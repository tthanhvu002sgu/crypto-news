import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectTopImpulseMoves,
  enrichMoveWithMicrostructure,
  formatForensicsPayloadForAi
} from './moveForensicsEngine.js';

test('detectTopImpulseMoves handles empty or invalid inputs gracefully', () => {
  assert.deepEqual(detectTopImpulseMoves([]), []);
  assert.deepEqual(detectTopImpulseMoves(null), []);
  assert.deepEqual(detectTopImpulseMoves(undefined), []);
  assert.deepEqual(detectTopImpulseMoves([{ time: null, open: null }]), []);
});

test('detectTopImpulseMoves identifies top moves and clusters consecutive impulse candles', () => {
  const baseTime = 1700000000000;
  const klines = [];

  // Generate 20 neutral bars
  for (let i = 0; i < 20; i++) {
    klines.push({
      time: baseTime + i * 900000,
      open: 10000,
      high: 10020,
      low: 9980,
      close: 10005,
      volume: 10,
      quoteVolume: 100000,
      takerBuyQuoteVolume: 50000
    });
  }

  // Bar 5: Single sharp pump (+5%)
  klines[5] = {
    time: baseTime + 5 * 900000,
    open: 10000,
    high: 10550,
    low: 9990,
    close: 10500,
    volume: 50,
    quoteVolume: 500000,
    takerBuyQuoteVolume: 400000
  };

  // Bar 10 & 11: Consecutive sharp dump (bar 10: -3%, bar 11: -3% -> total ~ -5.9%)
  klines[10] = {
    time: baseTime + 10 * 900000,
    open: 10000,
    high: 10010,
    low: 9690,
    close: 9700,
    volume: 60,
    quoteVolume: 600000,
    takerBuyQuoteVolume: 150000
  };
  klines[11] = {
    time: baseTime + 11 * 900000,
    open: 9700,
    high: 9710,
    low: 9400,
    close: 9409,
    volume: 70,
    quoteVolume: 700000,
    takerBuyQuoteVolume: 100000
  };

  // Bar 15: Moderate pump (+2.5%)
  klines[15] = {
    time: baseTime + 15 * 900000,
    open: 10000,
    high: 10260,
    low: 9990,
    close: 10250,
    volume: 30,
    quoteVolume: 300000,
    takerBuyQuoteVolume: 220000
  };

  const top3 = detectTopImpulseMoves(klines, 3);
  assert.equal(top3.length, 3);

  // Moves should be sorted chronologically in return array
  assert.ok(top3[0].startTime <= top3[1].startTime);
  assert.ok(top3[1].startTime <= top3[2].startTime);

  // One of the moves must be the clustered dump (candleCount === 2, drop ~ -5.9%)
  const clusteredDump = top3.find(m => m.candleCount === 2);
  assert.ok(clusteredDump, 'Should cluster consecutive dump candles 10 and 11');
  assert.equal(clusteredDump.direction, 'DUMP');
  assert.ok(clusteredDump.priceChangePercent < -5.5);
  assert.equal(clusteredDump.startPrice, 10000);
  assert.equal(clusteredDump.endPrice, 9409);

  // Single sharp pump (+5%)
  const sharpPump = top3.find(m => m.direction === 'PUMP' && m.priceChangePercent >= 4.5);
  assert.ok(sharpPump, 'Should capture sharp pump');
  assert.equal(sharpPump.candleCount, 1);
});

test('enrichMoveWithMicrostructure enriches moves with OI, CVD, Macro events, and forward reactions', () => {
  const baseTime = 1700000000000;
  const mockMoves = [
    {
      startIndex: 5,
      endIndex: 5,
      candleCount: 1,
      startTime: baseTime + 5 * 900000,
      endTime: baseTime + 5 * 900000,
      startPrice: 90000,
      endPrice: 95000,
      highPrice: 95500,
      lowPrice: 89900,
      priceChange: 5000,
      priceChangePercent: 5.55,
      direction: 'PUMP',
      volume: 100,
      quoteVolume: 9000000,
      takerCvdDelta: 4000000
    },
    {
      startIndex: 25,
      endIndex: 25,
      candleCount: 1,
      startTime: baseTime + 25 * 900000,
      endTime: baseTime + 25 * 900000,
      startPrice: 95000,
      endPrice: 90000,
      highPrice: 95100,
      lowPrice: 89800,
      priceChange: -5000,
      priceChangePercent: -5.26,
      direction: 'DUMP',
      volume: 120,
      quoteVolume: 11000000,
      takerCvdDelta: -5000000
    }
  ];

  const oiHistory = [
    { timestamp: baseTime + 4 * 900000, sumOpenInterest: 100000 },
    { timestamp: baseTime + 6 * 900000, sumOpenInterest: 95000 },  // OI dropped 5000 during pump -> Short Squeeze
    { timestamp: baseTime + 24 * 900000, sumOpenInterest: 95000 },
    { timestamp: baseTime + 26 * 900000, sumOpenInterest: 90000 }  // OI dropped 5000 during dump -> Long Liquidation Flush
  ];

  const lsHistory = [
    { timestamp: baseTime + 5 * 900000, longShortRatio: 1.25 },
    { timestamp: baseTime + 25 * 900000, longShortRatio: 0.85 }
  ];

  const calendarEvents = [
    { date: new Date(baseTime + 5 * 900000).toISOString(), title: 'US CPI Release', impact: 'high', country: 'USD' }
  ];

  // Full klines including forward candles (1h, 4h later)
  const klines = [
    { time: baseTime + 5 * 900000, open: 90000, high: 95500, low: 89900, close: 95000 },
    { time: baseTime + 5 * 900000 + 3600000, open: 95000, high: 96000, low: 94500, close: 95800 }, // 1h later: continued pump
    { time: baseTime + 5 * 900000 + 4 * 3600000, open: 95800, high: 97000, low: 95000, close: 96500 }, // 4h later: continuation
    { time: baseTime + 25 * 900000, open: 95000, high: 95100, low: 89800, close: 90000 },
    { time: baseTime + 25 * 900000 + 3600000, open: 90000, high: 91000, low: 89000, close: 89500 }
  ];

  const enriched = enrichMoveWithMicrostructure(mockMoves, {
    oiHistory,
    lsHistory,
    calendarEvents,
    klines
  });

  assert.equal(enriched.length, 2);

  // Move 1: Matched with high impact US CPI -> MACRO_NEWS_REACTION
  const m1 = enriched[0];
  assert.equal(m1.mechanismHypothesis, 'MACRO_NEWS_REACTION');
  assert.ok(m1.matchingCalendarEvents.length >= 1);
  assert.equal(m1.matchingCalendarEvents[0].title, 'US CPI Release');
  assert.equal(m1.lsRatio, 1.25);
  assert.ok(m1.oiDelta < 0, 'OI should be negative');
  assert.equal(m1.forwardReactions.price1h, 95800);
  assert.equal(m1.forwardReactions.trendContinuation, 'CONTINUATION_CONFIRMED');

  // Move 2: Dump with OI dropping and no macro -> LONG_LIQUIDATION_CASCADE
  const m2 = enriched[1];
  assert.equal(m2.mechanismHypothesis, 'LONG_LIQUIDATION_CASCADE');
  assert.equal(m2.lsRatio, 0.85);
  assert.ok(m2.oiDelta < 0);
});

test('enrichMoveWithMicrostructure identifies SHORT_SQUEEZE and ABSORPTION_TRAP correctly', () => {
  const baseTime = 1700000000000;
  
  // Test SHORT_SQUEEZE (PUMP + OI contraction, no macro event, low retracement)
  const squeezeMove = [{
    startIndex: 1,
    endIndex: 1,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime,
    startPrice: 80000,
    endPrice: 84000,
    highPrice: 84200,
    lowPrice: 79900,
    priceChange: 4000,
    priceChangePercent: 5.0,
    direction: 'PUMP',
    takerCvdDelta: 1000000
  }];

  const enrichedSqueeze = enrichMoveWithMicrostructure(squeezeMove, {
    oiHistory: [
      { timestamp: baseTime - 60000, sumOpenInterest: 100000 },
      { timestamp: baseTime + 60000, sumOpenInterest: 96000 } // -4% OI
    ],
    klines: [
      { time: baseTime, open: 80000, high: 84200, low: 79900, close: 84000 },
      { time: baseTime + 3600000, open: 84000, high: 84500, low: 83500, close: 84100 } // retracement <= 0%
    ]
  });
  assert.equal(enrichedSqueeze[0].mechanismHypothesis, 'SHORT_SQUEEZE');

  // Test ABSORPTION_TRAP (PUMP immediately retraced > 70%)
  const trapMove = [{
    startIndex: 1,
    endIndex: 1,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime,
    startPrice: 80000,
    endPrice: 84000,
    highPrice: 84200,
    lowPrice: 79900,
    priceChange: 4000,
    priceChangePercent: 5.0,
    direction: 'PUMP',
    takerCvdDelta: 1000000
  }];

  const enrichedTrap = enrichMoveWithMicrostructure(trapMove, {
    klines: [
      { time: baseTime, open: 80000, high: 84200, low: 79900, close: 84000 },
      { time: baseTime + 3600000, open: 84000, high: 84100, low: 80500, close: 80500 } // price dropped back to 80500 (87.5% retraced)
    ]
  });
  assert.equal(enrichedTrap[0].mechanismHypothesis, 'ABSORPTION_TRAP');
});

test('formatForensicsPayloadForAi formats valid Markdown tables and details', () => {
  const mockMoves24h = [
    {
      rank: 1,
      startTimeVn: '2026-11-03 14:00 (GMT+7)',
      endTimeVn: '2026-11-03 14:30 (GMT+7)',
      candleCount: 2,
      direction: 'PUMP',
      startPrice: 91000,
      endPrice: 93500,
      highPrice: 93800,
      lowPrice: 90900,
      priceChangePercent: 2.75,
      takerCvdDelta: 45000000,
      quoteVolume: 350000000,
      oiBefore: 120000,
      oiAfter: 118000,
      oiDeltaPercent: -1.67,
      lsRatio: 1.15,
      mechanismHypothesis: 'SHORT_SQUEEZE',
      mechanismExplanation: 'Phe Short bị ép thanh lý hoặc cắt lỗ hàng loạt.',
      forwardReactions: {
        price1h: 93400,
        price4h: 94000,
        retracementPercent: 4.0,
        trendContinuation: 'CONTINUATION_CONFIRMED'
      }
    }
  ];

  const mockMoves7d = [
    {
      rank: 1,
      startTimeVn: '2026-11-01 08:00 (GMT+7)',
      candleCount: 3,
      direction: 'DUMP',
      startPrice: 96000,
      endPrice: 91500,
      highPrice: 96200,
      lowPrice: 91200,
      priceChangePercent: -4.69,
      takerCvdDelta: -120000000,
      quoteVolume: 850000000,
      mechanismHypothesis: 'LONG_LIQUIDATION_CASCADE',
      mechanismExplanation: 'Thanh lý dây chuyền các vị thế Long.',
      forwardReactions: {
        retracementPercent: 15.0,
        trendContinuation: 'CONTINUATION_CONFIRMED'
      }
    }
  ];

  const payload = formatForensicsPayloadForAi(mockMoves24h, mockMoves7d);
  assert.ok(typeof payload === 'string');
  assert.match(payload, /## DỮ LIỆU GIẢI PHẪU BIẾN ĐỘNG GIÁ/);
  assert.match(payload, /TOP 3 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 24H QUA/);
  assert.match(payload, /TOP 5 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 7 NGÀY QUA/);
  assert.match(payload, /SHORT_SQUEEZE/);
  assert.match(payload, /LONG_LIQUIDATION_CASCADE/);
  assert.match(payload, /91,000/);
  assert.match(payload, /93,500/);
});

test('detectTopImpulseMoves accurately calculates candleDuration and assigns endTime', () => {
  const baseTime = 1700000000000;
  const klines = [
    { time: baseTime, open: 100, high: 101, low: 99, close: 100, volume: 10 },
    { time: baseTime + 900000, open: 100, high: 106, low: 99, close: 105, volume: 100, quoteVolume: 10000, takerBuyQuoteVolume: 8000 },
    { time: baseTime + 1800000, open: 105, high: 105, low: 104, close: 104.5, volume: 10 }
  ];

  const top1 = detectTopImpulseMoves(klines, 1);
  assert.equal(top1.length, 1);
  const move = top1[0];
  assert.equal(move.startTime, baseTime + 900000);
  assert.equal(move.endTime, baseTime + 1800000, 'endTime should be startTime + 900000ms duration');
  assert.ok(move.endTime > move.startTime);
});

test('enrichMoveWithMicrostructure enforces tolerance and returns null for future unformed forward prices', () => {
  const baseTime = 1700000000000;
  const move = [{
    startIndex: 0,
    endIndex: 0,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime + 900000,
    startPrice: 100,
    endPrice: 105,
    direction: 'PUMP',
    priceChangePercent: 5.0
  }];

  // Dataset only has candles up to 15m after the move
  const klines = [
    { time: baseTime, open: 100, close: 105 },
    { time: baseTime + 900000, open: 105, close: 104 }
  ];

  const enriched = enrichMoveWithMicrostructure(move, { klines });
  assert.equal(enriched[0].forwardReactions.price1h, null, 'price1h should be null when not enough time elapsed');
  assert.equal(enriched[0].forwardReactions.price4h, null, 'price4h should be null');
  assert.equal(enriched[0].forwardReactions.price12h, null, 'price12h should be null');
  assert.equal(enriched[0].forwardReactions.retracementPercent, null);
  assert.equal(enriched[0].forwardReactions.trendContinuation, 'DEVELOPING_IN_PROGRESS');
});

test('enrichMoveWithMicrostructure rejects OI data outside the timestamp coverage window', () => {
  const baseTime = 1700000000000;
  // Move was 4 days ago
  const oldMove = [{
    startIndex: 0,
    endIndex: 0,
    candleCount: 1,
    startTime: baseTime - 4 * 86400000,
    endTime: baseTime - 4 * 86400000 + 3600000,
    startPrice: 90000,
    endPrice: 95000,
    direction: 'PUMP',
    priceChangePercent: 5.5
  }];

  // OI history is only available for the last 24h
  const recentOiHistory = [
    { timestamp: baseTime - 86400000, sumOpenInterest: 50000 },
    { timestamp: baseTime - 43200000, sumOpenInterest: 51000 },
    { timestamp: baseTime, sumOpenInterest: 52000 }
  ];

  const enriched = enrichMoveWithMicrostructure(oldMove, { oiHistory: recentOiHistory });
  assert.equal(enriched[0].oiDelta, null, 'Should not fabricate OI delta from mismatched 24h window');
  assert.equal(enriched[0].oiDeltaPercent, null);
  assert.equal(enriched[0].oiBefore, null);
  assert.equal(enriched[0].oiAfter, null);
});

test('detectTopImpulseMoves captures liquidity sweep wicks (Stop Hunts) even with small candle body', () => {
  const baseTime = 1700000000000;
  const klines = [
    // 5 flat bars
    { time: baseTime, open: 10000, high: 10020, low: 9980, close: 10005, volume: 10 },
    { time: baseTime + 900000, open: 10005, high: 10025, low: 9985, close: 10010, volume: 10 },
    // Bar 2: Huge lower wick sweep: open 10010, crashed to 9500 (-5.1%), but closed back up at 10020 (+0.1% body)
    {
      time: baseTime + 2 * 900000,
      open: 10010,
      high: 10030,
      low: 9500,
      close: 10020,
      volume: 120,
      quoteVolume: 1200000,
      takerBuyQuoteVolume: 800000
    },
    // Another flat bar
    { time: baseTime + 3 * 900000, open: 10020, high: 10035, low: 10010, close: 10025, volume: 10 },
  ];

  const top1 = detectTopImpulseMoves(klines, 1);
  assert.equal(top1.length, 1);
  const sweepMove = top1[0];
  assert.equal(sweepMove.startIndex, 2);
  assert.equal(sweepMove.moveType, 'LIQUIDITY_SWEEP_LOW');
  assert.ok(sweepMove.rangePercent > 5.0, 'Range percent should exceed 5%');
  assert.ok(sweepMove.lowerWickRatio > 0.5, 'Lower wick should dominate the candle');
});

test('detectTopImpulseMoves smart clusters impulse moves with a small pause/pullback candle', () => {
  const baseTime = 1700000000000;
  const klines = [
    { time: baseTime, open: 10000, high: 10020, low: 9980, close: 10000, volume: 10 },
    // Bar 1: Strong pump +2% (10000 -> 10200)
    { time: baseTime + 900000, open: 10000, high: 10210, low: 9990, close: 10200, volume: 50 },
    // Bar 2: Small pause/inside bar -0.15% (10200 -> 10185)
    { time: baseTime + 2 * 900000, open: 10200, high: 10210, low: 10175, close: 10185, volume: 15 },
    // Bar 3: Continuation pump +2.5% (10185 -> 10440)
    { time: baseTime + 3 * 900000, open: 10185, high: 10450, low: 10180, close: 10440, volume: 60 },
    { time: baseTime + 4 * 900000, open: 10440, high: 10450, low: 10430, close: 10440, volume: 10 },
  ];

  const top = detectTopImpulseMoves(klines, 1, { maxClusterLength: 4 });
  assert.equal(top.length, 1);
  const clusteredMove = top[0];
  assert.equal(clusteredMove.candleCount, 3, 'Should cluster all 3 bars including the pause candle');
  assert.equal(clusteredMove.startPrice, 10000);
  assert.equal(clusteredMove.endPrice, 10440);
  assert.ok(clusteredMove.priceChangePercent > 4.0);
});

test('enrichMoveWithMicrostructure identifies SWEEP_AND_RECLAIM_LOW and incorporates HFT liquidations', () => {
  const baseTime = 1700000000000;
  const sweepMove = [{
    startIndex: 1,
    endIndex: 1,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime + 900000,
    startPrice: 90000,
    endPrice: 90100,
    highPrice: 90200,
    lowPrice: 86000,
    priceChange: 100,
    priceChangePercent: 0.11,
    rangePercent: 4.88,
    moveType: 'LIQUIDITY_SWEEP_LOW',
    direction: 'PUMP',
    lowerWickRatio: 0.85,
    intracandleRetracePercent: 97.0
  }];

  const localMoveStore = [{
    triggerTime: baseTime + 60000,
    qualityTier: 'TIER_A',
    flowLabel: 'SWEEP_DUMP_REVERSED',
    liqLongUsd: 2500000, // 2.5M Long liquidation
    liqShortUsd: 100000
  }];

  const enriched = enrichMoveWithMicrostructure(sweepMove, { localMoveStore });
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].mechanismHypothesis, 'SWEEP_AND_RECLAIM_LOW');
  assert.ok(enriched[0].localTrackerMatch != null);
  assert.equal(enriched[0].localTrackerMatch.liqLongUsd, 2500000);
});

test('detectTopImpulseMoves and enrichMoveWithMicrostructure support H4 structural expansion composed of smaller H1 bars', () => {
  const baseTime = 1700000000000;
  const H1_MS = 3600 * 1000;
  const H4_MS = 4 * 3600 * 1000;

  // Simulate 4 small H1 candles (each +0.8%, total ~ +3.25%)
  // On H1 individual bars, each change is small (~0.8%)
  const h1Candles = [
    { time: baseTime, open: 10000, high: 10090, low: 9990, close: 10080 },
    { time: baseTime + H1_MS, open: 10080, high: 10170, low: 10070, close: 10160 },
    { time: baseTime + 2 * H1_MS, open: 10160, high: 10250, low: 10150, close: 10240 },
    { time: baseTime + 3 * H1_MS, open: 10240, high: 10350, low: 10230, close: 10325 }
  ];

  // On H1 candles alone without clustering across sessions, each single bar is only ~0.8%
  const detectedH1 = detectTopImpulseMoves(h1Candles, 1, { maxClusterLength: 1 });
  assert.equal(detectedH1.length, 1);
  assert.ok(detectedH1[0].priceChangePercent < 1.0, 'Individual H1 candles are small (< 1%)');

  // Aggregated H4 klines:
  const h4Klines = [
    // Preceding neutral bar
    { time: baseTime - H4_MS, open: 10000, high: 10020, low: 9980, close: 10000, volume: 10, quoteVolume: 100000 },
    // The big H4 bar aggregating the 4 small H1 candles (+3.25% gain)
    {
      time: baseTime,
      open: 10000,
      high: 10350,
      low: 9980,
      close: 10325,
      volume: 120,
      quoteVolume: 1200000,
      takerBuyQuoteVolume: 900000 // Positive Taker CVD Delta
    },
    // Forward H4 bars
    // Immediately following bar (+0h to +4h from endTime):
    { time: baseTime + H4_MS, open: 10325, high: 10330, low: 10260, close: 10270, volume: 50 },
    // +4h from endTime (baseTime + 2 * H4_MS):
    { time: baseTime + 2 * H4_MS, open: 10270, high: 10280, low: 10230, close: 10240, volume: 50 },
    // +8h from endTime (baseTime + 3 * H4_MS):
    { time: baseTime + 3 * H4_MS, open: 10240, high: 10270, low: 10230, close: 10250, volume: 50 },
    // +12h from endTime (baseTime + 4 * H4_MS):
    { time: baseTime + 4 * H4_MS, open: 10250, high: 10280, low: 10240, close: 10260, volume: 50 },
    // +16h from endTime (baseTime + 5 * H4_MS):
    { time: baseTime + 5 * H4_MS, open: 10260, high: 10290, low: 10250, close: 10270, volume: 50 },
    // +20h from endTime (baseTime + 6 * H4_MS):
    { time: baseTime + 6 * H4_MS, open: 10270, high: 10300, low: 10260, close: 10280, volume: 50 },
    // +24h from endTime (baseTime + 7 * H4_MS):
    { time: baseTime + 7 * H4_MS, open: 10280, high: 10310, low: 10270, close: 10290, volume: 50 },
  ];

  // 1. Detect H4 moves
  const detectedH4 = detectTopImpulseMoves(h4Klines, 1, {
    maxClusterLength: 4,
    candleDurationMs: H4_MS
  });

  assert.equal(detectedH4.length, 1);
  const m = detectedH4[0];
  assert.equal(m.candleCount, 1, 'H4 bar is detected as single large impulse');
  assert.equal(m.startTime, baseTime);
  assert.equal(m.endTime, baseTime + H4_MS);
  assert.equal(m.startPrice, 10000);
  assert.equal(m.endPrice, 10325);
  assert.ok(Math.abs(m.priceChangePercent - 3.25) < 0.01);
  assert.equal(m.direction, 'PUMP');

  // 2. Enrich with microstructure and check forward reactions
  const enrichedH4 = enrichMoveWithMicrostructure(detectedH4, {
    klines: h4Klines
  });

  assert.equal(enrichedH4.length, 1);
  const em = enrichedH4[0];
  // On H4 klines, price1h should be null (cannot resolve within 45m tolerance from 4h bars)
  assert.equal(em.forwardReactions.price1h, null);
  // price4h (+4h), price12h (+12h), price24h (+24h) should resolve properly
  assert.equal(em.forwardReactions.price4h, 10240);
  assert.equal(em.forwardReactions.price12h, 10260);
  assert.equal(em.forwardReactions.price24h, 10290);
  // Retracement should fall back cleanly to price4h and confirm continuation (retraced 85/325 = 26.15% <= 35%)
  assert.ok(em.forwardReactions.retracementPercent != null);
  assert.ok(Math.abs(em.forwardReactions.retracementPercent - 26.15) < 0.1);
  assert.equal(em.forwardReactions.trendContinuation, 'CONTINUATION_CONFIRMED');
});

test('formatForensicsPayloadForAi supports H4 structural waves and preserves backward compatibility', () => {
  const baseTime = 1700000000000;
  const mockMove = (direction, pct) => ({
    rank: 1,
    startTime: baseTime,
    endTime: baseTime + 3600000,
    startTimeVn: '2026-11-04 14:00 (GMT+7)',
    fullTimeVn: 'Ngày 04/11/2026 lúc 14:00 (GMT+7)',
    candleCount: 1,
    direction,
    startPrice: 90000,
    endPrice: direction === 'PUMP' ? 90000 * (1 + pct / 100) : 90000 * (1 - pct / 100),
    highPrice: 95000,
    lowPrice: 89000,
    priceChangePercent: direction === 'PUMP' ? pct : -pct,
    rangePercent: 6.67,
    takerCvdDelta: 5000000,
    quoteVolume: 20000000,
    oiBefore: 50000,
    oiAfter: 52000,
    oiDeltaPercent: 4.0,
    lsRatio: 1.35,
    mechanismHypothesis: 'AGGRESSIVE_TAKER_BUYING',
    mechanismExplanation: 'Dòng tiền mua chủ động lớn.',
    forwardReactions: {
      price1h: 94000,
      price4h: 94500,
      price12h: 95000,
      price24h: 95500,
      retracementPercent: 10.0,
      trendContinuation: 'CONTINUATION_CONFIRMED'
    }
  });

  const m24h = [mockMove('PUMP', 4.5)];
  const m7d = [mockMove('DUMP', 3.8)];
  const mH4 = [mockMove('PUMP', 5.2)];

  // Case 1: 3 arguments with H4 moves array -> Section 3 included
  const payload3Args = formatForensicsPayloadForAi(m24h, m7d, mH4);
  assert.match(payload3Args, /### 1\. TOP 3 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 24H QUA/);
  assert.match(payload3Args, /### 2\. TOP 5 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 7 NGÀY QUA/);
  assert.match(payload3Args, /### 3\. TOP 5 ĐỢT BIẾN ĐỢT|### 3\. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H \(H4 STRUCTURAL WAVES\)/);
  assert.match(payload3Args, /AGGRESSIVE_TAKER_BUYING/);

  // Case 2: 2 arguments only -> Section 3 NOT included (Backward compatible)
  const payload2Args = formatForensicsPayloadForAi(m24h, m7d);
  assert.match(payload2Args, /### 1\. TOP 3 ĐỢT BIẾN ĐỘNG GIÁ/);
  assert.match(payload2Args, /### 2\. TOP 5 ĐỢT BIẾN ĐỘNG GIÁ/);
  assert.doesNotMatch(payload2Args, /### 3\. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H/);

  // Case 3: 3rd argument is legacy context object -> Section 3 NOT included
  const payloadContextObject = formatForensicsPayloadForAi(m24h, m7d, { someOldSetting: true });
  assert.doesNotMatch(payloadContextObject, /### 3\. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H/);

  // Case 4: 3rd argument is explicitly undefined -> Section 3 NOT included
  const payloadUndefined = formatForensicsPayloadForAi(m24h, m7d, undefined);
  assert.doesNotMatch(payloadUndefined, /### 3\. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H/);

  // Case 5: 3rd argument is empty array -> Section 3 included with empty indicator
  const payloadEmptyH4 = formatForensicsPayloadForAi(m24h, m7d, []);
  assert.match(payloadEmptyH4, /### 3\. TOP 5 ĐỢT BIẾN ĐỘNG CẤU TRÚC KHUNG 4H/);
  assert.match(payloadEmptyH4, /Không ghi nhận biến động đột biến nào trên khung 4h/);
});

test('enrichMoveWithMicrostructure dynamically scales tolerance for H4 candles to match 4h OI and LS intervals', () => {
  const baseTime = 1700000000000;
  const H4_MS = 4 * 3600 * 1000;

  // Single 4h move from baseTime to baseTime + 4h
  const h4Move = [{
    startIndex: 0,
    endIndex: 0,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime + H4_MS,
    startPrice: 85000,
    endPrice: 88000,
    highPrice: 88200,
    lowPrice: 84900,
    priceChange: 3000,
    priceChangePercent: 3.53,
    direction: 'PUMP',
    takerCvdDelta: 2500000
  }];

  // 4H OI points spaced 4 hours apart (e.g., at baseTime and baseTime + 4h)
  const oiHistory4h = [
    { timestamp: baseTime, sumOpenInterest: 100000 },
    { timestamp: baseTime + H4_MS, sumOpenInterest: 106000 } // +6% OI
  ];

  // 4H L/S ratio with point offset by 3.5h (which would fail a strict 3h tolerance)
  const lsHistory4h = [
    { timestamp: baseTime + H4_MS - 30 * 60 * 1000, longShortRatio: 1.45 }
  ];

  const enriched = enrichMoveWithMicrostructure(h4Move, {
    oiHistory: oiHistory4h,
    lsHistory: lsHistory4h,
    klines: [
      { time: baseTime, open: 85000, high: 88200, low: 84900, close: 88000 },
      { time: baseTime + H4_MS, open: 88000, high: 88500, low: 87800, close: 88200 }
    ]
  });

  assert.equal(enriched.length, 1);
  const m = enriched[0];
  // OI delta must be calculated accurately (+6000 BTC, +6%)
  assert.equal(m.oiBefore, 100000);
  assert.equal(m.oiAfter, 106000);
  assert.equal(m.oiDelta, 6000);
  assert.ok(Math.abs(m.oiDeltaPercent - 6.0) < 0.01);

  // LS ratio must be matched (1.45)
  assert.equal(m.lsRatio, 1.45);

  // Mechanism must classify as AGGRESSIVE_TAKER_BUYING (PUMP + OI increasing + positive CVD)
  assert.equal(m.mechanismHypothesis, 'AGGRESSIVE_TAKER_BUYING');
});

test('LOGIC-002: preserves direction invariant with positive price change on LIQUIDITY_SWEEP_HIGH', () => {
  const baseTime = 1700000000000;
  // A bar that swept high with a massive wick: open 100, high 108, low 99.5, close 101.5 (+1.5% body, upper wick 76%)
  const klines = [
    { time: baseTime, open: 100, high: 108, low: 99.5, close: 101.5, volume: 150, quoteVolume: 15000 }
  ];

  const candidates = detectTopImpulseMoves(klines, 1);
  assert.equal(candidates.length, 1);
  const m = candidates[0];
  assert.equal(m.moveType, 'LIQUIDITY_SWEEP_HIGH');
  assert.equal(m.direction, 'PUMP', 'Must retain PUMP when close > open to prevent UI contradiction like DUMP +1.5%');
  assert.ok(m.priceChangePercent > 0);

  // When followed by a dump to 98.5 (retracing 200% of the impulse), retracement is positive
  const enriched = enrichMoveWithMicrostructure(candidates, {
    klines: [
      { time: baseTime, open: 100, high: 108, low: 99.5, close: 101.5 },
      { time: baseTime + 4 * 3600000, open: 101.5, high: 102.0, low: 98.0, close: 98.5 }
    ]
  });
  assert.equal(enriched[0].forwardReactions.trendContinuation, 'MEAN_REVERSION_OR_TRAP');
  assert.ok(enriched[0].forwardReactions.retracementPercent > 100, 'Retracement percent must be positive on reversal');
});

test('LOGIC-003: matches HFT liquidations occurring mid-way through a long H4 candle (> 45m from startTime)', () => {
  const baseTime = 1700000000000;
  const H4_MS = 4 * 3600 * 1000;

  const h4Move = [{
    startIndex: 0,
    endIndex: 0,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime + H4_MS,
    startPrice: 85000,
    endPrice: 80000,
    highPrice: 85200,
    lowPrice: 79500,
    priceChange: -5000,
    priceChangePercent: -5.88,
    direction: 'DUMP',
    takerCvdDelta: -3000000
  }];

  // Event occurs at minute 120 (2 hours into the 4h candle)
  const localMoveStore = [{
    triggerTime: baseTime + 2 * 3600 * 1000,
    liqLongUsd: 5000000,
    flowLabel: 'LONG_FLUSH',
    outcomeLabel: 'CONTINUATION_DUMP'
  }];

  const enriched = enrichMoveWithMicrostructure(h4Move, {
    localMoveStore,
    klines: [{ time: baseTime, open: 85000, high: 85200, low: 79500, close: 80000 }]
  });

  assert.equal(enriched.length, 1);
  assert.ok(enriched[0].localTrackerMatch != null, 'Must capture HFT liquidation event occurring 2h into the 4h move');
  assert.equal(enriched[0].localTrackerMatch.liqLongUsd, 5000000);
  assert.equal(enriched[0].mechanismHypothesis, 'LONG_LIQUIDATION_CASCADE');
});

test('LOGIC-004 & LOGIC-005: sets DEVELOPING_IN_PROGRESS on last bar and includes Phản Ứng Sau Đợt in 24h table', () => {
  const baseTime = 1700000000000;
  const lastBarMove = [{
    startIndex: 0,
    endIndex: 0,
    candleCount: 1,
    startTime: baseTime,
    endTime: baseTime + 900000,
    startPrice: 100,
    endPrice: 105,
    priceChangePercent: 5.0,
    direction: 'PUMP'
  }];

  // Move is the only and final candle in klines
  const enriched = enrichMoveWithMicrostructure(lastBarMove, {
    klines: [{ time: baseTime, open: 100, close: 105 }]
  });
  assert.equal(enriched[0].forwardReactions.trendContinuation, 'DEVELOPING_IN_PROGRESS');

  // Verify 24h Markdown table schema contains 'Phản Ứng Sau Đợt'
  const payload = formatForensicsPayloadForAi(enriched, [], []);
  assert.match(payload, /### 1\. TOP 3 ĐỢT BIẾN ĐỘNG GIÁ MẠNH NHẤT TRONG 24H QUA/);
  assert.match(payload, /Phản Ứng Sau Đợt/);
  assert.match(payload, /DEVELOPING_IN_PROGRESS/);
});




