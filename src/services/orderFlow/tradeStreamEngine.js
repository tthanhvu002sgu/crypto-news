import { applyTradeToAggregates, buildAggregateSeries, buildCustomAggregateSeries, buildFootprintNodes, summarizeVenueContribution } from './orderFlowAggregator.js';
import { detectPriceCvdDivergences, detectSpotFuturesDivergence } from './divergenceDetector.js';
import { OrderFlowStore } from './orderFlowStore.js';
import { parseBinanceTrade } from './adapters/binanceAdapter.js';
import { parseBybitTrades } from './adapters/bybitAdapter.js';
import { parseOkxTrades } from './adapters/okxAdapter.js';
import { parseCoinbaseTrades } from './adapters/coinbaseAdapter.js';
import { fetchOkxSwapMeta, recoverRecentTrades } from './tradeGapRecovery.js';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FLUSH_MS = 2000;
const NOTIFY_MS = 500;
const RECONNECT_MS = 4000;
const MAX_DEDUPE = 200_000;

const STREAMS = [
  { key: 'binance:spot', venue: 'binance', market: 'spot', instrument: 'BTCUSDT', url: 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade' },
  { key: 'binance:futures', venue: 'binance', market: 'futures', instrument: 'BTCUSDT', url: 'wss://fstream.binance.com/stream?streams=btcusdt@aggTrade' },
  { key: 'bybit:spot', venue: 'bybit', market: 'spot', instrument: 'BTCUSDT', url: 'wss://stream.bybit.com/v5/public/spot', subscribe: { op: 'subscribe', args: ['publicTrade.BTCUSDT'] } },
  { key: 'bybit:futures', venue: 'bybit', market: 'futures', instrument: 'BTCUSDT', url: 'wss://stream.bybit.com/v5/public/linear', subscribe: { op: 'subscribe', args: ['publicTrade.BTCUSDT'] } },
  { key: 'okx:spot', venue: 'okx', market: 'spot', instrument: 'BTC-USDT', url: 'wss://ws.okx.com:8443/ws/v5/public', subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT' }] } },
  { key: 'okx:futures', venue: 'okx', market: 'futures', instrument: 'BTC-USDT-SWAP', url: 'wss://ws.okx.com:8443/ws/v5/public', subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT-SWAP' }] } },
  { key: 'coinbase:spot', venue: 'coinbase', market: 'spot', instrument: 'BTC-USD', url: 'wss://advanced-trade-ws.coinbase.com', subscribe: { type: 'subscribe', product_ids: ['BTC-USD'], channel: 'market_trades' } },
];

export class TradeStreamEngine {
  constructor({ store = new OrderFlowStore(), webSocketFactory = (url) => new WebSocket(url) } = {}) {
    this.store = store;
    this.webSocketFactory = webSocketFactory;
    this.bucketMap = new Map();
    this.footprintMap = new Map();
    this.checkpoints = new Map();
    this.health = new Map(STREAMS.map((stream) => [stream.key, { ...stream, status: 'idle', coverage: 0, lastTradeAt: null, gap: null }]));
    this.divergences = new Map();
    this.listeners = new Set();
    this.connections = new Map();
    this.buffers = new Map();
    this.dedupe = new Set();
    this.dedupeQueue = [];
    this.dirtyBuckets = new Set();
    this.dirtyFootprints = new Set();
    this.dirtyCheckpoints = new Set();
    this.dirtyDivergences = new Set();
    this.contractMeta = null;
    this.lastDivergenceMinute = null;
    this.started = false;
    this.flushTimer = null;
    this.flushInFlight = false;
    this.notifyTimer = null;
  }

  async start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    const since = Date.now() - RETENTION_MS;
    try {
      await this.store.open();
      const [buckets, footprints, checkpoints, divergences] = await Promise.all([
        this.store.loadSince('cvdBuckets', since), this.store.loadSince('footprintBins', since),
        this.store.loadCheckpoints(), this.store.loadDivergences(),
      ]);
      buckets.forEach((row) => this.bucketMap.set(row.id, row));
      footprints.forEach((row) => this.footprintMap.set(row.id, row));
      checkpoints.forEach((row) => this.checkpoints.set(row.key, row));
      divergences.forEach((row) => this.divergences.set(row.id, row));
      await this.store.pruneBefore(since);
    } catch (error) {
      console.warn('[OrderFlow] IndexedDB hydration failed:', error.message);
    }
    try { this.contractMeta = await fetchOkxSwapMeta(); } catch (error) { console.warn('[OrderFlow] OKX contract metadata unavailable:', error.message); }
    STREAMS.forEach((stream) => this.connect(stream));
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  stop() {
    this.started = false;
    for (const connection of this.connections.values()) {
      clearTimeout(connection.reconnectTimer);
      clearInterval(connection.heartbeatTimer);
      if (connection.ws) { connection.ws.onclose = null; connection.ws.close(); }
    }
    this.connections.clear();
    clearInterval(this.flushTimer);
    clearTimeout(this.notifyTimer);
    this.flush();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setHealth(key, patch) {
    this.health.set(key, { ...(this.health.get(key) || {}), ...patch, updatedAt: Date.now() });
    this.scheduleNotify();
  }

  connect(stream) {
    if (!this.started) return;
    this.setHealth(stream.key, { status: 'connecting' });
    const ws = this.webSocketFactory(stream.url);
    const connection = { ws, reconnectTimer: null, heartbeatTimer: null };
    this.connections.set(stream.key, connection);
    this.buffers.set(stream.key, []);
    ws.onopen = async () => {
      if (stream.subscribe) ws.send(JSON.stringify(stream.subscribe));
      if (stream.venue === 'coinbase') {
        ws.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channel: 'heartbeats' }));
      }
      if (stream.venue === 'bybit') {
        connection.heartbeatTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ op: 'ping' }));
        }, 20_000);
      } else if (stream.venue === 'okx') {
        connection.heartbeatTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send('ping');
        }, 20_000);
      }
      this.setHealth(stream.key, { status: 'backfilling' });
      try {
        const result = await recoverRecentTrades(stream, this.checkpoints.get(stream.key), { contractMeta: this.contractMeta });
        result.trades.forEach((trade) => this.acceptTrade(stream, trade));
        const buffered = this.buffers.get(stream.key) || [];
        buffered.sort((a, b) => a.timestamp - b.timestamp).forEach((trade) => this.acceptTrade(stream, trade));
        this.buffers.set(stream.key, []);
        this.setHealth(stream.key, { status: result.bounded ? 'degraded' : 'live', coverage: result.bounded ? 70 : 100, gap: result.bounded ? 'REST_LIMIT_REACHED' : null });
      } catch (error) {
        const buffered = this.buffers.get(stream.key) || [];
        buffered.forEach((trade) => this.acceptTrade(stream, trade));
        this.buffers.set(stream.key, []);
        this.setHealth(stream.key, { status: 'degraded', coverage: 40, gap: error.message });
      }
    };
    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const trades = this.parseMessage(stream, message);
      const status = this.health.get(stream.key)?.status;
      if (status === 'backfilling' || status === 'connecting') this.buffers.get(stream.key)?.push(...trades);
      else trades.forEach((trade) => this.acceptTrade(stream, trade));
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!this.started) return;
      clearInterval(connection.heartbeatTimer);
      this.setHealth(stream.key, { status: 'disconnected' });
      connection.reconnectTimer = setTimeout(() => this.connect(stream), RECONNECT_MS);
    };
  }

  parseMessage(stream, message) {
    if (stream.venue === 'binance') {
      const trade = parseBinanceTrade(message, { market: stream.market });
      return trade ? [trade] : [];
    }
    if (stream.venue === 'bybit') return parseBybitTrades(message, { market: stream.market });
    if (stream.venue === 'okx') return parseOkxTrades(message, { market: stream.market, contractMeta: this.contractMeta });
    if (stream.venue === 'coinbase') return parseCoinbaseTrades(message);
    return [];
  }

  acceptTrade(stream, trade) {
    if (!trade || this.dedupe.has(trade.eventKey)) return false;
    this.dedupe.add(trade.eventKey);
    this.dedupeQueue.push(trade.eventKey);
    if (this.dedupeQueue.length > MAX_DEDUPE) this.dedupe.delete(this.dedupeQueue.shift());
    const { bucket, footprint } = applyTradeToAggregates(trade, this.bucketMap, this.footprintMap);
    this.dirtyBuckets.add(bucket.id);
    this.dirtyFootprints.add(footprint.id);
    const checkpoint = { key: stream.key, tradeId: trade.tradeId, sequence: trade.sequence, timestamp: trade.timestamp, updatedAt: Date.now() };
    this.checkpoints.set(stream.key, checkpoint);
    this.dirtyCheckpoints.add(stream.key);
    this.setHealth(stream.key, { lastTradeAt: trade.timestamp });
    const minute = Math.floor(trade.timestamp / 60_000) * 60_000;
    if (this.lastDivergenceMinute != null && minute > this.lastDivergenceMinute) this.detectDivergences();
    this.lastDivergenceMinute = Math.max(this.lastDivergenceMinute || 0, minute);
    this.scheduleNotify();
    return true;
  }

  detectDivergences() {
    const rows = [...this.bucketMap.values()];
    const events = [];
    for (const { timeframe, bucketMs, lookback } of [
      { timeframe: '5m', bucketMs: 5 * 60_000, lookback: 144 },
      { timeframe: '15m', bucketMs: 15 * 60_000, lookback: 96 },
      { timeframe: '1h', bucketMs: 60 * 60_000, lookback: 72 },
    ]) {
      const spot = buildCustomAggregateSeries(rows, 'spot', bucketMs, lookback);
      const futures = buildCustomAggregateSeries(rows, 'futures', bucketMs, lookback);
      const seriesCoverage = (series) => {
        if (series.length < 2) return 0;
        const expected = Math.max(1, Math.round((series.at(-1).time - series[0].time) / bucketMs) + 1);
        return Math.min(100, (series.length / expected) * 100);
      };
      const spotCoverage = seriesCoverage(spot);
      const futuresCoverage = seriesCoverage(futures);
      events.push(
        ...detectPriceCvdDivergences(spot, { market: 'spot', timeframe }).map((event) => ({ ...event, dataCoverage: spotCoverage })),
        ...detectPriceCvdDivergences(futures, { market: 'futures', timeframe }).map((event) => ({ ...event, dataCoverage: futuresCoverage })),
      );
      const cross = detectSpotFuturesDivergence(spot, futures, { timeframe });
      if (cross) events.push({ ...cross, dataCoverage: Math.min(spotCoverage, futuresCoverage) });
    }
    events.sort((a, b) => b.confirmedAt - a.confirmedAt).slice(0, 20).forEach((event) => {
      if (!event.confirmedAt || this.divergences.has(event.id)) return;
      const streamCoverage = event.market === 'spot'
        ? this.marketHealth('spot').coverage
        : event.market === 'futures'
          ? this.marketHealth('futures').coverage
          : Math.min(this.marketHealth('spot').coverage, this.marketHealth('futures').coverage);
      const coverage = Math.min(event.dataCoverage || 0, streamCoverage);
      if (coverage < 70) return;
      const enriched = { ...event, coverage, createdAt: Date.now() };
      this.divergences.set(event.id, enriched);
      this.dirtyDivergences.add(event.id);
    });
  }

  marketHealth(market) {
    const rows = [...this.health.values()].filter((item) => item.market === market);
    const live = rows.filter((item) => item.status === 'live').length;
    const active = rows.filter((item) => item.status === 'live' || item.status === 'degraded').length;
    const coverage = rows.length ? rows.reduce((sum, item) => sum + (item.coverage || 0), 0) / rows.length : 0;
    return { total: rows.length, live, active, coverage, status: live === rows.length ? 'live' : active > 0 ? 'degraded' : 'warming' };
  }

  getSnapshot(timeframe = '24H', gap = 100) {
    const bucketRows = [...this.bucketMap.values()];
    const footprintRows = [...this.footprintMap.values()];
    const spot = buildAggregateSeries(bucketRows, 'spot', timeframe);
    const futures = buildAggregateSeries(bucketRows, 'futures', timeframe);
    return {
      timeframe, spot, futures,
      spotNodes: buildFootprintNodes(footprintRows, 'spot', timeframe, gap),
      futuresNodes: buildFootprintNodes(footprintRows, 'futures', timeframe, gap),
      spotContribution: summarizeVenueContribution(spot),
      futuresContribution: summarizeVenueContribution(futures),
      health: { spot: this.marketHealth('spot'), futures: this.marketHealth('futures'), venues: [...this.health.values()] },
      divergences: [...this.divergences.values()].sort((a, b) => b.confirmedAt - a.confirmedAt).slice(0, 20),
      updatedAt: Date.now(),
    };
  }

  scheduleNotify() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.listeners.forEach((listener) => listener());
    }, NOTIFY_MS);
  }

  async flush() {
    if (this.flushInFlight) return;
    this.flushInFlight = true;
    const bucketIds = this.dirtyBuckets;
    const footprintIds = this.dirtyFootprints;
    const checkpointIds = this.dirtyCheckpoints;
    const divergenceIds = this.dirtyDivergences;
    this.dirtyBuckets = new Set();
    this.dirtyFootprints = new Set();
    this.dirtyCheckpoints = new Set();
    this.dirtyDivergences = new Set();
    const buckets = [...bucketIds].map((id) => this.bucketMap.get(id)).filter(Boolean);
    const footprints = [...footprintIds].map((id) => this.footprintMap.get(id)).filter(Boolean);
    const checkpoints = [...checkpointIds].map((id) => this.checkpoints.get(id)).filter(Boolean);
    const divergences = [...divergenceIds].map((id) => this.divergences.get(id)).filter(Boolean);
    try {
      await this.store.persist({ buckets, footprints, checkpoints, divergences });
    } catch (error) {
      bucketIds.forEach((id) => this.dirtyBuckets.add(id));
      footprintIds.forEach((id) => this.dirtyFootprints.add(id));
      checkpointIds.forEach((id) => this.dirtyCheckpoints.add(id));
      divergenceIds.forEach((id) => this.dirtyDivergences.add(id));
      console.warn('[OrderFlow] Persistence flush failed:', error.message);
    } finally {
      this.flushInFlight = false;
    }
  }
}

export const aggregatedOrderFlowEngine = new TradeStreamEngine();
