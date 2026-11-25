import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeForwardStudy,
  exportBacktestArtifacts,
  runBacktest,
  simulateTargetExposureStrategy,
} from '../src/backtester.js';
import { loadCandlesFromFile, saveCandlesToFile } from '../src/dataLoader.js';

const makeCycleCandles = (length = 360) => Array.from({ length }, (_, i) => {
  const close = 10000 * Math.exp(0.004 * i + 0.55 * Math.sin(i / 15));
  return {
    time: new Date(Date.UTC(2018, 0, 1 + i * 7)),
    open: close * 0.995,
    high: close * 1.04,
    low: close * 0.96,
    close,
    volume: 5000 + i * 25,
    isClosed: true,
  };
});

test('CSV and JSON data loader round-trips candles accurately', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-backtest-'));
  const sample = makeCycleCandles(10);

  const csvPath = path.join(tmpDir, 'sample.csv');
  await saveCandlesToFile(csvPath, sample);
  const fromCsv = await loadCandlesFromFile(csvPath);
  assert.equal(fromCsv.length, 10);
  assert.ok(Math.abs(fromCsv[0].close - sample[0].close) < 1e-9);

  const jsonPath = path.join(tmpDir, 'sample.json');
  await saveCandlesToFile(jsonPath, sample);
  const fromJson = await loadCandlesFromFile(jsonPath);
  assert.equal(fromJson.length, 10);
  assert.equal(fromJson[9].time.toISOString(), sample[9].time.toISOString());

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('computeForwardStudy calculates exact forward return and MAE', () => {
  const series = [
    { time: new Date('2024-01-01'), open: 100, high: 105, low: 95, close: 100, decision: 'STRONG ACCUM' },
    { time: new Date('2024-01-08'), open: 100, high: 110, low: 80, close: 105, decision: 'NEUTRAL' },
    { time: new Date('2024-01-15'), open: 105, high: 130, low: 90, close: 120, decision: 'NEUTRAL' },
    { time: new Date('2024-01-22'), open: 120, high: 150, low: 115, close: 150, decision: 'NEUTRAL' },
  ];

  // next_open at bar 0 => enters at bar 1 open (100); +2 bars => exits at bar 2 close (120) => +20%, min low=80 => MAE -20%
  const study = computeForwardStudy(series, {
    startIndex: 0,
    endIndex: 0,
    horizons: [2, 3],
    groupBy: (r) => r.decision,
    executionMode: 'next_open',
  });

  assert.equal(study.length, 1);
  assert.equal(study[0].key, 'STRONG ACCUM');
  assert.ok(Math.abs(study[0].horizons[2].meanPct - 20) < 1e-9);
  assert.ok(Math.abs(study[0].horizons[2].meanMaePct - (-20)) < 1e-9);
  assert.ok(Math.abs(study[0].horizons[3].meanPct - 50) < 1e-9);
});

test('simulateTargetExposureStrategy handles fees, buy, sell and realized PnL cleanly', () => {
  const series = [
    { time: new Date('2024-01-01'), open: 100, close: 100, decision: 'ACCUMULATE', composite: 1, valZone: 'CHEAP', pnlZone: 'FAIR', divergence: false },
    { time: new Date('2024-01-08'), open: 100, close: 120, decision: 'NEUTRAL', composite: 0, valZone: 'FAIR', pnlZone: 'FAIR', divergence: false },
    { time: new Date('2024-01-15'), open: 120, close: 150, decision: 'DISTRIBUTE', composite: -1, valZone: 'EXP', pnlZone: 'FAIR', divergence: false },
    { time: new Date('2024-01-22'), open: 150, close: 100, decision: 'NEUTRAL', composite: 0, valZone: 'FAIR', pnlZone: 'FAIR', divergence: false },
  ];

  const result = simulateTargetExposureStrategy({
    name: 'TestStrat',
    description: 'test',
    series,
    startIndex: 0,
    endIndex: 3,
    targetExposureAt: (row, prev) => (row.composite >= 1 ? 1 : row.composite <= -1 ? 0 : prev),
    initialCapital: 1000,
    feeBps: 0,
    timeframe: 'W',
    executionMode: 'next_open',
  });

  // Signal BUY at bar 0 -> buys at bar 1 open (100), 10 units.
  // Signal SELL at bar 2 -> sells at bar 3 open (150) -> cash = 1500, avoids drop to 100 at bar 3 close.
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[0].side, 'BUY');
  assert.equal(result.trades[1].side, 'SELL');
  assert.ok(Math.abs(result.metrics.finalEquity - 1500) < 1e-9);
  assert.ok(Math.abs(result.metrics.totalReturnPct - 50) < 1e-9);
  assert.equal(result.metrics.winRatePct, 100);
});

test('runBacktest end-to-end and artifact export', async () => {
  const candles = makeCycleCandles(360);
  const report = runBacktest(candles, {
    warmupBars: 120,
    feeBps: 10,
    initialCapital: 10000,
  });

  assert.equal(report.meta.evalBars, 240);
  assert.ok(report.strategies.length >= 5);
  assert.ok(report.forwardStudies.byDecision.length >= 1);
  assert.ok(report.dcaComparison.equalDca.invested > 0);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mv-export-'));
  await exportBacktestArtifacts(tmpDir, report);

  const files = await fs.readdir(tmpDir);
  assert.ok(files.includes('summary.json'));
  assert.ok(files.includes('series.csv'));
  assert.ok(files.includes('trades.csv'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
