/**
 * Pure calculation engine for BTC Options analysis (Max Pain, GEX, Walls, PCR).
 * NO React imports, NO side effects.
 */

/**
 * Safe number parser
 * @param {any} value
 * @returns {number|null}
 */
export const finite = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Parse Deribit instrument name like 'BTC-28MAR26-95000-C'
 * @param {string} name
 * @returns {{ currency: string, expiry: string, strike: number, type: string } | null}
 */
export const parseInstrumentName = (name) => {
  if (!name || typeof name !== 'string') return null;
  const parts = name.split('-');
  if (parts.length !== 4) return null;
  const [currency, expiry, strikeStr, type] = parts;
  const strike = finite(strikeStr);
  if (strike === null) return null;
  return { currency, expiry, strike, type };
};

/**
 * Filter instruments array by Days To Expiration.
 * @param {Array} instruments 
 * @param {number|null} maxDte 
 * @returns {Array}
 */
export const filterByDte = (instruments, maxDte) => {
  if (!Array.isArray(instruments)) return [];
  if (maxDte == null) return instruments;
  
  const now = Date.now();
  const maxMs = maxDte * 24 * 60 * 60 * 1000;
  
  return instruments.filter(inst => {
    if (!inst || inst.expirationTimestamp == null) return false;
    const timeToExpiry = inst.expirationTimestamp - now;
    return timeToExpiry > 0 && timeToExpiry <= maxMs;
  });
};

const MAX_GAMMA = 100;

/**
 * Group instruments by strike price, sum Call OI and Put OI separately.
 * Optionally filter strikes within ±strikeRangePct of underlying price (default 0.30, null for no range filter).
 * Accumulates sum(Gamma * OI) per strike for accurate multi-expiry GEX calculations.
 * @param {Array} instruments 
 * @param {number} underlyingPrice 
 * @param {number|null} strikeRangePct 
 * @returns {Array<{ strike: number, callOI: number, putOI: number, callGamma: number, putGamma: number, callGammaOI: number, putGammaOI: number }>}
 */
export const aggregateStrikeOI = (instruments, underlyingPrice, strikeRangePct = 0.30) => {
  if (!Array.isArray(instruments) || finite(underlyingPrice) === null) return [];
  
  const hasRange = strikeRangePct != null && Number.isFinite(strikeRangePct);
  const minStrike = hasRange ? underlyingPrice * (1 - strikeRangePct) : -Infinity;
  const maxStrike = hasRange ? underlyingPrice * (1 + strikeRangePct) : Infinity;
  
  const strikeMap = new Map();
  
  for (const inst of instruments) {
    if (!inst) continue;
    const parsed = parseInstrumentName(inst.instrumentName || inst.instrument_name);
    if (!parsed) continue;
    
    const { strike, type } = parsed;
    
    if (strike < minStrike || strike > maxStrike) continue;
    
    if (!strikeMap.has(strike)) {
      strikeMap.set(strike, {
        strike,
        callOI: 0,
        putOI: 0,
        callGamma: 0,
        putGamma: 0,
        callGammaOI: 0,
        putGammaOI: 0
      });
    }
    
    const data = strikeMap.get(strike);
    const oi = Math.max(0, finite(inst.openInterest || inst.open_interest) || 0);
    const gamma = Math.max(0, Math.min(finite(inst.gamma) || 0, MAX_GAMMA));
    
    if (type === 'C') {
      data.callOI += oi;
      data.callGamma += gamma;
      data.callGammaOI += gamma * oi;
    } else if (type === 'P') {
      data.putOI += oi;
      data.putGamma += gamma;
      data.putGammaOI += gamma * oi;
    }
  }
  
  return Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
};

/**
 * Classic Max Pain algorithm
 * @param {Array<{ strike: number, callOI: number, putOI: number }>} strikeData 
 * @returns {{ maxPainPrice: number, totalPain: number } | null}
 */
export const calculateMaxPain = (strikeData) => {
  if (!Array.isArray(strikeData) || strikeData.length === 0) return null;
  
  const valid = strikeData.filter(d => d && finite(d.strike) !== null);
  if (valid.length === 0) return null;

  let minPain = Infinity;
  let maxPainPrice = null;
  
  for (const candidate of valid) {
    const candidateStrike = candidate.strike;
    let totalPain = 0;
    
    for (const option of valid) {
      const strike = option.strike;
      const callOI = finite(option.callOI) || 0;
      const putOI = finite(option.putOI) || 0;
      // call buyer value at expiration = max(0, candidateStrike - strike) * callOI
      const callVal = Math.max(0, candidateStrike - strike) * callOI;
      // put buyer value at expiration = max(0, strike - candidateStrike) * putOI
      const putVal = Math.max(0, strike - candidateStrike) * putOI;
      totalPain += callVal + putVal;
    }
    
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainPrice = candidateStrike;
    }
  }
  
  if (maxPainPrice === null) return null;
  return { maxPainPrice, totalPain: minPain };
};

/**
 * Net Gamma Exposure per strike (Deribit BTC: 1 contract = 1 BTC, no 100x TradFi multiplier)
 * Call GEX is positive, Put GEX is negative (MM Net Long Calls / Net Short Puts)
 * Uses exact sum(Gamma * OI) if available.
 * @param {Array<{ strike: number, callOI: number, putOI: number, callGamma?: number, putGamma?: number, callGammaOI?: number, putGammaOI?: number }>} strikeData 
 * @param {number} underlyingPrice 
 * @param {number} contractMultiplier 
 * @returns {Array<{ strike: number, callGex: number, putGex: number, netGex: number }>}
 */
export const calculateGexByStrike = (strikeData, underlyingPrice, contractMultiplier = 1) => {
  if (!Array.isArray(strikeData) || finite(underlyingPrice) === null) return [];
  
  const spot = finite(underlyingPrice);
  const mult = finite(contractMultiplier) ?? 1;

  return strikeData
    .filter(data => data && finite(data.strike) !== null)
    .map(data => {
      const callGammaOI = data.callGammaOI != null
        ? (finite(data.callGammaOI) || 0)
        : (finite(data.callGamma) || 0) * (finite(data.callOI) || 0);
      const putGammaOI = data.putGammaOI != null
        ? (finite(data.putGammaOI) || 0)
        : (finite(data.putGamma) || 0) * (finite(data.putOI) || 0);
      const rawCallGex = callGammaOI * spot * mult * 1;
      const rawPutGex = putGammaOI * spot * mult * (-1);
      const callGex = rawCallGex === 0 ? 0 : rawCallGex;
      const putGex = rawPutGex === 0 ? 0 : rawPutGex;
      const rawNetGex = callGex + putGex;
      const netGex = rawNetGex === 0 ? 0 : rawNetGex;
      
      return {
        strike: data.strike,
        callGex,
        putGex,
        netGex
      };
    })
    .sort((a, b) => a.strike - b.strike);
};

/**
 * Identify call wall and put wall.
 * Requires OI > 0 so zero-OI strikes are never selected as walls.
 * @param {Array<{ strike: number, callOI: number, putOI: number }>} strikeData 
 * @param {number} underlyingPrice 
 * @returns {{ callWall: { strike: number, oi: number } | null, putWall: { strike: number, oi: number } | null }}
 */
export const identifyWalls = (strikeData, underlyingPrice) => {
  let callWall = null;
  let putWall = null;
  
  if (!Array.isArray(strikeData) || finite(underlyingPrice) === null) {
    return { callWall, putWall };
  }
  
  let maxCallOI = 0;
  let maxPutOI = 0;
  
  for (const data of strikeData) {
    if (!data) continue;
    const strike = finite(data.strike);
    if (strike === null) continue;

    const callOI = finite(data.callOI) || 0;
    const putOI = finite(data.putOI) || 0;

    if (strike >= underlyingPrice) {
      if (callOI > maxCallOI) {
        maxCallOI = callOI;
        callWall = { strike, oi: callOI };
      }
    }
    if (strike <= underlyingPrice) {
      if (putOI > maxPutOI) {
        maxPutOI = putOI;
        putWall = { strike, oi: putOI };
      }
    }
  }
  
  return { callWall, putWall };
};

/**
 * Find the strike price where Net GEX crosses zero (sign change).
 * When underlyingPrice is provided, returns the flip level closest to current Spot price.
 * Accurately handles transitions across zero-OI strikes without registering false flips.
 * @param {Array<{ strike: number, netGex: number }>} gexByStrike 
 * @param {number|null} underlyingPrice 
 * @returns {number | null}
 */
export const findGexFlipLevel = (gexByStrike, underlyingPrice = null) => {
  if (!Array.isArray(gexByStrike) || gexByStrike.length < 2) return null;
  
  // Filter valid items with numeric strike and netGex
  const valid = [];
  for (const item of gexByStrike) {
    if (item && finite(item.strike) !== null && finite(item.netGex) !== null) {
      valid.push({ strike: Number(item.strike), netGex: Number(item.netGex) });
    }
  }
  if (valid.length < 2) return null;

  const flips = [];
  
  for (let i = 0; i < valid.length - 1; i++) {
    const curr = valid[i];
    const next = valid[i + 1];
    
    // Case 1: Direct sign change between two non-zero strikes
    if ((curr.netGex < 0 && next.netGex > 0) || (curr.netGex > 0 && next.netGex < 0)) {
      const spread = Math.abs(curr.netGex) + Math.abs(next.netGex);
      if (spread > 0) {
        const ratio = Math.abs(curr.netGex) / spread;
        const flipPrice = curr.strike + ratio * (next.strike - curr.strike);
        flips.push(flipPrice);
      }
      continue;
    }

    // Case 2: One or more zeroes between non-zero strikes.
    // Trigger when leaving a non-zero strike into a zero strike (curr.netGex !== 0 and next.netGex === 0).
    if (curr.netGex !== 0 && next.netGex === 0) {
      let endIdx = i + 1;
      while (endIdx < valid.length && valid[endIdx].netGex === 0) {
        endIdx++;
      }

      // If there is a non-zero strike after the zero block, check for true sign change
      if (endIdx < valid.length) {
        const after = valid[endIdx];
        if ((curr.netGex < 0 && after.netGex > 0) || (curr.netGex > 0 && after.netGex < 0)) {
          const firstZeroStrike = valid[i + 1].strike;
          const lastZeroStrike = valid[endIdx - 1].strike;
          const flipPrice = (firstZeroStrike + lastZeroStrike) / 2;
          flips.push(flipPrice);
        }
      }
      // Advance loop index to the end of the zero block
      i = endIdx - 1;
    }
  }
  
  if (flips.length === 0) return null;

  const spot = finite(underlyingPrice);
  if (spot !== null) {
    let closestFlip = flips[0];
    let minDiff = Math.abs(flips[0] - spot);
    for (let j = 1; j < flips.length; j++) {
      const diff = Math.abs(flips[j] - spot);
      if (diff < minDiff) {
        minDiff = diff;
        closestFlip = flips[j];
      }
    }
    return closestFlip;
  }
  
  return flips[0];
};

/**
 * Determine if current price is in Positive Gamma or Negative Gamma zone.
 * @param {Array<{ strike: number, netGex: number }>} gexByStrike 
 * @param {number} currentPrice 
 * @returns {{ regime: string, netGexAtPrice: number, description: string }}
 */
export const classifyGammaRegime = (gexByStrike, currentPrice) => {
  if (!Array.isArray(gexByStrike) || finite(currentPrice) === null) {
    return { regime: 'NEUTRAL', netGexAtPrice: 0, description: 'No data' };
  }
  
  const spot = finite(currentPrice);
  const minStrike = spot * 0.95;
  const maxStrike = spot * 1.05;
  
  let netGexAtPrice = 0;
  for (const data of gexByStrike) {
    if (!data || finite(data.strike) === null) continue;
    if (data.strike >= minStrike && data.strike <= maxStrike) {
      netGexAtPrice += finite(data.netGex) || 0;
    }
  }
  
  if (netGexAtPrice > 0) {
    return { regime: 'POSITIVE_GAMMA', netGexAtPrice, description: 'Sticky/mean-reverting' };
  } else if (netGexAtPrice < 0) {
    return { regime: 'NEGATIVE_GAMMA', netGexAtPrice, description: 'Volatile/momentum' };
  }
  return { regime: 'NEUTRAL', netGexAtPrice, description: 'Neutral' };
};

/**
 * Put/Call Ratio
 * @param {Array<{ callOI: number, putOI: number }>} strikeData 
 * @returns {{ pcr: number, totalCallOI: number, totalPutOI: number } | null}
 */
export const calculatePCR = (strikeData) => {
  if (!Array.isArray(strikeData) || strikeData.length === 0) return null;
  
  let totalCallOI = 0;
  let totalPutOI = 0;
  
  for (const data of strikeData) {
    if (!data) continue;
    totalCallOI += Math.max(0, finite(data.callOI) || 0);
    totalPutOI += Math.max(0, finite(data.putOI) || 0);
  }
  
  if (totalCallOI === 0) return null;
  return { pcr: totalPutOI / totalCallOI, totalCallOI, totalPutOI };
};

/**
 * Format strike number as currency string
 * @param {number|null} val 
 * @returns {string}
 */
const fmtNarrativeStrike = (val) => {
  if (val == null || !Number.isFinite(val)) return '---';
  return `$${Math.round(val).toLocaleString()}`;
};

/**
 * Generate concise, professional ASP100 narrative for BTC Options
 * (Action - Sentiment - Positioning within ~100 words)
 * @param {Object} params
 * @returns {Object}
 */
export const generateOptionsAsp100Narrative = ({
  gammaRegime,
  callWall,
  putWall,
  maxPain,
  gexFlipPrice,
  pcr,
  underlyingPrice
}) => {
  const spot = finite(underlyingPrice);
  const regimeType = gammaRegime?.regime || 'NEUTRAL';
  const pcrVal = finite(pcr?.pcr);

  // 1. Executive Summary & Badge
  let badge = 'NEUTRAL GAMMA';
  let badgeType = 'neutral'; // 'positive' | 'negative' | 'neutral'
  let executive = 'Cấu trúc Options cân bằng; vận động giá hiện tại phụ thuộc chủ yếu vào dòng tiền giao ngay (Spot Flow).';

  if (regimeType === 'POSITIVE_GAMMA') {
    badge = '+GEX MEAN-REVERTING';
    badgeType = 'positive';
    executive = 'Thị trường trong vùng +GEX: Cơ chế hedging của Dealer ghìm biên độ dao động, nén giá trong hành lang Call/Put Wall.';
  } else if (regimeType === 'NEGATIVE_GAMMA') {
    badge = '-GEX MOMENTUM EXPANSION';
    badgeType = 'negative';
    executive = 'Thị trường trong vùng -GEX: Dealer hedging cùng chiều khuếch đại biến động, giá nhạy cảm với các đợt bùng nổ theo đà.';
  }

  // 2. [P] POSITIONING (~25-30 words)
  let positioning = '';
  const cwStr = callWall?.strike != null ? fmtNarrativeStrike(callWall.strike) : null;
  const pwStr = putWall?.strike != null ? fmtNarrativeStrike(putWall.strike) : null;
  const mpStr = maxPain?.maxPainPrice != null ? fmtNarrativeStrike(maxPain.maxPainPrice) : null;
  const flipStr = gexFlipPrice != null ? fmtNarrativeStrike(gexFlipPrice) : null;

  if (regimeType === 'POSITIVE_GAMMA') {
    if (cwStr && pwStr) {
      positioning = `Dealer Long Gamma tạo trần kháng cự tại ${cwStr} (Call Wall) và sàn đỡ tại ${pwStr} (Put Wall).`;
    } else if (cwStr) {
      positioning = `Kháng cự thể chế chủ đạo tập trung dày đặc tại ${cwStr} (Call Wall).`;
    } else if (pwStr) {
      positioning = `Hỗ trợ thể chế chủ đạo được bảo vệ vững chắc tại ${pwStr} (Put Wall).`;
    } else {
      positioning = 'Lực kẹp phái sinh chưa hình thành rõ rệt do thiếu cụm OI tập trung.';
    }
    if (mpStr) {
      positioning += ` Tâm hút Max Pain tại ${mpStr}.`;
    }
  } else if (regimeType === 'NEGATIVE_GAMMA') {
    if (flipStr) {
      positioning = `Spot dưới mốc Flip ${flipStr} kích hoạt Dealer bán tháo phòng hộ khi giá giảm.`;
    } else {
      positioning = 'Hiệu ứng Short Gamma của Dealer gia tăng áp lực trượt giá theo đà.';
    }
    if (cwStr || pwStr) {
      positioning += ` Biên độ mở rộng giữa hỗ trợ ${pwStr || 'sâu'} và kháng cự ${cwStr || 'cao'}.`;
    }
  } else {
    if (cwStr && pwStr) {
      positioning = `Hành lang giao dịch phái sinh được xác lập giữa sàn ${pwStr} (Put Wall) và trần ${cwStr} (Call Wall).`;
    } else {
      positioning = 'Các mốc định vị quyền chọn chưa hội tụ đủ thanh khoản để tạo trần/sàn cứng.';
    }
    if (mpStr) {
      positioning += ` Lực hút Max Pain duy trì quanh ${mpStr}.`;
    }
  }

  // 3. [S] SENTIMENT (~20-25 words)
  let sentiment = '';
  if (pcrVal == null) {
    sentiment = 'Chưa đủ dữ liệu Put/Call Ratio để xác lập thiên kiến phòng hộ phái sinh.';
  } else if (pcrVal < 0.65) {
    sentiment = `PCR ${pcrVal.toFixed(2)} cho thấy Call Skew áp đảo; dòng tiền thiên hướng đầu cơ tăng mạnh, cần lưu ý áp lực chốt lời khi áp sát Call Wall.`;
  } else if (pcrVal <= 1.05) {
    sentiment = `PCR ${pcrVal.toFixed(2)} ở mức cân bằng lành mạnh; tương quan giữa cược tăng giá và nhu cầu mua Put phòng hộ duy trì ổn định.`;
  } else if (pcrVal <= 1.30) {
    sentiment = `PCR ${pcrVal.toFixed(2)} thể hiện nhu cầu mua Put phòng hộ (Hedging) gia tăng, thị trường nâng cao tâm lý thận trọng ngắn hạn.`;
  } else {
    sentiment = `PCR ${pcrVal.toFixed(2)} cao cực đoan phản ánh tâm lý hoảng loạn mua bảo hiểm; đây thường là tín hiệu tạo đáy nghịch đảo (Contrarian Bottom).`;
  }

  // 4. [A] ACTIONABLE (~25-30 words)
  let action = '';
  if (regimeType === 'POSITIVE_GAMMA') {
    action = `Ưu tiên Range Trading (chốt lời gần ${cwStr || 'trần'}, gom hàng gần ${pwStr || 'sàn'}). Chỉ breakout nếu Spot vượt ${cwStr || 'trần'} kèm volume lớn.`;
  } else if (regimeType === 'NEGATIVE_GAMMA') {
    action = `Hạn chế bắt dao rơi; ưu tiên bám đà bứt phá (Breakout Momentum) hoặc nới rộng Stop Loss để tránh bị quét râu nến trong vùng biến động cao.`;
  } else {
    action = `Quan sát phản ứng quanh mốc ${pwStr || 'hỗ trợ'} - ${cwStr || 'kháng cự'}; duy trì tỷ trọng an toàn và chờ xác nhận đồng pha từ Spot CVD trước khi vào lệnh lớn.`;
  }

  const fullText = `${executive}\n• [P] POSITIONING: ${positioning}\n• [S] SENTIMENT: ${sentiment}\n• [A] ACTION: ${action}`;

  // Word count estimation
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  return {
    badge,
    badgeType,
    executive,
    positioning,
    sentiment,
    action,
    fullText,
    wordCount
  };
};

/**
 * Master function that orchestrates all the above
 * @param {Array} instruments 
 * @param {number} underlyingPrice 
 * @param {number|null} dteFilter 
 * @returns {Object}
 */
export const analyzeBtcOptions = (instruments, underlyingPrice, dteFilter = null) => {
  if (!Array.isArray(instruments) || finite(underlyingPrice) === null) {
    return {
      strikeDistribution: [], maxPain: null, gexByStrike: [],
      callWall: null, putWall: null, gexFlipPrice: null,
      gammaRegime: { regime: 'NEUTRAL', netGexAtPrice: 0, description: 'No data' },
      pcr: null,
      narrative: generateOptionsAsp100Narrative({
        gammaRegime: { regime: 'NEUTRAL' },
        callWall: null,
        putWall: null,
        maxPain: null,
        gexFlipPrice: null,
        pcr: null,
        underlyingPrice: null
      }),
      meta: { underlyingPrice, dteFilter, instrumentCount: 0, lastUpdated: Date.now() }
    };
  }
  
  const filtered = filterByDte(instruments, dteFilter);
  // Full chain without strike truncation for market-wide metrics (PCR, Walls, Max Pain)
  const allStrikeDistribution = aggregateStrikeOI(filtered, underlyingPrice, null);
  // Display strikes within ±30% for localized GEX & distribution chart
  const strikeDistribution = aggregateStrikeOI(filtered, underlyingPrice, 0.30);
  
  const maxPain = calculateMaxPain(allStrikeDistribution.length > 0 ? allStrikeDistribution : strikeDistribution);
  const gexByStrike = calculateGexByStrike(strikeDistribution, underlyingPrice);
  const { callWall, putWall } = identifyWalls(allStrikeDistribution, underlyingPrice);
  const gexFlipPrice = findGexFlipLevel(gexByStrike, underlyingPrice);
  const gammaRegime = classifyGammaRegime(gexByStrike, underlyingPrice);
  const pcr = calculatePCR(allStrikeDistribution);
  const narrative = generateOptionsAsp100Narrative({
    gammaRegime,
    callWall,
    putWall,
    maxPain,
    gexFlipPrice,
    pcr,
    underlyingPrice
  });
  
  return {
    strikeDistribution,
    maxPain,
    gexByStrike,
    callWall,
    putWall,
    gexFlipPrice,
    gammaRegime,
    pcr,
    narrative,
    meta: {
      underlyingPrice,
      dteFilter,
      instrumentCount: filtered.length,
      lastUpdated: Date.now()
    }
  };
};
