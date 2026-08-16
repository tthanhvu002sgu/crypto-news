/**
 * MOVE TRACKER v2 — BTCUSDT realtime detector plus decision-time research log.
 * Champion: ATR/FIXED price displacement. Challenger: shadow-only participation
 * and cross-venue flow labels; it never suppresses a champion event.
 */

import { subscribeAggTrades, subscribeSpotAggTrades } from './websocket';
import { getATR, getATRState } from './atrCalculator';
import {
  DETECTION_WINDOWS_SEC,
  OUTCOME_HORIZONS_SEC,
  aggregateBuckets,
  buildBaselineSamples,
  buildDetectionScores,
  buildForwardOutcome,
  buildTimeframeContext,
  calculateRecoveryPct,
  classifyFlowLabel,
  classifyPriceOutcome,
  classifyShadowTier,
  percentileRank,
  selectMoveCandidate,
  thresholdForWindow,
} from './moveTrackerCore';
import {
  exportMoveEvents,
  getMoveStats,
  initializeMoveEventStore,
  loadMovePreview,
  queryMoveEvents,
  upsertMoveEvent,
} from './moveEventStore';

export { exportMoveEvents, getMoveStats, queryMoveEvents } from './moveEventStore';

export const MOVE_CONFIG = {
  MODE_ATR: 'ATR',
  MODE_FIXED: 'FIXED',
  DEFAULT_ATR_MULT: 1.5,
  DEFAULT_FIXED_USD: 500,
  LARGE_TRADE_MIN_USD: 100_000,
  MAX_MOVE_DURATION_SEC: 300,
  RECOVERY_TRACK_SEC: 60,
  COOLDOWN_SEC: 30,
  SHADOW_PARTICIPATION_PERCENTILE: 90,
};

const SETTINGS_LS_KEY = 'hft_move_tracker_settings_v2';
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BUCKET_MS = 1000;
const RING_RETENTION_MS = 65 * 60 * 1000;
const PRICE_RING_MAX = RING_RETENTION_MS / BUCKET_MS;
const ATR_REFRESH_MS = 60 * 1000;
const CONTEXT_REFRESH_MS = 60 * 1000;
const UI_NOTIFY_MS = 250;
const STATS_REFRESH_MS = 1200;
const STREAM_FRESH_MS = 10_000;
const EXTERNAL_CONTEXT_FRESH_MS = 5 * 60 * 1000;
const MIN_BASELINE_SAMPLES = 20;

const defaultSettings = {
  mode: MOVE_CONFIG.MODE_ATR,
  atrMult: MOVE_CONFIG.DEFAULT_ATR_MULT,
  fixedUsd: MOVE_CONFIG.DEFAULT_FIXED_USD,
  enabled: true,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_LS_KEY) || 'null');
    return saved && typeof saved === 'object' ? { ...defaultSettings, ...saved } : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isRecentMove(move, now = Date.now()) {
  return (move?.triggerTime ?? move?.startTime ?? 0) >= now - HISTORY_RETENTION_MS;
}

let currentSettings = loadSettings();
let trackerStatus = 'IDLE';
let activeMove = null;
let moveHistory = loadMovePreview().filter(isRecentMove);
let researchStats = null;
let lastMoveEndTime = 0;
let notifyTimer = null;
let statsTimer = null;
let atrRefreshPromise = null;
let lastAtrRefreshAt = 0;
let lastDetectionAt = 0;
let moveListeners = new Set();

const futuresBuckets = [];
const spotBuckets = [];
const pendingRecoveries = new Map();
const recoveryTimers = new Map();
const outcomeTrackers = new Map();

const marketHealth = {
  futuresLastTradeAt: null,
  spotLastTradeAt: null,
  source: 'Binance BTCUSDT',
};

let timeframeContext = {
  '5m': { timeframe: '5m', status: 'WARMING' },
  '15m': { timeframe: '15m', status: 'WARMING' },
  '1h': { timeframe: '1h', status: 'WARMING' },
};

let externalContext = {
  openInterest: null,
  fundingRate: null,
  obiPercent: null,
  orderBookSignal: null,
  updatedAt: 0,
};

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(currentSettings));
  } catch (error) {
    console.warn('[MoveTracker] Settings save unavailable:', error);
  }
}

function getSynchronousThreshold(windowSec = 120) {
  if (currentSettings.mode === MOVE_CONFIG.MODE_FIXED) return currentSettings.fixedUsd;
  return thresholdForWindow(getATRState().value, currentSettings.atrMult, windowSec);
}

function getStateSnapshot() {
  return {
    status: trackerStatus,
    activeMove: clone(activeMove),
    pendingRecoveries: Array.from(pendingRecoveries.values()).map((pending) => ({
      ...clone(pending.event),
      recoveryEndsAt: pending.recoveryEndsAt,
    })),
    moveHistory: clone(moveHistory),
    settings: { ...currentSettings },
    health: { ...marketHealth },
    atrState: getATRState(),
    thresholdUsd: getSynchronousThreshold(120),
    timeframeContext: clone(timeframeContext),
    researchStats: clone(researchStats),
  };
}

export function subscribeMoveTracker(listener) {
  moveListeners.add(listener);
  listener(getStateSnapshot());
  return () => moveListeners.delete(listener);
}

function notifyListeners() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
  const snapshot = getStateSnapshot();
  moveListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Isolate UI listeners from the realtime stream.
    }
  });
}

function scheduleNotify() {
  if (!notifyTimer) notifyTimer = setTimeout(notifyListeners, UI_NOTIFY_MS);
}

export function getMoveTrackerState() {
  return getStateSnapshot();
}

export function updateMoveTrackerSettings(newSettings) {
  currentSettings = { ...currentSettings, ...newSettings };
  saveSettings();
  if (newSettings.mode === MOVE_CONFIG.MODE_ATR || newSettings.atrMult != null) refreshAtrThreshold(true);
  notifyListeners();
}

export function updateMoveTrackerContext(snapshot = {}) {
  externalContext = {
    ...externalContext,
    openInterest: snapshot.openInterest ?? externalContext.openInterest,
    fundingRate: snapshot.fundingRate ?? externalContext.fundingRate,
    obiPercent: snapshot.obiPercent ?? externalContext.obiPercent,
    orderBookSignal: snapshot.orderBookSignal ?? externalContext.orderBookSignal,
    updatedAt: snapshot.updatedAt ?? Date.now(),
  };
}

async function refreshAtrThreshold(force = false) {
  if (!force && Date.now() - lastAtrRefreshAt < ATR_REFRESH_MS) return getATRState().value;
  if (atrRefreshPromise) return atrRefreshPromise;
  atrRefreshPromise = getATR('BTCUSDT', '5m', 14, { force })
    .then((value) => {
      lastAtrRefreshAt = Date.now();
      scheduleNotify();
      return value;
    })
    .finally(() => {
      atrRefreshPromise = null;
    });
  return atrRefreshPromise;
}

export async function getThresholdUsd() {
  if (currentSettings.mode === MOVE_CONFIG.MODE_FIXED) return currentSettings.fixedUsd;
  const atr = await refreshAtrThreshold();
  return thresholdForWindow(atr, currentSettings.atrMult, 120);
}

function appendTradeBucket(ring, trade, includePrice) {
  const timestamp = trade.timestamp || Date.now();
  const bucketTime = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
  let bucket = ring.at(-1);
  const created = !bucket || bucket.ts !== bucketTime;
  if (created) {
    bucket = {
      ts: bucketTime,
      open: includePrice ? trade.price : null,
      high: includePrice ? trade.price : null,
      low: includePrice ? trade.price : null,
      close: includePrice ? trade.price : null,
      totalVolume: 0,
      totalQty: 0,
      tradeCount: 0,
      takerBuyVol: 0,
      takerSellVol: 0,
      largeTradesCount: 0,
      largeTradesVol: 0,
      maxSingleTradeUsd: 0,
      maxSingleTradeSide: null,
    };
    ring.push(bucket);
  }
  if (includePrice) {
    bucket.high = Math.max(bucket.high, trade.price);
    bucket.low = Math.min(bucket.low, trade.price);
    bucket.close = trade.price;
  }
  bucket.totalVolume += trade.usdtVol;
  bucket.totalQty += trade.qty;
  bucket.tradeCount += 1;
  if (trade.isTakerSell) bucket.takerSellVol += trade.usdtVol;
  else bucket.takerBuyVol += trade.usdtVol;
  if (trade.usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD) {
    bucket.largeTradesCount += 1;
    bucket.largeTradesVol += trade.usdtVol;
  }
  if (trade.usdtVol > bucket.maxSingleTradeUsd) {
    bucket.maxSingleTradeUsd = trade.usdtVol;
    bucket.maxSingleTradeSide = trade.isTakerSell ? 'SELL' : 'BUY';
  }
  const cutoff = timestamp - RING_RETENTION_MS;
  while (ring.length > PRICE_RING_MAX || (ring[0] && ring[0].ts < cutoff)) ring.shift();
  return created;
}

function addTradeToStats(event, trade, prefix = '') {
  const totalVolumeKey = prefix ? `${prefix}TotalVolume` : 'totalVolume';
  const tradeCountKey = prefix ? `${prefix}TradeCount` : 'tradeCount';
  const takerBuyKey = prefix ? `${prefix}TakerBuyVol` : 'takerBuyVol';
  const takerSellKey = prefix ? `${prefix}TakerSellVol` : 'takerSellVol';
  event[totalVolumeKey] = (event[totalVolumeKey] || 0) + trade.usdtVol;
  event[tradeCountKey] = (event[tradeCountKey] || 0) + 1;
  if (trade.isTakerSell) event[takerSellKey] = (event[takerSellKey] || 0) + trade.usdtVol;
  else event[takerBuyKey] = (event[takerBuyKey] || 0) + trade.usdtVol;
  if (!prefix) {
    event.totalQty = (event.totalQty || 0) + trade.qty;
    if (trade.usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD) {
      event.largeTradesCount = (event.largeTradesCount || 0) + 1;
      event.largeTradesVol = (event.largeTradesVol || 0) + trade.usdtVol;
    }
    if (trade.usdtVol > (event.maxSingleTradeUsd || 0)) {
      event.maxSingleTradeUsd = trade.usdtVol;
      event.maxSingleTradeSide = trade.isTakerSell ? 'SELL' : 'BUY';
    }
  }
}

function eventStats(event, prefix = '') {
  return {
    totalVolume: event[prefix ? `${prefix}TotalVolume` : 'totalVolume'] || 0,
    tradeCount: event[prefix ? `${prefix}TradeCount` : 'tradeCount'] || 0,
    takerBuyVol: event[prefix ? `${prefix}TakerBuyVol` : 'takerBuyVol'] || 0,
    takerSellVol: event[prefix ? `${prefix}TakerSellVol` : 'takerSellVol'] || 0,
  };
}

function dataFreshness(now) {
  const atrState = getATRState(now);
  return {
    futuresFresh: marketHealth.futuresLastTradeAt != null && now - marketHealth.futuresLastTradeAt <= STREAM_FRESH_MS,
    spotFresh: marketHealth.spotLastTradeAt != null && now - marketHealth.spotLastTradeAt <= STREAM_FRESH_MS,
    atrFresh: atrState.status === 'LIVE',
    futuresAgeMs: marketHealth.futuresLastTradeAt == null ? null : now - marketHealth.futuresLastTradeAt,
    spotAgeMs: marketHealth.spotLastTradeAt == null ? null : now - marketHealth.spotLastTradeAt,
    atrAgeMs: Number.isFinite(atrState.ageMs) ? atrState.ageMs : null,
  };
}

function externalContextSnapshot(now) {
  return {
    ...externalContext,
    ageMs: externalContext.updatedAt ? now - externalContext.updatedAt : null,
    status: externalContext.updatedAt && now - externalContext.updatedAt <= EXTERNAL_CONTEXT_FRESH_MS ? 'FRESH' : 'STALE',
  };
}

function syncHistory(event) {
  if (event.status === 'TRACKING') return;
  moveHistory = [clone(event), ...moveHistory.filter((move) => move.id !== event.id)]
    .filter(isRecentMove)
    .sort((a, b) => (b.triggerTime || 0) - (a.triggerTime || 0))
    .slice(0, 500);
}

function scheduleStatsRefresh() {
  if (statsTimer) return;
  statsTimer = setTimeout(async () => {
    statsTimer = null;
    try {
      researchStats = await getMoveStats();
      notifyListeners();
    } catch (error) {
      console.warn('[MoveTracker] Stats refresh unavailable:', error);
    }
  }, STATS_REFRESH_MS);
}

function persistEvent(event) {
  upsertMoveEvent(event)
    .then(() => scheduleStatsRefresh())
    .catch((error) => console.warn('[MoveTracker] Event persistence unavailable:', error));
}

function buildTriggerEvent(candidate, detectionScores, price, now) {
  const futuresStats = aggregateBuckets(futuresBuckets, candidate.startTime, now);
  const spotStats = aggregateBuckets(spotBuckets, candidate.startTime, now);
  const baseline = buildBaselineSamples(futuresBuckets, candidate.windowSec, now);
  const tradeRate = futuresStats.tradeCount / Math.max(1, candidate.windowSec);
  const volumePercentile = percentileRank(baseline.map((sample) => sample.totalVolume), futuresStats.totalVolume);
  const tradeRatePercentile = percentileRank(baseline.map((sample) => sample.tradeRate), tradeRate);
  const participationPercentile = Math.max(volumePercentile ?? -Infinity, tradeRatePercentile ?? -Infinity);
  const freshness = dataFreshness(now);
  const flow = classifyFlowLabel(candidate.direction, futuresStats, spotStats, freshness);
  const dataComplete = freshness.futuresFresh && freshness.spotFresh && freshness.atrFresh && baseline.length >= MIN_BASELINE_SAMPLES;
  const qualityTier = classifyShadowTier({
    participationPercentile: Number.isFinite(participationPercentile) ? participationPercentile : null,
    futuresAligned: flow.futures.aligned,
    spotAligned: flow.spot.aligned,
    dataComplete,
  });
  const id = `move_${now}_${Math.round(price * 100)}`;
  return {
    id,
    schemaVersion: 2,
    symbol: 'BTCUSDT',
    market: 'BINANCE_FUTURES',
    confirmationMarket: 'BINANCE_SPOT',
    status: 'TRACKING',
    direction: candidate.direction,
    startTime: candidate.startTime,
    triggerTime: now,
    startPrice: candidate.startPrice,
    triggerPrice: price,
    endTime: null,
    endPrice: price,
    peakPrice: Math.max(candidate.startPrice, price),
    troughPrice: Math.min(candidate.startPrice, price),
    lastExtremeTime: now,
    detectionWindowSec: candidate.windowSec,
    thresholdUsd: candidate.thresholdUsd,
    thresholdMultiple: candidate.score,
    detectionScores: clone(detectionScores),
    detectorConfig: {
      champion: currentSettings.mode,
      mode: currentSettings.mode,
      atrMultiplier: currentSettings.atrMult,
      fixedUsd: currentSettings.fixedUsd,
      atr: getATRState(now),
      shadowOnly: true,
    },
    totalVolume: futuresStats.totalVolume,
    totalQty: futuresStats.totalQty,
    tradeCount: futuresStats.tradeCount,
    takerBuyVol: futuresStats.takerBuyVol,
    takerSellVol: futuresStats.takerSellVol,
    largeTradesCount: futuresStats.largeTradesCount,
    largeTradesVol: futuresStats.largeTradesVol,
    maxSingleTradeUsd: futuresStats.maxSingleTradeUsd,
    maxSingleTradeSide: futuresStats.maxSingleTradeSide,
    spotTotalVolume: spotStats.totalVolume,
    spotTradeCount: spotStats.tradeCount,
    spotTakerBuyVol: spotStats.takerBuyVol,
    spotTakerSellVol: spotStats.takerSellVol,
    qualityTier,
    flowLabel: flow.label,
    outcomeLabel: 'UNRESOLVED',
    dataQuality: { ...freshness, baselineSampleCount: baseline.length, complete: dataComplete },
    triggerSnapshot: {
      capturedAt: now,
      price,
      futures: { ...futuresStats, ...flow.futures },
      spot: { ...spotStats, ...flow.spot },
      volumePercentile,
      tradeRatePercentile,
      participationPercentile: Number.isFinite(participationPercentile) ? participationPercentile : null,
      qualityTier,
      flowLabel: flow.label,
      dataQuality: { ...freshness, baselineSampleCount: baseline.length, complete: dataComplete },
      externalContext: externalContextSnapshot(now),
    },
    endSnapshot: null,
    forwardOutcomes: {},
    timeframeContext: clone(timeframeContext),
  };
}

function startMove(candidate, scores, price, now) {
  activeMove = buildTriggerEvent(candidate, scores, price, now);
  trackerStatus = 'TRACKING';
  outcomeTrackers.set(activeMove.id, {
    event: activeMove,
    pathHigh: price,
    pathLow: price,
    pending: new Set(OUTCOME_HORIZONS_SEC),
  });
  persistEvent(activeMove);
  notifyListeners();
}

function updateMoveExtremes(event, price, now) {
  const madeDirectionalExtreme = event.direction === 'PUMP' ? price > event.peakPrice : price < event.troughPrice;
  event.peakPrice = Math.max(event.peakPrice, price);
  event.troughPrice = Math.min(event.troughPrice, price);
  if (madeDirectionalExtreme) event.lastExtremeTime = now;
  event.endPrice = price;
  const excursion = event.direction === 'PUMP' ? event.peakPrice - event.startPrice : event.startPrice - event.troughPrice;
  event.thresholdMultiple = excursion / Math.max(1, event.thresholdUsd);
}

function recentPriceSpeed(now) {
  const recent = futuresBuckets.filter((bucket) => bucket.ts >= now - 5000);
  if (recent.length < 2) return Infinity;
  return Math.abs(recent.at(-1).close - recent[0].open) / 5;
}

function shouldEndMove(event, now) {
  const trackingSec = (now - event.triggerTime) / 1000;
  const durationSec = (now - event.startTime) / 1000;
  if (durationSec >= MOVE_CONFIG.MAX_MOVE_DURATION_SEC) return true;
  if (trackingSec < 8 || (now - event.lastExtremeTime) / 1000 < 15) return false;
  const excursion = event.direction === 'PUMP' ? event.peakPrice - event.startPrice : event.startPrice - event.troughPrice;
  const pullback = event.direction === 'PUMP' ? event.peakPrice - event.endPrice : event.endPrice - event.troughPrice;
  const retracementRatio = excursion > 0 ? pullback / excursion : 0;
  return retracementRatio >= 0.2 || recentPriceSpeed(now) <= Math.max(5, event.thresholdUsd * 0.03);
}

function buildEndSnapshot(event, now, price) {
  const futuresStats = eventStats(event);
  const spotStats = eventStats(event, 'spot');
  const freshness = dataFreshness(now);
  const flow = classifyFlowLabel(event.direction, futuresStats, spotStats, freshness);
  const totalVolume = Math.max(1, futuresStats.totalVolume);
  return {
    capturedAt: now,
    price,
    durationSec: Math.max(1, Math.round((now - event.startTime) / 1000)),
    futures: {
      ...futuresStats,
      ...flow.futures,
      takerBuyRatio: Number(((futuresStats.takerBuyVol / totalVolume) * 100).toFixed(1)),
      largeTradeRatio: Number((((event.largeTradesVol || 0) / totalVolume) * 100).toFixed(1)),
      avgTradeSize: Math.round(totalVolume / Math.max(1, futuresStats.tradeCount)),
    },
    spot: { ...spotStats, ...flow.spot },
    flowLabel: flow.label,
    dataQuality: freshness,
    externalContext: externalContextSnapshot(now),
  };
}

function beginRecovery(event, price, now) {
  event.endTime = now;
  event.endPrice = price;
  event.status = 'POST_EVENT';
  event.endSnapshot = buildEndSnapshot(event, now, price);
  event.finalFlowLabel = event.endSnapshot.flowLabel;
  const pending = {
    event,
    latestPrice: price,
    latestTradeAt: now,
    recoveryHigh: price,
    recoveryLow: price,
    recoveryEndsAt: now + MOVE_CONFIG.RECOVERY_TRACK_SEC * 1000,
  };
  pendingRecoveries.set(event.id, pending);
  const timer = setTimeout(() => finalizeRecovery(event.id), MOVE_CONFIG.RECOVERY_TRACK_SEC * 1000);
  recoveryTimers.set(event.id, timer);
  lastMoveEndTime = now;
  activeMove = null;
  trackerStatus = 'IDLE';
  syncHistory(event);
  persistEvent(event);
  notifyListeners();
}

function finalizeRecovery(eventId) {
  const pending = pendingRecoveries.get(eventId);
  if (!pending) return;
  pendingRecoveries.delete(eventId);
  const timer = recoveryTimers.get(eventId);
  if (timer) clearTimeout(timer);
  recoveryTimers.delete(eventId);
  const event = pending.event;
  const distanceMs = Math.abs((pending.latestTradeAt ?? 0) - pending.recoveryEndsAt);
  const dataStatus = distanceMs <= STREAM_FRESH_MS ? 'COMPLETE' : 'DATA_GAP';
  const recoveryPct = dataStatus === 'COMPLETE'
    ? calculateRecoveryPct(event.direction, event.startPrice, event.peakPrice, event.troughPrice, pending.latestPrice)
    : null;
  event.recovery = {
    targetTime: pending.recoveryEndsAt,
    observedAt: pending.latestTradeAt,
    finalPrice: pending.latestPrice,
    recoveryHigh: pending.recoveryHigh,
    recoveryLow: pending.recoveryLow,
    recoveryPct: recoveryPct == null ? null : Number(recoveryPct.toFixed(1)),
    dataStatus,
  };
  event.outcomeLabel = classifyPriceOutcome(recoveryPct, dataStatus);
  event.status = outcomeTrackers.has(event.id) ? 'MONITORING' : 'COMPLETE';
  syncHistory(event);
  persistEvent(event);
  notifyListeners();
}

function updatePendingRecoveries(price, timestamp) {
  const ready = [];
  pendingRecoveries.forEach((pending, id) => {
    pending.latestPrice = price;
    pending.latestTradeAt = timestamp;
    pending.recoveryHigh = Math.max(pending.recoveryHigh, price);
    pending.recoveryLow = Math.min(pending.recoveryLow, price);
    if (timestamp >= pending.recoveryEndsAt) ready.push(id);
  });
  ready.forEach(finalizeRecovery);
}

function updateForwardOutcomes(price, timestamp) {
  outcomeTrackers.forEach((tracker, id) => {
    tracker.pathHigh = Math.max(tracker.pathHigh, price);
    tracker.pathLow = Math.min(tracker.pathLow, price);
    let changed = false;
    Array.from(tracker.pending).sort((a, b) => a - b).forEach((horizonSec) => {
      const targetTime = tracker.event.triggerTime + horizonSec * 1000;
      if (timestamp < targetTime) return;
      tracker.event.forwardOutcomes[String(horizonSec)] = buildForwardOutcome({
        event: tracker.event,
        price,
        timestamp,
        targetTime,
        pathHigh: tracker.pathHigh,
        pathLow: tracker.pathLow,
      });
      tracker.pending.delete(horizonSec);
      changed = true;
    });
    if (!changed) return;
    if (tracker.pending.size === 0) {
      tracker.event.status = pendingRecoveries.has(id) ? 'POST_EVENT' : 'COMPLETE';
      outcomeTrackers.delete(id);
    }
    syncHistory(tracker.event);
    persistEvent(tracker.event);
    scheduleNotify();
  });
}

function findMoveCandidate(price, now) {
  const atrState = getATRState(now);
  const scores = buildDetectionScores({
    buckets: futuresBuckets,
    price,
    now,
    atrValue: atrState.status === 'LIVE' ? atrState.value : null,
    atrMultiplier: currentSettings.atrMult,
    fixedUsd: currentSettings.fixedUsd,
    mode: currentSettings.mode,
  });
  return { candidate: selectMoveCandidate(scores), scores };
}

function handleIncomingTrade(trade) {
  const now = trade.timestamp || Date.now();
  marketHealth.futuresLastTradeAt = now;
  appendTradeBucket(futuresBuckets, trade, true);
  updatePendingRecoveries(trade.price, now);
  updateForwardOutcomes(trade.price, now);
  if (!currentSettings.enabled) {
    scheduleNotify();
    return;
  }
  if (currentSettings.mode === MOVE_CONFIG.MODE_ATR) refreshAtrThreshold();

  if (trackerStatus === 'IDLE') {
    if (now - lastMoveEndTime < MOVE_CONFIG.COOLDOWN_SEC * 1000 || now - lastDetectionAt < UI_NOTIFY_MS) {
      scheduleNotify();
      return;
    }
    lastDetectionAt = now;
    const { candidate, scores } = findMoveCandidate(trade.price, now);
    if (candidate) startMove(candidate, scores, trade.price, now);
    else scheduleNotify();
    return;
  }

  if (trackerStatus === 'TRACKING' && activeMove) {
    addTradeToStats(activeMove, trade);
    updateMoveExtremes(activeMove, trade.price, now);
    if (shouldEndMove(activeMove, now)) beginRecovery(activeMove, trade.price, now);
    else scheduleNotify();
  }
}

function handleIncomingSpotTrade(trade) {
  const now = trade.timestamp || Date.now();
  marketHealth.spotLastTradeAt = now;
  appendTradeBucket(spotBuckets, trade, false);
  if (activeMove && now >= activeMove.startTime) addTradeToStats(activeMove, trade, 'spot');
  scheduleNotify();
}

async function refreshTimeframeContext() {
  const now = Date.now();
  const entries = await Promise.all(['5m', '15m', '1h'].map(async (timeframe) => {
    try {
      const params = new URLSearchParams({ symbol: 'BTCUSDT', interval: timeframe, limit: '40' });
      const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return [timeframe, buildTimeframeContext(await response.json(), timeframe, now)];
    } catch (error) {
      return [timeframe, { timeframe, status: 'UNAVAILABLE', error: error instanceof Error ? error.message : String(error) }];
    }
  }));
  timeframeContext = Object.fromEntries(entries);
  scheduleNotify();
}

async function initializeResearchHistory() {
  try {
    await initializeMoveEventStore();
    const stored = await queryMoveEvents({ limit: 500 });
    for (const event of stored) {
      if (['TRACKING', 'POST_EVENT', 'MONITORING'].includes(event.status)) {
        event.status = 'INTERRUPTED';
        event.dataQuality = { ...event.dataQuality, interruptedByReload: true, complete: false };
        await upsertMoveEvent(event);
      }
    }
    moveHistory = stored.filter(isRecentMove);
    researchStats = await getMoveStats();
    notifyListeners();
  } catch (error) {
    console.warn('[MoveTracker] Research store initialization unavailable:', error);
  }
}

subscribeAggTrades(handleIncomingTrade);
subscribeSpotAggTrades(handleIncomingSpotTrade);
initializeResearchHistory();
refreshAtrThreshold(true);
refreshTimeframeContext();
setInterval(refreshTimeframeContext, CONTEXT_REFRESH_MS);

export const MOVE_RESEARCH = {
  detectionWindowsSec: DETECTION_WINDOWS_SEC,
  outcomeHorizonsSec: OUTCOME_HORIZONS_SEC,
  minBaselineSamples: MIN_BASELINE_SAMPLES,
  retentionDays: 90,
  championPreserved: true,
  challengerMode: 'SHADOW',
};

export async function downloadMoveResearch(format = 'json') {
  const content = await exportMoveEvents(format);
  const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `btc-move-research-${new Date().toISOString().slice(0, 10)}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
