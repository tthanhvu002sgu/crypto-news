import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { extractHistoricalFeesWindow, fetchLiveDefiLlamaMetrics } from './defiLlamaAdapter.js';
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
