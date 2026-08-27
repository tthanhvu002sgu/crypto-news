import axios from 'axios';

const ALGORITHM_VERSION = 'v7';
const RESULT_CACHE_TTL = 5 * 60 * 1000;
const UNIVERSE_CACHE_TTL = 4 * 60 * 60 * 1000;
const RESULT_CACHE_KEY = `crypto_scanner_${ALGORITHM_VERSION}_results`;
const UNIVERSE_CACHE_KEY = `crypto_scanner_${ALGORITHM_VERSION}_universe`;

const EXCLUDED_SYMBOLS = new Set([
  'USDTUSDC', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDCUSDT', 'DAIUSDT',
  'WBTCUSDT', 'WETHUSDT', 'WEETHUSDT', 'WBETHUSDT', 'BTCUSDT', 'ETHUSDT',
]);

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const number = (value, fallback = null) => finite(value) ? Number(value) : fallback;
const round = (value, digits = 2) => finite(value)
  ? Math.round(Number(value) * (10 ** digits)) / (10 ** digits)
  : null;
const sum = values => values.reduce((total, value) => total + (number(value, 0) || 0), 0);
const average = values => values.length ? sum(values) / values.length : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function storageGet(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // LocalStorage failure must never block a scan.
  }
}

export function calculateEMA(data, period) {
  if (!Array.isArray(data) || data.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = average(data.slice(0, period));
  for (let i = period; i < data.length; i += 1) {
    ema = data[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

export function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return round(100 - (100 / (1 + avgGain / avgLoss)), 1);
}

export function calculateATR(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length <= period) return null;
  const trueRanges = [];
  for (let i = 1; i < klines.length; i += 1) {
    const high = number(klines[i][2], 0);
    const low = number(klines[i][3], 0);
    const previousClose = number(klines[i - 1][4], 0);
    trueRanges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return average(trueRanges.slice(-period));
}

function closedKlines(klines, now = Date.now()) {
  return (Array.isArray(klines) ? klines : []).filter(kline => number(kline?.[6], Infinity) <= now);
}

function pctReturn(closes, hours) {
  if (!Array.isArray(closes) || closes.length <= hours) return null;
  const current = closes.at(-1);
  const baseline = closes.at(-(hours + 1));
  return baseline > 0 ? ((current / baseline) - 1) * 100 : null;
}

function zScore(value, sample) {
  if (!finite(value) || !Array.isArray(sample) || sample.length < 12) return null;
  const mean = average(sample);
  const variance = average(sample.map(item => (item - mean) ** 2));
  const deviation = Math.sqrt(variance || 0);
  return deviation > 0 ? (value - mean) / deviation : 0;
}

/** Normalized taker flow for one exact window of closed Binance klines. */
export function calculateKlineFlowStats(klines, windowSize = 24, offset = 0) {
  const end = klines.length - offset;
  const start = end - windowSize;
  if (start < 0 || end <= 0) return null;
  const window = klines.slice(start, end);
  const quoteVolume = sum(window.map(kline => number(kline[7], 0)));
  const takerBuyQuote = sum(window.map(kline => number(kline[10], 0)));
  if (quoteVolume <= 0) return null;
  const cvd = (2 * takerBuyQuote) - quoteVolume;
  return {
    cvd,
    cvdRatio: cvd / quoteVolume,
    quoteVolume,
    takerBuyRatio: (takerBuyQuote / quoteVolume) * 100,
  };
}

async function mapConcurrent(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

export async function getMarketCapMap() {
  const capMap = new Map();
  const addFirst = (symbol, marketCap) => {
    const key = String(symbol || '').toUpperCase();
    const cap = number(marketCap);
    if (key && cap > 0 && !capMap.has(key)) capMap.set(key, cap);
  };

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page: 1 },
      timeout: 5000,
    });
    (response.data || []).forEach(item => addFirst(item.symbol, item.market_cap));
    if (capMap.size) return capMap;
  } catch {
    // Continue with secondary provider.
  }

  try {
    const response = await axios.get('https://api.coincap.io/v2/assets', {
      params: { limit: 250 },
      timeout: 5000,
    });
    (response.data?.data || []).forEach(item => addFirst(item.symbol, item.marketCapUsd));
  } catch (error) {
    console.warn('[Scanner] Market-cap providers unavailable:', error.message);
  }
  return capMap;
}

export async function getFundingRatesMap() {
  const fundingMap = new Map();
  try {
    const response = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 5000 });
    (response.data || []).forEach(item => {
      const markPrice = number(item.markPrice);
      const indexPrice = number(item.indexPrice);
      fundingMap.set(item.symbol, {
        fundingRate: round(number(item.lastFundingRate, 0) * 100, 6),
        basisPct: markPrice > 0 && indexPrice > 0 ? ((markPrice / indexPrice) - 1) * 100 : null,
      });
    });
  } catch (error) {
    console.warn('[Scanner] Funding/basis unavailable:', error.message);
  }
  return fundingMap;
}

export async function getFuturesBookTickers() {
  const bookMap = new Map();
  try {
    const response = await axios.get('https://fapi.binance.com/fapi/v1/ticker/bookTicker', { timeout: 5000 });
    (response.data || []).forEach(item => {
      const bid = number(item.bidPrice);
      const ask = number(item.askPrice);
      if (bid > 0 && ask > 0) {
        bookMap.set(item.symbol, {
          bidPrice: bid,
          askPrice: ask,
          spreadPct: ((ask - bid) / ask) * 100,
        });
      }
    });
  } catch (error) {
    console.warn('[Scanner] Futures book unavailable:', error.message);
  }
  return bookMap;
}

async function fetchUniverseMetric(symbol) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval: '1d', limit: 31 },
      timeout: 5000,
    });
    const completed = closedKlines(response.data).slice(-30);
    if (completed.length < 25) return null;
    const dailyVolumes = completed.map(kline => number(kline[7], 0));
    const vol30d = sum(dailyVolumes);
    const avgDailyVol30d = average(dailyVolumes);
    const variance = average(dailyVolumes.map(value => (value - avgDailyVol30d) ** 2));
    return {
      vol30d: Math.round(vol30d),
      avgDailyVol30d: Math.round(avgDailyVol30d),
      volCV: round(avgDailyVol30d > 0 ? Math.sqrt(variance) / avgDailyVol30d : 99, 2),
    };
  } catch {
    return null;
  }
}

/**
 * Builds universe by preserving explicit quotas:
 * - 30 Core Liquidity pairs (top 24h volume)
 * - 10 Top Positive Momentum pairs (top 24h gainers)
 * - 10 Top Negative Momentum pairs (top 24h losers)
 * Deduplicates and preserves all quota candidates without losing momentum coins to final sort.
 */
export async function getTop30dVolumePairs(marketCapMap, limit = 50) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
    const liquidPairs = (response.data || [])
      .filter(item => item.symbol.endsWith('USDT')
        && !EXCLUDED_SYMBOLS.has(item.symbol)
        && number(item.quoteVolume, 0) >= 3_000_000);

    if (liquidPairs.length === 0) return [];

    // Quotas: 30 Core liquid + 10 Top gainers + 10 Top losers
    const coreLiquid = [...liquidPairs]
      .sort((a, b) => number(b.quoteVolume, 0) - number(a.quoteVolume, 0))
      .slice(0, 30);

    const topGainers = [...liquidPairs]
      .sort((a, b) => number(b.priceChangePercent, 0) - number(a.priceChangePercent, 0))
      .slice(0, 10);

    const topLosers = [...liquidPairs]
      .sort((a, b) => number(a.priceChangePercent, 0) - number(b.priceChangePercent, 0))
      .slice(0, 10);

    const candidateMap = new Map();
    [...coreLiquid, ...topGainers, ...topLosers].forEach(item => {
      if (!candidateMap.has(item.symbol)) {
        candidateMap.set(item.symbol, item);
      }
    });

    const candidates = [...candidateMap.values()].slice(0, limit);

    const cached = storageGet(UNIVERSE_CACHE_KEY);
    const cacheFresh = cached && Date.now() - cached.timestamp < UNIVERSE_CACHE_TTL;
    const cachedMetrics = cacheFresh ? new Map(cached.metrics.map(item => [item.symbol, item])) : new Map();

    const missing = candidates.filter(item => !cachedMetrics.has(item.symbol));
    const fetched = await mapConcurrent(missing, 8, item => fetchUniverseMetric(item.symbol));
    fetched.forEach((metric, index) => {
      if (metric) cachedMetrics.set(missing[index].symbol, { symbol: missing[index].symbol, ...metric });
    });
    storageSet(UNIVERSE_CACHE_KEY, { timestamp: Date.now(), metrics: [...cachedMetrics.values()] });

    // Map each candidate while preserving momentum membership
    return candidates.map(item => {
      const metric = cachedMetrics.get(item.symbol);
      if (!metric) return null;
      const baseAsset = item.symbol.slice(0, -4);
      return {
        symbol: item.symbol,
        baseAsset,
        price: number(item.lastPrice, 0),
        priceChange24h: number(item.priceChangePercent, 0),
        volume24h: number(item.quoteVolume, 0),
        high24h: number(item.highPrice, 0),
        low24h: number(item.lowPrice, 0),
        marketCap: marketCapMap.get(baseAsset) ?? null,
        vol30d: metric.vol30d,
        avgDailyVol30d: metric.avgDailyVol30d,
        volCV: metric.volCV,
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('[Scanner] Universe fetch failed:', error.message);
    return [];
  }
}

async function getBenchmarkReturns() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: 'BTCUSDT', interval: '1h', limit: 30 },
      timeout: 5000,
    });
    const closes = closedKlines(response.data).map(kline => number(kline[4], 0));
    return { h1: pctReturn(closes, 1), h4: pctReturn(closes, 4), h24: pctReturn(closes, 24) };
  } catch {
    return { h1: null, h4: null, h24: null };
  }
}

async function optionalGet(url, config) {
  try {
    const response = await axios.get(url, config);
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Pure closed-candle Price Action context detector (No lookahead).
 * Evaluates 4H Structure, Price Position, Breakout Quality, and Volatility State.
 */
export function detectPriceActionContext(closes4h, closes1h, spot1h, ema21, ema55, emaSlopePct, breakoutAtr, breakdownAtr, atr1h, volumeZ1h) {
  // 1. Structure 4H
  let structure4h = 'UNCLEAR';
  if (ema21 && ema55) {
    const emaDiffPct = Math.abs(ema21 - ema55) / ema55;
    const slope = emaSlopePct || 0;
    if (emaDiffPct < 0.004 || (Math.abs(slope) < 0.2 && emaDiffPct < 0.008)) {
      structure4h = 'RANGE';
    } else if (ema21 > ema55 && slope > -0.1) {
      structure4h = 'UPTREND';
    } else if (ema21 < ema55 && slope < 0.1) {
      structure4h = 'DOWNTREND';
    } else {
      structure4h = 'RANGE';
    }
  }

  // 2. Price Position relative to range & EMA
  let pricePosition = 'IN_RANGE';
  const currentPrice = closes1h?.at(-1) || closes4h?.at(-1) || 0;
  const distanceToEmaPct = ema21 > 0 ? ((currentPrice / ema21) - 1) * 100 : 0;

  if (Math.abs(distanceToEmaPct) > 7.0) {
    pricePosition = 'EXTENDED';
  } else if ((breakoutAtr !== null && breakoutAtr > 0.25) || (breakdownAtr !== null && breakdownAtr > 0.25)) {
    pricePosition = 'BREAKOUT';
  } else if (breakoutAtr !== null && breakoutAtr >= -0.5 && breakoutAtr <= 0.25) {
    pricePosition = 'NEAR_RANGE_HIGH';
  } else if (breakdownAtr !== null && breakdownAtr >= -0.5 && breakdownAtr <= 0.25) {
    pricePosition = 'NEAR_RANGE_LOW';
  }

  // 3. Breakout Quality
  let breakoutQuality = 'NONE';
  if (pricePosition === 'BREAKOUT' && Array.isArray(spot1h) && spot1h.length >= 2) {
    const lastCandle = spot1h.at(-1);
    const candleOpen = number(lastCandle?.[1], 0);
    const candleHigh = number(lastCandle?.[2], 0);
    const candleLow = number(lastCandle?.[3], 0);
    const candleClose = number(lastCandle?.[4], 0);
    const candleRange = candleHigh - candleLow;
    const bodyRange = Math.abs(candleClose - candleOpen);

    if (candleRange > 0) {
      if (bodyRange / candleRange >= 0.55) {
        breakoutQuality = 'STRONG_CLOSE';
      } else {
        breakoutQuality = 'WICK_HEAVY_SWEEP';
      }
    }
  }

  // 4. Volatility State
  let volatilityState = 'NORMAL';
  if (volumeZ1h !== null) {
    if (volumeZ1h >= 1.5) {
      volatilityState = 'EXPANSION';
    } else if (volumeZ1h <= -0.8) {
      volatilityState = 'COMPRESSION';
    }
  }

  // 5. Generate concise summary statement (Tiếng Việt)
  const structText = structure4h === 'UPTREND' ? '4H uptrend'
    : structure4h === 'DOWNTREND' ? '4H downtrend'
    : structure4h === 'RANGE' ? '4H range đi ngang' : '4H cấu trúc chưa rõ';

  const posText = pricePosition === 'EXTENDED' ? 'giá đã kéo xa EMA21'
    : pricePosition === 'BREAKOUT' ? (breakoutQuality === 'STRONG_CLOSE' ? 'breakout nến đóng dứt khoát' : 'breakout quét râu')
    : pricePosition === 'NEAR_RANGE_HIGH' ? 'gần range high'
    : pricePosition === 'NEAR_RANGE_LOW' ? 'gần range low' : 'dao động trong range';

  const volText = volatilityState === 'EXPANSION' ? 'volume mở rộng'
    : volatilityState === 'COMPRESSION' ? 'biên độ nén chặt' : 'vol bình thường';

  const statement = `${structText} · ${posText} · ${volText}`;

  return {
    structure4h,
    pricePosition,
    breakoutQuality,
    volatilityState,
    statement,
  };
}

async function analyzeCoin(pair, futuresBookMap, fundingMap, benchmark) {
  try {
    const [spot4hRaw, spot1hRaw, dailyRaw, futures1hRaw, oiRaw] = await Promise.all([
      optionalGet('https://api.binance.com/api/v3/klines', {
        params: { symbol: pair.symbol, interval: '4h', limit: 150 }, timeout: 6000,
      }),
      optionalGet('https://api.binance.com/api/v3/klines', {
        params: { symbol: pair.symbol, interval: '1h', limit: 170 }, timeout: 6000,
      }),
      optionalGet('https://api.binance.com/api/v3/klines', {
        params: { symbol: pair.symbol, interval: '1d', limit: 61 }, timeout: 6000,
      }),
      optionalGet('https://fapi.binance.com/fapi/v1/klines', {
        params: { symbol: pair.symbol, interval: '1h', limit: 50 }, timeout: 6000,
      }),
      optionalGet('https://fapi.binance.com/futures/data/openInterestHist', {
        params: { symbol: pair.symbol, period: '1h', limit: 25 }, timeout: 6000,
      }),
    ]);

    const spot4h = closedKlines(spot4hRaw);
    const spot1h = closedKlines(spot1hRaw);
    const futures1h = closedKlines(futures1hRaw);
    if (spot4h.length < 60 || spot1h.length < 48 || futures1h.length < 48) return null;

    const closes4h = spot4h.map(kline => number(kline[4], 0));
    const closes1h = spot1h.map(kline => number(kline[4], 0));
    const ema21 = calculateEMA(closes4h, 21);
    const ema55 = calculateEMA(closes4h, 55);
    const previousEma21 = calculateEMA(closes4h.slice(0, -3), 21);
    const emaSlopePct = previousEma21 > 0 ? ((ema21 / previousEma21) - 1) * 100 : null;

    let dailyEma21 = null;
    let dailyEma55 = null;
    let isDailyUptrend = null;
    const daily = closedKlines(dailyRaw);
    if (daily.length >= 55) {
      const dailyCloses = daily.map(kline => number(kline[4], 0));
      dailyEma21 = calculateEMA(dailyCloses, 21);
      dailyEma55 = calculateEMA(dailyCloses, 55);
      isDailyUptrend = dailyEma21 > dailyEma55;
    }

    const spotFlow = calculateKlineFlowStats(spot1h, 24);
    const futuresFlow = calculateKlineFlowStats(futures1h, 24);
    const previousFuturesFlow = calculateKlineFlowStats(futures1h, 24, 24);
    if (!spotFlow || !futuresFlow || !previousFuturesFlow) return null;

    const recentVolume = number(spot1h.at(-1)?.[7], 0);
    const historicalVolumes = spot1h.slice(-169, -1).map(kline => number(kline[7], 0));
    const volumeZ1h = zScore(recentVolume, historicalVolumes);
    const atr1h = calculateATR(spot1h.slice(-40), 14);
    const previousRange = spot1h.slice(-21, -1);
    const priorHigh = Math.max(...previousRange.map(kline => number(kline[2], 0)));
    const priorLow = Math.min(...previousRange.map(kline => number(kline[3], 0)));
    const currentClose = closes1h.at(-1);
    const breakoutAtr = atr1h > 0 ? (currentClose - priorHigh) / atr1h : null;
    const breakdownAtr = atr1h > 0 ? (priorLow - currentClose) / atr1h : null;

    let oiChange4h = null;
    let oiChange24h = null;
    if (Array.isArray(oiRaw) && oiRaw.length >= 5) {
      const values = oiRaw.map(item => number(item.sumOpenInterest)).filter(finite);
      const latest = values.at(-1);
      const change = hours => values.length > hours && values.at(-(hours + 1)) > 0
        ? ((latest / values.at(-(hours + 1))) - 1) * 100
        : null;
      oiChange4h = change(4);
      oiChange24h = change(24);
    }

    const funding = fundingMap.get(pair.symbol) || {};
    const book = futuresBookMap.get(pair.symbol);
    const returns = {
      h1: pctReturn(closes1h, 1),
      h4: pctReturn(closes1h, 4),
      h24: pctReturn(closes1h, 24),
    };
    const relativeStrength = {
      h1: finite(benchmark.h1) ? returns.h1 - benchmark.h1 : null,
      h4: finite(benchmark.h4) ? returns.h4 - benchmark.h4 : null,
      h24: finite(benchmark.h24) ? returns.h24 - benchmark.h24 : null,
    };
    const availableOptional = [isDailyUptrend, oiChange4h, funding.fundingRate, funding.basisPct]
      .filter(value => value !== null && value !== undefined).length;

    const paContext = detectPriceActionContext(
      closes4h, closes1h, spot1h, ema21, ema55, emaSlopePct, breakoutAtr, breakdownAtr, atr1h, volumeZ1h,
    );

    return {
      ...pair,
      currentPrice: currentClose,
      ema21: round(ema21, 8),
      ema55: round(ema55, 8),
      emaSlopePct: round(emaSlopePct, 3),
      dailyEma21: round(dailyEma21, 8),
      dailyEma55: round(dailyEma55, 8),
      isDailyUptrend,
      rsi14: calculateRSI(closes4h, 14),
      return1h: round(returns.h1, 3),
      return4h: round(returns.h4, 3),
      return24h: round(returns.h24, 3),
      relativeStrength1h: round(relativeStrength.h1, 3),
      relativeStrength4h: round(relativeStrength.h4, 3),
      relativeStrength24h: round(relativeStrength.h24, 3),
      volumeZ1h: round(volumeZ1h, 2),
      breakoutAtr: round(breakoutAtr, 2),
      breakdownAtr: round(breakdownAtr, 2),
      cvd24h: Math.round(futuresFlow.cvd),
      futuresCvdRatio24h: round(futuresFlow.cvdRatio * 100, 3),
      spotCvd24h: Math.round(spotFlow.cvd),
      spotCvdRatio24h: round(spotFlow.cvdRatio * 100, 3),
      cvdTrendRatio: round((futuresFlow.cvdRatio - previousFuturesFlow.cvdRatio) * 100, 3),
      takerBuyRatio: round(futuresFlow.takerBuyRatio, 1),
      oiChange4h: round(oiChange4h, 2),
      oiChange24h: round(oiChange24h, 2),
      hasFutures: true,
      spreadPct: round(book?.spreadPct, 4),
      fundingRate: round(funding.fundingRate, 6),
      basisPct: round(funding.basisPct, 4),
      dataCoverage: round((5 + availableOptional) / 9, 2),
      paContext,
    };
  } catch (error) {
    console.warn(`[Scanner] Skipping ${pair.symbol}:`, error.message);
    return null;
  }
}

function addPoint(state, pillar, points, label, type = 'neutral') {
  state[pillar] = (state[pillar] || 0) + points;
  state.tags.push({ label, pts: points, type, pillar });
  state.breakdown.push({ category: pillar.toUpperCase(), item: label, pts: points });
}

function directionValue(direction, value) {
  return direction === 'BUY' ? value : -value;
}

/**
 * Pillar 1: Quality (Max 5.0)
 * Liquidity, spread, volume consistency, and data coverage.
 */
function scoreQuality(coin, state) {
  if (coin.vol30d >= 1_000_000_000) addPoint(state, 'quality', 1.25, 'Vol 30D > $1B', 'emerald');
  else if (coin.vol30d >= 300_000_000) addPoint(state, 'quality', 0.75, 'Vol 30D > $300M', 'emerald');

  if (coin.marketCap >= 2_000_000_000) addPoint(state, 'quality', 1.25, 'Large Cap (>$2B)', 'emerald');
  else if (coin.marketCap >= 1_000_000_000) addPoint(state, 'quality', 0.75, 'Mid Cap (>$1B)', 'emerald');

  if (coin.volCV <= 0.6) addPoint(state, 'quality', 1.0, `Vol CV thấp (${coin.volCV})`, 'emerald');
  else if (coin.volCV <= 0.9) addPoint(state, 'quality', 0.5, `Vol CV ổn định (${coin.volCV})`, 'cyan');

  if (coin.spreadPct <= 0.03) addPoint(state, 'quality', 0.75, `Spread rất hẹp (${coin.spreadPct}%)`, 'emerald');
  else if (coin.spreadPct <= 0.08) addPoint(state, 'quality', 0.5, `Spread chấp nhận (${coin.spreadPct}%)`, 'cyan');

  if (coin.dataCoverage >= 0.85) addPoint(state, 'quality', 0.75, 'Data coverage cao (≥85%)', 'emerald');
  else if (coin.dataCoverage >= 0.7) addPoint(state, 'quality', 0.5, 'Data coverage đủ', 'cyan');

  state.quality = clamp(state.quality, 0, 5.0);
}

/**
 * Pillar 2: Relative Strength vs BTC (Max 8.0)
 * Multi-horizon relative performance & breakout momentum vs BTC.
 */
function scoreRelativeStrength(coin, direction, state) {
  const sign = value => directionValue(direction, number(value, 0));
  const percentile = direction === 'BUY' ? coin.strengthPercentile : 100 - coin.strengthPercentile;

  if (percentile >= 85) addPoint(state, 'relativeStrength', 3.0, `RS vs BTC Top ${100 - Math.round(percentile)}%`, 'emerald');
  else if (percentile >= 70) addPoint(state, 'relativeStrength', 2.0, 'RS vs BTC mạnh', 'emerald');
  else if (percentile >= 55) addPoint(state, 'relativeStrength', 1.0, 'RS vs BTC khá', 'cyan');

  if (sign(coin.relativeStrength4h) > 0.4) addPoint(state, 'relativeStrength', 1.5, 'Outperform BTC 4H', 'emerald');
  if (sign(coin.relativeStrength24h) > 1.0) addPoint(state, 'relativeStrength', 1.5, 'Outperform BTC 24H', 'emerald');
  if (sign(coin.relativeStrength1h) > 0.2) addPoint(state, 'relativeStrength', 1.0, 'Outperform BTC 1H', 'cyan');

  const breakout = direction === 'BUY' ? coin.breakoutAtr : coin.breakdownAtr;
  if (breakout >= 0.25) addPoint(state, 'relativeStrength', 1.0, `Breakout ${breakout} ATR`, 'amber');

  state.relativeStrength = clamp(state.relativeStrength, 0, 8.0);
}

/**
 * Pillar 3: Flow (Max 6.0)
 * Spot/Futures taker flow agreement, CVD acceleration, and OI confirmation.
 */
function scoreFlow(coin, direction, state) {
  const sign = value => directionValue(direction, number(value, 0));

  if (sign(coin.futuresCvdRatio24h) >= 3.0) addPoint(state, 'flow', 2.0, 'Futures CVD xác nhận mạnh', 'emerald');
  else if (sign(coin.futuresCvdRatio24h) >= 1.0) addPoint(state, 'flow', 1.0, 'Futures CVD cùng chiều', 'cyan');

  if (sign(coin.spotCvdRatio24h) >= 1.0) addPoint(state, 'flow', 1.5, 'Spot CVD gom hàng xác nhận', 'emerald');
  if (sign(coin.cvdTrendRatio) > 0.5) addPoint(state, 'flow', 1.0, 'CVD đang tăng tốc', 'cyan');

  if (coin.oiChange4h !== null && sign(coin.return4h) > 0 && coin.oiChange4h > 1.0) {
    addPoint(state, 'flow', 1.5, `Price + OI tăng đồng thuận (+${coin.oiChange4h}%)`, 'emerald');
  }

  state.flow = clamp(state.flow, 0, 6.0);
}

/**
 * Pillar 4: Market Context & Crowding (Max 6.0)
 * 4H/1D Trend alignment, RSI sweet spot, macro context, and crowding penalties.
 */
function scoreMarketContext(coin, direction, state, macroContext = {}) {
  const sign = value => directionValue(direction, number(value, 0));

  const trend4h = coin.ema21 > coin.ema55 ? 1 : -1;
  if (directionValue(direction, trend4h) > 0) addPoint(state, 'marketContext', 1.5, 'EMA 4H cùng chiều', 'emerald');
  if (sign(coin.emaSlopePct) > 0) addPoint(state, 'marketContext', 0.5, 'EMA21 có độ dốc', 'cyan');

  if (coin.isDailyUptrend !== null && directionValue(direction, coin.isDailyUptrend ? 1 : -1) > 0) {
    addPoint(state, 'marketContext', 1.5, 'Daily Trend 1D xác nhận', 'emerald');
  }

  const rsiGood = direction === 'BUY'
    ? coin.rsi14 >= 42 && coin.rsi14 <= 68
    : coin.rsi14 >= 32 && coin.rsi14 <= 58;
  if (rsiGood) addPoint(state, 'marketContext', 1.0, `RSI vùng cân bằng (${coin.rsi14})`, 'cyan');

  if (typeof macroContext.isBtcBullish === 'boolean'
    && directionValue(direction, macroContext.isBtcBullish ? 1 : -1) > 0) {
    addPoint(state, 'marketContext', 0.75, 'BTC Macro regime cùng chiều', 'cyan');
  }
  if (typeof macroContext.isEtfInflow === 'boolean'
    && directionValue(direction, macroContext.isEtfInflow ? 1 : -1) > 0) {
    addPoint(state, 'marketContext', 0.75, 'ETF Inflow cùng chiều', 'cyan');
  }

  // Crowding / Extension Penalties
  const funding = sign(coin.fundingRate);
  const basis = sign(coin.basisPct);
  if (funding > 0.04 || basis > 0.25) {
    state.marketContext -= 1.0;
    state.breakdown.push({ category: 'MARKETCONTEXT', item: 'Vị thế quá crowded (Funding/Basis cao)', pts: -1.0 });
  }

  const distanceToEma = ((coin.currentPrice / coin.ema21) - 1) * 100;
  const directedDistance = directionValue(direction, distanceToEma);
  if (directedDistance > 8.0) {
    state.marketContext -= 1.0;
    state.breakdown.push({ category: 'MARKETCONTEXT', item: 'Giá đã quá xa EMA21 (>8%)', pts: -1.0 });
  }

  state.marketContext = clamp(state.marketContext, 0, 6.0);
}

/** Detects potential risks, crowding and data warnings */
function detectWarnings(coin, direction) {
  const warnings = [];
  const sign = value => directionValue(direction, number(value, 0));

  if (sign(coin.fundingRate) > 0.04) {
    warnings.push({ code: 'CROWDED_FUNDING', message: `Funding Rate cao (${coin.fundingRate}%), rủi ro crowded trade`, level: 'amber' });
  } else if (sign(coin.fundingRate) < -0.03 && sign(coin.return4h) > 0) {
    warnings.push({ code: 'NEGATIVE_FUNDING_OPPOSING', message: 'Funding âm đối kháng, theo dõi squeeze', level: 'cyan' });
  }

  if (coin.basisPct !== null && Math.abs(coin.basisPct) > 0.25) {
    warnings.push({ code: 'WIDE_BASIS', message: `Basis giãn rộng (${coin.basisPct}%)`, level: 'amber' });
  }

  if (coin.spreadPct > 0.08) {
    warnings.push({ code: 'WIDE_SPREAD', message: `Spread rộng (${coin.spreadPct}%)`, level: 'amber' });
  }

  if (coin.volCV > 0.9) {
    warnings.push({ code: 'ERRATIC_VOL', message: `Volume biến động cao (VolCV ${coin.volCV})`, level: 'amber' });
  }

  if (coin.dataCoverage < 0.8) {
    warnings.push({ code: 'PARTIAL_DATA', message: `Độ phủ dữ liệu ${Math.round(coin.dataCoverage * 100)}%`, level: 'neutral' });
  }

  if (direction === 'BUY' && coin.rsi14 > 72) {
    warnings.push({ code: 'RSI_OVERBOUGHT', message: `RSI 4H quá mua (${coin.rsi14})`, level: 'amber' });
  } else if (direction === 'SELL' && coin.rsi14 < 28) {
    warnings.push({ code: 'RSI_OVERSOLD', message: `RSI 4H quá bán (${coin.rsi14})`, level: 'amber' });
  }

  const distanceToEma = ((coin.currentPrice / coin.ema21) - 1) * 100;
  if (Math.abs(distanceToEma) > 6.0) {
    warnings.push({ code: 'STRETCHED_EMA', message: `Giá cách xa EMA21 4H (${round(distanceToEma, 1)}%)`, level: 'amber' });
  }

  return warnings;
}

export function scoreCoinDirection(coin, direction, macroContext = {}) {
  const state = { quality: 0, relativeStrength: 0, flow: 0, marketContext: 0, tags: [], breakdown: [] };
  scoreQuality(coin, state);
  scoreRelativeStrength(coin, direction, state);
  scoreFlow(coin, direction, state);
  scoreMarketContext(coin, direction, state, macroContext);

  const totalScore = round(state.quality + state.relativeStrength + state.flow + state.marketContext, 1);

  // States per pillar
  const qualityState = state.quality >= 4.0 ? 'LIQUID' : state.quality >= 3.0 ? 'ACCEPTABLE' : 'BORDERLINE';
  const strengthState = state.relativeStrength >= 6.0 ? 'STRONG' : state.relativeStrength >= 3.5 ? 'NEUTRAL' : 'WEAK';

  const signFuturesFlow = directionValue(direction, number(coin.futuresCvdRatio24h, 0));
  const signSpotFlow = directionValue(direction, number(coin.spotCvdRatio24h, 0));
  let flowState = 'NEUTRAL';
  if (signFuturesFlow > 1.0 && signSpotFlow > 0.5) flowState = 'FLOW CONFIRMED';
  else if (signFuturesFlow > 0 || signSpotFlow > 0) flowState = 'PARTIAL FLOW';
  else if (signFuturesFlow < -1.0 || signSpotFlow < -1.0) flowState = 'DIVERGENT';

  const trendState = coin.paContext?.structure4h || (coin.ema21 > coin.ema55 ? 'UPTREND' : 'DOWNTREND');

  // Status mapping
  let status = 'THEO DÕI THÊM';
  let statusColor = '#94a3b8';
  if (totalScore >= 18.0) {
    status = 'ƯU TIÊN CAO';
    statusColor = '#10b981';
  } else if (totalScore >= 14.0) {
    status = 'ĐÁNG THEO DÕI';
    statusColor = '#0284c7';
  }

  // Top 3 positive reasons sorted by point contribution
  const positiveReasons = [...state.tags]
    .filter(tag => tag.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map(tag => tag.label);

  const warnings = detectWarnings(coin, direction);

  return {
    ...coin,
    direction,
    score: totalScore,
    qualityScore: round(state.quality, 1),
    strengthScore: round(state.relativeStrength, 1),
    flowScore: round(state.flow, 1),
    contextScore: round(state.marketContext, 1),
    pillarScores: {
      quality: { score: round(state.quality, 1), max: 5.0, state: qualityState },
      strength: { score: round(state.relativeStrength, 1), max: 8.0, state: strengthState },
      flow: { score: round(state.flow, 1), max: 6.0, state: flowState },
      context: { score: round(state.marketContext, 1), max: 6.0, state: trendState },
    },
    qualityState,
    strengthState,
    flowState,
    trendState,
    positiveReasons,
    warnings,
    tags: state.tags,
    breakdown: state.breakdown,
    status,
    statusColor,
  };
}

export const scoreCoinBuy = (coin, macroContext = {}) => scoreCoinDirection(coin, 'BUY', macroContext);
export const scoreCoinSell = (coin, macroContext = {}) => scoreCoinDirection(coin, 'SELL', macroContext);

export function passesQualityGate(coin) {
  return coin.hasFutures
    && finite(coin.marketCap) && coin.marketCap >= 1_000_000_000
    && finite(coin.spreadPct) && coin.spreadPct <= 0.15
    && finite(coin.volCV) && coin.volCV <= 1.3
    && coin.vol30d >= 100_000_000
    && coin.dataCoverage >= 0.65;
}

function macroSignature(context) {
  const triState = value => value === true ? '1' : value === false ? '0' : 'u';
  return `${triState(context.isBtcBullish)}:${triState(context.isEtfInflow)}`;
}

function assignStrengthPercentiles(coins) {
  const ranked = coins.map(coin => ({
    coin,
    composite: (number(coin.relativeStrength1h, 0) * 0.2)
      + (number(coin.relativeStrength4h, 0) * 0.35)
      + (number(coin.relativeStrength24h, 0) * 0.45),
  })).sort((a, b) => a.composite - b.composite);
  if (ranked.length === 1) {
    ranked[0].coin.relativeStrengthComposite = round(ranked[0].composite, 3);
    ranked[0].coin.strengthPercentile = 50;
    return;
  }
  const denominator = Math.max(1, ranked.length - 1);
  ranked.forEach((item, index) => {
    item.coin.relativeStrengthComposite = round(item.composite, 3);
    item.coin.strengthPercentile = round((index / denominator) * 100, 1);
  });
}

/**
 * Diagnostic utility to evaluate shortlist ranking quality against forward price outcomes.
 * Does not optimize thresholds on the same observed fold.
 */
export function evaluateShortlistUtility(snapshot, forwardOutcomes = {}) {
  if (!snapshot || !Array.isArray(snapshot.topBuy)) return null;

  const btcReturn = number(forwardOutcomes.btcReturn24h, 0);
  const buyOutcomes = snapshot.topBuy.map(coin => {
    const coinReturn = number(forwardOutcomes[coin.symbol]?.return24h, null);
    const relReturn = coinReturn !== null && btcReturn !== null ? coinReturn - btcReturn : null;
    return {
      symbol: coin.symbol,
      score: coin.score,
      relReturn,
      outperformed: relReturn !== null ? relReturn > 0 : null,
    };
  });

  const validEvaluated = buyOutcomes.filter(item => item.outperformed !== null);
  const precisionAt5 = validEvaluated.length > 0
    ? validEvaluated.filter(item => item.outperformed).length / validEvaluated.length
    : null;

  const validRelReturns = validEvaluated.map(item => item.relReturn).filter(finite);
  const avgRelReturnTop5 = validRelReturns.length > 0 ? average(validRelReturns) : null;

  return {
    evaluatedCount: validEvaluated.length,
    precisionAt5: precisionAt5 !== null ? round(precisionAt5 * 100, 1) : null,
    avgRelReturnTop5: avgRelReturnTop5 !== null ? round(avgRelReturnTop5, 2) : null,
    details: buyOutcomes,
  };
}

export async function runFullScan(macroContext = {}, forceRefresh = false) {
  const signature = macroSignature(macroContext);
  const cached = storageGet(RESULT_CACHE_KEY);
  if (!forceRefresh && cached?.algorithmVersion === ALGORITHM_VERSION
    && cached?.macroSignature === signature
    && Date.now() - cached.timestamp < RESULT_CACHE_TTL) {
    return cached;
  }

  let errorState = null;
  let marketCapMap = new Map();
  let futuresBookMap = new Map();
  let fundingMap = new Map();
  let benchmark = { h1: null, h4: null, h24: null };

  try {
    const fetched = await Promise.all([
      getMarketCapMap(),
      getFuturesBookTickers(),
      getFundingRatesMap(),
      getBenchmarkReturns(),
    ]);
    marketCapMap = fetched[0];
    futuresBookMap = fetched[1];
    fundingMap = fetched[2];
    benchmark = fetched[3];
  } catch (error) {
    console.error('[Scanner] Failed fetching auxiliary data:', error);
    errorState = 'PROVIDER_UNAVAILABLE';
  }

  const universe = await getTop30dVolumePairs(marketCapMap, 50);
  if (!universe || universe.length === 0) {
    if (!errorState) errorState = 'PROVIDER_UNAVAILABLE';
    const emptyResult = {
      algorithmVersion: ALGORITHM_VERSION,
      macroSignature: signature,
      topBuy: [],
      topSell: [],
      scannedCount: 0,
      analyzedCount: 0,
      qualifiedCount: 0,
      errorState,
      timestamp: Date.now(),
      dataFreshness: {
        timestamp: Date.now(),
        oldestSource: 'Binance REST',
        ageSeconds: 0,
        coverageAvg: 0,
      },
    };
    return emptyResult;
  }

  const analyzed = (await mapConcurrent(
    universe,
    5,
    pair => analyzeCoin(pair, futuresBookMap, fundingMap, benchmark),
  )).filter(Boolean);

  if (analyzed.length < universe.length * 0.4) {
    errorState = 'INSUFFICIENT_COVERAGE';
  }

  const qualified = analyzed.filter(passesQualityGate);
  assignStrengthPercentiles(qualified);

  const scored = qualified.map(coin => {
    const buy = scoreCoinBuy(coin, macroContext);
    const sell = scoreCoinSell(coin, macroContext);
    return {
      buy: { ...buy, directionalEdge: round(buy.score - sell.score, 1) },
      sell: { ...sell, directionalEdge: round(sell.score - buy.score, 1) },
    };
  });

  const sorter = (a, b) => b.score - a.score
    || b.directionalEdge - a.directionalEdge
    || b.vol30d - a.vol30d;

  const topBuy = scored.map(item => item.buy)
    .filter(coin => coin.score >= 14 && coin.directionalEdge >= 3)
    .sort(sorter).slice(0, 5);

  const topSell = scored.map(item => item.sell)
    .filter(coin => coin.score >= 14 && coin.directionalEdge >= 3)
    .sort(sorter).slice(0, 5);

  if (!errorState && qualified.length === 0) {
    errorState = 'NO_CANDIDATES';
  }

  const avgCoverage = analyzed.length > 0
    ? round(average(analyzed.map(c => c.dataCoverage || 0)), 2)
    : 0;

  const result = {
    algorithmVersion: ALGORITHM_VERSION,
    macroSignature: signature,
    topBuy,
    topSell,
    scannedCount: universe.length,
    analyzedCount: analyzed.length,
    qualifiedCount: qualified.length,
    rejectedMissingMarketCap: analyzed.filter(coin => !finite(coin.marketCap)).length,
    errorState,
    timestamp: Date.now(),
    dataFreshness: {
      timestamp: Date.now(),
      oldestSource: 'Binance 4H/Daily Klines',
      ageSeconds: 0,
      coverageAvg: avgCoverage,
    },
  };

  storageSet(RESULT_CACHE_KEY, result);
  return result;
}

