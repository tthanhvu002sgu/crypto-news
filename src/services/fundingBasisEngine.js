/**
 * Pure calculation & normalization engine for Multi-Exchange Funding & Basis.
 * Supports Binance, Bybit, OKX, and Bitget public endpoints.
 * NO React dependencies, NO side effects.
 */

export const FINITE_OR_ZERO = (val) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Normalizes a single venue's data into canonical shape.
 */
export function normalizeVenueData({
  exchange,
  code,
  fundingRate,
  markPrice,
  indexPrice,
  nextFundingTime,
  status = 'OK',
}) {
  const fRate = Number(fundingRate);
  const isValidRate = Number.isFinite(fRate);
  const mark = Number(markPrice);
  const index = Number(indexPrice);

  const basisUsd = Number.isFinite(mark) && Number.isFinite(index) ? mark - index : 0;
  const basisPct = Number.isFinite(index) && index > 0 ? (basisUsd / index) * 100 : 0;

  const fundingPct8h = isValidRate ? fRate * 100 : 0;
  const annualizedPct = isValidRate ? fundingPct8h * 3 * 365 : 0;

  return {
    exchange,
    code,
    venue: code,
    symbol: 'BTCUSDT',
    fundingRate: isValidRate ? fRate : null,
    fundingPct8h: isValidRate ? fundingPct8h : null,
    annualizedPct: isValidRate ? annualizedPct : null,
    fundingApr: isValidRate ? annualizedPct : null,
    markPrice: Number.isFinite(mark) ? mark : null,
    indexPrice: Number.isFinite(index) ? index : null,
    basisUsd: Number.isFinite(mark) && Number.isFinite(index) ? basisUsd : null,
    basisPct: Number.isFinite(index) && index > 0 ? basisPct : null,
    nextFundingTime: nextFundingTime ? Number(nextFundingTime) : null,
    status: isValidRate && status === 'OK' ? 'OK' : 'ERROR',
  };
}

/**
 * Binance Futures parser
 * Raw response from /fapi/v1/premiumIndex?symbol=BTCUSDT
 */
export function parseBinanceFunding(data) {
  if (!data) return normalizeVenueData({ exchange: 'Binance', code: 'BINANCE', status: 'ERROR' });
  return normalizeVenueData({
    exchange: 'Binance',
    code: 'BINANCE',
    fundingRate: data.lastFundingRate,
    markPrice: data.markPrice,
    indexPrice: data.indexPrice,
    nextFundingTime: data.nextFundingTime,
    status: 'OK',
  });
}

/**
 * Bybit Linear V5 parser
 * Raw response from /v5/market/tickers?category=linear&symbol=BTCUSDT
 */
export function parseBybitFunding(data) {
  const item = data?.result?.list?.[0] || data?.list?.[0] || data;
  if (!item || item.fundingRate == null || item.fundingRate === '') {
    return normalizeVenueData({ exchange: 'Bybit', code: 'BYBIT', status: 'ERROR' });
  }
  return normalizeVenueData({
    exchange: 'Bybit',
    code: 'BYBIT',
    fundingRate: item.fundingRate,
    markPrice: item.markPrice,
    indexPrice: item.indexPrice,
    nextFundingTime: item.nextFundingTime,
    status: 'OK',
  });
}

/**
 * OKX parser
 * Combines funding-rate, ticker, and index-ticker
 */
export function parseOkxFunding(fundingData, tickerData, indexData) {
  const fItem = fundingData?.data?.[0] || fundingData;
  const tItem = tickerData?.data?.[0] || tickerData;
  const idxItem = indexData?.data?.[0] || indexData;

  const fundingRate = fItem?.fundingRate;
  const nextFundingTime = fItem?.nextFundingTime || fItem?.fundingTime;
  const markPrice = tItem?.markPx || tItem?.last;
  const indexPrice = idxItem?.idxPx || tItem?.idxPx || markPrice;

  if (fundingRate == null) {
    return normalizeVenueData({ exchange: 'OKX', code: 'OKX', status: 'ERROR' });
  }

  return normalizeVenueData({
    exchange: 'OKX',
    code: 'OKX',
    fundingRate,
    markPrice,
    indexPrice,
    nextFundingTime,
    status: 'OK',
  });
}

/**
 * Bitget V2 parser
 * Raw response from /api/v2/mix/market/tickers?productType=USDT-FUTURES
 */
export function parseBitgetFunding(data, targetSymbol = 'BTCUSDT') {
  const list = data?.data || data;
  if (!Array.isArray(list)) {
    return normalizeVenueData({ exchange: 'Bitget', code: 'BITGET', status: 'ERROR' });
  }
  const item = list.find((t) => String(t.symbol).toUpperCase() === targetSymbol.toUpperCase());
  if (!item || item.fundingRate == null) {
    return normalizeVenueData({ exchange: 'Bitget', code: 'BITGET', status: 'ERROR' });
  }

  return normalizeVenueData({
    exchange: 'Bitget',
    code: 'BITGET',
    fundingRate: item.fundingRate,
    markPrice: item.markPrice || item.lastPr,
    indexPrice: item.indexPrice || item.markPrice,
    nextFundingTime: item.nextFundingTime,
    status: 'OK',
  });
}

/**
 * Aggregates multi-venue funding and basis into market-wide metrics and squeeze / crowding regime.
 *
 * @param {Array<Object>} venuesList - Array of normalized venue objects
 * @returns {Object} Comprehensive analysis
 */
export function analyzeMultiExchangeFunding(venuesList) {
  const validVenues = (Array.isArray(venuesList) ? venuesList : []).filter(
    (v) => v && v.status === 'OK' && v.fundingRate != null && Number.isFinite(v.fundingRate)
  );

  if (validVenues.length === 0) {
    return {
      venues: Array.isArray(venuesList) ? venuesList : [],
      validCount: 0,
      validVenuesCount: 0,
      avgFundingRate: 0,
      avgFundingPct8h: 0,
      avgAnnualizedPct: 0,
      avgFundingApr: 0,
      avgBasisPct: 0,
      highestVenue: null,
      lowestVenue: null,
      minFundingRate: null,
      maxFundingRate: null,
      fundingSpreadPct: 0,
      fundingSpread: 0,
      basisSpreadPct: 0,
      crowdingRegime: 'NO_DATA',
      crowdingLabel: 'NO DATA',
      squeezeLabel: 'NO DATA',
      crowdingTone: 'neutral',
      narrative: 'Chưa đủ dữ liệu từ các sàn phái sinh để phân tích funding spread.',
      timestamp: Date.now(),
    };
  }

  // Find min & max funding
  let highestVenue = validVenues[0];
  let lowestVenue = validVenues[0];
  let sumFunding = 0;
  let sumBasis = 0;
  let validBasisCount = 0;

  for (const v of validVenues) {
    sumFunding += v.fundingRate;
    if (v.fundingRate > highestVenue.fundingRate) highestVenue = v;
    if (v.fundingRate < lowestVenue.fundingRate) lowestVenue = v;

    if (v.basisPct != null && Number.isFinite(v.basisPct)) {
      sumBasis += v.basisPct;
      validBasisCount += 1;
    }
  }

  const avgFundingRate = sumFunding / validVenues.length;
  const avgFundingPct8h = avgFundingRate * 100;
  const avgAnnualizedPct = avgFundingPct8h * 3 * 365;
  const avgBasisPct = validBasisCount > 0 ? sumBasis / validBasisCount : 0;

  const fundingSpreadPct = (highestVenue.fundingRate - lowestVenue.fundingRate) * 100;

  const bases = validVenues.map((v) => v.basisPct).filter(Number.isFinite);
  const basisSpreadPct = bases.length >= 2 ? Math.max(...bases) - Math.min(...bases) : 0;

  // Squeeze / Crowding Regime classification
  let crowdingRegime = 'NEUTRAL_CARRY';
  let crowdingLabel = 'BALANCED CARRY';
  let crowdingTone = 'neutral';
  let narrative = '';

  const highLongVenues = validVenues.filter((v) => v.fundingRate >= 0.00025).length;
  const highShortVenues = validVenues.filter((v) => v.fundingRate <= -0.00008).length;

  const quorumThreshold = Math.max(2, Math.ceil(validVenues.length * 0.75));

  if (avgFundingPct8h >= 0.03 || (highLongVenues >= quorumThreshold && avgBasisPct >= 0.1)) {
    crowdingRegime = 'EXTREME_LONG_CROWDING';
    crowdingLabel = 'LONG CROWDED (Unwind Risk)';
    crowdingTone = 'bear';
    narrative = `Funding dương cao cực đoan (TB 8h: +${avgFundingPct8h.toFixed(4)}% · APR: +${avgAnnualizedPct.toFixed(1)}%). Vị thế Long đòn bẩy dày đặc, rủi ro Long Unwind / Flash Dump khi cạn kiệt lực mua.`;
  } else if (avgFundingPct8h <= -0.01 || (highShortVenues >= quorumThreshold && avgBasisPct <= -0.05)) {
    crowdingRegime = 'EXTREME_SHORT_CROWDING';
    crowdingLabel = 'SHORT SQUEEZE WATCH';
    crowdingTone = 'bull';
    narrative = `Funding âm sâu trên đa sàn (TB 8h: ${avgFundingPct8h.toFixed(4)}% · APR: ${avgAnnualizedPct.toFixed(1)}%). Phe Short bị tính phí duy trì cao, tín hiệu tích lũy tiềm năng cho cú Short Squeeze.`;
  } else if (fundingSpreadPct >= 0.015) {
    crowdingRegime = 'CROSS_VENUE_DISPERSION';
    crowdingLabel = 'VENUE DISPERSION';
    crowdingTone = 'warning';
    narrative = `Lệch pha funding giữa các sàn lớn (${fundingSpreadPct.toFixed(4)}% giữa ${highestVenue.exchange} và ${lowestVenue.exchange}). Khả năng có gom/xả cục bộ hoặc cơ hội Funding Arbitrage.`;
  } else {
    crowdingRegime = 'NEUTRAL_CARRY';
    crowdingLabel = 'BALANCED CARRY';
    crowdingTone = 'neutral';
    narrative = `Funding duy trì quanh mức cơ sở (TB 8h: +${avgFundingPct8h.toFixed(4)}% · APR: +${avgAnnualizedPct.toFixed(1)}%). Thị trường phái sinh cân bằng, không có áp lực crowding cực đoan.`;
  }

  return {
    venues: venuesList,
    validCount: validVenues.length,
    validVenuesCount: validVenues.length,
    avgFundingRate,
    avgFundingPct8h,
    avgAnnualizedPct,
    avgFundingApr: avgAnnualizedPct,
    avgBasisPct,
    highestVenue,
    lowestVenue,
    minFundingRate: lowestVenue?.fundingRate ?? null,
    maxFundingRate: highestVenue?.fundingRate ?? null,
    fundingSpreadPct,
    fundingSpread: fundingSpreadPct / 100,
    basisSpreadPct,
    crowdingRegime,
    crowdingLabel,
    squeezeLabel: crowdingLabel,
    crowdingTone,
    narrative,
    timestamp: Date.now(),
  };
}
