import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstrumentName,
  filterByDte,
  aggregateStrikeOI,
  calculateMaxPain,
  calculateGexByStrike,
  identifyWalls,
  findGexFlipLevel,
  classifyGammaRegime,
  calculatePCR,
  generateOptionsAsp100Narrative,
  analyzeBtcOptions
} from './optionsCalculations.js';
import { parseDeribitExpiryDate } from './deribitOptionsService.js';

// ── Fixture Data ────────────────────────────────────────────────────────────────
const UNDERLYING_PRICE = 100000;

const mockInstruments = [
  { instrumentName: 'BTC-28MAR26-95000-C', expirationTimestamp: Date.now() + 5 * 86400000, openInterest: 100, gamma: 0.05 },
  { instrumentName: 'BTC-28MAR26-95000-P', expirationTimestamp: Date.now() + 5 * 86400000, openInterest: 150, gamma: 0.04 },
  { instrumentName: 'BTC-28MAR26-100000-C', expirationTimestamp: Date.now() + 5 * 86400000, openInterest: 300, gamma: 0.10 },
  { instrumentName: 'BTC-28MAR26-100000-P', expirationTimestamp: Date.now() + 5 * 86400000, openInterest: 200, gamma: 0.10 },
  { instrumentName: 'BTC-28MAR26-105000-C', expirationTimestamp: Date.now() + 5 * 86400000, openInterest: 400, gamma: 0.08 },
  { instrumentName: 'BTC-15APR26-110000-C', expirationTimestamp: Date.now() + 15 * 86400000, openInterest: 100, gamma: 0.02 },
];

describe('optionsCalculations', () => {

  // ── parseInstrumentName ───────────────────────────────────────────────────────
  test('parseInstrumentName: parses Call correctly', () => {
    const r = parseInstrumentName('BTC-28MAR26-95000-C');
    assert.deepEqual(r, { currency: 'BTC', expiry: '28MAR26', strike: 95000, type: 'C' });
  });

  test('parseInstrumentName: parses Put correctly', () => {
    assert.equal(parseInstrumentName('BTC-28MAR26-95000-P').type, 'P');
  });

  test('parseInstrumentName: parses ETH correctly', () => {
    assert.deepEqual(parseInstrumentName('ETH-27JUN26-5000-C'), { currency: 'ETH', expiry: '27JUN26', strike: 5000, type: 'C' });
  });

  test('parseInstrumentName: returns null for invalid input', () => {
    assert.equal(parseInstrumentName('INVALID-STRING'), null);
    assert.equal(parseInstrumentName(null), null);
    assert.equal(parseInstrumentName(undefined), null);
  });

  // ── filterByDte ───────────────────────────────────────────────────────────────
  test('filterByDte: keeps only instruments within DTE window', () => {
    const filtered = filterByDte(mockInstruments, 7);
    assert.equal(filtered.length, 5);
    assert.equal(filtered.find(i => i.instrumentName === 'BTC-15APR26-110000-C'), undefined);
  });

  test('filterByDte: null DTE keeps all instruments', () => {
    assert.equal(filterByDte(mockInstruments, null).length, 6);
  });

  test('filterByDte: empty array returns empty', () => {
    assert.deepEqual(filterByDte([], 7), []);
  });

  // ── aggregateStrikeOI ─────────────────────────────────────────────────────────
  test('aggregateStrikeOI: groups calls and puts at same strike', () => {
    const agg = aggregateStrikeOI(mockInstruments, UNDERLYING_PRICE);
    const s95 = agg.find(s => s.strike === 95000);
    assert.ok(s95);
    assert.equal(s95.callOI, 100);
    assert.equal(s95.putOI, 150);
  });

  test('aggregateStrikeOI: filters out strikes beyond ±30% of underlying', () => {
    const wide = [
      ...mockInstruments,
      { instrumentName: 'BTC-28MAR26-50000-C', expirationTimestamp: Date.now(), openInterest: 10, gamma: 0.1 },
      { instrumentName: 'BTC-28MAR26-150000-C', expirationTimestamp: Date.now(), openInterest: 10, gamma: 0.1 },
    ];
    const agg = aggregateStrikeOI(wide, UNDERLYING_PRICE);
    assert.equal(agg.find(s => s.strike === 50000), undefined);
    assert.equal(agg.find(s => s.strike === 150000), undefined);
  });

  test('aggregateStrikeOI: caps gamma at 100', () => {
    const agg = aggregateStrikeOI([
      { instrumentName: 'BTC-28MAR26-100000-C', expirationTimestamp: Date.now(), openInterest: 10, gamma: 150 }
    ], UNDERLYING_PRICE);
    assert.equal(agg[0].callGamma, 100);
  });

  // ── calculateMaxPain ──────────────────────────────────────────────────────────
  test('calculateMaxPain: returns object with maxPainPrice for valid data', () => {
    const agg = aggregateStrikeOI(mockInstruments, UNDERLYING_PRICE);
    const result = calculateMaxPain(agg);
    assert.ok(result);
    assert.equal(typeof result.maxPainPrice, 'number');
    assert.ok(result.totalPain >= 0);
  });

  test('calculateMaxPain: single strike returns that strike', () => {
    const result = calculateMaxPain([{ strike: 90000, callOI: 10, putOI: 10 }]);
    assert.equal(result.maxPainPrice, 90000);
    assert.equal(result.totalPain, 0);
  });

  test('calculateMaxPain: returns null for empty data', () => {
    assert.equal(calculateMaxPain([]), null);
  });

  // ── calculateGexByStrike ──────────────────────────────────────────────────────
  test('calculateGexByStrike: Call GEX positive, Put GEX negative', () => {
    const gex = calculateGexByStrike(
      [{ strike: 100000, callOI: 100, putOI: 100, callGamma: 0.05, putGamma: 0.05 }],
      UNDERLYING_PRICE
    );
    assert.ok(gex[0].callGex > 0);
    assert.ok(gex[0].putGex < 0);
  });

  test('calculateGexByStrike: Net GEX = Call GEX + Put GEX', () => {
    const gex = calculateGexByStrike(
      [{ strike: 100000, callOI: 200, putOI: 100, callGamma: 0.05, putGamma: 0.05 }],
      UNDERLYING_PRICE
    );
    assert.equal(gex[0].netGex, gex[0].callGex + gex[0].putGex);
  });

  test('calculateGexByStrike: zero OI gives zero GEX', () => {
    const gex = calculateGexByStrike(
      [{ strike: 100000, callOI: 0, putOI: 0, callGamma: 0.05, putGamma: 0.05 }],
      UNDERLYING_PRICE
    );
    assert.equal(gex[0].callGex, 0);
    assert.equal(gex[0].putGex, 0);
    assert.equal(gex[0].netGex, 0);
  });

  // ── identifyWalls ─────────────────────────────────────────────────────────────
  test('identifyWalls: finds call wall at/above price with highest call OI', () => {
    const { callWall } = identifyWalls([
      { strike: 90000, callOI: 500, putOI: 0 },
      { strike: 100000, callOI: 50, putOI: 0 },
      { strike: 110000, callOI: 400, putOI: 0 },
    ], 100000);
    assert.ok(callWall);
    assert.equal(callWall.strike, 110000);
    assert.equal(callWall.oi, 400);
  });

  test('identifyWalls: finds put wall at/below price with highest put OI', () => {
    const { putWall } = identifyWalls([
      { strike: 80000, callOI: 0, putOI: 300 },
      { strike: 90000, callOI: 0, putOI: 600 },
      { strike: 100000, callOI: 0, putOI: 100 },
    ], 100000);
    assert.ok(putWall);
    assert.equal(putWall.strike, 90000);
    assert.equal(putWall.oi, 600);
  });

  test('identifyWalls: returns nulls when empty', () => {
    const { callWall, putWall } = identifyWalls([], 100000);
    assert.equal(callWall, null);
    assert.equal(putWall, null);
  });

  // ── findGexFlipLevel ──────────────────────────────────────────────────────────
  test('findGexFlipLevel: interpolates price at sign change', () => {
    const flip = findGexFlipLevel([
      { strike: 90000, netGex: -1000000 },
      { strike: 100000, netGex: 1000000 },
    ]);
    assert.equal(flip, 95000);
  });

  test('findGexFlipLevel: returns null when all positive', () => {
    assert.equal(findGexFlipLevel([
      { strike: 90000, netGex: 1000000 },
      { strike: 100000, netGex: 1000000 },
    ]), null);
  });

  test('findGexFlipLevel: returns null when all negative', () => {
    assert.equal(findGexFlipLevel([
      { strike: 90000, netGex: -1000000 },
      { strike: 100000, netGex: -1000000 },
    ]), null);
  });

  // ── classifyGammaRegime ───────────────────────────────────────────────────────
  test('classifyGammaRegime: POSITIVE_GAMMA when net GEX positive', () => {
    const r = classifyGammaRegime([{ strike: 100000, netGex: 5000 }], 100000);
    assert.equal(r.regime, 'POSITIVE_GAMMA');
    assert.ok(r.netGexAtPrice > 0);
  });

  test('classifyGammaRegime: NEGATIVE_GAMMA when net GEX negative', () => {
    const r = classifyGammaRegime([{ strike: 100000, netGex: -5000 }], 100000);
    assert.equal(r.regime, 'NEGATIVE_GAMMA');
    assert.ok(r.netGexAtPrice < 0);
  });

  test('classifyGammaRegime: NEUTRAL when empty', () => {
    assert.equal(classifyGammaRegime([], 100000).regime, 'NEUTRAL');
  });

  // ── calculatePCR ──────────────────────────────────────────────────────────────
  test('calculatePCR: correct ratio', () => {
    const r = calculatePCR([
      { strike: 90000, callOI: 100, putOI: 150 },
      { strike: 100000, callOI: 200, putOI: 100 },
    ]);
    assert.ok(r);
    assert.ok(Math.abs(r.pcr - 0.8333) < 0.001);
    assert.equal(r.totalCallOI, 300);
    assert.equal(r.totalPutOI, 250);
  });

  test('calculatePCR: returns null when zero call OI', () => {
    assert.equal(calculatePCR([{ strike: 90000, callOI: 0, putOI: 150 }]), null);
  });

  // ── analyzeBtcOptions (integration) ───────────────────────────────────────────
  test('analyzeBtcOptions: returns complete analysis with valid data', () => {
    const r = analyzeBtcOptions(mockInstruments, UNDERLYING_PRICE);
    assert.ok(r);
    assert.ok(r.maxPain);
    assert.equal(typeof r.maxPain.maxPainPrice, 'number');
    assert.ok(r.pcr);
    assert.ok(r.callWall || r.putWall);
    assert.ok(r.strikeDistribution.length > 0);
    assert.ok(r.gexByStrike.length > 0);
    assert.ok(r.gammaRegime);
    assert.ok(r.meta.instrumentCount > 0);
  });

  test('analyzeBtcOptions: graceful result when empty instruments', () => {
    const r = analyzeBtcOptions([], UNDERLYING_PRICE);
    assert.equal(r.maxPain, null);
    assert.equal(r.pcr, null);
    assert.equal(r.callWall, null);
    assert.equal(r.putWall, null);
    assert.equal(r.gexFlipPrice, null);
    assert.equal(r.gammaRegime.regime, 'NEUTRAL');
    assert.deepEqual(r.strikeDistribution, []);
  });

  // ── parseDeribitExpiryDate ───────────────────────────────────────────────────
  test('parseDeribitExpiryDate: parses 1-digit day dates like 4OCT26', () => {
    const ts = parseDeribitExpiryDate('4OCT26');
    assert.ok(ts);
    const d = new Date(ts);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 9); // October = 9
    assert.equal(d.getUTCDate(), 4);
    assert.equal(d.getUTCHours(), 8);
  });

  test('parseDeribitExpiryDate: parses 2-digit day dates like 28MAR26', () => {
    const ts = parseDeribitExpiryDate('28MAR26');
    assert.ok(ts);
    const d = new Date(ts);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 2); // March = 2
    assert.equal(d.getUTCDate(), 28);
    assert.equal(d.getUTCHours(), 8);
  });

  test('parseDeribitExpiryDate: returns null for invalid formats', () => {
    assert.equal(parseDeribitExpiryDate('INVALID'), null);
    assert.equal(parseDeribitExpiryDate(''), null);
    assert.equal(parseDeribitExpiryDate(null), null);
    assert.equal(parseDeribitExpiryDate('32JAN26'), null);
  });

  // ── LOGIC-001: Multi-expiry GEX sum(Gamma * OI) ───────────────────────────
  test('LOGIC-001: aggregateStrikeOI & calculateGexByStrike correctly sum(Gamma * OI) for multi-expiry', () => {
    const multiExpiryInstruments = [
      { instrumentName: 'BTC-28MAR26-100000-C', openInterest: 100, gamma: 0.05 },
      { instrumentName: 'BTC-25SEP26-100000-C', openInterest: 200, gamma: 0.02 },
    ];
    const agg = aggregateStrikeOI(multiExpiryInstruments, 100000);
    assert.equal(agg.length, 1);
    assert.equal(agg[0].callOI, 300);
    // callGammaOI must be 100*0.05 + 200*0.02 = 5 + 4 = 9
    assert.equal(agg[0].callGammaOI, 9);

    const gex = calculateGexByStrike(agg, 100000);
    // GEX = 9 * 100000 * 1 = 900000 (NOT sum(Gamma)*sum(OI) = 0.07*300*100000 = 2100000)
    assert.equal(gex[0].callGex, 900000);
  });

  // ── LOGIC-002: Zero Gamma flip level closest to spot ───────────────────────
  test('LOGIC-002: findGexFlipLevel selects flip level closest to spot price over deep OTM noise', () => {
    const noisyGex = [
      { strike: 40000, netGex: -100 },
      { strike: 45000, netGex: 100 }, // Flip 1 around 42500 (deep OTM noise)
      { strike: 90000, netGex: -5000000 },
      { strike: 100000, netGex: 5000000 }, // Flip 2 at 95000 (near spot)
      { strike: 110000, netGex: 6000000 },
    ];
    // With spot at 98000, it must pick 95000, not 42500
    const flip = findGexFlipLevel(noisyGex, 98000);
    assert.equal(flip, 95000);

    // Flat zeroes should not register as a flip
    const flatZeroGex = [
      { strike: 40000, netGex: 0 },
      { strike: 45000, netGex: 0 },
      { strike: 50000, netGex: 0 },
    ];
    assert.equal(findGexFlipLevel(flatZeroGex, 45000), null);
  });

  // ── LOGIC-003: No 100x TradFi equity contract multiplier ───────────────────
  test('LOGIC-003: calculateGexByStrike has NO 100x TradFi equity multiplier', () => {
    const singleData = [{ strike: 100000, callOI: 10, putOI: 10, callGamma: 0.01, putGamma: 0.01 }];
    const gex = calculateGexByStrike(singleData, 100000, 1);
    // 0.01 * 10 * 100000 = 10000 (NOT 1000000)
    assert.equal(gex[0].callGex, 10000);
    assert.equal(gex[0].putGex, -10000);
  });

  // ── LOGIC-004: Market-wide PCR & Wings walls outside +/-30% ────────────────
  test('LOGIC-004: analyzeBtcOptions captures walls and PCR outside +/-30% strike window', () => {
    const wideMarket = [
      // Within +/-30% of 100k
      { instrumentName: 'BTC-28MAR26-100000-C', expirationTimestamp: Date.now() + 86400000, openInterest: 200, gamma: 0.05 },
      { instrumentName: 'BTC-28MAR26-100000-P', expirationTimestamp: Date.now() + 86400000, openInterest: 300, gamma: 0.05 },
      // Far OTM Wing Calls (+60% at 160k)
      { instrumentName: 'BTC-28MAR26-160000-C', expirationTimestamp: Date.now() + 86400000, openInterest: 5000, gamma: 0.001 },
      // Far OTM Wing Puts (-50% at 50k)
      { instrumentName: 'BTC-28MAR26-50000-P', expirationTimestamp: Date.now() + 86400000, openInterest: 6000, gamma: 0.001 },
    ];

    const result = analyzeBtcOptions(wideMarket, 100000);
    // Walls must capture true market walls at 160k and 50k
    assert.equal(result.callWall?.strike, 160000);
    assert.equal(result.callWall?.oi, 5000);
    assert.equal(result.putWall?.strike, 50000);
    assert.equal(result.putWall?.oi, 6000);

    // PCR must include 160k calls and 50k puts: totalCallOI = 5200, totalPutOI = 6300
    assert.equal(result.pcr?.totalCallOI, 5200);
    assert.equal(result.pcr?.totalPutOI, 6300);

    // But strikeDistribution for UI chart remains within +/-30%
    assert.ok(result.strikeDistribution.every(s => s.strike >= 70000 && s.strike <= 130000));
  });

  // ── LOGIC-006: identifyWalls ignores zero OI strikes ───────────────────────
  test('LOGIC-006: identifyWalls returns null when strikes have 0 OI (does not select strike when maxOI = -1)', () => {
    const zeroOIStrikes = [
      { strike: 90000, callOI: 0, putOI: 0 },
      { strike: 100000, callOI: 0, putOI: 0 },
      { strike: 110000, callOI: 0, putOI: 0 },
    ];
    const { callWall, putWall } = identifyWalls(zeroOIStrikes, 100000);
    assert.equal(callWall, null);
    assert.equal(putWall, null);

    const callsOnly = [
      { strike: 90000, callOI: 0, putOI: 0 },
      { strike: 100000, callOI: 150, putOI: 0 },
    ];
    const res = identifyWalls(callsOnly, 100000);
    assert.equal(res.callWall?.strike, 100000);
    assert.equal(res.putWall, null);

    // Malformed and null items handled gracefully
    const malformed = [null, { strike: 'invalid' }, { strike: 105000, callOI: 50, putOI: 60 }];
    const res2 = identifyWalls(malformed, 100000);
    assert.equal(res2.callWall?.strike, 105000);
    assert.equal(res2.putWall, null);
  });

  // ── LOGIC-002 (Enhanced): Zero-strike sign crossings and false-flip prevention ───
  test('LOGIC-002 (Enhanced): findGexFlipLevel does NOT register false flip on intermediate 0 strikes in one-sided regime', () => {
    // Intermediate zero in all-positive regime
    const allPositiveWithZero = [
      { strike: 90000, netGex: 100 },
      { strike: 95000, netGex: 0 },
      { strike: 100000, netGex: 150 },
    ];
    assert.equal(findGexFlipLevel(allPositiveWithZero, 95000), null);

    // Intermediate zero in all-negative regime
    const allNegativeWithZero = [
      { strike: 90000, netGex: -100 },
      { strike: 95000, netGex: 0 },
      { strike: 100000, netGex: -150 },
    ];
    assert.equal(findGexFlipLevel(allNegativeWithZero, 95000), null);

    // True transition across a zero strike
    const transitionThroughZero = [
      { strike: 90000, netGex: -100 },
      { strike: 95000, netGex: 0 },
      { strike: 100000, netGex: 150 },
    ];
    assert.equal(findGexFlipLevel(transitionThroughZero, 95000), 95000);

    // True transition across multiple consecutive zero strikes (flips at midpoint)
    const transitionAcrossMultipleZeroes = [
      { strike: 80000, netGex: -100 },
      { strike: 85000, netGex: 0 },
      { strike: 90000, netGex: 0 },
      { strike: 95000, netGex: 100 },
    ];
    assert.equal(findGexFlipLevel(transitionAcrossMultipleZeroes, 87500), 87500);

    // Leading or trailing zeroes do not register false flips
    const trailingZeroes = [
      { strike: 90000, netGex: 100 },
      { strike: 95000, netGex: 0 },
      { strike: 100000, netGex: 0 },
    ];
    assert.equal(findGexFlipLevel(trailingZeroes, 95000), null);
  });

  // ── Robustness: Malformed and partial data defense ─────────────────────────
  test('Defensive robustness: calculateMaxPain and calculatePCR handle nulls/non-finites gracefully', () => {
    const dirtyData = [
      null,
      { strike: 90000, callOI: 'invalid', putOI: null },
      { strike: 95000, callOI: 100, putOI: 200 },
      { strike: 100000, callOI: 300, putOI: 100 },
    ];
    const mp = calculateMaxPain(dirtyData);
    assert.ok(mp !== null);
    assert.ok(Number.isFinite(mp.maxPainPrice));

    const pcr = calculatePCR(dirtyData);
    assert.ok(pcr !== null);
    assert.equal(pcr.totalCallOI, 400);
    assert.equal(pcr.totalPutOI, 300);
    assert.equal(pcr.pcr, 0.75);
  });

  test('Defensive robustness: aggregateStrikeOI clamps negative gamma and non-finite OI', () => {
    const badInstruments = [
      { instrumentName: 'BTC-28MAR26-95000-C', openInterest: -10, gamma: -0.05 },
      { instrumentName: 'BTC-28MAR26-95000-P', openInterest: 50, gamma: 150 }, // gamma > 100 clamped
    ];
    const agg = aggregateStrikeOI(badInstruments, 95000);
    assert.equal(agg.length, 1);
    assert.equal(agg[0].callOI, 0); // negative clamped to 0
    assert.equal(agg[0].callGamma, 0); // negative gamma clamped to 0
    assert.equal(agg[0].putGamma, 100); // capped at 100
  });

  // ── ASP100 Options Narrative Tests ─────────────────────────────────────────
  describe('generateOptionsAsp100Narrative', () => {
    test('ASP100: positive gamma with balanced PCR produces mean-reverting narrative with walls', () => {
      const narrative = generateOptionsAsp100Narrative({
        gammaRegime: { regime: 'POSITIVE_GAMMA' },
        callWall: { strike: 105000, oi: 2500 },
        putWall: { strike: 95000, oi: 3000 },
        maxPain: { maxPainPrice: 100000 },
        gexFlipPrice: 97000,
        pcr: { pcr: 0.85 },
        underlyingPrice: 100000
      });

      assert.equal(narrative.badge, '+GEX MEAN-REVERTING');
      assert.equal(narrative.badgeType, 'positive');
      assert.match(narrative.executive, /\+GEX/);
      assert.match(narrative.positioning, /\$105,000/);
      assert.match(narrative.positioning, /\$95,000/);
      assert.match(narrative.positioning, /\$100,000/);
      assert.match(narrative.sentiment, /0\.85/);
      assert.match(narrative.sentiment, /cân bằng/);
      assert.match(narrative.action, /Range Trading/);
      assert.ok(narrative.wordCount >= 60 && narrative.wordCount <= 130, `wordCount ${narrative.wordCount} outside expected range`);
    });

    test('ASP100: negative gamma with high PCR produces momentum breakout narrative with hedging sentiment', () => {
      const narrative = generateOptionsAsp100Narrative({
        gammaRegime: { regime: 'NEGATIVE_GAMMA' },
        callWall: { strike: 110000, oi: 1500 },
        putWall: { strike: 88000, oi: 2200 },
        maxPain: { maxPainPrice: 94000 },
        gexFlipPrice: 96500,
        pcr: { pcr: 1.25 },
        underlyingPrice: 92000
      });

      assert.equal(narrative.badge, '-GEX MOMENTUM EXPANSION');
      assert.equal(narrative.badgeType, 'negative');
      assert.match(narrative.executive, /-GEX/);
      assert.match(narrative.positioning, /\$96,500/);
      assert.match(narrative.sentiment, /1\.25/);
      assert.match(narrative.sentiment, /phòng hộ/);
      assert.match(narrative.action, /Breakout Momentum/);
    });

    test('ASP100: defensive handling with null inputs does not throw', () => {
      const narrative = generateOptionsAsp100Narrative({
        gammaRegime: null,
        callWall: null,
        putWall: null,
        maxPain: null,
        gexFlipPrice: null,
        pcr: null,
        underlyingPrice: null
      });

      assert.equal(narrative.badge, 'NEUTRAL GAMMA');
      assert.equal(narrative.badgeType, 'neutral');
      assert.ok(narrative.executive.length > 0);
      assert.ok(narrative.positioning.length > 0);
      assert.ok(narrative.sentiment.length > 0);
      assert.ok(narrative.action.length > 0);
    });

    test('ASP100: analyzeBtcOptions bundles narrative in return payload', () => {
      const result = analyzeBtcOptions(mockInstruments, UNDERLYING_PRICE, null);
      assert.ok(result.narrative);
      assert.ok(result.narrative.badge);
      assert.ok(result.narrative.positioning);
      assert.ok(result.narrative.sentiment);
      assert.ok(result.narrative.action);
    });
  });

});
