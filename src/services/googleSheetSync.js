/**
 * Google Sheets Client Sync Service
 * 
 * Cho phép đồng bộ dữ liệu trực tiếp từ trình duyệt Web lên Google Sheet qua Apps Script Webhook.
 * Chuẩn hóa Data Contract đồng nhất với worker GitHub Actions.
 */

// ─── HELPER FORMATTERS ────────────────────────────────────────────────────────
const toFiniteNumber = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,%]/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const fmt = (n, d = 2) => {
  const num = toFiniteNumber(n);
  return num != null ? num.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '---';
};

const fmtUsd = (n, d = 0) => {
  const num = toFiniteNumber(n);
  return num != null ? `$${num.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '---';
};

const fmtB = (n, d = 2) => {
  const num = toFiniteNumber(n);
  return num != null ? `$${(num / 1e9).toFixed(d)}B` : '---';
};

const fmtM = (n, d = 1) => {
  const num = toFiniteNumber(n);
  return num != null ? `$${(num / 1e6).toFixed(d)}M` : '---';
};

const fmtCompactUsd = (n) => {
  const num = toFiniteNumber(n);
  if (num == null) return '---';
  const val = Math.abs(num);
  const sign = num < 0 ? '-' : (num > 0 ? '+' : '');
  if (val >= 1e9) return `${sign}$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${sign}$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${sign}$${(val / 1e3).toFixed(1)}K`;
  return `${sign}$${val.toFixed(0)}`;
};

export function getCurrentSessionVN(date = new Date()) {
  const vnHour = (date.getUTCHours() + 7) % 24;
  if (vnHour >= 6 && vnHour < 14) {
    return { name: 'PHIÊN Á (ASIAN SESSION)', code: 'ASIA', hour: vnHour };
  } else if (vnHour >= 14 && vnHour < 20) {
    return { name: 'PHIÊN ÂU (EUROPEAN SESSION)', code: 'EUROPE', hour: vnHour };
  } else {
    return { name: 'PHIÊN MỸ (US SESSION)', code: 'US', hour: vnHour };
  }
}

/**
 * Tính toán khoảng chi phí sản xuất 1 BTC từ độ khó khai thác (difficulty)
 */
export function calculateBtcProductionCostRange(difficulty) {
  const diff = toFiniteNumber(difficulty);
  if (!diff || diff <= 0) return { min: null, max: null, formatted: 'N/A' };
  
  // Normalize difficulty if passed in Trillion units (< 1e6)
  const rawDiff = diff < 1e6 ? diff * 1e12 : diff;
  
  // Baseline energy model: 26 J/TH @ $0.05/kWh + 10% opex
  const hashesPerBlock = rawDiff * Math.pow(2, 32);
  const joulesPerHash = 26 * 1e-12;
  const kwhPerBlock = (hashesPerBlock * joulesPerHash) / 3.6e6;
  const energyCostPerBlock = kwhPerBlock * 0.05;
  const blockSubsidy = 3.125; // Post-2024 halving
  const mid = (energyCostPerBlock / blockSubsidy) * 1.1;

  const min = Math.round(mid * 0.95);
  const max = Math.round(mid * 1.10);
  return {
    min,
    max,
    formatted: `$${min.toLocaleString()} - $${max.toLocaleString()}`
  };
}

const isFieldFallback = (val) => {
  if (val == null) return false;
  if (typeof val === 'object') {
    return val.isFallback === true || val.status === 'FALLBACK' || val.status === 'UNAVAILABLE';
  }
  return false;
};

/**
 * Kiểm tra tính đầy đủ, nguồn gốc và độ mới của dữ liệu trước khi xuất
 */
export function validateExportReadiness(data, biasData, etfHoldings, etfHistory, options = {}) {
  const blockingErrors = [];
  const warnings = [];
  const laggedInfo = [];

  const btcPrice = toFiniteNumber(data?.btc?.price ?? options?.livePrice);
  const fundingRate = toFiniteNumber(data?.fundingRate?.val ?? data?.fundingRate ?? options?.liveFunding);
  const openInterest = toFiniteNumber(data?.openInterest?.val ?? data?.openInterest);
  const biasScore = toFiniteNumber(biasData?.score);

  // 1. REQUIRED FIELDS CHECK
  if (btcPrice == null || btcPrice <= 0 || data?.btc?.isFallback) {
    blockingErrors.push('Thiếu giá Bitcoin (BTC Price) từ Binance REST / WebSocket.');
  }
  if (fundingRate == null || data?.fundingRateIsFallback || isFieldFallback(data?.fundingRate)) {
    blockingErrors.push('Thiếu tỷ lệ Funding Rate từ Binance Futures.');
  }
  if (openInterest == null || openInterest <= 0 || data?.oiIsFallback || isFieldFallback(data?.openInterest)) {
    blockingErrors.push('Thiếu khối lượng Open Interest (OI) từ Binance Futures.');
  }
  if (biasScore == null) {
    blockingErrors.push('Chưa tính toán được Market Bias Engine Score.');
  }

  // 2. OPTIONAL FIELDS CHECK (Check real vs fallback)
  const ethPrice = toFiniteNumber(data?.ethTicker?.price ?? data?.eth?.price ?? data?.ethPrice?.price ?? data?.ethPrice ?? options?.liveEthPrice);
  if (ethPrice == null || isFieldFallback(data?.ethTicker)) {
    warnings.push('Chưa tải được giá Ethereum (ETH Ticker).');
  }

  const solPrice = toFiniteNumber(data?.solTicker?.price ?? data?.sol?.price ?? data?.solPrice?.price ?? data?.solPrice ?? options?.liveSolPrice);
  if (solPrice == null || isFieldFallback(data?.solTicker)) {
    warnings.push('Chưa tải được giá Solana (SOL Ticker).');
  }

  if (data?.fngData?.value == null || isFieldFallback(data?.fngData)) {
    warnings.push('Thiếu chỉ số Fear & Greed (Alternative.me).');
  }

  const stablecoinTotal = toFiniteNumber(data?.stablecoins?.total ?? data?.stablecoins?.totalCirculatingUsd);
  if (stablecoinTotal == null || isFieldFallback(data?.stablecoins)) {
    warnings.push('Thiếu tổng vốn hóa Stablecoin (CoinGecko / DefiLlama).');
  }

  if (data?.onChainMetrics?.mvrv == null || isFieldFallback(data?.onChainMetrics)) {
    warnings.push('Thiếu chỉ số On-chain BTC MVRV (CoinMetrics).');
  }

  if ((data?.onChain?.difficulty == null && data?.onChain?.difficultyRaw == null) || isFieldFallback(data?.onChain)) {
    warnings.push('Thiếu độ khó khai thác Difficulty & Hashrate (Blockchain.info).');
  }

  const hasFed = data?.fedFundsRate != null && !isFieldFallback(data?.fedFundsRate);
  const hasCpi = data?.cpi != null && !isFieldFallback(data?.cpi);
  if (!hasFed && !hasCpi) {
    warnings.push('Thiếu chỉ số kinh tế vĩ mô FRED (Lãi suất Fed / CPI).');
  }

  const hasDxy = data?.dxy != null && !isFieldFallback(data?.dxy);
  const hasVix = data?.vix != null && !isFieldFallback(data?.vix);
  if (!hasDxy || !hasVix) {
    warnings.push('Thiếu chỉ số thị trường quốc tế DXY hoặc VIX.');
  }

  const hasSpotCvd = Array.isArray(data?.cvdHistory24hSpot) && data.cvdHistory24hSpot.length > 0 && !data?.cvdHistory24hSpot?.isFallback;
  const hasFutCvd = Array.isArray(data?.cvdHistory24h) && data.cvdHistory24h.length > 0 && !data?.cvdHistory24h?.isFallback;
  if (!hasSpotCvd || !hasFutCvd) {
    warnings.push('Thiếu dữ liệu dòng lệnh Spot CVD hoặc Futures CVD 24h.');
  }

  // 3. PUBLICATION_LAGGED FIELDS CHECK
  const flows = Array.isArray(etfHistory) ? etfHistory : [];
  const isEtfFallback = flows.length === 0 || flows.isFallback === true || flows.status === 'FALLBACK' || flows.source === 'STATIC_BUNDLE';
  if (flows.length === 0) {
    warnings.push('Chưa có lịch sử dòng tiền Spot ETF.');
    laggedInfo.push({ field: 'Spot ETF Flows', status: 'CHƯA CÓ LỊCH SỬ', detail: 'Chưa nạp lịch sử dòng tiền ETF từ Farside.' });
  } else if (isEtfFallback) {
    warnings.push('Dòng tiền Spot ETF đang dùng dữ liệu tĩnh fallback.');
    laggedInfo.push({ field: 'Spot ETF Flows', status: 'FALLBACK_TĨNH', detail: `Dữ liệu tĩnh cũ (${flows[flows.length - 1]?.date || '---'}) - loại khỏi bias score.` });
  } else {
    const latestFlow = flows[flows.length - 1];
    laggedInfo.push({ field: 'Spot ETF Flows', status: 'LAGGED_DAILY', detail: `Ngày quan sát gần nhất: ${latestFlow?.date || '---'}` });
  }

  const isCotFallback = !data?.cotData?.assetManager || isFieldFallback(data?.cotData);
  if (!data?.cotData?.assetManager) {
    warnings.push('Chưa có báo cáo vị thế CME COT.');
    laggedInfo.push({ field: 'CME COT Positioning', status: 'CHƯA CÓ DỮ LIỆU', detail: 'Chưa có báo cáo vị thế CME COT từ CFTC.' });
  } else if (isCotFallback) {
    warnings.push('Vị thế CME COT đang dùng baseline fallback.');
    laggedInfo.push({ field: 'CME COT Positioning', status: 'FALLBACK_TĨNH', detail: `Báo cáo baseline (${data.cotData.date || '---'}) - loại khỏi bias score.` });
  } else {
    laggedInfo.push({ field: 'CME COT Positioning', status: 'LAGGED_WEEKLY', detail: `Ngày báo cáo: ${data.cotData.date || 'Thứ 6 gần nhất'}` });
  }

  // Total checked fields = 14
  const totalCheckedFields = 14;
  const passedFields = Math.max(0, totalCheckedFields - blockingErrors.length - warnings.length);
  const completenessScore = Math.max(0, Math.min(100, Math.round((passedFields / totalCheckedFields) * 100)));

  return {
    isValid: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    laggedInfo,
    completenessScore
  };
}

/**
 * Xây dựng toàn bộ 5 tab dữ liệu chuẩn hóa cho Google Sheets
 */
export function buildGoogleSheetPayload(data, biasData, etfHoldings, etfHistory, options = {}) {
  const session = getCurrentSessionVN();
  const now = new Date();
  const timestampUtc = now.toISOString();
  const timestampVn = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';
  
  const validation = validateExportReadiness(data, biasData, etfHoldings, etfHistory, options);

  // ── 1. PRICES & TICKERS ───────────────────────────────────────────────────
  const btcPrice = toFiniteNumber(data?.btc?.price ?? options?.livePrice) || 0;
  const btcChange = toFiniteNumber(data?.btc?.change ?? options?.liveChange);
  const btcVolume = toFiniteNumber(data?.btc?.volume ?? options?.liveVolume);
  const btcHigh = toFiniteNumber(data?.btc?.high ?? options?.liveHigh);
  const btcLow = toFiniteNumber(data?.btc?.low ?? options?.liveLow);

  const ethPrice = toFiniteNumber(data?.ethTicker?.price ?? data?.eth?.price ?? data?.ethPrice?.price ?? data?.ethPrice ?? options?.liveEthPrice);
  const ethChange = toFiniteNumber(data?.ethTicker?.change ?? data?.eth?.change ?? data?.ethPrice?.change);
  const ethVolume = toFiniteNumber(data?.ethTicker?.volume ?? data?.eth?.volume);

  const solPrice = toFiniteNumber(data?.solTicker?.price ?? data?.sol?.price ?? data?.solPrice?.price ?? data?.solPrice ?? options?.liveSolPrice);
  const solChange = toFiniteNumber(data?.solTicker?.change ?? data?.sol?.change ?? data?.solPrice?.change);
  const solVolume = toFiniteNumber(data?.solTicker?.volume ?? data?.sol?.volume);

  // ── 2. DERIVATIVES & ORDER FLOW ───────────────────────────────────────────
  const fundingRate = toFiniteNumber(data?.fundingRate ?? options?.liveFunding);
  const openInterest = toFiniteNumber(data?.openInterest);
  const btcOiUsd = openInterest && btcPrice ? openInterest * btcPrice : null;

  const lsHistory = Array.isArray(data?.lsHistory) ? data.lsHistory : [];
  const latestLs = lsHistory.length > 0 ? toFiniteNumber(lsHistory[lsHistory.length - 1]?.longShortRatio) : null;
  const globalLs = toFiniteNumber(data?.longShortRatio ?? latestLs);
  const topLs = toFiniteNumber(data?.topTraderLsRatio);

  const spotCvd24 = toFiniteNumber(data?.cvdHistory24hSpot?.[data.cvdHistory24hSpot.length - 1]?.cvd);
  const futCvd24 = toFiniteNumber(data?.cvdHistory24h?.[data.cvdHistory24h.length - 1]?.cvd);
  const spotCvd7d = toFiniteNumber(data?.cvdHistory7dSpot?.[data.cvdHistory7dSpot.length - 1]?.cvd);
  const futCvd7d = toFiniteNumber(data?.cvdHistory7d?.[data.cvdHistory7d.length - 1]?.cvd);
  const spotCvd30d = toFiniteNumber(data?.cvdHistory30dSpot?.[data.cvdHistory30dSpot.length - 1]?.cvd);
  const futCvd30d = toFiniteNumber(data?.cvdHistory30d?.[data.cvdHistory30d.length - 1]?.cvd);

  let cvdDivergenceStatus = 'Chưa có phân kỳ rõ ràng';
  let cvdDivergenceDesc = 'Cả Spot và Futures cùng chiều biến động';
  if (spotCvd24 != null && futCvd24 != null) {
    if (spotCvd24 > 0 && futCvd24 < 0) {
      cvdDivergenceStatus = 'Spot Mua / Futures Short (Divergence)';
      cvdDivergenceDesc = 'Dòng tiền giao ngay hấp thụ cung, phái sinh Short đuổi -> Dễ có Short Squeeze';
    } else if (spotCvd24 < 0 && futCvd24 > 0) {
      cvdDivergenceStatus = 'Spot Bán / Futures Long (Bull Trap)';
      cvdDivergenceDesc = 'Phái sinh fomo Long nhưng Spot xả mạnh -> Rủi ro Long Squeeze cao';
    } else if (spotCvd24 > 0 && futCvd24 > 0) {
      cvdDivergenceStatus = 'Đồng Thuận Mua (Spot + Futures Bullish)';
      cvdDivergenceDesc = 'Cả lực mua giao ngay và lực kéo phái sinh đều xác nhận đà tăng';
    } else if (spotCvd24 < 0 && futCvd24 < 0) {
      cvdDivergenceStatus = 'Đồng Thuận Bán (Spot + Futures Bearish)';
      cvdDivergenceDesc = 'Áp lực bán tháo lan tỏa cả thị trường giao ngay và hợp đồng tương lai';
    }
  }

  const orderBook = data?.orderBook || {};
  const obiVal = toFiniteNumber(orderBook.obiPercent ?? data?.obiData?.obi);
  const orderBookBidVol = toFiniteNumber(orderBook.bidVolumeUsd ?? data?.obiData?.bidVol);
  const orderBookAskVol = toFiniteNumber(orderBook.askVolumeUsd ?? data?.obiData?.askVol);
  const topBidWall = orderBook.topBidWall || null;
  const topAskWall = orderBook.topAskWall || null;

  // ── 3. ON-CHAIN & MINING ──────────────────────────────────────────────────
  const btcMvrv = toFiniteNumber(data?.onChainMetrics?.mvrv);
  const btcMvrvDate = data?.onChainMetrics?.date || null;
  const ethMvrv = toFiniteNumber(data?.ethOnChainMetrics?.mvrv);
  const ethMvrvDate = data?.ethOnChainMetrics?.date || null;
  const btcNupl = btcMvrv != null && btcMvrv > 0 ? 1 - (1 / btcMvrv) : null;
  const btcSupplyProfit = btcMvrv != null && btcMvrv > 0 ? Math.max(28, Math.min(98.5, -8 + 47 * btcMvrv - 1.1 * btcMvrv * btcMvrv)) : null;

  const difficultyT = toFiniteNumber(data?.onChain?.difficulty);
  const hashRateEH = toFiniteNumber(data?.onChain?.hashRate);
  const btcActiveAddrs = toFiniteNumber(data?.onChainMetrics?.activeAddresses);
  const btcTxCount = toFiniteNumber(data?.onChainMetrics?.txCount ?? data?.onChain?.txCount24h);
  const prodCost = calculateBtcProductionCostRange(difficultyT);

  // ── 4. ETF FLOWS & CME COT ────────────────────────────────────────────────
  const fundsList = Array.isArray(etfHoldings?.funds) ? etfHoldings.funds : [];
  const etfTotalBtc = toFiniteNumber(etfHoldings?.total);

  const flowsList = Array.isArray(etfHistory) ? etfHistory : [];
  const latest7Flows = flowsList.slice(-7);
  const validFlows = latest7Flows.map(f => toFiniteNumber(f.flow)).filter(f => f != null);
  const etf7dNetTotal = validFlows.length > 0 ? validFlows.reduce((acc, v) => acc + v, 0) : null;
  const etfPosDays = validFlows.filter(v => v > 0).length;
  const etfNegDays = validFlows.filter(v => v < 0).length;
  const latestEtfDate = latest7Flows.length > 0 ? latest7Flows[latest7Flows.length - 1]?.date : null;
  const etfStatusLabel = latestEtfDate ? `PUBLISHED (${latestEtfDate})` : 'PENDING_UPDATE';

  const cotData = data?.cotData || null;
  const cotDate = cotData?.date || null;

  // ── 5. MACRO INDICATORS & CALENDAR ────────────────────────────────────────
  const fedFundsRate = toFiniteNumber(data?.fedFundsRate?.val ?? data?.fedFundsRate);
  const cpi = toFiniteNumber(data?.cpi?.val ?? data?.cpi);
  const realRateProxy = fedFundsRate != null && cpi != null ? parseFloat((fedFundsRate - cpi).toFixed(2)) : null;
  const tenYearYield = toFiniteNumber(data?.tenYearYield?.val ?? data?.tenYearYield);
  const dxy = toFiniteNumber(data?.dxy?.price ?? data?.dxy);
  const vix = toFiniteNumber(data?.vix?.price ?? data?.vix);
  const sp500Price = toFiniteNumber(data?.sp500?.price ?? data?.sp500);
  const sp500Change = toFiniteNumber(data?.sp500?.changePercent);
  const qqqPrice = toFiniteNumber(data?.qqq?.price ?? data?.qqq);
  const qqqChange = toFiniteNumber(data?.qqq?.changePercent);
  const highYield = toFiniteNumber(data?.highYield?.val ?? data?.highYield);
  const m2Supply = toFiniteNumber(data?.m2Supply?.val ?? data?.m2Supply);
  const netLiquidity = toFiniteNumber(data?.netLiquidity);

  let macroRegime = 'MIXED / TRANSITION';
  if (fedFundsRate != null && cpi != null) {
    if (fedFundsRate < 3.5 && cpi < 2.5) macroRegime = 'NỚI LỎNG (EASING)';
    else if (fedFundsRate >= 4.5 && cpi > 3.0) macroRegime = 'THẮT CHẶT (TIGHTENING)';
    else if (cpi <= 2.8 && fedFundsRate <= 4.5) macroRegime = 'MỞ RỘNG (EXPANSION)';
    else if (cpi > 3.5 && fedFundsRate >= 5.0) macroRegime = 'CO HẸP (CONTRACTION)';
  }

  const calendarEvents = Array.isArray(biasData?.upcomingEvents) && biasData.upcomingEvents.length > 0
    ? biasData.upcomingEvents
    : (Array.isArray(options?.calendarEvents) ? options.calendarEvents : []);

  // ── 6. SENTIMENT & MARKET BREADTH ─────────────────────────────────────────
  const fngVal = toFiniteNumber(data?.fngData?.value);
  const fngSentiment = data?.fngData?.sentiment || (fngVal != null ? (fngVal <= 25 ? 'Extreme Fear' : fngVal <= 45 ? 'Fear' : fngVal <= 55 ? 'Neutral' : fngVal <= 75 ? 'Greed' : 'Extreme Greed') : null);

  const globalData = data?.globalData || {};
  const stablecoins = data?.stablecoins || {};
  const stablecoinTotal = toFiniteNumber(stablecoins.total ?? stablecoins.totalCirculatingUsd);

  // ── 7. BIAS ENGINE ────────────────────────────────────────────────────────
  const biasTotal = toFiniteNumber(biasData?.score) ?? 0;
  const biasLabel = biasData?.label ?? 'TRUNG LẬP';
  const pillars = biasData?.pillars || { microstructure: 0, onChain: 0, institutional: 0, newsRisk: 0, macro: 0 };

  // ==========================================================================
  // TAB 1: OVERVIEW_BIAS
  // ==========================================================================
  const regime = biasData?.regime || {};
  const overview = [
    ['DANH MỤC / CHỈ SỐ', 'GIÁ TRỊ HIỆN TẠI', 'BIÊN ĐỘ / TRẠNG THÁI', 'ĐÁNH GIÁ ĐỊNH LƯỢNG & NGUỒN'],
    ['THÔNG TIN ĐỒNG BỘ', session.name, timestampVn, `Độ hoàn thiện: ${validation.completenessScore}% | Nguồn: ${options?.source || 'Web Client'}`],
    ['MARKET BIAS TOTAL', `${biasTotal > 0 ? '+' : ''}${biasTotal} / 100`, biasLabel, `Confidence: ${biasData?.confidence ?? '---'}% | Tổng hợp 4 trụ cột định lượng`],
    ['CHẾ ĐỘ BIAS 3 TẦNG', `Trend: ${regime.trend || 'N/A'}`, `Valuation: ${regime.valuation || 'N/A'} | Liquidity: ${regime.liquidity || 'N/A'}`, `Tactical: ${regime.tactical || 'BALANCED'}`],
    ['Trụ Cột 1: Institutional Flows (40%)', `${pillars.institutional > 0 ? '+' : ''}${pillars.institutional} / 100`, 'Spot ETF Flows + CME COT Positioning', 'Dòng tiền quỹ tổ chức Wall Street'],
    ['Trụ Cột 2: On-Chain & Network (25%)', `${pillars.onChain > 0 ? '+' : ''}${pillars.onChain} / 100`, 'MVRV (Anchor) + SSR + Addrs + Cost Floor + Tx', 'Định giá chuỗi khối cơ bản & thợ đào'],
    ['Trụ Cột 3: Macro Liquidity & Risk (20%)', `${(pillars.newsRisk ?? pillars.macro ?? 0) > 0 ? '+' : ''}${pillars.newsRisk ?? pillars.macro ?? 0} / 100`, 'Fed + CPI + Net Liq + HY Spread + DXY + 10Y + VIX', 'Môi trường thanh khoản vĩ mô toàn cầu'],
    ['Trụ Cột 4: Microstructure & Trend (15%)', `${pillars.microstructure > 0 ? '+' : ''}${pillars.microstructure} / 100`, 'BTC Trend MA + CVD + Funding + OI + F&G + L/S', 'Cấu trúc xu hướng kỹ thuật & dòng lệnh phái sinh'],
    ['Bitcoin (BTC/USDT)', fmtUsd(btcPrice), btcChange != null ? `${btcChange >= 0 ? '+' : ''}${fmt(btcChange)}% (24h)` : '---', `Vol 24h: ${fmtB(btcVolume)} | Biên độ: ${fmtUsd(btcLow, 0)} - ${fmtUsd(btcHigh, 0)}`],
    ['Ethereum (ETH/USDT)', fmtUsd(ethPrice), ethChange != null ? `${ethChange >= 0 ? '+' : ''}${fmt(ethChange)}% (24h)` : '---', `Vol 24h: ${fmtB(ethVolume)} | Binance Spot`],
    ['Solana (SOL/USDT)', fmtUsd(solPrice), solChange != null ? `${solChange >= 0 ? '+' : ''}${fmt(solChange)}% (24h)` : '---', `Vol 24h: ${fmtB(solVolume)} | Binance Spot`],
    ['Tổng Vốn Hóa Thị Trường (Total Cap)', fmtB(globalData.totalMarketCap), `BTC Dom: ${fmt(globalData.btcDominance, 1)}% | ETH Dom: ${fmt(globalData.ethDominance, 1)}%`, 'CoinGecko Global Market Breadth'],
    ['Tổng Vốn Hóa Stablecoin', fmtB(stablecoinTotal), `USDT: ${fmtB(stablecoins.usdt)} | USDC: ${fmtB(stablecoins.usdc)}`, 'Sức mua dự trữ trên sàn (CoinGecko/DefiLlama)'],
    ['Chỉ số Sợ Hãi & Tham Lam (F&G)', fngVal != null ? `${fngVal} / 100` : 'N/A', fngSentiment || 'UNKNOWN', fngVal != null ? (fngVal <= 25 ? 'Vùng Mua Gom Giá Trị (Extreme Fear)' : fngVal >= 75 ? 'Rủi Ro Đỉnh Cực Đại (Extreme Greed)' : 'Tâm Lý Cân Bằng (Neutral)') : 'Chưa có dữ liệu từ Alternative.me'],
    ['BTC Production Cost Floor (Est.)', prodCost.formatted, difficultyT ? `Difficulty: ${fmt(difficultyT, 1)}T | Hashrate: ${fmt(hashRateEH, 1)} EH/s` : '---', 'Energy Model 26 J/TH @ $0.05/kWh (Sàn giá hòa vốn thợ đào)']
  ];

  // ==========================================================================
  // TAB 2: DERIVATIVES_FLOW
  // ==========================================================================
  const derivatives = [
    ['CHỈ BÁO PHÁI SINH & VI CẤU TRÚC', 'GIÁ TRỊ QUAN SÁT', 'CHU KỲ / KHUNG', 'TÁC ĐỘNG / ĐÁNH GIÁ ĐỊNH LƯỢNG'],
    ['Binance BTC Funding Rate', fundingRate != null ? `${(fundingRate * 100).toFixed(4)}% (${(fundingRate * 3 * 365 * 100).toFixed(1)}%/năm)` : 'N/A', '8 Giờ', fundingRate > 0.0003 ? 'Longs quá nóng ⚠ (Rủi ro Long Squeeze)' : fundingRate < -0.0001 ? 'Shorts dồn ép (Tiềm năng Short Squeeze)' : 'Lành mạnh (Cân bằng cung cầu)'],
    ['Binance BTC Open Interest (OI)', openInterest != null ? `${fmt(openInterest, 0)} BTC (~${fmtB(btcOiUsd)})` : 'N/A', 'Realtime', 'Tổng khối lượng vị thế hợp đồng chưa thanh toán'],
    ['Global Accounts Long/Short Ratio', fmt(globalLs, 3), '1 Giờ', globalLs > 1.8 ? 'Đám đông nghiêng Long nặng (Retail crowded)' : globalLs < 0.8 ? 'Đám đông nghiêng Short nặng' : 'Tỷ lệ tài khoản cân bằng'],
    ['Top Trader Long/Short Ratio', fmt(topLs, 3), '1 Giờ', 'Vị thế tài khoản Top Trader vốn lớn trên Binance'],
    ['Spot CVD 24h (Binance Spot)', fmtCompactUsd(spotCvd24), '24 Giờ (1h)', spotCvd24 > 0 ? 'Dòng tiền Mua chủ động Spot (+)' : spotCvd24 < 0 ? 'Dòng tiền Bán chủ động Spot (-)' : 'Cân bằng'],
    ['Futures CVD 24h (Binance Futures)', fmtCompactUsd(futCvd24), '24 Giờ (1h)', futCvd24 > 0 ? 'Lực mua Taker Futures (+)' : futCvd24 < 0 ? 'Lực bán Taker Futures (-)' : 'Cân bằng'],
    ['Spot CVD 7 Ngày (4h)', fmtCompactUsd(spotCvd7d), '7 Ngày (4h)', spotCvd7d != null ? (spotCvd7d > 0 ? 'Tích lũy Spot trung hạn (+)' : 'Xả hàng Spot trung hạn (-)') : 'N/A'],
    ['Futures CVD 7 Ngày (4h)', fmtCompactUsd(futCvd7d), '7 Ngày (4h)', futCvd7d != null ? (futCvd7d > 0 ? 'Đòn bẩy nghiêng Long (+)' : 'Đòn bẩy nghiêng Short (-)') : 'N/A'],
    ['Spot CVD 30 Ngày (1d)', fmtCompactUsd(spotCvd30d), '30 Ngày (1d)', spotCvd30d != null ? (spotCvd30d > 0 ? 'Tích lũy Spot dài hạn (+)' : 'Phân phối Spot dài hạn (-)') : 'N/A'],
    ['Futures CVD 30 Ngày (1d)', fmtCompactUsd(futCvd30d), '30 Ngày (1d)', futCvd30d != null ? (futCvd30d > 0 ? 'Vị thế Long dài hạn (+)' : 'Vị thế Short dài hạn (-)') : 'N/A'],
    ['Đánh Giá Phân Kỳ Spot vs Futures', cvdDivergenceStatus, 'Đa khung', cvdDivergenceDesc],
    ['Order Book Imbalance (OBI Depth 100)', obiVal != null ? `${obiVal >= 0 ? '+' : ''}${fmt(obiVal, 1)}%` : 'N/A', 'Top 100 Bids/Asks', obiVal > 10 ? 'Phe Mua áp đảo sổ lệnh (Bid dominant)' : obiVal < -10 ? 'Phe Bán áp đảo sổ lệnh (Ask dominant)' : 'Sổ lệnh cân bằng'],
    ['Tổng Độ Sâu Sổ Lệnh Mua (Bids)', fmtCompactUsd(orderBookBidVol), 'Top 100 levels', 'Hỗ trợ thanh khoản Limit Buy tức thời'],
    ['Tổng Độ Sâu Sổ Lệnh Bán (Asks)', fmtCompactUsd(orderBookAskVol), 'Top 100 levels', 'Kháng cự thanh khoản Limit Sell tức thời'],
    ['Tường Mua Lớn Nhất (Whale Bid Wall)', topBidWall ? `$${fmt(topBidWall.price, 0)} (${fmtCompactUsd(topBidWall.notional)})` : '---', 'Displayed Liquidity', 'Vùng hỗ trợ có điều kiện (rủi ro rút lệnh/spoofing)'],
    ['Tường Bán Lớn Nhất (Whale Ask Wall)', topAskWall ? `$${fmt(topAskWall.price, 0)} (${fmtCompactUsd(topAskWall.notional)})` : '---', 'Displayed Liquidity', 'Vùng kháng cự có điều kiện (rủi ro rút lệnh/spoofing)']
  ];

  // ==========================================================================
  // TAB 3: ETF_ONCHAIN
  // ==========================================================================
  const etf_onchain = [
    ['QUỸ / CHỈ SỐ ON-CHAIN', 'SỐ LIỆU / GIÁ TRỊ THỰC TẾ', 'THỜI GIAN / ĐỘ TRỄ', 'Ý NGHĨA DÒNG TIỀN & ĐỊNH GIÁ'],
    ['Tổng Lượng BTC Spot ETF Mỹ Nắm Giữ', etfTotalBtc ? `${etfTotalBtc.toLocaleString()} BTC (~${fmtB(etfTotalBtc * btcPrice)})` : 'N/A', 'Bitbo Tracking', 'Tổng dự trữ tài sản của toàn bộ 11 quỹ Spot ETF Mỹ']
  ];

  if (fundsList.length > 0) {
    fundsList.forEach(f => {
      etf_onchain.push([
        `  • Quỹ ${f.name || 'ETF'}`,
        f.holdings ? `${f.holdings.toLocaleString()} BTC` : '---',
        f.marketShare ? `Thị phần: ${f.marketShare}` : 'Holdings',
        'Quỹ phát hành ETF giao ngay tại Mỹ'
      ]);
    });
  }

  etf_onchain.push([
    'Spot ETF Net Total (7 Phiên Quan Sát)',
    etf7dNetTotal != null ? `${etf7dNetTotal >= 0 ? '+' : ''}$${fmt(etf7dNetTotal, 1)}M` : 'N/A',
    `Ngày gần nhất: ${latestEtfDate || '---'}`,
    `Trạng thái: ${etfStatusLabel} | ${etfPosDays} ngày Dương / ${etfNegDays} ngày Âm`
  ]);

  if (latest7Flows.length > 0) {
    latest7Flows.forEach(fl => {
      const flowNum = toFiniteNumber(fl.flow);
      etf_onchain.push([
        `  • ETF Flow Ngày ${fl.date || '---'}`,
        flowNum != null ? `${flowNum >= 0 ? '+' : ''}$${fmt(flowNum, 1)}M USD` : '---',
        flowNum != null ? (flowNum >= 0 ? 'INFLOW (+)' : 'OUTFLOW (-)') : 'PENDING',
        'Farside Investors Official Daily Flow Data'
      ]);
    });
  }

  // CME COT Positioning
  etf_onchain.push([
    'CME Bitcoin Futures COT Open Interest',
    cotData?.openInterest != null ? `${cotData.openInterest.toLocaleString()} Hợp Đồng` : 'N/A',
    `Báo cáo: ${cotDate || '---'}`,
    'Độ trễ công bố: ~3-7 ngày (Thứ 6 hàng tuần phản ánh vị thế Thứ 3)'
  ]);

  if (cotData?.assetManager) {
    const am = cotData.assetManager;
    etf_onchain.push([
      '  • CME Asset Manager (Institutional)',
      `Net: ${am.net >= 0 ? '+' : ''}${am.net} (Long: ${am.long} / Short: ${am.short})`,
      am.netChange != null ? `Thay đổi tuần: ${am.netChange >= 0 ? '+' : ''}${am.netChange}` : '---',
      'Vị thế tích lũy mua dài hạn của các quỹ đầu tư quản lý tài sản'
    ]);
  }

  if (cotData?.leveragedFunds) {
    const lf = cotData.leveragedFunds;
    etf_onchain.push([
      '  • CME Leveraged Funds (Hedge Funds)',
      `Net: ${lf.net >= 0 ? '+' : ''}${lf.net} (Long: ${lf.long} / Short: ${lf.short})`,
      lf.netChange != null ? `Thay đổi tuần: ${lf.netChange >= 0 ? '+' : ''}${lf.netChange}` : '---',
      'Vị thế đầu cơ / arbitrage basis trading của các quỹ phòng hộ'
    ]);
  }

  // On-Chain Valuation
  etf_onchain.push(
    ['Bitcoin MVRV Ratio', btcMvrv != null ? fmt(btcMvrv, 2) : 'N/A', `Observation: ${btcMvrvDate || 'Daily'}`, btcMvrv != null ? (btcMvrv < 1.0 ? 'Vùng Đáy Tuyệt Đối (< 1.0)' : btcMvrv < 1.5 ? 'Vùng Tích Lũy Giá Rẻ (1.0 - 1.5)' : btcMvrv < 2.5 ? 'Định Giá Hợp Lý (1.5 - 2.5)' : 'Vùng Quá Nóng (> 2.5)') : 'CoinMetrics Community Data'],
    ['Bitcoin NUPL (Net Unrealized Profit/Loss)', btcNupl != null ? `${(btcNupl * 100).toFixed(1)}%` : 'N/A', 'MVRV Derived', 'Tỷ lệ lãi/lỗ chưa thực hiện toàn mạng lưới (Phụ thuộc MVRV)'],
    ['Bitcoin Supply in Profit (Model Est.)', btcSupplyProfit != null ? `${btcSupplyProfit.toFixed(1)}%` : 'N/A', 'Model Heuristic', 'Tỷ lệ nguồn cung đang có lãi (Heuristic phụ thuộc MVRV)'],
    ['Ethereum MVRV Ratio', ethMvrv != null ? fmt(ethMvrv, 2) : 'N/A', `Observation: ${ethMvrvDate || 'Daily'}`, 'CoinMetrics Community Data for ETH'],
    ['Bitcoin Mining Production Cost Floor', prodCost.formatted, 'Calculated', 'Sàn chi phí hòa vốn dàn máy thế hệ mới (26 J/TH @ $0.05/kWh)'],
    ['Bitcoin Network Hashrate', hashRateEH ? `${fmt(hashRateEH, 1)} EH/s` : 'N/A', 'Daily Avg', 'Sức mạnh tính toán bảo mật chuỗi khối Bitcoin'],
    ['Bitcoin Mining Difficulty', difficultyT ? `${fmt(difficultyT, 1)} T` : 'N/A', '2016 Blocks Adjustment', 'Độ khó thuật toán khai thác Bitcoin'],
    ['Bitcoin Active Addresses / Day', btcActiveAddrs ? btcActiveAddrs.toLocaleString() : 'N/A', '24 Giờ', 'Số địa chỉ ví gửi/nhận hoạt động trong ngày'],
    ['Bitcoin Transactions / 24h', btcTxCount ? btcTxCount.toLocaleString() : 'N/A', '24 Giờ', 'Số lượng giao dịch xác nhận on-chain']
  );

  // ==========================================================================
  // TAB 4: MACRO_CALENDAR
  // ==========================================================================
  const macro = [
    ['THỜI GIAN / CHỈ SỐ VĨ MÔ', 'SỐ LIỆU HIỆN TẠI', 'KỲ TRƯỚC / DỰ BÁO', 'MỨC ĐỘ ẢNH HƯỞNG', 'ĐÁNH GIÁ TÁC ĐỘNG THANH KHOẢN CRYPTO'],
    ['Lãi Suất Fed (Fed Funds Rate)', fedFundsRate != null ? `${fmt(fedFundsRate, 2)}%` : 'N/A', 'FRED Series FEDFUNDS', 'HIGH', fedFundsRate > 5.0 ? 'Chính sách tiền tệ thắt chặt (Chi phí vốn USD cao)' : 'Chính sách tiền tệ nới lỏng'],
    ['Lạm Phát Mỹ (CPI YoY)', cpi != null ? `${fmt(cpi, 2)}%` : 'N/A', 'FRED Series CPIAUCSL', 'HIGH', cpi > 3.0 ? 'Lạm phát dai dẳng (Hạn chế khả năng Fed hạ lãi suất)' : 'Lạm phát hạ nhiệt (Ủng hộ thanh khoản)'],
    ['Lãi Suất Thực Proxy (Real Rate = Fed - CPI)', realRateProxy != null ? `${realRateProxy >= 0 ? '+' : ''}${fmt(realRateProxy, 2)}%` : 'N/A', 'Ex-post Proxy', 'HIGH', realRateProxy > 2.0 ? 'Real Yield thực tế cao (Tạo áp lực lên tài sản rủi ro)' : 'Real Yield thấp/âm (Hỗ trợ định giá Crypto)'],
    ['Lợi Suất Trái Phiếu Mỹ 10 Năm (US 10Y)', tenYearYield != null ? `${fmt(tenYearYield, 2)}%` : 'N/A', 'FRED Series DGS10', 'HIGH', 'Chi phí chiết khấu dòng tiền định giá tài sản toàn cầu'],
    ['Chỉ Số Sức Mạnh Đô La Mỹ (DXY)', dxy != null ? fmt(dxy, 2) : 'N/A', 'Yahoo Finance', 'HIGH', dxy > 105 ? 'USD mạnh lên (Thắt chặt thanh khoản ngoại hối toàn cầu)' : dxy < 100 ? 'USD suy yếu (Dòng vốn chảy vào Crypto)' : 'DXY ổn định'],
    ['Chỉ Số Biến Động VIX (VIX Volatility)', vix != null ? fmt(vix, 2) : 'N/A', 'Yahoo Finance', 'MEDIUM', vix < 15 ? 'Khẩu vị rủi ro cao (Risk-On lành mạnh)' : vix > 25 ? 'Căng thẳng rủi ro thị trường (Risk-Off)' : 'Biến động bình thường'],
    ['Chỉ Số Chứng Khoán S&P 500 (SPX)', sp500Price != null ? fmt(sp500Price, 2) : 'N/A', sp500Change != null ? `${sp500Change >= 0 ? '+' : ''}${fmt(sp500Change)}%` : '---', 'MEDIUM', 'Tâm lý thị trường chứng khoán Phố Wall'],
    ['Chỉ Số Công Nghệ Nasdaq 100 (QQQ)', qqqPrice != null ? fmt(qqqPrice, 2) : 'N/A', qqqChange != null ? `${qqqChange >= 0 ? '+' : ''}${fmt(qqqChange)}%` : '---', 'MEDIUM', 'Tương quan tích cực với dòng tiền công nghệ và crypto'],
    ['Chênh Lệch Tín Dụng Rủi Ro (High Yield Spread)', highYield != null ? `${fmt(highYield, 2)}%` : 'N/A', 'FRED BAMLH0A0HYM2EY', 'MEDIUM', highYield > 4.5 ? 'Áp lực căng thẳng tín dụng doanh nghiệp' : 'Thị trường tín dụng lành mạnh'],
    ['Cung Tiền M2 Mỹ (M2 Money Supply)', m2Supply != null ? fmtB(m2Supply * 1e9) : 'N/A', 'FRED M2SL (Tỷ USD)', 'MEDIUM', 'Tổng thanh khoản tiền tệ lưu thông nền kinh tế Mỹ'],
    ['Thanh Khoản Ròng Fed (US Net Liquidity)', netLiquidity != null ? `$${fmt(netLiquidity, 2)}B` : 'N/A', 'Walcl - TGA - RRP', 'HIGH', 'Thước đo thanh khoản can thiệp trực tiếp từ Fed'],
    ['Đánh Giá Chế Độ Vĩ Mô (Macro Regime)', macroRegime, 'Tổng hợp đa biến', 'STRATEGIC', 'Kênh truyền dẫn thanh khoản chủ đạo sang thị trường tiền điện tử']
  ];

  macro.push(['--- LỊCH SỰ KIỆN KINH TẾ TUẦN NÀY ---', '---', '---', '---', '---']);

  if (calendarEvents.length > 0) {
    for (const ev of calendarEvents.slice(0, 10)) {
      macro.push([
        ev.timeStr || (ev.date ? String(ev.date).replace('T', ' ').substring(0, 16) : '---'),
        ev.title || 'Sự kiện kinh tế',
        `${ev.country || 'USD'} | Dự báo: ${ev.forecast || '---'} | Trước đó: ${ev.previous || '---'} | Thực tế: ${ev.actual || 'TBD'}`,
        (ev.impact || 'MEDIUM').toUpperCase(),
        ev.analysis || ((ev.impact || '').toLowerCase() === 'high' ? '⚠ Biến động mạnh thanh khoản USD' : 'Theo dõi phản ứng lợi suất')
      ]);
    }
  } else {
    macro.push(['---', 'Không có sự kiện vĩ mô biến động cao trong 24h tới', 'ALL', 'LOW', 'Thị trường vận động thuần theo cung cầu kỹ thuật']);
  }

  // ==========================================================================
  // TAB 5: AI_PROMPT_SUMMARY (Decision Lab Standardized 9-Section Context)
  // ==========================================================================
  const ai_summary_md = `
# BẢN NGỮ CẢNH DỮ LIỆU THỊ TRƯỜNG TOÀN DIỆN (AI DECISION LAB CONTRACT)
**Phiên:** ${session.name} (${session.code}) | **Thời gian cập nhật:** ${timestampVn} | **UTC:** ${timestampUtc}
**Trạng thái Dữ liệu:** Hoàn thiện ${validation.completenessScore}% | **Nguồn phát hành:** ${options?.source || 'Web Client'}

---

## 1. BỐI CẢNH VĨ MÔ & REAL-RATE PROXY
- **Lãi suất Fed (Fed Funds Rate):** ${fedFundsRate != null ? `${fmt(fedFundsRate, 2)}%` : 'N/A'}
- **Lạm phát CPI Mỹ (YoY):** ${cpi != null ? `${fmt(cpi, 2)}%` : 'N/A'}
- **Lãi suất thực Proxy (Fed Funds - CPI):** ${realRateProxy != null ? `${realRateProxy >= 0 ? '+' : ''}${fmt(realRateProxy, 2)}%` : 'N/A'}
- **Lợi suất Trái phiếu 10 Năm (US 10Y):** ${tenYearYield != null ? `${fmt(tenYearYield, 2)}%` : 'N/A'}
- **Chỉ số Sức mạnh Đô la Mỹ (DXY):** ${dxy != null ? fmt(dxy, 2) : 'N/A'}
- **Chỉ số Biến động VIX:** ${vix != null ? fmt(vix, 2) : 'N/A'}
- **Chứng khoán Mỹ:** S&P 500: ${sp500Price != null ? fmt(sp500Price, 2) : 'N/A'} (${sp500Change != null ? `${sp500Change >= 0 ? '+' : ''}${fmt(sp500Change)}%` : '---'}) | QQQ: ${qqqPrice != null ? fmt(qqqPrice, 2) : 'N/A'}
- **Chênh lệch Tín dụng Rủi ro (High Yield Spread):** ${highYield != null ? `${fmt(highYield, 2)}%` : 'N/A'}
- **Cung tiền M2 Mỹ:** ${m2Supply != null ? fmtB(m2Supply * 1e9) : 'N/A'}
- **Thanh khoản Ròng Fed (Net Liquidity):** ${netLiquidity != null ? `$${fmt(netLiquidity, 2)}B` : 'N/A'}
- **Phân loại Chế độ Vĩ mô:** **${macroRegime}**

### SỰ KIỆN KINH TẾ TRỌNG TÂM (FAIRECONOMY / FOREXFACTORY)
${calendarEvents.length > 0 ? calendarEvents.slice(0, 6).map(e => `- [${(e.impact || 'MEDIUM').toUpperCase()}] **${e.title}** (${e.country || 'USD'}) lúc ${e.timeStr || (e.date ? String(e.date).substring(11, 16) : '---')} | Dự báo: ${e.forecast || 'N/A'} | Trước: ${e.previous || 'N/A'} | Thực tế: ${e.actual || 'TBD'}`).join('\n') : '- Không có sự kiện vĩ mô biến động cao trong 24h tới.'}

---

## 2. THỊ TRƯỜNG, GIÁ CẢ & ĐỘ RỘNG (MARKET BREADTH)
- **Bitcoin (BTC/USDT):** **${fmtUsd(btcPrice)}** (${btcChange != null ? `${btcChange >= 0 ? '+' : ''}${fmt(btcChange)}% 24h` : '---'}) | Vol 24h: ${fmtB(btcVolume)} | Biên độ 24h: ${fmtUsd(btcLow, 0)} - ${fmtUsd(btcHigh, 0)}
- **Ethereum (ETH/USDT):** **${fmtUsd(ethPrice)}** (${ethChange != null ? `${ethChange >= 0 ? '+' : ''}${fmt(ethChange)}% 24h` : '---'}) | Vol 24h: ${fmtB(ethVolume)}
- **Solana (SOL/USDT):** **${fmtUsd(solPrice)}** (${solChange != null ? `${solChange >= 0 ? '+' : ''}${fmt(solChange)}% 24h` : '---'}) | Vol 24h: ${fmtB(solVolume)}
- **Tỷ trọng Thị phần (Dominance):** BTC Dom: **${fmt(globalData.btcDominance, 1)}%** | ETH Dom: **${fmt(globalData.ethDominance, 1)}%**
- **Tổng Vốn Hóa Toàn Thị Trường:** **${fmtB(globalData.totalMarketCap)}**
- **Tổng Vốn Hóa Stablecoin:** **${fmtB(stablecoinTotal)}** (USDT: ${fmtB(stablecoins.usdt)} | USDC: ${fmtB(stablecoins.usdc)})
- **Chỉ số Sợ hãi & Tham lam (Fear & Greed):** **${fngVal != null ? `${fngVal}/100` : 'N/A'}** (${fngSentiment || 'UNKNOWN'})

---

## 3. ĐỊNH GIÁ ON-CHAIN & MẠNG LƯỚI KHAI THÁC
- **BTC MVRV Ratio:** **${btcMvrv != null ? fmt(btcMvrv, 2) : 'N/A'}** (Ngày quan sát: ${btcMvrvDate || 'Daily'})
- **BTC NUPL (Net Unrealized Profit/Loss):** **${btcNupl != null ? `${(btcNupl * 100).toFixed(1)}%` : 'N/A'}** (Heuristic phụ thuộc MVRV)
- **BTC Supply in Profit (% Nguồn cung có lãi):** **${btcSupplyProfit != null ? `${btcSupplyProfit.toFixed(1)}%` : 'N/A'}** (Model derived)
- **ETH MVRV Ratio:** **${ethMvrv != null ? fmt(ethMvrv, 2) : 'N/A'}** (Ngày quan sát: ${ethMvrvDate || 'Daily'})
- **Chi Phí Khai Thác Sàn (Production Cost Floor):** **${prodCost.formatted}** (Energy Model 26 J/TH @ $0.05/kWh)
- **Hashrate Mạng Lưới:** **${hashRateEH ? `${fmt(hashRateEH, 1)} EH/s` : 'N/A'}** | **Difficulty:** **${difficultyT ? `${fmt(difficultyT, 1)} T` : 'N/A'}**
- **Địa Chỉ Hoạt Động (Active Addresses 24h):** **${btcActiveAddrs ? btcActiveAddrs.toLocaleString() : 'N/A'}** | **Số Giao Dịch 24h:** **${btcTxCount ? btcTxCount.toLocaleString() : 'N/A'}**

---

## 4. DÒNG TIỀN TỔ CHỨC (SPOT ETF) & VỊ THẾ CME COT
- **Tổng Số Lượng BTC Spot ETF Mỹ Nắm Giữ:** **${etfTotalBtc ? `${etfTotalBtc.toLocaleString()} BTC (~${fmtB(etfTotalBtc * btcPrice)})` : 'N/A'}**
- **Spot ETF Net Flow 7 Phiên Quan Sát:** **${etf7dNetTotal != null ? `${etf7dNetTotal >= 0 ? '+' : ''}$${fmt(etf7dNetTotal, 1)}M USD` : 'N/A'}** (${etfPosDays} ngày Dương / ${etfNegDays} ngày Âm)
- **Trạng Thái Công Bố Dòng Tiền ETF:** **${etfStatusLabel}**
- **Chi Tiết Flow ETF 7 Ngày Gần Nhất:**
${latest7Flows.length > 0 ? latest7Flows.map(f => `  - Ngày ${f.date || '---'}: ${toFiniteNumber(f.flow) != null ? `${toFiniteNumber(f.flow) >= 0 ? '+' : ''}$${fmt(toFiniteNumber(f.flow), 1)}M USD` : 'PENDING'}`).join('\n') : '  - Chưa có dữ liệu lịch sử flow.'}
- **Vị Thế CME Bitcoin Futures (COT Report):**
  - Báo cáo ngày: **${cotDate || 'N/A'}** (Độ trễ công bố tự nhiên: 3-7 ngày)
  - CME Open Interest: **${cotData?.openInterest != null ? `${cotData.openInterest.toLocaleString()} hợp đồng` : 'N/A'}**
  - Asset Manager (Institutional): **Net ${cotData?.assetManager?.net >= 0 ? '+' : ''}${cotData?.assetManager?.net ?? 'N/A'}** (Long: ${cotData?.assetManager?.long ?? '---'} / Short: ${cotData?.assetManager?.short ?? '---'}) | Thay đổi: ${cotData?.assetManager?.netChange ?? '---'}
  - Leveraged Funds (Hedge Funds): **Net ${cotData?.leveragedFunds?.net >= 0 ? '+' : ''}${cotData?.leveragedFunds?.net ?? 'N/A'}** (Long: ${cotData?.leveragedFunds?.long ?? '---'} / Short: ${cotData?.leveragedFunds?.short ?? '---'}) | Thay đổi: ${cotData?.leveragedFunds?.netChange ?? '---'}

---

## 5. THỊ TRƯỜNG PHÁI SINH & DÒNG LỆNH KHỚP CHỦ ĐỘNG
- **Binance BTC Funding Rate:** **${fundingRate != null ? `${(fundingRate * 100).toFixed(4)}%` : 'N/A'}** (${fundingRate != null ? (fundingRate > 0.0003 ? 'Longs quá nóng' : fundingRate < -0.0001 ? 'Shorts dồn ép' : 'Cân bằng') : '---'})
- **Binance Open Interest (OI):** **${openInterest != null ? `${fmt(openInterest, 0)} BTC` : 'N/A'}** (~${fmtB(btcOiUsd)})
- **Tỷ Lệ Long/Short Tài Khoản (Global):** **${fmt(globalLs, 3)}** | **Top Trader L/S:** **${fmt(topLs, 3)}**
- **CVD Khớp Lệnh Chủ Động (Taker Volume Imbalance):**
  - Spot CVD 24h: **${fmtCompactUsd(spotCvd24)}** | Futures CVD 24h: **${fmtCompactUsd(futCvd24)}**
  - Spot CVD 7d: **${fmtCompactUsd(spotCvd7d)}** | Futures CVD 7d: **${fmtCompactUsd(futCvd7d)}**
  - Spot CVD 30d: **${fmtCompactUsd(spotCvd30d)}** | Futures CVD 30d: **${fmtCompactUsd(futCvd30d)}**
- **Đánh Giá Phân Kỳ Spot vs Futures:** **${cvdDivergenceStatus}** (${cvdDivergenceDesc})

---

## 6. THANH KHOẢN HIỂN THỊ & SỔ LỆNH (ORDER BOOK & OBI)
- **Order Book Imbalance (OBI Depth 100):** **${obiVal != null ? `${obiVal >= 0 ? '+' : ''}${fmt(obiVal, 1)}%` : 'N/A'}**
- **Độ Sâu Sổ Lệnh:** Bids (Mua): **${fmtCompactUsd(orderBookBidVol)}** vs Asks (Bán): **${fmtCompactUsd(orderBookAskVol)}**
- **Tường Thanh Khoản Lớn (Whale Walls):**
  - Top Bid Wall: **${topBidWall ? `$${fmt(topBidWall.price, 0)} (${fmtCompactUsd(topBidWall.notional)})` : 'N/A'}**
  - Top Ask Wall: **${topAskWall ? `$${fmt(topAskWall.price, 0)} (${fmtCompactUsd(topAskWall.notional)})` : 'N/A'}**

---

## 7. ĐÁNH GIÁ MARKET BIAS ENGINE & 3-LAYER REGIME
- **Tổng Điểm Định Lượng:** **${biasTotal > 0 ? '+' : ''}${biasTotal} / 100** -> Trạng thái: **${biasLabel}** (Độ tin cậy: ${biasData?.confidence ?? '---'}%)
- **Phân Tầng Cấu Trúc (3-Layer Regime):**
  - *Valuation Bias (Định giá):* **${regime.valuation || 'FAIR_VALUE'}**
  - *Trend Bias (Cấu trúc xu hướng):* **${regime.trend || 'UNKNOWN'}**
  - *Macro Liquidity (Thanh khoản vĩ mô):* **${regime.liquidity || 'NEUTRAL'}**
  - *Tactical Bias (Chiến thuật/Đòn bẩy):* **${regime.tactical || 'BALANCED'}**
- **Điểm 4 Trụ Cột Thành Phần:**
  - *Institutional Flows (40%):* **${pillars.institutional}/100**
  - *On-Chain & Network (25%):* **${pillars.onChain}/100**
  - *Macro Liquidity & Risk (20%):* **${pillars.newsRisk ?? pillars.macro ?? 0}/100**
  - *Microstructure & Trend (15%):* **${pillars.microstructure}/100**

---

## 8. NGUYÊN TẮC PHÂN TÍCH DÀNH CHO AI (ANTI-HALLUCINATION CONTRACT)
1. **Tuyệt đối tuân thủ bằng chứng:** Chỉ sử dụng và trích dẫn các số liệu thực tế có mặt trực tiếp trong 7 phần phía trên. Bất kỳ chỉ số nào mang giá trị 'N/A' hoặc 'UNKNOWN' phải được gắn thẻ [CHƯA BIẾT].
2. **Đối chiếu mâu thuẫn tín hiệu:** Phân tích rõ phân kỳ giữa Giá vs CVD, Spot vs Futures, Dòng tiền tổ chức ETF vs Vị thế đòn bẩy phái sinh.
3. **Phân định rõ khung thời gian:** 
   - 0-24h (Chiến thuật): Ưu tiên Funding, CVD, OBI, Whale Walls.
   - 1-7d (Swing): Ưu tiên Cấu trúc giá, Spot ETF net flow 7d, OI change.
   - 2-12w (Vị thế): Ưu tiên Vĩ mô, MVRV, Lãi suất thực, CME COT.
4. **Quy tắc Quản trị Rủi ro:** Chỉ đề xuất setup khi tỷ lệ R:R >= 1.8 và có điều kiện kích hoạt/vô hiệu hóa rõ ràng. Nếu tín hiệu mâu thuẫn hoặc chưa đủ xác nhận, ghi rõ **KHÔNG GIAO DỊCH (NO TRADE)**.
`.trim();

  return {
    sessionName: session.name,
    sessionCode: session.code,
    timestamp: timestampVn,
    timestampUtc,
    validation,
    overview,
    derivatives,
    etf_onchain,
    macro,
    ai_summary_md
  };
}

/**
 * Gửi payload trực tiếp lên Google Apps Script Webhook từ trình duyệt
 */
export async function syncToGoogleSheetsFromBrowser(webhookUrl, dashboardData, biasData, etfHoldings, etfHistory, options = {}) {
  if (!webhookUrl || !webhookUrl.trim().startsWith('http')) {
    throw new Error('Chưa cấu hình Google Sheet Webhook URL hợp lệ trong Cài đặt.');
  }

  // 1. Chạy validation
  const validation = validateExportReadiness(dashboardData, biasData, etfHoldings, etfHistory, options);
  if (!validation.isValid) {
    const errorList = validation.blockingErrors.map(e => `• ${e}`).join('\n');
    throw new Error(`Không thể xuất Google Sheet do thiếu dữ liệu bắt buộc:\n${errorList}`);
  }

  // 2. Xây dựng payload chuẩn hóa
  const payload = buildGoogleSheetPayload(dashboardData, biasData, etfHoldings, etfHistory, {
    ...options,
    source: 'Browser Web Client'
  });

  // 3. Gửi text/plain để tránh CORS preflight block trên Google Apps Script
  const cleanUrl = webhookUrl.trim();
  const jsonBody = JSON.stringify(payload);

  try {
    const response = await fetch(cleanUrl, {
      method: 'POST',
      mode: 'no-cors', // Apps Script redirect 302
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: jsonBody
    });

    return {
      status: 'success',
      session: payload.sessionName,
      timestamp: payload.timestamp,
      completenessScore: validation.completenessScore,
      warnings: validation.warnings,
      message: `Đã gửi thành công dữ liệu phiên ${payload.sessionName} lên Google Sheets!`
    };
  } catch (err) {
    throw new Error(`Lỗi kết nối Webhook: ${err.message}`);
  }
}
