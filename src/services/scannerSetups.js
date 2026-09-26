/**
 * Scanner v8: Setup Detection Engine
 * Implements two distinct price-action setups:
 * 1. Continuation Pullback (Pullback tiếp diễn)
 * 2. Breakout–Retest (Breakout kiểm tra lại)
 *
 * States: READY, FORMING, WATCH, EXTENDED, INVALIDATED, EXPIRED, DATA_INCOMPLETE
 * Uses ATR for zone tolerance, stop buffers, and extension limits.
 * Separates Volume Contraction and Range Contraction into distinct metrics.
 * Evaluates candle direction, close location within range, and wick dominance.
 * Preserves confirmed state across bars while within allowed ATR zone.
 * Anchors reference zones to prevent drift.
 */

import {
  SETUP_CONFIG,
  SETUP_STATES,
  SETUP_TYPES,
  DIRECTIONS,
  HYSTERESIS_CONFIG,
} from './scannerConfig.js';

const isFiniteNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const toNumber = (value, fallback = null) => isFiniteNumber(value) ? Number(value) : fallback;
const round = (val, d = 2) => isFiniteNumber(val) ? Math.round(Number(val) * (10 ** d)) / (10 ** d) : null;

/**
 * Calculates True Range and Average True Range (ATR) over period.
 */
export function calculateATR(klines, period = 14) {
  if (!Array.isArray(klines) || klines.length <= period) return null;
  const trueRanges = [];
  for (let i = 1; i < klines.length; i += 1) {
    const high = toNumber(klines[i][2], 0);
    const low = toNumber(klines[i][3], 0);
    const prevClose = toNumber(klines[i - 1][4], 0);
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trueRanges.length < period) return null;
  const slice = trueRanges.slice(-period);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

/**
 * Calculates True Range and ATR directly from parsed candle objects.
 */
export function calculateCandlesATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const high = toNumber(candles[i].high, 0);
    const low = toNumber(candles[i].low, 0);
    const prevClose = toNumber(candles[i - 1].close, 0);
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trueRanges.length < period) return null;
  const slice = trueRanges.slice(-period);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

/**
 * Registry holding anchored ATR, invalidation levels, and invalidated state for discovered setups.
 * Prevents invalidation level drift when future volatility surges, and locks invalidated setups.
 */
const setupStateRegistry = new Map();

export function __resetSetupStateRegistryForTests() {
  setupStateRegistry.clear();
}


/**
 * Parses kline row to typed OHLCV object.
 */
export function parseCandle(kline) {
  if (!kline) return null;
  return {
    openTime: toNumber(kline[0]),
    open: toNumber(kline[1]),
    high: toNumber(kline[2]),
    low: toNumber(kline[3]),
    close: toNumber(kline[4]),
    volume: toNumber(kline[5]),
    closeTime: toNumber(kline[6]),
    quoteVolume: toNumber(kline[7]),
  };
}

/**
 * Finds confirmed swing pivots without lookahead.
 * A pivot at index `i` is confirmed when `i + rightBars` candle has closed.
 *
 * @param {Array<Object>} candles - Array of parsed candle objects
 * @param {number} leftBars - Bars to the left with lower/higher values
 * @param {number} rightBars - Bars to the right with lower/higher values
 * @returns {{ highs: Array<{ index: number, price: number, time: number }>, lows: Array<{ index: number, price: number, time: number }> }}
 */
export function findConfirmedPivots(candles, leftBars = SETUP_CONFIG.swingPivotLeftBars, rightBars = SETUP_CONFIG.swingPivotRightBars) {
  const highs = [];
  const lows = [];
  const maxEvalIndex = candles.length - 1 - rightBars;

  for (let i = leftBars; i <= maxEvalIndex; i += 1) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    // Check left
    for (let j = 1; j <= leftBars; j += 1) {
      if (candles[i - j].high >= current.high) isHigh = false;
      if (candles[i - j].low <= current.low) isLow = false;
    }

    // Check right
    for (let j = 1; j <= rightBars; j += 1) {
      if (candles[i + j].high > current.high) isHigh = false;
      if (candles[i + j].low < current.low) isLow = false;
    }

    if (isHigh) {
      highs.push({ index: i, price: current.high, time: current.closeTime });
    }
    if (isLow) {
      lows.push({ index: i, price: current.low, time: current.closeTime });
    }
  }

  return { highs, lows };
}

/**
 * Measures range contraction and volume contraction as separate metrics.
 */
export function evaluateContraction(candles, atr1h) {
  if (!candles || candles.length < 5 || !atr1h || atr1h <= 0) {
    return {
      volumeContraction: false,
      rangeContraction: false,
      volumeRatio: 1.0,
      rangeRatio: 1.0,
      statement: 'vol bình thường · biên độ bình thường',
    };
  }

  const latest = candles.at(-1);
  const recent3 = candles.slice(-3);
  const prior20 = candles.slice(-23, -3);

  // Volume contraction: average volume of recent 3 candles vs prior 20 average
  const avgPriorVol = prior20.length > 0
    ? prior20.reduce((acc, c) => acc + (c.quoteVolume || 0), 0) / prior20.length
    : (latest.quoteVolume || 1);
  const avgRecentVol = recent3.reduce((acc, c) => acc + (c.quoteVolume || 0), 0) / recent3.length;
  const volumeRatio = avgPriorVol > 0 ? avgRecentVol / avgPriorVol : 1.0;
  const volumeContraction = volumeRatio < 0.85;

  // Range contraction: latest candle range vs ATR
  const latestRange = latest.high - latest.low;
  const rangeRatio = latestRange / atr1h;
  const rangeContraction = rangeRatio < 0.75;

  const volText = volumeContraction ? 'volume co lại' : volumeRatio > 1.4 ? 'volume mở rộng' : 'vol ổn định';
  const rangeText = rangeContraction ? 'biên độ co hẹp' : rangeRatio > 1.3 ? 'biên độ nới rộng' : 'biên độ bình thường';

  return {
    volumeContraction,
    rangeContraction,
    volumeRatio: round(volumeRatio, 2),
    rangeRatio: round(rangeRatio, 2),
    statement: `${volText} · ${rangeText}`,
  };
}

/**
 * Evaluates whether a candle qualifies as a confirmation candle.
 * Checks candle direction, close location within range, and wick dominance.
 */
export function isConfirmationCandle(candle, prevCandle, direction, setupType = SETUP_TYPES.PULLBACK) {
  if (!candle) return false;
  const candleRange = candle.high - candle.low;
  if (candleRange <= 0) return false;

  const isLong = direction === DIRECTIONS.LONG || direction === 'BUY';
  const close = candle.close;
  const open = candle.open;
  const high = candle.high;
  const low = candle.low;

  if (isLong) {
    // 1. Bullish candle
    const isBullish = close > open;
    // 2. Closed in upper half of its range
    const closeLocation = (close - low) / candleRange;
    const closedInUpperHalf = closeLocation >= 0.5;
    // 3. Upper wick not excessively long (no severe rejection from top: <= 45% of range)
    const upperWickRatio = (high - close) / candleRange;
    const cleanUpperWick = upperWickRatio <= 0.45;

    if (setupType === SETUP_TYPES.PULLBACK) {
      // Reclaiming prior candle high
      const reclaimedPriorHigh = prevCandle ? close > prevCandle.high : true;
      return isBullish && closedInUpperHalf && cleanUpperWick && reclaimedPriorHigh;
    }

    return isBullish && closedInUpperHalf && cleanUpperWick;
  }

  // SHORT
  // 1. Bearish candle
  const isBearish = close < open;
  // 2. Closed in lower half of its range
  const closeLocation = (high - close) / candleRange;
  const closedInLowerHalf = closeLocation >= 0.5;
  // 3. Lower wick not excessively long (no severe rejection from bottom: <= 45% of range)
  const lowerWickRatio = (close - low) / candleRange;
  const cleanLowerWick = lowerWickRatio <= 0.45;

  if (setupType === SETUP_TYPES.PULLBACK) {
    // Breaking prior candle low
    const lostPriorLow = prevCandle ? close < prevCandle.low : true;
    return isBearish && closedInLowerHalf && cleanLowerWick && lostPriorLow;
  }

  return isBearish && closedInLowerHalf && cleanLowerWick;
}

/**
 * Computes R:R with gross and net (after estimated fees) values.
 * Enforces directional correctness when direction is specified.
 * Calculated against available entry price (not stale trigger zone).
 */
export function computeRewardRisk(entryPrice, invalidationLevel, targetLevel, feePct = SETUP_CONFIG.estimatedFeePct, direction = null) {
  if (!isFiniteNumber(entryPrice) || !isFiniteNumber(invalidationLevel) || !isFiniteNumber(targetLevel)) {
    return { gross: null, net: null };
  }

  const isLong = direction === DIRECTIONS.LONG || direction === 'BUY';
  const isShort = direction === DIRECTIONS.SHORT || direction === 'SELL';

  let grossReward;
  let grossRisk;

  if (isLong) {
    grossReward = targetLevel - entryPrice;
    grossRisk = entryPrice - invalidationLevel;
  } else if (isShort) {
    grossReward = entryPrice - targetLevel;
    grossRisk = invalidationLevel - entryPrice;
  } else {
    grossReward = Math.abs(targetLevel - entryPrice);
    grossRisk = Math.abs(entryPrice - invalidationLevel);
  }

  if (grossRisk <= 0 || grossReward <= 0) return { gross: null, net: null };

  const grossRR = round(grossReward / grossRisk, 2);

  const feeAmount = entryPrice * (feePct / 100);
  const netReward = grossReward - feeAmount;
  const netRisk = grossRisk + feeAmount;
  const netRR = netRisk > 0 && netReward > 0 ? round(netReward / netRisk, 2) : null;

  return {
    gross: grossRR,
    net: netRR,
  };
}

/**
 * Detects Continuation Pullback setup on closed 1H candles.
 * Confirms setup when price pulls back to structural support and prints confirmation.
 * Retains confirmed status as long as price remains within allowed ATR extension.
 */
export function detectPullbackSetup(candles, direction, atr1h, options = {}) {
  const isLong = direction === DIRECTIONS.LONG || direction === 'BUY';
  const { highs, lows } = findConfirmedPivots(candles);

  if (candles.length < 20 || !atr1h || atr1h <= 0) {
    return null;
  }

  const currentCandle = candles.at(-1);
  const currentPrice = currentCandle.close;
  const evalPrice = isFiniteNumber(options?.latestPrice) ? Number(options.latestPrice) : currentPrice;

  if (isLong) {
    // For LONG:
    // Need a recent confirmed swing high (peak of prior leg)
    const recentHighs = highs.filter(h => h.index >= candles.length - 20);
    if (recentHighs.length === 0) return null;
    const lastHigh = recentHighs.at(-1);

    // Preceding swing low provides structural support zone
    const precedingLows = lows.filter(l => l.index < lastHigh.index && l.index >= candles.length - 25);
    if (precedingLows.length === 0) return null;
    const supportLow = precedingLows.at(-1);

    const triggerPrice = supportLow.price;
    const targetLevel = lastHigh.price;

    const setupKey = `${options?.symbol ? `${options.symbol}_` : ''}${DIRECTIONS.LONG}_${SETUP_TYPES.PULLBACK}_${supportLow.time}_${round(triggerPrice, 6)}`;
    const memoryExisting = setupStateRegistry.get(setupKey);
    const hydratedExisting = options?.hydratedRegistry?.get(setupKey);
    const existing = hydratedExisting?.isInvalidated ? hydratedExisting : (memoryExisting || hydratedExisting);

    let setupAtr = existing?.atr;
    let invalidationLevel = existing?.invalidationLevel;

    if (!memoryExisting || setupAtr === undefined) {
      const formationCandles = candles.slice(0, Math.max(supportLow.index, lastHigh.index) + 1);
      const formationAtr = calculateCandlesATR(formationCandles, 14);
      setupAtr = options?.anchoredAtr ?? formationAtr ?? atr1h;
      if (invalidationLevel === undefined) {
        invalidationLevel = options?.invalidationLevel ?? round(supportLow.price - (SETUP_CONFIG.stopBufferAtr * setupAtr), 6);
      }
      setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: existing?.isInvalidated || false });
    }

    const zoneTolerance = SETUP_CONFIG.zoneToleranceAtr * setupAtr;
    const distanceToZone = evalPrice - triggerPrice;
    const distanceAtr = round(Math.abs(distanceToZone) / setupAtr, 2);

    // Invalidation check: closed below invalidation or latest price breaches invalidation
    const closedBelowInvalidation = candles.slice(lastHigh.index).some(c => c.close < invalidationLevel);
    if (existing?.isInvalidated || evalPrice < invalidationLevel || currentPrice < invalidationLevel || closedBelowInvalidation) {
      setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: true });
      return {
        type: SETUP_TYPES.PULLBACK,
        direction: DIRECTIONS.LONG,
        status: SETUP_STATES.INVALIDATED,
        triggerPrice: round(triggerPrice, 6),
        invalidationLevel,
        targetLevel: round(targetLevel, 6),
        distanceAtr,
        formedAt: supportLow.time,
        confirmedAt: null,
        confirmationPrice: null,
        reason: (evalPrice < invalidationLevel && !closedBelowInvalidation && currentPrice >= invalidationLevel)
          ? `Giá Futures hiện tại (${evalPrice}) đã phá thủng mức vô hiệu (${invalidationLevel})`
          : 'Đã phá vỡ đáy cấu trúc và mức vô hiệu',
      };
    }

    // Check if price reached the reference support zone since lastHigh
    const candlesSincePeak = candles.slice(lastHigh.index);
    const reachedZone = candlesSincePeak.some(c => c.low <= triggerPrice + zoneTolerance);

    // Search for confirmation candle since peak
    let confirmedCandle = null;
    let confirmedIdx = -1;

    for (let idx = lastHigh.index + 1; idx < candles.length; idx += 1) {
      const c = candles[idx];
      const prev = candles[idx - 1];
      const reachedByNow = candles.slice(lastHigh.index, idx + 1).some(bar => bar.low <= triggerPrice + zoneTolerance);
      if (reachedByNow && isConfirmationCandle(c, prev, DIRECTIONS.LONG, SETUP_TYPES.PULLBACK)) {
        confirmedCandle = c;
        confirmedIdx = idx;
        break;
      }
    }

    const isConfirmed = confirmedCandle !== null;
    const confirmationPrice = isConfirmed ? round(confirmedCandle.close, 6) : null;
    const availableEntryPrice = isConfirmed ? evalPrice : triggerPrice;

    const rr = targetLevel
      ? computeRewardRisk(availableEntryPrice, invalidationLevel, targetLevel, SETUP_CONFIG.estimatedFeePct, DIRECTIONS.LONG)
      : { gross: null, net: null };

    let status = SETUP_STATES.FORMING;
    let reason = reachedZone
      ? 'Đã chạm vùng hỗ trợ swing low, đang chờ nến tăng xác nhận'
      : 'Đang điều chỉnh về vùng hỗ trợ swing low, chờ nến tăng xác nhận';

    const wasAlreadyReady = existing?.status === SETUP_STATES.READY
      || existing?.initialStatus === SETUP_STATES.READY
      || options?.wasReady === true;

    const maxAllowedExtension = wasAlreadyReady
      ? (HYSTERESIS_CONFIG?.maintenanceMaxExtensionAtr ?? 1.8)
      : SETUP_CONFIG.maxExtensionAtr;

    const minAllowedRR = wasAlreadyReady
      ? (HYSTERESIS_CONFIG?.maintenanceMinRewardRisk ?? 1.6)
      : SETUP_CONFIG.minTargetRewardRisk;

    if (isConfirmed) {
      if (distanceAtr > maxAllowedExtension) {
        status = SETUP_STATES.EXTENDED;
        reason = `Đã xác nhận nhưng giá hiện tại đã chạy xa vùng hỗ trợ (+${distanceAtr} ATR)`;
      } else if (candles.length - 1 - confirmedIdx > SETUP_CONFIG.maxFormingBars) {
        status = SETUP_STATES.EXPIRED;
        reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến 1H từ lúc xác nhận`;
      } else if (!targetLevel) {
        status = SETUP_STATES.FORMING;
        reason = 'Đã xác nhận pullback nhưng chưa có cản mục tiêu cấu trúc (target) hợp lệ';
      } else if (rr.gross === null || rr.gross < minAllowedRR) {
        status = SETUP_STATES.FORMING;
        reason = `Tỷ lệ R:R tại giá vào khả dụng (${rr.gross ?? '---'}R) chưa đạt tối thiểu ${minAllowedRR}R`;
      } else {
        status = SETUP_STATES.READY;
        reason = `Nến tăng xác nhận lấy lại vùng swing low và vượt đỉnh nến trước (${distanceAtr} ATR)`;
      }
    } else if (candles.length - lastHigh.index > SETUP_CONFIG.maxFormingBars) {
      status = SETUP_STATES.EXPIRED;
      reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến 1H chưa có xác nhận tiếp diễn`;
    }

    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: false, status });

    return {
      type: SETUP_TYPES.PULLBACK,
      direction: DIRECTIONS.LONG,
      status,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel: round(targetLevel, 6),
      distanceAtr,
      rewardRiskRatio: rr.gross,
      rewardRiskNet: rr.net,
      formedAt: supportLow.time,
      confirmedAt: isConfirmed ? confirmedCandle.closeTime : null,
      confirmationPrice,
      reason,
      triggerZone: {
        low: round(triggerPrice - zoneTolerance, 6),
        high: round(triggerPrice + zoneTolerance, 6),
      },
    };
  }

  // SHORT Pullback logic: strictly symmetric
  const recentLows = lows.filter(l => l.index >= candles.length - 20);
  if (recentLows.length === 0) return null;
  const lastLow = recentLows.at(-1);

  const precedingHighs = highs.filter(h => h.index < lastLow.index && h.index >= candles.length - 25);
  if (precedingHighs.length === 0) return null;
  const resistanceHigh = precedingHighs.at(-1);

  const triggerPrice = resistanceHigh.price;
  const targetLevel = lastLow.price;

  const setupKey = `${options?.symbol ? `${options.symbol}_` : ''}${DIRECTIONS.SHORT}_${SETUP_TYPES.PULLBACK}_${resistanceHigh.time}_${round(triggerPrice, 6)}`;
  const memoryExisting = setupStateRegistry.get(setupKey);
  const hydratedExisting = options?.hydratedRegistry?.get(setupKey);
  const existing = hydratedExisting?.isInvalidated ? hydratedExisting : (memoryExisting || hydratedExisting);

  let setupAtr = existing?.atr;
  let invalidationLevel = existing?.invalidationLevel;

  if (!memoryExisting || setupAtr === undefined) {
    const formationCandles = candles.slice(0, Math.max(resistanceHigh.index, lastLow.index) + 1);
    const formationAtr = calculateCandlesATR(formationCandles, 14);
    setupAtr = options?.anchoredAtr ?? formationAtr ?? atr1h;
    if (invalidationLevel === undefined) {
      invalidationLevel = options?.invalidationLevel ?? round(resistanceHigh.price + (SETUP_CONFIG.stopBufferAtr * setupAtr), 6);
    }
    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: existing?.isInvalidated || false });
  }

  const zoneTolerance = SETUP_CONFIG.zoneToleranceAtr * setupAtr;
  const distanceToZone = triggerPrice - evalPrice;
  const distanceAtr = round(Math.abs(distanceToZone) / setupAtr, 2);

  const closedAboveInvalidation = candles.slice(lastLow.index).some(c => c.close > invalidationLevel);
  if (existing?.isInvalidated || evalPrice > invalidationLevel || currentPrice > invalidationLevel || closedAboveInvalidation) {
    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: true });
    return {
      type: SETUP_TYPES.PULLBACK,
      direction: DIRECTIONS.SHORT,
      status: SETUP_STATES.INVALIDATED,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel: round(targetLevel, 6),
      distanceAtr,
      formedAt: resistanceHigh.time,
      confirmedAt: null,
      confirmationPrice: null,
      reason: (evalPrice > invalidationLevel && !closedAboveInvalidation && currentPrice <= invalidationLevel)
        ? `Giá Futures hiện tại (${evalPrice}) đã vượt mức vô hiệu (${invalidationLevel})`
        : 'Đã phá vỡ đỉnh cấu trúc và mức vô hiệu',
    };
  }

  const candlesSinceValley = candles.slice(lastLow.index);
  const reachedZone = candlesSinceValley.some(c => c.high >= triggerPrice - zoneTolerance);

  let confirmedCandle = null;
  let confirmedIdx = -1;

  for (let idx = lastLow.index + 1; idx < candles.length; idx += 1) {
    const c = candles[idx];
    const prev = candles[idx - 1];
    const reachedByNow = candles.slice(lastLow.index, idx + 1).some(bar => bar.high >= triggerPrice - zoneTolerance);
    if (reachedByNow && isConfirmationCandle(c, prev, DIRECTIONS.SHORT, SETUP_TYPES.PULLBACK)) {
      confirmedCandle = c;
      confirmedIdx = idx;
      break;
    }
  }

  const isConfirmed = confirmedCandle !== null;
  const confirmationPrice = isConfirmed ? round(confirmedCandle.close, 6) : null;
  const availableEntryPrice = isConfirmed ? evalPrice : triggerPrice;

  const rr = targetLevel
    ? computeRewardRisk(availableEntryPrice, invalidationLevel, targetLevel, SETUP_CONFIG.estimatedFeePct, DIRECTIONS.SHORT)
    : { gross: null, net: null };

  let status = SETUP_STATES.FORMING;
  let reason = reachedZone
    ? 'Đã chạm vùng kháng cự swing high, đang chờ nến giảm xác nhận'
    : 'Đang hồi phục về vùng kháng cự swing high, chờ nến giảm xác nhận';

  const wasAlreadyReady = existing?.status === SETUP_STATES.READY
    || existing?.initialStatus === SETUP_STATES.READY
    || options?.wasReady === true;

  const maxAllowedExtension = wasAlreadyReady
    ? (HYSTERESIS_CONFIG?.maintenanceMaxExtensionAtr ?? 1.8)
    : SETUP_CONFIG.maxExtensionAtr;

  const minAllowedRR = wasAlreadyReady
    ? (HYSTERESIS_CONFIG?.maintenanceMinRewardRisk ?? 1.6)
    : SETUP_CONFIG.minTargetRewardRisk;

  if (isConfirmed) {
    if (distanceAtr > maxAllowedExtension) {
      status = SETUP_STATES.EXTENDED;
      reason = `Đã xác nhận nhưng giá hiện tại đã chạy xa vùng kháng cự (+${distanceAtr} ATR)`;
    } else if (candles.length - 1 - confirmedIdx > SETUP_CONFIG.maxFormingBars) {
      status = SETUP_STATES.EXPIRED;
      reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến 1H từ lúc xác nhận`;
    } else if (!targetLevel) {
      status = SETUP_STATES.FORMING;
      reason = 'Đã xác nhận pullback nhưng chưa có cản mục tiêu cấu trúc (target) hợp lệ';
    } else if (rr.gross === null || rr.gross < minAllowedRR) {
      status = SETUP_STATES.FORMING;
      reason = `Tỷ lệ R:R tại giá vào khả dụng (${rr.gross ?? '---'}R) chưa đạt tối thiểu ${minAllowedRR}R`;
    } else {
      status = SETUP_STATES.READY;
      reason = `Nến giảm xác nhận giữ dưới vùng swing high và phá đáy nến trước (${distanceAtr} ATR)`;
    }
  } else if (candles.length - lastLow.index > SETUP_CONFIG.maxFormingBars) {
    status = SETUP_STATES.EXPIRED;
    reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến 1H chưa có xác nhận tiếp diễn`;
  }

  setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: false, status });

  return {
    type: SETUP_TYPES.PULLBACK,
    direction: DIRECTIONS.SHORT,
    status,
    triggerPrice: round(triggerPrice, 6),
    invalidationLevel,
    targetLevel: round(targetLevel, 6),
    distanceAtr,
    rewardRiskRatio: rr.gross,
    rewardRiskNet: rr.net,
    formedAt: resistanceHigh.time,
    confirmedAt: isConfirmed ? confirmedCandle.closeTime : null,
    confirmationPrice,
    reason,
    triggerZone: {
      low: round(triggerPrice - zoneTolerance, 6),
      high: round(triggerPrice + zoneTolerance, 6),
    },
  };
}

/**
 * Detects Breakout–Retest setup on closed 1H candles.
 * Evaluates 20-candle high/low prior to breakout.
 * Anchors reference zone to breakout bar.
 * Uses genuine historical swing pivots for target (never fabricates fake target).
 */
export function detectBreakoutRetestSetup(candles, direction, atr1h, options = {}) {
  const isLong = direction === DIRECTIONS.LONG || direction === 'BUY';
  const lookback = SETUP_CONFIG.breakoutLookbackBars; // 20

  if (!candles || candles.length < lookback + 1 || !atr1h || atr1h <= 0) {
    return null;
  }

  const { highs, lows } = findConfirmedPivots(candles);
  const currentCandle = candles.at(-1);
  const currentPrice = currentCandle.close;
  const evalPrice = isFiniteNumber(options?.latestPrice) ? Number(options.latestPrice) : currentPrice;

  if (isLong) {
    // 1. Identify breakout candle chronologically within recent search window
    const maxSearch = SETUP_CONFIG.maxFormingBars + 4;
    const startIdx = Math.max(lookback, candles.length - maxSearch);
    let breakoutIndex = -1;
    let prior20High = null;

    for (let i = startIdx; i < candles.length; i += 1) {
      const windowPrior = candles.slice(i - lookback, i);
      const windowHigh = Math.max(...windowPrior.map(c => c.high));
      if (candles[i].close > windowHigh && candles[i - 1].close <= windowHigh) {
        breakoutIndex = i;
        prior20High = windowHigh;
        break;
      }
    }

    if (breakoutIndex === -1 || prior20High === null) return null;

    const triggerPrice = prior20High;
    const setupKey = `${options?.symbol ? `${options.symbol}_` : ''}${DIRECTIONS.LONG}_${SETUP_TYPES.BREAKOUT_RETEST}_${candles[breakoutIndex].closeTime}_${round(triggerPrice, 6)}`;
    const memoryExisting = setupStateRegistry.get(setupKey);
    const hydratedExisting = options?.hydratedRegistry?.get(setupKey);
    const existing = hydratedExisting?.isInvalidated ? hydratedExisting : (memoryExisting || hydratedExisting);

    let setupAtr = existing?.atr;
    let invalidationLevel = existing?.invalidationLevel;

    if (!memoryExisting || setupAtr === undefined) {
      const formationCandles = candles.slice(0, breakoutIndex + 1);
      const formationAtr = calculateCandlesATR(formationCandles, 14);
      setupAtr = options?.anchoredAtr ?? formationAtr ?? atr1h;
      if (invalidationLevel === undefined) {
        invalidationLevel = options?.invalidationLevel ?? round(prior20High - (SETUP_CONFIG.stopBufferAtr * setupAtr), 6);
      }
      setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: existing?.isInvalidated || false });
    }

    const zoneTolerance = SETUP_CONFIG.zoneToleranceAtr * setupAtr;
    const distanceAtr = round(Math.abs(evalPrice - triggerPrice) / setupAtr, 2);

    // Structural target from genuine prior swing high resistance in chart history
    const priorResistances = highs.filter(h => h.index < breakoutIndex && h.price > triggerPrice);
    const targetLevel = priorResistances.length > 0
      ? round(Math.min(...priorResistances.map(h => h.price)), 6)
      : null;

    const candlesSinceBreakout = candles.slice(breakoutIndex + 1);

    // Invalidation check
    const closedBelowInvalidation = candlesSinceBreakout.some(c => c.close < invalidationLevel);
    if (existing?.isInvalidated || evalPrice < invalidationLevel || currentPrice < invalidationLevel || closedBelowInvalidation) {
      setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: true });
      return {
        type: SETUP_TYPES.BREAKOUT_RETEST,
        direction: DIRECTIONS.LONG,
        status: SETUP_STATES.INVALIDATED,
        triggerPrice: round(triggerPrice, 6),
        invalidationLevel,
        targetLevel,
        distanceAtr,
        formedAt: candles[breakoutIndex].closeTime,
        confirmedAt: null,
        confirmationPrice: null,
        reason: (evalPrice < invalidationLevel && !closedBelowInvalidation && currentPrice >= invalidationLevel)
          ? `Giá Futures hiện tại (${evalPrice}) đã phá thủng mức vô hiệu retest (${invalidationLevel})`
          : 'Giá đã đóng dưới mức vô hiệu retest',
      };
    }

    if (candlesSinceBreakout.length === 0) {
      return {
        type: SETUP_TYPES.BREAKOUT_RETEST,
        direction: DIRECTIONS.LONG,
        status: SETUP_STATES.FORMING,
        triggerPrice: round(triggerPrice, 6),
        invalidationLevel,
        targetLevel,
        distanceAtr,
        formedAt: candles[breakoutIndex].closeTime,
        confirmedAt: null,
        confirmationPrice: null,
        reason: 'Breakout đã xảy ra, đang chờ giá quay lại retest vùng đỉnh cũ',
        triggerZone: {
          low: round(triggerPrice - zoneTolerance, 6),
          high: round(triggerPrice + zoneTolerance, 6),
        },
      };
    }

    // Has price touched the retest zone?
    const touchedRetestZone = candlesSinceBreakout.some(
      c => c.low <= triggerPrice + zoneTolerance && c.close >= invalidationLevel,
    );

    if (!touchedRetestZone) {
      const isExpired = candlesSinceBreakout.length > SETUP_CONFIG.maxFormingBars;
      return {
        type: SETUP_TYPES.BREAKOUT_RETEST,
        direction: DIRECTIONS.LONG,
        status: isExpired ? SETUP_STATES.EXPIRED : SETUP_STATES.FORMING,
        triggerPrice: round(triggerPrice, 6),
        invalidationLevel,
        targetLevel: null,
        distanceAtr,
        formedAt: candles[breakoutIndex].closeTime,
        confirmedAt: null,
        confirmationPrice: null,
        reason: isExpired
          ? `Quá ${SETUP_CONFIG.maxFormingBars} nến chưa quay lại retest`
          : 'Breakout đã xảy ra, đang chờ giá quay lại retest vùng đỉnh cũ',
        triggerZone: {
          low: round(triggerPrice - zoneTolerance, 6),
          high: round(triggerPrice + zoneTolerance, 6),
        },
      };
    }

    // Find confirmation candle after touching retest zone
    let confirmedCandle = null;
    let confirmedIdx = -1;

    for (let j = 0; j < candlesSinceBreakout.length; j += 1) {
      const bar = candlesSinceBreakout[j];
      const barAbsIdx = breakoutIndex + 1 + j;
      const prevBar = candles[barAbsIdx - 1];
      const touchedSoFar = candlesSinceBreakout.slice(0, j + 1).some(
        c => c.low <= triggerPrice + zoneTolerance && c.close >= invalidationLevel,
      );
      if (touchedSoFar && isConfirmationCandle(bar, prevBar, DIRECTIONS.LONG, SETUP_TYPES.BREAKOUT_RETEST) && bar.close >= triggerPrice) {
        confirmedCandle = bar;
        confirmedIdx = barAbsIdx;
        break;
      }
    }

    const isConfirmed = confirmedCandle !== null;
    const confirmationPrice = isConfirmed ? round(confirmedCandle.close, 6) : null;
    const availableEntryPrice = isConfirmed ? evalPrice : triggerPrice;

    const rr = targetLevel
      ? computeRewardRisk(availableEntryPrice, invalidationLevel, targetLevel, SETUP_CONFIG.estimatedFeePct, DIRECTIONS.LONG)
      : { gross: null, net: null };

    let status = SETUP_STATES.FORMING;
    let reason = 'Đang retest vùng breakout, chờ phản ứng giữ hỗ trợ';

    const wasAlreadyReady = existing?.status === SETUP_STATES.READY
      || existing?.initialStatus === SETUP_STATES.READY
      || options?.wasReady === true;

    const maxAllowedExtension = wasAlreadyReady
      ? (HYSTERESIS_CONFIG?.maintenanceMaxExtensionAtr ?? 1.8)
      : SETUP_CONFIG.maxExtensionAtr;

    const minAllowedRR = wasAlreadyReady
      ? (HYSTERESIS_CONFIG?.maintenanceMinRewardRisk ?? 1.6)
      : SETUP_CONFIG.minTargetRewardRisk;

    if (isConfirmed) {
      if (distanceAtr > maxAllowedExtension) {
        status = SETUP_STATES.EXTENDED;
        reason = `Đã retest thành công nhưng giá hiện tại đã chạy xa vùng trigger (+${distanceAtr} ATR)`;
      } else if (candles.length - 1 - confirmedIdx > SETUP_CONFIG.maxFormingBars) {
        status = SETUP_STATES.EXPIRED;
        reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến từ lúc xác nhận retest`;
      } else if (!targetLevel) {
        status = SETUP_STATES.FORMING;
        reason = 'Đã retest thành công nhưng chưa có cản mục tiêu cấu trúc (target) hợp lệ';
      } else if (rr.gross === null || rr.gross < minAllowedRR) {
        status = SETUP_STATES.FORMING;
        reason = `Tỷ lệ R:R tại giá vào khả dụng (${rr.gross ?? '---'}R) chưa đạt tối thiểu ${minAllowedRR}R`;
      } else {
        status = SETUP_STATES.READY;
        reason = `Nến retest đóng giữ vững trên vùng breakout với phản ứng tăng (+${distanceAtr} ATR)`;
      }
    } else if (candlesSinceBreakout.length > SETUP_CONFIG.maxFormingBars) {
      status = SETUP_STATES.EXPIRED;
      reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến chưa xác nhận retest`;
    }

    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: false, status });

    return {
      type: SETUP_TYPES.BREAKOUT_RETEST,
      direction: DIRECTIONS.LONG,
      status,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel,
      distanceAtr,
      rewardRiskRatio: rr.gross,
      rewardRiskNet: rr.net,
      formedAt: candles[breakoutIndex].closeTime,
      confirmedAt: isConfirmed ? confirmedCandle.closeTime : null,
      confirmationPrice,
      reason,
      triggerZone: {
        low: round(triggerPrice - zoneTolerance, 6),
        high: round(triggerPrice + zoneTolerance, 6),
      },
    };
  }

  // SHORT Breakout–Retest (Breakdown & Retest from below)
  const maxSearch = SETUP_CONFIG.maxFormingBars + 4;
  const startIdx = Math.max(lookback, candles.length - maxSearch);
  let breakdownIndex = -1;
  let prior20Low = null;

  for (let i = startIdx; i < candles.length; i += 1) {
    const windowPrior = candles.slice(i - lookback, i);
    const windowLow = Math.min(...windowPrior.map(c => c.low));
    if (candles[i].close < windowLow && candles[i - 1].close >= windowLow) {
      breakdownIndex = i;
      prior20Low = windowLow;
      break;
    }
  }

  if (breakdownIndex === -1 || prior20Low === null) return null;

  const triggerPrice = prior20Low;
  const setupKey = `${options?.symbol ? `${options.symbol}_` : ''}${DIRECTIONS.SHORT}_${SETUP_TYPES.BREAKOUT_RETEST}_${candles[breakdownIndex].closeTime}_${round(triggerPrice, 6)}`;
  const memoryExisting = setupStateRegistry.get(setupKey);
  const hydratedExisting = options?.hydratedRegistry?.get(setupKey);
  const existing = hydratedExisting?.isInvalidated ? hydratedExisting : (memoryExisting || hydratedExisting);

  let setupAtr = existing?.atr;
  let invalidationLevel = existing?.invalidationLevel;

  if (!memoryExisting || setupAtr === undefined) {
    const formationCandles = candles.slice(0, breakdownIndex + 1);
    const formationAtr = calculateCandlesATR(formationCandles, 14);
    setupAtr = options?.anchoredAtr ?? formationAtr ?? atr1h;
    if (invalidationLevel === undefined) {
      invalidationLevel = options?.invalidationLevel ?? round(prior20Low + (SETUP_CONFIG.stopBufferAtr * setupAtr), 6);
    }
    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: existing?.isInvalidated || false });
  }

  const zoneTolerance = SETUP_CONFIG.zoneToleranceAtr * setupAtr;
  const distanceAtr = round(Math.abs(triggerPrice - evalPrice) / setupAtr, 2);

  // Structural target from genuine prior swing low support in chart history
  const priorSupports = lows.filter(l => l.index < breakdownIndex && l.price < triggerPrice);
  const targetLevel = priorSupports.length > 0
    ? round(Math.max(...priorSupports.map(l => l.price)), 6)
    : null;

  const candlesSinceBreakdown = candles.slice(breakdownIndex + 1);

  const closedAboveInvalidation = candlesSinceBreakdown.some(c => c.close > invalidationLevel);
  if (existing?.isInvalidated || evalPrice > invalidationLevel || currentPrice > invalidationLevel || closedAboveInvalidation) {
    setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: true });
    return {
      type: SETUP_TYPES.BREAKOUT_RETEST,
      direction: DIRECTIONS.SHORT,
      status: SETUP_STATES.INVALIDATED,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel,
      distanceAtr,
      formedAt: candles[breakdownIndex].closeTime,
      confirmedAt: null,
      confirmationPrice: null,
      reason: (evalPrice > invalidationLevel && !closedAboveInvalidation && currentPrice <= invalidationLevel)
        ? `Giá Futures hiện tại (${evalPrice}) đã vượt mức vô hiệu retest (${invalidationLevel})`
        : 'Giá đã đóng vượt mức vô hiệu retest phía trên',
    };
  }

  if (candlesSinceBreakdown.length === 0) {
    return {
      type: SETUP_TYPES.BREAKOUT_RETEST,
      direction: DIRECTIONS.SHORT,
      status: SETUP_STATES.FORMING,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel,
      distanceAtr,
      formedAt: candles[breakdownIndex].closeTime,
      confirmedAt: null,
      confirmationPrice: null,
      reason: 'Breakdown đã xảy ra, đang chờ giá quay lại retest đáy cũ từ dưới lên',
      triggerZone: {
        low: round(triggerPrice - zoneTolerance, 6),
        high: round(triggerPrice + zoneTolerance, 6),
      },
    };
  }

  const touchedRetestZone = candlesSinceBreakdown.some(
    c => c.high >= triggerPrice - zoneTolerance && c.close <= invalidationLevel,
  );

  if (!touchedRetestZone) {
    const isExpired = candlesSinceBreakdown.length > SETUP_CONFIG.maxFormingBars;
    return {
      type: SETUP_TYPES.BREAKOUT_RETEST,
      direction: DIRECTIONS.SHORT,
      status: isExpired ? SETUP_STATES.EXPIRED : SETUP_STATES.FORMING,
      triggerPrice: round(triggerPrice, 6),
      invalidationLevel,
      targetLevel: null,
      distanceAtr,
      formedAt: candles[breakdownIndex].closeTime,
      confirmedAt: null,
      confirmationPrice: null,
      reason: isExpired
        ? `Quá ${SETUP_CONFIG.maxFormingBars} nến chưa quay lại retest`
        : 'Breakdown đã xảy ra, đang chờ giá quay lại retest đáy cũ từ dưới lên',
      triggerZone: {
        low: round(triggerPrice - zoneTolerance, 6),
        high: round(triggerPrice + zoneTolerance, 6),
      },
    };
  }

  let confirmedCandle = null;
  let confirmedIdx = -1;

  for (let j = 0; j < candlesSinceBreakdown.length; j += 1) {
    const bar = candlesSinceBreakdown[j];
    const barAbsIdx = breakdownIndex + 1 + j;
    const prevBar = candles[barAbsIdx - 1];
    const touchedSoFar = candlesSinceBreakdown.slice(0, j + 1).some(
      c => c.high >= triggerPrice - zoneTolerance && c.close <= invalidationLevel,
    );
    if (touchedSoFar && isConfirmationCandle(bar, prevBar, DIRECTIONS.SHORT, SETUP_TYPES.BREAKOUT_RETEST) && bar.close <= triggerPrice) {
      confirmedCandle = bar;
      confirmedIdx = barAbsIdx;
      break;
    }
  }

  const isConfirmed = confirmedCandle !== null;
  const confirmationPrice = isConfirmed ? round(confirmedCandle.close, 6) : null;
  const availableEntryPrice = isConfirmed ? evalPrice : triggerPrice;

  const rr = targetLevel
    ? computeRewardRisk(availableEntryPrice, invalidationLevel, targetLevel, SETUP_CONFIG.estimatedFeePct, DIRECTIONS.SHORT)
    : { gross: null, net: null };

  let status = SETUP_STATES.FORMING;
  let reason = 'Đang retest vùng breakdown, chờ phản ứng từ chối';

  const wasAlreadyReady = existing?.status === SETUP_STATES.READY
    || existing?.initialStatus === SETUP_STATES.READY
    || options?.wasReady === true;

  const maxAllowedExtension = wasAlreadyReady
    ? (HYSTERESIS_CONFIG?.maintenanceMaxExtensionAtr ?? 1.8)
    : SETUP_CONFIG.maxExtensionAtr;

  const minAllowedRR = wasAlreadyReady
    ? (HYSTERESIS_CONFIG?.maintenanceMinRewardRisk ?? 1.6)
    : SETUP_CONFIG.minTargetRewardRisk;

  if (isConfirmed) {
    if (distanceAtr > maxAllowedExtension) {
      status = SETUP_STATES.EXTENDED;
      reason = `Đã retest từ chối nhưng giá hiện tại đã chạy xa vùng trigger (+${distanceAtr} ATR)`;
    } else if (candles.length - 1 - confirmedIdx > SETUP_CONFIG.maxFormingBars) {
      status = SETUP_STATES.EXPIRED;
      reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến từ lúc xác nhận retest`;
    } else if (!targetLevel) {
      status = SETUP_STATES.FORMING;
      reason = 'Đã retest từ chối nhưng chưa có cản mục tiêu cấu trúc (target) hợp lệ';
    } else if (rr.gross === null || rr.gross < minAllowedRR) {
      status = SETUP_STATES.FORMING;
      reason = `Tỷ lệ R:R tại giá vào khả dụng (${rr.gross ?? '---'}R) chưa đạt tối thiểu ${minAllowedRR}R`;
    } else {
      status = SETUP_STATES.READY;
      reason = `Nến retest đóng giữ vững dưới đáy cũ với phản ứng giảm (+${distanceAtr} ATR)`;
    }
  } else if (candlesSinceBreakdown.length > SETUP_CONFIG.maxFormingBars) {
    status = SETUP_STATES.EXPIRED;
    reason = `Quá ${SETUP_CONFIG.maxFormingBars} nến chưa xác nhận retest`;
  }

  setupStateRegistry.set(setupKey, { atr: setupAtr, invalidationLevel, isInvalidated: false, status });

  return {
    type: SETUP_TYPES.BREAKOUT_RETEST,
    direction: DIRECTIONS.SHORT,
    status,
    triggerPrice: round(triggerPrice, 6),
    invalidationLevel,
    targetLevel,
    distanceAtr,
    rewardRiskRatio: rr.gross,
    rewardRiskNet: rr.net,
    formedAt: candles[breakdownIndex].closeTime,
    confirmedAt: isConfirmed ? confirmedCandle.closeTime : null,
    confirmationPrice,
    reason,
    triggerZone: {
      low: round(triggerPrice - zoneTolerance, 6),
      high: round(triggerPrice + zoneTolerance, 6),
    },
  };
}

/**
 * Master Setup Evaluator:
 * Evaluates both Pullback and Breakout-Retest setups on 1H candles.
 * Returns the best setup match or WATCH state if strong but no setup active.
 */
export function evaluateSetups(klines1h, direction, strengthResult, options = {}) {
  if (!strengthResult?.passed) {
    return {
      status: strengthResult?.status === 'DATA_INCOMPLETE' ? SETUP_STATES.DATA_INCOMPLETE : SETUP_STATES.WATCH,
      setupType: SETUP_TYPES.NONE,
      direction,
      details: null,
      reason: strengthResult?.failedConditions?.[0] || 'Chưa vượt qua cửa lọc sức mạnh',
    };
  }

  const candles = (klines1h || []).map(parseCandle).filter(Boolean);
  const atr1h = calculateATR(klines1h, 14);

  if (candles.length < 25 || !atr1h) {
    return {
      status: SETUP_STATES.DATA_INCOMPLETE,
      setupType: SETUP_TYPES.NONE,
      direction,
      details: null,
      reason: 'Thiếu nến 1H hoặc ATR1H để xác nhận setup',
    };
  }

  const contraction = evaluateContraction(candles, atr1h);

  const pullback = detectPullbackSetup(candles, direction, atr1h, options);
  const breakout = detectBreakoutRetestSetup(candles, direction, atr1h, options);

  // Preference order: READY > FORMING > EXTENDED > WATCH
  const candidates = [pullback, breakout].filter(Boolean);

  const readyCandidates = candidates.filter(c => c.status === SETUP_STATES.READY);
  if (readyCandidates.length > 0) {
    const bestReady = readyCandidates.sort((a, b) => (b.rewardRiskRatio || 0) - (a.rewardRiskRatio || 0))[0];
    return {
      status: SETUP_STATES.READY,
      setupType: bestReady.type,
      direction,
      details: bestReady,
      contraction,
      atr1h: round(atr1h, 4),
      reason: bestReady.reason,
    };
  }

  const formingCandidates = candidates.filter(c => c.status === SETUP_STATES.FORMING);
  if (formingCandidates.length > 0) {
    const bestForming = formingCandidates.sort((a, b) => (b.rewardRiskRatio || 0) - (a.rewardRiskRatio || 0))[0];
    return {
      status: SETUP_STATES.FORMING,
      setupType: bestForming.type,
      direction,
      details: bestForming,
      contraction,
      atr1h: round(atr1h, 4),
      reason: bestForming.reason,
    };
  }

  const extendedCandidate = candidates.find(c => c.status === SETUP_STATES.EXTENDED);
  if (extendedCandidate) {
    return {
      status: SETUP_STATES.EXTENDED,
      setupType: extendedCandidate.type,
      direction,
      details: extendedCandidate,
      contraction,
      atr1h: round(atr1h, 4),
      reason: extendedCandidate.reason,
    };
  }

  const invalidatedCandidate = candidates.find(c => c.status === SETUP_STATES.INVALIDATED);
  if (invalidatedCandidate) {
    return {
      status: SETUP_STATES.INVALIDATED,
      setupType: invalidatedCandidate.type,
      direction,
      details: invalidatedCandidate,
      contraction,
      atr1h: round(atr1h, 4),
      reason: invalidatedCandidate.reason,
    };
  }

  const expiredCandidate = candidates.find(c => c.status === SETUP_STATES.EXPIRED);
  if (expiredCandidate) {
    return {
      status: SETUP_STATES.EXPIRED,
      setupType: expiredCandidate.type,
      direction,
      details: expiredCandidate,
      contraction,
      atr1h: round(atr1h, 4),
      reason: expiredCandidate.reason,
    };
  }

  // Strong coin but neither setup currently active => WATCH
  return {
    status: SETUP_STATES.WATCH,
    setupType: SETUP_TYPES.NONE,
    direction,
    details: null,
    contraction,
    atr1h: round(atr1h, 4),
    reason: 'Đạt sức mạnh, đang theo dõi hình thành setup (chưa có điểm pullback hoặc breakout-retest rõ ràng)',
  };
}
