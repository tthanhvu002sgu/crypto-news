import { computeMoveStats } from './moveTrackerCore.js';

const DB_NAME = 'MoveTrackerResearch';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const LEGACY_DB_NAME = 'CryptoSignalLog';
const LEGACY_STORE_NAME = 'signals';
const LEGACY_LS_KEY = 'hft_move_history_v1';
const PREVIEW_LS_KEY = 'hft_move_preview_v2';
const MIGRATION_LS_KEY = 'hft_move_research_migration_v1';
const CLEANUP_LS_KEY = 'hft_move_research_cleanup_v1';
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

let databasePromise = null;

function cloneForStorage(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeForIndex(event) {
  return {
    ...event,
    schemaVersion: event.schemaVersion ?? 2,
    triggerTime: event.triggerTime ?? event.startTime ?? event.endTime ?? Date.now(),
    detectionWindowSec: event.detectionWindowSec ?? event.detection?.windowSec ?? null,
    qualityTier: event.qualityTier ?? event.triggerSnapshot?.qualityTier ?? 'DATA_INCOMPLETE',
    flowLabel: event.flowLabel ?? event.triggerSnapshot?.flowLabel ?? 'DATA_INCOMPLETE',
    outcomeLabel: event.outcomeLabel ?? 'UNRESOLVED',
  };
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      ['triggerTime', 'direction', 'detectionWindowSec', 'qualityTier', 'flowLabel', 'outcomeLabel'].forEach((indexName) => {
        if (!store.indexNames.contains(indexName)) store.createIndex(indexName, indexName, { unique: false });
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
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store, transaction, resolve, reject);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

function writePreview(events) {
  try {
    localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify(events.slice(0, 20)));
  } catch {
    // IndexedDB remains authoritative when localStorage is unavailable.
  }
}

export function loadMovePreview() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREVIEW_LS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function upsertMoveEvent(event) {
  if (!event?.id) throw new Error('Move event requires a stable id');
  const normalized = cloneForStorage(normalizeForIndex(event));
  await transactionRequest('readwrite', (store) => {
    store.put(normalized);
  });
  const preview = [normalized, ...loadMovePreview().filter((item) => item.id !== normalized.id)]
    .sort((a, b) => b.triggerTime - a.triggerTime)
    .slice(0, 20);
  writePreview(preview);
  return normalized;
}

function matchesFilters(event, filters) {
  if (filters.direction && filters.direction !== 'ALL' && event.direction !== filters.direction) return false;
  if (filters.qualityTier && filters.qualityTier !== 'ALL' && event.qualityTier !== filters.qualityTier) return false;
  if (filters.flowLabel && filters.flowLabel !== 'ALL' && event.flowLabel !== filters.flowLabel) return false;
  if (filters.outcomeLabel && filters.outcomeLabel !== 'ALL' && event.outcomeLabel !== filters.outcomeLabel) return false;
  if (filters.detectionWindowSec && Number(event.detectionWindowSec) !== Number(filters.detectionWindowSec)) return false;
  return true;
}

export async function queryMoveEvents(filters = {}) {
  const limit = Number.isFinite(filters.limit) ? filters.limit : 500;
  const fromTime = filters.fromTime ?? 0;
  const toTime = filters.toTime ?? Date.now();
  return transactionRequest('readonly', (store, transaction, resolve, reject) => {
    const range = IDBKeyRange.bound(fromTime, toTime);
    const request = store.index('triggerTime').openCursor(range, 'prev');
    const results = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && results.length < limit) {
        if (matchesFilters(cursor.value, filters)) results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = null;
  });
}

export async function getMoveStats(filters = {}) {
  const events = await queryMoveEvents({ ...filters, limit: filters.limit ?? 10_000 });
  return computeMoveStats(events);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportMoveEvents(format = 'json', filters = {}) {
  const events = await queryMoveEvents({ ...filters, limit: filters.limit ?? 10_000 });
  if (format.toLowerCase() === 'json') return JSON.stringify(events, null, 2);
  if (format.toLowerCase() !== 'csv') throw new Error(`Unsupported move export format: ${format}`);
  const headers = [
    'id', 'triggerTime', 'direction', 'detectionWindowSec', 'qualityTier', 'flowLabel', 'outcomeLabel',
    'triggerPrice', 'thresholdUsd', 'participationPercentile', 'context5m', 'context15m', 'context1h',
    'return15sBps', 'return30sBps', 'return60sBps', 'return5mBps', 'return15mBps', 'dataComplete5m',
  ];
  const rows = events.map((event) => [
    event.id,
    event.triggerTime,
    event.direction,
    event.detectionWindowSec,
    event.qualityTier,
    event.flowLabel,
    event.outcomeLabel,
    event.triggerPrice ?? event.triggerSnapshot?.price,
    event.thresholdUsd,
    event.triggerSnapshot?.participationPercentile,
    event.timeframeContext?.['5m']?.structure,
    event.timeframeContext?.['15m']?.structure,
    event.timeframeContext?.['1h']?.structure,
    event.forwardOutcomes?.['15']?.continuationBps,
    event.forwardOutcomes?.['30']?.continuationBps,
    event.forwardOutcomes?.['60']?.continuationBps,
    event.forwardOutcomes?.['300']?.continuationBps,
    event.forwardOutcomes?.['900']?.continuationBps,
    event.forwardOutcomes?.['300']?.dataStatus,
  ].map(csvCell).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export async function pruneMoveEvents(now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  let deleted = 0;
  await transactionRequest('readwrite', (store, transaction, resolve, reject) => {
    const request = store.index('triggerTime').openCursor(IDBKeyRange.upperBound(cutoff, true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        deleted += 1;
        cursor.continue();
      } else {
        resolve(deleted);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = null;
  });
  return deleted;
}

function legacyToEvent(move) {
  const triggerTime = move.triggerTime ?? move.startTime ?? move.endTime ?? Date.now();
  return normalizeForIndex({
    ...move,
    id: String(move.id ?? `legacy_${triggerTime}`),
    schemaVersion: 2,
    legacy: true,
    symbol: 'BTCUSDT',
    market: 'BINANCE_FUTURES',
    triggerTime,
    triggerPrice: move.triggerPrice ?? move.endPrice ?? move.startPrice,
    detectionWindowSec: move.detectionWindowSec ?? null,
    qualityTier: 'DATA_INCOMPLETE',
    flowLabel: move.flowContext ?? 'DATA_INCOMPLETE',
    outcomeLabel: move.recoveryPct == null
      ? 'DATA_INCOMPLETE'
      : move.recoveryPct < 25
        ? 'CONTINUATION'
        : move.recoveryPct < 50
          ? 'PARTIAL_RETRACE'
          : 'MEAN_REVERSION',
    status: 'LEGACY_COMPLETE',
    triggerSnapshot: move.triggerSnapshot ?? null,
    endSnapshot: move.endSnapshot ?? {
      endTime: move.endTime,
      price: move.endPrice,
      totalVolume: move.totalVolume,
      tradeCount: move.tradeCount,
      futuresCvd: move.cvdDelta,
      spotCvd: move.spotCvdDelta,
    },
    forwardOutcomes: move.forwardOutcomes ?? {},
    timeframeContext: move.timeframeContext ?? {},
  });
}

async function readLegacyIndexedDb() {
  if (typeof indexedDB.databases !== 'function') return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return [];
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction(LEGACY_STORE_NAME, 'readonly');
      const getAll = transaction.objectStore(LEGACY_STORE_NAME).getAll();
      getAll.onsuccess = () => {
        db.close();
        resolve(getAll.result.filter((signal) => signal?.type === 'MOVE_REPORT' && signal.moveReport).map((signal) => signal.moveReport));
      };
      getAll.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}

export async function migrateLegacyMoveEvents() {
  try {
    if (localStorage.getItem(MIGRATION_LS_KEY) === 'done') return 0;
  } catch {
    // Continue; IndexedDB put is idempotent by stable event id.
  }
  let localMoves = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || '[]');
    if (Array.isArray(parsed)) localMoves = parsed;
  } catch {
    localMoves = [];
  }
  const legacyMoves = [...localMoves, ...await readLegacyIndexedDb()];
  const deduplicated = new Map(legacyMoves.map((move) => {
    const normalized = legacyToEvent(move);
    return [normalized.id, normalized];
  }));
  for (const event of deduplicated.values()) await upsertMoveEvent(event);
  try {
    localStorage.setItem(MIGRATION_LS_KEY, 'done');
  } catch {
    // Safe to repeat because puts are idempotent.
  }
  return deduplicated.size;
}

export async function initializeMoveEventStore() {
  await openDatabase();
  await migrateLegacyMoveEvents();
  let shouldCleanup;
  try {
    const lastCleanup = Number(localStorage.getItem(CLEANUP_LS_KEY) || 0);
    shouldCleanup = Date.now() - lastCleanup > 24 * 60 * 60 * 1000;
  } catch {
    shouldCleanup = true;
  }
  if (shouldCleanup) {
    await pruneMoveEvents();
    try {
      localStorage.setItem(CLEANUP_LS_KEY, String(Date.now()));
    } catch {
      // Cleanup has already completed.
    }
  }
}

export async function __resetMoveEventStoreForTests() {
  if (databasePromise) {
    const db = await databasePromise.catch(() => null);
    db?.close();
  }
  databasePromise = null;
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
