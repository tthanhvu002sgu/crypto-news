/**
 * Deterministic Report Blueprint Engine (Single Source of Truth)
 *
 * Pre-computes 6-pillar directional scores (-2..+2), confidence grades,
 * aligned Short/Medium/Long-Term Spot verdicts, unified price zones,
 * capital tranche allocations, and 2-tier reversal triggers BEFORE calling the LLM.
 *
 * Pure JS — NO React imports, NO side effects.
 */

const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const parsed = Number.parseFloat(v.replace(/[$,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const clampScore = (v) => Math.max(-2, Math.min(2, Math.round(v)));

const roundPrice = (price, step = 500) => {
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price / step) * step;
};

const fmtUsd = (val) => {
  if (!Number.isFinite(val)) return 'N/A';
  return `$${Math.round(val).toLocaleString('en-US')}`;
};

const fmtRange = (low, high) => {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 'N/A';
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  return `${fmtUsd(a)} - ${fmtUsd(b)}`;
};

const confidenceFromCount = (available, total, { hasLag = false, hasConflict = false } = {}) => {
  const ratio = total > 0 ? available / total : 0;
  if (ratio < 0.4) return { vi: 'Thấp', en: 'Low' };
  if (ratio < 0.7 || hasLag || hasConflict) return { vi: 'Trung bình', en: 'Medium' };
  return { vi: 'Cao', en: 'High' };
};

/**
 * Score Pillar 1: Macro & Liquidity (-2..+2)
 */
function scoreMacroPillar(macro = {}) {
  const realRate = toNum(macro.realRateProxy);
  const vix = toNum(macro.vix);
  const tenYear = toNum(macro.tenYearYield);
  const dxy = toNum(macro.dxy);
  const hySpread = toNum(macro.highYield);

  const inputs = [realRate, vix, tenYear, dxy, hySpread].filter((x) => x !== null);
  if (inputs.length === 0) {
    return { score: 0, confidence: { vi: 'Thấp', en: 'Low' }, regime: { vi: 'CHƯA ĐỦ DỮ LIỆU', en: 'INSUFFICIENT DATA' } };
  }

  let pts = 0;
  if (realRate !== null) {
    if (realRate >= 1.5) pts -= 1.0;
    else if (realRate > 0) pts -= 0.5;
    else if (realRate <= -1.0) pts += 1.0;
    else pts += 0.5;
  }
  if (vix !== null) {
    if (vix >= 30) pts -= 1.0;
    else if (vix >= 22) pts -= 0.5;
    else if (vix <= 15) pts += 0.5;
  }
  if (tenYear !== null) {
    if (tenYear >= 4.5) pts -= 0.5;
    else if (tenYear <= 3.5) pts += 0.5;
  }
  if (dxy !== null) {
    if (dxy >= 104) pts -= 0.5;
    else if (dxy <= 98) pts += 0.5;
  }
  if (hySpread !== null) {
    if (hySpread >= 4.5) pts -= 0.5;
    else if (hySpread <= 3.2) pts += 0.25;
  }

  const score = clampScore(pts);
  let regime = { vi: 'HỖN HỢP / CHUYỂN PHA', en: 'MIXED / TRANSITION' };
  if (score <= -2) regime = { vi: 'THẮT CHẶT / CO HẸP MẠNH', en: 'TIGHTENING / CONTRACTION' };
  else if (score === -1) regime = { vi: 'THẮT CHẶT', en: 'TIGHTENING' };
  else if (score === 1) regime = { vi: 'NỚI LỎNG NHẸ', en: 'MILD EASING' };
  else if (score >= 2) regime = { vi: 'MỞ RỘNG THANH KHOẢN', en: 'LIQUIDITY EXPANSION' };

  return {
    score,
    confidence: confidenceFromCount(inputs.length, 5),
    regime,
  };
}

/**
 * Score Pillar 2: Spot Price Structure (-2..+2)
 */
function scoreSpotPillar(spot = {}) {
  const ch7d = toNum(spot.change7d);
  const ch30d = toNum(spot.change30d);
  const ch90d = toNum(spot.change90d);
  const rangePos30d = toNum(spot.rangePos30d);
  const priceNow = toNum(spot.priceNow);
  const ma50 = toNum(spot.ma50);
  const ma200 = toNum(spot.ma200);

  const inputs = [ch7d, ch30d, ch90d, rangePos30d].filter((x) => x !== null);
  if (inputs.length === 0) {
    return { score: 0, confidence: { vi: 'Thấp', en: 'Low' } };
  }

  let pts = 0;
  if (ch7d !== null) pts += ch7d <= -8 ? -0.75 : ch7d < -2 ? -0.35 : ch7d >= 8 ? 0.75 : ch7d > 2 ? 0.35 : 0;
  if (ch30d !== null) pts += ch30d <= -15 ? -0.75 : ch30d < -5 ? -0.35 : ch30d >= 15 ? 0.75 : ch30d > 5 ? 0.35 : 0;
  if (ch90d !== null) pts += ch90d <= -15 ? -0.5 : ch90d >= 15 ? 0.5 : 0;
  if (priceNow !== null && ma200 !== null) {
    pts += priceNow < ma200 ? -0.5 : 0.5;
  } else if (priceNow !== null && ma50 !== null) {
    pts += priceNow < ma50 ? -0.25 : 0.25;
  }
  if (rangePos30d !== null) {
    if (rangePos30d <= 15) pts -= 0.25;
    else if (rangePos30d >= 85) pts += 0.25;
  }

  return {
    score: clampScore(pts),
    confidence: confidenceFromCount(inputs.length, 4),
  };
}

/**
 * Score Pillar 3: Institutional Flow — Spot ETF & CME COT (-2..+2)
 */
function scoreInstitutionalPillar(inst = {}) {
  const etfNet7d = toNum(inst.etfNetTotalM);
  const etfPosDays = toNum(inst.etfPositiveDays);
  const etfNegDays = toNum(inst.etfNegativeDays);
  const amCotIndex = toNum(inst.amCotIndex);
  const am4W = toNum(inst.am4W);

  const inputs = [etfNet7d, amCotIndex, am4W].filter((x) => x !== null);
  if (inputs.length === 0) {
    return { score: 0, confidence: { vi: 'Thấp', en: 'Low' } };
  }

  let pts = 0;
  if (etfNet7d !== null) {
    if (etfNet7d <= -800) pts -= 1.5;
    else if (etfNet7d <= -200) pts -= 1.0;
    else if (etfNet7d < 0) pts -= 0.5;
    else if (etfNet7d >= 800) pts += 1.5;
    else if (etfNet7d >= 200) pts += 1.0;
    else if (etfNet7d > 0) pts += 0.5;
  }
  if (etfPosDays !== null && etfNegDays !== null) {
    if (etfNegDays >= 5) pts -= 0.25;
    else if (etfPosDays >= 5) pts += 0.25;
  }
  if (amCotIndex !== null) {
    if (amCotIndex <= 25) pts -= 0.5;
    else if (amCotIndex >= 75) pts += 0.5;
  }
  if (am4W !== null) {
    if (am4W < -300) pts -= 0.25;
    else if (am4W > 300) pts += 0.25;
  }

  return {
    score: clampScore(pts),
    confidence: confidenceFromCount(inputs.length, 3),
  };
}

/**
 * Score Pillar 4: BTC On-Chain Valuation (-2..+2)
 *
 * Valuation-consistent scoring:
 * - Deep value / capitulation (MVRV < 1.0) => +2
 * - Discount / below production cost (MVRV 1.0..1.25 & spot < prodCostLow) => +1
 * - Fair value (MVRV 1.25..2.2) => 0
 * - Overheated (MVRV 2.2..3.0 => -1; > 3.0 => -2)
 * Never outputs -1 while classifying the market as a Long-Term Value Zone.
 */
function scoreOnChainPillar(onchain = {}) {
  const mvrv = toNum(onchain.mvrv);
  const priceNow = toNum(onchain.priceNow);
  const prodLow = toNum(onchain.prodCostLow);
  const prodHigh = toNum(onchain.prodCostHigh);

  const inputs = [mvrv, prodLow].filter((x) => x !== null);
  if (inputs.length === 0) {
    return {
      score: 0,
      confidence: { vi: 'Thấp', en: 'Low' },
      valuationLabel: { vi: 'Chưa đủ dữ liệu', en: 'Insufficient data' },
    };
  }

  let score = 0;
  let valuationLabel = { vi: 'Vùng định giá trung tính', en: 'Fair Value Zone' };

  if (mvrv !== null) {
    if (mvrv < 1.0) {
      score = 2;
      valuationLabel = { vi: 'Vùng đầu hàng / Giá trị sâu (MVRV < 1.0)', en: 'Deep Capitulation Value Zone (MVRV < 1.0)' };
    } else if (mvrv <= 1.25) {
      if (priceNow !== null && prodLow !== null && priceNow < prodLow) {
        score = 1;
        valuationLabel = { vi: 'Vùng chiết khấu dưới chi phí đào (chưa đầu hàng toàn diện)', en: 'Below-Production-Cost Discount Zone (pre-capitulation)' };
      } else {
        score = 0;
        valuationLabel = { vi: 'Vùng chiết khấu sớm', en: 'Early Discount Zone' };
      }
    } else if (mvrv <= 2.2) {
      score = 0;
      valuationLabel = { vi: 'Vùng định giá trung tính', en: 'Fair Value Zone' };
    } else if (mvrv <= 3.0) {
      score = -1;
      valuationLabel = { vi: 'Vùng định giá cao / Mở rộng nóng', en: 'Elevated Valuation Zone' };
    } else {
      score = -2;
      valuationLabel = { vi: 'Vùng quá nóng chu kỳ', en: 'Cycle Overheated Zone' };
    }
  } else if (priceNow !== null && prodLow !== null && priceNow < prodLow) {
    score = 1;
    valuationLabel = { vi: 'Dưới chi phí sản xuất thợ mỏ', en: 'Below Miner Production Cost' };
  } else if (priceNow !== null && prodHigh !== null && priceNow > prodHigh * 2) {
    score = -1;
    valuationLabel = { vi: 'Cao hơn nhiều chi phí sản xuất', en: 'Far Above Production Cost' };
  }

  // Note: NUPL and Supply in Profit are derived from MVRV, so On-chain independence is Medium at best.
  return {
    score,
    confidence: { vi: 'Trung bình', en: 'Medium' },
    valuationLabel,
  };
}

/**
 * Score Pillar 5: Derivatives Positioning (-2..+2)
 */
function scoreDerivativesPillar(deriv = {}) {
  const funding = toNum(deriv.fundingRate);
  const lsRatio = toNum(deriv.lsRatio);
  const oiChangePct = toNum(deriv.oiChangePct);
  const basisPct = toNum(deriv.basisPct);

  const inputs = [funding, lsRatio, oiChangePct].filter((x) => x !== null);
  if (inputs.length === 0) {
    return { score: 0, confidence: { vi: 'Thấp', en: 'Low' } };
  }

  let pts = 0;
  // High retail L/S ratio (> 2.2) is contrarian bearish (crowded longs = flush risk)
  if (lsRatio !== null) {
    if (lsRatio >= 2.5) pts -= 1.0;
    else if (lsRatio >= 1.8) pts -= 0.5;
    else if (lsRatio <= 0.85) pts += 0.75;
  }
  // Funding rate: negative shows short pressure (contrarian relief only if L/S is not crowded)
  if (funding !== null) {
    if (funding < -0.0001) pts -= 0.25;
    else if (funding > 0.0003) pts -= 0.5;
    else if (funding >= 0 && funding <= 0.00015) pts += 0.25;
  }
  if (oiChangePct !== null && oiChangePct < -3) {
    pts -= 0.25;
  }
  if (basisPct !== null && basisPct < -0.1) {
    pts -= 0.25;
  }

  return {
    score: clampScore(pts),
    confidence: confidenceFromCount(inputs.length, 3),
  };
}

/**
 * Score Pillar 6: Microstructure & Executed Flow (-2..+2)
 */
function scoreMicrostructurePillar(micro = {}) {
  const spotCvd24h = toNum(micro.spotCvd24h);
  const futCvd24h = toNum(micro.futCvd24h);
  const spotCvd7d = toNum(micro.spotCvd7d);
  const longLiq1h = toNum(micro.longLiq1h);
  const shortLiq1h = toNum(micro.shortLiq1h);

  const inputs = [spotCvd24h, futCvd24h, spotCvd7d].filter((x) => x !== null);
  if (inputs.length === 0) {
    return { score: 0, confidence: { vi: 'Thấp', en: 'Low' } };
  }

  let pts = 0;
  if (spotCvd24h !== null) pts += spotCvd24h < -20e6 ? -0.75 : spotCvd24h > 20e6 ? 0.75 : 0;
  if (futCvd24h !== null) pts += futCvd24h < -50e6 ? -0.5 : futCvd24h > 50e6 ? 0.5 : 0;
  if (spotCvd7d !== null) pts += spotCvd7d < -100e6 ? -0.5 : spotCvd7d > 100e6 ? 0.5 : 0;
  if (longLiq1h !== null && shortLiq1h !== null) {
    if (longLiq1h > 20e6 && longLiq1h > shortLiq1h * 3) pts -= 0.5;
    else if (shortLiq1h > 20e6 && shortLiq1h > longLiq1h * 3) pts += 0.5;
  }

  return {
    score: clampScore(pts),
    confidence: confidenceFromCount(inputs.length, 3),
  };
}

/**
 * Build deterministic Single Source of Truth (SSOT) blueprint for AI market reports.
 */
export function buildReportBlueprint(input = {}) {
  const priceNow = toNum(input.priceNow);
  const macro = scoreMacroPillar(input.macro);
  const spot = scoreSpotPillar({ ...input.spot, priceNow });
  const institutional = scoreInstitutionalPillar(input.institutional);
  const onchain = scoreOnChainPillar({ ...input.onchain, priceNow });
  const derivatives = scoreDerivativesPillar(input.derivatives);
  const microstructure = scoreMicrostructurePillar(input.microstructure);

  const totalScore =
    macro.score +
    spot.score +
    institutional.score +
    onchain.score +
    derivatives.score +
    microstructure.score;

  const lsRatio = toNum(input.derivatives?.lsRatio);
  const gexFlip = toNum(input.options?.gexFlipPrice);
  const putWall = toNum(input.options?.putWallStrike);
  const callWall = toNum(input.options?.callWallStrike);
  const mvrv = toNum(input.onchain?.mvrv);
  const prodLow = toNum(input.onchain?.prodCostLow);
  const ma50 = toNum(input.spot?.ma50);
  const impliedRealizedPrice = priceNow && mvrv && mvrv > 0 ? priceNow / mvrv : null;

  // ── 1. Unified Short / Medium / Long-Term Spot Verdicts ──
  const isCrowdedLongFlush =
    (lsRatio !== null && lsRatio >= 2.2) &&
    (microstructure.score <= -1 || spot.score <= -1);

  let shortTermVerdict = { vi: 'NẮM GIỮ & QUAN SÁT', en: 'HOLD & MONITOR' };
  let deployAtCurrentSpot = false;
  let tranche1NowPct = 0;

  if (totalScore <= -4 || isCrowdedLongFlush) {
    shortTermVerdict = { vi: 'CHỜ CHIẾT KHẤU SÂU', en: 'WAIT FOR VALUE ZONE' };
    deployAtCurrentSpot = false;
    tranche1NowPct = 0;
  } else if (totalScore <= -1) {
    shortTermVerdict = { vi: 'DCA CÓ ĐIỀU KIỆN', en: 'CONDITIONAL DCA' };
    deployAtCurrentSpot = true;
    tranche1NowPct = 20;
  } else if (totalScore <= 3) {
    shortTermVerdict = { vi: 'NẮM GIỮ & QUAN SÁT', en: 'HOLD & MONITOR' };
    deployAtCurrentSpot = false;
    tranche1NowPct = 0;
  } else if (totalScore <= 6) {
    shortTermVerdict = { vi: 'DCA CÓ ĐIỀU KIỆN', en: 'CONDITIONAL DCA' };
    deployAtCurrentSpot = true;
    tranche1NowPct = 25;
  } else {
    shortTermVerdict = { vi: 'TÍCH LŨY MẠNH', en: 'AGGRESSIVE ACCUMULATION' };
    deployAtCurrentSpot = true;
    tranche1NowPct = 35;
  }

  let mediumTermVerdict = { vi: 'NẮM GIỮ & QUAN SÁT', en: 'HOLD & MONITOR' };
  if (institutional.score <= -2 && macro.score <= -1) {
    mediumTermVerdict = { vi: 'CHỜ CHIẾT KHẤU SÂU', en: 'WAIT FOR VALUE ZONE' };
  } else if (institutional.score <= -1 || macro.score <= -1) {
    mediumTermVerdict = { vi: 'DCA CÓ ĐIỀU KIỆN', en: 'CONDITIONAL DCA' };
  } else if (institutional.score >= 1 && macro.score >= 0) {
    mediumTermVerdict = { vi: 'TÍCH LŨY MẠNH', en: 'AGGRESSIVE ACCUMULATION' };
  }

  let longTermVerdict = { vi: 'NẮM GIỮ & QUAN SÁT', en: 'HOLD & MONITOR' };
  if (onchain.score >= 2) {
    longTermVerdict = { vi: 'TÍCH LŨY MẠNH', en: 'AGGRESSIVE ACCUMULATION' };
  } else if (onchain.score === 1) {
    longTermVerdict = { vi: 'DCA CÓ ĐIỀU KIỆN', en: 'CONDITIONAL DCA' };
  } else if (onchain.score <= -2) {
    longTermVerdict = { vi: 'HẠ TỶ TRỌNG PHÒNG THỦ', en: 'TRIM / REDUCE RISK' };
  }

  // ── 2. Unified Price Zones (SSOT) ──
  const step = priceNow && priceNow >= 20000 ? 500 : 100;
  let zone1Low = null;
  let zone1High = null;
  let zone2Low = null;
  let zone2High = null;

  if (priceNow) {
    if (deployAtCurrentSpot) {
      zone1Low = roundPrice(priceNow * 0.96, step);
      zone1High = roundPrice(priceNow * 1.01, step);
    } else {
      // Wait for discount: anchor Zone 1 below current spot (6%..12% discount, nudged by Implied Realized Price if nearby)
      const baseHigh = roundPrice(priceNow * 0.94, step);
      let baseLow = roundPrice(priceNow * 0.87, step);
      if (impliedRealizedPrice && impliedRealizedPrice < baseHigh && impliedRealizedPrice > priceNow * 0.78) {
        baseLow = roundPrice(impliedRealizedPrice, step);
      }
      zone1Low = Math.min(baseLow, baseHigh - step);
      zone1High = baseHigh;
    }

    // Zone 2: Deep flush discount — at least 10% below Zone 1 low, anchored toward Put Wall when reasonable
    const maxZone2High = roundPrice(zone1Low * 0.90, step);
    let targetZone2Low = roundPrice(zone1Low * 0.80, step);
    if (putWall && putWall < maxZone2High && putWall >= priceNow * 0.50) {
      targetZone2Low = roundPrice(putWall, step);
    }
    zone2Low = Math.min(targetZone2Low, maxZone2High - step * 2);
    zone2High = maxZone2High;
  }

  // ── 3. Two-Tier Reversal / Invalidation Triggers ──
  const tier1Level =
    gexFlip && priceNow && gexFlip > priceNow && gexFlip < priceNow * 1.2
      ? roundPrice(gexFlip, step)
      : priceNow
        ? roundPrice(priceNow * 1.05, step)
        : null;

  let tier2Candidate = null;
  if (ma50 && tier1Level && ma50 > tier1Level && ma50 < priceNow * 1.35) {
    tier2Candidate = roundPrice(ma50, step);
  } else if (tier1Level) {
    tier2Candidate = roundPrice(tier1Level * 1.06, step);
  }
  const tier2Level =
    tier2Candidate && tier1Level && tier2Candidate <= tier1Level
      ? roundPrice(tier1Level * 1.05, step)
      : tier2Candidate;

  // ── 4. Tranche Capital Allocation Plan (100% consistent with Short-Term Verdict) ──
  const tranches = deployAtCurrentSpot
    ? {
        tranche1Pct: tranche1NowPct,
        tranche1Mode: 'CURRENT_SPOT_PROBE',
        tranche2Pct: 100 - tranche1NowPct - 30,
        tranche3Pct: 30,
      }
    : {
        tranche1Pct: 25,
        tranche1Mode: 'DISCOUNT_ZONE_1_ONLY',
        tranche2Pct: 45,
        tranche3Pct: 30,
      };

  const minSpacingPct =
    zone1Low && zone2High && zone1Low > 0
      ? Math.max(10, Math.round(((zone1Low - zone2High) / zone1Low) * 100))
      : 10;

  return {
    pillars: {
      macro,
      spot,
      institutional,
      onchain,
      derivatives,
      microstructure,
    },
    totalScore,
    verdicts: {
      shortTerm: shortTermVerdict,
      mediumTerm: mediumTermVerdict,
      longTerm: longTermVerdict,
    },
    allocation: {
      deployAtCurrentSpot,
      allocationAtCurrentSpotPct: tranche1NowPct,
      ...tranches,
      minSpacingPct,
    },
    zones: {
      currentSpot: priceNow,
      impliedRealizedPrice: impliedRealizedPrice ? Math.round(impliedRealizedPrice) : null,
      prodCostLow: prodLow,
      zone1: { low: zone1Low, high: zone1High, label: fmtRange(zone1Low, zone1High) },
      zone2: { low: zone2Low, high: zone2High, label: fmtRange(zone2Low, zone2High) },
      callWall,
      putWall,
      gexFlip,
    },
    reversalTiers: {
      tier1EarlyWarning: {
        level: tier1Level,
        label: fmtUsd(tier1Level),
      },
      tier2TrendConfirmation: {
        level: tier2Level,
        label: fmtUsd(tier2Level),
      },
    },
  };
}

/**
 * Render the SSOT blueprint as a deterministic markdown block to inject into promptData.
 */
export function formatBlueprintForPrompt(blueprint) {
  if (!blueprint) return '';
  const { pillars, totalScore, verdicts, allocation, zones, reversalTiers } = blueprint;
  const fmtS = (n) => (n > 0 ? `+${n}` : `${n}`);

  const tranche1Rule = allocation.deployAtCurrentSpot
    ? `Tranche 1 (${allocation.tranche1Pct}% reserve capital): Controlled probe allowed in ${zones.zone1.label} (near current spot) ONLY with flow confirmation.`
    : `Current Spot Allocation = 0% (DO NOT deploy at current spot ${fmtUsd(zones.currentSpot)}). Tranche 1 (${allocation.tranche1Pct}% reserve capital) activates ONLY on discount into ${zones.zone1.label}.`;

  return `## 0.5. DETERMINISTIC REPORT BLUEPRINT (SINGLE SOURCE OF TRUTH — MANDATORY)
*CRITICAL CONSISTENCY CONTRACT: You MUST adopt the exact pillar scores, verdicts, price zones, tranche rules, and 2-tier reversal triggers below across Section 0, Section 4, Section 5, and Section 6. NEVER invent conflicting price zones or contradict the Short-Term verdict in Tranche 1.*
- **Pre-computed Pillar Scores (-2..+2):** Macro ${fmtS(pillars.macro.score)} (${pillars.macro.confidence.en}/${pillars.macro.confidence.vi}) | Spot ${fmtS(pillars.spot.score)} (${pillars.spot.confidence.en}/${pillars.spot.confidence.vi}) | Institutional Flow ${fmtS(pillars.institutional.score)} (${pillars.institutional.confidence.en}/${pillars.institutional.confidence.vi}) | On-Chain ${fmtS(pillars.onchain.score)} (${pillars.onchain.confidence.en}/${pillars.onchain.confidence.vi}; ${pillars.onchain.valuationLabel.en}) | Derivatives ${fmtS(pillars.derivatives.score)} (${pillars.derivatives.confidence.en}/${pillars.derivatives.confidence.vi}) | Microstructure ${fmtS(pillars.microstructure.score)} (${pillars.microstructure.confidence.en}/${pillars.microstructure.confidence.vi}) -> **Total ${fmtS(totalScore)}/12**
- **Macro Regime Classification:** ${pillars.macro.regime.vi} (${pillars.macro.regime.en})
- **Mandatory Spot Verdicts:**
  - Short-Term (1-4w): **${verdicts.shortTerm.vi}** (${verdicts.shortTerm.en})
  - Medium-Term (1-3m): **${verdicts.mediumTerm.vi}** (${verdicts.mediumTerm.en})
  - Long-Term (3-12m+): **${verdicts.longTerm.vi}** (${verdicts.longTerm.en})
- **Unified Action Price Zones (use identically in Sections 0, 4, 5, 6):**
  - Zone 1 (Tranche 1 target): **${zones.zone1.label}**
  - Zone 2 (Tranche 2 deep discount / flush target): **${zones.zone2.label}** (minimum spacing >= ${allocation.minSpacingPct}% below Zone 1)
  - Implied On-Chain Realized Price (Spot / MVRV): **${fmtUsd(zones.impliedRealizedPrice)}**
- **Capital Allocation Guardrail:**
  - ${tranche1Rule}
  - Tranche 2 (${allocation.tranche2Pct}% reserve capital): Deep flush / capitulation into **${zones.zone2.label}**.
  - Tranche 3 (${allocation.tranche3Pct}% reserve capital): Trend confirmation add-on ONLY when Tier-2 reversal trigger is met.
  - Tail-Risk Contingency (if spot breaks below ${fmtUsd(zones.zone2.low)}): Pause remaining deployment; preserve Tranche 3 cash buffer until forced selling exhausts and macro/ETF outflows stabilize.
- **2-Tier Reversal / Invalidation Hierarchy (NEVER mix these two tiers):**
  - **Tier 1 — Early Warning (Short-Term, stops waiting for deeper discount):** Reclaim **${reversalTiers.tier1EarlyWarning.label}** with Binance Spot CVD turning net positive across multiple sessions.
  - **Tier 2 — Trend Confirmation (Medium-Term, activates Tranche 3 add-on):** Sustained daily closes above **${reversalTiers.tier2TrendConfirmation.label}** backed by consecutive Spot ETF net inflows (3+ sessions or weekly net positive) and Spot/Futures CVD alignment.`;
}
