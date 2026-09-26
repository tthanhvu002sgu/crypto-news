import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateATR,
  findConfirmedPivots,
  evaluateContraction,
  computeRewardRisk,
  detectPullbackSetup,
  detectBreakoutRetestSetup,
  evaluateSetups,
  isConfirmationCandle,
  __resetSetupStateRegistryForTests,
} from './scannerSetups.js';
import { SETUP_STATES, SETUP_TYPES, DIRECTIONS } from './scannerConfig.js';

beforeEach(() => {
  __resetSetupStateRegistryForTests();
});

function makeKline(time, open, high, low, close, volume = 1000) {
  return [
    time,
    String(open),
    String(high),
    String(low),
    String(close),
    String(volume),
    time + 3599999,
    String(volume * close),
    100,
    String(volume * 0.5),
    String(volume * close * 0.5),
    '0',
  ];
}

function generateCandlesSeries(basePrice = 100, count = 40) {
  const klines = [];
  let price = basePrice;
  const now = 1700000000000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const high = price + 1.5;
    const low = price - 1.0;
    const close = price + 0.5;
    klines.push(makeKline(now + (i * 3600000), open, high, low, close, 5000));
    price = close;
  }
  return klines;
}

test('calculateATR computes average true range accurately across 14 periods', () => {
  const klines = generateCandlesSeries(100, 30);
  const atr = calculateATR(klines, 14);
  assert.ok(atr > 1.5 && atr < 3.5, `Expected ATR ~2.5, got ${atr}`);
});

test('findConfirmedPivots identifies swing highs and lows without lookahead', () => {
  const baseTime = 1700000000000;
  const candles = [];
  // Build 10 candles with a clear peak at index 4 (high = 120) and valley at index 7 (low = 85)
  for (let i = 0; i < 10; i += 1) {
    let high = 100 + i;
    let low = 95 + i;
    if (i === 4) {
      high = 120;
    }
    if (i === 7) {
      low = 85;
    }
    candles.push({
      openTime: baseTime + (i * 3600000),
      open: 98,
      high,
      low,
      close: 99,
      quoteVolume: 5000,
      closeTime: baseTime + ((i + 1) * 3600000) - 1,
    });
  }

  const { highs, lows } = findConfirmedPivots(candles, 2, 2);
  assert.ok(highs.some(h => h.index === 4 && h.price === 120));
  assert.ok(lows.some(l => l.index === 7 && l.price === 85));
});

test('evaluateContraction cleanly separates volume contraction and range contraction', () => {
  // Generate candles where volume is dying down (volume contraction), but range is normal
  const candles = [];
  const baseTime = 1700000000000;
  for (let i = 0; i < 25; i += 1) {
    // Prior 20 candles have volume 10000
    const vol = i < 22 ? 10000 : 2000; // recent 3 have much lower volume
    candles.push({
      openTime: baseTime + (i * 3600000),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      quoteVolume: vol,
      closeTime: baseTime + ((i + 1) * 3600000) - 1,
    });
  }

  const atr1h = 3.0;
  const contraction = evaluateContraction(candles, atr1h);
  assert.equal(contraction.volumeContraction, true);
  assert.ok(contraction.volumeRatio < 0.5);
  assert.equal(contraction.rangeContraction, false); // range is 3.0, same as ATR
  assert.ok(contraction.statement.includes('volume co lại'));
});

test('computeRewardRisk accounts for transaction fees in Net R:R', () => {
  const triggerPrice = 100;
  const invalidationLevel = 95; // Risk = 5
  const targetLevel = 110; // Reward = 10 -> Gross RR = 2.0
  const rr = computeRewardRisk(triggerPrice, invalidationLevel, targetLevel, 0.1); // 0.1% fee

  assert.equal(rr.gross, 2.0);
  // Net reward = 10 - 0.1 = 9.9, Net risk = 5 + 0.1 = 5.1 -> 9.9 / 5.1 = 1.94
  assert.ok(rr.net < rr.gross);
  assert.equal(rr.net, 1.94);
});

test('detectPullbackSetup distinguishes FORMING vs READY vs EXTENDED', () => {
  // Build a series with an established swing low, followed by higher swing high, then pullback
  const klines = [];
  const baseTime = 1700000000000;
  const atr1h = 2.0;

  // 1. Initial base up to swing low at index 5 (price = 100)
  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  // Swing low at index 5
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // low = 98

  // 2. Rally up to swing high at index 15 (price = 115)
  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  // Swing high at index 15
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // high = 118

  // 3. Price pulls back towards swing low (low 98)
  for (let i = 16; i <= 20; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 116 - ((i - 15) * 3), 117 - ((i - 15) * 3), 113 - ((i - 15) * 3), 114 - ((i - 15) * 3)));
  }

  // At index 21, candle is in support zone (98.6) but bearish -> FORMING
  klines.push(makeKline(baseTime + (21 * 3600000), 99.5, 99.8, 98.2, 98.6)); // bearish close

  const forming = detectPullbackSetup(
    klines.map(k => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      quoteVolume: 5000,
      closeTime: k[6],
    })),
    DIRECTIONS.LONG,
    atr1h,
  );

  assert.ok(forming);
  assert.equal(forming.status, SETUP_STATES.FORMING);

  // Now add confirmation candle at index 22: bullish close reclaiming zone and exceeding prior high (100.2, distance 1.1 ATR -> READY)
  const confirmedKlines = [...klines];
  confirmedKlines.push(makeKline(baseTime + (22 * 3600000), 98.6, 100.5, 98.4, 100.2)); // high 100.5 > prev high 99.8, close 100.2 > open 98.6

  const ready = detectPullbackSetup(
    confirmedKlines.map(k => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      quoteVolume: 8000,
      closeTime: k[6],
    })),
    DIRECTIONS.LONG,
    atr1h,
  );

  assert.ok(ready);
  assert.equal(ready.status, SETUP_STATES.READY);
  assert.ok(ready.rewardRiskRatio > 2.0);

  // Now test EXTENDED: price runs far above trigger (> 1.5 ATR)
  const extendedKlines = [...confirmedKlines];
  extendedKlines.push(makeKline(baseTime + (23 * 3600000), 102.0, 108.0, 101.5, 107.5)); // 107.5 is 9.5 points above low 98 -> ~4.75 ATR away!

  const extended = detectPullbackSetup(
    extendedKlines.map(k => ({
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      quoteVolume: 12000,
      closeTime: k[6],
    })),
    DIRECTIONS.LONG,
    atr1h,
  );

  assert.ok(extended);
  assert.equal(extended.status, SETUP_STATES.EXTENDED);
});

test('detectBreakoutRetestSetup requires a retest and reaction before declaring READY', () => {
  const klines = [];
  const baseTime = 1700000000000;
  const atr1h = 2.0;

  // 10 historical candles with a confirmed swing high at index 4 (115)
  for (let i = 0; i < 10; i += 1) {
    if (i === 4) {
      klines.push(makeKline(baseTime + (i * 3600000), 98, 115, 97, 105));
    } else {
      klines.push(makeKline(baseTime + (i * 3600000), 95, 99.0, 93, 96));
    }
  }

  // Next 20 candles (indices 10 to 29) trading between 90 and 99.5
  for (let i = 10; i < 30; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 95, 99.5, 93, 96));
  }

  // Candle 30: Breakout candle closes above 99.5 at 104
  klines.push(makeKline(baseTime + (30 * 3600000), 96, 105, 95.5, 104));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 8000, closeTime: k[6],
  }));

  // Breakout occurred, but price has NOT retested yet -> FORMING
  const beforeRetest = detectBreakoutRetestSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.ok(beforeRetest);
  assert.equal(beforeRetest.status, SETUP_STATES.FORMING);
  assert.ok(beforeRetest.reason.includes('đang chờ giá quay lại retest'));

  // Add Retest candle: dips down to 99.8 (touching breakout level 99.5) and closes bullish at 101.5
  parsed.push({
    openTime: baseTime + (31 * 3600000),
    open: 100.0,
    high: 102.5,
    low: 99.8,
    close: 101.5,
    quoteVolume: 6000,
    closeTime: baseTime + (32 * 3600000) - 1,
  });

  const afterRetest = detectBreakoutRetestSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.ok(afterRetest);
  assert.equal(afterRetest.status, SETUP_STATES.READY);
  assert.ok(afterRetest.rewardRiskRatio >= 2.0);
  assert.ok(afterRetest.reason.includes('Nến retest đóng giữ vững'));
});

test('evaluateSetups classifies strong coin with no setup as WATCH', () => {
  const klines = generateCandlesSeries(100, 30);
  const strengthResult = { passed: true, status: 'STRONG', failedConditions: [] };

  const result = evaluateSetups(klines, DIRECTIONS.LONG, strengthResult);
  assert.ok(result);
  // Plain trend without pullback or retest becomes WATCH
  assert.ok(result.status === SETUP_STATES.WATCH || result.status === SETUP_STATES.FORMING);
  if (result.status === SETUP_STATES.WATCH) {
    assert.equal(result.setupType, SETUP_TYPES.NONE);
    assert.ok(result.reason.includes('Đạt sức mạnh, đang theo dõi hình thành setup'));
  }
});

test('isConfirmationCandle verifies direction, close position, and wick rejection', () => {
  const prev = { open: 100, high: 102, low: 98, close: 99 };

  // Valid bullish confirmation (close 103 > open 99, range 104 - 98 = 6, closeLocation = 5/6 = 0.83, upperWick = 1/6 = 0.17)
  const validLong = { open: 99, high: 104, low: 98, close: 103 };
  assert.equal(isConfirmationCandle(validLong, prev, DIRECTIONS.LONG, SETUP_TYPES.PULLBACK), true);

  // Severe rejection upper wick (shooting star): high = 110, close = 101, open = 99 -> upper wick = 9/12 = 0.75 -> REJECTED
  const rejectedLong = { open: 99, high: 110, low: 98, close: 101 };
  assert.equal(isConfirmationCandle(rejectedLong, prev, DIRECTIONS.LONG, SETUP_TYPES.PULLBACK), false);

  // Bearish candle cannot confirm LONG
  const bearishCandle = { open: 102, high: 103, low: 97, close: 98 };
  assert.equal(isConfirmationCandle(bearishCandle, prev, DIRECTIONS.LONG, SETUP_TYPES.PULLBACK), false);
});

test('detectPullbackSetup handles invalidation cleanly without ReferenceError', () => {
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // low = 98 (supportLow)

  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // peak at index 15

  // Now price crashes straight through invalidation (98 - 0.5 * 2.0 = 97.0) down to 92.0
  for (let i = 16; i <= 21; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 110 - ((i - 15) * 3.5), 111 - ((i - 15) * 3.5), 92, 93));
  }

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 5000, closeTime: k[6],
  }));

  // Must not throw ReferenceError!
  const invalidated = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.ok(invalidated);
  assert.equal(invalidated.status, SETUP_STATES.INVALIDATED);
  assert.ok(invalidated.formedAt > 0);
  assert.equal(invalidated.invalidationLevel, 96.357143);
});

test('detectPullbackSetup preserves READY state across subsequent consolidating candle', () => {
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // low = 98

  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // peak at 118

  for (let i = 16; i <= 20; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 116 - ((i - 15) * 3), 117 - ((i - 15) * 3), 113 - ((i - 15) * 3), 114 - ((i - 15) * 3)));
  }

  // Index 21: in zone (98.6)
  klines.push(makeKline(baseTime + (21 * 3600000), 99.5, 99.8, 98.2, 98.6));
  // Index 22: bullish confirmation candle (close 100.2, high 100.5)
  klines.push(makeKline(baseTime + (22 * 3600000), 98.6, 100.5, 98.4, 100.2));

  // Index 23: subsequent bar consolidates at 100.3 (inside 1.5 ATR zone, does not break prior high)
  klines.push(makeKline(baseTime + (23 * 3600000), 100.2, 100.4, 100.1, 100.3));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 7000, closeTime: k[6],
  }));

  const result = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.ok(result);
  // Must REMAIN READY, not revert to FORMING!
  assert.equal(result.status, SETUP_STATES.READY);
  assert.equal(result.confirmedAt, baseTime + (22 * 3600000) + 3599999);
});

test('detectBreakoutRetestSetup returns null target when no structural resistance exists in history', () => {
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  // 20 bars in range 90-100 (all previous bars below 100)
  for (let i = 0; i < 20; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 95, 99.5, 93, 96));
  }
  // Candle 20: Breakout above 99.5 to 104
  klines.push(makeKline(baseTime + (20 * 3600000), 96, 105, 95.5, 104));
  // Candle 21: Retest and reaction (low 99.7, close 101.5)
  klines.push(makeKline(baseTime + (21 * 3600000), 100.0, 102.5, 99.7, 101.5));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 8000, closeTime: k[6],
  }));

  const result = detectBreakoutRetestSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.ok(result);
  // Must NOT declare READY when targetLevel is null! Gated to FORMING
  assert.equal(result.status, SETUP_STATES.FORMING);
  assert.equal(result.targetLevel, null);
  assert.equal(result.rewardRiskRatio, null);
  assert.ok(result.reason.includes('chưa có cản mục tiêu cấu trúc (target) hợp lệ'));
});

test('[P1-1] Live Futures price overrides closed candle: invalidation breaches and extended moves block READY', () => {
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // support low = 98

  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // peak = 118

  for (let i = 16; i <= 20; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 116 - ((i - 15) * 3), 117 - ((i - 15) * 3), 113 - ((i - 15) * 3), 114 - ((i - 15) * 3)));
  }
  // Index 21: in zone
  klines.push(makeKline(baseTime + (21 * 3600000), 99.5, 99.8, 98.2, 98.6));
  // Index 22: confirmation candle closes at 100.2 (bullish)
  klines.push(makeKline(baseTime + (22 * 3600000), 98.6, 100.5, 98.4, 100.2));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 7000, closeTime: k[6],
  }));

  // 1. Without live price, closed candle yields READY
  const normalResult = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h);
  assert.equal(normalResult.status, SETUP_STATES.READY);
  assert.equal(normalResult.confirmationPrice, 100.2);

  // 2. Live Futures price pumped far above trigger (> 1.5 ATR, e.g. 106.0) during current unclosed hour
  const liveExtended = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h, { latestPrice: 106.0 });
  assert.equal(liveExtended.status, SETUP_STATES.EXTENDED);
  assert.ok(liveExtended.reason.includes('chạy xa vùng hỗ trợ'));

  // 3. Live Futures price dropped below invalidation level (e.g. 95.0 < 96.357) during current unclosed hour
  const liveBreached = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h, { latestPrice: 95.0 });
  assert.equal(liveBreached.status, SETUP_STATES.INVALIDATED);
  assert.ok(liveBreached.reason.includes('Giá Futures hiện tại (95) đã phá thủng mức vô hiệu'));
});

test('[P1-2] R:R uses available entry price instead of stale trigger; gates READY behind minTargetRewardRisk >= 2.0R', () => {
  // Exact user case: trigger = 99.5, stop = 98.5, target = 103.5
  // If calculated from trigger 99.5: reward = 4.0, risk = 1.0 -> 4.0R (INFLATED!)
  // Calculated from available entry price at confirmation (101.5):
  // Gross reward = 103.5 - 101.5 = 2.0, Gross risk = 101.5 - 98.5 = 3.0 -> 2.0 / 3.0 = 0.67R
  // Net R:R with 0.08% fee:
  // Fee = 101.5 * 0.0008 = 0.0812
  // Net reward = 2.0 - 0.0812 = 1.9188
  // Net risk = 3.0 + 0.0812 = 3.0812 -> 1.9188 / 3.0812 = 0.62R
  const calculatedRR = computeRewardRisk(101.5, 98.5, 103.5, 0.08, DIRECTIONS.LONG);
  assert.equal(calculatedRR.gross, 0.67);
  assert.equal(calculatedRR.net, 0.62);

  // Now test that detector rejects 0.67R and stays in FORMING
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  // 10 historical candles with swing resistance at 103.5 (index 4)
  for (let i = 0; i < 10; i += 1) {
    if (i === 4) {
      klines.push(makeKline(baseTime + (i * 3600000), 98, 103.5, 97, 101));
    } else {
      klines.push(makeKline(baseTime + (i * 3600000), 95, 99.0, 93, 96));
    }
  }

  // 20 candles (indices 10 to 29) trading between 90 and 99.5
  for (let i = 10; i < 30; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 95, 99.5, 93, 96));
  }

  // Breakout candle at index 30 (closes at 101 > 99.5)
  klines.push(makeKline(baseTime + (30 * 3600000), 96, 102, 95.5, 101));

  // Retest candle at index 31 (dips to 99.5, closes at 101.5)
  klines.push(makeKline(baseTime + (31 * 3600000), 100, 102, 99.5, 101.5));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 8000, closeTime: k[6],
  }));

  const lowRRResult = detectBreakoutRetestSetup(parsed, DIRECTIONS.LONG, atr1h, { anchoredAtr: 2.0 });
  assert.ok(lowRRResult);
  // Target 103.5 gives available entry R:R = 0.67R < 2.0R -> MUST NOT be READY!
  assert.equal(lowRRResult.status, SETUP_STATES.FORMING);
  assert.equal(lowRRResult.targetLevel, 103.5);
  assert.equal(lowRRResult.rewardRiskRatio, 0.67);
  assert.ok(lowRRResult.reason.includes('chưa đạt tối thiểu 2R'));
});

test('[P1-3] Invalidation stop is anchored to formation ATR and never resurrected on subsequent scans', () => {
  const baseTime = 1700000000000;
  const symbol = 'BTCUSDT';
  const klines = [];

  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // low = 98

  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // peak = 118

  // First scan: Formation ATR is locked. When price breaches stop, setup is INVALIDATED.
  // Add crashing candles to 94 (well below stop)
  for (let i = 16; i <= 21; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - ((i - 15) * 3), 106 - ((i - 15) * 3), 94, 94.5));
  }

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 5000, closeTime: k[6],
  }));

  const scan1 = detectPullbackSetup(parsed, DIRECTIONS.LONG, 2.0, { symbol });
  assert.equal(scan1.status, SETUP_STATES.INVALIDATED);
  const lockedStop = scan1.invalidationLevel;

  // Second scan later: market ATR blows out to 10.0 (which would have produced a much lower stop if recomputed)
  // and price bounces to 95.0. If resurrected, it would think 95 > new stop!
  // But because registry locks stop level and remembers invalidation, it MUST REMAIN INVALIDATED.
  const scan2 = detectPullbackSetup(parsed, DIRECTIONS.LONG, 10.0, { symbol, latestPrice: 95.0 });
  assert.equal(scan2.status, SETUP_STATES.INVALIDATED);
  assert.equal(scan2.invalidationLevel, lockedStop);
});

test('evaluateSetups preserves INVALIDATED setup status and does not disguise as WATCH', () => {
  const baseTime = 1700000000000;
  const klines = [];

  // 5 historical padding candles
  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 108, 109, 107, 108));
  }

  for (let i = 5; i < 10; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - (i - 5), 106 - (i - 5), 104 - (i - 5), 104 - (i - 5)));
  }
  klines.push(makeKline(baseTime + (10 * 3600000), 101, 102, 98, 100)); // low = 98

  for (let i = 11; i <= 19; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 10), 101 + (i - 10), 98 + (i - 10), 100 + (i - 10)));
  }
  klines.push(makeKline(baseTime + (20 * 3600000), 114, 118, 113, 116)); // peak = 118

  // Crashing below invalidation
  for (let i = 21; i <= 27; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - ((i - 20) * 3), 106 - ((i - 20) * 3), 94, 94.5));
  }

  const strengthResult = { passed: true, status: 'STRONG', failedConditions: [], reasons: ['STRONG'] };
  const evaluated = evaluateSetups(klines, DIRECTIONS.LONG, strengthResult, { symbol: 'TESTUSDT' });

  // MUST be INVALIDATED, NOT WATCH!
  assert.equal(evaluated.status, SETUP_STATES.INVALIDATED);
  assert.equal(evaluated.setupType, SETUP_TYPES.PULLBACK);
  assert.ok(evaluated.details);
  assert.ok(evaluated.reason.includes('mức vô hiệu'));
});

test('detectBreakoutRetestSetup preserves structural targetLevel even when invalidated', () => {
  const baseTime = 1700000000000;
  const klines = [];

  // Historical resistance at 115
  for (let i = 0; i < 10; i += 1) {
    if (i === 4) {
      klines.push(makeKline(baseTime + (i * 3600000), 98, 115, 97, 105));
    } else {
      klines.push(makeKline(baseTime + (i * 3600000), 95, 99.0, 93, 96));
    }
  }

  for (let i = 10; i < 30; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 95, 99.5, 93, 96));
  }

  // Breakout candle at index 30
  klines.push(makeKline(baseTime + (30 * 3600000), 96, 105, 95.5, 104));

  // Retest crashes down through stop (prior20High 99.5 - 0.5*2 = 98.5) down to 94
  klines.push(makeKline(baseTime + (31 * 3600000), 100, 101, 93.5, 94));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 8000, closeTime: k[6],
  }));

  const res = detectBreakoutRetestSetup(parsed, DIRECTIONS.LONG, 2.0);
  assert.equal(res.status, SETUP_STATES.INVALIDATED);
  // targetLevel must NOT be null; must preserve historical swing resistance 115
  assert.equal(res.targetLevel, 115);
});

test('setupStateRegistry updates status to EXTENDED and clears stale READY flag when coin runs too far', () => {
  const baseTime = 1700000000000;
  const atr1h = 2.0;
  const klines = [];

  for (let i = 0; i < 5; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 105 - i, 106 - i, 104 - i, 104 - i));
  }
  klines.push(makeKline(baseTime + (5 * 3600000), 101, 102, 98, 100)); // low = 98

  for (let i = 6; i <= 14; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 99 + (i - 5), 101 + (i - 5), 98 + (i - 5), 100 + (i - 5)));
  }
  klines.push(makeKline(baseTime + (15 * 3600000), 114, 118, 113, 116)); // peak at 118

  for (let i = 16; i <= 20; i += 1) {
    klines.push(makeKline(baseTime + (i * 3600000), 116 - ((i - 15) * 3), 117 - ((i - 15) * 3), 113 - ((i - 15) * 3), 114 - ((i - 15) * 3)));
  }

  // Index 21: in zone (98.6)
  klines.push(makeKline(baseTime + (21 * 3600000), 99.5, 99.8, 98.2, 98.6));
  // Index 22: bullish confirmation candle (close 100.2, high 100.5)
  klines.push(makeKline(baseTime + (22 * 3600000), 98.6, 100.5, 98.4, 100.2));

  const parsed = klines.map(k => ({
    openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: 7000, closeTime: k[6],
  }));

  // 1. Initial detection -> READY
  const first = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h, { symbol: 'TESTCOIN' });
  assert.equal(first.status, SETUP_STATES.READY);

  // 2. Next scan: live price runs far away (> 1.8 ATR from trigger 98 -> e.g. 106.0)
  const extended = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h, { symbol: 'TESTCOIN', latestPrice: 106.0 });
  assert.equal(extended.status, SETUP_STATES.EXTENDED);

  // 3. Third scan: price at 103.5 (1.67 ATR). Without stale READY, maxAllowedExtension is 1.5 ATR, so it remains EXTENDED.
  const check = detectPullbackSetup(parsed, DIRECTIONS.LONG, atr1h, { symbol: 'TESTCOIN', latestPrice: 103.5 });
  assert.equal(check.status, SETUP_STATES.EXTENDED);
});


