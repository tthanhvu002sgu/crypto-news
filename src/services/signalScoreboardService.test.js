import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  calculateQuantiles,
  isSignalHit,
  getEdgeVerdict,
  computeOccurrencesStats,
  backtestBiasRegimes,
  backtestCapitalFlow,
  backtestScannerRank,
  backtestMoveTracker,
  generateSignalScoreboard,
  SCOREBOARD_HORIZONS,
} from './signalScoreboardService.js';

describe('signalScoreboardService unit tests', () => {
  describe('SCOREBOARD_HORIZONS & calculateQuantiles', () => {
    test('defines default horizons', () => {
      assert.deepStrictEqual(SCOREBOARD_HORIZONS, ['1D', '3D', '7D']);
    });

    test('calculateQuantiles returns correct quantiles and spread', () => {
      const q = calculateQuantiles([5, 1, 9, 3, 7]);
      assert.strictEqual(q.n, 5);
      assert.strictEqual(q.min, 1);
      assert.strictEqual(q.max, 9);
      assert.strictEqual(q.median, 5);
      assert.strictEqual(q.p25, 3);
      assert.strictEqual(q.p75, 7);
      assert.strictEqual(q.iqr, 4);

      const empty = calculateQuantiles([]);
      assert.strictEqual(empty.n, 0);
      assert.strictEqual(empty.median, null);
    });
  });

  describe('isSignalHit & getEdgeVerdict', () => {
    test('isSignalHit properly verifies direction matches', () => {
      assert.strictEqual(isSignalHit('LONG', 2.5), true);
      assert.strictEqual(isSignalHit('LONG', -1.0), false);
      assert.strictEqual(isSignalHit('SHORT', -3.2), true);
      assert.strictEqual(isSignalHit('SHORT', 1.5), false);
      assert.strictEqual(isSignalHit('RANGE', 0.5), true);
      assert.strictEqual(isSignalHit('RANGE', 2.5), false);
      assert.strictEqual(isSignalHit('LONG', NaN), false);
    });

    test('getEdgeVerdict handles insufficient data and high edge tiers', () => {
      const vLowSample = getEdgeVerdict(80, 2.0, 2);
      assert.strictEqual(vLowSample.tier, 'INSUFFICIENT_DATA');

      const vHighEdge = getEdgeVerdict(62, 1.8, 15);
      assert.strictEqual(vHighEdge.tier, 'VERIFIED_EDGE');
      assert.ok(vHighEdge.label.includes('EDGE XÁC THỰC'));

      const vModerate = getEdgeVerdict(54, 0.5, 10);
      assert.strictEqual(vModerate.tier, 'MODERATE_EDGE');

      const vNegative = getEdgeVerdict(42, -1.2, 10);
      assert.strictEqual(vNegative.tier, 'NEGATIVE_EDGE');
    });
  });

  describe('computeOccurrencesStats', () => {
    test('computes sampleSize, hitRate, median, IQR and profit factor accurately', () => {
      const occurrences = [
        { expectedDirection: 'LONG', forwardReturns: { '1D': 3.0, '3D': 5.0 } },
        { expectedDirection: 'LONG', forwardReturns: { '1D': 2.0, '3D': 4.0 } },
        { expectedDirection: 'LONG', forwardReturns: { '1D': -1.0, '3D': 1.0 } },
        { expectedDirection: 'LONG', forwardReturns: { '1D': 4.0, '3D': 6.0 } },
        { expectedDirection: 'LONG', forwardReturns: { '1D': null, '3D': null } }, // unresolved
      ];

      const stats1d = computeOccurrencesStats(occurrences, '1D');
      assert.strictEqual(stats1d.totalCount, 5);
      assert.strictEqual(stats1d.sampleSize, 4);
      assert.strictEqual(stats1d.hits, 3);
      assert.strictEqual(stats1d.hitRate, 75);
      assert.strictEqual(stats1d.medianReturn, 2.5); // median of [-1, 2, 3, 4] is (2+3)/2 = 2.5
      assert.ok(stats1d.profitFactor > 1);
      assert.strictEqual(stats1d.verdict.tier, 'VERIFIED_EDGE');
    });
  });

  describe('Walk-Forward Engine Backtests', () => {
    const mockKlines = Array.from({ length: 45 }, (_, i) => {
      const time = new Date(Date.now() - (45 - i) * 86400000);
      return {
        time,
        open: 60000 + i * 250,
        high: 60600 + i * 250,
        low: 59700 + i * 250,
        close: 60200 + i * 250,
        volume: 30000,
      };
    });

    const mockDashboardData = {
      btcDailyKlinesAll: mockKlines,
      btc: { price: 71000, change: 1.8, volume: 25000000000 },
      cvdHistory30dSpot: 40000000,
      cvdHistory30d: 65000000,
    };

    const mockEtfHistory = [
      { date: '01/09/26', flow: '150.0' },
      { date: '02/09/26', flow: '220.0' },
    ];

    test('backtestBiasRegimes runs walk-forward across klines and produces all horizons', () => {
      const signals = backtestBiasRegimes(mockDashboardData, mockEtfHistory);
      assert.ok(signals.length >= 5);
      assert.ok(signals[0].horizons['1D']);
      assert.ok(signals[0].horizons['3D']);
      assert.ok(signals[0].horizons['7D']);
      assert.strictEqual(typeof signals[0].horizons['1D'].sampleSize, 'number');
    });

    test('backtestCapitalFlow classifies setups and computes forward returns', () => {
      const signals = backtestCapitalFlow(mockDashboardData);
      assert.strictEqual(signals.length, 7);
      const longBuildup = signals.find((s) => s.id === 'cf_long_buildup');
      assert.ok(longBuildup);
      assert.strictEqual(longBuildup.category, 'capitalFlow');
      assert.strictEqual(longBuildup.expectedDirection, 'LONG');

      // Kiểm chứng toàn bộ 7 phân hệ Capital Flow đều có mẫu kiểm định (không bị kẹt 0 do sai state)
      signals.forEach((sig) => {
        assert.ok(sig.horizons['1D'].sampleSize > 0, `Signal ${sig.id} must have sampleSize > 0`);
      });
    });

    test('backtestScannerRank processes altcoin signals and provides quant baseline', () => {
      const mockScannerData = {
        assets: [
          { symbol: 'SOL', scores: { rs: 75 }, flowLabel: 'SPOT_SUPPORTED', metrics: { priceChangePct: 4.5, currentPrice: 180 }, forwardReturns: { '1D': 3.2, '3D': 4.8, '7D': 6.5 } },
          { symbol: 'ETH', scores: { rs: 60 }, flowLabel: 'SPOT_SUPPORTED', metrics: { priceChangePct: 2.1, currentPrice: 3200 }, forwardReturns: { '1D': 1.5, '3D': 2.2, '7D': 3.1 } },
          { symbol: 'DOGE', scores: { rs: 30 }, flowLabel: 'SHORT_COVERING', metrics: { priceChangePct: 1.0, currentPrice: 0.15 }, forwardReturns: { '1D': 2.0, '3D': 3.0, '7D': 4.0 } },
        ],
      };
      const signals = backtestScannerRank(mockScannerData, mockKlines);
      assert.strictEqual(signals.length, 4);
      assert.ok(signals[0].horizons['1D'].sampleSize > 0);
    });

    test('backtestMoveTracker processes volatility spikes and correctly scores DUMP continuation hits', () => {
      const mockMoveEvents = [
        {
          id: 'move_1',
          direction: 'PUMP',
          outcomeLabel: 'CONTINUATION',
          triggerPrice: 65000,
          forwardOutcomes: { '300': { rawReturnBps: 150, continuationBps: 150, outcomeLabel: 'CONTINUATION' } },
        },
        {
          id: 'move_2',
          direction: 'DUMP',
          outcomeLabel: 'CONTINUATION',
          triggerPrice: 64000,
          // Real moveTrackerCore format: price dropped 1.2% (raw -120), so continuationBps is positive (+120)
          forwardOutcomes: { '300': { rawReturnBps: -120, continuationBps: 120, outcomeLabel: 'CONTINUATION' } },
        },
      ];
      const signals = backtestMoveTracker(mockMoveEvents);
      assert.strictEqual(signals.length, 4);
      const dumpCont = signals.find((s) => s.id === 'move_dump_continuation');
      assert.ok(dumpCont);
      assert.strictEqual(dumpCont.expectedDirection, 'SHORT');
      // DUMP CONTINUATION with falling price must be a HIT for SHORT!
      assert.ok(dumpCont.horizons['1D'].hits >= 1);
      assert.ok(dumpCont.horizons['1D'].medianReturn < 0);
    });

    test('backtestBiasRegimes enforces temporal fence and ignores future ETF data', () => {
      const etfPastOnly = [
        { date: '01/09/26', flow: '-500.0' },
        { date: '02/09/26', flow: '-300.0' },
      ];
      const etfWithFutureLeak = [
        ...etfPastOnly,
        { date: '25/12/29', flow: '+99999.0' }, // Future extreme inflow
      ];
      const signals1 = backtestBiasRegimes(mockDashboardData, etfPastOnly);
      const signals2 = backtestBiasRegimes(mockDashboardData, etfWithFutureLeak);
      // Both runs must yield identical sample counts and hits because future ETF row is past the candle dates
      assert.deepStrictEqual(
        signals1.map((s) => s.horizons['1D'].sampleSize),
        signals2.map((s) => s.horizons['1D'].sampleSize)
      );
    });

    test('generateSignalScoreboard unifies all 4 categories with hybrid provenance and KPI summary', () => {
      const scoreboard = generateSignalScoreboard({
        dashboardData: mockDashboardData,
        etfHistory: mockEtfHistory,
        liveSnapshots: [
          { timestamp: Date.now() - 86400000, btcPrice: 69000, biasScore: 35 },
          { timestamp: Date.now(), btcPrice: 71000, biasScore: 40 },
        ],
        selectedHorizon: '1D',
      });

      assert.strictEqual(scoreboard.selectedHorizon, '1D');
      assert.strictEqual(scoreboard.summary.provenance.mode, 'HYBRID');
      assert.ok(scoreboard.summary.totalSignalsCount > 15);
      assert.ok(scoreboard.summary.totalResolvedSamples > 0);
      assert.ok(scoreboard.categories.biasRegime.signals.length > 0);
      assert.ok(scoreboard.categories.capitalFlow.signals.length > 0);
      assert.ok(scoreboard.categories.scannerRank.signals.length > 0);
      assert.ok(scoreboard.categories.moveTracker.signals.length > 0);
    });
  });
});
