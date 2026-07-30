import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2, Download } from 'lucide-react';
import Tooltip from './Tooltip';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines, getHistoricalCVD, fetchRealtimeFeed } from '../services/api';
import { fetchEconomicCalendar } from '../services/economicCalendarService';
import { getSystemPrompt, getGenerationConfig, AI_STYLE_LABELS } from '../services/aiPrompts';
import { fetchTop10FreeUniqueProviderModels, streamOpenRouterCompletion, FALLBACK_FREE_MODELS } from '../services/openrouter';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';
import TradePlanAuditor from './TradePlanAuditor';
import { 
  EtfChart, 
  CvdChart, 
  FundingOiChart, 
  CotChart, 
  OnChainValuationChart, 
  MacroLiquidityChart 
} from './SummaryCharts';

const renderTextWithTags = (text) => {
  if (typeof text !== 'string') return text;

  // Match evidence tags, dollar amounts ($92,450, $83.06B), percentages (+1.5%, -3.2%, 100%), ratios (1.8x, 2.5x)
  const combinedRegex = /(\[(?:QUAN SÁT|OBSERVED|SUY DẪN|DERIVED|GIẢ THUYẾT|INFERENCE|CHƯA BIẾT|UNKNOWN)\]|\$[0-9.,]+[KMBkmb]?|[+-][0-9.,]+%|[0-9.,]+%|[0-9.]+(?:x|X)\b)/g;
  const parts = text.split(combinedRegex);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    // 1. Evidence Tags
    if (part === '[QUAN SÁT]' || part === '[OBSERVED]') {
      return <span key={i} className="data-tag tag-observed">{part}</span>;
    }
    if (part === '[SUY DẪN]' || part === '[DERIVED]') {
      return <span key={i} className="data-tag tag-derived">{part}</span>;
    }
    if (part === '[GIẢ THUYẾT]' || part === '[INFERENCE]') {
      return <span key={i} className="data-tag tag-inference">{part}</span>;
    }
    if (part === '[CHƯA BIẾT]' || part === '[UNKNOWN]') {
      return <span key={i} className="data-tag tag-unknown">{part}</span>;
    }

    // 2. Positive & Negative Percentages
    if (part.startsWith('+')) {
      return <span key={i} className="num-highlight positive">{part}</span>;
    }
    if (part.startsWith('-') && part.endsWith('%')) {
      return <span key={i} className="num-highlight negative">{part}</span>;
    }

    // 3. Currencies, Ratios & Plain Percentages
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
  h2: ({ children }) => <h2>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h2>,
  h3: ({ children }) => <h3>{React.Children.map(children, child => typeof child === 'string' ? renderTextWithTags(child) : child)}</h3>,
};

/**
 * Remove orphaned ** markers while preserving valid **word** bold pairs.
 *
 * An "opening **" must be preceded by whitespace/start and followed by non-space.
 * A "closing **" must be preceded by non-space and followed by whitespace/punctuation/end.
 * Valid bold = opening ** matched with nearest subsequent closing **.
 * Anything else is orphaned → removed.
 */
const stripOrphanedBold = (text) => {
  const markers = [];
  let idx = 0;
  while (idx < text.length) {
    const pos = text.indexOf('**', idx);
    if (pos === -1) break;
    const charBefore = pos > 0 ? text[pos - 1] : ' ';
    const charAfter = pos + 2 < text.length ? text[pos + 2] : ' ';
    const isOpening = /[\s([/]/.test(charBefore) && /\S/.test(charAfter);
    const isClosing = /\S/.test(charBefore) && (/[\s.,;:!?\])}/\n]/.test(charAfter) || pos + 2 >= text.length);
    markers.push({ pos, isOpening, isClosing });
    idx = pos + 2;
  }
  if (markers.length === 0) return text;

  const paired = new Set();
  const stack = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (m.isOpening && !m.isClosing) {
      stack.push(i);
    } else if (m.isClosing && stack.length > 0) {
      const openIdx = stack.pop();
      paired.add(markers[openIdx].pos);
      paired.add(m.pos);
    }
  }

  let result = '';
  let lastIdx = 0;
  for (const m of markers) {
    result += text.substring(lastIdx, m.pos);
    if (paired.has(m.pos)) { result += '**'; }
    lastIdx = m.pos + 2;
  }
  result += text.substring(lastIdx);
  return result;
};

export const cleanLatex = (text) => {
  if (!text) return text;

  // ── Phase 1: LaTeX symbol cleanup ──────────────────────────────────
  let cleaned = text
    .replace(/\\sim\b/gi, '~')
    .replace(/\\approx\b/gi, '≈')
    .replace(/\\Delta\b/gi, 'Δ')
    .replace(/\\delta\b/gi, 'δ')
    .replace(/\\rightarrow\b/gi, '->')
    .replace(/\\leftarrow\b/gi, '<-')
    .replace(/\\geq?\b/gi, '>=')
    .replace(/\\leq?\b/gi, '<=')
    .replace(/\\times\b/gi, 'x')
    .replace(/\\ref\{[^}]+\}/gi, '')
    .replace(/\\text\{([^}]+)\}/gi, '$1')
    .replace(/\\mathrm\{([^}]+)\}/gi, '$1')
    // Fix dollar math wrappers
    .replace(/\$\s*\\?sim\s*\$?\s*\$?\s*([0-9.,]+[KMBkmb]?)\$?\)?/gi, '~$1')
    .replace(/\$\s*\\?approx\s*\$?\s*\$?\s*([0-9.,]+[KMBkmb]?)\$?\)?/gi, '≈$1')
    .replace(/\$\s*\\?Delta\s*\$?\s*([A-Z0-9.,_]+)\$?/gi, 'Δ $1');

  // ── Phase 2: Pre-clean asterisks ───────────────────────────────────
  cleaned = cleaned
    .replace(/\*{3,}/g, '**')      // collapse ***+ → **
    .replace(/\*\*\s*\*\*/g, '');  // remove empty ** **

  // ── Phase 3: Structural line-break insertion ───────────────────────
  // 3a. Force headings (### 1., ### 2., etc.) onto their own line
  //     Apply twice to handle chained headings
  cleaned = cleaned.replace(/([^\n#])\s*(#{1,4}\s+)/g, '$1\n\n$2');
  cleaned = cleaned.replace(/([^\n#])\s*(#{1,4}\s+)/g, '$1\n\n$2');

  // 3b. Split heading lines that contain an embedded bullet
  //     e.g., "### 4. TITLE - **Label:** Content" → heading + bullet on separate lines
  cleaned = cleaned
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      if (/^#{1,4}\s/.test(trimmed)) {
        const idx = trimmed.search(/\s+-\s+(?:\*{0,2}\s*)?(?=\p{L})/u);
        if (idx > 0) {
          const heading = trimmed.substring(0, idx);
          const rest = trimmed.substring(idx).replace(/^\s+-\s*\*{0,2}\s*/, '');
          return [heading, '- ' + rest];
        }
      }
      return [line];
    })
    .join('\n');

  // 3c. Force bullet points onto separate lines
  //     Match: non-newline char + spaces + hyphen + optional asterisks + Label with colon
  cleaned = cleaned.replace(
    /([^\n])\s+-\s*\*{0,2}\s*(?=\*{0,2}\s*\p{L}[\p{L}\s/&(),'0-9@$]{1,70}?:\s*)/gu,
    '$1\n- '
  );

  // ── Phase 4: Per-line bullet formatting & bold cleanup ─────────────
  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // Skip empty lines and headings
      if (!trimmed || /^#{1,4}\s/.test(trimmed)) return line;

      // Process bullet lines (starting with - or •)
      if (/^[-•]\s/.test(trimmed)) {
        // Parse: "- [**]Label:[**] Content"
        const m = trimmed.match(/^([-•]\s+)\*{0,2}\s*(.+?:)\s*\*{0,2}\s*(.*)/);
        if (m) {
          let [, prefix, rawLabel, content] = m;
          // Clean label: strip any ** from label text and re-apply uniformly
          const label = rawLabel.replace(/\*{1,2}/g, '').trim();
          // Clean content: use context-aware orphan bold stripper
          content = stripOrphanedBold(content);
          return `${prefix}**${label}** ${content}`.trimEnd();
        }
      }

      // Non-bullet lines: strip orphaned bold
      return stripOrphanedBold(line);
    })
    .join('\n');

  // ── Phase 5: Final cleanup ─────────────────────────────────────────
  cleaned = cleaned
    // Fix missing space between words and dollar amounts
    .replace(/([a-zA-Zà-ỹÀ-Ỹ])(\$[0-9])/g, '$1 $2')
    // Fix missing space after ) before words
    .replace(/([\)])([a-zA-Zà-ỹÀ-Ỹ])/g, '$1 $2')
    // Ensure space after bullet hyphen
    .replace(/^-\s*([^\s])/gm, '- $1')
    // Prevent 4-space indent from creating code blocks
    .replace(/^ {4,}([-*+]|\d+\.) /gm, '  $1 ')
    // ── Tilde / strikethrough prevention ────────────────────────────
    // remark-gfm treats ~~text~~ as strikethrough and ~text~ as subscript.
    // Models use ~ as an approximation symbol (LaTeX \sim), which creates
    // accidental ~value~ pairs that render with strikethrough.
    // Remove any ~~...~~ markdown strikethrough by unwrapping its content.
    .replace(/~~([^~]+)~~/g, '$1')
    // Convert lone ~value~ (approx pattern) to ≈value
    .replace(/~([^~\n]{1,60})~/g, '≈$1')
    // Remove any remaining lone tildes that are not intentional
    .replace(/(?<![~])~(?![~])/g, '');

  return cleaned;
};


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

export default function SummaryTab({ 
  data, apiKeys, cvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading, lastSync,
  btcNupl, ethNupl, btcSupplyProfit, ethSupplyProfit
}) {
  const [reportCvdData, setReportCvdData] = useState([]);
  const { isModuleHidden } = useModuleVisibility();
  const isSummaryHidden = isModuleHidden('tab_summary');
  const [aiProvider, setAiProvider] = useState(() => {
    return localStorage.getItem('ai-provider') || 'gemini';
  });

  const handleProviderChange = (newProvider) => {
    setAiProvider(newProvider);
    localStorage.setItem('ai-provider', newProvider);
  };

  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('ai-model');
    if (saved === 'gemini-flash-lite-latest' || saved === 'gemini-flash-latest') {
      return saved;
    }
    return 'gemini-flash-lite-latest';
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
    return saved === 'professional' || saved === 'compact' ? saved : 'compact';
  });

  const handleStyleChange = (newStyle) => {
    setSelectedStyle(newStyle);
    localStorage.setItem('ai-analysis-style', newStyle);
  };

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
    let latestNews = [];

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
        latestNews,
        calendarRes,
      ] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100),
        getWhaleWalls(),
        getBTCKlines('BTCUSDT', '4h', 42),
        getBTCKlines('BTCUSDT', '1d', 30),
        getBTCKlines('BTCUSDT', '1d', 90),
        getBTCKlines('BTCUSDT', '1w', 52),
        getHistoricalCVD('BTCUSDT', '4h', 42),
        getHistoricalCVD('BTCUSDT', '1d', 30),
        fetchRealtimeFeed(),
        fetchEconomicCalendar().catch(() => null),
      ]);
    } catch (error) {
      console.warn('Error fetching data for report:', error);
    }

    const activeCvd7d = cvd7d.length > 0 ? cvd7d : (data.cvdHistory7d || []);
    const activeCvd30d = cvd30d.length > 0 ? cvd30d : (data.cvdHistory30d || []);
    if (activeCvd30d.length > 0 || activeCvd7d.length > 0) {
      setReportCvdData(activeCvd30d.length > 0 ? activeCvd30d : activeCvd7d);
    }
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

    const cvdBlock = (series, label) => {
      const valid = (series || []).filter(
        (point) =>
          toFiniteNumber(point.cvd) !== null &&
          toFiniteNumber(point.price) !== null
      );
      if (valid.length === 0) {
        return `### ${label}\n- Summary: N/A\n- Sampled path: N/A`;
      }

      const firstPrice = toFiniteNumber(valid[0].price);
      const lastPrice = toFiniteNumber(valid[valid.length - 1].price);
      const priceChange =
        firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : null;
      const finalCvd = toFiniteNumber(valid[valid.length - 1].cvd);
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
            `Rebased cumulative CVD ${formatSigned(point.cvd, 0, ' USD')}`
        )
        .join('\n');

      return `### ${label}
- Scope: Binance BTCUSDT klines; taker-buy quote volume minus taker-sell quote volume; cumulative series rebased at the start of this window.
- Price change across window: ${formatSigned(priceChange, 2, '%')}
- Final rebased cumulative CVD: ${formatSigned(finalCvd, 0, ' USD')}
- First-half net taker delta: ${formatSigned(firstHalfDelta, 0, ' USD')}
- Second-half net taker delta: ${formatSigned(secondHalfDelta, 0, ' USD')}
- Sampled paired path:
${path}`;
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

    const etfFlow7d = Array.isArray(etfHistory) ? etfHistory.slice(-7) : [];
    const etfFlows = etfFlow7d
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

    const promptData = `
# MARKET ANALYSIS INPUT

## 0. SNAPSHOT, COVERAGE & PROVENANCE
- Report generated at: ${new Date().toISOString()}
- Dashboard last successful sync/fetch: ${safeIsoTime(lastSync)}
- Coverage summary: ${coverageStr}
- BTC spot/klines, funding, OI, global L/S accounts, and historical CVD venue: Binance BTCUSDT.
- OBI and whale-wall scope: multi-exchange aggregation returned by the dashboard; composition is shown where available.
- Macro observations may have publication lag. The dashboard currently supplies values but not every source observation date.
- ETF history contains the latest seven available dashboard observations, which may include non-trading-day gaps or fallback data. Compare the latest observation date with the report timestamp.
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
})()}`.trim()

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
${etfFlowStr}

### CME COT Futures Only
${cotStr}
- CME COT open interest: ${data.cotData?.openInterest ?? 'N/A'}
- COT observation age at report time: ${cotObservationAgeDays === null ? 'N/A' : cotObservationAgeDays + ' days'}
- COT release caveat: Friday release reflects Tuesday positions, approximately 3-7 days lagged.

## 5. DERIVATIVES
- BTC 24h price change input for price/OI matrix: ${formatSigned(data.btc?.change, 2, '%')}
- Current Funding Rate: ${toFiniteNumber(data.fundingRate) === null ? 'N/A' : formatSigned(data.fundingRate * 100, 4, '%')}
- Current Open Interest: ${toFiniteNumber(data.openInterest) === null ? 'N/A' : formatNumber(data.openInterest, 0) + ' BTC'}
- OI change across supplied history: ${formatSigned(oiChangePct, 2, '%')}
- OI history:
${oiStr}
- Current Global Long/Short Account Ratio: ${formatNumber(lsLast, 3)}
- Change in L/S ratio across supplied history: ${formatSigned(lsChange, 3)}
- L/S account history:
${lsStr}
- Intraday CVD: ${formatSigned(cvd, 0, ' USD')}
- Intraday taker buy volume: ${formatNumber(buyVolume, 0)} USD
- Intraday taker sell volume: ${formatNumber(sellVolume, 0)} USD

## 6. HISTORICAL PRICE / CVD
${cvdBlock(activeCvd7d, '7-Day CVD / Price (4h)')}

${cvdBlock(activeCvd30d, '30-Day CVD / Price (1d)')}

## 7. DISPLAYED LIQUIDITY & ORDER BOOK
- Aggregated OBI: ${orderBook?.obiPercent !== undefined ? formatSigned(orderBook.obiPercent, 2, '%') : 'N/A'}
- Dashboard OBI label: ${orderBook?.signal || 'N/A'}
- OBI exchange breakdown:
${orderBook?.exchanges?.length
  ? orderBook.exchanges.map((exchange) => `  - ${exchange.name}: ${formatSigned(exchange.obi, 2, '%')}`).join('\n')
  : '  N/A'}
- Whale bid share: ${whaleWalls?.bidRatio !== undefined ? formatNumber(whaleWalls.bidRatio * 100, 1) + '%' : 'N/A'}
- Dashboard whale-wall label: ${whaleWalls?.signal || 'N/A'}

### Largest Displayed Bid Walls
${formatWalls(whaleWalls?.whaleBids)}

### Largest Displayed Ask Walls
${formatWalls(whaleWalls?.whaleAsks)}

## 8. LATEST HEADLINES & EVENT RISK
${formatNews(activeNews)}

## 9. USER INTENDED BIAS & AUDIT REQUEST
- User Selected Bias: **${selectedUserBias === 'none' ? 'NONE (Objective Evaluation)' : selectedUserBias.toUpperCase()}**
${
  selectedUserBias !== 'none'
    ? `- SPECIAL DIRECTIVE: The user has selected a **${selectedUserBias.toUpperCase()}** bias. You MUST include the USER BIAS AUDIT section in your report. Provide (1) Assessment of whether current data supports or refutes ${selectedUserBias.toUpperCase()}, (2) Actionable risk management advice & entry conditions, and (3) Final verdict on the ${selectedUserBias.toUpperCase()} bias (**CONFIRMED VALID**, **WAIT FOR CONFIRMATION**, or **INVALIDATED**).`
    : '- Note: User selected Objective Evaluation (No specific bias).'
}
`;

    const systemPrompt = getSystemPrompt(selectedStyle, selectedLang, selectedUserBias);
    return { promptData, systemPrompt };
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
        const { promptData, systemPrompt } = await preparePromptAndData();
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
    const modelAttempts = selectedModel === 'gemini-flash-lite-latest'
      ? ['gemini-flash-lite-latest', 'gemini-flash-latest']
      : ['gemini-flash-latest', 'gemini-flash-lite-latest'];

    let success = false;
    let finalError = null;
    let actualModelUsed = selectedModel;

    try {
      const { promptData, systemPrompt } = await preparePromptAndData();

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

          console.log(`[AI] Attempt ${attempt + 1}: model=${model} lang=${selectedLang} style=${selectedStyle}`);
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
                    currentText = cleanLatex(currentText + text);
                    setAiSummary((attempt > 0 ? fallbackPrefix : '') + currentText);
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
                    setAiSummary((attempt > 0 ? fallbackPrefix : '') + currentText);
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

  if (isSummaryHidden) return null;

  return (
    <div className="summary-tab-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* ── Separate Trade Plan Auditor Widget ── */}
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
      />

      {/* ── AI Market Decision Lab Main Panel ── */}
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
                    ? 'XUẤT DATA CHO AI'
                    : 'EXPORT DATA FOR AI'}
              </button>
            </Tooltip>
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
                  ? isVi
                    ? 'ĐANG KIỂM ĐỊNH...'
                    : 'TESTING THESIS...'
                  : isVi
                    ? 'PHÂN TÍCH & RA QUYẾT ĐỊNH'
                    : 'ANALYZE & DECIDE'}
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

              // Split markdown by headers (##, ###, ####)
              const chunks = aiSummary.split(/(?=^#{2,4}\s)/m).filter(Boolean);
              const renderedCharts = new Set();
              
              return chunks.map((chunk, index) => {
                const lowerText = chunk.toLowerCase();
                let chartToRender = null;
                
                // 1. Spot ETF Chart - place strictly under ETF section
                if (!renderedCharts.has('etf') && (lowerText.includes('etf') || lowerText.includes('spot etf') || lowerText.includes('net flow'))) {
                  chartToRender = <EtfChart key="etf" etfHistory={etfHistory} />;
                  renderedCharts.add('etf');
                }
                // 2. CME COT Chart - place strictly under CME COT section
                else if (!renderedCharts.has('cot') && (lowerText.includes('cme') || lowerText.includes('cot') || lowerText.includes('asset manager') || lowerText.includes('quỹ đầu cơ'))) {
                  chartToRender = <CotChart key="cot" cotData={data.cotData} />;
                  renderedCharts.add('cot');
                }
                // 3. Phái sinh OI & Funding Chart - place strictly under Derivatives section
                else if (!renderedCharts.has('oi') && (lowerText.includes('phái sinh') || lowerText.includes('open interest') || lowerText.includes('funding rate') || lowerText.includes('derivatives'))) {
                  chartToRender = <FundingOiChart key="oi" oiHistory={Array.isArray(data.oiHistory) ? data.oiHistory : []} fundingRates={data.fundingRates} />;
                  renderedCharts.add('oi');
                }
                // 4. Lịch sử Giá & CVD Chart - place strictly under CVD / Price section
                else if (!renderedCharts.has('cvd') && (lowerText.includes('cvd') || lowerText.includes('taker flow') || lowerText.includes('lịch sử giá') || lowerText.includes('historical price'))) {
                  const cvdSource = reportCvdData.length > 0 ? reportCvdData : (data.cvdHistory30d?.length > 0 ? data.cvdHistory30d : data.cvdHistory7d);
                  chartToRender = <CvdChart key="cvd" cvdData={cvdSource} />;
                  renderedCharts.add('cvd');
                }
                // 5. On-Chain Valuation Chart - place strictly under On-Chain section
                else if (!renderedCharts.has('onchain') && (lowerText.includes('on-chain') || lowerText.includes('mvrv') || lowerText.includes('production cost') || lowerText.includes('định giá'))) {
                  chartToRender = <OnChainValuationChart key="onchain" mvrv={data.onChainMetrics?.mvrv} btcPrice={data.btc?.price} productionCost={data.productionCost} />;
                  renderedCharts.add('onchain');
                }
                // 6. Vĩ mô Macro Liquidity Chart - place strictly under Macro section
                else if (!renderedCharts.has('macro') && (lowerText.includes('vĩ mô') || lowerText.includes('macro') || lowerText.includes('liquidity') || lowerText.includes('real-rate'))) {
                  chartToRender = <MacroLiquidityChart key="macro" data={data} />;
                  renderedCharts.add('macro');
                }

                return (
                  <div key={index} className="summary-chunk" style={{ position: 'relative' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{chunk}</ReactMarkdown>
                    {chartToRender}
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
  </div>
);
}
