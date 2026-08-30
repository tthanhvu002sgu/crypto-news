export const ORDER_FLOW_MARKETS = Object.freeze(['spot', 'futures']);
export const ORDER_FLOW_SIDES = Object.freeze(['buy', 'sell']);

const finitePositive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function createNormalizedTrade(input = {}) {
  const venue = String(input.venue || '').toLowerCase();
  const market = String(input.market || '').toLowerCase();
  const instrument = String(input.instrument || 'BTC').toUpperCase();
  const tradeId = String(input.tradeId ?? '');
  const timestamp = Number(input.timestamp);
  const price = finitePositive(input.price);
  const baseQuantity = finitePositive(input.baseQuantity);
  const aggressorSide = String(input.aggressorSide || '').toLowerCase();

  if (!venue || !ORDER_FLOW_MARKETS.includes(market) || !tradeId) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || price == null || baseQuantity == null) return null;
  if (!ORDER_FLOW_SIDES.includes(aggressorSide)) return null;

  const quoteNotionalUsdEq = finitePositive(input.quoteNotionalUsdEq) ?? (price * baseQuantity);
  return {
    eventKey: `${venue}:${market}:${instrument}:${tradeId}`,
    venue,
    market,
    instrument,
    tradeId,
    sequence: input.sequence == null ? null : String(input.sequence),
    timestamp,
    receivedAt: Number(input.receivedAt) || Date.now(),
    price,
    baseQuantity,
    quoteNotionalUsdEq,
    quoteCurrency: String(input.quoteCurrency || 'USD').toUpperCase(),
    aggressorSide,
    source: input.source === 'backfill' ? 'backfill' : 'live',
    contractMetaVersion: input.contractMetaVersion || null,
  };
}

export const tradeDelta = (trade) => trade?.aggressorSide === 'buy'
  ? Number(trade.quoteNotionalUsdEq) || 0
  : -(Number(trade?.quoteNotionalUsdEq) || 0);
