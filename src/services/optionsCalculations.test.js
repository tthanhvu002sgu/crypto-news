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

});
