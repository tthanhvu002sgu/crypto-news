import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBinanceFunding,
  parseBybitFunding,
  parseOkxFunding,
  parseBitgetFunding,
  analyzeMultiExchangeFunding,
} from './fundingBasisEngine.js';

describe('fundingBasisEngine', () => {
  describe('Exchange Parsers', () => {
    it('parseBinanceFunding: extracts funding rate and basis', () => {
      const raw = {
        symbol: 'BTCUSDT',
        markPrice: '65200.50',
        indexPrice: '65150.00',
        lastFundingRate: '0.00010000',
        nextFundingTime: 1700000000000,
      };

      const res = parseBinanceFunding(raw);
      assert.equal(res.exchange, 'Binance');
      assert.equal(res.code, 'BINANCE');
      assert.equal(res.venue, 'BINANCE');
      assert.equal(res.symbol, 'BTCUSDT');
      assert.equal(res.status, 'OK');
      assert.equal(res.fundingRate, 0.0001);
      assert.equal(res.fundingPct8h, 0.01);
      assert.equal(res.annualizedPct, 0.01 * 3 * 365);
      assert.equal(res.fundingApr, res.annualizedPct);
      assert.equal(res.markPrice, 65200.5);
      assert.equal(res.indexPrice, 65150);
      assert.equal(res.basisUsd, 50.5);
      assert.ok(res.basisPct > 0);
    });

    it('parseBybitFunding: extracts from V5 ticker structure', () => {
      const raw = {
        retCode: 0,
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              markPrice: '65210.00',
              indexPrice: '65150.00',
              fundingRate: '0.00012000',
              nextFundingTime: '1700000000000',
            },
          ],
        },
      };

      const res = parseBybitFunding(raw);
      assert.equal(res.exchange, 'Bybit');
      assert.equal(res.status, 'OK');
      assert.equal(res.fundingRate, 0.00012);
      assert.equal(res.fundingPct8h, 0.012);
    });

    it('parseBybitFunding: treats numeric fundingRate 0 as valid OK (LOGIC-003)', () => {
      const raw = {
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              markPrice: '65000',
              indexPrice: '65000',
              fundingRate: 0, // numeric 0
            },
          ],
        },
      };

      const res = parseBybitFunding(raw);
      assert.equal(res.status, 'OK');
      assert.equal(res.fundingRate, 0);
      assert.equal(res.fundingPct8h, 0);
    });

    it('parseOkxFunding: merges rate, ticker, and index', () => {
      const fData = { data: [{ instId: 'BTC-USDT-SWAP', fundingRate: '0.00008', nextFundingTime: '1700000000000' }] };
      const tData = { data: [{ instId: 'BTC-USDT-SWAP', markPx: '65205.00' }] };
      const idxData = { data: [{ instId: 'BTC-USDT', idxPx: '65150.00' }] };

      const res = parseOkxFunding(fData, tData, idxData);
      assert.equal(res.exchange, 'OKX');
      assert.equal(res.status, 'OK');
      assert.equal(res.fundingRate, 0.00008);
      assert.equal(res.markPrice, 65205);
      assert.equal(res.indexPrice, 65150);
    });

    it('parseBitgetFunding: finds matching symbol in list', () => {
      const raw = {
        data: [
          { symbol: 'ETHUSDT', fundingRate: '0.0001' },
          { symbol: 'BTCUSDT', fundingRate: '0.00011', markPrice: '65202', indexPrice: '65150', nextFundingTime: 1700000000000 },
        ],
      };

      const res = parseBitgetFunding(raw, 'BTCUSDT');
      assert.equal(res.exchange, 'Bitget');
      assert.equal(res.status, 'OK');
      assert.equal(res.fundingRate, 0.00011);
      assert.equal(res.markPrice, 65202);
    });

    it('defensive: handles errors gracefully on invalid payload', () => {
      const badBinance = parseBinanceFunding(null);
      assert.equal(badBinance.status, 'ERROR');

      const badBybit = parseBybitFunding({});
      assert.equal(badBybit.status, 'ERROR');

      const badOkx = parseOkxFunding(null, null, null);
      assert.equal(badOkx.status, 'ERROR');

      const badBitget = parseBitgetFunding({ data: [] });
      assert.equal(badBitget.status, 'ERROR');
    });
  });

  describe('analyzeMultiExchangeFunding', () => {
    it('identifies EXTREME_LONG_CROWDING when funding is heavily positive', () => {
      const venues = [
        { exchange: 'Binance', code: 'BINANCE', status: 'OK', fundingRate: 0.00035, basisPct: 0.15 },
        { exchange: 'Bybit', code: 'BYBIT', status: 'OK', fundingRate: 0.00038, basisPct: 0.16 },
        { exchange: 'OKX', code: 'OKX', status: 'OK', fundingRate: 0.00032, basisPct: 0.14 },
        { exchange: 'Bitget', code: 'BITGET', status: 'OK', fundingRate: 0.00036, basisPct: 0.15 },
      ];

      const res = analyzeMultiExchangeFunding(venues);
      assert.equal(res.validCount, 4);
      assert.equal(res.validVenuesCount, 4);
      assert.equal(res.crowdingRegime, 'EXTREME_LONG_CROWDING');
      assert.equal(res.crowdingLabel, 'LONG CROWDED (Unwind Risk)');
      assert.equal(res.squeezeLabel, res.crowdingLabel);
      assert.equal(res.crowdingTone, 'bear');
      assert.ok(res.avgFundingPct8h > 0.03);
      assert.equal(res.avgFundingApr, res.avgAnnualizedPct);
      assert.equal(res.highestVenue.exchange, 'Bybit');
      assert.equal(res.lowestVenue.exchange, 'OKX');
      assert.equal(res.maxFundingRate, 0.00038);
      assert.equal(res.minFundingRate, 0.00032);
      assert.ok(res.fundingSpread > 0);
    });

    it('identifies EXTREME_SHORT_CROWDING when funding is negative across venues', () => {
      const venues = [
        { exchange: 'Binance', code: 'BINANCE', status: 'OK', fundingRate: -0.00015, basisPct: -0.1 },
        { exchange: 'Bybit', code: 'BYBIT', status: 'OK', fundingRate: -0.00020, basisPct: -0.12 },
        { exchange: 'OKX', code: 'OKX', status: 'OK', fundingRate: -0.00010, basisPct: -0.08 },
        { exchange: 'Bitget', code: 'BITGET', status: 'OK', fundingRate: -0.00018, basisPct: -0.11 },
      ];

      const res = analyzeMultiExchangeFunding(venues);
      assert.equal(res.crowdingRegime, 'EXTREME_SHORT_CROWDING');
      assert.equal(res.crowdingTone, 'bull');
      assert.ok(res.avgFundingPct8h < -0.01);
    });

    it('identifies CROSS_VENUE_DISPERSION when large funding gap between exchanges', () => {
      const venues = [
        { exchange: 'Binance', code: 'BINANCE', status: 'OK', fundingRate: 0.00025, basisPct: 0.05 },
        { exchange: 'Bybit', code: 'BYBIT', status: 'OK', fundingRate: 0.00005, basisPct: 0.01 }, // spread 0.00020 = 0.02%
      ];

      const res = analyzeMultiExchangeFunding(venues);
      assert.equal(res.crowdingRegime, 'CROSS_VENUE_DISPERSION');
      assert.equal(res.crowdingTone, 'warning');
      assert.ok(res.fundingSpreadPct >= 0.015);
    });

    it('identifies NEUTRAL_CARRY when normal baseline funding', () => {
      const venues = [
        { exchange: 'Binance', code: 'BINANCE', status: 'OK', fundingRate: 0.00010, basisPct: 0.02 },
        { exchange: 'Bybit', code: 'BYBIT', status: 'OK', fundingRate: 0.00010, basisPct: 0.02 },
      ];

      const res = analyzeMultiExchangeFunding(venues);
      assert.equal(res.crowdingRegime, 'NEUTRAL_CARRY');
      assert.equal(res.crowdingTone, 'neutral');
    });

    it('handles empty input gracefully', () => {
      const res = analyzeMultiExchangeFunding([]);
      assert.equal(res.crowdingRegime, 'NO_DATA');
      assert.equal(res.validCount, 0);
    });

    it('identifies EXTREME_LONG_CROWDING when only 2 venues online and both meet squeeze criteria (LOGIC-002)', () => {
      // 2 venues out of 4 online (e.g. OKX/Bitget geoblocked)
      const venues = [
        { exchange: 'Binance', code: 'BINANCE', status: 'OK', fundingRate: 0.00028, basisPct: 0.12 },
        { exchange: 'Bybit', code: 'BYBIT', status: 'OK', fundingRate: 0.00029, basisPct: 0.14 },
      ];

      const res = analyzeMultiExchangeFunding(venues);
      assert.equal(res.validCount, 2);
      // highLongVenues = 2 >= quorumThreshold (Math.max(2, ceil(2*0.75)) = 2)
      assert.equal(res.crowdingRegime, 'EXTREME_LONG_CROWDING');
      assert.equal(res.crowdingTone, 'bear');
    });
  });
});
