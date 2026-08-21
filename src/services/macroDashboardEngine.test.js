import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMacroDashboard,
  macroDashboardInternals,
} from './macroDashboardEngine.js';

const candles = (length, priceAt, overrides = {}) => Array.from({ length }, (_, index) => {
  const close = priceAt(index);
  return {
    time: new Date(Date.UTC(2017, 0, 1 + index * 7)),
    open: close,
    high: close,
    low: close,
    close,
    volume: index + 1,
    isClosed: index < length - 1,
    ...overrides,
  };
});

test('rolling helpers match Pine window semantics', () => {
  assert.deepEqual(
    macroDashboardInternals.rollingSma([1, 2, 3, 4], 3),
    [null, null, 2, 3],
  );

  const stdev = macroDashboardInternals.rollingPopulationStdev([1, 2, 3], 3);
  assert.ok(Math.abs(stdev[2] - Math.sqrt(2 / 3)) < 1e-12);
});

test('OLS uses bars-ago x and recovers exponential forward CAGR', () => {
  const closes = Array.from({ length: 200 }, (_, index) => Math.exp(Math.log(100) + 0.01 * index));
  const ols = macroDashboardInternals.olsAt(closes, 199, 200, 0.01);
  assert.ok(Math.abs(ols.b + 0.01) < 1e-12);
  assert.ok(Math.abs(Math.exp(ols.a) - closes[199]) < 1e-8);

  const expectedCagr = (Math.exp(0.01 * 52) - 1) * 100;
  const result = calculateMacroDashboard(candles(300, (index) => Math.exp(Math.log(100) + 0.01 * index)));
  assert.ok(Math.abs(result.current.impliedCagr - expectedCagr) < 1e-8);
});

test('default SMA cohort ROI is the exact 52/104/156/208-bar Pine calculation', () => {
  const result = calculateMacroDashboard(candles(500, (index) => index + 1));
  const currentPrice = 500;
  const periods = [52, 104, 156, 208];
  const expectedRois = periods.map((period) => {
    const basis = currentPrice - (period - 1) / 2;
    return (currentPrice / basis - 1) * 100;
  });

  result.current.rois.forEach((roi, index) => {
    assert.ok(Math.abs(roi - expectedRois[index]) < 1e-10);
  });
  const expectedAverage = expectedRois.reduce((sum, value) => sum + value, 0) / 4;
  assert.ok(Math.abs(result.current.weightedAverage - expectedAverage) < 1e-10);
  assert.equal(result.current.pnlZone, 'GIFT');
  assert.equal(result.current.percentile, 0);
});

test('cohort years remain years*52 bars when locked timeframe changes', () => {
  const input = candles(500, (index) => 20000 + index * 50 + Math.sin(index / 7) * 300);
  const weekly = calculateMacroDashboard(input, { timeframe: 'W' });
  const daily = calculateMacroDashboard(input, { timeframe: 'D' });
  assert.deepEqual(daily.current.rois, weekly.current.rois);
  assert.equal(daily.current.weightedAverage, weekly.current.weightedAverage);
  assert.notEqual(daily.current.impliedCagr, weekly.current.impliedCagr);
});

test('result exposes W0, W-1 and the developing-candle state', () => {
  const result = calculateMacroDashboard(candles(500, (index) => 30000 + index * 100));
  assert.equal(result.current.price, 79900);
  assert.equal(result.current.isClosed, false);
  assert.equal(result.previous.price, 79800);
  assert.equal(result.previous.isClosed, true);
});
