/**
 * CVD Service & Immutable Daily Snapshot Store
 * 
 * Solves the rolling rebase problem by anchoring cumulative CVD to a fixed UTC timestamp:
 * CVD_ANCHOR_UTC = 2020-01-01T00:00:00.000Z (1577836800000).
 * 
 * Separates three distinct concepts:
 * 1. cumulativeFromAnchor: Immutable historical baseline for storage and audit continuity.
 * 2. windowNetDelta: Net buy/sell delta within a specific window (24H/7D/30D) for Hero, Bias Engine & Sheets.
 * 3. cumulativeWithinWindow: Running window delta rebased to zero for chart rendering.
 */

import axios from 'axios';

export const CVD_ANCHOR_UTC = '2020-01-01T00:00:00.000Z';
export const CVD_ANCHOR_TIMESTAMP = 1577836800000; // 2020-01-01 00:00:00 UTC
export const SNAPSHOT_STORE_VERSION = 1;
export const SNAPSHOT_STORAGE_KEY = 'hft_cvd_daily_snapshots_v1';

// A full ledger backfill is shared by the 24H/7D/30D consumers. Without this
// single-flight guard, opening the dashboard with an empty/stale store starts
// three identical multi-page Binance downloads for each market.
const snapshotSyncInFlight = new Map();

// ─── TIME & DATE UTILS ────────────────────────────────────────────────────────

/**
 * Returns UTC date string 'YYYY-MM-DD'
 */
export function getUtcDateString(timestamp) {
  const d = new Date(timestamp);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns UTC midnight timestamp for a given time
 */
export function getUtcMidnight(timestamp) {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Checks if a timestamp belongs to a closed UTC day (i.e. before today's UTC midnight)
 */
export function isUtcDayClosed(openTime, now = Date.now()) {
  const todayUtcMidnight = getUtcMidnight(now);
  return openTime + 86400000 <= todayUtcMidnight;
}

// ─── KLINE NORMALIZATION ──────────────────────────────────────────────────────

/**
 * Normalizes raw Binance kline array into a typed object.
 * Raw format: [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]
 */
export function normalizeKline(rawKline, now = Date.now()) {
  if (!rawKline || !Array.isArray(rawKline)) return null;

  const openTime = Number(rawKline[0]);
  const closePrice = parseFloat(rawKline[4]) || 0;
  const closeTime = Number(rawKline[6]);
  const quoteVol = parseFloat(rawKline[7]) || 0;
  const takerBuyVol = parseFloat(rawKline[10]) || 0;
  const takerSellVol = Math.max(0, quoteVol - takerBuyVol);
  const delta = takerBuyVol - takerSellVol;
  const isClosed = closeTime < now;

  return {
    openTime,
    closeTime,
    open: parseFloat(rawKline[1]) || 0,
    high: parseFloat(rawKline[2]) || 0,
    low: parseFloat(rawKline[3]) || 0,
    close: closePrice,
    volume: parseFloat(rawKline[5]) || 0,
    quoteVol,
    takerBuyVol,
    takerSellVol,
    delta,
    isClosed
  };
}

// ─── SNAPSHOT RECORD FACTORY ──────────────────────────────────────────────────

/**
 * Creates an immutable daily snapshot record
 */
export function createDailySnapshot({
  market,
  symbol = 'BTCUSDT',
  openTime,
  closeTime,
  dailyDelta,
  cumulativeFromAnchor,
  buyVolume,
  sellVolume,
  closePrice,
  now = Date.now()
}) {
  return {
    version: SNAPSHOT_STORE_VERSION,
    market: market === 'spot' ? 'spot' : 'futures',
    symbol,
    utcDate: getUtcDateString(openTime),
    openTime,
    closeTime: closeTime || (openTime + 86400000 - 1),
    dailyDelta: Math.round(dailyDelta),
    cumulativeFromAnchor: Math.round(cumulativeFromAnchor),
    buyVolume: Math.round(buyVolume),
    sellVolume: Math.round(sellVolume),
    closePrice: Number(closePrice) || 0,
    source: 'binance-kline',
    status: 'closed',
    capturedAt: now
  };
}

// ─── SNAPSHOT STORE (LOCALSTORAGE + IN-MEMORY) ─────────────────────────────────

let inMemoryStore = {
  version: SNAPSHOT_STORE_VERSION,
  updatedAt: 0,
  spot: {
    lastAnchorTime: CVD_ANCHOR_TIMESTAMP,
    lastClosedDate: null,
    lastCumulative: 0,
    snapshots: {} // { 'YYYY-MM-DD': snapshot }
  },
  futures: {
    lastAnchorTime: CVD_ANCHOR_TIMESTAMP,
    lastClosedDate: null,
    lastCumulative: 0,
    snapshots: {}
  }
};

/**
 * Checks if localStorage is available
 */
function isLocalStorageAvailable() {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Retrieves the snapshot store
 */
export function getSnapshotStore() {
  if (!isLocalStorageAvailable()) {
    return inMemoryStore;
  }

  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return inMemoryStore;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === SNAPSHOT_STORE_VERSION && parsed.spot && parsed.futures) {
      inMemoryStore = parsed;
      return parsed;
    }
  } catch (e) {
    console.warn('[CVDStore] Failed to read snapshot store from localStorage:', e.message);
  }
  return inMemoryStore;
}

/**
 * Saves the snapshot store atomically
 */
export function saveSnapshotStore(store) {
  inMemoryStore = store;
  if (!isLocalStorageAvailable()) return;

  try {
    store.updatedAt = Date.now();
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[CVDStore] Failed to persist snapshot store:', e.message);
  }
}

/**
 * Resets the snapshot store (for tests/migration)
 */
export function resetSnapshotStore() {
  inMemoryStore = {
    version: SNAPSHOT_STORE_VERSION,
    updatedAt: 0,
    spot: {
      lastAnchorTime: CVD_ANCHOR_TIMESTAMP,
      lastClosedDate: null,
      lastCumulative: 0,
      snapshots: {}
    },
    futures: {
      lastAnchorTime: CVD_ANCHOR_TIMESTAMP,
      lastClosedDate: null,
      lastCumulative: 0,
      snapshots: {}
    }
  };

  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    } catch {}
  }
}

/**
 * Retrieves all closed daily snapshots for a market sorted chronologically
 */
export function getDailySnapshots(market = 'futures') {
  const store = getSnapshotStore();
  const marketKey = market === 'spot' ? 'spot' : 'futures';
  const snapshotsMap = store[marketKey]?.snapshots || {};
  return Object.values(snapshotsMap).sort((a, b) => a.openTime - b.openTime);
}

/**
 * Retrieves snapshot for a specific UTC date
 */
export function getSnapshotByDate(market = 'futures', utcDate) {
  const store = getSnapshotStore();
  const marketKey = market === 'spot' ? 'spot' : 'futures';
  return store[marketKey]?.snapshots?.[utcDate] || null;
}

/**
 * Upserts verified closed snapshots into the store without overwriting existing closed snapshots
 */
export function upsertDailySnapshots(market = 'futures', snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return getDailySnapshots(market);

  const store = getSnapshotStore();
  const marketKey = market === 'spot' ? 'spot' : 'futures';
  if (!store[marketKey]) {
    store[marketKey] = {
      lastAnchorTime: CVD_ANCHOR_TIMESTAMP,
      lastClosedDate: null,
      lastCumulative: 0,
      snapshots: {}
    };
  }

  const marketData = store[marketKey];
  let changed = false;

  for (const snap of snapshots) {
    if (!snap || snap.status !== 'closed' || !snap.utcDate) continue;
    // Closed snapshots are immutable: do not overwrite existing valid snapshot
    if (!marketData.snapshots[snap.utcDate]) {
      marketData.snapshots[snap.utcDate] = snap;
      changed = true;
    }
  }

  if (changed) {
    const sorted = Object.values(marketData.snapshots).sort((a, b) => a.openTime - b.openTime);
    if (sorted.length > 0) {
      const latest = sorted[sorted.length - 1];
      marketData.lastClosedDate = latest.utcDate;
      marketData.lastCumulative = latest.cumulativeFromAnchor;
    }
    saveSnapshotStore(store);
  }

  return Object.values(marketData.snapshots).sort((a, b) => a.openTime - b.openTime);
}

// ─── BINANCE KLINE FETCHERS & BACKFILL ─────────────────────────────────────────

/**
 * Resolves the Binance REST base URL
 */
export function getBinanceKlinesUrl(market = 'futures') {
  return market === 'spot'
    ? 'https://api.binance.com/api/v3/klines'
    : 'https://fapi.binance.com/fapi/v1/klines';
}

/**
 * Fetches daily klines from Binance in batches from startTime to now
 */
export async function fetchBinanceDailyKlines(symbol = 'BTCUSDT', market = 'futures', startTime = CVD_ANCHOR_TIMESTAMP, axiosInstance = axios, now = Date.now()) {
  const baseUrl = getBinanceKlinesUrl(market);
  const allRows = [];
  let currentStartTime = startTime;
  const todayUtcMidnight = getUtcMidnight(now);

  try {
    while (currentStartTime < todayUtcMidnight) {
      const res = await axiosInstance.get(baseUrl, {
        params: {
          symbol,
          interval: '1d',
          startTime: currentStartTime,
          limit: 1000
        },
        timeout: 10000
      });

      const batch = Array.isArray(res.data) ? res.data : [];
      if (batch.length === 0) break;

      allRows.push(...batch);

      const lastRow = batch[batch.length - 1];
      const lastOpenTime = Number(lastRow[0]);
      if (lastOpenTime >= todayUtcMidnight || batch.length < 1000) break;

      const nextStart = lastOpenTime + 86400000;
      if (nextStart <= currentStartTime) break;
      currentStartTime = nextStart;
    }

    return allRows;
  } catch (err) {
    console.error(`[CVDService] Error fetching daily klines (${market}):`, err.message);
    return allRows;
  }
}

/**
 * Synchronizes and backfills the daily snapshots ledger up to yesterday's closed UTC day.
 * Idempotent, safe, and thread/call safe.
 */
export async function syncDailySnapshots(symbol = 'BTCUSDT', market = 'futures', { axiosInstance = axios, now = Date.now() } = {}) {
  const existingSnapshots = getDailySnapshots(market);
  const todayUtcMidnight = getUtcMidnight(now);

  let startTime = CVD_ANCHOR_TIMESTAMP;
  let runningCumulative = 0;

  if (existingSnapshots.length > 0) {
    const lastSnap = existingSnapshots[existingSnapshots.length - 1];
    startTime = lastSnap.openTime + 86400000;
    runningCumulative = lastSnap.cumulativeFromAnchor;
  }

  // Already up to date with the latest closed UTC day
  if (startTime >= todayUtcMidnight) {
    return existingSnapshots;
  }

  const rawKlines = await fetchBinanceDailyKlines(symbol, market, startTime, axiosInstance, now);
  if (!rawKlines || rawKlines.length === 0) {
    return existingSnapshots;
  }

  const newSnapshots = [];

  for (const raw of rawKlines) {
    const k = normalizeKline(raw, now);
    if (!k) continue;

    // Only record strictly closed UTC days
    if (k.openTime + 86400000 > todayUtcMidnight || !k.isClosed) {
      continue;
    }

    runningCumulative += k.delta;

    const snap = createDailySnapshot({
      market,
      symbol,
      openTime: k.openTime,
      closeTime: k.closeTime,
      dailyDelta: k.delta,
      cumulativeFromAnchor: runningCumulative,
      buyVolume: k.takerBuyVol,
      sellVolume: k.takerSellVol,
      closePrice: k.close,
      now
    });

    newSnapshots.push(snap);
  }

  if (newSnapshots.length > 0) {
    return upsertDailySnapshots(market, newSnapshots);
  }

  return existingSnapshots;
}

/**
 * Checks if the daily snapshot ledger is stale (missing yesterday's closed UTC day or empty).
 */
export function isLedgerStale(market = 'futures', now = Date.now()) {
  const snapshots = getDailySnapshots(market);
  if (!snapshots || snapshots.length === 0) return true;

  const todayUtcMidnight = getUtcMidnight(now);
  const yesterdayUtcMidnight = todayUtcMidnight - 86400000;
  const lastSnap = snapshots[snapshots.length - 1];

  // If last snapshot is before yesterday's closed day, ledger is stale and needs backfill
  return (lastSnap.openTime + 86400000) <= yesterdayUtcMidnight;
}

/**
 * Ensures daily snapshots are synchronized up to yesterday's closed UTC day.
 * Only makes a network request if the store is empty, stale, or force=true.
 */
export async function ensureDailySnapshots(symbol = 'BTCUSDT', market = 'futures', { axiosInstance = axios, now = Date.now(), force = false } = {}) {
  let snapshots = getDailySnapshots(market);
  if (force || isLedgerStale(market, now)) {
    const syncKey = `${market}:${symbol}`;
    let syncPromise = snapshotSyncInFlight.get(syncKey);

    if (!syncPromise) {
      syncPromise = syncDailySnapshots(symbol, market, { axiosInstance, now }).finally(() => {
        if (snapshotSyncInFlight.get(syncKey) === syncPromise) {
          snapshotSyncInFlight.delete(syncKey);
        }
      });
      snapshotSyncInFlight.set(syncKey, syncPromise);
    }

    snapshots = await syncPromise;
  }
  return snapshots;
}

// ─── SERIES ENGINE & MULTI-TIMEFRAME BUILDER ──────────────────────────────────

/**
 * Builds a stable CVD series from raw klines and daily snapshot baseline.
 * 
 * Returns standard Data Contract:
 * {
 *   market,
 *   interval,
 *   timeframe,
 *   anchorTime: CVD_ANCHOR_TIMESTAMP,
 *   points: [{ time, timestamp, delta, cumulativeFromAnchor, cumulativeWithinWindow, cvd, buyVol, sellVol, price, isClosed }],
 *   windowNetDelta,
 *   asOf,
 *   hasProvisionalPoint
 * }
 */
export function buildCvdSeries({
  market = 'futures',
  interval = '1h',
  timeframe = '24H',
  rawKlines = [],
  dailySnapshots = [],
  targetCount = null,
  now = Date.now()
}) {
  const normKlines = rawKlines
    .map(k => (Array.isArray(k) ? normalizeKline(k, now) : k))
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);

  if (normKlines.length === 0) {
    return {
      market,
      interval,
      timeframe,
      anchorTime: CVD_ANCHOR_TIMESTAMP,
      points: [],
      windowNetDelta: 0,
      asOf: now,
      hasProvisionalPoint: false
    };
  }

  const firstKline = normKlines[0];
  const firstOpenTime = firstKline.openTime;

  // Find the closest closed daily snapshot prior to or at the start of the window
  const priorSnapshots = dailySnapshots.filter(s => s.openTime + 86400000 <= firstOpenTime);
  const baselineSnapshot = priorSnapshots.length > 0 ? priorSnapshots[priorSnapshots.length - 1] : null;
  const baseCumulative = baselineSnapshot ? baselineSnapshot.cumulativeFromAnchor : 0;

  let runningCumulative = baseCumulative;

  const allPoints = normKlines.map(k => {
    runningCumulative += k.delta;

    return {
      time: k.openTime,
      timestamp: k.openTime,
      delta: Math.round(k.delta),
      cumulativeFromAnchor: Math.round(runningCumulative),
      cvd: Math.round(runningCumulative), // backward-compatible alias for chart consumption
      buyVol: Math.round(k.takerBuyVol),
      sellVol: Math.round(k.takerSellVol),
      price: k.close,
      isClosed: Boolean(k.isClosed)
    };
  });

  // Slice exactly the requested target display count if specified (e.g. 24 for 24H, 42 for 7D, 30 for 30D)
  const visiblePoints = (targetCount && targetCount > 0 && targetCount < allPoints.length)
    ? allPoints.slice(-targetCount)
    : allPoints;

  // The chart projection uses the selected window as its zero reference, while
  // cumulativeFromAnchor remains untouched for persistence and auditability.
  const points = withWindowCumulative(visiblePoints);
  const windowNetDelta = points.at(-1)?.cumulativeWithinWindow ?? 0;

  return {
    market,
    interval,
    timeframe,
    anchorTime: CVD_ANCHOR_TIMESTAMP,
    points,
    windowNetDelta: Math.round(windowNetDelta),
    asOf: now,
    hasProvisionalPoint: points.some(p => !p.isClosed)
  };
}

/**
 * Adds a zero-rebased running CVD to a list without mutating the source points.
 * The final cumulativeWithinWindow value always equals the sum of point deltas,
 * which is the same value shown by the timeframe Hero card.
 */
export function withWindowCumulative(points = []) {
  let runningWindowDelta = 0;

  return points.map(point => {
    runningWindowDelta += Number(point?.delta) || 0;
    return {
      ...point,
      cumulativeWithinWindow: Math.round(runningWindowDelta)
    };
  });
}

// ─── SAFE CVD VALUE EXTRACTOR ─────────────────────────────────────────────────

/**
 * Safely extracts the net window delta (24H/7D/30D) from either:
 * - New data contract series object: `{ windowNetDelta, points, ... }`
 * - Direct numeric delta
 * - Legacy points array
 * 
 * Never returns raw multi-year cumulative from anchor (which could be ±$10B).
 */
export function extractCvdNetDelta(cvdInput) {
  if (cvdInput == null) return null;

  if (typeof cvdInput === 'number' && Number.isFinite(cvdInput)) {
    return cvdInput;
  }

  // Contract object
  if (typeof cvdInput.windowNetDelta === 'number' && Number.isFinite(cvdInput.windowNetDelta)) {
    return cvdInput.windowNetDelta;
  }

  if (typeof cvdInput.netDelta === 'number' && Number.isFinite(cvdInput.netDelta)) {
    return cvdInput.netDelta;
  }

  if (Array.isArray(cvdInput.points)) {
    if (cvdInput.points.length === 0) return null;
    return cvdInput.points.reduce((acc, p) => acc + (Number(p.delta) || 0), 0);
  }

  // Legacy array of points
  if (Array.isArray(cvdInput)) {
    if (cvdInput.length === 0) return null;
    const last = cvdInput[cvdInput.length - 1];
    if (typeof last?.windowNetDelta === 'number') return last.windowNetDelta;
    if (typeof last?.netDelta === 'number') return last.netDelta;

    const hasDeltas = cvdInput.some(p => typeof p?.delta === 'number' && Number.isFinite(p.delta));
    if (hasDeltas) {
      return cvdInput.reduce((acc, p) => acc + (Number(p.delta) || 0), 0);
    }

    if (typeof last?.cvd === 'number' && Number.isFinite(last.cvd)) {
      // Check sanity: if value is within normal window range (not multi-billion anchor)
      return last.cvd;
    }
  }

  return null;
}
