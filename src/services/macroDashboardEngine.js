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

export const MACRO_SOP_PRESET = Object.freeze({
  ...MACRO_DASHBOARD_DEFAULTS,
  engineMode: ENGINE_MODES.MATH_V3,
  timeframe: 'W',
  costMethod: 'VWAP',
  weightScheme: 'Equal',
  zoneMethod: 'Percentile',
  zMode: 'Structural',
  useDualWindow: true,
  useHysteresis: true,
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

export const normalizeMacroCandles = (candles, nowMs = Date.now()) => (Array.isArray(candles) ? candles : [])
  .map((candle) => {
    const closeTime = finite(candle.closeTime);
    return {
      ...candle,
      time: candle.time instanceof Date ? candle.time : new Date(candle.time),
      open: finite(candle.open),
      high: finite(candle.high),
      low: finite(candle.low),
      close: finite(candle.close),
      volume: Math.max(0, finite(candle.volume, 0)),
      closeTime,
      isClosed: closeTime !== null ? closeTime < nowMs : candle.isClosed !== false,
    };
  })
  .filter((candle) => (
    !Number.isNaN(candle.time.getTime())
    && candle.open > 0
    && candle.high > 0
    && candle.low > 0
    && candle.close > 0
  ))
  .sort((left, right) => left.time - right.time);

export const applyLivePriceToMacroCandles = (candles, livePrice, nowMs = Date.now()) => {
  if (!Array.isArray(candles) || candles.length === 0) return candles;
  const price = finite(livePrice);
  if (price === null || price <= 0) return candles;
  const last = candles[candles.length - 1];
  const closeTime = finite(last.closeTime);
  const lastIsClosed = closeTime !== null ? closeTime < nowMs : last.isClosed !== false;
  if (lastIsClosed) return candles;

  const rows = candles.slice();
  rows[rows.length - 1] = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  return rows;
};

const quickselectInPlace = (arr, left, right, k) => {
  let lo = left;
  let hi = right;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < arr[lo]) { const t = arr[lo]; arr[lo] = arr[mid]; arr[mid] = t; }
    if (arr[hi] < arr[lo]) { const t = arr[lo]; arr[lo] = arr[hi]; arr[hi] = t; }
    if (arr[mid] < arr[hi]) { const t = arr[mid]; arr[mid] = arr[hi]; arr[hi] = t; }
    const pivot = arr[hi];
    let i = lo;
    let j = hi - 1;
    while (true) {
      while (i <= j && arr[i] < pivot) i += 1;
      while (i <= j && arr[j] > pivot) j -= 1;
      if (i >= j) break;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      i += 1;
      j -= 1;
    }
    const t = arr[i]; arr[i] = arr[hi]; arr[hi] = t;
    if (i === k) return arr[k];
    if (k < i) hi = i - 1;
    else lo = i + 1;
  }
  return arr[lo];
};

const medianOfBuf = (buf, len) => {
  if (len === 0) return 0;
  if (len === 1) return buf[0];
  const mid = len >> 1;
  const upper = quickselectInPlace(buf, 0, len - 1, mid);
  if (len % 2 === 1) return upper;
  let lower = -Infinity;
  for (let i = 0; i < mid; i += 1) {
    if (buf[i] > lower) lower = buf[i];
  }
  return 0.5 * (lower + upper);
};

const calculateMathV3ValuatorSeries = (closes, settings, lookback, madLookback) => {
  const B = barsPerYear(settings.timeframe);
  const n = closes.length;
  const logCloses = new Float64Array(n);
  const prefY = new Float64Array(n + 1);
  const prefKY = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const y = Math.log(Math.max(closes[i], settings.minTick));
    logCloses[i] = y;
    prefY[i + 1] = prefY[i] + y;
    prefKY[i + 1] = prefKY[i] + i * y;
  }

  const regression = new Array(n);
  const deviations = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    const length = Math.min(lookback, index + 1);
    if (length < 2) {
      regression[index] = { a: logCloses[index], b: 0, deviation: 0 };
      deviations[index] = 0;
      continue;
    }
    const lo = index - length + 1;
    const sumX = (length * (length - 1)) / 2;
    const sumXX = ((length - 1) * length * (2 * length - 1)) / 6;
    const sumY = prefY[index + 1] - prefY[lo];
    const sumKY = prefKY[index + 1] - prefKY[lo];
    const sumXY = index * sumY - sumKY;
    const denominator = length * sumXX - sumX * sumX;
    const b = denominator !== 0 ? (length * sumXY - sumX * sumY) / denominator : 0;
    const a = (sumY - b * sumX) / length;
    const deviation = logCloses[index] - a;
    regression[index] = { a, b, deviation };
    deviations[index] = deviation;
  }

  const buf = new Float64Array(madLookback);
  return regression.map((row, index) => {
    const start = Math.max(0, index - madLookback + 1);
    const len = index - start + 1;
    for (let k = 0; k < len; k += 1) buf[k] = deviations[start + k];
    const loc = medianOfBuf(buf, len);
    for (let k = 0; k < len; k += 1) buf[k] = Math.abs(deviations[start + k] - loc);
    const mad = 1.4826 * medianOfBuf(buf, len);
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
  const volBuf = new Float64Array(volWindow);
  const relVol = candles.map((candle, index) => {
    const start = Math.max(0, index - volWindow + 1);
    const len = index - start + 1;
    for (let k = 0; k < len; k += 1) volBuf[k] = candles[start + k].volume;
    const med = medianOfBuf(volBuf, len);
    return med > 0 ? Math.min(candle.volume / med, 3.0) : 1.0;
  });

  const longValuator = calculateMathV3ValuatorSeries(closes, settings, scaledLongLookback, madLookback);
  const shortValuator = calculateMathV3ValuatorSeries(closes, settings, scaledShortLookback, madLookback);

  // Disjoint Halving-cycle cohort tranches: [0..y0], [y0..y1], [y1..y2], [y2..y3] scaled by barsPerYear(tf).
  const sortedYears = settings.years.slice(0, 4).sort((a, b) => a - b);
  while (sortedYears.length < 4) sortedYears.push((sortedYears.at(-1) || 0) + 1);
  const trancheBounds = [0, ...sortedYears.map((y) => Math.max(1, Math.round(y * B)))];
  const weights = weightsFor(settings.weightScheme);

  const n = candles.length;
  const prefLogCloses = new Float64Array(n + 1);
  const prefLogMidHl = new Float64Array(n + 1);
  const prefRelVol = new Float64Array(n + 1);
  const prefRelVolLogTypical = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    prefLogCloses[i + 1] = prefLogCloses[i] + logCloses[i];
    prefLogMidHl[i + 1] = prefLogMidHl[i] + logMidHl[i];
    prefRelVol[i + 1] = prefRelVol[i] + relVol[i];
    prefRelVolLogTypical[i + 1] = prefRelVolLogTypical[i] + relVol[i] * logTypical[i];
  }

  const trancheLogBasisAt = (index, lagStart, lagEnd) => {
    const hi = index - lagStart;
    const lo = Math.max(0, index - lagEnd + 1);
    if (hi < lo || hi < 0) return null;

    if (settings.costMethod === 'VWAP') {
      const sw = prefRelVol[hi + 1] - prefRelVol[lo];
      const swp = prefRelVolLogTypical[hi + 1] - prefRelVolLogTypical[lo];
      return sw > 0 ? swp / sw : null;
    }
    if (settings.costMethod === 'Median HL') {
      const span = hi - lo + 1;
      return (prefLogMidHl[hi + 1] - prefLogMidHl[lo]) / span;
    }
    if (settings.costMethod !== 'EMA') {
      const span = hi - lo + 1;
      return (prefLogCloses[hi + 1] - prefLogCloses[lo]) / span;
    }

    let sw = 0;
    let swp = 0;
    const span = hi - lo + 1;
    const decay = 2 / (span + 1);
    for (let k = lo; k <= hi; k += 1) {
      const w = Math.pow(1 - decay, hi - k);
      sw += w;
      swp += w * logCloses[k];
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

  // Top-side ATH cycle-top detector (asymmetric: preserves bottom-side GIFT/CHEAP/GB bit-for-bit).
  const cycleBars = Math.max(12, Math.round(4 * B));
  const volBars = Math.max(8, Math.round(2 * B));
  const shortAnchorBars = Math.max(4, Math.round(B));

  const rv2Y = new Float64Array(n);
  const high4Y = new Float64Array(n);
  const highDeque = new Int32Array(n);
  let dqHead = 0;
  let dqTail = 0;
  const valOverheatZ = new Float64Array(n);
  const shortLogDev = new Float64Array(n);
  const pnlOverheatZ = new Float64Array(n);
  const valOverheatPct = new Float64Array(n);
  const pnlOverheatPct = new Float64Array(n);

  for (let index = 0; index < n; index += 1) {
    // Causal 2Y annualized population stdev of log returns, floored at 0.25 (0.70 when < 4 returns).
    const volLo = Math.max(1, index - volBars + 1);
    const volCount = index - volLo + 1;
    if (volCount < 4) {
      rv2Y[index] = 0.7;
    } else {
      let sumRet = 0;
      for (let k = volLo; k <= index; k += 1) sumRet += logCloses[k] - logCloses[k - 1];
      const muRet = sumRet / volCount;
      let sumSq = 0;
      for (let k = volLo; k <= index; k += 1) {
        const diff = (logCloses[k] - logCloses[k - 1]) - muRet;
        sumSq += diff * diff;
      }
      rv2Y[index] = Math.max(Math.sqrt((sumSq / volCount) * B), 0.25);
    }

    // Causal 4Y rolling high via O(n) monotonic deque.
    const hiLo = Math.max(0, index - cycleBars + 1);
    while (dqHead < dqTail && highDeque[dqHead] < hiLo) dqHead += 1;
    const curHigh = candles[index].high;
    while (dqHead < dqTail && candles[highDeque[dqTail - 1]].high <= curHigh) dqTail -= 1;
    highDeque[dqTail] = index;
    dqTail += 1;
    high4Y[index] = Math.max(0, candles[highDeque[dqHead]].high);

    const longLo = Math.max(0, index - scaledLongLookback + 1);
    const meanLogLong = (prefLogCloses[index + 1] - prefLogCloses[longLo]) / (index - longLo + 1);
    valOverheatZ[index] = (logCloses[index] - meanLogLong) / rv2Y[index];

    const shortLo = Math.max(0, index - shortAnchorBars + 1);
    const meanLogShort = (prefLogCloses[index + 1] - prefLogCloses[shortLo]) / (index - shortLo + 1);
    shortLogDev[index] = logCloses[index] - meanLogShort;

    pnlOverheatZ[index] = pnlMetrics[index].meanLogMoneyness / rv2Y[index];

    const avail = Math.min(index, scaledPctLookback);
    if (avail < minRankBars) {
      valOverheatPct[index] = 50;
      pnlOverheatPct[index] = 50;
    } else {
      let countValBelow = 0;
      let countPnlBelow = 0;
      for (let barsAgo = 1; barsAgo <= avail; barsAgo += 1) {
        if (valOverheatZ[index - barsAgo] < valOverheatZ[index]) countValBelow += 1;
        if (pnlOverheatZ[index - barsAgo] < pnlOverheatZ[index]) countPnlBelow += 1;
      }
      valOverheatPct[index] = (countValBelow / avail) * 100;
      pnlOverheatPct[index] = (countPnlBelow / avail) * 100;
    }
  }

  let inGift = false;
  let inBubble = false;
  let previousValZone = null;
  let previousPnlZone = null;
  let valBarsInZone = 0;
  let pnlBarsInZone = 0;

  const series = candles.map((candle, index) => {
    const long = longValuator[index];
    const short = shortValuator[index];
    const pnl = pnlMetrics[index];
    const shortGiftOk = !settings.useDualWindow || short.z < settings.valCheap;

    const nearAth = high4Y[index] > 0 && candle.close >= 0.85 * high4Y[index];
    const allProfitable = pnl.underwater === 0;
    const shortTopOk = !settings.useDualWindow || shortLogDev[index] > 0;
    const enterBubble = nearAth && shortTopOk && valOverheatZ[index] >= 2.20 && valOverheatPct[index] >= settings.pnlBubble;
    const exitBubble = !nearAth || !shortTopOk || valOverheatZ[index] < 1.90;

    if (settings.useHysteresis) {
      if (long.z < settings.valGift && shortGiftOk) {
        inGift = true;
        inBubble = false;
      } else if (long.z > settings.giftExit || (settings.useDualWindow && short.z > 0)) {
        inGift = false;
      }

      if (!inGift && enterBubble) {
        inBubble = true;
        inGift = false;
      } else if (exitBubble) {
        inBubble = false;
      }
    } else {
      inGift = long.z < settings.valGift && shortGiftOk;
      inBubble = !inGift && enterBubble;
    }

    let valZone = ZONES.FAIR;
    if (inGift && !inBubble) valZone = ZONES.GIFT;
    else if (inBubble && !inGift) valZone = ZONES.BUBBLE;
    else if (long.z < settings.valCheap && (!settings.useDualWindow || short.z < 0)) valZone = ZONES.CHEAP;
    else if (nearAth && shortTopOk && valOverheatZ[index] >= 1.90 && valOverheatPct[index] >= settings.pnlExpensive) valZone = ZONES.EXP;

    let pnlZone;
    if (settings.zoneMethod === 'Convergence') {
      pnlZone = pnlZoneAt(pnl, settings);
    } else if (pnl.percentile < settings.pnlGift && pnl.meanLogMoneyness < 0) {
      pnlZone = ZONES.GIFT;
    } else if (pnl.percentile < settings.pnlCheap && pnl.meanLogMoneyness <= 0.05) {
      pnlZone = ZONES.CHEAP;
    } else if (nearAth && allProfitable && pnlOverheatPct[index] >= settings.pnlBubble && pnlOverheatZ[index] >= 2.20) {
      pnlZone = ZONES.BUBBLE;
    } else if (allProfitable && pnlOverheatPct[index] >= settings.pnlExpensive && pnlOverheatZ[index] >= 1.90) {
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
      vol2Y: rv2Y[index],
      athDrawdownPct: high4Y[index] > 0 ? (candle.close / high4Y[index] - 1) * 100 : 0,
      valOverheatZ: valOverheatZ[index],
      valOverheatPct: valOverheatPct[index],
      pnlOverheatZ: pnlOverheatZ[index],
      pnlOverheatPct: pnlOverheatPct[index],
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

export const isGreenBubble = (row) => Boolean(row && row.composite >= 3 && !row.divergence);

export const isRedBubble = (row) => Boolean(row && row.composite <= -3 && !row.divergence);

const SOP_REQUIRED_FIELDS = [
  { key: 'engineMode', label: 'Engine', expected: ENGINE_MODES.MATH_V3, displayExpected: 'math_v3 (MathClean v3)' },
  { key: 'timeframe', label: 'Locked TF', expected: 'W', displayExpected: 'W (Tuần)' },
  { key: 'costMethod', label: 'Cost Basis', expected: 'VWAP', displayExpected: 'VWAP (RVWAP)' },
  { key: 'weightScheme', label: 'Cohort Weight', expected: 'Equal', displayExpected: 'Equal (1Y/2Y/3Y/4Y)' },
  { key: 'zoneMethod', label: 'PnL Zone', expected: 'Percentile', displayExpected: 'Percentile' },
  { key: 'zMode', label: 'Z Mode', expected: 'Structural', displayExpected: 'Structural (MAD 4Y)' },
  { key: 'useDualWindow', label: 'Dual confirm', expected: true, displayExpected: 'ON' },
  { key: 'useHysteresis', label: 'Hysteresis', expected: true, displayExpected: 'ON' },
];

export const checkSopConfigCompliance = (settings = {}) => {
  const merged = mergeSettings(settings);
  const isMathV3 = merged.engineMode === ENGINE_MODES.MATH_V3;
  const checks = SOP_REQUIRED_FIELDS.map((field) => {
    const actual = isMathV3 && field.key === 'zMode' ? 'Structural' : merged[field.key];
    const ok = actual === field.expected;
    return {
      ...field,
      actual,
      displayActual: typeof actual === 'boolean' ? (actual ? 'ON' : 'OFF') : String(actual),
      ok,
    };
  });
  const mismatches = checks.filter((item) => !item.ok);
  return {
    isCompliant: mismatches.length === 0,
    checks,
    mismatches,
  };
};

/**
 * Evaluates the live/closed Macro Dashboard state against the Green Bubble DCA SOP (MathClean v3).
 * Uses the latest CLOSED bar as the canonical SOP signal to avoid mid-week repainting.
 */
export const evaluateSopAction = (dashboard, options = {}) => {
  const series = Array.isArray(dashboard?.series) ? dashboard.series : [];
  const settings = dashboard?.settings || MACRO_DASHBOARD_DEFAULTS;
  const weeklyBudget = Math.max(0, finite(options.weeklyBudget, 1000));
  const cashReserve = Math.max(0, finite(options.cashReserve, 0));
  const compliance = checkSopConfigCompliance(settings);

  if (series.length === 0) {
    return {
      status: 'NO_DATA',
      signalBar: null,
      liveBar: null,
      isLiveDeveloping: false,
      compliance,
      gbStreak: 0,
      rbStreak: 0,
      totalGreenBubbles: 0,
      totalRedBubbles: 0,
      lastGreenBubble: null,
      lastRedBubble: null,
      rule1: null,
      rule2: null,
      cy4: null,
    };
  }

  const latestBar = series.at(-1);
  const isLiveDeveloping = latestBar?.isClosed === false;
  let closedIdx = series.length - 1;
  while (closedIdx >= 0 && series[closedIdx].isClosed === false) {
    closedIdx -= 1;
  }
  const signalBar = closedIdx >= 0 ? series[closedIdx] : latestBar;
  const liveBar = isLiveDeveloping ? latestBar : null;
  const closedSeries = closedIdx >= 0 ? series.slice(0, closedIdx + 1) : series;

  let gbStreak = 0;
  for (let i = closedSeries.length - 1; i >= 0; i -= 1) {
    if (isGreenBubble(closedSeries[i])) gbStreak += 1;
    else break;
  }

  let rbStreak = 0;
  for (let i = closedSeries.length - 1; i >= 0; i -= 1) {
    if (isRedBubble(closedSeries[i])) rbStreak += 1;
    else break;
  }

  let totalGreenBubbles = 0;
  let totalRedBubbles = 0;
  let lastGreenBubble = null;
  let lastRedBubble = null;
  for (const row of closedSeries) {
    if (isGreenBubble(row)) {
      totalGreenBubbles += 1;
      lastGreenBubble = row;
    }
    if (isRedBubble(row)) {
      totalRedBubbles += 1;
      lastRedBubble = row;
    }
  }

  const greenActive = isGreenBubble(signalBar);
  const redActive = isRedBubble(signalBar);
  const liveGreen = isGreenBubble(liveBar);
  const liveRed = isRedBubble(liveBar);

  let lastGbIdx = -1;
  for (let i = closedSeries.length - 1; i >= 0; i -= 1) {
    if (isGreenBubble(closedSeries[i])) {
      lastGbIdx = i;
      break;
    }
  }
  let cy4FirstRbBar = null;
  let rbClustersSinceLastGb = 0;
  for (let i = lastGbIdx + 1; i < closedSeries.length; i += 1) {
    if (isRedBubble(closedSeries[i]) && (i === lastGbIdx + 1 || !isRedBubble(closedSeries[i - 1]))) {
      rbClustersSinceLastGb += 1;
      if (!cy4FirstRbBar) cy4FirstRbBar = closedSeries[i];
    }
  }
  const cy4IsFirstWeek = redActive && rbStreak === 1 && rbClustersSinceLastGb === 1;
  const cy4AlreadyTriggered = Boolean(cy4FirstRbBar) && !cy4IsFirstWeek;
  const cy4FirstDateStr = cy4FirstRbBar ? cy4FirstRbBar.time.toISOString().slice(0, 10) : null;

  // Rule 1 (GB-7: All-In 100% Reserve on Green Bubble)
  const rule1Spend = greenActive ? cashReserve : 0;
  const rule1Remaining = Math.max(0, cashReserve - rule1Spend);
  // Rule 2 (GB-6: Fractional 50% Reserve / Green Bubble Week)
  const rule2Spend = greenActive ? cashReserve * 0.5 : 0;
  const rule2Remaining = Math.max(0, cashReserve - rule2Spend);

  let status = 'WAIT_ACCUMULATE_CASH';
  let headline = 'KHÔNG MUA BTC · TÍCH LŨY QUỸ DỰ PHÒNG R';
  let tone = 'neutral';
  let summary = `Nến đóng gần nhất là ${signalBar.decision} (Score ${signalBar.composite > 0 ? '+' : ''}${signalBar.composite}${signalBar.divergence ? ', Divergence = YES' : ''}). Theo SOP, tuyệt đối KHÔNG mua BTC khi chưa có chấm xanh (Score >= +3 & Divergence = NO).`;

  if (greenActive) {
    status = 'GREEN_BUBBLE_BUY';
    headline = `GREEN BUBBLE (TUẦN #${gbStreak}) · KÍCH HOẠT GIẢI NGÂN`;
    tone = 'buy';
    summary = gbStreak === 1
      ? `Nến tuần đóng cửa xác nhận Green Bubble đầu tiên (Score +${signalBar.composite}, Divergence = NO). Kích hoạt giải ngân quỹ dự phòng R trong ngày Thứ Hai (Market Buy hoặc Limit -1% đến -2%, khớp bù cuối ngày).`
      : `Cụm Green Bubble tiếp diễn sang tuần thứ #${gbStreak} (Score +${signalBar.composite}). Tiếp tục giải ngân theo quy tắc đã chọn.`;
  } else if (redActive) {
    status = 'RED_BUBBLE_TAKE_PROFIT';
    headline = `RED BUBBLE (TUẦN #${rbStreak}) · KHÔNG MUA · TÙY CHỌN CHỐT 50% (CY-4)`;
    tone = 'sell';
    if (cy4IsFirstWeek) {
      summary = `Nến tuần đóng cửa bật Red Bubble đầu tiên (Score ${signalBar.composite}, Divergence = NO). Tuyệt đối không mua BTC; nếu theo biến thể xoay vòng CY-4, chốt 50% lượng BTC đang giữ đúng 1 lần duy nhất về quỹ R (4% APY), giữ 50% Core Hold.`;
    } else if (rbClustersSinceLastGb > 1) {
      summary = `Cụm Red Bubble tái diễn (Score ${signalBar.composite}). Không mua BTC; CY-4 đã kích hoạt chốt 50% ở ngày ${cy4FirstDateStr} trong chu kỳ này nên tiếp tục giữ nguyên 50% Core Hold.`;
    } else {
      summary = `Cụm Red Bubble đang ở tuần thứ #${rbStreak} (Score ${signalBar.composite}). Không mua BTC; nếu đã chốt 50% ở tuần Red Bubble đầu tiên của cụm thì giữ nguyên 50% Core Hold.`;
    }
  }

  return {
    status,
    headline,
    tone,
    summary,
    signalBar,
    liveBar,
    isLiveDeveloping,
    liveGreen,
    liveRed,
    compliance,
    gbStreak,
    rbStreak,
    totalGreenBubbles,
    totalRedBubbles,
    lastGreenBubble,
    lastRedBubble,
    weeklyBudget,
    cashReserve,
    rule1: {
      code: 'GB-7',
      label: 'Quy tắc 1 · All-In 100% Reserve',
      action: greenActive
        ? (gbStreak === 1 ? 'GIẢI NGÂN 100% QUỸ R' : 'GIẢI NGÂN 100% NGÂN SÁCH TUẦN MỚI')
        : 'GIỮ 100% TIỀN TRONG QUỸ R (+4% APY)',
      spendUsd: rule1Spend,
      remainingReserveUsd: rule1Remaining,
      nextDepositUsd: weeklyBudget,
    },
    rule2: {
      code: 'GB-6',
      label: 'Quy tắc 2 · Cân bằng 50% Reserve',
      action: greenActive
        ? `GIẢI NGÂN 50% QUỸ R (TUẦN GB #${gbStreak})`
        : 'GIỮ 100% TIỀN TRONG QUỸ R (+4% APY)',
      spendUsd: rule2Spend,
      remainingReserveUsd: rule2Remaining,
      nextDepositUsd: weeklyBudget,
    },
    cy4: {
      active: redActive,
      isFirstWeek: cy4IsFirstWeek,
      alreadyTriggeredInCycle: cy4AlreadyTriggered,
      firstTriggerTime: cy4FirstRbBar ? cy4FirstRbBar.time : null,
      action: redActive
        ? (cy4IsFirstWeek
          ? 'BÁN 50% BTC ĐANG GIỮ (1 LẦN DUY NHẤT) → ĐƯA VỀ QUỸ R (4% APY), GIỮ 50% CORE HOLD'
          : (rbClustersSinceLastGb > 1
            ? `ĐÃ KÍCH HOẠT CY-4 TRONG CHU KỲ NÀY (${cy4FirstDateStr}) → GIỮ NGUYÊN 50% CORE HOLD`
            : 'ĐÃ QUA TUẦN RB #1 → GIỮ NGUYÊN 50% CORE HOLD (KHÔNG BÁN THÊM)'))
        : (cy4AlreadyTriggered
          ? `ĐÃ CHỐT 50% TRONG CHU KỲ NÀY (${cy4FirstDateStr}) → GIỮ 50% CORE HOLD CHỜ GREEN BUBBLE MỚI`
          : 'CHƯA KÍCH HOẠT (CHỈ KÍCH HOẠT KHI RED BUBBLE: SCORE <= -3 & !DIV)'),
    },
  };
};

export const macroDashboardInternals = {
  ema,
  rollingSma,
  rollingPopulationStdev,
  olsAt,
  zoneScore,
  actionFromScore,
};
