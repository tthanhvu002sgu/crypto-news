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
  assert.equal(result.actionBadge, 'LONG BUILD-UP');
  assert.equal(result.label, 'Mở vị thế Long');
  assert.equal(result.mechanism, 'NEW_POSITION');
});

test('classifies new short-biased capital when Price, CVD and OI fall/rise in the short matrix', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -1.2, cvdRatioPct: -2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'CAPITAL_IN_SHORT_BIAS');
  assert.equal(result.bias, 'SHORT');
  assert.equal(result.actionBadge, 'SHORT BUILD-UP');
  assert.equal(result.label, 'Mở vị thế Short');
});

test('distinguishes short covering from new long capital', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: 2.1, oiChangePct: -3.4 });
  assert.equal(result.state, 'CAPITAL_OUT_SHORT_COVER');
  assert.equal(result.flow, 'OUT');
  assert.equal(result.actionBadge, 'SHORT COVER');
  assert.equal(result.label, 'Đóng vị thế Short');
});

test('labels falling Price, sell CVD and contracting OI as long exit with liquidation caveat', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -1.2, cvdRatioPct: -2.1, oiChangePct: -3.4 });
  assert.equal(result.state, 'CAPITAL_OUT_LONG_EXIT');
  assert.equal(result.actionBadge, 'LONG UNWIND');
  assert.equal(result.label, 'Thoát vị thế Long');
  assert.match(result.detail, /chưa thể tách/i);
});

test('does not force direction when OI expands against price/CVD alignment', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 1.2, cvdRatioPct: -2.1, oiChangePct: 3.4 });
  assert.equal(result.state, 'SELL_ABSORPTION_WITH_OI_IN');
  assert.equal(result.bias, 'MIXED');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Hấp thụ lực bán');
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
  assert.equal(result.spotAlignment.label, 'Spot đồng thuận mua');
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
  assert.equal(result.spotAlignment.label, 'Spot phân kỳ bán');
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
  assert.equal(result.spotAlignment.label, 'Spot đồng thuận bán');
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
  assert.equal(result.spotAlignment.label, 'Spot phân kỳ mua');
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

test('identifies spot confluence sell during Long Exit when both Futures and Spot CVD are negative', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: -1.79,
    cvdRatioPct: -4.47,
    oiChangePct: -0.23,
    spotCvdRatioPct: -1.85,
    spotNetDelta: -31_510_000,
  });
  assert.equal(result.state, 'CAPITAL_OUT_LONG_EXIT');
  assert.equal(result.spotAlignment.state, 'SPOT_CONFLUENCE');
  assert.equal(result.spotAlignment.label, 'Spot đồng thuận bán');
  assert.equal(result.spotAlignment.tone, 'bearish');
});

test('identifies spot divergence buy during Long Exit when Spot is buying against Futures selling', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: -1.79,
    cvdRatioPct: -4.47,
    oiChangePct: -0.23,
    spotCvdRatioPct: 1.5,
    spotNetDelta: 30_000_000,
  });
  assert.equal(result.state, 'CAPITAL_OUT_LONG_EXIT');
  assert.equal(result.spotAlignment.state, 'SPOT_DIVERGENCE');
  assert.equal(result.spotAlignment.label, 'Spot phân kỳ mua');
  assert.equal(result.spotAlignment.tone, 'warning');
});

test('identifies spot confluence buy during Short Covering when both Futures and Spot CVD are positive', () => {
  const result = classifyCapitalFlow({
    ...complete,
    priceChangePct: 1.5,
    cvdRatioPct: 2.3,
    oiChangePct: -0.8,
    spotCvdRatioPct: 1.2,
    spotNetDelta: 25_000_000,
  });
  assert.equal(result.state, 'CAPITAL_OUT_SHORT_COVER');
  assert.equal(result.spotAlignment.state, 'SPOT_CONFLUENCE');
  assert.equal(result.spotAlignment.label, 'Spot đồng thuận mua');
  assert.equal(result.spotAlignment.tone, 'bullish');
});

test('detects sell absorption when aggressive selling is strong but price stays flat with OI expanding', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -0.05, cvdRatioPct: -2.4, oiChangePct: 1.8 });
  assert.equal(result.state, 'SELL_ABSORPTION_WITH_OI_IN');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Hấp thụ lực bán');
  assert.equal(result.mechanism, 'SELL_ABSORPTION');
});

test('detects sell absorption when aggressive selling is strong and price stays flat while OI contracts', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 0.04, cvdRatioPct: -2.2, oiChangePct: -1.5 });
  assert.equal(result.state, 'SELL_ABSORPTION_WITH_OI_OUT');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Hấp thụ lực bán');
});

test('detects rotation sell absorption when strong selling meets flat price and flat OI', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -0.02, cvdRatioPct: -2.0, oiChangePct: 0.05 });
  assert.equal(result.state, 'FLOW_ROTATION_SELL_ABSORPTION');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Luân chuyển · Hấp thụ bán');
  assert.equal(result.mechanism, 'SELL_ABSORPTION');
  assert.equal(result.tone, 'constructive');
});

test('detects rotation buy absorption when strong buying meets flat price and flat OI', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 0.02, cvdRatioPct: 2.0, oiChangePct: -0.05 });
  assert.equal(result.state, 'FLOW_ROTATION_BUY_ABSORPTION');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Luân chuyển · Hấp thụ mua');
  assert.equal(result.mechanism, 'BUY_ABSORPTION');
  assert.equal(result.tone, 'warning');
});

test('detects bullish and bearish rotation turnover when price and CVD align with flat OI', () => {
  const bullish = classifyCapitalFlow({ ...complete, priceChangePct: 2.5, cvdRatioPct: 1.8, oiChangePct: 0.05 });
  assert.equal(bullish.state, 'FLOW_ROTATION_BULLISH');
  assert.equal(bullish.actionBadge, 'ROTATION');
  assert.equal(bullish.label, 'Luân chuyển tăng');
  assert.equal(bullish.tone, 'constructive');

  const bearish = classifyCapitalFlow({ ...complete, priceChangePct: -2.5, cvdRatioPct: -1.8, oiChangePct: -0.05 });
  assert.equal(bearish.state, 'FLOW_ROTATION_BEARISH');
  assert.equal(bearish.actionBadge, 'ROTATION');
  assert.equal(bearish.label, 'Luân chuyển giảm');
  assert.equal(bearish.tone, 'bearish');
});

test('applies wider deadbands for 7D and 30D horizons', () => {
  const d7 = classifyCapitalFlow({ ...complete, horizon: '7D', priceChangePct: 0.35, cvdRatioPct: 0.5, oiChangePct: 0.35 });
  assert.equal(d7.horizon, '7D');
  assert.equal(d7.priceDirection, 'flat');
  assert.equal(d7.oiDirection, 'flat');
  assert.equal(d7.state, 'NO_MATERIAL_FLOW_CHANGE');

  const d30 = classifyCapitalFlow({ ...complete, horizon: '30D', priceChangePct: 0.8, cvdRatioPct: 0.5, oiChangePct: 0.8 });
  assert.equal(d30.horizon, '30D');
  assert.equal(d30.priceDirection, 'flat');
  assert.equal(d30.oiDirection, 'flat');
  assert.equal(d30.state, 'NO_MATERIAL_FLOW_CHANGE');
});

test('detects sell absorption when OI contracts but price rises against aggressive selling (LOGIC-001)', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: 0.45, cvdRatioPct: -2.5, oiChangePct: -1.8 });
  assert.equal(result.state, 'SELL_ABSORPTION_WITH_OI_OUT');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Hấp thụ lực bán');
  assert.equal(result.mechanism, 'SELL_ABSORPTION');
  assert.equal(result.tone, 'constructive');
});

test('detects buy absorption when OI contracts but price falls against aggressive buying (LOGIC-001)', () => {
  const result = classifyCapitalFlow({ ...complete, priceChangePct: -0.45, cvdRatioPct: 2.5, oiChangePct: -1.8 });
  assert.equal(result.state, 'BUY_ABSORPTION_WITH_OI_OUT');
  assert.equal(result.actionBadge, 'ABSORPTION');
  assert.equal(result.label, 'Hấp thụ lực mua');
  assert.equal(result.mechanism, 'BUY_ABSORPTION');
  assert.equal(result.tone, 'warning');
});

test('exposes directional field on spotAlignment and coveragePct on quality (LOGIC-003, LOGIC-005)', () => {
  const divSell = classifyCapitalFlow({
    ...complete,
    coveragePct: 85,
    priceChangePct: 1.2,
    cvdRatioPct: 2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: -1.5,
    spotNetDelta: -50_000_000,
  });
  assert.equal(divSell.spotAlignment.state, 'SPOT_DIVERGENCE');
  assert.equal(divSell.spotAlignment.direction, 'SELL');
  assert.equal(divSell.quality.coveragePct, 85);

  const divBuy = classifyCapitalFlow({
    ...complete,
    coveragePct: 60,
    priceChangePct: -1.2,
    cvdRatioPct: -2.1,
    oiChangePct: 3.4,
    spotCvdRatioPct: 1.5,
    spotNetDelta: 50_000_000,
  });
  assert.equal(divBuy.spotAlignment.state, 'SPOT_DIVERGENCE');
  assert.equal(divBuy.spotAlignment.direction, 'BUY');
  assert.equal(divBuy.quality.level, 'DEGRADED');
  assert.equal(divBuy.quality.coveragePct, 60);
});

