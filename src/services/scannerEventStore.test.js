import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveScannerEvent,
  saveScannerEvents,
  queryScannerEvents,
  evaluateForwardOutcome,
  summarizePerformance,
  updatePendingEventOutcomes,
  __resetScannerEventStoreForTests,
} from './scannerEventStore.js';
import { DIRECTIONS, SETUP_STATES, SETUP_TYPES } from './scannerConfig.js';

beforeEach(async () => {
  await __resetScannerEventStoreForTests();
});

test('saveScannerEvent deduplicates by coin, direction, setupType, and formedAt', async () => {
  const event1 = {
    symbol: 'SOLUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.FORMING,
    formedAt: 1700000000000,
    currentPrice: 100,
    triggerPrice: 98,
    invalidationLevel: 96,
    targetLevel: 110,
  };

  await saveScannerEvent(event1);

  // Update same event to READY state
  const event2 = {
    ...event1,
    status: SETUP_STATES.READY,
    confirmedAt: 1700003600000,
  };
  await saveScannerEvent(event2);

  // Save a different event (different setup type)
  const event3 = {
    symbol: 'SOLUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.BREAKOUT_RETEST,
    status: SETUP_STATES.READY,
    formedAt: 1700000000000,
  };
  await saveScannerEvent(event3);

  const all = await queryScannerEvents();
  assert.equal(all.length, 2, 'Should deduplicate event1 and event2 into 1 record');
  const pullback = all.find(e => e.setupType === SETUP_TYPES.PULLBACK);
  assert.equal(pullback.status, SETUP_STATES.READY);
  assert.equal(pullback.confirmedAt, 1700003600000);
});

test('queryScannerEvents filters by direction, status, and setupType', async () => {
  await saveScannerEvents([
    { symbol: 'SOLUSDT', direction: DIRECTIONS.LONG, setupType: SETUP_TYPES.PULLBACK, status: SETUP_STATES.READY, formedAt: 1000 },
    { symbol: 'AVAXUSDT', direction: DIRECTIONS.LONG, setupType: SETUP_TYPES.BREAKOUT_RETEST, status: SETUP_STATES.FORMING, formedAt: 1000 },
    { symbol: 'BEARUSDT', direction: DIRECTIONS.SHORT, setupType: SETUP_TYPES.PULLBACK, status: SETUP_STATES.READY, formedAt: 1000 },
  ]);

  const longs = await queryScannerEvents({ direction: DIRECTIONS.LONG });
  assert.equal(longs.length, 2);

  const readyShorts = await queryScannerEvents({ direction: DIRECTIONS.SHORT, status: SETUP_STATES.READY });
  assert.equal(readyShorts.length, 1);
  assert.equal(readyShorts[0].symbol, 'BEARUSDT');
});

test('evaluateForwardOutcome identifies TRIGGERED_WIN, TRIGGERED_LOSS, and AMBIGUOUS', () => {
  const event = {
    symbol: 'SOLUSDT',
    direction: DIRECTIONS.LONG,
    currentPrice: 100,
    triggerPrice: 100,
    invalidationLevel: 95,
    targetLevel: 110,
  };

  // 1. Reaches target first without hitting stop
  const winCandles = [
    { open: 100, high: 104, low: 98, close: 103, closeTime: 1000 },
    { open: 103, high: 112, low: 101, close: 111, closeTime: 2000 }, // High 112 >= Target 110
  ];
  const btcCandles = [
    { open: 50000, close: 50500 },
    { open: 50500, close: 51000 },
  ];

  const winOutcome = evaluateForwardOutcome(event, winCandles, btcCandles);
  assert.equal(winOutcome.resolution, 'TRIGGERED_WIN');
  assert.equal(winOutcome.resolvedAt, 2000);
  assert.ok(winOutcome.maxFavorableExcursionPct >= 12.0);

  // 2. Hits stop first
  const lossCandles = [
    { open: 100, high: 101, low: 94, close: 94.5, closeTime: 1000 }, // Low 94 <= Stop 95
  ];
  const lossOutcome = evaluateForwardOutcome(event, lossCandles, btcCandles);
  assert.equal(lossOutcome.resolution, 'TRIGGERED_LOSS');

  // 3. Hits both target and stop within the same bar -> AMBIGUOUS
  const ambiguousCandles = [
    { open: 100, high: 112, low: 94, close: 102, closeTime: 1000 }, // High >= 110 AND Low <= 95
  ];
  const ambiguousOutcome = evaluateForwardOutcome(event, ambiguousCandles, btcCandles);
  assert.equal(ambiguousOutcome.resolution, 'AMBIGUOUS');
});

test('summarizePerformance computes winRate and relative return cleanly', () => {
  const events = [
    { direction: 'LONG', status: 'READY', outcomes: { resolution: 'TRIGGERED_WIN', relReturn24hVsBtc: 4.5 } },
    { direction: 'LONG', status: 'READY', outcomes: { resolution: 'TRIGGERED_WIN', relReturn24hVsBtc: 2.5 } },
    { direction: 'SHORT', status: 'READY', outcomes: { resolution: 'TRIGGERED_LOSS', relReturn24hVsBtc: -1.0 } },
  ];

  const summary = summarizePerformance(events);
  assert.equal(summary.totalEvents, 3);
  assert.equal(summary.resolvedCount, 3);
  assert.equal(summary.winRate, 66.7); // 2 out of 3 = 66.7%
  assert.equal(summary.avgRelReturn24h, 2.0); // (4.5 + 2.5 - 1.0) / 3 = 2.0%
});

test('evaluateForwardOutcome evaluates SHORT trades with positive return on price decline and correct relative edge vs BTC', () => {
  const shortEvent = {
    symbol: 'BEARUSDT',
    direction: DIRECTIONS.SHORT,
    currentPrice: 100,
    triggerPrice: 100,
    invalidationLevel: 105,
    targetLevel: 90,
  };

  const dropCandles = [
    { open: 100, high: 101, low: 97, close: 98, closeTime: 1000 },
    { open: 98, high: 99, low: 95, close: 96, closeTime: 2000 },
    { open: 96, high: 97, low: 93, close: 94, closeTime: 3000 },
    { open: 94, high: 95, low: 91, close: 92, closeTime: 4000 },
  ];

  const btcCandles = [
    { open: 50000, close: 49800 },
    { open: 49800, close: 49500 },
    { open: 49500, close: 49200 },
    { open: 49200, close: 49000 },
  ];

  const outcome = evaluateForwardOutcome(shortEvent, dropCandles, btcCandles);
  assert.ok(outcome);
  assert.equal(outcome.return4h, 8.0);
  assert.equal(outcome.relReturn4hVsBtc, 6.0);
  assert.ok(outcome.maxFavorableExcursionPct >= 9.0);
});

test('[P2-5] saveScannerEvents preserves initial discovery snapshot (status, price, timestamp, outcomes) across refreshes', async () => {
  const initialTime = 1700000000000;
  const initialEvent = {
    symbol: 'ETHUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.BREAKOUT_RETEST,
    status: SETUP_STATES.READY,
    formedAt: initialTime,
    confirmedAt: initialTime + 3600000,
    timestamp: initialTime + 3600000,
    currentPrice: 2000,
    triggerPrice: 1980,
    invalidationLevel: 1950,
    targetLevel: 2100,
    distanceAtr: 0.5,
    outcomes: {
      resolution: 'TRIGGERED_WIN',
      return24h: 5.0,
      relReturn24hVsBtc: 3.2,
    },
  };

  await saveScannerEvents([initialEvent]);

  // Later refresh scan: setup has run to EXTENDED at price 2080, and outcomes is null in incoming scan
  const refreshTime = initialTime + 7200000;
  const refreshEvent = {
    symbol: 'ETHUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.BREAKOUT_RETEST,
    status: SETUP_STATES.EXTENDED,
    formedAt: initialTime,
    confirmedAt: initialTime + 3600000,
    timestamp: refreshTime,
    currentPrice: 2080,
    triggerPrice: 1980,
    invalidationLevel: 1950,
    targetLevel: 2100,
    distanceAtr: 2.2,
    outcomes: null,
  };

  await saveScannerEvents([refreshEvent]);

  const all = await queryScannerEvents({ symbol: 'ETHUSDT' });
  assert.equal(all.length, 1);
  const stored = all[0];

  // Immutable discovery snapshot MUST be preserved!
  assert.equal(stored.status, SETUP_STATES.READY);
  assert.equal(stored.currentPrice, 2000);
  assert.equal(stored.timestamp, initialTime + 3600000);
  assert.equal(stored.initialStatus, SETUP_STATES.READY);
  assert.equal(stored.initialPrice, 2000);

  // Existing outcomes MUST NOT be wiped to null!
  assert.ok(stored.outcomes);
  assert.equal(stored.outcomes.resolution, 'TRIGGERED_WIN');
  assert.equal(stored.outcomes.return24h, 5.0);

  // Latest status and price are tracked separately
  assert.equal(stored.latestStatus, SETUP_STATES.EXTENDED);
  assert.equal(stored.latestPrice, 2080);
  assert.equal(stored.latestDistanceAtr, 2.2);
});

test('[P2-5] evaluateForwardOutcome strictly requires at least 24 future candles for return24h, returning null when insufficient', () => {
  const event = {
    symbol: 'SOLUSDT',
    direction: DIRECTIONS.LONG,
    currentPrice: 100,
    triggerPrice: 100,
    invalidationLevel: 80, // Far stop so it doesn't trigger
    targetLevel: 150, // Far target so it doesn't trigger
  };

  // 1. Only 23 candles: return24h must be null
  const candles23 = Array.from({ length: 23 }, (_, i) => ({
    open: 100, high: 102, low: 98, close: 101, closeTime: 1000 + (i * 3600000),
  }));
  const btcCandles23 = Array.from({ length: 23 }, () => ({ open: 50000, close: 50500 }));

  const outcome23 = evaluateForwardOutcome(event, candles23, btcCandles23);
  assert.equal(outcome23.return24h, null, 'Must be null when < 24 candles');
  assert.equal(outcome23.relReturn24hVsBtc, null, 'Must be null when < 24 candles');
  assert.notEqual(outcome23.return4h, null, 'return4h should be computed with 23 candles');

  // 2. Exactly 24 candles: return24h is computed from candle index 23
  const candles24 = [...candles23, { open: 101, high: 106, low: 100, close: 105, closeTime: 1000 + (23 * 3600000) }];
  const btcCandles24 = [...btcCandles23, { open: 50500, close: 51000 }];

  const outcome24 = evaluateForwardOutcome(event, candles24, btcCandles24);
  assert.equal(outcome24.return24h, 5.0); // (105 / 100 - 1) * 100 = +5.0%
  assert.notEqual(outcome24.relReturn24hVsBtc, null);

  // 3. Only 3 candles: return4h must be null
  const candles3 = candles23.slice(0, 3);
  const outcome3 = evaluateForwardOutcome(event, candles3, btcCandles23.slice(0, 3));
  assert.equal(outcome3.return4h, null, 'Must be null when < 4 candles');
  assert.equal(outcome3.relReturn4hVsBtc, null);
});

test('[P2-5] updatePendingEventOutcomes resolves pending READY events and updates store', async () => {
  const eventTime = 1700000000000;
  await saveScannerEvent({
    symbol: 'AVAXUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.READY,
    formedAt: eventTime,
    confirmedAt: eventTime + 3600000,
    timestamp: eventTime + 3600000,
    currentPrice: 20,
    triggerPrice: 20,
    invalidationLevel: 18,
    targetLevel: 25,
    outcomes: { resolution: 'UNRESOLVED' },
  });

  const mockCandles = Array.from({ length: 25 }, (_, i) => ({
    openTime: eventTime + 3600000 + (i * 3600000),
    open: 20 + i * 0.3,
    high: i === 10 ? 26 : 20 + i * 0.3 + 0.5, // hits target 25 at candle 10
    low: 19,
    close: 20 + i * 0.3 + 0.2,
    closeTime: eventTime + 3600000 + ((i + 1) * 3600000) - 1,
  }));

  const mockBtcCandles = Array.from({ length: 25 }, (_, i) => ({
    openTime: eventTime + 3600000 + (i * 3600000),
    open: 50000,
    high: 51000,
    low: 49000,
    close: 50500,
    closeTime: eventTime + 3600000 + ((i + 1) * 3600000) - 1,
  }));

  const updated = await updatePendingEventOutcomes({
    fetchCandles: async (symbol) => (symbol === 'BTCUSDT' ? mockBtcCandles : mockCandles),
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].outcomes.resolution, 'TRIGGERED_WIN');
  assert.equal(updated[0].status, SETUP_STATES.READY);
  assert.equal(updated[0].currentPrice, 20);

  const stored = (await queryScannerEvents({ symbol: 'AVAXUSDT' }))[0];
  assert.equal(stored.outcomes.resolution, 'TRIGGERED_WIN');
});

test('saveScannerEvents transitions existing FORMING event to READY with confirmation price and preserves across EXTENDED', async () => {
  const baseTime = 1700000000000;
  // 1. Initial scan: coin is FORMING at price 95
  await saveScannerEvents([{
    symbol: 'NEARUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.FORMING,
    formedAt: baseTime,
    timestamp: baseTime,
    currentPrice: 95,
    triggerPrice: 95,
    invalidationLevel: 92,
    targetLevel: 105,
  }]);

  let all = await queryScannerEvents({ symbol: 'NEARUSDT' });
  assert.equal(all.length, 1);
  assert.equal(all[0].status, SETUP_STATES.FORMING);
  assert.equal(all[0].initialPrice, 95);

  // 2. Later scan: confirms into READY at confirmationPrice 100
  const confirmTime = baseTime + 3600000;
  await saveScannerEvents([{
    symbol: 'NEARUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.READY,
    formedAt: baseTime,
    confirmedAt: confirmTime,
    confirmationPrice: 100,
    timestamp: confirmTime,
    currentPrice: 100,
    triggerPrice: 95,
    invalidationLevel: 92,
    targetLevel: 105,
  }]);

  all = await queryScannerEvents({ symbol: 'NEARUSDT' });
  assert.equal(all.length, 1);
  assert.equal(all[0].status, SETUP_STATES.READY);
  assert.equal(all[0].initialStatus, SETUP_STATES.READY);
  // Initial price for the READY discovery must be 100 (NOT the old 95 from FORMING!)
  assert.equal(all[0].initialPrice, 100);
  assert.equal(all[0].confirmationPrice, 100);

  // 3. Later scan: price moves to 108 and becomes EXTENDED
  const refreshTime = baseTime + 7200000;
  await saveScannerEvents([{
    symbol: 'NEARUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.EXTENDED,
    formedAt: baseTime,
    confirmedAt: confirmTime,
    confirmationPrice: 100,
    timestamp: refreshTime,
    currentPrice: 108,
    triggerPrice: 95,
    invalidationLevel: 92,
    targetLevel: 105,
  }]);

  all = await queryScannerEvents({ symbol: 'NEARUSDT' });
  assert.equal(all.length, 1);
  // Discovery snapshot must be locked to the READY confirmation price (100)
  assert.equal(all[0].status, SETUP_STATES.READY);
  assert.equal(all[0].initialStatus, SETUP_STATES.READY);
  assert.equal(all[0].initialPrice, 100);
  assert.equal(all[0].confirmationPrice, 100);
  assert.equal(all[0].currentPrice, 100);
  // Latest values reflect new scan
  assert.equal(all[0].latestStatus, SETUP_STATES.EXTENDED);
  assert.equal(all[0].latestPrice, 108);
});

test('updatePendingEventOutcomes backfills 24h return for early-resolved trades once 24 candles arrive', async () => {
  const eventTime = 1700000000000;
  // Save an event that already resolved early (e.g. at candle 2 as TRIGGERED_WIN) but has return24h = null
  await saveScannerEvent({
    symbol: 'LINKUSDT',
    direction: DIRECTIONS.LONG,
    setupType: SETUP_TYPES.PULLBACK,
    status: SETUP_STATES.READY,
    formedAt: eventTime,
    confirmedAt: eventTime + 3600000,
    timestamp: eventTime + 3600000,
    currentPrice: 15,
    triggerPrice: 15,
    invalidationLevel: 14,
    targetLevel: 18,
    outcomes: {
      resolution: 'TRIGGERED_WIN',
      return4h: 10.0,
      return24h: null,
      relReturn24hVsBtc: null,
    },
  });

  // Now 25 candles are available
  const mockCandles = Array.from({ length: 25 }, (_, i) => ({
    openTime: eventTime + 3600000 + (i * 3600000),
    open: 15 + i * 0.2,
    high: i === 2 ? 19 : 15 + i * 0.2 + 0.3, // Hit TP at candle 2
    low: 14.5,
    close: 15 + i * 0.2 + 0.1,
    closeTime: eventTime + 3600000 + ((i + 1) * 3600000) - 1,
  }));

  const mockBtcCandles = Array.from({ length: 25 }, (_, i) => ({
    openTime: eventTime + 3600000 + (i * 3600000),
    open: 50000,
    high: 51000,
    low: 49000,
    close: 50000 + (i * 50),
    closeTime: eventTime + 3600000 + ((i + 1) * 3600000) - 1,
  }));

  const updated = await updatePendingEventOutcomes({
    fetchCandles: async (symbol) => (symbol === 'BTCUSDT' ? mockBtcCandles : mockCandles),
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].outcomes.resolution, 'TRIGGERED_WIN');
  assert.notEqual(updated[0].outcomes.return24h, null, 'return24h must now be populated');
  assert.notEqual(updated[0].outcomes.relReturn24hVsBtc, null);
});

test('saveScannerEvents deduplicates multiple events with the same id in one batch', async () => {
  const baseTime = 1700000000000;
  const batch = [
    {
      symbol: 'DOTUSDT',
      direction: DIRECTIONS.LONG,
      setupType: SETUP_TYPES.PULLBACK,
      status: SETUP_STATES.FORMING,
      formedAt: baseTime,
      currentPrice: 7.0,
    },
    {
      symbol: 'DOTUSDT',
      direction: DIRECTIONS.LONG,
      setupType: SETUP_TYPES.PULLBACK,
      status: SETUP_STATES.READY,
      formedAt: baseTime,
      currentPrice: 7.5,
    },
  ];

  const results = await saveScannerEvents(batch);
  assert.equal(results.length, 1);
  const stored = (await queryScannerEvents({ symbol: 'DOTUSDT' }))[0];
  assert.equal(stored.status, SETUP_STATES.READY);
  assert.equal(stored.currentPrice, 7.5);
});


