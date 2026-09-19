/**
 * Scanner v8: Strength Evaluation Engine
 * Mandatory strength gates: RS vs BTC (4H, 24H), Percentile rank,
 * 4H EMA structure/slope, and 1H RS durability.
 * Flow and Quality cannot compensate for failed strength criteria.
 */

import {
  QUALITY_GATE_THRESHOLDS,
  STRENGTH_THRESHOLDS,
  DIRECTIONS,
} from './scannerConfig.js';

const isFiniteNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const toNumber = (value, fallback = null) => isFiniteNumber(value) ? Number(value) : fallback;

/**
 * Gate 1: Check Data Integrity
 * Ensures closed candles, synchronized series, non-zero benchmark data.
 */
export function evaluateDataIntegrity(coin, benchmark) {
  if (!coin) {
    return { valid: false, reason: 'MISSING_COIN_DATA' };
  }

  // Mandatory benchmark check
  if (!benchmark || !isFiniteNumber(benchmark.h1) || !isFiniteNumber(benchmark.h4) || !isFiniteNumber(benchmark.h24)) {
    return { valid: false, reason: 'MISSING_BENCHMARK_DATA' };
  }

  // Required price and moving average metrics
  const price = coin.currentPrice ?? coin.price;
  if (!isFiniteNumber(price) || price <= 0) {
    return { valid: false, reason: 'INVALID_CURRENT_PRICE' };
  }
  if (!isFiniteNumber(coin.ema21) || !isFiniteNumber(coin.ema55) || !isFiniteNumber(coin.emaSlopePct)) {
    return { valid: false, reason: 'MISSING_EMA_DATA' };
  }
  if (!isFiniteNumber(coin.relativeStrength4h) || !isFiniteNumber(coin.relativeStrength24h)) {
    return { valid: false, reason: 'MISSING_RELATIVE_STRENGTH' };
  }

  return { valid: true };
}

/**
 * Gate 2: Quality & Liquidity Gate
 * Verifies market cap, spread, volume consistency, and data coverage.
 */
export function passesQualityGate(coin) {
  if (!coin || !coin.hasFutures) return false;
  const mcap = toNumber(coin.marketCap);
  const spread = toNumber(coin.spreadPct);
  const volcv = toNumber(coin.volCV);
  const vol30d = toNumber(coin.vol30d);
  const coverage = toNumber(coin.dataCoverage);

  return mcap !== null && mcap >= QUALITY_GATE_THRESHOLDS.minMarketCap
    && spread !== null && spread <= QUALITY_GATE_THRESHOLDS.maxSpreadPct
    && volcv !== null && volcv <= QUALITY_GATE_THRESHOLDS.maxVolCV
    && vol30d !== null && vol30d >= QUALITY_GATE_THRESHOLDS.minVol30d
    && coverage !== null && coverage >= QUALITY_GATE_THRESHOLDS.minDataCoverage;
}

/**
 * Calculate RS24H durability across the last N 1H candles (e.g. 3 of last 4).
 * For each bar t:
 *   returnCoin = (close[t] - close[t - 24]) / close[t - 24]
 *   returnBtc  = (btcClose[t] - btcClose[t - 24]) / btcClose[t - 24]
 *   rs24h[t]   = (returnCoin - returnBtc) * 100
 *
 * @param {Array<number>} coin1hCloses - Array of closed 1H candle prices, chronological
 * @param {Array<number>} btc1hCloses - Array of closed 1H BTC candle prices, chronological
 * @param {string} direction - 'LONG' or 'SHORT'
 * @returns {{ count: number, total: number, passed: boolean, values: number[] }}
 */
export function calculateRsDurability(coin1hCloses, btc1hCloses, direction = DIRECTIONS.LONG) {
  const lookbackBars = STRENGTH_THRESHOLDS.rsDurabilityLookbackBars; // 4
  const minRequired = STRENGTH_THRESHOLDS.rsDurabilityMinBars; // 3
  const requiredLength = 24 + lookbackBars; // at least 28 bars

  if (!Array.isArray(coin1hCloses) || !Array.isArray(btc1hCloses)
    || coin1hCloses.length < requiredLength || btc1hCloses.length < requiredLength) {
    return { count: 0, total: lookbackBars, passed: false, values: [], reason: 'INSUFFICIENT_HISTORY' };
  }

  const values = [];
  let passingCount = 0;

  for (let i = 0; i < lookbackBars; i += 1) {
    // Offset from end: 0 is latest closed, 1 is 1 bar ago, etc.
    const coinCurr = coin1hCloses.at(-(1 + i));
    const coinPast = coin1hCloses.at(-(1 + i + 24));
    const btcCurr = btc1hCloses.at(-(1 + i));
    const btcPast = btc1hCloses.at(-(1 + i + 24));

    if (coinPast > 0 && btcPast > 0) {
      const coinRet = ((coinCurr / coinPast) - 1) * 100;
      const btcRet = ((btcCurr / btcPast) - 1) * 100;
      const rs = coinRet - btcRet;
      values.push(Math.round(rs * 100) / 100);

      if (direction === DIRECTIONS.LONG && rs > 0) {
        passingCount += 1;
      } else if (direction === DIRECTIONS.SHORT && rs < 0) {
        passingCount += 1;
      }
    }
  }

  return {
    count: passingCount,
    total: lookbackBars,
    passed: passingCount >= minRequired,
    values,
  };
}

/**
 * Gate 3: Evaluate Strength
 * Strict conditions: RS4h, RS24h, Percentile, 4H EMA structure, EMA slope, 4H Close, RS Durability.
 * Breakout is excluded from strength (reserved for setups).
 */
export function evaluateStrength(coin, direction, benchmark, coin1hCloses = [], btc1hCloses = []) {
  const isLong = direction === DIRECTIONS.LONG;
  const reasons = [];
  const failedConditions = [];

  // 1. Data integrity check
  const integrity = evaluateDataIntegrity(coin, benchmark);
  if (!integrity.valid) {
    return {
      passed: false,
      status: 'DATA_INCOMPLETE',
      direction,
      symbol: coin?.symbol,
      reasons: [],
      failedConditions: [integrity.reason],
      strengthPercentile: coin?.strengthPercentile ?? null,
      rs4h: coin?.relativeStrength4h ?? null,
      rs24h: coin?.relativeStrength24h ?? null,
      rs1h: coin?.relativeStrength1h ?? null,
      durabilityCount: 0,
      durabilityPassed: false,
    };
  }

  // 2. Relative Strength vs BTC (4H & 24H)
  const rs4h = toNumber(coin.relativeStrength4h, 0);
  const rs24h = toNumber(coin.relativeStrength24h, 0);
  const rs1h = toNumber(coin.relativeStrength1h, 0);

  if (isLong) {
    if (rs4h > 0 && rs24h > 0) {
      reasons.push(`RS vs BTC dương cả 4H (+${rs4h.toFixed(2)}%) và 24H (+${rs24h.toFixed(2)}%)`);
    } else {
      failedConditions.push(`RS vs BTC không đạt đồng thuận dương (4H: ${rs4h.toFixed(2)}%, 24H: ${rs24h.toFixed(2)}%)`);
    }
  } else {
    if (rs4h < 0 && rs24h < 0) {
      reasons.push(`RS vs BTC âm cả 4H (${rs4h.toFixed(2)}%) và 24H (${rs24h.toFixed(2)}%)`);
    } else {
      failedConditions.push(`RS vs BTC không đạt đồng thuận âm (4H: ${rs4h.toFixed(2)}%, 24H: ${rs24h.toFixed(2)}%)`);
    }
  }

  // 3. Percentile Rank in eligible universe
  const percentile = toNumber(coin.strengthPercentile, null);
  if (isLong) {
    if (percentile !== null && percentile >= STRENGTH_THRESHOLDS.longPercentileMin) {
      reasons.push(`Thuộc top ${Math.round(100 - percentile)}% mạnh nhất universe (Percentile ${percentile}%)`);
    } else {
      failedConditions.push(`Percentile chưa đạt top 30% (hiện tại: ${percentile ?? '---'}%)`);
    }
  } else {
    if (percentile !== null && percentile <= STRENGTH_THRESHOLDS.shortPercentileMax) {
      reasons.push(`Thuộc top ${Math.round(percentile)}% yếu nhất universe (Percentile ${percentile}%)`);
    } else {
      failedConditions.push(`Percentile chưa đạt top 30% yếu (hiện tại: ${percentile ?? '---'}%)`);
    }
  }

  // 4. 4H EMA Trend & Slope
  const ema21 = toNumber(coin.ema21);
  const ema55 = toNumber(coin.ema55);
  const slope = toNumber(coin.emaSlopePct);
  const close4h = toNumber(coin.close4h ?? coin.currentPrice ?? coin.price); // 4H close price

  if (isLong) {
    const emaAligned = ema21 > ema55;
    const slopePositive = slope > STRENGTH_THRESHOLDS.min4hEmaSlopePct;
    const priceAboveEma = close4h > ema21;

    if (emaAligned && slopePositive && priceAboveEma) {
      reasons.push(`Xu hướng 4H tăng rõ (EMA21 > EMA55, độ dốc +${slope.toFixed(2)}%, giá trên EMA21)`);
    } else {
      if (!emaAligned) failedConditions.push('EMA21 4H không nằm trên EMA55');
      if (!slopePositive) failedConditions.push(`Độ dốc EMA21 4H không dương (${slope.toFixed(2)}%)`);
      if (!priceAboveEma) failedConditions.push('Giá đóng 4H chưa nằm trên EMA21');
    }
  } else {
    const emaAligned = ema21 < ema55;
    const slopeNegative = slope < -STRENGTH_THRESHOLDS.min4hEmaSlopePct;
    const priceBelowEma = close4h < ema21;

    if (emaAligned && slopeNegative && priceBelowEma) {
      reasons.push(`Xu hướng 4H giảm rõ (EMA21 < EMA55, độ dốc ${slope.toFixed(2)}%, giá dưới EMA21)`);
    } else {
      if (!emaAligned) failedConditions.push('EMA21 4H không nằm dưới EMA55');
      if (!slopeNegative) failedConditions.push(`Độ dốc EMA21 4H không âm (${slope.toFixed(2)}%)`);
      if (!priceBelowEma) failedConditions.push('Giá đóng 4H chưa nằm dưới EMA21');
    }
  }

  // 5. RS24H Durability (>= 3 of last 4 1H candles)
  const durability = calculateRsDurability(coin1hCloses, btc1hCloses, direction);
  if (durability.passed) {
    reasons.push(`Độ bền RS24H: ${durability.count}/${durability.total} nến 1H gần nhất cùng chiều`);
  } else {
    failedConditions.push(`Độ bền RS24H không đạt (chỉ ${durability.count}/${durability.total} nến 1H cùng chiều)`);
  }

  // 6. Contextual Notes (RS1H note, 1D alignment, Macro alignment)
  // RS1H is not a hard disqualifier
  const rs1hDescription = isLong
    ? (rs1h >= 0 ? `RS 1H đang tăng tốc (+${rs1h.toFixed(2)}%)` : `RS 1H đang điều chỉnh/pullback (${rs1h.toFixed(2)}%)`)
    : (rs1h <= 0 ? `RS 1H đang giảm sâu (${rs1h.toFixed(2)}%)` : `RS 1H đang hồi phục nhẹ (+${rs1h.toFixed(2)}%)`);

  const passed = failedConditions.length === 0;

  return {
    passed,
    status: passed ? 'STRONG' : 'WEAK',
    direction,
    symbol: coin.symbol,
    strengthPercentile: percentile,
    rs4h,
    rs24h,
    rs1h,
    rs1hDescription,
    ema21,
    ema55,
    emaSlopePct: slope,
    durabilityCount: durability.count,
    durabilityTotal: durability.total,
    durabilityPassed: durability.passed,
    durabilityValues: durability.values,
    reasons,
    failedConditions,
    is1dAligned: isLong ? coin.isDailyUptrend === true : coin.isDailyUptrend === false,
  };
}
