/**
 * Standalone Crypto Metrics Aggregator & Google Sheets Sync Worker
 * 
 * Chức năng:
 * - Thu thập toàn bộ chỉ số Crypto, Phái sinh, On-chain, ETF, Vĩ mô LIVE từ Binance, DefiLlama, Alternative.me, FairEconomy, CoinMetrics, FRED, Yahoo Finance.
 * - Sử dụng chung Data Contract và hàm buildGoogleSheetPayload với Browser Web App.
 * - Loại bỏ toàn bộ fake hard-coded fallback để đảm bảo Data Integrity.
 * - Gửi Webhook ghi đè dữ liệu lên Google Sheet (5 Tab).
 * 
 * Cách chạy:
 *   node scripts/syncGoogleSheet.mjs --dry-run
 *   GOOGLE_SHEET_WEBHOOK_URL="https://script.google.com/macros/s/.../exec" node scripts/syncGoogleSheet.mjs
 */

import axios from 'axios';
import { buildGoogleSheetPayload, getCurrentSessionVN, validateExportReadiness } from '../src/services/googleSheetSync.js';
import { calculateMarketBias } from '../src/services/biasEngine.js';
import {
  getBTCTicker24h,
  getIntradayCVD,
  getHistoricalCVD,
  getFundingRate,
  getOpenInterest,
  getOIHistory,
  getLongShortRatio,
  getOrderBookDepth,
  getWhaleWalls,
  getBTCOnChain,
  getBTCOnChainMetrics,
  getETHOnChainMetrics,
  getStablecoinData,
  getGlobalCryptoData,
  getSsrMovingAverageData,
  getFearAndGreed,
  getYahooStockQuote,
  getYahoo10YYield,
  getDXYQuote,
  getFredAPIMetric,
  getUSCPIInflationYoY,
  getUSNetLiquidityData,
  getETFHoldings,
  getETFFlowHistory,
  getCMECot
} from '../src/services/api.js';

const WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || process.argv.find(arg => arg.startsWith('--url='))?.split('=')[1];
const IS_DRY_RUN = process.argv.includes('--dry-run') || !WEBHOOK_URL;
const FRED_API_KEY = process.env.FRED_API_KEY || process.argv.find(arg => arg.startsWith('--fred-key='))?.split('=')[1] || '';

// ─── BINANCE TICKERS ─────────────────────────────────────────────────────────

async function fetchTickers() {
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const results = {};
    for (const sym of symbols) {
      const ticker = await getBTCTicker24h(sym);
      if (ticker) results[sym] = ticker;
    }
    return results;
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Tickers:', err.message);
    return null;
  }
}

// ─── BINANCE DAILY KLINES ───────────────────────────────────────────────────

async function fetchDailyKlines() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=300', { timeout: 10000 });
    return res.data.map(k => ({
      time: new Date(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      takerBuyQuoteVolume: parseFloat(k[10]),
      isClosed: true,
    }));
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Daily Klines:', err.message);
    return [];
  }
}

// ─── DERIVATIVES & ORDER FLOW ────────────────────────────────────────────────

async function fetchDerivativesFlow() {
  try {
    const [fr, oi, oiHist, lsHist, topLsRes] = await Promise.allSettled([
      getFundingRate('BTCUSDT'),
      getOpenInterest('BTCUSDT'),
      getOIHistory('BTCUSDT', '1h', 24),
      getLongShortRatio('BTCUSDT', '1h', 24),
      axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { timeout: 8000 })
    ]);

    const fundingRate = fr.status === 'fulfilled' ? fr.value : null;
    const openInterest = oi.status === 'fulfilled' ? oi.value : null;
    const oiHistory = oiHist.status === 'fulfilled' && Array.isArray(oiHist.value) ? oiHist.value : [];
    const lsHistory = lsHist.status === 'fulfilled' && Array.isArray(lsHist.value) ? lsHist.value : [];
    const globalLs = lsHistory.length > 0 ? lsHistory[lsHistory.length - 1]?.longShortRatio : null;
    const topLs = topLsRes.status === 'fulfilled' && topLsRes.value.data?.[0] ? parseFloat(topLsRes.value.data[0].longShortRatio) : null;

    return { fundingRate, openInterest, oiHistory, lsHistory, globalLs, topLs };
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Phái sinh:', err.message);
    return { fundingRate: null, openInterest: null, oiHistory: [], lsHistory: [], globalLs: null, topLs: null };
  }
}

// ─── CVD MULTI-TIMEFRAME ─────────────────────────────────────────────────────

async function fetchCvdData() {
  try {
    const [spot24, fut24, spot7d, fut7d, spot30d, fut30d] = await Promise.allSettled([
      getIntradayCVD('BTCUSDT', 'spot'),
      getIntradayCVD('BTCUSDT', 'futures'),
      getHistoricalCVD('BTCUSDT', '4h', 42, 'spot'),
      getHistoricalCVD('BTCUSDT', '4h', 42, 'futures'),
      getHistoricalCVD('BTCUSDT', '1d', 30, 'spot'),
      getHistoricalCVD('BTCUSDT', '1d', 30, 'futures')
    ]);

    return {
      cvdHistory24hSpot: spot24.status === 'fulfilled' && Array.isArray(spot24.value) ? spot24.value : [],
      cvdHistory24h: fut24.status === 'fulfilled' && Array.isArray(fut24.value) ? fut24.value : [],
      cvdHistory7dSpot: spot7d.status === 'fulfilled' && Array.isArray(spot7d.value) ? spot7d.value : [],
      cvdHistory7d: fut7d.status === 'fulfilled' && Array.isArray(fut7d.value) ? fut7d.value : [],
      cvdHistory30dSpot: spot30d.status === 'fulfilled' && Array.isArray(spot30d.value) ? spot30d.value : [],
      cvdHistory30d: fut30d.status === 'fulfilled' && Array.isArray(fut30d.value) ? fut30d.value : []
    };
  } catch (err) {
    console.warn('[Sync] Lỗi fetch CVD:', err.message);
    return {
      cvdHistory24hSpot: [], cvdHistory24h: [],
      cvdHistory7dSpot: [], cvdHistory7d: [],
      cvdHistory30dSpot: [], cvdHistory30d: []
    };
  }
}

// ─── ECONOMIC CALENDAR ───────────────────────────────────────────────────────

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

// ─── MAIN BUILDER & DISPATCHER ────────────────────────────────────────────────

async function main() {
  const session = getCurrentSessionVN();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';

  console.log(`\n======================================================`);
  console.log(`  CRYPTO NEWS & METRICS STANDALONE AGGREGATOR`);
  console.log(`  Phiên: ${session.name}`);
  console.log(`  Thời gian: ${timestampVn}`);
  console.log(`======================================================\n`);

  console.log('[1/5] Đang lấy Tickers, Klines, CVD Đa khung & Phái sinh từ Binance...');
  const [tickers, dailyKlines, derivatives, cvdData, orderBookDepth, whaleWalls] = await Promise.all([
    fetchTickers(),
    fetchDailyKlines(),
    fetchDerivativesFlow(),
    fetchCvdData(),
    getOrderBookDepth('BTCUSDT', 100),
    getWhaleWalls('BTCUSDT', 500000)
  ]);

  console.log('[2/5] Đang lấy Fear & Greed, Stablecoins, Global Market, On-Chain & SSR...');
  const [fng, stablecoins, globalCrypto, onChain, btcMvrv, ethMvrv, ssrMa, calendarEvents] = await Promise.all([
    getFearAndGreed(),
    getStablecoinData(),
    getGlobalCryptoData(),
    getBTCOnChain(),
    getBTCOnChainMetrics(),
    getETHOnChainMetrics(),
    getSsrMovingAverageData(),
    fetchEconomicCalendar()
  ]);

  console.log('[3/5] Đang lấy chỉ số Vĩ mô (FRED / Yahoo Finance) & Dòng tiền Tổ chức (ETF/COT)...');
  const [
    fedFundsRate,
    cpiYoY,
    tenYearYieldFred,
    unrate,
    highYieldSpread,
    m2Supply,
    netLiquidityData,
    dxyQuote,
    vixQuote,
    sp500Quote,
    qqqQuote,
    tenYearYahoo,
    etfHoldingsLive,
    etfFlowLive,
    cotDataLive
  ] = await Promise.all([
    FRED_API_KEY ? getFredAPIMetric('FEDFUNDS', FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getUSCPIInflationYoY(FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getFredAPIMetric('DGS10', FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getFredAPIMetric('UNRATE', FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getFredAPIMetric('BAMLH0A0HYM2EY', FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getFredAPIMetric('M2SL', FRED_API_KEY) : Promise.resolve(null),
    FRED_API_KEY ? getUSNetLiquidityData(FRED_API_KEY) : Promise.resolve(null),
    getDXYQuote(),
    getYahooStockQuote('^VIX'),
    getYahooStockQuote('^GSPC'),
    getYahooStockQuote('QQQ'),
    getYahoo10YYield(),
    getETFHoldings(),
    getETFFlowHistory(),
    getCMECot()
  ]);

  const effectiveTenYearYield = tenYearYieldFred ?? tenYearYahoo;
  const effectiveNetLiquidity = netLiquidityData?.netLiquidity ?? null;

  const orderBookObj = {
    obiPercent: orderBookDepth?.imbalancePercent ?? null,
    bidVolumeUsd: orderBookDepth?.bidVolumeUsd ?? null,
    askVolumeUsd: orderBookDepth?.askVolumeUsd ?? null,
    topBidWall: whaleWalls?.bidWall ? { price: whaleWalls.bidWall.price, notional: whaleWalls.bidWall.notional } : null,
    topAskWall: whaleWalls?.askWall ? { price: whaleWalls.askWall.price, notional: whaleWalls.askWall.notional } : null
  };

  const dashboardData = {
    btc: tickers?.BTCUSDT || null,
    ethTicker: tickers?.ETHUSDT || null,
    solTicker: tickers?.SOLUSDT || null,
    btcDailyKlinesAll: dailyKlines,
    fundingRate: derivatives.fundingRate,
    openInterest: derivatives.openInterest,
    oiHistory: derivatives.oiHistory,
    lsHistory: derivatives.lsHistory,
    longShortRatio: derivatives.globalLs,
    topTraderLsRatio: derivatives.topLs,
    fngData: fng,
    stablecoins: stablecoins,
    globalData: globalCrypto,
    onChain: onChain,
    onChainMetrics: btcMvrv,
    ethOnChainMetrics: ethMvrv,
    ssrMa: ssrMa,
    fedFundsRate: fedFundsRate,
    cpi: cpiYoY,
    unrate: unrate,
    tenYearYield: effectiveTenYearYield,
    dxy: dxyQuote ? { price: dxyQuote } : null,
    vix: vixQuote,
    sp500: sp500Quote,
    qqq: qqqQuote,
    highYield: highYieldSpread,
    m2Supply: m2Supply,
    netLiquidity: effectiveNetLiquidity,
    cvdHistory24hSpot: cvdData.cvdHistory24hSpot,
    cvdHistory24h: cvdData.cvdHistory24h,
    cvdHistory7dSpot: cvdData.cvdHistory7dSpot,
    cvdHistory7d: cvdData.cvdHistory7d,
    cvdHistory30dSpot: cvdData.cvdHistory30dSpot,
    cvdHistory30d: cvdData.cvdHistory30d,
    orderBook: orderBookObj,
    cotData: cotDataLive,
    news: calendarEvents.map(e => ({
      title: `[LỊCH SỰ KIỆN] ${e.title}`,
      time: e.date,
      tag: `Calendar,${e.impact || 'Medium'}`
    }))
  };

  console.log('[4/5] Đang tính toán Market Bias Engine chuẩn hóa...');
  const biasData = calculateMarketBias(dashboardData, etfFlowLive || []);
  biasData.upcomingEvents = calendarEvents;

  const validation = validateExportReadiness(dashboardData, biasData, etfHoldingsLive, etfFlowLive);
  console.log(`Độ hoàn thiện dữ liệu: ${validation.completenessScore}% (Hợp lệ: ${validation.isValid})`);
  if (validation.warnings.length > 0) {
    console.log('Cảnh báo dữ liệu:', validation.warnings);
  }

  const payload = buildGoogleSheetPayload(dashboardData, biasData, etfHoldingsLive, etfFlowLive, {
    source: 'GitHub Actions / CLI Worker',
    calendarEvents: calendarEvents
  });

  if (IS_DRY_RUN) {
    console.log('\n[DRY RUN MODE] Dữ liệu thu thập hoàn tất! Không gửi Webhook.');
    console.log('Market Bias Score:', `${biasData.score > 0 ? '+' : ''}${biasData.score} / 100 (${biasData.label}) | Confidence: ${biasData.confidence}%`);
    console.log('Bias Regime: Valuation =', biasData.regime?.valuation, '| Trend =', biasData.regime?.trend, '| Liquidity =', biasData.regime?.liquidity, '| Tactical =', biasData.regime?.tactical);
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

