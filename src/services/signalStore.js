/**
 * Signal Store — IndexedDB wrapper for persistent signal log storage.
 * Signals are stored with full indicator snapshots for retrospective analysis.
 */

const DB_NAME = 'CryptoSignalLog';
const DB_VERSION = 1;
const STORE_NAME = 'signals';
let dbInstance = null;

const signalAddedListeners = new Set();

export function onSignalAdded(callback) {
  signalAddedListeners.add(callback);
  return () => signalAddedListeners.delete(callback);
}

function notifySignalAdded(signal) {
  signalAddedListeners.forEach((fn) => {
    try { fn(signal); } catch { /* ignore */ }
  });
}

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('severity', 'severity', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      dbInstance.onerror = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[SignalStore] IndexedDB open error:', event.target.error);
      dbInstance = null;
      reject(event.target.error);
    };
  });
}

const LS_SIGNALS_KEY = 'hft_signal_log_ls_v1';

function saveSignalToLS(signal, id) {
  try {
    const raw = localStorage.getItem(LS_SIGNALS_KEY);
    let list = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const item = { ...signal, id: id || signal.id || Date.now() };
    list = [item, ...list].filter(s => s && s.timestamp > cutoff).slice(0, 200);
    localStorage.setItem(LS_SIGNALS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[SignalStore] LS save error:', e);
  }
}

function getSignalsFromLS(limit = 200) {
  try {
    const raw = localStorage.getItem(LS_SIGNALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
        return parsed.filter(s => s && s.timestamp > cutoff).slice(0, limit);
      }
    }
  } catch {}
  return [];
}

/**
 * Add a signal to the store.
 * @param {Object} signal - { timestamp, type, severity, title, description, snapshot }
 * @returns {Promise<number>} - The auto-generated ID
 */
export async function addSignal(signal) {
  const newSignal = {
    ...signal,
    timestamp: signal.timestamp || Date.now(),
  };
  let generatedId = newSignal.timestamp;

  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(newSignal);

      request.onsuccess = () => {
        generatedId = request.result;
        newSignal.id = generatedId;
        resolve(generatedId);
      };
      request.onerror = () => {
        dbInstance = null;
        reject(request.error);
      };
    });
  } catch (e) {
    console.warn('[SignalStore] addSignal IDB error, using LS fallback:', e);
    dbInstance = null;
    newSignal.id = generatedId;
  }

  saveSignalToLS(newSignal, generatedId);
  notifySignalAdded(newSignal);
  return generatedId;
}

/**
 * Get all signals, newest first. Optional limit.
 * @param {number} limit - Max signals to return (default 200)
 * @returns {Promise<Array>}
 */
export async function getSignals(limit = 200) {
  let idbResults = [];
  try {
    const db = await openDB();
    idbResults = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev'); // newest first
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[SignalStore] getSignals IDB error, using LS fallback:', e);
    idbResults = [];
  }

  const lsResults = getSignalsFromLS(limit);
  const map = new Map();
  lsResults.forEach(s => map.set(`${s.id}_${s.timestamp}`, s));
  idbResults.forEach(s => map.set(`${s.id}_${s.timestamp}`, s));

  const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  return merged;
}

/**
 * Get signals within a date range.
 * @param {number} fromTs - Start timestamp (inclusive)
 * @param {number} toTs - End timestamp (inclusive)
 * @returns {Promise<Array>}
 */
export async function getSignalsByDateRange(fromTs, toTs) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.bound(fromTs, toTs);
      const request = index.openCursor(range, 'prev');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SignalStore] getSignalsByDateRange error:', e);
    return [];
  }
}

/**
 * Get total signal count.
 * @returns {Promise<number>}
 */
export async function getSignalCount() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SignalStore] getSignalCount error:', e);
    return 0;
  }
}

/**
 * Delete signals older than X days (default 7 days).
 * @param {number} daysToKeep - Keep signals newer than this many days
 * @returns {Promise<number>} - Number of deleted signals
 */
export async function clearOldSignals(daysToKeep = 7) {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  try {
    const raw = localStorage.getItem(LS_SIGNALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(s => s && s.timestamp > cutoff);
        localStorage.setItem(LS_SIGNALS_KEY, JSON.stringify(filtered));
      }
    }
  } catch {}

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);
      let deleted = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SignalStore] clearOldSignals error:', e);
    return 0;
  }
}

/**
 * Clear all signals.
 * @returns {Promise<void>}
 */
export async function clearAllSignals() {
  try {
    localStorage.removeItem(LS_SIGNALS_KEY);
  } catch {}

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[SignalStore] clearAllSignals error:', e);
  }
}

/**
 * Export all signals as JSON string (for download).
 * @returns {Promise<string>}
 */
export async function exportSignals() {
  const signals = await getSignals(10000);
  return JSON.stringify(signals, null, 2);
}

/**
 * Get move report signals specifically
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getMoveReports(limit = 100) {
  const allSignals = await getSignals(500);
  return allSignals.filter((s) => s.type === 'MOVE_REPORT').slice(0, limit);
}

