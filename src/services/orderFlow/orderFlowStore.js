const DB_NAME = 'AggregatedOrderFlow';
const DB_VERSION = 1;

const requestPromise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export class OrderFlowStore {
  constructor(indexedDb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
    this.indexedDb = indexedDb;
    this.db = null;
  }

  async open() {
    if (!this.indexedDb || this.db) return this.db;
    const request = this.indexedDb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('cvdBuckets')) {
        const store = db.createObjectStore('cvdBuckets', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('footprintBins')) {
        const store = db.createObjectStore('footprintBins', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('checkpoints')) db.createObjectStore('checkpoints', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('divergences')) {
        const store = db.createObjectStore('divergences', { keyPath: 'id' });
        store.createIndex('confirmedAt', 'confirmedAt');
      }
    };
    this.db = await requestPromise(request);
    return this.db;
  }

  async loadSince(storeName, since) {
    const db = await this.open();
    if (!db) return [];
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index('timestamp');
    return requestPromise(index.getAll(IDBKeyRange.lowerBound(since)));
  }

  async loadCheckpoints() {
    const db = await this.open();
    if (!db) return [];
    return requestPromise(db.transaction('checkpoints', 'readonly').objectStore('checkpoints').getAll());
  }

  async loadDivergences(limit = 50) {
    const db = await this.open();
    if (!db) return [];
    const rows = await requestPromise(db.transaction('divergences', 'readonly').objectStore('divergences').getAll());
    return rows.sort((a, b) => b.confirmedAt - a.confirmedAt).slice(0, limit);
  }

  async persist({ buckets = [], footprints = [], checkpoints = [], divergences = [] } = {}) {
    const db = await this.open();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['cvdBuckets', 'footprintBins', 'checkpoints', 'divergences'], 'readwrite');
      buckets.forEach((row) => tx.objectStore('cvdBuckets').put(row));
      footprints.forEach((row) => tx.objectStore('footprintBins').put(row));
      checkpoints.forEach((row) => tx.objectStore('checkpoints').put(row));
      divergences.forEach((row) => tx.objectStore('divergences').put(row));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async pruneBefore(timestamp) {
    const db = await this.open();
    if (!db) return;
    for (const storeName of ['cvdBuckets', 'footprintBins']) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const request = tx.objectStore(storeName).index('timestamp').openKeyCursor(IDBKeyRange.upperBound(timestamp, true));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          tx.objectStore(storeName).delete(cursor.primaryKey);
          cursor.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
  }
}
