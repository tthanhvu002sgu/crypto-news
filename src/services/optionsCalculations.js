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
 * Filter strikes within ±30% of underlying price.
 * @param {Array} instruments 
 * @param {number} underlyingPrice 
 * @param {number} strikeRangePct 
 * @returns {Array<{ strike: number, callOI: number, putOI: number, callGamma: number, putGamma: number }>}
 */
export const aggregateStrikeOI = (instruments, underlyingPrice, strikeRangePct = 0.30) => {
  if (!Array.isArray(instruments) || finite(underlyingPrice) === null) return [];
  
  const minStrike = underlyingPrice * (1 - strikeRangePct);
  const maxStrike = underlyingPrice * (1 + strikeRangePct);
  
  const strikeMap = new Map();
  
  for (const inst of instruments) {
    if (!inst) continue;
    const parsed = parseInstrumentName(inst.instrumentName || inst.instrument_name);
    if (!parsed) continue;
    
    const { strike, type } = parsed;
    
    if (strike < minStrike || strike > maxStrike) continue;
    
    if (!strikeMap.has(strike)) {
      strikeMap.set(strike, { strike, callOI: 0, putOI: 0, callGamma: 0, putGamma: 0 });
    }
    
    const data = strikeMap.get(strike);
    const oi = finite(inst.openInterest || inst.open_interest) || 0;
    const gamma = Math.min(finite(inst.gamma) || 0, MAX_GAMMA);
    
    if (type === 'C') {
      data.callOI += oi;
      data.callGamma += gamma;
    } else if (type === 'P') {
      data.putOI += oi;
      data.putGamma += gamma;
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
  
  let minPain = Infinity;
  let maxPainPrice = null;
  
  for (const candidate of strikeData) {
    const candidateStrike = candidate.strike;
    let totalPain = 0;
    
    for (const option of strikeData) {
      const strike = option.strike;
      // call buyer value at expiration = max(0, underlying - strike), where underlying is candidateStrike
      const callVal = Math.max(0, candidateStrike - strike) * option.callOI;
      // put buyer value at expiration = max(0, strike - underlying)
      const putVal = Math.max(0, strike - candidateStrike) * option.putOI;
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
 * Net Gamma Exposure per strike
 * @param {Array<{ strike: number, callOI: number, putOI: number, callGamma: number, putGamma: number }>} strikeData 
 * @param {number} underlyingPrice 
 * @param {number} contractMultiplier 
 * @returns {Array<{ strike: number, callGex: number, putGex: number, netGex: number }>}
 */
export const calculateGexByStrike = (strikeData, underlyingPrice, contractMultiplier = 1) => {
  if (!Array.isArray(strikeData) || finite(underlyingPrice) === null) return [];
  
  return strikeData.map(data => {
    const rawCallGex = (data.callGamma || 0) * (data.callOI || 0) * underlyingPrice * contractMultiplier * 100 * 1;
    const rawPutGex = (data.putGamma || 0) * (data.putOI || 0) * underlyingPrice * contractMultiplier * 100 * (-1);
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
  }).sort((a, b) => a.strike - b.strike);
};

/**
 * Identify call wall and put wall
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
  
  let maxCallOI = -1;
  let maxPutOI = -1;
  
  for (const data of strikeData) {
    if (data.strike >= underlyingPrice) {
      if (data.callOI > maxCallOI) {
        maxCallOI = data.callOI;
        callWall = { strike: data.strike, oi: data.callOI };
      }
    }
    if (data.strike <= underlyingPrice) {
      if (data.putOI > maxPutOI) {
        maxPutOI = data.putOI;
        putWall = { strike: data.strike, oi: data.putOI };
      }
    }
  }
  
  return { callWall, putWall };
};

/**
 * Find the strike price where Net GEX crosses zero (sign change).
 * @param {Array<{ strike: number, netGex: number }>} gexByStrike 
 * @returns {number | null}
 */
export const findGexFlipLevel = (gexByStrike) => {
  if (!Array.isArray(gexByStrike) || gexByStrike.length < 2) return null;
  
  for (let i = 1; i < gexByStrike.length; i++) {
    const prev = gexByStrike[i - 1];
    const curr = gexByStrike[i];
    
    // Check if sign flips between adjacent strikes
    if ((prev.netGex < 0 && curr.netGex >= 0) || (prev.netGex > 0 && curr.netGex <= 0)) {
      const spread = Math.abs(prev.netGex) + Math.abs(curr.netGex);
      if (spread === 0) return curr.strike;
      const ratio = Math.abs(prev.netGex) / spread;
      const flipPrice = prev.strike + ratio * (curr.strike - prev.strike);
      return flipPrice;
    }
  }
  
  return null;
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
  
  const minStrike = currentPrice * 0.95;
  const maxStrike = currentPrice * 1.05;
  
  let netGexAtPrice = 0;
  for (const data of gexByStrike) {
    if (data.strike >= minStrike && data.strike <= maxStrike) {
      netGexAtPrice += data.netGex;
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
    totalCallOI += data.callOI;
    totalPutOI += data.putOI;
  }
  
  if (totalCallOI === 0) return null;
  return { pcr: totalPutOI / totalCallOI, totalCallOI, totalPutOI };
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
      meta: { underlyingPrice, dteFilter, instrumentCount: 0, lastUpdated: Date.now() }
    };
  }
  
  const filtered = filterByDte(instruments, dteFilter);
  const strikeDistribution = aggregateStrikeOI(filtered, underlyingPrice);
  
  const maxPain = calculateMaxPain(strikeDistribution);
  const gexByStrike = calculateGexByStrike(strikeDistribution, underlyingPrice);
  const { callWall, putWall } = identifyWalls(strikeDistribution, underlyingPrice);
  const gexFlipPrice = findGexFlipLevel(gexByStrike);
  const gammaRegime = classifyGammaRegime(gexByStrike, underlyingPrice);
  const pcr = calculatePCR(strikeDistribution);
  
  return {
    strikeDistribution,
    maxPain,
    gexByStrike,
    callWall,
    putWall,
    gexFlipPrice,
    gammaRegime,
    pcr,
    meta: {
      underlyingPrice,
      dteFilter,
      instrumentCount: filtered.length,
      lastUpdated: Date.now()
    }
  };
};
