/**
 * Market Bias Engine Service
 * Calculates an overall BTC market bias score from -100 to +100
 * using 4 balanced, cross-verified pillars calibrated for macro, on-chain & swing trend:
 * 
 * 1. Institutional Flows & Capital (40%):
 *    - Spot ETF 7-Day Net Flow (28%)
 *    - CME COT Institutional Asset Managers (12%)
 * 
 * 2. On-Chain Fundamentals & Network (25%):
 *    - MVRV Ratio (Single Valuation Anchor) (8%)
 *    - Stablecoin Supply Ratio (SSR) Oscillator Z-Score (5%)
 *    - Active Addresses & Network Activity (4%)
 *    - Mining Production Cost Floor (4%)
 *    - Network Transaction Volume / Demand (4%)
 * 
 * 3. Macro Liquidity & Risk Shock (20%):
 *    - Monetary Policy & Real Rate Pulse (Fed Funds, CPI, Real Rate, Unrate) (6%)
 *    - US Net Liquidity & Credit Stress (Net Liquidity, High-Yield Spread, M2) (5%)
 *    - Global Currency & Discount Rates (DXY Dollar Index, US 10Y Yield) (4%)
 *    - Equities Risk Appetite (S&P 500 / Nasdaq 100) (2%)
 *    - VIX Volatility & 24h High Impact Calendar Shock (3%)
 * 
 * 4. Market Microstructure & BTC Trend Regime (15%):
 *    - BTC Trend & Price Regime (MA50/MA200, 30D/90D Momentum, Realized Vol) (3%)
 *    - Spot CVD 24h/7d/30d (3%) — Multi-Exchange raw-trade when coverage is sufficient, Binance otherwise
 *    - Futures CVD 24h/7d/30d (2%) — Multi-Exchange raw-trade when coverage is sufficient, Binance otherwise
 *    - Funding Rate Confluence (Cross-checked with Spot CVD) (2%)
 *    - Open Interest Surge & Leverage Action (2%)
 *    - Fear & Greed Index (2%)
 *    - Retail Long/Short Ratio (1%)
 */

import { extractCvdNetDelta } from './cvdService.js';

const MAX_SCORING_WEIGHT = 0.95;

export function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/,/g, '').replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Calculates trend metrics, moving averages and realized volatility from daily candles
 */
export function calculateBtcTrendRegime(dailyKlines, currentPrice = null) {
  if (!Array.isArray(dailyKlines) || dailyKlines.length < 14) {
    return {
      hasData: false,
      signal: 0,
      status: 'No daily trend data',
      ma50: null,
      ma200: null,
      slope50: null,
      return7d: null,
      return30d: null,
      return90d: null,
      realizedVol30d: null,
      regimeLabel: 'UNKNOWN',
    };
  }

  const closes = dailyKlines
    .map((k) => (typeof k === 'object' && k !== null ? toFiniteNumber(k.close ?? k[4]) : toFiniteNumber(k)))
    .filter((v) => v != null && v > 0);

  if (closes.length < 14) {
    return {
      hasData: false,
      signal: 0,
      status: 'Insufficient closed candles',
      ma50: null,
      ma200: null,
      slope50: null,
      return7d: null,
      return30d: null,
      return90d: null,
      realizedVol30d: null,
      regimeLabel: 'UNKNOWN',
    };
  }

  const len = closes.length;
  const refPrice = toFiniteNumber(currentPrice) || closes[len - 1];

  // Moving averages
  const ma50Len = Math.min(50, len);
  const ma50Slice = closes.slice(len - ma50Len);
  const ma50 = ma50Slice.reduce((a, b) => a + b, 0) / ma50Len;

  let ma200 = null;
  if (len >= 100) {
    const ma200Len = Math.min(200, len);
    const ma200Slice = closes.slice(len - ma200Len);
    ma200 = ma200Slice.reduce((a, b) => a + b, 0) / ma200Len;
  }

  // MA50 slope (20 bars ago)
  let slope50 = 0;
  if (len >= 70) {
    const past50Slice = closes.slice(len - 70, len - 20);
    const pastMa50 = past50Slice.reduce((a, b) => a + b, 0) / 50;
    slope50 = pastMa50 > 0 ? ((ma50 - pastMa50) / pastMa50) * 100 : 0;
  }

  // Returns
  const price7dAgo = len >= 8 ? closes[len - 8] : closes[0];
  const return7d = price7dAgo > 0 ? ((refPrice - price7dAgo) / price7dAgo) * 100 : 0;

  const price30dAgo = len >= 31 ? closes[len - 31] : closes[0];
  const return30d = price30dAgo > 0 ? ((refPrice - price30dAgo) / price30dAgo) * 100 : 0;

  const price90dAgo = len >= 91 ? closes[len - 91] : null;
  const return90d = price90dAgo && price90dAgo > 0 ? ((refPrice - price90dAgo) / price90dAgo) * 100 : null;

  // 30D Realized Volatility (Annualized standard deviation of daily returns)
  let realizedVol30d = null;
  const volWindow = closes.slice(Math.max(0, len - 31));
  if (volWindow.length >= 10) {
    const dailyReturns = [];
    for (let i = 1; i < volWindow.length; i++) {
      if (volWindow[i - 1] > 0 && volWindow[i] > 0) {
        dailyReturns.push(Math.log(volWindow[i] / volWindow[i - 1]));
      }
    }
    if (dailyReturns.length >= 8) {
      const meanRet = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / (dailyReturns.length - 1);
      realizedVol30d = Math.sqrt(Math.max(0, variance)) * Math.sqrt(365) * 100;
    }
  }

  // Determine structural trend signal (-1.0 to +1.0)
  let trendScore = 0;
  let regimeLabel = 'SIDEWAYS / RANGE';

  const above50 = refPrice > ma50;
  const above200 = ma200 != null ? refPrice > ma200 : above50;
  const goldenCross = ma200 != null ? ma50 > ma200 : true;

  if (above50 && above200 && goldenCross) {
    if (slope50 > 1.5 && return30d > 5) {
      trendScore = 1.0;
      regimeLabel = 'STRONG UPTREND';
    } else {
      trendScore = 0.7;
      regimeLabel = 'UPTREND';
    }
  } else if (above50 && !above200) {
    trendScore = 0.3;
    regimeLabel = 'EARLY RECOVERY';
  } else if (!above50 && above200) {
    trendScore = -0.3;
    regimeLabel = 'PULLBACK IN BULL';
  } else if (!above50 && !above200 && !goldenCross) {
    if (slope50 < -1.5 && return30d < -5) {
      trendScore = -1.0;
      regimeLabel = 'STRONG DOWNTREND';
    } else {
      trendScore = -0.7;
      regimeLabel = 'DOWNTREND';
    }
  } else {
    trendScore = clamp(return30d / 25);
    regimeLabel = 'SIDEWAYS / RANGE';
  }

  const ma200Str = ma200 != null ? ` | MA200: $${Math.round(ma200).toLocaleString()}` : '';
  const statusStr = `${regimeLabel} (Giá ${above50 ? '>' : '<'} MA50: $${Math.round(ma50).toLocaleString()}${ma200Str} • 30D: ${return30d >= 0 ? '+' : ''}${return30d.toFixed(1)}%)`;

  return {
    hasData: true,
    signal: trendScore,
    status: statusStr,
    ma50,
    ma200,
    slope50,
    return7d,
    return30d,
    return90d,
    realizedVol30d,
    regimeLabel,
  };
}

export function parseToDate(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  if (typeof val === 'number') {
    if (val < 1e11) return new Date(val * 1000);
    return new Date(val);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Match DD/MM/YY or DD/MM/YYYY
    const ddmmyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (ddmmyyMatch) {
      const day = parseInt(ddmmyyMatch[1], 10);
      const month = parseInt(ddmmyyMatch[2], 10) - 1;
      let year = parseInt(ddmmyyMatch[3], 10);
      if (year < 100) year += 2000;
      const d = new Date(Date.UTC(year, month, day));
      if (!Number.isNaN(d.getTime())) return d;
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function getDaysAgo(val, referenceTime = Date.now()) {
  const d = parseToDate(val);
  if (!d) return null;
  const ref = typeof referenceTime === 'number' ? referenceTime : new Date(referenceTime).getTime();
  const diffMs = ref - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function calculateDataFreshness(data, etfHistory = [], referenceTime = Date.now()) {
  const sources = [];

  // 1. BTC Price Freshness
  const priceTs = data?.btc?.lastUpdated || data?.btc?.timestamp;
  let priceUpdatedStr = 'Live (WS)';
  if (priceTs) {
    const minAgo = Math.max(0, Math.floor((referenceTime - new Date(priceTs).getTime()) / (60 * 1000)));
    priceUpdatedStr = minAgo <= 1 ? 'Vừa xong (Live)' : `${minAgo}m`;
  }

  // 2. Spot ETF Flow
  const isEtfFallback = !Array.isArray(etfHistory) || etfHistory.length === 0 || etfHistory.isFallback === true || etfHistory.status === 'FALLBACK' || etfHistory.source === 'STATIC_BUNDLE';
  if (isEtfFallback) {
    sources.push({ key: 'etf', name: 'Spot ETF Flows', status: 'FALLBACK', ageDays: null, label: 'ETF (Fallback)' });
  } else {
    const latestEtf = etfHistory[etfHistory.length - 1];
    const etfDate = etfHistory.lastObservationDate || latestEtf?.date;
    const days = getDaysAgo(etfDate, referenceTime);
    sources.push({
      key: 'etf',
      name: 'Spot ETF Flows',
      status: 'REAL',
      ageDays: days,
      label: days != null ? (days === 0 ? 'ETF Nay' : `ETF ${days}d`) : 'ETF Live'
    });
  }

  // 3. CME COT
  const isCotFallback = !data?.cotData?.assetManager || isItemFallback(data?.cotData);
  if (isCotFallback) {
    sources.push({ key: 'cot', name: 'CME COT', status: 'FALLBACK', ageDays: null, label: 'COT (Fallback)' });
  } else {
    const cotDate = data.cotData.rawDate || data.cotData.date;
    const days = getDaysAgo(cotDate, referenceTime);
    sources.push({
      key: 'cot',
      name: 'CME COT',
      status: 'REAL',
      ageDays: days,
      label: days != null ? (days === 0 ? 'COT Nay' : `COT ${days}d`) : 'COT Live'
    });
  }

  // 4. On-Chain Metrics (MVRV / Mining)
  const isOnChainFallback = isItemFallback(data?.onChainMetrics);
  if (isOnChainFallback) {
    sources.push({ key: 'onchain', name: 'On-Chain MVRV', status: 'FALLBACK', ageDays: null, label: 'On-chain (Fallback)' });
  } else if (data?.onChainMetrics?.date || data?.onChainMetrics?.time) {
    const onChainDate = data.onChainMetrics.date || data.onChainMetrics.time;
    const days = getDaysAgo(onChainDate, referenceTime);
    sources.push({
      key: 'onchain',
      name: 'On-Chain MVRV',
      status: 'REAL',
      ageDays: days,
      label: days != null ? (days === 0 ? 'On-chain Nay' : `On-chain ${days}d`) : 'On-chain Live'
    });
  }

  // 5. Macro (FRED Net Liquidity / CPI / Yield)
  const isNetLiqFallback = isItemFallback(data?.netLiquidity) || data?.netLiquidityIsFallback;
  if (!isNetLiqFallback && data?.netLiquidity?.date) {
    const days = getDaysAgo(data.netLiquidity.date, referenceTime);
    sources.push({
      key: 'macro',
      name: 'US Net Liquidity',
      status: 'REAL',
      ageDays: days,
      label: days != null ? (days === 0 ? 'Macro Nay' : `Macro ${days}d`) : 'Macro Live'
    });
  }

  // Find oldest among valid, active non-fallback sources
  const validSources = sources.filter(s => s.status === 'REAL' && s.ageDays != null);
  let oldestDataStr = 'Live (<1d)';
  let oldestSource = null;

  if (validSources.length > 0) {
    validSources.sort((a, b) => b.ageDays - a.ageDays);
    oldestSource = validSources[0];
    oldestDataStr = oldestSource.label;
  } else if (sources.some(s => s.status === 'FALLBACK')) {
    oldestDataStr = 'Data: Fallback';
  }

  return {
    priceUpdatedStr,
    oldestDataStr,
    oldestSource,
    sources
  };
}

export function evaluateBiasPriceConfirmation(biasScore, btcChange24h) {
  const score = toFiniteNumber(biasScore) ?? 0;
  const chg = toFiniteNumber(btcChange24h) ?? 0;

  const isBiasBull = score >= 15;
  const isBiasBear = score <= -15;
  const isPriceUp = chg >= 0.5;
  const isPriceDown = chg <= -0.5;

  if (isBiasBull && isPriceUp) {
    return {
      state: 'CONFIRMED_BULLISH',
      biasDirection: 'BULLISH',
      priceDirection: 'UP',
      label: 'Bullish được price xác nhận',
      shortLabel: 'XÁC NHẬN TĂNG ▲',
      description: 'Động lực định lượng đa tầng (định chế, on-chain, vĩ mô) và hành vi giá 24h đồng thuận hướng tăng.',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.3)',
      icon: 'check-circle'
    };
  }

  if (isBiasBull && isPriceDown) {
    return {
      state: 'BULLISH_DIVERGENCE',
      biasDirection: 'BULLISH',
      priceDirection: 'DOWN',
      label: 'Bullish divergence — thesis chưa được xác nhận',
      shortLabel: 'PHÂN KỲ TĂNG ⚡',
      description: 'Bias định lượng tích cực nhưng giá 24h đang giảm. Dòng tiền ngầm/vĩ mô tích lũy nhưng thesis chưa phản ánh vào giá.',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.12)',
      border: 'rgba(245, 158, 11, 0.3)',
      icon: 'alert-triangle'
    };
  }

  if (isBiasBear && isPriceUp) {
    return {
      state: 'BEARISH_DIVERGENCE',
      biasDirection: 'BEARISH',
      priceDirection: 'UP',
      label: 'Bearish divergence — cảnh giác',
      shortLabel: 'PHÂN KỲ GIẢM ⚠',
      description: 'Giá 24h tăng nhưng Bias định lượng vĩ mô/on-chain đang yếu hoặc âm. Cảnh giác bẫy tăng giá (bull trap).',
      color: '#f43f5e',
      bg: 'rgba(244, 63, 94, 0.12)',
      border: 'rgba(244, 63, 94, 0.3)',
      icon: 'alert-circle'
    };
  }

  if (isBiasBear && isPriceDown) {
    return {
      state: 'CONFIRMED_BEARISH',
      biasDirection: 'BEARISH',
      priceDirection: 'DOWN',
      label: 'Bearish được price xác nhận',
      shortLabel: 'XÁC NHẬN GIẢM ▼',
      description: 'Cả Bias định lượng và hành vi giá 24h đều đồng thuận hướng giảm. Áp lực bán chiếm ưu thế.',
      color: '#f87171',
      bg: 'rgba(248, 113, 113, 0.12)',
      border: 'rgba(248, 113, 113, 0.3)',
      icon: 'trending-down'
    };
  }

  return {
    state: 'NEUTRAL_ALIGNED',
    biasDirection: 'NEUTRAL',
    priceDirection: isPriceUp ? 'UP' : isPriceDown ? 'DOWN' : 'FLAT',
    label: 'Thị trường cân bằng / Chưa có phân kỳ',
    shortLabel: 'TRUNG LẬP ⚖',
    description: 'Tín hiệu Bias và giá dao động trong biên độ trung tính, thị trường đang tích lũy hoặc chờ chất xúc tác mới.',
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.1)',
    border: 'rgba(148, 163, 184, 0.25)',
    icon: 'activity'
  };
}

function isItemFallback(item) {
  if (item == null) return false;
  if (typeof item === 'object') {
    return item.isFallback === true || item.status === 'FALLBACK' || item.status === 'UNAVAILABLE';
  }
  return false;
}

function getReadyAggregateSeries(data, market, timeframe) {
  const series = data?.aggregatedOrderFlow?.[market]?.[timeframe];
  return series?.isBiasReady === true ? series : null;
}

function divergenceAdjustment(divergence, market) {
  if (!divergence || divergence.market !== market) return 0;
  if (divergence.type === 'bullish_divergence') return 0.12;
  if (divergence.type === 'bearish_divergence') return -0.12;
  return 0;
}

export function calculateMarketBias(data, etfHistory = [], options = {}) {
  const currentPrice = options?.livePrice ?? data?.btc?.price ?? null;
  const currentChange = options?.liveChange ?? data?.btc?.change ?? 0;
  const refTime = options?.referenceTime ?? Date.now();

  const freshness = calculateDataFreshness(data, etfHistory, refTime);

  if (!data) {
    const confirmation = evaluateBiasPriceConfirmation(0, currentChange);
    return {
      score: 0,
      label: 'NEUTRAL',
      color: 'var(--text-slate-400)',
      confidence: 0,
      calendarRisk: 'LOW',
      pillars: { institutional: 0, onChain: 0, newsRisk: 0, microstructure: 0 },
      signals: [],
      upcomingEvents: [],
      freshness,
      confirmation,
      priceContext: {
        price: currentPrice,
        change: currentChange,
        high: null,
        low: null,
        volume: null,
      },
      regime: {
        valuation: 'FAIR_VALUE',
        trend: 'UNKNOWN',
        liquidity: 'NEUTRAL',
        tactical: 'BALANCED',
        details: {},
      },
    };
  }

  const signals = [];
  let availableWeight = 0;
  let calendarRiskLevel = 'LOW';
  const upcomingEvents = [];

  // ----------------------------------------------------
  // PILLAR 1: INSTITUTIONAL FLOWS & CAPITAL (40%)
  // ----------------------------------------------------
  let instScoreSum = 0;

  // 1A. Spot ETF 7-Day Net Flow (28%)
  const isEtfFallback = etfHistory?.isFallback === true || etfHistory?.status === 'FALLBACK' || etfHistory?.source === 'STATIC_BUNDLE';
  if (Array.isArray(etfHistory) && etfHistory.length > 0 && !isEtfFallback) {
    const allFlows = etfHistory.map((item) => toFiniteNumber(item.flow)).filter((flow) => flow != null);
    const last7 = allFlows.slice(-7);
    const sum7d = last7.reduce((acc, flow) => acc + flow, 0);
    const flowStr = `${sum7d >= 0 ? '+' : ''}$${sum7d.toFixed(1)}M`;

    let etfSignal = 0;
    let etfStatus = 'No data';
    if (sum7d > 800) { etfSignal = 1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Gom rất mạnh)`; }
    else if (sum7d > 250) { etfSignal = 0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Vào ổn định)`; }
    else if (sum7d > -250) { etfSignal = 0.0; etfStatus = `ETF Flow 7D: ${flowStr} (Đi ngang)`; }
    else if (sum7d > -800) { etfSignal = -0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Rút nhẹ)`; }
    else { etfSignal = -1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Rút rất mạnh)`; }

    const typicalDailyFlow = median(allFlows.map((flow) => Math.abs(flow)));
    if (typicalDailyFlow != null && last7.length > 0) {
      etfSignal = clamp(Math.tanh(sum7d / Math.max(250, typicalDailyFlow * 3)));
      etfStatus = `ETF Flow 7D: ${flowStr}`;
    }

    instScoreSum += etfSignal * 0.28;
    availableWeight += 0.28;
    signals.push({ name: 'ETF 7D Net Flow', weight: '28%', score: etfSignal * 28, status: etfStatus, pillar: 'institutional' });
  } else if (isEtfFallback) {
    signals.push({ name: 'ETF 7D Net Flow', weight: '0% (FALLBACK)', score: 0, status: 'Dữ liệu ETF fallback / tĩnh (loại khỏi tính điểm)', pillar: 'institutional', isFallback: true });
  }

  // 1B. CME COT Institutional Flow (12%)
  const isCotFallback = isItemFallback(data.cotData) || data.cotData?.isFallback === true;
  if (data.cotData?.assetManager && !isCotFallback) {
    const netPos = toFiniteNumber(data.cotData.assetManager.net);
    const netChange = toFiniteNumber(data.cotData.assetManager.netChange);
    if (netPos != null) {
      let cotSignal = 0;
      let cotStatus = 'No data';
      if (netPos > 3000) { cotSignal = 1.0; cotStatus = `CME Asset Mgr Net +${netPos} (Long áp đảo)`; }
      else if (netPos > 1000) { cotSignal = 0.5; cotStatus = `CME Asset Mgr Net +${netPos} (Long ưu thế)`; }
      else if (netPos > -1000) { cotSignal = 0.0; cotStatus = `CME Asset Mgr Net ${netPos} (Cân bằng)`; }
      else if (netPos > -3000) { cotSignal = -0.5; cotStatus = `CME Asset Mgr Net ${netPos} (Short ưu thế)`; }
      else { cotSignal = -1.0; cotStatus = `CME Asset Mgr Net ${netPos} (Short áp đảo)`; }

      if (netChange != null) {
        if (netChange > 500 && cotSignal >= 0) cotSignal = Math.min(1.0, cotSignal + 0.2);
        else if (netChange < -500 && cotSignal <= 0) cotSignal = Math.max(-1.0, cotSignal - 0.2);
      }

      instScoreSum += cotSignal * 0.12;
      availableWeight += 0.12;
      signals.push({ name: 'CME COT Flow', weight: '12%', score: cotSignal * 12, status: cotStatus, pillar: 'institutional' });
    }
  } else if (isCotFallback) {
    signals.push({ name: 'CME COT Flow', weight: '0% (FALLBACK)', score: 0, status: 'Dữ liệu CME COT fallback / chưa cập nhật (loại khỏi tính điểm)', pillar: 'institutional', isFallback: true });
  }

  // ----------------------------------------------------
  // PILLAR 2: ON-CHAIN FUNDAMENTALS & NETWORK (25%)
  // ----------------------------------------------------
  let onChainScoreSum = 0;
  const mvrv = !isItemFallback(data.onChainMetrics) ? toFiniteNumber(data.onChainMetrics?.mvrv) : null;

  // 2A. MVRV Ratio (Single Valuation Anchor - 8%)
  if (mvrv != null) {
    let mvrvSignal = 0;
    let mvrvStatus = 'No data';
    if (mvrv < 1.0) { mvrvSignal = 1.0; mvrvStatus = `MVRV ${mvrv} (Rất rẻ / Vùng đáy)`; }
    else if (mvrv < 1.4) { mvrvSignal = 0.7; mvrvStatus = `MVRV ${mvrv} (Vùng tích lũy tốt)`; }
    else if (mvrv < 2.2) { mvrvSignal = 0.2; mvrvStatus = `MVRV ${mvrv} (Định giá hợp lý)`; }
    else if (mvrv < 2.8) { mvrvSignal = -0.3; mvrvStatus = `MVRV ${mvrv} (Giá hơi cao)`; }
    else { mvrvSignal = -1.0; mvrvStatus = `MVRV ${mvrv} (Vùng giá quá nóng / Quá định giá)`; }

    mvrvSignal = clamp(-Math.tanh((mvrv - 2.0) / 0.75));
    onChainScoreSum += mvrvSignal * 0.08;
    availableWeight += 0.08;
    signals.push({ name: 'MVRV Valuation Ratio', weight: '8%', score: mvrvSignal * 8, status: mvrvStatus, pillar: 'onChain' });
  }

  // 2B. SSR (Stablecoin Supply Ratio) Oscillator (5%)
  const isSsrFallback = isItemFallback(data.ssrMa) || isItemFallback(data.stablecoins);
  const p = data.btc?.price;
  const m = (typeof data.ssrMa === 'object' && data.ssrMa?.stablecoinTotal) || data.stablecoins?.total;
  if (!isSsrFallback && p && m && typeof data.ssrMa === 'object' && data.ssrMa?.ma200) {
    let ssrSignal = 0;
    let ssrStatus = 'No data';
    const ssr = (p * 19740000) / m;
    const z = data.ssrMa.stdDev200 > 0 ? (ssr - data.ssrMa.ma200) / data.ssrMa.stdDev200 : 0;
    if (z < -2) { ssrSignal = 1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Oversold - Sức mua chờ lớn)`; }
    else if (z < -1) { ssrSignal = 0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Sức mua mạnh)`; }
    else if (z < 1) { ssrSignal = 0.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Bình thường)`; }
    else if (z < 2) { ssrSignal = -0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Cạn sức mua)`; }
    else { ssrSignal = -1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Overheated - Hết tiền mua)`; }
     
    onChainScoreSum += ssrSignal * 0.05;
    availableWeight += 0.05;
    signals.push({ name: 'Stablecoin Supply Ratio (SSR)', weight: '5%', score: ssrSignal * 5, status: ssrStatus, pillar: 'onChain' });
  }

  // 2C. Active Addresses (4%)
  if (!isItemFallback(data.onChainMetrics) && data.onChainMetrics?.activeAddresses) {
    const addrs = toFiniteNumber(data.onChainMetrics.activeAddresses);
    if (addrs != null && addrs > 0) {
      let addrSignal = 0;
      let addrStatus = 'No data';
      if (addrs > 1000000) { addrSignal = 1.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng cực sôi động)`; }
      else if (addrs > 850000) { addrSignal = 0.5; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng hoạt động tốt)`; }
      else if (addrs > 700000) { addrSignal = 0.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng bình thường)`; }
      else { addrSignal = -0.6; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng suy giảm hoạt động)`; }

      onChainScoreSum += addrSignal * 0.04;
      availableWeight += 0.04;
      signals.push({ name: 'Active Addresses Activity', weight: '4%', score: addrSignal * 4, status: addrStatus, pillar: 'onChain' });
    }
  }

  // 2D. Mining Production Cost Floor (4%)
  const diffInput = !isItemFallback(data.onChain) ? toFiniteNumber(data.onChain?.difficultyRaw ?? data.onChain?.difficulty) : null;
  if (data.btc?.price > 0 && diffInput != null && diffInput > 0) {
    // Normalize difficulty: if in Trillion units (< 1e6), multiply by 1e12
    const rawDiff = diffInput < 1e6 ? diffInput * 1e12 : diffInput;
    const hashRateEH = (rawDiff * Math.pow(2, 32)) / (600 * 1e18);
    const estCostMid = Math.round(hashRateEH * 420 + 38000);
    const priceToCostRatio = data.btc.price / (estCostMid || 65000);

    let miningSignal = 0;
    let miningStatus = 'No data';
    if (priceToCostRatio < 1.05) { miningSignal = 1.0; miningStatus = `Giá sát phí đào ~$${(estCostMid/1000).toFixed(0)}k (Đáy hỗ trợ thợ đào)`; }
    else if (priceToCostRatio < 1.30) { miningSignal = 0.5; miningStatus = `Biên lợi nhuận thợ đào thấp (Vùng an toàn)`; }
    else if (priceToCostRatio < 1.80) { miningSignal = 0.0; miningStatus = `Lợi nhuận thợ đào bình thường`; }
    else { miningSignal = -0.5; miningStatus = `Lợi nhuận thợ đào rất cao (Rủi ro xả)`; }

    onChainScoreSum += miningSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'Mining Cost Floor', weight: '4%', score: miningSignal * 4, status: miningStatus, pillar: 'onChain' });
  }

  // 2E. On-chain Network Transaction Demand (4%)
  const isTxFallback = isItemFallback(data.onChainMetrics) && isItemFallback(data.onChain);
  const txCount = !isTxFallback ? toFiniteNumber(data.onChainMetrics?.txCount ?? data.onChain?.txCount24h) : null;
  if (txCount != null && txCount > 0) {
    let txSignal = 0;
    let txStatus = 'No data';
    if (txCount > 500000) { txSignal = 0.8; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch rất cao)`; }
    else if (txCount > 350000) { txSignal = 0.3; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch ổn định)`; }
    else if (txCount > 250000) { txSignal = -0.2; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch trung bình)`; }
    else { txSignal = -0.7; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch thấp)`; }

    onChainScoreSum += txSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'Network Transaction Demand', weight: '4%', score: txSignal * 4, status: txStatus, pillar: 'onChain' });
  }

  // ----------------------------------------------------
  // PILLAR 3: MACRO LIQUIDITY & RISK SHOCK (20%)
  // ----------------------------------------------------
  let newsRiskScoreSum = 0;

  // 3A. Monetary Policy & Real Rates Pulse (6%)
  const fedVal = !isItemFallback(data.fedFundsRate) ? toFiniteNumber(data.fedFundsRate?.val ?? data.fedFundsRate) : null;
  const rawCpi = !isItemFallback(data.cpi) ? toFiniteNumber(data.cpi?.val ?? data.cpi) : null;
  // Safeguard: CPI must be YoY percentage (e.g. 0-20%), not raw index level (> 50)
  const cpiVal = (rawCpi != null && rawCpi <= 50) ? rawCpi : null;
  const unrateVal = !isItemFallback(data.unrate) ? toFiniteNumber(data.unrate?.val ?? data.unrate) : null;
  
  if (fedVal != null || cpiVal != null || unrateVal != null) {
    let mScore = 0;
    let count = 0;
    const desc = [];
    
    if (fedVal != null) {
      if (fedVal > 5.0) { mScore -= 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Thắt chặt)`); }
      else if (fedVal < 3.5) { mScore += 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Nới lỏng)`); }
      else { desc.push(`Fed ${fedVal.toFixed(1)}%`); }
      count++;
    }
    if (cpiVal != null) {
      if (cpiVal > 3.5) { mScore -= 0.8; desc.push(`CPI ${cpiVal.toFixed(1)}% (Cao)`); }
      else if (cpiVal < 2.5) { mScore += 0.5; desc.push(`CPI ${cpiVal.toFixed(1)}% (Hạ nhiệt)`); }
      else { desc.push(`CPI ${cpiVal.toFixed(1)}%`); }
      count++;
    }
    if (unrateVal != null) {
      if (unrateVal > 4.5) { mScore -= 0.5; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Rủi ro suy thoái)`); }
      else if (unrateVal < 4.0) { mScore += 0.3; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Việc làm khỏe)`); }
      else { desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}%`); }
      count++;
    }
    if (fedVal != null && cpiVal != null) {
      const realRate = fedVal - cpiVal;
      if (realRate > 2.5) { mScore -= 0.3; desc.push(`Real Rate +${realRate.toFixed(1)}% (Áp lực vốn)`); }
      else if (realRate < 0.5) { mScore += 0.3; desc.push(`Real Rate ${realRate.toFixed(1)}% (Hỗ trợ định giá)`); }
    }
    
    const macroPulseSignal = count > 0 ? clamp(mScore / count) : 0;
    const macroPulseStatus = desc.length > 0 ? desc.join(' • ') : 'Macro ổn định';
    
    newsRiskScoreSum += macroPulseSignal * 0.06;
    availableWeight += 0.06;
    signals.push({ name: 'Monetary Policy Pulse', weight: '6%', score: macroPulseSignal * 6, status: macroPulseStatus, pillar: 'newsRisk' });
  }

  // 3B. US Net Liquidity & Credit Stress (5%)
  const isNetLiqFallback = isItemFallback(data.netLiquidity) || data.netLiquidityIsFallback === true;
  const netLiq = !isNetLiqFallback ? toFiniteNumber(data.netLiquidity?.val ?? data.netLiquidity) : null;
  const hySpread = !isItemFallback(data.highYield) ? toFiniteNumber(data.highYield?.val ?? data.highYield) : null;
  const m2 = !isItemFallback(data.m2Supply) ? toFiniteNumber(data.m2Supply?.val ?? data.m2Supply) : null;

  if (netLiq != null || hySpread != null || m2 != null) {
    let lScore = 0;
    let lCount = 0;
    const lDesc = [];

    if (netLiq != null) {
      // Net liquidity in Billions USD (Fed balance sheet - TGA - RRP)
      if (netLiq > 6200) { lScore += 0.7; lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T (Mở rộng)`); }
      else if (netLiq < 5500) { lScore -= 0.7; lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T (Co hẹp)`); }
      else { lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T`); }
      lCount++;
    }

    if (hySpread != null) {
      if (hySpread < 3.5) { lScore += 0.6; lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Tín dụng khỏe)`); }
      else if (hySpread > 4.5) { lScore -= 0.8; lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Credit Stress)`); }
      else { lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Bình thường)`); }
      lCount++;
    }

    if (m2 != null) {
      if (m2 > 21500) { lScore += 0.4; lDesc.push(`M2 $${(m2/1000).toFixed(1)}T`); }
      else { lDesc.push(`M2 $${(m2/1000).toFixed(1)}T`); }
      lCount++;
    }

    const liqSignal = lCount > 0 ? clamp(lScore / lCount) : 0;
    const liqStatus = lDesc.length > 0 ? lDesc.join(' • ') : 'Thanh khoản bình thường';

    newsRiskScoreSum += liqSignal * 0.05;
    availableWeight += 0.05;
    signals.push({ name: 'US Net Liquidity & Credit', weight: '5%', score: liqSignal * 5, status: liqStatus, pillar: 'newsRisk' });
  }

  // 3C. Global Currency (DXY) & US 10Y Yield (4%)
  const dxyVal = !isItemFallback(data.dxy) ? toFiniteNumber(data.dxy?.price ?? data.dxy?.val ?? data.dxy) : null;
  const yield10yVal = !isItemFallback(data.tenYearYield) ? toFiniteNumber(data.tenYearYield?.val ?? data.tenYearYield) : null;

  if (dxyVal != null || yield10yVal != null) {
    let dyScore = 0;
    let dyCount = 0;
    const dyDesc = [];

    if (dxyVal != null) {
      if (dxyVal > 105) { dyScore -= 0.8; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD rất mạnh / Hút vốn)`); }
      else if (dxyVal > 103) { dyScore -= 0.3; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD hơi cao)`); }
      else if (dxyVal < 100) { dyScore += 0.8; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD suy yếu / Risk-On)`); }
      else { dyDesc.push(`DXY ${dxyVal.toFixed(1)} (Ổn định)`); }
      dyCount++;
    }

    if (yield10yVal != null) {
      if (yield10yVal > 4.5) { dyScore -= 0.8; dyDesc.push(`10Y ${yield10yVal.toFixed(2)}% (Lợi suất đè nặng)`); }
      else if (yield10yVal < 3.8) { dyScore += 0.6; dyDesc.push(`10Y ${yield10yVal.toFixed(2)}% (Chi phí vốn giảm)`); }
      else { dyDesc.push(`10Y ${yield10yVal.toFixed(2)}%`); }
      dyCount++;
    }

    const dxyYieldSignal = dyCount > 0 ? clamp(dyScore / dyCount) : 0;
    const dxyYieldStatus = dyDesc.length > 0 ? dyDesc.join(' • ') : 'Tỷ giá & lợi suất cân bằng';

    newsRiskScoreSum += dxyYieldSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'DXY & US 10Y Yield', weight: '4%', score: dxyYieldSignal * 4, status: dxyYieldStatus, pillar: 'newsRisk' });
  }

  // 3D. Equities Risk Appetite (S&P 500 / Nasdaq) (2%)
  const isSpFallback = isItemFallback(data.sp500);
  const isQqqFallback = isItemFallback(data.qqq);
  const spChg = !isSpFallback ? toFiniteNumber(data.sp500?.changePercent) : null;
  const qqqChg = !isQqqFallback ? toFiniteNumber(data.qqq?.changePercent) : null;

  if (spChg != null || qqqChg != null) {
    const avgChg = ((spChg ?? 0) + (qqqChg ?? 0)) / ((spChg != null && qqqChg != null) ? 2 : 1);
    const eqSignal = clamp(avgChg / 1.5);
    const eqStatus = `S&P500 ${spChg != null ? (spChg >= 0 ? '+' : '') + spChg.toFixed(2) + '%' : '---'} • QQQ ${qqqChg != null ? (qqqChg >= 0 ? '+' : '') + qqqChg.toFixed(2) + '%' : '---'} (Khẩu vị rủi ro chứng khoán)`;

    newsRiskScoreSum += eqSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Wall Street Risk Appetite', weight: '2%', score: eqSignal * 2, status: eqStatus, pillar: 'newsRisk' });
  }

  // 3E. VIX Volatility & 24h Calendar Event Shock (3%)
  let vixSignal = 0;
  let vixStatus = 'No data';
  const vixVal = !isItemFallback(data.vix) ? toFiniteNumber(data.vix?.price ?? data.vix?.val ?? data.vix) : null;
  
  if (vixVal != null && vixVal > 0) {
    if (vixVal < 15) { vixSignal = 0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-On ổn định)`; }
    else if (vixVal < 20) { vixSignal = 0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Biến động bình thường)`; }
    else if (vixVal < 25) { vixSignal = -0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Căng thẳng nhẹ)`; }
    else if (vixVal < 32) { vixSignal = -0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-Off hoảng loạn)`; }
    else { vixSignal = -1.0; vixStatus = `VIX ${vixVal.toFixed(1)} (Khủng hoảng tâm lý)`; }
  }

  // Check 24h High Impact Events
  if (Array.isArray(data.news)) {
    const now = Date.now();
    const highImpactCalendarEvents = data.news.filter((n) => {
      if (!n.tag?.includes('Calendar')) return false;
      const t = new Date(n.time).getTime();
      return t - now > 0 && t - now <= 24 * 60 * 60 * 1000;
    });

    if (highImpactCalendarEvents.length > 0) {
      calendarRiskLevel = 'HIGH';
      highImpactCalendarEvents.forEach((e) => {
        upcomingEvents.push({
          title: e.title.replace('[LỊCH SỰ KIỆN]', '').trim(),
          time: e.time,
          tag: e.tag,
        });
      });
      // Dampen risk shock when high impact event is within 24h
      vixSignal = Math.min(vixSignal, -0.4);
      vixStatus = `${vixStatus} • ⚠ Lịch High Impact trong 24h: ${upcomingEvents[0]?.title || 'Sự kiện vĩ mô'}`;
    }
  }

  if (vixVal != null || upcomingEvents.length > 0) {
    newsRiskScoreSum += vixSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'VIX & Calendar Shock', weight: '3%', score: vixSignal * 3, status: vixStatus, pillar: 'newsRisk' });
  }

  // ----------------------------------------------------
  // PILLAR 4: MARKET MICROSTRUCTURE & BTC TREND REGIME (15%)
  // ----------------------------------------------------
  let microScoreSum = 0;
  const btcVolume = toFiniteNumber(data.btc?.volume);

  // 4A. BTC Trend & Price Regime (3%)
  const dailyKlines = data.btcDailyKlinesAll ?? data.dailyKlines ?? data.klines;
  const trendRegime = calculateBtcTrendRegime(dailyKlines, data.btc?.price);
  if (trendRegime.hasData) {
    microScoreSum += trendRegime.signal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'BTC Trend Regime (Daily MA)', weight: '3%', score: trendRegime.signal * 3, status: trendRegime.status, pillar: 'microstructure' });
  }

  // 4B. Spot CVD (24h, 7d, 30d) (3%)
  // Multi-exchange raw trades replace the matching Binance window only after its coverage/freshness gate passes.
  const aggregateSpot24 = getReadyAggregateSeries(data, 'spot', '24H');
  const aggregateSpot7d = getReadyAggregateSeries(data, 'spot', '7D');
  const aggregateSpot30d = getReadyAggregateSeries(data, 'spot', '30D');
  const spot24 = extractCvdNetDelta(aggregateSpot24) ?? (!isItemFallback(data.cvdHistory24hSpot) ? extractCvdNetDelta(data.cvdHistory24hSpot) : null);
  const spot7d = extractCvdNetDelta(aggregateSpot7d) ?? extractCvdNetDelta(data.cvdHistory7dSpot);
  const spot30d = extractCvdNetDelta(aggregateSpot30d) ?? extractCvdNetDelta(data.cvdHistory30dSpot);
  const spotCvdSource = aggregateSpot24 ? 'MULTI-EXCHANGE RAW' : 'BINANCE';
  const aggregateDivergences = data?.aggregatedOrderFlow?.isReady
    ? (data.aggregatedOrderFlow.divergences || []).filter((event) => event?.coverage >= 70)
    : [];
  const spotDivergence = aggregateDivergences.find((event) => event.market === 'spot');
  let spotCvdSignal = 0;
  
  if (spot24 != null && btcVolume != null && btcVolume > 0) {
    let spotCvdStatus = 'No data';
    const cvdRatio = spot24 / btcVolume; 
    let baseScore = clamp(Math.tanh(cvdRatio / 0.05));
    if (spot7d != null) {
      if (spot7d > 0 && spot24 > 0) baseScore += 0.1;
      else if (spot7d < 0 && spot24 < 0) baseScore -= 0.1;
    }
    if (spot30d != null) {
      if (spot30d > 0 && spot24 > 0) baseScore += 0.1;
      else if (spot30d < 0 && spot24 < 0) baseScore -= 0.1;
    }
    baseScore += divergenceAdjustment(spotDivergence, 'spot');
    spotCvdSignal = clamp(baseScore);
    
    if (spotCvdSignal > 0.6) spotCvdStatus = 'Spot Gom Hàng Mạnh (+)';
    else if (spotCvdSignal > 0.2) spotCvdStatus = 'Spot Mua Ưu Thế';
    else if (spotCvdSignal > -0.2) spotCvdStatus = 'Spot Đi Ngang';
    else if (spotCvdSignal > -0.6) spotCvdStatus = 'Spot Bán Ưu Thế';
    else spotCvdStatus = 'Spot Xả Mạnh (-)';
    spotCvdStatus += ` · ${spotCvdSource}`;
    if (spotDivergence) spotCvdStatus += ` · ${spotDivergence.type === 'bullish_divergence' ? 'Bullish divergence xác nhận' : 'Bearish divergence xác nhận'}`;

    microScoreSum += spotCvdSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'Spot CVD (24h/7d/30d)', weight: '3%', score: spotCvdSignal * 3, status: spotCvdStatus, pillar: 'microstructure' });
  }

  // 4C. Futures CVD (24h, 7d, 30d) (2%)
  const aggregateFut24 = getReadyAggregateSeries(data, 'futures', '24H');
  const aggregateFut7d = getReadyAggregateSeries(data, 'futures', '7D');
  const aggregateFut30d = getReadyAggregateSeries(data, 'futures', '30D');
  const fut24 = extractCvdNetDelta(aggregateFut24) ?? (!isItemFallback(data.cvdHistory24h) ? extractCvdNetDelta(data.cvdHistory24h) : null);
  const fut7d = extractCvdNetDelta(aggregateFut7d) ?? extractCvdNetDelta(data.cvdHistory7d);
  const fut30d = extractCvdNetDelta(aggregateFut30d) ?? extractCvdNetDelta(data.cvdHistory30d);
  const futCvdSource = aggregateFut24 ? 'MULTI-EXCHANGE RAW' : 'BINANCE';
  const futDivergence = aggregateDivergences.find((event) => event.market === 'futures');
  
  if (fut24 != null && btcVolume != null && btcVolume > 0) {
    let futCvdStatus = 'No data';
    const cvdRatio = fut24 / btcVolume;
    let baseScore = clamp(Math.tanh(cvdRatio / 0.08));
    if (fut7d != null) {
      if (fut7d > 0 && fut24 > 0) baseScore += 0.1;
      else if (fut7d < 0 && fut24 < 0) baseScore -= 0.1;
    }
    if (fut30d != null) {
      if (fut30d > 0 && fut24 > 0) baseScore += 0.1;
      else if (fut30d < 0 && fut24 < 0) baseScore -= 0.1;
    }
    baseScore += divergenceAdjustment(futDivergence, 'futures');
    const futCvdSignal = clamp(baseScore);
    
    if (futCvdSignal > 0.6) futCvdStatus = 'Futures Long Chủ Đạo';
    else if (futCvdSignal > 0.2) futCvdStatus = 'Futures Nghiêng Long';
    else if (futCvdSignal > -0.2) futCvdStatus = 'Futures Cân Bằng';
    else if (futCvdSignal > -0.6) futCvdStatus = 'Futures Nghiêng Short';
    else futCvdStatus = 'Futures Short Chủ Đạo';
    futCvdStatus += ` · ${futCvdSource}`;
    if (futDivergence) futCvdStatus += ` · ${futDivergence.type === 'bullish_divergence' ? 'Bullish divergence xác nhận' : 'Bearish divergence xác nhận'}`;

    microScoreSum += futCvdSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Futures CVD (24h/7d/30d)', weight: '2%', score: futCvdSignal * 2, status: futCvdStatus, pillar: 'microstructure' });
  }

  const spotFuturesDivergence = aggregateDivergences.find((event) => event.market === 'cross');
  if (spotFuturesDivergence) {
    signals.push({
      name: 'Multi-Exchange Spot/Futures Divergence',
      weight: 'Context',
      score: 0,
      status: `${spotFuturesDivergence.timeframe?.toUpperCase() || '—'} · ${spotFuturesDivergence.evidence}`,
      pillar: 'microstructure',
    });
  }

  // 4D. Funding Rate & Leverage Confluence (2%)
  const isFrFallback = isItemFallback(data.fundingRate) || data.fundingRateIsFallback === true;
  const fr = !isFrFallback ? toFiniteNumber(data.fundingRate?.val ?? data.fundingRate) : null;
  if (fr != null) {
    let frSignal = 0;
    let frStatus = 'No data';
    const frPct = (fr * 100).toFixed(3) + '%';
    const isSpotBuying = spotCvdSignal > 0.1;
    const isSpotDumping = spotCvdSignal < -0.1;

    if (fr > 0.0005) {
      frSignal = isSpotDumping ? -1.0 : -0.7;
      frStatus = isSpotDumping ? `Extreme Long Crowding + Spot Xả (${frPct}) -> Trap` : `Overheated Longs (${frPct})`;
    } else if (fr > 0.0002) {
      frSignal = isSpotBuying ? 0.5 : 0.0;
      frStatus = `Bullish (${frPct})`;
    } else if (fr > 0.00005) {
      frSignal = 0.5;
      frStatus = `Bullish nhẹ (${frPct})`;
    } else if (fr > -0.00005) {
      frSignal = 0.0;
      frStatus = `Trung lập (${frPct})`;
    } else if (fr > -0.0002) {
      frSignal = isSpotBuying ? 0.3 : -0.5;
      frStatus = isSpotBuying ? `Shorts bị gom (${frPct})` : `Bearish (${frPct})`;
    } else {
      // Extreme negative funding
      if (isSpotBuying) {
        frSignal = 0.9;
        frStatus = `Extreme Shorts + Spot Gom (${frPct}) -> Squeeze Mạnh`;
      } else if (isSpotDumping) {
        frSignal = -0.9;
        frStatus = `Extreme Negative Funding + Spot Xả (${frPct}) -> Downtrend Thực`;
      } else {
        frSignal = 0.5;
        frStatus = `Extreme Shorts (${frPct}) -> Squeeze Potential`;
      }
    }

    microScoreSum += frSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Funding Rate Confluence', weight: '2%', score: frSignal * 2, status: frStatus, pillar: 'microstructure' });
  }

  // 4E. Open Interest Surge + Price Action (2%)
  const isOiFallback = isItemFallback(data.openInterest) || data.oiIsFallback === true;
  const currentOi = !isOiFallback ? toFiniteNumber(data.openInterest?.val ?? data.openInterest) : null;
  const prevOi = toFiniteNumber(data.oiHistory?.[0]?.sumOpenInterest ?? data.oiHistory?.[data.oiHistory.length - 1]?.sumOpenInterest);
  if (currentOi != null && prevOi != null && prevOi > 0) {
    let oiSignal = 0;
    let oiStatus = 'No data';
    const oiChangePct = prevOi > 0 ? ((currentOi - prevOi) / prevOi) * 100 : 0;
    const priceChange = data.btc?.change || 0;

    if (oiChangePct > 5 && priceChange > 2) { oiSignal = 1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price +${priceChange.toFixed(1)}% (Longs in)`; }
    else if (oiChangePct > 5 && priceChange < -2) { oiSignal = -1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price ${priceChange.toFixed(1)}% (Shorts in)`; }
    else if (oiChangePct > 2 && priceChange > 0) { oiSignal = 0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá tăng)`; }
    else if (oiChangePct > 2 && priceChange < 0) { oiSignal = -0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá giảm)`; }
    else if (oiChangePct < -5) { oiSignal = -0.2; oiStatus = `Deleveraging OI ${oiChangePct.toFixed(1)}%`; }
    else { oiSignal = 0.0; oiStatus = `OI ổn định (${oiChangePct >= 0 ? '+' : ''}${oiChangePct.toFixed(1)}%)`; }

    microScoreSum += oiSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Open Interest & Price', weight: '2%', score: oiSignal * 2, status: oiStatus, pillar: 'microstructure' });
  }

  // 4F. Fear & Greed Index (2%)
  const isFngFallback = isItemFallback(data.fngData) || data.fngData?.isFallback === true;
  const fng = !isFngFallback ? toFiniteNumber(data.fngData?.value ?? data.fngData?.val ?? data.fngData) : null;
  if (fng != null) {
    let fngSignal = 0;
    let fngStatus = 'No data';
    if (fng <= 20) { fngSignal = 1.0; fngStatus = `Fear & Greed ${fng} (Extreme Fear -> Mua tốt)`; }
    else if (fng <= 35) { fngSignal = 0.5; fngStatus = `Fear & Greed ${fng} (Fear)`; }
    else if (fng <= 65) { fngSignal = 0.0; fngStatus = `Fear & Greed ${fng} (Neutral)`; }
    else if (fng <= 80) { fngSignal = -0.5; fngStatus = `Fear & Greed ${fng} (Greed)`; }
    else { fngSignal = -1.0; fngStatus = `Fear & Greed ${fng} (Extreme Greed -> Quá nóng)`; }

    fngSignal = clamp((50 - fng) / 30);
    microScoreSum += fngSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Fear & Greed Index', weight: '2%', score: fngSignal * 2, status: fngStatus, pillar: 'microstructure' });
  }

  // 4G. Long/Short Ratio (1%)
  const isLsFallback = isItemFallback(data.lsHistory) || data.lsIsFallback === true;
  const lsFromHistory = Array.isArray(data.lsHistory) && data.lsHistory.length > 0
    ? toFiniteNumber(data.lsHistory[data.lsHistory.length - 1]?.longShortRatio)
    : null;
  const lsDirect = toFiniteNumber(data.longShortRatio ?? data.globalLs);
  const latestLs = !isLsFallback ? (lsFromHistory ?? lsDirect) : null;

  if (latestLs != null && latestLs > 0) {
    let lsSignal = 0;
    let lsStatus = 'No data';
    if (latestLs > 2.5) { lsSignal = -0.8; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Quá nhiều Longs)`; }
    else if (latestLs > 1.8) { lsSignal = -0.3; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng về Long)`; }
    else if (latestLs > 1.2) { lsSignal = 0.2; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Hợp lý)`; }
    else if (latestLs <= 0.8) { lsSignal = 0.6; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng Short -> Squeeze)`; }
    else { lsSignal = 0.0; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Cân bằng)`; }

    lsSignal = clamp((1 - latestLs) / 0.9);
    microScoreSum += lsSignal * 0.01;
    availableWeight += 0.01;
    signals.push({ name: 'Long/Short Ratio', weight: '1%', score: lsSignal * 1, status: lsStatus, pillar: 'microstructure' });
  }

  // ----------------------------------------------------
  // TOTAL SCORE COMPUTATION (ZERO-FALLBACK CONFIDENCE)
  // ----------------------------------------------------
  const totalWeightedRaw = instScoreSum + onChainScoreSum + newsRiskScoreSum + microScoreSum;
  
  const directionalScore = availableWeight > 0 ? (totalWeightedRaw / availableWeight) * 100 : 0;
  const confidencePct = Math.round(clamp(availableWeight / MAX_SCORING_WEIGHT, 0, 1) * 100);
  const clampedScore = clamp(Math.round(directionalScore * (confidencePct / 100)), -100, 100);

  let label = 'NEUTRAL';
  let color = 'var(--text-slate-400)';
  let bgGradient = 'rgba(148, 163, 184, 0.15)';

  if (confidencePct < 55) {
    label = 'LOW CONFIDENCE';
    color = 'var(--text-slate-400)';
    bgGradient = 'rgba(148, 163, 184, 0.15)';
  } else if (clampedScore >= 60) {
    label = 'STRONG BULL';
    color = 'var(--color-emerald-400)';
    bgGradient = 'rgba(16, 185, 129, 0.15)';
  } else if (clampedScore >= 25) {
    label = 'BULLISH';
    color = '#34d399';
    bgGradient = 'rgba(52, 211, 153, 0.12)';
  } else if (clampedScore <= -60) {
    label = 'STRONG BEAR';
    color = 'var(--color-rose-400)';
    bgGradient = 'rgba(244, 63, 94, 0.15)';
  } else if (clampedScore <= -25) {
    label = 'BEARISH';
    color = '#f87171';
    bgGradient = 'rgba(248, 113, 113, 0.12)';
  } else {
    label = 'NEUTRAL';
    color = 'var(--text-contrast)';
    bgGradient = 'rgba(148, 163, 184, 0.12)';
  }

  // ----------------------------------------------------
  // THREE-LAYER BIAS REGIME METADATA
  // ----------------------------------------------------
  let valuationRegime = 'FAIR_VALUE';
  if (mvrv != null) {
    if (mvrv < 1.0) valuationRegime = 'DEEP_VALUE';
    else if (mvrv < 1.4) valuationRegime = 'UNDERVALUED';
    else if (mvrv < 2.2) valuationRegime = 'FAIR_VALUE';
    else if (mvrv < 2.8) valuationRegime = 'HEATED';
    else valuationRegime = 'OVERHEATED';
  }

  let liquidityRegime = 'NEUTRAL';
  if (netLiq != null || hySpread != null) {
    if ((netLiq && netLiq > 6100) || (hySpread && hySpread < 3.5)) liquidityRegime = 'EXPANDING';
    else if ((netLiq && netLiq < 5500) || (hySpread && hySpread > 4.5)) liquidityRegime = 'CONTRACTING';
  }

  let tacticalRegime = 'BALANCED';
  if (spotCvdSignal > 0.4 && fr != null && fr < -0.0001) tacticalRegime = 'SHORT_SQUEEZE_WATCH';
  else if (spotCvdSignal < -0.4 && fr != null && fr > 0.0003) tacticalRegime = 'LONG_SQUEEZE_RISK';
  else if (spotCvdSignal > 0.3) tacticalRegime = 'SPOT_ACCUMULATION';
  else if (spotCvdSignal < -0.3) tacticalRegime = 'SPOT_DISTRIBUTION';

  const confirmation = evaluateBiasPriceConfirmation(clampedScore, currentChange);

  return {
    score: clampedScore,
    label,
    color,
    bgGradient,
    confidence: confidencePct,
    calendarRisk: calendarRiskLevel,
    pillars: {
      institutional: Math.round((instScoreSum / 0.40) * 100) || 0,
      onChain: Math.round((onChainScoreSum / 0.25) * 100) || 0,
      newsRisk: Math.round((newsRiskScoreSum / 0.20) * 100) || 0,
      microstructure: Math.round((microScoreSum / 0.15) * 100) || 0,
    },
    signals,
    upcomingEvents,
    freshness,
    confirmation,
    priceContext: {
      price: currentPrice,
      change: currentChange,
      high: data?.btc?.high ?? null,
      low: data?.btc?.low ?? null,
      volume: data?.btc?.volume ?? null,
    },
    regime: {
      valuation: valuationRegime,
      trend: trendRegime.regimeLabel,
      liquidity: liquidityRegime,
      tactical: tacticalRegime,
      details: {
        ma50: trendRegime.ma50,
        ma200: trendRegime.ma200,
        slope50: trendRegime.slope50,
        return7d: trendRegime.return7d,
        return30d: trendRegime.return30d,
        return90d: trendRegime.return90d,
        realizedVol30d: trendRegime.realizedVol30d,
        dxy: dxyVal,
        tenYearYield: yield10yVal,
        highYieldSpread: hySpread,
        netLiquidity: netLiq,
        vix: vixVal,
      },
    },
  };
}
