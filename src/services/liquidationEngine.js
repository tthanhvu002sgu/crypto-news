/**
 * Pure calculation and parser engine for Binance Futures real-time liquidations (btcusdt@forceOrder).
 * NO React dependencies, NO network side effects.
 */

/**
 * Parses Binance Futures forceOrder stream payload.
 *
 * In Binance Futures forceOrder:
 * - o.S === 'SELL': The liquidation engine submitted a market SELL order to close a LONG position.
 *                   -> Position Liquidated: 'LONG'
 * - o.S === 'BUY' : The liquidation engine submitted a market BUY order to close a SHORT position.
 *                   -> Position Liquidated: 'SHORT'
 *
 * @param {Object} msg - Raw or wrapped websocket message
 * @returns {Object|null} Normalized liquidation event
 */
export function parseForceOrderMessage(msg) {
  if (!msg) return null;

  // Handle wrapped combined-stream { stream, data } or direct payload
  const raw = msg.data || msg;
  const o = raw.o;

  if (!o || !o.s || !o.S) {
    return null;
  }

  const symbol = String(o.s).toUpperCase();
  const orderSide = String(o.S).toUpperCase(); // 'BUY' | 'SELL'
  const positionSide = orderSide === 'SELL' ? 'LONG' : 'SHORT';

  const price = parseFloat(o.ap || o.p || 0);
  const avgPrice = parseFloat(o.ap || o.p || 0);
  const qty = parseFloat(o.q || o.l || o.z || 0);
  const usdValue = price * qty;

  const timestamp = Number(o.T || raw.E || Date.now());
  const time = new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const id = `liq_${timestamp}_${price.toFixed(1)}_${qty.toFixed(4)}_${orderSide}`;

  return {
    id,
    symbol,
    orderSide,
    positionSide,
    side: orderSide,
    posSide: positionSide,
    price,
    avgPrice,
    qty,
    usdValue,
    usdtVol: usdValue,
    timestamp,
    time,
  };
}

/**
 * Aggregates liquidation events across a rolling time window.
 *
 * @param {Array<Object>} events - Array of parsed liquidation events
 * @param {number} [now=Date.now()] - Current epoch timestamp in ms
 * @param {number} [windowMs=300000] - Rolling window duration in ms (default 5 minutes)
 * @returns {Object} Aggregated liquidation metrics
 */
export function aggregateLiquidations(events, now = Date.now(), windowMs = 300_000) {
  const result = {
    windowMs,
    longLiqUsd: 0,
    shortLiqUsd: 0,
    totalLiqUsd: 0,
    netLiqDelta: 0, // shortLiqUsd - longLiqUsd (>0: shorts squeezed; <0: longs flushed)
    longLiqCount: 0,
    shortLiqCount: 0,
    totalCount: 0,
    maxSingleLiqUsd: 0,
    maxSingleLiqSide: null,
    dominanceLabel: 'QUIET', // 'SHORT_SQUEEZE' | 'LONG_FLUSH' | 'BALANCED' | 'QUIET'
  };

  if (!Array.isArray(events) || events.length === 0) {
    return result;
  }

  const cutoff = now - windowMs;
  const maxFutureTs = now + 60_000; // allow up to 60s client-server clock drift

  for (const item of events) {
    if (!item) continue;
    const ts = Number(item.timestamp || 0);
    if (ts < cutoff || ts > maxFutureTs) continue;

    const usd = Number(item.usdValue ?? item.usdtVol ?? 0);
    const pos = item.positionSide || item.posSide;

    if (pos === 'LONG') {
      result.longLiqUsd += usd;
      result.longLiqCount += 1;
    } else if (pos === 'SHORT') {
      result.shortLiqUsd += usd;
      result.shortLiqCount += 1;
    }

    if (usd > result.maxSingleLiqUsd) {
      result.maxSingleLiqUsd = usd;
      result.maxSingleLiqSide = pos;
    }
  }

  result.totalLiqUsd = result.longLiqUsd + result.shortLiqUsd;
  result.netLiqDelta = result.shortLiqUsd - result.longLiqUsd;
  result.totalCount = result.longLiqCount + result.shortLiqCount;

  // Classify dominance regime
  if (result.totalLiqUsd === 0 || result.totalCount === 0) {
    result.dominanceLabel = 'QUIET';
  } else if (result.shortLiqUsd >= result.totalLiqUsd * 0.65 && result.totalLiqUsd >= 50_000) {
    result.dominanceLabel = 'SHORT_SQUEEZE';
  } else if (result.longLiqUsd >= result.totalLiqUsd * 0.65 && result.totalLiqUsd >= 50_000) {
    result.dominanceLabel = 'LONG_FLUSH';
  } else {
    result.dominanceLabel = 'BALANCED';
  }

  // Schema aliases for UI compatibility (WhaleTradesPanel & MoveTrackerPanel)
  result.totalUsd = result.totalLiqUsd;
  result.longUsd = result.longLiqUsd;
  result.shortUsd = result.shortLiqUsd;
  result.longCount = result.longLiqCount;
  result.shortCount = result.shortLiqCount;
  result.count = result.totalCount;
  result.longRatio = result.totalLiqUsd > 0 ? result.longLiqUsd / result.totalLiqUsd : 0.5;
  result.shortRatio = result.totalLiqUsd > 0 ? result.shortLiqUsd / result.totalLiqUsd : 0.5;
  result.dominantSide = result.dominanceLabel === 'SHORT_SQUEEZE'
    ? 'SHORT'
    : result.dominanceLabel === 'LONG_FLUSH'
    ? 'LONG'
    : null;

  return result;
}

/**
 * Formats USD value into compact string ($1.2M, $450K, $12K)
 * @param {number} val
 * @returns {string}
 */
export function formatLiqUsd(val) {
  if (val == null || !Number.isFinite(val)) return '$0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
