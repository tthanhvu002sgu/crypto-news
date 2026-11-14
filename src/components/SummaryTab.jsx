import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2, Download, FileDown } from 'lucide-react';
import Tooltip from './Tooltip';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines, getBTCFuturesKlines, getHistoricalCVD, fetchRealtimeFeed, getOIHistory, getLongShortRatio, getMultiExchangeFunding } from '../services/api';
import { getWeeklyEconomicCalendar } from '../services/economicCalendarService';
import { fetchCached } from '../utils/cache';
import { fetchDeribitOptionChain } from '../services/deribitOptionsService';
import { analyzeOptionsChain } from '../services/optionsCalculations';
import { fetchFuturesFundingHistory } from '../services/scannerDataEngine';
import { getSystemPrompt, getGenerationConfig, AI_STYLE_LABELS } from '../services/aiPrompts';
import { buildProfessionalReportLayout } from '../services/summaryReportLayout';
import { fetchTop10FreeUniqueProviderModels, streamOpenRouterCompletion, FALLBACK_FREE_MODELS } from '../services/openrouter';
import { detectTopImpulseMoves, enrichMoveWithMicrostructure, formatForensicsPayloadForAi, formatCompactUsd, formatUsd, formatDisplayDateVn } from '../services/moveForensicsEngine';
import { loadMovePreview } from '../services/moveEventStore';
import { cleanLatex, cleanReportMarkdown, stripOrphanedBold } from '../services/reportSanitizer';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import TradePlanAuditor from './TradePlanAuditor';
import { 
  EtfChart, 
  CvdChart, 
  FundingOiChart, 
  CotChart, 
  OnChainValuationChart, 
  MacroLiquidityChart,
  LiquidationChart,
  OptionsStrikeChart
} from './SummaryCharts';

const renderTextWithTags = (text) => {
  if (typeof text !== 'string') return text;

  // Match dollar amounts ($92,450, $83.06B), percentages (+1.5%, -3.2%, 100%), ratios (1.8x, 2.5x)
  const combinedRegex = /(\$[0-9.,]+[KMBkmb]?|[+-][0-9.,]+%|[0-9.,]+%|[0-9.]+(?:x|X)\b)/g;
  const parts = text.split(combinedRegex);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    // 1. Positive & Negative Percentages
    if (part.startsWith('+')) {
      return <span key={i} className="num-highlight positive">{part}</span>;
    }
    if (part.startsWith('-') && part.endsWith('%')) {
      return <span key={i} className="num-highlight negative">{part}</span>;
    }

    // 2. Currencies, Ratios & Plain Percentages
    if (part.startsWith('$') || part.endsWith('%') || part.toLowerCase().endsWith('x')) {
      return <span key={i} className="num-highlight">{part}</span>;
    }

    return part;
  });
};

const markdownComponents = {
  table: ({ children }) => (
    <div className="table-responsive-wrapper">
      <table>{children}</table>
    </div>
  ),
  p: ({ children }) => <p>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</p>,
  li: ({ children }) => <li>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</li>,
  td: ({ children }) => <td>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</td>,
  strong: ({ children }) => <strong>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</strong>,
  h1: ({ children }) => <h1>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h1>,
  h2: ({ children }) => <h2>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h2>,
  h3: ({ children }) => <h3>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h3>,
  h4: ({ children }) => <h4>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h4>,
};

// Re-export sanitized helpers for backwards compatibility
export { cleanLatex, cleanReportMarkdown, stripOrphanedBold };


const toFiniteNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatNumber = (value, digits = 2) => {
  const number = toFiniteNumber(value);
  if (number === null) return 'N/A';
  return number.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatSigned = (value, digits = 2, suffix = '') => {
  const number = toFiniteNumber(value);
  if (number === null) return 'N/A';
  return `${number > 0 ? '+' : ''}${formatNumber(number, digits)}${suffix}`;
};

const safeIsoTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toISOString();
};

const parseMarketDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  const dayFirstMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (dayFirstMatch) {
    const [, day, month, rawYear] = dayFirstMatch;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const ageInDays = (value, now = new Date()) => {
  const date = parseMarketDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
};

// U.S. spot ETF flow providers publish after the U.S. session, which is normally
// the following calendar day in Vietnam. A row carrying today's local date can
// therefore be a provisional 0.0 placeholder, not an observed zero-flow day.
const isCompletedEtfObservation = (value, now = new Date()) => {
  const observationDate = parseMarketDate(value);
  if (!observationDate) return false;
  const localReportDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return observationDate.getTime() < localReportDay;
};

export default function SummaryTab({ 
  data, apiKeys, cvd, spotCvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  liquidations, liqStats5m, liqStats1h,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading, lastSync,
  btcNupl, ethNupl, btcSupplyProfit, ethSupplyProfit,
  onExportMarkdown, isExportingMd
}) {
  const [reportCvdData, setReportCvdData] = useState([]);
  const [reportChartData, setReportChartData] = useState(null);
  const { isModuleHidden, showModule } = useModuleVisibility();
  const isSummaryHidden = isModuleHidden('tab_summary');
  const isAuditorHidden = isModuleHidden('dash_trade_auditor');
  const [aiProvider, setAiProvider] = useState(() => {
    return localStorage.getItem('ai-provider') || 'gemini';
  });

  const handleProviderChange = (newProvider) => {
    setAiProvider(newProvider);
    localStorage.setItem('ai-provider', newProvider);
  };

  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('ai-model');
    const validModels = [
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
    ];
    if (saved && validModels.includes(saved)) {
      return saved;
    }
    return 'gemma-4-31b-it';
  });

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    localStorage.setItem('ai-model', newModel);
  };

  const [openrouterModels, setOpenrouterModels] = useState(FALLBACK_FREE_MODELS);
  const [isOpenrouterLoading, setIsOpenrouterLoading] = useState(false);
  const [selectedOpenRouterModel, setSelectedOpenRouterModel] = useState(() => {
    return localStorage.getItem('ai-openrouter-model') || 'deepseek/deepseek-r1:free';
  });

  const handleOpenRouterModelChange = (newModel) => {
    setSelectedOpenRouterModel(newModel);
    localStorage.setItem('ai-openrouter-model', newModel);
  };

  React.useEffect(() => {
    let isMounted = true;
    async function loadOpenRouterModels() {
      setIsOpenrouterLoading(true);
      const top10 = await fetchTop10FreeUniqueProviderModels();
      if (isMounted && top10 && top10.length > 0) {
        setOpenrouterModels(top10);
      }
      if (isMounted) setIsOpenrouterLoading(false);
    }
    loadOpenRouterModels();
    return () => { isMounted = false; };
  }, []);

  const [selectedStyle, setSelectedStyle] = useState(() => {
    const saved = localStorage.getItem('ai-analysis-style');
    return saved === 'professional' || saved === 'compact' || saved === 'forensics' ? saved : 'compact';
  });

  const [forensicsMoves24h, setForensicsMoves24h] = useState([]);
  const [forensicsMoves7d, setForensicsMoves7d] = useState([]);
  const [forensicsMovesH4, setForensicsMovesH4] = useState([]);
  const forensicsKlinesRef = useRef({ k15m: [], k1h: [], k4h: [] });
  const [isForensicsLoading, setIsForensicsLoading] = useState(false);
  const [forensicsSortBy, setForensicsSortBy] = useState('time'); // 'time' | 'magnitude'

  const sortedMoves24h = useMemo(() => {
    const list = [...forensicsMoves24h];
    if (forensicsSortBy === 'magnitude') {
      return list.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));
    }
    return list.sort((a, b) => a.startTime - b.startTime);
  }, [forensicsMoves24h, forensicsSortBy]);

  const sortedMoves7d = useMemo(() => {
    const list = [...forensicsMoves7d];
    if (forensicsSortBy === 'magnitude') {
      return list.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));
    }
    return list.sort((a, b) => a.startTime - b.startTime);
  }, [forensicsMoves7d, forensicsSortBy]);

  const sortedMovesH4 = useMemo(() => {
    const list = [...forensicsMovesH4];
    if (forensicsSortBy === 'magnitude') {
      return list.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));
    }
    return list.sort((a, b) => a.startTime - b.startTime);
  }, [forensicsMovesH4, forensicsSortBy]);

  const fetchAndEnrichForensics = async (force = false) => {
    if (!force && forensicsMoves24h.length > 0 && forensicsMoves7d.length > 0 && forensicsMovesH4.length > 0) {
      return { ...forensicsKlinesRef.current, enr24h: forensicsMoves24h, enr7d: forensicsMoves7d, enrH4: forensicsMovesH4 };
    }

    setIsForensicsLoading(true);
    try {
      const [k15m, k1h, k4h, calRes, oi96_15m, ls96_15m, oi168_1h, ls168_1h, oi120_4h, ls120_4h] = await Promise.all([
        getBTCFuturesKlines('BTCUSDT', '15m', 96),
        getBTCFuturesKlines('BTCUSDT', '1h', 168),
        getBTCFuturesKlines('BTCUSDT', '4h', 120),
        getWeeklyEconomicCalendar().catch(() => null),
        getOIHistory('BTCUSDT', '15m', 96).catch(() => []),
        getLongShortRatio('BTCUSDT', '15m', 96).catch(() => []),
        getOIHistory('BTCUSDT', '1h', 168).catch(() => []),
        getLongShortRatio('BTCUSDT', '1h', 168).catch(() => []),
        getOIHistory('BTCUSDT', '4h', 120).catch(() => []),
        getLongShortRatio('BTCUSDT', '4h', 120).catch(() => []),
      ]);
      const localEvents = loadMovePreview();
      const raw24h = detectTopImpulseMoves(k15m, 3, { maxClusterLength: 8 });
      const raw7d = detectTopImpulseMoves(k1h, 5, { maxClusterLength: 6 });
      const rawH4 = detectTopImpulseMoves(k4h, 5, { maxClusterLength: 4, candleDurationMs: 4 * 3600 * 1000 });

      const activeOi24h = (Array.isArray(oi96_15m) && oi96_15m.length > 0)
        ? oi96_15m
        : ((Array.isArray(oi168_1h) && oi168_1h.length > 0) ? oi168_1h : (data?.oiHistory || []));
      const activeLs24h = (Array.isArray(ls96_15m) && ls96_15m.length > 0)
        ? ls96_15m
        : ((Array.isArray(ls168_1h) && ls168_1h.length > 0) ? ls168_1h : (data?.lsHistory || []));

      const activeOi7d = (Array.isArray(oi168_1h) && oi168_1h.length > 0)
        ? oi168_1h
        : (data?.oiHistory || []);
      const activeLs7d = (Array.isArray(ls168_1h) && ls168_1h.length > 0)
        ? ls168_1h
        : (data?.lsHistory || []);

      const activeOiH4 = (Array.isArray(oi120_4h) && oi120_4h.length > 0)
        ? oi120_4h
        : ((Array.isArray(oi168_1h) && oi168_1h.length > 0) ? oi168_1h : (data?.oiHistory || []));
      const activeLsH4 = (Array.isArray(ls120_4h) && ls120_4h.length > 0)
        ? ls120_4h
        : ((Array.isArray(ls168_1h) && ls168_1h.length > 0) ? ls168_1h : (data?.lsHistory || []));

      const activeCalendarEvents = calRes?.events || data?.calendarEvents || [];

      const enr24h = enrichMoveWithMicrostructure(raw24h, {
        oiHistory: activeOi24h,
        lsHistory: activeLs24h,
        calendarEvents: activeCalendarEvents,
        localMoveStore: localEvents,
        klines: k15m,
      });
      const enr7d = enrichMoveWithMicrostructure(raw7d, {
        oiHistory: activeOi7d,
        lsHistory: activeLs7d,
        calendarEvents: activeCalendarEvents,
        localMoveStore: localEvents,
        klines: k1h,
      });
      const enrH4 = enrichMoveWithMicrostructure(rawH4, {
        oiHistory: activeOiH4,
        lsHistory: activeLsH4,
        calendarEvents: activeCalendarEvents,
        localMoveStore: localEvents,
        klines: k4h,
      });

      forensicsKlinesRef.current = { k15m, k1h, k4h };
      setForensicsMoves24h(enr24h);
      setForensicsMoves7d(enr7d);
      setForensicsMovesH4(enrH4);
      return { k15m, k1h, k4h, enr24h, enr7d, enrH4 };
    } catch (err) {
      console.warn('Failed to load move forensics:', err);
      return { k15m: [], k1h: [], k4h: [], enr24h: [], enr7d: [], enrH4: [] };
    } finally {
      setIsForensicsLoading(false);
    }
  };

  const handleStyleChange = (newStyle) => {
    setSelectedStyle(newStyle);
    localStorage.setItem('ai-analysis-style', newStyle);
    if (newStyle === 'forensics' && (forensicsMoves24h.length === 0 || forensicsMoves7d.length === 0 || forensicsMovesH4.length === 0)) {
      fetchAndEnrichForensics();
    }
  };

  useEffect(() => {
    if (selectedStyle === 'forensics' && (forensicsMoves24h.length === 0 || forensicsMoves7d.length === 0 || forensicsMovesH4.length === 0)) {
      fetchAndEnrichForensics();
    }
  }, [selectedStyle]);

  /** User bias: none | long | short — persists across reloads */
  const [selectedUserBias, setSelectedUserBias] = useState(() => {
    return localStorage.getItem('ai-user-bias') || 'none';
  });

  const handleUserBiasChange = (bias) => {
    setSelectedUserBias(bias);
    localStorage.setItem('ai-user-bias', bias);
  };

  /** Report language: vi | en — persists across reloads */
  const [selectedLang, setSelectedLang] = useState(() => {
    const saved = localStorage.getItem('ai-report-lang');
    return saved === 'en' || saved === 'vi' ? saved : 'vi';
  });

  const handleLangChange = (lang) => {
    setSelectedLang(lang);
    localStorage.setItem('ai-report-lang', lang);
  };

  const isVi = selectedLang === 'vi';
  const styleLabels = AI_STYLE_LABELS[selectedLang] || AI_STYLE_LABELS.en;

  const preparePromptAndData = async () => {
    let orderBook = null;
    let whaleWalls = null;
    let klines7d = [];
    let klines30d = [];
    let klines90d = [];
    let klines1y = [];
    let cvd7d = [];
    let cvd30d = [];
    let spotCvd7d = [];
    let spotCvd30d = [];
    let latestNews = [];
    let calendarRes = null;
    let fundingHistory = [];
    let optionsChain = null;

    try {
      [
        orderBook,
        whaleWalls,
        klines7d,
        klines30d,
        klines90d,
        klines1y,
        cvd7d,
        cvd30d,
        spotCvd7d,
        spotCvd30d,
        latestNews,
        calendarRes,
        fundingHistory,
        optionsChain,
      ] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100),
        getWhaleWalls(),
        getBTCKlines('BTCUSDT', '4h', 42),
        getBTCKlines('BTCUSDT', '1d', 30),
        getBTCKlines('BTCUSDT', '1d', 90),
        getBTCKlines('BTCUSDT', '1w', 52),
        getHistoricalCVD('BTCUSDT', '4h', 42, 'futures'),
        getHistoricalCVD('BTCUSDT', '1d', 30, 'futures'),
        getHistoricalCVD('BTCUSDT', '4h', 42, 'spot'),
        getHistoricalCVD('BTCUSDT', '1d', 30, 'spot'),
        fetchRealtimeFeed(),
        getWeeklyEconomicCalendar().catch(() => null),
        fetchFuturesFundingHistory('BTCUSDT', Date.now() - 3 * 86400000, Date.now()).catch(() => []),
        fetchCached('deribit_options_btc_v2', () => fetchDeribitOptionChain('BTC'), 15 * 60 * 1000).catch(() => null),
      ]);
    } catch (error) {
      console.warn('Error fetching data for report:', error);
    }

    const getSeriesPoints = (series) => {
      if (!series) return [];
      if (Array.isArray(series)) return series;
      if (Array.isArray(series.points)) return series.points;
      return [];
    };
    const getSeriesNetDelta = (series) => {
      if (series == null) return null;
      if (typeof series.windowNetDelta === 'number') return series.windowNetDelta;
      const pts = getSeriesPoints(series);
      if (pts.length === 0) return null;
      const sumDelta = pts.reduce((sum, p) => sum + (toFiniteNumber(p.delta) || 0), 0);
      if (sumDelta !== 0 || pts.some(p => p.delta !== undefined)) return sumDelta;
      return toFiniteNumber(pts[pts.length - 1]?.cvd);
    };

    const activeCvd7dSeries = (cvd7d?.points?.length > 0 || cvd7d?.length > 0) ? cvd7d : (data.cvdHistory7d || []);
    const activeCvd30dSeries = (cvd30d?.points?.length > 0 || cvd30d?.length > 0) ? cvd30d : (data.cvdHistory30d || []);
    const activeSpotCvd7dSeries = (spotCvd7d?.points?.length > 0 || spotCvd7d?.length > 0) ? spotCvd7d : (data.cvdHistory7dSpot || []);
    const activeSpotCvd30dSeries = (spotCvd30d?.points?.length > 0 || spotCvd30d?.length > 0) ? spotCvd30d : (data.cvdHistory30dSpot || []);

    const activeCvd7d = getSeriesPoints(activeCvd7dSeries);
    const activeCvd30d = getSeriesPoints(activeCvd30dSeries);
    const activeSpotCvd7d = getSeriesPoints(activeSpotCvd7dSeries);
    const activeSpotCvd30d = getSeriesPoints(activeSpotCvd30dSeries);

    if (activeCvd30d.length > 0 || activeCvd7d.length > 0) {
      setReportCvdData(activeCvd30d.length > 0 ? activeCvd30d : activeCvd7d);
    }

    const fundingSettlements = Array.isArray(fundingHistory) ? fundingHistory : [];
    const optionsAnalysis = optionsChain?.instruments?.length
      ? analyzeOptionsChain(optionsChain.instruments, optionsChain.underlyingPrice, null, 'BTC')
      : null;
    setReportChartData({ fundingHistory: fundingSettlements, options: optionsAnalysis });
    const activeNews = latestNews?.length > 0 ? latestNews : (data.news || []);
    const klines48h = Array.isArray(data.klines) ? data.klines : [];
    const priceNow =
      toFiniteNumber(data.btc?.price) ??
      toFiniteNumber(klines48h[klines48h.length - 1]?.close);

    const sampleSeries = (items, maxPoints = 10) => {
      if (!Array.isArray(items) || items.length === 0) return [];
      const pointCount = Math.min(maxPoints, items.length);
      if (pointCount === 1) return [items[0]];
      return Array.from({ length: pointCount }, (_, index) => {
        const sourceIndex = Math.round((index * (items.length - 1)) / (pointCount - 1));
        return items[sourceIndex];
      });
    };

    const priceStats = (candles, label) => {
      const valid = (candles || []).filter((candle) =>
        [candle.open, candle.high, candle.low, candle.close].every(
          (value) => toFiniteNumber(value) !== null
        )
      );
      if (valid.length === 0) {
        return { label, text: `- ${label}: N/A`, changePct: null, rangePosition: null };
      }

      const open = toFiniteNumber(valid[0].open);
      const close = toFiniteNumber(valid[valid.length - 1].close);
      const high = Math.max(...valid.map((candle) => toFiniteNumber(candle.high)));
      const low = Math.min(...valid.map((candle) => toFiniteNumber(candle.low)));
      const changePct = open > 0 ? ((close - open) / open) * 100 : null;
      const rangePosition = high > low ? ((close - low) / (high - low)) * 100 : null;
      const start = safeIsoTime(valid[0].time);
      const end = safeIsoTime(valid[valid.length - 1].time);

      return {
        label,
        changePct,
        rangePosition,
        text:
          `- ${label}: ${start} -> ${end} | Open $${formatNumber(open, 0)} | ` +
          `Close $${formatNumber(close, 0)} | Change ${formatSigned(changePct, 2, '%')} | ` +
          `High $${formatNumber(high, 0)} | Low $${formatNumber(low, 0)} | ` +
          `Close location in range ${formatNumber(rangePosition, 1)}%`,
      };
    };

    const pricePath = (candles, maxPoints = 10) => {
      const sampled = sampleSeries(candles || [], maxPoints);
      if (sampled.length === 0) return '  N/A';
      return sampled
        .map(
          (candle) =>
            `  - ${safeIsoTime(candle.time)} | Close $${formatNumber(candle.close, 0)} | ` +
            `Volume ${formatNumber(candle.volume, 2)} BTC`
        )
        .join('\n');
    };

    const cvdBlock = (seriesInput, label) => {
      const valid = getSeriesPoints(seriesInput).filter(
        (point) =>
          toFiniteNumber(point.cvd ?? point.cumulativeFromAnchor) !== null &&
          toFiniteNumber(point.price) !== null
      );
      if (valid.length === 0) {
        return `### ${label}\n- Summary: N/A\n- Sampled path: N/A`;
      }

      const firstPrice = toFiniteNumber(valid[0].price);
      const lastPrice = toFiniteNumber(valid[valid.length - 1].price);
      const priceChange =
        firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;
      const netDelta = getSeriesNetDelta(seriesInput) ?? valid.reduce((sum, p) => sum + (toFiniteNumber(p.delta) || 0), 0);
      const midpoint = Math.floor(valid.length / 2);
      const firstHalfDelta = valid
        .slice(0, midpoint)
        .reduce((sum, point) => sum + (toFiniteNumber(point.delta) || 0), 0);
      const secondHalfDelta = valid
        .slice(midpoint)
        .reduce((sum, point) => sum + (toFiniteNumber(point.delta) || 0), 0);
      const path = sampleSeries(valid, 10)
        .map(
          (point) =>
            `  - ${safeIsoTime(point.time)} | Price $${formatNumber(point.price, 0)} | ` +
            `Cumulative CVD ${formatSigned(point.cumulativeFromAnchor ?? point.cvd, 0, ' USD')}`
        )
        .join('\n');

      return `### ${label}
- Scope: Binance BTCUSDT klines; taker-buy quote volume minus taker-sell quote volume; stable UTC anchor (2020-01-01) cumulative series with independent window net delta.
- Price change across window: ${formatSigned(priceChange, 2, '%')}
- Window Net Taker Delta: ${formatSigned(netDelta, 0, ' USD')}
- First-half net taker delta: ${formatSigned(firstHalfDelta, 0, ' USD')}
- Second-half net taker delta: ${formatSigned(secondHalfDelta, 0, ' USD')}
- Sampled paired path (Cumulative from Anchor):
${path}`;
    };

    const compareCvdVenues = (futuresSeries, spotSeries, label) => {
      const futuresValue = getSeriesNetDelta(futuresSeries);
      const spotValue = getSeriesNetDelta(spotSeries);
      const agreement = futuresValue === null || spotValue === null
        ? 'N/A'
        : futuresValue === 0 || spotValue === 0
          ? 'Neutral / one venue is flat'
          : Math.sign(futuresValue) === Math.sign(spotValue)
            ? 'Aligned direction'
            : 'Divergent direction';
      return `- ${label} Futures Net CVD: ${formatSigned(futuresValue, 0, ' USD')}\n` +
        `- ${label} Spot Net CVD: ${formatSigned(spotValue, 0, ' USD')}\n` +
        `- Venue comparison: ${agreement}. Do not net, average, or treat the two venue values as interchangeable.`;
    };
    const wallQuality = (usdValue) => {
      const millions = (toFiniteNumber(usdValue) || 0) / 1e6;
      if (millions < 10) return 'Sub-10M / usually immaterial for BTC';
      if (millions < 30) return '10M-30M / weak tactical liquidity';
      if (millions < 50) return '30M-50M / medium';
      if (millions < 100) return '50M-100M / strong displayed wall';
      return '100M+ / extremely large displayed wall';
    };

    const formatWalls = (walls) => {
      if (!Array.isArray(walls) || walls.length === 0) return '  N/A';
      return walls.slice(0, 5).map((wall) => {
        const wallPrice = toFiniteNumber(wall.price);
        const usdValue = toFiniteNumber(wall.usdValue);
        const distancePct =
          priceNow > 0 && wallPrice !== null
            ? ((wallPrice - priceNow) / priceNow) * 100
            : null;
        const sources = Object.entries(wall.sources || {})
          .map(([name, value]) => `${name}: $${formatNumber((toFiniteNumber(value) || 0) / 1e6, 1)}M`)
          .join(', ');

        return (
          `  - $${formatNumber(wallPrice, 0)} | $${formatNumber((usdValue || 0) / 1e6, 2)}M | ` +
          `${formatSigned(distancePct, 2, '%')} from spot | ${wallQuality(usdValue)} | ` +
          `${formatNumber(wall.qty, 2)} BTC | Sources: ${sources || 'N/A'}`
        );
      }).join('\n');
    };

    const formatCotRow = (name, row) => {
      if (!row) return `  - ${name}: N/A`;
      return (
        `  - ${name}: Long ${row.long ?? 'N/A'} (${row.longChange ?? 'N/A'}), ` +
        `Short ${row.short ?? 'N/A'} (${row.shortChange ?? 'N/A'}), ` +
        `Spread ${row.spread ?? 'N/A'} (${row.spreadChange ?? 'N/A'}), ` +
        `Net ${row.net ?? 'N/A'} (${row.netChange ?? 'N/A'})`
      );
    };

    const cotStr = data.cotData
      ? `- Observation date: ${data.cotData.date || 'N/A'}
- Structural Regime: ${data.cotData.regime?.label || 'N/A'}
- Asset Manager COT Index (26W Percentile): ${data.cotData.analytics?.amCotIndex ?? data.cotData.cotIndex ?? 'N/A'}%
- Asset Manager 4-Week Net Momentum: ${data.cotData.analytics?.deltas?.am4W != null ? (data.cotData.analytics.deltas.am4W >= 0 ? '+' : '') + data.cotData.analytics.deltas.am4W + ' contracts' : 'N/A'}
- Leveraged Funds 4-Week Net Momentum: ${data.cotData.analytics?.deltas?.lf4W != null ? (data.cotData.analytics.deltas.lf4W >= 0 ? '+' : '') + data.cotData.analytics.deltas.lf4W + ' contracts' : 'N/A'}
${formatCotRow('Dealer Intermediary', data.cotData.dealerIntermediary)}
${formatCotRow('Asset Manager / Institutional', data.cotData.assetManager)}
${formatCotRow('Leveraged Funds', data.cotData.leveragedFunds)}
${formatCotRow('Other Reportables', data.cotData.otherReportables)}
${formatCotRow('Nonreportable Positions', data.cotData.nonReportable)}`
      : '- CME COT: N/A';

    const lsHistory24h = Array.isArray(data.lsHistory) ? data.lsHistory : [];
    const lsSampled = sampleSeries(lsHistory24h, 7);
    const lsFirst = toFiniteNumber(lsHistory24h[0]?.longShortRatio);
    const lsLast = toFiniteNumber(lsHistory24h[lsHistory24h.length - 1]?.longShortRatio);
    const lsChange = lsFirst !== null && lsLast !== null ? lsLast - lsFirst : null;
    const lsStr = lsSampled.length > 0
      ? lsSampled.map((row) => {
          const ratio = toFiniteNumber(row.longShortRatio);
          const longAccount = toFiniteNumber(row.longAccount);
          const shortAccount = toFiniteNumber(row.shortAccount);
          return (
            `  - ${safeIsoTime(row.timestamp)} | Ratio ${formatNumber(ratio, 3)} | ` +
            `Long ${longAccount === null ? 'N/A' : formatNumber(longAccount * 100, 1) + '%'} | ` +
            `Short ${shortAccount === null ? 'N/A' : formatNumber(shortAccount * 100, 1) + '%'}`
          );
        }).join('\n')
      : '  N/A';

    const oiHistory24h = Array.isArray(data.oiHistory) ? data.oiHistory : [];
    const oiSampled = sampleSeries(oiHistory24h, 7);
    const oiFirst = toFiniteNumber(oiHistory24h[0]?.sumOpenInterest);
    const oiLast = toFiniteNumber(oiHistory24h[oiHistory24h.length - 1]?.sumOpenInterest);
    const oiChangePct =
      oiFirst > 0 && oiLast !== null ? ((oiLast - oiFirst) / oiFirst) * 100 : null;
    const oiStr = oiSampled.length > 0
      ? oiSampled.map(
          (row) =>
            `  - ${safeIsoTime(row.timestamp)} | ${formatNumber(row.sumOpenInterest, 0)} BTC | ` +
            `$${formatNumber(row.sumOpenInterestValue, 0)} notional`
        ).join('\n')
      : '  N/A';

    const reportNow = new Date();
    const rawEtfFlows = Array.isArray(etfHistory)
      ? etfHistory
          .map((row) => ({ ...row, numericFlow: toFiniteNumber(row.flow) }))
          .filter((row) => row.numericFlow !== null)
      : [];
    const pendingEtfRows = rawEtfFlows.filter(
      (row) => !isCompletedEtfObservation(row.date, reportNow)
    );
    const etfFlows = rawEtfFlows
      .filter((row) => isCompletedEtfObservation(row.date, reportNow))
      .slice(-7)
      .map((row) => ({ ...row, numericFlow: toFiniteNumber(row.flow) }))
      .filter((row) => row.numericFlow !== null);
    const etfNetTotal = etfFlows.reduce((sum, row) => sum + row.numericFlow, 0);
    const etfPositiveDays = etfFlows.filter((row) => row.numericFlow > 0).length;
    const etfNegativeDays = etfFlows.filter((row) => row.numericFlow < 0).length;
    const etfFlowStr = etfFlows.length > 0
      ? etfFlows
          .map((row) => `  - ${row.date}: ${formatSigned(row.numericFlow, 1, 'M USD')}`)
          .join('\n')
      : '  N/A';
    const latestEtfDate = etfFlows[etfFlows.length - 1]?.date || null;
    const etfObservationAgeDays = ageInDays(latestEtfDate);
    const etfPublicationStatus = pendingEtfRows.length > 0
      ? `PENDING/UNKNOWN — ignored ${pendingEtfRows.length} provisional current/future-date row(s); these are not observed zero flows.`
      : 'PENDING/UNKNOWN for the report date — ETF flow is publication-lagged; use only the latest completed observation below.';
    const cotObservationAgeDays = ageInDays(data.cotData?.date);

    const fedRate = toFiniteNumber(data.fedFundsRate);
    const rawCpi = toFiniteNumber(data.cpi);
    const cpi = rawCpi !== null && rawCpi >= -20 && rawCpi <= 50 ? rawCpi : null;
    const cpiValidation =
      rawCpi !== null && cpi === null
        ? `REJECTED (${formatNumber(rawCpi, 2)} is not a plausible U.S. YoY inflation rate)`
        : 'Valid YoY percentage';
    const realRateProxy =
      fedRate !== null && cpi !== null ? fedRate - cpi : null;

    const price48h = priceStats(klines48h, '48 hours');
    const price7d = priceStats(klines7d, '7 days');
    const price30d = priceStats(klines30d, '30 days');
    const price90d = priceStats(klines90d, '90 days');
    const price1y = priceStats(klines1y, '1 year');

    const productionCost = data.onChain?.productionCost;
    const productionCostStr = productionCost
      ? `$${formatNumber(productionCost.low, 0)} - $${formatNumber(productionCost.high, 0)} ` +
        `(mid $${formatNumber(productionCost.mid, 0)}; model estimate using fixed power/efficiency assumptions)`
      : 'N/A';

    const coverageGroups = {
      Macro: [
        data.netLiquidity,
        data.fedFundsRate,
        data.tenYearYield,
        data.dxy,
        data.vix?.price,
        data.highYield,
        cpi,
        data.unrate,
        data.sp500?.price,
        data.qqq?.price,
        data.m2Supply,
      ],
      Onchain: [
        data.onChain?.hashRate,
        data.onChain?.difficulty,
        data.onChainMetrics?.mvrv,
        data.onChainMetrics?.activeAddresses,
        data.ethOnChainMetrics?.mvrv,
      ],
      Flows: [
        etfFlows.length > 0 ? etfNetTotal : null,
        data.cotData?.date,
      ],
      Microstructure: [
        data.fundingRate,
        data.openInterest,
        lsLast,
        cvd,
        orderBook?.obiPercent,
        whaleWalls?.bidRatio,
      ],
    };

    const coverageStr = Object.entries(coverageGroups)
      .map(([name, values]) => {
        const available = values.filter((value) => {
          if (typeof value === 'number') return Number.isFinite(value);
          return value !== null && value !== undefined && value !== '' && value !== 'N/A';
        }).length;
        return `${name} ${available}/${values.length}`;
      })
      .join(' | ');

    // A report is only useful when every required evidence bucket is present.
    // Keep this independent from prompt formatting so a literal "N/A" can
    // never quietly reach the model as if it were evidence.
    const missingData = [];
    const hasValue = (value) => {
      if (typeof value === 'number') return Number.isFinite(value);
      if (typeof value === 'string') return value.trim() !== '' && value.trim().toUpperCase() !== 'N/A';
      return value !== null && value !== undefined;
    };
    const requireValue = (label, value) => {
      if (!hasValue(value)) missingData.push(label);
    };
    const requireSeries = (label, series, minimum = 1) => {
      if (!Array.isArray(series) || series.length < minimum) missingData.push(label);
    };

    [
      ['BTC spot price', priceNow],
      ['US Net Liquidity', data.netLiquidity],
      ['Fed Funds rate', fedRate],
      ['CPI YoY', cpi],
      ['US 10Y Yield', data.tenYearYield],
      ['DXY', data.dxy],
      ['VIX', data.vix?.price],
      ['High-yield spread', data.highYield],
      ['US unemployment', data.unrate],
      ['S&P 500', data.sp500?.price],
      ['Nasdaq / QQQ', data.qqq?.price],
      ['BTC MVRV', data.onChainMetrics?.mvrv],
      ['BTC hashrate', data.onChain?.hashRate],
      ['BTC difficulty', data.onChain?.difficulty],
      ['ETF holdings', etfHoldings?.total],
      ['CME COT date', data.cotData?.date],
      ['CME COT asset-manager positions', data.cotData?.assetManager?.net],
      ['CME COT leveraged-fund positions', data.cotData?.leveragedFunds?.net],
      ['Funding rate', data.fundingRate],
      ['Open interest', data.openInterest],
      ['Long/short ratio', lsLast],
      ['Realtime Futures CVD', cvd],
      ['Realtime Spot CVD', spotCvd],
      ['Order-book imbalance', orderBook?.obiPercent],
      ['Whale-wall bid ratio', whaleWalls?.bidRatio],
    ].forEach(([label, value]) => requireValue(label, value));

    requireSeries('48h BTC price candles', klines48h, 2);
    requireSeries('7d BTC price candles', klines7d, 2);
    requireSeries('30d BTC price candles', klines30d, 2);
    requireSeries('90d BTC price candles', klines90d, 2);
    requireSeries('1y BTC price candles', klines1y, 2);
    requireSeries('ETF flow history', etfFlows, 1);
    requireSeries('Futures CVD 7d', activeCvd7d, 2);
    requireSeries('Futures CVD 30d', activeCvd30d, 2);
    requireSeries('Spot CVD 7d', activeSpotCvd7d, 2);
    requireSeries('Spot CVD 30d', activeSpotCvd30d, 2);
    requireSeries('Recent news', activeNews, 1);
    requireSeries('Economic-calendar events', calendarRes?.allEvents, 1);

    const formatNews = (items) => {
      if (!Array.isArray(items) || items.length === 0) return '- N/A';
      return items.slice(0, 15).map((item) => {
        let source = 'Unknown source';
        try {
          source = item.link ? new URL(item.link).hostname.replace(/^www\./, '') : source;
        } catch {
          source = 'Unknown source';
        }
        const snippet = item.snippet
          ? ` | Snippet: ${String(item.snippet).replace(/\s+/g, ' ').slice(0, 220)}`
          : '';
        return (
          `- [${item.timeStr || safeIsoTime(item.time)}] ${item.title || 'Untitled'} | ` +
          `Tag: ${item.tag || 'N/A'} | Source: ${source}${snippet}`
        );
      }).join('\n');
    };

    const formatFundingHistory = (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return '  N/A';
      return rows.slice(-9).map((row) => {
        const rate = toFiniteNumber(row.fundingRate);
        const annualized = rate === null ? 'N/A' : formatSigned(rate * 3 * 365 * 100, 2, '%');
        return (
          `  - ${safeIsoTime(row.fundingTime)} | ${rate === null ? 'N/A' : formatSigned(rate * 100, 4, '%')}/8h | ` +
          `Annualized ${annualized}`
        );
      }).join('\n');
    };

    const formatLiqWindow = (label, stats) => {
      if (!stats) return `- ${label}: N/A`;
      return (
        `- ${label}: Long liquidated ${formatSigned(stats.longLiqUsd, 0, ' USD')} (${stats.longLiqCount ?? 'N/A'} events) | ` +
        `Short liquidated ${formatSigned(stats.shortLiqUsd, 0, ' USD')} (${stats.shortLiqCount ?? 'N/A'} events) | ` +
        `Net ${formatSigned(stats.netLiqDelta, 0, ' USD')} | Dashboard dominance label: ${stats.dominanceLabel || 'N/A'}`
      );
    };

    const liqEventStr = (() => {
      if (!Array.isArray(liquidations) || liquidations.length === 0) return '  N/A';
      return [...liquidations]
        .sort((a, b) => (toFiniteNumber(b.usdValue) || 0) - (toFiniteNumber(a.usdValue) || 0))
        .slice(0, 5)
        .map((event) => {
          const usd = toFiniteNumber(event.usdValue);
          const price = toFiniteNumber(event.price);
          return (
            `  - ${safeIsoTime(event.timestamp)} | ${event.positionSide || 'N/A'} liquidated | ` +
            `$${formatNumber(usd, 0)} | Price $${formatNumber(price, 0)} | ${formatNumber(event.qty, 3)} BTC`
          );
        })
        .join('\n');
    })();

    const optionsStr = (() => {
      if (!optionsAnalysis) return '- Deribit BTC options: N/A';
      const { callWall, putWall, maxPain, pcr, gammaRegime, gexFlipPrice, strikeDistribution, meta } = optionsAnalysis;
      const topStrikes = Array.isArray(strikeDistribution)
        ? [...strikeDistribution]
            .sort((a, b) => ((toFiniteNumber(b.callOI) || 0) + (toFiniteNumber(b.putOI) || 0)) - ((toFiniteNumber(a.callOI) || 0) + (toFiniteNumber(a.putOI) || 0)))
            .slice(0, 8)
        : [];
      const strikeLines = topStrikes.length > 0
        ? topStrikes
            .map((row) => `  - Strike $${formatNumber(row.strike, 0)} | Call OI ${formatNumber(row.callOI, 0)} | Put OI ${formatNumber(row.putOI, 0)}`)
            .join('\n')
        : '  N/A';
      return (
        `- Underlying spot used: ${meta?.underlyingPrice != null ? '$' + formatNumber(meta.underlyingPrice, 0) : 'N/A'} | Instruments: ${meta?.instrumentCount ?? 'N/A'}\n` +
        `- Call Wall: ${callWall ? '$' + formatNumber(callWall.strike, 0) + ' (' + formatNumber(callWall.oi, 0) + ' OI)' : 'N/A'}\n` +
        `- Put Wall: ${putWall ? '$' + formatNumber(putWall.strike, 0) + ' (' + formatNumber(putWall.oi, 0) + ' OI)' : 'N/A'}\n` +
        `- Max Pain: ${maxPain ? '$' + formatNumber(maxPain.maxPainPrice, 0) : 'N/A'}\n` +
        `- Put/Call OI Ratio: ${pcr ? formatNumber(pcr.pcr, 2) : 'N/A'} | Total Call OI ${pcr ? formatNumber(pcr.totalCallOI, 0) : 'N/A'} | Total Put OI ${pcr ? formatNumber(pcr.totalPutOI, 0) : 'N/A'}\n` +
        `- GEX regime: ${gammaRegime?.regime || 'N/A'} (${gammaRegime?.description || 'N/A'}) | Net GEX at spot: ${gammaRegime?.netGexAtPrice != null ? formatNumber(gammaRegime.netGexAtPrice, 0) : 'N/A'} | GEX flip level: ${gexFlipPrice != null ? '$' + formatNumber(gexFlipPrice, 0) : 'N/A'}\n` +
        `- Provenance: dealer-positioning model assumption, not observed dealer books (dashboard-derived estimate).\n` +
        `- Top strikes by total OI:\n${strikeLines}`
      );
    })();

    const promptData = `
# MARKET ANALYSIS INPUT

## 0. SNAPSHOT, COVERAGE & PROVENANCE
- Report generated at: ${new Date().toISOString()}
- Dashboard last successful sync/fetch: ${safeIsoTime(lastSync)}
- Coverage summary: ${coverageStr}
- BTC spot/klines, funding, OI, global L/S accounts, and historical CVD venue: Binance BTCUSDT.
- OBI and whale-wall scope: multi-exchange aggregation returned by the dashboard; composition is shown where available.
- Macro observations may have publication lag. The dashboard currently supplies values but not every source observation date.
- ETF history below contains only the latest seven completed observations strictly before the report's local calendar date. Same-day/future rows are provisional and excluded.
- ETF holdings snapshot date is not supplied; freshness is unknown.
- News is headline/snippet input, not independently verified full-text reporting.
- Historical CVD is cumulative taker delta rebased at the start of each requested window. Cross-window absolute levels are not comparable.
- BTC/ETH NUPL shown below is algebraically derived from MVRV by the dashboard. Supply in Profit is also a model estimate from MVRV. These are dependent signals and must not be triple-counted.
- Order-book liquidity can be cancelled or spoofed. Treat walls as conditional, not guaranteed.

## 1. MACRO & CROSS-ASSET
- US Net Liquidity: ${data.netLiquidity !== null && data.netLiquidity !== undefined ? '$' + formatNumber(data.netLiquidity, 2) + 'B' : 'N/A'}
- Fed Funds Rate: ${fedRate === null ? 'N/A' : formatNumber(fedRate, 2) + '%'}
- Headline CPI inflation (YoY, FRED CPIAUCSL transformed with pc1): ${cpi === null ? 'N/A' : formatNumber(cpi, 2) + '%'}
- CPI unit validation: ${cpiValidation}
- Derived ex-post real-rate proxy (Fed Funds - CPI): ${realRateProxy === null ? 'N/A' : formatSigned(realRateProxy, 2, '%')}
- US 10Y Yield: ${toFiniteNumber(data.tenYearYield) === null ? 'N/A' : formatNumber(data.tenYearYield, 2) + '%'}
- DXY: ${formatNumber(data.dxy, 2)}
- VIX: ${formatNumber(data.vix?.price, 2)}
- US High-Yield Spread: ${toFiniteNumber(data.highYield) === null ? 'N/A' : formatNumber(data.highYield, 2) + '%'}
- US Unemployment: ${toFiniteNumber(data.unrate) === null ? 'N/A' : formatNumber(data.unrate, 2) + '%'}
- S&P 500: ${formatNumber(data.sp500?.price, 2)} | Change: ${formatSigned(data.sp500?.changePercent, 2, '%')}
- Nasdaq proxy / QQQ: ${formatNumber(data.qqq?.price, 2)} | Change: ${formatSigned(data.qqq?.changePercent, 2, '%')}
- M2 Supply: ${data.m2Supply !== null && data.m2Supply !== undefined ? '$' + formatNumber(data.m2Supply, 2) + 'B' : 'N/A'}
- Crypto Fear & Greed: ${data.fngData?.value ?? 'N/A'} (${data.fngData?.sentiment || 'N/A'})

### HIGH-IMPACT ECONOMIC CALENDAR EVENTS (ForexFactory / FairEconomy)
${(() => {
  const events = calendarRes?.allEvents || [];
  const highImpact = events.filter((e) => e.country === 'USD' || e.impact === 'High' || e.impact === 'Medium').slice(0, 8);
  if (highImpact.length === 0) return '- High-Impact Events: N/A';
  return highImpact
    .map(
      (e) =>
        `- ${e.dateStr || ''} ${e.timeStr || ''} | ${e.country} | ${e.title} (${e.titleVN || ''}) | ` +
        `Actual: ${e.actual || 'TBD'} | Forecast: ${e.forecast || 'N/A'} | Prev: ${e.previous || 'N/A'} | Impact: ${e.impact}`
    )
    .join('\n');
})().trim()}

## 2. BTC PRICE STRUCTURE & CRYPTO BREADTH
- BTC spot: ${priceNow === null ? 'N/A' : '$' + formatNumber(priceNow, 2)}
- BTC 24h change: ${formatSigned(data.btc?.change, 2, '%')}
- BTC 24h high / low: $${formatNumber(data.btc?.high, 0)} / $${formatNumber(data.btc?.low, 0)}
- BTC 24h quote volume: ${toFiniteNumber(data.btc?.volume) === null ? 'N/A' : '$' + formatNumber(data.btc.volume / 1e9, 2) + 'B'}
${price48h.text}
${price7d.text}
${price30d.text}
${price90d.text}
${price1y.text}

### Sampled 48h BTC Path
${pricePath(klines48h, 12)}

### Sampled 7d BTC Path
${pricePath(klines7d, 12)}

- ETH: $${formatNumber(data.ethPrice?.price, 2)} | 24h ${formatSigned(data.ethPrice?.change, 2, '%')}
- SOL: $${formatNumber(data.solPrice?.price, 2)} | 24h ${formatSigned(data.solPrice?.change, 2, '%')}
- BTC Dominance: ${toFiniteNumber(data.globalData?.btcDominance) === null ? 'N/A' : formatNumber(data.globalData.btcDominance, 1) + '%'}
- ETH Dominance: ${toFiniteNumber(data.globalData?.ethDominance) === null ? 'N/A' : formatNumber(data.globalData.ethDominance, 1) + '%'}
- Total Crypto Market Cap: ${toFiniteNumber(data.globalData?.totalMarketCap) === null ? 'N/A' : '$' + formatNumber(data.globalData.totalMarketCap / 1e9, 1) + 'B'}

## 3. ON-CHAIN, NETWORK & STABLECOINS
- BTC CoinMetrics observation date: ${data.onChainMetrics?.date || 'N/A'}
- BTC MVRV: ${data.onChainMetrics?.mvrv || 'N/A'}
- BTC NUPL: ${btcNupl || 'N/A'} | Provenance: derived from MVRV, not independent.
- BTC Supply in Profit: ${btcSupplyProfit || 'N/A'} | Provenance: model-estimated from MVRV, not independent.
- BTC Active Addresses: ${data.onChainMetrics?.activeAddresses || 'N/A'}
- BTC Transactions: ${data.onChainMetrics?.txCount || data.onChain?.txCount24h || 'N/A'}
- BTC Hashrate: ${data.onChain?.hashRate || 'N/A'} EH/s
- BTC Difficulty: ${data.onChain?.difficulty || 'N/A'}T
- BTC Production Cost Range: ${productionCostStr}
- ETH CoinMetrics observation date: ${data.ethOnChainMetrics?.date || 'N/A'}
- ETH MVRV: ${data.ethOnChainMetrics?.mvrv || 'N/A'}
- ETH NUPL: ${ethNupl || 'N/A'} | Provenance: derived from MVRV, not independent.
- ETH Supply in Profit: ${ethSupplyProfit || 'N/A'} | Provenance: model-estimated from MVRV, not independent.
- ETH Active Addresses: ${data.ethOnChainMetrics?.activeAddresses || 'N/A'}
- ETH Transactions: ${data.ethOnChainMetrics?.txCount || 'N/A'}
- USDT Market Cap: ${toFiniteNumber(data.stablecoins?.usdt) === null ? 'N/A' : '$' + formatNumber(data.stablecoins.usdt / 1e9, 2) + 'B'}
- USDC Market Cap: ${toFiniteNumber(data.stablecoins?.usdc) === null ? 'N/A' : '$' + formatNumber(data.stablecoins.usdc / 1e9, 2) + 'B'}
- Combined USDT + USDC Market Cap: ${toFiniteNumber(data.stablecoins?.total) === null ? 'N/A' : '$' + formatNumber(data.stablecoins.total / 1e9, 2) + 'B'}
- Stablecoin exchange reserves and transfer activity: N/A

## 4. INSTITUTIONAL FLOWS & CME POSITIONING
- Total BTC ETF Holdings: ${etfHoldings?.total ? etfHoldings.total.toLocaleString('en-US') + ' BTC' : 'N/A'}
- Approximate ETF Holdings Value at current BTC spot: ${
      etfHoldings?.total && priceNow
        ? '$' + formatNumber((etfHoldings.total * priceNow) / 1e9, 2) + 'B'
        : 'N/A'
    }
- Seven-observation ETF Net Flow: ${etfFlows.length > 0 ? formatSigned(etfNetTotal, 1, 'M USD') : 'N/A'}
- Positive / negative observations: ${etfFlows.length > 0 ? etfPositiveDays + ' / ' + etfNegativeDays : 'N/A'}
- Latest ETF observation date / age: ${latestEtfDate || 'N/A'} / ${etfObservationAgeDays === null ? 'N/A' : etfObservationAgeDays + ' days'}
- ETF flow status for report date: ${etfPublicationStatus}
${etfFlowStr}

### CME COT Futures Only
${cotStr}
- CME COT open interest: ${data.cotData?.openInterest ?? 'N/A'}
- COT observation age at report time: ${cotObservationAgeDays === null ? 'N/A' : cotObservationAgeDays + ' days'}
- COT release caveat: Friday release reflects Tuesday positions, approximately 3-7 days lagged.
- COT Strategic Synthesis: ${data.cotData?.narrative?.overview || 'N/A'} (dashboard heuristic — verify independently)

## 5. DERIVATIVES
- BTC 24h price change input for price/OI matrix: ${formatSigned(data.btc?.change, 2, '%')}
- Current Funding Rate: ${toFiniteNumber(data.fundingRate) === null ? 'N/A' : formatSigned(data.fundingRate * 100, 4, '%')}
- Funding settlements — Binance BTCUSDT, last 9 (8h intervals):
${formatFundingHistory(fundingSettlements)}
- Current Open Interest: ${toFiniteNumber(data.openInterest) === null ? 'N/A' : formatNumber(data.openInterest, 0) + ' BTC'}
- OI change across supplied history: ${formatSigned(oiChangePct, 2, '%')}
- OI history:
${oiStr}
- Current Global Long/Short Account Ratio: ${formatNumber(lsLast, 3)}
- Change in L/S ratio across supplied history: ${formatSigned(lsChange, 3)}
- L/S account history:
${lsStr}
- Intraday CVD — Binance Futures: ${formatSigned(cvd, 0, ' USD')}
- Intraday CVD — Binance Spot: ${formatSigned(spotCvd, 0, ' USD')}
- Intraday taker buy volume — Binance Futures: ${formatNumber(buyVolume, 0)} USD
- Intraday taker sell volume — Binance Futures: ${formatNumber(sellVolume, 0)} USD
- Venue labels: Binance Spot and Binance Futures CVD are separate measurements, shown above and in Section 6.

### LIQUIDATIONS (BINANCE BTCUSDT WEBSOCKET)
- Coverage: rolling session window captured by the dashboard WebSocket; single-venue, not full-market history.
${formatLiqWindow('Last 5 minutes', liqStats5m)}
${formatLiqWindow('Last 1 hour', liqStats1h)}
- Largest recent liquidation events by USD:
${liqEventStr}

### DERIBIT BTC OPTIONS (ALL EXPIRIES)
${optionsStr}

## 6. HISTORICAL PRICE / CVD
${cvdBlock(activeCvd7d, '7-Day Binance Futures CVD / Price (4h)')}

${cvdBlock(activeCvd30d, '30-Day Binance Futures CVD / Price (1d)')}

${cvdBlock(activeSpotCvd7d, '7-Day Binance Spot CVD / Price (4h)')}

${cvdBlock(activeSpotCvd30d, '30-Day Binance Spot CVD / Price (1d)')}

### CVD VENUE COMPARISON (MANDATORY)
${compareCvdVenues(activeCvd7d, activeSpotCvd7d, '7-day / 4h')}
${compareCvdVenues(activeCvd30d, activeSpotCvd30d, '30-day / 1d')}

## 7. DISPLAYED LIQUIDITY & ORDER BOOK
- Aggregated OBI: ${orderBook?.obiPercent !== undefined ? formatSigned(orderBook.obiPercent, 2, '%') : 'N/A'}
- Dashboard OBI label: ${orderBook?.signal || 'N/A'} (dashboard heuristic — verify independently)
- OBI exchange breakdown:
${orderBook?.exchanges?.length
  ? orderBook.exchanges.map((exchange) => `  - ${exchange.name}: ${formatSigned(exchange.obi, 2, '%')}`).join('\n')
  : '  N/A'}
- Whale bid share: ${whaleWalls?.bidRatio !== undefined ? formatNumber(whaleWalls.bidRatio * 100, 1) + '%' : 'N/A'}
- Dashboard whale-wall label: ${whaleWalls?.signal || 'N/A'} (dashboard heuristic — verify independently)

### Largest Displayed Bid Walls
${formatWalls(whaleWalls?.whaleBids)}

### Largest Displayed Ask Walls
${formatWalls(whaleWalls?.whaleAsks)}

## 8. LATEST HEADLINES & EVENT RISK
${formatNews(activeNews)}

## 9. USER INTENDED BIAS & AUDIT REQUEST
- User Selected Bias: **${selectedUserBias === 'none' ? 'NONE (Objective Evaluation)' : selectedUserBias.toUpperCase()}**
${selectedUserBias !== 'none' ? '' : '- Note: User selected Objective Evaluation (No specific bias).'}

${await (async () => {
  try {
    const [fRes, multiFunding] = await Promise.all([
      fetchAndEnrichForensics(),
      getMultiExchangeFunding('BTCUSDT').catch(() => null),
    ]);
    const basisPct = toFiniteNumber(
      multiFunding?.avgBasisPct
      ?? multiFunding?.exchanges?.find((e) => toFiniteNumber(e?.basisPct) !== null)?.basisPct
    );
    return formatForensicsPayloadForAi(fRes.enr24h, fRes.enr7d, fRes.enrH4, {
      k15m: fRes.k15m,
      k1h: fRes.k1h,
      k4h: fRes.k4h,
      currentPrice: priceNow,
      lsRatio: lsLast,
      fundingRate: toFiniteNumber(data.fundingRate),
      basisPct,
      oiChangePct,
    });
  } catch (err) {
    console.warn('Failed to embed forensics payload:', err);
    return '';
  }
})()}
`;

    const systemPrompt = getSystemPrompt(selectedStyle, selectedLang, selectedUserBias);
    return { promptData, systemPrompt, missingData };
  };

  const [isExporting, setIsExporting] = useState(false);

  const exportDataForAi = async () => {
    setIsExporting(true);
    try {
      const { promptData, systemPrompt } = await preparePromptAndData();
      const langNote = isVi ? 'Tiếng Việt' : 'English';

      const markdownContent = isVi
        ? `# Yêu cầu phân tích thị trường AI

File này chứa dữ liệu thị trường hiện tại và hướng dẫn phân tích (system prompt). Bạn có thể tải/copy sang ChatGPT, Claude, Gemini hoặc AI khác.

**Ngôn ngữ báo cáo mong muốn:** ${langNote}

---

## 1. System Prompt (Hướng dẫn phân tích)

\`\`\`markdown
${systemPrompt}
\`\`\`

## 2. Market Data (Dữ liệu đầu vào)

\`\`\`markdown
${promptData}
\`\`\`
`
        : `# AI Market Analysis Request

This file contains the current market data and analysis instructions. You can upload or copy this content to ChatGPT, Claude, Gemini, or any other AI model for a professional market analysis.

**Report language:** ${langNote}

---

## 1. System Prompt (Analysis Instructions)

\`\`\`markdown
${systemPrompt}
\`\`\`

## 2. Market Data (Input Data)

\`\`\`markdown
${promptData}
\`\`\`
`;

      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.href = url;
      link.setAttribute(
        'download',
        `crypto_market_data_for_ai_${selectedLang}_${dateStr}_${timeStr}.md`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exporting data:', e);
      alert((isVi ? 'Xuất dữ liệu thất bại: ' : 'Failed to export data: ') + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  const prepareVerifiedReportData = async () => {
    const prepared = await preparePromptAndData();
    if (prepared.missingData.length === 0) return prepared;

    const title = isVi
      ? 'Chưa thể tạo báo cáo AI vì dữ liệu bắt buộc còn thiếu:'
      : 'The AI report cannot be created because required data is still missing:';
    alert(`${title}\n\n• ${prepared.missingData.join('\n• ')}\n\n${isVi
      ? 'Hãy đồng bộ lại và chờ các nguồn này có dữ liệu, rồi thử lại.'
      : 'Sync again and wait for these sources to return data, then try again.'}`);
    return null;
  };

  const generateReport = async () => {
    if (aiProvider === 'openrouter') {
      const openrouterKey = apiKeys?.openrouter?.trim();
      if (!openrouterKey) {
        alert(
          isVi
            ? 'Vui lòng nhập OpenRouter API Key trong phần API Settings (⚙️ Cài đặt)!'
            : 'Please enter your OpenRouter API Key in API Settings (⚙️ Settings)!'
        );
        return;
      }

      setIsAiLoading(true);
      setAiSummary('');

      try {
        const prepared = await prepareVerifiedReportData();
        if (!prepared) return;
        const { promptData, systemPrompt } = prepared;
        const genConfig = getGenerationConfig(selectedStyle);

        await streamOpenRouterCompletion({
          apiKey: openrouterKey,
          model: selectedOpenRouterModel,
          systemPrompt,
          userPrompt: promptData,
          generationConfig: genConfig,
          onChunk: (accumulatedText) => {
            const cleaned = cleanLatex(accumulatedText);
            setAiSummary(cleaned);
          },
        });

        const activeModelInfo = openrouterModels.find((m) => m.id === selectedOpenRouterModel);
        const modelLabel = activeModelInfo ? activeModelInfo.name : selectedOpenRouterModel;
        const footer = isVi
          ? `\n\n---\n*Báo cáo tạo bởi OpenRouter Model: **${modelLabel}** · Ngôn ngữ: Tiếng Việt*`
          : `\n\n---\n*Report generated by OpenRouter Model: **${modelLabel}** · Language: English*`;
        setAiSummary((prev) => prev + footer);
      } catch (err) {
        console.error('[AI] OpenRouter generation failed:', err);
        let msg = err.message || '';
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid api key')) {
          msg = isVi
            ? 'API Key OpenRouter không hợp lệ hoặc hết hạn. Vui lòng kiểm tra lại trong ⚙️ Cài đặt.'
            : 'Invalid or expired OpenRouter API Key. Please verify in ⚙️ Settings.';
        }
        setAiSummary((prev) => prev + `\n\n**[Lỗi OpenRouter: ${msg}]**`);
      } finally {
        setIsAiLoading(false);
      }
      return;
    }

    const geminiKey = apiKeys?.gemini?.trim();

    if (!geminiKey) {
      alert(
        isVi
          ? 'Vui lòng nhập Gemini API Key trong phần API Settings!'
          : 'Please enter your Gemini API Key in the API Settings!'
      );
      return;
    }

    setIsAiLoading(true);
    setAiSummary('');

    // Determine candidate models and order of attempts
    const allModels = [
      'gemma-4-31b-it',
      'gemma-4-26b-a4b-it',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
    ];
    const modelAttempts = [
      selectedModel,
      ...allModels.filter((m) => m !== selectedModel),
    ];

    let success = false;
    let finalError = null;
    let actualModelUsed = selectedModel;

    try {
      const prepared = await prepareVerifiedReportData();
      if (!prepared) return;
      const { promptData, systemPrompt } = prepared;

      for (let attempt = 0; attempt < modelAttempts.length; attempt++) {
        const model = modelAttempts[attempt];
        actualModelUsed = model;

        const fallbackPrefix = isVi
          ? `*Đang tự động chuyển sang model dự phòng: **${model}** do model trước lỗi...*\n\n`
          : `*Automatically falling back to backup model: **${model}** due to previous model error...*\n\n`;

        if (attempt > 0) {
          setAiSummary(fallbackPrefix);
        } else {
          setAiSummary('');
        }

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${geminiKey}`;
          const headers = {
            'Content-Type': 'application/json',
          };

          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              system_instruction: {
                parts: { text: systemPrompt },
              },
              contents: [{ role: 'user', parts: [{ text: promptData }] }],
              generationConfig: getGenerationConfig(selectedStyle),
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || `HTTP status ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let currentText = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split(/\r?\n|\r/);
            buffer = lines.pop() || '';

            for (const line of lines) {
              const cleaned = line.trim();
              if (!cleaned) continue;
              if (cleaned.startsWith('data: ')) {
                const dataStr = cleaned.slice(6).trim();
                if (!dataStr) continue;

                let parsed = null;
                try {
                  parsed = JSON.parse(dataStr);
                } catch {
                  continue;
                }

                if (parsed.error) {
                  throw new Error(parsed.error.message || JSON.stringify(parsed.error));
                }
                const choice = parsed.candidates?.[0];
                if (choice) {
                  const text = choice.content?.parts?.[0]?.text || '';
                  if (text) {
                    currentText += text;
                    setAiSummary((attempt > 0 ? fallbackPrefix : '') + cleanLatex(currentText));
                  }
                  if (choice.finishReason && choice.finishReason !== 'STOP') {
                    if (choice.finishReason === 'SAFETY') {
                      currentText += isVi
                        ? '\n\n**[Báo cáo dừng do bộ lọc an toàn AI]**'
                        : '\n\n**[Report stopped due to AI Safety Filter]**';
                    } else if (choice.finishReason === 'MAX_TOKENS') {
                      currentText += isVi
                        ? '\n\n**[Báo cáo dừng: đã đạt giới hạn token đầu ra]**'
                        : '\n\n**[Report stopped: Max Output Tokens limit reached]**';
                    } else {
                      currentText += isVi
                        ? `\n\n**[Báo cáo dừng sớm. Lý do: ${choice.finishReason}]**`
                        : `\n\n**[Report stopped early. Reason: ${choice.finishReason}]**`;
                    }
                    setAiSummary((attempt > 0 ? fallbackPrefix : '') + cleanLatex(currentText));
                  }
                }
              }
            }
          }

          success = true;
          break; // Break the outer loop because this attempt succeeded
        } catch (err) {
          console.error(`[AI] Attempt ${attempt + 1} (${model}) failed:`, err);
          finalError = err;
          // Continue to next model in modelAttempts
        }
      }

      if (success) {
        const footer = isVi
          ? `\n\n---\n*Báo cáo tạo bởi model: **${actualModelUsed}** (Gemini API) · Ngôn ngữ: Tiếng Việt*`
          : `\n\n---\n*Report generated by model: **${actualModelUsed}** (Gemini API) · Language: English*`;
        setAiSummary((prev) => prev + footer);
      } else {
        throw finalError || new Error('All models failed to generate content');
      }
    } catch (err) {
      console.error('[AI] All attempts failed:', err);
      let friendlyError = err.message || '';
      if (
        friendlyError.includes('429') ||
        friendlyError.toLowerCase().includes('quota') ||
        friendlyError.toLowerCase().includes('rate limit') ||
        friendlyError.toLowerCase().includes('exhausted')
      ) {
        friendlyError = isVi
          ? `Rate limit hoặc hết hạn mức API.\n\n**Hướng khắc phục:** Kiểm tra hạn mức trên Google AI Studio hoặc thử lại sau.`
          : `Rate limit or API quota exhausted.\n\n**Fix:** Check your quota on Google AI Studio or try again later.`;
      }
      setAiSummary(
        (prev) =>
          prev +
          (isVi ? '\n\n**Lỗi tạo báo cáo sau khi thử tất cả các model:** ' : '\n\n**Error generating report after trying all models:** ') +
          friendlyError
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="summary-tab-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Separate Trade Plan Auditor Widget ── */}
      {!isAuditorHidden && (
        <TradePlanAuditor
          data={data}
          cvd={cvd}
          buyVolume={buyVolume}
          sellVolume={sellVolume}
          apiKeys={apiKeys}
          aiProvider={aiProvider}
          selectedModel={selectedModel}
          selectedOpenRouterModel={selectedOpenRouterModel}
          openrouterModels={openrouterModels}
          isVi={isVi}
          lastSync={lastSync}
          moduleId="dash_trade_auditor"
        />
      )}

      {/* ── AI Market Decision Lab Main Panel ── */}
      {!isSummaryHidden && (
        <div className="summary-tab glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 className="panel-title font-mono text-emerald" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Sparkles size={18} /> AI MARKET DECISION LAB
        </h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Language Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
              {isVi ? 'NGÔN NGỮ:' : 'LANG:'}
            </span>
            <select
              value={selectedLang}
              onChange={(e) => handleLangChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              title={isVi ? 'Ngôn ngữ báo cáo AI' : 'AI report language'}
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Style Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
              {isVi ? 'PHONG CÁCH:' : 'STYLE:'}
            </span>
            <select
              value={selectedStyle}
              onChange={(e) => handleStyleChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="compact">{styleLabels.compact}</option>
              <option value="professional">{styleLabels.professional}</option>
              <option value="forensics">{styleLabels.forensics}</option>
            </select>
          </div>

          {/* User Bias Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
              {isVi ? 'BIAS CỦA BẠN:' : 'YOUR BIAS:'}
            </span>
            <select
              value={selectedUserBias}
              onChange={(e) => handleUserBiasChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="font-mono"
              style={{
                background:
                  selectedUserBias === 'long'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : selectedUserBias === 'short'
                    ? 'rgba(244, 63, 94, 0.15)'
                    : 'var(--bg-slate-900)',
                border:
                  selectedUserBias === 'long'
                    ? '1px solid var(--color-emerald-500)'
                    : selectedUserBias === 'short'
                    ? '1px solid var(--color-rose-500)'
                    : '1px solid var(--border-panel)',
                color:
                  selectedUserBias === 'long'
                    ? 'var(--color-emerald-400)'
                    : selectedUserBias === 'short'
                    ? 'var(--color-rose-400)'
                    : 'var(--text-slate-300)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
                fontWeight: selectedUserBias !== 'none' ? 700 : 400,
              }}
            >
              <option value="none">{isVi ? 'Khách quan (Không bias)' : 'Objective (No bias)'}</option>
              <option value="long">🟢 LONG (Kỳ vọng Tăng)</option>
              <option value="short">🔴 SHORT (Kỳ vọng Giảm)</option>
            </select>
          </div>

          {/* AI Provider Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>PROVIDER:</span>
            <select
              value={aiProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="gemini">Google Gemini API</option>
              <option value="openrouter">OpenRouter (Free Models)</option>
            </select>
          </div>

          {/* Model Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>MODEL:</span>
            {aiProvider === 'openrouter' ? (
              <select
                value={selectedOpenRouterModel}
                onChange={(e) => handleOpenRouterModelChange(e.target.value)}
                disabled={isAiLoading || isExporting || isOpenrouterLoading}
                className="text-slate-300 font-mono"
                style={{
                  background: 'var(--bg-slate-900)',
                  border: '1px solid var(--border-panel)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  outline: 'none',
                  cursor: 'pointer',
                  maxWidth: '220px',
                }}
              >
                {openrouterModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={isAiLoading || isExporting}
                className="text-slate-300 font-mono"
                style={{
                  background: 'var(--bg-slate-900)',
                  border: '1px solid var(--border-panel)',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="gemma-4-31b-it">Gemma 4 31B IT ({isVi ? 'Khuyên dùng' : 'Recommended'})</option>
                <option value="gemma-4-26b-a4b-it">Gemma 4 26B A4B IT ({isVi ? 'Siêu tốc' : 'Speed'})</option>
                <option value="gemini-flash-lite-latest">Gemini Flash Lite (Latest)</option>
                <option value="gemini-flash-latest">Gemini Flash (Latest)</option>
              </select>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Tooltip
              content={{
                api: 'Hệ thống (Local)',
                def: isVi
                  ? 'Xuất dữ liệu thị trường + system prompt (theo ngôn ngữ đã chọn) thành file Markdown để dùng với AI khác.'
                  : 'Export market data + system prompt (in the selected language) as Markdown for other AI tools.',
              }}
              lastUpdated={lastSync}
            >
              <button
                className="font-mono"
                onClick={exportDataForAi}
                disabled={isExporting || isAiLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: isExporting || isAiLoading ? 'var(--bg-slate-800)' : 'var(--bg-slate-900)',
                  color: isExporting || isAiLoading ? 'var(--text-slate-500)' : 'var(--color-emerald-400)',
                  border:
                    isExporting || isAiLoading
                      ? '1px solid var(--border-panel)'
                      : '1px solid var(--border-emerald-500)',
                  cursor: isExporting || isAiLoading ? 'not-allowed' : 'pointer',
                  boxShadow: 'none',
                  transition: 'all 0.2s ease',
                }}
                onMouseOver={(e) => {
                  if (!isExporting && !isAiLoading) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.borderColor = 'var(--text-contrast)';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isExporting && !isAiLoading) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.borderColor = 'var(--border-emerald-500)';
                  }
                }}
              >
                {isExporting ? <Loader2 size={14} className="spinning" /> : <Download size={14} />}
                {isExporting
                  ? isVi
                    ? 'ĐANG XUẤT...'
                    : 'EXPORTING...'
                  : isVi
                    ? 'XUẤT PROMPT CHO AI'
                    : 'EXPORT PROMPT FOR AI'}
              </button>
            </Tooltip>
            {onExportMarkdown && (
              <Tooltip
                content={{
                  api: 'Hệ thống (Markdown Engine)',
                  def: isVi
                    ? 'Xuất toàn bộ 12 mục dữ liệu định lượng (Market Bias, Options, ETF Flow, CME COT, Macro v2, CVD, Flow Regime, L/S, OI, Whale Walls, OBI, Altcoin Scanner - Mới nhất & Lịch sử) ra file Markdown.'
                    : 'Export all 12 quantitative data modules (Latest & History) to a comprehensive Markdown file.',
                }}
                lastUpdated={lastSync}
              >
                <button
                  className="font-mono btn-export-md"
                  onClick={onExportMarkdown}
                  disabled={isExportingMd || isAiLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    borderRadius: '4px',
                    background: isExportingMd || isAiLoading ? 'var(--bg-slate-800)' : 'rgba(56, 189, 248, 0.12)',
                    color: isExportingMd || isAiLoading ? 'var(--text-slate-500)' : '#38bdf8',
                    border: isExportingMd || isAiLoading ? '1px solid var(--border-panel)' : '1px solid rgba(56, 189, 248, 0.5)',
                    cursor: isExportingMd || isAiLoading ? 'not-allowed' : 'pointer',
                    boxShadow: 'none',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={(e) => {
                    if (!isExportingMd && !isAiLoading) {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.borderColor = '#38bdf8';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!isExportingMd && !isAiLoading) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                    }
                  }}
                >
                  {isExportingMd ? <Loader2 size={14} className="spinning" /> : <FileDown size={14} />}
                  {isExportingMd
                    ? (isVi ? 'ĐANG XUẤT MD...' : 'EXPORTING MD...')
                    : (isVi ? 'XUẤT FULL DATA (MD)' : 'EXPORT FULL MD')}
                </button>
              </Tooltip>
            )}
            <Tooltip
              content={{
                api: aiProvider === 'openrouter' ? 'OpenRouter API (Free Top 10)' : 'Gemini API',
                def: isVi
                  ? 'AI kiểm định giả thuyết, phản biện narrative và lập playbook quyết định từ dữ liệu vĩ mô, on-chain, flow, phái sinh và HFT.'
                  : 'AI tests competing hypotheses and builds a decision playbook from macro, on-chain, flow, derivatives, and HFT data.',
              }}
              lastUpdated={lastSync}
            >
              <button
                className="btn-sync font-mono"
                onClick={generateReport}
                disabled={isAiLoading || isExporting}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {isAiLoading ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}
                {isAiLoading
                  ? selectedStyle === 'forensics'
                    ? (isVi ? '💥 ĐANG GIẢI PHẪU...' : '💥 ANALYZING FORENSICS...')
                    : (isVi ? 'ĐANG KIỂM ĐỊNH...' : 'TESTING THESIS...')
                  : selectedStyle === 'forensics'
                    ? (isVi ? '💥 GIẢI PHẪU BIẾN ĐỘNG & DỰ PHÓNG' : '💥 FORENSICS & FORECAST')
                    : (isVi ? 'PHÂN TÍCH & RA QUYẾT ĐỊNH' : 'ANALYZE & DECIDE')}
              </button>
            </Tooltip>
            <ModuleMenu moduleId="tab_summary" />
          </div>
        </div>
      </div>

      {aiProvider === 'gemini' && !apiKeys?.gemini && (
        <div className="font-mono" style={{ background: 'var(--bg-amber-badge)', border: '1px solid var(--border-badge-warn)', color: 'var(--color-amber-400)', padding: '10px 14px', borderRadius: '6px', fontSize: '0.75rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠️ {isVi ? 'Chưa nhập Gemini API Key. Vui lòng bấm biểu tượng ⚙️ Cài đặt ở thanh Header để cấu hình API Key.' : 'Gemini API Key missing. Please click the ⚙️ Settings icon in the top header to configure your API key.'}</span>
        </div>
      )}

      {aiProvider === 'openrouter' && !apiKeys?.openrouter && (
        <div className="font-mono" style={{ background: 'var(--bg-amber-badge)', border: '1px solid var(--border-badge-warn)', color: 'var(--color-amber-400)', padding: '10px 14px', borderRadius: '6px', fontSize: '0.75rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠️ {isVi ? 'Chưa nhập OpenRouter API Key. Vui lòng bấm biểu tượng ⚙️ Cài đặt ở thanh Header để nhập API Key.' : 'OpenRouter API Key missing. Please click the ⚙️ Settings icon in the top header to configure your API key.'}</span>
        </div>
      )}

      {selectedStyle === 'forensics' && (
        <div
          className="forensics-timeline-card font-mono"
          style={{
            background: 'var(--bg-panel-solid, var(--bg-slate-900))',
            border: '1px solid var(--border-panel)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-contrast)' }}>
                <span>💥</span>
                <span>{isVi ? 'BẢNG CÁC ĐỢT GIẬT GIÁ ĐÃ NHẬN DIỆN (TOP 3 TRONG 24H & TOP 5 TRONG 7D)' : 'DETECTED SHARP IMPULSE MOVES (TOP 3 IN 24H & TOP 5 IN 7D)'}</span>
                {isForensicsLoading && <Loader2 size={13} className="spinning" style={{ color: 'var(--color-primary)' }} />}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-slate-400)', marginTop: '2px' }}>
                {isVi
                  ? 'Tái dựng vi cấu trúc tại thời điểm nến giật: Taker CVD Delta, Δ Open Interest, Long/Short và sự kiện vĩ mô.'
                  : 'Microstructure reconstructed at the moment of impulse: Taker CVD Delta, Δ Open Interest, L/S Ratio & Macro events.'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-active-tab)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '2px', fontSize: '0.65rem' }}>
                <span style={{ padding: '2px 6px', color: 'var(--text-slate-400)', fontWeight: 500 }}>
                  {isVi ? 'Sắp xếp:' : 'Sort:'}
                </span>
                <button
                  onClick={() => setForensicsSortBy('time')}
                  style={{
                    background: forensicsSortBy === 'time' ? 'var(--bg-panel-solid, var(--bg-slate-900))' : 'transparent',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    fontSize: '0.65rem',
                    cursor: 'pointer',
                    fontWeight: forensicsSortBy === 'time' ? 'bold' : 'normal',
                    color: forensicsSortBy === 'time' ? 'var(--text-contrast)' : 'var(--text-slate-400)',
                    boxShadow: forensicsSortBy === 'time' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                  title={isVi ? 'Sắp xếp theo dòng thời gian từ cũ đến mới' : 'Sort chronologically from oldest to newest'}
                >
                  ⏱️ {isVi ? 'Thời gian' : 'Time'}
                </button>
                <button
                  onClick={() => setForensicsSortBy('magnitude')}
                  style={{
                    background: forensicsSortBy === 'magnitude' ? 'var(--bg-panel-solid, var(--bg-slate-900))' : 'transparent',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    fontSize: '0.65rem',
                    cursor: 'pointer',
                    fontWeight: forensicsSortBy === 'magnitude' ? 'bold' : 'normal',
                    color: forensicsSortBy === 'magnitude' ? 'var(--text-contrast)' : 'var(--text-slate-400)',
                    boxShadow: forensicsSortBy === 'magnitude' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                  title={isVi ? 'Sắp xếp theo biên độ biến động % mạnh nhất' : 'Sort by price change % magnitude'}
                >
                  💥 {isVi ? 'Biên độ %' : 'Magnitude'}
                </button>
              </div>

              <button
                onClick={() => fetchAndEnrichForensics(true)}
                disabled={isForensicsLoading}
                style={{
                  background: 'var(--bg-badge-api)',
                  border: '1px solid var(--border-badge-api)',
                  color: 'var(--color-badge-api)',
                  padding: '5px 12px',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  cursor: isForensicsLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {isForensicsLoading ? (isVi ? 'ĐANG QUÉT...' : 'SCANNING...') : (isVi ? '🔄 QUÉT LẠI' : '🔄 RESCAN')}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
            {/* 24h Column */}
            <div style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--color-cyan-500, #0891b2)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚡</span>
                  <span>{isVi ? 'TOP 3 TRONG 24 GIỜ QUA (NẾN 15M)' : 'TOP 3 IN 24 HOURS (15M CANDLES)'}</span>
                </div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)', fontWeight: 'normal' }}>
                  {forensicsSortBy === 'time' ? (isVi ? '⏱️ Theo thời gian' : '⏱️ Chronological') : (isVi ? '💥 Theo biên độ' : '💥 By magnitude')}
                </span>
              </div>
              {sortedMoves24h.length === 0 ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', padding: '8px 0' }}>
                  {isForensicsLoading ? (isVi ? 'Đang tải nến 15m...' : 'Loading 15m candles...') : (isVi ? 'Chưa phát hiện biến động đột biến trong 24h.' : 'No major impulse moves detected in 24h.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sortedMoves24h.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: m.direction === 'PUMP' ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                        border: `1px solid ${m.direction === 'PUMP' ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                        borderRadius: '6px',
                        padding: '10px 12px',
                        fontSize: '0.7rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-slate-400)' }}>#{idx + 1}</span>
                          <span style={{
                            fontWeight: 'bold',
                            color: m.direction === 'PUMP' ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                          }}>
                            {m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP'} {m.priceChangePercent >= 0 ? '+' : ''}{m.priceChangePercent.toFixed(2)}%
                          </span>
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>({m.candleCount}x 15m)</span>
                          {m.moveType === 'LIQUIDITY_SWEEP_LOW' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(16,185,129,0.18)', color: 'var(--color-emerald-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              🎯 {isVi ? 'SWEEP ĐÁY' : 'SWEEP LOW'}
                            </span>
                          )}
                          {m.moveType === 'LIQUIDITY_SWEEP_HIGH' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(244,63,94,0.18)', color: 'var(--color-rose-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚡ {isVi ? 'SWEEP ĐỈNH' : 'SWEEP HIGH'}
                            </span>
                          )}
                          {m.moveType === 'TWO_WAY_VOLATILITY' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(245,158,11,0.18)', color: 'var(--color-amber-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚔️ {isVi ? 'QUÉT 2 ĐẦU' : '2-WAY SWEEP'}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            color: 'var(--text-contrast)',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                          title={m.fullTimeVn || m.startTimeVn}
                        >
                          <span>📅</span>
                          <span>{m.displayTimeVn || m.startTimeVn}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-contrast)', fontSize: '0.68rem', margin: '6px 0' }}>
                        <span>{formatUsd(m.startPrice, 0)} → <strong>{formatUsd(m.endPrice, 0)}</strong></span>
                        <span style={{ color: 'var(--text-slate-400)' }}>
                          {isVi ? 'Râu quét' : 'Range'}: <strong style={{ color: 'var(--color-amber-400)' }}>{m.rangePercent != null ? `${m.rangePercent.toFixed(1)}%` : 'N/A'}</strong> ({formatUsd(m.lowPrice, 0)} - {formatUsd(m.highPrice, 0)})
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          fontWeight: 500,
                          background: (m.takerCvdDelta || 0) >= 0 ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                          border: `1px solid ${(m.takerCvdDelta || 0) >= 0 ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                          color: (m.takerCvdDelta || 0) >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                        }}>
                          CVD: {(m.takerCvdDelta || 0) >= 0 ? '+' : ''}{formatCompactUsd(m.takerCvdDelta)}
                        </span>

                        {m.oiDeltaPercent != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            fontWeight: 500,
                            background: 'var(--bg-amber-badge)',
                            border: '1px solid var(--border-badge-warn)',
                            color: 'var(--color-amber-500)',
                          }}>
                            ΔOI: {m.oiDeltaPercent >= 0 ? '+' : ''}{m.oiDeltaPercent.toFixed(1)}%
                          </span>
                        )}

                        {m.lsRatio != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            color: 'var(--text-slate-200)',
                          }}>
                            L/S: {m.lsRatio.toFixed(2)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqLongUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-rose-badge)',
                            border: '1px solid var(--border-rose-500)',
                            color: 'var(--color-rose-400)',
                          }}>
                            🔥 Liq Long: {formatCompactUsd(m.localTrackerMatch.liqLongUsd)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqShortUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-emerald-badge)',
                            border: '1px solid var(--border-emerald-500)',
                            color: 'var(--color-emerald-400)',
                          }}>
                            🔥 Liq Short: {formatCompactUsd(m.localTrackerMatch.liqShortUsd)}
                          </span>
                        )}

                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          background: 'var(--bg-badge-api)',
                          border: '1px solid var(--border-badge-api)',
                          color: 'var(--color-badge-api)',
                          fontWeight: 'bold',
                        }}>
                          {m.mechanismHypothesis}
                        </span>
                      </div>

                      {m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0 && (
                        <div style={{ fontSize: '0.62rem', color: 'var(--color-amber-500)', marginTop: '6px' }}>
                          ⚠️ {m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title}`).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 7d Column */}
            <div style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--color-amber-500, #d97706)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📅</span>
                  <span>{isVi ? 'TOP 5 TRONG 7 NGÀY QUA (NẾN 1H)' : 'TOP 5 IN 7 DAYS (1H CANDLES)'}</span>
                </div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)', fontWeight: 'normal' }}>
                  {forensicsSortBy === 'time' ? (isVi ? '⏱️ Theo thời gian' : '⏱️ Chronological') : (isVi ? '💥 Theo biên độ' : '💥 By magnitude')}
                </span>
              </div>
              {sortedMoves7d.length === 0 ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', padding: '8px 0' }}>
                  {isForensicsLoading ? (isVi ? 'Đang tải nến 1h...' : 'Loading 1h candles...') : (isVi ? 'Chưa phát hiện biến động đột biến trong 7d.' : 'No major impulse moves detected in 7d.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sortedMoves7d.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: m.direction === 'PUMP' ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                        border: `1px solid ${m.direction === 'PUMP' ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                        borderRadius: '6px',
                        padding: '10px 12px',
                        fontSize: '0.7rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-slate-400)' }}>#{idx + 1}</span>
                          <span style={{
                            fontWeight: 'bold',
                            color: m.direction === 'PUMP' ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                          }}>
                            {m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP'} {m.priceChangePercent >= 0 ? '+' : ''}{m.priceChangePercent.toFixed(2)}%
                          </span>
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>({m.candleCount}x 1h)</span>
                          {m.moveType === 'LIQUIDITY_SWEEP_LOW' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(16,185,129,0.18)', color: 'var(--color-emerald-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              🎯 {isVi ? 'SWEEP ĐÁY' : 'SWEEP LOW'}
                            </span>
                          )}
                          {m.moveType === 'LIQUIDITY_SWEEP_HIGH' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(244,63,94,0.18)', color: 'var(--color-rose-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚡ {isVi ? 'SWEEP ĐỈNH' : 'SWEEP HIGH'}
                            </span>
                          )}
                          {m.moveType === 'TWO_WAY_VOLATILITY' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(245,158,11,0.18)', color: 'var(--color-amber-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚔️ {isVi ? 'QUÉT 2 ĐẦU' : '2-WAY SWEEP'}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            color: 'var(--text-contrast)',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                          title={m.fullTimeVn || m.startTimeVn}
                        >
                          <span>📅</span>
                          <span>{m.displayTimeVn || m.startTimeVn}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-contrast)', fontSize: '0.68rem', margin: '6px 0' }}>
                        <span>{formatUsd(m.startPrice, 0)} → <strong>{formatUsd(m.endPrice, 0)}</strong></span>
                        <span style={{ color: 'var(--text-slate-400)' }}>
                          {isVi ? 'Râu quét' : 'Range'}: <strong style={{ color: 'var(--color-amber-400)' }}>{m.rangePercent != null ? `${m.rangePercent.toFixed(1)}%` : 'N/A'}</strong> ({formatUsd(m.lowPrice, 0)} - {formatUsd(m.highPrice, 0)})
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          fontWeight: 500,
                          background: (m.takerCvdDelta || 0) >= 0 ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                          border: `1px solid ${(m.takerCvdDelta || 0) >= 0 ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                          color: (m.takerCvdDelta || 0) >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                        }}>
                          CVD: {(m.takerCvdDelta || 0) >= 0 ? '+' : ''}{formatCompactUsd(m.takerCvdDelta)}
                        </span>

                        {m.oiDeltaPercent != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            fontWeight: 500,
                            background: 'var(--bg-amber-badge)',
                            border: '1px solid var(--border-badge-warn)',
                            color: 'var(--color-amber-500)',
                          }}>
                            ΔOI: {m.oiDeltaPercent >= 0 ? '+' : ''}{m.oiDeltaPercent.toFixed(1)}%
                          </span>
                        )}

                        {m.lsRatio != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            color: 'var(--text-slate-200)',
                          }}>
                            L/S: {m.lsRatio.toFixed(2)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqLongUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-rose-badge)',
                            border: '1px solid var(--border-rose-500)',
                            color: 'var(--color-rose-400)',
                          }}>
                            🔥 Liq Long: {formatCompactUsd(m.localTrackerMatch.liqLongUsd)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqShortUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-emerald-badge)',
                            border: '1px solid var(--border-emerald-500)',
                            color: 'var(--color-emerald-400)',
                          }}>
                            🔥 Liq Short: {formatCompactUsd(m.localTrackerMatch.liqShortUsd)}
                          </span>
                        )}

                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          background: 'var(--bg-badge-api)',
                          border: '1px solid var(--border-badge-api)',
                          color: 'var(--color-badge-api)',
                          fontWeight: 'bold',
                        }}>
                          {m.mechanismHypothesis}
                        </span>

                        {m.forwardReactions?.retracementPercent != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            color: 'var(--text-slate-200)',
                          }}>
                            {isVi ? 'Thoái lui' : 'Retrace'}: {m.forwardReactions.retracementPercent.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* H4 Structural Column */}
            <div style={{ background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '6px', padding: '12px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--color-indigo-400, #818cf8)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🏛️</span>
                  <span>{isVi ? 'TOP 5 TRONG 20 NGÀY QUA (NẾN 4H)' : 'TOP 5 IN 20 DAYS (4H CANDLES)'}</span>
                </div>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-slate-400)', fontWeight: 'normal' }}>
                  {forensicsSortBy === 'time' ? (isVi ? '⏱️ Theo thời gian' : '⏱️ Chronological') : (isVi ? '💥 Theo biên độ' : '💥 By magnitude')}
                </span>
              </div>
              {sortedMovesH4.length === 0 ? (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', padding: '8px 0' }}>
                  {isForensicsLoading ? (isVi ? 'Đang tải nến 4h...' : 'Loading 4h candles...') : (isVi ? 'Chưa phát hiện biến động cấu trúc trong 20 ngày.' : 'No major structural moves detected in 20 days.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sortedMovesH4.map((m, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: m.direction === 'PUMP' ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                        border: `1px solid ${m.direction === 'PUMP' ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                        borderRadius: '6px',
                        padding: '10px 12px',
                        fontSize: '0.7rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-slate-400)' }}>#{idx + 1}</span>
                          <span style={{
                            fontWeight: 'bold',
                            color: m.direction === 'PUMP' ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                          }}>
                            {m.direction === 'PUMP' ? '🟢 PUMP' : '🔴 DUMP'} {m.priceChangePercent >= 0 ? '+' : ''}{m.priceChangePercent.toFixed(2)}%
                          </span>
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>({m.candleCount}x 4h)</span>
                          {m.moveType === 'LIQUIDITY_SWEEP_LOW' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(16,185,129,0.18)', color: 'var(--color-emerald-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              🎯 {isVi ? 'SWEEP ĐÁY' : 'SWEEP LOW'}
                            </span>
                          )}
                          {m.moveType === 'LIQUIDITY_SWEEP_HIGH' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(244,63,94,0.18)', color: 'var(--color-rose-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚡ {isVi ? 'SWEEP ĐỈNH' : 'SWEEP HIGH'}
                            </span>
                          )}
                          {m.moveType === 'TWO_WAY_VOLATILITY' && (
                            <span style={{ fontSize: '0.6rem', background: 'rgba(245,158,11,0.18)', color: 'var(--color-amber-400)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>
                              ⚔️ {isVi ? 'QUÉT 2 ĐẦU' : '2-WAY SWEEP'}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            color: 'var(--text-contrast)',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                          title={m.fullTimeVn || m.startTimeVn}
                        >
                          <span>📅</span>
                          <span>{m.displayTimeVn || m.startTimeVn}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-contrast)', fontSize: '0.68rem', margin: '6px 0' }}>
                        <span>{formatUsd(m.startPrice, 0)} → <strong>{formatUsd(m.endPrice, 0)}</strong></span>
                        <span style={{ color: 'var(--text-slate-400)' }}>
                          {isVi ? 'Râu quét' : 'Range'}: <strong style={{ color: 'var(--color-amber-400)' }}>{m.rangePercent != null ? `${m.rangePercent.toFixed(1)}%` : 'N/A'}</strong> ({formatUsd(m.lowPrice, 0)} - {formatUsd(m.highPrice, 0)})
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          fontWeight: 500,
                          background: (m.takerCvdDelta || 0) >= 0 ? 'var(--bg-emerald-badge)' : 'var(--bg-rose-badge)',
                          border: `1px solid ${(m.takerCvdDelta || 0) >= 0 ? 'var(--border-emerald-500)' : 'var(--border-rose-500)'}`,
                          color: (m.takerCvdDelta || 0) >= 0 ? 'var(--color-emerald-500)' : 'var(--color-rose-500)',
                        }}>
                          CVD: {(m.takerCvdDelta || 0) >= 0 ? '+' : ''}{formatCompactUsd(m.takerCvdDelta)}
                        </span>

                        {m.oiDeltaPercent != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            fontWeight: 500,
                            background: 'var(--bg-amber-badge)',
                            border: '1px solid var(--border-badge-warn)',
                            color: 'var(--color-amber-500)',
                          }}>
                            ΔOI: {m.oiDeltaPercent >= 0 ? '+' : ''}{m.oiDeltaPercent.toFixed(1)}%
                          </span>
                        )}

                        {m.lsRatio != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            color: 'var(--text-slate-200)',
                          }}>
                            L/S: {m.lsRatio.toFixed(2)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqLongUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-rose-badge)',
                            border: '1px solid var(--border-rose-500)',
                            color: 'var(--color-rose-400)',
                          }}>
                            🔥 Liq Long: {formatCompactUsd(m.localTrackerMatch.liqLongUsd)}
                          </span>
                        )}

                        {m.localTrackerMatch?.liqShortUsd > 0 && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-emerald-badge)',
                            border: '1px solid var(--border-emerald-500)',
                            color: 'var(--color-emerald-400)',
                          }}>
                            🔥 Liq Short: {formatCompactUsd(m.localTrackerMatch.liqShortUsd)}
                          </span>
                        )}

                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '0.62rem',
                          background: 'var(--bg-badge-api)',
                          border: '1px solid var(--border-badge-api)',
                          color: 'var(--color-badge-api)',
                          fontWeight: 'bold',
                        }}>
                          {m.mechanismHypothesis}
                        </span>

                        {m.forwardReactions?.retracementPercent != null && (
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontSize: '0.62rem',
                            background: 'var(--bg-active-tab)',
                            border: '1px solid var(--border-panel)',
                            color: 'var(--text-slate-200)',
                          }}>
                            {isVi ? 'Thoái lui' : 'Retrace'}: {m.forwardReactions.retracementPercent.toFixed(0)}%
                          </span>
                        )}
                      </div>

                      {m.matchingCalendarEvents && m.matchingCalendarEvents.length > 0 && (
                        <div style={{ fontSize: '0.62rem', color: 'var(--color-amber-500)', marginTop: '6px' }}>
                          ⚠️ {m.matchingCalendarEvents.map(e => `[${e.impact}] ${e.title}`).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className="summary-content"
        style={{
          background: 'var(--bg-slate-950)',
          padding: '24px',
          borderRadius: '8px',
          border: '1px solid var(--border-panel)',
          minHeight: '300px',
          color: 'var(--text-contrast)',
          lineHeight: '1.7',
          fontSize: '0.88rem',
          overflowY: 'auto',
        }}
      >
        {aiSummary ? (
          <div className="markdown-body">
            {(() => {
              if (selectedStyle !== 'professional') {
                return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{aiSummary}</ReactMarkdown>;
              }

              const reportBlocks = buildProfessionalReportLayout(aiSummary);
              const cvdSource = reportCvdData?.length > 0 ? reportCvdData : (data.cvdHistory30d?.points || data.cvdHistory30d || data.cvdHistory7d?.points || data.cvdHistory7d || []);
              const oiHistory = Array.isArray(data.oiHistory) ? data.oiHistory : [];
              const hasLiquidationStats = Boolean(liqStats5m || liqStats1h);
              const chartComponents = {
                macro: <MacroLiquidityChart key="macro" data={data} />,
                etf: Array.isArray(etfHistory) && etfHistory.length > 0 ? <EtfChart key="etf" etfHistory={etfHistory} /> : null,
                cot: data.cotData ? <CotChart key="cot" cotData={data.cotData} /> : null,
                onchain: <OnChainValuationChart key="onchain" mvrv={data.onChainMetrics?.mvrv} nupl={btcNupl} btcPrice={data.btc?.price} productionCost={data.onChain?.productionCost} />,
                oi: oiHistory.length > 0 ? <FundingOiChart key="oi" oiHistory={oiHistory} fundingHistory={reportChartData?.fundingHistory} /> : null,
                cvd: Array.isArray(cvdSource) && cvdSource.length > 0 ? <CvdChart key="cvd" cvdData={cvdSource} /> : null,
                liq: hasLiquidationStats ? <LiquidationChart key="liq" liqStats5m={liqStats5m} liqStats1h={liqStats1h} /> : null,
                options: reportChartData?.options ? <OptionsStrikeChart key="options" options={reportChartData.options} /> : null,
              };

              return reportBlocks.map((block, index) => {
                const charts = block.charts.map((chartId) => chartComponents[chartId]).filter(Boolean);

                return (
                  <div key={index} className="summary-chunk">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{block.markdown}</ReactMarkdown>
                    {charts.length > 0 && (
                      <aside className={`summary-evidence-group ${charts.length > 1 ? 'is-grid' : ''}`} aria-label={isVi ? 'Biểu đồ bằng chứng cho luận điểm trên' : 'Evidence charts for the analysis above'}>
                        <div className="summary-evidence-label font-mono">
                          {isVi ? 'BẰNG CHỨNG TRỰC QUAN' : 'VISUAL EVIDENCE'}
                        </div>
                        <div className="summary-evidence-charts">{charts}</div>
                      </aside>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div style={{ color: 'var(--text-slate-500)', textAlign: 'center', marginTop: '100px' }}>
            {isVi ? (
              <>
                Bấm &quot;PHÂN TÍCH &amp; RA QUYẾT ĐỊNH&quot; để AI kiểm định các giả thuyết thị trường,
                chỉ ra edge, phản-thesis, điều kiện vô hiệu và hành động phù hợp theo từng khung thời gian.
                <br />
                <br />
                (Cần Gemini API Key trong Settings)
              </>
            ) : (
              <>
                Click &quot;ANALYZE &amp; DECIDE&quot; to test competing market hypotheses and produce
                an evidence-ranked, conditional decision playbook.
                <br />
                <br />
                (Requires Gemini API Key in Settings)
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )}

  {/* ── Fallback when both modules are hidden ── */}
  {isAuditorHidden && isSummaryHidden && (
    <div className="glass-panel text-slate-500 font-mono" style={{ padding: '40px 20px', textAlign: 'center', borderRadius: '8px' }}>
      <p style={{ margin: '0 0 12px', fontSize: '0.8rem' }}>
        {isVi ? 'Tất cả module trong AI Decision Lab hiện đang bị ẩn.' : 'All modules in AI Decision Lab are currently hidden.'}
      </p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => showModule('tab_summary')}
          className="text-emerald"
          style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem' }}
        >
          {isVi ? 'Hiện lại AI Decision Lab' : 'Unhide AI Decision Lab'}
        </button>
        <button
          type="button"
          onClick={() => showModule('dash_trade_auditor')}
          className="text-emerald"
          style={{ background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.72rem' }}
        >
          {isVi ? 'Hiện lại Trade Plan Auditor' : 'Unhide Trade Plan Auditor'}
        </button>
      </div>
    </div>
  )}
</div>
);
}
