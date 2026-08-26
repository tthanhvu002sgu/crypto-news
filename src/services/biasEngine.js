/**
 * Market Bias Engine Service
 * Calculates an overall BTC market bias score from -100 to +100
 * using 4 balanced, cross-verified pillars calibrated for macro, on-chain & swing trend:
 * 
 * 1. Institutional Flows & Capital (40%):
 *    - Spot ETF 7-Day Net Flow (28%)
 *    - CME COT Institutional Asset Managers (12%)
 * 
 * 2. On-Chain Fundamentals & Network (25%):
 *    - MVRV Ratio (Single Valuation Anchor) (8%)
 *    - Stablecoin Supply Ratio (SSR) Oscillator Z-Score (5%)
 *    - Active Addresses & Network Activity (4%)
 *    - Mining Production Cost Floor (4%)
 *    - Network Transaction Volume / Demand (4%)
 * 
 * 3. Macro Liquidity & Risk Shock (20%):
 *    - Monetary Policy & Real Rate Pulse (Fed Funds, CPI, Real Rate, Unrate) (6%)
 *    - US Net Liquidity & Credit Stress (Net Liquidity, High-Yield Spread, M2) (5%)
 *    - Global Currency & Discount Rates (DXY Dollar Index, US 10Y Yield) (4%)
 *    - Equities Risk Appetite (S&P 500 / Nasdaq 100) (2%)
 *    - VIX Volatility & 24h High Impact Calendar Shock (3%)
 * 
 * 4. Market Microstructure & BTC Trend Regime (15%):
 *    - BTC Trend & Price Regime (MA50/MA200, 30D/90D Momentum, Realized Vol) (3%)
 *    - Spot CVD 24h/7d/30d (3%)
 *    - Futures CVD 24h/7d/30d (2%)
 *    - Funding Rate Confluence (Cross-checked with Spot CVD) (2%)
 *    - Open Interest Surge & Leverage Action (2%)
 *    - Fear & Greed Index (2%)
 *    - Retail Long/Short Ratio (1%)
 */

const MAX_SCORING_WEIGHT = 0.95;

export function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/,/g, '').replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Calculates trend metrics, moving averages and realized volatility from daily candles
 */
export function calculateBtcTrendRegime(dailyKlines, currentPrice = null) {
  if (!Array.isArray(dailyKlines) || dailyKlines.length < 14) {
    return {
      hasData: false,
      signal: 0,
      status: 'No daily trend data',
      ma50: null,
      ma200: null,
      slope50: null,
      return7d: null,
      return30d: null,
      return90d: null,
      realizedVol30d: null,
      regimeLabel: 'UNKNOWN',
    };
  }

  const closes = dailyKlines
    .map((k) => (typeof k === 'object' && k !== null ? toFiniteNumber(k.close ?? k[4]) : toFiniteNumber(k)))
    .filter((v) => v != null && v > 0);

  if (closes.length < 14) {
    return {
      hasData: false,
      signal: 0,
      status: 'Insufficient closed candles',
      ma50: null,
      ma200: null,
      slope50: null,
      return7d: null,
      return30d: null,
      return90d: null,
      realizedVol30d: null,
      regimeLabel: 'UNKNOWN',
    };
  }

  const len = closes.length;
  const refPrice = toFiniteNumber(currentPrice) || closes[len - 1];

  // Moving averages
  const ma50Len = Math.min(50, len);
  const ma50Slice = closes.slice(len - ma50Len);
  const ma50 = ma50Slice.reduce((a, b) => a + b, 0) / ma50Len;

  let ma200 = null;
  if (len >= 100) {
    const ma200Len = Math.min(200, len);
    const ma200Slice = closes.slice(len - ma200Len);
    ma200 = ma200Slice.reduce((a, b) => a + b, 0) / ma200Len;
  }

  // MA50 slope (20 bars ago)
  let slope50 = 0;
  if (len >= 70) {
    const past50Slice = closes.slice(len - 70, len - 20);
    const pastMa50 = past50Slice.reduce((a, b) => a + b, 0) / 50;
    slope50 = pastMa50 > 0 ? ((ma50 - pastMa50) / pastMa50) * 100 : 0;
  }

  // Returns
  const price7dAgo = len >= 8 ? closes[len - 8] : closes[0];
  const return7d = price7dAgo > 0 ? ((refPrice - price7dAgo) / price7dAgo) * 100 : 0;

  const price30dAgo = len >= 31 ? closes[len - 31] : closes[0];
  const return30d = price30dAgo > 0 ? ((refPrice - price30dAgo) / price30dAgo) * 100 : 0;

  const price90dAgo = len >= 91 ? closes[len - 91] : null;
  const return90d = price90dAgo && price90dAgo > 0 ? ((refPrice - price90dAgo) / price90dAgo) * 100 : null;

  // 30D Realized Volatility (Annualized standard deviation of daily returns)
  let realizedVol30d = null;
  const volWindow = closes.slice(Math.max(0, len - 31));
  if (volWindow.length >= 10) {
    const dailyReturns = [];
    for (let i = 1; i < volWindow.length; i++) {
      if (volWindow[i - 1] > 0 && volWindow[i] > 0) {
        dailyReturns.push(Math.log(volWindow[i] / volWindow[i - 1]));
      }
    }
    if (dailyReturns.length >= 8) {
      const meanRet = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / (dailyReturns.length - 1);
      realizedVol30d = Math.sqrt(Math.max(0, variance)) * Math.sqrt(365) * 100;
    }
  }

  // Determine structural trend signal (-1.0 to +1.0)
  let trendScore = 0;
  let regimeLabel = 'SIDEWAYS / RANGE';

  const above50 = refPrice > ma50;
  const above200 = ma200 != null ? refPrice > ma200 : above50;
  const goldenCross = ma200 != null ? ma50 > ma200 : true;

  if (above50 && above200 && goldenCross) {
    if (slope50 > 1.5 && return30d > 5) {
      trendScore = 1.0;
      regimeLabel = 'STRONG UPTREND';
    } else {
      trendScore = 0.7;
      regimeLabel = 'UPTREND';
    }
  } else if (above50 && !above200) {
    trendScore = 0.3;
    regimeLabel = 'EARLY RECOVERY';
  } else if (!above50 && above200) {
    trendScore = -0.3;
    regimeLabel = 'PULLBACK IN BULL';
  } else if (!above50 && !above200 && !goldenCross) {
    if (slope50 < -1.5 && return30d < -5) {
      trendScore = -1.0;
      regimeLabel = 'STRONG DOWNTREND';
    } else {
      trendScore = -0.7;
      regimeLabel = 'DOWNTREND';
    }
  } else {
    trendScore = clamp(return30d / 25);
    regimeLabel = 'SIDEWAYS / RANGE';
  }

  const ma200Str = ma200 != null ? ` | MA200: $${Math.round(ma200).toLocaleString()}` : '';
  const statusStr = `${regimeLabel} (Giá ${above50 ? '>' : '<'} MA50: $${Math.round(ma50).toLocaleString()}${ma200Str} • 30D: ${return30d >= 0 ? '+' : ''}${return30d.toFixed(1)}%)`;

  return {
    hasData: true,
    signal: trendScore,
    status: statusStr,
    ma50,
    ma200,
    slope50,
    return7d,
    return30d,
    return90d,
    realizedVol30d,
    regimeLabel,
  };
}

export function calculateMarketBias(data, etfHistory = []) {
  if (!data) {
    return {
      score: 0,
      label: 'NEUTRAL',
      color: 'var(--text-slate-400)',
      confidence: 0,
      calendarRisk: 'LOW',
      pillars: { institutional: 0, onChain: 0, newsRisk: 0, microstructure: 0 },
      signals: [],
      upcomingEvents: [],
      regime: {
        valuation: 'FAIR_VALUE',
        trend: 'UNKNOWN',
        liquidity: 'NEUTRAL',
        tactical: 'BALANCED',
        details: {},
      },
    };
  }

  const signals = [];
  let availableWeight = 0;
  let calendarRiskLevel = 'LOW';
  const upcomingEvents = [];

  // ----------------------------------------------------
  // PILLAR 1: INSTITUTIONAL FLOWS & CAPITAL (40%)
  // ----------------------------------------------------
  let instScoreSum = 0;

  // 1A. Spot ETF 7-Day Net Flow (28%)
  let etfSignal = 0;
  let etfStatus = 'No data';
  if (Array.isArray(etfHistory) && etfHistory.length > 0) {
    const allFlows = etfHistory.map((item) => toFiniteNumber(item.flow)).filter((flow) => flow != null);
    const last7 = allFlows.slice(-7);
    const sum7d = last7.reduce((acc, flow) => acc + flow, 0);
    const flowStr = `${sum7d >= 0 ? '+' : ''}$${sum7d.toFixed(1)}M`;

    if (sum7d > 800) { etfSignal = 1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Gom rất mạnh)`; }
    else if (sum7d > 250) { etfSignal = 0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Vào ổn định)`; }
    else if (sum7d > -250) { etfSignal = 0.0; etfStatus = `ETF Flow 7D: ${flowStr} (Đi ngang)`; }
    else if (sum7d > -800) { etfSignal = -0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Rút nhẹ)`; }
    else { etfSignal = -1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Rút rất mạnh)`; }

    const typicalDailyFlow = median(allFlows.map((flow) => Math.abs(flow)));
    if (typicalDailyFlow != null && last7.length > 0) {
      etfSignal = clamp(Math.tanh(sum7d / Math.max(250, typicalDailyFlow * 3)));
      etfStatus = `ETF Flow 7D: ${flowStr}`;
    }

    instScoreSum += etfSignal * 0.28;
    availableWeight += 0.28;
    signals.push({ name: 'ETF 7D Net Flow', weight: '28%', score: etfSignal * 28, status: etfStatus, pillar: 'institutional' });
  }

  // 1B. CME COT Institutional Flow (12%)
  let cotSignal = 0;
  let cotStatus = 'No data';
  if (data.cotData?.assetManager) {
    const netPos = toFiniteNumber(data.cotData.assetManager.net);
    const netChange = toFiniteNumber(data.cotData.assetManager.netChange);
    if (netPos != null) {
      if (netPos > 3000) { cotSignal = 1.0; cotStatus = `CME Asset Mgr Net +${netPos} (Long áp đảo)`; }
      else if (netPos > 1000) { cotSignal = 0.5; cotStatus = `CME Asset Mgr Net +${netPos} (Long ưu thế)`; }
      else if (netPos > -1000) { cotSignal = 0.0; cotStatus = `CME Asset Mgr Net ${netPos} (Cân bằng)`; }
      else if (netPos > -3000) { cotSignal = -0.5; cotStatus = `CME Asset Mgr Net ${netPos} (Short ưu thế)`; }
      else { cotSignal = -1.0; cotStatus = `CME Asset Mgr Net ${netPos} (Short áp đảo)`; }

      if (netChange != null) {
        if (netChange > 500 && cotSignal >= 0) cotSignal = Math.min(1.0, cotSignal + 0.2);
        else if (netChange < -500 && cotSignal <= 0) cotSignal = Math.max(-1.0, cotSignal - 0.2);
      }

      instScoreSum += cotSignal * 0.12;
      availableWeight += 0.12;
      signals.push({ name: 'CME COT Flow', weight: '12%', score: cotSignal * 12, status: cotStatus, pillar: 'institutional' });
    }
  }

  // ----------------------------------------------------
  // PILLAR 2: ON-CHAIN FUNDAMENTALS & NETWORK (25%)
  // ----------------------------------------------------
  let onChainScoreSum = 0;
  const mvrv = toFiniteNumber(data.onChainMetrics?.mvrv);

  // 2A. MVRV Ratio (Single Valuation Anchor - 8%)
  let mvrvSignal = 0;
  let mvrvStatus = 'No data';
  if (mvrv != null) {
    if (mvrv < 1.0) { mvrvSignal = 1.0; mvrvStatus = `MVRV ${mvrv} (Rất rẻ / Vùng đáy)`; }
    else if (mvrv < 1.4) { mvrvSignal = 0.7; mvrvStatus = `MVRV ${mvrv} (Vùng tích lũy tốt)`; }
    else if (mvrv < 2.2) { mvrvSignal = 0.2; mvrvStatus = `MVRV ${mvrv} (Định giá hợp lý)`; }
    else if (mvrv < 2.8) { mvrvSignal = -0.3; mvrvStatus = `MVRV ${mvrv} (Giá hơi cao)`; }
    else { mvrvSignal = -1.0; mvrvStatus = `MVRV ${mvrv} (Vùng giá quá nóng / Quá định giá)`; }

    mvrvSignal = clamp(-Math.tanh((mvrv - 2.0) / 0.75));
    onChainScoreSum += mvrvSignal * 0.08;
    availableWeight += 0.08;
    signals.push({ name: 'MVRV Valuation Ratio', weight: '8%', score: mvrvSignal * 8, status: mvrvStatus, pillar: 'onChain' });
  }

  // 2B. SSR (Stablecoin Supply Ratio) Oscillator (5%)
  let ssrSignal = 0;
  let ssrStatus = 'No data';
  const p = data.btc?.price;
  const m = (typeof data.ssrMa === 'object' && data.ssrMa?.stablecoinTotal) || data.stablecoins?.total;
  if (p && m && typeof data.ssrMa === 'object' && data.ssrMa?.ma200) {
    const ssr = (p * 19740000) / m;
    const z = data.ssrMa.stdDev200 > 0 ? (ssr - data.ssrMa.ma200) / data.ssrMa.stdDev200 : 0;
    if (z < -2) { ssrSignal = 1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Oversold - Sức mua chờ lớn)`; }
    else if (z < -1) { ssrSignal = 0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Sức mua mạnh)`; }
    else if (z < 1) { ssrSignal = 0.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Bình thường)`; }
    else if (z < 2) { ssrSignal = -0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Cạn sức mua)`; }
    else { ssrSignal = -1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Overheated - Hết tiền mua)`; }
     
    onChainScoreSum += ssrSignal * 0.05;
    availableWeight += 0.05;
    signals.push({ name: 'Stablecoin Supply Ratio (SSR)', weight: '5%', score: ssrSignal * 5, status: ssrStatus, pillar: 'onChain' });
  }

  // 2C. Active Addresses (4%)
  let addrSignal = 0;
  let addrStatus = 'No data';
  if (data.onChainMetrics?.activeAddresses) {
    const addrs = toFiniteNumber(data.onChainMetrics.activeAddresses);
    if (addrs != null && addrs > 0) {
      if (addrs > 1000000) { addrSignal = 1.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng cực sôi động)`; }
      else if (addrs > 850000) { addrSignal = 0.5; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng hoạt động tốt)`; }
      else if (addrs > 700000) { addrSignal = 0.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng bình thường)`; }
      else { addrSignal = -0.6; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng suy giảm hoạt động)`; }

      onChainScoreSum += addrSignal * 0.04;
      availableWeight += 0.04;
      signals.push({ name: 'Active Addresses Activity', weight: '4%', score: addrSignal * 4, status: addrStatus, pillar: 'onChain' });
    }
  }

  // 2D. Mining Production Cost Floor (4%)
  let miningSignal = 0;
  let miningStatus = 'No data';
  if (data.btc?.price > 0 && data.onChain?.difficulty > 0) {
    const hashRateEH = (data.onChain.difficulty * Math.pow(2, 32)) / (600 * 1e18);
    const estCostMid = Math.round(hashRateEH * 420 + 38000);
    const priceToCostRatio = data.btc.price / (estCostMid || 65000);

    if (priceToCostRatio < 1.05) { miningSignal = 1.0; miningStatus = `Giá sát phí đào ~$${(estCostMid/1000).toFixed(0)}k (Đáy hỗ trợ thợ đào)`; }
    else if (priceToCostRatio < 1.30) { miningSignal = 0.5; miningStatus = `Biên lợi nhuận thợ đào thấp (Vùng an toàn)`; }
    else if (priceToCostRatio < 1.80) { miningSignal = 0.0; miningStatus = `Lợi nhuận thợ đào bình thường`; }
    else { miningSignal = -0.5; miningStatus = `Lợi nhuận thợ đào rất cao (Rủi ro xả)`; }

    onChainScoreSum += miningSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'Mining Cost Floor', weight: '4%', score: miningSignal * 4, status: miningStatus, pillar: 'onChain' });
  }

  // 2E. On-chain Network Transaction Demand (4%)
  let txSignal = 0;
  let txStatus = 'No data';
  const txCount = toFiniteNumber(data.onChainMetrics?.txCount ?? data.onChain?.txCount24h);
  if (txCount != null && txCount > 0) {
    if (txCount > 500000) { txSignal = 0.8; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch rất cao)`; }
    else if (txCount > 350000) { txSignal = 0.3; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch ổn định)`; }
    else if (txCount > 250000) { txSignal = -0.2; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch trung bình)`; }
    else { txSignal = -0.7; txStatus = `${(txCount/1000).toFixed(0)}k txs/24h (Nhu cầu giao dịch thấp)`; }

    onChainScoreSum += txSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'Network Transaction Demand', weight: '4%', score: txSignal * 4, status: txStatus, pillar: 'onChain' });
  }

  // ----------------------------------------------------
  // PILLAR 3: MACRO LIQUIDITY & RISK SHOCK (20%)
  // ----------------------------------------------------
  let newsRiskScoreSum = 0;

  // 3A. Monetary Policy & Real Rates Pulse (6%)
  let macroPulseSignal = 0;
  let macroPulseStatus = 'No data';
  const fedVal = toFiniteNumber(data.fedFundsRate?.val ?? data.fedFundsRate);
  const cpiVal = toFiniteNumber(data.cpi?.val ?? data.cpi);
  const unrateVal = toFiniteNumber(data.unrate?.val ?? data.unrate);
  
  if (fedVal != null || cpiVal != null || unrateVal != null) {
    let mScore = 0;
    let count = 0;
    const desc = [];
    
    if (fedVal != null) {
      if (fedVal > 5.0) { mScore -= 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Thắt chặt)`); }
      else if (fedVal < 3.5) { mScore += 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Nới lỏng)`); }
      else { desc.push(`Fed ${fedVal.toFixed(1)}%`); }
      count++;
    }
    if (cpiVal != null) {
      if (cpiVal > 3.5) { mScore -= 0.8; desc.push(`CPI ${cpiVal.toFixed(1)}% (Cao)`); }
      else if (cpiVal < 2.5) { mScore += 0.5; desc.push(`CPI ${cpiVal.toFixed(1)}% (Hạ nhiệt)`); }
      else { desc.push(`CPI ${cpiVal.toFixed(1)}%`); }
      count++;
    }
    if (unrateVal != null) {
      if (unrateVal > 4.5) { mScore -= 0.5; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Rủi ro suy thoái)`); }
      else if (unrateVal < 4.0) { mScore += 0.3; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Việc làm khỏe)`); }
      else { desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}%`); }
      count++;
    }
    if (fedVal != null && cpiVal != null) {
      const realRate = fedVal - cpiVal;
      if (realRate > 2.5) { mScore -= 0.3; desc.push(`Real Rate +${realRate.toFixed(1)}% (Áp lực vốn)`); }
      else if (realRate < 0.5) { mScore += 0.3; desc.push(`Real Rate ${realRate.toFixed(1)}% (Hỗ trợ định giá)`); }
    }
    
    macroPulseSignal = count > 0 ? clamp(mScore / count) : 0;
    macroPulseStatus = desc.length > 0 ? desc.join(' • ') : 'Macro ổn định';
    
    newsRiskScoreSum += macroPulseSignal * 0.06;
    availableWeight += 0.06;
    signals.push({ name: 'Monetary Policy Pulse', weight: '6%', score: macroPulseSignal * 6, status: macroPulseStatus, pillar: 'newsRisk' });
  }

  // 3B. US Net Liquidity & Credit Stress (5%)
  let liqSignal = 0;
  let liqStatus = 'No data';
  const netLiq = toFiniteNumber(data.netLiquidity);
  const hySpread = toFiniteNumber(data.highYield?.val ?? data.highYield);
  const m2 = toFiniteNumber(data.m2Supply?.val ?? data.m2Supply);

  if (netLiq != null || hySpread != null || m2 != null) {
    let lScore = 0;
    let lCount = 0;
    const lDesc = [];

    if (netLiq != null) {
      // Net liquidity in Billions USD (Fed balance sheet - TGA - RRP)
      if (netLiq > 6200) { lScore += 0.7; lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T (Mở rộng)`); }
      else if (netLiq < 5500) { lScore -= 0.7; lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T (Co hẹp)`); }
      else { lDesc.push(`Net Liq $${(netLiq/1000).toFixed(2)}T`); }
      lCount++;
    }

    if (hySpread != null) {
      if (hySpread < 3.5) { lScore += 0.6; lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Tín dụng khỏe)`); }
      else if (hySpread > 4.5) { lScore -= 0.8; lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Credit Stress)`); }
      else { lDesc.push(`HY Spread ${hySpread.toFixed(2)}% (Bình thường)`); }
      lCount++;
    }

    if (m2 != null) {
      if (m2 > 21500) { lScore += 0.4; lDesc.push(`M2 $${(m2/1000).toFixed(1)}T`); }
      else { lDesc.push(`M2 $${(m2/1000).toFixed(1)}T`); }
      lCount++;
    }

    liqSignal = lCount > 0 ? clamp(lScore / lCount) : 0;
    liqStatus = lDesc.length > 0 ? lDesc.join(' • ') : 'Thanh khoản bình thường';

    newsRiskScoreSum += liqSignal * 0.05;
    availableWeight += 0.05;
    signals.push({ name: 'US Net Liquidity & Credit', weight: '5%', score: liqSignal * 5, status: liqStatus, pillar: 'newsRisk' });
  }

  // 3C. Global Currency (DXY) & US 10Y Yield (4%)
  let dxyYieldSignal = 0;
  let dxyYieldStatus = 'No data';
  const dxyVal = toFiniteNumber(data.dxy?.price ?? data.dxy);
  const yield10yVal = toFiniteNumber(data.tenYearYield?.val ?? data.tenYearYield);

  if (dxyVal != null || yield10yVal != null) {
    let dyScore = 0;
    let dyCount = 0;
    const dyDesc = [];

    if (dxyVal != null) {
      if (dxyVal > 105) { dyScore -= 0.8; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD rất mạnh / Hút vốn)`); }
      else if (dxyVal > 103) { dyScore -= 0.3; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD hơi cao)`); }
      else if (dxyVal < 100) { dyScore += 0.8; dyDesc.push(`DXY ${dxyVal.toFixed(1)} (USD suy yếu / Risk-On)`); }
      else { dyDesc.push(`DXY ${dxyVal.toFixed(1)} (Ổn định)`); }
      dyCount++;
    }

    if (yield10yVal != null) {
      if (yield10yVal > 4.5) { dyScore -= 0.8; dyDesc.push(`10Y ${yield10yVal.toFixed(2)}% (Lợi suất đè nặng)`); }
      else if (yield10yVal < 3.8) { dyScore += 0.6; dyDesc.push(`10Y ${yield10yVal.toFixed(2)}% (Chi phí vốn giảm)`); }
      else { dyDesc.push(`10Y ${yield10yVal.toFixed(2)}%`); }
      dyCount++;
    }

    dxyYieldSignal = dyCount > 0 ? clamp(dyScore / dyCount) : 0;
    dxyYieldStatus = dyDesc.length > 0 ? dyDesc.join(' • ') : 'Tỷ giá & lợi suất cân bằng';

    newsRiskScoreSum += dxyYieldSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'DXY & US 10Y Yield', weight: '4%', score: dxyYieldSignal * 4, status: dxyYieldStatus, pillar: 'newsRisk' });
  }

  // 3D. Equities Risk Appetite (S&P 500 / Nasdaq) (2%)
  let eqSignal = 0;
  let eqStatus = 'No data';
  const spChg = toFiniteNumber(data.sp500?.changePercent);
  const qqqChg = toFiniteNumber(data.qqq?.changePercent);

  if (spChg != null || qqqChg != null) {
    const avgChg = ((spChg ?? 0) + (qqqChg ?? 0)) / ((spChg != null && qqqChg != null) ? 2 : 1);
    eqSignal = clamp(avgChg / 1.5);
    eqStatus = `S&P500 ${spChg != null ? (spChg >= 0 ? '+' : '') + spChg.toFixed(2) + '%' : '---'} • QQQ ${qqqChg != null ? (qqqChg >= 0 ? '+' : '') + qqqChg.toFixed(2) + '%' : '---'} (Khẩu vị rủi ro chứng khoán)`;

    newsRiskScoreSum += eqSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Wall Street Risk Appetite', weight: '2%', score: eqSignal * 2, status: eqStatus, pillar: 'newsRisk' });
  }

  // 3E. VIX Volatility & 24h Calendar Event Shock (3%)
  let vixSignal = 0;
  let vixStatus = 'No data';
  const vixVal = toFiniteNumber(data.vix?.price ?? data.vix?.val ?? data.vix);
  
  if (vixVal != null && vixVal > 0) {
    if (vixVal < 15) { vixSignal = 0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-On ổn định)`; }
    else if (vixVal < 20) { vixSignal = 0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Biến động bình thường)`; }
    else if (vixVal < 25) { vixSignal = -0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Căng thẳng nhẹ)`; }
    else if (vixVal < 32) { vixSignal = -0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-Off hoảng loạn)`; }
    else { vixSignal = -1.0; vixStatus = `VIX ${vixVal.toFixed(1)} (Khủng hoảng tâm lý)`; }
  }

  // Check 24h High Impact Events
  if (Array.isArray(data.news)) {
    const now = Date.now();
    const highImpactCalendarEvents = data.news.filter((n) => {
      if (!n.tag?.includes('Calendar')) return false;
      const t = new Date(n.time).getTime();
      return t - now > 0 && t - now <= 24 * 60 * 60 * 1000;
    });

    if (highImpactCalendarEvents.length > 0) {
      calendarRiskLevel = 'HIGH';
      highImpactCalendarEvents.forEach((e) => {
        upcomingEvents.push({
          title: e.title.replace('[LỊCH SỰ KIỆN]', '').trim(),
          time: e.time,
          tag: e.tag,
        });
      });
      // Dampen risk shock when high impact event is within 24h
      vixSignal = Math.min(vixSignal, -0.4);
      vixStatus = `${vixStatus} • ⚠ Lịch High Impact trong 24h: ${upcomingEvents[0]?.title || 'Sự kiện vĩ mô'}`;
    }
  }

  if (vixVal != null || upcomingEvents.length > 0) {
    newsRiskScoreSum += vixSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'VIX & Calendar Shock', weight: '3%', score: vixSignal * 3, status: vixStatus, pillar: 'newsRisk' });
  }

  // ----------------------------------------------------
  // PILLAR 4: MARKET MICROSTRUCTURE & BTC TREND REGIME (15%)
  // ----------------------------------------------------
  let microScoreSum = 0;
  const btcVolume = toFiniteNumber(data.btc?.volume);

  // 4A. BTC Trend & Price Regime (3%)
  const dailyKlines = data.btcDailyKlinesAll ?? data.dailyKlines ?? data.klines;
  const trendRegime = calculateBtcTrendRegime(dailyKlines, data.btc?.price);
  if (trendRegime.hasData) {
    microScoreSum += trendRegime.signal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'BTC Trend Regime (Daily MA)', weight: '3%', score: trendRegime.signal * 3, status: trendRegime.status, pillar: 'microstructure' });
  }

  // 4B. Spot CVD (24h, 7d, 30d) (3%)
  let spotCvdSignal = 0;
  let spotCvdStatus = 'No data';
  const spot24 = toFiniteNumber(data.cvdHistory24hSpot?.[data.cvdHistory24hSpot.length - 1]?.cvd);
  const spot7d = toFiniteNumber(data.cvdHistory7dSpot?.[data.cvdHistory7dSpot.length - 1]?.cvd);
  const spot30d = toFiniteNumber(data.cvdHistory30dSpot?.[data.cvdHistory30dSpot.length - 1]?.cvd);
  
  if (spot24 != null && btcVolume != null && btcVolume > 0) {
    const cvdRatio = spot24 / btcVolume; 
    let baseScore = clamp(Math.tanh(cvdRatio / 0.05));
    if (spot7d != null) {
      if (spot7d > 0 && spot24 > 0) baseScore += 0.1;
      else if (spot7d < 0 && spot24 < 0) baseScore -= 0.1;
    }
    if (spot30d != null) {
      if (spot30d > 0 && spot24 > 0) baseScore += 0.1;
      else if (spot30d < 0 && spot24 < 0) baseScore -= 0.1;
    }
    spotCvdSignal = clamp(baseScore);
    
    if (spotCvdSignal > 0.6) spotCvdStatus = 'Spot Gom Hàng Mạnh (+)';
    else if (spotCvdSignal > 0.2) spotCvdStatus = 'Spot Mua Ưu Thế';
    else if (spotCvdSignal > -0.2) spotCvdStatus = 'Spot Đi Ngang';
    else if (spotCvdSignal > -0.6) spotCvdStatus = 'Spot Bán Ưu Thế';
    else spotCvdStatus = 'Spot Xả Mạnh (-)';

    microScoreSum += spotCvdSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'Spot CVD (24h/7d/30d)', weight: '3%', score: spotCvdSignal * 3, status: spotCvdStatus, pillar: 'microstructure' });
  }

  // 4C. Futures CVD (24h, 7d, 30d) (2%)
  let futCvdSignal = 0;
  let futCvdStatus = 'No data';
  const fut24 = toFiniteNumber(data.cvdHistory24h?.[data.cvdHistory24h.length - 1]?.cvd);
  const fut7d = toFiniteNumber(data.cvdHistory7d?.[data.cvdHistory7d.length - 1]?.cvd);
  const fut30d = toFiniteNumber(data.cvdHistory30d?.[data.cvdHistory30d.length - 1]?.cvd);
  
  if (fut24 != null && btcVolume != null && btcVolume > 0) {
    const cvdRatio = fut24 / btcVolume;
    let baseScore = clamp(Math.tanh(cvdRatio / 0.08));
    if (fut7d != null) {
      if (fut7d > 0 && fut24 > 0) baseScore += 0.1;
      else if (fut7d < 0 && fut24 < 0) baseScore -= 0.1;
    }
    if (fut30d != null) {
      if (fut30d > 0 && fut24 > 0) baseScore += 0.1;
      else if (fut30d < 0 && fut24 < 0) baseScore -= 0.1;
    }
    futCvdSignal = clamp(baseScore);
    
    if (futCvdSignal > 0.6) futCvdStatus = 'Futures Long Chủ Đạo';
    else if (futCvdSignal > 0.2) futCvdStatus = 'Futures Nghiêng Long';
    else if (futCvdSignal > -0.2) futCvdStatus = 'Futures Cân Bằng';
    else if (futCvdSignal > -0.6) futCvdStatus = 'Futures Nghiêng Short';
    else futCvdStatus = 'Futures Short Chủ Đạo';

    microScoreSum += futCvdSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Futures CVD (24h/7d/30d)', weight: '2%', score: futCvdSignal * 2, status: futCvdStatus, pillar: 'microstructure' });
  }

  // 4D. Funding Rate & Leverage Confluence (2%)
  let frSignal = 0;
  let frStatus = 'No data';
  const fr = toFiniteNumber(data.fundingRate);
  if (fr != null) {
    const frPct = (fr * 100).toFixed(3) + '%';
    const isSpotBuying = spotCvdSignal > 0.1;
    const isSpotDumping = spotCvdSignal < -0.1;

    if (fr > 0.0005) {
      frSignal = isSpotDumping ? -1.0 : -0.7;
      frStatus = isSpotDumping ? `Extreme Long Crowding + Spot Xả (${frPct}) -> Trap` : `Overheated Longs (${frPct})`;
    } else if (fr > 0.0002) {
      frSignal = isSpotBuying ? 0.5 : 0.0;
      frStatus = `Bullish (${frPct})`;
    } else if (fr > 0.00005) {
      frSignal = 0.5;
      frStatus = `Bullish nhẹ (${frPct})`;
    } else if (fr > -0.00005) {
      frSignal = 0.0;
      frStatus = `Trung lập (${frPct})`;
    } else if (fr > -0.0002) {
      frSignal = isSpotBuying ? 0.3 : -0.5;
      frStatus = isSpotBuying ? `Shorts bị gom (${frPct})` : `Bearish (${frPct})`;
    } else {
      // Extreme negative funding
      if (isSpotBuying) {
        frSignal = 0.9;
        frStatus = `Extreme Shorts + Spot Gom (${frPct}) -> Squeeze Mạnh`;
      } else if (isSpotDumping) {
        frSignal = -0.9;
        frStatus = `Extreme Negative Funding + Spot Xả (${frPct}) -> Downtrend Thực`;
      } else {
        frSignal = 0.5;
        frStatus = `Extreme Shorts (${frPct}) -> Squeeze Potential`;
      }
    }

    microScoreSum += frSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Funding Rate Confluence', weight: '2%', score: frSignal * 2, status: frStatus, pillar: 'microstructure' });
  }

  // 4E. Open Interest Surge + Price Action (2%)
  let oiSignal = 0;
  let oiStatus = 'No data';
  const currentOi = toFiniteNumber(data.openInterest);
  const prevOi = toFiniteNumber(data.oiHistory?.[0]?.sumOpenInterest);
  if (currentOi != null && prevOi != null && prevOi > 0) {
    const oiChangePct = prevOi > 0 ? ((currentOi - prevOi) / prevOi) * 100 : 0;
    const priceChange = data.btc?.change || 0;

    if (oiChangePct > 5 && priceChange > 2) { oiSignal = 1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price +${priceChange.toFixed(1)}% (Longs in)`; }
    else if (oiChangePct > 5 && priceChange < -2) { oiSignal = -1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price ${priceChange.toFixed(1)}% (Shorts in)`; }
    else if (oiChangePct > 2 && priceChange > 0) { oiSignal = 0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá tăng)`; }
    else if (oiChangePct > 2 && priceChange < 0) { oiSignal = -0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá giảm)`; }
    else if (oiChangePct < -5) { oiSignal = -0.2; oiStatus = `Deleveraging OI ${oiChangePct.toFixed(1)}%`; }
    else { oiSignal = 0.0; oiStatus = `OI ổn định (${oiChangePct >= 0 ? '+' : ''}${oiChangePct.toFixed(1)}%)`; }

    microScoreSum += oiSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Open Interest & Price', weight: '2%', score: oiSignal * 2, status: oiStatus, pillar: 'microstructure' });
  }

  // 4F. Fear & Greed Index (2%)
  let fngSignal = 0;
  let fngStatus = 'No data';
  const fng = toFiniteNumber(data.fngData?.value);
  if (fng != null) {
    if (fng <= 20) { fngSignal = 1.0; fngStatus = `Fear & Greed ${fng} (Extreme Fear -> Mua tốt)`; }
    else if (fng <= 35) { fngSignal = 0.5; fngStatus = `Fear & Greed ${fng} (Fear)`; }
    else if (fng <= 65) { fngSignal = 0.0; fngStatus = `Fear & Greed ${fng} (Neutral)`; }
    else if (fng <= 80) { fngSignal = -0.5; fngStatus = `Fear & Greed ${fng} (Greed)`; }
    else { fngSignal = -1.0; fngStatus = `Fear & Greed ${fng} (Extreme Greed -> Quá nóng)`; }

    fngSignal = clamp((50 - fng) / 30);
    microScoreSum += fngSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Fear & Greed Index', weight: '2%', score: fngSignal * 2, status: fngStatus, pillar: 'microstructure' });
  }

  // 4G. Long/Short Ratio (1%)
  let lsSignal = 0;
  let lsStatus = 'No data';
  const latestLs = toFiniteNumber(data.lsHistory?.[data.lsHistory.length - 1]?.longShortRatio);
  if (latestLs != null && latestLs > 0) {
    if (latestLs > 2.5) { lsSignal = -0.8; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Quá nhiều Longs)`; }
    else if (latestLs > 1.8) { lsSignal = -0.3; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng về Long)`; }
    else if (latestLs > 1.2) { lsSignal = 0.2; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Hợp lý)`; }
    else if (latestLs <= 0.8) { lsSignal = 0.6; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng Short -> Squeeze)`; }
    else { lsSignal = 0.0; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Cân bằng)`; }

    lsSignal = clamp((1 - latestLs) / 0.9);
    microScoreSum += lsSignal * 0.01;
    availableWeight += 0.01;
    signals.push({ name: 'Long/Short Ratio', weight: '1%', score: lsSignal * 1, status: lsStatus, pillar: 'microstructure' });
  }

  // ----------------------------------------------------
  // TOTAL SCORE COMPUTATION
  // ----------------------------------------------------
  const totalWeightedRaw = instScoreSum + onChainScoreSum + newsRiskScoreSum + microScoreSum;
  
  const directionalScore = availableWeight > 0 ? (totalWeightedRaw / availableWeight) * 100 : 0;
  const confidencePct = Math.round(clamp(availableWeight / MAX_SCORING_WEIGHT, 0, 1) * 100);
  const clampedScore = clamp(Math.round(directionalScore * (confidencePct / 100)), -100, 100);

  let label = 'NEUTRAL';
  let color = 'var(--text-slate-400)';
  let bgGradient = 'rgba(148, 163, 184, 0.15)';

  if (confidencePct < 55) {
    label = 'LOW CONFIDENCE';
    color = 'var(--text-slate-400)';
    bgGradient = 'rgba(148, 163, 184, 0.15)';
  } else if (clampedScore >= 60) {
    label = 'STRONG BULL';
    color = 'var(--color-emerald-400)';
    bgGradient = 'rgba(16, 185, 129, 0.15)';
  } else if (clampedScore >= 25) {
    label = 'BULLISH';
    color = '#34d399';
    bgGradient = 'rgba(52, 211, 153, 0.12)';
  } else if (clampedScore <= -60) {
    label = 'STRONG BEAR';
    color = 'var(--color-rose-400)';
    bgGradient = 'rgba(244, 63, 94, 0.15)';
  } else if (clampedScore <= -25) {
    label = 'BEARISH';
    color = '#f87171';
    bgGradient = 'rgba(248, 113, 113, 0.12)';
  } else {
    label = 'NEUTRAL';
    color = 'var(--text-contrast)';
    bgGradient = 'rgba(148, 163, 184, 0.12)';
  }

  // ----------------------------------------------------
  // THREE-LAYER BIAS REGIME METADATA
  // ----------------------------------------------------
  let valuationRegime = 'FAIR_VALUE';
  if (mvrv != null) {
    if (mvrv < 1.0) valuationRegime = 'DEEP_VALUE';
    else if (mvrv < 1.4) valuationRegime = 'UNDERVALUED';
    else if (mvrv < 2.2) valuationRegime = 'FAIR_VALUE';
    else if (mvrv < 2.8) valuationRegime = 'HEATED';
    else valuationRegime = 'OVERHEATED';
  }

  let liquidityRegime = 'NEUTRAL';
  if (netLiq != null || hySpread != null) {
    if ((netLiq && netLiq > 6100) || (hySpread && hySpread < 3.5)) liquidityRegime = 'EXPANDING';
    else if ((netLiq && netLiq < 5500) || (hySpread && hySpread > 4.5)) liquidityRegime = 'CONTRACTING';
  }

  let tacticalRegime = 'BALANCED';
  if (spotCvdSignal > 0.4 && fr != null && fr < -0.0001) tacticalRegime = 'SHORT_SQUEEZE_WATCH';
  else if (spotCvdSignal < -0.4 && fr != null && fr > 0.0003) tacticalRegime = 'LONG_SQUEEZE_RISK';
  else if (spotCvdSignal > 0.3) tacticalRegime = 'SPOT_ACCUMULATION';
  else if (spotCvdSignal < -0.3) tacticalRegime = 'SPOT_DISTRIBUTION';

  return {
    score: clampedScore,
    label,
    color,
    bgGradient,
    confidence: confidencePct,
    calendarRisk: calendarRiskLevel,
    pillars: {
      institutional: Math.round((instScoreSum / 0.40) * 100) || 0,
      onChain: Math.round((onChainScoreSum / 0.25) * 100) || 0,
      newsRisk: Math.round((newsRiskScoreSum / 0.20) * 100) || 0,
      microstructure: Math.round((microScoreSum / 0.15) * 100) || 0,
    },
    signals,
    upcomingEvents,
    regime: {
      valuation: valuationRegime,
      trend: trendRegime.regimeLabel,
      liquidity: liquidityRegime,
      tactical: tacticalRegime,
      details: {
        ma50: trendRegime.ma50,
        ma200: trendRegime.ma200,
        slope50: trendRegime.slope50,
        return7d: trendRegime.return7d,
        return30d: trendRegime.return30d,
        return90d: trendRegime.return90d,
        realizedVol30d: trendRegime.realizedVol30d,
        dxy: dxyVal,
        tenYearYield: yield10yVal,
        highYieldSpread: hySpread,
        netLiquidity: netLiq,
        vix: vixVal,
      },
    },
  };
}

