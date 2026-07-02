/**
 * Signal Engine — Detects notable market conditions and logs them with full indicator snapshots.
 * 
 * Runs client-side, fed by WebSocket + REST data.
 * Produces signal objects: { timestamp, type, severity, title, description, snapshot }
 */

import { addSignal } from './signalStore';

// ─── Severity Levels ──────────────────────────────────────────────────────────
export const SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

// ─── Signal Types ─────────────────────────────────────────────────────────────
export const SIGNAL_TYPE = {
  PRICE_SPIKE: 'PRICE_SPIKE',
  VOLUME_SPIKE: 'VOLUME_SPIKE',
  CVD_DIVERGENCE: 'CVD_DIVERGENCE',
  FUNDING_EXTREME: 'FUNDING_EXTREME',
  OI_SURGE: 'OI_SURGE',
  OBI_EXTREME: 'OBI_EXTREME',
  WHALE_CLUSTER: 'WHALE_CLUSTER',
  WHALE_WALL_SHIFT: 'WHALE_WALL_SHIFT',
  MACRO_EVENT: 'MACRO_EVENT',
  FNG_EXTREME: 'FNG_EXTREME',
  PERIODIC_SNAPSHOT: 'PERIODIC_SNAPSHOT',
};

// ─── Cooldown tracking — prevent spam ─────────────────────────────────────────
const cooldowns = new Map();

function isOnCooldown(signalType, cooldownMs = 5 * 60 * 1000) {
  const lastFired = cooldowns.get(signalType) || 0;
  if (Date.now() - lastFired < cooldownMs) return true;
  cooldowns.set(signalType, Date.now());
  return false;
}

// ─── Previous values for delta detection ──────────────────────────────────────
const prevValues = {
  price: null,
  priceTimestamp: null,
  oiValue: null,
  oiTimestamp: null,
  cvd: null,
  priceAtCvdCheck: null,
};

// ─── Helper: build full snapshot object ───────────────────────────────────────
function buildSnapshot(ctx) {
  const snap = {};

  // Price data
  if (ctx.livePrice != null) snap.btcPrice = ctx.livePrice;
  if (ctx.liveChange != null) snap.btcChange24h = ctx.liveChange;
  if (ctx.liveHigh != null) snap.btcHigh = ctx.liveHigh;
  if (ctx.liveLow != null) snap.btcLow = ctx.liveLow;
  if (ctx.liveVolume != null) snap.btcVolume24h = ctx.liveVolume;
  if (ctx.liveEthPrice != null) snap.ethPrice = ctx.liveEthPrice;
  if (ctx.liveSolPrice != null) snap.solPrice = ctx.liveSolPrice;

  // CVD & Order Flow
  if (ctx.cvd != null) snap.cvd = Math.round(ctx.cvd);
  if (ctx.sessionCvd != null) snap.sessionCvd = Math.round(ctx.sessionCvd);
  if (ctx.buyVolume != null) snap.buyVolume = Math.round(ctx.buyVolume);
  if (ctx.sellVolume != null) snap.sellVolume = Math.round(ctx.sellVolume);
  const totalVol = (ctx.buyVolume || 0) + (ctx.sellVolume || 0);
  if (totalVol > 0) snap.buyRatio = parseFloat(((ctx.buyVolume / totalVol) * 100).toFixed(1));

  // Funding Rate
  if (ctx.fundingRate != null) snap.fundingRate = ctx.fundingRate;

  // Open Interest
  if (ctx.openInterest != null) snap.openInterest = ctx.openInterest;

  // Order Book
  if (ctx.orderBook) {
    snap.obiPercent = ctx.orderBook.obiPercent;
    snap.obSignal = ctx.orderBook.signal;
    snap.bidVolBtc = ctx.orderBook.bidVolBtc;
    snap.askVolBtc = ctx.orderBook.askVolBtc;
    if (ctx.orderBook.exchanges) {
      snap.obiByExchange = ctx.orderBook.exchanges;
    }
  }

  // Whale Walls
  if (ctx.whaleData) {
    snap.bidWallTotal = ctx.whaleData.bidWallTotal;
    snap.askWallTotal = ctx.whaleData.askWallTotal;
    snap.bidRatio = ctx.whaleData.bidRatio;
    snap.whaleWallSignal = ctx.whaleData.signal;
  }

  // Macro data (from parent App state)
  if (ctx.data) {
    const d = ctx.data;
    if (d.fundingRate != null) snap.fundingRateRest = d.fundingRate;
    if (d.openInterest != null) snap.openInterestRest = d.openInterest;
    if (d.fngData) {
      snap.fngValue = d.fngData.value;
      snap.fngSentiment = d.fngData.sentiment;
    }
    if (d.globalData) {
      snap.btcDominance = d.globalData.btcDominance;
      snap.totalMarketCap = d.globalData.totalMarketCap;
    }
    if (d.stablecoins) {
      snap.stablecoinTotal = d.stablecoins.total;
    }
    if (d.fedFundsRate != null) snap.fedRate = d.fedFundsRate;
    if (d.cpi != null) snap.cpi = d.cpi;
    if (d.tenYearYield != null) snap.tenYearYield = d.tenYearYield;
    if (d.dxy != null) snap.dxy = d.dxy;
    if (d.vix?.price != null) snap.vix = d.vix.price;
    if (d.sp500?.price != null) snap.sp500 = d.sp500.price;
    if (d.netLiquidity != null) snap.netLiquidity = d.netLiquidity;
    if (d.onChainMetrics?.mvrv != null) snap.mvrv = d.onChainMetrics.mvrv;
    if (d.highYield != null) snap.highYield = d.highYield;
    if (d.m2Supply != null) snap.m2Supply = d.m2Supply;
  }

  return snap;
}

// ─── Detection Rules ──────────────────────────────────────────────────────────

function detectPriceSpike(ctx) {
  if (!ctx.livePrice || !prevValues.price) return null;
  const priceDelta = ((ctx.livePrice - prevValues.price) / prevValues.price) * 100;
  const timeDelta = Date.now() - (prevValues.priceTimestamp || 0);

  // >1.5% move in under 5 minutes
  if (Math.abs(priceDelta) >= 1.5 && timeDelta <= 5 * 60 * 1000) {
    const direction = priceDelta > 0 ? '↑' : '↓';
    const severity = Math.abs(priceDelta) >= 3 ? SEVERITY.CRITICAL : Math.abs(priceDelta) >= 2 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
    return {
      type: SIGNAL_TYPE.PRICE_SPIKE,
      severity,
      title: `Giá BTC ${direction} ${Math.abs(priceDelta).toFixed(2)}% trong ${Math.round(timeDelta / 60000)} phút`,
      description: `$${prevValues.price.toLocaleString()} → $${ctx.livePrice.toLocaleString()}`,
    };
  }
  return null;
}

function detectFundingExtreme(ctx) {
  const rate = ctx.fundingRate ?? ctx.data?.fundingRate;
  if (rate == null) return null;
  const pct = rate * 100;

  if (pct > 0.05) {
    return {
      type: SIGNAL_TYPE.FUNDING_EXTREME,
      severity: pct > 0.1 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `Funding Rate cực cao: ${pct.toFixed(4)}%`,
      description: `Long overloaded — áp lực thanh lý long. Tỷ lệ phí quá cao cho vị thế Long.`,
    };
  }
  if (pct < -0.01) {
    return {
      type: SIGNAL_TYPE.FUNDING_EXTREME,
      severity: pct < -0.03 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `Funding Rate âm: ${pct.toFixed(4)}%`,
      description: `Short bias — thị trường bi quan, short trả phí cho long.`,
    };
  }
  return null;
}

function detectOBIExtreme(ctx) {
  if (!ctx.orderBook) return null;
  const obi = ctx.orderBook.obiPercent;
  if (Math.abs(obi) >= 30) {
    const direction = obi > 0 ? 'BUY' : 'SELL';
    return {
      type: SIGNAL_TYPE.OBI_EXTREME,
      severity: Math.abs(obi) >= 50 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `OBI ${direction} cực đoan: ${obi > 0 ? '+' : ''}${obi}%`,
      description: `Order book mất cân bằng nghiêm trọng — áp lực ${direction.toLowerCase()} rất lớn trên sổ lệnh.`,
    };
  }
  return null;
}

function detectWhaleWallShift(ctx) {
  if (!ctx.whaleData) return null;
  const { bidRatio, bidWallTotal, askWallTotal } = ctx.whaleData;
  const totalWalls = bidWallTotal + askWallTotal;

  if (totalWalls < 1000000) return null; // Ignore if total walls < $1M

  if (bidRatio > 0.7) {
    return {
      type: SIGNAL_TYPE.WHALE_WALL_SHIFT,
      severity: SEVERITY.MEDIUM,
      title: `Whale walls chênh lệch mạnh — BID ${(bidRatio * 100).toFixed(0)}%`,
      description: `Smart money đỡ giá. Support: $${(bidWallTotal / 1e6).toFixed(1)}M vs Resistance: $${(askWallTotal / 1e6).toFixed(1)}M`,
    };
  }
  if (bidRatio < 0.3) {
    return {
      type: SIGNAL_TYPE.WHALE_WALL_SHIFT,
      severity: SEVERITY.MEDIUM,
      title: `Whale walls chênh lệch mạnh — ASK ${((1 - bidRatio) * 100).toFixed(0)}%`,
      description: `Tường bán áp đảo. Resistance: $${(askWallTotal / 1e6).toFixed(1)}M vs Support: $${(bidWallTotal / 1e6).toFixed(1)}M`,
    };
  }
  return null;
}

function detectFnGExtreme(ctx) {
  if (!ctx.data?.fngData) return null;
  const val = ctx.data.fngData.value;
  if (val <= 15) {
    return {
      type: SIGNAL_TYPE.FNG_EXTREME,
      severity: SEVERITY.HIGH,
      title: `Extreme Fear: Fear & Greed = ${val}`,
      description: `Thị trường cực kỳ hoảng sợ — lịch sử cho thấy đây thường là vùng tích lũy.`,
    };
  }
  if (val >= 85) {
    return {
      type: SIGNAL_TYPE.FNG_EXTREME,
      severity: SEVERITY.HIGH,
      title: `Extreme Greed: Fear & Greed = ${val}`,
      description: `Thị trường cực kỳ tham lam — rủi ro điều chỉnh tăng cao.`,
    };
  }
  return null;
}

function detectOISurge(ctx) {
  if (ctx.data?.openInterest == null || prevValues.oiValue == null) return null;
  const oi = ctx.data.openInterest;
  const oiDelta = ((oi - prevValues.oiValue) / prevValues.oiValue) * 100;
  const timeDelta = Date.now() - (prevValues.oiTimestamp || 0);

  // >5% OI change in under 30 minutes
  if (Math.abs(oiDelta) >= 5 && timeDelta <= 30 * 60 * 1000) {
    const direction = oiDelta > 0 ? 'tăng' : 'giảm';
    return {
      type: SIGNAL_TYPE.OI_SURGE,
      severity: Math.abs(oiDelta) >= 10 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      title: `OI ${direction} ${Math.abs(oiDelta).toFixed(1)}% trong ${Math.round(timeDelta / 60000)} phút`,
      description: `Open Interest: ${prevValues.oiValue.toFixed(0)} → ${oi.toFixed(0)} BTC`,
    };
  }
  return null;
}

function detectCVDDivergence(ctx) {
  if (ctx.cvd == null || ctx.livePrice == null) return null;
  if (prevValues.cvd == null || prevValues.priceAtCvdCheck == null) return null;

  const priceDelta = ((ctx.livePrice - prevValues.priceAtCvdCheck) / prevValues.priceAtCvdCheck) * 100;
  const cvdDelta = ctx.cvd - prevValues.cvd;

  // Price up >1% but CVD down significantly, or vice versa
  if (priceDelta > 1 && cvdDelta < -50000000) { // Price ↑ CVD ↓ $50M+
    return {
      type: SIGNAL_TYPE.CVD_DIVERGENCE,
      severity: SEVERITY.HIGH,
      title: `CVD Divergence ⚠ — Giá ↑${priceDelta.toFixed(1)}% nhưng CVD ↓`,
      description: `Giá tăng nhưng dòng tiền bán ròng. CVD giảm $${Math.abs(cvdDelta / 1e6).toFixed(1)}M — cảnh báo fakeout.`,
    };
  }
  if (priceDelta < -1 && cvdDelta > 50000000) { // Price ↓ CVD ↑ $50M+
    return {
      type: SIGNAL_TYPE.CVD_DIVERGENCE,
      severity: SEVERITY.HIGH,
      title: `CVD Divergence ⚠ — Giá ↓${Math.abs(priceDelta).toFixed(1)}% nhưng CVD ↑`,
      description: `Giá giảm nhưng dòng tiền mua ròng. CVD tăng +$${(cvdDelta / 1e6).toFixed(1)}M — có thể đang tích lũy.`,
    };
  }
  return null;
}

// ─── Main Engine Runner ───────────────────────────────────────────────────────

/**
 * Run all detection rules against current context.
 * Called periodically (every ~30s from the HFT tab).
 * 
 * @param {Object} ctx - All available data context
 * @returns {Promise<Array>} - Array of newly detected signals
 */
export async function runSignalDetection(ctx) {
  const detectors = [
    { fn: detectPriceSpike, cooldown: 3 * 60 * 1000 },       // 3 min cooldown
    { fn: detectFundingExtreme, cooldown: 15 * 60 * 1000 },   // 15 min
    { fn: detectOBIExtreme, cooldown: 5 * 60 * 1000 },        // 5 min
    { fn: detectWhaleWallShift, cooldown: 10 * 60 * 1000 },   // 10 min
    { fn: detectFnGExtreme, cooldown: 60 * 60 * 1000 },       // 1 hour
    { fn: detectOISurge, cooldown: 10 * 60 * 1000 },          // 10 min
    { fn: detectCVDDivergence, cooldown: 10 * 60 * 1000 },    // 10 min
  ];

  const snapshot = buildSnapshot(ctx);
  const newSignals = [];

  for (const { fn, cooldown } of detectors) {
    try {
      const result = fn(ctx);
      if (result && !isOnCooldown(result.type, cooldown)) {
        const signal = {
          ...result,
          timestamp: Date.now(),
          snapshot,
        };
        await addSignal(signal);
        newSignals.push(signal);
      }
    } catch (e) {
      console.warn('[SignalEngine] Detection error:', e);
    }
  }

  // Update prev values for next cycle
  if (ctx.livePrice != null) {
    prevValues.price = ctx.livePrice;
    prevValues.priceTimestamp = Date.now();
  }
  if (ctx.data?.openInterest != null) {
    prevValues.oiValue = ctx.data.openInterest;
    prevValues.oiTimestamp = Date.now();
  }
  if (ctx.cvd != null) {
    prevValues.cvd = ctx.cvd;
    prevValues.priceAtCvdCheck = ctx.livePrice;
  }

  return newSignals;
}

/**
 * Take a periodic snapshot of all indicators (every 15 min).
 * This is the main "log" function that ensures data is always recorded.
 * 
 * @param {Object} ctx - All available data context
 * @returns {Promise<Object|null>} - The saved signal, or null if skipped
 */
export async function takePeriodicSnapshot(ctx) {
  if (!ctx.livePrice) return null; // Don't snapshot if no price data

  const snapshot = buildSnapshot(ctx);
  const signal = {
    type: SIGNAL_TYPE.PERIODIC_SNAPSHOT,
    severity: SEVERITY.LOW,
    timestamp: Date.now(),
    title: `Snapshot — BTC $${ctx.livePrice?.toLocaleString() || '---'}`,
    description: buildSnapshotSummary(ctx),
    snapshot,
  };

  await addSignal(signal);
  return signal;
}

function buildSnapshotSummary(ctx) {
  const parts = [];
  if (ctx.livePrice) parts.push(`BTC: $${ctx.livePrice.toLocaleString()}`);
  if (ctx.liveChange != null) parts.push(`24h: ${ctx.liveChange >= 0 ? '+' : ''}${ctx.liveChange.toFixed(2)}%`);
  if (ctx.cvd != null) {
    const cvdSign = ctx.cvd >= 0 ? '+' : '-';
    const cvdAbs = Math.abs(ctx.cvd);
    const cvdStr = cvdAbs >= 1e9 ? `${(cvdAbs / 1e9).toFixed(2)}B` : cvdAbs >= 1e6 ? `${(cvdAbs / 1e6).toFixed(1)}M` : `${(cvdAbs / 1e3).toFixed(0)}K`;
    parts.push(`CVD: ${cvdSign}$${cvdStr}`);
  }
  const fr = ctx.fundingRate ?? ctx.data?.fundingRate;
  if (fr != null) parts.push(`FR: ${(fr * 100).toFixed(4)}%`);
  if (ctx.orderBook?.obiPercent != null) parts.push(`OBI: ${ctx.orderBook.obiPercent > 0 ? '+' : ''}${ctx.orderBook.obiPercent}%`);
  if (ctx.data?.fngData) parts.push(`F&G: ${ctx.data.fngData.value}`);
  return parts.join(' · ');
}
