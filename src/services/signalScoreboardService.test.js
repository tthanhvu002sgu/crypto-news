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
  getNormalizedKlines,
  findForwardCandleClose,
} from './signalScoreboardService.js';
import { calculateQuantiles as biasCalculateQuantiles } from './biasHistoryService.js';

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
      assert.ok(signals[0].horizons['1D'].medianReturn < 20, 'Returns must be realistic, not cross-asset distorted');
      assert.strictEqual(signals[0].horizons['1D'].medianReturn, 2.0);
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

  describe('Audit Logic Fixes (LOGIC-001 through LOGIC-004)', () => {
    // ── LOGIC-001: Taker volume utilization in backtestCapitalFlow ─────────────
    describe('LOGIC-001: backtestCapitalFlow taker volume utilization', () => {
      test('prioritizes real takerBuyQuoteVolume and quoteVolume to compute cvdRatioPct', () => {
        const klinesWithTaker = Array.from({ length: 25 }, (_, i) => {
          const time = new Date(Date.now() - (25 - i) * 86400000);
          return {
            time,
            open: 60000 + i * 100,
            high: 60500 + i * 100,
            low: 59800 + i * 100,
            close: 60200 + i * 100,
            volume: 1000,
            quoteVolume: 60000000,
            // 70% taker buy => cvdRatioPct = (42M - 18M)/60M * 100 = +40%
            takerBuyQuoteVolume: 42000000,
          };
        });

        const dashboardData = { btcDailyKlinesAll: klinesWithTaker };
        const signals = backtestCapitalFlow(dashboardData);
        assert.ok(signals.length > 0);

        // With massive taker buy (+40%), Long Buildup should capture occurrences
        const longBuildup = signals.find((s) => s.id === 'cf_long_buildup');
        assert.ok(longBuildup);
        assert.ok(longBuildup.totalSignals > 0);
      });

      test('supports Binance array klines with column 7 quoteVolume and column 10 takerBuyQuoteVolume', () => {
        const binanceArrayKlines = Array.from({ length: 25 }, (_, i) => {
          const timeMs = Date.now() - (25 - i) * 86400000;
          return [
            timeMs,                     // 0: openTime
            '60000',                    // 1: open
            '60500',                    // 2: high
            '59500',                    // 3: low
            '60200',                    // 4: close
            '1000',                     // 5: volume
            timeMs + 86400000 - 1,      // 6: closeTime
            '100000000',                // 7: quoteVolume
            5000,                       // 8: count
            '300',                      // 9: takerBuyBaseVolume
            '25000000',                 // 10: takerBuyQuoteVolume (25% taker buy => CVD is -50%)
            '0',                        // 11: ignore
          ];
        });

        const dashboardData = { btcDailyKlinesAll: binanceArrayKlines };
        const signals = backtestCapitalFlow(dashboardData);
        assert.ok(signals.length > 0);
        // Heavy net selling in taker flow (-50% CVD) should trigger SHORT signals
        const shortSignals = signals.filter((s) => s.expectedDirection === 'SHORT');
        const totalShortOccurrences = shortSignals.reduce((acc, s) => acc + s.totalSignals, 0);
        assert.ok(totalShortOccurrences > 0);
      });

      test('falls back to candle-shape proxy when taker volume is missing', () => {
        const klinesNoTaker = Array.from({ length: 25 }, (_, i) => ({
          time: new Date(Date.now() - (25 - i) * 86400000),
          open: 60000,
          high: 60500,
          low: 59500,
          close: 60400,
          volume: 1000,
        }));
        const dashboardData = { btcDailyKlinesAll: klinesNoTaker };
        const signals = backtestCapitalFlow(dashboardData);
        assert.ok(signals.length > 0);
        assert.ok(signals[0].horizons['1D'].sampleSize > 0);
      });
    });

    // ── LOGIC-002: Real Forward Return measurement for Move Tracker & Scanner Rank ─
    describe('LOGIC-002: Real forward return measurement and grounded proxy', () => {
      test('findForwardCandleClose locates future daily closing prices accurately', () => {
        const baseTime = 1700000000000;
        const klines = [
          { time: baseTime, close: 100 },
          { time: baseTime + 1 * 86400000, close: 105 },
          { time: baseTime + 2 * 86400000, close: 110 },
          { time: baseTime + 3 * 86400000, close: 115 },
          { time: baseTime + 7 * 86400000, close: 135 },
        ];
        const normalized = getNormalizedKlines(klines);

        assert.strictEqual(findForwardCandleClose(normalized, baseTime, 1), 105);
        assert.strictEqual(findForwardCandleClose(normalized, baseTime, 3), 115);
        assert.strictEqual(findForwardCandleClose(normalized, baseTime, 7), 135);
        // When target is beyond the dataset:
        assert.strictEqual(findForwardCandleClose(normalized, baseTime, 10), null);
      });

      test('backtestMoveTracker measures real returns against entryPrice when klines are provided', () => {
        const baseTime = Date.now() - 20 * 86400000;
        const testKlines = Array.from({ length: 20 }, (_, i) => ({
          time: baseTime + i * 86400000,
          open: 60000 + i * 500,
          high: 60600 + i * 500,
          low: 59800 + i * 500,
          close: 60000 + (i + 1) * 500, // strictly rising: 60500, 61000, 61500, ...
          volume: 1000,
        }));

        const moveEvents = [
          {
            id: 'event_early',
            direction: 'PUMP',
            outcomeLabel: 'CONTINUATION',
            triggerTime: baseTime,
            triggerPrice: 60000,
            forwardOutcomes: { '300': { rawReturnBps: 80 } },
          },
        ];

        const signals = backtestMoveTracker(moveEvents, testKlines);
        const pumpCont = signals.find((s) => s.id === 'move_pump_continuation');
        assert.ok(pumpCont);
        const h1 = pumpCont.horizons['1D'];
        assert.ok(h1.sampleSize >= 1);
        // Entry at 60,000, +1D candle close is 61,000 => real return is ((61000-60000)/60000)*100 = +1.67%
        assert.ok(h1.medianReturn > 0);
        // Since real klines were available, isProxyHorizon should be false for this occurrence
        assert.strictEqual(h1.isProxyHorizon, false);
      });

      test('backtestMoveTracker flags isProxyHorizon: true and uses grounded proxy when klines omitted', () => {
        const recentMoveEvents = [
          {
            id: 'event_recent',
            direction: 'DUMP',
            outcomeLabel: 'REVERSION',
            triggerTime: Date.now() - 3600000,
            triggerPrice: 65000,
            forwardOutcomes: { '300': { rawReturnBps: -150 } },
          },
        ];
        // Call without klines
        const signals = backtestMoveTracker(recentMoveEvents);
        const dumpRev = signals.find((s) => s.id === 'move_dump_reversion');
        assert.ok(dumpRev);
        assert.strictEqual(dumpRev.expectedDirection, 'LONG');
        const h1 = dumpRev.horizons['1D'];
        assert.ok(h1.sampleSize >= 1);
        assert.strictEqual(h1.isProxyHorizon, true);
        assert.ok(h1.medianReturn > 0, 'Dump reversion proxy should anticipate positive bounce for LONG');
      });

      test('backtestScannerRank measures real returns from klines and sets isProxyHorizon flag', () => {
        const baseTime = Date.now() - 15 * 86400000;
        const testKlines = Array.from({ length: 15 }, (_, i) => ({
          time: baseTime + i * 86400000,
          open: 100 + i * 2,
          high: 105 + i * 2,
          low: 98 + i * 2,
          close: 102 + i * 2,
        }));

        const scannerData = {
          assets: [
            {
              symbol: 'TESTCOIN',
              timestamp: baseTime,
              scores: { rs: 80 },
              flowLabel: 'SPOT_SUPPORTED',
              metrics: { currentPrice: 100 },
            },
          ],
        };

        const signals = backtestScannerRank(scannerData, testKlines);
        const topRs = signals.find((s) => s.id === 'scanner_top_rank');
        assert.ok(topRs);
        assert.strictEqual(topRs.horizons['1D'].isProxyHorizon, false);
        // Entry 100, +1D close 104 => real return +4.0%
        assert.strictEqual(topRs.horizons['1D'].medianReturn, 4);
      });

      test('backtestScannerRank prevents cross-asset scale distortion when altcoin is tested against BTC klines', () => {
        const btcKlines = Array.from({ length: 25 }, (_, i) => ({
          time: Date.now() - (25 - i) * 86400000,
          open: 60000 + i * 100,
          high: 60500 + i * 100,
          low: 59500 + i * 100,
          close: 60200 + i * 100,
        }));

        const scannerData = {
          assets: [
            {
              symbol: 'SOL',
              timestamp: Date.now() - 5 * 86400000,
              scores: { rs: 75 },
              flowLabel: 'SPOT_SUPPORTED',
              metrics: { currentPrice: 180 }, // SOL price ~180 vs BTC price ~60k
            },
          ],
        };

        const signals = backtestScannerRank(scannerData, btcKlines);
        const topRs = signals.find((s) => s.id === 'scanner_top_rank');
        assert.ok(topRs);
        const h1 = topRs.horizons['1D'];
        // Since BTC klines and SOL price have completely different scales,
        // it must use grounded market proxy with isProxyHorizon: true and reasonable returns (< 20%)
        assert.strictEqual(h1.isProxyHorizon, true);
        assert.ok(h1.medianReturn < 20, `Return should be grounded, got ${h1.medianReturn}%`);
        assert.ok(h1.medianReturn > 0, 'High RS should produce positive expected return');
      });

      test('computeOccurrencesStats evaluates isProxyHorizon per-horizon instead of global collapse', () => {
        const occurrences = [
          {
            expectedDirection: 'LONG',
            forwardReturns: { '1D': 2.5, '7D': 5.0 },
            isProxyHorizon: true, // overall flag true because 7D is proxy
            proxyHorizons: { '1D': false, '7D': true },
          },
        ];

        const stats1d = computeOccurrencesStats(occurrences, '1D');
        const stats7d = computeOccurrencesStats(occurrences, '7D');

        // Horizon 1D has real candle data, so isProxyHorizon MUST be false
        assert.strictEqual(stats1d.isProxyHorizon, false);
        // Horizon 7D was proxy, so isProxyHorizon MUST be true
        assert.strictEqual(stats7d.isProxyHorizon, true);
      });
    });

    // ── LOGIC-003: Deduplication of calculateQuantiles ─────────────────────────
    describe('LOGIC-003: calculateQuantiles code deduplication', () => {
      test('calculateQuantiles in signalScoreboardService matches biasHistoryService implementation', () => {
        assert.strictEqual(calculateQuantiles, biasCalculateQuantiles);
        const testArray = [12, 45, 23, 67, 89, 34, 56];
        const resA = calculateQuantiles(testArray);
        const resB = biasCalculateQuantiles(testArray);
        assert.deepStrictEqual(resA, resB);
      });
    });

    // ── LOGIC-004: Standardized Profit Factor for RANGE strategy ───────────────
    describe('LOGIC-004: computeOccurrencesStats RANGE profit factor standardization', () => {
      test('computes win based on balance protection ratio when returns are within +/-1.5%', () => {
        const inRangeOccurrences = [
          { expectedDirection: 'RANGE', forwardReturns: { '1D': 0.0 } }, // dead center: 100% balance protection
          { expectedDirection: 'RANGE', forwardReturns: { '1D': 0.75 } }, // halfway: 50% protection
          { expectedDirection: 'RANGE', forwardReturns: { '1D': -1.5 } }, // boundary: 0% protection
        ];

        const stats = computeOccurrencesStats(inRangeOccurrences, '1D');
        assert.strictEqual(stats.sampleSize, 3);
        assert.strictEqual(stats.hits, 3);
        assert.strictEqual(stats.hitRate, 100);
        assert.ok(stats.avgWin > 0);
        // Dead center gives 1.5, halfway gives 1.125, boundary gives 0.75
        // Average win is (1.5 + 1.125 + 0.75) / 3 = 1.125
        assert.strictEqual(stats.avgWin, 1.13);
      });

      test('normalizes breakout loss to prevent artificial negative skew for high-winrate range strategies', () => {
        const mixedOccurrences = [
          // 4 Range Wins (inside +/-1.5%)
          { expectedDirection: 'RANGE', forwardReturns: { '1D': 0.2 } },
          { expectedDirection: 'RANGE', forwardReturns: { '1D': -0.5 } },
          { expectedDirection: 'RANGE', forwardReturns: { '1D': 0.8 } },
          { expectedDirection: 'RANGE', forwardReturns: { '1D': -1.2 } },
          // 1 Breakout Loss (moved 6.0%)
          { expectedDirection: 'RANGE', forwardReturns: { '1D': 6.0 } },
        ];

        const stats = computeOccurrencesStats(mixedOccurrences, '1D');
        assert.strictEqual(stats.sampleSize, 5);
        assert.strictEqual(stats.hits, 4);
        assert.strictEqual(stats.hitRate, 80);
        // With 80% hit rate, Profit Factor MUST be positive and healthy (> 1.0)
        assert.ok(stats.profitFactor > 1.0, `Profit Factor was ${stats.profitFactor}, expected > 1.0`);
        // Max loss should be capped at 1.5x rangeBound (2.25%) rather than unbounded raw excess (4.5%)
        assert.ok(stats.avgLoss <= 2.25);
      });
    });
  });
});
