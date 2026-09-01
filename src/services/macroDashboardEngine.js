const ZONES = Object.freeze({
  GIFT: 'GIFT',
  CHEAP: 'CHEAP',
  FAIR: 'FAIR',
  EXP: 'EXP',
  BUBBLE: 'BUBBLE',
});

export const MACRO_DASHBOARD_DEFAULTS = Object.freeze({
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

const barsPerYear = (timeframe) => {
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
    return highs.map((high, index) => high === null || lows[index] === null ? null : (high + lows[index]) / 2);
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

export function calculateMacroDashboard(inputCandles, inputSettings = {}) {
  const settings = mergeSettings(inputSettings);
  const candles = normalizeMacroCandles(inputCandles);
  if (candles.length === 0) return { settings, series: [], current: null, previous: null, alerts: {} };

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
    const rois = costBases.map((basis) => basis[index] > 0 ? ((candle.close - basis[index]) / basis[index]) * 100 : 0);
    const weightedAverage = rois.reduce((sum, roi, cohortIndex) => sum + roi * weights[cohortIndex], 0);
    const roiMin = Math.min(...rois);
    const roiMax = Math.max(...rois);
    const underwater = rois.filter((roi) => roi < 0).length / 4 * 100;
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
    metrics.percentile = countBelow / settings.percentileLookback * 100;
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

    return {
      time: candle.time,
      isClosed: candle.isClosed !== false,
      closeTime: candle.closeTime ?? null,
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
      valBarsInZone,
      ...pnl,
      pnlZone,
      pnlBarsInZone,
      composite,
      divergence,
      action: actionFromScore(composite),
      decision: divergence ? 'MIXED / WAIT' : actionFromScore(composite),
    };
  });

  const current = series.at(-1);
  const previous = series.at(-2) ?? null;
  return {
    settings,
    series,
    current,
    previous,
    alerts: {
      valGift: current.valZone === ZONES.GIFT && current.valBarsInZone === settings.minBarsAlert,
      valBubble: current.valZone === ZONES.BUBBLE && current.valBarsInZone === settings.minBarsAlert,
      valCheap: current.valZone === ZONES.CHEAP && current.valBarsInZone === settings.minBarsAlert,
      valExpensive: current.valZone === ZONES.EXP && current.valBarsInZone === settings.minBarsAlert,
      pnlGift: current.pnlZone === ZONES.GIFT && current.pnlBarsInZone === settings.minBarsAlert,
      pnlBubble: current.pnlZone === ZONES.BUBBLE && current.pnlBarsInZone === settings.minBarsAlert,
      strongAccum: current.composite >= 3 && (previous?.composite ?? 0) < 3 && !current.divergence,
      strongDist: current.composite <= -3 && (previous?.composite ?? 0) > -3 && !current.divergence,
      divergenceNew: current.divergence && !previous?.divergence,
    },
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
