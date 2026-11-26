/**
 * Scanner v9 Pure Mathematical & Analytical Core
 * Strictly deterministic, zero look-ahead, comprehensive edge-case handling.
 */

export const MODEL_VERSION = 'v1.1.0';
export const SCHEMA_VERSION = 'v9.0.0';

export const PILLAR_WEIGHTS = {
  rs: 0.40,
  flow: 0.25,
  fundamentals: 0.25,
  liquidity: 0.10,
};

export const FLOW_SUBWEIGHTS = {
  spotPressure: 0.70,
  derivativesConfirmation: 0.30,
};

export const FUNDAMENTALS_SUBWEIGHTS = {
  quantSector: 0.60,
  qualitativeRubric: 0.40,
};

export const LIQUIDITY_SUBWEIGHTS = {
  windowVolume: 0.50,
  volumeStability: 0.50,
};

export const MIN_SECTOR_PEERS = 5;
export const MAX_DAILY_FUNDING_RATE = 0.0003; // 0.03%

export const FLOW_LABELS = {
  SPOT_SUPPORTED: 'SPOT_SUPPORTED',
  DERIVATIVES_DOMINATED: 'DERIVATIVES_DOMINATED',
  SHORT_COVERING: 'SHORT_COVERING',
  MIXED_OR_INSUFFICIENT: 'MIXED_OR_INSUFFICIENT',
};

export const FLOW_LABEL_TEXTS = {
  SPOT_SUPPORTED: 'Spot hỗ trợ',
  DERIVATIVES_DOMINATED: 'Phái sinh chi phối',
  SHORT_COVERING: 'Có dấu hiệu short covering',
  MIXED_OR_INSUFFICIENT: 'Hỗn hợp/chưa đủ dữ liệu',
};

/**
 * Calculate Relative Strength vs a benchmark over a window:
 * RS = 100 * [ (P_alt,t / P_b,t) / (P_alt,t-H / P_b,t-H) - 1 ]
 */
export function calculateRelativeStrength(altCloseCurrent, altClosePrior, btcCloseCurrent, btcClosePrior) {
  const pAltCurrent = Number(altCloseCurrent);
  const pAltPrior = Number(altClosePrior);
  const pBtcCurrent = Number(btcCloseCurrent);
  const pBtcPrior = Number(btcClosePrior);

  if (
    !Number.isFinite(pAltCurrent) || pAltCurrent <= 0 ||
    !Number.isFinite(pAltPrior) || pAltPrior <= 0 ||
    !Number.isFinite(pBtcCurrent) || pBtcCurrent <= 0 ||
    !Number.isFinite(pBtcPrior) || pBtcPrior <= 0
  ) {
    return {
      value: null,
      reason: 'missing_price_data',
    };
  }

  const crossCurrent = pAltCurrent / pBtcCurrent;
  const crossPrior = pAltPrior / pBtcPrior;

  if (!Number.isFinite(crossPrior) || crossPrior <= 0) {
    return {
      value: null,
      reason: 'invalid_cross_rate',
    };
  }

  const rs = 100 * ((crossCurrent / crossPrior) - 1);
  return {
    value: rs,
    reason: 'valid',
  };
}

/**
 * Calculate Spot or Futures CVD and Normalized Flow Pressure from klines.
 * CVD = Sum(2 * takerBuyQuoteVolume - quoteVolume)
 * FlowPressure = CVD / totalQuoteVolume
 */
export function calculateCvdAndFlowPressure(klines) {
  if (!Array.isArray(klines) || klines.length === 0) {
    return {
      totalQuoteVolume: 0,
      takerBuyQuoteVolume: 0,
      takerSellQuoteVolume: 0,
      cvd: 0,
      flowPressure: 0,
      count: 0,
      isValid: false,
    };
  }

  let totalQuoteVolume = 0;
  let takerBuyQuoteVolume = 0;

  for (const k of klines) {
    // kline format: [openTime, open, high, low, close, volume, closeTime, quoteVolume, count, takerBuyBase, takerBuyQuote, ignore]
    const quoteVol = Number(k[7]);
    const takerBuyQuote = Number(k[10]);

    if (Number.isFinite(quoteVol) && quoteVol > 0) {
      totalQuoteVolume += quoteVol;
      if (Number.isFinite(takerBuyQuote) && takerBuyQuote >= 0) {
        takerBuyQuoteVolume += takerBuyQuote;
      }
    }
  }

  const takerSellQuoteVolume = Math.max(0, totalQuoteVolume - takerBuyQuoteVolume);
  // CVD = takerBuyQuote - takerSellQuote = takerBuyQuote - (totalQuote - takerBuyQuote) = 2 * takerBuyQuote - totalQuote
  const cvd = 2 * takerBuyQuoteVolume - totalQuoteVolume;
  const flowPressure = totalQuoteVolume > 0 ? cvd / totalQuoteVolume : 0;

  return {
    totalQuoteVolume,
    takerBuyQuoteVolume,
    takerSellQuoteVolume,
    cvd,
    flowPressure,
    count: klines.length,
    isValid: totalQuoteVolume > 0,
  };
}

/**
 * Calculate Open Interest metrics between start and end of window.
 */
export function calculateOiMetrics(startOiRecord, endOiRecord) {
  if (!startOiRecord || !endOiRecord) {
    return {
      startOiBase: null,
      endOiBase: null,
      deltaOiBase: null,
      deltaOiBasePct: null,
      startOiUsd: null,
      endOiUsd: null,
      deltaOiUsd: null,
      deltaOiUsdPct: null,
      reason: 'missing_oi_endpoints',
      isValid: false,
    };
  }

  const startBase = Number(startOiRecord.sumOpenInterest || startOiRecord.openInterest);
  const endBase = Number(endOiRecord.sumOpenInterest || endOiRecord.openInterest);
  const startUsd = Number(startOiRecord.sumOpenInterestValue || startOiRecord.openInterestUsd);
  const endUsd = Number(endOiRecord.sumOpenInterestValue || endOiRecord.openInterestUsd);

  const hasBase = Number.isFinite(startBase) && Number.isFinite(endBase) && startBase > 0;
  const hasUsd = Number.isFinite(startUsd) && Number.isFinite(endUsd) && startUsd > 0;

  if (!hasBase && !hasUsd) {
    return {
      startOiBase: null,
      endOiBase: null,
      deltaOiBase: null,
      deltaOiBasePct: null,
      startOiUsd: null,
      endOiUsd: null,
      deltaOiUsd: null,
      deltaOiUsdPct: null,
      reason: 'invalid_oi_numbers',
      isValid: false,
    };
  }

  const deltaOiBase = hasBase ? (endBase - startBase) : null;
  const deltaOiBasePct = hasBase ? 100 * ((endBase - startBase) / startBase) : null;
  const deltaOiUsd = hasUsd ? (endUsd - startUsd) : null;
  const deltaOiUsdPct = hasUsd ? 100 * ((endUsd - startUsd) / startUsd) : null;

  return {
    startOiBase: hasBase ? startBase : null,
    endOiBase: hasBase ? endBase : null,
    deltaOiBase,
    deltaOiBasePct,
    startOiUsd: hasUsd ? startUsd : null,
    endOiUsd: hasUsd ? endUsd : null,
    deltaOiUsd,
    deltaOiUsdPct,
    reason: 'valid',
    isValid: true,
  };
}

/**
 * Calculate Funding Rate sum and daily average in window.
 * Does not assume 3 settlements per day.
 */
export function calculateFundingMetrics(fundingRecords, windowDays = 7) {
  if (!Array.isArray(fundingRecords) || fundingRecords.length === 0) {
    return {
      fundingSum: null,
      fundingAvgDaily: null,
      settlementCount: 0,
      reason: 'no_funding_history',
      isValid: false,
    };
  }

  let sum = 0;
  let validCount = 0;

  for (const item of fundingRecords) {
    const rate = Number(item.fundingRate);
    if (Number.isFinite(rate)) {
      sum += rate;
      validCount += 1;
    }
  }

  if (validCount === 0 || windowDays <= 0) {
    return {
      fundingSum: null,
      fundingAvgDaily: null,
      settlementCount: 0,
      reason: 'invalid_funding_rates',
      isValid: false,
    };
  }

  const fundingAvgDaily = sum / windowDays;

  return {
    fundingSum: sum,
    fundingAvgDaily,
    settlementCount: validCount,
    reason: 'valid',
    isValid: true,
  };
}

/**
 * Classify Flow Interpretation Label based on observable rule-based deduction:
 * - SPOT_SUPPORTED: Price Up AND Spot CVD > 0
 * - DERIVATIVES_DOMINATED: Price Up, Futures CVD > 0, OI Change Base > 0, Spot CVD <= 0 (or not positive)
 * - SHORT_COVERING: Price Up, OI Change Base < 0, Futures CVD > 0
 * - MIXED_OR_INSUFFICIENT: Other cases or insufficient data
 */
export function classifyFlowInterpretation({ priceChangePct, spotCvd, futuresCvd, deltaOiBase }) {
  const hasPrice = Number.isFinite(Number(priceChangePct));
  const pDelta = Number(priceChangePct);

  if (!hasPrice) {
    return {
      label: FLOW_LABELS.MIXED_OR_INSUFFICIENT,
      text: FLOW_LABEL_TEXTS.MIXED_OR_INSUFFICIENT,
      reason: 'missing_price_change',
    };
  }

  const sCvd = Number.isFinite(Number(spotCvd)) ? Number(spotCvd) : null;
  const fCvd = Number.isFinite(Number(futuresCvd)) ? Number(futuresCvd) : null;
  const oiDelta = Number.isFinite(Number(deltaOiBase)) ? Number(deltaOiBase) : null;

  // Rule 1: Spot supported (Price Up & Spot CVD > 0)
  if (pDelta > 0 && sCvd !== null && sCvd > 0) {
    return {
      label: FLOW_LABELS.SPOT_SUPPORTED,
      text: FLOW_LABEL_TEXTS.SPOT_SUPPORTED,
      reason: 'price_up_spot_cvd_positive',
    };
  }

  // Rule 3: Short covering (Price Up, OI base contracted, Futures CVD > 0)
  if (pDelta > 0 && oiDelta !== null && oiDelta < 0 && fCvd !== null && fCvd > 0) {
    return {
      label: FLOW_LABELS.SHORT_COVERING,
      text: FLOW_LABEL_TEXTS.SHORT_COVERING,
      reason: 'price_up_oi_contracted_futures_cvd_positive',
    };
  }

  // Rule 2: Derivatives dominated (Price Up, Futures CVD > 0, OI base expanded, Spot CVD <= 0 or missing)
  if (pDelta > 0 && fCvd !== null && fCvd > 0 && oiDelta !== null && oiDelta > 0 && (sCvd === null || sCvd <= 0)) {
    return {
      label: FLOW_LABELS.DERIVATIVES_DOMINATED,
      text: FLOW_LABEL_TEXTS.DERIVATIVES_DOMINATED,
      reason: 'price_up_futures_cvd_oi_expanded_spot_not_positive',
    };
  }

  return {
    label: FLOW_LABELS.MIXED_OR_INSUFFICIENT,
    text: FLOW_LABEL_TEXTS.MIXED_OR_INSUFFICIENT,
    reason: 'mixed_or_falling_price',
  };
}

/**
 * Calculate Volume Stability: Inverse of 30-day Volume Coefficient of Variation
 * CV = stdDev(vol30d) / mean(vol30d)
 * Stability = 1 / max(CV, 0.0001)
 */
export function calculateVolumeStability(dailyQuoteVolumes30d) {
  if (!Array.isArray(dailyQuoteVolumes30d) || dailyQuoteVolumes30d.length === 0) {
    return {
      cv: null,
      stability: null,
      isValid: false,
    };
  }

  const validVolumes = dailyQuoteVolumes30d
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0);

  if (validVolumes.length < 5) {
    return {
      cv: null,
      stability: null,
      isValid: false,
    };
  }

  const n = validVolumes.length;
  const mean = validVolumes.reduce((a, b) => a + b, 0) / n;

  if (mean <= 0) {
    return {
      cv: null,
      stability: null,
      isValid: false,
    };
  }

  const variance = validVolumes.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;
  const stability = 1 / Math.max(cv, 0.0001);

  return {
    cv,
    stability,
    meanVolume: mean,
    stdDevVolume: stdDev,
    isValid: true,
  };
}

/**
 * Calculate percentiles with midrank for ties:
 * For array of numbers, filters out nulls.
 * For each value x: S = count(< x), E = count(== x), N = total valid.
 * Percentile = 100 * (S + 0.5 * E) / N.
 * If all values equal, returns 50.
 * Null values receive null percentile.
 */
export function calculatePercentilesMidrank(values) {
  if (!Array.isArray(values) || values.length === 0) return [];

  const indexed = values.map((val, idx) => ({
    val: (val !== null && val !== undefined && Number.isFinite(Number(val))) ? Number(val) : null,
    originalIdx: idx,
  }));

  const valid = indexed.filter(item => item.val !== null);
  const result = new Array(values.length).fill(null);

  if (valid.length === 0) return result;

  const N = valid.length;
  // Sort ascending
  valid.sort((a, b) => a.val - b.val);

  for (let i = 0; i < N; i += 1) {
    const currentVal = valid[i].val;
    // Count S (strictly smaller) and E (equal)
    let S = 0;
    let E = 0;
    for (let j = 0; j < N; j += 1) {
      if (valid[j].val < currentVal) {
        S += 1;
      } else if (valid[j].val === currentVal) {
        E += 1;
      }
    }

    const percentile = 100 * ((S + 0.5 * E) / N);
    result[valid[i].originalIdx] = percentile;
  }

  return result;
}

function isValidNumeric(val) {
  return val !== null && val !== undefined && val !== '' && Number.isFinite(Number(val));
}

/**
 * Calculate Derivatives Confirmation Score (0 - 100):
 * 4 conditions (25 points each):
 * 1. Spot CVD > 0
 * 2. Futures CVD > 0
 * 3. Price Up and OI Base Up
 * 4. Funding daily average |funding| <= 0.0003 (0.03%)
 *
 * If hasFutures is true, futures CVD, delta OI base, and fundingAvgDaily are strictly required.
 * Missing any required futures component invalidates derivatives confirmation and blocks flow pillar.
 */
export function calculateDerivativesConfirmationScore({ spotCvd, futuresCvd, priceChangePct, deltaOiBase, fundingAvgDaily, hasFutures }) {
  const hasValidSpotCvd = isValidNumeric(spotCvd);
  const hasValidFuturesCvd = isValidNumeric(futuresCvd);
  const hasValidPriceChange = isValidNumeric(priceChangePct);
  const hasValidDeltaOiBase = isValidNumeric(deltaOiBase);
  const hasValidFunding = isValidNumeric(fundingAvgDaily);

  // If futures status is unknown (API geo-blocked or fetch failed), never treat as Spot Only
  if (hasFutures === null) {
    return {
      score: null,
      isValid: false,
      reason: 'futures_fetch_error',
      missingComponents: ['futures_api'],
      conditions: {
        spotCvdPositive: false,
        futuresCvdPositive: false,
        priceAndOiExpanding: false,
        fundingWithinThreshold: false,
      },
    };
  }

  // If asset has futures, missing any required futures component fails validation
  if (hasFutures) {
    if (!hasValidFuturesCvd || !hasValidDeltaOiBase || !hasValidFunding) {
      return {
        score: null,
        isValid: false,
        reason: 'missing_derivatives_data',
        missingComponents: [
          !hasValidFuturesCvd && 'futures_cvd',
          !hasValidDeltaOiBase && 'delta_oi_base',
          !hasValidFunding && 'funding_avg_daily',
        ].filter(Boolean),
        conditions: {
          spotCvdPositive: false,
          futuresCvdPositive: false,
          priceAndOiExpanding: false,
          fundingWithinThreshold: false,
        },
      };
    }
  }

  const c1 = hasValidSpotCvd && Number(spotCvd) > 0;
  const c2 = Boolean(hasFutures && hasValidFuturesCvd && Number(futuresCvd) > 0);
  const c3 = Boolean(hasFutures && hasValidPriceChange && Number(priceChangePct) > 0 && hasValidDeltaOiBase && Number(deltaOiBase) > 0);
  const c4 = Boolean(hasFutures && hasValidFunding && Math.abs(Number(fundingAvgDaily)) <= MAX_DAILY_FUNDING_RATE);

  const score = (c1 ? 25 : 0) + (c2 ? 25 : 0) + (c3 ? 25 : 0) + (c4 ? 25 : 0);

  return {
    score,
    isValid: true,
    reason: 'valid',
    conditions: {
      spotCvdPositive: c1,
      futuresCvdPositive: c2,
      priceAndOiExpanding: c3,
      fundingWithinThreshold: c4,
    },
  };
}

/**
 * Calculate Quantitative Sector Scores for all assets in universe for a specific window.
 * Supports single-metric or dual-metric growth; falls back from sector (>=5, then >=3)
 * to universe-wide peer comparison (>=5) when a sector has too few valid peers.
 */
export function calculateQuantitativeSectorScores(assets, windowKey = '7d') {
  if (!Array.isArray(assets) || assets.length === 0) return new Map();

  const getMetricGrowths = (asset) => {
    const g1Raw = asset.windows?.[windowKey]?.fundamentals?.metric1Growth;
    const g2Raw = asset.windows?.[windowKey]?.fundamentals?.metric2Growth;
    const g1 = (g1Raw !== null && g1Raw !== undefined && Number.isFinite(Number(g1Raw))) ? Number(g1Raw) : null;
    const g2 = (g2Raw !== null && g2Raw !== undefined && Number.isFinite(Number(g2Raw))) ? Number(g2Raw) : null;
    return { g1, g2, hasAny: g1 !== null || g2 !== null };
  };

  const scorePeerGroup = (peers, peerScope, reason) => {
    const g1Values = peers.map(p => p.g1);
    const g2Values = peers.map(p => p.g2);
    const p1s = calculatePercentilesMidrank(g1Values);
    const p2s = calculatePercentilesMidrank(g2Values);
    const groupMap = new Map();

    for (let i = 0; i < peers.length; i += 1) {
      const p1 = p1s[i];
      const p2 = p2s[i];
      let score = null;
      let metricCoverage = 'none';
      if (p1 !== null && p2 !== null) {
        score = (p1 + p2) / 2;
        metricCoverage = 'both';
      } else if (p1 !== null) {
        score = p1;
        metricCoverage = 'single_m1';
      } else if (p2 !== null) {
        score = p2;
        metricCoverage = 'single_m2';
      }
      groupMap.set(peers[i].asset.symbol, {
        score,
        peerCount: peers.length,
        peerScope,
        metricCoverage,
        reason,
        p1,
        p2,
      });
    }
    return groupMap;
  };

  // Precompute universe-wide valid peers for fallback
  const allValidPeers = [];
  const sectorGroups = new Map();

  for (const asset of assets) {
    const sector = asset.sector || 'Other';
    if (!sectorGroups.has(sector)) {
      sectorGroups.set(sector, []);
    }
    const growths = getMetricGrowths(asset);
    sectorGroups.get(sector).push({ asset, ...growths });
    if (growths.hasAny) {
      allValidPeers.push({ asset, ...growths });
    }
  }

  const universeScores = allValidPeers.length >= MIN_SECTOR_PEERS
    ? scorePeerGroup(allValidPeers, 'universe_fallback', 'valid_universe_fallback')
    : new Map();

  const results = new Map(); // symbol -> { score, reason, peerCount, peerScope }

  for (const [, group] of sectorGroups.entries()) {
    const validPeers = group.filter(p => p.hasAny);
    const peerCount = validPeers.length;

    if (peerCount >= MIN_SECTOR_PEERS) {
      const sectorMap = scorePeerGroup(validPeers, 'sector', 'valid');
      for (const [sym, val] of sectorMap.entries()) {
        results.set(sym, val);
      }
    } else if (peerCount >= 3) {
      const sectorMap = scorePeerGroup(validPeers, 'sector_small', 'valid_small_sector');
      for (const [sym, val] of sectorMap.entries()) {
        results.set(sym, val);
      }
    } else if (universeScores.size > 0) {
      for (const item of validPeers) {
        const fallbackScore = universeScores.get(item.asset.symbol);
        if (fallbackScore) {
          results.set(item.asset.symbol, fallbackScore);
        }
      }
    }

    for (const item of group) {
      if (!results.has(item.asset.symbol)) {
        results.set(item.asset.symbol, {
          score: null,
          peerCount,
          peerScope: 'none',
          reason: item.hasAny ? `insufficient_sector_peers_min_${MIN_SECTOR_PEERS}` : 'missing_growth_data',
        });
      }
    }
  }

  return results;
}

/**
 * Score all assets in universe for a specific window.
 * Computes 4 pillars, checks completeness, assigns total scores and ranks.
 */
export function scoreUniverseForWindow(assets, windowKey = '7d', quantSectorScoresMap = new Map()) {
  if (!Array.isArray(assets) || assets.length === 0) return [];

  // Extract raw arrays for percentile calculations across the daily universe
  const rsBtcValues = assets.map(a => a.windows?.[windowKey]?.metrics?.rsBtc ?? null);
  const rsEthValues = assets.map(a => a.windows?.[windowKey]?.metrics?.rsEth ?? null);
  const spotFlowPressureValues = assets.map(a => a.windows?.[windowKey]?.metrics?.spotFlowPressure ?? null);
  const windowVolumeValues = assets.map(a => a.windows?.[windowKey]?.metrics?.quoteVolume ?? null);
  const volStabilityValues = assets.map(a => a.liquidity30d?.stability ?? null);

  const pctRsBtc = calculatePercentilesMidrank(rsBtcValues);
  const pctRsEth = calculatePercentilesMidrank(rsEthValues);
  const pctSpotFlow = calculatePercentilesMidrank(spotFlowPressureValues);
  const pctWindowVol = calculatePercentilesMidrank(windowVolumeValues);
  const pctVolStability = calculatePercentilesMidrank(volStabilityValues);

  const scoredAssets = [];

  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];
    const win = asset.windows?.[windowKey] || {};
    const missingPillars = [];
    const missingReasons = [];

    // 1. RS Pillar (40%)
    const pBtc = pctRsBtc[i];
    const pEth = pctRsEth[i];
    let rsPillarScore = null;

    if (pBtc !== null && pEth !== null) {
      rsPillarScore = (pBtc + pEth) / 2;
    } else {
      missingPillars.push('rs');
      if (pBtc === null) missingReasons.push('missing_rs_btc');
      if (pEth === null) missingReasons.push('missing_rs_eth');
    }

    // 2. Flow Pillar (25%)
    const pFlow = pctSpotFlow[i];
    const derivConfirmation = calculateDerivativesConfirmationScore({
      spotCvd: win.metrics?.spotCvd,
      futuresCvd: win.metrics?.futuresCvd,
      priceChangePct: win.metrics?.priceChangePct,
      deltaOiBase: win.metrics?.deltaOiBase,
      fundingAvgDaily: win.metrics?.fundingAvgDaily,
      hasFutures: asset.hasFutures,
    });

    const degradedComponents = [];
    let flowPillarScore = null;
    let flowMode = 'none';
    if (pFlow !== null && derivConfirmation.isValid) {
      flowPillarScore = (FLOW_SUBWEIGHTS.spotPressure * pFlow) + (FLOW_SUBWEIGHTS.derivativesConfirmation * derivConfirmation.score);
      flowMode = 'full';
    } else if (pFlow !== null) {
      // Graceful fallback: rank Flow pillar on 100% Spot Flow Pressure when derivatives data is unavailable
      flowPillarScore = pFlow;
      flowMode = 'spot_fallback';
      degradedComponents.push('flow_derivatives');
      missingReasons.push(derivConfirmation.reason || 'missing_derivatives_data');
      if (Array.isArray(derivConfirmation.missingComponents)) {
        for (const compName of derivConfirmation.missingComponents) {
          missingReasons.push(`missing_${compName}`);
        }
      }
    } else {
      missingPillars.push('flow');
      missingReasons.push('missing_spot_flow_pressure');
      if (!derivConfirmation.isValid) {
        missingReasons.push(derivConfirmation.reason || 'missing_derivatives_data');
        if (Array.isArray(derivConfirmation.missingComponents)) {
          for (const compName of derivConfirmation.missingComponents) {
            missingReasons.push(`missing_${compName}`);
          }
        }
      }
    }

    // 3. Fundamentals Pillar (25%)
    const quantSectorRes = quantSectorScoresMap.get(asset.symbol);
    const quantSectorScore = quantSectorRes?.score ?? null;
    const rubricScore = asset.rubric?.rubricScore ?? null;

    let fundPillarScore = null;
    if (quantSectorScore !== null && rubricScore !== null) {
      fundPillarScore = (FUNDAMENTALS_SUBWEIGHTS.quantSector * quantSectorScore) + (FUNDAMENTALS_SUBWEIGHTS.qualitativeRubric * rubricScore);
    } else {
      missingPillars.push('fundamentals');
      if (quantSectorScore === null) {
        missingReasons.push(quantSectorRes?.reason || 'missing_quant_fundamentals');
      }
      if (rubricScore === null) {
        missingReasons.push(asset.rubric?.reason || 'missing_rubric');
      }
    }

    // 4. Liquidity Pillar (10%)
    const pVol = pctWindowVol[i];
    const pStab = pctVolStability[i];
    let liqPillarScore = null;

    if (pVol !== null && pStab !== null) {
      liqPillarScore = (LIQUIDITY_SUBWEIGHTS.windowVolume * pVol) + (LIQUIDITY_SUBWEIGHTS.volumeStability * pStab);
    } else {
      missingPillars.push('liquidity');
      if (pVol === null) missingReasons.push('missing_window_volume');
      if (pStab === null) missingReasons.push('missing_volume_stability_30d');
    }

    // Total Score (full 4-pillar or graceful re-weighted when RS + Liquidity + >=60% weight available)
    const isComplete = missingPillars.length === 0 && degradedComponents.length === 0;
    let availableWeight = 0;
    let weightedSum = 0;

    if (rsPillarScore !== null) {
      availableWeight += PILLAR_WEIGHTS.rs;
      weightedSum += PILLAR_WEIGHTS.rs * rsPillarScore;
    }
    if (flowPillarScore !== null) {
      availableWeight += PILLAR_WEIGHTS.flow;
      weightedSum += PILLAR_WEIGHTS.flow * flowPillarScore;
    }
    if (fundPillarScore !== null) {
      availableWeight += PILLAR_WEIGHTS.fundamentals;
      weightedSum += PILLAR_WEIGHTS.fundamentals * fundPillarScore;
    }
    if (liqPillarScore !== null) {
      availableWeight += PILLAR_WEIGHTS.liquidity;
      weightedSum += PILLAR_WEIGHTS.liquidity * liqPillarScore;
    }

    const coveragePct = Math.round(availableWeight * 100);
    let totalScore = null;
    let scoreType = 'insufficient';

    if (isComplete) {
      totalScore = weightedSum;
      scoreType = 'complete';
    } else if (rsPillarScore !== null && liqPillarScore !== null && availableWeight >= 0.60 - 1e-9) {
      totalScore = weightedSum / availableWeight;
      scoreType = 'partial';
    }

    scoredAssets.push({
      ...asset,
      windows: {
        ...asset.windows,
        [windowKey]: {
          ...win,
          percentiles: {
            rsBtc: pBtc,
            rsEth: pEth,
            spotFlowPressure: pFlow,
            windowVolume: pVol,
            volumeStability: pStab,
          },
          scores: {
            rsPillar: rsPillarScore,
            flowPillar: flowPillarScore,
            flowMode,
            fundPillar: fundPillarScore,
            liqPillar: liqPillarScore,
            quantSectorScore,
            quantPeerScope: quantSectorRes?.peerScope || 'none',
            rubricScore,
            derivativesConfirmationScore: derivConfirmation.score,
            derivativesConditions: derivConfirmation.conditions,
            totalScore,
            scoreType,
            coveragePct,
          },
          completeness: {
            isComplete,
            missingPillars,
            degradedComponents,
            missingReasons,
            coveragePct,
          },
          rank: null, // assigned below
        },
      },
    });
  }

  // Assign Ranks to complete assets
  const completeAssets = scoredAssets
    .filter(a => a.windows[windowKey].scores.totalScore !== null)
    .sort((a, b) => b.windows[windowKey].scores.totalScore - a.windows[windowKey].scores.totalScore);

  for (let r = 0; r < completeAssets.length; r += 1) {
    completeAssets[r].windows[windowKey].rank = r + 1;
  }

  // Incomplete assets maintain rank = null
  return scoredAssets;
}

/**
 * Calculate Summary Statistics for a scored universe in a window.
 */
export function calculateSummaryStatistics(assets, windowKey = '7d') {
  if (!Array.isArray(assets) || assets.length === 0) {
    return {
      totalAssets: 0,
      completeCount: 0,
      incompleteCount: 0,
      rsBtcPositiveRatio: 0,
      rsEthPositiveRatio: 0,
      medianRsBtc: null,
      medianRsEth: null,
      flowDistribution: {
        SPOT_SUPPORTED: 0,
        DERIVATIVES_DOMINATED: 0,
        SHORT_COVERING: 0,
        MIXED_OR_INSUFFICIENT: 0,
      },
      scoreDistribution: {
        tier80Plus: 0,
        tier60To79: 0,
        tier40To59: 0,
        tierBelow40: 0,
      },
    };
  }

  const totalAssets = assets.length;
  let completeCount = 0;
  let rankedCount = 0;
  let rsBtcPosCount = 0;
  let rsEthPosCount = 0;
  let validRsBtc = [];
  let validRsEth = [];

  const flowDist = {
    SPOT_SUPPORTED: 0,
    DERIVATIVES_DOMINATED: 0,
    SHORT_COVERING: 0,
    MIXED_OR_INSUFFICIENT: 0,
  };

  const scoreDist = {
    tier80Plus: 0,
    tier60To79: 0,
    tier40To59: 0,
    tierBelow40: 0,
  };

  for (const a of assets) {
    const win = a.windows?.[windowKey];
    if (!win) continue;

    if (win.scores?.totalScore !== null && win.scores?.totalScore !== undefined) {
      rankedCount += 1;
      if (win.completeness?.isComplete !== false) {
        completeCount += 1;
      }
      const score = win.scores.totalScore;
      if (score >= 80) scoreDist.tier80Plus += 1;
      else if (score >= 60) scoreDist.tier60To79 += 1;
      else if (score >= 40) scoreDist.tier40To59 += 1;
      else scoreDist.tierBelow40 += 1;
    }

    const rsBtc = win.metrics?.rsBtc;
    const rsEth = win.metrics?.rsEth;

    if (Number.isFinite(rsBtc)) {
      validRsBtc.push(rsBtc);
      if (rsBtc > 0) rsBtcPosCount += 1;
    }

    if (Number.isFinite(rsEth)) {
      validRsEth.push(rsEth);
      if (rsEth > 0) rsEthPosCount += 1;
    }

    const flowLabel = win.metrics?.flowLabel || FLOW_LABELS.MIXED_OR_INSUFFICIENT;
    if (flowDist[flowLabel] !== undefined) {
      flowDist[flowLabel] += 1;
    } else {
      flowDist.MIXED_OR_INSUFFICIENT += 1;
    }
  }

  const median = (arr) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  return {
    totalAssets,
    completeCount,
    rankedCount,
    incompleteCount: totalAssets - completeCount,
    rsBtcPositiveRatio: validRsBtc.length > 0 ? (rsBtcPosCount / validRsBtc.length) * 100 : 0,
    rsEthPositiveRatio: validRsEth.length > 0 ? (rsEthPosCount / validRsEth.length) * 100 : 0,
    medianRsBtc: median(validRsBtc),
    medianRsEth: median(validRsEth),
    flowDistribution: flowDist,
    scoreDistribution: scoreDist,
  };
}

/**
 * Compare current snapshot with prior snapshots to calculate deltaScore, deltaRank, and isNew.
 * Invariant: only compares snapshots with identical modelVersion.
 */
export function calculateTrackingDeltas(currentAsset, priorSnapshot1d, priorSnapshot7d, priorSnapshot30d, windowKey = '7d', currentModelVersion = MODEL_VERSION) {
  const currentWin = currentAsset?.windows?.[windowKey];
  const currentScore = currentWin?.scores?.totalScore ?? null;
  const currentRank = currentWin?.rank ?? null;

  const getPrior = (priorSnap) => {
    if (!priorSnap?.assets) return null;
    // Model version invariant check: Must use matching model version
    if (priorSnap.modelVersion && currentModelVersion && priorSnap.modelVersion !== currentModelVersion) {
      return null;
    }
    return priorSnap.assets.find(a => a.symbol === currentAsset.symbol);
  };

  const a1d = getPrior(priorSnapshot1d);
  const a7d = getPrior(priorSnapshot7d);
  const a30d = getPrior(priorSnapshot30d);

  const calcDiff = (priorAsset) => {
    if (!priorAsset) return { deltaScore: null, deltaRank: null };
    const pWin = priorAsset.windows?.[windowKey];
    const pScore = pWin?.scores?.totalScore ?? null;
    const pRank = pWin?.rank ?? null;

    const deltaScore = (currentScore !== null && pScore !== null) ? (currentScore - pScore) : null;
    // For rank, if previous rank was 10 and current is 3, improvement is +7 (pRank - currentRank)
    const deltaRank = (currentRank !== null && pRank !== null) ? (pRank - currentRank) : null;

    return { deltaScore, deltaRank };
  };

  const isNewInUniverse = priorSnapshot1d?.assets
    ? !priorSnapshot1d.assets.some(a => a.symbol === currentAsset.symbol)
    : false;

  return {
    isNewInUniverse,
    diff1d: calcDiff(a1d),
    diff7d: calcDiff(a7d),
    diff30d: calcDiff(a30d),
  };
}
