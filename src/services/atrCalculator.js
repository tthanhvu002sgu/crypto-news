/**
 * ATR Calculator for the MOVE TRACKER champion detector.
 * Uses closed Binance USD-M Futures candles and exposes data freshness.
 */

const FUTURES_KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const CACHE_TTL_MS = 60 * 1000;
const ATR_STALE_MS = 10 * 60 * 1000;

let cachedAtr = {
  value: null,
  lastUpdated: 0,
  lastClosedCandleTime: null,
  source: 'BINANCE_FUTURES',
  interval: '5m',
  period: 14,
  status: 'UNAVAILABLE',
  error: null,
};

let inFlightRequest = null;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateWilderATR(rawKlines, period = 14, now = Date.now()) {
  const closed = (Array.isArray(rawKlines) ? rawKlines : [])
    .filter((row) => Array.isArray(row) && finiteNumber(row[6]) != null && finiteNumber(row[6]) <= now)
    .map((row) => ({ high: finiteNumber(row[2]), low: finiteNumber(row[3]), close: finiteNumber(row[4]), closeTime: finiteNumber(row[6]) }))
    .filter((row) => row.high != null && row.low != null && row.close != null);

  if (closed.length < period + 1) return { value: null, lastClosedCandleTime: closed.at(-1)?.closeTime ?? null };
  const trueRanges = [];
  for (let index = 1; index < closed.length; index += 1) {
    const candle = closed[index];
    const previousClose = closed[index - 1].close;
    trueRanges.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose)));
  }
  if (trueRanges.length < period) return { value: null, lastClosedCandleTime: closed.at(-1)?.closeTime ?? null };

  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) atr = ((atr * (period - 1)) + trueRanges[index]) / period;
  return { value: Number(atr.toFixed(2)), lastClosedCandleTime: closed.at(-1)?.closeTime ?? null };
}

function snapshotAtr(now = Date.now()) {
  const ageMs = cachedAtr.lastUpdated ? now - cachedAtr.lastUpdated : Infinity;
  const status = cachedAtr.value == null ? 'UNAVAILABLE' : ageMs > ATR_STALE_MS ? 'STALE' : cachedAtr.status;
  return { ...cachedAtr, status, ageMs };
}

export async function getATR(symbol = 'BTCUSDT', interval = '5m', period = 14, options = {}) {
  const now = options.now ?? Date.now();
  const force = options.force === true;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!force && cachedAtr.value != null && now - cachedAtr.lastUpdated < CACHE_TTL_MS && cachedAtr.interval === interval && cachedAtr.period === period) {
    return cachedAtr.value;
  }
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = (async () => {
    try {
      const params = new URLSearchParams({ symbol, interval, limit: String(Math.max(period + 16, 30)) });
      const response = await fetchImpl(`${FUTURES_KLINES_URL}?${params}`);
      if (!response.ok) throw new Error(`Binance Futures API error: ${response.status}`);
      const calculated = calculateWilderATR(await response.json(), period, now);
      if (calculated.value == null) throw new Error('Insufficient closed Futures candles for ATR');
      cachedAtr = {
        value: calculated.value,
        lastUpdated: now,
        lastClosedCandleTime: calculated.lastClosedCandleTime,
        source: 'BINANCE_FUTURES',
        interval,
        period,
        status: 'LIVE',
        error: null,
      };
      return cachedAtr.value;
    } catch (error) {
      cachedAtr = { ...cachedAtr, status: cachedAtr.value == null ? 'UNAVAILABLE' : 'STALE', error: error instanceof Error ? error.message : String(error) };
      console.warn('[ATR] Futures ATR unavailable:', error);
      return cachedAtr.value;
    } finally {
      inFlightRequest = null;
    }
  })();
  return inFlightRequest;
}

export function getCurrentATR() {
  return cachedAtr.value;
}

export function getATRState(now = Date.now()) {
  return snapshotAtr(now);
}

export function __resetATRForTests() {
  cachedAtr = {
    value: null,
    lastUpdated: 0,
    lastClosedCandleTime: null,
    source: 'BINANCE_FUTURES',
    interval: '5m',
    period: 14,
    status: 'UNAVAILABLE',
    error: null,
  };
  inFlightRequest = null;
}
