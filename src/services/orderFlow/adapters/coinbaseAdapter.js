import { createNormalizedTrade } from '../normalizedTrade.js';

export function parseCoinbaseTrades(message, { source = 'live', receivedAt = Date.now() } = {}) {
  const events = Array.isArray(message?.events) ? message.events : [];
  const rows = events.flatMap((event) => Array.isArray(event?.trades) ? event.trades : []);
  return rows.map((row) => createNormalizedTrade({
    venue: 'coinbase', market: 'spot', instrument: row.product_id || 'BTC-USD',
    tradeId: row.trade_id, sequence: message?.sequence_num,
    timestamp: Date.parse(row.time), receivedAt,
    price: row.price, baseQuantity: row.size, quoteCurrency: 'USD',
    // Coinbase documents side as the maker side; aggressor side is inverse.
    aggressorSide: String(row.side).toUpperCase() === 'BUY' ? 'sell' : 'buy',
    source,
  })).filter(Boolean);
}
