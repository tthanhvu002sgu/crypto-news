import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateMarketBias, calculateBtcTrendRegime, toFiniteNumber, clamp, evaluateBiasPriceConfirmation, calculateDataFreshness, parseToDate, getDaysAgo } from './biasEngine.js';

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

  it('scores Spot and Futures CVD using Binance benchmark CVD series', () => {
    const data = {
      btc: { price: 90000, volume: 1000000000 },
      cvdHistory24hSpot: [{ cvd: 80000000 }],
      cvdHistory24h: [{ cvd: -50000000 }],
    };
    const bias = calculateMarketBias(data);
    const spotSignal = bias.signals.find((signal) => signal.name.startsWith('Spot CVD'));
    const futuresSignal = bias.signals.find((signal) => signal.name.startsWith('Futures CVD'));
    assert.ok(spotSignal.status.includes('BINANCE'));
    assert.ok(spotSignal.score > 0, 'positive Spot CVD should yield positive score');
    assert.ok(futuresSignal.status.includes('BINANCE'));
    assert.ok(futuresSignal.score < 0, 'negative Futures CVD should yield negative score');
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

  it('excludes fallback signals from available weight and confidence calculation', () => {
    const etfFallback = [
      { date: '18/06/26', flow: 200 }
    ];
    etfFallback.isFallback = true;

    const dataWithFallbacks = {
      btc: { price: 90000, volume: 1000000000 },
      cotData: { isFallback: true, assetManager: { net: 5000 } },
      fedFundsRate: { val: 4.5, isFallback: true },
      cpi: { val: 2.7, isFallback: true },
      netLiquidity: 6120,
      netLiquidityIsFallback: true,
      fundingRate: 0.0001,
    };

    const bias = calculateMarketBias(dataWithFallbacks, etfFallback);
    const etfSig = bias.signals.find(s => s.name.includes('ETF'));
    const cotSig = bias.signals.find(s => s.name.includes('COT'));
    const fedSig = bias.signals.find(s => s.name.includes('Monetary Policy'));
    const netLiqSig = bias.signals.find(s => s.name.includes('Net Liquidity'));

    assert.ok(etfSig && etfSig.weight.includes('0%'), 'ETF fallback should have 0% weight');
    assert.ok(cotSig && cotSig.weight.includes('0%'), 'COT fallback should have 0% weight');
    assert.strictEqual(fedSig, undefined, 'Fallback macro pulse should be omitted from scoring');
    assert.strictEqual(netLiqSig, undefined, 'Fallback net liquidity should be omitted from scoring');
    assert.ok(bias.confidence < 30, 'Confidence must be low when 40% institutional and macro are fallbacks');
  });

  it('normalizes mining difficulty whether provided in Trillions (<1e6) or Raw (>1e6)', () => {
    // 85.24 Trillion vs 85.24 * 1e12 Raw
    const dataTrillion = {
      btc: { price: 90000, volume: 1000000000 },
      onChain: { difficulty: 85.24 } // in Trillion
    };
    const dataRaw = {
      btc: { price: 90000, volume: 1000000000 },
      onChain: { difficulty: 85.24 * 1e12 } // in Raw
    };

    const biasT = calculateMarketBias(dataTrillion);
    const biasR = calculateMarketBias(dataRaw);

    const sigT = biasT.signals.find(s => s.name.includes('Mining Cost'));
    const sigR = biasR.signals.find(s => s.name.includes('Mining Cost'));

    assert.ok(sigT && sigR, 'Mining signals should exist in both');
    assert.strictEqual(sigT.score, sigR.score, 'Trillion and Raw difficulty must produce identical score');
  });

  it('ignores raw FRED CPI index levels (>50) to prevent corrupting inflation score', () => {
    const dataRawIndex = {
      btc: { price: 90000, volume: 1000000000 },
      fedFundsRate: 4.5,
      cpi: 314.54, // Raw index level from FRED CPIAUCSL instead of YoY %
    };

    const bias = calculateMarketBias(dataRawIndex);
    const macroSig = bias.signals.find(s => s.name.includes('Monetary Policy'));
    assert.ok(macroSig, 'Macro signal should still score fed funds');
    assert.ok(!macroSig.status.includes('314.5%'), 'CPI index level > 50 must not be displayed or scored as 314.5% inflation');
  });

  it('supports direct numeric longShortRatio and globalLs as well as lsHistory array', () => {
    const dataDirectLs = {
      btc: { price: 90000, volume: 1000000000 },
      longShortRatio: 2.8,
    };
    const bias = calculateMarketBias(dataDirectLs);
    const lsSig = bias.signals.find(s => s.name.includes('Long/Short'));
    assert.ok(lsSig, 'L/S signal should be present when longShortRatio is directly provided');
    assert.ok(lsSig.score < 0, 'L/S ratio 2.8 (crowded long) should be bearish');
  });

  describe('evaluateBiasPriceConfirmation unit tests', () => {
    it('evaluates CONFIRMED_BULLISH when Bias is positive and 24h price is up', () => {
      const res = evaluateBiasPriceConfirmation(38, 1.8);
      assert.strictEqual(res.state, 'CONFIRMED_BULLISH');
      assert.strictEqual(res.label, 'Bullish được price xác nhận');
      assert.strictEqual(res.shortLabel, 'XÁC NHẬN TĂNG ▲');
      assert.strictEqual(res.color, '#10b981');
    });

    it('evaluates BULLISH_DIVERGENCE when Bias is positive and 24h price is down', () => {
      const res = evaluateBiasPriceConfirmation(35, -2.4);
      assert.strictEqual(res.state, 'BULLISH_DIVERGENCE');
      assert.strictEqual(res.label, 'Bullish divergence — thesis chưa được xác nhận');
      assert.strictEqual(res.shortLabel, 'PHÂN KỲ TĂNG ⚡');
      assert.strictEqual(res.color, '#f59e0b');
    });

    it('evaluates BEARISH_DIVERGENCE when Bias is negative and 24h price is up (Bull trap risk)', () => {
      const res = evaluateBiasPriceConfirmation(-40, 2.5);
      assert.strictEqual(res.state, 'BEARISH_DIVERGENCE');
      assert.strictEqual(res.label, 'Bearish divergence — cảnh giác');
      assert.strictEqual(res.shortLabel, 'PHÂN KỲ GIẢM ⚠');
      assert.strictEqual(res.color, '#f43f5e');
    });

    it('evaluates CONFIRMED_BEARISH when Bias is negative and 24h price is down', () => {
      const res = evaluateBiasPriceConfirmation(-55, -3.2);
      assert.strictEqual(res.state, 'CONFIRMED_BEARISH');
      assert.strictEqual(res.label, 'Bearish được price xác nhận');
      assert.strictEqual(res.shortLabel, 'XÁC NHẬN GIẢM ▼');
      assert.strictEqual(res.color, '#f87171');
    });

    it('evaluates NEUTRAL_ALIGNED when Bias is neutral', () => {
      const res = evaluateBiasPriceConfirmation(5, 0.2);
      assert.strictEqual(res.state, 'NEUTRAL_ALIGNED');
      assert.strictEqual(res.shortLabel, 'TRUNG LẬP ⚖');
    });
  });

  describe('calculateDataFreshness & Date parsing unit tests', () => {
    it('parses various date formats (DD/MM/YY, ISO, Unix timestamp) and calculates days ago correctly', () => {
      const refTime = new Date('2026-08-27T12:00:00Z').getTime();
      
      const date1 = parseToDate('22/08/26');
      assert.strictEqual(date1.getUTCDate(), 22);
      assert.strictEqual(date1.getUTCMonth(), 7); // August is index 7
      assert.strictEqual(getDaysAgo('22/08/26', refTime), 5);

      const date2 = parseToDate('2026-08-26');
      assert.strictEqual(getDaysAgo(date2, refTime), 1);
    });

    it('identifies the oldest data source (e.g. CME COT 5d) among non-fallback active feeds', () => {
      const refTime = new Date('2026-08-27T12:00:00Z').getTime();
      const mockData = {
        btc: { price: 112450, change: 1.8, lastUpdated: '2026-08-27T11:58:00Z' },
        cotData: { date: '22/08/26', assetManager: { net: 3500 } },
        onChainMetrics: { date: '2026-08-26', mvrv: 1.8 },
      };
      const mockEtfHistory = [
        { date: '26/08/26', flow: 150 }
      ];

      const freshness = calculateDataFreshness(mockData, mockEtfHistory, refTime);
      assert.strictEqual(freshness.oldestDataStr, 'COT 5d');
      assert.strictEqual(freshness.priceUpdatedStr, '2m');
    });

    it('handles fallback feeds gracefully without falsely reporting fallback dates as oldest active', () => {
      const refTime = new Date('2026-08-27T12:00:00Z').getTime();
      const mockData = {
        btc: { price: 112450, change: 1.8 },
        cotData: { date: '01/01/2020', isFallback: true, assetManager: { net: 100 } },
      };
      const mockEtfHistory = [{ date: '26/08/26', flow: 200 }];

      const freshness = calculateDataFreshness(mockData, mockEtfHistory, refTime);
      assert.strictEqual(freshness.oldestDataStr, 'ETF 1d', 'Fallback COT should not be chosen as oldest active source');
    });
  });
});
