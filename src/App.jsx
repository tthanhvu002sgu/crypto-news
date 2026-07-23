import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import {
  getBTCTicker24h, getBTCKlines, getLongShortRatio,
  getFundingRate, getOpenInterest, getOIHistory,
  getGlobalCryptoData, getStablecoinData,
  fetchRealtimeFeed, getBTCOnChain, getBTCOnChainMetrics, getETHOnChainMetrics,
  getFREDMetric, getFREDStockQuote,
  getETFHoldings, getETFFlowHistory, getCMECot, getDXYQuote,
  getFearAndGreed, getHistoricalCVD,
} from './services/api';
import { useBinanceWebSocket, useCVDStream } from './services/websocket';
import { fetchCached } from './utils/cache';
import { updateBrowserChromeImmediate } from './utils/browserChrome';
import { CACHE_TTL, SYNC_INTERVAL } from './config/syncConfig';
import {
  Activity, RefreshCw, BarChart2, BookOpen, Layers,
  Terminal, HelpCircle, Zap, Radio, Crosshair, Moon, Sun, Settings, X, Sparkles, EyeOff,
  ChevronDown, ChevronRight
} from 'lucide-react';
import GlossaryTab from './components/GlossaryTab';
import HftRadarTab from './components/HftRadarTab';
import SummaryTab from './components/SummaryTab';
import DashboardTab from './components/DashboardTab';
import CascadeTab from './components/CascadeTab';
import TerminalTab from './components/TerminalTab';
import ScannerTab from './components/ScannerTab';
import Tooltip, { METRIC_METADATA, useTooltipSettings } from './components/Tooltip';
import { ModuleVisibilityProvider, useModuleVisibility, MODULES_CONFIG } from './context/ModuleVisibilityContext';
import ModuleMenu from './components/ModuleMenu';
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
const isPlausibleCpiYoY = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= -20 && number <= 50;
};

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
        ticks: { color: tickColor, maxTicksLimit: 8, font: { family: 'Roboto Mono', size: 9 } },
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: 'Roboto Mono', size: 9 } },
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

const FreshnessBadge = React.memo(function FreshnessBadge({ type }) {
  if (type === 'live') {
    return <span className="freshness-badge badge-live">LIVE</span>;
  }
  if (type === '5m' || type === 'hot') {
    return <span className="freshness-badge badge-cached-5m">5m</span>;
  }
  if (type === '1h' || type === 'cold') {
    return <span className="freshness-badge badge-cached-cold">1h</span>;
  }
  return null;
});


const MetricCard = React.memo(function MetricCard({ label, value, sub, subCls, badge, badgeCls, tooltipId, freshness }) {
  const metadata = tooltipId ? METRIC_METADATA[tooltipId] : null;
  return (
    <div className="metric-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '2px' }}>
        {metadata ? (
          <Tooltip content={metadata}>
            <span className="metric-label font-mono" style={{ cursor: 'help', borderBottom: '1px dashed var(--text-slate-500)', display: 'inline-block' }}>
              {label}
            </span>
          </Tooltip>
        ) : (
          <span className="metric-label font-mono">{label}</span>
        )}
        {freshness && <FreshnessBadge type={freshness} />}
      </div>
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
  btc: null,          // { price, change, high, low, close, volume }
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
      startX = e.pageX - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    };
    
    const onMouseLeave = () => {
      isDown = false;
      slider.style.cursor = 'grab';
    };
    
    const onMouseUp = () => {
      isDown = false;
      slider.style.cursor = 'grab';
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

function AppContent() {
  const newsSliderRef = useDraggableScroll();
  const { tooltipsEnabled, setTooltipsEnabled, setLastSyncTime } = useTooltipSettings();
  const { hiddenModules, showModule, showAllModules, isModuleHidden } = useModuleVisibility();
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
    const validTabs = ['dashboard', 'scanner', 'data', 'hft', 'cascade', 'summary', 'glossary', 'terminal'];
    return validTabs.includes(hash) ? hash : 'dashboard';
  });

  useEffect(() => {
    if (activeTab === 'cascade' && isModuleHidden('tab_cascade')) setActiveTab('dashboard');
    if (activeTab === 'summary' && isModuleHidden('tab_summary')) setActiveTab('dashboard');
    if (activeTab === 'glossary' && isModuleHidden('tab_glossary')) setActiveTab('dashboard');
    if (activeTab === 'terminal' && isModuleHidden('tab_terminal')) setActiveTab('dashboard');
  }, [activeTab, isModuleHidden]);

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
      const validTabs = ['dashboard', 'scanner', 'data', 'hft', 'cascade', 'summary', 'glossary', 'terminal'];
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
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

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

  // ── Sidebar Accordion State ────────────────────────────────────────────────
  const [accordionOpen, setAccordionOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar_accordion');
      return saved ? JSON.parse(saved) : { derivatives: true, macro: true, onchain: true };
    } catch {
      return { derivatives: true, macro: true, onchain: true };
    }
  });

  const toggleAccordion = useCallback((key) => {
    setAccordionOpen(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem('sidebar_accordion', JSON.stringify(updated));
      return updated;
    });
  }, []);


  // ── Binance WebSocket — realtime prices + funding rate ──────────────────
  const { livePrice, liveChange, liveHigh, liveLow, liveVolume, liveFunding, liveEthPrice, liveSolPrice, liveLinkPrice, wsStatus } =
    useBinanceWebSocket();

  // ── HFT WebSocket Streams ──────────────────────────────────────────────────────
  const { cvd, sessionCvd, buyVolume, sellVolume, volumeRatio, cvdHistory, whaleTrades, cvdStatus, volNodes } = useCVDStream();


  const addLog = useCallback((msg, type = 'info') => {
    const entry = { time: new Date().toLocaleTimeString('vi-VN'), msg, type };
    logsRef.current = [entry, ...logsRef.current].slice(0, 80);
    return entry;
  }, []);

  // Per-tier in-flight locks so HOT/WARM/COLD can overlap without skipping each other
  const tierLockRef = useRef({ hot: false, warm: false, cold: false });

  /**
   * Tiered sync — only requested tiers run.
   * force=true: bypass TTL for every key (manual SYNC / daily 08:00).
   * HOT  = Binance REST (short TTL; live price still from WS)
   * WARM = global / news / equities / short CVD history
   * COLD = FRED macro, on-chain, ETF, COT, F&G, long history
   */
  const syncData = useCallback(async (force = false, tiers = ['hot', 'warm', 'cold']) => {
    const activeTiers = tiers.filter((t) => !tierLockRef.current[t]);
    if (activeTiers.length === 0) return;

    activeTiers.forEach((t) => { tierLockRef.current[t] = true; });
    setIsSyncing(true);

    const wantHot = activeTiers.includes('hot');
    const wantWarm = activeTiers.includes('warm');
    const wantCold = activeTiers.includes('cold');
    const releaseLocks = () => {
      activeTiers.forEach((t) => { tierLockRef.current[t] = false; });
      setIsSyncing(Object.values(tierLockRef.current).some(Boolean));
    };

    try {
      const tierLabel = force
        ? 'FULL force'
        : activeTiers.map((t) => t.toUpperCase()).join('+');
      addLog(`Bắt đầu đồng bộ [${tierLabel}]${force ? ' (bỏ qua cache)' : ''}...`, 'system');

      const settled = (res) => (res?.status === 'fulfilled' ? res.value : null);

      // ── COLD: FRED macro (slow-moving) ────────────────────────────────────
      let fedFundsRateVal = null;
      let cpiVal = null;
      let unrateVal = null;
      let m2SupplyVal = null;
      let highYieldVal = null;
      let walclVal = null;
      let tgaVal = null;
      let rrpVal = null;

      if (wantCold) {
        addLog('Đang đồng bộ chỉ số vĩ mô từ FRED...', 'system');
        const macroResults = await Promise.allSettled([
          fetchCached('fedFundsRate', () => getFREDMetric('FEDFUNDS', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'Lãi suất Fed', force),
          fetchCached('cpiYoYCalculatedV2', () => getFREDMetric('CPIAUCSL', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'CPI Inflation YoY', force),
          fetchCached('unrate', () => getFREDMetric('UNRATE', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'Tỷ lệ thất nghiệp', force),
          fetchCached('m2Supply', () => getFREDMetric('M2SL', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'M2 Money Supply', force),
          fetchCached('highYield', () => getFREDMetric('BAMLH0A0HYM2EY', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'High Yield Spread', force),
          fetchCached('walcl', () => getFREDMetric('WALCL', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'Fed Assets', force),
          fetchCached('tga', () => getFREDMetric('WDTGAL', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'TGA Treasury Account', force),
          fetchCached('rrp', () => getFREDMetric('RRPONTSYD', apiKeys.fred), CACHE_TTL.macroFred, addLog, 'Reverse Repo', force),
        ]);
        fedFundsRateVal = settled(macroResults[0]);
        cpiVal = settled(macroResults[1]);
        if (cpiVal !== null && !isPlausibleCpiYoY(cpiVal)) {
          addLog(`⚠ CPI YoY bị từ chối do sai đơn vị hoặc ngoài phạm vi hợp lý: ${cpiVal}`, 'warning');
          cpiVal = null;
        }
        unrateVal = settled(macroResults[2]);
        m2SupplyVal = settled(macroResults[3]);
        highYieldVal = settled(macroResults[4]);
        walclVal = settled(macroResults[5]);
        tgaVal = settled(macroResults[6]);
        rrpVal = settled(macroResults[7]);
      }

      if (wantHot || wantWarm || wantCold) {
        addLog('Đang đồng bộ dữ liệu thị trường / phái sinh / context...', 'system');
      }

      const tasks = [];
      const keys = [];
      const push = (key, promise) => {
        keys.push(key);
        tasks.push(promise);
      };

      if (wantHot) {
        // Short TTL — WS drives live price; REST is charts + offline fallback
        push('btc', fetchCached('binanceTicker', () => getBTCTicker24h('BTCUSDT'), CACHE_TTL.binanceTicker, addLog, 'BTC Ticker (Binance)', force));
        push('klines', fetchCached('binanceKlines1h', () => getBTCKlines('BTCUSDT', '1h', 48), CACHE_TTL.binanceKlines, addLog, 'BTC Klines 48h (Binance)', force));
        push('ls', fetchCached('binanceLs', () => getLongShortRatio('BTCUSDT', '1h', 24), CACHE_TTL.binanceLs, addLog, 'L/S Ratio 24h (Binance)', force));
        push('fund', fetchCached('binanceFunding', () => getFundingRate('BTCUSDT'), CACHE_TTL.binanceFunding, addLog, 'Funding Rate (Binance)', force));
        push('oi', fetchCached('binanceOi', () => getOpenInterest('BTCUSDT'), CACHE_TTL.binanceOi, addLog, 'Open Interest (Binance)', force));
        push('oiHist', fetchCached('binanceOiHist', () => getOIHistory('BTCUSDT', '1h', 24), CACHE_TTL.binanceOiHist, addLog, 'OI History 24h (Binance)', force));
      }

      if (wantWarm) {
        push('global', fetchCached('globalCryptoData', () => getGlobalCryptoData(), CACHE_TTL.globalCrypto, addLog, 'Global Market (CoinGecko)', force));
        push('stable', fetchCached('stablecoinData', () => getStablecoinData(), CACHE_TTL.stablecoin, addLog, 'Stablecoins (CoinGecko)', force));
        push('news', fetchCached('realtimeFeed', () => fetchRealtimeFeed(), CACHE_TTL.news, addLog, 'News RSS (rss2json)', force));
        push('yield10y', fetchCached('yield10y', () => getFREDMetric('DGS10', apiKeys.fred), CACHE_TTL.yield10y, addLog, 'Yield 10Y (Yahoo Finance)', force));
        push('dxy', fetchCached('dxyQuote', () => getDXYQuote(), CACHE_TTL.dxy, addLog, 'Chỉ số DXY (Yahoo Finance)', force));
        push('sp500', fetchCached('sp500Quote', () => getFREDStockQuote('SP500', apiKeys.fred), CACHE_TTL.sp500, addLog, 'S&P 500 Index (Yahoo Finance)', force));
        push('vix', fetchCached('vixQuote', () => getFREDStockQuote('VIXCLS', apiKeys.fred), CACHE_TTL.vix, addLog, 'VIX Volatility Index (Yahoo Finance)', force));
        push('qqq', fetchCached('qqqQuote', () => getFREDStockQuote('NASDAQ100', apiKeys.fred), CACHE_TTL.qqq, addLog, 'Nasdaq 100 Index (Yahoo Finance)', force));
        push('cvd24h', fetchCached('cvdHistory24h_v2', () => getHistoricalCVD('BTCUSDT', '1h', 24), CACHE_TTL.cvd24h, addLog, 'Lịch sử CVD 24h (Binance)', force));
        push('cvd7d', fetchCached('cvdHistory7d', () => getHistoricalCVD('BTCUSDT', '4h', 42), CACHE_TTL.cvd7d, addLog, 'Lịch sử CVD 7d (Binance)', force));
      }

      if (wantCold) {
        push('onChain', fetchCached('btcOnChain', () => getBTCOnChain(), CACHE_TTL.onChain, addLog, 'BTC Network (blockchain.info)', force));
        push('onChainMetrics', fetchCached('btcOnChainMetrics', () => getBTCOnChainMetrics(), CACHE_TTL.onChain, addLog, 'On-chain Metrics (CoinMetrics)', force));
        push('ethOnChainMetrics', fetchCached('ethOnChainMetrics', () => getETHOnChainMetrics(), CACHE_TTL.onChain, addLog, 'ETH On-chain Metrics (CoinMetrics)', force));
        push('etfHoldings', fetchCached('etfHoldings', () => getETFHoldings(), CACHE_TTL.etf, addLog, 'Spot ETF Holdings (Bitbo)', force));
        push('etfHistory', fetchCached('etfFlowHistory_v4', () => getETFFlowHistory(), CACHE_TTL.etf, addLog, 'Spot ETF Flow History (Farside)', force));
        push('cot', fetchCached('cmeCot', () => getCMECot(), CACHE_TTL.cot, addLog, 'Báo cáo CME COT (Tradingster)', force));
        push('fng', fetchCached('fearAndGreed', () => getFearAndGreed(), CACHE_TTL.fng, addLog, 'Chỉ số Fear & Greed (alternative.me)', force));
        push('cvd30d', fetchCached('cvdHistory30d', () => getHistoricalCVD('BTCUSDT', '1d', 30), CACHE_TTL.cvd30d, addLog, 'Lịch sử CVD 30d (Binance)', force));
        push('dailyKlines', fetchCached('btcDailyKlinesAll', () => getBTCKlines('BTCUSDT', '1d', 1000), CACHE_TTL.dailyKlines, addLog, 'Lịch sử giá BTC Daily 1000d (Binance)', force));
      }

      const results = tasks.length > 0 ? await Promise.allSettled(tasks) : [];
      const byKey = Object.fromEntries(keys.map((k, i) => [k, results[i]]));

      const btc = wantHot ? settled(byKey.btc) : null;
      const klines = wantHot ? (settled(byKey.klines) || []) : [];
      const lsHistory = wantHot ? (settled(byKey.ls) || []) : [];
      const fundingRate = wantHot ? settled(byKey.fund) : null;
      const openInterest = wantHot ? settled(byKey.oi) : null;
      const oiHistory = wantHot ? (settled(byKey.oiHist) || []) : [];

      const globalData = wantWarm ? settled(byKey.global) : null;
      const stablecoins = wantWarm ? settled(byKey.stable) : null;
      const news = wantWarm ? (settled(byKey.news) || []) : [];
      const tenYearYield = wantWarm ? settled(byKey.yield10y) : null;
      const dxy = wantWarm ? settled(byKey.dxy) : null;
      const sp500 = wantWarm ? settled(byKey.sp500) : null;
      const vix = wantWarm ? settled(byKey.vix) : null;
      const qqq = wantWarm ? settled(byKey.qqq) : null;
      const cvdHistory24h = wantWarm ? settled(byKey.cvd24h) : null;
      const cvdHistory7d = wantWarm ? settled(byKey.cvd7d) : null;

      const onChain = wantCold ? settled(byKey.onChain) : null;
      const onChainMetrics = wantCold ? settled(byKey.onChainMetrics) : null;
      const ethOnChainMetrics = wantCold ? settled(byKey.ethOnChainMetrics) : null;
      const etfHoldingsVal = wantCold ? settled(byKey.etfHoldings) : null;
      const etfHistoryVal = wantCold ? settled(byKey.etfHistory) : null;
      const cotData = wantCold ? settled(byKey.cot) : null;
      const fngData = wantCold ? settled(byKey.fng) : null;
      const cvdHistory30d = wantCold ? settled(byKey.cvd30d) : null;
      const btcDailyKlinesAll = wantCold ? settled(byKey.dailyKlines) : null;

      const now = new Date().toLocaleString('vi-VN');
      addLog(`Đồng bộ hoàn tất [${tierLabel}] lúc ${now}`, 'system');

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
        netLiquidity = parseFloat(((walclVal / 1000) - (tgaVal / 1000) - rrpVal).toFixed(2));
      }

      // REST price fallback for favicon when WS not yet connected
      if (btc?.price != null) {
        updateBrowserChromeImmediate(btc.price, btc.change ?? 0);
      }

      setData((prev) => ({
        btc: btc ?? prev.btc,
        klines: klines.length > 0 ? klines : prev.klines,
        lsHistory: lsHistory.length > 0 ? lsHistory : prev.lsHistory,
        fundingRate: fundingRate ?? prev.fundingRate,
        openInterest: openInterest ?? prev.openInterest,
        oiHistory: oiHistory.length > 0 ? oiHistory : prev.oiHistory,
        globalData: globalData ?? prev.globalData,
        stablecoins: stablecoins ?? prev.stablecoins,
        news: news.length > 0 ? news : prev.news,
        logs: [...logsRef.current],
        onChain: onChain ?? prev.onChain,
        onChainMetrics: onChainMetrics ?? prev.onChainMetrics,
        ethOnChainMetrics: ethOnChainMetrics ?? prev.ethOnChainMetrics,
        fedFundsRate: fedFundsRateVal ?? prev.fedFundsRate,
        cpi: cpiVal ?? (isPlausibleCpiYoY(prev.cpi) ? prev.cpi : null),
        unrate: unrateVal ?? prev.unrate,
        tenYearYield: tenYearYield ?? prev.tenYearYield,
        dxy: dxy ?? prev.dxy,
        m2Supply: m2SupplyVal ?? prev.m2Supply,
        highYield: highYieldVal ?? prev.highYield,
        sp500: sp500 ?? prev.sp500,
        vix: vix ?? prev.vix,
        qqq: qqq ?? prev.qqq,
        netLiquidity: netLiquidity ?? prev.netLiquidity,
        cotData: cotData ?? prev.cotData,
        fngData: fngData ?? prev.fngData,
        cvdHistory24h: cvdHistory24h?.length > 0 ? cvdHistory24h : prev.cvdHistory24h,
        cvdHistory7d: cvdHistory7d?.length > 0 ? cvdHistory7d : prev.cvdHistory7d,
        cvdHistory30d: cvdHistory30d?.length > 0 ? cvdHistory30d : prev.cvdHistory30d,
        btcDailyKlinesAll: btcDailyKlinesAll?.length > 0 ? btcDailyKlinesAll : prev.btcDailyKlinesAll,
      }));

      setLastSync(now);
      window.appLastSync = now;
      setLastSyncTime(now);
      if (wantHot) {
        setIsOnline(btc != null || klines.length > 0);
      }
    } catch (err) {
      addLog(`✗ Đồng bộ lỗi: ${err?.message || err}`, 'error');
    } finally {
      releaseLocks();
    }
  }, [addLog, setLastSyncTime, apiKeys.fred]);

  // Daily force-sync at 08:00 local
  useEffect(() => {
    const checkAutoSync = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentDateStr = now.toLocaleDateString('vi-VN');
      const lastAutoSyncDate = localStorage.getItem('last-auto-sync-date');

      if (currentHour >= 8 && lastAutoSyncDate !== currentDateStr) {
        addLog('[Auto-Sync] Đồng bộ hàng ngày 08:00 — full force...', 'system');
        syncData(true, ['hot', 'warm', 'cold']);
        localStorage.setItem('last-auto-sync-date', currentDateStr);
      }
    };

    checkAutoSync();
    const interval = setInterval(checkAutoSync, SYNC_INTERVAL.dailyCheck);
    return () => clearInterval(interval);
  }, [syncData, addLog]);

  // Tiered auto-refresh: initial full load, then staggered intervals
  useEffect(() => {
    // First paint: everything once (respects per-key TTL → mostly network only on cold start)
    syncData(false, ['hot', 'warm', 'cold']);

    const hotTimer = setInterval(() => syncData(false, ['hot']), SYNC_INTERVAL.hot);
    const warmTimer = setInterval(() => syncData(false, ['warm']), SYNC_INTERVAL.warm);
    const coldTimer = setInterval(() => syncData(false, ['cold']), SYNC_INTERVAL.cold);

    return () => {
      clearInterval(hotTimer);
      clearInterval(warmTimer);
      clearInterval(coldTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps



  // ── Derived chart data ──────────────────────────────────────────────────────
  const btcChartData = useMemo(() => ({
    labels: data.klines.map(k => new Date(k.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
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
        if (i === 0) return theme === 'light' ? '#047857' : '#10b981';
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

  // Favicon + document.title: updated from WebSocket (browserChrome) and REST fallback in syncData.
  // Intentionally NOT tied to React re-renders — avoids lag on background tabs.

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
    if (etfAumTimeframe === '90D') return holdingsHistory;
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

  // ── NUPL & Supply in Profit Calculations (Improved) ────────────────────────
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

  // Improved Supply in Profit estimation (better calibrated quadratic)
  const calculateSupplyInProfit = (mvrv) => {
    if (!mvrv || isNaN(mvrv) || mvrv <= 0) return null;
    // Improved formula: less aggressive quadratic, better fit in MVRV 1.5-3.0 zone
    let est = -8 + 47 * mvrv - 1.1 * mvrv * mvrv;
    est = Math.max(28, Math.min(98.5, est));
    return parseFloat(est.toFixed(1));
  };

  const btcSupplyProfitEst = useMemo(() => {
    const mvrv = parseFloat(data.onChainMetrics?.mvrv);
    const est = calculateSupplyInProfit(mvrv);
    if (est === null) return null;
    return {
      valStr: `${est}%`,
      subStr: `Mô hình từ MVRV (cải tiến)`,
      cls: est > 95 ? 'text-rose' : est < 50 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${est}% (Estimated)`
    };
  }, [data.onChainMetrics?.mvrv]);

  const ethSupplyProfitEst = useMemo(() => {
    const mvrv = parseFloat(data.ethOnChainMetrics?.mvrv);
    const est = calculateSupplyInProfit(mvrv);
    if (est === null) return null;
    return {
      valStr: `${est}%`,
      subStr: `Mô hình từ MVRV (cải tiến)`,
      cls: est > 95 ? 'text-rose' : est < 50 ? 'text-emerald' : 'text-slate-400',
      aiStr: `${est}% (Estimated)`
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
              <span className="version-badge font-mono">v5.1-LIVE</span>
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
            {lastSync && <React.Fragment><span className="text-slate-500">•</span><span className="sync-time">{lastSync}</span></React.Fragment>}
            </div>
          {/* WebSocket status badge */}
          <div className={`ws-badge font-mono ws-${wsStatus}`}>
            {wsStatus === 'connected'
              ? <React.Fragment><Zap size={10} /> WS LIVE</React.Fragment>
              : wsStatus === 'connecting'
              ? <React.Fragment><Radio size={10} className="spinning" /> WS...</React.Fragment>  
              : <React.Fragment><Radio size={10} /> WS OFF</React.Fragment>}
            </div>
          <div className="auto-refresh-badge font-mono" title="HOT 5m · WARM 15m · COLD 60m (TTL cache)">REST ⟳ TIERED</div>
          <button className="btn-sync font-mono" onClick={() => syncData(true, ['hot', 'warm', 'cold'])} disabled={isSyncing}>
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
              <div className="btc-hero" style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
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
                {btcDisplay?.volume != null && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                    <span className="font-mono text-slate-400" style={{ fontSize: '0.65rem' }}>
                      Vol 24H: {fmtB(btcDisplay.volume)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-divider" />

            {/* ── Sidebar Accordion Group 1: Derivatives & Market Sentiment ── */}
            {!isModuleHidden('sidebar_derivatives') && (
              <div className="sidebar-accordion">
                <button className="sidebar-accordion-header" onClick={() => toggleAccordion('derivatives')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <LiveDot /> PHÁI SINH & TÂM LÝ (DERIVATIVES)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ModuleMenu moduleId="sidebar_derivatives" />
                    {accordionOpen.derivatives ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {accordionOpen.derivatives && (
                  <div className="sidebar-accordion-body">
                    <div className="metrics-grid">
                      <MetricCard
                        label="FUNDING RATE"
                        value={fund != null ? `${(fund * 100).toFixed(4)}%` : '---'}
                        sub={fundInfo.text}
                        subCls={fundInfo.cls}
                        badge={liveFunding != null ? '⚡WS' : null}
                        badgeCls="badge-ws"
                        tooltipId="funding"
                        freshness="live"
                      />
                      <MetricCard
                        label="OPEN INTEREST"
                        value={data.openInterest ? `${(data.openInterest / 1000).toFixed(1)}K BTC` : '---'}
                        sub="Derivatives"
                        subCls="text-slate-400"
                        tooltipId="oi"
                        freshness="live"
                      />
                      <MetricCard
                        label="L/S RATIO"
                        value={currentLS ? parseFloat(currentLS.longShortRatio).toFixed(3) : '---'}
                        sub={currentLS ? `Long ${(parseFloat(currentLS.longAccount) * 100).toFixed(1)}%` : ''}
                        subCls={currentLS && parseFloat(currentLS.longAccount) > 0.55 ? 'text-rose' : 'text-emerald'}
                        tooltipId="lsRatio"
                        freshness="5m"
                      />
                      <MetricCard
                        label="BTC DOMINANCE"
                        value={data.globalData?.btcDominance ? `${data.globalData.btcDominance}%` : '---'}
                        sub={data.globalData?.ethDominance ? `ETH ${data.globalData.ethDominance}%` : ''}
                        subCls="text-slate-400"
                        tooltipId="btcDom"
                        freshness="5m"
                      />
                      <MetricCard
                        label="STABLECOIN CAP"
                        value={data.stablecoins ? fmtB(data.stablecoins.total) : '---'}
                        sub={data.stablecoins ? `USDT ${fmtB(data.stablecoins.usdt)}` : ''}
                        subCls="text-slate-400"
                        tooltipId="stablecoin"
                        freshness="1h"
                      />
                      <MetricCard
                        label="TOTAL MARKET CAP"
                        value={data.globalData ? fmtT(data.globalData.totalMarketCap) : '---'}
                        sub={data.globalData?.marketCapChange24h ? `${data.globalData.marketCapChange24h}% 24h` : ''}
                        subCls={data.globalData?.marketCapChange24h > 0 ? 'text-emerald' : 'text-rose'}
                        tooltipId="totalMcap"
                        freshness="1h"
                      />
                      <MetricCard
                        label="BTC 24H VOL"
                        value={btcDisplay ? fmtB(btcDisplay.volume) : '---'}
                        sub="USDT Volume"
                        subCls="text-slate-400"
                        tooltipId="volume24h"
                        freshness="live"
                      />
                      <MetricCard
                        label="24H RANGE"
                        value={btcDisplay ? `${fmt(btcDisplay.low, 0)}` : '---'}
                        sub={btcDisplay ? `H: ${fmt(btcDisplay.high, 0)}` : ''}
                        subCls="text-slate-400"
                        tooltipId="range24h"
                        freshness="live"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Sidebar Accordion Group 2: US Macro Economics ── */}
            {!isModuleHidden('sidebar_macro') && (
              <div className="sidebar-accordion">
                <button className="sidebar-accordion-header" onClick={() => toggleAccordion('macro')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <LiveDot /> VĨ MÔ KINH TẾ MỸ (MACRO)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ModuleMenu moduleId="sidebar_macro" />
                    {accordionOpen.macro ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {accordionOpen.macro && (
                  <div className="sidebar-accordion-body">
                    <div className="metrics-grid">
                      <MetricCard
                        label="CPI YOY"
                        value={isPlausibleCpiYoY(data.cpi) ? `${Number(data.cpi).toFixed(2)}%` : '---'}
                        sub="Lạm phát so với cùng kỳ"
                        subCls="text-slate-400"
                        tooltipId="cpi"
                        freshness="1h"
                      />
                      <MetricCard
                        label="UNEMPLOYMENT"
                        value={data.unrate ? `${data.unrate}%` : '---'}
                        sub="Tỷ lệ thất nghiệp"
                        subCls="text-slate-400"
                        tooltipId="unrate"
                        freshness="1h"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Sidebar Accordion Group 3: BTC Network & On-chain ── */}
            {!isModuleHidden('sidebar_onchain') && (
              <div className="sidebar-accordion">
                <button className="sidebar-accordion-header" onClick={() => toggleAccordion('onchain')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <LiveDot /> BTC NETWORK & ON-CHAIN
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ModuleMenu moduleId="sidebar_onchain" />
                    {accordionOpen.onchain ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {accordionOpen.onchain && (
                  <div className="sidebar-accordion-body">
                    <div className="metrics-grid">
                      {/* Top Priority Valuation & Supply Metrics */}
                      <MetricCard
                        label="PRODUCTION COST"
                        value={(() => {
                          const pc = data.onChain?.productionCost;
                          if (!pc) return '---';
                          if (typeof pc === 'object' && pc.low != null && pc.high != null) {
                            const fmt = (n) => `$${Math.round(n / 1000)}k`;
                            return `${fmt(pc.low)} → ${fmt(pc.high)}`;
                          }
                          const n = parseInt(pc, 10);
                          return Number.isFinite(n) ? `$${n.toLocaleString()}` : '---';
                        })()}
                        sub={(() => {
                          const pc = data.onChain?.productionCost;
                          if (pc && typeof pc === 'object' && pc.mid != null) {
                            return `mid ~$${Math.round(pc.mid / 1000)}k · 1 BTC est.`;
                          }
                          return '1 BTC (range est.)';
                        })()}
                        subCls="text-slate-400"
                        tooltipId="productionCost"
                        freshness="1h"
                      />
                      <MetricCard
                        label="BTC MVRV"
                        value={data.onChainMetrics?.mvrv || '---'}
                        sub={data.onChainMetrics?.mvrv > 3.5 ? 'Overvalued ⚠' : data.onChainMetrics?.mvrv < 1 ? 'Undervalued ✓' : 'Fair Value'}
                        subCls={data.onChainMetrics?.mvrv > 3.5 ? 'text-rose' : data.onChainMetrics?.mvrv < 1 ? 'text-emerald' : 'text-slate-400'}
                        tooltipId="mvrv"
                        freshness="1h"
                      />
                      <MetricCard
                        label="BTC NUPL (LÃI/LỖ)"
                        value={btcNuplVal?.percentStr || '---'}
                        sub={btcNuplVal?.subStr || 'Net Unrealized Profit'}
                        subCls={btcNuplVal?.cls || 'text-slate-400'}
                        tooltipId="btcNupl"
                        freshness="1h"
                      />
                      <MetricCard
                        label="BTC COIN LỜI (EST)"
                        value={btcSupplyProfitEst?.valStr || '---'}
                        sub={btcSupplyProfitEst?.subStr || 'Supply in Profit'}
                        subCls={btcSupplyProfitEst?.cls || 'text-slate-400'}
                        tooltipId="btcSupplyProfit"
                        freshness="1h"
                      />
                      <MetricCard
                        label="ETH MVRV"
                        value={data.ethOnChainMetrics?.mvrv || '---'}
                        sub={data.ethOnChainMetrics?.mvrv > 3.5 ? 'Overvalued ⚠' : data.ethOnChainMetrics?.mvrv < 1 ? 'Undervalued ✓' : 'Fair Value'}
                        subCls={data.ethOnChainMetrics?.mvrv > 3.5 ? 'text-rose' : data.ethOnChainMetrics?.mvrv < 1 ? 'text-emerald' : 'text-slate-400'}
                        tooltipId="ethMvrv"
                        freshness="1h"
                      />
                      <MetricCard
                        label="ETH NUPL (LÃI/LỖ)"
                        value={ethNuplVal?.percentStr || '---'}
                        sub={ethNuplVal?.subStr || 'Net Unrealized Profit'}
                        subCls={ethNuplVal?.cls || 'text-slate-400'}
                        tooltipId="ethNupl"
                        freshness="1h"
                      />
                      <MetricCard
                        label="ETH COIN LỜI (EST)"
                        value={ethSupplyProfitEst?.valStr || '---'}
                        sub={ethSupplyProfitEst?.subStr || 'Supply in Profit'}
                        subCls={ethSupplyProfitEst?.cls || 'text-slate-400'}
                        tooltipId="ethSupplyProfit"
                        freshness="1h"
                      />
                      {/* Secondary Network & Miner Metrics */}
                      <MetricCard
                        label="HASH RATE"
                        value={data.onChain?.hashRate ? `${data.onChain.hashRate} EH/s` : '---'}
                        sub="Mining Power"
                        subCls="text-slate-400"
                        tooltipId="hashRate"
                        freshness="1h"
                      />
                      <MetricCard
                        label="ACTIVE ADDR"
                        value={data.onChainMetrics?.activeAddresses || '---'}
                        sub="Unique senders/day"
                        subCls="text-slate-400"
                        tooltipId="activeAddr"
                        freshness="1h"
                      />
                      <MetricCard
                        label="DIFFICULTY"
                        value={data.onChain?.difficulty ? `${data.onChain.difficulty}T` : '---'}
                        sub="Mining Difficulty"
                        subCls="text-slate-400"
                        tooltipId="difficulty"
                        freshness="1h"
                      />
                      <MetricCard
                        label="TX / 24H"
                        value={data.onChain?.txCount24h ? data.onChain.txCount24h.toLocaleString() : '---'}
                        sub="Transactions"
                        subCls="text-slate-400"
                        tooltipId="txCount"
                        freshness="1h"
                      />
                      <MetricCard
                        label="BLOCK TIME"
                        value={data.onChain?.minutesBetweenBlocks ? `${data.onChain.minutesBetweenBlocks}m` : '---'}
                        sub={data.onChain?.minutesBetweenBlocks < 10 ? 'Fast ↑' : 'Normal'}
                        subCls={data.onChain?.minutesBetweenBlocks < 10 ? 'text-emerald' : 'text-slate-400'}
                        tooltipId="blockTime"
                        freshness="1h"
                      />

                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </aside>

        {/* ── Main Content Area ─────────────────────────────────────────────── */}
        <main className="content-area">
          <nav className="tabs-nav font-mono">
            {[
              { id: 'dashboard', icon: <BarChart2 size={13} />, label: 'DASHBOARD' },
              { id: 'scanner',   icon: <Zap size={13} />,       label: 'SCANNER' },
              { id: 'hft',       icon: <Crosshair size={13} />, label: 'DATA' },
              { id: 'cascade',   icon: <Layers size={13} />,    label: 'THÁC THANH KHOẢN', moduleId: 'tab_cascade' },
              { id: 'summary',   icon: <Sparkles size={13} />,  label: 'AI SUMMARY', moduleId: 'tab_summary' },
              { id: 'glossary',  icon: <HelpCircle size={13} />, label: 'THUẬT NGỮ', moduleId: 'tab_glossary' },
              { id: 'terminal',  icon: <Terminal size={13} />,  label: 'TERMINAL LOGS', moduleId: 'tab_terminal' },
            ].filter(t => !t.moduleId || !isModuleHidden(t.moduleId)).map(t => (
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

            {/* ══ DASHBOARD TAB — Keep-Alive State ════════════════════════════ */}
            <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none' }}>
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
            </div>

            {/* ══ SCANNER TAB — Keep-Alive State ══════════════════════════════ */}
            <div style={{ display: activeTab === 'scanner' ? 'block' : 'none' }}>
              <ScannerTab
                data={data}
                etfHistory={etfHistory}
              />
            </div>

            {/* ══ HFT RADAR TAB — Keep-Alive State ════════════════════════════ */}
            <div style={{ display: activeTab === 'hft' ? 'block' : 'none' }}>
              <HftRadarTab
                cvd={cvd} sessionCvd={sessionCvd} buyVolume={buyVolume} sellVolume={sellVolume}
                cvdHistory={cvdHistory} cvdHistory24h={data.cvdHistory24h} cvdHistory7d={data.cvdHistory7d} cvdHistory30d={data.cvdHistory30d}
                cvdStatus={cvdStatus} livePrice={livePrice}
                whaleTrades={whaleTrades} volNodes={volNodes} theme={theme}
                data={data} fundingRate={fund}
                liveChange={liveChange} liveHigh={liveHigh} liveLow={liveLow}
                liveVolume={liveVolume} liveEthPrice={liveEthPrice} liveSolPrice={liveSolPrice}
              />
            </div>

            {/* ══ CASCADE TAB — Keep-Alive State ══════════════════════════════ */}
            <div style={{ display: activeTab === 'cascade' ? 'block' : 'none' }}>
              <CascadeTab
                data={data}
                fmt={fmt}
                fmtB={fmtB}
                btcDisplay={btcDisplay}
                fund={fund}
                CASCADE_KEY_MAP={CASCADE_KEY_MAP}
                METRIC_METADATA={METRIC_METADATA}
              />
            </div>

            {/* ══ AI SUMMARY TAB — Keep-Alive State ═══════════════════════════ */}
            <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
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
            </div>

            {/* ══ GLOSSARY TAB — Keep-Alive State ═════════════════════════════ */}
            <div style={{ display: activeTab === 'glossary' ? 'block' : 'none' }}>
              <GlossaryTab />
            </div>

            {/* ══ TERMINAL TAB — Keep-Alive State ═════════════════════════════ */}
            <div style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}>
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
            </div>

          </div>
        </main>

        {/* ── Mobile Bottom Navigation Bar ──────────────────────────────────── */}
        <nav className="mobile-bottom-nav">
          {[
            { id: 'dashboard', icon: <BarChart2 size={16} />, label: 'Dashboard' },
            { id: 'scanner',   icon: <Zap size={16} />,       label: 'Scanner' },
            { id: 'hft',       icon: <Crosshair size={16} />, label: 'Data HFT' },
            { id: 'cascade',   icon: <Layers size={16} />,    label: 'Thác TK', moduleId: 'tab_cascade' },
            { id: 'summary',   icon: <Sparkles size={16} />,  label: 'AI Summary', moduleId: 'tab_summary' },
            { id: 'glossary',  icon: <HelpCircle size={16} />, label: 'Thuật ngữ', moduleId: 'tab_glossary' },
          ].filter(t => !t.moduleId || !isModuleHidden(t.moduleId)).map(t => (
            <button
              key={t.id}
              className={`mobile-nav-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
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
              Nhập các khóa API cá nhân để Terminal đồng bộ trực tiếp dữ liệu vĩ mô & chứng khoán thực tế từ nguồn FRED & Alpha Vantage.
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

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                className="btn-sync font-mono"
                style={{ flex: 1, justifyContent: 'center', height: '34px', cursor: 'pointer' }}
                onClick={() => {
                  localStorage.setItem('app-api-keys', JSON.stringify(apiKeys));
                  setShowSettings(false);
                  addLog('Đã lưu cấu hình API Keys thành công. Đang tải lại dữ liệu...', 'ok');
                  syncData(true, ['hot', 'warm', 'cold']);
                }}
              >
                LƯU & ĐỒNG BỘ
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border-panel)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 className="font-mono text-slate-300" style={{ margin: 0, fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <EyeOff size={13} className="text-emerald" /> QUẢN LÝ MODULE ĐÃ ẨN
                </h4>
                {hiddenModules.length > 1 && (
                  <button
                    type="button"
                    onClick={showAllModules}
                    className="font-mono text-emerald"
                    style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.52rem', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  >
                    Hiển thị tất cả ({hiddenModules.length})
                  </button>
                )}
              </div>
              
              <p className="font-mono text-slate-400" style={{ fontSize: '0.55rem', margin: 0, lineHeight: 1.4 }}>
                Bật toggle ON để hiển thị lại module đã ẩn (chỉ hiển thị các module đang ẩn để tránh nhiễu).
              </p>

              {hiddenModules.length === 0 ? (
                <div className="font-mono text-slate-500" style={{ fontSize: '0.58rem', padding: '10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px dashed var(--border-panel)', textAlign: 'center' }}>
                  ✓ Không có module nào đang bị ẩn.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', paddingRight: '4px' }}>
                  {hiddenModules.map(id => {
                    const meta = MODULES_CONFIG[id] || { label: id, category: 'Khác' };
                    return (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-slate-950)', borderRadius: '6px', border: '1px solid var(--border-panel)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span className="font-mono text-contrast" style={{ fontSize: '0.62rem', fontWeight: 600 }}>{meta.label}</span>
                          <span className="font-mono text-slate-500" style={{ fontSize: '0.48rem' }}>[{meta.category}]</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => showModule(id)}
                          title="Bật để hiển thị lại module này"
                          style={{
                            width: '36px',
                            height: '20px',
                            borderRadius: '10px',
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid var(--border-panel)',
                            position: 'relative',
                            cursor: 'pointer',
                            transition: 'all 0.25s ease',
                            padding: 0
                          }}
                          className="module-toggle-off"
                        >
                          <span style={{
                            display: 'block',
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            background: 'var(--text-slate-400)',
                            position: 'absolute',
                            top: '2px',
                            left: '2px',
                            transition: 'all 0.25s ease'
                          }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ModuleVisibilityProvider>
      <AppContent />
    </ModuleVisibilityProvider>
  );
}
