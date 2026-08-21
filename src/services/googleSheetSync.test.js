import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleSheetPayload, getCurrentSessionVN } from './googleSheetSync.js';

test('getCurrentSessionVN returns valid session name and code', () => {
  const session = getCurrentSessionVN();
  assert.ok(['ASIA', 'EUROPE', 'US'].includes(session.code));
  assert.ok(session.name.length > 0);
  assert.ok(typeof session.hour === 'number');
});

test('buildGoogleSheetPayload formats 5 distinct sheets with complete headers and values', () => {
  const mockData = {
    btc: { price: 75000, change: 3.5, volume: 25000000000 },
    eth: { price: 2400, change: 1.2, volume: 12000000000 },
    sol: { price: 90, change: -0.5, volume: 3000000000 },
    fundingRate: 0.0001,
    openInterest: 100000,
    longShortRatio: 1.15,
    fngData: { value: 65, classification: 'Greed' },
    stablecoins: { totalCirculatingUSD: { peggedUSD: 185000000000 } },
    cvdHistory24hSpot: [{ cvd: 50000000 }],
    cvdHistory24h: [{ cvd: -20000000 }]
  };

  const mockBias = {
    score: 35,
    label: 'BULLISH MẠNH (STRONG BUY)',
    pillars: { microstructure: 30, onChain: 20, institutional: 40, newsRisk: 50 },
    upcomingEvents: [
      { date: '2026-08-21T14:30:00Z', title: 'US CPI y/y', country: 'USD', impact: 'high', forecast: '2.9%', previous: '3.0%' }
    ]
  };

  const payload = buildGoogleSheetPayload(mockData, mockBias);

  assert.ok(payload.sessionName);
  assert.ok(payload.timestamp);
  
  // Tab 1: Overview
  assert.ok(Array.isArray(payload.overview));
  assert.equal(payload.overview[0][0], 'DANH MỤC / CHỈ SỐ');
  assert.ok(payload.overview.length >= 10);
  assert.match(payload.overview[1][1], /\+35 \/ 100/);

  // Tab 2: Derivatives
  assert.ok(Array.isArray(payload.derivatives));
  assert.equal(payload.derivatives[0][0], 'CHỈ BÁO PHÁI SINH');

  // Tab 3: ETF Onchain
  assert.ok(Array.isArray(payload.etf_onchain));
  assert.equal(payload.etf_onchain[0][0], 'QUỸ / CHỈ SỐ ON-CHAIN');

  // Tab 4: Macro
  assert.ok(Array.isArray(payload.macro));
  assert.equal(payload.macro[0][0], 'THỜI GIAN (VN / UTC)');
  assert.equal(payload.macro[1][1], 'US CPI y/y');

  // Tab 5: AI Prompt
  assert.ok(typeof payload.ai_summary_md === 'string');
  assert.match(payload.ai_summary_md, /# BẢN TỔNG HỢP DỮ LIỆU THỊ TRƯỜNG/);
  assert.match(payload.ai_summary_md, /BTC/);
});
