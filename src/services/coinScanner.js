import axios from 'axios';

// ─── TA CALCULATORS (PURE JS) ──────────────────────────────────────────────────

/** Calculate Exponential Moving Average (EMA) */
export function calculateEMA(data, period) {
  if (!data || data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

/** Calculate Relative Strength Index (RSI 14) */
export function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - (100 / (1 + rs))) * 10) / 10;
}

// ─── BINANCE SCANNER DATA FETCHERS ─────────────────────────────────────────────

// List of stablecoins / wrapped tokens to exclude from altcoin scanner
const EXCLUDED_SYMBOLS = new Set([
  'USDTUSDC', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDCUSDT', 'DAIUSDT',
  'WBTCUSDT', 'WETHUSDT', 'WEETHUSDT', 'WBETHUSDT', 'BTCUSDT', 'ETHUSDT'
]);

/** Batch helper with concurrency throttle to prevent rate limit issues */
async function mapConcurrent(array, limit, fn) {
  const results = [];
  const executing = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (limit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

/** 
 * Fetch Top 50 coins sorted by TRUE 30-DAY VOLUME (not just 24h pump volume) 
 * Filters out low-liquidity coins with 1-day temporary volume spikes.
 */
export async function getTop30dVolumePairs(limit = 50) {
  try {
    // 1. Fetch 24h ticker for top 120 potential candidates
    const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
    const candidates = res.data
      .filter(item => 
        item.symbol.endsWith('USDT') && 
        !EXCLUDED_SYMBOLS.has(item.symbol) &&
        parseFloat(item.quoteVolume) > 3000000 // Min $3M 24h volume
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100);

    // 2. Fetch 30-day daily klines for each candidate to sum exact 30-day Quote Volume
    const fetch30dVol = async (item) => {
      try {
        const kRes = await axios.get('https://api.binance.com/api/v3/klines', {
          params: { symbol: item.symbol, interval: '1d', limit: 30 },
          timeout: 4000,
        });

        if (!kRes.data || kRes.data.length === 0) return null;

        const vol30d = kRes.data.reduce((sum, k) => sum + parseFloat(k[7]), 0); // quoteVolume sum
        const avgDailyVol30d = vol30d / (kRes.data.length || 1);

        return {
          symbol: item.symbol,
          baseAsset: item.symbol.replace('USDT', ''),
          price: parseFloat(item.lastPrice),
          priceChange24h: parseFloat(item.priceChangePercent),
          volume24h: parseFloat(item.quoteVolume),
          high24h: parseFloat(item.highPrice),
          low24h: parseFloat(item.lowPrice),
          vol30d: Math.round(vol30d),
          avgDailyVol30d: Math.round(avgDailyVol30d),
        };
      } catch {
        return null;
      }
    };

    // Run concurrently with batch limit of 10
    const results = await mapConcurrent(candidates, 10, fetch30dVol);
    const validPairs = results.filter(Boolean);

    // Sort by 30-DAY VOLUME descending & return top 50
    validPairs.sort((a, b) => b.vol30d - a.vol30d);
    return validPairs.slice(0, limit);
  } catch (e) {
    console.error('[Scanner] Failed to fetch top 30d volume pairs:', e.message);
    return [];
  }
}

/** Fetch Futures Book Tickers (Best Bid / Best Ask) for all symbols */
export async function getFuturesBookTickers() {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/ticker/bookTicker', { timeout: 5000 });
    const bookMap = new Map();
    res.data.forEach(item => {
      const bid = parseFloat(item.bidPrice);
      const ask = parseFloat(item.askPrice);
      if (ask > 0 && bid > 0) {
        const spreadPct = ((ask - bid) / ask) * 100;
        bookMap.set(item.symbol, {
          bidPrice: bid,
          askPrice: ask,
          spreadPct: Math.round(spreadPct * 1000) / 1000, // round 3 decimals e.g. 0.025%
        });
      }
    });
    return bookMap;
  } catch (e) {
    console.warn('[Scanner] Could not fetch futures book tickers:', e.message);
    return new Map();
  }
}

/** Analyze single coin indicators (Spot 4h Klines + Futures 4h Klines + Spread) */
async function analyzeCoin(pair, futuresBookMap) {
  try {
    // 1. Fetch Spot 4h klines (limit 55 for EMA 55 + RSI 14)
    const spotRes = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: pair.symbol, interval: '4h', limit: 55 },
      timeout: 5000,
    });

    if (!spotRes.data || spotRes.data.length < 30) return null;

    const closes = spotRes.data.map(k => parseFloat(k[4]));
    const currentPrice = closes[closes.length - 1];

    // TA Calculations
    const ema21 = calculateEMA(closes, 21);
    const ema55 = calculateEMA(closes, 55);
    const rsi14 = calculateRSI(closes, 14);

    // Volume Surge vs 30-day Daily Average Volume
    const avgDailyVol = pair.avgDailyVol30d || (pair.volume24h || 1);
    const volSurgeRatio = pair.volume24h > 0 ? (pair.volume24h / avgDailyVol) : 1;

    // 2. Fetch Futures 4h klines for CVD & Taker Buy/Sell ratio
    let cvd24h = 0;
    let cvdTrend = 0; // positive if recent 12h CVD > previous 12h CVD
    let takerBuyRatio = 50;
    let hasFutures = false;
    let spreadPct = null;

    // Check futures book ticker for Bid-Ask Spread
    if (futuresBookMap && futuresBookMap.has(pair.symbol)) {
      hasFutures = true;
      spreadPct = futuresBookMap.get(pair.symbol).spreadPct;
    }

    try {
      const futRes = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
        params: { symbol: pair.symbol, interval: '4h', limit: 12 },
        timeout: 4000,
      });

      if (futRes.data && futRes.data.length > 0) {
        hasFutures = true;
        let totalBuyQuote = 0;
        let totalQuote = 0;
        const deltas = [];

        futRes.data.forEach(k => {
          const qVol = parseFloat(k[7]);
          const buyQVol = parseFloat(k[10]);
          const sellQVol = qVol - buyQVol;
          const delta = buyQVol - sellQVol;

          totalBuyQuote += buyQVol;
          totalQuote += qVol;
          cvd24h += delta;
          deltas.push(delta);
        });

        takerBuyRatio = totalQuote > 0 ? Math.round((totalBuyQuote / totalQuote) * 100) : 50;

        // CVD trend: last 3 candles (12h) sum vs preceding 3 candles (12h) sum
        if (deltas.length >= 6) {
          const recent12h = deltas.slice(-3).reduce((a, b) => a + b, 0);
          const prev12h = deltas.slice(-6, -3).reduce((a, b) => a + b, 0);
          cvdTrend = recent12h - prev12h;
        }
      }
    } catch {
      // keep hasFutures as set by bookTicker if any
    }

    return {
      ...pair,
      currentPrice,
      ema21: ema21 ? Math.round(ema21 * 10000) / 10000 : null,
      ema55: ema55 ? Math.round(ema55 * 10000) / 10000 : null,
      rsi14,
      volSurgeRatio: Math.round(volSurgeRatio * 10) / 10,
      cvd24h: Math.round(cvd24h),
      cvdTrend: Math.round(cvdTrend),
      takerBuyRatio,
      hasFutures,
      spreadPct,
    };
  } catch (e) {
    console.warn(`[Scanner] Skipping ${pair.symbol}:`, e.message);
    return null;
  }
}

// ─── SCORING ALGORITHM (0 - 20 POINTS) ────────────────────────────────────────

export function scoreCoin(coin, macroContext = {}) {
  let score = 0;
  const tags = [];
  const breakdown = [];

  // 1. NHÂN — 30-Day Liquidity Base & Futures Spread (Max 6 pts)
  // 30-Day Volume Quality Check
  if (coin.vol30d >= 1000000000) { // 30d Vol > $1 Billion ($33M+/day)
    score += 2;
    tags.push({ label: 'Vol 30D Khủng (>$1B)', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Thanh khoản 30 ngày cực bền (>$1B)', pts: 2 });
  } else if (coin.vol30d >= 300000000) { // 30d Vol > $300 Million ($10M+/day)
    score += 1;
    tags.push({ label: 'Vol 30D Bền', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Thanh khoản 30 ngày ổn định (>$300M)', pts: 1 });
  }

  if (coin.hasFutures) {
    score += 1;
    breakdown.push({ category: 'NHÂN', item: 'Có Binance Futures', pts: 1 });
  }

  // SPREAD FUTURES EVALUATION (Chênh lệch giá Mua / Bán)
  if (coin.spreadPct !== null) {
    if (coin.spreadPct <= 0.03) {
      score += 2;
      tags.push({ label: `Spread ${coin.spreadPct.toFixed(3)}% ⚡`, type: 'emerald' });
      breakdown.push({ category: 'NHÂN', item: `Spread cực mỏng (${coin.spreadPct.toFixed(3)}%)`, pts: 2 });
    } else if (coin.spreadPct <= 0.08) {
      score += 1;
      tags.push({ label: `Spread ${coin.spreadPct.toFixed(2)}%`, type: 'emerald' });
      breakdown.push({ category: 'NHÂN', item: `Spread mỏng tốt (${coin.spreadPct.toFixed(2)}%)`, pts: 1 });
    } else if (coin.spreadPct > 0.15) {
      score -= 1;
      tags.push({ label: `Spread Rộng (${coin.spreadPct.toFixed(2)}%)`, type: 'rose' });
      breakdown.push({ category: 'NHÂN', item: `Spread rộng >0.15% (Rủi ro Slippage)`, pts: -1 });
    }
  }

  // 2. DUYÊN — Money Flow / CVD / Volume (Max 6 pts)
  if (coin.cvd24h > 0) {
    score += 2;
    tags.push({ label: 'CVD Inflow', type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Mua Ròng', pts: 2 });
  } else if (coin.cvd24h < 0) {
    score -= 1;
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Bán Ròng', pts: -1 });
  }

  if (coin.cvdTrend > 0) {
    score += 1;
    tags.push({ label: 'CVD Trend ↑', type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: 'CVD Momentum Đang Tăng', pts: 1 });
  }

  if (coin.volSurgeRatio >= 1.5) {
    score += 2;
    tags.push({ label: `Vol Surge ${coin.volSurgeRatio}x 30d`, type: 'amber' });
    breakdown.push({ category: 'DUYÊN', item: `Volume Đột Biến (${coin.volSurgeRatio}x TB 30d)`, pts: 2 });
  } else if (coin.volSurgeRatio >= 1.2) {
    score += 1;
    tags.push({ label: 'Vol Tăng Cường', type: 'amber' });
    breakdown.push({ category: 'DUYÊN', item: 'Volume Tăng So Với TB 30d', pts: 1 });
  }

  if (coin.takerBuyRatio >= 60) {
    score += 1;
    tags.push({ label: `Buy Pressure ${coin.takerBuyRatio}%`, type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: `Phe Mua Áp Đảo (${coin.takerBuyRatio}%)`, pts: 1 });
  }

  // 3. DUYÊN — Technical Analysis 4H (Max 6 pts)
  const isEmaUptrend = coin.ema21 && coin.ema55 && coin.ema21 > coin.ema55;
  if (isEmaUptrend) {
    score += 2;
    tags.push({ label: 'EMA 4h Uptrend', type: 'emerald' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 > EMA 55 (Uptrend 4h)', pts: 2 });
  } else {
    score -= 1;
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 < EMA 55 (Downtrend 4h)', pts: -1 });
  }

  const isPriceAboveEma21 = coin.ema21 && coin.currentPrice >= coin.ema21;
  if (isPriceAboveEma21) {
    score += 1;
    breakdown.push({ category: 'KỸ THUẬT', item: 'Giá nằm trên EMA 21', pts: 1 });
  } else {
    score -= 1;
    breakdown.push({ category: 'KỸ THUẬT', item: 'Giá nằm dưới EMA 21', pts: -1 });
  }

  // RSI 14 sweet spot (40-60 = Swing Pullback/Re-accumulation zone)
  if (coin.rsi14 >= 40 && coin.rsi14 <= 60) {
    score += 2;
    tags.push({ label: `RSI Sweet Spot (${coin.rsi14})`, type: 'cyan' });
    breakdown.push({ category: 'KỸ THUẬT', item: `RSI 14 Vùng Tích Lũy Vừa Đẹp (${coin.rsi14})`, pts: 2 });
  } else if (coin.rsi14 >= 30 && coin.rsi14 < 40) {
    score += 1;
    tags.push({ label: `RSI Bounce Zone (${coin.rsi14})`, type: 'cyan' });
    breakdown.push({ category: 'KỸ THUẬT', item: `RSI Vùng Hồi Phục (${coin.rsi14})`, pts: 1 });
  } else if (coin.rsi14 > 75) {
    score -= 1;
    tags.push({ label: `RSI Quá Mua (${coin.rsi14})`, type: 'rose' });
    breakdown.push({ category: 'KỸ THUẬT', item: `RSI Quá Mua > 75 (Rủi ro Fomo)`, pts: -1 });
  }

  // Price Change 24h Sweet Spot (2% to 10% = active but not overextended)
  if (coin.priceChange24h >= 2 && coin.priceChange24h <= 10) {
    score += 1;
    tags.push({ label: `24h +${coin.priceChange24h.toFixed(1)}%`, type: 'emerald' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'Biến động 24h mượt mà (2% - 10%)', pts: 1 });
  } else if (coin.priceChange24h > 15) {
    score -= 1;
    tags.push({ label: `Pump Quá Đà (+${coin.priceChange24h.toFixed(1)}%)`, type: 'rose' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'Biến động 24h > 15% (Tránh Chase Pump)', pts: -1 });
  }

  // 4. MACRO CONTEXT BONUS (Max 2 pts)
  if (macroContext.isBtcBullish) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'BTC Trend Thuận Lợi', pts: 1 });
  }
  if (macroContext.isEtfInflow) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'Dòng tiền ETF Mua Ròng', pts: 1 });
  }

  // Final status classification (out of 20 points)
  let status = 'NEUTRAL';
  let statusColor = 'var(--text-slate-400)';
  if (score >= 12) {
    status = 'STRONG';
    statusColor = '#10b981'; // Emerald
  } else if (score >= 8) {
    status = 'GOOD';
    statusColor = '#f59e0b'; // Amber
  } else if (score < 5) {
    status = 'WEAK';
    statusColor = '#f43f5e'; // Rose
  }

  return {
    ...coin,
    score,
    status,
    statusColor,
    tags,
    breakdown,
  };
}

// ─── MAIN ORCHESTRATOR ─────────────────────────────────────────────────────────

const CACHE_KEY = 'crypto_scanner_top5_v3';

export async function runFullScan(macroContext = {}, forceRefresh = false) {
  // Check local cache if not forced
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Cache valid for 45 minutes
        if (Date.now() - parsed.timestamp < 45 * 60 * 1000) {
          console.log('[Scanner] Using cached scan results');
          return parsed;
        }
      }
    } catch {
      // Ignore cache error
    }
  }

  console.log('[Scanner] Starting 30-Day Volume Top 50 scan...');
  const [topPairs, futuresBookMap] = await Promise.all([
    getTop30dVolumePairs(50),
    getFuturesBookTickers(),
  ]);

  if (topPairs.length === 0) {
    console.error('[Scanner] Could not fetch top 30d volume pairs.');
    return { top5: [], scannedCount: 0, timestamp: Date.now() };
  }

  // Analyze coins concurrently in batches of 5
  const analyzedCoins = await mapConcurrent(topPairs, 5, pair => analyzeCoin(pair, futuresBookMap));
  const validCoins = analyzedCoins.filter(Boolean);

  // Score all valid coins
  const scoredCoins = validCoins.map(coin => scoreCoin(coin, macroContext));

  // Sort descending by score, then by 30d volume
  scoredCoins.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.vol30d - a.vol30d;
  });

  // Extract TOP 5
  const top5 = scoredCoins.slice(0, 5);

  const scanResult = {
    top5,
    scannedCount: scoredCoins.length,
    timestamp: Date.now(),
  };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(scanResult));
  } catch {
    // Ignore storage error
  }

  return scanResult;
}
