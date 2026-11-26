/**
 * Scanner v9 Data Ingestion & Snapshot Generation Engine
 * Fetches Binance Spot & Futures data, DefiLlama, Curated Fundamentals, Rubrics,
 * strictly aligns timestamps up to 00:00 UTC, and computes complete 4-pillar rankings.
 */

import axios from 'axios';
import {
  SCANNER_SCHEMA_VERSION,
  SCANNER_MODEL_VERSION,
  WINDOWS,
} from './scannerConfig.js';
import {
  isExcludedSymbol,
  getAssetMetadata,
  getAllRegisteredAssets,
} from './assetRegistry.js';
import {
  evaluateRubricForDate,
} from './rubricRegistry.js';
import {
  getSectorMetricsGrowthForWindow,
} from './curatedFundamentalsService.js';
import {
  probeDefiLlamaStatus,
  fetchLiveDefiLlamaMetrics,
  fetchLiveDefiLlamaTvlMetrics,
} from './defiLlamaAdapter.js';
import {
  calculateRelativeStrength,
  calculateCvdAndFlowPressure,
  calculateOiMetrics,
  calculateFundingMetrics,
  classifyFlowInterpretation,
  calculateVolumeStability,
  calculateQuantitativeSectorScores,
  scoreUniverseForWindow,
  calculateSummaryStatistics,
} from './scannerCalculations.js';

const BINANCE_SPOT_BASE_URLS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
];

const BINANCE_FUTURES_BASE_URLS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
  'https://fapi3.binance.com',
];

const OKX_API_BASE = ['https:', '', 'www.okx.com'].join('/');
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toOkxSwapInstId(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  if (upper.endsWith('USDT')) {
    return `${upper.slice(0, -4)}-USDT-SWAP`;
  }
  return `${upper}-SWAP`;
}

/**
 * Utility delay function.
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalize an asOf date to midnight 00:00:00.000 UTC of that day.
 */
export function getUtcMidnightDate(dateInput = new Date()) {
  let d = new Date(dateInput);
  if (!Number.isFinite(d.getTime())) {
    d = new Date();
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Fetch Binance Spot endpoint with automatic mirror domain fallback.
 */
async function fetchBinanceSpot(endpointPath, params = {}, retries = 2, delayMs = 300) {
  let lastError = null;
  for (const baseUrl of BINANCE_SPOT_BASE_URLS) {
    const url = `${baseUrl}${endpointPath}`;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const resp = await axios.get(url, {
          params,
          timeout: 10000,
          headers: { 'User-Agent': DEFAULT_USER_AGENT },
        });
        return resp.data;
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        // If geo-blocked (451/403) or not found, fail over to next domain immediately
        if (status === 451 || status === 403 || status === 404) {
          break;
        }
        if (attempt < retries) {
          await sleep(delayMs * attempt);
        }
      }
    }
  }
  throw lastError || new Error(`Failed to fetch Binance Spot endpoint ${endpointPath}`);
}

/**
 * Fetch Binance Futures endpoint with automatic mirror domain fallback.
 */
async function fetchBinanceFutures(endpointPath, params = {}, retries = 2, delayMs = 300) {
  let lastError = null;
  for (const baseUrl of BINANCE_FUTURES_BASE_URLS) {
    const url = `${baseUrl}${endpointPath}`;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const resp = await axios.get(url, {
          params,
          timeout: 10000,
          headers: { 'User-Agent': DEFAULT_USER_AGENT },
        });
        return resp.data;
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        if (status === 451 || status === 403 || status === 404) {
          break;
        }
        if (attempt < retries) {
          await sleep(delayMs * attempt);
        }
      }
    }
  }
  throw lastError || new Error(`Failed to fetch Binance Futures endpoint ${endpointPath}`);
}

/**
 * Fetch Binance Spot USDT exchangeInfo pairs.
 */
export async function fetchSpotActiveUsdtPairs() {
  try {
    const data = await fetchBinanceSpot('/api/v3/exchangeInfo');
    const validPairs = [];

    for (const s of data?.symbols || []) {
      if (s.status === 'TRADING' && s.quoteAsset === 'USDT' && !isExcludedSymbol(s.symbol)) {
        validPairs.push(s.symbol);
      }
    }
    return validPairs;
  } catch (err) {
    console.error('[ScannerDataEngine] Error fetching spot exchangeInfo:', err.message);
    return [];
  }
}

/**
 * Fetch Binance Spot daily klines strictly ending at or before asOfUtcMidnight.
 */
export async function fetchSpotDailyKlines(symbol, asOfUtcMidnight, limit = 35) {
  const endTime = asOfUtcMidnight.getTime() - 1; // Last millisecond of previous UTC day
  try {
    const data = await fetchBinanceSpot('/api/v3/klines', {
      symbol,
      interval: '1d',
      endTime,
      limit,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch Binance Futures daily klines.
 */
export async function fetchFuturesDailyKlines(symbol, asOfUtcMidnight, limit = 35) {
  const endTime = asOfUtcMidnight.getTime() - 1;
  try {
    const data = await fetchBinanceFutures('/fapi/v1/klines', {
      symbol,
      interval: '1d',
      endTime,
      limit,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch Binance Futures Open Interest History.
 */
export async function fetchFuturesOiHistory(symbol, asOfUtcMidnight, limit = 35) {
  const asOfTime = asOfUtcMidnight instanceof Date ? asOfUtcMidnight.getTime() : new Date(asOfUtcMidnight).getTime();
  const endTime = asOfTime;
  try {
    const data = await fetchBinanceFutures('/futures/data/openInterestHist', {
      symbol,
      period: '1d',
      endTime,
      limit,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

/**
 * Fetch Binance Futures Funding Rate History.
 */
export async function fetchFuturesFundingHistory(symbol, startTime, endTime) {
  let allRecords = [];
  let currentStartTime = startTime;
  const seen = new Set();
  
  try {
    while (currentStartTime <= endTime) {
      const data = await fetchBinanceFutures('/fapi/v1/fundingRate', {
        symbol,
        startTime: currentStartTime,
        endTime,
        limit: 1000,
      });
      
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }
      
      let maxTime = currentStartTime;
      for (const item of data) {
        if (!seen.has(item.fundingTime)) {
          seen.add(item.fundingTime);
          allRecords.push(item);
        }
        if (item.fundingTime > maxTime) {
          maxTime = item.fundingTime;
        }
      }
      
      if (maxTime === currentStartTime) {
        // No forward progress
        break;
      }
      currentStartTime = maxTime + 1;
      
      if (data.length < 1000) {
        // Fetched all available records in window
        break;
      }
      await sleep(100);
    }
    return allRecords;
  } catch (err) {
    return allRecords;
  }
}

/**
 * Probe Binance Futures exchangeInfo to detect geo-blocking (451/403) and obtain active USDT perpetual symbols.
 */
export async function probeBinanceFuturesExchangeInfo() {
  let geoBlocked = false;
  let lastError = null;

  for (const baseUrl of BINANCE_FUTURES_BASE_URLS) {
    try {
      const resp = await axios.get(`${baseUrl}/fapi/v1/exchangeInfo`, {
        timeout: 8000,
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      });
      const symbols = new Set();
      for (const s of resp.data?.symbols || []) {
        if (s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT') {
          symbols.add(s.symbol);
        }
      }
      if (symbols.size > 0) {
        return { status: 'OK', geoBlocked: false, symbols };
      }
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 451 || status === 403) {
        geoBlocked = true;
      }
    }
  }

  return {
    status: geoBlocked ? 'GEO_BLOCKED' : 'ERROR',
    geoBlocked,
    symbols: null,
    error: lastError?.message || 'Unable to reach Binance Futures',
  };
}

/**
 * Fetch OKX active USDT-margined SWAP instruments for fallback when Binance Futures is geo-blocked.
 */
export async function fetchOkxSwapInstruments() {
  try {
    const resp = await axios.get(`${OKX_API_BASE}/api/v5/public/instruments`, {
      params: { instType: 'SWAP' },
      timeout: 10000,
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });
    const instIds = new Set();
    for (const item of resp.data?.data || []) {
      if (item.state === 'live' && item.settleCcy === 'USDT' && item.instId) {
        instIds.add(item.instId);
      }
    }
    return instIds.size > 0 ? instIds : null;
  } catch {
    return null;
  }
}

/**
 * Fetch OKX SWAP daily klines + taker volume ratio and normalize into Binance kline tuple format.
 * Uses unit-invariant buyRatio = buyVol / (buyVol + sellVol) applied to quote volume (volCcyQuote).
 */
export async function fetchOkxFuturesDailyKlines(symbol, asOfUtcMidnight, limit = 35) {
  const instId = toOkxSwapInstId(symbol);
  if (!instId) return [];

  const asOfTime = asOfUtcMidnight.getTime();
  const endTime = asOfTime - 1;

  try {
    const [candlesResp, takerResp] = await Promise.all([
      axios.get(`${OKX_API_BASE}/api/v5/market/history-candles`, {
        params: { instId, bar: '1Dutc', after: String(asOfTime), limit: String(limit) },
        timeout: 10000,
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      }),
      axios.get(`${OKX_API_BASE}/api/v5/rubik/stat/taker-volume-contract`, {
        params: { instId, period: '1D', unit: '1', end: String(asOfTime), limit: String(limit) },
        timeout: 10000,
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      }).catch(() => ({ data: { data: [] } })),
    ]);

    const rawCandles = Array.isArray(candlesResp.data?.data) ? candlesResp.data.data : [];
    let rawTaker = Array.isArray(takerResp.data?.data) ? takerResp.data.data : [];
    if (rawCandles.length === 0) {
      return [];
    }

    // Index taker volume ratio by UTC day midnight timestamp
    const takerRatioByDay = new Map();
    const indexTakerRows = (rows) => {
      for (const row of rows) {
        // [ts, sellVol, buyVol]
        const ts = Number(row[0]);
        const sellVol = Number(row[1]);
        const buyVol = Number(row[2]);
        if (Number.isFinite(ts) && Number.isFinite(sellVol) && Number.isFinite(buyVol) && (sellVol + buyVol) > 0) {
          const dayTs = Math.floor(ts / MS_PER_DAY) * MS_PER_DAY;
          takerRatioByDay.set(dayTs, buyVol / (buyVol + sellVol));
        }
      }
    };

    indexTakerRows(rawTaker);

    // Fallback to currency-level CONTRACTS taker volume if contract-level returned zeros/empty
    if (takerRatioByDay.size === 0) {
      const ccy = symbol.toUpperCase().replace(/USDT$/, '');
      if (ccy) {
        const ccyResp = await axios.get(`${OKX_API_BASE}/api/v5/rubik/stat/taker-volume`, {
          params: { ccy, instType: 'CONTRACTS', period: '1D', end: String(asOfTime) },
          timeout: 10000,
          headers: { 'User-Agent': DEFAULT_USER_AGENT },
        }).catch(() => ({ data: { data: [] } }));
        rawTaker = Array.isArray(ccyResp.data?.data) ? ccyResp.data.data : [];
        indexTakerRows(rawTaker);
      }
    }

    if (takerRatioByDay.size === 0) {
      return [];
    }

    const normalized = [];
    for (const c of rawCandles) {
      // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      const openTime = Number(c[0]);
      const quoteVol = Number(c[7]);
      if (!Number.isFinite(openTime) || openTime > endTime || !Number.isFinite(quoteVol) || quoteVol <= 0) {
        continue;
      }
      const dayTs = Math.floor(openTime / MS_PER_DAY) * MS_PER_DAY;
      const buyRatio = takerRatioByDay.get(dayTs);
      if (buyRatio === undefined) {
        continue;
      }
      const takerBuyQuote = quoteVol * buyRatio;
      const closeTime = openTime + MS_PER_DAY - 1;
      normalized.push([
        openTime,
        c[1],
        c[2],
        c[3],
        c[4],
        c[6],
        closeTime,
        String(quoteVol),
        0,
        '0',
        String(takerBuyQuote),
        '0',
      ]);
    }

    normalized.sort((a, b) => a[0] - b[0]);
    return normalized;
  } catch {
    return [];
  }
}

/**
 * Fetch OKX SWAP Open Interest history and normalize to Binance openInterestHist shape.
 */
export async function fetchOkxFuturesOiHistory(symbol, asOfUtcMidnight, limit = 35) {
  const instId = toOkxSwapInstId(symbol);
  if (!instId) return [];

  const asOfTime = asOfUtcMidnight instanceof Date ? asOfUtcMidnight.getTime() : new Date(asOfUtcMidnight).getTime();
  try {
    const resp = await axios.get(`${OKX_API_BASE}/api/v5/rubik/stat/contracts/open-interest-history`, {
      params: { instId, period: '1D', end: String(asOfTime + MS_PER_DAY), limit: String(Math.min(limit + 2, 100)) },
      timeout: 10000,
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });

    const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
    return rows
      .map((r) => {
        // [ts, oi, oiCcy, oiUsd]
        const ts = Number(r[0]);
        const oiBase = Number(r[2]);
        const oiUsd = Number(r[3]);
        if (!Number.isFinite(ts) || ts > asOfTime + 12 * 60 * 60 * 1000) return null;
        return {
          timestamp: ts,
          sumOpenInterest: Number.isFinite(oiBase) ? oiBase : null,
          sumOpenInterestValue: Number.isFinite(oiUsd) ? oiUsd : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

/**
 * Fetch OKX SWAP Funding Rate history and normalize to Binance fundingRate shape.
 */
export async function fetchOkxFuturesFundingHistory(symbol, startTime, endTime) {
  const instId = toOkxSwapInstId(symbol);
  if (!instId) return [];

  const allRecords = [];
  const seen = new Set();
  let afterCursor = null;

  try {
    for (let page = 0; page < 4; page += 1) {
      const params = { instId, limit: '100' };
      if (afterCursor) params.after = String(afterCursor);

      const resp = await axios.get(`${OKX_API_BASE}/api/v5/public/funding-rate-history`, {
        params,
        timeout: 10000,
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      });

      const rows = Array.isArray(resp.data?.data) ? resp.data.data : [];
      if (rows.length === 0) break;

      let minTime = Infinity;
      for (const item of rows) {
        const ft = Number(item.fundingTime);
        const rate = Number(item.realizedRate ?? item.fundingRate);
        if (Number.isFinite(ft)) {
          if (ft < minTime) minTime = ft;
          if (ft >= startTime && ft <= endTime && Number.isFinite(rate) && !seen.has(ft)) {
            seen.add(ft);
            allRecords.push({ fundingTime: ft, fundingRate: rate });
          }
        }
      }

      if (!Number.isFinite(minTime) || minTime <= startTime || rows.length < 100) {
        break;
      }
      afterCursor = minTime;
      await sleep(80);
    }

    allRecords.sort((a, b) => a.fundingTime - b.fundingTime);
    return allRecords;
  } catch {
    return allRecords;
  }
}

/**
 * Build Top 50 universe by 30-day quote volume.
 */
export async function buildTop50Universe(asOfUtcMidnight, candidateSymbols = null) {
  let pairs = candidateSymbols;

  if (!pairs || pairs.length === 0) {
    try {
      // 1. Fetch active TRADING Spot USDT pairs + 24hr tickers in parallel
      const [activePairs, tickers] = await Promise.all([
        fetchSpotActiveUsdtPairs(),
        fetchBinanceSpot('/api/v3/ticker/24hr'),
      ]);
      const activeSet = new Set(activePairs);
      const validTickerCandidates = [];

      for (const t of tickers || []) {
        const isAllowed = activeSet.size > 0
          ? activeSet.has(t.symbol)
          : (t.symbol && t.symbol.endsWith('USDT') && !isExcludedSymbol(t.symbol));
        if (isAllowed) {
          const vol24h = Number(t.quoteVolume) || 0;
          if (vol24h > 0) {
            validTickerCandidates.push({ symbol: t.symbol, vol24h });
          }
        }
      }

      // Sort by 24h volume to process most liquid first, cap to top 120 to avoid scanning 400+ illiquid pairs
      validTickerCandidates.sort((a, b) => b.vol24h - a.vol24h);
      pairs = validTickerCandidates.slice(0, 120).map(c => c.symbol);
    } catch {
      pairs = [];
    }
  }

  // Fallback to registered assets if API fetch fails or returns too few
  if (!pairs || pairs.length < 10) {
    pairs = getAllRegisteredAssets()
      .map(a => a.symbol)
      .filter(s => !isExcludedSymbol(s));
  }

  const universeCandidates = [];
  const expectedLatestOpenTime = asOfUtcMidnight.getTime() - MS_PER_DAY;

  // Batch fetch 30d klines to rank by exact 30d volume (batch size 15)
  const batchSize = 15;
  for (let i = 0; i < pairs.length; i += batchSize) {
    const chunk = pairs.slice(i, i + batchSize);
    const promises = chunk.map(async (sym) => {
      const klines = await fetchSpotDailyKlines(sym, asOfUtcMidnight, 31);
      if (klines && klines.length >= 30) {
        // Take last 31 completed daily candles if available, else 30
        const completedKlines = klines.slice(-31);
        const latestCandleOpenTime = Number(completedKlines[completedKlines.length - 1]?.[0]);
        if (latestCandleOpenTime !== expectedLatestOpenTime) {
          return null;
        }
        const completed30 = completedKlines.slice(-30);
        let total30dQuoteVol = 0;
        const dailyVolumes = [];

        for (const k of completed30) {
          const qVol = Number(k[7]) || 0;
          total30dQuoteVol += qVol;
          dailyVolumes.push(qVol);
        }

        const metadata = getAssetMetadata(sym) || {
          symbol: sym,
          baseAsset: sym.replace(/USDT$/, ''),
          name: sym.replace(/USDT$/, ''),
          sector: 'Other',
          narratives: [],
        };

        const volStability = calculateVolumeStability(dailyVolumes);

        return {
          symbol: sym,
          baseAsset: metadata.baseAsset,
          name: metadata.name,
          sector: metadata.sector,
          narratives: metadata.narratives || [],
          coingeckoId: metadata.coingeckoId || null,
          defillamaSlug: metadata.defillamaSlug || null,
          total30dQuoteVol,
          average30dDailyQuoteVol: total30dQuoteVol / 30,
          dailyVolumes30d: dailyVolumes,
          volStability,
          spotKlines: completedKlines,
        };
      }
      return null;
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r) universeCandidates.push(r);
    }
    await sleep(20);
  }

  // Sort descending by exact 30-day quote volume and take Top 50
  universeCandidates.sort((a, b) => b.total30dQuoteVol - a.total30dQuoteVol);
  return universeCandidates.slice(0, 50);
}

/**
 * Generate a complete daily snapshot for a given date.
 */
export async function generateDailySnapshot({
  asOf = new Date(),
  prefetchedUniverse = null,
  prefetchedBtcKlines = null,
  prefetchedEthKlines = null,
  sourceOverrides = {},
} = {}) {
  const asOfMidnight = getUtcMidnightDate(asOf);
  const asOfIso = asOfMidnight.toISOString();
  const generatedAtIso = new Date().toISOString();

  // 1. Fetch Benchmark Klines (BTC & ETH)
  let btcKlines = prefetchedBtcKlines;
  if (!btcKlines || btcKlines.length < 30) {
    btcKlines = await fetchSpotDailyKlines('BTCUSDT', asOfMidnight, 35);
  }

  let ethKlines = prefetchedEthKlines;
  if (!ethKlines || ethKlines.length < 30) {
    ethKlines = await fetchSpotDailyKlines('ETHUSDT', asOfMidnight, 35);
  }

  const hasBenchmarks = (btcKlines && btcKlines.length >= 30) && (ethKlines && ethKlines.length >= 30);
  if (!hasBenchmarks) {
    throw new Error(`Failed to fetch required benchmarks (BTCUSDT/ETHUSDT) for ${asOfIso}`);
  }

  // 2. Build Universe Top 50
  let universe = prefetchedUniverse;
  if (!universe || universe.length === 0) {
    universe = await buildTop50Universe(asOfMidnight);
  }

  if (!universe || universe.length === 0) {
    throw new Error(`Failed to build asset universe for ${asOfIso}`);
  }

  // Benchmark prices at t (latest closed), t-1d, t-7d, t-30d
  const btcCloseNow = btcKlines.length > 0 ? Number(btcKlines[btcKlines.length - 1][4]) : null;
  const btcClose1d = btcKlines.length >= 2 ? Number(btcKlines[btcKlines.length - 2][4]) : null;
  const btcClose7d = btcKlines.length >= 8 ? Number(btcKlines[btcKlines.length - 8][4]) : null;
  const btcClose30d = btcKlines.length >= 31 ? Number(btcKlines[btcKlines.length - 31][4]) : null;

  const ethCloseNow = ethKlines.length > 0 ? Number(ethKlines[ethKlines.length - 1][4]) : null;
  const ethClose1d = ethKlines.length >= 2 ? Number(ethKlines[ethKlines.length - 2][4]) : null;
  const ethClose7d = ethKlines.length >= 8 ? Number(ethKlines[ethKlines.length - 8][4]) : null;
  const ethClose30d = ethKlines.length >= 31 ? Number(ethKlines[ethKlines.length - 31][4]) : null;

  const rawAssets = [];

  // Probe futures venue once (avoid 50x repeated geo-block failures on US runners)
  const needsLiveFuturesProbe = universe.some(a => sourceOverrides[a.symbol]?.hasFutures === undefined);
  let activeFuturesVenue = 'binance';
  let binanceFuturesSymbols = null;
  let okxSwapInstIds = null;
  let binanceFuturesStatus = 'OK';

  if (needsLiveFuturesProbe) {
    const binanceProbe = await probeBinanceFuturesExchangeInfo();
    if (binanceProbe.status === 'OK' && binanceProbe.symbols) {
      activeFuturesVenue = 'binance';
      binanceFuturesSymbols = binanceProbe.symbols;
      binanceFuturesStatus = 'OK';
    } else {
      console.warn(`[ScannerDataEngine] Binance Futures unavailable (${binanceProbe.status}), probing OKX SWAP fallback...`);
      okxSwapInstIds = await fetchOkxSwapInstruments();
      if (okxSwapInstIds && okxSwapInstIds.size > 0) {
        activeFuturesVenue = 'okx';
        binanceFuturesStatus = binanceProbe.geoBlocked ? 'GEO_BLOCKED_FALLBACK_OKX' : 'ERROR_FALLBACK_OKX';
      } else {
        activeFuturesVenue = 'error';
        binanceFuturesStatus = binanceProbe.status;
      }
    }
  }

  // 3. Process each asset in universe
  for (const asset of universe) {
    const spotKlines = asset.spotKlines || (await fetchSpotDailyKlines(asset.symbol, asOfMidnight, 35));
    const klinesLen = spotKlines.length;

    // Check if asset has futures and fetch derivatives data from active venue
    let futuresKlines = [];
    let oiHistory = [];
    let fundingHistory = [];
    let hasFutures = false;
    let futuresSource = 'none';

    if (sourceOverrides[asset.symbol]?.hasFutures !== undefined) {
      hasFutures = sourceOverrides[asset.symbol].hasFutures;
      futuresSource = hasFutures ? (sourceOverrides[asset.symbol].futuresSource || 'binance') : 'none';
      if (hasFutures && sourceOverrides[asset.symbol]?.futuresKlines) {
        futuresKlines = sourceOverrides[asset.symbol].futuresKlines;
      }
    } else if (activeFuturesVenue === 'binance') {
      const listedOnBinanceFutures = binanceFuturesSymbols ? binanceFuturesSymbols.has(asset.symbol) : true;
      if (listedOnBinanceFutures) {
        futuresKlines = await fetchFuturesDailyKlines(asset.symbol, asOfMidnight, 35);
        if (Array.isArray(futuresKlines) && futuresKlines.length > 0) {
          hasFutures = true;
          futuresSource = 'binance';
        } else {
          // Contract is listed on Binance Futures exchangeInfo, so empty klines means fetch failure, not Spot Only
          hasFutures = null;
          futuresSource = 'error';
        }
      } else {
        hasFutures = false;
        futuresSource = 'none';
      }
    } else if (activeFuturesVenue === 'okx') {
      const okxInstId = toOkxSwapInstId(asset.symbol);
      const listedOnOkx = okxSwapInstIds && okxInstId ? okxSwapInstIds.has(okxInstId) : false;
      if (listedOnOkx) {
        futuresKlines = await fetchOkxFuturesDailyKlines(asset.symbol, asOfMidnight, 35);
        if (Array.isArray(futuresKlines) && futuresKlines.length > 0) {
          hasFutures = true;
          futuresSource = 'okx';
        } else {
          hasFutures = null;
          futuresSource = 'error';
        }
      } else {
        hasFutures = false;
        futuresSource = 'none';
      }
    } else {
      // Neither Binance Futures nor OKX fallback could be reached
      hasFutures = null;
      futuresSource = 'error';
    }

    if (hasFutures === true) {
      if (sourceOverrides[asset.symbol]?.oiHistory) {
        oiHistory = sourceOverrides[asset.symbol].oiHistory;
      } else if (futuresSource === 'okx') {
        oiHistory = await fetchOkxFuturesOiHistory(asset.symbol, asOfMidnight, 35);
      } else {
        oiHistory = await fetchFuturesOiHistory(asset.symbol, asOfMidnight, 35);
      }

      if (sourceOverrides[asset.symbol]?.fundingHistory) {
        fundingHistory = sourceOverrides[asset.symbol].fundingHistory;
      } else {
        const startTime = asOfMidnight.getTime() - (31 * MS_PER_DAY);
        const endTime = asOfMidnight.getTime() - 1;
        if (futuresSource === 'okx') {
          fundingHistory = await fetchOkxFuturesFundingHistory(asset.symbol, startTime, endTime);
        } else {
          fundingHistory = await fetchFuturesFundingHistory(asset.symbol, startTime, endTime);
        }
      }
    }

    // Evaluate Rubric
    const rubric = evaluateRubricForDate(asset.symbol, asOfMidnight);

    // Build indexed maps for exact timestamp alignment
    const spotMap = new Map((spotKlines || []).map(k => [Number(k[0]), k]));
    const btcMap = new Map((btcKlines || []).map(k => [Number(k[0]), Number(k[4])]));
    const ethMap = new Map((ethKlines || []).map(k => [Number(k[0]), Number(k[4])]));
    const futuresMap = hasFutures ? new Map((futuresKlines || []).map(k => [Number(k[0]), k])) : new Map();

    const windowConfigs = [
      { key: '24h', days: 1 },
      { key: '7d', days: 7 },
      { key: '30d', days: 30 },
    ];

    // Compute windows data: 24h (1 candle), 7d (7 candles), 30d (30 candles)
    const windowsData = {};

    for (const win of windowConfigs) {
      const days = win.days;
      const expectedCurrentOpenTime = asOfMidnight.getTime() - MS_PER_DAY;
      const expectedPriorOpenTime = asOfMidnight.getTime() - ((days + 1) * MS_PER_DAY);

      // Verify continuity: every daily candle in [asOfMidnight - days*MS_PER_DAY, asOfMidnight - MS_PER_DAY] must exist
      const spotSlice = [];
      let isSpotContinuous = true;
      for (let d = days; d >= 1; d -= 1) {
        const targetTime = asOfMidnight.getTime() - (d * MS_PER_DAY);
        const candle = spotMap.get(targetTime);
        if (!candle) {
          isSpotContinuous = false;
          break;
        }
        spotSlice.push(candle);
      }

      const spotCurrentCandle = isSpotContinuous ? spotMap.get(expectedCurrentOpenTime) : null;
      const spotPriorCandle = isSpotContinuous ? spotMap.get(expectedPriorOpenTime) : null;

      const spotCurrentClose = spotCurrentCandle ? Number(spotCurrentCandle[4]) : null;
      const spotPriorClose = spotPriorCandle ? Number(spotPriorCandle[4]) : null;

      // Price Change strictly requires both endpoints and continuous window
      let priceChangePct = null;
      if (isSpotContinuous && spotCurrentClose && spotPriorClose && spotPriorClose > 0) {
        priceChangePct = 100 * ((spotCurrentClose - spotPriorClose) / spotPriorClose);
      }

      // RS calculations with strictly anchored timestamps
      let rsBtcRes = { value: null, reason: 'discontinuous_or_lagging_window' };
      let rsEthRes = { value: null, reason: 'discontinuous_or_lagging_window' };

      if (isSpotContinuous && spotCurrentClose && spotPriorClose) {
        const btcCloseNow = btcMap.get(expectedCurrentOpenTime) ?? null;
        const btcPrior = btcMap.get(expectedPriorOpenTime) ?? null;
        const ethCloseNow = ethMap.get(expectedCurrentOpenTime) ?? null;
        const ethPrior = ethMap.get(expectedPriorOpenTime) ?? null;

        rsBtcRes = calculateRelativeStrength(spotCurrentClose, spotPriorClose, btcCloseNow, btcPrior);
        rsEthRes = calculateRelativeStrength(spotCurrentClose, spotPriorClose, ethCloseNow, ethPrior);
      }

      // Spot Flow: only valid if window is continuous
      const spotFlow = isSpotContinuous
        ? calculateCvdAndFlowPressure(spotSlice)
        : { totalQuoteVolume: 0, takerBuyQuoteVolume: 0, takerSellQuoteVolume: 0, cvd: null, flowPressure: null, count: 0, isValid: false };

      // Futures Flow: check futures continuity
      let futuresFlow = { totalQuoteVolume: 0, takerBuyQuoteVolume: 0, takerSellQuoteVolume: 0, cvd: null, flowPressure: null, count: 0, isValid: false };
      if (hasFutures) {
        const futuresSlice = [];
        let isFuturesContinuous = true;
        for (let d = days; d >= 1; d -= 1) {
          const targetTime = asOfMidnight.getTime() - (d * MS_PER_DAY);
          const candle = futuresMap.get(targetTime);
          if (!candle) {
            isFuturesContinuous = false;
            break;
          }
          futuresSlice.push(candle);
        }

        if (isFuturesContinuous && futuresSlice.length === days) {
          futuresFlow = calculateCvdAndFlowPressure(futuresSlice);
        }
      }

      // OI Metrics: Match exact timestamp endpoints
      const expectedEndOiTime = asOfMidnight.getTime();
      const expectedStartOiTime = asOfMidnight.getTime() - (days * MS_PER_DAY);

      let oiMetrics = {
        deltaOiBase: null,
        deltaOiBasePct: null,
        deltaOiUsd: null,
        deltaOiUsdPct: null,
        startOiTime: null,
        endOiTime: null,
        endOiBase: null,
        endOiUsd: null,
        isValid: false,
        reason: 'no_futures_or_missing_oi',
      };

      if (hasFutures && Array.isArray(oiHistory) && oiHistory.length > 0) {
        const oiToleranceMs = futuresSource === 'okx' ? 12 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
        // Find record closest to expectedEndOiTime (within venue-appropriate tolerance)
        const findOiRecord = (targetTime) => {
          let best = null;
          let minDiff = Infinity;
          for (const r of oiHistory) {
            const rTime = Number(r.timestamp || r.time);
            if (Number.isFinite(rTime)) {
              const diff = Math.abs(rTime - targetTime);
              if (diff <= oiToleranceMs && diff < minDiff) {
                minDiff = diff;
                best = r;
              }
            }
          }
          return best;
        };

        const endOi = findOiRecord(expectedEndOiTime);
        let startOi = findOiRecord(expectedStartOiTime);

        if (!startOi && sourceOverrides.priorSnapshots && sourceOverrides.priorSnapshots[win.key]) {
          const priorSnap = sourceOverrides.priorSnapshots[win.key];
          const priorSnapAsOf = priorSnap.asOf ? new Date(priorSnap.asOf).getTime() : 0;

          // Verify prior snapshot timestamp matches expected target within 1 day tolerance
          if (Math.abs(priorSnapAsOf - expectedStartOiTime) <= MS_PER_DAY) {
            const priorAsset = priorSnap.assets?.find(a => a.symbol === asset.symbol);
            if (priorAsset && priorAsset.windows && priorAsset.windows['24h']?.metrics?.endOiBase) {
              startOi = {
                sumOpenInterest: priorAsset.windows['24h'].metrics.endOiBase,
                sumOpenInterestValue: priorAsset.windows['24h'].metrics.endOiUsd,
                timestamp: expectedStartOiTime,
              };
            }
          }
        }

        if (startOi && endOi) {
          const calculated = calculateOiMetrics(startOi, endOi);
          oiMetrics = {
            ...calculated,
            startOiTime: Number(startOi.timestamp || startOi.time || expectedStartOiTime),
            endOiTime: Number(endOi.timestamp || endOi.time || expectedEndOiTime),
          };
        } else if (endOi) {
          oiMetrics.endOiTime = Number(endOi.timestamp || endOi.time || expectedEndOiTime);
          oiMetrics.endOiBase = Number(endOi.sumOpenInterest || endOi.openInterest);
          oiMetrics.endOiUsd = Number(endOi.sumOpenInterestValue || endOi.openInterestUsd);
          oiMetrics.reason = 'missing_start_oi_endpoint';
        } else {
          oiMetrics.reason = 'missing_current_oi_endpoint';
        }
      }

      // Funding Metrics
      let fundingMetrics = { fundingSum: null, fundingAvgDaily: null, isValid: false };
      if (hasFutures && fundingHistory.length > 0) {
        const winStartTime = asOfMidnight.getTime() - (days * MS_PER_DAY);
        const winEndTime = asOfMidnight.getTime() - 1;
        const winFundings = fundingHistory.filter(f => f.fundingTime >= winStartTime && f.fundingTime <= winEndTime);
        fundingMetrics = calculateFundingMetrics(winFundings, days);
      }

      // Flow Interpretation
      const flowInterpretation = classifyFlowInterpretation({
        priceChangePct,
        spotCvd: spotFlow.cvd,
        futuresCvd: hasFutures ? futuresFlow.cvd : null,
        deltaOiBase: oiMetrics.deltaOiBase,
      });

      // Live DefiLlama Adapter check for fundamentals (both metric1: TVL and metric2: Fees)
      let liveTvlMetrics = null;
      let liveFeesMetrics = null;
      if (asset.defillamaSlug) {
        const [tvlRes, feesRes] = await Promise.all([
          fetchLiveDefiLlamaTvlMetrics(asset.defillamaSlug, win.key, asOfMidnight).catch(() => null),
          fetchLiveDefiLlamaMetrics(asset.defillamaSlug, win.key, asOfMidnight).catch(() => null),
        ]);
        liveTvlMetrics = tvlRes;
        liveFeesMetrics = feesRes;
      }

      const liveWinOverride = {};
      if (liveTvlMetrics) {
        liveWinOverride.metric1Growth = liveTvlMetrics.growthRate;
        liveWinOverride.metric1Name = liveTvlMetrics.metricName;
        liveWinOverride.metric1Unit = liveTvlMetrics.metricUnit;
        liveWinOverride.metric1Value = liveTvlMetrics.currentValue;
        liveWinOverride.metric1Prior = liveTvlMetrics.priorValue;
        liveWinOverride.sourceUrl1 = liveTvlMetrics.sourceUrl;
        liveWinOverride.publishedAt1 = liveTvlMetrics.publishedAt;
      }
      if (liveFeesMetrics) {
        liveWinOverride.metric2Growth = liveFeesMetrics.growthRate;
        liveWinOverride.metric2Name = liveFeesMetrics.metricName;
        liveWinOverride.metric2Unit = liveFeesMetrics.metricUnit;
        liveWinOverride.metric2Value = liveFeesMetrics.currentValue;
        liveWinOverride.metric2Prior = liveFeesMetrics.priorValue;
        liveWinOverride.sourceUrl2 = liveFeesMetrics.sourceUrl;
        liveWinOverride.publishedAt2 = liveFeesMetrics.publishedAt;
      }

      const liveOverrides = Object.keys(liveWinOverride).length > 0
        ? { [asset.symbol]: { [win.key]: liveWinOverride } }
        : null;

      // Fundamentals Growth for this window
      const fundGrowth = getSectorMetricsGrowthForWindow(asset.symbol, win.key, asOfMidnight, liveOverrides);

      windowsData[win.key] = {
        metrics: {
          currentPrice: spotCurrentClose,
          priorPrice: spotPriorClose,
          priceChangePct,
          rsBtc: rsBtcRes.value,
          rsBtcReason: rsBtcRes.reason,
          rsEth: rsEthRes.value,
          rsEthReason: rsEthRes.reason,
          quoteVolume: spotFlow.totalQuoteVolume,
          spotCvd: spotFlow.cvd,
          spotFlowPressure: spotFlow.flowPressure,
          futuresCvd: hasFutures ? futuresFlow.cvd : null,
          futuresFlowPressure: hasFutures ? futuresFlow.flowPressure : null,
          deltaOiBase: oiMetrics.deltaOiBase,
          deltaOiBasePct: oiMetrics.deltaOiBasePct,
          deltaOiUsd: oiMetrics.deltaOiUsd,
          deltaOiUsdPct: oiMetrics.deltaOiUsdPct,
          startOiTime: oiMetrics.startOiTime,
          endOiTime: oiMetrics.endOiTime,
          endOiBase: oiMetrics.endOiBase,
          endOiUsd: oiMetrics.endOiUsd,
          fundingSum: fundingMetrics.fundingSum,
          fundingAvgDaily: fundingMetrics.fundingAvgDaily,
          flowLabel: flowInterpretation.label,
          flowLabelText: flowInterpretation.text,
          flowReason: flowInterpretation.reason,
        },
        fundamentals: {
          metric1Growth: fundGrowth.metric1Growth,
          metric2Growth: fundGrowth.metric2Growth,
          metric1Name: fundGrowth.metric1Name,
          metric2Name: fundGrowth.metric2Name,
          metric1Unit: fundGrowth.metric1Unit,
          metric2Unit: fundGrowth.metric2Unit,
          metric1Value: fundGrowth.metric1Value,
          metric2Value: fundGrowth.metric2Value,
          measurementStart: fundGrowth.measurementPeriod?.measurementStart || null,
          measurementEnd: fundGrowth.measurementPeriod?.measurementEnd || null,
          publishedAt: fundGrowth.measurementPeriod?.publishedAt || null,
          sourceUrl1: fundGrowth.sourceUrl1,
          sourceUrl2: fundGrowth.sourceUrl2,
          reason: fundGrowth.reason,
        },
      };
    }

    rawAssets.push({
      symbol: asset.symbol,
      baseAsset: asset.baseAsset,
      name: asset.name,
      sector: asset.sector,
      narratives: asset.narratives || [],
      coingeckoId: asset.coingeckoId || null,
      defillamaSlug: asset.defillamaSlug || null,
      hasFutures,
      futuresSource,
      liquidity30d: asset.volStability || calculateVolumeStability(asset.dailyVolumes30d || []),
      rubric,
      windows: windowsData,
    });
  }

  // 4. Score Universe across all 3 windows (24h, 7d, 30d)
  let scoredAssets = rawAssets;
  for (const winKey of WINDOWS) {
    const quantMap = calculateQuantitativeSectorScores(scoredAssets, winKey);
    scoredAssets = scoreUniverseForWindow(scoredAssets, winKey, quantMap);
  }

  // 5. Generate Summary Statistics for default window (7d)
  const summaryStats = {
    '24h': calculateSummaryStatistics(scoredAssets, '24h'),
    '7d': calculateSummaryStatistics(scoredAssets, '7d'),
    '30d': calculateSummaryStatistics(scoredAssets, '30d'),
  };

  const defiLlamaStatus = await probeDefiLlamaStatus();

  const snapshot = {
    schemaVersion: SCANNER_SCHEMA_VERSION,
    modelVersion: SCANNER_MODEL_VERSION,
    asOf: asOfIso,
    generatedAt: generatedAtIso,
    sourceStatus: {
      binanceSpot: 'OK',
      binanceFutures: binanceFuturesStatus,
      futuresVenue: activeFuturesVenue,
      defiLlama: defiLlamaStatus,
      curatedFundamentals: 'OK',
    },
    benchmarks: {
      btc: { current: btcCloseNow, prior1d: btcClose1d, prior7d: btcClose7d, prior30d: btcClose30d },
      eth: { current: ethCloseNow, prior1d: ethClose1d, prior7d: ethClose7d, prior30d: ethClose30d },
    },
    universe: scoredAssets.map(a => a.symbol),
    summary: summaryStats,
    assets: scoredAssets,
  };

  return snapshot;
}
