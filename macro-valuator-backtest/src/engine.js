/**
 * Macro Dashboard v2 — Valuator + PnL Matrix (Pine parity mode)
 * Extracted standalone calculation engine from src/services/macroDashboardEngine.js.
 * Zero external dependencies. Strictly causal (no lookahead).
 */

export const ZONES = Object.freeze({
  GIFT: 'GIFT',
  CHEAP: 'CHEAP',
  FAIR: 'FAIR',
  EXP: 'EXP',
  BUBBLE: 'BUBBLE',
});

export const ENGINE_MODES = Object.freeze({
  PINE_V2: 'pine_v2',
  MATH_V3: 'math_v3',
});

export const MACRO_DASHBOARD_DEFAULTS = Object.freeze({
  engineMode: 'pine_v2',
  timeframe: 'W',
  years: [1, 2, 3, 4],
  costMethod: 'SMA',
  weightScheme: 'Equal',
  zoneMethod: 'Percentile',
  percentileLookback: 208,
  pnlGift: 10,
  pnlCheap: 25,
  pnlExpensive: 75,
  pnlBubble: 90,
  convergenceRelativeSpread: 0.5,
  convergenceFloor: 10,
  convergenceGift: 0,
  convergenceBubble: 50,
  longLookback: 200,
  shortLookback: 100,
  useDualWindow: true,
  sigmaPeriod: 52,
  zMode: 'Structural',
  sigmaMethod: 'EWMA D²',
  valGift: -1.5,
  valCheap: -0.8,
  valExpensive: 0.8,
  valBubble: 1.5,
  useHysteresis: true,
  giftExit: -1,
  bubbleExit: 1,
  minBarsAlert: 2,
  bandK: 1,
  minTick: 0.01,
});

export const CHART_RANGES = Object.freeze(['6M', '1Y', '3Y', '5Y', 'ALL']);

export const chartBarsForRange = (range, timeframe = 'W') => {
  const normalizedRange = String(range || 'ALL').toUpperCase();
  if (normalizedRange === 'ALL') return Infinity;

  if (normalizedRange.endsWith('M')) {
    const months = Number.parseInt(normalizedRange, 10);
    if (!Number.isFinite(months) || months <= 0) return Infinity;
    const barsPerMonth = timeframe === 'D' ? 30.5 : timeframe === 'M' ? 1 : 52 / 12;
    return Math.round(months * barsPerMonth);
  }

  const years = Number.parseInt(normalizedRange, 10);
  if (!Number.isFinite(years) || years <= 0) return Infinity;
  const barsPerYear = timeframe === 'D' ? 365 : timeframe === 'M' ? 12 : 52;
  return years * barsPerYear;
};

const finite = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const mergeSettings = (settings = {}) => ({
  ...MACRO_DASHBOARD_DEFAULTS,
  ...settings,
  years: Array.isArray(settings.years)
    ? settings.years.slice(0, 4).map((value) => finite(value, 1))
    : [...MACRO_DASHBOARD_DEFAULTS.years],
});

const rollingSma = (values, period) => {
  const result = Array(values.length).fill(null);
  let sum = 0;
  let valid = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = finite(values[index]);
    if (value !== null) {
      sum += value;
      valid += 1;
    }

    const expiredIndex = index - period;
    if (expiredIndex >= 0) {
      const expired = finite(values[expiredIndex]);
      if (expired !== null) {
        sum -= expired;
        valid -= 1;
      }
    }

    if (index >= period - 1 && valid === period) result[index] = sum / period;
  }

  return result;
};

// Pine's recursive EMA form: alpha*source + (1-alpha)*previous EMA.
const ema = (values, period) => {
  const result = Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let previous = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = finite(values[index]);
    if (value === null) continue;
    previous = previous === null ? value : alpha * value + (1 - alpha) * previous;
    result[index] = previous;
  }

  return result;
};

// ta.stdev(source, length) uses biased=true by default, i.e. population variance.
const rollingPopulationStdev = (values, period) => {
  const result = Array(values.length).fill(null);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1).map((value) => finite(value));
    if (window.some((value) => value === null)) continue;
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period;
    result[index] = Math.sqrt(Math.max(variance, 0));
  }
  return result;
};

const weightsFor = (scheme) => {
  if (scheme === 'Short-heavy') return [0.4, 0.3, 0.2, 0.1];
  if (scheme === 'Long-heavy') return [0.1, 0.2, 0.3, 0.4];
  return [0.25, 0.25, 0.25, 0.25];
};

export const barsPerYear = (timeframe) => {
  if (timeframe === 'D') return 365;
  if (timeframe === 'M') return 12;
  return 52;
};

const zoneScore = (zone) => {
  if (zone === ZONES.GIFT) return 2;
  if (zone === ZONES.CHEAP) return 1;
  if (zone === ZONES.EXP) return -1;
  if (zone === ZONES.BUBBLE) return -2;
  return 0;
};

const actionFromScore = (score) => {
  if (score >= 3) return 'STRONG ACCUM';
  if (score >= 1) return 'ACCUMULATE';
  if (score <= -3) return 'STRONG DIST';
  if (score <= -1) return 'DISTRIBUTE';
  return 'NEUTRAL';
};

const olsAt = (closes, index, lookback, minTick) => {
  const length = Math.min(lookback, index + 1);
  if (length < 2) {
    return { a: Math.log(Math.max(closes[index], minTick)), b: 0, deviation: 0 };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let barsAgo = 0; barsAgo < length; barsAgo += 1) {
    const y = Math.log(Math.max(closes[index - barsAgo], minTick));
    sumX += barsAgo;
    sumY += y;
    sumXY += barsAgo * y;
    sumXX += barsAgo * barsAgo;
  }

  const denominator = length * sumXX - sumX * sumX;
  const b = denominator !== 0 ? (length * sumXY - sumX * sumY) / denominator : 0;
  const a = (sumY - b * sumX) / length;
  return {
    a,
    b,
    deviation: Math.log(Math.max(closes[index], minTick)) - a,
  };
};

const calculateValuatorSeries = (closes, settings, lookback) => {
  const regression = closes.map((_, index) => olsAt(closes, index, lookback, settings.minTick));
  const deviations = regression.map((row) => row.deviation);
  const deviationMean = ema(deviations, settings.sigmaPeriod);

  let sigma;
  if (settings.sigmaMethod === 'Rolling Std') {
    sigma = rollingPopulationStdev(deviations, settings.sigmaPeriod).map((value) => value ?? 0);
  } else {
    const varianceSource = deviations.map((deviation, index) => {
      if (settings.zMode === 'Adaptive') return (deviation - (deviationMean[index] ?? 0)) ** 2;
      return deviation ** 2;
    });
    sigma = ema(varianceSource, settings.sigmaPeriod).map((value) => Math.sqrt(Math.max(value ?? 0, 0)));
  }

  return regression.map((row, index) => {
    const currentSigma = sigma[index] ?? 0;
    const centeredDeviation = settings.zMode === 'Adaptive'
      ? row.deviation - (deviationMean[index] ?? 0)
      : row.deviation;
    const z = currentSigma > 0 ? centeredDeviation / currentSigma : 0;
    const fairValue = Math.exp(row.a);
    return {
      z,
      fairValue,
      versusFairValue: fairValue > 0 ? (closes[index] / fairValue - 1) * 100 : 0,
      cagr: (Math.exp(-row.b * barsPerYear(settings.timeframe)) - 1) * 100,
      deviation: row.deviation,
      sigma: currentSigma,
      bandUpper: fairValue * Math.exp(settings.bandK * currentSigma),
      bandLower: fairValue * Math.exp(-settings.bandK * currentSigma),
    };
  });
};

const costBasisSeries = (candles, period, method) => {
  const closes = candles.map((candle) => candle.close);
  if (method === 'EMA') return ema(closes, period);
  if (method === 'Median HL') {
    const highs = rollingSma(candles.map((candle) => candle.high), period);
    const lows = rollingSma(candles.map((candle) => candle.low), period);
    return highs.map((high, index) => (high === null || lows[index] === null ? null : (high + lows[index]) / 2));
  }
  if (method === 'VWAP') {
    const priceVolume = rollingSma(candles.map((candle) => candle.close * candle.volume), period);
    const volume = rollingSma(candles.map((candle) => candle.volume), period);
    const fallback = rollingSma(closes, period);
    return priceVolume.map((value, index) => {
      if (value === null || volume[index] === null) return null;
      return volume[index] > 0 ? value / volume[index] : fallback[index];
    });
  }
  return rollingSma(closes, period);
};

const pnlZoneAt = (metrics, settings) => {
  if (settings.zoneMethod === 'Convergence') {
    const converged = metrics.relativeSpread < settings.convergenceRelativeSpread;
    if (converged && metrics.roiMax < settings.convergenceGift) return ZONES.GIFT;
    if (converged && metrics.roiMin > settings.convergenceBubble) return ZONES.BUBBLE;
    if (metrics.roiMax < 0) return ZONES.CHEAP;
    if (metrics.roiMin > settings.convergenceBubble * 0.5) return ZONES.EXP;
    return ZONES.FAIR;
  }

  if (metrics.percentile < settings.pnlGift) return ZONES.GIFT;
  if (metrics.percentile < settings.pnlCheap) return ZONES.CHEAP;
  if (metrics.percentile > settings.pnlBubble) return ZONES.BUBBLE;
  if (metrics.percentile > settings.pnlExpensive) return ZONES.EXP;
  return ZONES.FAIR;
};

export const normalizeMacroCandles = (candles) => (Array.isArray(candles) ? candles : [])
  .map((candle) => ({
    ...candle,
    time: candle.time instanceof Date ? candle.time : new Date(candle.time),
    open: finite(candle.open),
    high: finite(candle.high),
    low: finite(candle.low),
    close: finite(candle.close),
    volume: finite(candle.volume, 0),
  }))
  .filter((candle) => (
    !Number.isNaN(candle.time.getTime())
    && candle.open !== null
    && candle.high !== null
    && candle.low !== null
    && candle.close !== null
  ))
  .sort((left, right) => left.time - right.time);

const medianOf = (values) => {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

const calculateMathV3ValuatorSeries = (closes, settings, lookback, madLookback) => {
  const B = barsPerYear(settings.timeframe);
  const regression = closes.map((_, index) => olsAt(closes, index, lookback, settings.minTick));
  const deviations = regression.map((row) => row.deviation);

  return regression.map((row, index) => {
    const start = Math.max(0, index - madLookback + 1);
    const hist = deviations.slice(start, index + 1);
    const loc = medianOf(hist);
    const mad = 1.4826 * medianOf(hist.map((d) => Math.abs(d - loc)));
    const scale = Math.max(mad, 0.18);
    const z = (row.deviation - loc) / scale;
    const fairValue = Math.exp(row.a + loc);
    return {
      z,
      fairValue,
      versusFairValue: fairValue > 0 ? (closes[index] / fairValue - 1) * 100 : 0,
      cagr: (Math.exp(-row.b * B) - 1) * 100,
      deviation: row.deviation - loc,
      sigma: scale,
      bandUpper: fairValue * Math.exp(settings.bandK * scale),
      bandLower: fairValue * Math.exp(-settings.bandK * scale),
    };
  });
};

const calculateMathV3Dashboard = (candles, settings) => {
  const B = barsPerYear(settings.timeframe);
  const scaleFactor = B / 52;
  const scaledLongLookback = Math.max(12, Math.round(settings.longLookback * scaleFactor));
  const scaledShortLookback = Math.max(6, Math.round(settings.shortLookback * scaleFactor));
  const scaledPctLookback = Math.max(12, Math.round(settings.percentileLookback * scaleFactor));
  const madLookback = Math.max(12, Math.round(4 * B));

  const closes = candles.map((candle) => candle.close);
  const logCloses = candles.map((candle) => Math.log(Math.max(candle.close, settings.minTick)));
  const logTypical = candles.map((candle) => Math.log(Math.max((candle.high + candle.low + candle.close) / 3, settings.minTick)));
  const logMidHl = candles.map((candle) => Math.log(Math.max((candle.high + candle.low) / 2, settings.minTick)));

  // Cap relative volume at 3x causal 1Y rolling median to immunize against exchange wash-volume regimes.
  const volWindow = Math.max(4, Math.round(B));
  const relVol = candles.map((candle, index) => {
    const start = Math.max(0, index - volWindow + 1);
    const vols = [];
    for (let k = start; k <= index; k += 1) vols.push(candles[k].volume);
    const med = medianOf(vols);
    return med > 0 ? Math.min(candle.volume / med, 3.0) : 1.0;
  });

  const longValuator = calculateMathV3ValuatorSeries(closes, settings, scaledLongLookback, madLookback);
  const shortValuator = calculateMathV3ValuatorSeries(closes, settings, scaledShortLookback, madLookback);

  // Disjoint Halving-cycle cohort tranches: [0..y0], [y0..y1], [y1..y2], [y2..y3] scaled by barsPerYear(tf).
  const sortedYears = settings.years.slice(0, 4).sort((a, b) => a - b);
  while (sortedYears.length < 4) sortedYears.push((sortedYears.at(-1) || 0) + 1);
  const trancheBounds = [0, ...sortedYears.map((y) => Math.max(1, Math.round(y * B)))];
  const weights = weightsFor(settings.weightScheme);

  const trancheLogBasisAt = (index, lagStart, lagEnd) => {
    const hi = index - lagStart;
    const lo = Math.max(0, index - lagEnd + 1);
    if (hi < lo || hi < 0) return null;

    let sw = 0;
    let swp = 0;
    const span = hi - lo + 1;
    const decay = settings.costMethod === 'EMA' ? 2 / (span + 1) : 0;

    for (let k = lo; k <= hi; k += 1) {
      let priceLog = logCloses[k];
      let w = 1;
      if (settings.costMethod === 'VWAP') {
        priceLog = logTypical[k];
        w = relVol[k];
      } else if (settings.costMethod === 'Median HL') {
        priceLog = logMidHl[k];
      } else if (settings.costMethod === 'EMA') {
        w = Math.pow(1 - decay, hi - k);
      }
      sw += w;
      swp += w * priceLog;
    }
    return sw > 0 ? swp / sw : null;
  };

  const pnlMetrics = candles.map((_, index) => {
    const logRois = [];
    const availableFlags = [];
    for (let t = 0; t < 4; t += 1) {
      const basisLog = trancheLogBasisAt(index, trancheBounds[t], trancheBounds[t + 1]);
      if (basisLog === null) {
        logRois.push(0);
        availableFlags.push(false);
      } else {
        logRois.push(logCloses[index] - basisLog);
        availableFlags.push(true);
      }
    }

    let weightSum = 0;
    let meanLogMoneyness = 0;
    let availCount = 0;
    let underwaterCount = 0;
    const validRoisPct = [];
    const rois = logRois.map((m, k) => {
      if (!availableFlags[k]) return 0;
      weightSum += weights[k];
      meanLogMoneyness += m * weights[k];
      availCount += 1;
      if (m < 0) underwaterCount += 1;
      const pct = (Math.exp(m) - 1) * 100;
      validRoisPct.push(pct);
      return pct;
    });

    meanLogMoneyness = weightSum > 0 ? meanLogMoneyness / weightSum : 0;
    const weightedAverage = (Math.exp(meanLogMoneyness) - 1) * 100;
    const roiMin = validRoisPct.length > 0 ? Math.min(...validRoisPct) : 0;
    const roiMax = validRoisPct.length > 0 ? Math.max(...validRoisPct) : 0;
    const underwater = availCount > 0 ? (underwaterCount / availCount) * 100 : 0;

    return {
      weightedAverage,
      meanLogMoneyness,
      percentile: 50,
      roiMin,
      roiMax,
      underwater,
      relativeSpread: (roiMax - roiMin) / Math.max(Math.abs(weightedAverage), settings.convergenceFloor),
      rois,
    };
  });

  // Finite-sample cold-start percentile (neutral during initial 6M warmup).
  const minRankBars = Math.max(12, Math.round(0.5 * B));
  pnlMetrics.forEach((metrics, index) => {
    const avail = Math.min(index, scaledPctLookback);
    if (avail < minRankBars) {
      metrics.percentile = 50;
      return;
    }
    let countBelow = 0;
    for (let barsAgo = 1; barsAgo <= avail; barsAgo += 1) {
      if (pnlMetrics[index - barsAgo].meanLogMoneyness < metrics.meanLogMoneyness) countBelow += 1;
    }
    metrics.percentile = (countBelow / avail) * 100;
  });

  let inGift = false;
  let inBubble = false;
  let previousValZone = null;
  let previousPnlZone = null;
  let valBarsInZone = 0;
  let pnlBarsInZone = 0;

  const series = candles.map((candle, index) => {
    const long = longValuator[index];
    const short = shortValuator[index];
    const shortGiftOk = !settings.useDualWindow || short.z < settings.valCheap;
    const shortBubbleOk = !settings.useDualWindow || short.z > settings.valExpensive;

    if (settings.useHysteresis) {
      if (long.z < settings.valGift && shortGiftOk) {
        inGift = true;
        inBubble = false;
      } else if (long.z > settings.giftExit || (settings.useDualWindow && short.z > 0)) {
        inGift = false;
      }

      if (long.z > settings.valBubble && shortBubbleOk) {
        inBubble = true;
        inGift = false;
      } else if (long.z < settings.bubbleExit || (settings.useDualWindow && short.z < 0)) {
        inBubble = false;
      }
    } else {
      inGift = long.z < settings.valGift && shortGiftOk;
      inBubble = long.z > settings.valBubble && shortBubbleOk;
    }

    let valZone = ZONES.FAIR;
    if (inGift && !inBubble) valZone = ZONES.GIFT;
    else if (inBubble && !inGift) valZone = ZONES.BUBBLE;
    else if (long.z < settings.valCheap && (!settings.useDualWindow || short.z < 0)) valZone = ZONES.CHEAP;
    else if (long.z > settings.valExpensive && (!settings.useDualWindow || short.z > 0)) valZone = ZONES.EXP;

    const pnl = pnlMetrics[index];
    let pnlZone;
    if (settings.zoneMethod === 'Convergence') {
      pnlZone = pnlZoneAt(pnl, settings);
    } else if (pnl.percentile < settings.pnlGift && pnl.meanLogMoneyness < 0) {
      pnlZone = ZONES.GIFT;
    } else if (pnl.percentile < settings.pnlCheap && pnl.meanLogMoneyness <= 0.05) {
      pnlZone = ZONES.CHEAP;
    } else if (pnl.percentile > settings.pnlBubble && pnl.meanLogMoneyness > 0.25) {
      pnlZone = ZONES.BUBBLE;
    } else if (pnl.percentile > settings.pnlExpensive && pnl.meanLogMoneyness > 0.10) {
      pnlZone = ZONES.EXP;
    } else {
      pnlZone = ZONES.FAIR;
    }

    valBarsInZone = valZone === previousValZone ? valBarsInZone + 1 : 1;
    pnlBarsInZone = pnlZone === previousPnlZone ? pnlBarsInZone + 1 : 1;
    previousValZone = valZone;
    previousPnlZone = pnlZone;

    const valScore = zoneScore(valZone);
    const pnlScore = zoneScore(pnlZone);
    const composite = valScore + pnlScore;
    const divergence = (pnlScore >= 1 && valScore <= -1) || (pnlScore <= -1 && valScore >= 1);
    const convictionScore = 0.5 * (-long.z) + 0.5 * (-pnl.meanLogMoneyness / 0.35);

    return {
      index,
      time: candle.time,
      isClosed: candle.isClosed !== false,
      closeTime: candle.closeTime ?? null,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      price: candle.close,
      fairValue: long.fairValue,
      bandUpper: long.bandUpper,
      bandLower: long.bandLower,
      valZLong: long.z,
      valZShort: short.z,
      versusFairValue: long.versusFairValue,
      impliedCagr: long.cagr,
      sigma: long.sigma,
      valZone,
      valScore,
      valBarsInZone,
      ...pnl,
      pnlZone,
      pnlScore,
      pnlBarsInZone,
      composite,
      convictionScore,
      divergence,
      action: actionFromScore(composite),
      decision: divergence ? 'MIXED / WAIT' : actionFromScore(composite),
    };
  });

  for (let index = 0; index < series.length; index += 1) {
    const row = series[index];
    const prev = index > 0 ? series[index - 1] : null;
    row.alerts = {
      valGift: row.valZone === ZONES.GIFT && row.valBarsInZone === settings.minBarsAlert,
      valBubble: row.valZone === ZONES.BUBBLE && row.valBarsInZone === settings.minBarsAlert,
      valCheap: row.valZone === ZONES.CHEAP && row.valBarsInZone === settings.minBarsAlert,
      valExpensive: row.valZone === ZONES.EXP && row.valBarsInZone === settings.minBarsAlert,
      pnlGift: row.pnlZone === ZONES.GIFT && row.pnlBarsInZone === settings.minBarsAlert,
      pnlBubble: row.pnlZone === ZONES.BUBBLE && row.pnlBarsInZone === settings.minBarsAlert,
      strongAccum: row.composite >= 3 && (prev?.composite ?? 0) < 3 && !row.divergence,
      strongDist: row.composite <= -3 && (prev?.composite ?? 0) > -3 && !row.divergence,
      divergenceNew: row.divergence && !prev?.divergence,
    };
  }

  const current = series.at(-1);
  const previous = series.at(-2) ?? null;
  return {
    settings,
    series,
    current,
    previous,
    alerts: current.alerts,
  };
};

export function calculateMacroDashboard(inputCandles, inputSettings = {}) {
  const settings = mergeSettings(inputSettings);
  const candles = normalizeMacroCandles(inputCandles);
  if (candles.length === 0) return { settings, series: [], current: null, previous: null, alerts: {} };
  if (settings.engineMode === ENGINE_MODES.MATH_V3) {
    return calculateMathV3Dashboard(candles, settings);
  }

  const closes = candles.map((candle) => candle.close);
  const longValuator = calculateValuatorSeries(closes, settings, settings.longLookback);
  const shortValuator = calculateValuatorSeries(closes, settings, settings.shortLookback);

  // This deliberately mirrors the Pine source: years are always multiplied by 52,
  // independent of the locked timeframe.
  const cohortPeriods = settings.years.map((years) => Math.max(1, Math.trunc(years * 52)));
  while (cohortPeriods.length < 4) cohortPeriods.push(52);
  const costBases = cohortPeriods.map((period) => costBasisSeries(candles, period, settings.costMethod));
  const weights = weightsFor(settings.weightScheme);

  const pnlMetrics = candles.map((candle, index) => {
    const rois = costBases.map((basis) => (basis[index] > 0 ? ((candle.close - basis[index]) / basis[index]) * 100 : 0));
    const weightedAverage = rois.reduce((sum, roi, cohortIndex) => sum + roi * weights[cohortIndex], 0);
    const roiMin = Math.min(...rois);
    const roiMax = Math.max(...rois);
    const underwater = (rois.filter((roi) => roi < 0).length / 4) * 100;
    return {
      weightedAverage,
      percentile: 0,
      roiMin,
      roiMax,
      underwater,
      relativeSpread: (roiMax - roiMin) / Math.max(Math.abs(weightedAverage), settings.convergenceFloor),
      rois,
    };
  });

  pnlMetrics.forEach((metrics, index) => {
    let countBelow = 0;
    for (let barsAgo = 1; barsAgo <= settings.percentileLookback; barsAgo += 1) {
      const previous = pnlMetrics[index - barsAgo];
      if (previous && previous.weightedAverage < metrics.weightedAverage) countBelow += 1;
    }
    // Pine keeps the requested lookback as denominator even before enough history exists.
    metrics.percentile = (countBelow / settings.percentileLookback) * 100;
  });

  let inGift = false;
  let inBubble = false;
  let previousValZone = null;
  let previousPnlZone = null;
  let valBarsInZone = 0;
  let pnlBarsInZone = 0;

  const series = candles.map((candle, index) => {
    const long = longValuator[index];
    const short = shortValuator[index];
    const shortGiftOk = !settings.useDualWindow || short.z < settings.valCheap;
    const shortBubbleOk = !settings.useDualWindow || short.z > settings.valExpensive;

    if (settings.useHysteresis) {
      if (long.z < settings.valGift && shortGiftOk) inGift = true;
      else if (long.z > settings.giftExit) inGift = false;

      if (long.z > settings.valBubble && shortBubbleOk) inBubble = true;
      else if (long.z < settings.bubbleExit) inBubble = false;
    } else {
      inGift = long.z < settings.valGift && shortGiftOk;
      inBubble = long.z > settings.valBubble && shortBubbleOk;
    }

    let valZone = ZONES.FAIR;
    if (inGift && !inBubble) valZone = ZONES.GIFT;
    else if (inBubble && !inGift) valZone = ZONES.BUBBLE;
    else if (long.z < settings.valCheap) valZone = ZONES.CHEAP;
    else if (long.z > settings.valExpensive) valZone = ZONES.EXP;

    const pnl = pnlMetrics[index];
    const pnlZone = pnlZoneAt(pnl, settings);
    valBarsInZone = valZone === previousValZone ? valBarsInZone + 1 : 1;
    pnlBarsInZone = pnlZone === previousPnlZone ? pnlBarsInZone + 1 : 1;
    previousValZone = valZone;
    previousPnlZone = pnlZone;

    const valScore = zoneScore(valZone);
    const pnlScore = zoneScore(pnlZone);
    const composite = valScore + pnlScore;
    const divergence = (pnlScore >= 1 && valScore <= -1) || (pnlScore <= -1 && valScore >= 1);

    const prevSeriesRow = index > 0 ? null : null;
    void prevSeriesRow;

    return {
      index,
      time: candle.time,
      isClosed: candle.isClosed !== false,
      closeTime: candle.closeTime ?? null,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      price: candle.close,
      fairValue: long.fairValue,
      bandUpper: long.bandUpper,
      bandLower: long.bandLower,
      valZLong: long.z,
      valZShort: short.z,
      versusFairValue: long.versusFairValue,
      impliedCagr: long.cagr,
      sigma: long.sigma,
      valZone,
      valScore,
      valBarsInZone,
      ...pnl,
      pnlZone,
      pnlScore,
      pnlBarsInZone,
      composite,
      divergence,
      action: actionFromScore(composite),
      decision: divergence ? 'MIXED / WAIT' : actionFromScore(composite),
    };
  });

  // Attach per-bar alert flags matching Pine bar-by-bar trigger conditions.
  for (let index = 0; index < series.length; index += 1) {
    const row = series[index];
    const prev = index > 0 ? series[index - 1] : null;
    row.alerts = {
      valGift: row.valZone === ZONES.GIFT && row.valBarsInZone === settings.minBarsAlert,
      valBubble: row.valZone === ZONES.BUBBLE && row.valBarsInZone === settings.minBarsAlert,
      valCheap: row.valZone === ZONES.CHEAP && row.valBarsInZone === settings.minBarsAlert,
      valExpensive: row.valZone === ZONES.EXP && row.valBarsInZone === settings.minBarsAlert,
      pnlGift: row.pnlZone === ZONES.GIFT && row.pnlBarsInZone === settings.minBarsAlert,
      pnlBubble: row.pnlZone === ZONES.BUBBLE && row.pnlBarsInZone === settings.minBarsAlert,
      strongAccum: row.composite >= 3 && (prev?.composite ?? 0) < 3 && !row.divergence,
      strongDist: row.composite <= -3 && (prev?.composite ?? 0) > -3 && !row.divergence,
      divergenceNew: row.divergence && !prev?.divergence,
    };
  }

  const current = series.at(-1);
  const previous = series.at(-2) ?? null;
  return {
    settings,
    series,
    current,
    previous,
    alerts: current.alerts,
  };
}

export const macroDashboardInternals = {
  ema,
  rollingSma,
  rollingPopulationStdev,
  olsAt,
  zoneScore,
  actionFromScore,
};
