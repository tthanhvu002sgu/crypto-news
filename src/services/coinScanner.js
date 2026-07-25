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
 * Fetch Market Caps map (symbol -> marketCapUSD) via CoinGecko (fallback CoinCap)
 */
export async function getMarketCapMap() {
  const capMap = new Map();
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page: 1 },
      timeout: 4000,
    });
    if (Array.isArray(res.data)) {
      res.data.forEach(item => {
        if (item.symbol && item.market_cap) {
          capMap.set(item.symbol.toUpperCase(), item.market_cap);
        }
      });
      return capMap;
    }
  } catch {
    // Fallback to CoinCap
    try {
      const ccRes = await axios.get('https://api.coincap.io/v2/assets', {
        params: { limit: 250 },
        timeout: 4000,
      });
      if (ccRes.data && Array.isArray(ccRes.data.data)) {
        ccRes.data.data.forEach(item => {
          if (item.symbol && item.marketCapUsd) {
            capMap.set(item.symbol.toUpperCase(), parseFloat(item.marketCapUsd));
          }
        });
      }
    } catch (err) {
      console.warn('[Scanner] Could not fetch market caps:', err.message);
    }
  }
  return capMap;
}

/**
 * Fetch Binance Futures Funding Rates for all symbols (% per 8h)
 */
export async function getFundingRatesMap() {
  const fundingMap = new Map();
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 4000 });
    if (Array.isArray(res.data)) {
      res.data.forEach(item => {
        if (item.symbol && item.lastFundingRate != null) {
          // Funding rate percentage (e.g. 0.0001 -> 0.01%)
          fundingMap.set(item.symbol, parseFloat(item.lastFundingRate) * 100);
        }
      });
    }
  } catch (e) {
    console.warn('[Scanner] Could not fetch funding rates:', e.message);
  }
  return fundingMap;
}

/** 
 * Fetch Top 50 coins sorted by TRUE 30-DAY VOLUME with Volume Consistency Check (volCV)
 */
export async function getTop30dVolumePairs(marketCapMap, limit = 50) {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
    const candidates = res.data
      .filter(item => 
        item.symbol.endsWith('USDT') && 
        !EXCLUDED_SYMBOLS.has(item.symbol) &&
        parseFloat(item.quoteVolume) > 3000000 // Min $3M 24h volume
      )
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100);

    const fetch30dVol = async (item) => {
      try {
        const kRes = await axios.get('https://api.binance.com/api/v3/klines', {
          params: { symbol: item.symbol, interval: '1d', limit: 30 },
          timeout: 4000,
        });

        if (!kRes.data || kRes.data.length === 0) return null;

        const dailyVols = kRes.data.map(k => parseFloat(k[7]));
        const vol30d = dailyVols.reduce((sum, v) => sum + v, 0);
        const meanDailyVol = vol30d / (dailyVols.length || 1);
        
        // Coefficient of Variation (volCV = stdDev / mean)
        const variance = dailyVols.reduce((sum, v) => sum + Math.pow(v - meanDailyVol, 2), 0) / (dailyVols.length || 1);
        const stdDev = Math.sqrt(variance);
        const volCV = meanDailyVol > 0 ? stdDev / meanDailyVol : 1.5;

        const baseAsset = item.symbol.replace('USDT', '');
        const marketCap = marketCapMap.get(baseAsset) || null;

        return {
          symbol: item.symbol,
          baseAsset,
          price: parseFloat(item.lastPrice),
          priceChange24h: parseFloat(item.priceChangePercent),
          volume24h: parseFloat(item.quoteVolume),
          high24h: parseFloat(item.highPrice),
          low24h: parseFloat(item.lowPrice),
          vol30d: Math.round(vol30d),
          avgDailyVol30d: Math.round(meanDailyVol),
          volCV: Math.round(volCV * 100) / 100, // Round 2 decimals e.g. 0.45
          marketCap,
        };
      } catch {
        return null;
      }
    };

    const results = await mapConcurrent(candidates, 10, fetch30dVol);
    const validPairs = results.filter(Boolean);

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
          spreadPct: Math.round(spreadPct * 1000) / 1000,
        });
      }
    });
    return bookMap;
  } catch (e) {
    console.warn('[Scanner] Could not fetch futures book tickers:', e.message);
    return new Map();
  }
}

/** Analyze single coin indicators (Spot 4h + Spot 1d Multi-TF + Futures 4h CVD + Funding) */
async function analyzeCoin(pair, futuresBookMap, fundingMap) {
  try {
    // 1. Fetch Spot 4h klines (limit 150 for precise EMA 55 convergence)
    const spot4hRes = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: pair.symbol, interval: '4h', limit: 150 },
      timeout: 5000,
    });

    if (!spot4hRes.data || spot4hRes.data.length < 55) return null;

    const closes4h = spot4hRes.data.map(k => parseFloat(k[4]));
    const currentPrice = closes4h[closes4h.length - 1];

    const ema21 = calculateEMA(closes4h, 21);
    const ema55 = calculateEMA(closes4h, 55);
    const rsi14 = calculateRSI(closes4h, 14);

    // 2. Fetch Spot Daily klines (limit 60) for Multi-Timeframe Daily Trend
    let dailyEma21 = null;
    let dailyEma55 = null;
    let isDailyUptrend = false;
    try {
      const spot1dRes = await axios.get('https://api.binance.com/api/v3/klines', {
        params: { symbol: pair.symbol, interval: '1d', limit: 60 },
        timeout: 4000,
      });
      if (spot1dRes.data && spot1dRes.data.length >= 55) {
        const closes1d = spot1dRes.data.map(k => parseFloat(k[4]));
        dailyEma21 = calculateEMA(closes1d, 21);
        dailyEma55 = calculateEMA(closes1d, 55);
        if (dailyEma21 && dailyEma55) {
          isDailyUptrend = dailyEma21 > dailyEma55;
        }
      }
    } catch {
      // ignore daily failure
    }

    const avgDailyVol = pair.avgDailyVol30d || (pair.volume24h || 1);
    const volSurgeRatio = pair.volume24h > 0 ? (pair.volume24h / avgDailyVol) : 1;

    // 3. Fetch Futures 4h klines for CVD (18 nến: 6 nến = exact 24h)
    let cvd24h = 0;
    let cvdTrend = 0;
    let takerBuyRatio = 50;
    let hasFutures = false;
    let spreadPct = null;
    let fundingRate = fundingMap.has(pair.symbol) ? fundingMap.get(pair.symbol) : null;

    if (futuresBookMap && futuresBookMap.has(pair.symbol)) {
      hasFutures = true;
      spreadPct = futuresBookMap.get(pair.symbol).spreadPct;
    }

    try {
      const futRes = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
        params: { symbol: pair.symbol, interval: '4h', limit: 18 },
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
          deltas.push(delta);
        });

        // CVD 24h = sum of last 6 candles (6 * 4h = 24h)
        const recent24hDeltas = deltas.slice(-6);
        cvd24h = recent24hDeltas.reduce((a, b) => a + b, 0);

        takerBuyRatio = totalQuote > 0 ? Math.round((totalBuyQuote / totalQuote) * 100) : 50;

        // CVD trend: recent 24h (last 6 candles) vs previous 24h (preceding 6 candles)
        if (deltas.length >= 12) {
          const prev24hDeltas = deltas.slice(-12, -6);
          const prev24hSum = prev24hDeltas.reduce((a, b) => a + b, 0);
          cvdTrend = cvd24h - prev24hSum;
        }
      }
    } catch {
      // keep default values
    }

    return {
      ...pair,
      currentPrice,
      ema21: ema21 ? Math.round(ema21 * 10000) / 10000 : null,
      ema55: ema55 ? Math.round(ema55 * 10000) / 10000 : null,
      dailyEma21: dailyEma21 ? Math.round(dailyEma21 * 10000) / 10000 : null,
      dailyEma55: dailyEma55 ? Math.round(dailyEma55 * 10000) / 10000 : null,
      isDailyUptrend,
      rsi14,
      volSurgeRatio: Math.round(volSurgeRatio * 10) / 10,
      cvd24h: Math.round(cvd24h),
      cvdTrend: Math.round(cvdTrend),
      takerBuyRatio,
      hasFutures,
      spreadPct,
      fundingRate: fundingRate !== null ? Math.round(fundingRate * 10000) / 10000 : null,
    };
  } catch (e) {
    console.warn(`[Scanner] Skipping ${pair.symbol}:`, e.message);
    return null;
  }
}

// ─── BUY / LONG SCORING ENGINE (MAX 25 POINTS) ─────────────────────────────────

export function scoreCoinBuy(coin, macroContext = {}) {
  let score = 0;
  const tags = [];
  const breakdown = [];

  // 1. NHÂN — 30D Volume, Market Cap, Vol Consistency & Spread (Max 8 pts)
  if (coin.vol30d >= 1000000000) {
    score += 2;
    tags.push({ label: 'Vol 30D Khủng (>$1B)', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Thanh khoản 30 ngày cực cao (>$1B)', pts: 2 });
  } else if (coin.vol30d >= 300000000) {
    score += 1;
    tags.push({ label: 'Vol 30D Bền', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Thanh khoản 30 ngày ổn định (>$300M)', pts: 1 });
  }

  // Market Cap
  if (coin.marketCap >= 1000000000) {
    score += 2;
    tags.push({ label: 'Cap Large (>$1B)', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Vốn hóa lớn (>$1B)', pts: 2 });
  } else if (coin.marketCap >= 200000000) {
    score += 1;
    tags.push({ label: 'Cap Mid (>$200M)', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Vốn hóa vừa (>$200M)', pts: 1 });
  }

  // Volume Consistency (volCV)
  if (coin.volCV <= 0.6) {
    score += 2;
    tags.push({ label: `Vol CV ${coin.volCV} (Đều)`, type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: `Volume 30D phân bổ rất đều (CV ${coin.volCV})`, pts: 2 });
  } else if (coin.volCV <= 0.9) {
    score += 1;
    breakdown.push({ category: 'NHÂN', item: `Volume 30D khá ổn định (CV ${coin.volCV})`, pts: 1 });
  } else if (coin.volCV > 1.2) {
    score -= 2;
    tags.push({ label: `Vol CV ${coin.volCV} ⚠️ (Pump Ảo)`, type: 'rose' });
    breakdown.push({ category: 'NHÂN', item: `Volume bất ổn định, rủi ro pump ảo (CV ${coin.volCV})`, pts: -2 });
  }

  // Spread Futures
  if (coin.spreadPct !== null) {
    if (coin.spreadPct <= 0.03) {
      score += 2;
      tags.push({ label: `Spread ${coin.spreadPct.toFixed(3)}% ⚡`, type: 'emerald' });
      breakdown.push({ category: 'NHÂN', item: `Spread cực mỏng (${coin.spreadPct.toFixed(3)}%)`, pts: 2 });
    } else if (coin.spreadPct <= 0.08) {
      score += 1;
      tags.push({ label: `Spread ${coin.spreadPct.toFixed(2)}%`, type: 'emerald' });
      breakdown.push({ category: 'NHÂN', item: `Spread mỏng (${coin.spreadPct.toFixed(2)}%)`, pts: 1 });
    } else if (coin.spreadPct > 0.15) {
      score -= 2;
      tags.push({ label: `Spread Rộng (${coin.spreadPct.toFixed(2)}%)`, type: 'rose' });
      breakdown.push({ category: 'NHÂN', item: `Spread rộng >0.15% (Trượt giá)`, pts: -2 });
    }
  }

  // 2. DUYÊN — Money Flow / CVD / Funding Rate (Max 8 pts)
  if (coin.cvd24h > 0) {
    score += 2;
    tags.push({ label: 'CVD Mua Ròng', type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Mua Ròng', pts: 2 });
  } else if (coin.cvd24h < 0) {
    score -= 2;
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Bán Ròng', pts: -2 });
  }

  if (coin.cvdTrend > 0) {
    score += 1;
    tags.push({ label: 'CVD Momentum ↑', type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: 'Lực CVD đang tăng tốc', pts: 1 });
  }

  if (coin.takerBuyRatio >= 60) {
    score += 2;
    tags.push({ label: `Phe Mua ${coin.takerBuyRatio}%`, type: 'emerald' });
    breakdown.push({ category: 'DUYÊN', item: `Phe Mua áp đảo (${coin.takerBuyRatio}%)`, pts: 2 });
  } else if (coin.takerBuyRatio >= 53) {
    score += 1;
    breakdown.push({ category: 'DUYÊN', item: `Phe Mua chiếm ưu thế (${coin.takerBuyRatio}%)`, pts: 1 });
  }

  // Funding Rate Check (Tránh Crowded Trade)
  if (coin.fundingRate !== null) {
    if (coin.fundingRate < -0.02) {
      score += 2;
      tags.push({ label: `Funding ${coin.fundingRate}% ⚡ (Short Squeeze)`, type: 'emerald' });
      breakdown.push({ category: 'DUYÊN', item: `Funding âm (${coin.fundingRate}%), tiềm năng Short Squeeze`, pts: 2 });
    } else if (Math.abs(coin.fundingRate) <= 0.01) {
      score += 1;
      tags.push({ label: `Funding Ổn (${coin.fundingRate}%)`, type: 'emerald' });
      breakdown.push({ category: 'DUYÊN', item: `Funding Rate cân bằng, không bị crowded (${coin.fundingRate}%)`, pts: 1 });
    } else if (coin.fundingRate > 0.04) {
      score -= 2;
      tags.push({ label: `Funding Cao (${coin.fundingRate}%) ⚠️`, type: 'rose' });
      breakdown.push({ category: 'DUYÊN', item: `Funding quá cao (${coin.fundingRate}%), rủi ro Long Squeeze`, pts: -2 });
    }
  }

  if (coin.volSurgeRatio >= 1.5) {
    score += 1;
    tags.push({ label: `Vol Surge ${coin.volSurgeRatio}x`, type: 'amber' });
  }

  // 3. KỸ THUẬT — Multi-Timeframe Trend & Indicators (Max 7 pts)
  const is4hUptrend = coin.ema21 && coin.ema55 && coin.ema21 > coin.ema55;
  if (is4hUptrend) {
    score += 2;
    tags.push({ label: 'EMA 4h Uptrend', type: 'emerald' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 > EMA 55 (4h Uptrend)', pts: 2 });
  } else {
    score -= 2;
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 < EMA 55 (4h Downtrend)', pts: -2 });
  }

  // Multi-TF Confirmation (Daily)
  if (is4hUptrend && coin.isDailyUptrend) {
    score += 2;
    tags.push({ label: 'Multi-TF Uptrend ✓', type: 'emerald' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'Khung 4h + Daily đồng thuận Uptrend', pts: 2 });
  }

  // Distance to EMA 21 (vùng pullback)
  if (coin.ema21 && coin.currentPrice) {
    const distPct = ((coin.currentPrice - coin.ema21) / coin.ema21) * 100;
    if (distPct >= -1 && distPct <= 3) {
      score += 2;
      tags.push({ label: `Vùng Pullback EMA21`, type: 'cyan' });
      breakdown.push({ category: 'KỸ THUẬT', item: `Giá sát EMA21 4h (${distPct.toFixed(1)}%), entry mượt`, pts: 2 });
    } else if (distPct > 7) {
      score -= 1;
      tags.push({ label: `Cách Xa EMA21 (+${distPct.toFixed(1)}%)`, type: 'rose' });
      breakdown.push({ category: 'KỸ THUẬT', item: `Giá quá xa EMA21 4h (Rủi ro đu đỉnh ngắn)`, pts: -1 });
    }
  }

  // RSI 14 Sweet Spot
  if (coin.rsi14 >= 40 && coin.rsi14 <= 60) {
    score += 1;
    tags.push({ label: `RSI Sweet Spot (${coin.rsi14})`, type: 'cyan' });
  } else if (coin.rsi14 > 75) {
    score -= 2;
    tags.push({ label: `RSI Overbought (${coin.rsi14})`, type: 'rose' });
  }

  // 4. MACRO CONTEXT BONUS (Max 2 pts)
  if (macroContext.isBtcBullish) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'BTC 24h Tăng Trưởng', pts: 1 });
  }
  if (macroContext.isEtfInflow) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'ETF Spot Mua Ròng', pts: 1 });
  }

  score = Math.max(0, score);

  let status = 'NEUTRAL';
  let statusColor = 'var(--text-slate-400)';
  if (score >= 16) {
    status = 'STRONG BUY';
    statusColor = '#10b981'; // Emerald
  } else if (score >= 11) {
    status = 'GOOD BUY';
    statusColor = '#f59e0b'; // Amber
  } else {
    status = 'WEAK';
    statusColor = '#64748b'; // Slate
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

// ─── SELL / SHORT SCORING ENGINE (MAX 25 POINTS) ────────────────────────────────

export function scoreCoinSell(coin, macroContext = {}) {
  let score = 0;
  const tags = [];
  const breakdown = [];

  const takerSellRatio = 100 - coin.takerBuyRatio;

  // 1. NHÂN — 30D Volume, Market Cap, Vol Consistency & Spread (Max 8 pts)
  if (coin.vol30d >= 1000000000) {
    score += 2;
    tags.push({ label: 'Vol 30D Khủng (>$1B)', type: 'emerald' });
    breakdown.push({ category: 'NHÂN', item: 'Thanh khoản 30 ngày lớn (Dễ khớp Short)', pts: 2 });
  } else if (coin.vol30d >= 300000000) {
    score += 1;
    tags.push({ label: 'Vol 30D Bền', type: 'emerald' });
  }

  if (coin.marketCap >= 200000000) {
    score += 1;
    tags.push({ label: 'Cap Mid/Large', type: 'emerald' });
  }

  if (coin.volCV <= 0.6) {
    score += 2;
    tags.push({ label: `Vol CV ${coin.volCV} (Đều)`, type: 'emerald' });
  } else if (coin.volCV > 1.2) {
    score -= 2;
    tags.push({ label: `Vol CV ${coin.volCV} ⚠️`, type: 'rose' });
  }

  if (coin.spreadPct !== null) {
    if (coin.spreadPct <= 0.03) {
      score += 2;
      tags.push({ label: `Spread ${coin.spreadPct.toFixed(3)}% ⚡`, type: 'emerald' });
    } else if (coin.spreadPct > 0.15) {
      score -= 2;
      tags.push({ label: `Spread Rộng (${coin.spreadPct.toFixed(2)}%)`, type: 'rose' });
    }
  }

  // 2. DUYÊN — Money Outflow / CVD / Funding Rate (Max 8 pts)
  if (coin.cvd24h < 0) {
    score += 2;
    tags.push({ label: 'CVD Bán Ròng', type: 'rose' });
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Bán Ròng (Xả hàng)', pts: 2 });
  } else if (coin.cvd24h > 0) {
    score -= 2;
    breakdown.push({ category: 'DUYÊN', item: 'CVD 24h Mua Ròng', pts: -2 });
  }

  if (coin.cvdTrend < 0) {
    score += 1;
    tags.push({ label: 'CVD Momentum ↓', type: 'rose' });
    breakdown.push({ category: 'DUYÊN', item: 'Lực bán CVD đang tăng tốc', pts: 1 });
  }

  if (takerSellRatio >= 60) {
    score += 2;
    tags.push({ label: `Phe Bán ${takerSellRatio}%`, type: 'rose' });
    breakdown.push({ category: 'DUYÊN', item: `Phe Bán áp đảo (${takerSellRatio}%)`, pts: 2 });
  } else if (takerSellRatio >= 53) {
    score += 1;
    breakdown.push({ category: 'DUYÊN', item: `Phe Bán chiếm ưu thế (${takerSellRatio}%)`, pts: 1 });
  }

  // Funding Rate Check for Short (Tránh Short Squeeze)
  if (coin.fundingRate !== null) {
    if (coin.fundingRate > 0.04) {
      score += 2;
      tags.push({ label: `Funding ${coin.fundingRate}% ⚡ (Long Squeeze)`, type: 'rose' });
      breakdown.push({ category: 'DUYÊN', item: `Funding quá dương (${coin.fundingRate}%), tiềm năng Long Squeeze Dump`, pts: 2 });
    } else if (Math.abs(coin.fundingRate) <= 0.01) {
      score += 1;
      tags.push({ label: `Funding Ổn (${coin.fundingRate}%)`, type: 'emerald' });
    } else if (coin.fundingRate < -0.03) {
      score -= 2;
      tags.push({ label: `Funding Âm (${coin.fundingRate}%) ⚠️`, type: 'rose' });
      breakdown.push({ category: 'DUYÊN', item: `Funding âm nặng (${coin.fundingRate}%), rủi ro Short Squeeze`, pts: -2 });
    }
  }

  // 3. KỸ THUẬT — Downtrend & Overbought Rejection (Max 7 pts)
  const is4hDowntrend = coin.ema21 && coin.ema55 && coin.ema21 < coin.ema55;
  if (is4hDowntrend) {
    score += 2;
    tags.push({ label: 'EMA 4h Downtrend', type: 'rose' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 < EMA 55 (4h Downtrend)', pts: 2 });
  } else {
    score -= 2;
    breakdown.push({ category: 'KỸ THUẬT', item: 'EMA 21 > EMA 55 (4h Uptrend)', pts: -2 });
  }

  // Multi-TF Bearish Confirmation (Daily)
  if (is4hDowntrend && !coin.isDailyUptrend) {
    score += 2;
    tags.push({ label: 'Multi-TF Downtrend ✓', type: 'rose' });
    breakdown.push({ category: 'KỸ THUẬT', item: 'Khung 4h + Daily đồng thuận Downtrend', pts: 2 });
  }

  // Distance to EMA 21 (kháng cự 4h)
  if (coin.ema21 && coin.currentPrice) {
    const distPct = ((coin.currentPrice - coin.ema21) / coin.ema21) * 100;
    if (distPct >= -3 && distPct <= 1) {
      score += 2;
      tags.push({ label: `Kháng cự EMA21`, type: 'cyan' });
      breakdown.push({ category: 'KỸ THUẬT', item: `Giá chạm kháng cự EMA21 4h (${distPct.toFixed(1)}%)`, pts: 2 });
    }
  }

  // RSI Overbought rejection or Dead-cat bounce zone
  if (coin.rsi14 >= 60 && coin.rsi14 <= 75) {
    score += 2;
    tags.push({ label: `RSI Test Kháng Cự (${coin.rsi14})`, type: 'cyan' });
  } else if (coin.rsi14 < 30) {
    score -= 2;
    tags.push({ label: `RSI Oversold (${coin.rsi14})`, type: 'rose' });
  }

  // 4. MACRO CONTEXT BONUS (Max 2 pts)
  if (!macroContext.isBtcBullish) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'BTC 24h Giảm Giá (Giúp phe Short)', pts: 1 });
  }
  if (!macroContext.isEtfInflow) {
    score += 1;
    breakdown.push({ category: 'MACRO', item: 'ETF Rút Vốn', pts: 1 });
  }

  score = Math.max(0, score);

  let status = 'NEUTRAL';
  let statusColor = 'var(--text-slate-400)';
  if (score >= 16) {
    status = 'STRONG SHORT';
    statusColor = '#f43f5e'; // Rose
  } else if (score >= 11) {
    status = 'GOOD SHORT';
    statusColor = '#fb923c'; // Orange
  } else {
    status = 'WEAK';
    statusColor = '#64748b'; // Slate
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

const CACHE_KEY = 'crypto_scanner_v4_buy_sell';

export async function runFullScan(macroContext = {}, forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
          console.log('[Scanner] Using cached dual-direction scan results');
          return parsed;
        }
      }
    } catch {
      // ignore cache error
    }
  }

  console.log('[Scanner] Starting 30-Day Volume Top 50 scan with VolCV, Funding & Multi-TF...');

  // Fetch Market Caps & Funding Rates concurrently
  const [marketCapMap, fundingMap, futuresBookMap] = await Promise.all([
    getMarketCapMap(),
    getFundingRatesMap(),
    getFuturesBookTickers(),
  ]);

  const topPairs = await getTop30dVolumePairs(marketCapMap, 50);

  if (topPairs.length === 0) {
    console.error('[Scanner] Could not fetch top 30d volume pairs.');
    return { topBuy: [], topSell: [], scannedCount: 0, timestamp: Date.now() };
  }

  // Analyze coins in batches of 5
  const analyzedCoins = await mapConcurrent(topPairs, 5, pair => 
    analyzeCoin(pair, futuresBookMap, fundingMap)
  );
  const validCoins = analyzedCoins.filter(Boolean);

  // ─── APPLY HARD QUALITY FILTERS (STRICT GATE) ──────────────────────────────
  const qualifiedCoins = validCoins.filter(coin => {
    // 1. Phải có Binance Futures
    if (!coin.hasFutures) return false;
    // 2. Vol 30D tối thiểu $100M USD
    if (coin.vol30d < 100_000_000) return false;
    // 3. Market Cap tối thiểu $100M (nếu có dữ liệu MCap)
    if (coin.marketCap && coin.marketCap < 100_000_000) return false;
    // 4. Futures Spread mỏng <= 0.15% (Chống trượt giá)
    if (coin.spreadPct !== null && coin.spreadPct > 0.15) return false;
    // 5. VolCV <= 1.3 (Loại bỏ coin bị pump ảo 1-2 ngày)
    if (coin.volCV > 1.3) return false;
    return true;
  });

  // ─── SCORE BUY (LONG) CANDIDATES ───────────────────────────────────────────
  const scoredBuy = qualifiedCoins
    .map(coin => scoreCoinBuy(coin, macroContext))
    .filter(coin => coin.score >= 10); // Minimum score quality filter (>= 10/25)

  scoredBuy.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.vol30d - a.vol30d;
  });

  const topBuy = scoredBuy.slice(0, 5); // Return up to top 5 (only those that passed filter)

  // ─── SCORE SELL (SHORT) CANDIDATES ──────────────────────────────────────────
  const scoredSell = qualifiedCoins
    .map(coin => scoreCoinSell(coin, macroContext))
    .filter(coin => coin.score >= 10); // Minimum score quality filter (>= 10/25)

  scoredSell.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.vol30d - a.vol30d;
  });

  const topSell = scoredSell.slice(0, 5);

  const scanResult = {
    topBuy,
    topSell,
    scannedCount: validCoins.length,
    qualifiedCount: qualifiedCoins.length,
    timestamp: Date.now(),
  };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(scanResult));
  } catch {
    // ignore storage error
  }

  return scanResult;
}
