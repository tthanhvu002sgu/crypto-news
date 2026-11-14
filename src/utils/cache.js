/**
 * localStorage + in-memory cache helpers for REST sync.
 * Key format: cache_<cacheKey> → { val, time }
 */

const CACHE_PREFIX = 'cache_';
const DEFAULT_MAX_STALE_MS = 7 * 24 * 3600 * 1000;
const MAX_LOCAL_STORAGE_ITEM_CHARS = 450_000;
const ROTATING_DATE_PREFIXES = ['cache_etfFlowHistory_', 'cache_cmeCot_v2_'];

const memoryCache = new Map();

const hasLocalStorage = () => typeof localStorage !== 'undefined';

const isQuotaError = (err) => (
  err?.name === 'QuotaExceededError'
  || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  || err?.code === 22
  || err?.code === 1014
);

function parseStoredEntry(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed == null || !('val' in parsed)) return null;
  return parsed;
}

function safeRemoveStorageKey(fullKey) {
  try {
    localStorage.removeItem(fullKey);
  } catch {
    /* ignore storage cleanup failure */
  }
}

function evictStaleCacheEntries(excludeFullKey, maxStaleAgeMs = DEFAULT_MAX_STALE_MS) {
  if (!hasLocalStorage()) return [];
  const now = Date.now();
  const candidates = [];

  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }

  for (const fullKey of keys) {
    if (fullKey === excludeFullKey) continue;

    // Remove superseded daily snapshots immediately (keep only the newest key being written)
    const isSupersededDated = ROTATING_DATE_PREFIXES.some(
      (prefix) => excludeFullKey.startsWith(prefix) && fullKey.startsWith(prefix)
    );
    if (isSupersededDated) {
      safeRemoveStorageKey(fullKey);
      continue;
    }

    try {
      const raw = localStorage.getItem(fullKey);
      const parsed = parseStoredEntry(raw);
      const ts = typeof parsed?.time === 'number' ? parsed.time : 0;
      if (!parsed || (ts > 0 && now - ts > maxStaleAgeMs)) {
        safeRemoveStorageKey(fullKey);
      } else {
        candidates.push({ fullKey, time: ts, size: raw ? raw.length : 0 });
      }
    } catch {
      safeRemoveStorageKey(fullKey);
    }
  }

  // Sort oldest-first; break ties by largest size so big feeds free quota fastest
  candidates.sort((a, b) => (a.time - b.time) || (b.size - a.size));
  return candidates;
}

function persistCacheEntry(cacheKey, entry, maxStaleAgeMs = DEFAULT_MAX_STALE_MS) {
  memoryCache.set(cacheKey, entry);
  if (!hasLocalStorage()) return;

  const fullKey = `${CACHE_PREFIX}${cacheKey}`;
  let serialized;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    return;
  }

  // Oversized payloads stay in memoryCache so they never starve localStorage quota
  if (serialized.length > MAX_LOCAL_STORAGE_ITEM_CHARS) {
    safeRemoveStorageKey(fullKey);
    return;
  }

  try {
    localStorage.setItem(fullKey, serialized);
    return;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn(`Lỗi ghi cache cho ${cacheKey}:`, e);
      return;
    }
  }

  // Quota exceeded: purge expired/superseded entries first, then evict oldest cache_* entries
  const remaining = evictStaleCacheEntries(fullKey, maxStaleAgeMs);
  try {
    localStorage.setItem(fullKey, serialized);
    return;
  } catch (e2) {
    if (!isQuotaError(e2)) return;
  }

  for (const item of remaining) {
    safeRemoveStorageKey(item.fullKey);
    try {
      localStorage.setItem(fullKey, serialized);
      return;
    } catch (e3) {
      if (!isQuotaError(e3)) return;
    }
  }
}

/**
 * Read a cached value if still within expiry (or return stale for fallback).
 * @returns {{ val: any, time: number } | null}
 */
export function readCacheEntry(cacheKey) {
  const mem = memoryCache.get(cacheKey) || null;
  let stored = null;

  if (hasLocalStorage()) {
    try {
      stored = parseStoredEntry(localStorage.getItem(`${CACHE_PREFIX}${cacheKey}`));
    } catch {
      stored = null;
    }
  }

  if (mem && stored) {
    return (mem.time ?? 0) >= (stored.time ?? 0) ? mem : stored;
  }
  return mem || stored;
}

/** True if cache exists and is younger than expiryMs. */
export function isCacheFresh(cacheKey, expiryMs) {
  const entry = readCacheEntry(cacheKey);
  if (!entry || entry.time == null) return false;
  return Date.now() - entry.time < expiryMs;
}

/** Read only the value (ignores expiry). Useful for hydrate-from-cache. */
export function readCacheValue(cacheKey, fallback = null) {
  try {
    const entry = readCacheEntry(cacheKey);
    if (entry && entry.val !== undefined && entry.val !== null) return entry.val;
    if (hasLocalStorage()) {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const val = parsed?.val !== undefined ? parsed.val : parsed;
        if (val !== null && val !== undefined) return val;
      }
    }
  } catch {
    /* ignore malformed cache payload */
  }
  return fallback;
}

/**
 * Read cache metadata including age and stale status.
 */
export function getCacheMetadata(cacheKey, expiryMs = 3600000) {
  const entry = readCacheEntry(cacheKey);
  if (!entry || entry.time == null) return { exists: false, time: null, ageHours: null, isFresh: false, isStale: true };
  const ageMs = Date.now() - entry.time;
  const ageHours = parseFloat((ageMs / 3600000).toFixed(1));
  return {
    exists: true,
    time: entry.time,
    ageHours,
    isFresh: ageMs < expiryMs,
    isStale: ageMs >= expiryMs
  };
}

/**
 * Fetch with localStorage + in-memory TTL cache and automatic LRU/stale eviction on quota overflow.
 */
export async function fetchCached(cacheKey, fetchFn, expiryMs, addLog, label, force = false, maxStaleAgeMs = DEFAULT_MAX_STALE_MS) {
  let cachedVal = null;
  let cachedTime = null;
  let hasCached = false;

  const entry = readCacheEntry(cacheKey);
  if (entry) {
    cachedVal = entry.val;
    cachedTime = entry.time;
    hasCached = true;
    if (!force && cachedTime != null && Date.now() - cachedTime < expiryMs) {
      if (addLog && label) addLog(`✓ ${label} (Dữ liệu cache)`, 'ok');
      return cachedVal;
    }
  }

  try {
    const freshVal = await fetchFn();
    if (freshVal !== null && freshVal !== undefined) {
      persistCacheEntry(cacheKey, { val: freshVal, time: Date.now() }, maxStaleAgeMs);
      if (addLog && label) addLog(`✓ ${label}`, 'ok');
      return freshVal;
    }
    throw new Error('Phản hồi trống hoặc lỗi API');
  } catch (e) {
    if (hasCached && cachedTime && (Date.now() - cachedTime <= maxStaleAgeMs)) {
      if (addLog && label) {
        const ageHours = ((Date.now() - cachedTime) / 3600000).toFixed(1);
        addLog(`⚠ ${label} — lỗi truy vấn, dùng tạm cache (${ageHours}h trước)`, 'warning');
      }
      if (cachedVal && typeof cachedVal === 'object') {
        return {
          ...cachedVal,
          isStale: true,
          cachedAt: cachedTime
        };
      }
      return cachedVal;
    }
    if (addLog && label) {
      addLog(`✗ ${label} — thất bại: ${e.message}`, 'error');
    }
  }
  return null;
}
