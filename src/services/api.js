import axios from 'axios';

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

// ─── FEAR & GREED INDEX ──────────────────────────────────────────────────────

/** Crypto Fear & Greed Index — 0=Extreme Fear, 100=Extreme Greed */
export const getFearAndGreed = async () => {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=7');
    return res.data.data; // [{value, value_classification, timestamp}, ...]
  } catch (e) {
    console.error('[API] Fear & Greed:', e.message);
    return null;
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
      ? { 'Accept': 'application/json', 'X-Return-Format': 'json' }
      : { 'Accept': 'text/plain' };

    const res = await axios.get(`https://r.jina.ai/${url}`, {
      headers,
      timeout: 15000,
    });
    return res.data || null;
  } catch (e) {
    console.error('[API] Jina Reader:', e.message);
    return null;
  }
};

// ─── NEWS RSS (multi-source with fallback) ─────────────────────────────────────

const RSS_API_BASE = 'https://api.rss2json.com/v1/api.json?rss_url=';

const NEWS_SOURCES = [
  { url: 'https://cointelegraph.com/rss',                  tag: 'CoinTelegraph', cat: 'crypto' },
  { url: 'https://decrypt.co/feed',                        tag: 'Decrypt',       cat: 'crypto' },
  { url: 'https://www.theblock.co/rss.xml',                tag: 'The Block',     cat: 'crypto' },
  { url: 'https://feeds.reuters.com/reuters/businessNews', tag: 'Reuters',       cat: 'macro'  },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', tag: 'WSJ Markets',   cat: 'macro'  },
];

const fetchRSS = async (src) => {
  try {
    const res = await axios.get(`${RSS_API_BASE}${encodeURIComponent(src.url)}`, { timeout: 6000 });
    if (res.data?.status !== 'ok') return [];
    return (res.data.items || []).slice(0, 5).map(item => ({
      time: new Date(item.pubDate),
      tag: src.tag,
      cat: src.cat,
      title: item.title || '',
      snippet: (item.description || '').replace(/<[^>]+>/g, '').trim().substring(0, 130),
      link: item.link,
    }));
  } catch {
    return [];
  }
};

export const fetchRealtimeFeed = async () => {
  const results = await Promise.allSettled(NEWS_SOURCES.map(fetchRSS));
  let combined = [];
  results.forEach(r => { if (r.status === 'fulfilled') combined = [...combined, ...r.value]; });
  return combined
    .sort((a, b) => b.time - a.time)
    .map(item => ({ ...item, timeStr: item.time.toLocaleString('vi-VN') }));
};

// ─── COINALYZE API — REMOVED ───────────────────────────────────────────────────
// ─── ORDER BOOK DEPTH — OBI (Order Book Imbalance) ────────────────────────────

/**
 * Lấy order book 100 levels từ Binance Futures.
 * Tính OBI = (ΣBid - ΣAsk) / (ΣBid + ΣAsk)
 * Lấy 100 levels giúp tính toán OBI ổn định hơn (tránh nhiễu của HFT bots trong 20 levels).
 */
export const getOrderBookDepth = async (symbol = 'BTCUSDT', limit = 100) => {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/depth', {
      params: { symbol, limit },
      timeout: 5000,
    });

    const bids = res.data.bids || []; // [[price, qty], ...]
    const asks = res.data.asks || [];

    // Sum all 100 levels volume (in BTC)
    const bidVol = bids.reduce((sum, [, q]) => sum + parseFloat(q), 0);
    const askVol = asks.reduce((sum, [, q]) => sum + parseFloat(q), 0);

    const total = bidVol + askVol;
    const obi = total > 0 ? ((bidVol - askVol) / total) : 0; // -1 to +1

    // Spread
    const bestBid = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0][0]) : 0;
    const spread = bestBid > 0 ? ((bestAsk - bestBid) / bestBid * 100) : 0;

    // USDT values for display
    const midPrice = (bestBid + bestAsk) / 2;
    const bidVolUsd = bidVol * midPrice;
    const askVolUsd = askVol * midPrice;

    return {
      obi: parseFloat(obi.toFixed(4)),           // -1 to +1
      obiPercent: parseFloat((obi * 100).toFixed(1)), // -100 to +100
      spread: parseFloat(spread.toFixed(4)),      // %
      bestBid,
      bestAsk,
      bidVolBtc: parseFloat(bidVol.toFixed(2)),
      askVolBtc: parseFloat(askVol.toFixed(2)),
      bidVolUsd: Math.round(bidVolUsd),
      askVolUsd: Math.round(askVolUsd),
      signal: obi > 0.15 ? 'BUY PRESSURE' : obi < -0.15 ? 'SELL PRESSURE' : 'BALANCED',
      signalCls: obi > 0.15 ? 'text-emerald' : obi < -0.15 ? 'text-rose' : 'text-slate-400',
    };
  } catch (e) {
    console.error('[API] Order Book:', e.message);
    return null;
  }
};

// ─── WHALE WALLS — Large Limit Orders ≥ $500K ────────────────────────────────

/**
 * Lấy order book sâu (1000 levels) từ Binance Futures.
 * Lọc các lệnh giới hạn có giá trị ≥ $500K USD.
 * Phân tích tỷ lệ Bid Walls vs Ask Walls.
 */
export const getWhaleWalls = async (symbol = 'BTCUSDT', minUsd = 500000) => {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/depth', {
      params: { symbol, limit: 1000 },
      timeout: 8000,
    });

    const bids = res.data.bids || [];
    const asks = res.data.asks || [];

    const filterWhale = (levels, side) =>
      levels
        .map(([p, q]) => ({
          price: parseFloat(p),
          qty: parseFloat(q),
          usdValue: parseFloat(p) * parseFloat(q),
          side,
        }))
        .filter(o => o.usdValue >= minUsd)
        .sort((a, b) => b.usdValue - a.usdValue)
        .slice(0, 15); // Top 15 per side

    const whaleBids = filterWhale(bids, 'BID');
    const whaleAsks = filterWhale(asks, 'ASK');

    const bidWallTotal = whaleBids.reduce((s, o) => s + o.usdValue, 0);
    const askWallTotal = whaleAsks.reduce((s, o) => s + o.usdValue, 0);

    const wallTotal = bidWallTotal + askWallTotal;
    const bidRatio = wallTotal > 0 ? bidWallTotal / wallTotal : 0.5;

    return {
      whaleBids,
      whaleAsks,
      bidWallTotal,
      askWallTotal,
      bidRatio: parseFloat(bidRatio.toFixed(3)),
      signal: bidRatio > 0.6 ? 'Smart money đỡ giá ↑' : bidRatio < 0.4 ? 'Tường bán áp đảo ↓' : 'Cân bằng',
      signalCls: bidRatio > 0.6 ? 'text-emerald' : bidRatio < 0.4 ? 'text-rose' : 'text-slate-400',
    };
  } catch (e) {
    console.error('[API] Whale Walls:', e.message);
    return null;
  }
};

// ─── FRED API (Macro yields & interest rates) ──────────────────────────────────
export const getFREDMetric = async (seriesId, apiKey) => {
  if (!apiKey) return null;
  const url = getFredUrl();
  const params = {
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: 1,
  };

  try {
    const res = await axios.get(url, { params, timeout: 8000 });
    const obs = res.data?.observations?.[0];
    return obs ? parseFloat(obs.value) : null;
  } catch (e) {
    if (isLocal) {
      console.error(`[API] FRED dev proxy error for ${seriesId}:`, e.message);
      return null;
    }
    console.warn(`[API] FRED direct request failed for ${seriesId}, trying via CORS proxy... Error:`, e.message);
    try {
      const targetUrl = new URL('https://api.stlouisfed.org/fred/series/observations');
      Object.keys(params).forEach(key => targetUrl.searchParams.append(key, params[key]));
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl.toString())}`;
      
      const res = await axios.get(proxyUrl, { timeout: 8000 });
      let data = res.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {}
      }
      const obs = data?.observations?.[0];
      return obs ? parseFloat(obs.value) : null;
    } catch (proxyError) {
      console.error(`[API] FRED proxy request failed for ${seriesId}:`, proxyError.message);
      return null;
    }
  }
};

export const getFREDStockQuote = async (seriesId, apiKey) => {
  if (!apiKey) return null;
  const url = getFredUrl();
  const params = {
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: 5, // fetch a few to skip any holiday "." values
  };

  try {
    const res = await axios.get(url, { params, timeout: 8000 });
    const obsList = (res.data?.observations || [])
      .map(o => ({ value: parseFloat(o.value), date: o.date }))
      .filter(o => !isNaN(o.value));
    
    if (obsList.length === 0) return null;
    
    const price = obsList[0].value;
    let changePercent = 0;
    if (obsList.length > 1) {
      const prevPrice = obsList[1].value;
      if (prevPrice > 0) {
        changePercent = ((price - prevPrice) / prevPrice) * 100;
      }
    }
    
    return {
      price,
      changePercent,
    };
  } catch (e) {
    if (isLocal) {
      console.error(`[API] FRED Stock Quote dev proxy error for ${seriesId}:`, e.message);
      return null;
    }
    console.warn(`[API] FRED Stock Quote direct failed for ${seriesId}, trying proxy... Error:`, e.message);
    try {
      const targetUrl = new URL('https://api.stlouisfed.org/fred/series/observations');
      Object.keys(params).forEach(key => targetUrl.searchParams.append(key, params[key]));
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl.toString())}`;
      
      const res = await axios.get(proxyUrl, { timeout: 8000 });
      let data = res.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {}
      }
      const obsList = (data?.observations || [])
        .map(o => ({ value: parseFloat(o.value), date: o.date }))
        .filter(o => !isNaN(o.value));
      
      if (obsList.length === 0) return null;
      
      const price = obsList[0].value;
      let changePercent = 0;
      if (obsList.length > 1) {
        const prevPrice = obsList[1].value;
        if (prevPrice > 0) {
          changePercent = ((price - prevPrice) / prevPrice) * 100;
        }
      }
      return { price, changePercent };
    } catch (proxyError) {
      console.error(`[API] FRED Stock Quote proxy failed for ${seriesId}:`, proxyError.message);
      return null;
    }
  }
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
      const targetUrl = new URL('https://www.alphavantage.co/query');
      Object.keys(params).forEach(key => targetUrl.searchParams.append(key, params[key]));
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl.toString())}`;
      
      const res = await axios.get(proxyUrl, { timeout: 8000 });
      let data = res.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {}
      }
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
 * Lấy lịch sử dòng tiền ETF từ Farside Investors qua Jina Reader
 */
export const getETFFlowHistory = async () => {
  try {
    const url = 'https://farside.co.uk/btc/';
    const markdown = await fetchWithJina(url, 'text');
    if (!markdown) return null;
    
    const lines = markdown.split('\n');
    const flowHistory = [];
    const dateRegex = /^\s*\|\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s*\|/;
    
    for (const line of lines) {
      const match = line.match(dateRegex);
      if (match) {
        const dateStr = match[1];
        const cells = line.split('|').map(c => c.trim());
        const totalStr = cells[cells.length - 2];
        
        let flowVal = 0;
        if (totalStr) {
          let clean = totalStr.replace(/,/g, '');
          if (clean.includes('(') && clean.includes(')')) {
            flowVal = -parseFloat(clean.replace(/[()]/g, ''));
          } else {
            flowVal = parseFloat(clean);
          }
        }
        
        if (!isNaN(flowVal)) {
          const [day, monthStr] = dateStr.split(/\s+/);
          const months = {
            Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
            Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
          };
          const month = months[monthStr.substring(0, 3)] || '01';
          const formattedDate = `${day}/${month}`;
          
          flowHistory.push({
            date: formattedDate,
            flow: flowVal
          });
        }
      }
    }
    
    if (flowHistory.length > 0) {
      return flowHistory.slice(-9);
    }
    return null;
  } catch (e) {
    console.error('[API] ETF Flow History error:', e.message);
    return null;
  }
};

/**
 * Lấy chỉ số thanh khoản ròng vĩ mô (US Net Liquidity) từ FRED
 */
export const getUSNetLiquidityData = async (apiKey) => {
  if (!apiKey) return null;
  const fredKey = apiKey.trim();
  
  try {
    const [walcl, tga, rrp] = await Promise.all([
      getFREDMetric('WALCL', fredKey),
      getFREDMetric('WDTGAL', fredKey),
      getFREDMetric('RRPONTSYD', fredKey),
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
    let assetManager = null;
    let leveragedFunds = null;
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

    const parseCell = (cell) => {
      if (!cell) return { pos: 0, change: 0 };
      const parts = cell.trim().split(/\s+/);
      const pos = parseInt(parts[0].replace(/,/g, '')) || 0;
      const change = parts[1] ? parseInt(parts[1].replace(/,/g, '')) : 0;
      return { pos, change };
    };

    for (const line of lines) {
      if (line.includes('**Asset Manager/ Institutional**')) {
        const cells = line.split('|').map(c => c.trim());
        const longData = parseCell(cells[2]);
        const shortData = parseCell(cells[5]);
        assetManager = {
          long: longData.pos,
          longChange: longData.change,
          short: shortData.pos,
          shortChange: shortData.change,
          net: longData.pos - shortData.pos,
          netChange: longData.change - shortData.change
        };
      }
      if (line.includes('**Leveraged Funds**')) {
        const cells = line.split('|').map(c => c.trim());
        const longData = parseCell(cells[2]);
        const shortData = parseCell(cells[5]);
        leveragedFunds = {
          long: longData.pos,
          longChange: longData.change,
          short: shortData.pos,
          shortChange: shortData.change,
          net: longData.pos - shortData.pos,
          netChange: longData.change - shortData.change
        };
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
        assetManager,
        leveragedFunds
      };
    }
    return null;
  } catch (e) {
    console.error('[API] CME COT error:', e.message);
    return null;
  }
};
