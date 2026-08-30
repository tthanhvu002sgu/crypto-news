import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFuturesPositioning, classifySpotFutures, computeFlowMetrics } from './orderFlowMetrics.js';

test('computeFlowMetrics normalizes CVD by selected-window volume', () => {
  const result = computeFlowMetrics({ buyVolume: 600, sellVolume: 400, netDelta: 200 });
  assert.equal(result.deltaRatioPct, 20);
  assert.equal(result.direction, 'buy');
  assert.equal(result.totalVolume, 1000);
});

test('computeFlowMetrics derives a latest-bucket z-score without using future data', () => {
  const points = [52, 51, 50, 49, 48, 70].map((buyVol) => ({ buyVol, sellVol: 100 - buyVol, delta: (buyVol * 2) - 100 }));
  const result = computeFlowMetrics({ points, buyVolume: 320, sellVolume: 280, netDelta: 40 });
  assert.ok(result.zScore > 2);
});

test('classifySpotFutures flags a futures-only buy move', () => {
  const result = classifySpotFutures({ direction: 'neutral', strengthScore: 50 }, { direction: 'buy', strengthScore: 72 });
  assert.equal(result.title, 'Futures dẫn dắt');
  assert.equal(result.tone, 'warning');
});

test('classifyFuturesPositioning distinguishes new longs from short covering', () => {
  assert.equal(classifyFuturesPositioning({ priceChangePct: 2, oiChangePct: 1, flowDirection: 'buy' }).label, 'Long mới tham gia');
  assert.equal(classifyFuturesPositioning({ priceChangePct: 2, oiChangePct: -1, flowDirection: 'buy' }).label, 'Short covering');
});
