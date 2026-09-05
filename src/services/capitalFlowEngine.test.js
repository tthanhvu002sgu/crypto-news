import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCapitalFlow } from './capitalFlowEngine.js';

const complete = {
  fundingRate: 0.0001,
  basisPct: 0.04,
  coveragePct: 100,
};

test('classifies new long-biased capital when Price, CVD and OI expand together', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: 2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'CAPITAL_IN_LONG_BIAS');
  assert.equal(result.flow, 'IN');
  assert.equal(result.mechanism, 'NEW_POSITION');
});

test('classifies new short-biased capital when Price, CVD and OI fall/rise in the short matrix', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -1.2, cvdRatioPct: -2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'CAPITAL_IN_SHORT_BIAS');
  assert.equal(result.bias, 'SHORT');
});

test('distinguishes short covering from new long capital', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: 2.1, oiChangePct: -3.4 });
  assert.equal(result.state, 'CAPITAL_OUT_SHORT_COVER');
  assert.equal(result.flow, 'OUT');
});

test('labels falling Price, sell CVD and contracting OI as long exit with liquidation caveat', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -1.2, cvdRatioPct: -2.1, oiChangePct: -3.4 });
  assert.equal(result.state, 'CAPITAL_OUT_LONG_EXIT');
  assert.match(result.detail, /chưa thể tách/i);
});

test('does not force direction when OI expands against price/CVD alignment', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: -2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'SELL_ABSORPTION_WITH_OI_IN');
  assert.equal(result.bias, 'MIXED');
});

test('abstains when a core input is missing', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: null, oiChangePct: 3.4 });
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.quality.level, 'INSUFFICIENT');
});

test('uses funding and basis as crowding context, not flow direction', () => {
  const result = classifyCapitalFlow({ ...complete, fundingRate: 0.0008, basisPct: 0.3, priceChangePct: 1.2, cvdRatioPct: 2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'CAPITAL_IN_LONG_BIAS');
  assert.equal(result.crowding.state, 'CROWDED_LONGS');
});

test('identifies spot confluence buy when long bias and spot CVD is positive', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: 1.2,
    cvdRatioPct: 2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: 1.5,
    spotNetDelta: 50_000_000,
  });
  assert.equal(result.state, 'CAPITAL_IN_LONG_BIAS');
  assert.equal(result.spotAlignment.state, 'SPOT_CONFLUENCE');
  assert.equal(result.spotAlignment.label, 'Đồng thuận mua');
  assert.equal(result.spotAlignment.tone, 'bullish');
});

test('identifies spot divergence sell when long bias but spot CVD is negative', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: 1.2,
    cvdRatioPct: 2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: -1.5,
    spotNetDelta: -50_000_000,
  });
  assert.equal(result.state, 'CAPITAL_IN_LONG_BIAS');
  assert.equal(result.spotAlignment.state, 'SPOT_DIVERGENCE');
  assert.equal(result.spotAlignment.label, 'Phân kỳ bán Spot');
  assert.equal(result.spotAlignment.tone, 'warning');
});

test('identifies spot confluence sell when short bias and spot CVD is negative', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: -1.2,
    cvdRatioPct: -2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: -2.0,
    spotNetDelta: -60_000_000,
  });
  assert.equal(result.state, 'CAPITAL_IN_SHORT_BIAS');
  assert.equal(result.spotAlignment.state, 'SPOT_CONFLUENCE');
  assert.equal(result.spotAlignment.label, 'Đồng thuận bán');
  assert.equal(result.spotAlignment.tone, 'bearish');
});

test('identifies spot divergence buy when short bias but spot CVD is positive', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: -1.2,
    cvdRatioPct: -2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: 1.8,
    spotNetDelta: 40_000_000,
  });
  assert.equal(result.state, 'CAPITAL_IN_SHORT_BIAS');
  assert.equal(result.spotAlignment.state, 'SPOT_DIVERGENCE');
  assert.equal(result.spotAlignment.label, 'Phân kỳ mua Spot');
  assert.equal(result.spotAlignment.tone, 'warning');
});

test('gracefully handles missing spot data as unavailable', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: 1.2,
    cvdRatioPct: 2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: null,
    spotNetDelta: null,
  });
  assert.equal(result.spotAlignment.state, 'UNAVAILABLE');
  assert.equal(result.spotAlignment.label, 'Spot chưa rõ');
});
