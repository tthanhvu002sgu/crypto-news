import axios from 'axios';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runFullScan,
  calculateKlineFlowStats,
  scoreCoinBuy,
  scoreCoinSell,
  passesQualityGate,
  detectPriceActionContext,
  evaluateShortlistUtility,
  alignSeriesByTimestamp,
  getTop30dVolumePairs,
} from './coinScanner.js';

function kline(quoteVolume, takerBuyQuote) {
  const row = new Array(11).fill(0);
  row[7] = String(quoteVolume);
  row[10] = String(takerBuyQuote);
  return row;
}

function strongBullishCoin(overrides = {}) {
  return {
    symbol: 'SOLUSDT',
    hasFutures: true,
    vol30d: 2_000_000_000,
    marketCap: 50_000_000_000,
    volCV: 0.5,
    spreadPct: 0.02,
    dataCoverage: 1.0,
    strengthPercentile: 95,
    relativeStrength1h: 0.8,
    relativeStrength4h: 2.0,
    relativeStrength24h: 5.0,
    futuresCvdRatio24h: 5.0,
    spotCvdRatio24h: 3.0,
    cvdTrendRatio: 1.0,
    ema21: 110,
    ema55: 100,
    emaSlopePct: 1.0,
    isDailyUptrend: true,
    breakoutAtr: 0.5,
    breakdownAtr: -1.0,
    volumeZ1h: 2.0,
    oiChange4h: 3.0,
    return4h: 2.0,
    fundingRate: 0.005,
    basisPct: 0.02,
    rsi14: 55,
    currentPrice: 111,
    ...overrides,
  };
}

function strongBearishCoin(overrides = {}) {
  return {
    symbol: 'BEARUSDT',
    hasFutures: true,
    vol30d: 2_000_000_000,
    marketCap: 50_000_000_000,
    volCV: 0.5,
    spreadPct: 0.02,
    dataCoverage: 1.0,
    strengthPercentile: 5, // bottom 5% -> top 5% for sell
    relativeStrength1h: -0.8,
    relativeStrength4h: -2.0,
    relativeStrength24h: -5.0,
    futuresCvdRatio24h: -5.0,
    spotCvdRatio24h: -3.0,
    cvdTrendRatio: -1.0,
    ema21: 90,
    ema55: 100,
    emaSlopePct: -1.0,
    isDailyUptrend: false,
    breakoutAtr: -1.0,
    breakdownAtr: 0.5,
    volumeZ1h: 2.0,
    oiChange4h: 3.0,
    return4h: -2.0,
    fundingRate: -0.005,
    basisPct: -0.02,
    rsi14: 45,
    currentPrice: 89,
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

test('4-pillar scoring assigns expected bounds and directional edge', () => {
  const coin = strongBullishCoin();
  const buy = scoreCoinBuy(coin, { isBtcBullish: true, isEtfInflow: true });
  const sell = scoreCoinSell(coin, { isBtcBullish: true, isEtfInflow: true });

  assert.ok(buy.score >= 18, `Expected high priority score >= 18, got ${buy.score}`);
  assert.ok(buy.score - sell.score >= 5, `Expected directional edge >= 5, got ${buy.score - sell.score}`);
  assert.equal(buy.status, 'ƯU TIÊN CAO');
  assert.equal(buy.qualityScore, 5.0);
  assert.ok(buy.strengthScore <= 8.0);
  assert.ok(buy.flowScore <= 6.0);
  assert.ok(buy.contextScore <= 6.0);
  assert.ok(Array.isArray(buy.positiveReasons));
  assert.ok(buy.positiveReasons.length <= 3);
  assert.ok(buy.positiveReasons.length >= 1);
});

test('BUY and SELL scoring logic is strictly symmetric', () => {
  const bullCoin = strongBullishCoin();
  const bearCoin = strongBearishCoin();

  const bullBuy = scoreCoinBuy(bullCoin, { isBtcBullish: true, isEtfInflow: true });
  const bearSell = scoreCoinSell(bearCoin, { isBtcBullish: false, isEtfInflow: false });

  // Perfectly mirrored market conditions must produce identical scores
  assert.equal(bullBuy.score, bearSell.score);
  assert.equal(bullBuy.qualityScore, bearSell.qualityScore);
  assert.equal(bullBuy.strengthScore, bearSell.strengthScore);
  assert.equal(bullBuy.flowScore, bearSell.flowScore);
  assert.equal(bullBuy.contextScore, bearSell.contextScore);
});

test('missing Daily trend is neutral (unknown), not bearish or bullish', () => {
  const lowEnough = { strengthPercentile: 60, breakoutAtr: -1 };
  const unknownDailyBuy = scoreCoinBuy(strongBullishCoin({ ...lowEnough, isDailyUptrend: null }));
  const bearishDailyBuy = scoreCoinBuy(strongBullishCoin({ ...lowEnough, isDailyUptrend: false }));
  const bullishDailyBuy = scoreCoinBuy(strongBullishCoin({ ...lowEnough, isDailyUptrend: true }));

  assert.equal(unknownDailyBuy.score, bearishDailyBuy.score);
  assert.equal(bullishDailyBuy.score, unknownDailyBuy.score + 1.5);
});

test('macro context awards points only when confirmed, neutral when unknown', () => {
  const coin = strongBullishCoin();
  const unknown = scoreCoinBuy(coin, { isBtcBullish: null, isEtfInflow: null });
  const supportive = scoreCoinBuy(coin, { isBtcBullish: true, isEtfInflow: true });
  const opposing = scoreCoinBuy(coin, { isBtcBullish: false, isEtfInflow: false });

  assert.equal(supportive.score, unknown.score + 1.5);
  assert.equal(opposing.score, unknown.score);
});

test('quality gate enforces market cap, spread, volCV and volume rules', () => {
  const valid = strongBullishCoin();
  assert.equal(passesQualityGate(valid), true);

  assert.equal(passesQualityGate({ ...valid, marketCap: 500_000_000 }), false);
  assert.equal(passesQualityGate({ ...valid, spreadPct: 0.20 }), false);
  assert.equal(passesQualityGate({ ...valid, volCV: 1.5 }), false);
  assert.equal(passesQualityGate({ ...valid, vol30d: 50_000_000 }), false);
  assert.equal(passesQualityGate({ ...valid, hasFutures: false }), false);
});

test('detectPriceActionContext classifies 4H structure and generates concise statement', () => {
  const paUptrend = detectPriceActionContext(
    [100, 105, 110, 115],
    [112, 113, 114, 115],
    [[0, 112, 116, 111, 115]], // spot1h
    110, 100, 1.2, // ema21, ema55, slope
    0.3, -1.0, 2.0, 1.8, // breakoutAtr, breakdownAtr, atr1h, volumeZ1h
  );

  assert.equal(paUptrend.structure4h, 'UPTREND');
  assert.equal(paUptrend.pricePosition, 'BREAKOUT');
  assert.equal(paUptrend.volatilityState, 'EXPANSION');
  assert.ok(paUptrend.statement.includes('4H uptrend'));
  assert.ok(paUptrend.statement.includes('volume mở rộng'));

  const paRange = detectPriceActionContext(
    [100, 101, 100, 101],
    [100, 100.5, 100.2, 100.4],
    [[0, 100, 101, 99.5, 100.4]],
    100.5, 100.3, 0.0,
    -0.1, -0.1, 1.0, -1.0,
  );
  assert.equal(paRange.structure4h, 'RANGE');
  assert.equal(paRange.volatilityState, 'COMPRESSION');
});

test('detects crowding warnings and overextended price', () => {
  const crowdedBuy = scoreCoinBuy(strongBullishCoin({
    fundingRate: 0.06,
    basisPct: 0.30,
    currentPrice: 130, // EMA21 is 110 -> 18% stretch
    rsi14: 78,
  }));

  const warningCodes = crowdedBuy.warnings.map(w => w.code);
  assert.ok(warningCodes.includes('CROWDED_FUNDING'));
  assert.ok(warningCodes.includes('WIDE_BASIS'));
  assert.ok(warningCodes.includes('STRETCHED_EMA'));
  assert.ok(warningCodes.includes('RSI_OVERBOUGHT'));
});

test('evaluateShortlistUtility measures Precision@5 and relative return vs BTC', () => {
  const snapshot = {
    topBuy: [
      { symbol: 'SOLUSDT', score: 20 },
      { symbol: 'AVAXUSDT', score: 19 },
      { symbol: 'NEARUSDT', score: 18 },
    ],
  };

  const forwardOutcomes = {
    btcReturn24h: 2.0,
    SOLUSDT: { return24h: 5.0 }, // rel +3.0 -> beat BTC
    AVAXUSDT: { return24h: 4.0 }, // rel +2.0 -> beat BTC
    NEARUSDT: { return24h: 1.0 }, // rel -1.0 -> lagged BTC
  };

  const utility = evaluateShortlistUtility(snapshot, forwardOutcomes);
  assert.equal(utility.evaluatedCount, 3);
  assert.equal(utility.precisionAt5, 66.7); // 2 out of 3 = 66.7%
  assert.ok(utility.avgRelReturnTop5 > 0);
});

test('[P2-4] alignSeriesByTimestamp synchronizes coin and BTC klines bar-for-bar by exact openTime', () => {
  // Coin has candles at timestamps 1000, 2000, 3000, 4000
  const coinKlines = [
    [1000, '10', '11', '9', '10.5'],
    [2000, '11', '12', '10', '11.5'],
    [3000, '12', '13', '11', '12.5'],
    [4000, '13', '14', '12', '13.5'],
  ];

  // BTC has candles at timestamps 2000, 3000, 4000, 5000 (missing 1000, extra 5000)
  const btcKlines = [
    [2000, '50000', '50500', '49500', '50200'],
    [3000, '50200', '50800', '50100', '50600'],
    [4000, '50600', '51000', '50400', '50900'],
    [5000, '50900', '51200', '50800', '51100'],
  ];

  const { coinCloses, btcCloses } = alignSeriesByTimestamp(coinKlines, btcKlines);

  // Must align only the overlapping timestamps (2000, 3000, 4000)
  assert.equal(coinCloses.length, 3);
  assert.equal(btcCloses.length, 3);

  assert.deepEqual(coinCloses, [11.5, 12.5, 13.5]);
  assert.deepEqual(btcCloses, [50200, 50600, 50900]);

  // Graceful empty / invalid handling
  assert.deepEqual(alignSeriesByTimestamp([], btcKlines), { coinCloses: [], btcCloses: [] });
  assert.deepEqual(alignSeriesByTimestamp(coinKlines, null), { coinCloses: [], btcCloses: [] });
});




test('runFullScan loads auxiliary data and analyzes a qualified coin without runtime errors', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(axios, 'get', async (url, config = {}) => {
    if (url.includes('coins/markets')) return {data: [{symbol: 'SOL', market_cap: 2000000000}]};
    if (url.includes('bookTicker')) return {data: [{symbol: 'SOLUSDT', bidPrice: '100', askPrice: '100.01'}]};
    if (url.includes('premiumIndex')) return {data: [{symbol: 'SOLUSDT', markPrice: '100', indexPrice: '100', lastFundingRate: '0'}]};
    if (url.includes('ticker/24hr')) return {data: [{symbol: 'SOLUSDT', quoteVolume: '100000000', lastPrice: '100', priceChangePercent: '1'}]};
    if (url.includes('openInterestHist')) return {data: []};
    if (url.includes('klines')) {
      const interval = config.params.interval;
      const ms = interval === '1d' ? 86400000 : interval === '4h' ? 14400000 : 3600000;
      const end = Math.floor(Date.now() / ms) * ms;
      const count = config.params.limit;
      return {data: Array.from({length: count}, (_, i) => {
        const time = end - (count - i) * ms;
        return [time, '100', '101', '99', '100', '1000000', time+ms-1, '100000000', 100, '500000', '50000000'];
      })};
    }
    throw new Error(`Unexpected endpoint: ${url}`);
  });
  const result = await runFullScan({}, true);
  assert.deepEqual(errors, []);
  assert.equal(result.errorState, null);
  assert.equal(result.analyzedCount, 1);
  assert.equal(result.qualifiedCount, 1);
});

test('getTop30dVolumePairs strictly caps candidate count to limit (50)', async (t) => {
  const mockTickers = Array.from({ length: 70 }, (_, i) => ({
    symbol: `COIN${i}USDT`,
    quoteVolume: String(10_000_000 - i * 100_000),
    priceChangePercent: String((i % 2 === 0 ? 1 : -1) * (i + 1)),
  }));

  t.mock.method(axios, 'get', async (url) => {
    if (url.includes('ticker/24hr')) {
      return { data: mockTickers };
    }
    if (url.includes('klines')) {
      return { data: Array.from({ length: 30 }, () => [Date.now(), '1', '2', '0.5', '1.5', '1000', Date.now(), '5000000']) };
    }
    return { data: [] };
  });

  const universe = await getTop30dVolumePairs(new Map(), 50);
  assert.ok(universe.length <= 50, `Universe length (${universe.length}) must not exceed limit 50`);
});
