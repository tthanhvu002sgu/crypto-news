import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateKlineFlowStats, scoreCoinBuy, scoreCoinSell } from './coinScanner.js';

function kline(quoteVolume, takerBuyQuote) {
  const row = new Array(11).fill(0);
  row[7] = String(quoteVolume);
  row[10] = String(takerBuyQuote);
  return row;
}

function strongCoin(overrides = {}) {
  return {
    symbol: 'SOLUSDT',
    vol30d: 2_000_000_000,
    marketCap: 50_000_000_000,
    volCV: 0.5,
    spreadPct: 0.02,
    dataCoverage: 1,
    strengthPercentile: 95,
    relativeStrength4h: 2,
    relativeStrength24h: 5,
    futuresCvdRatio24h: 5,
    spotCvdRatio24h: 3,
    cvdTrendRatio: 1,
    ema21: 110,
    ema55: 100,
    emaSlopePct: 1,
    isDailyUptrend: true,
    breakoutAtr: 0.5,
    breakdownAtr: -1,
    volumeZ1h: 2.5,
    oiChange4h: 3,
    return4h: 2,
    fundingRate: 0.005,
    basisPct: 0.02,
    rsi14: 55,
    currentPrice: 111,
    ...overrides,
  };
}

test('flow stats use exactly the requested 24 closed candles', () => {
  const klines = [
    ...Array.from({ length: 24 }, () => kline(100, 25)),
    ...Array.from({ length: 24 }, () => kline(100, 75)),
  ];
  const current = calculateKlineFlowStats(klines, 24);
  const previous = calculateKlineFlowStats(klines, 24, 24);
  assert.equal(current.quoteVolume, 2400);
  assert.equal(current.takerBuyRatio, 75);
  assert.equal(current.cvdRatio, 0.5);
  assert.equal(previous.takerBuyRatio, 25);
  assert.equal(previous.cvdRatio, -0.5);
});

test('missing Daily trend is neutral, not bearish', () => {
  const lowEnoughToAvoidStrengthCap = { strengthPercentile: 60, breakoutAtr: -1 };
  const unknownDailyBuy = scoreCoinBuy(strongCoin({ ...lowEnoughToAvoidStrengthCap, isDailyUptrend: null }));
  const bearishDailyBuy = scoreCoinBuy(strongCoin({ ...lowEnoughToAvoidStrengthCap, isDailyUptrend: false }));
  const bullishDailyBuy = scoreCoinBuy(strongCoin({ ...lowEnoughToAvoidStrengthCap, isDailyUptrend: true }));
  assert.equal(unknownDailyBuy.score, bearishDailyBuy.score);
  assert.equal(bullishDailyBuy.score, unknownDailyBuy.score + 1);

  const unknownDailySell = scoreCoinSell(strongCoin({ ...lowEnoughToAvoidStrengthCap, isDailyUptrend: null }));
  const bullishDailySell = scoreCoinSell(strongCoin({ ...lowEnoughToAvoidStrengthCap, isDailyUptrend: true }));
  assert.equal(unknownDailySell.score, bullishDailySell.score);
});

test('confirmed strength produces a clear directional edge', () => {
  const coin = strongCoin();
  const buy = scoreCoinBuy(coin, { isBtcBullish: true, isEtfInflow: true });
  const sell = scoreCoinSell(coin, { isBtcBullish: true, isEtfInflow: true });
  assert.ok(buy.score >= 18);
  assert.ok(buy.score - sell.score >= 3);
  assert.equal(buy.qualityScore, 5);
  assert.ok(buy.strengthScore > buy.entryScore);
});

test('unknown macro data awards neither direction', () => {
  const coin = strongCoin();
  const unknown = scoreCoinBuy(coin, { isBtcBullish: null, isEtfInflow: null });
  const supportive = scoreCoinBuy(coin, { isBtcBullish: true, isEtfInflow: true });
  assert.equal(unknown.macroScore, 0);
  assert.equal(supportive.macroScore, 2);
  assert.equal(supportive.score, unknown.score + 2);
});
