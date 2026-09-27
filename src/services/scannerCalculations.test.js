import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRelativeStrength,
  calculateCvdAndFlowPressure,
  calculateOiMetrics,
  calculateFundingMetrics,
  classifyFlowInterpretation,
  calculateVolumeStability,
  calculatePercentilesMidrank,
  calculateDerivativesConfirmationScore,
  calculateQuantitativeSectorScores,
  scoreUniverseForWindow,
  calculateSummaryStatistics,
  calculateTrackingDeltas,
  FLOW_LABELS,
} from './scannerCalculations.js';

test('1. Relative Strength Calculation & Edge Cases', async (t) => {
  await t.test('ALT +20% and BTC +10% yields exact ~9.09% RS', () => {
    // Current: Alt 120, BTC 110. Prior: Alt 100, BTC 100.
    const res = calculateRelativeStrength(120, 100, 110, 100);
    assert.equal(res.reason, 'valid');
    assert.ok(Math.abs(res.value - 9.09090909) < 0.0001);
  });

  await t.test('USD Price Falling but Outperforming Benchmark yields positive RS', () => {
    // Current: Alt 95 (-5%), BTC 80 (-20%). Prior: Alt 100, BTC 100.
    // Cross current = 95/80 = 1.1875. Cross prior = 1.0. RS = +18.75%
    const res = calculateRelativeStrength(95, 100, 80, 100);
    assert.equal(res.reason, 'valid');
    assert.ok(res.value > 0);
    assert.ok(Math.abs(res.value - 18.75) < 0.0001);
  });

  await t.test('Missing candle at either end returns null and clear reason', () => {
    assert.equal(calculateRelativeStrength(null, 100, 110, 100).value, null);
    assert.equal(calculateRelativeStrength(120, null, 110, 100).value, null);
    assert.equal(calculateRelativeStrength(120, 100, null, 100).value, null);
    assert.equal(calculateRelativeStrength(120, 100, 110, null).value, null);
    assert.equal(calculateRelativeStrength(0, 100, 110, 100).value, null);
    assert.equal(calculateRelativeStrength(120, 100, 0, 100).value, null);
  });
});

test('2. CVD & Flow Pressure Calculation', async (t) => {
  await t.test('Total volume 100, taker-buy 60 yields CVD +20 and Flow Pressure +20%', () => {
    // kline format: [openTime, open, high, low, close, volume, closeTime, quoteVolume, count, takerBuyBase, takerBuyQuote, ignore]
    const klines = [
      [1000, 10, 11, 9, 10, 50, 1999, '100', 10, 30, '60', 0],
    ];
    const res = calculateCvdAndFlowPressure(klines);
    assert.equal(res.totalQuoteVolume, 100);
    assert.equal(res.takerBuyQuoteVolume, 60);
    assert.equal(res.takerSellQuoteVolume, 40);
    assert.equal(res.cvd, 20);
    assert.equal(res.flowPressure, 0.20);
    assert.equal(res.isValid, true);
  });

  await t.test('Multi-candle aggregation works accurately', () => {
    const klines = [
      [1000, 10, 11, 9, 10, 50, 1999, '100', 10, 30, '60', 0], // delta = 20
      [2000, 10, 11, 9, 10, 50, 2999, '200', 20, 40, '80', 0], // delta = 160 - 200 = -40
    ];
    const res = calculateCvdAndFlowPressure(klines);
    assert.equal(res.totalQuoteVolume, 300);
    assert.equal(res.takerBuyQuoteVolume, 140);
    assert.equal(res.cvd, -20);
    assert.ok(Math.abs(res.flowPressure - (-20 / 300)) < 0.0001);
  });

  await t.test('Empty klines returns 0 cvd and invalid status', () => {
    const res = calculateCvdAndFlowPressure([]);
    assert.equal(res.cvd, 0);
    assert.equal(res.flowPressure, 0);
    assert.equal(res.isValid, false);
  });
});

test('3. Open Interest & Funding Metrics', async (t) => {
  await t.test('Calculates delta OI base and delta OI USD accurately', () => {
    const start = { sumOpenInterest: '1000', sumOpenInterestValue: '50000' };
    const end = { sumOpenInterest: '1200', sumOpenInterestValue: '66000' };
    const res = calculateOiMetrics(start, end);
    assert.equal(res.deltaOiBase, 200);
    assert.equal(res.deltaOiBasePct, 20);
    assert.equal(res.deltaOiUsd, 16000);
    assert.equal(res.deltaOiUsdPct, 32);
    assert.equal(res.isValid, true);
  });

  await t.test('Missing OI start or end returns null without crashing', () => {
    const res = calculateOiMetrics(null, { sumOpenInterest: '1200' });
    assert.equal(res.deltaOiBase, null);
    assert.equal(res.isValid, false);
  });

  await t.test('Funding metrics sums settlements and computes daily average for variable settlement counts', () => {
    // 21 settlements over 7 days (3/day)
    const records = Array.from({ length: 21 }, () => ({ fundingRate: '0.0001' }));
    const res = calculateFundingMetrics(records, 7);
    assert.ok(Math.abs(res.fundingSum - 0.0021) < 0.00001);
    assert.ok(Math.abs(res.fundingAvgDaily - 0.0003) < 0.00001);
    assert.equal(res.settlementCount, 21);
  });

  await t.test('Handles coins with 4h or irregular funding (e.g. 42 settlements / 7d)', () => {
    const records = Array.from({ length: 42 }, () => ({ fundingRate: '0.00005' }));
    const res = calculateFundingMetrics(records, 7);
    assert.ok(Math.abs(res.fundingSum - 0.0021) < 0.00001);
    assert.ok(Math.abs(res.fundingAvgDaily - 0.0003) < 0.00001);
  });
});

test('4. Flow Interpretation Classification', async (t) => {
  await t.test('SPOT_SUPPORTED: Price Up and Spot CVD > 0', () => {
    const res = classifyFlowInterpretation({
      priceChangePct: 5.0,
      spotCvd: 100000,
      futuresCvd: -50000,
      deltaOiBase: 100,
    });
    assert.equal(res.label, FLOW_LABELS.SPOT_SUPPORTED);
  });

  await t.test('SHORT_COVERING: Price Up, OI Base contracted, Futures CVD > 0', () => {
    const res = classifyFlowInterpretation({
      priceChangePct: 3.5,
      spotCvd: -10000,
      futuresCvd: 80000,
      deltaOiBase: -500,
    });
    assert.equal(res.label, FLOW_LABELS.SHORT_COVERING);
  });

  await t.test('DERIVATIVES_DOMINATED: Price Up, Futures CVD > 0, OI Base expanded, Spot CVD <= 0', () => {
    const res = classifyFlowInterpretation({
      priceChangePct: 4.0,
      spotCvd: -5000,
      futuresCvd: 90000,
      deltaOiBase: 1000,
    });
    assert.equal(res.label, FLOW_LABELS.DERIVATIVES_DOMINATED);
  });

  await t.test('MIXED_OR_INSUFFICIENT: Price Down or missing data', () => {
    const res = classifyFlowInterpretation({
      priceChangePct: -2.0,
      spotCvd: 50000,
      futuresCvd: 50000,
      deltaOiBase: 500,
    });
    assert.equal(res.label, FLOW_LABELS.MIXED_OR_INSUFFICIENT);
  });
});

test('5. Volume Stability (CV & Inverse CV)', async (t) => {
  await t.test('Calculates CV and stability cleanly', () => {
    const volumes = Array.from({ length: 30 }, () => 1000);
    const res = calculateVolumeStability(volumes);
    assert.equal(res.isValid, true);
    assert.equal(res.cv, 0);
    assert.ok(res.stability > 1000); // 1 / 0.0001 = 10000
  });

  await t.test('Fails on insufficient data (< 5 days)', () => {
    const res = calculateVolumeStability([1000, 2000]);
    assert.equal(res.isValid, false);
    assert.equal(res.stability, null);
  });
});

test('6. Midrank Percentiles & Tie Handling', async (t) => {
  await t.test('Distinct values produce standard percentiles', () => {
    const values = [10, 20, 30, 40];
    const res = calculatePercentilesMidrank(values);
    // For 10: S=0, E=1 -> (0 + 0.5)/4 * 100 = 12.5%
    // For 20: S=1, E=1 -> (1 + 0.5)/4 * 100 = 37.5%
    // For 30: S=2, E=1 -> (2 + 0.5)/4 * 100 = 62.5%
    // For 40: S=3, E=1 -> (3 + 0.5)/4 * 100 = 87.5%
    assert.deepEqual(res, [12.5, 37.5, 62.5, 87.5]);
  });

  await t.test('Tied values use midrank correctly', () => {
    const values = [10, 20, 20, 40];
    const res = calculatePercentilesMidrank(values);
    // For 10: S=0, E=1 -> 12.5%
    // For 20: S=1, E=2 -> (1 + 1)/4 * 100 = 50.0%
    // For 40: S=3, E=1 -> 87.5%
    assert.deepEqual(res, [12.5, 50.0, 50.0, 87.5]);
  });

  await t.test('All identical values result in exactly 50.0%', () => {
    const values = [5, 5, 5, 5, 5];
    const res = calculatePercentilesMidrank(values);
    assert.deepEqual(res, [50, 50, 50, 50, 50]);
  });

  await t.test('Null values receive null percentile while valid values are ranked among valid count', () => {
    const values = [null, 10, null, 20];
    const res = calculatePercentilesMidrank(values);
    // Valid count = 2.
    // For 10: S=0, E=1 -> 0.5/2 * 100 = 25%
    // For 20: S=1, E=1 -> 1.5/2 * 100 = 75%
    assert.equal(res[0], null);
    assert.equal(res[1], 25);
    assert.equal(res[2], null);
    assert.equal(res[3], 75);
  });
});

test('7. Derivatives Confirmation Score', async (t) => {
  await t.test('All 4 conditions satisfied gives 100 points', () => {
    const res = calculateDerivativesConfirmationScore({
      spotCvd: 5000,
      futuresCvd: 10000,
      priceChangePct: 2.5,
      deltaOiBase: 100,
      fundingAvgDaily: 0.0001,
      hasFutures: true,
    });
    assert.equal(res.score, 100);
    assert.equal(res.conditions.spotCvdPositive, true);
    assert.equal(res.conditions.futuresCvdPositive, true);
    assert.equal(res.conditions.priceAndOiExpanding, true);
    assert.equal(res.conditions.fundingWithinThreshold, true);
  });

  await t.test('Coin without Futures can only get Spot CVD points (25)', () => {
    const res = calculateDerivativesConfirmationScore({
      spotCvd: 5000,
      futuresCvd: 10000,
      priceChangePct: 2.5,
      deltaOiBase: 100,
      fundingAvgDaily: 0.0001,
      hasFutures: false,
    });
    assert.equal(res.score, 25);
  });

  await t.test('Funding exceeding 0.03% (0.0003) fails condition 4', () => {
    const res = calculateDerivativesConfirmationScore({
      spotCvd: 5000,
      futuresCvd: 10000,
      priceChangePct: 2.5,
      deltaOiBase: 100,
      fundingAvgDaily: 0.0005,
      hasFutures: true,
    });
    assert.equal(res.score, 75);
    assert.equal(res.conditions.fundingWithinThreshold, false);
  });
});

test('8. Quantitative Sector Scores & Minimum 5 Peer Requirement', async (t) => {
  await t.test('Sector with < 5 assets gets null score with clear reason', () => {
    const mockAssets = [
      {
        symbol: 'RWA1',
        sector: 'RWA',
        windows: {
          '7d': { fundamentals: { metric1Growth: 0.1, metric2Growth: 0.05 } },
        },
      },
      {
        symbol: 'RWA2',
        sector: 'RWA',
        windows: {
          '7d': { fundamentals: { metric1Growth: 0.2, metric2Growth: 0.10 } },
        },
      },
    ];

    const scoresMap = calculateQuantitativeSectorScores(mockAssets, '7d');
    assert.equal(scoresMap.get('RWA1').score, null);
    assert.equal(scoresMap.get('RWA1').peerCount, 2);
    assert.equal(scoresMap.get('RWA1').reason, 'insufficient_sector_peers_min_5');
  });

  await t.test('Sector with >= 5 assets calculates peer-relative quant score', () => {
    const mockAssets = Array.from({ length: 5 }, (_, i) => ({
      symbol: `L1_${i}`,
      sector: 'L1',
      windows: {
        '7d': { fundamentals: { metric1Growth: (i + 1) * 0.1, metric2Growth: (i + 1) * 0.05 } },
      },
    }));

    const scoresMap = calculateQuantitativeSectorScores(mockAssets, '7d');
    assert.equal(scoresMap.get('L1_0').peerCount, 5);
    assert.ok(scoresMap.get('L1_0').score !== null);
    // Smallest growth in 5 assets: S=0, E=1 -> 10%
    assert.equal(scoresMap.get('L1_0').score, 10);
    // Largest growth in 5 assets: S=4, E=1 -> 90%
    assert.equal(scoresMap.get('L1_4').score, 90);
  });
});

test('9. Full Universe Scoring Model & Completeness Rules', async (t) => {
  const createAsset = (sym, overrides = {}) => ({
    symbol: sym,
    sector: 'L1',
    hasFutures: true,
    liquidity30d: { stability: 100 },
    rubric: { rubricScore: 80, reason: 'valid' },
    windows: {
      '7d': {
        metrics: {
          rsBtc: 10,
          rsEth: 8,
          spotFlowPressure: 0.15,
          spotCvd: 50000,
          futuresCvd: 80000,
          priceChangePct: 5,
          deltaOiBase: 100,
          fundingAvgDaily: 0.0001,
          quoteVolume: 1000000,
        },
        fundamentals: {
          metric1Growth: 0.1,
          metric2Growth: 0.15,
        },
      },
    },
    ...overrides,
  });

  await t.test('Computes 4 pillars and ranks complete assets descending by total score', () => {
    const assets = [
      createAsset('SOLUSDT', { windows: { '7d': { metrics: { rsBtc: 25, rsEth: 20, spotFlowPressure: 0.3, spotCvd: 100, futuresCvd: 100, priceChangePct: 10, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 5000000 }, fundamentals: { metric1Growth: 0.5, metric2Growth: 0.5 } } } }),
      createAsset('AVAXUSDT', { windows: { '7d': { metrics: { rsBtc: 5, rsEth: 4, spotFlowPressure: 0.05, spotCvd: 100, futuresCvd: 100, priceChangePct: 2, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 1000000 }, fundamentals: { metric1Growth: 0.1, metric2Growth: 0.1 } } } }),
      createAsset('NEARUSDT', { windows: { '7d': { metrics: { rsBtc: 15, rsEth: 12, spotFlowPressure: 0.15, spotCvd: 100, futuresCvd: 100, priceChangePct: 5, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 2000000 }, fundamentals: { metric1Growth: 0.2, metric2Growth: 0.2 } } } }),
      createAsset('SUIUSDT', { windows: { '7d': { metrics: { rsBtc: 20, rsEth: 18, spotFlowPressure: 0.25, spotCvd: 100, futuresCvd: 100, priceChangePct: 8, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 3000000 }, fundamentals: { metric1Growth: 0.3, metric2Growth: 0.3 } } } }),
      createAsset('APTUSDT', { windows: { '7d': { metrics: { rsBtc: 10, rsEth: 9, spotFlowPressure: 0.10, spotCvd: 100, futuresCvd: 100, priceChangePct: 3, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 1500000 }, fundamentals: { metric1Growth: 0.15, metric2Growth: 0.15 } } } }),
    ];

    const quantMap = calculateQuantitativeSectorScores(assets, '7d');
    const scored = scoreUniverseForWindow(assets, '7d', quantMap);

    assert.equal(scored.length, 5);
    // All 5 are complete
    assert.equal(scored.filter(a => a.windows['7d'].completeness.isComplete).length, 5);

    // Check ranks: SOLUSDT should be rank 1 (strongest across all metrics)
    const sol = scored.find(a => a.symbol === 'SOLUSDT');
    assert.equal(sol.windows['7d'].rank, 1);
    assert.ok(sol.windows['7d'].scores.totalScore > 0);

    const avax = scored.find(a => a.symbol === 'AVAXUSDT');
    assert.equal(avax.windows['7d'].rank, 5);
  });

  await t.test('Missing pillar leads to null total score, null rank, and preserved submetrics (no dynamic reweighting)', () => {
    const assets = [
      createAsset('SOLUSDT'),
      createAsset('INCOMPLETE_COIN', {
        rubric: { rubricScore: null, reason: 'rubric_missing' }, // missing rubric
      }),
    ];

    const quantMap = new Map([
      ['SOLUSDT', { score: 70, peerCount: 5 }],
      ['INCOMPLETE_COIN', { score: 50, peerCount: 5 }],
    ]);

    const scored = scoreUniverseForWindow(assets, '7d', quantMap);
    const inc = scored.find(a => a.symbol === 'INCOMPLETE_COIN');

    assert.equal(inc.windows['7d'].scores.totalScore, null);
    assert.equal(inc.windows['7d'].rank, null);
    assert.equal(inc.windows['7d'].completeness.isComplete, false);
    assert.deepEqual(inc.windows['7d'].completeness.missingPillars, ['fundamentals']);
    // RS and Liquidity pillars should still be computed and preserved!
    assert.ok(inc.windows['7d'].scores.rsPillar !== null);
    assert.ok(inc.windows['7d'].scores.liqPillar !== null);
  });
});

test('10. Summary Statistics & Tracking Deltas', async (t) => {
  await t.test('Calculates summary statistics correctly', () => {
    const assets = [
      {
        symbol: 'A',
        windows: {
          '7d': {
            metrics: { rsBtc: 10, rsEth: 5, flowLabel: 'SPOT_SUPPORTED' },
            scores: { totalScore: 85 },
          },
        },
      },
      {
        symbol: 'B',
        windows: {
          '7d': {
            metrics: { rsBtc: -2, rsEth: -3, flowLabel: 'SHORT_COVERING' },
            scores: { totalScore: 45 },
          },
        },
      },
      {
        symbol: 'C',
        windows: {
          '7d': {
            metrics: { rsBtc: 5, rsEth: -1, flowLabel: 'DERIVATIVES_DOMINATED' },
            scores: { totalScore: null },
          },
        },
      },
    ];

    const stats = calculateSummaryStatistics(assets, '7d');
    assert.equal(stats.totalAssets, 3);
    assert.equal(stats.completeCount, 2);
    assert.equal(stats.incompleteCount, 1);
    // RS BTC positive: 2 / 3 -> 66.66%
    assert.ok(Math.abs(stats.rsBtcPositiveRatio - 66.666) < 0.1);
    // Flow distribution
    assert.equal(stats.flowDistribution.SPOT_SUPPORTED, 1);
    assert.equal(stats.flowDistribution.SHORT_COVERING, 1);
    assert.equal(stats.flowDistribution.DERIVATIVES_DOMINATED, 1);
  });

  await t.test('Calculates tracking deltas against previous snapshot', () => {
    const currentAsset = {
      symbol: 'SOLUSDT',
      windows: {
        '7d': {
          scores: { totalScore: 85 },
          rank: 2,
        },
      },
    };

    const priorSnapshot1d = {
      assets: [
        {
          symbol: 'SOLUSDT',
          windows: {
            '7d': {
              scores: { totalScore: 80 },
              rank: 5,
            },
          },
        },
      ],
    };

    const deltas = calculateTrackingDeltas(currentAsset, priorSnapshot1d, null, null, '7d');
    assert.equal(deltas.isNewInUniverse, false);
    assert.equal(deltas.diff1d.deltaScore, 5);
    // Rank improved from 5 to 2 -> +3
    assert.equal(deltas.diff1d.deltaRank, 3);
  });

  await t.test('Identifies new coin in universe', () => {
    const currentAsset = {
      symbol: 'NEWCOIN',
      windows: { '7d': { scores: { totalScore: 60 }, rank: 10 } },
    };
    const priorSnapshot1d = {
      assets: [{ symbol: 'SOLUSDT' }],
    };

    const deltas = calculateTrackingDeltas(currentAsset, priorSnapshot1d, null, null, '7d');
    assert.equal(deltas.isNewInUniverse, true);
    assert.equal(deltas.diff1d.deltaScore, null);
    assert.equal(deltas.diff1d.deltaRank, null);
  });
});
