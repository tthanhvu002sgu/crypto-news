import { createNormalizedTrade } from '../normalizedTrade.js';

export function parseBinanceTrade(message, { market = 'spot', source = 'live', receivedAt = Date.now() } = {}) {
  const data = message?.data || message;
  if (!data) return null;
  return createNormalizedTrade({
    venue: 'binance', market, instrument: data.s || 'BTCUSDT',
    tradeId: data.a ?? data.id, sequence: data.l ?? data.a,
    timestamp: data.T ?? data.time, receivedAt,
    price: data.p ?? data.price, baseQuantity: data.q ?? data.qty,
    quoteCurrency: 'USDT',
    aggressorSide: (data.m ?? data.isBuyerMaker) ? 'sell' : 'buy',
    source,
  });
}
