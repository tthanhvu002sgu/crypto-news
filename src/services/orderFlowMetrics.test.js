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

// Equal-volume buckets keep the selected-window ratio exact while the last
// bucket improves relative to a negative baseline (or weakens for the mirror).
function windowFixture(meanRatio, totalVolume = 6000, count = 60) {
  const offsets = Array.from({ length: count - 1 }, (_, index) =>
    index === count - 2 ? 0 : (index % 2 ? 4 : -4));
  const offsetMean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  const sign = meanRatio < 0 ? 1 : -1;
  const ratios = offsets.map((offset) => meanRatio - sign * 5 / count + offset - offsetMean);
  ratios.push(meanRatio + sign * (count - 1) * 5 / count);
  const points = ratios.map((ratio) => ({
    buyVol: totalVolume / count * (1 + ratio / 100) / 2,
    sellVol: totalVolume / count * (1 - ratio / 100) / 2,
    delta: totalVolume / count * ratio / 100,
  }));
  return computeFlowMetrics({
    points: [{ buyVol: 0, sellVol: 0, delta: 0 }, ...points],
    buyVolume: points.reduce((sum, point) => sum + point.buyVol, 0),
    sellVolume: points.reduce((sum, point) => sum + point.sellVol, 0),
    netDelta: meanRatio / 100 * totalVolume,
  });
}

test('negative Spot and Futures CVD reproduces the screenshot as sell consensus', () => {
  const spot = windowFixture(-12.19, 4590000 / 0.1219);
  const futures = windowFixture(-17.61, 88890000 / 0.1761);
  assert.ok(Math.abs(spot.netDelta + 4590000) < 1e-6);
  assert.ok(Math.abs(futures.netDelta + 88890000) < 1e-6);
  for (const result of [spot, futures]) {
    assert.ok(result.zScore > 1);
    assert.equal(result.direction, 'sell');
    assert.ok(result.strengthScore > 80);
    assert.equal(result.momentum, 'decelerating');
  }
  const verdict = classifySpotFutures(spot, futures);
  assert.equal(verdict.title, 'Bán đồng thuận');
  assert.equal(verdict.tone, 'bearish');
});

test('window direction survives opposite latest-bucket anomalies in all CVD bucket counts', () => {
  for (const count of [60, 24, 42, 30]) {
    const sell = windowFixture(-12, 6000, count);
    const buy = windowFixture(12, 6000, count);
    assert.ok(sell.zScore > 1);
    assert.ok(buy.zScore < -1);
    assert.equal(sell.direction, 'sell');
    assert.equal(buy.direction, 'buy');
    assert.equal(sell.strengthScore, buy.strengthScore);
    assert.equal(classifySpotFutures(buy, buy).title, 'Mua đồng thuận');
  }
});

test('missing deltas fall back to buy minus sell, including per-bucket deltas', () => {
  const points = [40, 42, 44, 46, 48, 49].map((buyVol) => ({ buyVol, sellVol: 100 - buyVol, delta: null }));
  const result = computeFlowMetrics({ points, buyVolume: 269, sellVolume: 331 });
  assert.equal(result.netDelta, -62);
  assert.equal(result.direction, 'sell');
  assert.ok(result.zScore > 1);
});

test('neutral threshold uses window pressure even with a large z-score', () => {
  for (const ratio of [-0.351, -0.35, -0.349, 0, 0.349, 0.35, 0.351]) {
    const result = computeFlowMetrics({ buyVolume: 500, sellVolume: 500, netDelta: ratio * 10 });
    assert.equal(result.direction, Math.abs(ratio) < 0.35 ? 'neutral' : ratio > 0 ? 'buy' : 'sell');
  }
  const points = [49, 50, 49, 50, 49, 90].map((buyVol) => ({ buyVol, sellVol: 100 - buyVol }));
  const result = computeFlowMetrics({ points, buyVolume: 500, sellVolume: 500, netDelta: 0 });
  assert.ok(result.zScore > 1);
  assert.equal(result.direction, 'neutral');
  assert.equal(result.strengthScore, 0);
  assert.equal(classifySpotFutures(result, result).confidence, 45);
});

test('missing or zero volume does not produce a confident balanced verdict', () => {
  const valid = computeFlowMetrics({ buyVolume: 400, sellVolume: 600 });
  for (const input of [{}, { buyVolume: null, sellVolume: null }, { buyVolume: -1, sellVolume: 100 }]) {
    const missing = computeFlowMetrics(input);
    assert.equal(missing.hasData, false);
    assert.equal(missing.direction, 'neutral');
    assert.equal(missing.strengthScore, null);
    assert.equal(missing.deltaRatioPct, null);
    assert.equal(classifySpotFutures(missing, valid).confidence, null);
    assert.equal(classifySpotFutures(valid, missing).title, 'Chưa đủ dữ liệu dòng lệnh');
  }
  assert.equal(classifySpotFutures(null, valid).confidence, null);
});

test('momentum measures strengthening or weakening of the current buy/sell side', () => {
  for (const [ratios, expected] of [
    [[-5, -5, -5, -20, -20, -20], 'accelerating'],
    [[-20, -20, -20, -5, -5, -5], 'decelerating'],
    [[5, 5, 5, 20, 20, 20], 'accelerating'],
    [[20, 20, 20, 5, 5, 5], 'decelerating'],
    [[-5, -5, -5, -5, -5, -5], 'stable'],
  ]) {
    const points = ratios.map((ratio) => ({ buyVol: (100 + ratio) / 2, sellVol: (100 - ratio) / 2 }));
    const result = computeFlowMetrics({ points, buyVolume: points.reduce((sum, p) => sum + p.buyVol, 0), sellVolume: points.reduce((sum, p) => sum + p.sellVol, 0) });
    assert.equal(result.momentum, expected);
  }
});

test('all nine Spot/Futures directions preserve verdicts and symmetric confidence', () => {
  const metrics = {
    buy: computeFlowMetrics({ buyVolume: 600, sellVolume: 400 }),
    sell: computeFlowMetrics({ buyVolume: 400, sellVolume: 600 }),
    neutral: computeFlowMetrics({ buyVolume: 500, sellVolume: 500 }),
  };
  const expected = [
    ['buy', 'buy', 'Mua đồng thuận'], ['sell', 'sell', 'Bán đồng thuận'],
    ['buy', 'sell', 'Spot hấp thụ Futures'], ['sell', 'buy', 'Nhịp tăng dùng đòn bẩy'],
    ['buy', 'neutral', 'Spot dẫn dắt'], ['sell', 'neutral', 'Spot phân phối'],
    ['neutral', 'buy', 'Futures dẫn dắt'], ['neutral', 'sell', 'Futures nghiêng Short'],
    ['neutral', 'neutral', 'Dòng lệnh cân bằng'],
  ];
  for (const [spot, futures, title] of expected) {
    const result = classifySpotFutures(metrics[spot], metrics[futures]);
    assert.equal(result.title, title);
    assert.ok(result.confidence >= 45 && result.confidence <= 92);
  }
  assert.equal(classifySpotFutures(metrics.buy, metrics.buy).confidence, classifySpotFutures(metrics.sell, metrics.sell).confidence);
});

test('positioning covers sell-side, absorption, missing values and funding context', () => {
  for (const [priceChangePct, oiChangePct, flowDirection, label] of [
    [-2, 1, 'sell', 'Short mới tham gia'], [-2, -1, 'sell', 'Long liquidation'],
    [2, 1, 'sell', 'Sell absorption'], [-2, 1, 'buy', 'Buy absorption / trapped longs'],
    [0, 0, 'buy', 'Dòng vị thế hỗn hợp'],
    [null, 1, 'buy', 'Chưa đủ dữ liệu định vị'], [1, null, 'buy', 'Chưa đủ dữ liệu định vị'],
    [1, 1, undefined, 'Chưa đủ dữ liệu định vị'], [1, 1, 'neutral', 'Chưa đủ dữ liệu định vị'],
  ]) {
    assert.equal(classifyFuturesPositioning({ priceChangePct, oiChangePct, flowDirection }).label, label);
  }
  const base = { priceChangePct: -2, oiChangePct: 1, flowDirection: 'sell' };
  assert.match(classifyFuturesPositioning({ ...base, fundingRate: 0.0005 }).detail, /crowded longs/);
  assert.match(classifyFuturesPositioning({ ...base, fundingRate: -0.0005 }).detail, /crowded shorts/);
});
