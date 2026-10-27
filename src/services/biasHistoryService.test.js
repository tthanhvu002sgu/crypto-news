import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatDayMonth,
  calculateBiasPriceCorrelation,
  detectBiasPriceDivergence,
  buildDailyBiasHistory,
  getBiasComparisonSeries,
  BIAS_BUCKETS,
  getBiasBucket,
  calculateQuantiles,
  computeBiasBucketDistribution,
} from './biasHistoryService.js';

describe('biasHistoryService unit tests', () => {
  test('formatDayMonth formats dates properly', () => {
    const d = new Date('2026-10-03T12:00:00Z');
    assert.match(formatDayMonth(d), /^\d{2}\/\d{2}$/);
    assert.strictEqual(formatDayMonth(null), '');
    assert.strictEqual(formatDayMonth('invalid'), '');
  });

  describe('BIAS_BUCKETS & getBiasBucket', () => {
    test('defines all 5 standard buckets', () => {
      assert.strictEqual(BIAS_BUCKETS.length, 5);
      const ids = BIAS_BUCKETS.map((b) => b.id);
      assert.deepStrictEqual(ids, ['STRONG_BEAR', 'BEAR', 'NEUTRAL', 'BULL', 'STRONG_BULL']);
    });

    test('classifies scores into correct buckets with boundary checks', () => {
      assert.strictEqual(getBiasBucket(-100).id, 'STRONG_BEAR');
      assert.strictEqual(getBiasBucket(-30).id, 'STRONG_BEAR');
      assert.strictEqual(getBiasBucket(-29).id, 'BEAR');
      assert.strictEqual(getBiasBucket(-11).id, 'BEAR');
      assert.strictEqual(getBiasBucket(-10).id, 'NEUTRAL');
      assert.strictEqual(getBiasBucket(0).id, 'NEUTRAL');
      assert.strictEqual(getBiasBucket(10).id, 'NEUTRAL');
      assert.strictEqual(getBiasBucket(11).id, 'BULL');
      assert.strictEqual(getBiasBucket(30).id, 'BULL');
      assert.strictEqual(getBiasBucket(31).id, 'STRONG_BULL');
      assert.strictEqual(getBiasBucket(100).id, 'STRONG_BULL');
      // non-finite fallback
      assert.strictEqual(getBiasBucket(NaN).id, 'NEUTRAL');
      assert.strictEqual(getBiasBucket(null).id, 'NEUTRAL');
    });
  });

  describe('calculateQuantiles', () => {
    test('handles empty or invalid inputs gracefully', () => {
      const qEmpty = calculateQuantiles([]);
      assert.strictEqual(qEmpty.n, 0);
      assert.strictEqual(qEmpty.median, null);
      assert.strictEqual(qEmpty.iqr, null);

      const qNull = calculateQuantiles(null);
      assert.strictEqual(qNull.n, 0);
    });

    test('calculates correct quantiles and IQR for odd and even samples', () => {
      // 5 items: [1, 2, 3, 4, 5]
      const qOdd = calculateQuantiles([1, 2, 3, 4, 5]);
      assert.strictEqual(qOdd.n, 5);
      assert.strictEqual(qOdd.median, 3);
      assert.strictEqual(qOdd.p25, 2);
      assert.strictEqual(qOdd.p75, 4);
      assert.strictEqual(qOdd.iqr, 2);
      assert.strictEqual(qOdd.min, 1);
      assert.strictEqual(qOdd.max, 5);

      // 4 items: [10, 20, 30, 40]
      const qEven = calculateQuantiles([40, 10, 20, 30]);
      assert.strictEqual(qEven.n, 4);
      assert.strictEqual(qEven.median, 25);
      assert.strictEqual(qEven.p25, 17.5);
      assert.strictEqual(qEven.p75, 32.5);
      assert.strictEqual(qEven.iqr, 15);
    });
  });

  describe('computeBiasBucketDistribution', () => {
    test('handles empty series cleanly', () => {
      const dist = computeBiasBucketDistribution([], '1D');
      assert.strictEqual(dist.horizon, '1D');
      assert.strictEqual(dist.buckets.length, 5);
      assert.strictEqual(dist.totalSamples, 0);
      assert.strictEqual(dist.totalResolved, 0);
      assert.strictEqual(dist.overallHitRate, null);
    });

    test('computes hits, hitRate, median, and IQR for resolved forward returns', () => {
      const sampleSeries = [
        { biasScore: 45, forwardReturns: { '1D': 3.5, '3D': 6.0, '7D': 8.0 } }, // Strong Bull -> Hit
        { biasScore: 50, forwardReturns: { '1D': -1.2, '3D': 2.0, '7D': 4.0 } }, // Strong Bull -> Miss
        { biasScore: 20, forwardReturns: { '1D': 1.8, '3D': 3.0, '7D': 5.0 } }, // Bull -> Hit
        { biasScore: 0, forwardReturns: { '1D': 0.2, '3D': 0.5, '7D': 1.0 } }, // Neutral -> Hit (flat)
        { biasScore: -20, forwardReturns: { '1D': -2.5, '3D': -4.0, '7D': -6.0 } }, // Bear -> Hit (-ret)
        { biasScore: -50, forwardReturns: { '1D': -4.0, '3D': -7.0, '7D': -9.0 } }, // Strong Bear -> Hit (-ret)
        { biasScore: 35, forwardReturns: { '1D': null, '3D': null, '7D': null } }, // Unresolved (today)
      ];

      const dist1d = computeBiasBucketDistribution(sampleSeries, '1D');
      assert.strictEqual(dist1d.totalSamples, 7);
      assert.strictEqual(dist1d.totalResolved, 6);

      const strongBull = dist1d.buckets.find((b) => b.id === 'STRONG_BULL');
      assert.strictEqual(strongBull.count, 3);
      assert.strictEqual(strongBull.resolvedCount, 2);
      assert.strictEqual(strongBull.hitRate, 50); // 1 hit out of 2
      assert.strictEqual(strongBull.medianReturn, 1.15); // (3.5 + -1.2) / 2 = 1.15

      const bear = dist1d.buckets.find((b) => b.id === 'BEAR');
      assert.strictEqual(bear.resolvedCount, 1);
      assert.strictEqual(bear.hitRate, 100);
      assert.strictEqual(bear.medianReturn, -2.5);

      const strongBear = dist1d.buckets.find((b) => b.id === 'STRONG_BEAR');
      assert.strictEqual(strongBear.resolvedCount, 1);
      assert.strictEqual(strongBear.hitRate, 100);

      assert.ok(dist1d.overallHitRate >= 80); // 5 hits out of 6 resolved = 83.3%
    });
  });

  describe('calculateBiasPriceCorrelation', () => {
    test('handles insufficient data gracefully', () => {
      const res0 = calculateBiasPriceCorrelation([]);
      assert.strictEqual(res0.strength, 'INSUFFICIENT_DATA');
      assert.strictEqual(res0.r, 0);

      const res1 = calculateBiasPriceCorrelation([{ btcPrice: 60000, biasScore: 20 }]);
      assert.strictEqual(res1.strength, 'INSUFFICIENT_DATA');
    });

    test('calculates strong positive correlation (r > 0.8)', () => {
      const data = [
        { btcPrice: 60000, biasScore: 10 },
        { btcPrice: 62000, biasScore: 25 },
        { btcPrice: 65000, biasScore: 40 },
        { btcPrice: 68000, biasScore: 60 },
        { btcPrice: 70000, biasScore: 75 },
      ];
      const res = calculateBiasPriceCorrelation(data);
      assert.strictEqual(res.strength, 'STRONG_POSITIVE');
      assert.ok(res.r >= 0.95);
    });

    test('calculates strong negative correlation (r < -0.8)', () => {
      const data = [
        { btcPrice: 60000, biasScore: 70 },
        { btcPrice: 62000, biasScore: 50 },
        { btcPrice: 65000, biasScore: 30 },
        { btcPrice: 68000, biasScore: 10 },
        { btcPrice: 70000, biasScore: -10 },
      ];
      const res = calculateBiasPriceCorrelation(data);
      assert.strictEqual(res.strength, 'STRONG_NEGATIVE');
      assert.ok(res.r <= -0.95);
    });

    test('handles zero variance (constant prices or scores) without NaN', () => {
      const data = [
        { btcPrice: 60000, biasScore: 20 },
        { btcPrice: 60000, biasScore: 20 },
        { btcPrice: 60000, biasScore: 20 },
      ];
      const res = calculateBiasPriceCorrelation(data);
      assert.strictEqual(res.r, 0);
      assert.strictEqual(res.strength, 'NEUTRAL');
    });
  });

  describe('detectBiasPriceDivergence', () => {
    test('detects BULLISH_DIVERGENCE when Price falls but Bias rises', () => {
      const data = [
        { btcPrice: 68000, biasScore: -15 },
        { btcPrice: 66000, biasScore: 5 },
        { btcPrice: 64000, biasScore: 25 }, // Price down -5.8%, Bias up +40
      ];
      const res = detectBiasPriceDivergence(data);
      assert.strictEqual(res.type, 'BULLISH_DIVERGENCE');
      assert.strictEqual(res.shortLabel, 'TÍCH LŨY NGẦM ▲');
      assert.ok(res.deltaPricePct < 0);
      assert.ok(res.deltaBias > 0);
    });

    test('detects BEARISH_DIVERGENCE when Price rises but Bias falls', () => {
      const data = [
        { btcPrice: 60000, biasScore: 45 },
        { btcPrice: 63000, biasScore: 20 },
        { btcPrice: 67000, biasScore: -10 }, // Price up +11.6%, Bias down -55
      ];
      const res = detectBiasPriceDivergence(data);
      assert.strictEqual(res.type, 'BEARISH_DIVERGENCE');
      assert.strictEqual(res.shortLabel, 'CẢNH BÁO PHÂN PHỐI ▼');
      assert.ok(res.deltaPricePct > 0);
      assert.ok(res.deltaBias < 0);
    });

    test('detects BULLISH_CONFIRMED when both Price and Bias rise', () => {
      const data = [
        { btcPrice: 60000, biasScore: 10 },
        { btcPrice: 65000, biasScore: 40 },
      ];
      const res = detectBiasPriceDivergence(data);
      assert.strictEqual(res.type, 'BULLISH_CONFIRMED');
      assert.strictEqual(res.shortLabel, 'ĐỒNG PHA TĂNG ▲');
    });

    test('detects BEARISH_CONFIRMED when both Price and Bias drop', () => {
      const data = [
        { btcPrice: 65000, biasScore: 20 },
        { btcPrice: 60000, biasScore: -15 },
      ];
      const res = detectBiasPriceDivergence(data);
      assert.strictEqual(res.type, 'BEARISH_CONFIRMED');
      assert.strictEqual(res.shortLabel, 'ĐỒNG PHA GIẢM ▼');
    });

    test('detects BEARISH_DIVERGENCE when internal peak occurs in second half with collapsing bias', () => {
      // Price: 60k -> 61k -> 65k (peak +8.3%) -> 60.5k (close near start)
      // Bias:  40  -> 30  -> 10  -> 5
      const data = [
        { btcPrice: 60000, biasScore: 40 },
        { btcPrice: 61000, biasScore: 30 },
        { btcPrice: 62000, biasScore: 20 },
        { btcPrice: 65000, biasScore: 10 },
        { btcPrice: 63000, biasScore: 5 },
        { btcPrice: 60500, biasScore: 5 },
      ];
      const res = detectBiasPriceDivergence(data);
      assert.strictEqual(res.type, 'BEARISH_DIVERGENCE');
      assert.strictEqual(res.shortLabel, 'CẢNH BÁO PHÂN PHỐI ▼');
    });
  });

  describe('buildDailyBiasHistory and getBiasComparisonSeries', () => {
    const mockKlines = Array.from({ length: 40 }, (_, i) => {
      const time = new Date(Date.now() - (40 - i) * 86400000);
      return {
        time,
        open: 60000 + i * 200,
        high: 60500 + i * 200,
        low: 59500 + i * 200,
        close: 60100 + i * 200,
        volume: 25000,
      };
    });

    const mockDashboardData = {
      btcDailyKlinesAll: mockKlines,
      btc: { price: 68000, change: 2.5, volume: 30000000000 },
      cvdHistory30dSpot: 50000000,
      cvdHistory30d: 80000000,
    };

    const mockEtfHistory = [
      { date: '01/09/26', flow: '-500.0' },
      { date: '02/09/26', flow: '-300.0' },
      { date: '01/10/26', flow: '120.5' },
      { date: '02/10/26', flow: '250.0' },
    ];

    test('builds 7d and 30d daily bias history series without look-ahead leakage and calculates forward returns', () => {
      const history7d = buildDailyBiasHistory(mockDashboardData, mockEtfHistory, 7);
      assert.strictEqual(history7d.length, 7);
      assert.ok(history7d[0].btcPrice > 0);
      assert.ok(typeof history7d[0].biasScore === 'number');
      assert.ok(history7d[0].bucket?.id);
      // First candle in 7d has forward klines available in mockKlines
      assert.ok(history7d[0].forwardReturns);
      assert.strictEqual(typeof history7d[0].forwardReturn1d, 'number');

      const history30d = buildDailyBiasHistory(mockDashboardData, mockEtfHistory, 30);
      assert.strictEqual(history30d.length, 30);
      assert.ok(history30d[0].bucket?.id);
    });

    test('getBiasComparisonSeries supports timeframe 7d, 30d, and realtime with bucket distribution', () => {
      const res7d = getBiasComparisonSeries({
        timeframe: '7d',
        dashboardData: mockDashboardData,
        etfHistory: mockEtfHistory,
      });
      assert.strictEqual(res7d.timeframe, '7d');
      assert.strictEqual(res7d.hasData, true);
      assert.strictEqual(res7d.series.length, 7);
      assert.ok(res7d.correlation.strength);
      assert.ok(res7d.divergence.type);
      assert.ok(res7d.bucketDistribution);
      assert.strictEqual(res7d.bucketDistribution.buckets.length, 5);

      const liveSnapshots = [
        { timestamp: Date.now() - 3600000, btcPrice: 67500, biasScore: 22, confidence: 80, timeStr: '14:00', dateStr: '03/10' },
        { timestamp: Date.now(), btcPrice: 68000, biasScore: 28, confidence: 85, timeStr: '15:00', dateStr: '03/10' },
      ];

      const resRt = getBiasComparisonSeries({
        timeframe: 'realtime',
        dashboardData: mockDashboardData,
        etfHistory: mockEtfHistory,
        liveSnapshots,
      });
      assert.strictEqual(resRt.timeframe, 'realtime');
      assert.strictEqual(resRt.series.length, 2);
      assert.ok(resRt.bucketDistribution);
    });
  });
});

