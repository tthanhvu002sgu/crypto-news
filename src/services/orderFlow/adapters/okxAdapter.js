import { createNormalizedTrade } from '../normalizedTrade.js';

export function parseOkxTrades(message, {
  market = 'spot', source = 'live', receivedAt = Date.now(), contractMeta = null,
} = {}) {
  const rows = Array.isArray(message?.data) ? message.data : [];
  return rows.map((row) => {
    const price = Number(row.px);
    const rawSize = Number(row.sz);
    let baseQuantity = rawSize;
    let contractMetaVersion = null;
    if (market === 'futures') {
      const contractValue = Number(contractMeta?.ctVal);
      if (!Number.isFinite(contractValue) || contractValue <= 0) return null;
      baseQuantity = rawSize * contractValue;
      contractMetaVersion = `${contractMeta.instId || row.instId}:${contractMeta.ctVal}:${contractMeta.ctValCcy || 'BTC'}`;
    }
    return createNormalizedTrade({
      venue: 'okx', market, instrument: row.instId || message?.arg?.instId,
      tradeId: row.tradeId, sequence: row.seqId ?? message?.seqId,
      timestamp: row.ts, receivedAt, price, baseQuantity,
      quoteCurrency: 'USDT', aggressorSide: row.side, source, contractMetaVersion,
    });
  }).filter(Boolean);
}
