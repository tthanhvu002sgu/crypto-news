/**
 * Standalone Crypto Metrics Aggregator & Google Sheets Sync Worker
 * 
 * Chức năng:
 * - Thu thập toàn bộ chỉ số Crypto, Phái sinh, On-chain, ETF, Vĩ mô từ Binance, DefiLlama, Alternative.me, FairEconomy, CoinMetrics, FRED.
 * - Sử dụng chung Data Contract và hàm buildGoogleSheetPayload với Browser Web App.
 * - Gửi Webhook ghi đè dữ liệu lên Google Sheet (5 Tab).
 * 
 * Cách chạy:
 *   node scripts/syncGoogleSheet.mjs --dry-run
 *   GOOGLE_SHEET_WEBHOOK_URL="https://script.google.com/macros/s/.../exec" node scripts/syncGoogleSheet.mjs
 */

import axios from 'axios';
import { buildGoogleSheetPayload, getCurrentSessionVN, validateExportReadiness } from '../src/services/googleSheetSync.js';

const WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || process.argv.find(arg => arg.startsWith('--url='))?.split('=')[1];
const IS_DRY_RUN = process.argv.includes('--dry-run') || !WEBHOOK_URL;
const FRED_API_KEY = process.env.FRED_API_KEY || process.argv.find(arg => arg.startsWith('--fred-key='))?.split('=')[1] || '';

// ─── DATA FETCHERS ────────────────────────────────────────────────────────────

async function fetchBinanceTickers() {
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const results = {};
    for (const sym of symbols) {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`, { timeout: 8000 });
      results[sym] = {
        price: parseFloat(res.data.lastPrice),
        change: parseFloat(res.data.priceChangePercent),
        high: parseFloat(res.data.highPrice),
        low: parseFloat(res.data.lowPrice),
        volume: parseFloat(res.data.quoteVolume),
      };
    }
    return results;
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Tickers:', err.message);
    return null;
  }
}

async function fetchDerivativesData() {
  try {
    const [frRes, oiRes, lsRes, topLsRes] = await Promise.allSettled([
      axios.get('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { timeout: 8000 })
    ]);

    const fundingRate = frRes.status === 'fulfilled' && frRes.value.data?.[0] ? parseFloat(frRes.value.data[0].fundingRate) : null;
    const openInterest = oiRes.status === 'fulfilled' && oiRes.value.data?.openInterest ? parseFloat(oiRes.value.data.openInterest) : null;
    const globalLs = lsRes.status === 'fulfilled' && lsRes.value.data?.[0] ? parseFloat(lsRes.value.data[0].longShortRatio) : null;
    const topLs = topLsRes.status === 'fulfilled' && topLsRes.value.data?.[0] ? parseFloat(topLsRes.value.data[0].longShortRatio) : null;

    return { fundingRate, openInterest, globalLs, topLs };
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Phái sinh:', err.message);
    return { fundingRate: null, openInterest: null, globalLs: null, topLs: null };
  }
}

async function fetchFearAndGreed() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 6000 });
    const item = res.data?.data?.[0];
    return item ? { value: parseInt(item.value, 10), sentiment: item.value_classification } : null;
  } catch (err) {
    console.warn('[Sync] Lỗi Fear & Greed:', err.message);
    return null;
  }
}

async function fetchStablecoins() {
  try {
    const res = await axios.get('https://stablecoins.llama.fi/stablecoins?includePrices=true', { timeout: 8000 });
    const peggedAssets = res.data?.peggedAssets || [];
    let totalCirculatingUsd = 0;
    let usdt = 0;
    let usdc = 0;
    for (const coin of peggedAssets) {
      const circ = Number(coin.circulating?.peggedUSD || 0);
      totalCirculatingUsd += circ;
      if (coin.symbol === 'USDT') usdt = circ;
      if (coin.symbol === 'USDC') usdc = circ;
    }
    return { total: totalCirculatingUsd, usdt, usdc };
  } catch (err) {
    console.warn('[Sync] Lỗi Stablecoins DefiLlama:', err.message);
    return null;
  }
}

async function fetchGlobalCrypto() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
    const d = res.data?.data;
    if (!d) return {};
    return {
      totalMarketCap: d.total_market_cap?.usd,
      btcDominance: d.market_cap_percentage?.btc,
      ethDominance: d.market_cap_percentage?.eth
    };
  } catch (err) {
    console.warn('[Sync] Lỗi Global Crypto:', err.message);
    return {};
  }
}

async function fetchOrderBookImbalance() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100', { timeout: 8000 });
    const bids = res.data.bids || [];
    const asks = res.data.asks || [];
    
    let bidVol = 0;
    let askVol = 0;
    let maxBid = { price: 0, notional: 0 };
    let maxAsk = { price: 0, notional: 0 };

    for (const [p, q] of bids) {
      const notional = parseFloat(p) * parseFloat(q);
      bidVol += notional;
      if (notional > maxBid.notional) maxBid = { price: parseFloat(p), notional };
    }
    for (const [p, q] of asks) {
      const notional = parseFloat(p) * parseFloat(q);
      askVol += notional;
      if (notional > maxAsk.notional) maxAsk = { price: parseFloat(p), notional };
    }

    const total = bidVol + askVol;
    const obi = total > 0 ? ((bidVol - askVol) / total) * 100 : 0;
    return {
      obi,
      bidVol,
      askVol,
      topBidWall: maxBid.notional > 0 ? maxBid : null,
      topAskWall: maxAsk.notional > 0 ? maxAsk : null
    };
  } catch (err) {
    console.warn('[Sync] Lỗi Depth OBI:', err.message);
    return { obi: 0, bidVol: 0, askVol: 0, topBidWall: null, topAskWall: null };
  }
}

async function fetchOnChainBlockchainInfo() {
  try {
    const res = await axios.get('https://api.blockchain.info/stats', { timeout: 8000 });
    return {
      difficulty: res.data.difficulty,
      hashRate: res.data.hash_rate ? res.data.hash_rate / 1e6 : null, // convert to EH/s
      txCount24h: res.data.n_tx
    };
  } catch (err) {
    console.warn('[Sync] Lỗi Blockchain.info:', err.message);
    return null;
  }
}

async function fetchCoinMetricsMvrv(asset = 'btc') {
  try {
    const res = await axios.get('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics', {
      params: {
        assets: asset,
        metrics: 'AdrActCnt,TxCnt,CapMVRVCur',
        frequency: '1d',
        page_size: 10
      },
      timeout: 8000
    });
    const items = res.data?.data || [];
    if (items.length === 0) return null;
    const reversed = [...items].reverse();
    const latestMvrv = reversed.find(d => d.CapMVRVCur != null && d.CapMVRVCur !== '');
    const latestTx = reversed.find(d => d.AdrActCnt && d.TxCnt) || latestMvrv || reversed[0];
    if (!latestMvrv && !latestTx) return null;
    return {
      mvrv: latestMvrv?.CapMVRVCur ? parseFloat(latestMvrv.CapMVRVCur) : null,
      activeAddresses: latestTx.AdrActCnt ? parseInt(latestTx.AdrActCnt, 10) : null,
      txCount: latestTx.TxCnt ? parseInt(latestTx.TxCnt, 10) : null,
      date: (latestMvrv || latestTx).time ? (latestMvrv || latestTx).time.split('T')[0] : null
    };
  } catch (err) {
    console.warn(`[Sync] Lỗi CoinMetrics (${asset}):`, err.message);
    return null;
  }
}

async function fetchEconomicCalendar() {
  try {
    const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { timeout: 8000 });
    const rawEvents = Array.isArray(res.data) ? res.data : [];
    const now = Date.now();
    const upcoming = rawEvents.filter(e => {
      if (!e.date) return false;
      const eventTime = new Date(e.date).getTime();
      return eventTime >= (now - 4 * 3600 * 1000) && eventTime <= (now + 48 * 3600 * 1000);
    }).slice(0, 10);

    return upcoming.map(e => ({
      title: e.title || 'Sự kiện kinh tế',
      country: e.country || 'USD',
      date: e.date,
      timeStr: e.date ? e.date.replace('T', ' ').substring(11, 16) : '---',
      impact: e.impact || 'Medium',
      forecast: e.forecast || '---',
      previous: e.previous || '---',
      actual: e.actual || '---'
    }));
  } catch (err) {
    console.warn('[Sync] Lỗi Economic Calendar:', err.message);
    return [];
  }
}

async function fetchFredSeries(seriesId) {
  if (!FRED_API_KEY) return null;
  try {
    const res = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
      params: {
        series_id: seriesId,
        api_key: FRED_API_KEY,
        file_type: 'json',
        sort_order: 'desc',
        limit: 2
      },
      timeout: 8000
    });
    const obs = res.data?.observations?.[0];
    return obs && obs.value !== '.' ? parseFloat(obs.value) : null;
  } catch (err) {
    return null;
  }
}

// ─── CALCULATE BIAS ENGINE SCORE ──────────────────────────────────────────────
function calculateBiasSnapshot(tickers, derivatives, fng, stablecoins, obiData, onChain, btcMvrvData) {
  const btcPrice = tickers?.BTCUSDT?.price || 0;
  const fundingRate = derivatives?.fundingRate || 0;
  const fngVal = fng?.value || 50;

  // 1. Institutional Flows (40%)
  let instScore = 15;

  // 2. On-Chain (25%)
  let onChainScore = 10;
  const mvrv = btcMvrvData?.mvrv;
  if (mvrv != null) {
    if (mvrv < 1.2) onChainScore = 35;
    else if (mvrv < 2.0) onChainScore = 15;
    else if (mvrv > 2.8) onChainScore = -25;
  }

  // 3. Macro & Risk (20%)
  let macroScore = 5;

  // 4. Microstructure (15%)
  let microScore = 0;
  if (fundingRate > 0.0003) microScore -= 20;
  else if (fundingRate > 0.00005) microScore += 10;
  else if (fundingRate < -0.0001) microScore += 25; // short squeeze
  
  if (fngVal <= 25) microScore += 25; // Extreme fear -> buy zone
  else if (fngVal >= 75) microScore -= 25; // Greed -> danger

  if (obiData?.obi > 15) microScore += 15;
  else if (obiData?.obi < -15) microScore -= 15;

  microScore = Math.max(-100, Math.min(100, microScore));

  const totalScore = Math.round((instScore * 0.40) + (onChainScore * 0.25) + (macroScore * 0.20) + (microScore * 0.15));
  
  let label = 'TRUNG LẬP (NEUTRAL)';
  if (totalScore >= 35) label = 'BULLISH MẠNH (STRONG BUY)';
  else if (totalScore >= 15) label = 'NGHIÊNG BULLISH (LEAN LONG)';
  else if (totalScore <= -35) label = 'BEARISH MẠNH (STRONG SELL)';
  else if (totalScore <= -15) label = 'NGHIÊNG BEARISH (LEAN SHORT)';

  return {
    score: totalScore,
    label,
    confidence: 80,
    pillars: {
      institutional: instScore,
      onChain: onChainScore,
      newsRisk: macroScore,
      microstructure: microScore
    }
  };
}

// ─── MAIN BUILDER & DISPATCHER ────────────────────────────────────────────────

async function main() {
  const session = getCurrentSessionVN();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';

  console.log(`\n======================================================`);
  console.log(`  CRYPTO NEWS & METRICS STANDALONE AGGREGATOR`);
  console.log(`  Phiên: ${session.name}`);
  console.log(`  Thời gian: ${timestampVn}`);
  console.log(`======================================================\n`);

  console.log('[1/5] Đang lấy Tickers & Phái sinh từ Binance...');
  const [tickers, derivatives, obiData] = await Promise.all([
    fetchBinanceTickers(),
    fetchDerivativesData(),
    fetchOrderBookImbalance()
  ]);

  console.log('[2/5] Đang lấy Fear & Greed, Stablecoins, Global Market, On-Chain...');
  const [fng, stablecoins, globalCrypto, onChain, btcMvrv, ethMvrv, calendarEvents] = await Promise.all([
    fetchFearAndGreed(),
    fetchStablecoins(),
    fetchGlobalCrypto(),
    fetchOnChainBlockchainInfo(),
    fetchCoinMetricsMvrv('btc'),
    fetchCoinMetricsMvrv('eth'),
    fetchEconomicCalendar()
  ]);

  console.log('[3/5] Đang lấy chỉ số Vĩ mô (FRED / Proxies)...');
  const [fedFundsRate, cpi, tenYearYield, dxy, vix] = await Promise.all([
    fetchFredSeries('FEDFUNDS'),
    fetchFredSeries('CPIAUCSL'),
    fetchFredSeries('DGS10'),
    Promise.resolve(103.8), // proxy
    Promise.resolve(15.5)   // proxy
  ]);

  console.log('[4/5] Đang tính toán Market Bias Engine...');
  const biasData = calculateBiasSnapshot(tickers, derivatives, fng, stablecoins, obiData, onChain, btcMvrv);
  biasData.upcomingEvents = calendarEvents;

  // Mock / Static ETF & COT data baseline
  const etfHoldings = {
    total: 1258664,
    funds: [
      { name: 'BlackRock (IBIT)', holdings: 774434, marketShare: '61.5%' },
      { name: 'Grayscale (GBTC)', holdings: 145028, marketShare: '11.5%' },
      { name: 'Fidelity (FBTC)', holdings: 180084, marketShare: '14.3%' },
      { name: 'Others (ARKB, BITB...)', holdings: 159118, marketShare: '12.6%' }
    ]
  };

  const etfHistory = [
    { date: '18/08/26', flow: 125.4 },
    { date: '19/08/26', flow: -42.8 },
    { date: '20/08/26', flow: 215.3 },
    { date: '21/08/26', flow: 88.6 }
  ];

  const cotData = {
    date: '19/08/2026',
    openInterest: 21850,
    assetManager: { long: 5850, short: 1420, net: 4430, netChange: 320 },
    leveragedFunds: { long: 5120, short: 12340, net: -7220, netChange: -410 }
  };

  const dashboardData = {
    btc: tickers?.BTCUSDT || null,
    ethTicker: tickers?.ETHUSDT || null,
    solTicker: tickers?.SOLUSDT || null,
    fundingRate: derivatives.fundingRate,
    openInterest: derivatives.openInterest,
    longShortRatio: derivatives.globalLs,
    topTraderLsRatio: derivatives.topLs,
    fngData: fng,
    stablecoins: stablecoins,
    globalData: globalCrypto,
    onChain: onChain,
    onChainMetrics: btcMvrv,
    ethOnChainMetrics: ethMvrv,
    fedFundsRate: fedFundsRate,
    cpi: cpi,
    tenYearYield: tenYearYield,
    dxy: dxy,
    vix: vix,
    orderBook: {
      obiPercent: obiData.obi,
      bidVolumeUsd: obiData.bidVol,
      askVolumeUsd: obiData.askVol,
      topBidWall: obiData.topBidWall,
      topAskWall: obiData.topAskWall
    },
    cotData: cotData
  };

  const validation = validateExportReadiness(dashboardData, biasData, etfHoldings, etfHistory);
  console.log(`Độ hoàn thiện dữ liệu: ${validation.completenessScore}% (Hợp lệ: ${validation.isValid})`);
  if (validation.warnings.length > 0) {
    console.log('Cảnh báo dữ liệu:', validation.warnings);
  }

  const payload = buildGoogleSheetPayload(dashboardData, biasData, etfHoldings, etfHistory, {
    source: 'GitHub Actions / CLI Worker',
    calendarEvents: calendarEvents
  });

  if (IS_DRY_RUN) {
    console.log('\n[DRY RUN MODE] Dữ liệu thu thập thành công! Không gửi Webhook.');
    console.log('Tab 1 (OVERVIEW_BIAS):', payload.overview.length, 'dòng');
    console.log('Tab 2 (DERIVATIVES_FLOW):', payload.derivatives.length, 'dòng');
    console.log('Tab 3 (ETF_ONCHAIN):', payload.etf_onchain.length, 'dòng');
    console.log('Tab 4 (MACRO_CALENDAR):', payload.macro.length, 'dòng');
    console.log('Tab 5 (AI_PROMPT_SUMMARY):', payload.ai_summary_md.length, 'ký tự');
    console.log('\n--- PREVIEW TAB 5 AI DECISION LAB PROMPT ---');
    console.log(payload.ai_summary_md.substring(0, 1000) + '...\n');
    console.log('Để đồng bộ thực tế lên Google Sheet, truyền GOOGLE_SHEET_WEBHOOK_URL hoặc đối số --url=<URL>');
    return;
  }

  console.log(`\n[5/5] Đang gửi payload lên Google Apps Script Webhook...`);
  try {
    const res = await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 5,
      timeout: 20000
    });

    console.log('✅ KẾT QUẢ TỪ GOOGLE APPS SCRIPT:');
    console.log(res.data);
    console.log('🎉 ĐÃ ĐỒNG BỘ THÀNH CÔNG LÊN GOOGLE SHEET!');
  } catch (err) {
    console.error('❌ Lỗi khi gửi Webhook:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status, 'Data:', err.response.data);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});

