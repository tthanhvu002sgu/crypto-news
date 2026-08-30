import { tradeDelta } from './normalizedTrade.js';

export const MINUTE_MS = 60_000;
export const TIMEFRAME_CONFIG = Object.freeze({
  '1H': { windowMs: 60 * MINUTE_MS, bucketMs: MINUTE_MS, expectedPoints: 60 },
  '24H': { windowMs: 24 * 60 * MINUTE_MS, bucketMs: 60 * MINUTE_MS, expectedPoints: 24 },
  '7D': { windowMs: 7 * 24 * 60 * MINUTE_MS, bucketMs: 4 * 60 * MINUTE_MS, expectedPoints: 42 },
  '30D': { windowMs: 30 * 24 * 60 * MINUTE_MS, bucketMs: 24 * 60 * MINUTE_MS, expectedPoints: 30 },
});

const emptyBucket = (market, timestamp) => ({
  id: `${market}:${timestamp}`, market, timestamp,
  buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, tradeCount: 0,
  open: null, high: null, low: null, close: null,
  venues: {}, updatedAt: 0,
});

export function applyTradeToAggregates(trade, bucketMap, footprintMap, priceBinSize = 10) {
  const minute = Math.floor(trade.timestamp / MINUTE_MS) * MINUTE_MS;
  const bucketKey = `${trade.market}:${minute}`;
  const bucket = bucketMap.get(bucketKey) || emptyBucket(trade.market, minute);
  const notional = Number(trade.quoteNotionalUsdEq) || 0;
  const delta = tradeDelta(trade);
  bucket.buyVol += delta > 0 ? notional : 0;
  bucket.sellVol += delta < 0 ? notional : 0;
  bucket.delta += delta;
  bucket.totalVol += notional;
  bucket.tradeCount += 1;
  bucket.open ??= trade.price;
  bucket.high = bucket.high == null ? trade.price : Math.max(bucket.high, trade.price);
  bucket.low = bucket.low == null ? trade.price : Math.min(bucket.low, trade.price);
  bucket.close = trade.price;
  bucket.updatedAt = Math.max(bucket.updatedAt, trade.receivedAt || Date.now());
  const venue = bucket.venues[trade.venue] || { buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, tradeCount: 0 };
  venue.buyVol += delta > 0 ? notional : 0;
  venue.sellVol += delta < 0 ? notional : 0;
  venue.delta += delta;
  venue.totalVol += notional;
  venue.tradeCount += 1;
  bucket.venues[trade.venue] = venue;
  bucketMap.set(bucketKey, bucket);

  const price = Math.floor(trade.price / priceBinSize) * priceBinSize;
  const footprintKey = `${trade.market}:${minute}:${price}`;
  const footprint = footprintMap.get(footprintKey) || {
    id: footprintKey, market: trade.market, timestamp: minute, price,
    buy: 0, sell: 0, tradeCount: 0, venues: {}, updatedAt: 0,
  };
  footprint.buy += delta > 0 ? notional : 0;
  footprint.sell += delta < 0 ? notional : 0;
  footprint.tradeCount += 1;
  footprint.venues[trade.venue] = (footprint.venues[trade.venue] || 0) + delta;
  footprint.updatedAt = Math.max(footprint.updatedAt, trade.receivedAt || Date.now());
  footprintMap.set(footprintKey, footprint);
  return { bucket, footprint };
}

function aggregateBuckets(rows, market, start, bucketMs) {
  const grouped = new Map();
  for (const row of rows) {
    if (row.market !== market || row.timestamp < start) continue;
    const time = Math.floor(row.timestamp / bucketMs) * bucketMs;
    const item = grouped.get(time) || emptyBucket(market, time);
    item.buyVol += row.buyVol || 0;
    item.sellVol += row.sellVol || 0;
    item.delta += row.delta || 0;
    item.totalVol += row.totalVol || 0;
    item.tradeCount += row.tradeCount || 0;
    item.open ??= row.open;
    if (row.high != null) item.high = item.high == null ? row.high : Math.max(item.high, row.high);
    if (row.low != null) item.low = item.low == null ? row.low : Math.min(item.low, row.low);
    item.close = row.close ?? item.close;
    item.updatedAt = Math.max(item.updatedAt, row.updatedAt || 0);
    for (const [venueKey, stats] of Object.entries(row.venues || {})) {
      const venue = item.venues[venueKey] || { buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, tradeCount: 0 };
      venue.buyVol += stats.buyVol || 0;
      venue.sellVol += stats.sellVol || 0;
      venue.delta += stats.delta || 0;
      venue.totalVol += stats.totalVol || 0;
      venue.tradeCount += stats.tradeCount || 0;
      item.venues[venueKey] = venue;
    }
    grouped.set(time, item);
  }
  return [...grouped.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function buildAggregateSeries(bucketRows, market, timeframe = '24H', now = Date.now()) {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['24H'];
  const end = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const start = end - config.windowMs;
  const grouped = aggregateBuckets(bucketRows, market, start, config.bucketMs).slice(-config.expectedPoints);
  let cumulative = 0;
  const points = grouped.map((row) => {
    cumulative += row.delta;
    return {
      time: row.timestamp, timestamp: row.timestamp, delta: row.delta,
      cumulativeWithinWindow: cumulative, cvd: cumulative,
      buyVol: row.buyVol, sellVol: row.sellVol, price: row.close,
      isClosed: row.timestamp + config.bucketMs <= end,
      venues: row.venues,
    };
  });
  const minuteCoverage = new Set(bucketRows.filter((row) => row.market === market && row.timestamp >= start).map((row) => row.timestamp)).size;
  const expectedMinutes = Math.round(config.windowMs / MINUTE_MS);
  const buyVol = points.reduce((sum, point) => sum + point.buyVol, 0);
  const sellVol = points.reduce((sum, point) => sum + point.sellVol, 0);
  return {
    market, timeframe, points, chartList: points, windowNetDelta: cumulative, netDelta: cumulative,
    displayVol: { buy: buyVol, sell: sellVol },
    coverage: Math.min(100, (minuteCoverage / expectedMinutes) * 100),
    isComplete: minuteCoverage >= expectedMinutes,
    asOf: points.at(-1)?.timestamp ?? null,
  };
}

export function buildCustomAggregateSeries(bucketRows, market, bucketMs, lookbackBuckets = 120, now = Date.now()) {
  const end = Math.floor(now / bucketMs) * bucketMs;
  const start = end - (bucketMs * lookbackBuckets);
  let cumulative = 0;
  return aggregateBuckets(bucketRows, market, start, bucketMs)
    .filter((row) => row.timestamp + bucketMs <= end)
    .slice(-lookbackBuckets)
    .map((row) => {
      cumulative += row.delta;
      return {
        time: row.timestamp,
        timestamp: row.timestamp,
        delta: row.delta,
        cumulativeWithinWindow: cumulative,
        cvd: cumulative,
        buyVol: row.buyVol,
        sellVol: row.sellVol,
        price: row.close,
        isClosed: true,
        venues: row.venues,
      };
    });
}

export function buildFootprintNodes(footprintRows, market, timeframe = '24H', gap = 10, now = Date.now()) {
  const config = TIMEFRAME_CONFIG[timeframe] || TIMEFRAME_CONFIG['24H'];
  const start = now - config.windowMs;
  const grouped = new Map();
  for (const row of footprintRows) {
    if (row.market !== market || row.timestamp < start) continue;
    const price = Math.floor(row.price / gap) * gap;
    const node = grouped.get(price) || { price, priceHigh: price + gap - 1, buy: 0, sell: 0, tradeCount: 0 };
    node.buy += row.buy || 0;
    node.sell += row.sell || 0;
    node.tradeCount += row.tradeCount || 0;
    grouped.set(price, node);
  }
  return [...grouped.values()].sort((a, b) => b.price - a.price);
}

export function summarizeVenueContribution(series) {
  const result = {};
  for (const point of series?.points || []) {
    for (const [venueKey, stats] of Object.entries(point.venues || {})) {
      const venue = result[venueKey] || { venue: venueKey, buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, tradeCount: 0 };
      venue.buyVol += stats.buyVol || 0;
      venue.sellVol += stats.sellVol || 0;
      venue.delta += stats.delta || 0;
      venue.totalVol += stats.totalVol || 0;
      venue.tradeCount += stats.tradeCount || 0;
      result[venueKey] = venue;
    }
  }
  const total = Object.values(result).reduce((sum, venue) => sum + venue.totalVol, 0);
  return Object.values(result).map((venue) => ({
    ...venue, sharePct: total > 0 ? (venue.totalVol / total) * 100 : 0,
    direction: venue.delta > 0 ? 'buy' : venue.delta < 0 ? 'sell' : 'neutral',
  })).sort((a, b) => b.totalVol - a.totalVol);
}
