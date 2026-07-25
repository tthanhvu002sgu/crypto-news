/**
 * Move Tracker Service — Real-time tracking & analysis of Pump/Dump price movements.
 * Evaluates whether price moves are Liquidity Sweeps, Whale Pushes, or Stop Hunts.
 */

import { subscribeAggTrades } from './websocket';
import { getATR } from './atrCalculator';
import { addSignal } from './signalStore';
import { SIGNAL_TYPE, SEVERITY } from './signalEngine';

// Configuration Defaults
export const MOVE_CONFIG = {
  MODE_ATR: 'ATR',
  MODE_FIXED: 'FIXED',
  DEFAULT_ATR_MULT: 1.5,
  DEFAULT_FIXED_USD: 500,
  LARGE_TRADE_MIN_USD: 100_000,
  MAX_MOVE_DURATION_SEC: 300,
  RECOVERY_TRACK_SEC: 60,
  COOLDOWN_SEC: 30,
};

// In-memory state for move tracker settings
let currentSettings = {
  mode: MOVE_CONFIG.MODE_ATR,
  atrMult: MOVE_CONFIG.DEFAULT_ATR_MULT,
  fixedUsd: MOVE_CONFIG.DEFAULT_FIXED_USD,
  enabled: true,
};

// State Machine Variables
let trackerStatus = 'IDLE'; // 'IDLE' | 'TRACKING' | 'POST_RECOVERY'
let activeMove = null;
let postRecoveryTimer = null;
let moveListeners = new Set();
let moveHistory = []; // In-memory history for quick UI renders
let lastMoveEndTime = 0;

// Price ring-buffer for detecting start of a move (stores last 3 minutes of price snapshots)
const PRICE_RING_MAX = 180; // 180 seconds
const priceRing = []; // [{ price, ts }]

/**
 * Register UI listener for live move status updates
 */
export function subscribeMoveTracker(listener) {
  moveListeners.add(listener);
  // Send immediate initial state
  listener({ status: trackerStatus, activeMove, moveHistory, settings: { ...currentSettings } });
  return () => moveListeners.delete(listener);
}

function notifyListeners() {
  const snapshot = {
    status: trackerStatus,
    activeMove: activeMove ? { ...activeMove } : null,
    moveHistory: [...moveHistory],
    settings: { ...currentSettings },
  };
  moveListeners.forEach((fn) => {
    try { fn(snapshot); } catch (e) { /* ignore */ }
  });
}

export function updateMoveTrackerSettings(newSettings) {
  currentSettings = { ...currentSettings, ...newSettings };
  notifyListeners();
}

/**
 * Calculate dynamic threshold USD based on settings
 */
export async function getThresholdUsd() {
  if (currentSettings.mode === MOVE_CONFIG.MODE_FIXED) {
    return currentSettings.fixedUsd;
  }
  const atr = await getATR('BTCUSDT', '5m', 14);
  return atr * currentSettings.atrMult;
}

/**
 * Heuristic classification of move report
 */
function classifyMoveVerdict(move) {
  const { direction, recoveryPct, largeTradeRatio, tradeCount, avgTradeSize, takerBuyRatio } = move;

  const isBuySidePush = direction === 'PUMP' && takerBuyRatio >= 55;
  const isSellSidePush = direction === 'DUMP' && takerBuyRatio <= 45;
  const takerMatchesDirection = isBuySidePush || isSellSidePush;

  if (recoveryPct >= 50) {
    return {
      verdict: 'LIQUIDITY_SWEEP',
      label: 'Quét Thanh Khoản',
      icon: '🔍',
      color: '#f59e0b', // Amber
      reason: `Giá đảo chiều/hồi ${recoveryPct.toFixed(1)}% ngay sau đợt di chuyển. Đặc trưng của pha quét thanh khoản hai đầu.`,
    };
  }

  if (largeTradeRatio >= 35 && takerMatchesDirection && recoveryPct < 35) {
    return {
      verdict: 'WHALE_PUSH',
      label: 'Cá Voi Đẩy Giá',
      icon: '🐋',
      color: '#10b981', // Emerald
      reason: `Lực mua/bán chủ động từ lệnh lớn (Cá voi) chiếm ${largeTradeRatio.toFixed(1)}% volume, giá không bị kéo ngược nhiều (${recoveryPct.toFixed(1)}%).`,
    };
  }

  if (avgTradeSize < 20000 && tradeCount > 500 && recoveryPct >= 25) {
    return {
      verdict: 'STOP_HUNT',
      label: 'Quét Stop-Loss',
      icon: '🎯',
      color: '#f43f5e', // Rose
      reason: `Số lượng lệnh khớp lớn (${tradeCount} lệnh), kích thước trung bình nhỏ ($${(avgTradeSize / 1000).toFixed(1)}K) kèm lực hồi ${recoveryPct.toFixed(1)}%.`,
    };
  }

  return {
    verdict: 'MIXED',
    label: 'Tín Hiệu Hỗn Hợp',
    icon: '⚪',
    color: '#888892',
    reason: `Chưa đủ bằng chứng để kết luận rõ ràng. Lực hồi ${recoveryPct.toFixed(1)}%, tỷ lệ lệnh lớn ${largeTradeRatio.toFixed(1)}%.`,
  };
}

/**
 * Main trade handler fed by WebSocket aggTrade stream
 */
async function handleIncomingTrade(trade) {
  if (!currentSettings.enabled) return;

  const { price, qty, usdtVol, isTakerSell, timestamp } = trade;
  const now = timestamp || Date.now();

  // Maintain 3-minute price ring buffer
  priceRing.push({ price, ts: now });
  const cutoff = now - 180 * 1000;
  while (priceRing.length > 0 && priceRing[0].ts < cutoff) {
    priceRing.shift();
  }

  // --- STATE 1: IDLE — Check if move started ---
  if (trackerStatus === 'IDLE') {
    if (now - lastMoveEndTime < MOVE_CONFIG.COOLDOWN_SEC * 1000) return; // Cooldown protection

    // Look back up to 120s in price ring
    const baselineCandidate = priceRing.find((p) => p.ts >= now - 120 * 1000);
    if (!baselineCandidate) return;

    const priceDelta = price - baselineCandidate.price;
    const absDelta = Math.abs(priceDelta);
    const thresholdUsd = await getThresholdUsd();

    if (absDelta >= thresholdUsd) {
      // START A NEW MOVE
      trackerStatus = 'TRACKING';
      const direction = priceDelta > 0 ? 'PUMP' : 'DUMP';

      activeMove = {
        id: `move_${now}`,
        direction,
        startTime: baselineCandidate.ts,
        startPrice: baselineCandidate.price,
        peakPrice: Math.max(baselineCandidate.price, price),
        troughPrice: Math.min(baselineCandidate.price, price),
        endPrice: price,
        endTime: null,
        totalVolume: usdtVol,
        totalQty: qty,
        tradeCount: 1,
        takerBuyVol: isTakerSell ? 0 : usdtVol,
        takerSellVol: isTakerSell ? usdtVol : 0,
        largeTradesCount: usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD ? 1 : 0,
        largeTradesVol: usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD ? usdtVol : 0,
        maxSingleTradeUsd: usdtVol,
        maxSingleTradeSide: isTakerSell ? 'SELL' : 'BUY',
        lastExtremeTime: now,
        thresholdUsd,
      };

      notifyListeners();
    }
    return;
  }

  // --- STATE 2: TRACKING — Accumulate move data ---
  if (trackerStatus === 'TRACKING' && activeMove) {
    activeMove.totalVolume += usdtVol;
    activeMove.totalQty += qty;
    activeMove.tradeCount += 1;

    if (isTakerSell) {
      activeMove.takerSellVol += usdtVol;
    } else {
      activeMove.takerBuyVol += usdtVol;
    }

    if (usdtVol >= MOVE_CONFIG.LARGE_TRADE_MIN_USD) {
      activeMove.largeTradesCount += 1;
      activeMove.largeTradesVol += usdtVol;
      if (usdtVol > activeMove.maxSingleTradeUsd) {
        activeMove.maxSingleTradeUsd = usdtVol;
        activeMove.maxSingleTradeSide = isTakerSell ? 'SELL' : 'BUY';
      }
    }

    // Update extremes
    let isNewExtreme = false;
    if (price > activeMove.peakPrice) {
      activeMove.peakPrice = price;
      if (activeMove.direction === 'PUMP') isNewExtreme = true;
    }
    if (price < activeMove.troughPrice) {
      activeMove.troughPrice = price;
      if (activeMove.direction === 'DUMP') isNewExtreme = true;
    }
    if (isNewExtreme) {
      activeMove.lastExtremeTime = now;
    }

    activeMove.endPrice = price;

    // Check if move has stalled / ended
    const durationSec = Math.round((now - activeMove.startTime) / 1000);
    const timeSinceLastExtremeSec = Math.round((now - activeMove.lastExtremeTime) / 1000);

    const isStalled = timeSinceLastExtremeSec >= 15;
    const isMaxDuration = durationSec >= MOVE_CONFIG.MAX_MOVE_DURATION_SEC;

    if (isStalled || isMaxDuration) {
      // TRANSITION TO POST_RECOVERY TRACKING
      activeMove.endTime = now;
      trackerStatus = 'POST_RECOVERY';

      // Schedule 60-second recovery finalization
      postRecoveryTimer = setTimeout(() => {
        finalizeMoveReport(price);
      }, MOVE_CONFIG.RECOVERY_TRACK_SEC * 1000);

      notifyListeners();
    } else {
      notifyListeners();
    }
  }
}

/**
 * Finalize move report after post-move 60s window
 */
async function finalizeMoveReport(finalPriceAfter60s) {
  if (!activeMove) return;

  const move = { ...activeMove };
  const totalVol = move.totalVolume || 1;
  const priceMoveUsd = Math.abs(move.endPrice - move.startPrice);
  const totalRangeUsd = Math.abs(move.peakPrice - move.troughPrice);

  // Recovery % calculation
  let recoveryPct = 0;
  if (move.direction === 'PUMP') {
    const totalPump = move.peakPrice - move.startPrice;
    if (totalPump > 0) {
      const pullback = move.peakPrice - finalPriceAfter60s;
      recoveryPct = Math.max(0, Math.min(100, (pullback / totalPump) * 100));
    }
  } else {
    const totalDump = move.startPrice - move.troughPrice;
    if (totalDump > 0) {
      const bounce = finalPriceAfter60s - move.troughPrice;
      recoveryPct = Math.max(0, Math.min(100, (bounce / totalDump) * 100));
    }
  }

  const takerBuyRatio = (move.takerBuyVol / totalVol) * 100;
  const largeTradeRatio = (move.largeTradesVol / totalVol) * 100;
  const avgTradeSize = totalVol / (move.tradeCount || 1);
  const cvdDelta = move.takerBuyVol - move.takerSellVol;
  const durationSec = Math.round((move.endTime - move.startTime) / 1000);
  const pctChange = ((move.endPrice - move.startPrice) / move.startPrice) * 100;

  const enrichedMove = {
    ...move,
    durationSec,
    pctChange: parseFloat(pctChange.toFixed(2)),
    priceMoveUsd: Math.round(priceMoveUsd),
    totalRangeUsd: Math.round(totalRangeUsd),
    takerBuyRatio: parseFloat(takerBuyRatio.toFixed(1)),
    largeTradeRatio: parseFloat(largeTradeRatio.toFixed(1)),
    avgTradeSize: Math.round(avgTradeSize),
    cvdDelta: Math.round(cvdDelta),
    recoveryPct: parseFloat(recoveryPct.toFixed(1)),
    finalPriceAfter60s,
  };

  const verdictInfo = classifyMoveVerdict(enrichedMove);
  enrichedMove.verdict = verdictInfo.verdict;
  enrichedMove.verdictLabel = verdictInfo.label;
  enrichedMove.verdictIcon = verdictInfo.icon;
  enrichedMove.verdictColor = verdictInfo.color;
  enrichedMove.verdictReason = verdictInfo.reason;

  // Add to move history (keep latest 50 in memory)
  moveHistory = [enrichedMove, ...moveHistory].slice(0, 50);

  // Reset state
  lastMoveEndTime = Date.now();
  trackerStatus = 'IDLE';
  activeMove = null;
  if (postRecoveryTimer) {
    clearTimeout(postRecoveryTimer);
    postRecoveryTimer = null;
  }

  notifyListeners();

  // Save to IndexedDB as MOVE_REPORT signal
  try {
    const title = `${enrichedMove.direction === 'PUMP' ? '🚀 PUMP' : '💥 DUMP'} BTC ${enrichedMove.pctChange >= 0 ? '+' : ''}${enrichedMove.pctChange}% trong ${enrichedMove.durationSec}s`;
    const description = `Volume: $${(enrichedMove.totalVolume / 1e6).toFixed(1)}M | CVD Δ: ${enrichedMove.cvdDelta >= 0 ? '+' : ''}${(enrichedMove.cvdDelta / 1e6).toFixed(1)}M | ${enrichedMove.tradeCount} trades | ${verdictInfo.icon} ${verdictInfo.label}`;

    await addSignal({
      type: SIGNAL_TYPE.MOVE_REPORT,
      severity: Math.abs(enrichedMove.pctChange) >= 2 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
      timestamp: Date.now(),
      title,
      description,
      moveReport: enrichedMove,
      snapshot: {
        btcPrice: enrichedMove.endPrice,
        cvd: enrichedMove.cvdDelta,
        buyVolume: enrichedMove.takerBuyVol,
        sellVolume: enrichedMove.takerSellVol,
        buyRatio: enrichedMove.takerBuyRatio,
      },
    });
  } catch (err) {
    console.error('[MoveTracker] Failed to save move signal:', err);
  }
}

// Initialize subscriber on module import
subscribeAggTrades(handleIncomingTrade);
