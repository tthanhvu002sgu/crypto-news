import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportBlueprint, formatBlueprintForPrompt } from './reportBlueprintEngine.js';

test('enforces 0% current-spot deployment when short-term verdict is WAIT FOR VALUE ZONE', () => {
  const bp = buildReportBlueprint({
    priceNow: 57056,
    macro: { realRateProxy: 0.3, vix: 35.89, tenYearYield: 4.91, dxy: 103.84, highYield: 3.52 },
    spot: { change7d: -14.44, change30d: -29.85, change90d: -26.52, rangePos30d: 1.1, ma50: 71000, ma200: 82000 },
    institutional: { etfNetTotalM: -1303.4, etfPositiveDays: 2, etfNegativeDays: 5, amCotIndex: 13.7, am4W: -714 },
    onchain: { mvrv: 1.16, prodCostLow: 70000, prodCostHigh: 81000 },
    derivatives: { fundingRate: -0.000061, lsRatio: 3.386, oiChangePct: -1.3, basisPct: -0.2 },
    microstructure: { spotCvd24h: -130e6, futCvd24h: -279e6, spotCvd7d: -479e6, longLiq1h: 52.8e6, shortLiq1h: 0.76e6 },
    options: { gexFlipPrice: 59494, putWallStrike: 40000, callWallStrike: 80000 },
  });

  assert.equal(bp.verdicts.shortTerm.vi, 'CHỜ CHIẾT KHẤU SÂU');
  assert.equal(bp.allocation.deployAtCurrentSpot, false);
  assert.equal(bp.allocation.allocationAtCurrentSpotPct, 0);
  // Zone 1 must be strictly below current spot when waiting for discount
  assert.ok(bp.zones.zone1.high < 57056, `Expected zone1.high (${bp.zones.zone1.high}) < 57056`);
  assert.ok(bp.zones.zone2.high < bp.zones.zone1.low, 'Zone 2 must be below Zone 1');
  assert.ok(bp.allocation.minSpacingPct >= 10, 'Minimum spacing between Zone 1 and Zone 2 must be >= 10%');

  // On-chain score must NOT be negative when MVRV is 1.16 and spot < production cost
  assert.equal(bp.pillars.onchain.score, 1);
  // Long-term verdict should be CONDITIONAL DCA (not AGGRESSIVE ACCUMULATION since MVRV > 1.0)
  assert.equal(bp.verdicts.longTerm.vi, 'DCA CÓ ĐIỀU KIỆN');

  // 2-tier reversal hierarchy: Tier 1 < Tier 2
  assert.equal(bp.reversalTiers.tier1EarlyWarning.level, 59500);
  assert.ok(bp.reversalTiers.tier2TrendConfirmation.level > bp.reversalTiers.tier1EarlyWarning.level);

  // Implied Realized Price = 57056 / 1.16 ≈ 49186
  assert.ok(bp.zones.impliedRealizedPrice > 48000 && bp.zones.impliedRealizedPrice < 50000);

  const md = formatBlueprintForPrompt(bp);
  assert.match(md, /DETERMINISTIC REPORT BLUEPRINT/);
  assert.match(md, /Current Spot Allocation = 0%/);
  assert.match(md, /Tier 1 — Early Warning/);
  assert.match(md, /Tier 2 — Trend Confirmation/);
});

test('assigns +2 on-chain score and AGGRESSIVE ACCUMULATION long-term only when MVRV < 1.0', () => {
  const bp = buildReportBlueprint({
    priceNow: 45000,
    onchain: { mvrv: 0.92, prodCostLow: 65000, prodCostHigh: 75000 },
  });

  assert.equal(bp.pillars.onchain.score, 2);
  assert.equal(bp.verdicts.longTerm.vi, 'TÍCH LŨY MẠNH');
});

test('total tranche allocation always sums to 100%', () => {
  const bp = buildReportBlueprint({
    priceNow: 95000,
    macro: { realRateProxy: -0.5, vix: 14, tenYearYield: 3.4, dxy: 97, highYield: 3.0 },
    spot: { change7d: 6, change30d: 18, change90d: 25, rangePos30d: 88, ma50: 88000, ma200: 78000 },
    institutional: { etfNetTotalM: 1200, etfPositiveDays: 6, etfNegativeDays: 1, amCotIndex: 80, am4W: 800 },
    onchain: { mvrv: 1.8, prodCostLow: 70000, prodCostHigh: 80000 },
    derivatives: { fundingRate: 0.0001, lsRatio: 1.1, oiChangePct: 5 },
    microstructure: { spotCvd24h: 120e6, futCvd24h: 150e6, spotCvd7d: 500e6 },
  });

  const sum = bp.allocation.tranche1Pct + bp.allocation.tranche2Pct + bp.allocation.tranche3Pct;
  assert.equal(sum, 100);
});
