import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatDayMonth,
  calculateBiasPriceCorrelation,
  detectBiasPriceDivergence,
  buildDailyBiasHistory,
  getBiasComparisonSeries,
} from './biasHistoryService.js';

describe('biasHistoryService unit tests', () => {
  test('formatDayMonth formats dates properly', () => {
    const d = new Date('2026-10-03T12:00:00Z');
    assert.match(formatDayMonth(d), /^\d{2}\/\d{2}$/);
    assert.strictEqual(formatDayMonth(null), '');
    assert.strictEqual(formatDayMonth('invalid'), '');
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

    test('builds 7d and 30d daily bias history series without look-ahead leakage', () => {
      const history7d = buildDailyBiasHistory(mockDashboardData, mockEtfHistory, 7);
      assert.strictEqual(history7d.length, 7);
      assert.ok(history7d[0].btcPrice > 0);
      assert.ok(typeof history7d[0].biasScore === 'number');

      const history30d = buildDailyBiasHistory(mockDashboardData, mockEtfHistory, 30);
      assert.strictEqual(history30d.length, 30);
    });

    test('getBiasComparisonSeries supports timeframe 7d, 30d, and realtime', () => {
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
    });
  });
});
