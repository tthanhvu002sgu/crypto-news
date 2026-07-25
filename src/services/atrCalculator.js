/**
 * ATR Calculator — Calculates Average True Range (ATR) from Binance Klines.
 * Default: 14 periods, 5-minute candles.
 */

let cachedAtr = {
  val: 350, // default fallback (~$350 ATR for BTC on 5m)
  lastUpdated: 0,
};

const CACHE_TTL_MS = 3 * 60 * 1000; // Recalculate every 3 minutes

/**
 * Fetch 5m klines from Binance and calculate ATR(14)
 * @param {string} symbol
 * @param {string} interval
 * @param {number} period
 * @returns {Promise<number>} ATR value in USD
 */
export async function getATR(symbol = 'BTCUSDT', interval = '5m', period = 14) {
  const now = Date.now();
  if (now - cachedAtr.lastUpdated < CACHE_TTL_MS && cachedAtr.val > 0) {
    return cachedAtr.val;
  }

  try {
    // Fetch (period + 10) candles to calculate EMA/SMA True Range smoothly
    const limit = period + 15;
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length < period + 1) {
      return cachedAtr.val;
    }

    // Format candles: [openTime, open, high, low, close, volume, ...]
    const candles = data.map(c => ({
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));

    // Calculate True Range (TR) array
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trValues.push(tr);
    }

    if (trValues.length < period) return cachedAtr.val;

    // Initial ATR: Simple Average of first 'period' TR values
    let atr = trValues.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    // Wilder's Smoothing for remaining TR values
    for (let i = period; i < trValues.length; i++) {
      atr = (atr * (period - 1) + trValues[i]) / period;
    }

    cachedAtr = {
      val: Math.round(atr * 100) / 100,
      lastUpdated: now,
    };

    return cachedAtr.val;
  } catch (err) {
    console.warn('[ATR] Failed to fetch ATR, using fallback:', err);
    return cachedAtr.val;
  }
}

/**
 * Synchronous getter for current cached ATR
 */
export function getCurrentATR() {
  return cachedAtr.val;
}
