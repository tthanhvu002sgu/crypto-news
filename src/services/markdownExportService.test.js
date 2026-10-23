import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComprehensiveMarkdownReport,
} from './markdownExportService.js';

test('buildComprehensiveMarkdownReport produces complete 12-section markdown report', () => {
  const mockDashboardData = {
    btc: { price: 68500, change: 2.45, volume: 32000000000, high: 69200, low: 67100 },
    ethTicker: { price: 2650, change: 1.2 },
    globalData: { btcDominance: 58.4, totalMarketCap: 2450000000000 },
    fundingRate: 0.0001,
    openInterest: 75000,
    oiHistory: [
      { timestamp: Date.now() - 3600000, sumOpenInterest: 74000 },
      { timestamp: Date.now(), sumOpenInterest: 75000 },
    ],
    lsHistory: [
      { timestamp: Date.now() - 3600000, longShortRatio: 1.25, longAccount: 55.5, shortAccount: 44.5 },
      { timestamp: Date.now(), longShortRatio: 1.30, longAccount: 56.5, shortAccount: 43.5 },
    ],
    cvdHistory24h: {
      windowNetDelta: 12500000,
      points: [
        { time: Date.now() - 3600000, price: 68000, buyVol: 20000000, sellVol: 15000000, cvd: 5000000 },
        { time: Date.now(), price: 68500, buyVol: 25000000, sellVol: 17500000, cvd: 12500000 },
      ],
    },
    cvdHistory24hSpot: {
      windowNetDelta: 8500000,
      points: [
        { time: Date.now() - 3600000, price: 68000, buyVol: 15000000, sellVol: 10000000, cvd: 5000000 },
        { time: Date.now(), price: 68500, buyVol: 18000000, sellVol: 14500000, cvd: 8500000 },
      ],
    },
    cvdHistory7d: { windowNetDelta: 45000000, points: [{ time: Date.now(), cumulativeWithinWindow: 45000000 }] },
    cvdHistory7dSpot: { windowNetDelta: 30000000, points: [{ time: Date.now(), cumulativeWithinWindow: 30000000 }] },
    cvdHistory30d: { windowNetDelta: 120000000, points: [{ time: Date.now(), cumulativeWithinWindow: 120000000 }] },
    cvdHistory30dSpot: { windowNetDelta: 95000000, points: [{ time: Date.now(), cumulativeWithinWindow: 95000000 }] },
    cotData: {
      date: '2026-10-20',
      openInterest: 19500,
      assetManager: { long: 5200, short: 1400, net: 3800, changeWoW: 150, cotIndex: 82.5 },
      leveragedFunds: { long: 4800, short: 11500, net: -6700, changeWoW: -300, cotIndex: 25.0 },
      dealer: { long: 6500, short: 4100, net: 2400 },
      nonRept: { long: 1200, short: 800, net: 400 },
      regime: { label: 'TÍCH LŨY THỂ CHẾ' },
      narrative: { overview: 'Asset Managers tiếp tục gia tăng vị thế mua ròng.' },
      history: [
        { date: '2026-10-13', openInterest: 19200, amNet: 3650, lfNet: -6400, amChangeWoW: 80, lfChangeWoW: -120 },
      ],
    },
    onChain: { difficulty: 95e12, hashRate: 680 },
    fedFundsRate: { val: 4.83 },
    cpi: { val: 2.6 },
    tenYearYield: { val: 4.15 },
    dxy: { price: 103.2 },
    vix: { price: 16.5 },
    sp500: { price: 5850, changePercent: 0.35 },
    qqq: { price: 495, changePercent: 0.48 },
    highYield: { val: 6.8 },
    unrate: { val: 4.1 },
    m2Supply: { val: 21300 },
    netLiquidity: 6250,
    fngData: { value: 65, sentiment: 'Greed' },
  };

  const mockBiasData = {
    score: 35,
    verdict: 'MODERATELY BULLISH',
    regime: 'LIQUIDITY EXPANSION',
    confidence: 88,
    summary: 'Dòng tiền ETF và CVD Spot hỗ trợ đà tăng giá.',
    pillars: {
      trend: { score: 40, status: 'TÍCH CỰC', detail: 'EMA 20 > EMA 50' },
      liquidity: { score: 50, status: 'BƠM MẠNH', detail: 'ETF inflow liên tục 5 ngày' },
      derivatives: { score: 20, status: 'CÂN BẰNG', detail: 'Funding duy trì 0.01%' },
      sentiment: { score: 30, status: 'LẠC QUAN', detail: 'F&G ở vùng Greed 65' },
      macro: { score: 25, status: 'THUẬN LỢI', detail: 'Net liquidity duy trì > $6.2T' },
    },
  };

  const mockOptionsAnalysis = {
    gammaRegime: 'POSITIVE_GAMMA',
    gexFlip: 66500,
    walls: {
      callWall: { strike: 72000, callOI: 2450.5 },
      putWall: { strike: 65000, putOI: 3120.0 },
    },
    maxPain: { maxPainPrice: 67000 },
    pcr: { oiPcr: 0.72, volumePcr: 0.65 },
    totalOI: { calls: 18500, puts: 13320, total: 31820 },
    narrative: 'Market Makers đang ở chế độ Long Gamma, hạn chế biến động hai đầu.',
    expiries: [
      { expiry: '31OCT26', dte: 9, callOI: 4500, putOI: 3200, topCallStrike: 72000, topPutStrike: 65000 },
    ],
    strikeDistribution: [
      { strike: 72000, callOI: 2450.5, putOI: 200, totalOI: 2650.5, gex: 15000000 },
      { strike: 65000, callOI: 150, putOI: 3120, totalOI: 3270, gex: -12000000 },
      { strike: 67000, callOI: 850, putOI: 920, totalOI: 1770, gex: 2500000 },
    ],
    meta: { underlyingPrice: 68500 },
  };

  const mockEtfHoldings = {
    total: 1050000,
    date: '2026-10-21',
    funds: [
      { ticker: 'IBIT', name: 'iShares Bitcoin Trust', btc: 520000, change: 2500 },
      { ticker: 'FBTC', name: 'Fidelity Wise Origin', btc: 210000, change: 850 },
    ],
  };

  const mockEtfHistory = [
    { date: '2026-10-20', flow: 155.4, status: 'PUBLISHED' },
    { date: '2026-10-21', flow: 210.8, status: 'PUBLISHED' },
  ];

  const mockWhaleWalls = {
    bidRatio: 0.64,
    askRatio: 0.36,
    signal: 'Lực mua đỡ giá chiếm ưu thế',
    whaleBids: [
      { price: 68000, quantity: 18.5, totalUsd: 1258000, exchange: 'Binance' },
      { price: 67500, quantity: 24.2, totalUsd: 1633500, exchange: 'Bybit' },
    ],
    whaleAsks: [
      { price: 69500, quantity: 15.0, totalUsd: 1042500, exchange: 'OKX' },
    ],
  };

  const mockOrderBook = {
    obiPercent: 18.5,
    signal: 'Áp lực Mua áp đảo',
    bidVolumeUsd: 85000000,
    askVolumeUsd: 62000000,
    exchanges: [
      { name: 'Binance Futures', obi: 21.2, bidVol: 45000000, askVol: 32000000 },
      { name: 'Bybit Futures', obi: 15.8, bidVol: 25000000, askVol: 18000000 },
    ],
  };

  const mockMacroDashboard = {
    current: {
      valuationZone: 'FAIR VALUE',
      longValuator: { z: 0.42, upper: 85000, lower: 52000 },
      shortValuator: { z: 0.31 },
      pnl: {
        zone: 'ACCUMULATION',
        weightedAverage: 18.4,
        percentile: 58.2,
        underwater: 25,
        rois: [12.5, 24.8, 32.1, 4.2],
      },
    },
    series: [
      { time: Date.now() - 86400000 * 7, close: 67000, longValuator: { z: 0.35 }, pnl: { weightedAverage: 15.2, percentile: 55, underwater: 25 } },
      { time: Date.now(), close: 68500, longValuator: { z: 0.42 }, pnl: { weightedAverage: 18.4, percentile: 58.2, underwater: 25 } },
    ],
  };

  const mockScannerData = {
    windowKey: '24h',
    currentSnapshot: {
      asOf: '2026-10-22T00:00:00.000Z',
      assets: [
        {
          symbol: 'SOLUSDT',
          baseAsset: 'SOL',
          sector: 'Layer 1',
          price: 185.5,
          windows: {
            '24h': {
              rank: 1,
              scores: { totalScore: 82.5 },
              metrics: { priceChangePct: 4.8, rsBtc: 2.3, spotCvd: 4500000, futuresCvd: 6200000, flowLabelText: 'Spot hỗ trợ' },
            },
          },
          tracking: {
            diff1d: { deltaRank: 2, deltaScore: 4.2 },
            diff7d: { deltaRank: 5, deltaScore: 12.8 },
          },
        },
      ],
      summary: {
        '24h': {
          rsBtcPositiveRatio: 64,
          rsEthPositiveRatio: 68,
          flowDistribution: {
            SPOT_SUPPORTED: 18,
            DERIVATIVES_DOMINATED: 8,
            SHORT_COVERING: 4,
            MIXED_OR_INSUFFICIENT: 20,
          },
        },
      },
    },
  };

  const markdown = buildComprehensiveMarkdownReport({
    dashboardData: mockDashboardData,
    biasData: mockBiasData,
    optionsAnalysis: mockOptionsAnalysis,
    etfHoldings: mockEtfHoldings,
    etfHistory: mockEtfHistory,
    whaleWalls: mockWhaleWalls,
    orderBook: mockOrderBook,
    macroDashboard: mockMacroDashboard,
    scannerData: mockScannerData,
    options: {
      livePrice: 68500,
      liveChange: 2.45,
      liveVolume: 32000000000,
    },
  });

  // Verify all 12 analytical sections are included
  assert.ok(markdown.includes('## 1. MARKET BIAS ENGINE (MỚI NHẤT & LỊCH SỬ)'), 'Includes Section 1');
  assert.ok(markdown.includes('## 2. OPTIONS REGIME — BTC (DERIBIT)'), 'Includes Section 2');
  assert.ok(markdown.includes('## 3. SPOT BITCOIN ETF FLOW (MỚI NHẤT & LỊCH SỬ)'), 'Includes Section 3');
  assert.ok(markdown.includes('## 4. CME BITCOIN FUTURES COT'), 'Includes Section 4');
  assert.ok(markdown.includes('## 5. MACRO DASHBOARD v2 (MỚI NHẤT & LỊCH SỬ)'), 'Includes Section 5');
  assert.ok(markdown.includes('## 6. CVD & ORDER FLOW (MỚI NHẤT & LỊCH SỬ 24H, 7D, 30D)'), 'Includes Section 6');
  assert.ok(markdown.includes('## 7. FLOW REGIME · 24H (MỚI NHẤT & BỐI CẢNH VỊ THẾ)'), 'Includes Section 7');
  assert.ok(markdown.includes('## 8. LONG / SHORT RATIO (L/S RATIO) (MỚI NHẤT & LỊCH SỬ 24H)'), 'Includes Section 8');
  assert.ok(markdown.includes('## 9. OPEN INTEREST (OI) (MỚI NHẤT & LỊCH SỬ 24H)'), 'Includes Section 9');
  assert.ok(markdown.includes('## 10. LIMIT ORDERS (WHALE WALLS >= $500K)'), 'Includes Section 10');
  assert.ok(markdown.includes('## 11. ORDER BOOK IMBALANCE (OBI & CẤU TRÚC ĐỘ SÂU SỔ LỆNH)'), 'Includes Section 11');
  assert.ok(markdown.includes('## 12. ALTCOIN SCANNER (MỚI NHẤT & LỊCH SỬ TRACKING)'), 'Includes Section 12');

  // Verify specific data items are present
  assert.ok(markdown.includes('MODERATELY BULLISH'), 'Includes bias verdict');
  assert.ok(markdown.includes('POSITIVE_GAMMA'), 'Includes options gamma regime');
  assert.ok(markdown.includes('$72,000'), 'Includes Call Wall');
  assert.ok(markdown.includes('$65,000'), 'Includes Put Wall');
  assert.ok(markdown.includes('1,050,000 BTC'), 'Includes ETF Holdings');
  assert.ok(markdown.includes('Quản Lý Tài Sản (Asset Managers'), 'Includes CME Asset Managers');
  assert.ok(markdown.includes('Chi Phí Sản Xuất Khai Thác Bitcoin'), 'Includes Production Cost');
  assert.ok(markdown.includes('Futures CVD Net Delta'), 'Includes CVD metrics');
  assert.ok(markdown.includes('SOLUSDT'), 'Includes Altcoin Scanner asset');
  assert.ok(markdown.includes('Tracking Deltas vs 1D & 7D Ago'), 'Includes Scanner historical tracking deltas');
});

test('buildComprehensiveMarkdownReport handles empty or null data defensively', () => {
  const markdown = buildComprehensiveMarkdownReport({
    dashboardData: {},
    biasData: null,
    optionsAnalysis: null,
    etfHoldings: null,
    etfHistory: [],
    whaleWalls: null,
    orderBook: null,
    macroDashboard: null,
    scannerData: null,
  });

  assert.ok(typeof markdown === 'string' && markdown.length > 500, 'Generates valid markdown even on empty data');
  assert.ok(markdown.includes('SOVEREIGN MACRO TERMINAL'), 'Has document header');
  assert.ok(markdown.includes('MARKET BIAS ENGINE'), 'Has Market Bias section');
  assert.ok(markdown.includes('ALTCOIN SCANNER'), 'Has Altcoin Scanner section');
});

test('LOGIC-001: optionsAnalysis.narrative as object (ASP-100 payload) does not crash and renders text', () => {
  const markdown = buildComprehensiveMarkdownReport({
    optionsAnalysis: {
      gammaRegime: 'POSITIVE_GAMMA',
      gexFlip: 66500,
      narrative: {
        badge: 'POSITIVE GAMMA',
        executive: 'Thị trường biến động hẹp quanh vùng 67K.',
        positioning: 'Market Makers tiếp tục hedging cân bằng.',
        sentiment: 'Hedging bảo hộ chiếm ưu thế.',
        action: 'Ưu tiên giao dịch theo chiến lược Mean Reversion.',
        fullText: 'Thị trường biến động hẹp quanh vùng 67K. Market Makers tiếp tục hedging cân bằng.',
        wordCount: 14,
      },
    },
  });

  assert.ok(markdown.includes('ASP-100 Synthesis'), 'Includes narrative header');
  assert.ok(markdown.includes('Thị trường biến động hẹp quanh vùng 67K'), 'Renders narrative text without crash');
});

test('LOGIC-002: macroDashboard with engine flattened structure renders valuator and PnL fields', () => {
  const markdown = buildComprehensiveMarkdownReport({
    macroDashboard: {
      current: {
        valZone: 'GIFT',
        valZLong: -1.85,
        valZShort: -1.20,
        bandLower: 45000,
        bandUpper: 72000,
        pnlZone: 'CAPITULATION',
        weightedAverage: -14.25,
        percentile: 12.4,
        underwater: 75.0,
        rois: [-8.5, -12.3, 5.4, 25.1],
      },
      series: [
        {
          time: new Date('2026-10-15').getTime(),
          price: 66000,
          valZLong: -1.75,
          valZone: 'GIFT',
          weightedAverage: -13.5,
          percentile: 14.0,
          underwater: 75.0,
        },
      ],
    },
  });

  assert.ok(markdown.includes('GIFT'), 'Renders valuation zone');
  assert.ok(markdown.includes('-1.85'), 'Renders valZLong');
  assert.ok(markdown.includes('CAPITULATION'), 'Renders pnlZone');
  assert.ok(markdown.includes('-14.25%'), 'Renders weightedAverage');
  assert.ok(markdown.includes('12.4%'), 'Renders percentile');
  assert.ok(markdown.includes('75.0%'), 'Renders underwater');
  assert.ok(markdown.includes('-8.50%'), 'Renders 1Y cohort ROI');
  assert.ok(markdown.includes('2026-10-15'), 'Renders series date');
  assert.ok(markdown.includes('66,000'), 'Renders series price');
});

test('LOGIC-003: CME COT history items using real processCotData schema render correctly', () => {
  const markdown = buildComprehensiveMarkdownReport({
    dashboardData: {
      cotData: {
        date: '20/10/2026',
        openInterest: 21000,
        assetManager: { long: 6000, short: 1500, net: 4500, netChange: 250, cotIndex: 85 },
        leveragedFunds: { long: 4000, short: 12000, net: -8000, netChange: -400, cotIndex: 20 },
        dealerIntermediary: { long: 7000, short: 4500, net: 2500, netChange: 100 },
        nonReportable: { long: 1500, short: 900, net: 600, netChange: 50 },
        regime: { label: 'TÍCH LŨY THỂ CHẾ' },
        history: [
          {
            date: '13/10/2026',
            openInterest: 20500,
            assetManager: { net: 4250, netChange: 150 },
            leveragedFunds: { net: -7600, netChange: -300 },
          },
        ],
      },
    },
  });

  assert.ok(markdown.includes('13/10/2026'), 'Renders history date');
  assert.ok(markdown.includes('+4,250'), 'Renders history Asset Manager net without fallback dashes');
  assert.ok(markdown.includes('-7,600'), 'Renders history Leveraged Funds net without fallback dashes');
  assert.ok(markdown.includes('+150'), 'Renders history Asset Manager WoW shift');
  assert.ok(markdown.includes('-300'), 'Renders history Leveraged Funds WoW shift');
});

test('LOGIC-004: Long/Short ratio decimal inputs (0.5524) format correctly as 55.24%', () => {
  const markdown = buildComprehensiveMarkdownReport({
    dashboardData: {
      longShortRatio: 1.234,
      lsHistory: [
        { timestamp: Date.now() - 3600000, longShortRatio: 1.20, longAccount: 0.545, shortAccount: 0.455 },
        { timestamp: Date.now(), longShortRatio: 1.234, longAccount: 0.5524, shortAccount: 0.4476 },
      ],
    },
  });

  assert.ok(markdown.includes('55.24%'), 'Formats 0.5524 as 55.24% instead of 0.55%');
  assert.ok(markdown.includes('44.76%'), 'Formats 0.4476 as 44.76% instead of 0.45%');
  assert.ok(markdown.includes('54.5%'), 'Formats history row 0.545 as 54.5%');
});

test('LOGIC-005: Limit orders (Whale walls) and Order book depth with real API fields format accurately', () => {
  const markdown = buildComprehensiveMarkdownReport({
    whaleWalls: {
      bidRatio: 0.65,
      askRatio: 0.35,
      signal: 'Smart money đỡ giá ↑',
      whaleBids: [
        { price: 67000, qty: 25.5, usdValue: 1708500, sources: { 'Binance Futures': 1000000, 'Bybit Futures': 708500 } },
      ],
      whaleAsks: [
        { price: 71000, qty: 18.2, usdValue: 1292200, sources: { 'OKX Futures': 1292200 } },
      ],
    },
    orderBook: {
      obi: 0.185,
      obiPercent: 18.5,
      bidVolUsd: 125000000,
      askVolUsd: 85000000,
      exchanges: [
        { name: 'BIN', obi: 22.4, bidVolUsd: 65000000, askVolUsd: 40000000 },
      ],
    },
    options: {
      livePrice: 68000,
    },
  });

  assert.ok(markdown.includes('25.50 BTC'), 'Renders whale bid quantity from qty');
  assert.ok(markdown.includes('$1.71M'), 'Renders whale bid USD value from usdValue');
  assert.ok(markdown.includes('Binance Futures, Bybit Futures'), 'Renders whale bid sources');
  assert.ok(markdown.includes('18.20 BTC'), 'Renders whale ask quantity from qty');
  assert.ok(markdown.includes('$1.29M'), 'Renders whale ask USD value from usdValue');
  assert.ok(markdown.includes('+$125.00M'), 'Renders bidVol from bidVolUsd');
  assert.ok(markdown.includes('+$85.00M'), 'Renders askVol from askVolUsd');
  assert.ok(markdown.includes('+22.40%'), 'Renders exchange OBI');
});

test('LOGIC-006: Altcoin scanner assets use metrics.currentPrice and historical bias uses btcPrice/biasScore', () => {
  const markdown = buildComprehensiveMarkdownReport({
    scannerData: {
      windowKey: '24h',
      currentSnapshot: {
        asOf: '2026-09-27T00:00:00.000Z',
        assets: [
          {
            symbol: 'ZECUSDT',
            sector: 'Privacy',
            windows: {
              '24h': {
                rank: 1,
                scores: { totalScore: 88.5 },
                metrics: {
                  currentPrice: 1653.12,
                  priceChangePct: 6.26,
                  rsBtc: 5.84,
                  flowLabelText: 'Spot hỗ trợ',
                },
              },
            },
          },
        ],
        summary: {
          '24h': { rsBtcPositiveRatio: 36, rsEthPositiveRatio: 38 },
        },
      },
    },
  });

  assert.ok(markdown.includes('1,653.1200'), 'Renders Altcoin price from metrics.currentPrice without --- fallback');
  assert.ok(markdown.includes('+6.26%'), 'Renders Altcoin 24h change');
  assert.ok(markdown.includes('88.5'), 'Renders total score');
});

test('LOGIC-007: null dateInput never evaluates to 1970-01-01', () => {
  const markdown = buildComprehensiveMarkdownReport({
    biasData: {
      score: 10,
      verdict: 'NEUTRAL',
    },
  });

  assert.ok(!markdown.includes('1970-01-01'), 'Never prints 1970-01-01 for null dates');
});
