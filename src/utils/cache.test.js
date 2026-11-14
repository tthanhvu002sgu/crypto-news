import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCached, readCacheEntry, readCacheValue, getCacheMetadata } from './cache.js';

function createQuotaStorage(maxBytes) {
  const map = new Map();
  const totalBytes = () => {
    let sum = 0;
    for (const [k, v] of map.entries()) sum += k.length + v.length;
    return sum;
  };
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      const prev = map.has(k) ? map.get(k) : '';
      const nextSize = totalBytes() - (map.has(k) ? k.length + prev.length : 0) + k.length + v.length;
      if (nextSize > maxBytes) {
        const err = new Error(`QuotaExceededError: ${nextSize} > ${maxBytes}`);
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

test('fetchCached evicts stale/oldest cache_* keys on QuotaExceededError without throwing', async () => {
  const storage = createQuotaStorage(210);
  globalThis.localStorage = storage;

  // Seed corrupt + expired + rotating dated entries
  storage.setItem('cache_corrupt_entry', '{bad-json');
  storage.setItem('cache_old_item', JSON.stringify({ val: { old: true }, time: Date.now() - 10 * 24 * 3600 * 1000 }));
  storage.setItem('cache_etfFlowHistory_2026-11-12', JSON.stringify({ val: '12345678901234567890', time: Date.now() - 1000 }));

  const fresh = await fetchCached(
    'etfFlowHistory_2026-11-14',
    async () => ({ rows: ['a', 'b', 'c'] }),
    60_000
  );

  assert.deepEqual(fresh, { rows: ['a', 'b', 'c'] });
  assert.equal(storage.getItem('cache_corrupt_entry'), null);
  assert.equal(storage.getItem('cache_old_item'), null);
  assert.equal(storage.getItem('cache_etfFlowHistory_2026-11-12'), null);
  assert.deepEqual(readCacheEntry('etfFlowHistory_2026-11-14')?.val, { rows: ['a', 'b', 'c'] });
});

test('fetchCached falls back to in-memory cache when payload exceeds localStorage limit', async () => {
  const storage = createQuotaStorage(10_000_000);
  globalThis.localStorage = storage;

  const hugeString = 'x'.repeat(460_000);
  let calls = 0;
  const val1 = await fetchCached('huge_feed_test', async () => {
    calls += 1;
    return { blob: hugeString };
  }, 60_000);

  assert.equal(val1.blob.length, 460_000);
  // Must NOT starve localStorage
  assert.equal(storage.getItem('cache_huge_feed_test'), null);
  // Must still serve from memoryCache on second call
  const val2 = await fetchCached('huge_feed_test', async () => {
    calls += 1;
    return { blob: 'should-not-run' };
  }, 60_000);
  assert.equal(calls, 1);
  assert.equal(val2.blob.length, 460_000);
  assert.equal(readCacheValue('huge_feed_test')?.blob.length, 460_000);
  assert.equal(getCacheMetadata('huge_feed_test', 60_000).isFresh, true);
});
