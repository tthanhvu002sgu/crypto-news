import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  calculateMacroDashboard,
  isGreenBubble,
  isRedBubble,
  MACRO_SOP_PRESET,
  macroDashboardInternals,
  normalizeMacroCandles,
} from '../src/engine.js';
import { loadCandlesFromFile } from '../src/dataLoader.js';
import {
  calculateMacroDashboard as appCalculateMacroDashboard,
} from '../../src/services/macroDashboardEngine.js';

const syntheticCandles = (length, priceAt) => Array.from({ length }, (_, index) => {
  const close = priceAt(index);
  return {
    time: new Date(Date.UTC(2017, 0, 1 + index * 7)),
    open: close * 0.99,
    high: close * 1.03,
    low: close * 0.97,
    close,
    volume: 1000 + index * 10,
    isClosed: true,
  };
});

test('100% parity with src/services/macroDashboardEngine.js across settings presets', () => {
  const input = syntheticCandles(320, (i) => 10000 * Math.exp(0.004 * i + 0.35 * Math.sin(i / 18)));
  const presets = [
    {},
    { costMethod: 'EMA', weightScheme: 'Short-heavy', zMode: 'Adaptive', sigmaMethod: 'Rolling Std' },
    { costMethod: 'VWAP', weightScheme: 'Long-heavy', zoneMethod: 'Convergence', useDualWindow: false, useHysteresis: false },
    { timeframe: 'D', costMethod: 'Median HL' },
  ];

  for (const settings of presets) {
    const standalone = calculateMacroDashboard(input, settings);
    const original = appCalculateMacroDashboard(input, settings);

    assert.equal(standalone.series.length, original.series.length);
    for (let i = 0; i < original.series.length; i += 1) {
      const a = standalone.series[i];
      const b = original.series[i];
      assert.equal(a.valZone, b.valZone);
      assert.equal(a.pnlZone, b.pnlZone);
      assert.equal(a.composite, b.composite);
      assert.equal(a.divergence, b.divergence);
      assert.equal(a.decision, b.decision);
      assert.ok(Math.abs(a.fairValue - b.fairValue) < 1e-9);
      assert.ok(Math.abs(a.valZLong - b.valZLong) < 1e-9);
      assert.ok(Math.abs(a.valZShort - b.valZShort) < 1e-9);
      assert.ok(Math.abs(a.weightedAverage - b.weightedAverage) < 1e-9);
      assert.ok(Math.abs(a.percentile - b.percentile) < 1e-9);
    }
    assert.deepEqual(standalone.alerts, original.alerts);
  }
});

test('strict causality: truncating future bars never alters past signals (no lookahead)', () => {
  const input = syntheticCandles(300, (i) => 5000 * Math.exp(0.005 * i + 0.5 * Math.sin(i / 14)));
  const full = calculateMacroDashboard(input);

  for (const cutoff of [50, 150, 220, 280]) {
    const prefix = calculateMacroDashboard(input.slice(0, cutoff + 1));
    const expected = full.series[cutoff];
    const actual = prefix.current;

    assert.equal(actual.valZone, expected.valZone);
    assert.equal(actual.pnlZone, expected.pnlZone);
    assert.equal(actual.composite, expected.composite);
    assert.equal(actual.decision, expected.decision);
    assert.ok(Math.abs(actual.valZLong - expected.valZLong) < 1e-12);
    assert.ok(Math.abs(actual.percentile - expected.percentile) < 1e-12);
    assert.ok(Math.abs(actual.fairValue - expected.fairValue) < 1e-12);
  }
});

test('rolling helpers & normalization work identically in standalone engine', () => {
  assert.deepEqual(
    macroDashboardInternals.rollingSma([1, 2, 3, 4], 3),
    [null, null, 2, 3],
  );
  const normalized = normalizeMacroCandles([
    { time: '2020-01-02T00:00:00Z', open: 10, high: 12, low: 9, close: 11, volume: 5 },
    { time: '2020-01-01T00:00:00Z', open: 8, high: 11, low: 7, close: 10, volume: 4 },
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].close, 10);
  assert.equal(normalized[1].close, 11);
});

test('math_v3: 100% parity between standalone and app engine + strict causality', () => {
  const input = syntheticCandles(340, (i) => 10000 * Math.exp(0.003 * i + 0.45 * Math.sin(i / 18)));
  const settings = { engineMode: 'math_v3', costMethod: 'VWAP', useDualWindow: true, useHysteresis: true };

  const standalone = calculateMacroDashboard(input, settings);
  const original = appCalculateMacroDashboard(input, settings);
  assert.equal(standalone.series.length, original.series.length);

  for (let i = 0; i < original.series.length; i += 1) {
    assert.equal(standalone.series[i].valZone, original.series[i].valZone);
    assert.equal(standalone.series[i].pnlZone, original.series[i].pnlZone);
    assert.equal(standalone.series[i].composite, original.series[i].composite);
    assert.ok(Math.abs(standalone.series[i].valZLong - original.series[i].valZLong) < 1e-9);
    assert.ok(Math.abs(standalone.series[i].convictionScore - original.series[i].convictionScore) < 1e-9);
    assert.ok(Math.abs(standalone.series[i].valOverheatZ - original.series[i].valOverheatZ) < 1e-9);
    assert.ok(Math.abs(standalone.series[i].pnlOverheatZ - original.series[i].pnlOverheatZ) < 1e-9);
    assert.ok(Math.abs(standalone.series[i].athDrawdownPct - original.series[i].athDrawdownPct) < 1e-9);
  }

  for (const cutoff of [40, 120, 220, 300]) {
    const prefix = calculateMacroDashboard(input.slice(0, cutoff + 1), settings);
    assert.equal(prefix.current.composite, standalone.series[cutoff].composite);
    assert.equal(prefix.current.valZone, standalone.series[cutoff].valZone);
    assert.equal(prefix.current.pnlZone, standalone.series[cutoff].pnlZone);
    assert.ok(Math.abs(prefix.current.valZLong - standalone.series[cutoff].valZLong) < 1e-12);
    assert.ok(Math.abs(prefix.current.valOverheatZ - standalone.series[cutoff].valOverheatZ) < 1e-12);
    assert.ok(Math.abs(prefix.current.pnlOverheatZ - standalone.series[cutoff].pnlOverheatZ) < 1e-12);
    assert.ok(Math.abs(prefix.current.percentile - standalone.series[cutoff].percentile) < 1e-12);
  }
});

test('math_v3: fixes cold-start GIFT bug, wash-volume distortion, and dual-confirm hysteresis latch', () => {
  // Cold-start parabolic rally should never be classified as pnlZone = GIFT
  const rally = syntheticCandles(40, (i) => 1000 * Math.exp(0.08 * i));
  const resRally = calculateMacroDashboard(rally, { engineMode: 'math_v3', costMethod: 'VWAP' });
  assert.notEqual(resRally.series[17].pnlZone, 'GIFT');
  assert.equal(resRally.series[17].percentile, 50);

  // 10x wash-volume spike during 26-bar window should distort math_v3 far less than raw pine_v2 VWAP
  const base = syntheticCandles(260, (i) => 20000 * Math.exp(0.002 * i + 0.3 * Math.sin(i / 20)));
  const washed = base.map((c, i) => (i >= 100 && i <= 125 ? { ...c, volume: c.volume * 10 } : c));
  const rBaseV3 = calculateMacroDashboard(base, { engineMode: 'math_v3', costMethod: 'VWAP' });
  const rWashV3 = calculateMacroDashboard(washed, { engineMode: 'math_v3', costMethod: 'VWAP' });
  const rBaseV2 = calculateMacroDashboard(base, { engineMode: 'pine_v2', costMethod: 'VWAP' });
  const rWashV2 = calculateMacroDashboard(washed, { engineMode: 'pine_v2', costMethod: 'VWAP' });
  const v3Diff = Math.abs(rBaseV3.current.weightedAverage - rWashV3.current.weightedAverage);
  const v2Diff = Math.abs(rBaseV2.current.weightedAverage - rWashV2.current.weightedAverage);
  assert.ok(v3Diff < v2Diff, `Expected math_v3 wash distortion (${v3Diff.toFixed(2)}) < pine_v2 (${v2Diff.toFixed(2)})`);

  // Dual-confirm invariant: GIFT must not remain latched when valZShort > 0; BUBBLE must stay near 4Y ATH
  for (const row of rBaseV3.series) {
    if (row.valZone === 'GIFT') assert.ok(row.valZShort <= 0);
    if (row.valZone === 'BUBBLE') assert.ok(row.athDrawdownPct >= -15);
  }
});

test('math_v3 SOP on BTCUSDT 1W: preserves exact 20 GB bars and detects ATH-only RB cycle tops', async () => {
  const btcCandles = await loadCandlesFromFile(fileURLToPath(new URL('../data/BTCUSDT_1w_10000.json', import.meta.url)));
  const { series } = calculateMacroDashboard(btcCandles, MACRO_SOP_PRESET);

  const gbs = series.filter((r) => isGreenBubble(r));
  const rbs = series.filter((r) => isRedBubble(r));

  // Exact 20 GB bars preserved (including 2018-12-10 and 2022-11-14..2023-01-02)
  assert.equal(gbs.length, 20);
  const gbDates = new Set(gbs.map((r) => r.time.toISOString().slice(0, 10)));
  assert.ok(gbDates.has('2018-12-10'));
  assert.ok(gbDates.has('2022-11-14'));
  assert.ok(gbDates.has('2023-01-02'));

  // Zero false-positive RB during 2019 bear-echo rally and 2020 pre-ATH recovery
  const rbDates = rbs.map((r) => r.time.toISOString().slice(0, 10));
  assert.equal(rbDates.filter((d) => d >= '2019-05-01' && d <= '2019-09-30').length, 0);
  assert.equal(rbDates.filter((d) => d >= '2020-08-01' && d <= '2020-11-30').length, 0);

  // RB fires in all major ATH cycle tops: 2021 Top1, 2021 Top2, 2024 ATH, 2025 Cycle Top
  assert.ok(rbDates.some((d) => d >= '2021-02-01' && d <= '2021-05-15'));
  assert.ok(rbDates.some((d) => d >= '2021-10-01' && d <= '2021-11-15'));
  assert.ok(rbDates.some((d) => d >= '2024-11-15' && d <= '2024-12-15'));
  assert.ok(rbDates.some((d) => d >= '2025-07-01' && d <= '2025-10-30'));

  // Structural invariants on every RB bar
  for (const row of rbs) {
    assert.ok(row.athDrawdownPct >= -15, `Expected RB ${row.time.toISOString()} within 15% of 4Y high, got ${row.athDrawdownPct}`);
    assert.equal(row.underwater, 0);
  }
});

test('LOGIC-001 & LOGIC-003 regressions: dynamic isClosed parity and non-positive OHLC rejection', () => {
  const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);
  const raw = [
    { time: '2026-11-09T00:00:00Z', open: 0, high: 0, low: 0, close: 0, volume: 10 },
    { time: '2026-11-16T00:00:00Z', open: -5, high: 10, low: -10, close: 5, volume: 10 },
    { time: '2026-11-16T00:00:00Z', open: 60000, high: 65000, low: 55000, close: 61000, volume: -100, closeTime: nowMs - 1000, isClosed: false },
    { time: '2026-11-23T00:00:00Z', open: 61000, high: 62000, low: 59000, close: 60500, volume: 500, closeTime: nowMs + 60000, isClosed: true },
  ];
  const normalized = normalizeMacroCandles(raw, nowMs);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].isClosed, true);
  assert.equal(normalized[0].volume, 0);
  assert.equal(normalized[1].isClosed, false);
});
