import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCotIndex,
  classifyCotRegime,
  processCotData,
  COT_REGIMES
} from './cotEngine.js';

describe('cotEngine', () => {
  it('calculates COT Index percentile correctly', () => {
    assert.equal(calculateCotIndex(50, 0, 100), 50);
    assert.equal(calculateCotIndex(100, 0, 100), 100);
    assert.equal(calculateCotIndex(0, 0, 100), 0);
    assert.equal(calculateCotIndex(120, 0, 100), 100);
    assert.equal(calculateCotIndex(-20, 0, 100), 0);
    assert.equal(calculateCotIndex(50, 50, 50), 50);
  });

  it('classifies regimes based on institutional and leveraged positioning', () => {
    // Arbitrage Hedged: LF deeply short and AM long
    const arbRegime = classifyCotRegime({
      amNet: 3500,
      amChangeWoW: 200,
      amChange4W: 400,
      amCotIndex: 60,
      lfNet: -6500,
      lfChangeWoW: -100,
      oiChangeWoW: 50,
    });
    assert.equal(arbRegime.id, COT_REGIMES.ARBITRAGE_HEDGED.id);

    // Institutional Accumulation: AM COT Index > 65% and large net long
    const accumRegime = classifyCotRegime({
      amNet: 5000,
      amChangeWoW: 500,
      amChange4W: 1200,
      amCotIndex: 85,
      lfNet: -2000,
      lfChangeWoW: 100,
      oiChangeWoW: 300,
    });
    assert.equal(accumRegime.id, COT_REGIMES.INSTITUTIONAL_ACCUMULATION.id);

    // Short squeeze: LF covering fast while OI drops
    const squeezeRegime = classifyCotRegime({
      amNet: 1000,
      amChangeWoW: -100,
      amChange4W: -200,
      amCotIndex: 40,
      lfNet: -3000,
      lfChangeWoW: 1500,
      oiChangeWoW: -1200,
    });
    assert.equal(squeezeRegime.id, COT_REGIMES.SHORT_SQUEEZE_RISK.id);
  });

  it('parses CFTC record and processes multi-week series properly', () => {
    const rawMock = [
      {
        report_date_as_yyyy_mm_dd: '2026-09-29T00:00:00.000',
        open_interest_all: '20000',
        change_in_open_interest_all: '500',
        asset_mgr_positions_long: '5000',
        asset_mgr_positions_short: '1000',
        lev_money_positions_long: '4000',
        lev_money_positions_short: '10000',
        dealer_positions_long_all: '6000',
        dealer_positions_short_all: '4000',
        nonrept_positions_long_all: '1200',
        nonrept_positions_short_all: '800',
        other_rept_positions_long: '300',
        other_rept_positions_short: '100',
      },
      {
        report_date_as_yyyy_mm_dd: '2026-09-22T00:00:00.000',
        open_interest_all: '19500',
        change_in_open_interest_all: '200',
        asset_mgr_positions_long: '4500',
        asset_mgr_positions_short: '1100',
        lev_money_positions_long: '4200',
        lev_money_positions_short: '10500',
        dealer_positions_long_all: '5800',
        dealer_positions_short_all: '3900',
        nonrept_positions_long_all: '1100',
        nonrept_positions_short_all: '750',
        other_rept_positions_long: '200',
        other_rept_positions_short: '100',
      }
    ];

    const result = processCotData(rawMock);
    assert.ok(result);
    assert.equal(result.date, '29/09/2026');
    assert.equal(result.openInterest, 20000);
    assert.equal(result.assetManager.net, 4000);
    assert.equal(result.leveragedFunds.net, -6000);
    assert.equal(result.analytics.deltas.amWoW, 4000 - 3400); // 600
    assert.equal(result.history.length, 2);
    assert.ok(result.narrative);
    assert.ok(result.narrative.smartMoney.includes('Asset Managers'));
  });
});
