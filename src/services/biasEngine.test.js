import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateMarketBias, calculateBtcTrendRegime, toFiniteNumber, clamp } from './biasEngine.js';

describe('biasEngine unit tests', () => {
  it('toFiniteNumber parses numbers, strings with commas and percentage correctly', () => {
    assert.strictEqual(toFiniteNumber(42), 42);
    assert.strictEqual(toFiniteNumber('1,234.56'), 1234.56);
    assert.strictEqual(toFiniteNumber('4.25%'), 4.25);
    assert.strictEqual(toFiniteNumber('$95,000'), 95000);
    assert.strictEqual(toFiniteNumber(null), null);
    assert.strictEqual(toFiniteNumber(undefined), null);
    assert.strictEqual(toFiniteNumber('N/A'), null);
  });

  it('handles safe VIX parsing when VIX is an object or a primitive number', () => {
    const dataWithVixObj = {
      vix: { price: 14.2, changePercent: -2.5 },
      btc: { price: 95000, volume: 1000000000 },
    };
    const biasObj = calculateMarketBias(dataWithVixObj);
    const vixSigObj = biasObj.signals.find((s) => s.name.includes('VIX'));
    assert.ok(vixSigObj, 'VIX signal should be present');
    assert.ok(vixSigObj.score > 0, 'VIX < 15 should give positive risk score');

    const dataWithVixNum = {
      vix: 28.5,
      btc: { price: 95000, volume: 1000000000 },
    };
    const biasNum = calculateMarketBias(dataWithVixNum);
    const vixSigNum = biasNum.signals.find((s) => s.name.includes('VIX'));
    assert.ok(vixSigNum, 'VIX signal should be present');
    assert.ok(vixSigNum.score < 0, 'VIX 28.5 should give negative risk score');
  });

  it('eliminates MVRV double-counting (NUPL and Supply in Profit are removed from signal weights)', () => {
    const data = {
      onChainMetrics: { mvrv: 1.2 },
      btc: { price: 90000 },
    };
    const bias = calculateMarketBias(data);
    const mvrvSig = bias.signals.find((s) => s.name.includes('MVRV'));
    const nuplSig = bias.signals.find((s) => s.name === 'NUPL');
    const sipSig = bias.signals.find((s) => s.name === 'Supply in Profit');

    assert.ok(mvrvSig, 'MVRV signal should exist');
    assert.strictEqual(mvrvSig.weight, '8%');
    assert.strictEqual(nuplSig, undefined, 'NUPL should not be a duplicate scored signal');
    assert.strictEqual(sipSig, undefined, 'Supply in Profit should not be a duplicate scored signal');
  });

  it('integrates Macro Liquidity and Financial Conditions (DXY, 10Y Yield, Net Liquidity, HY Spread)', () => {
    const macroData = {
      btc: { price: 95000, volume: 2000000000 },
      fedFundsRate: 4.25,
      cpi: 2.3,
      unrate: 4.1,
      dxy: { price: 99.5 },
      tenYearYield: 3.75,
      highYield: 3.2,
      netLiquidity: 6350,
      sp500: { changePercent: 1.2 },
      qqq: { changePercent: 1.8 },
      vix: 13.5,
    };

    const bias = calculateMarketBias(macroData);
    assert.ok(bias.pillars.newsRisk > 0, 'Macro liquidity pillar should be strongly positive');
    assert.strictEqual(bias.regime.liquidity, 'EXPANDING');

    const dxySig = bias.signals.find((s) => s.name.includes('DXY'));
    const netLiqSig = bias.signals.find((s) => s.name.includes('Net Liquidity'));
    const macroPulseSig = bias.signals.find((s) => s.name.includes('Monetary Policy'));
    const eqSig = bias.signals.find((s) => s.name.includes('Wall Street'));

    assert.ok(dxySig && dxySig.score > 0, 'Weak DXY (<100) & low 10Y should be bullish');
    assert.ok(netLiqSig && netLiqSig.score > 0, 'High Net Liquidity and tight HY Spread should be bullish');
    assert.ok(macroPulseSig && macroPulseSig.score > 0, 'Low CPI YoY (<2.5) should be positive');
    assert.ok(eqSig && eqSig.score > 0, 'Rising Equities should be positive');
  });

  it('calculates BTC Trend Regime from daily klines and outputs 3-layer regime metadata', () => {
    // Construct 250 daily candles with an uptrend: prices rising from 40k to 95k
    const dailyKlines = [];
    const basePrice = 40000;
    for (let i = 0; i < 250; i++) {
      const price = basePrice + i * 220; // 40,000 up to 95,000
      dailyKlines.push({
        time: new Date(Date.now() - (250 - i) * 86400 * 1000),
        open: price - 100,
        high: price + 200,
        low: price - 200,
        close: price,
        volume: 50000,
      });
    }

    const trend = calculateBtcTrendRegime(dailyKlines, 95000);
    assert.strictEqual(trend.hasData, true);
    assert.ok(trend.ma50 > 0);
    assert.ok(trend.ma200 > 0);
    assert.ok(trend.ma50 > trend.ma200, 'MA50 should be above MA200 in strong uptrend');
    assert.ok(trend.slope50 > 0, 'MA50 slope should be positive');
    assert.strictEqual(trend.regimeLabel, 'STRONG UPTREND');

    const data = {
      btc: { price: 95000, volume: 1000000000 },
      btcDailyKlinesAll: dailyKlines,
      onChainMetrics: { mvrv: 1.1 },
      fundingRate: -0.00015,
      cvdHistory24hSpot: [{ cvd: 50000000 }],
    };

    const bias = calculateMarketBias(data);
    assert.strictEqual(bias.regime.trend, 'STRONG UPTREND');
    assert.strictEqual(bias.regime.valuation, 'UNDERVALUED');
    assert.strictEqual(bias.regime.tactical, 'SHORT_SQUEEZE_WATCH');

    const trendSig = bias.signals.find((s) => s.name.includes('Trend Regime'));
    assert.ok(trendSig && trendSig.score > 0, 'Trend regime should contribute positively in uptrend');
  });

  it('differentiates negative funding rate with spot buying (Short Squeeze) vs spot selling (Bearish)', () => {
    // Case 1: Negative funding + Spot buying -> Bullish squeeze potential
    const squeezeData = {
      btc: { price: 90000, volume: 1000000000 },
      fundingRate: -0.00025,
      cvdHistory24hSpot: [{ cvd: 80000000 }], // Positive spot CVD
    };
    const squeezeBias = calculateMarketBias(squeezeData);
    const frSqueezeSig = squeezeBias.signals.find((s) => s.name.includes('Funding Rate'));
    assert.ok(frSqueezeSig && frSqueezeSig.score > 0, 'Negative funding with Spot Buying should be positive (Squeeze)');
    assert.ok(frSqueezeSig.status.includes('Squeeze'));

    // Case 2: Negative funding + Spot dumping -> Bearish true breakdown
    const dumpData = {
      btc: { price: 90000, volume: 1000000000 },
      fundingRate: -0.00025,
      cvdHistory24hSpot: [{ cvd: -80000000 }], // Negative spot CVD
    };
    const dumpBias = calculateMarketBias(dumpData);
    const frDumpSig = dumpBias.signals.find((s) => s.name.includes('Funding Rate'));
    assert.ok(frDumpSig && frDumpSig.score < 0, 'Negative funding with Spot Dumping should be bearish');
    assert.ok(frDumpSig.status.includes('Downtrend'));
  });

  it('dampens risk score when High Impact calendar event occurs within 24h', () => {
    const futureTime = new Date(Date.now() + 6 * 3600 * 1000).toISOString(); // In 6 hours
    const dataWithEvent = {
      btc: { price: 90000, volume: 1000000000 },
      vix: 14.0, // Low VIX usually bullish
      news: [
        { title: '[LỊCH SỰ KIỆN] FOMC Interest Rate Decision', time: futureTime, tag: 'Calendar,High' },
      ],
    };
    const bias = calculateMarketBias(dataWithEvent);
    assert.strictEqual(bias.calendarRisk, 'HIGH');
    assert.strictEqual(bias.upcomingEvents.length, 1);
    const vixSig = bias.signals.find((s) => s.name.includes('VIX & Calendar'));
    assert.ok(vixSig && vixSig.score < 0, 'Upcoming 24h High Impact event should dampen risk score');
  });
});
