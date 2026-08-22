import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleSheetPayload,
  getCurrentSessionVN,
  calculateBtcProductionCostRange,
  validateExportReadiness
} from './googleSheetSync.js';

test('getCurrentSessionVN returns valid session name and code', () => {
  const session = getCurrentSessionVN();
  assert.ok(['ASIA', 'EUROPE', 'US'].includes(session.code));
  assert.ok(session.name.length > 0);
  assert.ok(typeof session.hour === 'number');
});

test('calculateBtcProductionCostRange returns valid bounds for mining difficulty', () => {
  const difficulty = 110_000_000_000_000; // 110T
  const cost = calculateBtcProductionCostRange(difficulty);
  assert.ok(cost.min > 50000);
  assert.ok(cost.max > cost.min);
  assert.match(cost.formatted, /\$\d+,?\d+ - \$\d+,?\d+/);

  const nullCost = calculateBtcProductionCostRange(null);
  assert.equal(nullCost.formatted, 'N/A');
});

test('validateExportReadiness blocks when required fields are missing', () => {
  const emptyData = {};
  const emptyBias = {};
  const res = validateExportReadiness(emptyData, emptyBias, null, null);
  assert.equal(res.isValid, false);
  assert.ok(res.blockingErrors.length >= 3);
  assert.ok(res.blockingErrors.some(e => e.includes('Bitcoin')));
  assert.ok(res.blockingErrors.some(e => e.includes('Funding Rate')));
  assert.ok(res.blockingErrors.some(e => e.includes('Open Interest')));
});

test('validateExportReadiness passes and identifies warnings and publication lags', () => {
  const mockData = {
    btc: { price: 95000, change: 2.5, volume: 30000000000 },
    fundingRate: 0.0001,
    openInterest: 120000,
  };
  const mockBias = { score: 45 };
  const mockEtfHistory = [{ date: '21/08/26', flow: 150.5 }];
  const mockCot = { date: '19/08/2026', assetManager: { net: 4500 } };

  const res = validateExportReadiness(
    { ...mockData, cotData: mockCot },
    mockBias,
    { total: 1250000 },
    mockEtfHistory
  );

  assert.equal(res.isValid, true);
  assert.equal(res.blockingErrors.length, 0);
  assert.ok(res.warnings.length > 0); // Missing ETH, SOL, F&G...
  assert.ok(res.laggedInfo.length >= 2);
  assert.ok(res.completenessScore > 30);
});

test('buildGoogleSheetPayload formats 5 distinct sheets with complete real values and no fake fallbacks', () => {
  const mockData = {
    btc: { price: 95000, change: 3.5, volume: 25000000000, high: 96000, low: 92000 },
    ethTicker: { price: 2700, change: 1.2, volume: 12000000000 },
    solTicker: { price: 180, change: -0.5, volume: 3000000000 },
    fundingRate: 0.0001,
    openInterest: 100000,
    longShortRatio: 1.15,
    fngData: { value: 65, sentiment: 'Greed' },
    stablecoins: { usdt: 120000000000, usdc: 35000000000, total: 155000000000 },
    onChainMetrics: { mvrv: 2.15, activeAddresses: 920000, txCount: 450000, date: '2026-08-21' },
    ethOnChainMetrics: { mvrv: 1.65, activeAddresses: 480000, txCount: 1100000, date: '2026-08-21' },
    onChain: { difficulty: 110000000000000, hashRate: 750 },
    fedFundsRate: 4.85,
    cpi: 2.9,
    tenYearYield: 4.25,
    dxy: 103.5,
    vix: 16.2,
    sp500: { price: 5600, changePercent: 0.4 },
    qqq: { price: 480, changePercent: 0.6 },
    m2Supply: 21200,
    netLiquidity: 6150,
    cvdHistory24hSpot: [{ cvd: 50000000 }],
    cvdHistory24h: [{ cvd: -20000000 }],
    cvdHistory7dSpot: [{ cvd: 120000000 }],
    cvdHistory7d: [{ cvd: 80000000 }],
    orderBook: {
      obiPercent: 12.5,
      bidVolumeUsd: 45000000,
      askVolumeUsd: 35000000,
      topBidWall: { price: 93000, notional: 15000000 },
      topAskWall: { price: 97000, notional: 18000000 }
    },
    cotData: {
      date: '19/08/2026',
      openInterest: 22500,
      assetManager: { long: 6500, short: 1200, net: 5300, netChange: 450 },
      leveragedFunds: { long: 4500, short: 11000, net: -6500, netChange: -300 }
    }
  };

  const mockBias = {
    score: 35,
    label: 'BULLISH MẠNH (STRONG BUY)',
    confidence: 85,
    pillars: { microstructure: 30, onChain: 20, institutional: 40, newsRisk: 50 },
    upcomingEvents: [
      { date: '2026-08-21T14:30:00Z', title: 'US Core CPI y/y', country: 'USD', impact: 'high', forecast: '2.9%', previous: '3.0%', actual: '2.8%' }
    ]
  };

  const mockEtfHoldings = {
    total: 1258664,
    funds: [
      { name: 'BlackRock (IBIT)', holdings: 774434, marketShare: '61.5%' },
      { name: 'Fidelity (FBTC)', holdings: 180084, marketShare: '14.3%' }
    ]
  };

  const mockEtfHistory = [
    { date: '20/08/26', flow: 250.4 },
    { date: '21/08/26', flow: -45.2 }
  ];

  const payload = buildGoogleSheetPayload(mockData, mockBias, mockEtfHoldings, mockEtfHistory);

  assert.ok(payload.sessionName);
  assert.ok(payload.timestamp);
  
  // Tab 1: Overview
  assert.ok(Array.isArray(payload.overview));
  assert.equal(payload.overview[0][0], 'DANH MỤC / CHỈ SỐ');
  assert.ok(payload.overview.length >= 10);
  assert.match(payload.overview[2][1], /\+35 \/ 100/);
  // Real ETH & SOL prices
  assert.ok(payload.overview.some(r => r[0].includes('Ethereum') && r[1].includes('$2,700')));
  assert.ok(payload.overview.some(r => r[0].includes('Solana') && r[1].includes('$180')));
  // Real Stablecoin total
  assert.ok(payload.overview.some(r => r[0].includes('Stablecoin') && r[1].includes('$155.00B')));
  // Real F&G
  assert.ok(payload.overview.some(r => r[0].includes('Sợ Hãi') && r[1].includes('65 / 100') && r[2].includes('Greed')));

  // Tab 2: Derivatives
  assert.ok(Array.isArray(payload.derivatives));
  assert.equal(payload.derivatives[0][0], 'CHỈ BÁO PHÁI SINH & VI CẤU TRÚC');
  assert.ok(payload.derivatives.some(r => r[0].includes('Funding Rate') && r[1].includes('0.0100%')));
  assert.ok(payload.derivatives.some(r => r[0].includes('Order Book Imbalance') && r[1].includes('+12.5%')));
  assert.ok(payload.derivatives.some(r => r[0].includes('Tường Mua') && r[1].includes('$93,000')));

  // Tab 3: ETF Onchain
  assert.ok(Array.isArray(payload.etf_onchain));
  assert.equal(payload.etf_onchain[0][0], 'QUỸ / CHỈ SỐ ON-CHAIN');
  assert.ok(payload.etf_onchain.some(r => r[0].includes('BlackRock (IBIT)') && r[1].includes('774,434 BTC')));
  assert.ok(payload.etf_onchain.some(r => r[0].includes('CME Asset Manager') && r[1].includes('Net: +5300')));
  assert.ok(payload.etf_onchain.some(r => r[0].includes('Bitcoin MVRV') && r[1].includes('2.15')));

  // Tab 4: Macro
  assert.ok(Array.isArray(payload.macro));
  assert.equal(payload.macro[0][0], 'THỜI GIAN / CHỈ SỐ VĨ MÔ');
  assert.ok(payload.macro.some(r => r[0].includes('Lãi Suất Fed') && r[1].includes('4.85%')));
  assert.ok(payload.macro.some(r => r[0].includes('Lãi Suất Thực Proxy') && r[1].includes('+1.95%')));
  assert.ok(payload.macro.some(r => r[0].includes('DXY') && r[1].includes('103.50')));

  // Tab 5: AI Prompt
  assert.ok(typeof payload.ai_summary_md === 'string');
  assert.match(payload.ai_summary_md, /# BẢN NGỮ CẢNH DỮ LIỆU THỊ TRƯỜNG TOÀN DIỆN/);
  assert.match(payload.ai_summary_md, /BTC\/USDT/);
  assert.match(payload.ai_summary_md, /ETH\/USDT/);
  assert.match(payload.ai_summary_md, /MVRV/);
  assert.match(payload.ai_summary_md, /ANTI-HALLUCINATION/);
});
