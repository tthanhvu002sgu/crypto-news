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
  calculateQuantitativeSectorScores,
  scoreUniverseForWindow,
  calculateSummaryStatistics,
  calculateTrackingDeltas,
  evaluateRubricForDate,
  getCuratedFundamentalsForDate,
  getSectorMetricsGrowthForWindow,
  isExcludedSymbol,
  getAssetMetadata,
  getAllRegisteredAssets,
  getUtcMidnightDate,
  findPriorSnapshotDates,
  isSnapshotStale,
  exportScannerCsv,
  exportScannerJson,
  hydrateAssetsWithTracking,
  extractHistoricalFeesWindow,
  fetchLiveDefiLlamaMetrics,
  FLOW_LABELS,
  SCANNER_SCHEMA_VERSION,
  SCANNER_MODEL_VERSION,
} from './coinScanner.js';

test('Scanner v9 Comprehensive Acceptance Test Suite', async (t) => {
  // ── 1. Relative Strength (RS) ──────────────────────────────────────────────
  await t.test('RS: ALT +20% and BTC +10% yields exact ~9.09%', () => {
    const res = calculateRelativeStrength(120, 100, 110, 100);
    assert.equal(res.reason, 'valid');
    assert.ok(Math.abs(res.value - 9.090909) < 0.0001);
  });

  await t.test('RS: Negative USD return but outperforming falling benchmark yields positive RS', () => {
    // ALT down -5% (100 -> 95), BTC down -20% (100 -> 80)
    // Cross rate went from 1.0 to 95/80 = 1.1875 -> +18.75%
    const res = calculateRelativeStrength(95, 100, 80, 100);
    assert.equal(res.reason, 'valid');
    assert.ok(res.value > 0);
    assert.ok(Math.abs(res.value - 18.75) < 0.0001);
  });

  await t.test('RS: Missing candle at either end returns null without substituting 0 or stale price', () => {
    assert.equal(calculateRelativeStrength(null, 100, 110, 100).value, null);
    assert.equal(calculateRelativeStrength(120, null, 110, 100).value, null);
    assert.equal(calculateRelativeStrength(120, 100, null, 100).value, null);
    assert.equal(calculateRelativeStrength(120, 100, 110, null).value, null);
  });

  // ── 2. Flow, CVD, OI and Funding ──────────────────────────────────────────
  await t.test('Flow: Total volume 100, taker-buy 60 gives CVD 20 and ratio 20%', () => {
    const klines = [
      [1000, 10, 11, 9, 10, 50, 1999, '100', 10, 30, '60', 0],
    ];
    const res = calculateCvdAndFlowPressure(klines);
    assert.equal(res.totalQuoteVolume, 100);
    assert.equal(res.cvd, 20);
    assert.equal(res.flowPressure, 0.20);
  });

  await t.test('Flow: Independent Spot and Futures CVD calculations and flow interpretation', () => {
    // Spot supported: Price up + Spot CVD > 0
    assert.equal(
      classifyFlowInterpretation({ priceChangePct: 5, spotCvd: 50000, futuresCvd: 10000, deltaOiBase: 100 }).label,
      FLOW_LABELS.SPOT_SUPPORTED
    );

    // Derivatives dominated: Price up + Futures CVD > 0 + OI Base up + Spot CVD <= 0
    assert.equal(
      classifyFlowInterpretation({ priceChangePct: 5, spotCvd: -5000, futuresCvd: 80000, deltaOiBase: 100 }).label,
      FLOW_LABELS.DERIVATIVES_DOMINATED
    );

    // Short covering: Price up + Futures CVD > 0 + OI Base down
    assert.equal(
      classifyFlowInterpretation({ priceChangePct: 5, spotCvd: -5000, futuresCvd: 80000, deltaOiBase: -200 }).label,
      FLOW_LABELS.SHORT_COVERING
    );

    // Mixed: Price down
    assert.equal(
      classifyFlowInterpretation({ priceChangePct: -3, spotCvd: 50000, futuresCvd: 50000, deltaOiBase: 100 }).label,
      FLOW_LABELS.MIXED_OR_INSUFFICIENT
    );
  });

  await t.test('Funding: Calculates variable settlement counts without assuming 3/day', () => {
    const records = Array.from({ length: 42 }, () => ({ fundingRate: '0.00005' }));
    const res = calculateFundingMetrics(records, 7);
    assert.equal(res.settlementCount, 42);
    assert.ok(Math.abs(res.fundingSum - 0.0021) < 0.00001);
    assert.ok(Math.abs(res.fundingAvgDaily - 0.0003) < 0.00001);
  });

  await t.test('OI: Missing endpoint returns null with clear reason', () => {
    const res = calculateOiMetrics(null, { sumOpenInterest: 500 });
    assert.equal(res.isValid, false);
    assert.equal(res.deltaOiBase, null);
  });

  // ── 3. Fundamentals & Rubric Registry ─────────────────────────────────────
  await t.test('Rubric: Evaluates product and token accrual with 50/50 weights', () => {
    const rubric = evaluateRubricForDate('SOLUSDT', '2026-09-27T00:00:00.000Z');
    assert.equal(rubric.reason, 'valid');
    assert.equal(rubric.productScore, 100);
    assert.equal(rubric.tokenAccrualScore, 100);
    assert.equal(rubric.rubricScore, 100);
    assert.equal(rubric.isExpired, false);
  });

  await t.test('Rubric: Anti-lookahead rejects evaluations made in the future', () => {
    // Evaluating as of 2026-08-01 when rubric was evaluated at 2026-09-01
    const rubric = evaluateRubricForDate('SOLUSDT', '2026-08-01T00:00:00.000Z');
    assert.equal(rubric.reason, 'rubric_future_lookahead');
    assert.equal(rubric.rubricScore, null);
  });

  await t.test('Rubric: Expires after 90 days', () => {
    // Evaluating as of 2026-12-15 when rubric was evaluated at 2026-09-01 (over 90 days)
    const rubric = evaluateRubricForDate('SOLUSDT', '2026-12-15T00:00:00.000Z');
    assert.equal(rubric.reason, 'rubric_expired_over_90d');
    assert.equal(rubric.isExpired, true);
    assert.equal(rubric.rubricScore, null);
  });

  await t.test('Sector Fundamentals: Enforces minimum 5 peers for quant scoring', () => {
    const fewAssets = [
      { symbol: 'A', sector: 'AI', windows: { '7d': { fundamentals: { metric1Growth: 0.1, metric2Growth: 0.2 } } } },
      { symbol: 'B', sector: 'AI', windows: { '7d': { fundamentals: { metric1Growth: 0.3, metric2Growth: 0.4 } } } },
    ];
    const quantMap = calculateQuantitativeSectorScores(fewAssets, '7d');
    assert.equal(quantMap.get('A').score, null);
    assert.equal(quantMap.get('A').reason, 'insufficient_sector_peers_min_5');
  });

  await t.test('Sector Fundamentals: Live adapter overriding metric2 preserves metric1 from curated data', () => {
    const liveOverrides = {
      SOLUSDT: {
        '7d': {
          metric2Growth: 0.085858,
          metric2Name: 'network_fees',
          metric2Unit: 'USD',
          metric2Value: 21500000,
          metric2Prior: 19800000,
          sourceUrl2: 'https://defillama.com/fees/solana',
          publishedAt: '2026-09-27T00:00:00.000Z',
        },
      },
    };

    const res = getSectorMetricsGrowthForWindow('SOLUSDT', '7d', '2026-09-27T00:00:00.000Z', liveOverrides);
    assert.equal(res.reason, 'valid');
    assert.ok(res.metric1Growth !== null, 'metric1Growth should not be null');
    assert.ok(Math.abs(res.metric1Growth - 0.056338) < 0.0001, `Expected metric1Growth ~0.056338, got ${res.metric1Growth}`);
    assert.ok(Math.abs(res.metric2Growth - 0.085858) < 0.0001, `Expected metric2Growth ~0.085858, got ${res.metric2Growth}`);
    assert.equal(res.metric1Name, 'active_addresses');
    assert.equal(res.metric2Name, 'network_fees');
    assert.equal(res.measurementPeriod.status, 'valid');
  });

  await t.test('DefiLlama Adapter: Historical fees extraction respects window and real published timestamp', () => {
    const anchorSec = 1790467200; // 2026-09-27 00:00:00 UTC
    const daySec = 86400;
    const chart = [];
    // 14 days of chart data
    for (let i = 14; i >= 1; i -= 1) {
      const t = anchorSec - (i * daySec) + 3600; // within day
      const val = i <= 7 ? 20000 : 10000; // Prior 7d = 70000, Current 7d = 140000 -> +100% growth
      chart.push([t, val]);
    }

    const feesData = { totalDataChart: chart };
    const extracted = extractHistoricalFeesWindow(feesData, '7d', anchorSec * 1000);
    assert.ok(extracted !== null);
    assert.equal(extracted.currentValue, 140000);
    assert.equal(extracted.priorValue, 70000);
    assert.equal(extracted.growthRate, 1.0);
    assert.ok(extracted.publishedAt.startsWith('2026-09-26'));
  });

  await t.test('DefiLlama Adapter: Requesting past date (e.g. 2020) without historical data returns null, never falsifying date', async () => {
    // When feesData has no historical chart covering 2020, it returns null
    const res = await fetchLiveDefiLlamaMetrics('invalid-protocol-slug', '7d', '2020-01-01T00:00:00.000Z');
    assert.equal(res, null);
  });

  await t.test('OI Metrics: Matches exact 00:00 UTC daily record without dropping endpoint at asOf', () => {
    const asOfTime = new Date('2026-09-27T00:00:00.000Z').getTime();
    const startOiTime = asOfTime - (7 * 24 * 60 * 60 * 1000);

    const startOi = { timestamp: startOiTime, sumOpenInterest: '5000000', sumOpenInterestValue: '750000000' };
    const endOi = { timestamp: asOfTime, sumOpenInterest: '6000000', sumOpenInterestValue: '960000000' };

    const oiMetrics = calculateOiMetrics(startOi, endOi);
    assert.equal(oiMetrics.isValid, true);
    assert.equal(oiMetrics.endOiBase, 6000000);
    assert.equal(oiMetrics.deltaOiBase, 1000000);
    assert.equal(oiMetrics.deltaOiBasePct, 20);
  });

  // ── 4. Scoring Model & Completeness ───────────────────────────────────────
  await t.test('Scoring: 4 Pillars combine accurately (40/25/25/10) into 0-100 score', () => {
    const assets = [
      {
        symbol: 'A1',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 100 },
        rubric: { rubricScore: 100, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 20, rsEth: 20, spotFlowPressure: 0.5, spotCvd: 1000, futuresCvd: 1000, priceChangePct: 10, deltaOiBase: 10, fundingAvgDaily: 0.0001, quoteVolume: 1000000 },
            fundamentals: { metric1Growth: 0.5, metric2Growth: 0.5 },
          },
        },
      },
      {
        symbol: 'A2',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 50 },
        rubric: { rubricScore: 80, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 10, rsEth: 10, spotFlowPressure: 0.2, spotCvd: 500, futuresCvd: 500, priceChangePct: 5, deltaOiBase: 5, fundingAvgDaily: 0.0001, quoteVolume: 500000 },
            fundamentals: { metric1Growth: 0.2, metric2Growth: 0.2 },
          },
        },
      },
      {
        symbol: 'A3',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 40 },
        rubric: { rubricScore: 70, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 8, rsEth: 8, spotFlowPressure: 0.1, spotCvd: 200, futuresCvd: 200, priceChangePct: 2, deltaOiBase: 2, fundingAvgDaily: 0.0001, quoteVolume: 300000 },
            fundamentals: { metric1Growth: 0.1, metric2Growth: 0.1 },
          },
        },
      },
      {
        symbol: 'A4',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 30 },
        rubric: { rubricScore: 60, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 5, rsEth: 5, spotFlowPressure: 0.05, spotCvd: 100, futuresCvd: 100, priceChangePct: 1, deltaOiBase: 1, fundingAvgDaily: 0.0001, quoteVolume: 200000 },
            fundamentals: { metric1Growth: 0.05, metric2Growth: 0.05 },
          },
        },
      },
      {
        symbol: 'A5',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 20 },
        rubric: { rubricScore: 50, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 2, rsEth: 2, spotFlowPressure: 0.01, spotCvd: 50, futuresCvd: 50, priceChangePct: 0.5, deltaOiBase: 1, fundingAvgDaily: 0.0001, quoteVolume: 100000 },
            fundamentals: { metric1Growth: 0.01, metric2Growth: 0.01 },
          },
        },
      },
    ];

    const quantMap = calculateQuantitativeSectorScores(assets, '7d');
    const scored = scoreUniverseForWindow(assets, '7d', quantMap);

    assert.equal(scored.length, 5);
    const top = scored[0];
    assert.equal(top.symbol, 'A1');
    assert.equal(top.windows['7d'].rank, 1);
    assert.ok(top.windows['7d'].scores.totalScore > 80);
    assert.equal(scored[4].windows['7d'].rank, 5);
  });

  await t.test('Scoring: Incomplete assets get null total score and null rank, never reweighted', () => {
    const assets = [
      {
        symbol: 'COMPLETE_COIN',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 50 },
        rubric: { rubricScore: 80, reason: 'valid' },
        windows: {
          '7d': {
            metrics: { rsBtc: 10, rsEth: 10, spotFlowPressure: 0.1, spotCvd: 100, futuresCvd: 100, deltaOiBase: 50, fundingAvgDaily: 0.0001, quoteVolume: 100000 },
          },
        },
      },
      {
        symbol: 'INCOMPLETE_COIN',
        sector: 'L1',
        hasFutures: true,
        liquidity30d: { stability: 50 },
        rubric: { rubricScore: null, reason: 'rubric_missing' }, // Missing rubric
        windows: {
          '7d': {
            metrics: { rsBtc: 15, rsEth: 15, spotFlowPressure: 0.2, spotCvd: 200, futuresCvd: 200, deltaOiBase: 60, fundingAvgDaily: 0.0001, quoteVolume: 200000 },
          },
        },
      },
    ];

    const quantMap = new Map([
      ['COMPLETE_COIN', { score: 60, peerCount: 5 }],
      ['INCOMPLETE_COIN', { score: 70, peerCount: 5 }],
    ]);

    const scored = scoreUniverseForWindow(assets, '7d', quantMap);
    const inc = scored.find(a => a.symbol === 'INCOMPLETE_COIN');
    assert.equal(inc.windows['7d'].scores.totalScore, null);
    assert.equal(inc.windows['7d'].rank, null);
    assert.equal(inc.windows['7d'].completeness.isComplete, false);
    assert.deepEqual(inc.windows['7d'].completeness.missingPillars, ['fundamentals']);
  });

  // ── 5. Tracking, Stale Check & Registry ───────────────────────────────────
  await t.test('Registry: Excluded assets check (BTC, ETH, Stables, Leveraged, Wrapped)', () => {
    assert.equal(isExcludedSymbol('BTCUSDT'), true);
    assert.equal(isExcludedSymbol('ETHUSDT'), true);
    assert.equal(isExcludedSymbol('USDTUSDC'), true);
    assert.equal(isExcludedSymbol('FDUSDUSDT'), true);
    assert.equal(isExcludedSymbol('BTCUPUSDT'), true);
    assert.equal(isExcludedSymbol('ETHBEARUSDT'), true);
    assert.equal(isExcludedSymbol('WBTCUSDT'), true);
    assert.equal(isExcludedSymbol('SOLUSDT'), false);
    assert.equal(isExcludedSymbol('AVAXUSDT'), false);
  });

  await t.test('Tracking: Computes deltaScore, deltaRank, and NEW asset indicator', () => {
    const currentSnapshot = {
      assets: [
        {
          symbol: 'SOLUSDT',
          windows: { '7d': { scores: { totalScore: 88.5 }, rank: 2 } },
        },
        {
          symbol: 'NEW_ASSET',
          windows: { '7d': { scores: { totalScore: 72.0 }, rank: 15 } },
        },
      ],
    };

    const priorSnapshot1d = {
      assets: [
        {
          symbol: 'SOLUSDT',
          windows: { '7d': { scores: { totalScore: 82.0 }, rank: 6 } },
        },
      ],
    };

    const hydrated = hydrateAssetsWithTracking(currentSnapshot, priorSnapshot1d, null, null, '7d');
    const sol = hydrated.find(a => a.symbol === 'SOLUSDT');
    const newAsset = hydrated.find(a => a.symbol === 'NEW_ASSET');

    assert.equal(sol.tracking.isNewInUniverse, false);
    assert.equal(sol.tracking.diff1d.deltaScore, 6.5);
    assert.equal(sol.tracking.diff1d.deltaRank, 4); // Improved from rank 6 to 2 (+4)

    assert.equal(newAsset.tracking.isNewInUniverse, true);
    assert.equal(newAsset.tracking.diff1d.deltaScore, null);
    assert.equal(newAsset.tracking.diff1d.deltaRank, null);
  });

  await t.test('Tracking: Model Version Invariant isolates tracking across different model versions', () => {
    const currentAsset = {
      symbol: 'SOLUSDT',
      windows: { '7d': { scores: { totalScore: 90.0 }, rank: 1 } },
    };

    const priorSnapshotV1 = {
      modelVersion: 'v1.0.0',
      assets: [{ symbol: 'SOLUSDT', windows: { '7d': { scores: { totalScore: 85.0 }, rank: 3 } } }],
    };

    const priorSnapshotV2 = {
      modelVersion: 'v2.0.0',
      assets: [{ symbol: 'SOLUSDT', windows: { '7d': { scores: { totalScore: 85.0 }, rank: 3 } } }],
    };

    // Same model version -> deltas computed
    const deltasSame = calculateTrackingDeltas(currentAsset, priorSnapshotV1, null, null, '7d', 'v1.0.0');
    assert.equal(deltasSame.diff1d.deltaScore, 5.0);
    assert.equal(deltasSame.diff1d.deltaRank, 2);

    // Mismatched model version -> deltas are null (prevent mixing model versions)
    const deltasDiff = calculateTrackingDeltas(currentAsset, priorSnapshotV2, null, null, '7d', 'v1.0.0');
    assert.equal(deltasDiff.diff1d.deltaScore, null);
    assert.equal(deltasDiff.diff1d.deltaRank, null);
  });

  await t.test('Manifest: findPriorSnapshotDates finds exact 1d, 7d, 30d snapshots', () => {
    const mockManifest = {
      snapshots: [
        { date: '2026-09-27' },
        { date: '2026-09-26' },
        { date: '2026-09-20' },
        { date: '2026-08-28' },
      ],
    };

    const priors = findPriorSnapshotDates(mockManifest, '2026-09-27');
    assert.equal(priors.date1d, '2026-09-26');
    assert.equal(priors.date7d, '2026-09-20');
    assert.equal(priors.date30d, '2026-08-28');

    // Missing 7d in sparse manifest
    const sparseManifest = {
      snapshots: [
        { date: '2026-09-27' },
        { date: '2026-09-26' },
      ],
    };
    const sparsePriors = findPriorSnapshotDates(sparseManifest, '2026-09-27');
    assert.equal(sparsePriors.date1d, '2026-09-26');
    assert.equal(sparsePriors.date7d, null);
    assert.equal(sparsePriors.date30d, null);
  });

  await t.test('Registry: Has zero duplicate symbols', () => {
    const all = getAllRegisteredAssets();
    const symbols = all.map(a => a.symbol.toUpperCase());
    const uniqueSymbols = new Set(symbols);
    assert.equal(symbols.length, uniqueSymbols.size, 'All symbols in registry must be unique');
  });

  await t.test('Stale Check: Identifies snapshots older than 36 hours', () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    // 24 hours old -> NOT stale
    assert.equal(isSnapshotStale('2026-09-26T12:00:00.000Z', now), false);
    // 40 hours old -> STALE
    assert.equal(isSnapshotStale('2026-09-25T20:00:00.000Z', now), true);
  });

  // ── 6. Export Serialization ───────────────────────────────────────────────
  await t.test('Export: CSV contains full headers, units, modelVersion, and schemaVersion', () => {
    const snapshot = {
      asOf: '2026-09-27T00:00:00.000Z',
      schemaVersion: SCANNER_SCHEMA_VERSION,
      modelVersion: SCANNER_MODEL_VERSION,
      assets: [
        {
          symbol: 'SOLUSDT',
          baseAsset: 'SOL',
          name: 'Solana',
          sector: 'L1',
          narratives: ['DePIN'],
          liquidity30d: { stability: 120 },
          tracking: { diff1d: { deltaScore: 2.5, deltaRank: 1 } },
          windows: {
            '7d': {
              rank: 1,
              scores: { totalScore: 92.5, quantSectorScore: 90, rubricScore: 100 },
              metrics: { rsBtc: 15.2, rsEth: 18.4, spotCvd: 500000, spotFlowPressure: 0.25, flowLabel: 'SPOT_SUPPORTED', flowLabelText: 'Spot hỗ trợ', quoteVolume: 10000000 },
              completeness: { isComplete: true, missingPillars: [] },
            },
          },
        },
      ],
    };

    const csv = exportScannerCsv(snapshot, '7d');
    assert.ok(csv.includes('SOLUSDT'));
    assert.ok(csv.includes('Solana'));
    assert.ok(csv.includes('92.50'));
    assert.ok(csv.includes(SCANNER_MODEL_VERSION));
    assert.ok(csv.includes(SCANNER_SCHEMA_VERSION));

    const jsonStr = exportScannerJson(snapshot, '7d');
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.selectedWindow, '7d');
    assert.equal(parsed.assets.length, 1);
  });
});
