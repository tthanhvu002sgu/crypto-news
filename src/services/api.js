import axios from 'axios';
import staticFlowHistory from '../data/etfFlowHistoryStatic.json';

const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const getFredUrl = () => isLocal ? '/api-fred/fred/series/observations' : 'https://api.stlouisfed.org/fred/series/observations';
const getAlphaUrl = () => isLocal ? '/api-alphavantage/query' : 'https://www.alphavantage.co/query';
const getCoinMetricsUrl = () => isLocal ? '/api-coinmetrics/v4/timeseries/asset-metrics' : 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics';

// ─── BINANCE PUBLIC API ────────────────────────────────────────────────────────

/** BTC 24h ticker: price, % change, high, low, volume */
export const getBTCTicker24h = async (symbol = 'BTCUSDT') => {
  try {
    const res = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    return {
      price: parseFloat(res.data.lastPrice),
      change: parseFloat(res.data.priceChangePercent),
      high: parseFloat(res.data.highPrice),
      low: parseFloat(res.data.lowPrice),
      volume: parseFloat(res.data.quoteVolume),
    };
  } catch (e) {
    console.error('[API] BTC Ticker:', e.message);
    return null;
  }
};

/** BTC OHLCV candlestick data for charting */
export const getBTCKlines = async (symbol = 'BTCUSDT', interval = '1h', limit = 48) => {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit },
    });
    return res.data.map(k => ({
      time: new Date(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (e) {
    console.error('[API] Klines:', e.message);
    return [];
  }
};

/** Get CVD from the start of the local day using 5m klines */
export const getDailyCVD = async (symbol = 'BTCUSDT') => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // Local midnight
    const startTime = startOfDay.getTime();
    
    // 24 hours * 12 (5m intervals) = 288 candles, well under 1000 limit
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval: '5m', startTime, limit: 300 },
    });
    
    let initialCvd = 0;
    let initialBuyVol = 0;
    let initialSellVol = 0;
    
    res.data.forEach(k => {
      // k[7] = Quote asset volume, k[10] = Taker buy quote asset volume
      const quoteVol = parseFloat(k[7]);
      const takerBuyVol = parseFloat(k[10]);
      const takerSellVol = quoteVol - takerBuyVol;
      
      initialBuyVol += takerBuyVol;
      initialSellVol += takerSellVol;
      initialCvd += (takerBuyVol - takerSellVol);
    });
    
    return { initialCvd, initialBuyVol, initialSellVol, lastKlineTime: res.data.length > 0 ? res.data[res.data.length - 1][6] : startTime };
  } catch (e) {
    console.error('[API] Daily CVD:', e.message);
    return { initialCvd: 0, initialBuyVol: 0, initialSellVol: 0, lastKlineTime: 0 };
  }
};

/** Get CVD historical data (7d/30d) based on klines */
export const getHistoricalCVD = async (symbol = 'BTCUSDT', interval = '4h', limit = 42) => {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval, limit },
    });
    
    let cumulativeCvd = 0;
    return res.data.map(k => {
      // k[0]: open time, k[4]: close price, k[7]: quote asset volume, k[10]: taker buy quote asset volume
      const openTime = k[0];
      const closePrice = parseFloat(k[4]);
      const quoteVol = parseFloat(k[7]);
      const takerBuyVol = parseFloat(k[10]);
      const takerSellVol = quoteVol - takerBuyVol;
      const delta = takerBuyVol - takerSellVol;
      cumulativeCvd += delta;
      
      return {
        time: openTime,
        cvd: Math.round(cumulativeCvd),
        price: closePrice,
        delta: Math.round(delta)
      };
    });
  } catch (e) {
    console.error(`[API] Historical CVD (${interval}, ${limit}):`, e.message);
    return [];
  }
};

/**
 * Get intraday CVD chart data — same baseline as 1H LIVE mode.
 * Fetches 1H klines from LOCAL MIDNIGHT → now, accumulates CVD from 0.
 * Each point = one hourly candle, so the 24H chart matches the live WebSocket view.
 */
export const getIntradayCVD = async (symbol = 'BTCUSDT') => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0); // Local midnight (same as getDailyCVD)
    const startTime = startOfDay.getTime();

    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval: '1h', startTime, limit: 25 }, // max 25 = covers full day
    });

    let cumulativeCvd = 0;
    return res.data.map(k => {
      const openTime = k[0];
      const closePrice = parseFloat(k[4]);
      const quoteVol = parseFloat(k[7]);
      const takerBuyVol = parseFloat(k[10]);
      const takerSellVol = quoteVol - takerBuyVol;
      const delta = takerBuyVol - takerSellVol;
      cumulativeCvd += delta;

      return {
        time: openTime,
        cvd: Math.round(cumulativeCvd),
        price: closePrice,
        delta: Math.round(delta),
      };
    });
  } catch (e) {
    console.error('[API] Intraday CVD:', e.message);
    return [];
  }
};


/**
 * Lọc nến 1 phút có khối lượng Quote Asset (USD) lớn hơn threshold.
 * Tính toán Whale CVD dựa trên Taker Buy / Taker Sell của các nến đột biến này.
 */
export const getWhaleKlinesFlow = async (symbol = 'BTCUSDT', limit = 1000, volumeThreshold = 10000000) => {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol, interval: '1m', limit },
    });
    
    let whaleCvd = 0;
    let whaleBuyVol = 0;
    let whaleSellVol = 0;
    const spikeKlines = [];
    
    res.data.forEach(k => {
      const quoteVol = parseFloat(k[7]);
      if (quoteVol >= volumeThreshold) {
        const takerBuyVol = parseFloat(k[10]);
        const takerSellVol = quoteVol - takerBuyVol;
        
        whaleBuyVol += takerBuyVol;
        whaleSellVol += takerSellVol;
        const delta = takerBuyVol - takerSellVol;
        whaleCvd += delta;
        
        spikeKlines.push({
          time: new Date(k[0]),
          open: parseFloat(k[1]),
          close: parseFloat(k[4]),
          quoteVol,
          takerBuyVol,
          takerSellVol,
          delta,
          isBullish: takerBuyVol > takerSellVol
        });
      }
    });
    
    return { whaleCvd, whaleBuyVol, whaleSellVol, spikeKlines };
  } catch (e) {
    console.error('[API] Whale Klines Flow:', e.message);
    return { whaleCvd: 0, whaleBuyVol: 0, whaleSellVol: 0, spikeKlines: [] };
  }
};

/** Global Long/Short Account Ratio — last N periods */
export const getLongShortRatio = async (symbol = 'BTCUSDT', period = '1h', limit = 24) => {
  try {
    const res = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol, period, limit },
    });
    return res.data; // array sorted oldest→newest
  } catch (e) {
    console.error('[API] L/S Ratio:', e.message);
    return [];
  }
};

/** Current funding rate (% per 8h) */
export const getFundingRate = async (symbol = 'BTCUSDT') => {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/fundingRate', {
      params: { symbol, limit: 1 },
    });
    return res.data[0] ? parseFloat(res.data[0].fundingRate) : null;
  } catch (e) {
    console.error('[API] Funding Rate:', e.message);
    return null;
  }
};

/** Current Open Interest in BTC */
export const getOpenInterest = async (symbol = 'BTCUSDT') => {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
      params: { symbol },
    });
    return parseFloat(res.data.openInterest);
  } catch (e) {
    console.error('[API] Open Interest:', e.message);
    return null;
  }
};

/** Open Interest history for chart */
export const getOIHistory = async (symbol = 'BTCUSDT', period = '1h', limit = 24) => {
  try {
    const res = await axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
      params: { symbol, period, limit },
    });
    return res.data;
  } catch (e) {
    console.error('[API] OI History:', e.message);
    return [];
  }
};



// ─── COINGECKO (FREE TIER) ────────────────────────────────────────────────────

/** Global crypto market data: BTC dominance, total market cap, etc. */
export const getGlobalCryptoData = async () => {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/global');
    const d = res.data.data;
    return {
      btcDominance: d.market_cap_percentage?.btc?.toFixed(1) || null,
      ethDominance: d.market_cap_percentage?.eth?.toFixed(1) || null,
      totalMarketCap: d.total_market_cap?.usd || null,
      totalVolume: d.total_volume?.usd || null,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd?.toFixed(2) || null,
      activeCryptocurrencies: d.active_cryptocurrencies,
    };
  } catch (e) {
    console.error('[API] CoinGecko Global:', e.message);
    return null;
  }
};

/** Stablecoin market caps (USDT + USDC) as proxy for crypto "dry powder" */
export const getStablecoinData = async () => {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'tether,usd-coin',
        vs_currencies: 'usd',
        include_market_cap: 'true',
        include_24hr_change: 'true',
      },
    });
    const usdt = res.data?.tether?.usd_market_cap || 0;
    const usdc = res.data?.['usd-coin']?.usd_market_cap || 0;
    return {
      usdt,
      usdc,
      total: usdt + usdc,
      usdtChange: res.data?.tether?.usd_24h_change || 0,
    };
  } catch (e) {
    console.error('[API] Stablecoin:', e.message);
    return null;
  }
};

// ─── BLOCKCHAIN.INFO — BTC On-chain Network Stats (No API key required) ───────

/**
 * Lấy dữ liệu mạng lưới Bitcoin trực tiếp từ blockchain.info
 * Hash rate, Difficulty, Transaction count, Mempool, Avg fee
 */
export const getBTCOnChain = async () => {
  try {
    const res = await axios.get('https://blockchain.info/stats?format=json', { timeout: 8000 });
    const d = res.data;
    return {
      // Hash Rate: chuyển từ GH/s sang EH/s (Exahash)
      hashRate: d.hash_rate ? (d.hash_rate / 1e9).toFixed(2) : null,         // EH/s
      difficulty: d.difficulty ? (d.difficulty / 1e12).toFixed(2) : null,    // Trillion
      txCount24h: d.n_tx || null,
      totalBTC: d.totalbc ? (d.totalbc / 1e8).toFixed(0) : null,             // BTC mined
      minutesBetweenBlocks: d.minutes_between_blocks
        ? parseFloat(d.minutes_between_blocks).toFixed(1) : null,
      // Mempool: trung bình fee (satoshi/byte) từ estimated_transaction_volume
      avgTxSizeBytes: d.median_fee || null,
      productionCost: d.difficulty ? ((d.difficulty * 4294967296 * 26.0e-12 * 0.05) / (3.6e6 * 3.125) * 1.1).toFixed(0) : null,
    };
  } catch (e) {
    console.error('[API] Blockchain.info:', e.message);
    return null;
  }
};

// ─── COINMETRICS COMMUNITY — On-chain Metrics nâng cao (No API key required) ──

/**
 * Lấy on-chain metrics từ CoinMetrics Community API (miễn phí, không cần key)
 * Active Addresses, Transaction Count, NVT Ratio (proxy cho định giá on-chain)
 */
export const getBTCOnChainMetrics = async () => {
  try {
    const res = await axios.get(
      getCoinMetricsUrl(),
      {
        params: {
          assets: 'btc',
          metrics: 'AdrActCnt,TxCnt,CapMVRVCur',
          frequency: '1d',
          page_size: 2,
        },
        timeout: 10000,
      }
    );

    const items = res.data?.data;
    if (!items || items.length === 0) return null;

    // Lấy entry mới nhất có đủ data
    const latest = [...items].reverse().find(
      d => d.AdrActCnt && d.TxCnt
    );
    if (!latest) return null;

    return {
      activeAddresses: latest.AdrActCnt ? parseInt(latest.AdrActCnt).toLocaleString('en-US') : null,
      txCount: latest.TxCnt ? parseInt(latest.TxCnt).toLocaleString('en-US') : null,
      nvtRatio: null, // NVTAdj là chỉ số Pro, đặt null để tránh lỗi 403
      mvrv: latest.CapMVRVCur ? parseFloat(latest.CapMVRVCur).toFixed(2) : null,
      date: latest.time ? latest.time.split('T')[0] : null,
    };
  } catch (e) {
    console.error('[API] CoinMetrics:', e.message);
    return null;
  }
};

// ─── JINA READER — Đọc bất kỳ URL nào, không bị CORS (No API key required) ───

/**
 * Dùng Jina Reader để đọc nội dung bất kỳ webpage nào thành text/Markdown thuần.
 * Hữu ích để lấy dữ liệu từ các trang Việt Nam không có API.
 *
 * @param {string} url - URL đầy đủ của trang cần đọc (vd: https://cafef.vn)
 * @param {'text'|'json'} format - Định dạng trả về
 * @returns {Promise<string|null>} - Nội dung trang dưới dạng Markdown
 */
export const fetchWithJina = async (url, format = 'text') => {
  try {
    const headers = format === 'json'
      ? { 'Accept': 'application/json', 'X-Return-Format': 'json', 'x-no-cache': 'true' }
      : { 'Accept': 'text/plain', 'x-no-cache': 'true' };

    const res = await axios.get(`https://r.jina.ai/${url}`, {
      headers,
      timeout: 30000,
    });
    return res.data || null;
  } catch (e) {
    console.error('[API] Jina Reader:', e.message);
    return null;
  }
};

// ─── NEWS RSS & ECONOMIC CALENDAR (Today/Real-time Macro Events) ──────────────────

export const fetchRealtimeFeed = async () => {
  const now = new Date();
  let combined = [];

  // 1. Fetch economic calendar events from FairEconomy
  try {
    const rawData = await fetchWithJina('https://nfs.faireconomy.media/ff_calendar_thisweek.json', 'text');
    if (rawData) {
      const events = JSON.parse(rawData);
      if (Array.isArray(events)) {
        events.forEach(e => {
          if (!e.date) return;
          const eventTime = new Date(e.date);
          const t = eventTime.getTime();
          
          // Filter: within 24 hours of now + high impact + target countries (USD, EUR, JPY)
          const isNear = Math.abs(now.getTime() - t) <= 24 * 60 * 60 * 1000;
          const isHighImpact = e.impact?.toLowerCase() === 'high';
          const isTargetCountry = ['USD', 'JPY', 'EUR'].includes(e.country?.toUpperCase());
          
          if (isNear && isHighImpact && isTargetCountry) {
            combined.push({
              time: eventTime,
              tag: `Calendar (${e.country})`,
              cat: 'macro',
              title: `[LỊCH SỰ KIỆN] ${e.title} (Dự báo: ${e.forecast || 'N/A'}, Trước đó: ${e.previous || 'N/A'})`,
              link: 'https://www.forexfactory.com/calendar',
            });
          }
        });
      }
    }
  } catch (e) {
    console.error('[API] Error fetching economic calendar:', e.message);
  }

  // 2. Fetch geopolitical, war, and interest rate news from Google News search
  try {
    const query = encodeURIComponent('war OR conflict OR military OR geopolitics OR "interest rate" OR "lãi suất" OR Fed OR BOJ OR ECB');
    const googleNewsUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    const res = await axios.get(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(googleNewsUrl)}`, { timeout: 8000 });
    
    if (res.data?.status === 'ok' && Array.isArray(res.data.items)) {
      res.data.items.forEach(item => {
        if (!item.pubDate) return;
        const pubDate = new Date(item.pubDate);
        
        // Filter: within the last 24 hours
        if (now.getTime() - pubDate.getTime() <= 24 * 60 * 60 * 1000) {
          combined.push({
            time: pubDate,
            tag: 'Geopolitics/Macro',
            cat: 'macro',
            title: item.title || '',
            link: item.link || '',
          });
        }
      });
    }
  } catch (e) {
    console.error('[API] Error fetching geopolitical news:', e.message);
  }

  // 3. Fetch specific crypto news from Google News search
  try {
    const cryptoQuery = encodeURIComponent('(site:coindesk.com OR site:bloomberg.com/crypto OR site:reuters.com OR site:theblock.co OR site:glassnode.com) AND (bitcoin OR crypto OR cryptocurrency)');
    const cryptoNewsUrl = `https://news.google.com/rss/search?q=${cryptoQuery}&hl=en-US&gl=US&ceid=US:en&_cb=${now.getTime()}`;
    const res = await axios.get(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(cryptoNewsUrl)}&api_key=`, { timeout: 8000 });
    
    if (res.data?.status === 'ok' && Array.isArray(res.data.items)) {
      res.data.items.forEach(item => {
        if (!item.pubDate) return;
        const pubDate = new Date(item.pubDate);
        
        // Filter: within the last 48 hours to get enough crypto news
        if (now.getTime() - pubDate.getTime() <= 48 * 60 * 60 * 1000) {
          combined.push({
            time: pubDate,
            tag: 'Crypto News',
            cat: 'crypto',
            title: item.title || '',
            link: item.link || '',
          });
        }
      });
    }
  } catch (e) {
    console.error('[API] Error fetching crypto news:', e.message);
  }

  return combined
    .sort((a, b) => b.time - a.time)
    .map(item => ({ ...item, timeStr: item.time.toLocaleString('vi-VN') }));
};

// ─── COINALYZE API — REMOVED ───────────────────────────────────────────────────
// ─── ORDER BOOK DEPTH — OBI (Order Book Imbalance) ────────────────────────────

// Helper for OKX Contract Sizes (BTC = 0.01, ETH = 0.1, others default to 1.0)
const getOKXContractSize = (symbol) => {
  const sym = symbol.toUpperCase();
  if (sym.startsWith('BTC')) return 0.01;
  if (sym.startsWith('ETH')) return 0.1;
  if (sym.startsWith('SOL')) return 1;
  return 1; // Fallback
};

/**
 * Lấy order book từ Futures của top 4 sàn lớn nhất (Binance, Bybit, OKX, Bitget).
 * Tính OBI = (ΣBid - ΣAsk) / (ΣBid + ΣAsk)
 */
export const getOrderBookDepth = async (symbol = 'BTCUSDT', limit = 100) => {
  const symbolUpper = symbol.toUpperCase();
  const base = symbolUpper.replace('USDT', '');
  const symbolOKXFutures = `${base}-USDT-SWAP`;

  const bybitLimit = Math.min(limit, 500);
  const okxLimit = Math.min(limit, 400);

  let bitgetLimit = 100;
  if (limit <= 5) bitgetLimit = 5;
  else if (limit <= 15) bitgetLimit = 15;
  else if (limit <= 50) bitgetLimit = 50;
  else if (limit <= 100) bitgetLimit = 100;
  else bitgetLimit = 'max';

  const urls = {
    binance: `https://fapi.binance.com/fapi/v1/depth?symbol=${symbolUpper}&limit=${limit}`,
    bybit: `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbolUpper}&limit=${bybitLimit}`,
    okx: `https://www.okx.com/api/v5/market/books?instId=${symbolOKXFutures}&sz=${okxLimit}`,
    bitget: `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${symbolUpper}&productType=usdt-futures&limit=${bitgetLimit}`
  };

  const fetchSource = async (name, url, parser) => {
    try {
      const res = await axios.get(url, { timeout: 4000 });
      return parser(res.data);
    } catch (e) {
      console.warn(`[API - OrderBook] Failed to fetch OBI depth from ${name}:`, e.message);
      return { bids: [], asks: [] };
    }
  };

  const binanceParser = (data) => ({
    bids: data.bids || [],
    asks: data.asks || []
  });

  const bybitParser = (data) => ({
    bids: data.result?.b || [],
    asks: data.result?.a || []
  });

  const okxParser = (data) => ({
    bids: data?.data?.[0]?.bids || [],
    asks: data?.data?.[0]?.asks || []
  });

  const bitgetParser = (data) => ({
    bids: data?.data?.bids || [],
    asks: data?.data?.asks || []
  });

  try {
    const sourceNames = ['Binance Futures', 'Bybit Futures', 'OKX Futures', 'Bitget Futures'];
    const parsers = [binanceParser, bybitParser, okxParser, bitgetParser];

    const results = await Promise.all([
      fetchSource('Binance Futures', urls.binance, binanceParser),
      fetchSource('Bybit Futures', urls.bybit, bybitParser),
      fetchSource('OKX Futures', urls.okx, okxParser),
      fetchSource('Bitget Futures', urls.bitget, bitgetParser)
    ]);

    let totalBidVol = 0;
    let totalAskVol = 0;
    let binanceBestBid = 0;
    let binanceBestAsk = 0;

    const okxScale = getOKXContractSize(symbol);

    results.forEach((r, idx) => {
      const sourceName = sourceNames[idx];
      const bids = r.bids;
      const asks = r.asks;

      const scale = sourceName === 'OKX Futures' ? okxScale : 1.0;

      const bidVol = bids.reduce((sum, [, q]) => sum + parseFloat(q) * scale, 0);
      const askVol = asks.reduce((sum, [, q]) => sum + parseFloat(q) * scale, 0);

      totalBidVol += bidVol;
      totalAskVol += askVol;

      if (sourceName === 'Binance Futures') {
        binanceBestBid = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
        binanceBestAsk = asks.length > 0 ? parseFloat(asks[0][0]) : 0;
      }
    });

    const total = totalBidVol + totalAskVol;
    const obi = total > 0 ? ((totalBidVol - totalAskVol) / total) : 0; // -1 to +1
    const spread = binanceBestBid > 0 ? ((binanceBestAsk - binanceBestBid) / binanceBestBid * 100) : 0;

    const midPrice = (binanceBestBid + binanceBestAsk) / 2 || 60000;
    const bidVolUsd = totalBidVol * midPrice;
    const askVolUsd = totalAskVol * midPrice;

    // Calculate OBI for each individual exchange
    const exchanges = results.map((r, idx) => {
      const sourceName = sourceNames[idx];
      const scale = sourceName === 'OKX Futures' ? okxScale : 1.0;
      const bidVol = r.bids.reduce((sum, [, q]) => sum + parseFloat(q) * scale, 0);
      const askVol = r.asks.reduce((sum, [, q]) => sum + parseFloat(q) * scale, 0);
      const tot = bidVol + askVol;
      const exObi = tot > 0 ? ((bidVol - askVol) / tot) * 100 : 0;
      return {
        name: sourceName.replace(' Futures', '').replace(' Spot', '').replace('Binance', 'BIN').replace('Bybit', 'BYB').replace('OKX', 'OKX').replace('Bitget', 'BGT').replace('Coinbase', 'COIN'),
        obi: parseFloat(exObi.toFixed(1))
      };
    });

    return {
      obi: parseFloat(obi.toFixed(4)),           // -1 to +1
      obiPercent: parseFloat((obi * 100).toFixed(1)), // -100 to +100
      spread: parseFloat(spread.toFixed(4)),      // %
      bestBid: binanceBestBid,
      bestAsk: binanceBestAsk,
      bidVolBtc: parseFloat(totalBidVol.toFixed(2)),
      askVolBtc: parseFloat(totalAskVol.toFixed(2)),
      bidVolUsd: Math.round(bidVolUsd),
      askVolUsd: Math.round(askVolUsd),
      signal: obi > 0.15 ? 'BUY PRESSURE' : obi < -0.15 ? 'SELL PRESSURE' : 'BALANCED',
      signalCls: obi > 0.15 ? 'text-emerald' : obi < -0.15 ? 'text-rose' : 'text-slate-400',
      exchanges
    };
  } catch (e) {
    console.error('[API] Aggregated Order Book OBI Error:', e.message);
    return null;
  }
};

// ─── WHALE WALLS — Large Limit Orders ≥ $500K ────────────────────────────────

/**
 * Lấy order book sâu từ top 4 sàn lớn nhất (Binance, Bybit, OKX, Bitget).
 * Lọc các lệnh giới hạn có giá trị ≥ $500K USD.
 */
export const getWhaleWalls = async (symbol = 'BTCUSDT', minUsd = 500000) => {
  const symbolUpper = symbol.toUpperCase();
  const base = symbolUpper.replace('USDT', '');
  const symbolOKXSpot = `${base}-USDT`;
  const symbolOKXFutures = `${base}-USDT-SWAP`;

  const urls = {
    binanceFutures: `https://fapi.binance.com/fapi/v1/depth?symbol=${symbolUpper}&limit=1000`,
    binanceSpot: `https://api.binance.com/api/v3/depth?symbol=${symbolUpper}&limit=1000`,
    bybitFutures: `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbolUpper}&limit=500`,
    bybitSpot: `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbolUpper}&limit=500`,
    okxFutures: `https://www.okx.com/api/v5/market/books?instId=${symbolOKXFutures}&sz=400`,
    okxSpot: `https://www.okx.com/api/v5/market/books?instId=${symbolOKXSpot}&sz=400`,
    bitgetFutures: `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${symbolUpper}&productType=usdt-futures&limit=max`,
    bitgetSpot: `https://api.bitget.com/api/v2/spot/market/merge-depth?symbol=${symbolUpper}&limit=max`
  };

  const fetchSource = async (name, url, parser) => {
    try {
      const res = await axios.get(url, { timeout: 5000 });
      return parser(res.data);
    } catch (e) {
      console.warn(`[API - OrderBook] Failed to fetch whale walls from ${name}:`, e.message);
      return { bids: [], asks: [] };
    }
  };

  const binanceParser = (data) => ({
    bids: data.bids || [],
    asks: data.asks || []
  });

  const bybitParser = (data) => ({
    bids: data.result?.b || [],
    asks: data.result?.a || []
  });

  const okxParser = (data) => ({
    bids: data?.data?.[0]?.bids || [],
    asks: data?.data?.[0]?.asks || []
  });

  const bitgetParser = (data) => ({
    bids: data?.data?.bids || [],
    asks: data?.data?.asks || []
  });

  try {
    const sourceNames = [
      'Binance Futures', 'Binance Spot',
      'Bybit Futures', 'Bybit Spot',
      'OKX Futures', 'OKX Spot',
      'Bitget Futures', 'Bitget Spot'
    ];
    const parsers = [
      binanceParser, binanceParser,
      bybitParser, bybitParser,
      okxParser, okxParser,
      bitgetParser, bitgetParser
    ];

    const results = await Promise.all([
      fetchSource('Binance Futures', urls.binanceFutures, binanceParser),
      fetchSource('Binance Spot', urls.binanceSpot, binanceParser),
      fetchSource('Bybit Futures', urls.bybitFutures, bybitParser),
      fetchSource('Bybit Spot', urls.bybitSpot, bybitParser),
      fetchSource('OKX Futures', urls.okxFutures, okxParser),
      fetchSource('OKX Spot', urls.okxSpot, okxParser),
      fetchSource('Bitget Futures', urls.bitgetFutures, bitgetParser),
      fetchSource('Bitget Spot', urls.bitgetSpot, bitgetParser)
    ]);

    const bidsMap = new Map();
    const asksMap = new Map();
    const okxScale = getOKXContractSize(symbol);

    const processLevels = (levels, map, sourceName) => {
      const scale = sourceName === 'OKX Futures' ? okxScale : 1.0;
      for (const level of levels) {
        if (!level || level.length < 2) continue;
        const price = parseFloat(level[0]);
        const qty = parseFloat(level[1]) * scale;
        if (isNaN(price) || isNaN(qty) || qty <= 0) continue;
        const usdValue = price * qty;
        const roundedPrice = Math.round(price); // Group by integer USD price level
        
        if (!map.has(roundedPrice)) {
          map.set(roundedPrice, { price: roundedPrice, qty: 0, usdValue: 0, sources: {} });
        }
        const entry = map.get(roundedPrice);
        entry.qty += qty;
        entry.usdValue += usdValue;
        if (!entry.sources[sourceName]) entry.sources[sourceName] = 0;
        entry.sources[sourceName] += usdValue;
      }
    };

    results.forEach((r, idx) => {
      processLevels(r.bids, bidsMap, sourceNames[idx]);
      processLevels(r.asks, asksMap, sourceNames[idx]);
    });

    const filterAndFormat = (map, side) =>
      Array.from(map.values())
        .filter(o => o.usdValue >= minUsd)
        .sort((a, b) => b.usdValue - a.usdValue)
        .map(o => ({
          price: o.price,
          qty: o.qty,
          usdValue: o.usdValue,
          side,
          sources: o.sources
        }));

    const whaleBids = filterAndFormat(bidsMap, 'BID');
    const whaleAsks = filterAndFormat(asksMap, 'ASK');

    const bidWallTotal = whaleBids.reduce((s, o) => s + o.usdValue, 0);
    const askWallTotal = whaleAsks.reduce((s, o) => s + o.usdValue, 0);

    const wallTotal = bidWallTotal + askWallTotal;
    const bidRatio = wallTotal > 0 ? bidWallTotal / wallTotal : 0.5;

    return {
      whaleBids: whaleBids.slice(0, 15),
      whaleAsks: whaleAsks.slice(0, 15),
      bidWallTotal,
      askWallTotal,
      bidRatio: parseFloat(bidRatio.toFixed(3)),
      signal: bidRatio > 0.6 ? 'Smart money đỡ giá ↑' : bidRatio < 0.4 ? 'Tường bán áp đảo ↓' : 'Cân bằng',
      signalCls: bidRatio > 0.6 ? 'text-emerald' : bidRatio < 0.4 ? 'text-rose' : 'text-slate-400',
    };
  } catch (e) {
    console.error('[API] Whale Walls Aggregation Error:', e.message);
    return null;
  }
};

// ─── CORS PROXY HELPER ─────────────────────────────────────────────────────────

/**
 * Fallback mechanism trying multiple public CORS proxies sequentially.
 */
const fetchWithProxyFallback = async (targetUrlStr, params) => {
  const targetUrl = new URL(targetUrlStr);
  Object.keys(params).forEach(key => targetUrl.searchParams.append(key, params[key]));
  const fullUrl = targetUrl.toString();
  
  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(fullUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(fullUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(fullUrl)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await axios.get(proxyUrl, { timeout: 8000 });
      let data = res.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }
      if (data && typeof data === 'object') {
        return data;
      }
    } catch (e) {
      console.warn(`[Proxy Fallback] Failed for ${proxyUrl.split('?')[0]}`, e.message);
    }
  }
  throw new Error('All CORS proxies failed');
};

const getFredGraphUrl = (seriesId, units = 'lin') => {
  const unitsParam = units !== 'lin' ? `&units=${units}` : '';
  return isLocal
    ? `/api-fred-graph/graph/fredgraph.csv?id=${seriesId}${unitsParam}`
    : `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}${unitsParam}`;
};

// ─── HELPER FOR TEXT-BASED PROXY FALLBACK ─────────────────────────────────────
const fetchTextWithProxyFallback = async (targetUrlStr) => {
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrlStr)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrlStr)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrlStr)}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await axios.get(proxyUrl, { timeout: 15000 });
      let data = res.data;
      if (data && typeof data === 'object' && data.contents) {
        data = data.contents;
      }
      if (data && typeof data === 'string') {
        // Skip HTML responses (usually Cloudflare block pages or error pages)
        if (data.trim().startsWith('<')) {
          console.warn(`[Proxy Fallback Text] Skipping HTML response from ${proxyUrl.split('?')[0]}`);
          continue;
        }
        return data;
      }
    } catch (e) {
      console.warn(`[Proxy Fallback Text] Failed for ${proxyUrl.split('?')[0]}:`, e.message);
    }
  }
  throw new Error('All CORS proxies failed for text fetch');
};

// ─── TRADING ECONOMICS HTML SCRAPER (FALLBACK CHO FRED) ───────────────────────
export const getTEMetric = async (indicatorPath) => {
  try {
    const url = `https://r.jina.ai/https://tradingeconomics.com/united-states/${indicatorPath}`;
    const res = await axios.get(url, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    const content = res.data;
    if (!content) return null;
    
    const lines = content.split('\n');
    let actualIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('| Actual | Previous |')) {
        const headers = lines[i].split('|').map(s => s.trim());
        actualIndex = headers.indexOf('Actual');
      } else if (actualIndex !== -1 && lines[i].includes('|') && !lines[i].includes('---')) {
        const cols = lines[i].split('|').map(s => s.trim());
        if (cols.length > actualIndex) {
          const val = parseFloat(cols[actualIndex]);
          if (!isNaN(val)) return val;
        }
      }
    }
  } catch (e) {
    console.warn(`[API] TE scrape failed for ${indicatorPath}:`, e.message);
  }
  return null;
};

// ─── YCHARTS HIGH YIELD CRAWLER (FALLBACK CHO FRED SPREAD) ─────────────────────
export const getYChartsHighYield = async () => {
  try {
    const url = 'https://r.jina.ai/https://ycharts.com/indicators/us_high_yield_master_ii_optionadjusted_spread';
    const res = await axios.get(url, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    const content = res.data;
    if (!content) return null;

    const match = content.match(/is at\s+([\d\.]+)%/i) || 
                  content.match(/Last Value\s+([\d\.]+)%/i) || 
                  content.match(/value\s+of\s+([\d\.]+)%/i);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val)) return val;
    }
  } catch (e) {
    console.warn('[API] YCharts High Yield scrape failed:', e.message);
  }
  return null;
};

// ─── U.S. TREASURY DAILY STATEMENT API (FALLBACK CHO FRED TGA) ───────────────
export const getTGATreasuryAPI = async () => {
  try {
    const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=account_type:eq:Treasury General Account (TGA) Closing Balance&sort=-record_date&page[size]=1';
    const res = await axios.get(url, { timeout: 10000 });
    const item = res.data?.data?.[0];
    if (item && item.open_today_bal) {
      const val = parseFloat(item.open_today_bal);
      if (!isNaN(val)) return val; // returns in millions, e.g., 844521
    }
  } catch (e) {
    console.warn('[API] US Treasury TGA API failed:', e.message);
  }
  return null;
};

// ─── OFFICIAL FRED API CLIENT HELPER ──────────────────────────────────────────
export const getFredAPIMetric = async (seriesId, apiKey) => {
  const key = apiKey || (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FRED_API_KEY : null);
  if (!key || key === 'your_fred_key_here') return null;

  const url = getFredUrl();
  try {
    const res = await axios.get(url, {
      params: {
        series_id: seriesId,
        api_key: key,
        file_type: 'json',
        sort_order: 'desc',
        limit: 1
      },
      timeout: 8000
    });
    const observations = res.data?.observations;
    if (observations && observations.length > 0) {
      const val = parseFloat(observations[0].value);
      if (!isNaN(val)) return val;
    }
  } catch (e) {
    console.error(`[API] FRED API request failed for ${seriesId}:`, e.message);
  }
  return null;
};


// ─── KEYLESS FRED CSV PARSER ──────────────────────────────────────────────────
export const getFredCSVMetric = async (seriesId, units = 'lin') => {
  const url = getFredGraphUrl(seriesId, units);
  
  const parseFredCSV = (csvText) => {
    if (!csvText) return null;
    const lines = csvText.trim().split('\n').map(l => l.split(','));
    for (let i = lines.length - 1; i >= 1; i--) {
      if (lines[i] && lines[i][1]) {
        const val = lines[i][1].trim();
        if (val && val !== '.' && val !== '') {
          const parsed = parseFloat(val);
          if (!isNaN(parsed)) return parsed;
        }
      }
    }
    return null;
  };

  try {
    const res = await axios.get(url, { timeout: 8000 });
    if (res.data && typeof res.data === 'string') {
      return parseFredCSV(res.data);
    }
  } catch (e) {
    if (isLocal) {
      console.error(`[API] FRED CSV dev proxy error for ${seriesId}:`, e.message);
    } else {
      console.warn(`[API] FRED CSV direct fetch failed for ${seriesId}, trying via proxy... Error:`, e.message);
    }
  }

  // 3. Nếu không phải local, thử dùng AllOrigins cho FRED CSV (có thể vẫn bị Cloudflare block)
  if (!isLocal) {
    try {
      const unitsParam = units !== 'lin' ? `&units=${units}` : '';
      const text = await fetchTextWithProxyFallback(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}${unitsParam}`);
      return parseFredCSV(text);
    } catch (proxyError) {
      console.error(`[API] FRED CSV proxy request failed for ${seriesId}:`, proxyError.message);
    }
  }
  return null;
};

// ─── YAHOO FINANCE STOCK/INDEX QUOTE ──────────────────────────────────────────
export const getYahooStockQuote = async (ticker) => {
  const url = isLocal 
    ? `/api-yahoo/v8/finance/chart/${ticker}` 
    : `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}`;
  const params = {
    interval: '1d',
    range: '1d',
  };

  const parseYahooMeta = (data) => {
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta) {
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || meta.previousClose;
      let changePercent = 0;
      if (price && prev) {
        changePercent = ((price - prev) / prev) * 100;
      }
      return { price, changePercent };
    }
    return null;
  };

  // 1. Try direct or Vite proxy
  try {
    const res = await axios.get(url, {
      params,
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const parsed = parseYahooMeta(res.data);
    if (parsed) return parsed;
  } catch (e) {
    if (isLocal) {
      console.error(`[API] Yahoo dev proxy error for ${ticker}:`, e.message);
    } else {
      console.warn(`[API] Yahoo direct failed for ${ticker}, trying proxy... Error:`, e.message);
    }
  }

  // 2. Try Jina Reader CORS proxy fallback
  try {
    const targetUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
    const jinaUrl = `https://r.jina.ai/${targetUrl}`;
    const res = await axios.get(jinaUrl, {
      headers: {
        'Accept': 'application/json',
        'X-Return-Format': 'json'
      },
      timeout: 12000
    });
    const content = res.data?.data?.content;
    if (content) {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```[a-zA-Z]*\n?/, '');
        cleanContent = cleanContent.replace(/```$/, '');
        cleanContent = cleanContent.trim();
      }
      const data = JSON.parse(cleanContent);
      const parsed = parseYahooMeta(data);
      if (parsed) return parsed;
    }
  } catch (jinaError) {
    console.warn(`[API] Yahoo Jina proxy failed for ${ticker}:`, jinaError.message);
  }

  // 3. Try AllOrigins CORS proxy fallback
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`${url}?interval=1d&range=1d`)}`;
    const res = await axios.get(proxyUrl, { timeout: 8000 });
    let data = res.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch {}
    }
    const contentsStr = data?.contents;
    if (contentsStr) {
      const parsedData = JSON.parse(contentsStr);
      const parsed = parseYahooMeta(parsedData);
      if (parsed) return parsed;
    }
  } catch (proxyError) {
    console.error(`[API] Yahoo proxy failed for ${ticker}:`, proxyError.message);
  }
  return null;
};

// ─── YAHOO FINANCE 10Y TREASURY YIELD ─────────────────────────────────────────
export const getYahoo10YYield = async () => {
  const quote = await getYahooStockQuote('^TNX');
  if (quote && quote.price) {
    return parseFloat(quote.price.toFixed(3));
  }
  return null;
};

// ─── NEW YORK FED REVERSE REPO API ────────────────────────────────────────────
export const getReverseRepo = async () => {
  const url = 'https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json';
  
  const parseNYFed = (data) => {
    const ops = data?.repo?.operations;
    if (ops && ops.length > 0) {
      const latestOp = ops.find(o => o.totalAmtAccepted != null);
      if (latestOp) {
        // totalAmtAccepted is in USD thousands, e.g. 761000000 thousands = 761 billion
        return parseFloat((latestOp.totalAmtAccepted / 1000000).toFixed(3));
      }
    }
    return null;
  };

  try {
    const res = await axios.get(url, { timeout: 8000 });
    const parsed = parseNYFed(res.data);
    if (parsed !== null) return parsed;
  } catch (e) {
    console.warn('[API] NY Fed RRP direct request failed, trying proxy... Error:', e.message);
  }

  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await axios.get(proxyUrl, { timeout: 8000 });
    let data = res.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch {}
    }
    const contentsStr = data?.contents;
    if (contentsStr) {
      const parsedData = JSON.parse(contentsStr);
      const parsed = parseNYFed(parsedData);
      if (parsed !== null) return parsed;
    }
  } catch (proxyError) {
    console.error('[API] NY Fed RRP proxy request failed:', proxyError.message);
  }
  return null;
};


// ─── BACKWARD COMPATIBILITY FRED API WRAPPERS ─────────────────────────────────
export const getFREDMetric = async (seriesId, apiKey) => {
  // 1. Try official FRED API if apiKey is provided or available in env
  const officialVal = await getFredAPIMetric(seriesId, apiKey);
  if (officialVal !== null) return officialVal;

  // 2. Fallbacks for specific indicators
  if (seriesId === 'DGS10') {
    return getYahoo10YYield();
  }
  if (seriesId === 'RRPONTSYD') {
    return getReverseRepo();
  }
  if (seriesId === 'WDTGAL') {
    const tgaVal = await getTGATreasuryAPI();
    if (tgaVal !== null) return tgaVal;
  }
  if (seriesId === 'BAMLH0A0HYM2EY') {
    const hyVal = await getYChartsHighYield();
    if (hyVal !== null) return hyVal;
  }
  
  const teMap = {
    'FEDFUNDS': 'interest-rate',
    'CPIAUCSL': 'inflation-cpi',
    'UNRATE': 'unemployment-rate',
    'M2SL': 'money-supply-m2',
    'WALCL': 'central-bank-balance-sheet'
  };
  if (teMap[seriesId]) {
    const teVal = await getTEMetric(teMap[seriesId]);
    if (teVal !== null) return teVal;
  }
  
  // 3. Last resort fallback
  return getFredCSVMetric(seriesId);
};

export const getFREDStockQuote = async (seriesId, apiKey) => {
  let quote = null;
  if (seriesId === 'SP500') {
    quote = await getYahooStockQuote('^GSPC');
  } else if (seriesId === 'NASDAQ100') {
    quote = await getYahooStockQuote('^NDX');
  } else if (seriesId === 'VIXCLS') {
    quote = await getYahooStockQuote('^VIX');
  }
  
  if (quote) return quote;

  // Fallback
  const rawVal = await getFredCSVMetric(seriesId);
  if (rawVal !== null) {
    return { price: rawVal, changePercent: 0 };
  }
  return null;
};


// ─── YAHOO FINANCE API (U.S. Dollar Index DXY) ──────────────────────────────────
export const getDXYQuote = async () => {
  const quote = await getYahooStockQuote('DX-Y.NYB');
  if (quote && quote.price) {
    return parseFloat(quote.price.toFixed(3));
  }
  return null;
};

// ─── ALPHA VANTAGE API (Equities & Volatility ETFs) ─────────────────────────────
export const getAlphaVantageQuote = async (symbol, apiKey) => {
  if (!apiKey) return null;
  const url = getAlphaUrl();
  const params = {
    function: 'GLOBAL_QUOTE',
    symbol,
    apikey: apiKey,
  };

  try {
    const res = await axios.get(url, { params, timeout: 8000 });
    const quote = res.data?.['Global Quote'];
    if (quote && quote['05. price']) {
      return {
        price: parseFloat(quote['05. price']),
        changePercent: parseFloat(quote['10. change percent']?.replace('%', '') || 0),
      };
    }
    if (res.data?.Note || res.data?.Information) {
      console.warn(`[API] Alpha Vantage rate limit or note:`, res.data.Note || res.data.Information);
    }
    return null;
  } catch (e) {
    if (isLocal) {
      console.error(`[API] Alpha Vantage dev proxy error for ${symbol}:`, e.message);
      return null;
    }
    console.warn(`[API] Alpha Vantage direct request failed for ${symbol}, trying via CORS proxy... Error:`, e.message);
    try {
      const data = await fetchWithProxyFallback('https://www.alphavantage.co/query', params);
      const quote = data?.['Global Quote'];
      if (quote && quote['05. price']) {
        return {
          price: parseFloat(quote['05. price']),
          changePercent: parseFloat(quote['10. change percent']?.replace('%', '') || 0),
        };
      }
      if (data?.Note || data?.Information) {
        console.warn(`[API] Alpha Vantage proxy rate limit or note:`, data.Note || data.Information);
      }
      return null;
    } catch (proxyError) {
      console.error(`[API] Alpha Vantage proxy request failed for ${symbol}:`, proxyError.message);
      return null;
    }
  }
};

// ─── ETF DATA CRAWLERS (Bitbo & Farside) ──────────────────────────────────────

/**
 * Lấy số lượng nắm giữ Bitcoin hiện tại của các quỹ ETF từ Bitbo.io qua proxy
 */
export const getETFHoldings = async () => {
  try {
    const url = isLocal ? '/api-bitbo/etf/' : 'https://bitbo.io/etf/';
    let html = '';
    
    try {
      const res = await axios.get(url, { timeout: 8000 });
      html = res.data;
    } catch (err) {
      console.warn('[API] ETF holdings proxy fetch failed, trying Jina Reader...', err.message);
      html = await fetchWithJina('https://bitbo.io/etf/', 'text');
      if (!html) {
        throw new Error('Jina Reader returned empty content for Bitbo');
      }
      return parseETFHoldingsFromMarkdown(html);
    }
    
    // Parse Nuxt state từ HTML
    const match = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);?<\/script>/);
    if (!match) {
      throw new Error('Nuxt state not found in HTML');
    }
    
    const nuxtExpr = match[1];
    const getNuxt = new Function(`return ${nuxtExpr};`);
    const state = getNuxt();
    const dataObj = state.data?.[0];
    
    if (dataObj && dataObj.funds) {
      return parseETFFundsObject(dataObj.funds);
    }
    throw new Error('Funds object not found in Nuxt state');
  } catch (e) {
    console.error('[API] ETF Holdings error:', e.message);
    return null;
  }
};

// Hàm helper để map object funds từ Nuxt sang định dạng UI
const parseETFFundsObject = (funds) => {
  const getBtc = (fundKey) => funds[fundKey]?.btc ? Math.round(parseFloat(funds[fundKey].btc)) : 0;
  
  const ibit = getBtc('IBIT');
  const gbtc = getBtc('GBTC');
  const fbtc = getBtc('FBTC');
  
  const othersKeys = ['ARKB', 'BITB', 'BRRR', 'BTC', 'BTCO', 'BTCW', 'EZBC', 'HODL', 'DEFI', 'MSBT'];
  const others = othersKeys.reduce((sum, key) => sum + getBtc(key), 0);
  
  const total = ibit + gbtc + fbtc + others;
  
  return {
    funds: [
      { name: 'BlackRock (IBIT)', holdings: ibit, marketShare: total > 0 ? `${((ibit / total) * 100).toFixed(1)}%` : '0%' },
      { name: 'Grayscale (GBTC)', holdings: gbtc, marketShare: total > 0 ? `${((gbtc / total) * 100).toFixed(1)}%` : '0%' },
      { name: 'Fidelity (FBTC)', holdings: fbtc, marketShare: total > 0 ? `${((fbtc / total) * 100).toFixed(1)}%` : '0%' },
      { name: 'Others (ARKB, BITB...)', holdings: others, marketShare: total > 0 ? `${((others / total) * 100).toFixed(1)}%` : '0%' },
    ],
    total
  };
};

// Hàm helper để parse holdings từ Markdown (Jina Reader) trong trường hợp proxy lỗi
const parseETFHoldingsFromMarkdown = (markdown) => {
  try {
    const nuxtMatch = markdown.match(/window\.__NUXT__\s*=\s*([\s\S]*?);/);
    if (nuxtMatch) {
      const getNuxt = new Function(`return ${nuxtMatch[1]};`);
      const state = getNuxt();
      const dataObj = state.data?.[0];
      if (dataObj && dataObj.funds) {
        return parseETFFundsObject(dataObj.funds);
      }
    }

    const ibitMatch = markdown.match(/IBIT[\s\S]*?btc:\s*"([^"]+)"/) || markdown.match(/Blackrock[\s\S]*?btc:\s*"([^"]+)"/);
    const gbtcMatch = markdown.match(/GBTC[\s\S]*?btc:\s*"([^"]+)"/) || markdown.match(/Grayscale[\s\S]*?btc:\s*"([^"]+)"/);
    const fbtcMatch = markdown.match(/FBTC[\s\S]*?btc:\s*"([^"]+)"/) || markdown.match(/Fidelity[\s\S]*?btc:\s*"([^"]+)"/);
    
    if (ibitMatch && gbtcMatch && fbtcMatch) {
      const ibit = Math.round(parseFloat(ibitMatch[1]));
      const gbtc = Math.round(parseFloat(gbtcMatch[1]));
      const fbtc = Math.round(parseFloat(fbtcMatch[1]));
      
      let others = 159118;
      const total = ibit + gbtc + fbtc + others;
      
      return {
        funds: [
          { name: 'BlackRock (IBIT)', holdings: ibit, marketShare: `${((ibit / total) * 100).toFixed(1)}%` },
          { name: 'Grayscale (GBTC)', holdings: gbtc, marketShare: `${((gbtc / total) * 100).toFixed(1)}%` },
          { name: 'Fidelity (FBTC)', holdings: fbtc, marketShare: `${((fbtc / total) * 100).toFixed(1)}%` },
          { name: 'Others (ARKB, BITB...)', holdings: others, marketShare: `${((others / total) * 100).toFixed(1)}%` },
        ],
        total
      };
    }
  } catch (err) {
    console.error('[API] parseETFHoldingsFromMarkdown error:', err.message);
  }
  return null;
};

/**
 * Lấy lịch sử dòng tiền ETF từ Farside Investors
 * - Sử dụng dữ liệu tĩnh đã bundled sẵn (đến 18/06/26) làm base
 * - Thử fetch trang /btc/ (hiện tại) để bổ sung các ngày mới nhất
 */
export const getETFFlowHistory = async () => {
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };

  const parseFlowValue = (str) => {
    if (!str) return NaN;
    let clean = str.replace(/,/g, '').trim();
    if (clean.includes('(') && clean.includes(')')) {
      return -parseFloat(clean.replace(/[()]/g, ''));
    }
    return parseFloat(clean);
  };

  // Start with bundled static data (Jan 2024 → Jun 2026)
  const baseHistory = [...staticFlowHistory];
  const lastStaticDate = baseHistory.length > 0 ? baseHistory[baseHistory.length - 1].date : null;
  
  // Try to fetch new rows from /btc/ (current month page - less protected)
  try {
    const content = await fetchWithJina('https://farside.co.uk/btc/', 'text');
    if (content && content.includes('|')) {
      const newRows = [];
      const lines = content.split('\n');
      const dateRegex = /^\s*\|\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*\|/;
      for (const line of lines) {
        const match = line.match(dateRegex);
        if (match) {
          const dateStr = match[1];
          const cells = line.split('|').map(c => c.trim());
          const totalStr = cells[cells.length - 2];
          const flowVal = parseFlowValue(totalStr);
          if (!isNaN(flowVal)) {
            const parts = dateStr.trim().split(/\s+/);
            const day = parts[0].padStart(2, '0');
            const monthStr = parts[1].substring(0, 3);
            const year = parts[2];
            const month = months[monthStr] || '01';
            const formattedDate = `${day}/${month}/${year ? year.substring(2) : '26'}`;
            // Only add rows newer than last static date
            if (!lastStaticDate || formattedDate > lastStaticDate) {
              newRows.push({ date: formattedDate, flow: flowVal });
            }
          }
        }
      }
      if (newRows.length > 0) {
        console.log(`[API] ETF Flow: appended ${newRows.length} new rows from /btc/`);
        return [...baseHistory, ...newRows];
      }
    }
  } catch (e) {
    console.warn('[API] ETF Flow /btc/ fetch failed, using static data only:', e.message);
  }

  // Return static data as fallback (always valid)
  return baseHistory.length > 0 ? baseHistory : null;
};

/**
 * Lấy chỉ số thanh khoản ròng vĩ mô (US Net Liquidity) từ FRED
 */
export const getUSNetLiquidityData = async (apiKey) => {
  try {
    const [walcl, tga, rrp] = await Promise.all([
      getFREDMetric('WALCL'),
      getFREDMetric('WDTGAL'),
      getFREDMetric('RRPONTSYD'),
    ]);
    
    if (walcl !== null && tga !== null && rrp !== null) {
      const netLiquidity = (walcl / 1000) - (tga / 1000) - rrp;
      return parseFloat(netLiquidity.toFixed(2));
    }
    return null;
  } catch (e) {
    console.error('[API] US Net Liquidity error:', e.message);
    return null;
  }
};

/**
 * Lấy báo cáo vị thế CME Bitcoin Futures (COT) từ Tradingster qua Jina Reader
 */
export const getCMECot = async () => {
  try {
    const url = 'https://tradingster.com/cot/futures/fin/133741';
    const markdown = await fetchWithJina(url, 'text');
    if (!markdown) return null;
    
    const lines = markdown.split('\n');
    let dealerIntermediary = null;
    let assetManager = null;
    let leveragedFunds = null;
    let otherReportables = null;
    let nonReportable = null;
    
    let dateStr = 'N/A';
    let openInterest = 0;
    
    for (const line of lines) {
      if (line.includes('AS OF:')) {
        const match = line.match(/AS OF:\s*([0-9-]+)/);
        if (match) dateStr = match[1];
      }
      if (line.includes('Open Interest:')) {
        const match = line.match(/Open Interest:\s*([\d,]+)/);
        if (match) openInterest = parseInt(match[1].replace(/,/g, ''));
      }
    }

    const parseFullCell = (cell) => {
      if (!cell || cell.trim() === '') return { pos: 0, change: 0 };
      const parts = cell.trim().split(/\s+/);
      const pos = parseInt(parts[0].replace(/,/g, '')) || 0;
      const change = parts[1] ? parseInt(parts[1].replace(/,/g, '')) : 0;
      return { pos, change };
    };

    const parseTraderCell = (cell) => {
      if (!cell || cell.trim() === '' || cell.trim() === 'N/A') return null;
      return parseInt(cell.trim().replace(/,/g, '')) || 0;
    };

    const parsePercentCell = (cell) => {
      if (!cell || cell.trim() === '') return null;
      return parseFloat(cell.trim().replace('%', '')) || 0;
    };

    const parseRow = (line) => {
      const cells = line.split('|').map(c => c.trim());
      const longData = parseFullCell(cells[2]);
      const longOi = parsePercentCell(cells[3]);
      const longTraders = parseTraderCell(cells[4]);
      
      const shortData = parseFullCell(cells[5]);
      const shortOi = parsePercentCell(cells[6]);
      const shortTraders = parseTraderCell(cells[7]);
      
      const spreadData = parseFullCell(cells[8]);
      const spreadOi = parsePercentCell(cells[9]);
      const spreadTraders = parseTraderCell(cells[10]);
      
      return {
        long: longData.pos, longChange: longData.change, longOi, longTraders,
        short: shortData.pos, shortChange: shortData.change, shortOi, shortTraders,
        spread: spreadData.pos, spreadChange: spreadData.change, spreadOi, spreadTraders,
        net: longData.pos - shortData.pos,
        netChange: longData.change - shortData.change
      };
    };

    for (const line of lines) {
      if (line.includes('**Dealer Intermediary**')) {
        dealerIntermediary = parseRow(line);
      } else if (line.includes('**Asset Manager/ Institutional**')) {
        assetManager = parseRow(line);
      } else if (line.includes('**Leveraged Funds**')) {
        leveragedFunds = parseRow(line);
      } else if (line.includes('**Other Reportables**')) {
        otherReportables = parseRow(line);
      } else if (line.includes('**Nonreportable Positions**')) {
        nonReportable = parseRow(line);
      }
    }
    
    if (assetManager && leveragedFunds) {
      let formattedDate = dateStr;
      if (dateStr && dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        formattedDate = `${d}/${m}/${y}`;
      }
      
      return {
        date: formattedDate,
        openInterest,
        dealerIntermediary,
        assetManager,
        leveragedFunds,
        otherReportables,
        nonReportable
      };
    }
    return null;
  } catch (e) {
    console.error('[API] CME COT error:', e.message);
    return null;
  }
};

/** Fetch Crypto Fear and Greed Index */
export const getFearAndGreed = async () => {
  try {
    const res = await axios.get('https://api.alternative.me/fng/', { timeout: 6000 });
    const d = res.data?.data?.[0];
    if (d) {
      return {
        value: parseInt(d.value),
        sentiment: d.value_classification,
      };
    }
    return null;
  } catch (e) {
    console.error('[API] Fear and Greed:', e.message);
    return null;
  }
};
