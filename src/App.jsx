import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import {
  getBTCTicker24h, getBTCKlines, getLongShortRatio,
  getFundingRate, getOpenInterest, getOIHistory,
  getGlobalCryptoData, getStablecoinData,
  fetchRealtimeFeed, getBTCOnChain, getBTCOnChainMetrics, getETHOnChainMetrics,
  getFREDMetric, getAlphaVantageQuote, getFREDStockQuote,
  getETFHoldings, getETFFlowHistory, getCMECot, getDXYQuote,
  getFearAndGreed, getHistoricalCVD, getIntradayCVD,
} from './services/api';
import { useBinanceWebSocket, useCVDStream } from './services/websocket';
import {
  Activity, RefreshCw, BarChart2, BookOpen, Layers,
  Terminal, HelpCircle, Zap, Radio, Crosshair, Moon, Sun, Settings, X, Sparkles
} from 'lucide-react';
import GlossaryTab from './components/GlossaryTab';
import HftRadarTab from './components/HftRadarTab';
import SummaryTab from './components/SummaryTab';
import DashboardTab from './components/DashboardTab';
import CascadeTab from './components/CascadeTab';
import TerminalTab from './components/TerminalTab';
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

const fmtCvdUsd = (n) => {
  if (n == null) return '---';
  const sign = n < 0 ? '-' : (n > 0 ? '+' : '');
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};


const fundingLabel = (r) => {
  if (r == null) return { text: '---', cls: '' };
  const pct = r * 100;
  if (pct > 0.05) return { text: 'Long OL ⚠', cls: 'text-rose' };
  if (pct > 0.01) return { text: 'Long Bias', cls: 'text-amber' };
  if (pct < -0.01) return { text: 'Short Bias', cls: 'text-emerald' };
  return { text: 'Balanced', cls: 'text-slate-400' };
};

const fngColor = (val, isLight) => {
  if (val == null) return isLight ? '#475569' : '#94a3b8';
  const v = Number(val);
  if (v >= 75) return '#10b981'; // Extreme Greed
  if (v >= 55) return '#059669'; // Greed
  if (v >= 45) return '#d97706'; // Neutral
  if (v >= 25) return '#ea580c'; // Fear
  return '#e11d48'; // Extreme Fear
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
  'Economic Cycle Phase': 'econCycle',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const fetchCached = async (cacheKey, fetchFn, expiryMs, addLog, label, force = false) => {
  let cachedVal = null;
  let hasCached = false;
  try {
    const cached = localStorage.getItem(`cache_${cacheKey}`);
    if (cached) {
      const { val, time } = JSON.parse(cached);
      cachedVal = val;
      hasCached = true;
      if (!force && (Date.now() - time < expiryMs)) {
        if (addLog && label) {
          addLog(`✓ ${label} (Dữ liệu cache)`, 'ok');
        }
        return val;
      }
    }
  } catch (e) {
    console.warn(`Lỗi đọc cache cho ${cacheKey}:`, e);
  }

  try {
    const freshVal = await fetchFn();
    if (freshVal !== null && freshVal !== undefined) {
      try {
        localStorage.setItem(`cache_${cacheKey}`, JSON.stringify({ val: freshVal, time: Date.now() }));
      } catch (e) {
        console.warn(`Lỗi ghi cache cho ${cacheKey}:`, e);
      }
      if (addLog && label) {
        addLog(`✓ ${label}`, 'ok');
      }
      return freshVal;
    } else {
      throw new Error("Phản hồi trống hoặc lỗi API");
    }
  } catch (e) {
    if (hasCached) {
      if (addLog && label) {
        addLog(`⚠ ${label} — lỗi truy vấn, dùng tạm cache cũ`, 'warning');
      }
      return cachedVal;
    }
    if (addLog && label) {
      addLog(`✗ ${label} — thất bại: ${e.message}`, 'error');
    }
  }
  return null;
};

const MetricCard = React.memo(function MetricCard({ label, value, sub, subCls, badge, badgeCls, tooltipId }) {
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
});

const LiveDot = React.memo(function LiveDot({ active = true }) {
  return (
    <span className="live-dot-wrap">
      <span className={`live-dot ${active ? 'live-dot--active' : ''}`} />
      <span className={`live-dot live-dot--ping ${active ? 'live-dot--active' : ''}`} />
    </span>
  );
});

const NewsItem = React.memo(function NewsItem({ item }) {
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
});

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
  onChainMetrics: null, // CoinMetrics community data for BTC
  ethOnChainMetrics: null, // CoinMetrics community data for ETH
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
  fngData: null,
  cvdHistory24h: [],
  cvdHistory7d: [],
  cvdHistory30d: [],
  btcDailyKlinesAll: [],
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
  { date: '26/05/26', flow: -333.6 },
  { date: '27/05/26', flow: -733.4 },
  { date: '28/05/26', flow: -223.3 },
  { date: '29/05/26', flow: -125.3 },
  { date: '01/06/26', flow: -483.8 },
  { date: '02/06/26', flow: -519.1 },
  { date: '03/06/26', flow: -396.6 },
  { date: '04/06/26', flow: 3.2 },
  { date: '05/06/26', flow: -325.7 },
];

const BASELINE_CME_COT = {
  date: '02/06/2026',
  openInterest: 19882,
  assetManager: { long: 5256, longChange: -694, short: 2153, shortChange: 555, net: 3103, netChange: -1249 },
  leveragedFunds: { long: 6269, longChange: 1603, short: 12827, shortChange: -473, net: -6558, netChange: 2076 }
};

function useDraggableScroll() {
  const [node, setNode] = useState(null);
  
  const ref = useCallback(nodeEle => {
    setNode(nodeEle);
  }, []);

  useEffect(() => {
    if (!node) return;
    const slider = node;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    let isDragging = false;

    const onMouseDown = (e) => {
      isDown = true;
      isDragging = false;
      slider.style.cursor = 'grabbing';
      slider.style.scrollSnapType = 'none';
      startX = e.pageX - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    };
    
    const onMouseLeave = () => {
      isDown = false;
      slider.style.cursor = 'grab';
      slider.style.scrollSnapType = '';
    };
    
    const onMouseUp = () => {
      isDown = false;
      slider.style.cursor = 'grab';
      slider.style.scrollSnapType = '';
    };
    
    const onMouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      isDragging = true;
      const x = e.pageX - slider.offsetLeft;
      const walk = (x - startX) * 2; // Scroll-fast
      slider.scrollLeft = scrollLeft - walk;
    };
    
    const onClick = (e) => {
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    slider.style.cursor = 'grab';
    slider.addEventListener('mousedown', onMouseDown);
    slider.addEventListener('mouseleave', onMouseLeave);
    slider.addEventListener('mouseup', onMouseUp);
    slider.addEventListener('mousemove', onMouseMove);
    slider.addEventListener('click', onClick, true); // capture phase

    return () => {
      slider.removeEventListener('mousedown', onMouseDown);
      slider.removeEventListener('mouseleave', onMouseLeave);
      slider.removeEventListener('mouseup', onMouseUp);
      slider.removeEventListener('mousemove', onMouseMove);
      slider.removeEventListener('click', onClick, true);
    };
  }, [node]);
  
  return ref;
}

function App() {
  const newsSliderRef = useDraggableScroll();
  const { tooltipsEnabled, setTooltipsEnabled, setLastSyncTime } = useTooltipSettings();
  const [data, setData] = useState(() => {
    // Preload CVD history from localStorage cache for immediate display
    const readCache = (key) => {
      try {
        const raw = localStorage.getItem(`cache_${key}`);
        if (raw) {
          const { val } = JSON.parse(raw);
          return Array.isArray(val) && val.length > 0 ? val : [];
        }
      } catch {}
      return [];
    };
    return {
      ...INIT,
      cvdHistory24h: readCache('cvdHistory24h_v2'),
      cvdHistory7d:  readCache('cvdHistory7d'),
      cvdHistory30d: readCache('cvdHistory30d'),
    };
  });
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

  const [etfChartType, setEtfChartType] = useState('flows');
  const [etfAumTimeframe, setEtfAumTimeframe] = useState('ALL'); // '30D', '90D', 'ALL'

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
      if (saved) {
        const parsed = JSON.parse(saved);
        return { fred: '', alphaVantage: '', gemini: '', ...parsed };
      }
      return { fred: '', alphaVantage: '', gemini: '' };
    } catch {
      return { fred: '', alphaVantage: '', gemini: '' };
    }
  });
  const [showSettings, setShowSettings] = useState(false);

  // ── Binance WebSocket — realtime prices + funding rate ──────────────────
  const { livePrice, liveChange, liveHigh, liveLow, liveVolume, liveFunding, liveEthPrice, liveSolPrice, liveLinkPrice, wsStatus } =
    useBinanceWebSocket();

  // ── HFT WebSocket Streams ──────────────────────────────────────────────────────
  const { cvd, sessionCvd, buyVolume, sellVolume, volumeRatio, cvdHistory, whaleTrades, cvdStatus } = useCVDStream();


  const addLog = useCallback((msg, type = 'info') => {
    const entry = { time: new Date().toLocaleTimeString('vi-VN'), msg, type };
    logsRef.current = [entry, ...logsRef.current].slice(0, 80);
    return entry;
  }, []);

  const syncData = useCallback(async (force = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    addLog(force ? 'Bắt đầu đồng bộ dữ liệu (Bỏ qua cache)...' : 'Bắt đầu đồng bộ dữ liệu...', 'system');

    addLog('Đang đồng bộ chỉ số vĩ mô từ FRED & NY Fed...', 'system');
    
    // Fetch macro metrics in parallel using cache
    const macroResults = await Promise.allSettled([
      fetchCached('fedFundsRate', () => getFREDMetric('FEDFUNDS'), 12 * 60 * 60 * 1000, addLog, 'Lãi suất Fed', force),
      fetchCached('cpi', () => getFREDMetric('CPIAUCSL'), 12 * 60 * 60 * 1000, addLog, 'CPI Inflation', force),
      fetchCached('unrate', () => getFREDMetric('UNRATE'), 12 * 60 * 60 * 1000, addLog, 'Tỷ lệ thất nghiệp', force),
      fetchCached('m2Supply', () => getFREDMetric('M2SL'), 12 * 60 * 60 * 1000, addLog, 'M2 Money Supply', force),
      fetchCached('highYield', () => getFREDMetric('BAMLH0A0HYM2EY'), 12 * 60 * 60 * 1000, addLog, 'High Yield Spread', force),
      fetchCached('walcl', () => getFREDMetric('WALCL'), 12 * 60 * 60 * 1000, addLog, 'Fed Assets', force),
      fetchCached('tga', () => getFREDMetric('WDTGAL'), 12 * 60 * 60 * 1000, addLog, 'TGA Treasury Account', force),
      fetchCached('rrp', () => getFREDMetric('RRPONTSYD'), 12 * 60 * 60 * 1000, addLog, 'Reverse Repo', force)
    ]);

    const fedFundsRateVal = macroResults[0].status === 'fulfilled' ? macroResults[0].value : null;
    const cpiVal          = macroResults[1].status === 'fulfilled' ? macroResults[1].value : null;
    const unrateVal       = macroResults[2].status === 'fulfilled' ? macroResults[2].value : null;
    const m2SupplyVal     = macroResults[3].status === 'fulfilled' ? macroResults[3].value : null;
    const highYieldVal    = macroResults[4].status === 'fulfilled' ? macroResults[4].value : null;
    const walclVal        = macroResults[5].status === 'fulfilled' ? macroResults[5].value : null;
    const tgaVal          = macroResults[6].status === 'fulfilled' ? macroResults[6].value : null;
    const rrpVal          = macroResults[7].status === 'fulfilled' ? macroResults[7].value : null;

    addLog('Đang đồng bộ dữ liệu phái sinh, tin tức, ETF và chỉ số Yahoo Finance...', 'system');

    const [
      btcRes, klinesRes, lsRes, fundRes, oiRes, oiHistRes,
      globalRes, stableRes, newsRes,
      onChainRes, onChainMetricsRes, ethOnChainMetricsRes,
      etfHoldingsRes, etfHistoryRes,
      cotRes,
      yield10yRes, dxyRes, sp500Res, vixRes, qqqRes, fngRes,
      cvd24hRes, cvd7dRes, cvd30dRes, btcDailyKlinesAllRes
    ] = await Promise.allSettled([
      getBTCTicker24h('BTCUSDT'),
      getBTCKlines('BTCUSDT', '1h', 48),
      getLongShortRatio('BTCUSDT', '1h', 24),
      getFundingRate('BTCUSDT'),
      getOpenInterest('BTCUSDT'),
      getOIHistory('BTCUSDT', '1h', 24),
      fetchCached('globalCryptoData', () => getGlobalCryptoData(), 15 * 60 * 1000, addLog, 'Global Market (CoinGecko)', force),
      fetchCached('stablecoinData', () => getStablecoinData(), 15 * 60 * 1000, addLog, 'Stablecoins (CoinGecko)', force),
      fetchCached('realtimeFeed', () => fetchRealtimeFeed(), 15 * 60 * 1000, addLog, 'News RSS (rss2json)', force),
      fetchCached('btcOnChain', () => getBTCOnChain(), 6 * 60 * 60 * 1000, addLog, 'BTC Network (blockchain.info)', force),
      fetchCached('btcOnChainMetrics', () => getBTCOnChainMetrics(), 6 * 60 * 60 * 1000, addLog, 'On-chain Metrics (CoinMetrics)', force),
      fetchCached('ethOnChainMetrics', () => getETHOnChainMetrics(), 6 * 60 * 60 * 1000, addLog, 'ETH On-chain Metrics (CoinMetrics)', force),
      fetchCached('etfHoldings', () => getETFHoldings(), 4 * 60 * 60 * 1000, addLog, 'Spot ETF Holdings (Bitbo)', force),
      fetchCached('etfFlowHistory_v4', () => getETFFlowHistory(), 4 * 60 * 60 * 1000, addLog, 'Spot ETF Flow History (Farside)', force),
      fetchCached('cmeCot', () => getCMECot(), 12 * 60 * 60 * 1000, addLog, 'Báo cáo CME COT (Tradingster)', force),
      fetchCached('yield10y', () => getFREDMetric('DGS10'), 30 * 60 * 1000, addLog, 'Yield 10Y (Yahoo Finance)', force),
      fetchCached('dxyQuote', () => getDXYQuote(), 30 * 60 * 1000, addLog, 'Chỉ số DXY (Yahoo Finance)', force),
      fetchCached('sp500Quote', () => getFREDStockQuote('SP500'), 30 * 60 * 1000, addLog, 'S&P 500 Index (Yahoo Finance)', force),
      fetchCached('vixQuote', () => getFREDStockQuote('VIXCLS'), 30 * 60 * 1000, addLog, 'VIX Volatility Index (Yahoo Finance)', force),
      fetchCached('qqqQuote', () => getFREDStockQuote('NASDAQ100'), 30 * 60 * 1000, addLog, 'Nasdaq 100 Index (Yahoo Finance)', force),
      fetchCached('fearAndGreed', () => getFearAndGreed(), 4 * 60 * 60 * 1000, addLog, 'Chỉ số Fear & Greed (alternative.me)', force),
      fetchCached('cvdHistory24h_v2', () => getHistoricalCVD('BTCUSDT', '1h', 24), 10 * 60 * 1000, addLog, 'Lịch sử CVD 24h (Binance)', force),
      fetchCached('cvdHistory7d', () => getHistoricalCVD('BTCUSDT', '4h', 42), 30 * 60 * 1000, addLog, 'Lịch sử CVD 7d (Binance)', force),
      fetchCached('cvdHistory30d', () => getHistoricalCVD('BTCUSDT', '1d', 30), 2 * 60 * 60 * 1000, addLog, 'Lịch sử CVD 30d (Binance)', force),
      fetchCached('btcDailyKlinesAll', () => getBTCKlines('BTCUSDT', '1d', 1000), 2 * 60 * 60 * 1000, addLog, 'Lịch sử giá BTC Daily 1000d (Binance)', force)
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

    const globalData      = globalRes.status === 'fulfilled' ? globalRes.value : null;
    const stablecoins     = stableRes.status === 'fulfilled' ? stableRes.value : null;
    const news            = newsRes.status === 'fulfilled' ? newsRes.value : [];
    const onChain         = onChainRes.status === 'fulfilled' ? onChainRes.value : null;
    const onChainMetrics  = onChainMetricsRes.status === 'fulfilled' ? onChainMetricsRes.value : null;
    const ethOnChainMetrics = ethOnChainMetricsRes.status === 'fulfilled' ? ethOnChainMetricsRes.value : null;
    const etfHoldingsVal  = etfHoldingsRes.status === 'fulfilled' ? etfHoldingsRes.value : null;
    const etfHistoryVal   = etfHistoryRes.status === 'fulfilled' ? etfHistoryRes.value : null;
    const cotData         = cotRes.status === 'fulfilled' ? cotRes.value : null;
    const tenYearYield    = yield10yRes.status === 'fulfilled' ? yield10yRes.value : null;
    const dxy             = dxyRes.status === 'fulfilled' ? dxyRes.value : null;
    const sp500           = sp500Res.status === 'fulfilled' ? sp500Res.value : null;
    const vix             = vixRes.status === 'fulfilled' ? vixRes.value : null;
    const qqq             = qqqRes.status === 'fulfilled' ? qqqRes.value : null;
    const fngData         = fngRes.status === 'fulfilled' ? fngRes.value : null;
    const cvdHistory24h   = cvd24hRes.status === 'fulfilled' ? cvd24hRes.value : null;
    const cvdHistory7d    = cvd7dRes.status === 'fulfilled' ? cvd7dRes.value : null;
    const cvdHistory30d   = cvd30dRes.status === 'fulfilled' ? cvd30dRes.value : null;
    const btcDailyKlinesAll = btcDailyKlinesAllRes.status === 'fulfilled' ? btcDailyKlinesAllRes.value : null;

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
      ethOnChainMetrics: ethOnChainMetrics ?? prev.ethOnChainMetrics,
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
      fngData:        fngData         ?? prev.fngData,
      cvdHistory24h:  cvdHistory24h?.length > 0 ? cvdHistory24h : prev.cvdHistory24h,
      cvdHistory7d:   cvdHistory7d?.length > 0 ? cvdHistory7d : prev.cvdHistory7d,
      cvdHistory30d:  cvdHistory30d?.length > 0 ? cvdHistory30d : prev.cvdHistory30d,
      btcDailyKlinesAll: btcDailyKlinesAll?.length > 0 ? btcDailyKlinesAll : prev.btcDailyKlinesAll,
    }));

    setLastSync(now);
    window.appLastSync = now;
    setLastSyncTime(now);
    setIsOnline(btc != null || klines.length > 0);
    setIsSyncing(false);
  }, [isSyncing, addLog, apiKeys, setLastSyncTime]);

  // Tự động đồng bộ hàng ngày lúc 08:00 AM
  useEffect(() => {
    const checkAutoSync = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDateStr = now.toLocaleDateString('vi-VN');
      
      const lastAutoSyncDate = localStorage.getItem('last-auto-sync-date');
      
      if (currentHour >= 8 && lastAutoSyncDate !== currentDateStr) {
        addLog('[Auto-Sync] Đến giờ đồng bộ hàng ngày (08:00 AM). Đang tự động cập nhật...', 'system');
        syncData(true);
        localStorage.setItem('last-auto-sync-date', currentDateStr);
      }
    };

    checkAutoSync();
    const interval = setInterval(checkAutoSync, 60 * 1000);
    return () => clearInterval(interval);
  }, [syncData, addLog]);

  // Initial load + auto-refresh every 5 min
  useEffect(() => {
    syncData(false);
    const timer = setInterval(() => syncData(false), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line



  // ── Derived chart data ──────────────────────────────────────────────────────
  const btcChartData = useMemo(() => ({
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
  }), [data.klines, theme]);

  const lsChartData = useMemo(() => ({
    labels: data.lsHistory.map(r => new Date(r.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
    datasets: [
      {
        label: 'L/S Ratio',
        data: data.lsHistory.map(r => parseFloat(r.longShortRatio)),
        borderColor: theme === 'light' ? '#047857' : '#10b981',
        backgroundColor: theme === 'light' ? 'rgba(4, 120, 87, 0.05)' : 'rgba(16,185,129,0.05)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  }), [data.lsHistory, theme]);

  const oiChartData = useMemo(() => ({
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
  }), [data.oiHistory, theme]);

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

  // Cập nhật Document Title và Dynamic Favicon theo giá Bitcoin (Trực tiếp từ WebSocket & REST)
  useEffect(() => {
    if (!btcDisplay?.price) return;
    const price = parseFloat(btcDisplay.price);
    const change = parseFloat(btcDisplay.change || 0);
    const priceFormatted = price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    
    // Cập nhật Title tab trình duyệt
    document.title = `$${priceFormatted} | BTC ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;

    // Cập nhật Favicon SVG động
    const shortPrice = price >= 1000 ? `${(price / 1000).toFixed(price >= 100000 ? 0 : 1)}k` : `$${Math.round(price)}`;
    const bgColor = change >= 0 ? '#10b981' : '#ef4444'; // Xanh lá nếu tăng, Đỏ nếu giảm
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="${bgColor}"/>
      <text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${shortPrice}</text>
    </svg>`;
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = dataUrl;
  }, [btcDisplay?.price, btcDisplay?.change]);

  // ── ETF AUM & Holdings History Calculations ─────────────────────────────────
  const holdingsHistory = useMemo(() => {
    if (!etfHistory || etfHistory.length === 0) return [];
    
    // Create a map of formatted date "DD/MM/YY" -> BTC Close Price
    const priceMap = {};
    
    // 1. Populate from community data (30d)
    if (data.cvdHistory30d && data.cvdHistory30d.length > 0) {
      data.cvdHistory30d.forEach(h => {
        const d = new Date(h.time);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = String(d.getFullYear()).substring(2);
        const key = `${day}/${month}/${year}`;
        priceMap[key] = h.price;
      });
    }

    // 2. Populate from daily klines (up to 1000d for full historical coverage)
    if (data.btcDailyKlinesAll && data.btcDailyKlinesAll.length > 0) {
      data.btcDailyKlinesAll.forEach(h => {
        const d = new Date(h.time);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = String(d.getFullYear()).substring(2);
        const key = `${day}/${month}/${year}`;
        priceMap[key] = h.close;
      });
    }

    // 3. Include today's date key
    const today = new Date();
    const todayKey = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getFullYear()).substring(2)}`;
    priceMap[todayKey] = btcDisplay?.price || 60000;

    const history = [];
    let tempHoldings = etfHoldings.total;

    // Iterate backwards to compute holdings and AUM history
    for (let i = etfHistory.length - 1; i >= 0; i--) {
      const item = etfHistory[i];
      let dateStr = item.date;
      // Handle legacy dd/mm format by appending /26 (default baseline year)
      if (dateStr.length === 5) {
        dateStr = `${dateStr}/26`;
      }
      const flowUsd = item.flow; // Flow in millions USD
      
      const btcPrice = priceMap[dateStr] || btcDisplay?.price || 60000;
      const flowBtc = (flowUsd * 1e6) / btcPrice;
      
      history.unshift({
        date: dateStr,
        holdings: tempHoldings,
        aum: (tempHoldings * btcPrice) / 1e9, // AUM in billions USD
        price: btcPrice,
        flow: flowUsd
      });
      
      tempHoldings -= flowBtc;
    }
    
    return history;
  }, [etfHistory, etfHoldings.total, data.cvdHistory30d, data.btcDailyKlinesAll, btcDisplay?.price]);

  const aumChangeStats = useMemo(() => {
    if (holdingsHistory.length < 2) return { diffUsd: 0, diffPct: 0, direction: 'flat', oldestDate: '---' };
    
    const oldest = holdingsHistory[0];
    const latest = holdingsHistory[holdingsHistory.length - 1];
    
    const diffUsd = latest.aum - oldest.aum; // in billions USD
    const diffPct = oldest.aum > 0 ? (diffUsd / oldest.aum) * 100 : 0;
    const direction = diffUsd > 0 ? 'up' : diffUsd < 0 ? 'down' : 'flat';
    
    return {
      diffUsd,
      diffPct,
      direction,
      oldestDate: oldest.date,
      oldestAum: oldest.aum,
      latestAum: latest.aum
    };
  }, [holdingsHistory]);

  const filteredAumHistory = useMemo(() => {
    if (etfAumTimeframe === '30D') return holdingsHistory.slice(-30);
    if (etfAumTimeframe === '90D') return holdingsHistory.slice(-90);
    return holdingsHistory;
  }, [holdingsHistory, etfAumTimeframe]);

  const etfAumChartData = useMemo(() => ({
    labels: filteredAumHistory.map(h => h.date),
    datasets: [{
      label: 'Tổng AUM (B USD)',
      data: filteredAumHistory.map(h => h.aum),
      borderColor: theme === 'light' ? '#6366f1' : '#818cf8',
      backgroundColor: theme === 'light' ? 'rgba(99, 102, 241, 0.05)' : 'rgba(129, 140, 248, 0.05)',
      borderWidth: 1.5,
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
    }]
  }), [filteredAumHistory, theme]);

  const etfAumChartOpts = useMemo(() => ({
    ...getChartOpts(theme),
    plugins: {
      ...getChartOpts(theme).plugins,
      tooltip: {
        ...getChartOpts(theme).plugins.tooltip,
        callbacks: {
          label: (context) => ` Tổng AUM: ${context.parsed.y.toFixed(2)}B USD`
        }
      }
    },
    scales: {
      ...getChartOpts(theme).scales,
      y: {
        ...getChartOpts(theme).scales.y,
        ticks: {
          ...getChartOpts(theme).scales.y.ticks,
          callback: (v) => `$${v.toFixed(1)}B`
        }
      }
    }
  }), [theme]);

  // ── ETF Net Flows Bar Chart ────────────────────────────────────────────────
  const etfFlowChartData = useMemo(() => {
    const recentHistory = etfHistory.slice(-15);
    return {
      labels: recentHistory.map(h => h.date),
      datasets: [{
        label: 'Net Flow (M USD)',
        data: recentHistory.map(h => h.flow),
        backgroundColor: recentHistory.map(h => {
          if (h.flow >= 0) {
            return theme === 'light' ? '#047857' : '#10b981';
          } else {
            return theme === 'light' ? '#be123c' : '#f43f5e';
          }
        }),
        borderColor: recentHistory.map(h => {
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
  }, [etfHistory, theme]);

  const etfFlowChartOpts = useMemo(() => ({
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
  }), [theme]);

  const btcNuplVal = useMemo(() => {
    const mvrv = parseFloat(data.onChainMetrics?.mvrv);
    if (!mvrv || isNaN(mvrv) || mvrv === 0) return null;
    const raw = 1 - (1 / mvrv);
    return {
      percentStr: `${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}%`,
      subStr: `Ratio ${raw.toFixed(2)} • ${raw > 0.75 ? 'Hưng phấn ⚠' : raw < 0 ? 'Đầu hàng ✓' : 'Lạc quan ✓'}`,
      cls: raw > 0.75 ? 'text-rose' : raw < 0 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${raw.toFixed(2)} (${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}% net profit)`
    };
  }, [data.onChainMetrics?.mvrv]);

  const ethNuplVal = useMemo(() => {
    const mvrv = parseFloat(data.ethOnChainMetrics?.mvrv);
    if (!mvrv || isNaN(mvrv) || mvrv === 0) return null;
    const raw = 1 - (1 / mvrv);
    return {
      percentStr: `${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}%`,
      subStr: `Ratio ${raw.toFixed(2)} • ${raw > 0.75 ? 'Hưng phấn ⚠' : raw < 0 ? 'Đầu hàng ✓' : 'Lạc quan ✓'}`,
      cls: raw > 0.75 ? 'text-rose' : raw < 0 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${raw.toFixed(2)} (${raw >= 0 ? '+' : ''}${(raw * 100).toFixed(1)}% net profit)`
    };
  }, [data.ethOnChainMetrics?.mvrv]);

  const btcSupplyProfitEst = useMemo(() => {
    const mvrv = parseFloat(data.onChainMetrics?.mvrv);
    if (!mvrv || isNaN(mvrv) || mvrv === 0) return null;
    const est = Math.min(99.5, Math.max(20, -10 + 52 * mvrv - 1.5 * mvrv * mvrv));
    return {
      valStr: `${est.toFixed(1)}%`,
      subStr: `Mô hình từ MVRV`,
      cls: est > 95 ? 'text-rose' : est < 50 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${est.toFixed(1)}% (Estimated)`
    };
  }, [data.onChainMetrics?.mvrv]);

  const ethSupplyProfitEst = useMemo(() => {
    const mvrv = parseFloat(data.ethOnChainMetrics?.mvrv);
    if (!mvrv || isNaN(mvrv) || mvrv === 0) return null;
    const est = Math.min(99.5, Math.max(20, -10 + 52 * mvrv - 1.5 * mvrv * mvrv));
    return {
      valStr: `${est.toFixed(1)}%`,
      subStr: `Mô hình từ MVRV`,
      cls: est > 95 ? 'text-rose' : est < 50 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${est.toFixed(1)}% (Estimated)`
    };
  }, [data.ethOnChainMetrics?.mvrv]);

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
          <button className="btn-icon" onClick={() => setTooltipsEnabled(!tooltipsEnabled)} title={tooltipsEnabled ? "Tắt Tooltip (Alt+T)" : "Bật Tooltip (Alt+T)"} style={{ background: tooltipsEnabled ? 'rgba(16,185,129,0.1)' : 'transparent', border: '1px solid var(--border-panel)', color: tooltipsEnabled ? 'var(--color-emerald-400)' : 'var(--text-slate-500)', padding: '7px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s ease' }}>
            <HelpCircle size={15} />
          </button>
          <button className="btn-icon" onClick={() => setShowSettings(true)} title="API Settings" style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-slate-400)', padding: '7px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s ease' }}>
            <Settings size={15} />
          </button>
          <button className="btn-icon" onClick={toggleTheme} title="Toggle Theme" style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-slate-400)', padding: '7px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s ease' }}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
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
          <button className="btn-sync font-mono" onClick={() => syncData(true)} disabled={isSyncing}>
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
              <div className="btc-hero" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Tooltip content={METRIC_METADATA.btcPrice}>
                  <span className="metric-label font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block', margin: 0 }}>
                    BITCOIN {wsStatus === 'connected' && <span className="ws-live-tag font-mono">⚡</span>}
                  </span>
                </Tooltip>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`btc-price font-mono${livePrice ? ' ws-price-live' : ''}`} style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                    ${btcDisplay?.price ? fmt(btcDisplay.price, 0) : '---'}
                  </span>
                  {btcDisplay?.change != null && (
                    <span className={`btc-change font-mono ${btcDisplay.change >= 0 ? 'text-emerald' : 'text-rose'}`} style={{ fontSize: '0.65rem', fontWeight: 600, margin: 0 }}>
                      ({btcDisplay.change >= 0 ? '+' : ''}{btcDisplay.change.toFixed(2)}%)
                    </span>
                  )}
                </div>
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
                label="PRODUCTION COST"
                value={data.onChain?.productionCost ? `$${parseInt(data.onChain.productionCost).toLocaleString()}` : '---'}
                sub="1 BTC (Est.)"
                subCls="text-slate-400"
                tooltipId="productionCost"
              />
              <MetricCard
                label="BTC MVRV"
                value={data.onChainMetrics?.mvrv || '---'}
                sub={data.onChainMetrics?.mvrv > 3.5 ? 'Overvalued ⚠' : data.onChainMetrics?.mvrv < 1 ? 'Undervalued ✓' : 'Fair Value'}
                subCls={data.onChainMetrics?.mvrv > 3.5 ? 'text-rose' : data.onChainMetrics?.mvrv < 1 ? 'text-emerald' : 'text-slate-400'}
                tooltipId="mvrv"
              />
              <MetricCard
                label="ETH MVRV"
                value={data.ethOnChainMetrics?.mvrv || '---'}
                sub={data.ethOnChainMetrics?.mvrv > 3.5 ? 'Overvalued ⚠' : data.ethOnChainMetrics?.mvrv < 1 ? 'Undervalued ✓' : 'Fair Value'}
                subCls={data.ethOnChainMetrics?.mvrv > 3.5 ? 'text-rose' : data.ethOnChainMetrics?.mvrv < 1 ? 'text-emerald' : 'text-slate-400'}
                tooltipId="ethMvrv"
              />
              <MetricCard
                label="BTC NUPL (LÃI/LỖ)"
                value={btcNuplVal?.percentStr || '---'}
                sub={btcNuplVal?.subStr || 'Net Unrealized Profit'}
                subCls={btcNuplVal?.cls || 'text-slate-400'}
                tooltipId="btcNupl"
              />
              <MetricCard
                label="ETH NUPL (LÃI/LỖ)"
                value={ethNuplVal?.percentStr || '---'}
                sub={ethNuplVal?.subStr || 'Net Unrealized Profit'}
                subCls={ethNuplVal?.cls || 'text-slate-400'}
                tooltipId="ethNupl"
              />
              <MetricCard
                label="BTC COIN LỜI (EST)"
                value={btcSupplyProfitEst?.valStr || '---'}
                sub={btcSupplyProfitEst?.subStr || 'Supply in Profit'}
                subCls={btcSupplyProfitEst?.cls || 'text-slate-400'}
                tooltipId="btcSupplyProfit"
              />
              <MetricCard
                label="ETH COIN LỜI (EST)"
                value={ethSupplyProfitEst?.valStr || '---'}
                sub={ethSupplyProfitEst?.subStr || 'Supply in Profit'}
                subCls={ethSupplyProfitEst?.cls || 'text-slate-400'}
                tooltipId="ethSupplyProfit"
              />
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
              <DashboardTab
                data={data}
                theme={theme}
                newsSliderRef={newsSliderRef}
                btcChartData={btcChartData}
                getChartOpts={getChartOpts}
                currentLS={currentLS}
                lsChartData={lsChartData}
                oiChartData={oiChartData}
                etfHoldings={etfHoldings}
                fmt={fmt}
                btcDisplay={btcDisplay}
                etfHistory={etfHistory}
                aumChangeStats={aumChangeStats}
                etfChartType={etfChartType}
                setEtfChartType={setEtfChartType}
                etfAumTimeframe={etfAumTimeframe}
                setEtfAumTimeframe={setEtfAumTimeframe}
                etfFlowChartData={etfFlowChartData}
                etfFlowChartOpts={etfFlowChartOpts}
                etfAumChartData={etfAumChartData}
                etfAumChartOpts={etfAumChartOpts}
              />
            )}

            {/* ══ HFT RADAR TAB ══════════════════════════════════════════════ */}
            {activeTab === 'hft' && (
              <HftRadarTab
                cvd={cvd} sessionCvd={sessionCvd} buyVolume={buyVolume} sellVolume={sellVolume}
                cvdHistory={cvdHistory} cvdHistory24h={data.cvdHistory24h} cvdHistory7d={data.cvdHistory7d} cvdHistory30d={data.cvdHistory30d}
                cvdStatus={cvdStatus} livePrice={livePrice}
                whaleTrades={whaleTrades} theme={theme}
              />
            )}

            {/* ══ CASCADE TAB ════════════════════════════════════════════════ */}
            {activeTab === 'cascade' && (
              <CascadeTab
                data={data}
                fmt={fmt}
                fmtB={fmtB}
                btcDisplay={btcDisplay}
                fund={fund}
                CASCADE_KEY_MAP={CASCADE_KEY_MAP}
                METRIC_METADATA={METRIC_METADATA}
              />
            )}

            {/* ══ AI SUMMARY TAB ═════════════════════════════════════════════ */}
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
                lastSync={lastSync}
                btcNupl={btcNuplVal?.aiStr || 'N/A'}
                ethNupl={ethNuplVal?.aiStr || 'N/A'}
                btcSupplyProfit={btcSupplyProfitEst?.aiStr || 'N/A'}
                ethSupplyProfit={ethSupplyProfitEst?.aiStr || 'N/A'}
              />
            )}

            {/* ══ GLOSSARY TAB ═══════════════════════════════════════════════ */}
            {activeTab === 'glossary' && (
              <GlossaryTab />
            )}

            {/* ══ TERMINAL TAB ═══════════════════════════════════════════════ */}
            {activeTab === 'terminal' && (
              <TerminalTab
                data={data}
                btcDisplay={btcDisplay}
                wsStatus={wsStatus}
                fundInfo={fundInfo}
                fund={fund}
                fmt={fmt}
                fngColor={fngColor}
                theme={theme}
              />
            )}

          </div>
        </main>
      </div>

      {showSettings && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="glass-panel" style={{ width: '420px', padding: '24px', background: 'var(--bg-panel-solid)', display: 'flex', flexDirection: 'column', gap: '18px', borderRadius: 'var(--card-radius)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="font-mono" style={{ margin: 0, fontSize: '0.8rem', background: 'var(--gradient-aurora)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>⚙️ CÀI ĐẶT API KEYS</h3>
              <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: '1px solid var(--border-panel)', color: 'var(--text-slate-400)', cursor: 'pointer', padding: '4px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}>
                <X size={14} />
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
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none', transition: 'border-color 0.2s ease' }}
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
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none', transition: 'border-color 0.2s ease' }}
              />
              <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem' }}>
                Lấy miễn phí tại: <a href="https://www.alphavantage.co/" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>alphavantage.co</a>
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label className="font-mono text-slate-400" style={{ fontSize: '0.55rem' }}>GEMINI API KEY</label>
              <input
                type="password"
                placeholder="Nhập Gemini API key..."
                value={apiKeys.gemini || ''}
                onChange={(e) => setApiKeys(p => ({ ...p, gemini: e.target.value }))}
                style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text-contrast)', fontSize: '0.65rem', fontFamily: 'var(--font-mono)', outline: 'none', transition: 'border-color 0.2s ease' }}
              />
              <span className="font-mono text-slate-500" style={{ fontSize: '0.5rem' }}>
                Lấy miễn phí tại: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-emerald" style={{ textDecoration: 'underline' }}>Google AI Studio</a>
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
                  syncData(true);
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
