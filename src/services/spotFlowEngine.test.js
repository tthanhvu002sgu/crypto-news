import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCoinbasePremium,
  calculateSpotFuturesVolumeRatio,
  selectAlignedSpotFuturesVolumes,
  parseBinanceAggTrades,
  parseBybitRecentTrades,
  parseOkxTrades,
  parseCoinbaseTrades,
  summarizeTradeBatch,
  createMultiExchangeSessionStore,
  mergeTradesIntoSessionStore,
  buildMultiExchangeCvdComparison,
  classifyOrderBookComparison,
  aggregateOrderBookSnapshots,
} from './spotFlowEngine.js';

test('calculateCoinbasePremium computes USD and percentage premium and classifies regimes', () => {
  const strong = calculateCoinbasePremium({
    coinbasePrice: 100080,
    binanceSpotPrice: 100000,
    binanceFuturesPrice: 100020,
  });
  assert.equal(strong.regime, 'STRONG_PREMIUM');
  assert.equal(strong.tone, 'bullish');
  assert.ok(Math.abs(strong.premiumUsd - 80) < 1e-6);
  assert.ok(Math.abs(strong.premiumPct - 0.08) < 1e-6);
  assert.ok(Math.abs(strong.cbVsFuturesUsd - 60) < 1e-6);

  const discount = calculateCoinbasePremium({
    coinbasePrice: 99920,
    binanceSpotPrice: 100000,
  });
  assert.equal(discount.regime, 'STRONG_DISCOUNT');
  assert.equal(discount.tone, 'bearish');

  const missing = calculateCoinbasePremium({ coinbasePrice: null, binanceSpotPrice: 100000 });
  assert.equal(missing.regime, 'UNAVAILABLE');
  assert.equal(missing.premiumPct, null);
});

test('calculateSpotFuturesVolumeRatio computes share %, ratio and regime', () => {
  const spotHeavy = calculateSpotFuturesVolumeRatio({
    spotQuoteVol: 4_000_000_000,
    futuresQuoteVol: 6_000_000_000,
  });
  assert.equal(spotHeavy.regime, 'SPOT_HEAVY');
  assert.equal(spotHeavy.tone, 'bullish');
  assert.ok(Math.abs(spotHeavy.spotSharePct - 40) < 1e-6);
  assert.ok(Math.abs(spotHeavy.futuresSharePct - 60) < 1e-6);
  assert.ok(Math.abs(spotHeavy.spotToFuturesRatio - (4 / 6)) < 1e-6);

  const futuresDom = calculateSpotFuturesVolumeRatio({
    spotQuoteVol: 1_000_000_000,
    futuresQuoteVol: 9_000_000_000,
  });
  assert.equal(futuresDom.regime, 'FUTURES_DOMINANT');
  assert.equal(futuresDom.tone, 'warning');
  assert.ok(Math.abs(futuresDom.spotSharePct - 10) < 1e-6);

  const invalid = calculateSpotFuturesVolumeRatio({ spotQuoteVol: 0, futuresQuoteVol: 0 });
  assert.equal(invalid.regime, 'UNAVAILABLE');
});

test('trade parsers normalize Binance, Bybit, OKX (with contract scale) and Coinbase (maker inversion)', () => {
  const bn = parseBinanceAggTrades([
    { a: 1, p: '100000', q: '0.5', T: 1000, m: false }, // taker buy
    { a: 2, p: '100000', q: '0.2', T: 2000, m: true },  // taker sell
  ], 'spot');
  assert.equal(bn[0].side, 'buy');
  assert.equal(bn[0].usdVol, 50000);
  assert.equal(bn[1].side, 'sell');
  assert.equal(bn[1].usdVol, 20000);

  const byb = parseBybitRecentTrades({
    result: { list: [{ execId: 'e1', price: '100000', size: '0.3', side: 'Buy', time: '1500' }] },
  }, 'linear');
  assert.equal(byb.length, 1);
  assert.equal(byb[0].side, 'buy');
  assert.equal(byb[0].usdVol, 30000);

  // OKX SWAP: 10 contracts * 0.01 BTC/contract = 0.1 BTC @ 100,000 = $10,000
  const okx = parseOkxTrades({
    data: [{ tradeId: 't1', px: '100000', sz: '10', side: 'sell', ts: '1600' }],
  }, 'futures', 0.01);
  assert.equal(okx.length, 1);
  assert.equal(okx[0].qty, 0.1);
  assert.equal(okx[0].usdVol, 10000);
  assert.equal(okx[0].side, 'sell');

  // Coinbase: maker side === 'sell' means resting ask was hit -> TAKER BUY
  const cb = parseCoinbaseTrades([
    { trade_id: 101, price: '100100', size: '0.5', side: 'sell', time: '2026-11-14T00:00:00Z' },
    { trade_id: 102, price: '100050', size: '0.1', side: 'buy', time: '2026-11-14T00:00:01Z' },
  ]);
  assert.equal(cb[0].side, 'buy');
  assert.equal(cb[1].side, 'sell');
});

test('mergeTradesIntoSessionStore deduplicates repeated polls and accumulates cleanly', () => {
  const store = createMultiExchangeSessionStore();
  const batch1 = parseBinanceAggTrades([
    { a: 1, p: '100000', q: '1', T: 1000, m: false },
    { a: 2, p: '100000', q: '0.5', T: 2000, m: true },
  ], 'spot');
  mergeTradesIntoSessionStore(store, 'spot:BINANCE', batch1);

  // Overlapping batch with trade a:2 repeated and a:3 new
  const batch2 = parseBinanceAggTrades([
    { a: 2, p: '100000', q: '0.5', T: 2000, m: true },
    { a: 3, p: '100000', q: '0.5', T: 3000, m: false },
  ], 'spot');
  const summary = mergeTradesIntoSessionStore(store, 'spot:BINANCE', batch2);

  assert.equal(summary.tradeCount, 3);
  assert.equal(summary.buyVolUsd, 150000);
  assert.equal(summary.sellVolUsd, 50000);
  assert.equal(summary.netDeltaUsd, 100000);
  assert.equal(summary.spanSec, 2);
});

test('buildMultiExchangeCvdComparison aligns Spot vs Futures across exchanges', () => {
  const spotBin = summarizeTradeBatch(parseBinanceAggTrades([
    { a: 1, p: '100000', q: '2', T: 1000, m: false },
    { a: 2, p: '100000', q: '0.5', T: 2000, m: true },
  ], 'spot'));
  const spotCb = summarizeTradeBatch(parseCoinbaseTrades([
    { trade_id: 1, price: '100050', size: '1', side: 'sell', time: 1500 },
  ]));
  const futBin = summarizeTradeBatch(parseBinanceAggTrades([
    { a: 10, p: '100000', q: '0.4', T: 1000, m: false },
    { a: 11, p: '100000', q: '2.0', T: 2000, m: true },
  ], 'futures'));

  const cmp = buildMultiExchangeCvdComparison({
    spotVenues: { BINANCE: spotBin, COINBASE: spotCb },
    futuresVenues: { BINANCE: futBin },
  });

  assert.equal(cmp.spotTotal.activeVenues, 2);
  assert.equal(cmp.futuresTotal.activeVenues, 1);
  assert.ok(cmp.spotTotal.netDeltaUsd > 0);
  assert.ok(cmp.futuresTotal.netDeltaUsd < 0);
  assert.equal(cmp.alignment.state, 'SPOT_ABSORPTION');
  assert.equal(cmp.alignment.tone, 'constructive');
});

test('classifyOrderBookComparison detects Spot vs Futures divergence and confluence', () => {
  assert.equal(
    classifyOrderBookComparison({ obiPercent: -22 }, { obiPercent: 18 }).state,
    'SPOT_BID_SUPPORT'
  );
  assert.equal(
    classifyOrderBookComparison({ obiPercent: 25 }, { obiPercent: -15 }).state,
    'FUTURES_BID_SPOOF_RISK'
  );
  assert.equal(
    classifyOrderBookComparison({ obiPercent: 16 }, { obiPercent: 21 }).state,
    'CONFLUENCE_BID'
  );
});

test('LOGIC-001: mergeTradesIntoSessionStore preserves summary fields on empty polls and hides internal sets', () => {
  const store = createMultiExchangeSessionStore();
  const emptyInitial = mergeTradesIntoSessionStore(store, 'spot:BYBIT', []);
  assert.equal(emptyInitial.status, 'ERROR');
  assert.equal(emptyInitial.deltaRatioPct, null);
  assert.equal(emptyInitial.spanSec, 0);
  assert.equal('seenSet' in emptyInitial, false);

  const batch1 = parseBinanceAggTrades([
    { a: 1, p: '100', q: '2', T: 1_700_000_000_000, m: false },
    { a: 2, p: '100', q: '1', T: 1_700_000_060_000, m: true },
  ], 'spot');
  mergeTradesIntoSessionStore(store, 'spot:BINANCE', batch1);

  const afterEmptyPoll = mergeTradesIntoSessionStore(store, 'spot:BINANCE', []);
  assert.equal(afterEmptyPoll.status, 'OK');
  assert.equal(afterEmptyPoll.tradeCount, 2);
  assert.equal(afterEmptyPoll.spanSec, 60);
  assert.ok(Math.abs(afterEmptyPoll.deltaRatioPct - (100 / 3)) < 1e-6);
  assert.equal('seenSet' in afterEmptyPoll, false);
  assert.equal('seenOrder' in afterEmptyPoll, false);

  const afterNullPoll = mergeTradesIntoSessionStore(store, 'spot:BINANCE', null);
  assert.equal(afterNullPoll.spanSec, 60);
  assert.ok(Math.abs(afterNullPoll.deltaRatioPct - (100 / 3)) < 1e-6);
});

test('LOGIC-002: aggregateOrderBookSnapshots avoids 60000 fallback when primary fails and caps book levels by limit', () => {
  const sources = [
    { tag: 'BIN', scale: 1, isPrimary: true },
    { tag: 'BYB', scale: 1 },
    { tag: 'COIN', scale: 1 },
  ];
  const results = [
    { bids: [], asks: [] }, // primary Binance down
    {
      bids: [['3000', '10'], ['2999', '5'], ['2998', '999']],
      asks: [['3002', '5'], ['3003', '5'], ['3004', '999']],
    },
    {
      bids: [['3001', '5'], ['3000', '5'], ['2999', '999']],
      asks: [['3002', '5'], ['3003', '5'], ['3004', '999']],
    },
  ];

  // limit = 2 must exclude level-3 whale rows (qty 999) and compute midPrice ~3001 from Bybit
  const res = aggregateOrderBookSnapshots({ results, sources, market: 'spot', limit: 2 });
  assert.ok(res);
  assert.equal(res.bestBid, 3000);
  assert.equal(res.bestAsk, 3002);
  assert.ok(res.spread > 0 && res.spread < 0.1);
  assert.equal(res.bidVolBtc, 25);
  assert.equal(res.askVolBtc, 20);
  assert.equal(res.bidVolUsd, Math.round(25 * 3001));
  assert.equal(res.askVolUsd, Math.round(20 * 3001));

  const allDown = aggregateOrderBookSnapshots({
    results: [{ bids: [], asks: [] }, { bids: [], asks: [] }, { bids: [], asks: [] }],
    sources,
    market: 'spot',
    limit: 2,
  });
  assert.equal(allDown, null);
});

test('LOGIC-005: selectAlignedSpotFuturesVolumes rejects mixed 24H vs short-session horizons', () => {
  const mismatched = selectAlignedSpotFuturesVolumes({
    hasFuturesHistory: true,
    futuresHistoryVol: 10_000_000_000,
    futuresSessionVol: 5_000_000,
    hasSpotHistory: false,
    spotHistoryVol: 0,
    spotSessionVol: 1_000_000,
  });
  assert.equal(mismatched.aligned, false);
  assert.equal(mismatched.horizon, 'MISMATCH');
  assert.equal(calculateSpotFuturesVolumeRatio(mismatched).regime, 'UNAVAILABLE');

  const aligned24h = selectAlignedSpotFuturesVolumes({
    hasFuturesHistory: true,
    futuresHistoryVol: 7_000_000_000,
    futuresSessionVol: 0,
    hasSpotHistory: true,
    spotHistoryVol: 3_000_000_000,
    spotSessionVol: 0,
  });
  assert.equal(aligned24h.aligned, true);
  assert.equal(aligned24h.horizon, '24H');
  assert.ok(Math.abs(calculateSpotFuturesVolumeRatio(aligned24h).spotSharePct - 30) < 1e-6);

  const alignedSession = selectAlignedSpotFuturesVolumes({
    hasFuturesHistory: false,
    futuresHistoryVol: 0,
    futuresSessionVol: 6_000_000,
    hasSpotHistory: false,
    spotHistoryVol: 0,
    spotSessionVol: 4_000_000,
  });
  assert.equal(alignedSession.aligned, true);
  assert.equal(alignedSession.horizon, 'SESSION');
  assert.ok(Math.abs(calculateSpotFuturesVolumeRatio(alignedSession).spotSharePct - 40) < 1e-6);
});
