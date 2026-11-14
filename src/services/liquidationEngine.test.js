import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseForceOrderMessage,
  aggregateLiquidations,
  formatLiqUsd,
  parseCoinalyzeLiquidationHistory,
  selectBtcPerpMarketsForLiquidation,
  parseMultiExchangeCoinalyzeLiquidations,
  summarizeHistoricalLiquidations,
  bucketHistoricalLiquidations,
} from './liquidationEngine.js';
import { describeLiquidationEvidence } from './moveTrackerCore.js';

describe('liquidationEngine', () => {
  describe('parseForceOrderMessage', () => {
    it('parses SELL order as LONG liquidated position', () => {
      const msg = {
        stream: 'btcusdt@forceOrder',
        data: {
          e: 'forceOrder',
          E: 1700000000000,
          o: {
            s: 'BTCUSDT',
            S: 'SELL',
            o: 'LIMIT',
            f: 'IOC',
            q: '1.5',
            p: '65000',
            ap: '64950',
            X: 'FILLED',
            l: '1.5',
            z: '1.5',
            T: 1700000000000,
          },
        },
      };

      const parsed = parseForceOrderMessage(msg);
      assert.ok(parsed);
      assert.equal(parsed.symbol, 'BTCUSDT');
      assert.equal(parsed.orderSide, 'SELL');
      assert.equal(parsed.positionSide, 'LONG');
      assert.equal(parsed.side, 'SELL');
      assert.equal(parsed.posSide, 'LONG');
      assert.equal(parsed.price, 64950);
      assert.equal(parsed.qty, 1.5);
      assert.equal(parsed.usdValue, 64950 * 1.5);
      assert.equal(parsed.usdtVol, 64950 * 1.5);
      assert.equal(parsed.timestamp, 1700000000000);
    });

    it('parses BUY order as SHORT liquidated position', () => {
      const msg = {
        e: 'forceOrder',
        E: 1700000005000,
        o: {
          s: 'BTCUSDT',
          S: 'BUY',
          q: '2.0',
          p: '66000',
          ap: '66000',
          T: 1700000005000,
        },
      };

      const parsed = parseForceOrderMessage(msg);
      assert.ok(parsed);
      assert.equal(parsed.orderSide, 'BUY');
      assert.equal(parsed.positionSide, 'SHORT');
      assert.equal(parsed.usdValue, 132000);
    });

    it('returns null for invalid or empty messages', () => {
      assert.equal(parseForceOrderMessage(null), null);
      assert.equal(parseForceOrderMessage({}), null);
      assert.equal(parseForceOrderMessage({ o: {} }), null);
    });
  });

  describe('aggregateLiquidations', () => {
    const baseNow = 1700001000000;
    const sampleEvents = [
      // Within 5m: Long liq $100k at baseNow - 60s
      {
        id: '1',
        positionSide: 'LONG',
        usdValue: 100_000,
        timestamp: baseNow - 60_000,
      },
      // Within 5m: Long liq $200k at baseNow - 120s
      {
        id: '2',
        positionSide: 'LONG',
        usdValue: 200_000,
        timestamp: baseNow - 120_000,
      },
      // Within 5m: Short liq $50k at baseNow - 30s
      {
        id: '3',
        positionSide: 'SHORT',
        usdValue: 50_000,
        timestamp: baseNow - 30_000,
      },
      // Outside 5m (10m ago): Short liq $600k at baseNow - 600s
      {
        id: '4',
        positionSide: 'SHORT',
        usdValue: 600_000,
        timestamp: baseNow - 600_000,
      },
    ];

    it('aggregates 5m window correctly', () => {
      const agg5m = aggregateLiquidations(sampleEvents, baseNow, 300_000);
      assert.equal(agg5m.longLiqUsd, 300_000);
      assert.equal(agg5m.shortLiqUsd, 50_000);
      assert.equal(agg5m.totalLiqUsd, 350_000);
      assert.equal(agg5m.netLiqDelta, -250_000);
      assert.equal(agg5m.longLiqCount, 2);
      assert.equal(agg5m.shortLiqCount, 1);
      assert.equal(agg5m.totalCount, 3);
      assert.equal(agg5m.maxSingleLiqUsd, 200_000);
      assert.equal(agg5m.maxSingleLiqSide, 'LONG');
      assert.equal(agg5m.dominanceLabel, 'LONG_FLUSH');

      // Assert UI schema aliases
      assert.equal(agg5m.totalUsd, 350_000);
      assert.equal(agg5m.longUsd, 300_000);
      assert.equal(agg5m.shortUsd, 50_000);
      assert.equal(agg5m.longCount, 2);
      assert.equal(agg5m.shortCount, 1);
      assert.equal(agg5m.count, 3);
      assert.equal(agg5m.dominantSide, 'LONG');
      assert.ok(agg5m.longRatio > 0.65);
    });

    it('aggregates 1h window including older events', () => {
      const agg1h = aggregateLiquidations(sampleEvents, baseNow, 3_600_000);
      assert.equal(agg1h.longLiqUsd, 300_000);
      assert.equal(agg1h.shortLiqUsd, 650_000);
      assert.equal(agg1h.totalLiqUsd, 950_000);
      assert.equal(agg1h.netLiqDelta, 350_000);
      assert.equal(agg1h.totalCount, 4);
      assert.equal(agg1h.maxSingleLiqUsd, 600_000);
      assert.equal(agg1h.maxSingleLiqSide, 'SHORT');
      assert.equal(agg1h.dominanceLabel, 'SHORT_SQUEEZE');
      assert.equal(agg1h.dominantSide, 'SHORT');
    });

    it('tolerates client-server clock skew up to 60s without dropping events', () => {
      const skewedEvents = [
        {
          id: 'future-skew',
          positionSide: 'LONG',
          usdValue: 150_000,
          timestamp: baseNow + 3000, // 3 seconds ahead of client now
        },
      ];
      const agg = aggregateLiquidations(skewedEvents, baseNow, 300_000);
      assert.equal(agg.totalLiqUsd, 150_000);
      assert.equal(agg.longLiqCount, 1);
    });

    it('returns QUIET when no events or empty array', () => {
      const quiet = aggregateLiquidations([], baseNow, 300_000);
      assert.equal(quiet.totalLiqUsd, 0);
      assert.equal(quiet.dominanceLabel, 'QUIET');
    });

    it('handles BALANCED regime when neither side exceeds 65%', () => {
      const balancedEvents = [
        { id: '1', positionSide: 'LONG', usdValue: 100_000, timestamp: baseNow - 10_000 },
        { id: '2', positionSide: 'SHORT', usdValue: 90_000, timestamp: baseNow - 10_000 },
      ];
      const res = aggregateLiquidations(balancedEvents, baseNow, 300_000);
      assert.equal(res.dominanceLabel, 'BALANCED');
    });
  });

  describe('formatLiqUsd', () => {
    it('formats values concisely', () => {
      assert.equal(formatLiqUsd(1_500_000), '$1.50M');
      assert.equal(formatLiqUsd(250_000), '$250.0K');
      assert.equal(formatLiqUsd(2_500_000_000), '$2.50B');
      assert.equal(formatLiqUsd(-500_000), '-$500.0K');
      assert.equal(formatLiqUsd(0), '$0');
    });
  });

  describe('describeLiquidationEvidence', () => {
    it('returns quiet narrative when no liquidations occur', () => {
      const event = { triggerSnapshot: { liquidations: { rolling5m: { totalLiqUsd: 0 }, rolling1h: { totalLiqUsd: 0 } } } };
      assert.equal(describeLiquidationEvidence(event), '5m: Không có thanh lý đáng kể');
    });

    it('formats small liquidation amounts cleanly without $0.0M', () => {
      const event = {
        triggerSnapshot: {
          liquidations: {
            rolling5m: { totalLiqUsd: 25_000, dominanceLabel: 'LONG_FLUSH' },
            rolling1h: { totalLiqUsd: 80_000 },
          },
        },
      };
      const text = describeLiquidationEvidence(event);
      assert.match(text, /5m: \$25\.0K \(Long bị quét\)/);
      assert.match(text, /1h: \$80\.0K/);
    });

    it('formats large liquidation cascades accurately', () => {
      const event = {
        triggerSnapshot: {
          liquidations: {
            rolling5m: { totalLiqUsd: 3_500_000, dominanceLabel: 'SHORT_SQUEEZE' },
            rolling1h: { totalLiqUsd: 12_000_000 },
          },
        },
      };
      const text = describeLiquidationEvidence(event);
      assert.match(text, /5m: \$3\.50M \(Short bị quét\)/);
      assert.match(text, /1h: \$12\.00M/);
    });
  });

  describe('Coinalyze historical liquidation helpers', () => {
    const nowMs = Date.UTC(2026, 10, 14, 12, 0, 0);
    const nowSec = Math.floor(nowMs / 1000);

    it('parses Coinalyze liquidation-history payload and sorts ascending', () => {
      const payload = [
        {
          symbol: 'BTCUSDT_PERP.A',
          history: [
            { t: nowSec - 3600, l: 250_000, s: 100_000 },
            { t: nowSec - 7200, l: 50_000, s: 400_000 },
          ],
        },
      ];
      const parsed = parseCoinalyzeLiquidationHistory(payload);
      assert.equal(parsed.symbol, 'BTCUSDT_PERP.A');
      assert.equal(parsed.history.length, 2);
      assert.equal(parsed.history[0].timestamp, (nowSec - 7200) * 1000);
      assert.equal(parsed.history[0].longUsd, 50_000);
      assert.equal(parsed.history[0].shortUsd, 400_000);
      assert.equal(parsed.history[0].totalUsd, 450_000);
      assert.equal(parsed.history[0].netDelta, 350_000);
    });

    it('summarizes 24h, 7d, and 30d rolling windows accurately', () => {
      const DAY = 86400;
      const payload = [
        {
          symbol: 'BTCUSDT_PERP.A',
          history: [
            { t: nowSec - 2 * 3600, l: 1_000_000, s: 200_000 }, // within 24h
            { t: nowSec - 3 * DAY, l: 500_000, s: 2_000_000 }, // within 7d
            { t: nowSec - 15 * DAY, l: 3_000_000, s: 1_000_000 }, // within 30d
            { t: nowSec - 35 * DAY, l: 9_999_999, s: 9_999_999 }, // outside 30d
          ],
        },
      ];
      const { history } = parseCoinalyzeLiquidationHistory(payload);
      const summary = summarizeHistoricalLiquidations(history, nowMs);

      assert.equal(summary.h24.longUsd, 1_000_000);
      assert.equal(summary.h24.shortUsd, 200_000);
      assert.equal(summary.h24.totalUsd, 1_200_000);
      assert.equal(summary.h24.dominanceLabel, 'LONG_FLUSH');

      assert.equal(summary.d7.longUsd, 1_500_000);
      assert.equal(summary.d7.shortUsd, 2_200_000);
      assert.equal(summary.d7.totalUsd, 3_700_000);
      assert.equal(summary.d7.dominanceLabel, 'BALANCED');

      assert.equal(summary.d30.longUsd, 4_500_000);
      assert.equal(summary.d30.shortUsd, 3_200_000);
      assert.equal(summary.d30.totalUsd, 7_700_000);
    });

    it('buckets 7d/30d history by UTC day and 24h by hour', () => {
      const DAY = 86400;
      const payload = [
        {
          symbol: 'BTCUSDT_PERP.A',
          history: [
            { t: nowSec - 2 * 3600, l: 100_000, s: 50_000 },
            { t: nowSec - 1 * 3600, l: 200_000, s: 100_000 },
            { t: nowSec - 2 * DAY, l: 400_000, s: 300_000 },
          ],
        },
      ];
      const { history } = parseCoinalyzeLiquidationHistory(payload);
      const buckets24h = bucketHistoricalLiquidations(history, '24h', nowMs);
      assert.equal(buckets24h.length, 2);

      const buckets7d = bucketHistoricalLiquidations(history, '7d', nowMs);
      assert.equal(buckets7d.length, 2); // 2 distinct UTC days
      assert.equal(buckets7d[1].longUsd, 300_000);
      assert.equal(buckets7d[1].shortUsd, 150_000);
    });

    it('selects one primary BTC perpetual per exchange and aggregates multi-exchange liquidations with byExchange breakdown', () => {
      const exchanges = [
        { name: 'Binance', code: 'A' },
        { name: 'Bybit', code: '6' },
        { name: 'OKX', code: '3' },
      ];
      const futureMarkets = [
        { symbol: 'BTCUSDT_PERP.A', exchange: 'A', base_asset: 'BTC', quote_asset: 'USDT', is_perpetual: true, margined: 'STABLE' },
        { symbol: 'BTCUSD_PERP.A', exchange: 'A', base_asset: 'BTC', quote_asset: 'USD', is_perpetual: true, margined: 'COIN' },
        { symbol: 'BTCUSDT.6', exchange: '6', base_asset: 'BTC', quote_asset: 'USDT', is_perpetual: true, margined: 'STABLE' },
        { symbol: 'BTC-USDT-SWAP.3', exchange: '3', base_asset: 'BTC', quote_asset: 'USDT', is_perpetual: true, margined: 'STABLE' },
        { symbol: 'ETHUSDT_PERP.A', exchange: 'A', base_asset: 'ETH', quote_asset: 'USDT', is_perpetual: true, margined: 'STABLE' },
      ];

      const selected = selectBtcPerpMarketsForLiquidation(futureMarkets, exchanges, 10);
      assert.equal(selected.length, 3);
      assert.deepEqual(selected.map((s) => s.exchangeName), ['Binance', 'Bybit', 'OKX']);
      assert.equal(selected[0].symbol, 'BTCUSDT_PERP.A');

      const payload = [
        { symbol: 'BTCUSDT_PERP.A', history: [{ t: nowSec - 3600, l: 400_000, s: 100_000 }] },
        { symbol: 'BTCUSDT.6', history: [{ t: nowSec - 3600, l: 200_000, s: 300_000 }] },
      ];
      const multi = parseMultiExchangeCoinalyzeLiquidations(payload, selected);
      assert.deepEqual(multi.exchanges, ['Binance', 'Bybit']);
      assert.equal(multi.history.length, 1);
      assert.equal(multi.history[0].longUsd, 600_000);
      assert.equal(multi.history[0].shortUsd, 400_000);
      assert.equal(multi.history[0].totalUsd, 1_000_000);
      assert.equal(multi.history[0].byExchange.Binance.totalUsd, 500_000);
      assert.equal(multi.history[0].byExchange.Bybit.totalUsd, 500_000);

      const buckets = bucketHistoricalLiquidations(multi.history, '24h', nowMs);
      assert.equal(buckets.length, 1);
      assert.equal(buckets[0].byExchange.Binance.longUsd, 400_000);
      assert.equal(buckets[0].byExchange.Bybit.shortUsd, 300_000);
    });
  });
});
