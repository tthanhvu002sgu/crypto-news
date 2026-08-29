import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CVD_ANCHOR_UTC,
  CVD_ANCHOR_TIMESTAMP,
  SNAPSHOT_STORE_VERSION,
  getUtcDateString,
  getUtcMidnight,
  isUtcDayClosed,
  normalizeKline,
  createDailySnapshot,
  resetSnapshotStore,
  getSnapshotStore,
  getDailySnapshots,
  getSnapshotByDate,
  upsertDailySnapshots,
  syncDailySnapshots,
  isLedgerStale,
  ensureDailySnapshots,
  buildCvdSeries,
  extractCvdNetDelta
} from './cvdService.js';

import { calculateMarketBias } from './biasEngine.js';
import { buildGoogleSheetPayload } from './googleSheetSync.js';

describe('CVD Service & Immutable Daily Snapshot Engine', () => {
  beforeEach(() => {
    resetSnapshotStore();
  });

  it('1. Anchor is fixed to 2020-01-01T00:00:00.000Z across all markets', () => {
    assert.equal(CVD_ANCHOR_UTC, '2020-01-01T00:00:00.000Z');
    assert.equal(CVD_ANCHOR_TIMESTAMP, 1577836800000);
    assert.equal(getUtcDateString(CVD_ANCHOR_TIMESTAMP), '2020-01-01');
    assert.equal(getUtcMidnight(CVD_ANCHOR_TIMESTAMP), CVD_ANCHOR_TIMESTAMP);
  });

  it('2. Same timestamp produces identical cumulativeFromAnchor across independent requests with sliding windows', () => {
    // Setup closed daily snapshot baseline (Aug 27 closed snapshot)
    const day1Open = Date.UTC(2026, 7, 27, 0, 0, 0); // 2026-08-27

    const snap1 = createDailySnapshot({
      market: 'futures',
      openTime: day1Open,
      dailyDelta: 1000000,
      cumulativeFromAnchor: 5000000,
      buyVolume: 6000000,
      sellVolume: 5000000,
      closePrice: 60000
    });

    upsertDailySnapshots('futures', [snap1]);
    const snapshots = getDailySnapshots('futures');

    // On 2026-08-28 (midnight = 00:00 UTC):
    // 10:00 candle (h1), 11:00 candle (h2), 12:00 candle (h3), 13:00 candle (h4)
    const h1Time = Date.UTC(2026, 7, 28, 10, 0, 0);
    const h2Time = Date.UTC(2026, 7, 28, 11, 0, 0);
    const h3Time = Date.UTC(2026, 7, 28, 12, 0, 0);
    const h4Time = Date.UTC(2026, 7, 28, 13, 0, 0);

    const kline1 = [h1Time, '61000', '61200', '60900', '61100', '100', h1Time + 3600000 - 1, '6110000', 1000, '55', '3360500', '0']; // delta: +611,000
    const kline2 = [h2Time, '61100', '61300', '61000', '61250', '120', h2Time + 3600000 - 1, '7350000', 1200, '70', '4287500', '0']; // delta: +1,225,000
    const kline3 = [h3Time, '61250', '61500', '61200', '61400', '150', h3Time + 3600000 - 1, '9210000', 1500, '90', '5526000', '0']; // delta: +1,842,000
    const kline4 = [h4Time, '61400', '61600', '61300', '61500', '160', h4Time + 3600000 - 1, '9840000', 1600, '95', '5844000', '0']; // delta: +1,848,000

    // Request A: Made at 12:30 UTC. Fetched klines starting from midnight boundary [k1, k2, k3].
    // Target display count = 2 (points for h2: 11:00 and h3: 12:00)
    const seriesA = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: [kline1, kline2, kline3],
      dailySnapshots: snapshots,
      targetCount: 2,
      now: h3Time + 1800000
    });

    // Request B: Made at 13:30 UTC (window slid by 1 hour). Fetched klines starting from midnight boundary [k1, k2, k3, k4].
    // Target display count = 2 (points for h3: 12:00 and h4: 13:00)
    const seriesB = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: [kline1, kline2, kline3, kline4],
      dailySnapshots: snapshots,
      targetCount: 2,
      now: h4Time + 1800000
    });

    assert.equal(seriesA.points.length, 2, 'Series A has exactly 2 display points');
    assert.equal(seriesB.points.length, 2, 'Series B has exactly 2 display points');

    // Shared timestamp h3Time (12:00) across independent Request A and Request B
    const pointH3inA = seriesA.points.find(p => p.time === h3Time);
    const pointH3inB = seriesB.points.find(p => p.time === h3Time);

    assert.ok(pointH3inA, 'h3 exists in series A');
    assert.ok(pointH3inB, 'h3 exists in series B');

    // CRITICAL: cumulativeFromAnchor at h3 is 100% IDENTICAL across independent queries
    assert.equal(pointH3inA.cumulativeFromAnchor, pointH3inB.cumulativeFromAnchor);
    assert.equal(pointH3inA.cumulativeFromAnchor, 5000000 + 611000 + 1225000 + 1842000); // = 8,678,000

    // Exact bucket count for windowNetDelta (no extra padding bucket)
    assert.equal(seriesA.windowNetDelta, 1225000 + 1842000); // = 3,067,000 (h2 + h3)
    assert.equal(seriesB.windowNetDelta, 1842000 + 1848000); // = 3,690,000 (h3 + h4)
  });

  it('3. Closed daily snapshots are strictly immutable and never overwritten by sync/re-fetch', () => {
    const dayOpen = Date.UTC(2026, 7, 25, 0, 0, 0);
    const initialSnap = createDailySnapshot({
      market: 'spot',
      openTime: dayOpen,
      dailyDelta: 500000,
      cumulativeFromAnchor: 10000000,
      buyVolume: 3000000,
      sellVolume: 2500000,
      closePrice: 62000,
      now: 1000
    });

    upsertDailySnapshots('spot', [initialSnap]);

    const attemptOverwriteSnap = createDailySnapshot({
      market: 'spot',
      openTime: dayOpen,
      dailyDelta: 999999999, // tampered delta
      cumulativeFromAnchor: 999999999,
      buyVolume: 999999999,
      sellVolume: 0,
      closePrice: 99999,
      now: 2000
    });

    // Re-upserting must not overwrite existing closed snapshot
    upsertDailySnapshots('spot', [attemptOverwriteSnap]);

    const storedSnap = getSnapshotByDate('spot', '2026-08-25');
    assert.equal(storedSnap.dailyDelta, 500000);
    assert.equal(storedSnap.cumulativeFromAnchor, 10000000);
    assert.equal(storedSnap.capturedAt, 1000);
  });

  it('4. Spot and Futures maintain independent ledgers and never overwrite each other', () => {
    const dayOpen = Date.UTC(2026, 7, 26, 0, 0, 0);
    const spotSnap = createDailySnapshot({
      market: 'spot',
      openTime: dayOpen,
      dailyDelta: 123456,
      cumulativeFromAnchor: 1111111,
      buyVolume: 2000000,
      sellVolume: 1876544,
      closePrice: 63000
    });
    const futSnap = createDailySnapshot({
      market: 'futures',
      openTime: dayOpen,
      dailyDelta: -654321,
      cumulativeFromAnchor: -2222222,
      buyVolume: 5000000,
      sellVolume: 5654321,
      closePrice: 63050
    });

    upsertDailySnapshots('spot', [spotSnap]);
    upsertDailySnapshots('futures', [futSnap]);

    const storedSpot = getSnapshotByDate('spot', '2026-08-26');
    const storedFut = getSnapshotByDate('futures', '2026-08-26');

    assert.equal(storedSpot.market, 'spot');
    assert.equal(storedSpot.dailyDelta, 123456);
    assert.equal(storedSpot.cumulativeFromAnchor, 1111111);

    assert.equal(storedFut.market, 'futures');
    assert.equal(storedFut.dailyDelta, -654321);
    assert.equal(storedFut.cumulativeFromAnchor, -2222222);
  });

  it('5. Live running candle is marked provisional (isClosed: false) and locked only once when closed', () => {
    const now = Date.UTC(2026, 7, 29, 12, 30, 0);
    const pastKlineTime = Date.UTC(2026, 7, 29, 11, 0, 0);
    const liveKlineTime = Date.UTC(2026, 7, 29, 12, 0, 0);

    const pastRaw = [pastKlineTime, '64000', '64100', '63900', '64050', '50', pastKlineTime + 3600000 - 1, '3202500', 500, '30', '1921500', '0'];
    const liveRaw = [liveKlineTime, '64050', '64200', '64000', '64150', '20', liveKlineTime + 3600000 - 1, '1283000', 200, '12', '769800', '0'];

    const normPast = normalizeKline(pastRaw, now);
    const normLive = normalizeKline(liveRaw, now);

    assert.equal(normPast.isClosed, true);
    assert.equal(normLive.isClosed, false); // still running at 12:30

    const series = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: [pastRaw, liveRaw],
      dailySnapshots: [],
      now
    });

    assert.equal(series.hasProvisionalPoint, true);
    assert.equal(series.points[0].isClosed, true);
    assert.equal(series.points[1].isClosed, false);
  });

  it('6. UTC midnight rollover does not double-count daily deltas', async () => {
    const aug27Open = Date.UTC(2026, 7, 27, 0, 0, 0);
    const aug28Open = Date.UTC(2026, 7, 28, 0, 0, 0);

    const aug27Raw = [aug27Open, '60000', '61000', '59000', '60500', '1000', aug27Open + 86400000 - 1, '60500000', 10000, '600', '36300000', '0'];
    const aug28Raw = [aug28Open, '60500', '62000', '60000', '61500', '1200', aug28Open + 86400000 - 1, '73800000', 12000, '700', '43050000', '0'];

    const mockAxios = {
      get: async () => ({ data: [aug27Raw, aug28Raw] })
    };

    // Simulated sync at Aug 29 02:00 UTC (both Aug 27 and Aug 28 are closed)
    const simTime = Date.UTC(2026, 7, 29, 2, 0, 0);
    await syncDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now: simTime });

    const snaps = getDailySnapshots('futures');
    assert.equal(snaps.length, 2);
    assert.equal(snaps[0].utcDate, '2026-08-27');
    assert.equal(snaps[1].utcDate, '2026-08-28');

    const d1 = normalizeKline(aug27Raw).delta;
    const d2 = normalizeKline(aug28Raw).delta;

    assert.equal(snaps[0].dailyDelta, Math.round(d1));
    assert.equal(snaps[0].cumulativeFromAnchor, Math.round(d1));
    assert.equal(snaps[1].dailyDelta, Math.round(d2));
    assert.equal(snaps[1].cumulativeFromAnchor, Math.round(d1 + d2));

    // Re-syncing should not double count
    await syncDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now: simTime });
    const snaps2 = getDailySnapshots('futures');
    assert.equal(snaps2.length, 2);
    assert.equal(snaps2[1].cumulativeFromAnchor, Math.round(d1 + d2));
  });

  it('7. Multi-day gaps are backfilled in chronological sequence without gaps', async () => {
    const d1Time = Date.UTC(2026, 7, 20, 0, 0, 0);
    const d2Time = Date.UTC(2026, 7, 21, 0, 0, 0);
    const d3Time = Date.UTC(2026, 7, 22, 0, 0, 0);

    const d1 = [d1Time, '58000', '59000', '57500', '58500', '500', d1Time + 86400000 - 1, '29250000', 5000, '300', '17550000', '0'];
    const d2 = [d2Time, '58500', '59500', '58000', '59000', '600', d2Time + 86400000 - 1, '35400000', 6000, '350', '20650000', '0'];
    const d3 = [d3Time, '59000', '60000', '58500', '59500', '700', d3Time + 86400000 - 1, '41650000', 7000, '400', '23800000', '0'];

    const mockAxios = {
      get: async () => ({ data: [d1, d2, d3] })
    };

    await syncDailySnapshots('BTCUSDT', 'spot', {
      axiosInstance: mockAxios,
      now: Date.UTC(2026, 7, 23, 10, 0, 0)
    });

    const snaps = getDailySnapshots('spot');
    assert.equal(snaps.length, 3);
    assert.equal(snaps[0].utcDate, '2026-08-20');
    assert.equal(snaps[1].utcDate, '2026-08-21');
    assert.equal(snaps[2].utcDate, '2026-08-22');

    assert.ok(snaps[0].openTime < snaps[1].openTime);
    assert.ok(snaps[1].openTime < snaps[2].openTime);
  });

  it('8. windowNetDelta strictly equals the sum of candle deltas across the timeframe window', () => {
    const now = Date.UTC(2026, 7, 29, 12, 0, 0);
    const klines = [];
    let expectedSum = 0;

    for (let i = 0; i < 24; i++) {
      const openTime = Date.UTC(2026, 7, 28, 12 + i, 0, 0);
      const buyVol = 1000000 + i * 50000;
      const totalQuote = 1800000 + i * 80000;
      const sellVol = totalQuote - buyVol;
      const delta = buyVol - sellVol;
      expectedSum += delta;

      klines.push([
        openTime, '60000', '60500', '59900', '60200', '50',
        openTime + 3600000 - 1, String(totalQuote), 500, '20', String(buyVol), '0'
      ]);
    }

    const series = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: klines,
      dailySnapshots: [],
      now
    });

    assert.equal(series.windowNetDelta, Math.round(expectedSum));
    assert.equal(series.points.length, 24);
    assert.equal(extractCvdNetDelta(series), Math.round(expectedSum));
  });

  it('9. Bias Engine consumes windowNetDelta and is immune to multi-billion cumulativeFromAnchor', () => {
    // Construct series with multi-billion anchor (+50 Billion from 2020) but moderate 24h net delta (+15 Million)
    const cvdSeries24hSpot = {
      market: 'spot',
      interval: '1h',
      timeframe: '24H',
      anchorTime: CVD_ANCHOR_TIMESTAMP,
      points: [
        { time: 1000, delta: 5000000, cumulativeFromAnchor: 50005000000, isClosed: true },
        { time: 2000, delta: 10000000, cumulativeFromAnchor: 50015000000, isClosed: true }
      ],
      windowNetDelta: 15000000, // +$15M net in 24h
      asOf: Date.now()
    };

    const cvdSeries24hFut = {
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      anchorTime: CVD_ANCHOR_TIMESTAMP,
      points: [
        { time: 1000, delta: 10000000, cumulativeFromAnchor: -30000000000, isClosed: true },
        { time: 2000, delta: 10000000, cumulativeFromAnchor: -29990000000, isClosed: true }
      ],
      windowNetDelta: 20000000, // +$20M net in 24h
      asOf: Date.now()
    };

    const mockData = {
      btc: { price: 65000, volume: 2000000000, change: 1.5 },
      cvdHistory24hSpot: cvdSeries24hSpot,
      cvdHistory24h: cvdSeries24hFut,
      fundingRate: 0.0001,
      openInterest: 15000000000,
      fngData: 55,
      mvrv: 1.8,
      dxy: 103.0,
      vix: 15.0
    };

    const bias = calculateMarketBias(mockData);

    const spotSignal = bias.signals.find(s => s.name === 'Spot CVD (24h/7d/30d)');
    const futSignal = bias.signals.find(s => s.name === 'Futures CVD (24h/7d/30d)');

    assert.ok(spotSignal, 'Spot CVD signal must exist');
    assert.ok(futSignal, 'Futures CVD signal must exist');

    // Score must be in normal realistic range [-3, +3], NOT blown out by 50B anchor
    assert.ok(spotSignal.score >= -3 && spotSignal.score <= 3);
    assert.ok(futSignal.score >= -2 && futSignal.score <= 2);
  });

  it('10. Browser and syncGoogleSheet export produce identical windowNetDelta and divergence status', () => {
    const cvdSpot24 = {
      market: 'spot',
      interval: '1h',
      windowNetDelta: 50000000, // +$50M
      points: []
    };
    const cvdFut24 = {
      market: 'futures',
      interval: '1h',
      windowNetDelta: -30000000, // -$30M (Spot Buy, Futures Short -> Divergence / Short Squeeze)
      points: []
    };

    const mockData = {
      btc: { price: 65000, volume: 2000000000, change: 1.0, high: 66000, low: 64000 },
      cvdHistory24hSpot: cvdSpot24,
      cvdHistory24h: cvdFut24,
      fundingRate: -0.0001,
      openInterest: 12000000000,
      fngData: { value: 50 },
      mvrv: { val: 1.8 },
      etfHoldings: { total: 1200000 },
      etfHistory: [{ total: 100 }],
      farsideWeeklyFlows: [],
      cotData: { nonCommercialNet: 5000 },
      dxy: { val: 103 },
      vix: { val: 15 },
      sp500: { val: 5800 },
      qqq: { val: 490 },
      us10y: { val: 4.2 }
    };

    const payload = buildGoogleSheetPayload(mockData, { score: 50 }, { total: 1200000 }, [{ date: '21/08/2026', flow: 100 }]);
    assert.ok(Array.isArray(payload.derivatives), 'derivatives tab must be present');

    const spotRow = payload.derivatives.find(r => r[0].includes('Spot CVD 24h'));
    const futRow = payload.derivatives.find(r => r[0].includes('Futures CVD 24h'));
    const divRow = payload.derivatives.find(r => r[0].includes('Đánh Giá Phân Kỳ Spot vs Futures'));

    assert.ok(spotRow, 'Spot CVD row must exist in derivatives tab');
    assert.ok(futRow, 'Futures CVD row must exist in derivatives tab');
    assert.ok(divRow, 'Divergence row must exist in derivatives tab');

    assert.equal(divRow[1], 'Spot Mua / Futures Short (Divergence)');
  });

  it('11. Provenance metadata (source, anchorTime, asOf, version) is fully preserved in data contract', () => {
    const kline = [Date.UTC(2026, 7, 28, 0, 0, 0), '60000', '60100', '59900', '60050', '10', Date.UTC(2026, 7, 28, 1, 0, 0) - 1, '600500', 100, '6', '360300', '0'];
    const now = Date.UTC(2026, 7, 28, 1, 30, 0);

    const series = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: [kline],
      dailySnapshots: [],
      now
    });

    assert.equal(series.market, 'futures');
    assert.equal(series.interval, '1h');
    assert.equal(series.timeframe, '24H');
    assert.equal(series.anchorTime, CVD_ANCHOR_TIMESTAMP);
    assert.equal(series.asOf, now);
    assert.equal(typeof series.windowNetDelta, 'number');
    assert.equal(Array.isArray(series.points), true);
  });

  it('12. isLedgerStale flags missing closed days and ensureDailySnapshots performs incremental backfill', async () => {
    // Stale ledger with only snapshot from Aug 26
    const threeDaysAgo = Date.UTC(2026, 7, 26, 0, 0, 0);
    const snapOld = createDailySnapshot({
      market: 'futures',
      openTime: threeDaysAgo,
      dailyDelta: 500000,
      cumulativeFromAnchor: 2000000,
      buyVolume: 1000000,
      sellVolume: 500000,
      closePrice: 59000
    });
    upsertDailySnapshots('futures', [snapOld]);

    const simTimeNow = Date.UTC(2026, 7, 29, 14, 0, 0); // Today is Aug 29. Yesterday was Aug 28.
    assert.equal(isLedgerStale('futures', simTimeNow), true, 'Ledger must be flagged as stale');

    const aug27Open = Date.UTC(2026, 7, 27, 0, 0, 0);
    const aug28Open = Date.UTC(2026, 7, 28, 0, 0, 0);
    const aug27Raw = [aug27Open, '59000', '60000', '58500', '59500', '100', aug27Open + 86400000 - 1, '5950000', 1000, '55', '3272500', '0']; // delta: +595k
    const aug28Raw = [aug28Open, '59500', '61000', '59000', '60500', '120', aug28Open + 86400000 - 1, '7260000', 1200, '70', '4235000', '0']; // delta: +1210k

    const mockAxios = {
      get: async () => ({ data: [aug27Raw, aug28Raw] })
    };

    const synced = await ensureDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now: simTimeNow });
    assert.equal(synced.length, 3, 'Ledger has 3 snapshots after incremental backfill');
    assert.equal(synced[1].utcDate, '2026-08-27');
    assert.equal(synced[2].utcDate, '2026-08-28');
    assert.equal(isLedgerStale('futures', simTimeNow), false, 'Ledger is fresh after backfill');
  });

  it('13. targetCount cleanly slices display points and sums exact bucket count into windowNetDelta', () => {
    // 5 candles
    const t0 = Date.UTC(2026, 7, 28, 10, 0, 0);
    const klines = [0, 1, 2, 3, 4].map(i => {
      const t = t0 + i * 3600000;
      return [t, '60000', '60100', '59900', '60050', '100', t + 3600000 - 1, '6005000', 1000, '60', '3603000', '0']; // delta: +1,201,000 per candle
    });

    const series = buildCvdSeries({
      market: 'futures',
      interval: '1h',
      timeframe: '24H',
      rawKlines: klines,
      dailySnapshots: [],
      targetCount: 3, // request only the last 3 candles
      now: t0 + 5 * 3600000
    });

    assert.equal(series.points.length, 3, 'Output points must have exactly 3 candles');
    assert.equal(series.windowNetDelta, 3 * 1201000, 'windowNetDelta must strictly sum the 3 display candles');
  });

  it('14. concurrent timeframe consumers share one daily-ledger backfill request', async () => {
    const dayOpen = Date.UTC(2026, 7, 28, 0, 0, 0);
    const now = Date.UTC(2026, 7, 29, 12, 0, 0);
    const rawDay = [
      dayOpen, '60000', '61000', '59000', '60500', '1000',
      dayOpen + 86400000 - 1, '60500000', 10000, '600', '36300000', '0'
    ];
    let requestCount = 0;
    let releaseRequest;
    const requestGate = new Promise(resolve => { releaseRequest = resolve; });
    const mockAxios = {
      get: async () => {
        requestCount += 1;
        await requestGate;
        return { data: [rawDay] };
      }
    };

    const consumers = [
      ensureDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now }),
      ensureDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now }),
      ensureDailySnapshots('BTCUSDT', 'futures', { axiosInstance: mockAxios, now })
    ];

    assert.equal(requestCount, 1);
    releaseRequest();
    const results = await Promise.all(consumers);
    assert.equal(requestCount, 1);
    assert.equal(results[0].length, 1);
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  });
});
