import { createNormalizedTrade } from '../normalizedTrade.js';

export function parseBybitTrades(message, { market = 'spot', source = 'live', receivedAt = Date.now() } = {}) {
  const rows = Array.isArray(message?.data) ? message.data : [];
  return rows.map((row) => createNormalizedTrade({
    venue: 'bybit', market, instrument: row.s || 'BTCUSDT',
    tradeId: row.i, sequence: row.seq ?? message?.seq,
    timestamp: row.T, receivedAt,
    price: row.p, baseQuantity: row.v,
    quoteCurrency: 'USDT', aggressorSide: String(row.S).toLowerCase(), source,
  })).filter(Boolean);
}
