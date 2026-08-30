import { parseBinanceTrade } from './adapters/binanceAdapter.js';
import { parseBybitTrades } from './adapters/bybitAdapter.js';
import { parseOkxTrades } from './adapters/okxAdapter.js';
import { parseCoinbaseTrades } from './adapters/coinbaseAdapter.js';

async function getJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: options.headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOkxSwapMeta() {
  const payload = await getJson('https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP');
  return payload?.data?.[0] || null;
}

export async function recoverRecentTrades(stream, checkpoint, { contractMeta = null } = {}) {
  const since = Number(checkpoint?.timestamp) || 0;
  const sourceOptions = { market: stream.market, source: 'backfill', contractMeta };
  let rows = [];
  let bounded = false;

  if (stream.venue === 'binance') {
    const base = stream.market === 'spot' ? 'https://api.binance.com/api/v3/aggTrades' : 'https://fapi.binance.com/fapi/v1/aggTrades';
    const fromId = checkpoint?.tradeId && /^\d+$/.test(String(checkpoint.tradeId)) ? Number(checkpoint.tradeId) + 1 : null;
    let cursor = fromId;
    for (let page = 0; page < (fromId == null ? 1 : 10); page += 1) {
      const url = `${base}?symbol=BTCUSDT&limit=1000${cursor != null ? `&fromId=${cursor}` : ''}`;
      const payload = await getJson(url);
      const pageRows = (Array.isArray(payload) ? payload : []).map((row) => parseBinanceTrade(row, sourceOptions)).filter(Boolean);
      rows.push(...pageRows);
      if (pageRows.length < 1000) { bounded = false; break; }
      bounded = fromId != null;
      const next = Number(pageRows.at(-1)?.tradeId) + 1;
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
    }
  } else if (stream.venue === 'bybit') {
    const limit = stream.market === 'spot' ? 60 : 1000;
    const category = stream.market === 'spot' ? 'spot' : 'linear';
    const payload = await getJson(`https://api.bybit.com/v5/market/recent-trade?category=${category}&symbol=BTCUSDT&limit=${limit}`);
    rows = parseBybitTrades({ data: (payload?.result?.list || []).map((row) => ({
      i: row.execId, T: row.time, p: row.price, v: row.size, S: row.side, s: row.symbol, seq: row.seq,
    })) }, sourceOptions);
    bounded = Boolean(checkpoint && rows.length >= limit);
  } else if (stream.venue === 'okx') {
    const payload = await getJson(`https://www.okx.com/api/v5/market/trades?instId=${encodeURIComponent(stream.instrument)}&limit=500`);
    rows = parseOkxTrades({ data: payload?.data || [] }, sourceOptions);
    bounded = Boolean(checkpoint && rows.length >= 500);
  } else if (stream.venue === 'coinbase') {
    const payload = await getJson('https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000', { headers: { Accept: 'application/json' } });
    rows = parseCoinbaseTrades({ events: [{ trades: (Array.isArray(payload) ? payload : []).map((row) => ({ ...row, product_id: 'BTC-USD', side: String(row.side).toUpperCase() })) }] }, sourceOptions);
    bounded = Boolean(checkpoint && rows.length >= 1000);
  }

  rows = rows.filter((trade) => trade.timestamp >= since && !(trade.timestamp === since && String(trade.tradeId) === String(checkpoint?.tradeId)))
    .sort((a, b) => a.timestamp - b.timestamp || String(a.tradeId).localeCompare(String(b.tradeId)));
  return { trades: rows, bounded, recoveredFrom: since, recoveredTo: rows.at(-1)?.timestamp ?? since };
}
