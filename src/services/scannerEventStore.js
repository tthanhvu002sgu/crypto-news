/**
 * Scanner v8: Event Store & Forward Outcome Evaluation
 * Persists immutable snapshots and state transitions into IndexedDB.
 * Deduplicates by: symbol + direction + setupType + formedAt timestamp.
 * Evaluates forward performance (4H/24H return vs BTC, MFE, MAE, R-multiple).
 */

import axios from 'axios';
import { CONFIG_VERSION, SETUP_STATES } from './scannerConfig.js';

const DB_NAME = 'CryptoScannerResearch';
const DB_VERSION = 1;
const STORE_NAME = 'scanner_events';

let databasePromise = null;

function cloneForStorage(val) {
  return JSON.parse(JSON.stringify(val));
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

      ['symbol', 'direction', 'setupType', 'status', 'timestamp', 'configVersion'].forEach((idx) => {
        if (!store.indexNames.contains(idx)) store.createIndex(idx, idx, { unique: false });
      });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });

  return databasePromise;
}

function transactionRequest(mode, operation) {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = operation(store, transaction, resolve, reject);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  });
}

/**
 * Builds deterministic ID for deduplication:
 * coin + direction + setupType + formedAt
 */
export function buildEventId(event) {
  const symbol = event.symbol || 'UNKNOWN';
  const direction = event.direction || 'LONG';
  const setupType = event.setupType || 'NONE';
  const formedAt = event.formedAt || event.timestamp || 0;
  return `${symbol}_${direction}_${setupType}_${formedAt}`;
}

export function normalizeEvent(event) {
  const formedAt = event.formedAt || event.timestamp || Date.now();
  const id = event.id || buildEventId({ ...event, formedAt });

  return {
    id,
    symbol: event.symbol,
    direction: event.direction,
    setupType: event.setupType || 'NONE',
    status: event.status || 'WATCH',
    isInvalidated: event.isInvalidated === true || event.status === SETUP_STATES.INVALIDATED,
    market: event.market || 'SPOT',
    configVersion: event.configVersion || CONFIG_VERSION,
    formedAt,
    confirmedAt: event.confirmedAt || null,
    confirmationPrice: event.confirmationPrice ?? null,
    discoveredAt: event.discoveredAt || event.timestamp || Date.now(),
    timestamp: event.timestamp || Date.now(),
    currentPrice: event.currentPrice ?? null,
    triggerPrice: event.triggerPrice ?? null,
    invalidationLevel: event.invalidationLevel ?? null,
    targetLevel: event.targetLevel ?? null,
    distanceAtr: event.distanceAtr ?? null,
    rewardRiskRatio: event.rewardRiskRatio ?? null,
    rewardRiskNet: event.rewardRiskNet ?? null,
    strengthPercentile: event.strengthPercentile ?? null,
    relativeStrength4h: event.relativeStrength4h ?? null,
    relativeStrength24h: event.relativeStrength24h ?? null,
    reason: event.reason || '',
    outcomes: event.outcomes || null,
    scanCount: event.scanCount || 1,
    lastSeenAt: event.lastSeenAt || event.updatedAt || event.timestamp || Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Merges a newly scanned event with an existing database record.
 * Preserves the initial discovery snapshot (status, currentPrice, timestamp) and any evaluated outcomes.
 * Separates latest status, price, and distance in separate fields.
 */
export function mergeEventWithExisting(newItem, existing) {
  if (!existing) {
    return {
      ...newItem,
      initialStatus: newItem.status,
      initialPrice: newItem.confirmationPrice ?? newItem.currentPrice,
      initialTimestamp: newItem.timestamp,
      confirmationPrice: newItem.confirmationPrice ?? null,
      latestStatus: newItem.status,
      latestPrice: newItem.currentPrice,
      latestDistanceAtr: newItem.distanceAtr,
      latestReason: newItem.reason,
      latestTriggerPrice: newItem.triggerPrice,
      latestInvalidationLevel: newItem.invalidationLevel,
      latestTargetLevel: newItem.targetLevel,
      scanCount: newItem.scanCount || 1,
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const wasReady = existing.status === SETUP_STATES.READY || existing.initialStatus === SETUP_STATES.READY;
  const isNowReady = newItem.status === SETUP_STATES.READY;

  let initialStatus;
  let initialPrice;
  let initialTimestamp;
  let confirmationPrice;
  let confirmedAt;
  let status;
  let currentPrice;
  let timestamp;
  
  let triggerPrice;
  let invalidationLevel;
  let targetLevel;
  let rewardRiskRatio;
  let rewardRiskNet;

  if (wasReady) {
    // Was already discovered as READY: preserve original immutable READY snapshot
    initialStatus = existing.initialStatus || SETUP_STATES.READY;
    initialPrice = existing.initialPrice ?? existing.confirmationPrice ?? existing.currentPrice;
    initialTimestamp = existing.initialTimestamp || existing.timestamp;
    confirmationPrice = existing.confirmationPrice ?? null;
    confirmedAt = existing.confirmedAt || newItem.confirmedAt;
    status = SETUP_STATES.READY;
    currentPrice = initialPrice;
    timestamp = existing.timestamp || initialTimestamp;
    
    triggerPrice = existing.triggerPrice;
    invalidationLevel = existing.invalidationLevel;
    targetLevel = existing.targetLevel;
    rewardRiskRatio = existing.rewardRiskRatio;
    rewardRiskNet = existing.rewardRiskNet;
  } else if (isNowReady) {
    // First transition to READY: anchor immutable snapshot to this confirmation
    initialStatus = SETUP_STATES.READY;
    initialPrice = newItem.confirmationPrice ?? newItem.currentPrice;
    initialTimestamp = newItem.timestamp;
    confirmationPrice = newItem.confirmationPrice ?? null;
    confirmedAt = newItem.confirmedAt || existing.confirmedAt || Date.now();
    status = SETUP_STATES.READY;
    currentPrice = initialPrice;
    timestamp = newItem.timestamp;

    triggerPrice = newItem.triggerPrice ?? existing.triggerPrice;
    invalidationLevel = newItem.invalidationLevel ?? existing.invalidationLevel;
    targetLevel = newItem.targetLevel ?? existing.targetLevel;
    rewardRiskRatio = newItem.rewardRiskRatio ?? existing.rewardRiskRatio;
    rewardRiskNet = newItem.rewardRiskNet ?? existing.rewardRiskNet;
  } else {
    // Neither was READY (e.g. FORMING, WATCH)
    initialStatus = existing.initialStatus || newItem.status;
    initialPrice = existing.initialPrice ?? newItem.currentPrice;
    initialTimestamp = existing.initialTimestamp || existing.timestamp || newItem.timestamp;
    confirmationPrice = newItem.confirmationPrice || existing.confirmationPrice || null;
    confirmedAt = newItem.confirmedAt || existing.confirmedAt || null;
    status = newItem.status;
    currentPrice = newItem.currentPrice ?? existing.currentPrice;
    timestamp = existing.timestamp || newItem.timestamp;

    triggerPrice = newItem.triggerPrice ?? existing.triggerPrice;
    invalidationLevel = newItem.invalidationLevel ?? existing.invalidationLevel;
    targetLevel = newItem.targetLevel ?? existing.targetLevel;
    rewardRiskRatio = newItem.rewardRiskRatio ?? existing.rewardRiskRatio;
    rewardRiskNet = newItem.rewardRiskNet ?? existing.rewardRiskNet;
  }

  // Preserve existing outcomes if already evaluated unless newItem has valid updated outcomes
  const outcomes = (newItem.outcomes !== null && newItem.outcomes !== undefined)
    ? newItem.outcomes
    : (existing.outcomes || null);

  return {
    ...existing,
    ...newItem,
    id: existing.id,
    symbol: existing.symbol,
    direction: existing.direction,
    setupType: existing.setupType,
    formedAt: existing.formedAt,
    confirmedAt,
    timestamp,
    initialStatus,
    initialPrice,
    initialTimestamp,
    confirmationPrice,
    status,
    currentPrice,
    triggerPrice,
    invalidationLevel,
    targetLevel,
    rewardRiskRatio,
    rewardRiskNet,
    outcomes,
    discoveredAt: wasReady ? (existing.discoveredAt || existing.timestamp)
      : isNowReady ? newItem.discoveredAt : (existing.discoveredAt || newItem.discoveredAt),
    isInvalidated: existing.isInvalidated === true || existing.latestStatus === SETUP_STATES.INVALIDATED
      || existing.status === SETUP_STATES.INVALIDATED || newItem.isInvalidated === true,
    latestStatus: newItem.status,
    latestPrice: newItem.currentPrice ?? existing.latestPrice ?? existing.currentPrice,
    latestDistanceAtr: newItem.distanceAtr ?? existing.latestDistanceAtr,
    latestReason: newItem.reason || existing.latestReason,
    latestTriggerPrice: newItem.triggerPrice ?? existing.latestTriggerPrice,
    latestInvalidationLevel: newItem.invalidationLevel ?? existing.latestInvalidationLevel,
    latestTargetLevel: newItem.targetLevel ?? existing.latestTargetLevel,
    scanCount: (existing?.scanCount || 1) + 1,
    lastSeenAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Upsert a single scanner event into IndexedDB, preserving initial snapshot.
 */
export async function saveScannerEvent(event) {
  const [saved] = await saveScannerEvents([event]);
  return saved || normalizeEvent(event);
}

/**
 * Batch upsert scanner events with snapshot preservation.
 */
export async function saveScannerEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const normalizedList = events.map(normalizeEvent);
  const uniqueMap = new Map();
  normalizedList.forEach(item => uniqueMap.set(item.id, item));
  const uniqueList = Array.from(uniqueMap.values());
  const results = [];
  await transactionRequest('readwrite', (store, tx, resolve, reject) => {
    uniqueList.forEach((item) => {
      const getReq = store.get(item.id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const merged = mergeEventWithExisting(item, existing);
        store.put(cloneForStorage(merged));
        results.push(merged);
      };
      getReq.onerror = () => {
        reject(getReq.error);
      };
    });
  });
  return results;
}

/** Rebuild durable invalidation locks, including records written by earlier v8 builds. */
export function buildHydratedSetupRegistry(events = []) {
  const registry = new Map();
  for (const event of events) {
    if (!event.isInvalidated && event.latestStatus !== SETUP_STATES.INVALIDATED
      && event.status !== SETUP_STATES.INVALIDATED) continue;
    const key = `${event.symbol}_${event.direction}_${event.setupType}_${event.formedAt}_${event.triggerPrice}`;
    registry.set(key, { invalidationLevel: event.invalidationLevel, isInvalidated: true });
  }
  return registry;
}

/** Patch only outcomes against the latest stored row; a network fetch may overlap a scan. */
export async function saveScannerEventOutcome(id, outcomes) {
  let saved = null;
  await transactionRequest('readwrite', (store) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) return;
      saved = { ...request.result, outcomes: cloneForStorage(outcomes), outcomesUpdatedAt: Date.now() };
      store.put(saved);
    };
  });
  return saved;
}

/**
 * Query scanner events with filtering.
 */
export async function queryScannerEvents(filter = {}) {
  const result = await transactionRequest('readonly', (store, tx, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      let items = request.result || [];
      if (filter.direction) {
        items = items.filter(i => i.direction === filter.direction);
      }
      if (filter.setupType) {
        items = items.filter(i => i.setupType === filter.setupType);
      }
      if (filter.status) {
        items = items.filter(i => i.status === filter.status);
      }
      if (filter.fromTime) {
        items = items.filter(i => Math.max(i.lastSeenAt || 0, i.updatedAt || 0, i.timestamp || 0) >= filter.fromTime);
      }
      if (filter.toTime) {
        items = items.filter(i => i.timestamp <= filter.toTime);
      }
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
  return result || [];
}

/**
 * Evaluates forward performance outcomes of a recorded event using subsequent 1H candles.
 * Tracks 4H/24H return vs BTC, MFE, MAE, and resolution (WIN, LOSS, AMBIGUOUS, UNRESOLVED).
 * Strictly requires at least 4 future candles for 4H return and 24 future candles for 24H return.
 */
export function evaluateForwardOutcome(event, subsequentCandles = [], btcSubsequentCandles = []) {
  if (!event || !Array.isArray(subsequentCandles) || subsequentCandles.length === 0) {
    return null;
  }

  const isLong = event.direction === 'LONG' || event.direction === 'BUY';
  const entryPrice = event.confirmationPrice || event.initialPrice || event.currentPrice || event.triggerPrice;
  const target = event.targetLevel;
  const stop = event.invalidationLevel;

  if (!entryPrice || entryPrice <= 0) return null;

  // 4H return requires >= 4 candles; 24H return requires >= 24 candles
  const c4 = subsequentCandles.length >= 4 ? subsequentCandles[3]?.close : null;
  const c24 = subsequentCandles.length >= 24 ? subsequentCandles[23]?.close : null;
  const rawReturn4h = (subsequentCandles.length >= 4 && c4 !== null && c4 !== undefined) ? ((c4 / entryPrice) - 1) * 100 : null;
  const rawReturn24h = (subsequentCandles.length >= 24 && c24 !== null && c24 !== undefined) ? ((c24 / entryPrice) - 1) * 100 : null;
  const return4h = rawReturn4h !== null ? (isLong ? rawReturn4h : -rawReturn4h) : null;
  const return24h = rawReturn24h !== null ? (isLong ? rawReturn24h : -rawReturn24h) : null;

  const btcEntry = btcSubsequentCandles[0]?.open || btcSubsequentCandles[0]?.close;
  const btc4 = btcSubsequentCandles.length >= 4 ? btcSubsequentCandles[3]?.close : null;
  const btc24 = btcSubsequentCandles.length >= 24 ? btcSubsequentCandles[23]?.close : null;

  const btcReturn4h = (btcSubsequentCandles.length >= 4 && btcEntry && btc4 !== null && btc4 !== undefined) ? ((btc4 / btcEntry) - 1) * 100 : null;
  const btcReturn24h = (btcSubsequentCandles.length >= 24 && btcEntry && btc24 !== null && btc24 !== undefined) ? ((btc24 / btcEntry) - 1) * 100 : null;

  // For LONG: outperformance = coinReturn - btcReturn
  // For SHORT: outperformance = shortCoinReturn - shortBtcReturn = (-rawReturn) - (-btcReturn) = btcReturn - rawReturn
  const relReturn4h = return4h !== null && btcReturn4h !== null
    ? (isLong ? return4h - btcReturn4h : btcReturn4h - rawReturn4h)
    : null;
  const relReturn24h = return24h !== null && btcReturn24h !== null
    ? (isLong ? return24h - btcReturn24h : btcReturn24h - rawReturn24h)
    : null;

  // Track MFE & MAE
  let maxFavorable = 0;
  let maxAdverse = 0;
  let resolution = 'UNRESOLVED';
  let resolvedAt = null;

  for (let i = 0; i < subsequentCandles.length; i += 1) {
    const candle = subsequentCandles[i];
    const high = candle.high;
    const low = candle.low;

    const favorable = isLong ? ((high / entryPrice) - 1) * 100 : ((entryPrice - low) / entryPrice) * 100;
    const adverse = isLong ? ((entryPrice - low) / entryPrice) * 100 : ((high - entryPrice) / entryPrice) * 100;

    if (favorable > maxFavorable) maxFavorable = favorable;
    if (adverse > maxAdverse) maxAdverse = adverse;

    // Check hit conditions if target and stop exist
    if (target && stop && resolution === 'UNRESOLVED') {
      const hitTarget = isLong ? high >= target : low <= target;
      const hitStop = isLong ? low <= stop : high >= stop;

      if (hitTarget && hitStop) {
        // Both touched within the same candle -> AMBIGUOUS
        resolution = 'AMBIGUOUS';
        resolvedAt = candle.closeTime;
        break;
      } else if (hitTarget) {
        resolution = 'TRIGGERED_WIN';
        resolvedAt = candle.closeTime;
        break;
      } else if (hitStop) {
        resolution = 'TRIGGERED_LOSS';
        resolvedAt = candle.closeTime;
        break;
      }
    }
  }

  return {
    return4h: return4h !== null ? Math.round(return4h * 100) / 100 : null,
    return24h: return24h !== null ? Math.round(return24h * 100) / 100 : null,
    relReturn4hVsBtc: relReturn4h !== null ? Math.round(relReturn4h * 100) / 100 : null,
    relReturn24hVsBtc: relReturn24h !== null ? Math.round(relReturn24h * 100) / 100 : null,
    maxFavorableExcursionPct: Math.round(maxFavorable * 100) / 100,
    maxAdverseExcursionPct: Math.round(maxAdverse * 100) / 100,
    resolution,
    resolvedAt,
  };
}

/**
 * Automated outcome evaluation loop:
 * Queries pending READY events with unresolved outcomes, fetches subsequent klines,
 * evaluates forward performance, and updates the store while keeping the initial discovery snapshot immutable.
 */
export async function updatePendingEventOutcomes(options = {}) {
  const pending = await queryScannerEvents();
  const now = options.now || Date.now();
  const candidates = pending.filter(e => {
    const isReady = e.status === SETUP_STATES.READY || e.initialStatus === SETUP_STATES.READY;
    if (!isReady) return false;
    const eventTime = e.confirmedAt || e.formedAt || e.timestamp;
    if (!eventTime) return false;

    if (!e.outcomes || e.outcomes.resolution === 'UNRESOLVED') {
      return true;
    }

    if ((e.outcomes.resolution === 'TRIGGERED_WIN' || e.outcomes.resolution === 'TRIGGERED_LOSS') && e.outcomes.return24h === null) {
      return (now - eventTime) >= 24 * 3600 * 1000;
    }

    return false;
  }).slice(0, 10);

  if (candidates.length === 0) return [];

  const fetcher = options.fetchCandles || (async (symbol, startTime, market = 'SPOT') => {
    try {
      const url = market === 'FUTURES' ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
      const resp = await axios.get(url, {
        params: { symbol, interval: '1h', startTime: startTime + 1, limit: 30 },
        timeout: 5000,
      });
      return (resp.data || []).filter(k => Number(k[6]) <= Date.now()).map(k => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        closeTime: Number(k[6]),
      }));
    } catch {
      return [];
    }
  });

  const btcCache = new Map();
  const getBtc = async (start, market = 'SPOT') => {
    const key = `${start}_${market}`;
    if (!btcCache.has(key)) {
      btcCache.set(key, fetcher('BTCUSDT', start, market));
    }
    return btcCache.get(key);
  };

  const updated = [];
  for (const event of candidates) {
    // If confirmationPrice exists, outcome starts consistently from confirmedAt.
    // Otherwise, outcome starts from the discovery timestamp.
    const start = event.confirmationPrice && event.confirmedAt
      ? event.confirmedAt : (event.discoveredAt || event.timestamp);
    try {
      const [subsequentCandles, btcSubsequentCandles] = await Promise.all([
        fetcher(event.symbol, start, event.market),
        getBtc(start, event.market),
      ]);
      if (Array.isArray(subsequentCandles) && subsequentCandles.length > 0) {
        const outcome = evaluateForwardOutcome(event, subsequentCandles, btcSubsequentCandles);
        if (outcome) {
          const saved = await saveScannerEventOutcome(event.id, outcome);
          updated.push(saved);
        }
      }
    } catch {
      // Background research evaluation failures should never interrupt application flow
    }
  }
  return updated;
}

/**
 * Computes performance summary stats from a collection of evaluated events.
 */
export function summarizePerformance(events = []) {
  const total = events.length;
  if (total === 0) {
    return {
      totalEvents: 0,
      longCount: 0,
      shortCount: 0,
      readyCount: 0,
      winRate: null,
      avgRelReturn24h: null,
    };
  }

  const longEvents = events.filter(e => e.direction === 'LONG');
  const shortEvents = events.filter(e => e.direction === 'SHORT');
  const readyEvents = events.filter(e => e.status === 'READY');

  const resolved = events.filter(e => e.outcomes?.resolution === 'TRIGGERED_WIN' || e.outcomes?.resolution === 'TRIGGERED_LOSS');
  const wins = resolved.filter(e => e.outcomes?.resolution === 'TRIGGERED_WIN');
  const winRate = resolved.length > 0 ? (wins.length / resolved.length) * 100 : null;

  const validRelReturns = events.map(e => e.outcomes?.relReturn24hVsBtc).filter(v => v !== null && v !== undefined);
  const avgRelReturn24h = validRelReturns.length > 0
    ? validRelReturns.reduce((acc, v) => acc + v, 0) / validRelReturns.length
    : null;

  return {
    totalEvents: total,
    longCount: longEvents.length,
    shortCount: shortEvents.length,
    readyCount: readyEvents.length,
    resolvedCount: resolved.length,
    winRate: winRate !== null ? Math.round(winRate * 10) / 10 : null,
    avgRelReturn24h: avgRelReturn24h !== null ? Math.round(avgRelReturn24h * 100) / 100 : null,
  };
}

/**
 * Aggregates historical scanner events over 24H or 7D to identify persistent leaders,
 * triggered setups, and aggregate performance.
 *
 * @param {'24h'|'7d'} timeframe
 */
export async function getTrackingSummary(timeframe = '24h') {
  const now = Date.now();
  const durationMs = timeframe === '7d' ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
  const fromTime = now - durationMs;

  const allEvents = await queryScannerEvents({ fromTime });

  const coinMap = new Map();
  const readyEvents = [];

  for (const event of allEvents) {
    const symbol = event.symbol;
    if (!symbol) continue;

    const isReady = event.status === SETUP_STATES.READY
      || event.initialStatus === SETUP_STATES.READY
      || event.outcomes?.resolution === 'TRIGGERED_WIN'
      || event.outcomes?.resolution === 'TRIGGERED_LOSS';

    if (isReady) {
      readyEvents.push(event);
    }

    if (!coinMap.has(symbol)) {
      coinMap.set(symbol, {
        symbol,
        baseAsset: symbol.replace(/USDT$/, ''),
        direction: event.direction || 'LONG',
        setupType: event.setupType,
        firstSeen: event.formedAt || event.timestamp,
        lastSeen: event.lastSeenAt || event.updatedAt || event.timestamp || now,
        appearanceCount: event.scanCount || 1,
        latestStatus: event.latestStatus ?? event.status ?? 'WATCH',
        initialPrice: event.confirmationPrice || event.initialPrice || event.currentPrice || 0,
        latestPrice: event.latestPrice ?? event.currentPrice ?? event.initialPrice ?? 0,
        triggerPrice: event.triggerPrice,
        invalidationLevel: event.invalidationLevel,
        targetLevel: event.targetLevel,
        rewardRiskRatio: event.rewardRiskRatio,
        peakGainPct: event.outcomes?.maxFavorableExcursionPct ?? null,
        maxDrawdownPct: event.outcomes?.maxAdverseExcursionPct ?? null,
        relReturnVsBtc: event.outcomes?.relReturn24hVsBtc ?? null,
        return24h: event.outcomes?.return24h ?? null,
        resolution: event.outcomes?.resolution ?? (isReady ? 'RUNNING' : 'OBSERVING'),
      });
    } else {
      const existing = coinMap.get(symbol);
      existing.appearanceCount += (event.scanCount || 1);
      existing.firstSeen = Math.min(existing.firstSeen, event.formedAt || event.timestamp);
      const eventLastSeen = event.lastSeenAt || event.updatedAt || event.timestamp || now;
      existing.lastSeen = Math.max(existing.lastSeen, eventLastSeen);

      if (isReady) {
        if (existing.latestStatus !== SETUP_STATES.READY) {
          existing.latestStatus = event.latestStatus ?? event.status ?? SETUP_STATES.READY;
          existing.setupType = event.setupType;
        }
        existing.triggerPrice = event.triggerPrice ?? existing.triggerPrice;
        existing.invalidationLevel = event.invalidationLevel ?? existing.invalidationLevel;
        existing.targetLevel = event.targetLevel ?? existing.targetLevel;
        existing.initialPrice = event.confirmationPrice || event.initialPrice || event.currentPrice || existing.initialPrice;
      }

      if (event.outcomes?.maxFavorableExcursionPct != null) {
        existing.peakGainPct = Math.max(existing.peakGainPct || 0, event.outcomes.maxFavorableExcursionPct);
      }
      if (event.outcomes?.relReturn24hVsBtc != null) {
        existing.relReturnVsBtc = event.outcomes.relReturn24hVsBtc;
      }
      if (event.outcomes?.resolution && event.outcomes.resolution !== 'UNRESOLVED') {
        existing.resolution = event.outcomes.resolution;
      }
    }
  }

  const leaders = Array.from(coinMap.values()).map(coin => {
    const hoursSpan = Math.max(1, Math.round((coin.lastSeen - coin.firstSeen) / 3600000));
    const persistenceScore = (coin.appearanceCount * 1.5)
      + (hoursSpan * 3)
      + (coin.peakGainPct > 0 ? Math.min(20, coin.peakGainPct * 0.5) : 0)
      + (coin.latestStatus === SETUP_STATES.READY ? 5 : 0);

    return {
      ...coin,
      hoursSpan,
      persistenceScore: Math.round(persistenceScore * 10) / 10,
    };
  }).sort((a, b) => b.persistenceScore - a.persistenceScore);

  const resolved = readyEvents.filter(e => e.outcomes?.resolution === 'TRIGGERED_WIN' || e.outcomes?.resolution === 'TRIGGERED_LOSS');
  const wins = resolved.filter(e => e.outcomes?.resolution === 'TRIGGERED_WIN');
  const winRate = resolved.length > 0 ? Math.round((wins.length / resolved.length) * 1000) / 10 : null;

  const validRelReturns = readyEvents
    .map(e => e.outcomes?.relReturn24hVsBtc)
    .filter(v => v !== null && v !== undefined && Number.isFinite(v));
  const avgRelReturn = validRelReturns.length > 0
    ? Math.round((validRelReturns.reduce((acc, v) => acc + v, 0) / validRelReturns.length) * 100) / 100
    : null;

  const validGainers = leaders.filter(c => c.peakGainPct != null && c.peakGainPct > 0);
  const bestCoin = validGainers.length > 0
    ? validGainers.reduce((best, c) => (c.peakGainPct > (best?.peakGainPct ?? 0) ? c : best), null)
    : null;

  return {
    timeframe,
    fromTime,
    toTime: now,
    totalTrackedCoins: leaders.length,
    totalReadySetups: readyEvents.length,
    resolvedCount: resolved.length,
    winCount: wins.length,
    lossCount: resolved.length - wins.length,
    winRate,
    avgRelReturn24h: avgRelReturn,
    bestPerformer: bestCoin ? { symbol: bestCoin.symbol, peakGainPct: bestCoin.peakGainPct } : null,
    leaders: leaders.slice(0, 15),
    recentTriggered: readyEvents.slice(0, 10),
  };
}

/**
 * Test helper: resets the in-memory/indexedDB connection.
 */
export async function __resetScannerEventStoreForTests() {
  if (databasePromise) {
    const db = await databasePromise;
    db.close();
    databasePromise = null;
  }
  if (typeof indexedDB !== 'undefined') {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }
}
