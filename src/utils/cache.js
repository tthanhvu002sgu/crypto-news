/**
 * localStorage cache helpers for REST sync.
 * Key format: cache_<cacheKey> → { val, time }
 */

/**
 * Read a cached value if still within expiry (or return stale for fallback).
 * @returns {{ val: any, time: number } | null}
 */
export function readCacheEntry(cacheKey) {
  try {
    const raw = localStorage.getItem(`cache_${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed == null || !('val' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True if cache exists and is younger than expiryMs. */
export function isCacheFresh(cacheKey, expiryMs) {
  const entry = readCacheEntry(cacheKey);
  if (!entry || entry.time == null) return false;
  return Date.now() - entry.time < expiryMs;
}

/** Read only the value (ignores expiry). Useful for hydrate-from-cache. */
export function readCacheValue(cacheKey) {
  const entry = readCacheEntry(cacheKey);
  return entry ? entry.val : null;
}

/**
 * Fetch with localStorage TTL cache.
 * - Fresh cache + !force → return cache (no network)
 * - Network fail + any cache → return stale cache
 * - force → always network
 */
export async function fetchCached(cacheKey, fetchFn, expiryMs, addLog, label, force = false) {
  let cachedVal = null;
  let hasCached = false;

  try {
    const cached = localStorage.getItem(`cache_${cacheKey}`);
    if (cached) {
      const { val, time } = JSON.parse(cached);
      cachedVal = val;
      hasCached = true;
      if (!force && Date.now() - time < expiryMs) {
        if (addLog && label) addLog(`✓ ${label} (Dữ liệu cache)`, 'ok');
        return val;
      }
    }
  } catch (e) {
    console.warn(`Lỗi đọc cache cho ${cacheKey}:`, e);
  }

  try {
    const freshVal = await fetchFn();
    if (freshVal !== null && freshVal !== undefined) {
      try {
        localStorage.setItem(
          `cache_${cacheKey}`,
          JSON.stringify({ val: freshVal, time: Date.now() })
        );
      } catch (e) {
        console.warn(`Lỗi ghi cache cho ${cacheKey}:`, e);
      }
      if (addLog && label) addLog(`✓ ${label}`, 'ok');
      return freshVal;
    }
    throw new Error('Phản hồi trống hoặc lỗi API');
  } catch (e) {
    if (hasCached) {
      if (addLog && label) {
        addLog(`⚠ ${label} — lỗi truy vấn, dùng tạm cache cũ`, 'warning');
      }
      return cachedVal;
    }
    if (addLog && label) {
      addLog(`✗ ${label} — thất bại: ${e.message}`, 'error');
    }
  }
  return null;
}
