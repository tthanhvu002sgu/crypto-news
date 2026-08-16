import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetMoveEventStoreForTests,
  exportMoveEvents,
  getMoveStats,
  migrateLegacyMoveEvents,
  pruneMoveEvents,
  queryMoveEvents,
  upsertMoveEvent,
} from './moveEventStore.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();

function event(id, triggerTime, overrides = {}) {
  return {
    id,
    schemaVersion: 2,
    triggerTime,
    direction: 'PUMP',
    detectionWindowSec: 15,
    qualityTier: 'PRICE_ONLY',
    flowLabel: 'MIXED_FLOW',
    outcomeLabel: 'CONTINUATION',
    triggerPrice: 100,
    forwardOutcomes: {
      '300': { dataStatus: 'COMPLETE', continuationBps: 10, mfeBps: 20, maeBps: 5, outcomeLabel: 'CONTINUATION' },
    },
    timeframeContext: { '5m': { structure: 'UP' } },
    ...overrides,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await __resetMoveEventStoreForTests();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('CryptoSignalLog');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
});

test('IndexedDB upsert is idempotent and query filters indexed research fields', async () => {
  await upsertMoveEvent(event('one', 1000));
  await upsertMoveEvent(event('one', 1000, { qualityTier: 'CONFLUENT' }));
  await upsertMoveEvent(event('two', 2000, { direction: 'DUMP' }));
  const all = await queryMoveEvents({ toTime: 3000 });
  assert.equal(all.length, 2);
  assert.equal(all.find((item) => item.id === 'one').qualityTier, 'CONFLUENT');
  assert.deepEqual((await queryMoveEvents({ direction: 'DUMP', toTime: 3000 })).map((item) => item.id), ['two']);
});

test('stats and CSV export flatten +5m outcomes without inventing missing values', async () => {
  await upsertMoveEvent(event('one', 1000));
  const stats = await getMoveStats({ toTime: 3000 });
  assert.equal(stats.overall.n, 1);
  assert.equal(stats.overall.medianReturnBps, 10);
  const csv = await exportMoveEvents('csv', { toTime: 3000 });
  assert.match(csv, /return5mBps/);
  assert.match(csv, /"one"/);
});

test('localStorage legacy migration deduplicates by stable move id', async () => {
  localStorage.setItem('hft_move_history_v1', JSON.stringify([
    { id: 'legacy-one', startTime: 1000, endTime: 2000, direction: 'PUMP', startPrice: 100, endPrice: 101, recoveryPct: 10 },
    { id: 'legacy-one', startTime: 1000, endTime: 2000, direction: 'PUMP', startPrice: 100, endPrice: 101, recoveryPct: 10 },
  ]));
  assert.equal(await migrateLegacyMoveEvents(), 1);
  assert.equal((await queryMoveEvents({ toTime: 3000 })).length, 1);
  assert.equal(await migrateLegacyMoveEvents(), 0);
});

test('legacy CryptoSignalLog MOVE_REPORT records migrate into the research store', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('CryptoSignalLog', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('signals', { keyPath: 'id', autoIncrement: true });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('signals', 'readwrite');
      transaction.objectStore('signals').add({
        type: 'MOVE_REPORT',
        timestamp: 2000,
        moveReport: { id: 'legacy-idb', startTime: 1000, endTime: 2000, direction: 'DUMP', startPrice: 101, endPrice: 100, recoveryPct: 55 },
      });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  assert.equal(await migrateLegacyMoveEvents(), 1);
  const migrated = (await queryMoveEvents({ toTime: 3000 }))[0];
  assert.equal(migrated.id, 'legacy-idb');
  assert.equal(migrated.outcomeLabel, 'MEAN_REVERSION');
});

test('90-day retention removes only expired events', async () => {
  const now = 100 * 24 * 60 * 60 * 1000;
  await upsertMoveEvent(event('expired', now - 91 * 24 * 60 * 60 * 1000));
  await upsertMoveEvent(event('kept', now - 89 * 24 * 60 * 60 * 1000));
  assert.equal(await pruneMoveEvents(now), 1);
  assert.deepEqual((await queryMoveEvents({ toTime: now })).map((item) => item.id), ['kept']);
});
