import axios from 'axios';

const ALGORITHM_VERSION = 'v6';
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
    // A full localStorage must never block a scan.
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
    // Providers return assets in descending market-cap order. Keeping the first
    // prevents a small duplicate ticker from overwriting the canonical asset.
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
    // Continue with the secondary provider.
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

export async function getTop30dVolumePairs(marketCapMap, limit = 50) {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', { timeout: 8000 });
    const liquidPairs = (response.data || [])
      .filter(item => item.symbol.endsWith('USDT')
        && !EXCLUDED_SYMBOLS.has(item.symbol)
        && number(item.quoteVolume, 0) >= 3_000_000);
    // Blend the liquid core with both tails of current momentum. This avoids
    // missing a newly strong coin simply because it was outside top 24h volume.
    const candidateMap = new Map();
    const addCandidates = items => items.forEach(item => candidateMap.set(item.symbol, item));
    addCandidates([...liquidPairs]
      .sort((a, b) => number(b.quoteVolume, 0) - number(a.quoteVolume, 0)).slice(0, 110));
    addCandidates([...liquidPairs]
      .sort((a, b) => number(b.priceChangePercent, 0) - number(a.priceChangePercent, 0)).slice(0, 25));
    addCandidates([...liquidPairs]
      .sort((a, b) => number(a.priceChangePercent, 0) - number(b.priceChangePercent, 0)).slice(0, 25));
    const candidates = [...candidateMap.values()];

    const cached = storageGet(UNIVERSE_CACHE_KEY);
    const cacheFresh = cached && Date.now() - cached.timestamp < UNIVERSE_CACHE_TTL;
    const cachedMetrics = cacheFresh ? new Map(cached.metrics.map(item => [item.symbol, item])) : new Map();

    const missing = candidates.filter(item => !cachedMetrics.has(item.symbol));
    const fetched = await mapConcurrent(missing, 8, item => fetchUniverseMetric(item.symbol));
    fetched.forEach((metric, index) => {
      if (metric) cachedMetrics.set(missing[index].symbol, { symbol: missing[index].symbol, ...metric });
    });
    storageSet(UNIVERSE_CACHE_KEY, { timestamp: Date.now(), metrics: [...cachedMetrics.values()] });

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
    }).filter(Boolean).sort((a, b) => b.vol30d - a.vol30d).slice(0, limit);
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
    };
  } catch (error) {
    console.warn(`[Scanner] Skipping ${pair.symbol}:`, error.message);
    return null;
  }
}

function addPoint(state, bucket, points, label, type = 'neutral') {
  state[bucket] += points;
  state.tags.push({ label, type });
  state.breakdown.push({ category: bucket.toUpperCase(), item: label, pts: points });
}

function directionValue(direction, value) {
  return direction === 'BUY' ? value : -value;
}

function scoreQuality(coin, state) {
  if (coin.vol30d >= 1_000_000_000) addPoint(state, 'quality', 1, 'Vol 30D > $1B', 'emerald');
  else if (coin.vol30d >= 300_000_000) addPoint(state, 'quality', 0.5, 'Vol 30D > $300M', 'emerald');
  if (coin.marketCap >= 2_000_000_000) addPoint(state, 'quality', 1, 'Large cap', 'emerald');
  else if (coin.marketCap >= 1_000_000_000) addPoint(state, 'quality', 0.5, 'Mid cap', 'emerald');
  if (coin.volCV <= 0.6) addPoint(state, 'quality', 1, `VolCV ${coin.volCV}`, 'emerald');
  else if (coin.volCV <= 0.9) addPoint(state, 'quality', 0.5, `VolCV ${coin.volCV}`, 'cyan');
  if (coin.spreadPct <= 0.03) addPoint(state, 'quality', 1, `Spread ${coin.spreadPct}%`, 'emerald');
  else if (coin.spreadPct <= 0.08) addPoint(state, 'quality', 0.5, `Spread ${coin.spreadPct}%`, 'cyan');
  if (coin.dataCoverage >= 0.85) addPoint(state, 'quality', 1, 'Data coverage cao', 'emerald');
  else if (coin.dataCoverage >= 0.7) addPoint(state, 'quality', 0.5, 'Data coverage du', 'cyan');
}

function scoreStrength(coin, direction, state) {
  const sign = value => directionValue(direction, number(value, 0));
  const percentile = direction === 'BUY' ? coin.strengthPercentile : 100 - coin.strengthPercentile;
  if (percentile >= 85) addPoint(state, 'strength', 3, `RS vs BTC top ${100 - Math.round(percentile)}%`, 'emerald');
  else if (percentile >= 70) addPoint(state, 'strength', 2, 'RS vs BTC manh', 'emerald');
  else if (percentile >= 55) addPoint(state, 'strength', 1, 'RS vs BTC kha', 'cyan');

  if (sign(coin.relativeStrength4h) > 0.4) addPoint(state, 'strength', 1, 'Outperform BTC 4H', 'emerald');
  if (sign(coin.relativeStrength24h) > 1) addPoint(state, 'strength', 1, 'Outperform BTC 24H', 'emerald');

  if (sign(coin.futuresCvdRatio24h) >= 3) addPoint(state, 'strength', 2, 'Futures CVD xac nhan', 'emerald');
  else if (sign(coin.futuresCvdRatio24h) >= 1) addPoint(state, 'strength', 1, 'Futures CVD cung chieu', 'cyan');
  if (sign(coin.spotCvdRatio24h) >= 1) addPoint(state, 'strength', 1.5, 'Spot CVD xac nhan', 'emerald');
  if (sign(coin.cvdTrendRatio) > 0.5) addPoint(state, 'strength', 1, 'CVD dang tang toc', 'cyan');

  const trend4h = coin.ema21 > coin.ema55 ? 1 : -1;
  if (directionValue(direction, trend4h) > 0) addPoint(state, 'strength', 1, 'EMA 4H cung chieu', 'emerald');
  if (sign(coin.emaSlopePct) > 0) addPoint(state, 'strength', 0.5, 'EMA21 co do doc', 'cyan');
  if (coin.isDailyUptrend !== null && directionValue(direction, coin.isDailyUptrend ? 1 : -1) > 0) {
    addPoint(state, 'strength', 1, 'Daily trend xac nhan', 'emerald');
  }
  const breakout = direction === 'BUY' ? coin.breakoutAtr : coin.breakdownAtr;
  if (breakout >= 0.25) addPoint(state, 'strength', 1, `Breakout ${breakout} ATR`, 'amber');
  state.strength = Math.min(12, state.strength);
}

function scoreEntry(coin, direction, state) {
  const sign = value => directionValue(direction, number(value, 0));
  if (coin.volumeZ1h >= 2) addPoint(state, 'entry', 1.5, `Volume z-score ${coin.volumeZ1h}`, 'amber');
  else if (coin.volumeZ1h >= 1) addPoint(state, 'entry', 1, `Volume z-score ${coin.volumeZ1h}`, 'cyan');

  if (coin.oiChange4h !== null && sign(coin.return4h) > 0 && coin.oiChange4h > 1) {
    addPoint(state, 'entry', 1.5, `Price + OI xac nhan (${coin.oiChange4h}%)`, 'emerald');
  }

  const funding = sign(coin.fundingRate);
  const basis = sign(coin.basisPct);
  const flowConfirmed = sign(coin.futuresCvdRatio24h) > 1 && sign(coin.return4h) > 0;
  if (flowConfirmed && funding < -0.02 && basis <= 0) {
    addPoint(state, 'entry', 1, 'Crowding nguoc chieu: squeeze setup', 'amber');
  } else if (funding > 0.04 || basis > 0.25) {
    state.breakdown.push({ category: 'ENTRY', item: 'Trade dang crowded', pts: -1 });
    state.entry -= 1;
  } else if (finite(coin.fundingRate)) {
    addPoint(state, 'entry', 0.5, 'Funding/basis can bang', 'cyan');
  }

  const rsiGood = direction === 'BUY'
    ? coin.rsi14 >= 42 && coin.rsi14 <= 68
    : coin.rsi14 >= 32 && coin.rsi14 <= 58;
  if (rsiGood) addPoint(state, 'entry', 1, `RSI ${coin.rsi14}`, 'cyan');

  const distanceToEma = ((coin.currentPrice / coin.ema21) - 1) * 100;
  const directedDistance = directionValue(direction, distanceToEma);
  if (directedDistance >= -1 && directedDistance <= 3) addPoint(state, 'entry', 1, 'Entry gan EMA21', 'cyan');
  else if (directedDistance > 8) {
    state.entry -= 1;
    state.breakdown.push({ category: 'ENTRY', item: 'Gia da qua xa EMA21', pts: -1 });
  }
  state.entry = clamp(state.entry, 0, 6);
}

export function scoreCoinDirection(coin, direction, macroContext = {}) {
  const state = { quality: 0, strength: 0, entry: 0, macro: 0, tags: [], breakdown: [] };
  scoreQuality(coin, state);
  scoreStrength(coin, direction, state);
  scoreEntry(coin, direction, state);

  if (typeof macroContext.isBtcBullish === 'boolean'
    && directionValue(direction, macroContext.isBtcBullish ? 1 : -1) > 0) {
    addPoint(state, 'macro', 1, 'BTC regime cung chieu', 'cyan');
  }
  if (typeof macroContext.isEtfInflow === 'boolean'
    && directionValue(direction, macroContext.isEtfInflow ? 1 : -1) > 0) {
    addPoint(state, 'macro', 1, 'ETF flow cung chieu', 'cyan');
  }

  const score = round(clamp(state.quality, 0, 5)
    + clamp(state.strength, 0, 12)
    + clamp(state.entry, 0, 6)
    + clamp(state.macro, 0, 2), 1);
  const status = score >= 18 ? 'RAT MANH' : score >= 14 ? 'DAT CHUAN' : 'THEO DOI';
  return {
    ...coin,
    direction,
    score,
    qualityScore: round(state.quality, 1),
    strengthScore: round(state.strength, 1),
    entryScore: round(state.entry, 1),
    macroScore: round(state.macro, 1),
    tags: state.tags,
    breakdown: state.breakdown,
    status,
    statusColor: score >= 18 ? '#34d399' : score >= 14 ? '#fbbf24' : '#94a3b8',
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

export async function runFullScan(macroContext = {}, forceRefresh = false) {
  const signature = macroSignature(macroContext);
  const cached = storageGet(RESULT_CACHE_KEY);
  if (!forceRefresh && cached?.algorithmVersion === ALGORITHM_VERSION
    && cached?.macroSignature === signature
    && Date.now() - cached.timestamp < RESULT_CACHE_TTL) {
    return cached;
  }

  const [marketCapMap, futuresBookMap, fundingMap, benchmark] = await Promise.all([
    getMarketCapMap(),
    getFuturesBookTickers(),
    getFundingRatesMap(),
    getBenchmarkReturns(),
  ]);
  const universe = await getTop30dVolumePairs(marketCapMap, 50);
  const analyzed = (await mapConcurrent(
    universe,
    5,
    pair => analyzeCoin(pair, futuresBookMap, fundingMap, benchmark),
  )).filter(Boolean);
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

  const result = {
    algorithmVersion: ALGORITHM_VERSION,
    macroSignature: signature,
    topBuy,
    topSell,
    scannedCount: universe.length,
    analyzedCount: analyzed.length,
    qualifiedCount: qualified.length,
    rejectedMissingMarketCap: analyzed.filter(coin => !finite(coin.marketCap)).length,
    timestamp: Date.now(),
  };
  storageSet(RESULT_CACHE_KEY, result);
  return result;
}
