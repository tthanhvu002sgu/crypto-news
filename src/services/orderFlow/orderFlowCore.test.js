import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTradeToAggregates, buildAggregateSeries, buildCustomAggregateSeries, buildFootprintNodes } from './orderFlowAggregator.js';
import { createNormalizedTrade } from './normalizedTrade.js';
import { detectPriceCvdDivergences, detectSpotFuturesDivergence } from './divergenceDetector.js';
import { TradeStreamEngine } from './tradeStreamEngine.js';
import { recoverRecentTrades } from './tradeGapRecovery.js';

const makeTrade = (id, side, timestamp, price = 100, qty = 1, market = 'spot', venue = 'binance') => createNormalizedTrade({ venue, market, instrument: 'BTC', tradeId: id, timestamp, price, baseQuantity: qty, aggressorSide: side });

test('footprint delta conserves the same executed-trade delta as CVD', () => {
  const buckets = new Map();
  const footprints = new Map();
  const start = 1_800_000_000_000;
  [makeTrade('1', 'buy', start, 101, 2), makeTrade('2', 'sell', start + 1, 99, 1)].forEach((trade) => applyTradeToAggregates(trade, buckets, footprints));
  const series = buildAggregateSeries([...buckets.values()], 'spot', '1H', start + 60_000);
  const nodes = buildFootprintNodes([...footprints.values()], 'spot', '1H', 10, start + 60_000);
  assert.equal(series.windowNetDelta, nodes.reduce((sum, node) => sum + node.buy - node.sell, 0));
});

test('aggregate series preserves per-venue contribution', () => {
  const buckets = new Map();
  const footprints = new Map();
  const start = 1_800_000_000_000;
  applyTradeToAggregates(makeTrade('1', 'buy', start, 100, 1, 'spot', 'binance'), buckets, footprints);
  applyTradeToAggregates(makeTrade('2', 'sell', start, 100, 0.5, 'spot', 'coinbase'), buckets, footprints);
  const point = buildAggregateSeries([...buckets.values()], 'spot', '1H', start + 60_000).points[0];
  assert.equal(point.venues.binance.delta, 100);
  assert.equal(point.venues.coinbase.delta, -50);
});

test('custom divergence series emits only closed 5m buckets', () => {
  const buckets = new Map();
  const footprints = new Map();
  const start = 1_800_000_000_000;
  applyTradeToAggregates(makeTrade('closed', 'buy', start + 60_000, 100), buckets, footprints);
  applyTradeToAggregates(makeTrade('open', 'sell', start + (6 * 60_000), 101), buckets, footprints);
  const points = buildCustomAggregateSeries([...buckets.values()], 'spot', 5 * 60_000, 12, start + (7 * 60_000));
  assert.equal(points.length, 1);
  assert.equal(points[0].isClosed, true);
  assert.equal(points[0].delta, 100);
});

test('price/CVD divergence is emitted only after right-hand pivot confirmation', () => {
  const prices = [100, 101, 103, 101, 100, 102, 105, 102, 101, 100, 99];
  const cvds = [0, 10, 30, 20, 15, 18, 20, 16, 12, 8, 5];
  const series = prices.map((price, index) => ({ time: index * 60_000, price, cvd: cvds[index] }));
  const [event] = detectPriceCvdDivergences(series, { minPricePct: 0.01, minCvdPct: 0.1 });
  assert.ok(event);
  assert.ok(event.confirmedAt > event.pivotTime);
});

test('spot/futures divergence requires opposite normalized flow', () => {
  const event = detectSpotFuturesDivergence(
    [{ time: 1, delta: 20, buyVol: 60, sellVol: 40 }],
    [{ time: 1, delta: -30, buyVol: 35, sellVol: 65 }],
  );
  assert.equal(event.type, 'spot_buy_futures_sell');
});

test('stream engine applies overlapping live/backfill trade exactly once', () => {
  const store = { persist: async () => {} };
  const engine = new TradeStreamEngine({ store, webSocketFactory: () => null });
  const stream = { key: 'binance:spot', venue: 'binance', market: 'spot' };
  const trade = makeTrade('same', 'buy', 1_800_000_000_000, 100, 1);
  assert.equal(engine.acceptTrade(stream, trade), true);
  assert.equal(engine.acceptTrade(stream, { ...trade, source: 'backfill' }), false);
  assert.equal([...engine.bucketMap.values()][0].tradeCount, 1);
});

test('persistence flush does not clear a bucket dirtied again while the transaction is in flight', async () => {
  let release;
  const store = { persist: () => new Promise((resolve) => { release = resolve; }) };
  const engine = new TradeStreamEngine({ store, webSocketFactory: () => null });
  const stream = { key: 'binance:spot', venue: 'binance', market: 'spot' };
  const start = 1_800_000_000_000;
  engine.acceptTrade(stream, makeTrade('first', 'buy', start));
  const flushing = engine.flush();
  engine.acceptTrade(stream, makeTrade('second', 'sell', start + 1));
  release();
  await flushing;
  assert.equal(engine.dirtyBuckets.size, 1);
});

test('bias snapshot only marks a multi-exchange CVD window ready after coverage, active streams and freshness pass', () => {
  const engine = new TradeStreamEngine({ store: { persist: async () => {} }, webSocketFactory: () => null });
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  for (const market of ['spot', 'futures']) {
    for (let index = 0; index < 1008; index += 1) {
      const timestamp = end - ((1007 - index) * 60_000);
      engine.bucketMap.set(`${market}:${timestamp}`, {
        id: `${market}:${timestamp}`, market, timestamp,
        buyVol: 100, sellVol: 0, delta: 100, totalVol: 100, tradeCount: 1,
        open: 100, high: 100, low: 100, close: 100, venues: {}, updatedAt: timestamp,
      });
    }
  }
  for (const [key, health] of engine.health.entries()) {
    engine.health.set(key, { ...health, status: 'live', coverage: 100 });
  }
  const snapshot = engine.getBiasSnapshot();
  assert.equal(snapshot.spot['24H'].isBiasReady, true);
  assert.equal(snapshot.futures['24H'].isBiasReady, true);
  assert.equal(snapshot.isReady, true);
  assert.equal(snapshot.spot['7D'].isBiasReady, false);
});

test('Binance gap recovery paginates beyond the first 1000 trades', async () => {
  const originalFetch = globalThis.fetch;
  const requestedFromIds = [];
  globalThis.fetch = async (url) => {
    const fromId = Number(new URL(url).searchParams.get('fromId'));
    requestedFromIds.push(fromId);
    const count = fromId === 100 ? 1000 : 1;
    return {
      ok: true,
      json: async () => Array.from({ length: count }, (_, index) => ({
        a: fromId + index, T: 1_800_000_000_000 + fromId + index,
        p: '100', q: '1', m: false, s: 'BTCUSDT',
      })),
    };
  };
  try {
    const result = await recoverRecentTrades(
      { venue: 'binance', market: 'spot', instrument: 'BTCUSDT' },
      { tradeId: '99', timestamp: 1_800_000_000_000 },
    );
    assert.deepEqual(requestedFromIds, [100, 1100]);
    assert.equal(result.trades.length, 1001);
    assert.equal(result.bounded, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
