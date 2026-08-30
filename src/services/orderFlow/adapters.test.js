import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceTrade } from './adapters/binanceAdapter.js';
import { parseBybitTrades } from './adapters/bybitAdapter.js';
import { parseOkxTrades } from './adapters/okxAdapter.js';
import { parseCoinbaseTrades } from './adapters/coinbaseAdapter.js';

test('Binance buyer-maker flag is inverted into aggressor side', () => {
  assert.equal(parseBinanceTrade({ a: 1, T: 10, p: '100', q: '2', m: true }).aggressorSide, 'sell');
  assert.equal(parseBinanceTrade({ a: 2, T: 11, p: '100', q: '2', m: false }).aggressorSide, 'buy');
});

test('Bybit exposes taker side directly', () => {
  const [trade] = parseBybitTrades({ data: [{ i: 'a', T: 10, p: '100', v: '2', S: 'Buy', s: 'BTCUSDT', seq: 5 }] });
  assert.equal(trade.aggressorSide, 'buy');
  assert.equal(trade.quoteNotionalUsdEq, 200);
});

test('OKX swap contract size converts contracts into BTC quantity', () => {
  const [trade] = parseOkxTrades({ data: [{ tradeId: 'a', ts: 10, px: '50000', sz: '3', side: 'sell', instId: 'BTC-USDT-SWAP' }] }, { market: 'futures', contractMeta: { instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctValCcy: 'BTC' } });
  assert.equal(trade.baseQuantity, 0.03);
  assert.equal(trade.quoteNotionalUsdEq, 1500);
});

test('Coinbase maker side is inverted into aggressor side', () => {
  const [trade] = parseCoinbaseTrades({ sequence_num: 4, events: [{ trades: [{ trade_id: 'c', product_id: 'BTC-USD', price: '100', size: '2', side: 'BUY', time: '2026-08-30T00:00:00Z' }] }] });
  assert.equal(trade.aggressorSide, 'sell');
});
