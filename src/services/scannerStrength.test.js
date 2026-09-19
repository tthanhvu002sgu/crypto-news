import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDataIntegrity,
  passesQualityGate,
  calculateRsDurability,
  evaluateStrength,
} from './scannerStrength.js';
import { DIRECTIONS } from './scannerConfig.js';

function validBenchmark() {
  return { h1: 0.5, h4: 1.2, h24: 3.0 };
}

function mockCoinLong(overrides = {}) {
  return {
    symbol: 'SOLUSDT',
    currentPrice: 150,
    marketCap: 50_000_000_000,
    hasFutures: true,
    spreadPct: 0.03,
    volCV: 0.5,
    vol30d: 500_000_000,
    dataCoverage: 0.9,
    relativeStrength4h: 2.5,
    relativeStrength24h: 4.0,
    relativeStrength1h: -0.5, // Negative RS1H allowed in pullback!
    strengthPercentile: 85,
    ema21: 145,
    ema55: 140,
    emaSlopePct: 1.2,
    isDailyUptrend: true,
    ...overrides,
  };
}

function mockCoinShort(overrides = {}) {
  return {
    symbol: 'BEARUSDT',
    currentPrice: 50,
    marketCap: 50_000_000_000,
    hasFutures: true,
    spreadPct: 0.03,
    volCV: 0.5,
    vol30d: 500_000_000,
    dataCoverage: 0.9,
    relativeStrength4h: -2.5,
    relativeStrength24h: -4.0,
    relativeStrength1h: 0.5,
    strengthPercentile: 15,
    ema21: 55,
    ema55: 60,
    emaSlopePct: -1.2,
    isDailyUptrend: false,
    ...overrides,
  };
}

/** Generate synthetic 1H closes with a constant growth/decay rate */
function generateCloses(startPrice, bars, ratePerBar) {
  const closes = [];
  let price = startPrice;
  for (let i = 0; i < bars; i += 1) {
    price *= (1 + ratePerBar);
    closes.push(price);
  }
  return closes;
}

test('evaluateDataIntegrity flags missing BTC benchmark and does not replace with 0', () => {
  const coin = mockCoinLong();
  // Missing benchmark entirely
  const resultNull = evaluateDataIntegrity(coin, null);
  assert.equal(resultNull.valid, false);
  assert.equal(resultNull.reason, 'MISSING_BENCHMARK_DATA');

  // Benchmark has null returns
  const resultNullReturns = evaluateDataIntegrity(coin, { h1: null, h4: 1.0, h24: 2.0 });
  assert.equal(resultNullReturns.valid, false);
  assert.equal(resultNullReturns.reason, 'MISSING_BENCHMARK_DATA');

  // Valid benchmark passes
  const resultOk = evaluateDataIntegrity(coin, validBenchmark());
  assert.equal(resultOk.valid, true);
});

test('Quality gate enforces market cap, spread, VolCV, and futures requirements', () => {
  const valid = mockCoinLong();
  assert.equal(passesQualityGate(valid), true);

  // Fails on market cap < 1B
  assert.equal(passesQualityGate({ ...valid, marketCap: 800_000_000 }), false);
  // Fails on spread > 0.15%
  assert.equal(passesQualityGate({ ...valid, spreadPct: 0.16 }), false);
  // Fails on volCV > 1.3
  assert.equal(passesQualityGate({ ...valid, volCV: 1.4 }), false);
  // Fails on vol30d < 100M
  assert.equal(passesQualityGate({ ...valid, vol30d: 50_000_000 }), false);
  // Fails without futures
  assert.equal(passesQualityGate({ ...valid, hasFutures: false }), false);
});

test('calculateRsDurability accurately counts aligned candles out of last 4', () => {
  // Coin growing at 0.5% per bar, BTC growing at 0.1% per bar -> Coin outperforms BTC every bar
  const coinCloses = generateCloses(100, 30, 0.005);
  const btcCloses = generateCloses(50000, 30, 0.001);

  const durabilityLong = calculateRsDurability(coinCloses, btcCloses, DIRECTIONS.LONG);
  assert.equal(durabilityLong.passed, true);
  assert.equal(durabilityLong.count, 4);
  assert.equal(durabilityLong.total, 4);

  // Coin underperforming BTC
  const durabilityShort = calculateRsDurability(coinCloses, btcCloses, DIRECTIONS.SHORT);
  assert.equal(durabilityShort.passed, false);
  assert.equal(durabilityShort.count, 0);

  // Insufficient bars fails cleanly
  const shortHistory = calculateRsDurability([100, 101], [50000, 50100], DIRECTIONS.LONG);
  assert.equal(shortHistory.passed, false);
  assert.equal(shortHistory.reason, 'INSUFFICIENT_HISTORY');
});

test('WEAK coin cannot pass strength gate even with high liquidity and flow', () => {
  // Coin has weak percentile (50%) and negative RS4H (-1.0%)
  const weakCoin = mockCoinLong({
    strengthPercentile: 50,
    relativeStrength4h: -1.0,
    relativeStrength24h: 0.5,
  });

  const coinCloses = generateCloses(100, 30, 0.005);
  const btcCloses = generateCloses(50000, 30, 0.001);

  const evalResult = evaluateStrength(weakCoin, DIRECTIONS.LONG, validBenchmark(), coinCloses, btcCloses);
  assert.equal(evalResult.passed, false);
  assert.equal(evalResult.status, 'WEAK');
  assert.ok(evalResult.failedConditions.length >= 2);
  assert.ok(evalResult.failedConditions.some(c => c.includes('Percentile')));
});

test('Pullback candidate is NOT disqualified solely because RS1H is negative', () => {
  // Coin has negative RS1H (-1.2%) indicating short-term pullback, but passes all 4H/24H criteria
  const pullbackCoin = mockCoinLong({
    relativeStrength1h: -1.2,
    relativeStrength4h: 2.0,
    relativeStrength24h: 3.5,
    strengthPercentile: 80,
  });

  const coinCloses = generateCloses(100, 30, 0.005);
  const btcCloses = generateCloses(50000, 30, 0.001);

  const evalResult = evaluateStrength(pullbackCoin, DIRECTIONS.LONG, validBenchmark(), coinCloses, btcCloses);
  assert.equal(evalResult.passed, true);
  assert.equal(evalResult.status, 'STRONG');
  assert.ok(evalResult.rs1hDescription.includes('điều chỉnh/pullback'));
});

test('LONG and SHORT strength evaluation is strictly symmetric', () => {
  const bullCoin = mockCoinLong();
  const bearCoin = mockCoinShort();

  const bullCoinCloses = generateCloses(100, 30, 0.005);
  const bullBtcCloses = generateCloses(50000, 30, 0.001);

  const bearCoinCloses = generateCloses(100, 30, -0.005);
  const bearBtcCloses = generateCloses(50000, 30, -0.001);

  const evalLong = evaluateStrength(bullCoin, DIRECTIONS.LONG, validBenchmark(), bullCoinCloses, bullBtcCloses);
  const evalShort = evaluateStrength(bearCoin, DIRECTIONS.SHORT, { h1: -0.5, h4: -1.2, h24: -3.0 }, bearCoinCloses, bearBtcCloses);

  assert.equal(evalLong.passed, true);
  assert.equal(evalShort.passed, true);
  assert.equal(evalLong.status, 'STRONG');
  assert.equal(evalShort.status, 'STRONG');
  assert.equal(evalLong.durabilityPassed, evalShort.durabilityPassed);
});
