import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateBuckets,
  buildDetectionScores,
  buildForwardOutcome,
  buildTimeframeContext,
  classifyFlowLabel,
  classifyPriceOutcome,
  classifyShadowTier,
  computeMoveStats,
  selectMoveCandidate,
} from './moveTrackerCore.js';

function bucket(ts, price, volume = 100, buys = 60) {
  return {
    ts,
    open: price,
    high: price,
    low: price,
    close: price,
    totalVolume: volume,
    totalQty: 1,
    tradeCount: 1,
    takerBuyVol: buys,
    takerSellVol: volume - buys,
    largeTradesCount: 0,
    largeTradesVol: 0,
    maxSingleTradeUsd: volume,
    maxSingleTradeSide: 'BUY',
  };
}

test('detector records every horizon and selects the strongest triggered score without mutating buckets', () => {
  const now = 120_000;
  const buckets = Array.from({ length: 121 }, (_, index) => bucket(index * 1000, 100 + index * 0.05));
  const before = structuredClone(buckets);
  const scores = buildDetectionScores({ buckets, price: 120, now, atrValue: 20, atrMultiplier: 1, mode: 'ATR' });
  assert.deepEqual(scores.map((score) => score.windowSec), [15, 30, 60, 120]);
  assert.ok(scores.some((score) => score.triggered));
  assert.equal(selectMoveCandidate(scores).direction, 'PUMP');
  assert.deepEqual(buckets, before);
});

test('aggregateBuckets includes each bucket exactly once inside the requested window', () => {
  const buckets = [bucket(0, 100, 100), bucket(1000, 101, 200), bucket(2000, 102, 300)];
  const result = aggregateBuckets(buckets, 1000, 2000);
  assert.equal(result.totalVolume, 500);
  assert.equal(result.tradeCount, 2);
});

test('flow and shadow labels are descriptive and data-health gated', () => {
  const futures = { totalVolume: 100, takerBuyVol: 70, takerSellVol: 30 };
  const spot = { totalVolume: 80, takerBuyVol: 50, takerSellVol: 30 };
  assert.equal(classifyFlowLabel('PUMP', futures, spot, { futuresFresh: true, spotFresh: true }).label, 'SPOT_CONFIRMED');
  assert.equal(classifyShadowTier({ participationPercentile: 95, futuresAligned: true, spotAligned: true, dataComplete: true }), 'CONFLUENT');
  assert.equal(classifyShadowTier({ participationPercentile: 99, futuresAligned: true, spotAligned: true, dataComplete: false }), 'DATA_INCOMPLETE');
});

test('price outcome boundaries are stable at 25% and 50%', () => {
  assert.equal(classifyPriceOutcome(24.999), 'CONTINUATION');
  assert.equal(classifyPriceOutcome(25), 'PARTIAL_RETRACE');
  assert.equal(classifyPriceOutcome(49.999), 'PARTIAL_RETRACE');
  assert.equal(classifyPriceOutcome(50), 'MEAN_REVERSION');
  assert.equal(classifyPriceOutcome(10, 'DATA_GAP'), 'DATA_INCOMPLETE');
});

test('forward outcome is decision-time anchored and reports late observations as a gap', () => {
  const event = { direction: 'PUMP', triggerPrice: 100, triggerSnapshot: { price: 100 } };
  const before = structuredClone(event);
  const complete = buildForwardOutcome({ event, price: 101, timestamp: 15_000, targetTime: 15_000, pathHigh: 102, pathLow: 99 });
  assert.equal(complete.continuationBps, 100);
  assert.equal(complete.mfeBps, 200);
  assert.equal(complete.maeBps, 100);
  assert.equal(complete.dataStatus, 'COMPLETE');
  const gap = buildForwardOutcome({ event, price: 101, timestamp: 26_001, targetTime: 15_000, pathHigh: 102, pathLow: 99 });
  assert.equal(gap.dataStatus, 'DATA_GAP');
  assert.deepEqual(event, before);
});

test('timeframe context ignores the open candle and stats mark small samples', () => {
  const now = 100_000;
  const closed = Array.from({ length: 25 }, (_, index) => [0, 100 + index, 102 + index, 99 + index, 101 + index, 0, 1_000 + index, 1_000 + index]);
  const open = [0, 999, 1200, 1, 1000, 0, now + 10_000, 999_999];
  const context = buildTimeframeContext([...closed, open], '5m', now);
  assert.notEqual(context.close, 1000);
  const event = {
    detectionWindowSec: 15,
    timeframeContext: { '5m': { structure: 'UP' } },
    forwardOutcomes: { '300': { dataStatus: 'COMPLETE', continuationBps: 10, mfeBps: 20, maeBps: 5, outcomeLabel: 'CONTINUATION' } },
  };
  const stats = computeMoveStats([event]);
  assert.equal(stats.detectionHorizons[0].n, 1);
  assert.equal(stats.detectionHorizons[0].smallSample, true);
  assert.equal(stats.timeframeContexts[0].key, '5m:UP');
});
