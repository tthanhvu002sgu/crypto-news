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

/**
 * Parses Coinalyze `/v1/liquidation-history` response array into normalized hourly/daily points.
 *
 * Coinalyze schema: `[{ symbol: "BTCUSDT_PERP.A", history: [{ t: 1700000000, l: 120000, s: 80000 }] }]`
 * where `t` is UNIX epoch in seconds, `l` is Long liquidations, `s` is Short liquidations.
 *
 * @param {Array<Object>} payload
 * @returns {{ symbol: string, history: Array<Object> }}
 */
export function parseCoinalyzeLiquidationHistory(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { symbol: '', history: [] };
  }

  const entry = payload[0] || {};
  const symbol = String(entry.symbol || '');
  const rawHistory = Array.isArray(entry.history) ? entry.history : [];

  const history = rawHistory
    .filter((pt) => pt && Number.isFinite(Number(pt.t)))
    .map((pt) => {
      const timestamp = Number(pt.t) * 1000;
      const longUsd = Math.max(0, Number(pt.l) || 0);
      const shortUsd = Math.max(0, Number(pt.s) || 0);
      return {
        timestamp,
        longUsd,
        shortUsd,
        totalUsd: longUsd + shortUsd,
        netDelta: shortUsd - longUsd,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return { symbol, history };
}

function summarizeWindow(history, cutoffMs, nowMs) {
  let longUsd = 0;
  let shortUsd = 0;
  let bucketCount = 0;

  for (const pt of history) {
    if (!pt) continue;
    if (pt.timestamp < cutoffMs || pt.timestamp > nowMs + 3600_000) continue;
    longUsd += pt.longUsd || 0;
    shortUsd += pt.shortUsd || 0;
    bucketCount += 1;
  }

  const totalUsd = longUsd + shortUsd;
  const netDelta = shortUsd - longUsd;
  const longRatio = totalUsd > 0 ? longUsd / totalUsd : 0.5;
  const shortRatio = totalUsd > 0 ? shortUsd / totalUsd : 0.5;

  let dominanceLabel = 'QUIET';
  if (totalUsd > 0 && bucketCount > 0) {
    if (shortUsd >= totalUsd * 0.6) dominanceLabel = 'SHORT_SQUEEZE';
    else if (longUsd >= totalUsd * 0.6) dominanceLabel = 'LONG_FLUSH';
    else dominanceLabel = 'BALANCED';
  }

  return {
    longUsd,
    shortUsd,
    totalUsd,
    netDelta,
    longRatio,
    shortRatio,
    dominanceLabel,
    bucketCount,
  };
}

/**
 * Summarizes Coinalyze historical liquidations across 24h, 7d, and 30d rolling windows.
 *
 * @param {Array<Object>} history - Output of parseCoinalyzeLiquidationHistory().history
 * @param {number} [nowMs=Date.now()]
 * @returns {{ h24: Object, d7: Object, d30: Object }}
 */
export function summarizeHistoricalLiquidations(history, nowMs = Date.now()) {
  const list = Array.isArray(history) ? history : [];
  const HOUR = 3600_000;
  return {
    h24: summarizeWindow(list, nowMs - 24 * HOUR, nowMs),
    d7: summarizeWindow(list, nowMs - 7 * 24 * HOUR, nowMs),
    d30: summarizeWindow(list, nowMs - 30 * 24 * HOUR, nowMs),
  };
}

/**
 * Aggregates Coinalyze hourly liquidation points into chart-ready time buckets.
 * - '24h': hourly buckets over last 24h
 * - '7d': daily (UTC) buckets over last 7d
 * - '30d': daily (UTC) buckets over last 30d
 *
 * @param {Array<Object>} history
 * @param {'24h'|'7d'|'30d'} timeframe
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<{ timestamp: number, label: string, longUsd: number, shortUsd: number, totalUsd: number }>}
 */
export function bucketHistoricalLiquidations(history, timeframe = '24h', nowMs = Date.now()) {
  if (!Array.isArray(history) || history.length === 0) return [];

  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  const windowMs = timeframe === '30d' ? 30 * DAY : timeframe === '7d' ? 7 * DAY : 24 * HOUR;
  const cutoff = nowMs - windowMs;

  if (timeframe === '24h') {
    return history
      .filter((pt) => pt.timestamp >= cutoff && pt.timestamp <= nowMs + HOUR)
      .map((pt) => {
        const d = new Date(pt.timestamp);
        const label = `${String(d.getHours()).padStart(2, '0')}:00`;
        return {
          timestamp: pt.timestamp,
          label,
          longUsd: pt.longUsd,
          shortUsd: pt.shortUsd,
          totalUsd: pt.totalUsd,
        };
      });
  }

  // Group by UTC day for 7d and 30d
  const byDay = new Map();
  for (const pt of history) {
    if (pt.timestamp < cutoff || pt.timestamp > nowMs + HOUR) continue;
    const d = new Date(pt.timestamp);
    const dayKey = d.toISOString().slice(0, 10);
    const existing = byDay.get(dayKey);
    if (existing) {
      existing.longUsd += pt.longUsd;
      existing.shortUsd += pt.shortUsd;
      existing.totalUsd += pt.totalUsd;
    } else {
      const mmdd = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      byDay.set(dayKey, {
        timestamp: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        label: mmdd,
        longUsd: pt.longUsd,
        shortUsd: pt.shortUsd,
        totalUsd: pt.totalUsd,
      });
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.timestamp - b.timestamp);
}
