export const DETECTION_WINDOWS_SEC = [15, 30, 60, 120];
export const OUTCOME_HORIZONS_SEC = [15, 30, 60, 300, 900];
export const SMALL_SAMPLE_SIZE = 30;

export function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function aggregateBuckets(ring, startTime, endTime = Infinity) {
  return (Array.isArray(ring) ? ring : []).reduce((result, bucket) => {
    if (bucket.ts < startTime || bucket.ts > endTime) return result;
    result.totalVolume += finite(bucket.totalVolume);
    result.totalQty += finite(bucket.totalQty);
    result.tradeCount += finite(bucket.tradeCount);
    result.takerBuyVol += finite(bucket.takerBuyVol);
    result.takerSellVol += finite(bucket.takerSellVol);
    result.largeTradesCount += finite(bucket.largeTradesCount);
    result.largeTradesVol += finite(bucket.largeTradesVol);
    if (finite(bucket.maxSingleTradeUsd) > result.maxSingleTradeUsd) {
      result.maxSingleTradeUsd = finite(bucket.maxSingleTradeUsd);
      result.maxSingleTradeSide = bucket.maxSingleTradeSide ?? null;
    }
    return result;
  }, {
    totalVolume: 0,
    totalQty: 0,
    tradeCount: 0,
    takerBuyVol: 0,
    takerSellVol: 0,
    largeTradesCount: 0,
    largeTradesVol: 0,
    maxSingleTradeUsd: 0,
    maxSingleTradeSide: null,
  });
}

export function percentileRank(samples, value) {
  const valid = (Array.isArray(samples) ? samples : []).filter(Number.isFinite);
  if (valid.length === 0 || !Number.isFinite(value)) return null;
  const belowOrEqual = valid.filter((sample) => sample <= value).length;
  return Number(((belowOrEqual / valid.length) * 100).toFixed(1));
}

export function buildBaselineSamples(ring, windowSec, now, lookbackMs = 60 * 60 * 1000) {
  const windowMs = windowSec * 1000;
  const samples = [];
  const earliest = Math.max(now - lookbackMs, ring[0]?.ts ?? now);
  for (let end = now - windowMs; end - windowMs >= earliest; end -= windowMs) {
    const stats = aggregateBuckets(ring, end - windowMs, end - 1);
    if (stats.tradeCount > 0) {
      samples.push({ totalVolume: stats.totalVolume, tradeRate: stats.tradeCount / windowSec });
    }
  }
  return samples;
}

export function thresholdForWindow(atrValue, atrMultiplier, windowSec) {
  if (!Number.isFinite(atrValue) || atrValue <= 0) return Infinity;
  const timeScale = Math.max(0.45, Math.sqrt(windowSec / 300));
  return atrValue * atrMultiplier * timeScale;
}

export function buildDetectionScores({ buckets, price, now, atrValue, atrMultiplier, fixedUsd, mode }) {
  return DETECTION_WINDOWS_SEC.map((windowSec) => {
    const start = now - windowSec * 1000;
    const windowBuckets = buckets.filter((bucket) => bucket.ts >= start && bucket.ts <= now);
    if (windowBuckets.length < Math.min(3, windowSec)) return { windowSec, available: false, triggered: false };
    const lowBucket = windowBuckets.reduce((best, bucket) => bucket.low < best.low ? bucket : best, windowBuckets[0]);
    const highBucket = windowBuckets.reduce((best, bucket) => bucket.high > best.high ? bucket : best, windowBuckets[0]);
    const thresholdUsd = mode === 'FIXED' ? finite(fixedUsd, Infinity) : thresholdForWindow(atrValue, atrMultiplier, windowSec);
    const pumpDelta = price - lowBucket.low;
    const dumpDelta = highBucket.high - price;
    const direction = pumpDelta >= dumpDelta ? 'PUMP' : 'DUMP';
    const deltaUsd = Math.max(pumpDelta, dumpDelta);
    const score = Number.isFinite(thresholdUsd) && thresholdUsd > 0 ? deltaUsd / thresholdUsd : 0;
    const base = direction === 'PUMP' ? lowBucket : highBucket;
    return {
      windowSec,
      available: Number.isFinite(thresholdUsd),
      triggered: score >= 1,
      direction,
      startTime: base.ts,
      startPrice: direction === 'PUMP' ? base.low : base.high,
      deltaUsd,
      thresholdUsd,
      score,
      pumpScore: Number.isFinite(thresholdUsd) ? pumpDelta / thresholdUsd : 0,
      dumpScore: Number.isFinite(thresholdUsd) ? dumpDelta / thresholdUsd : 0,
    };
  });
}

export function selectMoveCandidate(scores) {
  return (Array.isArray(scores) ? scores : []).filter((score) => score.triggered).sort((a, b) => b.score - a.score)[0] ?? null;
}

export function flowMetrics(direction, stats) {
  const totalVolume = Math.max(0, finite(stats?.totalVolume));
  const cvd = finite(stats?.takerBuyVol) - finite(stats?.takerSellVol);
  const expectedSign = direction === 'PUMP' ? 1 : -1;
  return { cvd, flowRatio: totalVolume > 0 ? cvd / totalVolume : null, aligned: totalVolume > 0 ? Math.sign(cvd) === expectedSign : null };
}

export function classifyFlowLabel(direction, futuresStats, spotStats, dataQuality = {}) {
  const futures = flowMetrics(direction, futuresStats);
  const spot = flowMetrics(direction, spotStats);
  if (!dataQuality.futuresFresh || !dataQuality.spotFresh || futures.aligned == null || spot.aligned == null) {
    return { label: 'DATA_INCOMPLETE', futures, spot };
  }
  let label = 'MIXED_FLOW';
  if (futures.aligned && spot.aligned) label = 'SPOT_CONFIRMED';
  else if (futures.aligned && !spot.aligned) label = 'FUTURES_LED';
  else if (!futures.aligned && spot.aligned) label = 'SPOT_LED';
  return { label, futures, spot };
}

export function classifyShadowTier({ participationPercentile, futuresAligned, spotAligned, dataComplete }) {
  if (!dataComplete) return 'DATA_INCOMPLETE';
  const anomalous = Number.isFinite(participationPercentile) && participationPercentile >= 90;
  if (anomalous && futuresAligned && spotAligned) return 'CONFLUENT';
  if (anomalous && futuresAligned && !spotAligned) return 'FUTURES_LED';
  return 'PRICE_ONLY';
}

export function calculateRecoveryPct(direction, startPrice, peakPrice, troughPrice, finalPrice) {
  if (direction === 'PUMP') {
    const excursion = peakPrice - startPrice;
    return excursion > 0 ? Math.max(0, Math.min(100, ((peakPrice - finalPrice) / excursion) * 100)) : 0;
  }
  const excursion = startPrice - troughPrice;
  return excursion > 0 ? Math.max(0, Math.min(100, ((finalPrice - troughPrice) / excursion) * 100)) : 0;
}

export function classifyPriceOutcome(recoveryPct, dataStatus = 'COMPLETE') {
  if (dataStatus !== 'COMPLETE' || !Number.isFinite(recoveryPct)) return 'DATA_INCOMPLETE';
  if (recoveryPct < 25) return 'CONTINUATION';
  if (recoveryPct < 50) return 'PARTIAL_RETRACE';
  return 'MEAN_REVERSION';
}

export function buildForwardOutcome({ event, price, timestamp, targetTime, pathHigh, pathLow }) {
  const triggerPrice = finite(event.triggerPrice ?? event.triggerSnapshot?.price);
  const expectedSign = event.direction === 'PUMP' ? 1 : -1;
  const rawReturnBps = triggerPrice > 0 ? ((price - triggerPrice) / triggerPrice) * 10_000 : 0;
  const mfeUsd = event.direction === 'PUMP' ? Math.max(0, pathHigh - triggerPrice) : Math.max(0, triggerPrice - pathLow);
  const maeUsd = event.direction === 'PUMP' ? Math.max(0, triggerPrice - pathLow) : Math.max(0, pathHigh - triggerPrice);
  const recoveryPct = calculateRecoveryPct(event.direction, triggerPrice, pathHigh, pathLow, price);
  const latenessMs = Math.max(0, timestamp - targetTime);
  const dataStatus = latenessMs <= 10_000 ? 'COMPLETE' : 'DATA_GAP';
  return {
    targetTime,
    observedAt: timestamp,
    price,
    latenessMs,
    dataStatus,
    rawReturnBps: Number(rawReturnBps.toFixed(2)),
    continuationBps: Number((rawReturnBps * expectedSign).toFixed(2)),
    mfeBps: Number(((mfeUsd / Math.max(1, triggerPrice)) * 10_000).toFixed(2)),
    maeBps: Number(((maeUsd / Math.max(1, triggerPrice)) * 10_000).toFixed(2)),
    recoveryPct: Number(recoveryPct.toFixed(1)),
    outcomeLabel: classifyPriceOutcome(recoveryPct, dataStatus),
  };
}

export function buildTimeframeContext(rawKlines, timeframe, now = Date.now()) {
  const closed = (Array.isArray(rawKlines) ? rawKlines : [])
    .filter((row) => Array.isArray(row) && finite(row[6], Infinity) <= now)
    .map((row) => ({ close: finite(row[4]), high: finite(row[2]), low: finite(row[3]), quoteVolume: finite(row[7]), closeTime: finite(row[6]) }));
  if (closed.length < 21) return { timeframe, status: 'UNAVAILABLE' };
  const recent = closed.slice(-20);
  const multiplier = 2 / 21;
  let ema = recent[0].close;
  const emaSeries = [ema];
  for (let index = 1; index < recent.length; index += 1) {
    ema = ((recent[index].close - ema) * multiplier) + ema;
    emaSeries.push(ema);
  }
  const close = recent.at(-1).close;
  const previousEma = emaSeries.at(-4);
  const structure = close > ema && ema > previousEma ? 'UP' : close < ema && ema < previousEma ? 'DOWN' : 'RANGE';
  const ranges = recent.map((row) => row.high - row.low);
  const natrPct = close > 0 ? (ranges.reduce((sum, value) => sum + value, 0) / ranges.length / close) * 100 : null;
  const volumes = closed.slice(-21, -1).map((row) => row.quoteVolume);
  return {
    timeframe,
    status: 'COMPLETE',
    structure,
    close,
    ema20: Number(ema.toFixed(2)),
    natrPct: natrPct == null ? null : Number(natrPct.toFixed(4)),
    volumePercentile: percentileRank(volumes, recent.at(-1).quoteVolume),
    lastClosedCandleTime: recent.at(-1).closeTime,
  };
}

export function median(values) {
  const sorted = (Array.isArray(values) ? values : []).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeGroup(key, events) {
  const outcomes = events.map((event) => event.forwardOutcomes?.['300']).filter(Boolean);
  const complete = outcomes.filter((outcome) => outcome.dataStatus === 'COMPLETE');
  return {
    key,
    n: events.length,
    completeN: complete.length,
    dataCompleteRate: events.length ? Number(((complete.length / events.length) * 100).toFixed(1)) : 0,
    medianReturnBps: median(complete.map((outcome) => outcome.continuationBps)),
    medianMfeBps: median(complete.map((outcome) => outcome.mfeBps)),
    medianMaeBps: median(complete.map((outcome) => outcome.maeBps)),
    continuationRate: complete.length ? Number(((complete.filter((outcome) => outcome.outcomeLabel === 'CONTINUATION').length / complete.length) * 100).toFixed(1)) : null,
    reversionRate: complete.length ? Number(((complete.filter((outcome) => outcome.outcomeLabel === 'MEAN_REVERSION').length / complete.length) * 100).toFixed(1)) : null,
    smallSample: events.length < SMALL_SAMPLE_SIZE,
  };
}

export function computeMoveStats(events) {
  const validEvents = Array.isArray(events) ? events : [];
  const detectionMap = new Map();
  const contextMap = new Map();
  validEvents.forEach((event) => {
    const windowKey = String(event.detectionWindowSec ?? event.detection?.windowSec ?? 'N/A');
    if (!detectionMap.has(windowKey)) detectionMap.set(windowKey, []);
    detectionMap.get(windowKey).push(event);
    ['5m', '15m', '1h'].forEach((timeframe) => {
      const structure = event.timeframeContext?.[timeframe]?.structure;
      if (!structure) return;
      const key = `${timeframe}:${structure}`;
      if (!contextMap.has(key)) contextMap.set(key, []);
      contextMap.get(key).push(event);
    });
  });
  return {
    generatedAt: Date.now(),
    overall: summarizeGroup('ALL', validEvents),
    detectionHorizons: Array.from(detectionMap.entries()).map(([key, group]) => summarizeGroup(key, group)).sort((a, b) => Number(a.key) - Number(b.key)),
    timeframeContexts: Array.from(contextMap.entries()).map(([key, group]) => summarizeGroup(key, group)).sort((a, b) => a.key.localeCompare(b.key)),
  };
}
