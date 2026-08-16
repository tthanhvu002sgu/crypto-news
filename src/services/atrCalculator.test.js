import test from 'node:test';
import assert from 'node:assert/strict';
import { __resetATRForTests, calculateWilderATR, getATR, getATRState } from './atrCalculator.js';

function kline(index, high, low, close, closeTime) {
  return [index, String(close), String(high), String(low), String(close), '0', closeTime];
}

test('ATR excludes the currently-forming Futures candle', () => {
  const now = 1_000_000;
  const closed = Array.from({ length: 20 }, (_, index) => kline(index, 102 + index, 100 + index, 101 + index, now - (20 - index) * 1000));
  const baseline = calculateWilderATR(closed, 14, now);
  const withOpenSpike = calculateWilderATR([...closed, kline(21, 10_000, 1, 5_000, now + 10_000)], 14, now);
  assert.equal(withOpenSpike.value, baseline.value);
  assert.equal(withOpenSpike.lastClosedCandleTime, baseline.lastClosedCandleTime);
});

test('ATR fetch uses Binance USD-M Futures and exposes source/freshness metadata', async () => {
  __resetATRForTests();
  const now = 2_000_000;
  const rows = Array.from({ length: 30 }, (_, index) => kline(index, 102 + index, 100 + index, 101 + index, now - (30 - index) * 1000));
  let requestedUrl = '';
  const value = await getATR('BTCUSDT', '5m', 14, {
    now,
    force: true,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => rows };
    },
  });
  assert.ok(requestedUrl.startsWith('https://fapi.binance.com/fapi/v1/klines'));
  assert.ok(value > 0);
  assert.equal(getATRState(now).source, 'BINANCE_FUTURES');
  assert.equal(getATRState(now).status, 'LIVE');
});

test('ATR returns unavailable instead of a fabricated fallback when fetch fails', async () => {
  __resetATRForTests();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const value = await getATR('BTCUSDT', '5m', 14, {
      force: true,
      fetchImpl: async () => { throw new Error('offline'); },
    });
    assert.equal(value, null);
    assert.equal(getATRState().status, 'UNAVAILABLE');
  } finally {
    console.warn = originalWarn;
  }
});
