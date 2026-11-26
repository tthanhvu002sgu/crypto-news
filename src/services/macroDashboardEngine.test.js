import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLivePriceToMacroCandles,
  calculateMacroDashboard,
  macroDashboardInternals,
  CHART_RANGES,
  chartBarsForRange,
  normalizeMacroCandles,
  ENGINE_MODES,
  MACRO_SOP_PRESET,
  checkSopConfigCompliance,
  evaluateSopAction,
  isGreenBubble,
  isRedBubble,
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

test('cached candle timestamps are rehydrated as Date objects', () => {
  const cached = JSON.parse(JSON.stringify(candles(3, (index) => 100 + index)));
  const normalized = normalizeMacroCandles(cached);

  assert.equal(normalized.length, 3);
  assert.ok(normalized.every((candle) => candle.time instanceof Date));
  assert.equal(normalized[0].time.toISOString(), cached[0].time);
});

test('CHART_RANGES contains 6M, 1Y, 3Y, 5Y, ALL and calculates correct bar count', () => {
  assert.deepEqual(CHART_RANGES, ['6M', '1Y', '3Y', '5Y', 'ALL']);

  // ALL returns Infinity
  assert.equal(chartBarsForRange('ALL', 'W'), Infinity);
  assert.equal(chartBarsForRange('ALL', 'D'), Infinity);
  assert.equal(chartBarsForRange('ALL', 'M'), Infinity);

  // 6M (months)
  assert.equal(chartBarsForRange('6M', 'W'), 26);
  assert.equal(chartBarsForRange('6M', 'D'), 183);
  assert.equal(chartBarsForRange('6M', 'M'), 6);

  // 1Y
  assert.equal(chartBarsForRange('1Y', 'W'), 52);
  assert.equal(chartBarsForRange('1Y', 'D'), 365);
  assert.equal(chartBarsForRange('1Y', 'M'), 12);

  // 3Y
  assert.equal(chartBarsForRange('3Y', 'W'), 156);
  assert.equal(chartBarsForRange('3Y', 'D'), 1095);
  assert.equal(chartBarsForRange('3Y', 'M'), 36);

  // 5Y
  assert.equal(chartBarsForRange('5Y', 'W'), 260);
  assert.equal(chartBarsForRange('5Y', 'D'), 1825);
  assert.equal(chartBarsForRange('5Y', 'M'), 60);
});

test('math_v3 exposes per-bar alerts, convictionScore, and fixes cold-start GIFT bug', () => {
  const rally = candles(40, (index) => 1000 * Math.exp(0.08 * index), { isClosed: true });
  const result = calculateMacroDashboard(rally, MACRO_SOP_PRESET);

  assert.equal(result.settings.engineMode, ENGINE_MODES.MATH_V3);
  assert.equal(result.series[17].percentile, 50);
  assert.notEqual(result.series[17].pnlZone, 'GIFT');
  assert.equal(typeof result.current.convictionScore, 'number');
  assert.ok(result.series.every((row) => row.alerts && typeof row.alerts.strongAccum === 'boolean'));
});

test('checkSopConfigCompliance verifies standard SOP preset and flags mismatches', () => {
  const ok = checkSopConfigCompliance(MACRO_SOP_PRESET);
  assert.equal(ok.isCompliant, true);
  assert.equal(ok.mismatches.length, 0);

  const bad = checkSopConfigCompliance({ engineMode: 'pine_v2', costMethod: 'SMA', timeframe: 'D' });
  assert.equal(bad.isCompliant, false);
  const mismatchKeys = bad.mismatches.map((m) => m.key);
  assert.ok(mismatchKeys.includes('engineMode'));
  assert.ok(mismatchKeys.includes('costMethod'));
  assert.ok(mismatchKeys.includes('timeframe'));
});

test('evaluateSopAction uses latest closed bar and computes Rule 1, Rule 2, and CY-4 accurately', () => {
  const mkRow = (overrides) => ({
    time: new Date('2026-11-16T00:00:00Z'),
    isClosed: true,
    price: 20000,
    composite: 0,
    divergence: false,
    decision: 'NEUTRAL',
    ...overrides,
  });

  // 1. Green Bubble Week 1 on closed bar (even if live W0 is neutral)
  const gb1 = evaluateSopAction({
    settings: MACRO_SOP_PRESET,
    series: [
      mkRow({ time: new Date('2026-11-09T00:00:00Z'), composite: 2, decision: 'ACCUMULATE' }),
      mkRow({ time: new Date('2026-11-16T00:00:00Z'), composite: 4, decision: 'STRONG ACCUM' }),
      mkRow({ time: new Date('2026-11-23T00:00:00Z'), isClosed: false, composite: 1, decision: 'ACCUMULATE' }),
    ],
  }, { weeklyBudget: 1000, cashReserve: 80000 });

  assert.equal(gb1.status, 'GREEN_BUBBLE_BUY');
  assert.equal(gb1.gbStreak, 1);
  assert.equal(gb1.isLiveDeveloping, true);
  assert.equal(gb1.rule1.spendUsd, 80000);
  assert.equal(gb1.rule1.remainingReserveUsd, 0);
  assert.equal(gb1.rule2.spendUsd, 40000);
  assert.equal(gb1.rule2.remainingReserveUsd, 40000);

  // 2. Green Bubble Week 2+ -> Rule 1 deploys 100% of current cashReserve (GB-7), Rule 2 deploys 50%
  const gb2 = evaluateSopAction({
    settings: MACRO_SOP_PRESET,
    series: [
      mkRow({ time: new Date('2026-11-09T00:00:00Z'), composite: 3, decision: 'STRONG ACCUM' }),
      mkRow({ time: new Date('2026-11-16T00:00:00Z'), composite: 4, decision: 'STRONG ACCUM' }),
    ],
  }, { weeklyBudget: 1000, cashReserve: 42000 });

  assert.equal(gb2.status, 'GREEN_BUBBLE_BUY');
  assert.equal(gb2.gbStreak, 2);
  assert.equal(gb2.rule1.spendUsd, 42000);
  assert.equal(gb2.rule1.remainingReserveUsd, 0);
  assert.equal(gb2.rule2.spendUsd, 21000);

  // 3. Divergence or ACCUMULATE (+2) -> WAIT_ACCUMULATE_CASH (never buy)
  const wait = evaluateSopAction({
    settings: MACRO_SOP_PRESET,
    series: [
      mkRow({ composite: 3, divergence: true, decision: 'MIXED / WAIT' }),
    ],
  }, { weeklyBudget: 1000, cashReserve: 50000 });

  assert.equal(isGreenBubble(wait.signalBar), false);
  assert.equal(wait.status, 'WAIT_ACCUMULATE_CASH');
  assert.equal(wait.rule1.spendUsd, 0);
  assert.equal(wait.rule2.spendUsd, 0);

  // 4. Red Bubble Week 1 -> CY-4 take profit active
  const rb1 = evaluateSopAction({
    settings: MACRO_SOP_PRESET,
    series: [
      mkRow({ composite: -3, divergence: false, decision: 'STRONG DIST' }),
    ],
  }, { weeklyBudget: 1000, cashReserve: 10000 });

  assert.equal(isRedBubble(rb1.signalBar), true);
  assert.equal(rb1.status, 'RED_BUBBLE_TAKE_PROFIT');
  assert.equal(rb1.cy4.active, true);
  assert.equal(rb1.cy4.isFirstWeek, true);
});

test('LOGIC-003 & LOGIC-006 regressions: dynamic isClosed, safe livePrice override, and math_v3 zMode compliance', () => {
  const nowMs = Date.UTC(2026, 10, 25, 12, 0, 0);
  const raw = [
    { time: '2026-11-16T00:00:00Z', open: 100, high: 110, low: 95, close: 105, volume: 10, closeTime: nowMs - 1000, isClosed: false },
  ];
  const normalizedClosed = normalizeMacroCandles(raw, nowMs);
  assert.equal(normalizedClosed[0].isClosed, true);

  // Closed candle must NOT be mutated by livePrice
  const untouched = applyLivePriceToMacroCandles(normalizedClosed, 99999, nowMs);
  assert.equal(untouched[0].close, 105);

  // Open candle MUST update close and expand high/low
  const openCandle = normalizeMacroCandles([
    { time: '2026-11-23T00:00:00Z', open: 100, high: 110, low: 95, close: 105, volume: 10, closeTime: nowMs + 60000, isClosed: false },
  ], nowMs);
  const updatedHigh = applyLivePriceToMacroCandles(openCandle, 125, nowMs);
  assert.equal(updatedHigh[0].close, 125);
  assert.equal(updatedHigh[0].high, 125);
  assert.equal(updatedHigh[0].low, 95);

  // math_v3 ignores zMode, so Adaptive must still be SOP-compliant
  const v3Adaptive = checkSopConfigCompliance({ ...MACRO_SOP_PRESET, zMode: 'Adaptive' });
  assert.equal(v3Adaptive.isCompliant, true);
});

test('LOGIC-005 regression: CY-4 triggers at most once per cycle between Green Bubbles', () => {
  const mkRow = (date, composite) => ({
    time: new Date(`${date}T00:00:00Z`),
    isClosed: true,
    price: 50000,
    composite,
    divergence: false,
    decision: composite >= 3 ? 'STRONG ACCUM' : composite <= -3 ? 'STRONG DIST' : 'NEUTRAL',
  });

  // Cycle 1: GB -> RB1 (first) -> NEUTRAL dip -> RB2 (re-entry in same cycle -> must NOT re-trigger CY-4)
  const sameCycleSeries = [
    mkRow('2022-11-14', 3),
    mkRow('2024-11-18', -3),
    mkRow('2024-11-25', -2),
    mkRow('2024-12-02', -3),
  ];

  const firstRb = evaluateSopAction({ settings: MACRO_SOP_PRESET, series: sameCycleSeries.slice(0, 2) });
  assert.equal(firstRb.cy4.active, true);
  assert.equal(firstRb.cy4.isFirstWeek, true);
  assert.equal(firstRb.cy4.alreadyTriggeredInCycle, false);

  const reEntryRb = evaluateSopAction({ settings: MACRO_SOP_PRESET, series: sameCycleSeries });
  assert.equal(reEntryRb.cy4.active, true);
  assert.equal(reEntryRb.cy4.isFirstWeek, false);
  assert.equal(reEntryRb.cy4.alreadyTriggeredInCycle, true);
  assert.equal(reEntryRb.cy4.firstTriggerTime.toISOString().slice(0, 10), '2024-11-18');

  // Post-RB neutral cooldown in same cycle: action must reflect already-triggered state (no contradiction)
  const postRbNeutral = evaluateSopAction({
    settings: MACRO_SOP_PRESET,
    series: [...sameCycleSeries, mkRow('2025-01-06', 1)],
  });
  assert.equal(postRbNeutral.cy4.active, false);
  assert.equal(postRbNeutral.cy4.alreadyTriggeredInCycle, true);
  assert.ok(postRbNeutral.cy4.action.includes('2024-11-18'));
  assert.ok(!postRbNeutral.cy4.action.includes('CHƯA KÍCH HOẠT'));

  // New Cycle 2: another GB resets CY-4 so RB3 triggers again
  const nextCycleSeries = [
    ...sameCycleSeries,
    mkRow('2026-11-16', 3),
    mkRow('2028-11-20', -3),
  ];
  const nextCycleRb = evaluateSopAction({ settings: MACRO_SOP_PRESET, series: nextCycleSeries });
  assert.equal(nextCycleRb.cy4.active, true);
  assert.equal(nextCycleRb.cy4.isFirstWeek, true);
  assert.equal(nextCycleRb.cy4.alreadyTriggeredInCycle, false);
});

test('LOGIC-003 regression: normalizeMacroCandles filters non-positive OHLC and clamps negative volume', () => {
  const normalized = normalizeMacroCandles([
    { time: '2026-11-09T00:00:00Z', open: 0, high: 0, low: 0, close: 0, volume: 10 },
    { time: '2026-11-16T00:00:00Z', open: 100, high: 110, low: 95, close: 105, volume: -5 },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].close, 105);
  assert.equal(normalized[0].volume, 0);
});
