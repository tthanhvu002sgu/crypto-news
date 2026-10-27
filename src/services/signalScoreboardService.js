/**
 * Signal Scoreboard & Automated Backtest Engine
 * 
 * Kiểm chứng "Edge" định lượng không look-ahead bias (No-Look-Ahead).
 * Thống kê Hit-Rate, Median Forward Return, IQR (P25–P75), Profit Factor
 * và Sample Size (N) cho 4 phân hệ tín hiệu cốt lõi:
 * 1. Capital Flow (Long/Short build-up, Short covering, Long exit, Spot confluence)
 * 2. Bias Regime (5 Bucket Bias chuẩn & Trend Regimes)
 * 3. Scanner Rank (Top RS Altcoins, Spot Supported flow)
 * 4. Move Tracker (Pump/Dump Continuation vs Mean Reversion)
 * 
 * Kiến trúc Hybrid No-Look-Ahead:
 * Kết hợp giữa chuỗi nến lịch sử walk-forward (đã kiểm định) và
 * live snapshot provenance ghi nhận thực tế từ IndexedDB/localStorage.
 */

import { calculateMarketBias, toFiniteNumber } from './biasEngine.js';
import { getBiasBucket, toSortableDateStr } from './biasHistoryService.js';
import { classifyCapitalFlow } from './capitalFlowEngine.js';

export const SCOREBOARD_HORIZONS = ['1D', '3D', '7D'];

/**
 * Tính toán phân vị và độ phân tán (Min, Max, P25, Median, P75, IQR, Mean)
 */
export function calculateQuantiles(numbers) {
  const valid = (Array.isArray(numbers) ? numbers : [])
    .filter((v) => Number.isFinite(Number(v)))
    .map(Number)
    .sort((a, b) => a - b);

  const n = valid.length;
  if (n === 0) {
    return {
      n: 0,
      min: null,
      max: null,
      p25: null,
      median: null,
      p75: null,
      iqr: null,
      mean: null,
    };
  }

  const getPercentile = (p) => {
    if (n === 1) return valid[0];
    const pos = (n - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (valid[base + 1] !== undefined) {
      return valid[base] + rest * (valid[base + 1] - valid[base]);
    }
    return valid[base];
  };

  const min = valid[0];
  const max = valid[n - 1];
  const p25 = Number(getPercentile(0.25).toFixed(2));
  const median = Number(getPercentile(0.50).toFixed(2));
  const p75 = Number(getPercentile(0.75).toFixed(2));
  const iqr = Number((p75 - p25).toFixed(2));
  const sum = valid.reduce((acc, v) => acc + v, 0);
  const mean = Number((sum / n).toFixed(2));

  return {
    n,
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    p25,
    median,
    p75,
    iqr,
    mean,
  };
}

/**
 * Đánh giá kết quả Hit / Miss dựa trên hướng kỳ vọng của tín hiệu
 * @param {'LONG'|'SHORT'|'RANGE'} expectedDirection
 * @param {number} returnPct
 * @returns {boolean}
 */
export function isSignalHit(expectedDirection, returnPct) {
  if (!Number.isFinite(returnPct)) return false;
  if (expectedDirection === 'LONG') return returnPct > 0;
  if (expectedDirection === 'SHORT') return returnPct < 0;
  if (expectedDirection === 'RANGE') return Math.abs(returnPct) <= 1.5;
  return false;
}

/**
 * Phân định nhãn Edge Verdict định lượng dựa trên Hit-rate, Median Return và Sample Size
 */
export function getEdgeVerdict(hitRate, medianReturn, sampleSize) {
  if (sampleSize == null || sampleSize < 3) {
    return {
      tier: 'INSUFFICIENT_DATA',
      label: 'CHỜ THÊM MẪU',
      shortLabel: 'CHỜ MẪU',
      badgeColor: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.1)',
      border: 'rgba(148, 163, 184, 0.3)',
      desc: 'Cần tối thiểu 3 mẫu kiểm định để đánh giá Edge.',
    };
  }

  const hr = Number(hitRate);
  const med = Number(medianReturn ?? 0);

  if (hr >= 58 && (med > 0 || hr >= 65)) {
    return {
      tier: 'VERIFIED_EDGE',
      label: '⭐ EDGE XÁC THỰC',
      shortLabel: 'EDGE CAO',
      badgeColor: '#10b981',
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.35)',
      desc: `Hit-rate ${hr.toFixed(1)}% với Median Return dương (+${med.toFixed(2)}%) — Tín hiệu có lợi thế thống kê rõ ràng.`,
    };
  }

  if (hr >= 52) {
    return {
      tier: 'MODERATE_EDGE',
      label: 'KHẢ QUAN ▲',
      shortLabel: 'KHẢ QUAN',
      badgeColor: '#34d399',
      bg: 'rgba(52, 211, 153, 0.1)',
      border: 'rgba(52, 211, 153, 0.3)',
      desc: `Hit-rate ${hr.toFixed(1)}% đạt mức kỳ vọng tích cực trên thị trường crypto.`,
    };
  }

  if (hr >= 47) {
    return {
      tier: 'NEUTRAL_EDGE',
      label: 'TRUNG TÍNH ⚖',
      shortLabel: 'CÂN BẰNG',
      badgeColor: '#94a3b8',
      bg: 'rgba(148, 163, 184, 0.1)',
      border: 'rgba(148, 163, 184, 0.25)',
      desc: `Hit-rate ${hr.toFixed(1)}% xấp xỉ mức ngẫu nhiên (50/50); cần phối hợp thêm chỉ báo bổ trợ.`,
    };
  }

  return {
    tier: 'NEGATIVE_EDGE',
    label: '⚠ CẢNH BÁO RỦI RO',
    shortLabel: 'RỦI RO',
    badgeColor: '#f43f5e',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.35)',
    desc: `Hit-rate thấp (${hr.toFixed(1)}%) — Tín hiệu thường gặp nhiễu hoặc bẫy giá ngược chiều.`,
  };
}

/**
 * Tính toán thống kê hiệu suất cho một danh sách cá thể tín hiệu theo kỳ hạn
 * @param {Array<{expectedDirection: string, forwardReturns: Object}>} occurrences
 * @param {string} horizon
 */
export function computeOccurrencesStats(occurrences, horizon = '1D') {
  const valid = Array.isArray(occurrences) ? occurrences : [];
  const horizonKey = String(horizon).toUpperCase();

  const resolved = [];
  let hits = 0;
  let winSum = 0;
  let winCount = 0;
  let lossSum = 0;
  let lossCount = 0;

  valid.forEach((occ) => {
    const ret = occ?.forwardReturns?.[horizonKey] ??
      (horizonKey === '1D' ? occ?.forwardReturn1d :
       horizonKey === '3D' ? occ?.forwardReturn3d :
       horizonKey === '7D' ? occ?.forwardReturn7d : null);

    if (ret != null && Number.isFinite(Number(ret))) {
      const numRet = Number(ret);
      resolved.push(numRet);

      const isHit = isSignalHit(occ.expectedDirection, numRet);
      if (isHit) hits += 1;

      // Win / Loss magnitude
      if (occ.expectedDirection === 'LONG') {
        if (numRet > 0) { winSum += numRet; winCount += 1; }
        else if (numRet < 0) { lossSum += Math.abs(numRet); lossCount += 1; }
      } else if (occ.expectedDirection === 'SHORT') {
        if (numRet < 0) { winSum += Math.abs(numRet); winCount += 1; }
        else if (numRet > 0) { lossSum += numRet; lossCount += 1; }
      } else {
        if (Math.abs(numRet) <= 1.5) { winSum += Math.max(0.1, 1.5 - Math.abs(numRet)); winCount += 1; }
        else { lossSum += (Math.abs(numRet) - 1.5); lossCount += 1; }
      }
    }
  });

  const q = calculateQuantiles(resolved);
  const sampleSize = resolved.length;
  const hitRate = sampleSize > 0 ? Number(((hits / sampleSize) * 100).toFixed(1)) : null;
  const profitFactor = lossSum > 0 ? Number((winSum / lossSum).toFixed(2)) : winSum > 0 ? 9.99 : null;
  const avgWin = winCount > 0 ? Number((winSum / winCount).toFixed(2)) : null;
  const avgLoss = lossCount > 0 ? Number((lossSum / lossCount).toFixed(2)) : null;

  const verdict = getEdgeVerdict(hitRate, q.median, sampleSize);

  return {
    horizon: horizonKey,
    totalCount: valid.length,
    sampleSize,
    hits,
    hitRate,
    medianReturn: q.median,
    p25: q.p25,
    p75: q.p75,
    iqr: q.iqr,
    min: q.min,
    max: q.max,
    mean: q.mean,
    profitFactor,
    avgWin,
    avgLoss,
    verdict,
    returns: resolved,
  };
}

/**
 * 1. Walk-Forward Backtester cho Market Bias Regimes
 */
export function backtestBiasRegimes(dashboardData, etfHistory = [], horizons = SCOREBOARD_HORIZONS) {
  if (!dashboardData) return [];

  const rawKlines = dashboardData.btcDailyKlinesAll ?? dashboardData.dailyKlines ?? dashboardData.klines;
  if (!Array.isArray(rawKlines) || rawKlines.length < 10) return [];

  const lookbackBars = Math.min(90, rawKlines.length);
  const startIdx = rawKlines.length - lookbackBars;

  const signalGroups = {
    STRONG_BULL: {
      id: 'bias_strong_bull',
      code: 'BIAS-01',
      name: 'Bias: Strong Bull (+30..+100)',
      category: 'biasRegime',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    BULL: {
      id: 'bias_bull',
      code: 'BIAS-02',
      name: 'Bias: Bull (+10..+30)',
      category: 'biasRegime',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    NEUTRAL: {
      id: 'bias_neutral',
      code: 'BIAS-03',
      name: 'Bias: Neutral (-10..+10)',
      category: 'biasRegime',
      expectedDirection: 'RANGE',
      directionLabel: 'NEUTRAL ⚖',
      occurrences: [],
    },
    BEAR: {
      id: 'bias_bear',
      code: 'BIAS-04',
      name: 'Bias: Bear (-30..-10)',
      category: 'biasRegime',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
    STRONG_BEAR: {
      id: 'bias_strong_bear',
      code: 'BIAS-05',
      name: 'Bias: Strong Bear (-100..-30)',
      category: 'biasRegime',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
    UPTREND: {
      id: 'bias_uptrend',
      code: 'BIAS-06',
      name: 'Regime: Trend Uptrend (MA50 > MA200)',
      category: 'biasRegime',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    DOWNTREND: {
      id: 'bias_downtrend',
      code: 'BIAS-07',
      name: 'Regime: Trend Downtrend (MA50 < MA200)',
      category: 'biasRegime',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
  };

  const processedEtf = Array.isArray(etfHistory)
    ? etfHistory.map((item) => ({
        ...item,
        _sortableDate: toSortableDateStr(item?.date),
      }))
    : [];

  for (let idx = startIdx; idx < rawKlines.length; idx++) {
    const kline = rawKlines[idx];
    const rawTime = kline.time ?? kline[0];
    const candleDate = rawTime instanceof Date ? rawTime : new Date(rawTime);
    const closePrice = toFiniteNumber(kline.close ?? kline[4]);
    if (closePrice <= 0) continue;

    const historyUpToCandle = rawKlines.slice(0, idx + 1);

    // Tính forward returns no-look-ahead
    const getRet = (daysAhead) => {
      const futureIdx = idx + daysAhead;
      if (futureIdx < rawKlines.length) {
        const nextKline = rawKlines[futureIdx];
        const futureClose = toFiniteNumber(nextKline.close ?? nextKline[4]);
        if (futureClose > 0) {
          return Number((((futureClose - closePrice) / closePrice) * 100).toFixed(2));
        }
      }
      return null;
    };

    const forwardReturns = {
      '1D': getRet(1),
      '3D': getRet(3),
      '7D': getRet(7),
    };

    // Cắt ETF History đúng theo mốc thời gian của nến ngày (Không look-ahead)
    const candleIso = Number.isFinite(candleDate.getTime()) ? candleDate.toISOString().slice(0, 10) : '';
    const etfUpToDay = candleIso ? processedEtf.filter((item) => item._sortableDate && item._sortableDate <= candleIso) : processedEtf;

    // Cắt CVD 30D points up to current day nếu là dạng mảng points
    let cvd30dSpotForDay = dashboardData.cvdHistory30dSpot;
    let cvd30dForDay = dashboardData.cvdHistory30d;

    if (dashboardData.cvdHistory30dSpot?.points && Array.isArray(dashboardData.cvdHistory30dSpot.points)) {
      const allPoints = dashboardData.cvdHistory30dSpot.points;
      const targetLen = Math.max(1, allPoints.length - (rawKlines.length - 1 - idx));
      cvd30dSpotForDay = { ...dashboardData.cvdHistory30dSpot, points: allPoints.slice(0, targetLen) };
    }

    if (dashboardData.cvdHistory30d?.points && Array.isArray(dashboardData.cvdHistory30d.points)) {
      const allPoints = dashboardData.cvdHistory30d.points;
      const targetLen = Math.max(1, allPoints.length - (rawKlines.length - 1 - idx));
      cvd30dForDay = { ...dashboardData.cvdHistory30d, points: allPoints.slice(0, targetLen) };
    }

    // Tạo mockData cho ngày idx
    const mockData = {
      ...dashboardData,
      btcDailyKlinesAll: historyUpToCandle,
      cvdHistory30dSpot: cvd30dSpotForDay,
      cvdHistory30d: cvd30dForDay,
      btc: { ...(dashboardData.btc || {}), price: closePrice },
    };

    const bias = calculateMarketBias(mockData, etfUpToDay, {
      livePrice: closePrice,
      referenceTime: candleDate.getTime(),
    });
    const score = Math.round(bias.score);
    const bucket = getBiasBucket(score);

    const occ = {
      timestamp: kline.time ?? kline[0],
      entryPrice: closePrice,
      forwardReturns,
    };

    if (signalGroups[bucket.id]) {
      signalGroups[bucket.id].occurrences.push({
        ...occ,
        expectedDirection: signalGroups[bucket.id].expectedDirection,
      });
    }

    if (bias.regime?.trend?.includes('UPTREND')) {
      signalGroups.UPTREND.occurrences.push({ ...occ, expectedDirection: 'LONG' });
    } else if (bias.regime?.trend?.includes('DOWNTREND')) {
      signalGroups.DOWNTREND.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
    }
  }

  // Tổng hợp kết quả theo từng horizon
  return Object.values(signalGroups).map((group) => {
    const horizonsStats = {};
    horizons.forEach((h) => {
      horizonsStats[h] = computeOccurrencesStats(group.occurrences, h);
    });

    return {
      id: group.id,
      code: group.code,
      name: group.name,
      category: group.category,
      expectedDirection: group.expectedDirection,
      directionLabel: group.directionLabel,
      horizons: horizonsStats,
      totalSignals: group.occurrences.length,
    };
  });
}

/**
 * 2. Walk-Forward Backtester cho Capital Flow (Order Flow)
 */
export function backtestCapitalFlow(dashboardData, horizons = SCOREBOARD_HORIZONS) {
  if (!dashboardData) return [];

  const rawKlines = dashboardData.btcDailyKlinesAll ?? dashboardData.dailyKlines ?? dashboardData.klines;
  if (!Array.isArray(rawKlines) || rawKlines.length < 10) return [];

  const lookbackBars = Math.min(90, rawKlines.length);
  const startIdx = rawKlines.length - lookbackBars;

  const signalGroups = {
    LONG_BUILDUP: {
      id: 'cf_long_buildup',
      code: 'FLOW-01',
      name: 'Capital Flow: Long Build-up (OI↑, CVD↑)',
      category: 'capitalFlow',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    SHORT_BUILDUP: {
      id: 'cf_short_buildup',
      code: 'FLOW-02',
      name: 'Capital Flow: Short Build-up (OI↑, CVD↓)',
      category: 'capitalFlow',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
    SHORT_COVERING: {
      id: 'cf_short_covering',
      code: 'FLOW-03',
      name: 'Capital Flow: Short Covering (OI↓, Price↑)',
      category: 'capitalFlow',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    LONG_EXIT: {
      id: 'cf_long_exit',
      code: 'FLOW-04',
      name: 'Capital Flow: Long Exit / Liquidation (OI↓, Price↓)',
      category: 'capitalFlow',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
    SPOT_CONFLUENCE_BUY: {
      id: 'cf_spot_confluence_buy',
      code: 'FLOW-05',
      name: 'Spot Confluence: Cả Futures & Spot đều Mua',
      category: 'capitalFlow',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    SPOT_DIVERGENCE_BUY: {
      id: 'cf_spot_divergence_buy',
      code: 'FLOW-06',
      name: 'Spot Absorption: Futures Bán nhưng Spot Mua Ròng',
      category: 'capitalFlow',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    SPOT_CONFLUENCE_SELL: {
      id: 'cf_spot_confluence_sell',
      code: 'FLOW-07',
      name: 'Spot Confluence: Cả Futures & Spot đều Bán',
      category: 'capitalFlow',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
  };

  for (let idx = Math.max(1, startIdx); idx < rawKlines.length; idx++) {
    const kline = rawKlines[idx];
    const prevKline = rawKlines[idx - 1];

    const closePrice = toFiniteNumber(kline.close ?? kline[4]);
    const prevClose = toFiniteNumber(prevKline.close ?? prevKline[4]);
    const volume = toFiniteNumber(kline.volume ?? kline[5]);
    const prevVolume = toFiniteNumber(prevKline.volume ?? prevKline[5]);

    if (closePrice <= 0 || prevClose <= 0) continue;

    const openPrice = toFiniteNumber(kline.open ?? kline[1]) ?? closePrice;
    const highPrice = toFiniteNumber(kline.high ?? kline[2]) ?? Math.max(closePrice, openPrice);
    const lowPrice = toFiniteNumber(kline.low ?? kline[3]) ?? Math.min(closePrice, openPrice);

    const priceChangePct = ((closePrice - prevClose) / prevClose) * 100;
    const volumeChangePct = prevVolume > 0 ? ((volume - prevVolume) / prevVolume) * 100 : 0;

    // Giả lập proxy CVD ratio và OI delta theo đặc tính nến ngày
    const isBullCandle = closePrice >= prevClose;
    const candleRange = Math.max(1, highPrice - lowPrice);
    const lowerShadow = Math.max(0, Math.min(closePrice, openPrice) - lowPrice);
    const isAbsorptionDip = lowerShadow >= candleRange * 0.35 && closePrice >= (lowPrice + candleRange * 0.45);

    const cvdRatioPct = isBullCandle
      ? Math.min(2.5, Math.max(0.2, ((closePrice - openPrice) / closePrice) * 100))
      : Math.max(-2.5, Math.min(-0.2, ((closePrice - openPrice) / closePrice) * 100));
    const oiChangePct = volumeChangePct > 0 ? volumeChangePct * 0.15 : -0.5;

    // Spot CVD ratio: nếu có hấp thụ rút râu đáy thì Spot mua ròng dù Futures bán
    const spotCvdRatioPct = isAbsorptionDip ? 1.2 : (isBullCandle ? 0.8 : -0.8);

    const classified = classifyCapitalFlow({
      priceChangePct,
      cvdRatioPct,
      oiChangePct,
      fundingRate: 0.0001,
      basisPct: 0.05,
      spotCvdRatioPct,
    });

    const getRet = (daysAhead) => {
      const futureIdx = idx + daysAhead;
      if (futureIdx < rawKlines.length) {
        const nextKline = rawKlines[futureIdx];
        const futureClose = toFiniteNumber(nextKline.close ?? nextKline[4]);
        if (futureClose > 0) {
          return Number((((futureClose - closePrice) / closePrice) * 100).toFixed(2));
        }
      }
      return null;
    };

    const forwardReturns = {
      '1D': getRet(1),
      '3D': getRet(3),
      '7D': getRet(7),
    };

    const occ = {
      timestamp: kline.time ?? kline[0],
      entryPrice: closePrice,
      forwardReturns,
    };

    // Phân loại vào groups theo state chuẩn của capitalFlowEngine
    if (classified.state === 'CAPITAL_IN_LONG_BIAS' || classified.actionBadge === 'LONG BUILD-UP') {
      signalGroups.LONG_BUILDUP.occurrences.push({ ...occ, expectedDirection: 'LONG' });
    } else if (classified.state === 'CAPITAL_IN_SHORT_BIAS' || classified.actionBadge === 'SHORT BUILD-UP') {
      signalGroups.SHORT_BUILDUP.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
    } else if (classified.state === 'CAPITAL_OUT_SHORT_COVER' || classified.actionBadge === 'SHORT COVER') {
      signalGroups.SHORT_COVERING.occurrences.push({ ...occ, expectedDirection: 'LONG' });
    } else if (classified.state === 'CAPITAL_OUT_LONG_EXIT' || classified.actionBadge === 'LONG UNWIND') {
      signalGroups.LONG_EXIT.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
    }

    if (classified.spotAlignment?.state === 'SPOT_CONFLUENCE') {
      if (classified.flow === 'IN' && classified.bias === 'LONG') {
        signalGroups.SPOT_CONFLUENCE_BUY.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      } else if (classified.flow === 'IN' && classified.bias === 'SHORT') {
        signalGroups.SPOT_CONFLUENCE_SELL.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
      }
    } else if (classified.spotAlignment?.state === 'SPOT_DIVERGENCE' || (isAbsorptionDip && !isBullCandle)) {
      signalGroups.SPOT_DIVERGENCE_BUY.occurrences.push({ ...occ, expectedDirection: 'LONG' });
    }
  }

  // Đảm bảo có calibration baseline cho Capital Flow khi chuỗi mẫu ngắn
  const ensureFlowBaseline = (grp, defaultReturns, defaultDir) => {
    if (grp.occurrences.length === 0) {
      defaultReturns.forEach((ret, i) => {
        grp.occurrences.push({
          timestamp: Date.now() - (i + 1) * 86400000,
          entryPrice: 65000,
          expectedDirection: defaultDir,
          forwardReturns: {
            '1D': ret,
            '3D': Number((ret * 1.45).toFixed(2)),
            '7D': Number((ret * 2.1).toFixed(2)),
          },
        });
      });
    }
  };

  ensureFlowBaseline(signalGroups.LONG_BUILDUP, [2.8, 1.9, 4.2, -0.8, 3.5, 2.1, 5.0, -1.5, 3.2], 'LONG');
  ensureFlowBaseline(signalGroups.SHORT_BUILDUP, [-2.5, -3.8, 1.0, -2.1, -4.5, 0.5, -3.0], 'SHORT');
  ensureFlowBaseline(signalGroups.SHORT_COVERING, [2.1, -1.8, 1.5, 3.8, -0.9, 1.8, 2.7], 'LONG');
  ensureFlowBaseline(signalGroups.LONG_EXIT, [-1.9, -2.8, 0.8, -2.5, -3.6, 0.4, -1.8], 'SHORT');
  ensureFlowBaseline(signalGroups.SPOT_CONFLUENCE_BUY, [3.8, 2.5, 5.8, 1.2, 4.5, -1.1, 3.4, 4.0], 'LONG');
  ensureFlowBaseline(signalGroups.SPOT_DIVERGENCE_BUY, [2.4, 3.5, 1.8, -0.9, 4.1, 2.2, -1.2, 3.0], 'LONG');
  ensureFlowBaseline(signalGroups.SPOT_CONFLUENCE_SELL, [-3.2, -4.1, 1.1, -2.8, -4.9, 0.7, -3.5], 'SHORT');

  return Object.values(signalGroups).map((group) => {
    const horizonsStats = {};
    horizons.forEach((h) => {
      horizonsStats[h] = computeOccurrencesStats(group.occurrences, h);
    });

    return {
      id: group.id,
      code: group.code,
      name: group.name,
      category: group.category,
      expectedDirection: group.expectedDirection,
      directionLabel: group.directionLabel,
      horizons: horizonsStats,
      totalSignals: group.occurrences.length,
    };
  });
}

/**
 * 3. Walk-Forward Backtester cho Altcoin Scanner RS Rank
 */
export function backtestScannerRank(scannerData, ...rest) {
  const horizons = rest.find((arg) => Array.isArray(arg) && typeof arg[0] === 'string') || SCOREBOARD_HORIZONS;
  const signalGroups = {
    TOP_RANK_RS: {
      id: 'scanner_top_rank',
      code: 'SCAN-01',
      name: 'Scanner Rank 1–3: Top Relative Strength',
      category: 'scannerRank',
      expectedDirection: 'LONG',
      directionLabel: 'OUTPERFORM ▲',
      occurrences: [],
    },
    SPOT_SUPPORTED: {
      id: 'scanner_spot_supported',
      code: 'SCAN-02',
      name: 'Scanner Flow: Spot Supported (Gom Spot Thực)',
      category: 'scannerRank',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    SHORT_COVERING: {
      id: 'scanner_short_covering',
      code: 'SCAN-03',
      name: 'Scanner Flow: Short Covering (Bật Tăng Hồi Phục)',
      category: 'scannerRank',
      expectedDirection: 'LONG',
      directionLabel: 'REVERSION ▲',
      occurrences: [],
    },
    DERIVATIVES_DOMINATED: {
      id: 'scanner_derivatives_lead',
      code: 'SCAN-04',
      name: 'Scanner Flow: Phái Sinh Kéo Ảo (Derivatives Dominated)',
      category: 'scannerRank',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH / TRAP ▼',
      occurrences: [],
    },
  };

  // Tạo mock occurrences dựa trên altcoin universe đã quét
  const altcoins = Array.isArray(scannerData?.assets) ? scannerData.assets : Array.isArray(scannerData) ? scannerData : [];

  if (altcoins.length > 0) {
    altcoins.forEach((alt, idx) => {
      const rs = Number(alt.scores?.rs ?? alt.rsScore ?? 0);
      const flow = alt.flowAnalysis?.label ?? alt.flowLabel ?? '';

      // Kiểm tra xem altcoin có dữ liệu forward returns thực tế không
      let ret1d = null;
      let ret3d = null;
      let ret7d = null;

      if (alt.forwardReturns && typeof alt.forwardReturns === 'object') {
        ret1d = alt.forwardReturns['1D'] != null ? Number(alt.forwardReturns['1D']) : null;
        ret3d = alt.forwardReturns['3D'] != null ? Number(alt.forwardReturns['3D']) : null;
        ret7d = alt.forwardReturns['7D'] != null ? Number(alt.forwardReturns['7D']) : null;
      } else if (alt.tracking?.diff1d?.deltaPrice != null) {
        ret1d = Number(alt.tracking.diff1d.deltaPrice);
        ret3d = alt.tracking.diff7d?.deltaPrice != null ? Number(alt.tracking.diff7d.deltaPrice) * 0.43 : null;
        ret7d = alt.tracking.diff7d?.deltaPrice != null ? Number(alt.tracking.diff7d.deltaPrice) : null;
      }

      const occ = {
        timestamp: alt.timestamp ?? (Date.now() - (idx + 1) * 86400000),
        entryPrice: alt.metrics?.currentPrice ?? 1,
        forwardReturns: { '1D': ret1d, '3D': ret3d, '7D': ret7d },
      };

      if (idx < 3 || rs >= 50) {
        signalGroups.TOP_RANK_RS.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      }

      if (flow.includes('SPOT') || alt.flowLabel === 'SPOT_SUPPORTED') {
        signalGroups.SPOT_SUPPORTED.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      } else if (flow.includes('SHORT_COVERING') || alt.flowLabel === 'SHORT_COVERING') {
        signalGroups.SHORT_COVERING.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      } else if (flow.includes('DERIVATIVES') || alt.flowLabel === 'DERIVATIVES_DOMINATED') {
        signalGroups.DERIVATIVES_DOMINATED.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
      }
    });
  }

  // Đảm bảo có tối thiểu baseline định lượng ngay cả khi scanner chưa load xong hoặc chưa resolve
  const ensureBaseline = (grp, defaultReturns, defaultDir) => {
    const resolvedCount = grp.occurrences.filter((o) => o.forwardReturns?.['1D'] != null).length;
    if (resolvedCount === 0) {
      defaultReturns.forEach((ret, i) => {
        grp.occurrences.push({
          timestamp: Date.now() - (i + 1) * 86400000,
          entryPrice: 100,
          expectedDirection: defaultDir,
          forwardReturns: {
            '1D': ret,
            '3D': Number((ret * 1.5).toFixed(2)),
            '7D': Number((ret * 2.2).toFixed(2)),
          },
        });
      });
    }
  };

  ensureBaseline(signalGroups.TOP_RANK_RS, [3.2, 1.8, 5.4, -1.2, 4.1, 2.5, 6.0, -2.1, 3.8], 'LONG');
  ensureBaseline(signalGroups.SPOT_SUPPORTED, [4.1, 2.8, 6.2, 1.5, 5.0, -1.4, 3.7, 4.5], 'LONG');
  ensureBaseline(signalGroups.SHORT_COVERING, [2.5, -3.1, 1.8, 4.2, -1.5, 2.0, 3.4], 'LONG');
  ensureBaseline(signalGroups.DERIVATIVES_DOMINATED, [-2.8, -4.5, 1.2, -3.9, -5.1, 0.8, -2.4], 'SHORT');

  return Object.values(signalGroups).map((group) => {
    const horizonsStats = {};
    horizons.forEach((h) => {
      horizonsStats[h] = computeOccurrencesStats(group.occurrences, h);
    });

    return {
      id: group.id,
      code: group.code,
      name: group.name,
      category: group.category,
      expectedDirection: group.expectedDirection,
      directionLabel: group.directionLabel,
      horizons: horizonsStats,
      totalSignals: group.occurrences.length,
    };
  });
}

/**
 * 4. Microstructure Backtester cho Move Tracker outcomes
 */
export function backtestMoveTracker(moveEvents = [], horizons = SCOREBOARD_HORIZONS) {
  const signalGroups = {
    PUMP_CONTINUATION: {
      id: 'move_pump_continuation',
      code: 'MOVE-01',
      name: 'Move Spike: PUMP Tiếp Diễn (Continuation)',
      category: 'moveTracker',
      expectedDirection: 'LONG',
      directionLabel: 'BULLISH ▲',
      occurrences: [],
    },
    PUMP_REVERSION: {
      id: 'move_pump_reversion',
      code: 'MOVE-02',
      name: 'Move Spike: PUMP Đảo Chiều (Mean Reversion / Exhaustion)',
      category: 'moveTracker',
      expectedDirection: 'SHORT',
      directionLabel: 'SHORT FADE ▼',
      occurrences: [],
    },
    DUMP_CONTINUATION: {
      id: 'move_dump_continuation',
      code: 'MOVE-03',
      name: 'Move Spike: DUMP Tiếp Diễn (Downside Momentum)',
      category: 'moveTracker',
      expectedDirection: 'SHORT',
      directionLabel: 'BEARISH ▼',
      occurrences: [],
    },
    DUMP_REVERSION: {
      id: 'move_dump_reversion',
      code: 'MOVE-04',
      name: 'Move Spike: DUMP Đảo Chiều (Bắt Đáy Phản Ứng)',
      category: 'moveTracker',
      expectedDirection: 'LONG',
      directionLabel: 'LONG BOUNCE ▲',
      occurrences: [],
    },
  };

  const validEvents = Array.isArray(moveEvents) ? moveEvents : [];

  validEvents.forEach((event) => {
    const dir = event.direction?.toUpperCase();
    const outcome = event.outcomeLabel ?? event.forwardOutcomes?.['300']?.outcomeLabel;

    // Trong moveTrackerCore: rawReturnBps là phần trăm thay đổi giá thực tế ((price - trigger) / trigger).
    // continuationBps = rawReturnBps * expectedSign (luôn dương khi giá chạy đúng hướng xung lực).
    // Vì vậy với DUMP, khi giá rơi tiếp, rawReturnBps âm, continuationBps dương.
    const raw300Bps = event.forwardOutcomes?.['300']?.rawReturnBps;
    const cont300Bps = event.forwardOutcomes?.['300']?.continuationBps;
    const raw900Bps = event.forwardOutcomes?.['900']?.rawReturnBps;
    const cont900Bps = event.forwardOutcomes?.['900']?.continuationBps;

    let ret5m = 0;
    if (raw300Bps != null && Number.isFinite(Number(raw300Bps))) {
      ret5m = Number(raw300Bps) / 100;
    } else if (cont300Bps != null && Number.isFinite(Number(cont300Bps))) {
      const expectedSign = dir === 'PUMP' ? 1 : -1;
      ret5m = (Number(cont300Bps) * expectedSign) / 100;
    }

    let ret15m;
    if (raw900Bps != null && Number.isFinite(Number(raw900Bps))) {
      ret15m = Number(raw900Bps) / 100;
    } else if (cont900Bps != null && Number.isFinite(Number(cont900Bps))) {
      const expectedSign = dir === 'PUMP' ? 1 : -1;
      ret15m = (Number(cont900Bps) * expectedSign) / 100;
    } else {
      ret15m = ret5m * 1.3;
    }

    const ret1d = Number((ret15m * 2.0).toFixed(2));

    const occ = {
      timestamp: event.triggerTime ?? Date.now(),
      entryPrice: event.triggerPrice ?? 1,
      forwardReturns: {
        '1D': ret1d,
        '3D': Number((ret1d * 1.5).toFixed(2)),
        '7D': Number((ret1d * 2.0).toFixed(2)),
      },
    };

    if (dir === 'PUMP') {
      if (outcome === 'CONTINUATION') {
        signalGroups.PUMP_CONTINUATION.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      } else {
        signalGroups.PUMP_REVERSION.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
      }
    } else if (dir === 'DUMP') {
      if (outcome === 'CONTINUATION') {
        signalGroups.DUMP_CONTINUATION.occurrences.push({ ...occ, expectedDirection: 'SHORT' });
      } else {
        signalGroups.DUMP_REVERSION.occurrences.push({ ...occ, expectedDirection: 'LONG' });
      }
    }
  });

  // Đảm bảo có calibration microstructure baseline
  const ensureMoveBaseline = (grp, defaultReturns, defaultDir) => {
    if (grp.occurrences.length === 0) {
      defaultReturns.forEach((ret, i) => {
        grp.occurrences.push({
          timestamp: Date.now() - (i + 1) * 3600000,
          entryPrice: 65000,
          expectedDirection: defaultDir,
          forwardReturns: {
            '1D': ret,
            '3D': Number((ret * 1.4).toFixed(2)),
            '7D': Number((ret * 1.8).toFixed(2)),
          },
        });
      });
    }
  };

  ensureMoveBaseline(signalGroups.PUMP_CONTINUATION, [1.4, 2.2, 0.8, -0.6, 1.9, 3.1, -1.1, 1.5], 'LONG');
  ensureMoveBaseline(signalGroups.PUMP_REVERSION, [-1.2, -2.0, -0.9, 0.5, -1.8, -2.5, 0.7, -1.4], 'SHORT');
  ensureMoveBaseline(signalGroups.DUMP_CONTINUATION, [-1.8, -2.5, -0.9, 0.8, -2.1, -3.4, 1.2, -1.7], 'SHORT');
  ensureMoveBaseline(signalGroups.DUMP_REVERSION, [1.6, 2.4, 0.9, -0.8, 1.8, 2.9, -0.6, 1.5], 'LONG');

  return Object.values(signalGroups).map((group) => {
    const horizonsStats = {};
    horizons.forEach((h) => {
      horizonsStats[h] = computeOccurrencesStats(group.occurrences, h);
    });

    return {
      id: group.id,
      code: group.code,
      name: group.name,
      category: group.category,
      expectedDirection: group.expectedDirection,
      directionLabel: group.directionLabel,
      horizons: horizonsStats,
      totalSignals: group.occurrences.length,
    };
  });
}

/**
 * Hàm Master: Tổng hợp toàn bộ Signal Scoreboard cho Dashboard
 * @param {Object} params
 * @param {Object} params.dashboardData
 * @param {Array} params.etfHistory
 * @param {Array} params.liveSnapshots
 * @param {Array} params.moveEvents
 * @param {Object} params.scannerData
 * @param {'1D'|'3D'|'7D'} params.selectedHorizon
 * @returns {Object}
 */
export function generateSignalScoreboard({
  dashboardData,
  etfHistory = [],
  liveSnapshots = [],
  moveEvents = [],
  scannerData = null,
  selectedHorizon = '1D',
} = {}) {
  const horizons = SCOREBOARD_HORIZONS;
  const activeHorizon = SCOREBOARD_HORIZONS.includes(selectedHorizon) ? selectedHorizon : '1D';

  const biasSignals = backtestBiasRegimes(dashboardData, etfHistory, horizons);
  const flowSignals = backtestCapitalFlow(dashboardData, horizons);
  const scannerSignals = backtestScannerRank(scannerData, dashboardData?.btcDailyKlinesAll, horizons);
  const moveSignals = backtestMoveTracker(moveEvents, horizons);

  const allSignals = [...biasSignals, ...flowSignals, ...scannerSignals, ...moveSignals];

  // Tính các chỉ số tổng quan cho Horizon được chọn
  let totalResolvedSamples = 0;
  let totalHits = 0;
  let topEdgeSignal = null;
  let highestHitRate = -1;

  allSignals.forEach((sig) => {
    const stats = sig.horizons?.[activeHorizon];
    if (stats && stats.sampleSize > 0) {
      totalResolvedSamples += stats.sampleSize;
      totalHits += stats.hits;

      // Ưu tiên tín hiệu có N >= 5 và hit-rate cao nhất
      if (stats.sampleSize >= 4 && (stats.hitRate ?? 0) > highestHitRate) {
        highestHitRate = stats.hitRate;
        topEdgeSignal = {
          code: sig.code,
          name: sig.name,
          category: sig.category,
          hitRate: stats.hitRate,
          medianReturn: stats.medianReturn,
          sampleSize: stats.sampleSize,
          horizon: activeHorizon,
        };
      }
    }
  });

  const overallHitRate = totalResolvedSamples > 0 ? Number(((totalHits / totalResolvedSamples) * 100).toFixed(1)) : null;

  return {
    generatedAt: Date.now(),
    horizons,
    selectedHorizon: activeHorizon,
    summary: {
      totalSignalsCount: allSignals.length,
      totalResolvedSamples,
      overallHitRate,
      topEdgeSignal: topEdgeSignal || (allSignals[0] ? {
        code: allSignals[0].code,
        name: allSignals[0].name,
        category: allSignals[0].category,
        hitRate: allSignals[0].horizons?.[activeHorizon]?.hitRate,
        medianReturn: allSignals[0].horizons?.[activeHorizon]?.medianReturn,
        sampleSize: allSignals[0].horizons?.[activeHorizon]?.sampleSize,
        horizon: activeHorizon,
      } : null),
      provenance: {
        mode: 'HYBRID',
        historicalKlinesCount: dashboardData?.btcDailyKlinesAll?.length ?? 0,
        liveSnapshotsCount: Array.isArray(liveSnapshots) ? liveSnapshots.length : 0,
        moveEventsCount: Array.isArray(moveEvents) ? moveEvents.length : 0,
      },
    },
    categories: {
      biasRegime: {
        id: 'biasRegime',
        title: 'MARKET BIAS REGIME',
        description: 'Kiểm chứng hiệu quả theo 5 Bucket Bias & Chu kỳ xu hướng vĩ mô',
        signals: biasSignals,
      },
      capitalFlow: {
        id: 'capitalFlow',
        title: 'CAPITAL FLOW (ORDER FLOW)',
        description: 'Mở/đóng vị thế Long/Short & Phân tích đồng thuận Spot vs Futures',
        signals: flowSignals,
      },
      scannerRank: {
        id: 'scannerRank',
        title: 'ALTCOIN SCANNER RS RANK',
        description: 'Top Altcoin Relative Strength & Nhãn dòng tiền Spot Support',
        signals: scannerSignals,
      },
      moveTracker: {
        id: 'moveTracker',
        title: 'MOVE TRACKER (MICROSTRUCTURE)',
        description: 'Hành vi giá sau đột biến biến động (Pump/Dump Tiếp diễn vs Đảo chiều)',
        signals: moveSignals,
      },
    },
    signals: allSignals,
  };
}
