import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { extractHistoricalFeesWindow, extractHistoricalTvlWindow, fetchLiveDefiLlamaMetrics } from './defiLlamaAdapter.js';
import { getSectorMetricsGrowthForWindow } from './curatedFundamentalsService.js';

const DAY = 86_400_000;
const AS_OF = Date.parse('2026-09-27T00:00:00.000Z');
const chart = Array.from({ length: 14 }, (_, index) => [
  (AS_OF - (14 - index) * DAY) / 1000,
  100,
]);

test('historical fees require both complete, closed daily windows', () => {
  const complete = extractHistoricalFeesWindow({ totalDataChart: chart }, '7d', AS_OF);
  assert.equal(complete.currentValue, 700);
  assert.equal(complete.priorValue, 700);
  assert.equal(complete.growthRate, 0);
  assert.equal(complete.publishedAt, '2026-09-26T00:00:00.000Z');

  assert.equal(extractHistoricalFeesWindow({ totalDataChart: chart.slice(0, 11) }, '7d', AS_OF), null);
  assert.equal(extractHistoricalFeesWindow({ totalDataChart: [...chart, chart[0]] }, '7d', AS_OF), null);
  assert.equal(extractHistoricalFeesWindow({ totalDataChart: chart.slice(1) }, '7d', AS_OF), null);
});

test('fees summary without daily history cannot create a past snapshot', async () => {
  const previousGet = axios.get;
  axios.get = async () => ({ data: { total7d: 700, change_7d: 20 } });
  try {
    assert.equal(await fetchLiveDefiLlamaMetrics('scanner-history-test', '7d', new Date('2020-01-01')), null);
  } finally {
    axios.get = previousGet;
  }
});

test('future live publication cannot affect a closed snapshot', () => {
  const baseline = getSectorMetricsGrowthForWindow('SOLUSDT', '7d', new Date(AS_OF));
  const overrides = { SOLUSDT: { '7d': { metric2Growth: 9, publishedAt: '2026-09-27T12:00:00.000Z' } } };
  const result = getSectorMetricsGrowthForWindow('SOLUSDT', '7d', new Date(AS_OF), overrides);
  assert.equal(result.metric1Growth, baseline.metric1Growth);
  assert.equal(result.metric2Growth, baseline.metric2Growth);
});

test('historical TVL extraction computes exact closed-day growth and enforces anti-lookahead', () => {
  const tvlSeries = [
    { date: (AS_OF - 8 * DAY) / 1000, tvl: 1000 },
    { date: (AS_OF - 1 * DAY) / 1000, tvl: 1200 },
    // Future point after AS_OF must be ignored
    { date: (AS_OF + 1 * DAY) / 1000, tvl: 9999 },
  ];
  const res = extractHistoricalTvlWindow(tvlSeries, '7d', AS_OF);
  assert.ok(res);
  assert.equal(res.priorValue, 1000);
  assert.equal(res.currentValue, 1200);
  assert.ok(Math.abs(res.growthRate - 0.2) < 1e-9);
  assert.equal(res.publishedAt, '2026-09-26T00:00:00.000Z');
});

test('live overrides with independent publishedAt1 and publishedAt2 supply both metrics without static data', () => {
  // Date far after curatedFundamentals.json (2026-09-27) so static data is unmatched
  const laterDate = new Date('2026-11-24T00:00:00.000Z');
  const overrides = {
    SOLUSDT: {
      '7d': {
        metric1Growth: 0.15,
        metric1Name: 'tvl',
        metric1Unit: 'USD',
        publishedAt1: '2026-11-23T00:00:00.000Z',
        metric2Growth: 0.25,
        metric2Name: 'network_fees',
        metric2Unit: 'USD',
        publishedAt2: '2026-11-23T00:00:00.000Z',
      },
    },
  };
  const res = getSectorMetricsGrowthForWindow('SOLUSDT', '7d', laterDate, overrides);
  assert.equal(res.metric1Growth, 0.15);
  assert.equal(res.metric2Growth, 0.25);
  assert.equal(res.reason, 'valid');
});
