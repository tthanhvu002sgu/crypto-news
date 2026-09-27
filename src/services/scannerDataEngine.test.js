import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUtcMidnightDate,
  generateDailySnapshot,
} from './scannerDataEngine.js';

function mockKlineSeries(basePrice, days = 35, growthDaily = 0.005, anchorDate = new Date('2026-09-27T00:00:00.000Z')) {
  const klines = [];
  let price = basePrice;
  const anchorTime = getUtcMidnightDate(anchorDate).getTime();
  for (let i = days; i >= 0; i -= 1) {
    const openTime = anchorTime - (i * 24 * 60 * 60 * 1000);
    const closeTime = openTime + (24 * 60 * 60 * 1000) - 1;
    const open = price;
    price = price * (1 + growthDaily);
    const close = price;
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.99;
    const quoteVol = '1000000';
    const takerBuyQuote = '550000';
    klines.push([openTime, open, high, low, close, '100', closeTime, quoteVol, 100, '50', takerBuyQuote, 0]);
  }
  return klines;
}

test('Scanner Data Engine Snapshot Generation', async (t) => {
  await t.test('Normalizes date to UTC midnight (00:00:00.000Z)', () => {
    const date = new Date('2026-09-27T10:15:30.500+07:00');
    const mid = getUtcMidnightDate(date);
    assert.equal(mid.getUTCHours(), 0);
    assert.equal(mid.getUTCMinutes(), 0);
    assert.equal(mid.getUTCSeconds(), 0);
    assert.equal(mid.getUTCMilliseconds(), 0);
  });

  await t.test('Generates complete snapshot schema with all 3 windows scored and summary stats', async () => {
    const btcKlines = mockKlineSeries(60000, 35, 0.002);
    const ethKlines = mockKlineSeries(3000, 35, 0.001);

    const universe = [
      {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        name: 'Solana',
        sector: 'L1',
        hasFutures: true,
        spotKlines: mockKlineSeries(150, 35, 0.005),
      },
      {
        symbol: 'BNBUSDT',
        baseAsset: 'BNB',
        name: 'BNB',
        sector: 'L1',
        hasFutures: true,
        spotKlines: mockKlineSeries(550, 35, 0.003),
      },
      {
        symbol: 'AVAXUSDT',
        baseAsset: 'AVAX',
        name: 'Avalanche',
        sector: 'L1',
        hasFutures: true,
        spotKlines: mockKlineSeries(30, 35, 0.001),
      },
      {
        symbol: 'SUIUSDT',
        baseAsset: 'SUI',
        name: 'Sui',
        sector: 'L1',
        hasFutures: true,
        spotKlines: mockKlineSeries(2.0, 35, 0.008),
      },
      {
        symbol: 'NEARUSDT',
        baseAsset: 'NEAR',
        name: 'NEAR Protocol',
        sector: 'L1',
        hasFutures: true,
        spotKlines: mockKlineSeries(5.0, 35, 0.004),
      },
      {
        symbol: 'ARBUSDT',
        baseAsset: 'ARB',
        name: 'Arbitrum',
        sector: 'L2',
        hasFutures: true,
        spotKlines: mockKlineSeries(0.8, 35, 0.002),
      },
    ];

    const overrides = {
      SOLUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
      BNBUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
      AVAXUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
      SUIUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
      NEARUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
      ARBUSDT: { hasFutures: true, oiHistory: [], fundingHistory: [] },
    };

    const snapshot = await generateDailySnapshot({
      asOf: new Date('2026-09-27T00:00:00.000Z'),
      prefetchedBtcKlines: btcKlines,
      prefetchedEthKlines: ethKlines,
      prefetchedUniverse: universe,
      sourceOverrides: overrides,
    });

    assert.equal(snapshot.schemaVersion, 'v9.0.0');
    assert.equal(snapshot.modelVersion, 'v1.0.0');
    assert.equal(snapshot.assets.length, 6);
    assert.equal(snapshot.universe.length, 6);
    assert.ok(snapshot.summary['7d'].totalAssets === 6);

    const sol = snapshot.assets.find(a => a.symbol === 'SOLUSDT');
    assert.ok(sol);
    assert.ok(sol.windows['24h']);
    assert.ok(sol.windows['7d']);
    assert.ok(sol.windows['30d']);
    assert.ok(sol.windows['7d'].metrics.rsBtc !== null);
    assert.ok(sol.windows['7d'].metrics.rsEth !== null);
    assert.ok(sol.windows['7d'].metrics.spotCvd !== null);
  });
});
