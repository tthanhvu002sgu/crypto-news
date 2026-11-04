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

