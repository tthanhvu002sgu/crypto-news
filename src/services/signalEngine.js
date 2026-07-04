/**
 * Signal Engine — Detects notable market conditions and logs them with full indicator snapshots.
 *
 * Runs client-side, fed by WebSocket + REST data.
 * Produces signal objects: { timestamp, type, severity, title, description, snapshot }
 *
 * v2.0 — Event-driven multi-window price detection using a sliding ring-buffer.
 * Instead of comparing only against the "last cycle" value (which missed moves
 * spanning multiple cycles), a ring-buffer stores { price, cvd, buyVolume, sellVolume }
 * every 30 s. PRICE_SPIKE fires per time-window (1m / 5m / 15m / 30m) with
 * independent thresholds (absolute USD AND %). Each signal is enriched with:
 *   • CVD delta over the same window
 *   • OBI current state
 *   • Funding rate
 *   • Whale wall imbalance
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

function isOnCooldown(key, cooldownMs = 5 * 60 * 1000) {
  const lastFired = cooldowns.get(key) || 0;
  if (Date.now() - lastFired < cooldownMs) return true;
  cooldowns.set(key, Date.now());
  return false;
}

// ─── Sliding Price Ring-Buffer ─────────────────────────────────────────────────
// Stores one entry each time runSignalDetection is called (~every 30 s).
// 2 hours at 30 s cadence = 240 entries max.
const PRICE_HISTORY_MAX = 240;
const priceHistory = []; // [{ price, cvd, buyVolume, sellVolume, ts }]

function pushPriceHistory(ctx) {
  priceHistory.push({
    price: ctx.livePrice,
    cvd: ctx.cvd ?? null,
    buyVolume: ctx.buyVolume ?? null,
    sellVolume: ctx.sellVolume ?? null,
    ts: Date.now(),
  });
  if (priceHistory.length > PRICE_HISTORY_MAX) priceHistory.shift();
}

/**
 * Return the oldest ring-buffer entry that is AT LEAST windowMs ago.
 * Walks backward to find the entry closest to (now - windowMs).
 */
function getBaselineEntry(windowMs) {
  const cutoff = Date.now() - windowMs;
  for (let i = priceHistory.length - 1; i >= 0; i--) {
    if (priceHistory[i].ts <= cutoff) return priceHistory[i];
  }
  return null;
}

// ─── Slower-changing detector state (OI surge, CVD divergence) ────────────────
const prevValues = {
  oiValue: null,
  oiTimestamp: null,
  cvd: null,
  priceAtCvdCheck: null,
};

// ─── Helper: build full snapshot object ───────────────────────────────────────
function buildSnapshot(ctx, extra = {}) {
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

  // Merge window-specific deltas
  Object.assign(snap, extra);

  return snap;
}

// ─── Detection Rules ──────────────────────────────────────────────────────────

/**
 * Multi-window PRICE_SPIKE detection.
 * Fires independently per window; each has its own cooldown key so a 5m
 * signal does not suppress a 15m signal.
 *
 * Thresholds (fires when EITHER condition is met):
 *   1m:  ≥ $300 or ≥ 0.4%
 *   5m:  ≥ $500 or ≥ 0.7%
 *  15m:  ≥ $800 or ≥ 1.2%
 *  30m:  ≥ $1500 or ≥ 2.0%
 */
const PRICE_WINDOWS = [
  { label: '1 phút',  ms: 1 * 60 * 1000,  minUsd: 300,  minPct: 0.4,  cooldownKey: 'PRICE_SPIKE_1M',  cooldownMs: 2 * 60 * 1000 },
  { label: '5 phút',  ms: 5 * 60 * 1000,  minUsd: 500,  minPct: 0.7,  cooldownKey: 'PRICE_SPIKE_5M',  cooldownMs: 5 * 60 * 1000 },
  { label: '15 phút', ms: 15 * 60 * 1000, minUsd: 800,  minPct: 1.2,  cooldownKey: 'PRICE_SPIKE_15M', cooldownMs: 8 * 60 * 1000 },
  { label: '30 phút', ms: 30 * 60 * 1000, minUsd: 1500, minPct: 2.0,  cooldownKey: 'PRICE_SPIKE_30M', cooldownMs: 15 * 60 * 1000 },
];

function detectPriceSpikeMultiWindow(ctx) {
  if (!ctx.livePrice) return [];
  const results = [];

  for (const win of PRICE_WINDOWS) {
    const base = getBaselineEntry(win.ms);
    if (!base) continue;

    const usdDelta = ctx.livePrice - base.price;
    const pctDelta = (usdDelta / base.price) * 100;

    // Must exceed at least one threshold
    if (Math.abs(usdDelta) < win.minUsd && Math.abs(pctDelta) < win.minPct) continue;
    if (isOnCooldown(win.cooldownKey, win.cooldownMs)) continue;

    const direction = usdDelta > 0 ? '↑' : '↓';
    const absUsd = Math.abs(usdDelta);
    const absPct = Math.abs(pctDelta);
    const actualWindowMin = Math.round((Date.now() - base.ts) / 60000);

    // Severity by magnitude
    let severity;
    if (absUsd >= 2000 || absPct >= 3) severity = SEVERITY.CRITICAL;
    else if (absUsd >= 1000 || absPct >= 2) severity = SEVERITY.HIGH;
    else if (absUsd >= 500  || absPct >= 1) severity = SEVERITY.MEDIUM;
    else severity = SEVERITY.LOW;

    // CVD delta over the same window
    const cvdDelta = (ctx.cvd != null && base.cvd != null) ? ctx.cvd - base.cvd : null;
    const buyDelta  = (ctx.buyVolume  != null && base.buyVolume  != null) ? ctx.buyVolume  - base.buyVolume  : null;
    const sellDelta = (ctx.sellVolume != null && base.sellVolume != null) ? ctx.sellVolume - base.sellVolume : null;

    // Inline context notes for the description
    const cvdNote   = cvdDelta != null ? ` | CVD window: ${cvdDelta >= 0 ? '+' : ''}${(cvdDelta / 1e6).toFixed(1)}M` : '';
    const obiNote   = ctx.orderBook?.obiPercent != null ? ` | OBI: ${ctx.orderBook.obiPercent > 0 ? '+' : ''}${ctx.orderBook.obiPercent}%` : '';
    const fr        = ctx.fundingRate ?? ctx.data?.fundingRate;
    const frNote    = fr != null ? ` | FR: ${(fr * 100).toFixed(4)}%` : '';
    const whaleNote = ctx.whaleData?.bidWallTotal != null
      ? ` | BidWall: $${(ctx.whaleData.bidWallTotal / 1e6).toFixed(1)}M AskWall: $${(ctx.whaleData.askWallTotal / 1e6).toFixed(1)}M`
      : '';

    results.push({
      type: SIGNAL_TYPE.PRICE_SPIKE,
      severity,
      title: `Giá BTC ${direction}$${absUsd.toFixed(0)} (${direction}${absPct.toFixed(2)}%) trong ${win.label}`,
      description: `$${Math.round(base.price).toLocaleString()} → $${Math.round(ctx.livePrice).toLocaleString()} (${actualWindowMin} phút thực tế)${cvdNote}${obiNote}${frNote}${whaleNote}`,
      // Extra fields merged into snapshot
      _extra: {
        priceWindow: win.label,
        priceUsdDelta: parseFloat(usdDelta.toFixed(0)),
        pricePctDelta: parseFloat(pctDelta.toFixed(3)),
        priceBase: Math.round(base.price),
        priceCurrent: Math.round(ctx.livePrice),
        cvdDeltaWindow: cvdDelta != null ? Math.round(cvdDelta) : null,
        cvdBuyDeltaWindow: buyDelta  != null ? Math.round(buyDelta)  : null,
        cvdSellDeltaWindow: sellDelta != null ? Math.round(sellDelta) : null,
        windowActualMin: actualWindowMin,
      },
    });
  }

  return results;
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
  if (!ctx.livePrice) return [];

  // Push current reading into ring-buffer BEFORE detection runs
  pushPriceHistory(ctx);

  const newSignals = [];

  // ── Multi-window price spikes (array) ─────────────────────────────────────
  const spikes = detectPriceSpikeMultiWindow(ctx);
  for (const spike of spikes) {
    const { _extra, ...signalBase } = spike;
    const snapshot = buildSnapshot(ctx, _extra);
    const signal = { ...signalBase, timestamp: Date.now(), snapshot };
    try {
      await addSignal(signal);
      newSignals.push(signal);
    } catch (e) {
      console.warn('[SignalEngine] addSignal error (spike):', e);
    }
  }

  // ── Single-result detectors ────────────────────────────────────────────────
  const snapshot = buildSnapshot(ctx);
  const singleDetectors = [
    { fn: detectFundingExtreme, cooldownKey: SIGNAL_TYPE.FUNDING_EXTREME, cooldownMs: 15 * 60 * 1000 },
    { fn: detectOBIExtreme,     cooldownKey: SIGNAL_TYPE.OBI_EXTREME,     cooldownMs: 5  * 60 * 1000 },
    { fn: detectWhaleWallShift, cooldownKey: SIGNAL_TYPE.WHALE_WALL_SHIFT, cooldownMs: 10 * 60 * 1000 },
    { fn: detectFnGExtreme,     cooldownKey: SIGNAL_TYPE.FNG_EXTREME,     cooldownMs: 60 * 60 * 1000 },
    { fn: detectOISurge,        cooldownKey: SIGNAL_TYPE.OI_SURGE,        cooldownMs: 10 * 60 * 1000 },
    { fn: detectCVDDivergence,  cooldownKey: SIGNAL_TYPE.CVD_DIVERGENCE,  cooldownMs: 10 * 60 * 1000 },
  ];

  for (const { fn, cooldownKey, cooldownMs } of singleDetectors) {
    try {
      const result = fn(ctx);
      if (result && !isOnCooldown(cooldownKey, cooldownMs)) {
        const signal = { ...result, timestamp: Date.now(), snapshot };
        await addSignal(signal);
        newSignals.push(signal);
      }
    } catch (e) {
      console.warn('[SignalEngine] Detection error:', e);
    }
  }

  // Update state for slower-changing detectors
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
 * Enriched with price-window deltas from the ring-buffer so the snapshot
 * shows how much price moved in the last 1/5/15/30 minutes.
 *
 * @param {Object} ctx - All available data context
 * @returns {Promise<Object|null>} - The saved signal, or null if skipped
 */
export async function takePeriodicSnapshot(ctx) {
  if (!ctx.livePrice) return null;

  // Compute window deltas from ring-buffer
  const windowDeltas = {};
  for (const win of PRICE_WINDOWS) {
    const base = getBaselineEntry(win.ms);
    if (!base) continue;
    const usd = ctx.livePrice - base.price;
    const pct = (usd / base.price) * 100;
    const cvd = ctx.cvd != null && base.cvd != null ? ctx.cvd - base.cvd : null;
    const key  = win.label.replace(' ', '_');
    windowDeltas[`delta_${key}_usd`] = parseFloat(usd.toFixed(0));
    windowDeltas[`delta_${key}_pct`] = parseFloat(pct.toFixed(3));
    if (cvd != null) windowDeltas[`delta_${key}_cvd`] = Math.round(cvd);
  }

  const snapshot = buildSnapshot(ctx, windowDeltas);

  // Build description with notable window moves
  const notableLines = [];
  for (const win of PRICE_WINDOWS) {
    const key = win.label.replace(' ', '_');
    const usd = windowDeltas[`delta_${key}_usd`];
    const pct = windowDeltas[`delta_${key}_pct`];
    const cvd = windowDeltas[`delta_${key}_cvd`];
    if (usd != null && Math.abs(usd) >= 200) {
      const dir = usd > 0 ? '↑' : '↓';
      const cvdNote = cvd != null ? ` CVD:${cvd >= 0 ? '+' : ''}${(cvd / 1e6).toFixed(1)}M` : '';
      notableLines.push(`${win.label}: ${dir}$${Math.abs(usd).toLocaleString()} (${pct >= 0 ? '+' : ''}${pct}%)${cvdNote}`);
    }
  }

  const description = buildSnapshotSummary(ctx)
    + (notableLines.length > 0 ? '\n' + notableLines.join(' · ') : '');

  // Elevate severity if a notable move happened in last 15m
  const move15mUsd = Math.abs(windowDeltas['delta_15_phút_usd'] ?? 0);
  const severity = move15mUsd >= 800 ? SEVERITY.HIGH
    : move15mUsd >= 300 ? SEVERITY.MEDIUM
    : SEVERITY.LOW;

  const signal = {
    type: SIGNAL_TYPE.PERIODIC_SNAPSHOT,
    severity,
    timestamp: Date.now(),
    title: `Snapshot — BTC $${ctx.livePrice?.toLocaleString() || '---'}`,
    description,
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
