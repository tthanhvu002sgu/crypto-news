import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDailyChanges,
  pearsonCorrelation,
  alignSeriesPair,
  buildCorrelationMatrix,
  generateCorrelationNarrative,
  normalizeDateStr,
} from './correlationEngine.js';

describe('correlationEngine', () => {
  describe('normalizeDateStr', () => {
    it('normalizes YYYY-MM-DD strings and timestamps', () => {
      assert.equal(normalizeDateStr('2026-03-15'), '2026-03-15');
      assert.equal(normalizeDateStr('2026-03-15T12:00:00Z'), '2026-03-15');
      assert.equal(normalizeDateStr(1710460800000), '2024-03-15');
      assert.equal(normalizeDateStr(null), null);
      assert.equal(normalizeDateStr('invalid'), null);
    });
  });

  describe('computeDailyChanges', () => {
    it('computes daily percentage changes in chronological order', () => {
      const raw = [
        { date: '2026-01-01', close: 100 },
        { date: '2026-01-02', close: 110 },
        { date: '2026-01-03', close: 121 },
      ];

      const changes = computeDailyChanges(raw, 'pct');
      assert.equal(changes.length, 2);
      assert.equal(changes[0].date, '2026-01-02');
      assert.equal(Number(changes[0].change.toFixed(2)), 0.1);
      assert.equal(changes[1].date, '2026-01-03');
      assert.equal(Number(changes[1].change.toFixed(2)), 0.1);
    });

    it('returns empty for insufficient data', () => {
      assert.deepEqual(computeDailyChanges([]), []);
      assert.deepEqual(computeDailyChanges([{ date: '2026-01-01', close: 100 }]), []);
    });
  });

  describe('pearsonCorrelation', () => {
    it('computes exact +1.0 for perfectly correlated series', () => {
      const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const ys = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
      const r = pearsonCorrelation(xs, ys, 15);
      assert.equal(r, 1.0);
    });

    it('computes exact -1.0 for perfectly inverse series', () => {
      const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const ys = [30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
      const r = pearsonCorrelation(xs, ys, 15);
      assert.equal(r, -1.0);
    });

    it('returns null when sample size < minSamples', () => {
      const xs = [1, 2, 3, 4, 5];
      const ys = [2, 4, 6, 8, 10];
      const r = pearsonCorrelation(xs, ys, 15);
      assert.equal(r, null);
    });

    it('returns null when series has zero variance', () => {
      const xs = Array(15).fill(5);
      const ys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      const r = pearsonCorrelation(xs, ys, 15);
      assert.equal(r, null);
    });
  });

  describe('alignSeriesPair', () => {
    it('inner-joins dates between 24/7 Crypto and Mon-Fri TradFi', () => {
      // Crypto trades Sat/Sun
      const cryptoChanges = [
        { date: '2026-03-05', change: 0.01 }, // Thu
        { date: '2026-03-06', change: -0.02 }, // Fri
        { date: '2026-03-07', change: 0.03 }, // Sat
        { date: '2026-03-08', change: -0.01 }, // Sun
        { date: '2026-03-09', change: 0.02 }, // Mon
      ];

      // TradFi skips Sat/Sun
      const tradFiChanges = [
        { date: '2026-03-05', change: 0.005 },
        { date: '2026-03-06', change: -0.01 },
        { date: '2026-03-09', change: 0.015 },
      ];

      const { xs, ys, dates } = alignSeriesPair(cryptoChanges, tradFiChanges, 30);
      assert.equal(dates.length, 3);
      assert.deepEqual(dates, ['2026-03-05', '2026-03-06', '2026-03-09']);
      assert.deepEqual(xs, [0.01, -0.02, 0.02]);
      assert.deepEqual(ys, [0.005, -0.01, 0.015]);
    });
  });

  describe('buildCorrelationMatrix', () => {
    it('builds complete 7x7 matrix and cryptoVsMacro subtable', () => {
      // Generate synthetic 25 days of data for BTC and SPX
      const dates = [];
      for (let i = 1; i <= 25; i++) {
        const dayStr = i < 10 ? `0${i}` : `${i}`;
        dates.push(`2026-01-${dayStr}`);
      }

      const btcBase = 40000;
      const dxyBase = 100;
      const btcSeries = [{ date: dates[0], close: btcBase }];
      const dxySeries = [{ date: dates[0], close: dxyBase }];

      for (let i = 1; i < dates.length; i++) {
        const ret = (i % 2 === 0 ? 0.02 : -0.02) * (1 + (i % 3) * 0.1);
        btcSeries.push({ date: dates[i], close: btcSeries[i - 1].close * (1 + ret) });
        // Inverse returns for DXY
        dxySeries.push({ date: dates[i], close: dxySeries[i - 1].close * (1 - ret) });
      }

      const seriesMap = {
        BTC: btcSeries,
        ETH: btcSeries,
        SOL: btcSeries,
        SPX: btcSeries,
        DXY: dxySeries,
        GOLD: btcSeries,
        US10Y: dxySeries,
      };

      const result = buildCorrelationMatrix(seriesMap, 30);
      assert.ok(result);
      assert.equal(result.matrix.BTC.BTC, 1.0);
      assert.equal(result.matrix.BTC.SPX, 1.0); // Identical series
      assert.ok(result.matrix.BTC.DXY <= -0.99); // Inverse series
      assert.equal(result.cryptoVsMacro.length, 3);
      assert.ok(result.narrative.length > 0);
    });

    it('sets diagonal correlation to null when series has insufficient or zero samples (LOGIC-001)', () => {
      const seriesMap = {
        BTC: [
          { date: '2026-01-01', close: 40000 },
          { date: '2026-01-02', close: 41000 },
        ],
        US10Y: [], // empty series
      };

      const result = buildCorrelationMatrix(seriesMap, 30);
      // BTC has only 1 daily return (< 15 minSamples) -> diagonal must be null
      assert.equal(result.matrix.BTC.BTC, null);
      // US10Y has 0 samples -> diagonal must be null, not 1.0
      assert.equal(result.matrix.US10Y.US10Y, null);
      assert.equal(result.sampleCounts['US10Y_US10Y'], 0);
    });

    it('uses diff mode for US10Y yield changes (LOGIC-005)', () => {
      const raw10Y = [
        { date: '2026-01-01', close: 4.0 },
        { date: '2026-01-02', close: 4.2 },
      ];
      // In diff mode: 4.2 - 4.0 = +0.20
      const changes = computeDailyChanges(raw10Y, 'diff');
      assert.equal(changes.length, 1);
      assert.equal(Number(changes[0].change.toFixed(2)), 0.2);
    });
  });

  describe('generateCorrelationNarrative', () => {
    it('produces insightful institutional commentary', () => {
      const mockMatrix = {
        BTC: {
          SPX: 0.65,
          DXY: -0.55,
          GOLD: 0.45,
          US10Y: -0.35,
        },
      };

      const narrative = generateCorrelationNarrative(mockMatrix, 30);
      assert.match(narrative, /S&P 500/);
      assert.match(narrative, /DXY/);
      assert.match(narrative, /Vàng/);
      assert.match(narrative, /10Y/);
    });
  });
});
