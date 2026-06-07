import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import {
  getBTCTicker24h, getBTCKlines, getLongShortRatio,
  getFundingRate, getOpenInterest, getOIHistory,
  getGlobalCryptoData, getStablecoinData,
  fetchRealtimeFeed, getBTCOnChain, getBTCOnChainMetrics,
  getFREDMetric, getAlphaVantageQuote, getFREDStockQuote,
  getETFHoldings, getETFFlowHistory, getCMECot, getDXYQuote,
} from './services/api';
import { useBinanceWebSocket, useCVDStream } from './services/websocket';
import {
  Activity, RefreshCw, BarChart2, BookOpen, Layers,
  Terminal, HelpCircle, Zap, Radio, Crosshair, Moon, Sun, Settings, X, Sparkles
} from 'lucide-react';
import GlossaryTab from './components/GlossaryTab';
import HftRadarTab from './components/HftRadarTab';
import SummaryTab from './components/SummaryTab';
import Tooltip, { METRIC_METADATA, useTooltipSettings } from './components/Tooltip';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip as ChartTooltip, Legend, Filler, BarElement,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { motion } from 'framer-motion';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler, BarElement);

// ─── Helper Utilities ─────────────────────────────────────────────────────────

const fmt = (n, decimals = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '---';
const fmtB = (n) => n != null ? `$${(n / 1e9).toFixed(1)}B` : '---';
const fmtT = (n) => n != null ? `$${(n / 1e12).toFixed(2)}T` : '---';


const fundingLabel = (r) => {
  if (r == null) return { text: '---', cls: '' };
  const pct = r * 100;
  if (pct > 0.05) return { text: 'Long OL ⚠', cls: 'text-rose' };
  if (pct > 0.01) return { text: 'Long Bias', cls: 'text-amber' };
  if (pct < -0.01) return { text: 'Short Bias', cls: 'text-emerald' };
  return { text: 'Balanced', cls: 'text-slate-400' };
};

const getChartOpts = (theme) => {
  const isLight = theme === 'light';
  const gridColor = isLight ? 'rgba(71, 85, 105, 0.4)' : 'rgba(30, 41, 59, 0.4)';
  const tickColor = isLight ? '#000000' : '#94a3b8';
  const tooltipBg = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.95)';
  const tooltipBorder = isLight ? '#334155' : 'rgba(30, 41, 59, 0.8)';
  const tooltipTitle = isLight ? '#000000' : '#94a3b8';
  const tooltipBody = isLight ? '#000000' : '#e2e8f0';

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        padding: 10,
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: tickColor, maxTicksLimit: 8, font: { family: 'JetBrains Mono', size: 9 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: 'JetBrains Mono', size: 9 } },
      },
    },
  };
};

// ─── Metric Tooltip Data & Component ──────────────────────────────────────────
// Imported from ./components/Tooltip

const CASCADE_KEY_MAP = {
  'Fed Funds Rate': 'fedRate',
  'CPI Inflation': 'cpi',
  'Unemployment Rate': 'unrate',
  'Stablecoin Supply': 'stablecoin',
  'MVRV Ratio': 'mvrv',
  'DXY (Dollar Index)': 'dxy',
  '10Y Treasury Yield': 'tenYearYield',
  'BTC Dominance': 'btcDom',
  'S&P 500 Index': 'sp500',
  'Nasdaq 100 Index': 'qqq',
  'High Yield Credit': 'highYield',
  'VIX Volatility': 'vix',
  'M2 Supply (Billion $)': 'm2Supply',
  'Funding Rate': 'funding',
  'US Net Liquidity (Billion $)': 'netLiquidity',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, subCls, badge, badgeCls, tooltipId }) {
  const metadata = tooltipId ? METRIC_METADATA[tooltipId] : null;
  return (
    <div className="metric-card">
      {metadata ? (
        <Tooltip content={metadata}>
          <span className="metric-label font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
            {label}
          </span>
        </Tooltip>
      ) : (
        <span className="metric-label font-mono">{label}</span>
      )}
      <span className="metric-value font-mono">{value}</span>
      {sub && <span className={`metric-sub font-mono ${subCls || 'text-slate-400'}`}>{sub}</span>}
      {badge && <span className={`metric-badge font-mono ${badgeCls || ''}`}>{badge}</span>}
    </div>
  );
}



function LiveDot({ active = true }) {
  return (
    <span className="live-dot-wrap">
      <span className={`live-dot ${active ? 'live-dot--active' : ''}`} />
      <span className={`live-dot live-dot--ping ${active ? 'live-dot--active' : ''}`} />
    </span>
  );
}

function NewsItem({ item }) {
  const catColor = item.cat === 'macro' ? 'var(--color-amber-400)' : 'var(--color-emerald-400)';
  const catBg = item.cat === 'macro' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)';
  const catBorder = item.cat === 'macro' ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)';
  return (
    <div className="news-item">
      <div className="news-meta font-mono">
        <span className="news-tag" style={{ color: catColor, background: catBg, borderColor: catBorder }}>{item.tag}</span>
        <span className="news-time">{item.timeStr}</span>
      </div>
      <a href={item.link} target="_blank" rel="noreferrer" className="news-link">
        <p className="news-title">{item.title}</p>
        {item.snippet && <p className="news-snippet">{item.snippet}</p>}
      </a>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const INIT = {
  btc: null,          // { price, change, high, low, volume }
  klines: [],         // [{time, open, high, low, close, volume}]
  lsHistory: [],      // [{longShortRatio, longAccount, shortAccount, timestamp}]
  fundingRate: null,
  openInterest: null,
  oiHistory: [],

  globalData: null,
  stablecoins: null,
  news: [],
  logs: [],
  onChain: null,      // Blockchain.info network stats
  onChainMetrics: null, // CoinMetrics community data
  fedFundsRate: null,
  cpi: null,
  unrate: null,
  tenYearYield: null,
  dxy: null,
  sp500: null,
  vix: null,
  m2Supply: null,
  highYield: null,
  qqq: null,
  ethPrice: null,
  solPrice: null,
  linkPrice: null,
  netLiquidity: 6050.25, // default baseline
  cotData: null,
};

// US Spot Bitcoin ETFs Baseline Holdings (Fallback)
const BASELINE_ETF_HOLDINGS = {
  funds: [
    { name: 'BlackRock (IBIT)', holdings: 774434, marketShare: '61.5%' },
    { name: 'Grayscale (GBTC)', holdings: 145028, marketShare: '11.5%' },
    { name: 'Fidelity (FBTC)', holdings: 180084, marketShare: '14.3%' },
    { name: 'Others (ARKB, BITB...)', holdings: 159118, marketShare: '12.6%' },
  ],
  total: 1258664
};

const BASELINE_ETF_FLOWS = [
  { date: '26/05', flow: -333.6 },
  { date: '27/05', flow: -733.4 },
  { date: '28/05', flow: -223.3 },
  { date: '29/05', flow: -125.3 },
  { date: '01/06', flow: -483.8 },
  { date: '02/06', flow: -519.1 },
  { date: '03/06', flow: -396.6 },
  { date: '04/06', flow: 3.2 },
  { date: '05/06', flow: -325.7 },
];

const BASELINE_CME_COT = {
  date: '02/06/2026',
  openInterest: 19882,
  assetManager: { long: 5256, longChange: -694, short: 2153, shortChange: 555, net: 3103, netChange: -1249 },
  leveragedFunds: { long: 6269, longChange: 1603, short: 12827, shortChange: -473, net: -6558, netChange: 2076 }
};

function App() {
  const { tooltipsEnabled, setTooltipsEnabled } = useTooltipSettings();
  const [data, setData] = useState(INIT);
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.slice(1);
    const validTabs = ['dashboard', 'hft', 'cascade', 'summary', 'glossary', 'terminal'];
    return validTabs.includes(hash) ? hash : 'dashboard';
  });

  const [aiSummary, setAiSummary] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [etfHoldings, setEtfHoldings] = useState(() => {
    try {
      const saved = localStorage.getItem('etf-holdings');
      return saved ? JSON.parse(saved) : BASELINE_ETF_HOLDINGS;
    } catch {
      return BASELINE_ETF_HOLDINGS;
    }
  });

  useEffect(() => {
    if (data.cotData === null) {
      setData(prev => ({ ...prev, cotData: BASELINE_CME_COT }));
    }
  }, [data.cotData]);

  const [etfHistory, setEtfHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('etf-flow-history');
      return saved ? JSON.parse(saved) : BASELINE_ETF_FLOWS;
    } catch {
      return BASELINE_ETF_FLOWS;
    }
  });

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      const validTabs = ['dashboard', 'hft', 'cascade', 'summary', 'glossary', 'terminal'];
      if (validTabs.includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const logsRef = useRef([]);

  // Theme State
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // API Keys state for macro data
  const [apiKeys, setApiKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('app-api-keys');
      return saved ? JSON.parse(saved) : { fred: '', alphaVantage: '', openRouter: '' };
    } catch {
      return { fred: '', alphaVantage: '', openRouter: '' };
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  // ── Binance WebSocket — realtime prices + funding rate ──────────────────
  const { livePrice, liveChange, liveHigh, liveLow, liveVolume, liveFunding, liveEthPrice, liveSolPrice, liveLinkPrice, wsStatus } =
    useBinanceWebSocket();

  // ── HFT WebSocket Streams ──────────────────────────────────────────────────────
  const { cvd, buyVolume, sellVolume, volumeRatio, cvdHistory, cvdStatus } = useCVDStream();


  const addLog = useCallback((msg, type = 'info') => {
    const entry = { time: new Date().toLocaleTimeString('vi-VN'), msg, type };
    logsRef.current = [entry, ...logsRef.current].slice(0, 80);
    return entry;
  }, []);

  const syncData = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    addLog('Bắt đầu đồng bộ dữ liệu từ tất cả nguồn...', 'system');

    addLog('Đang đồng bộ chỉ số vĩ mô từ FRED & NY Fed...', 'system');
    
    let fedFundsRateVal = null;
    let cpiVal = null;
    let unrateVal = null;
    let m2SupplyVal = null;
    let highYieldVal = null;
    let walclVal = null;
    let tgaVal = null;
    let rrpVal = null;

    try {
      fedFundsRateVal = await getFREDMetric('FEDFUNDS');
      addLog('✓ Lãi suất Fed (Trading Economics / FRED)', 'ok');
    } catch (e) {
      addLog('✗ Lãi suất Fed — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      cpiVal = await getFREDMetric('CPIAUCSL');
      addLog('✓ CPI Inflation (Trading Economics / FRED)', 'ok');
    } catch (e) {
      addLog('✗ CPI Inflation — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      unrateVal = await getFREDMetric('UNRATE');
      addLog('✓ Tỷ lệ thất nghiệp (Trading Economics / FRED)', 'ok');
    } catch (e) {
      addLog('✗ Tỷ lệ thất nghiệp — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      m2SupplyVal = await getFREDMetric('M2SL');
      addLog('✓ M2 Money Supply (Trading Economics / FRED)', 'ok');
    } catch (e) {
      addLog('✗ M2 Money Supply — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      highYieldVal = await getFREDMetric('BAMLH0A0HYM2EY');
      addLog('✓ High Yield Spread (YCharts / FRED)', 'ok');
    } catch (e) {
      addLog('✗ High Yield Spread — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      walclVal = await getFREDMetric('WALCL');
      addLog('✓ Fed Assets (Trading Economics / FRED)', 'ok');
    } catch (e) {
      addLog('✗ Fed Assets — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      tgaVal = await getFREDMetric('WDTGAL');
      addLog('✓ TGA Treasury Account (US Treasury / FRED)', 'ok');
    } catch (e) {
      addLog('✗ TGA Treasury Account — thất bại: ' + e.message, 'error');
    }
    await new Promise(r => setTimeout(r, 200));

    try {
      rrpVal = await getFREDMetric('RRPONTSYD');
      addLog('✓ Reverse Repo (NY Fed / FRED)', 'ok');
    } catch (e) {
      addLog('✗ Reverse Repo — thất bại: ' + e.message, 'error');
    }

    addLog('Đang đồng bộ dữ liệu phái sinh, tin tức, ETF và chỉ số Yahoo Finance...', 'system');

    const [
      btcRes, klinesRes, lsRes, fundRes, oiRes, oiHistRes,
      globalRes, stableRes, newsRes,
      onChainRes, onChainMetricsRes,
      etfHoldingsRes, etfHistoryRes,
      cotRes,
      yield10yRes, dxyRes, sp500Res, vixRes, qqqRes
    ] = await Promise.allSettled([
      getBTCTicker24h('BTCUSDT'),
      getBTCKlines('BTCUSDT', '1h', 48),
      getLongShortRatio('BTCUSDT', '1h', 24),
      getFundingRate('BTCUSDT'),
      getOpenInterest('BTCUSDT'),
      getOIHistory('BTCUSDT', '1h', 24),
      getGlobalCryptoData(),
      getStablecoinData(),
      fetchRealtimeFeed(),
      getBTCOnChain(),
      getBTCOnChainMetrics(),
      getETFHoldings(),
      getETFFlowHistory(),
      getCMECot(),
      getFREDMetric('DGS10'),     // Yield 10Y (Yahoo Finance)
      getDXYQuote(),              // DXY (Yahoo Finance)
      getFREDStockQuote('SP500'), // S&P 500 (Yahoo Finance)
      getFREDStockQuote('VIXCLS'), // VIX (Yahoo Finance)
      getFREDStockQuote('NASDAQ100') // Nasdaq (Yahoo Finance)
    ]);

    const get = (res, label, hasKey) => {
      if (res.status === 'fulfilled' && res.value != null) {
        addLog(`✓ ${label}`, 'ok');
        return res.value;
      }
      if (!hasKey) {
        return null; // Silent skip
      }
      const errMsg = res.status === 'rejected' ? res.reason?.message : 'Không nhận được dữ liệu (lỗi API hoặc phản hồi trống)';
      addLog(`✗ ${label} — thất bại: ${errMsg}`, 'error');
      return null;
    };

    const btc             = get(btcRes,             'BTC Ticker (Binance)', true);
    const klines          = get(klinesRes,          'BTC Klines 48h (Binance)', true) || [];
    const lsHistory       = get(lsRes,              'L/S Ratio 24h (Binance)', true) || [];
    const fundingRate     = get(fundRes,            'Funding Rate (Binance)', true);
    const openInterest    = get(oiRes,              'Open Interest (Binance)', true);
    const oiHistory       = get(oiHistRes,          'OI History 24h (Binance)', true) || [];

    const globalData      = get(globalRes,          'Global Market (CoinGecko)', true);
    const stablecoins     = get(stableRes,          'Stablecoins (CoinGecko)', true);
    const news            = get(newsRes,            'News RSS (rss2json)', true) || [];
    const onChain         = get(onChainRes,         'BTC Network (blockchain.info)', true);
    const onChainMetrics  = get(onChainMetricsRes,  'On-chain Metrics (CoinMetrics)', true);
    const etfHoldingsVal  = get(etfHoldingsRes,     'Spot ETF Holdings (Bitbo)', true);
    const etfHistoryVal   = get(etfHistoryRes,      'Spot ETF Flow History (Farside)', true);
    const cotData         = get(cotRes,             'Báo cáo CME COT (Tradingster)', true);
    const tenYearYield    = get(yield10yRes,        'Yield 10Y (Yahoo Finance)', true);
    const dxy             = get(dxyRes,             'Chỉ số DXY (Yahoo Finance)', true);
    const sp500           = get(sp500Res,           'S&P 500 Index (Yahoo Finance)', true);
    const vix             = get(vixRes,             'VIX Volatility Index (Yahoo Finance)', true);
    const qqq             = get(qqqRes,             'Nasdaq 100 Index (Yahoo Finance)', true);

    const now = new Date().toLocaleString('vi-VN');
    addLog(`Đồng bộ hoàn tất lúc ${now}`, 'system');

    if (etfHoldingsVal) {
      setEtfHoldings(etfHoldingsVal);
      localStorage.setItem('etf-holdings', JSON.stringify(etfHoldingsVal));
    }
    if (etfHistoryVal) {
      setEtfHistory(etfHistoryVal);
      localStorage.setItem('etf-flow-history', JSON.stringify(etfHistoryVal));
    }

    let netLiquidity = null;
    if (walclVal != null && tgaVal != null && rrpVal != null) {
      netLiquidity = (walclVal / 1000) - (tgaVal / 1000) - rrpVal;
      netLiquidity = parseFloat(netLiquidity.toFixed(2));
    }

    setData(prev => ({
      btc:            btc          ?? prev.btc,
      klines:         klines.length > 0 ? klines : prev.klines,
      lsHistory:      lsHistory.length > 0 ? lsHistory : prev.lsHistory,
      fundingRate:    fundingRate   ?? prev.fundingRate,
      openInterest:   openInterest  ?? prev.openInterest,
      oiHistory:      oiHistory.length > 0 ? oiHistory : prev.oiHistory,
      globalData:     globalData   ?? prev.globalData,
      stablecoins:    stablecoins  ?? prev.stablecoins,
      news:           news.length > 0 ? news : prev.news,
      logs:           [...logsRef.current],
      onChain:        onChain      ?? prev.onChain,
      onChainMetrics: onChainMetrics ?? prev.onChainMetrics,
      fedFundsRate:   fedFundsRateVal ?? prev.fedFundsRate,
      cpi:            cpiVal          ?? prev.cpi,
      unrate:         unrateVal       ?? prev.unrate,
      tenYearYield:   tenYearYield    ?? prev.tenYearYield,
      dxy:            dxy             ?? prev.dxy,
      m2Supply:       m2SupplyVal     ?? prev.m2Supply,
      highYield:      highYieldVal    ?? prev.highYield,
      sp500:          sp500           ?? prev.sp500,
      vix:            vix             ?? prev.vix,
      qqq:            qqq             ?? prev.qqq,
      netLiquidity:   netLiquidity    ?? prev.netLiquidity,
      cotData:        cotData         ?? prev.cotData,
    }));

    setLastSync(now);
    setIsOnline(btc != null || klines.length > 0);
    setIsSyncing(false);
  }, [isSyncing, addLog, apiKeys]);

  // Tự động đồng bộ hàng ngày lúc 08:00 AM
  useEffect(() => {
    const checkAutoSync = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDateStr = now.toLocaleDateString('vi-VN');
      
      const lastAutoSyncDate = localStorage.getItem('last-auto-sync-date');
      
      if (currentHour >= 8 && lastAutoSyncDate !== currentDateStr) {
        addLog('[Auto-Sync] Đến giờ đồng bộ hàng ngày (08:00 AM). Đang tự động cập nhật...', 'system');
        syncData();
        localStorage.setItem('last-auto-sync-date', currentDateStr);
      }
    };

    checkAutoSync();
    const interval = setInterval(checkAutoSync, 60 * 1000);
    return () => clearInterval(interval);
  }, [syncData, addLog]);

  // Initial load + auto-refresh every 5 min
  useEffect(() => {
    syncData();
    const timer = setInterval(() => syncData(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line

  // ── Derived chart data ──────────────────────────────────────────────────────
  const btcChartData = {
    labels: data.klines.map(k => k.time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
    datasets: [{
      data: data.klines.map(k => k.close),
      borderColor: theme === 'light' ? '#047857' : '#10b981',
      backgroundColor: theme === 'light' ? 'rgba(4, 120, 87, 0.05)' : 'rgba(16,185,129,0.05)',
      borderWidth: 1.5,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
    }],
  };

  const lsChartData = {
    labels: data.lsHistory.map(r => new Date(r.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
    datasets: [
      {
        label: 'Long %',
        data: data.lsHistory.map(r => (parseFloat(r.longAccount) * 100).toFixed(2)),
        borderColor: theme === 'light' ? '#047857' : '#10b981',
        backgroundColor: theme === 'light' ? 'rgba(4, 120, 87, 0.15)' : 'rgba(16,185,129,0.15)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: 'Short %',
        data: data.lsHistory.map(r => (parseFloat(r.shortAccount) * 100).toFixed(2)),
        borderColor: theme === 'light' ? '#be123c' : '#f43f5e',
        backgroundColor: theme === 'light' ? 'rgba(190, 18, 60, 0.05)' : 'rgba(244,63,94,0.05)',
        borderWidth: 1.5,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  };

  const oiChartData = {
    labels: data.oiHistory.map(r => new Date(r.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
    datasets: [{
      label: 'OI (BTC)',
      data: data.oiHistory.map(r => parseFloat(r.sumOpenInterest).toFixed(0)),
      backgroundColor: (ctx) => {
        const i = ctx.dataIndex;
        if (i === 0) return theme === 'light' ? 'rgba(49, 46, 129, 0.7)' : 'rgba(99,102,241,0.6)';
        const prev = parseFloat(ctx.dataset.data[i - 1]);
        const curr = parseFloat(ctx.dataset.data[i]);
        if (curr >= prev) {
          return theme === 'light' ? 'rgba(4, 120, 87, 0.8)' : 'rgba(16,185,129,0.7)';
        } else {
          return theme === 'light' ? 'rgba(190, 18, 60, 0.8)' : 'rgba(244,63,94,0.7)';
        }
      },
      borderRadius: 2,
      borderSkipped: false,
    }],
  };

  const currentLS = data.lsHistory[data.lsHistory.length - 1];
  // Use live WebSocket funding rate if available, fallback to REST
  const fund = liveFunding ?? data.fundingRate;
  const fundInfo = fundingLabel(fund);
  // Use live WebSocket BTC price if available, fallback to REST
  const btcDisplay = livePrice ? {
    price: livePrice,
    change: liveChange,
    high: liveHigh ?? data.btc?.high,
    low: liveLow ?? data.btc?.low,
    volume: liveVolume ?? data.btc?.volume,
  } : data.btc;

  // ── ETF Net Flows Bar Chart ────────────────────────────────────────────────
  const etfFlowChartData = {
    labels: etfHistory.map(h => h.date),
    datasets: [{
      label: 'Net Flow (M USD)',
      data: etfHistory.map(h => h.flow),
      backgroundColor: etfHistory.map(h => {
        if (h.flow >= 0) {
          return theme === 'light' ? '#047857' : '#10b981';
        } else {
          return theme === 'light' ? '#be123c' : '#f43f5e';
        }
      }),
      borderColor: etfHistory.map(h => {
        if (h.flow >= 0) {
          return theme === 'light' ? '#064e3b' : '#059669';
        } else {
          return theme === 'light' ? '#881337' : '#e11d48';
        }
      }),
      borderWidth: 1,
      borderRadius: 2,
    }]
  };

  const etfFlowChartOpts = {
    ...getChartOpts(theme),
    plugins: {
      ...getChartOpts(theme).plugins,
      tooltip: {
        ...getChartOpts(theme).plugins.tooltip,
        callbacks: {
          label: (context) => ` Dòng tiền ròng: ${context.parsed.y >= 0 ? '+' : ''}${context.parsed.y}M USD`
        }
      }
    },
    scales: {
      ...getChartOpts(theme).scales,
      y: {
        ...getChartOpts(theme).scales.y,
        ticks: {
          ...getChartOpts(theme).scales.y.ticks,
          callback: (v) => `${v >= 0 ? '+' : ''}${v}M`
        }
      }
    }
  };




  return (
    <div className="app-container">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-box">
            <Activity className="logo-icon" />
          </div>
          <div>
            <div className="title-group">
              <h1 className="app-title font-mono">SOVEREIGN MACRO TERMINAL</h1>
              <span className="version-badge font-mono">v5.0-LIVE</span>
            </div>
            <p className="subtitle font-mono">
              Phân tích dòng tiền phi cảm xúc • Hoài nghi Socratic • Dữ liệu thực thời gian thực
            </p>
          </div>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={() => setTooltipsEnabled(!tooltipsEnabled)} title={tooltipsEnabled ? "Tắt Tooltip (Alt+T)" : "Bật Tooltip (Alt+T)"} style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: tooltipsEnabled ? 'var(--color-emerald-400)' : 'var(--text-slate-500)', padding: '6px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HelpCircle size={16} />
          </button>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="API Settings" style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-slate-300)', padding: '6px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Settings size={16} />
          </button>
          <button className="btn-icon" onClick={toggleTheme} title="Toggle Theme" style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-slate-300)', padding: '6px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="status-box font-mono">
            <LiveDot active={isOnline} />
            <span className="text-slate-400">{isOnline ? 'LIVE' : 'OFFLINE'}</span>
            {lastSync && <><span className="text-slate-500">•</span><span className="sync-time">{lastSync}</span></>}
          </div>
          {/* WebSocket status badge */}
          <div className={`ws-badge font-mono ws-${wsStatus}`}>
            {wsStatus === 'connected'
              ? <><Zap size={10} /> WS LIVE</>
              : wsStatus === 'connecting'
              ? <><Radio size={10} className="spinning" /> WS...</>  
              : <><Radio size={10} /> WS OFF</>}
          </div>
          <div className="auto-refresh-badge font-mono">REST ⟳ 5MIN</div>
          <button className="btn-sync font-mono" onClick={syncData} disabled={isSyncing}>
            <RefreshCw size={13} className={isSyncing ? 'spinning' : ''} />
            {isSyncing ? 'ĐANG ĐỒNG BỘ...' : 'SYNC NGAY'}
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="main-content">
        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside className="sidebar glass-panel">
          <div className="sidebar-inner">

            {/* BTC Price row */}
            <div className="sidebar-top-row">
              <div className="btc-hero">
                <Tooltip content={METRIC_METADATA.btcPrice}>
                  <span className="metric-label font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
                    BITCOIN
                    {wsStatus === 'connected' && <span className="ws-live-tag font-mono"> ⚡</span>}
                  </span>
                </Tooltip>
                <span className={`btc-price font-mono${livePrice ? ' ws-price-live' : ''}`}>
                  ${btcDisplay?.price ? fmt(btcDisplay.price, 0) : '---'}
                </span>
                {btcDisplay?.change != null && (
                  <span className={`btc-change font-mono ${btcDisplay.change >= 0 ? 'text-emerald' : 'text-rose'}`}>
                    {btcDisplay.change >= 0 ? '▲' : '▼'} {Math.abs(btcDisplay.change).toFixed(2)}%
                  </span>
                )}
              </div>
            </div>

            <div className="sidebar-divider" />

            {/* Metrics grid — Derivatives */}
            <h3 className="widget-title font-mono">
              <LiveDot /> PHÁI SINH REALTIME
            </h3>
            <div className="metrics-grid">
              <MetricCard
                label="FUNDING RATE"
                value={fund != null ? `${(fund * 100).toFixed(4)}%` : '---'}
                sub={fundInfo.text}
                subCls={fundInfo.cls}
                badge={liveFunding != null ? '⚡WS' : null}
                badgeCls="badge-ws"
                tooltipId="funding"
              />
              <MetricCard
                label="OPEN INTEREST"
                value={data.openInterest ? `${(data.openInterest / 1000).toFixed(1)}K BTC` : '---'}
                sub="Derivatives"
                subCls="text-slate-400"
                tooltipId="oi"
              />
              <MetricCard
                label="L/S RATIO"
                value={currentLS ? parseFloat(currentLS.longShortRatio).toFixed(3) : '---'}
                sub={currentLS ? `Long ${(parseFloat(currentLS.longAccount) * 100).toFixed(1)}%` : ''}
                subCls={currentLS && parseFloat(currentLS.longAccount) > 0.55 ? 'text-rose' : 'text-emerald'}
                tooltipId="lsRatio"
              />
              <MetricCard
                label="BTC DOMINANCE"
                value={data.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---'}
                sub={data.globalData?.ethDominance ? `ETH ${data.globalData.ethDominance}%` : ''}
                subCls="text-slate-400"
                tooltipId="btcDom"
              />
              <MetricCard
                label="STABLECOIN CAP"
                value={data.stablecoins ? fmtB(data.stablecoins.total) : '---'}
                sub={data.stablecoins ? `USDT ${fmtB(data.stablecoins.usdt)}` : ''}
                subCls="text-slate-400"
                tooltipId="stablecoin"
              />
              <MetricCard
                label="TOTAL MARKET CAP"
                value={data.globalData ? fmtT(data.globalData.totalMarketCap) : '---'}
                sub={data.globalData?.marketCapChange24h ? `${data.globalData.marketCapChange24h}% 24h` : ''}
                subCls={data.globalData?.marketCapChange24h > 0 ? 'text-emerald' : 'text-rose'}
                tooltipId="totalMcap"
              />
              <MetricCard
                label="BTC 24H VOL"
                value={btcDisplay ? fmtB(btcDisplay.volume) : '---'}
                sub="USDT Volume"
                subCls="text-slate-400"
                tooltipId="volume24h"
              />
              <MetricCard
                label="24H RANGE"
                value={btcDisplay ? `${fmt(btcDisplay.low, 0)}` : '---'}
                sub={btcDisplay ? `H: ${fmt(btcDisplay.high, 0)}` : ''}
                subCls="text-slate-400"
                tooltipId="range24h"
              />
            </div>

            <div className="sidebar-divider" />

            <h3 className="widget-title font-mono">
              <LiveDot /> DỮ LIỆU KINH TẾ MỸ (HÀNG THÁNG)
            </h3>
            <div className="metrics-grid">
              <MetricCard
                label="CPI"
                value={data.cpi ? data.cpi.toFixed(2) : '---'}
                sub="Chỉ số giá tiêu dùng"
                subCls="text-slate-400"
                tooltipId="cpi"
              />
              <MetricCard
                label="UNEMPLOYMENT"
                value={data.unrate ? `${data.unrate}%` : '---'}
                sub="Tỷ lệ thất nghiệp"
                subCls="text-slate-400"
                tooltipId="unrate"
              />
            </div>

            <div className="sidebar-divider" />

            {/* On-chain Network Stats — Blockchain.info */}
            <h3 className="widget-title font-mono">
              <LiveDot /> BTC NETWORK (ON-CHAIN)
            </h3>
            <div className="metrics-grid">
              <MetricCard
                label="HASH RATE"
                value={data.onChain?.hashRate ? `${data.onChain.hashRate} EH/s` : '---'}
                sub="Mining Power"
                subCls="text-slate-400"
                tooltipId="hashRate"
              />
              <MetricCard
                label="DIFFICULTY"
                value={data.onChain?.difficulty ? `${data.onChain.difficulty}T` : '---'}
                sub="Mining Difficulty"
                subCls="text-slate-400"
                tooltipId="difficulty"
              />
              <MetricCard
                label="TX / 24H"
                value={data.onChain?.txCount24h ? data.onChain.txCount24h.toLocaleString() : '---'}
                sub="Transactions"
                subCls="text-slate-400"
                tooltipId="txCount"
              />
              <MetricCard
                label="BLOCK TIME"
                value={data.onChain?.minutesBetweenBlocks ? `${data.onChain.minutesBetweenBlocks}m` : '---'}
                sub={data.onChain?.minutesBetweenBlocks < 10 ? 'Fast ↑' : 'Normal'}
                subCls={data.onChain?.minutesBetweenBlocks < 10 ? 'text-emerald' : 'text-slate-400'}
                tooltipId="blockTime"
              />
              <MetricCard
                label="ACTIVE ADDR"
                value={data.onChainMetrics?.activeAddresses || '---'}
                sub="Unique senders/day"
                subCls="text-slate-400"
                tooltipId="activeAddr"
              />
              <MetricCard
                label="MVRV RATIO"
                value={data.onChainMetrics?.mvrv || '---'}
                sub={data.onChainMetrics?.mvrv > 3.5 ? 'Overvalued ⚠' : data.onChainMetrics?.mvrv < 1 ? 'Undervalued ✓' : 'Fair Value'}
                subCls={data.onChainMetrics?.mvrv > 3.5 ? 'text-rose' : data.onChainMetrics?.mvrv < 1 ? 'text-emerald' : 'text-slate-400'}
                tooltipId="mvrv"
              />
            </div>

            <div className="sidebar-divider" />

            {/* News Feed */}
            <h3 className="widget-title font-mono">
              <LiveDot /> DÒNG TIN VĨ MÔ &amp; CRYPTO
            </h3>
            <div className="news-feed">
              {data.news.length === 0 ? (
                <div className="news-empty font-mono">
                  {isSyncing ? 'Đang tải tin tức...' : 'Nhấn SYNC để tải tin tức'}
                </div>
              ) : (
                data.news.map((item, i) => <NewsItem key={i} item={item} />)
              )}
            </div>

          </div>
        </aside>

        {/* ── Main Content Area ─────────────────────────────────────────────── */}
        <main className="content-area">
          <nav className="tabs-nav font-mono">
            {[
              { id: 'dashboard', icon: <BarChart2 size={13} />, label: 'DASHBOARD' },
              { id: 'hft',       icon: <Crosshair size={13} />, label: 'HFT RADAR' },
              { id: 'cascade',   icon: <Layers size={13} />,    label: 'THÁC THANH KHOẢN' },
              { id: 'summary',   icon: <Sparkles size={13} />,  label: 'AI SUMMARY' },
              { id: 'glossary',  icon: <HelpCircle size={13} />, label: 'THUẬT NGỮ' },
              { id: 'terminal',  icon: <Terminal size={13} />,  label: 'TERMINAL LOGS' },
            ].map(t => (
              <button
                key={t.id}
                className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">

            {/* ══ DASHBOARD TAB ══════════════════════════════════════════════ */}
            {activeTab === 'dashboard' && (
              <div className="dashboard-layout">

                {/* BTC Price Chart */}
                <div className="glass-panel chart-panel">
                  <div className="chart-header">
                    <h3 className="chart-title font-mono text-emerald">
                      <span className="dot dot-emerald" /> BTC/USDT — GIÁ 48 GIỜ GẦN NHẤT (1H)
                    </h3>
                    <span className="chart-badge font-mono">
                      {data.btc ? `$${fmt(data.btc.price, 0)}` : '---'}
                      {data.btc?.change != null && (
                        <span className={data.btc.change >= 0 ? 'text-emerald' : 'text-rose'}>
                          {' '}{data.btc.change >= 0 ? '+' : ''}{data.btc.change.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="chart-body">
                    {data.klines.length > 0
                      ? <Line data={btcChartData} options={{
                          ...getChartOpts(theme),
                          scales: {
                            ...getChartOpts(theme).scales,
                            y: { ...getChartOpts(theme).scales.y, ticks: { ...getChartOpts(theme).scales.y.ticks, callback: v => `$${(v/1000).toFixed(1)}k` } }
                          }
                        }} />
                      : <div className="chart-empty font-mono">Đang tải dữ liệu biểu đồ...</div>
                    }
                  </div>
                </div>

                {/* L/S Ratio & OI Charts */}
                <div className="charts-row">
                  <div className="glass-panel chart-panel">
                    <div className="chart-header">
                      <h3 className="chart-title font-mono text-emerald">
                        <span className="dot dot-emerald" /> LONG/SHORT RATIO — 24H
                      </h3>
                      <div className="chart-legend font-mono">
                        <span className="legend-dot" style={{ background: '#10b981' }} />Long
                        <span className="legend-dot" style={{ background: '#f43f5e', marginLeft: 8 }} />Short
                      </div>
                    </div>
                    <div className="chart-body">
                      {data.lsHistory.length > 0
                        ? <Line data={lsChartData} options={{
                            ...getChartOpts(theme),
                            plugins: { ...getChartOpts(theme).plugins, legend: { display: false } },
                            scales: {
                              ...getChartOpts(theme).scales,
                              y: { ...getChartOpts(theme).scales.y, ticks: { ...getChartOpts(theme).scales.y.ticks, callback: v => `${v}%` } }
                            }
                          }} />
                        : <div className="chart-empty font-mono">Đang tải...</div>
                      }
                    </div>
                  </div>

                  <div className="glass-panel chart-panel">
                    <div className="chart-header">
                      <h3 className="chart-title font-mono text-amber">
                        <span className="dot dot-amber" /> OPEN INTEREST — 24H (BTC)
                      </h3>
                      <span className="chart-badge font-mono">
                        {data.openInterest ? `${(data.openInterest / 1000).toFixed(1)}K BTC` : '---'}
                      </span>
                    </div>
                    <div className="chart-body">
                      {data.oiHistory.length > 0
                        ? <Bar data={oiChartData} options={getChartOpts(theme)} />
                        : <div className="chart-empty font-mono">Đang tải...</div>
                      }
                    </div>
                  </div>
                </div>


                {/* US Spot Bitcoin ETFs Row */}
                <div className="whales-row">
                  {/* Spot ETFs Holdings Panel */}
                  <div className="glass-panel whale-panel">
                    <h3 className="chart-title font-mono text-emerald" style={{ marginBottom: 16 }}>
                      <span className="dot dot-emerald" /> US SPOT BITCOIN ETFS (TOTAL: {fmt(etfHoldings.total, 0)} BTC)
                    </h3>
                    <div className="etf-summary font-mono">
                      <div className="etf-sum-card">
                        <span className="etf-sum-label">TOTAL AUM</span>
                        <span className="etf-sum-val text-emerald">${fmt((etfHoldings.total * (btcDisplay?.price || 60000)) / 1e9, 2)}B</span>
                      </div>
                      <div className="etf-sum-card">
                        <span className="etf-sum-label">NET FLOWS (24H)</span>
                        <span className={`etf-sum-val ${etfHistory[etfHistory.length - 1]?.flow >= 0 ? 'text-emerald' : 'text-rose'}`}>
                          {etfHistory[etfHistory.length - 1]?.flow >= 0 ? '+' : ''}{etfHistory[etfHistory.length - 1]?.flow}M
                        </span>
                      </div>
                      <div className="etf-sum-card">
                        <span className="etf-sum-label">% SUPPLY HELD</span>
                        <span className="etf-sum-val text-slate-300">
                          ~{((etfHoldings.total / (data.node?.circulatingSupply || 20039293.75)) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="whale-table font-mono" style={{ width: '100%', fontSize: '0.62rem' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '6px 4px' }}>ETF FUND</th>
                            <th style={{ textAlign: 'right', padding: '6px 4px' }}>HOLDINGS</th>
                            <th style={{ textAlign: 'right', padding: '6px 4px' }}>VALUE</th>
                            <th style={{ textAlign: 'right', padding: '6px 4px' }}>SHARE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {etfHoldings.funds.map((e, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-panel)' }}>
                              <td style={{ padding: '8px 4px', color: 'var(--text-contrast)' }}>{e.name}</td>
                              <td style={{ padding: '8px 4px', textAlign: 'right' }}>{e.holdings.toLocaleString()} BTC</td>
                              <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-contrast)' }}>${fmt((e.holdings * (btcDisplay?.price || 60000)) / 1e9, 2)}B</td>
                              <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--text-slate-400)' }}>{e.marketShare}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Spot ETFs Net Flow History Chart Panel */}
                  <div className="glass-panel whale-panel">
                    <h3 className="chart-title font-mono text-emerald" style={{ marginBottom: 16 }}>
                      <span className="dot dot-emerald" /> LỊCH SỬ DÒNG TIỀN RÒNG (NET FLOWS)
                    </h3>
                    <div className="chart-body" style={{ height: '220px' }}>
                      {etfHistory.length > 0 ? (
                        <Bar data={etfFlowChartData} options={etfFlowChartOpts} />
                      ) : (
                        <div className="chart-empty font-mono">Đang tải biểu đồ dòng tiền...</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* CME COT Table Row */}
                <div className="fng-cot-row">
                    {/* CME Bitcoin COT positions table */}
                    <div className="glass-panel whale-panel" style={{ height: '100%' }}>
                      <h3 className="chart-title font-mono text-amber" style={{ marginBottom: 16 }}>
                        <span className="dot dot-amber" /> CME BITCOIN FUTURES COT (AS OF {data.cotData?.date || 'N/A'})
                      </h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="whale-table font-mono" style={{ width: '100%', fontSize: '0.62rem' }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '6px 4px' }}>TRADER GROUP</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px' }}>LONG</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px' }}>SHORT</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px' }}>NET POS</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: '1px solid var(--border-panel)' }}>
                              <td style={{ padding: '8px 4px', color: 'var(--text-contrast)', fontWeight: 'bold' }}>Asset Managers</td>
                              <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                {data.cotData?.assetManager ? `${data.cotData.assetManager.long.toLocaleString()} (${data.cotData.assetManager.longChange >= 0 ? '+' : ''}${data.cotData.assetManager.longChange})` : '---'}
                              </td>
                              <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                {data.cotData?.assetManager ? `${data.cotData.assetManager.short.toLocaleString()} (${data.cotData.assetManager.shortChange >= 0 ? '+' : ''}${data.cotData.assetManager.shortChange})` : '---'}
                              </td>
                              <td style={{ padding: '8px 4px', textAlign: 'right', color: (data.cotData?.assetManager?.net >= 0) ? 'var(--color-emerald-400)' : 'var(--color-rose-400)', fontWeight: 600 }}>
                                {data.cotData?.assetManager ? `${data.cotData.assetManager.net >= 0 ? '+' : ''}${data.cotData.assetManager.net.toLocaleString()} (${data.cotData.assetManager.netChange >= 0 ? '+' : ''}${data.cotData.assetManager.netChange})` : '---'}
                              </td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border-panel)' }}>
                              <td style={{ padding: '8px 4px', color: 'var(--text-contrast)', fontWeight: 'bold' }}>Leveraged Funds</td>
                              <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                {data.cotData?.leveragedFunds ? `${data.cotData.leveragedFunds.long.toLocaleString()} (${data.cotData.leveragedFunds.longChange >= 0 ? '+' : ''}${data.cotData.leveragedFunds.longChange})` : '---'}
                              </td>
                              <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                                {data.cotData?.leveragedFunds ? `${data.cotData.leveragedFunds.short.toLocaleString()} (${data.cotData.leveragedFunds.shortChange >= 0 ? '+' : ''}${data.cotData.leveragedFunds.shortChange})` : '---'}
                              </td>
                              <td style={{ padding: '8px 4px', textAlign: 'right', color: (data.cotData?.leveragedFunds?.net >= 0) ? 'var(--color-emerald-400)' : 'var(--color-rose-400)', fontWeight: 600 }}>
                                {data.cotData?.leveragedFunds ? `${data.cotData.leveragedFunds.net >= 0 ? '+' : ''}${data.cotData.leveragedFunds.net.toLocaleString()} (${data.cotData.leveragedFunds.netChange >= 0 ? '+' : ''}${data.cotData.leveragedFunds.netChange})` : '---'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="font-mono text-slate-500" style={{ fontSize: '0.52rem', marginTop: '10px', textAlign: 'right' }}>
                        Open Interest: {data.cotData?.openInterest ? data.cotData.openInterest.toLocaleString() : '---'} contracts
                      </div>
                    </div>
                  </div>

              </div>
            )}



            {/* ══ CASCADE TAB ════════════════════════════════════════════════ */}
            {activeTab === 'cascade' && (
              <motion.div 
                className="cascade-layout"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="glass-panel panel-section">
                  <div className="panel-header">
                    <h3 className="panel-title font-mono text-emerald">
                      [BƯỚC 3] THÁC THANH KHOẢN — SƠ ĐỒ LƯU CHUYỂN
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-6" style={{ lineHeight: 1.7, textAlign: 'center' }}>
                    Tiền bắt đầu từ FED → chảy vào các thị trường theo thứ tự ưu tiên rủi ro. Sơ đồ minh họa phân bổ dòng tiền cơ sở.
                  </p>

                  <div className="cascade-flow">
                    {[
                      {
                        tier: 'TIER 0',
                        label: 'THƯỢNG NGUỒN VĨ MÔ',
                        desc: 'FED & Chính sách tiền tệ',
                        status: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? '[🔴 RESTRICTIVE]' : '[🟢 ACCOMMODATIVE]') : '[🔴 RESTRICTIVE]',
                        statusColor: data.fedFundsRate ? (data.fedFundsRate > 4.0 ? '#f43f5e' : '#10b981') : '#f43f5e',
                        items: [
                          { k: 'Fed Funds Rate', v: data.fedFundsRate ? `${data.fedFundsRate}%` : '4.25–4.50%', note: 'Lãi suất điều hành' },
                          { k: 'CPI Inflation', v: data.cpi ? data.cpi.toFixed(2) : '---', note: 'Chỉ số giá tiêu dùng' },
                          { k: 'Unemployment Rate', v: data.unrate ? `${data.unrate}%` : '---', note: 'Tỷ lệ thất nghiệp' },
                          { k: 'M2 Supply (Billion $)', v: data.m2Supply ? `$${fmt(data.m2Supply, 0)}` : '---', note: 'Tổng cung tiền M2' },
                          { k: 'US Net Liquidity (Billion $)', v: data.netLiquidity ? `$${fmt(data.netLiquidity, 0)}B` : '---', note: 'WALCL - TGA - RRP' },
                        ],
                        color: '#6366f1',
                      },
                      {
                        tier: 'TIER 1',
                        label: 'CHI PHÍ VỐN & USD',
                        desc: 'Khóa van thanh khoản',
                        status: data.dxy > 103 ? '[🔴 TIGHTENING]' : '[🟢 EASING]',
                        statusColor: data.dxy > 103 ? '#f43f5e' : '#10b981',
                        items: [
                          { k: 'DXY (Dollar Index)', v: data.dxy ? fmt(data.dxy, 2) : '---', note: 'Sức mạnh USD' },
                          { k: '10Y Treasury Yield', v: data.tenYearYield ? `${data.tenYearYield}%` : '---', note: 'Lợi suất TP 10 năm' },
                          { k: 'VIX Volatility', v: data.vix ? `${fmt(data.vix.price, 2)}` : '---', note: 'Chỉ số hoảng loạn' },
                        ],
                        color: '#f59e0b',
                      },
                      {
                        tier: 'TIER 2',
                        label: 'TÀI SẢN RỦI RO',
                        desc: 'Dòng vốn Equity & Credit',
                        status: data.sp500?.changePercent > 0 ? '[🟢 EXPANDING]' : '[🔴 CONTRACTING]',
                        statusColor: data.sp500?.changePercent > 0 ? '#10b981' : '#f43f5e',
                        items: [
                          { k: 'S&P 500 Index', v: data.sp500 ? `${fmt(data.sp500.price, 2)} (${data.sp500.changePercent >= 0 ? '+' : ''}${data.sp500.changePercent.toFixed(2)}%)` : '---', note: 'Chứng khoán Mỹ' },
                          { k: 'Nasdaq 100 Index', v: data.qqq ? `${fmt(data.qqq.price, 2)} (${data.qqq.changePercent >= 0 ? '+' : ''}${data.qqq.changePercent.toFixed(2)}%)` : '---', note: 'Cổ phiếu công nghệ' },
                          { k: 'High Yield Credit', v: data.highYield ? `${data.highYield}%` : '---', note: 'Rủi ro vỡ nợ' },
                        ],
                        color: '#10b981',
                      },
                      {
                        tier: 'TIER 3',
                        label: 'HẠ NGUỒN CRYPTO',
                        desc: 'On-chain & Phái sinh',
                        status: btcDisplay?.change >= 0 ? '[🟢 INFLOW]' : '[🔴 OUTFLOW]',
                        statusColor: btcDisplay?.change >= 0 ? '#10b981' : '#f43f5e',
                        items: [
                          { k: 'Stablecoin Supply', v: data.stablecoins ? fmtB(data.stablecoins.total) : '---', note: 'Sức mua cơ sở' },
                          { k: 'BTC Dominance', v: data.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---', note: 'Dòng vốn Altcoin' },
                          { k: 'Funding Rate', v: fund != null ? `${(fund * 100).toFixed(4)}%` : '---', note: 'Lệch pha phái sinh' },
                          { k: 'MVRV Ratio', v: data.onChainMetrics?.mvrv || '---', note: 'Định giá On-chain' },
                        ],
                        color: '#f43f5e',
                      },
                    ].map((tier, idx) => (
                      <React.Fragment key={idx}>
                        <motion.div 
                          className="cascade-tier" 
                          style={{ '--tier-color': tier.color }}
                          initial={{ opacity: 0, y: -20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.15, duration: 0.5 }}
                        >
                          <div className="cascade-tier-header">
                            <span className="cascade-tier-badge font-mono" style={{ color: tier.color, borderColor: tier.color }}>{tier.tier}</span>
                            <div className="cascade-tier-label font-mono" style={{ color: tier.color }}>{tier.label}</div>
                            <div className="cascade-tier-desc font-mono">{tier.desc}</div>
                            <div className="cascade-tier-status font-mono" style={{ color: tier.statusColor, border: `1px solid ${tier.statusColor}40`, background: `${tier.statusColor}10` }}>
                              {tier.status}
                            </div>
                          </div>
                          <div className="tree-nodes-row">
                            {tier.items.map((item, j) => {
                              const tooltipId = CASCADE_KEY_MAP[item.k];
                              const metadata = tooltipId ? METRIC_METADATA[tooltipId] : null;
                              return (
                                <div key={j} className="tree-node font-mono">
                                  {metadata ? (
                                    <Tooltip content={metadata}>
                                      <span className="tree-node-key" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)' }}>
                                        {item.k}
                                      </span>
                                    </Tooltip>
                                  ) : (
                                    <span className="tree-node-key">{item.k}</span>
                                  )}
                                  <span className="tree-node-val" style={{ color: 'var(--text-contrast)' }}>{item.v}</span>
                                  <span className="tree-node-note">{item.note}</span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                        {idx < 3 && (
                          <motion.div 
                            className="cascade-arrow" 
                            style={{ color: tier.color }}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: '40px' }}
                            transition={{ delay: idx * 0.15 + 0.1, duration: 0.4 }}
                          >
                            <div className="flow-line">
                               <div className="flow-dot"></div>
                            </div>
                          </motion.div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ══ TERMINAL TAB ═══════════════════════════════════════════════ */}
            {activeTab === 'terminal' && (
              <div className="glass-panel panel-section">
                <div className="panel-header">
                  <h3 className="panel-title font-mono text-emerald">
                    📟 SOVEREIGN CRAWLER — ACTIVITY LOG
                  </h3>
                  <span className="panel-badge font-mono">{data.logs.length} entries</span>
                </div>
                <div className="terminal-log font-mono">
                  {data.logs.length === 0
                    ? <div className="text-slate-500">Nhấn SYNC để xem log hoạt động...</div>
                    : data.logs.map((l, i) => (
                        <div key={i} className={`log-line log-${l.type}`}>
                          <span className="log-time">[{l.time}]</span>
                          <span className="log-msg">{l.msg}</span>
                        </div>
                      ))
                  }
                </div>
                <div className="terminal-summary font-mono">
                  <div className="summary-row">
                    <span className="text-slate-400">BTC:</span>
                    <span>${btcDisplay ? fmt(btcDisplay.price, 0) : '---'} {wsStatus === 'connected' ? '⚡' : ''}</span>
                    <span className="text-slate-400">Funding:</span>
                    <span className={fundInfo.cls}>{fund != null ? `${(fund * 100).toFixed(4)}%` : '---'}</span>
                    <span className="text-slate-400">OI:</span>
                    <span>{data.openInterest ? `${(data.openInterest/1000).toFixed(1)}K BTC` : '---'}</span>
                    <span className="text-slate-400">F&G:</span>
                    <span style={{ color: fngColor(fngData?.value, theme === 'light') }}>{fngData?.value || '---'}</span>
                    <span className="text-slate-400">HashRate:</span>
                    <span>{data.onChain?.hashRate ? `${data.onChain.hashRate}EH/s` : '---'}</span>
                    <span className="text-slate-400">WS:</span>
                    <span className={wsStatus === 'connected' ? 'text-emerald' : 'text-rose'}>{wsStatus.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'summary' && (
            <SummaryTab 
              data={data} 
              apiKeys={apiKeys} 
              cvd={cvd}
              buyVolume={buyVolume}
              sellVolume={sellVolume}
              etfHoldings={etfHoldings}
              etfHistory={etfHistory}
              aiSummary={aiSummary}
              setAiSummary={setAiSummary}
              isAiLoading={isAiLoading}
              setIsAiLoading={setIsAiLoading}
            />
          )}

            {activeTab === 'glossary' && (
              <GlossaryTab />
            )}

            {activeTab === 'hft' && (
              <HftRadarTab
                cvd={cvd}
                buyVolume={buyVolume}
                sellVolume={sellVolume}
                cvdHistory={cvdHistory}
                cvdStatus={cvdStatus}
                livePrice={livePrice || data.btc?.price}
                theme={theme}
              />
            )}

          </div>
        </main>
      </div>

      {showSettings && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ width: '400px', padding: '20px', background: 'var(--bg-panel-solid)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="font-mono text-emerald" style={{ margin: 0, fontSize: '0.8rem' }}>📟 CÀI ĐẶT API KEYS</h3>
              <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-slate-400)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            
            <p className="font-mono text-slate-400" style={{ fontSize: '0.62rem', margin: 0, lineHeight: 1.4 }}>
              Nhập các khóa API cá nhân để Terminal đồng bộ trực tiếp dữ liệu vĩ mô &amp; chứng khoán thực tế từ nguồn FRED &amp; Alpha Vantage.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="font-mono text-slate-400" style={{ fontSize: '0.55rem' }}>FRED API KEY</label>
              <input
                type="text"
                placeholder="Nhập FRED API key..."
                value={apiKeys.fred}
                onChange={(e) => setApiKeys(p => ({ ...p, fred: e.target.value }))}
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '8px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
              />
              <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem' }}>
                Lấy miễn phí tại: <a href="https://fred.stlouisfed.org/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>fred.stlouisfed.org</a>
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="font-mono text-slate-400" style={{ fontSize: '0.55rem' }}>ALPHA VANTAGE API KEY</label>
              <input
                type="text"
                placeholder="Nhập Alpha Vantage key..."
                value={apiKeys.alphaVantage}
                onChange={(e) => setApiKeys(p => ({ ...p, alphaVantage: e.target.value }))}
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '8px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
              />
              <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem' }}>
                Lấy miễn phí tại: <a href="https://www.alphavantage.co/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>alphavantage.co</a>
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="font-mono text-slate-400" style={{ fontSize: '0.55rem' }}>OPENROUTER API KEY</label>
              <input
                type="password"
                placeholder="Nhập OpenRouter API key..."
                value={apiKeys.openRouter || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, openRouter: e.target.value }))}
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '8px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
              />
              <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem' }}>
                Lấy miễn phí tại: <a href="https://openrouter.ai/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>openrouter.ai</a>
              </span>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                className="btn-sync font-mono"
                style={{ flex: 1, justifyContent: 'center', height: '34px', cursor: 'pointer' }}
                onClick={() => {
                  localStorage.setItem('app-api-keys', JSON.stringify(apiKeys));
                  setShowSettings(false);
                  addLog('Đã lưu cấu hình API Keys thành công. Đang tải lại dữ liệu...', 'ok');
                  syncData();
                }}
              >
                LƯU &amp; ĐỒNG BỘ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
