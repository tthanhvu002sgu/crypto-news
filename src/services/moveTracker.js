/**
 * Move Tracker Service — realtime Binance BTCUSDT move detection.
 * Futures drives price detection; Spot is retained as an independent confirmation venue.
 */

import { subscribeAggTrades, subscribeSpotAggTrades } from './websocket';
import { getATR, getCurrentATR } from './atrCalculator';
import { addSignal, getMoveReports } from './signalStore';
import { SIGNAL_TYPE, SEVERITY } from './signalEngine';

export const MOVE_CONFIG = {
  MODE_ATR: 'ATR',
  MODE_FIXED: 'FIXED',
  DEFAULT_ATR_MULT: 1.5,
  DEFAULT_FIXED_USD: 500,
  LARGE_TRADE_MIN_USD: 100_000,
  MAX_MOVE_DURATION_SEC: 300,
  RECOVERY_TRACK_SEC: 60,
  COOLDOWN_SEC: 30,
};

const SETTINGS_LS_KEY = 'hft_move_tracker_settings_v2';
const MOVE_HISTORY_LS_KEY = 'hft_move_history_v1';
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BUCKET_MS = 1000;
const RING_RETENTION_MS = 180 * 1000;
const PRICE_RING_MAX = RING_RETENTION_MS / BUCKET_MS;
const DETECTION_WINDOWS_SEC = [15, 30, 60, 120];
const ATR_REFRESH_MS = 60 * 1000;
const UI_NOTIFY_MS = 250;

const defaultSettings = {
  mode: MOVE_CONFIG.MODE_ATR,
  atrMult: MOVE_CONFIG.DEFAULT_ATR_MULT,
  fixedUsd: MOVE_CONFIG.DEFAULT_FIXED_USD,
  enabled: true,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_LS_KEY) || 'null');
    return saved && typeof saved === 'object' ? { ...defaultSettings, ...saved } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function isRecentMove(move, now = Date.now()) {
  const timestamp = move?.startTime || move?.endTime || 0;
  return timestamp >= now - HISTORY_RETENTION_MS;
}

function loadMoveHistoryLS() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MOVE_HISTORY_LS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentMove).slice(0, 50) : [];
  } catch {
    return [];
  }
}

let currentSettings = loadSettings();
let trackerStatus = 'IDLE';
let activeMove = null;
let moveHistory = loadMoveHistoryLS();
let lastMoveEndTime = 0;
let moveListeners = new Set();
let notifyTimer = null;
let thresholdRefreshPromise = null;
let lastAtrRefreshAt = 0;
let cachedAtrThreshold = Math.max(1, getCurrentATR() * currentSettings.atrMult);

const futuresBuckets = [];
const spotBuckets = [];
const pendingRecoveries = new Map();
const marketHealth = {
  futuresLastTradeAt: null,
  spotLastTradeAt: null,
  source: 'Binance BTCUSDT',
};

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(currentSettings));
  } catch (error) {
    console.warn('[MoveTracker] Settings save error:', error);
  }
}

function saveMoveHistoryLS() {
  try {
    moveHistory = moveHistory.filter(isRecentMove).slice(0, 50);
    localStorage.setItem(MOVE_HISTORY_LS_KEY, JSON.stringify(moveHistory));
  } catch (error) {
    console.warn('[MoveTracker] History save error:', error);
  }
}

async function initMoveHistoryFromStore() {
  try {
    const stored = await getMoveReports(100);
    const map = new Map();
    moveHistory.filter(isRecentMove).forEach((move) => map.set(move.id || move.startTime, move));
    stored
      .map((signal) => signal.moveReport)
      .filter((move) => move && isRecentMove(move))
      .forEach((move) => map.set(move.id || move.startTime, move));
    moveHistory = Array.from(map.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .slice(0, 50);
    saveMoveHistoryLS();
    notifyListeners();
  } catch (error) {
    console.warn('[MoveTracker] History restore error:', error);
  }
}

function recoverySnapshots() {
  return Array.from(pendingRecoveries.values())
    .sort((a, b) => b.endTime - a.endTime)
    .map((move) => ({ ...move, recoveryTimer: undefined }));
}

function getStateSnapshot() {
  return {
    status: trackerStatus,
    activeMove: activeMove ? { ...activeMove } : null,
    pendingRecoveries: recoverySnapshots(),
    moveHistory: [...moveHistory],
    settings: { ...currentSettings },
    health: { ...marketHealth },
    thresholdUsd: getSynchronousThreshold(120),
  };
}

export function subscribeMoveTracker(listener) {
  moveListeners.add(listener);
  listener(getStateSnapshot());
  return () => moveListeners.delete(listener);
}

function notifyListeners() {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  const snapshot = getStateSnapshot();
  moveListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Isolate UI listeners from the trade stream.
    }
  });
}

function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(notifyListeners, UI_NOTIFY_MS);
}

export function getMoveTrackerState() {
  return getStateSnapshot();
}

export function updateMoveTrackerSettings(newSettings) {
  currentSettings = { ...currentSettings, ...newSettings };
  saveSettings();
  if (newSettings.atrMult != null || newSettings.mode === MOVE_CONFIG.MODE_ATR) {
    cachedAtrThreshold = Math.max(1, getCurrentATR() * currentSettings.atrMult);
    refreshAtrThreshold(true);
  }
  notifyListeners();
}

async function refreshAtrThreshold(force = false) {
  if (!force && Date.now() - lastAtrRefreshAt < ATR_REFRESH_MS) return cachedAtrThreshold;
  if (thresholdRefreshPromise) return thresholdRefreshPromise;
  thresholdRefreshPromise = getATR('BTCUSDT', '5m', 14)
    .then((atr) => {
      cachedAtrThreshold = Math.max(1, atr * currentSettings.atrMult);
      lastAtrRefreshAt = Date.now();
      return cachedAtrThreshold;
    })
    .finally(() => {
      thresholdRefreshPromise = null;
    });
  return thresholdRefreshPromise;
}

export async function getThresholdUsd() {
  if (currentSettings.mode === MOVE_CONFIG.MODE_FIXED) return currentSettings.fixedUsd;
  return refreshAtrThreshold();
}

function getSynchronousThreshold(windowSec = 120) {
  if (currentSettings.mode === MOVE_CONFIG.MODE_FIXED) return currentSettings.fixedUsd;
  // Scale the 5m ATR to the observation window while retaining a noise floor.
  const timeScale = Math.max(0.45, Math.sqrt(windowSec / 300));
  return Math.max(1, cachedAtrThreshold * timeScale);
}

function appendTradeBucket(ring, trade, includePrice) {
  const timestamp = trade.timestamp || Date.now();
  const bucketTime = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
  let bucket = ring[ring.length - 1];

  if (!bucket || bucket.ts !== bucketTime) {
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
}

function aggregateBuckets(ring, startTime, endTime = Infinity) {
  return ring.reduce((result, bucket) => {
    if (bucket.ts < startTime || bucket.ts > endTime) return result;
    result.totalVolume += bucket.totalVolume;
    result.totalQty += bucket.totalQty;
    result.tradeCount += bucket.tradeCount;
    result.takerBuyVol += bucket.takerBuyVol;
    result.takerSellVol += bucket.takerSellVol;
    result.largeTradesCount += bucket.largeTradesCount;
    result.largeTradesVol += bucket.largeTradesVol;
    if (bucket.maxSingleTradeUsd > result.maxSingleTradeUsd) {
      result.maxSingleTradeUsd = bucket.maxSingleTradeUsd;
      result.maxSingleTradeSide = bucket.maxSingleTradeSide;
    }
    return result;
  }, {
    totalVolume: 0,
    totalQty: 0,
    tradeCount: 0,
    takerBuyVol: 0,
    takerSellVol: 0,
    largeTradesCount: 0,
    largeTradesVol: 0,
    maxSingleTradeUsd: 0,
    maxSingleTradeSide: null,
  });
}

function findMoveCandidate(price, now) {
  let best = null;
  for (const windowSec of DETECTION_WINDOWS_SEC) {
    const start = now - windowSec * 1000;
    const buckets = futuresBuckets.filter((bucket) => bucket.ts >= start && bucket.ts <= now);
    if (buckets.length < Math.min(3, windowSec)) continue;

    const pumpBase = buckets.reduce((min, bucket) => bucket.low < min.low ? bucket : min, buckets[0]);
    const dumpBase = buckets.reduce((max, bucket) => bucket.high > max.high ? bucket : max, buckets[0]);
    const thresholdUsd = getSynchronousThreshold(windowSec);
    const candidates = [
      { direction: 'PUMP', startPrice: pumpBase.low, startTime: pumpBase.ts, delta: price - pumpBase.low },
      { direction: 'DUMP', startPrice: dumpBase.high, startTime: dumpBase.ts, delta: dumpBase.high - price },
    ];

    for (const candidate of candidates) {
      const score = candidate.delta / thresholdUsd;
      if (score >= 1 && (!best || score > best.score)) {
        best = { ...candidate, score, thresholdUsd, windowSec };
      }
    }
  }
  return best;
}

function startMove(candidate, price, now) {
  const futuresStats = aggregateBuckets(futuresBuckets, candidate.startTime, now);
  const spotStats = aggregateBuckets(spotBuckets, candidate.startTime, now);
  activeMove = {
    id: `move_${now}`,
    direction: candidate.direction,
    source: 'BINANCE_FUTURES',
    confirmationSource: 'BINANCE_SPOT',
    startTime: candidate.startTime,
    triggerTime: now,
    startPrice: candidate.startPrice,
    peakPrice: Math.max(candidate.startPrice, price),
    troughPrice: Math.min(candidate.startPrice, price),
    endPrice: price,
    endTime: null,
    ...futuresStats,
    spotTotalVolume: spotStats.totalVolume,
    spotTradeCount: spotStats.tradeCount,
    spotTakerBuyVol: spotStats.takerBuyVol,
    spotTakerSellVol: spotStats.takerSellVol,
    lastExtremeTime: now,
    thresholdUsd: candidate.thresholdUsd,
    detectionWindowSec: candidate.windowSec,
    thresholdMultiple: candidate.score,
  };
  trackerStatus = 'TRACKING';
  notifyListeners();
}

function addFuturesTradeToMove(move, trade) {
  move.totalVolume += trade.usdtVol;
  move.totalQty += trade.qty;
  move.tradeCount += 1;
  if (trade.isTakerSell) move.takerSellVol += trade.usdtVol;
  else move.takerBuyVol += trade.usdtVol;
  if (trade.usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD) {
    move.largeTradesCount += 1;
    move.largeTradesVol += trade.usdtVol;
  }
  if (trade.usdtVol > move.maxSingleTradeUsd) {
    move.maxSingleTradeUsd = trade.usdtVol;
    move.maxSingleTradeSide = trade.isTakerSell ? 'SELL' : 'BUY';
  }
}

function updateMoveExtremes(move, price, now) {
  const previousDirection = move.direction;
  const madeNewPeak = price > move.peakPrice;
  const madeNewTrough = price < move.troughPrice;
  if (madeNewPeak) move.peakPrice = price;
  if (madeNewTrough) move.troughPrice = price;

  const pumpExcursion = move.peakPrice - move.startPrice;
  const dumpExcursion = move.startPrice - move.troughPrice;
  move.direction = pumpExcursion >= dumpExcursion ? 'PUMP' : 'DUMP';
  const isDirectionExtreme =
    (move.direction === 'PUMP' && madeNewPeak) ||
    (move.direction === 'DUMP' && madeNewTrough);
  if (isDirectionExtreme || move.direction !== previousDirection) move.lastExtremeTime = now;
  move.endPrice = price;
  move.thresholdMultiple = Math.max(pumpExcursion, dumpExcursion) / Math.max(1, move.thresholdUsd);
}

function recentPriceSpeed(now) {
  const recent = futuresBuckets.filter((bucket) => bucket.ts >= now - 5000);
  if (recent.length < 2) return Infinity;
  return Math.abs(recent[recent.length - 1].close - recent[0].open) / 5;
}

function shouldEndMove(move, now) {
  const trackingSec = (now - move.triggerTime) / 1000;
  const durationSec = (now - move.startTime) / 1000;
  if (durationSec >= MOVE_CONFIG.MAX_MOVE_DURATION_SEC) return true;
  if (trackingSec < 8 || (now - move.lastExtremeTime) / 1000 < 15) return false;

  const excursion = move.direction === 'PUMP'
    ? move.peakPrice - move.startPrice
    : move.startPrice - move.troughPrice;
  const pullback = move.direction === 'PUMP'
    ? move.peakPrice - move.endPrice
    : move.endPrice - move.troughPrice;
  const retracementRatio = excursion > 0 ? pullback / excursion : 0;
  const isQuiet = recentPriceSpeed(now) <= Math.max(5, move.thresholdUsd * 0.03);
  return retracementRatio >= 0.2 || isQuiet;
}

function beginRecovery(move, price, now) {
  const recoveringMove = {
    ...move,
    endTime: now,
    endPrice: price,
    latestRecoveryPrice: price,
    latestRecoveryTradeAt: now,
    recoveryHigh: price,
    recoveryLow: price,
    recoveryEndsAt: now + MOVE_CONFIG.RECOVERY_TRACK_SEC * 1000,
  };
  recoveringMove.recoveryTimer = setTimeout(
    () => finalizeMoveReport(recoveringMove.id),
    MOVE_CONFIG.RECOVERY_TRACK_SEC * 1000
  );
  pendingRecoveries.set(recoveringMove.id, recoveringMove);
  lastMoveEndTime = now;
  activeMove = null;
  trackerStatus = 'IDLE';
  notifyListeners();
}

function updatePendingRecoveries(price, timestamp) {
  pendingRecoveries.forEach((move) => {
    move.latestRecoveryPrice = price;
    move.latestRecoveryTradeAt = timestamp;
    move.recoveryHigh = Math.max(move.recoveryHigh, price);
    move.recoveryLow = Math.min(move.recoveryLow, price);
  });
}

function venueFlowContext(move) {
  const futuresCvd = move.takerBuyVol - move.takerSellVol;
  const spotAvailable = move.spotTradeCount > 0;
  const spotCvd = spotAvailable ? move.spotTakerBuyVol - move.spotTakerSellVol : null;
  const expectedSign = move.direction === 'PUMP' ? 1 : -1;
  const futuresConfirms = Math.sign(futuresCvd) === expectedSign;
  const spotConfirms = spotAvailable ? Math.sign(spotCvd) === expectedSign : null;
  let flowContext = spotAvailable ? 'MIXED_FLOW' : 'FUTURES_ONLY_UNCONFIRMED';
  if (futuresConfirms && spotConfirms) flowContext = 'SPOT_CONFIRMED';
  else if (spotAvailable && futuresConfirms && !spotConfirms) flowContext = 'FUTURES_LED';
  else if (!futuresConfirms && spotConfirms) flowContext = 'SPOT_LED';
  return { futuresCvd, spotCvd, futuresConfirms, spotConfirms, spotAvailable, flowContext };
}

function classifyMoveVerdict(move) {
  const evidence = [];
  const scores = { LIQUIDITY_SWEEP: 0, WHALE_PUSH: 0, STOP_HUNT: 0 };
  const directionBuyRatio = move.direction === 'PUMP' ? move.takerBuyRatio : 100 - move.takerBuyRatio;
  const tradeRate = move.tradeCount / Math.max(1, move.durationSec);

  if (move.recoveryPct == null) evidence.push('Recovery 60s không hợp lệ do data gap');

  if (move.recoveryPct >= 50) {
    scores.LIQUIDITY_SWEEP += 55;
    evidence.push(`Hồi ${move.recoveryPct.toFixed(1)}% sau 60s`);
  } else if (move.recoveryPct >= 30) {
    scores.LIQUIDITY_SWEEP += 30;
    scores.STOP_HUNT += 25;
  }
  if (move.largeTradeRatio >= 35) {
    scores.WHALE_PUSH += 35;
    evidence.push(`Lệnh ≥$100K chiếm ${move.largeTradeRatio.toFixed(1)}% volume Futures`);
  }
  if (directionBuyRatio >= 58) scores.WHALE_PUSH += 20;
  if (move.flowContext === 'SPOT_CONFIRMED') {
    scores.WHALE_PUSH += 20;
    evidence.push('Spot và Futures cùng hướng');
  }
  if (move.flowContext === 'FUTURES_LED') {
    scores.LIQUIDITY_SWEEP += 15;
    scores.STOP_HUNT += 15;
    evidence.push('Futures dẫn dắt, Spot chưa xác nhận');
  }
  if (move.flowContext === 'FUTURES_ONLY_UNCONFIRMED') {
    evidence.push('Thiếu executed flow Spot cùng cửa sổ');
  }
  if (tradeRate >= 20 && move.avgTradeSize < 20_000) {
    scores.STOP_HUNT += 35;
    evidence.push(`${tradeRate.toFixed(1)} trades/s, size trung bình thấp`);
  }
  if (move.recoveryPct >= 25) scores.STOP_HUNT += 20;
  if (move.recoveryPct != null && move.recoveryPct < 25) scores.WHALE_PUSH += 10;

  const [verdict, topScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const confidenceScore = Math.min(
    move.recoveryPct == null ? 60 : 95,
    Math.max(35, Math.round(topScore))
  );
  const verdictMap = {
    LIQUIDITY_SWEEP: { label: 'Khả năng quét thanh khoản', icon: '◇', color: '#d4a373' },
    WHALE_PUSH: { label: 'Khả năng dòng tiền lớn đẩy giá', icon: '◆', color: '#10b981' },
    STOP_HUNT: { label: 'Khả năng quét stop', icon: '◎', color: '#f43f5e' },
  };

  if (topScore < 55) {
    return {
      verdict: 'MIXED',
      label: 'Chưa đủ bằng chứng',
      icon: '○',
      color: '#888892',
      confidenceScore,
      evidence,
      reason: 'Tín hiệu chưa hội tụ đủ giữa recovery, executed flow Futures và xác nhận Spot.',
    };
  }
  const meta = verdictMap[verdict];
  return {
    verdict,
    ...meta,
    confidenceScore,
    evidence,
    reason: `${meta.label} (${confidenceScore}% confidence). ${evidence.join('; ') || 'Bằng chứng còn hạn chế'}. Đây là phân loại xác suất, không phải kết luận nguyên nhân.`,
  };
}

function calculateRecoveryPct(move, finalPrice) {
  if (move.direction === 'PUMP') {
    const excursion = move.peakPrice - move.startPrice;
    return excursion > 0 ? Math.max(0, Math.min(100, ((move.peakPrice - finalPrice) / excursion) * 100)) : 0;
  }
  const excursion = move.startPrice - move.troughPrice;
  return excursion > 0 ? Math.max(0, Math.min(100, ((finalPrice - move.troughPrice) / excursion) * 100)) : 0;
}

function getMoveSeverity(move) {
  if (move.thresholdMultiple >= 2.5 || (Math.abs(move.pctChange) >= 2 && move.confidenceScore >= 70)) {
    return SEVERITY.CRITICAL;
  }
  if (move.thresholdMultiple >= 1.5 || move.confidenceScore >= 70) return SEVERITY.HIGH;
  return SEVERITY.MEDIUM;
}

async function finalizeMoveReport(moveId) {
  const pending = pendingRecoveries.get(moveId);
  if (!pending) return;
  pendingRecoveries.delete(moveId);
  if (pending.recoveryTimer) clearTimeout(pending.recoveryTimer);

  const finalPriceAfter60s = pending.latestRecoveryPrice ?? pending.endPrice;
  const recoveryDataGap = !pending.latestRecoveryTradeAt ||
    pending.recoveryEndsAt - pending.latestRecoveryTradeAt > 10_000;
  const totalVolume = pending.totalVolume || 1;
  const spotTotalVolume = pending.spotTotalVolume || 0;
  const durationSec = Math.max(1, Math.round((pending.endTime - pending.startTime) / 1000));
  const flow = venueFlowContext(pending);
  const enrichedMove = {
    ...pending,
    recoveryTimer: undefined,
    durationSec,
    pctChange: Number((((pending.endPrice - pending.startPrice) / pending.startPrice) * 100).toFixed(2)),
    priceMoveUsd: Math.round(Math.abs(pending.endPrice - pending.startPrice)),
    totalRangeUsd: Math.round(pending.peakPrice - pending.troughPrice),
    takerBuyRatio: Number(((pending.takerBuyVol / totalVolume) * 100).toFixed(1)),
    spotTakerBuyRatio: spotTotalVolume > 0
      ? Number(((pending.spotTakerBuyVol / spotTotalVolume) * 100).toFixed(1))
      : null,
    largeTradeRatio: Number(((pending.largeTradesVol / totalVolume) * 100).toFixed(1)),
    avgTradeSize: Math.round(totalVolume / Math.max(1, pending.tradeCount)),
    cvdDelta: Math.round(flow.futuresCvd),
    spotCvdDelta: flow.spotCvd == null ? null : Math.round(flow.spotCvd),
    flowContext: flow.flowContext,
    spotConfirms: flow.spotConfirms,
    recoveryPct: recoveryDataGap
      ? null
      : Number(calculateRecoveryPct(pending, finalPriceAfter60s).toFixed(1)),
    recoveryStatus: recoveryDataGap ? 'DATA_GAP' : 'COMPLETE',
    finalPriceAfter60s,
  };
  const verdict = classifyMoveVerdict(enrichedMove);
  Object.assign(enrichedMove, {
    verdict: verdict.verdict,
    verdictLabel: verdict.label,
    verdictIcon: verdict.icon,
    verdictColor: verdict.color,
    verdictReason: verdict.reason,
    confidenceScore: verdict.confidenceScore,
    evidence: verdict.evidence,
  });

  moveHistory = [enrichedMove, ...moveHistory.filter((move) => move.id !== enrichedMove.id)]
    .filter(isRecentMove)
    .slice(0, 50);
  saveMoveHistoryLS();
  notifyListeners();

  try {
    const directionIcon = enrichedMove.direction === 'PUMP' ? '▲' : '▼';
    await addSignal({
      type: SIGNAL_TYPE.MOVE_REPORT,
      severity: getMoveSeverity(enrichedMove),
      timestamp: enrichedMove.endTime,
      title: `${directionIcon} ${enrichedMove.direction} BTC ${enrichedMove.pctChange >= 0 ? '+' : ''}${enrichedMove.pctChange}% trong ${durationSec}s`,
      description: `Futures volume $${(enrichedMove.totalVolume / 1e6).toFixed(1)}M | Futures CVD ${enrichedMove.cvdDelta >= 0 ? '+' : ''}$${(enrichedMove.cvdDelta / 1e6).toFixed(1)}M | Spot CVD ${enrichedMove.spotCvdDelta == null ? 'N/A' : `${enrichedMove.spotCvdDelta >= 0 ? '+' : ''}$${(enrichedMove.spotCvdDelta / 1e6).toFixed(1)}M`} | ${verdict.label} ${verdict.confidenceScore}%`,
      moveReport: enrichedMove,
      snapshot: {
        btcPrice: enrichedMove.endPrice,
        cvd: enrichedMove.cvdDelta,
        spotCvd: enrichedMove.spotCvdDelta,
        buyVolume: enrichedMove.takerBuyVol,
        sellVolume: enrichedMove.takerSellVol,
        buyRatio: enrichedMove.takerBuyRatio,
        moveFlowContext: enrichedMove.flowContext,
      },
    });
  } catch (error) {
    console.error('[MoveTracker] Failed to save move signal:', error);
  }
}

function handleIncomingTrade(trade) {
  const now = trade.timestamp || Date.now();
  marketHealth.futuresLastTradeAt = now;
  appendTradeBucket(futuresBuckets, trade, true);
  updatePendingRecoveries(trade.price, now);
  if (!currentSettings.enabled) {
    scheduleNotify();
    return;
  }

  if (currentSettings.mode === MOVE_CONFIG.MODE_ATR) refreshAtrThreshold();

  if (trackerStatus === 'IDLE') {
    if (now - lastMoveEndTime < MOVE_CONFIG.COOLDOWN_SEC * 1000) {
      scheduleNotify();
      return;
    }
    const candidate = findMoveCandidate(trade.price, now);
    if (candidate) startMove(candidate, trade.price, now);
    else scheduleNotify();
    return;
  }

  if (trackerStatus === 'TRACKING' && activeMove) {
    addFuturesTradeToMove(activeMove, trade);
    updateMoveExtremes(activeMove, trade.price, now);
    if (shouldEndMove(activeMove, now)) beginRecovery(activeMove, trade.price, now);
    else scheduleNotify();
  }
}

function handleIncomingSpotTrade(trade) {
  const now = trade.timestamp || Date.now();
  marketHealth.spotLastTradeAt = now;
  appendTradeBucket(spotBuckets, trade, false);
  if (activeMove && now >= activeMove.startTime) {
    activeMove.spotTotalVolume += trade.usdtVol;
    activeMove.spotTradeCount += 1;
    if (trade.isTakerSell) activeMove.spotTakerSellVol += trade.usdtVol;
    else activeMove.spotTakerBuyVol += trade.usdtVol;
  }
  scheduleNotify();
}

subscribeAggTrades(handleIncomingTrade);
subscribeSpotAggTrades(handleIncomingSpotTrade);
initMoveHistoryFromStore();
refreshAtrThreshold(true);

export async function simulateMoveReport(direction = 'PUMP') {
  const isPump = direction === 'PUMP';
  const now = Date.now();
  const startPrice = 96_000 + Math.floor(Math.random() * 2_000);
  const moveUsd = 500 + Math.floor(Math.random() * 700);
  const endPrice = isPump ? startPrice + moveUsd : startPrice - moveUsd;
  const totalVolume = 25_000_000;
  const simulated = {
    id: `sim_${now}`,
    direction,
    source: 'BINANCE_FUTURES',
    confirmationSource: 'BINANCE_SPOT',
    startPrice,
    endPrice,
    troughPrice: isPump ? startPrice : endPrice,
    peakPrice: isPump ? endPrice : startPrice,
    startTime: now - 120_000,
    triggerTime: now - 90_000,
    endTime: now - 60_000,
    durationSec: 60,
    thresholdUsd: 500,
    thresholdMultiple: moveUsd / 500,
    pctChange: Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2)),
    priceMoveUsd: moveUsd,
    totalRangeUsd: moveUsd,
    totalVolume,
    totalQty: totalVolume / startPrice,
    takerBuyVol: isPump ? totalVolume * 0.7 : totalVolume * 0.3,
    takerSellVol: isPump ? totalVolume * 0.3 : totalVolume * 0.7,
    takerBuyRatio: isPump ? 70 : 30,
    tradeCount: 1_200,
    largeTradesCount: 18,
    largeTradesVol: 9_000_000,
    largeTradeRatio: 36,
    maxSingleTradeUsd: 850_000,
    maxSingleTradeSide: isPump ? 'BUY' : 'SELL',
    avgTradeSize: Math.round(totalVolume / 1_200),
    cvdDelta: isPump ? 10_000_000 : -10_000_000,
    spotTotalVolume: 12_000_000,
    spotTradeCount: 800,
    spotTakerBuyVol: isPump ? 7_200_000 : 4_800_000,
    spotTakerSellVol: isPump ? 4_800_000 : 7_200_000,
    spotTakerBuyRatio: isPump ? 60 : 40,
    spotCvdDelta: isPump ? 2_400_000 : -2_400_000,
    flowContext: 'SPOT_CONFIRMED',
    spotConfirms: true,
    recoveryPct: 18,
    finalPriceAfter60s: isPump ? endPrice - moveUsd * 0.18 : endPrice + moveUsd * 0.18,
  };
  const verdict = classifyMoveVerdict(simulated);
  Object.assign(simulated, {
    verdict: verdict.verdict,
    verdictLabel: verdict.label,
    verdictIcon: verdict.icon,
    verdictColor: verdict.color,
    verdictReason: verdict.reason,
    confidenceScore: verdict.confidenceScore,
    evidence: verdict.evidence,
  });
  moveHistory = [simulated, ...moveHistory].filter(isRecentMove).slice(0, 50);
  saveMoveHistoryLS();
  notifyListeners();
  await addSignal({
    type: SIGNAL_TYPE.MOVE_REPORT,
    severity: getMoveSeverity(simulated),
    timestamp: now,
    title: `${isPump ? '▲' : '▼'} ${direction} BTC ${simulated.pctChange}% trong 60s`,
    description: `${verdict.label} ${verdict.confidenceScore}% | Futures CVD ${(simulated.cvdDelta / 1e6).toFixed(1)}M | Spot CVD ${(simulated.spotCvdDelta / 1e6).toFixed(1)}M`,
    moveReport: simulated,
    snapshot: { btcPrice: endPrice, cvd: simulated.cvdDelta, spotCvd: simulated.spotCvdDelta },
  });
}
