/**
 * Market Bias Engine Service
 * Calculates an overall BTC market bias score from -100 to +100
 * using 4 weighted pillars calibrated for sustainable macro & swing trend:
 * 
 * 1. Institutional Flows (40%): Spot ETF 7-Day Net Flow (28%), CME COT (12%)
 * 2. On-Chain Fundamentals (25%): MVRV Ratio (9%), NUPL (4%), SSR (4%), Supply in Profit (3%), Active Addresses (3%), Mining Production Cost (2%)
 * 3. Macro & Risk Shock (20%): Macro Indicators (Fed, CPI, Unrate) (14%), VIX Volatility Index (6%)
 * 4. Market Microstructure (15%): Spot CVD (4%), Futures CVD (3%), Funding Rate (3%), OI Change (2%), Fear & Greed (2%), L/S Ratio (1%)
 */

const MAX_SCORING_WEIGHT = 0.90;

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/,/g, '').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function calculateSupplyInProfit(mvrv) {
  if (!mvrv || isNaN(mvrv) || mvrv <= 0) return null;
  let est = -8 + 47 * mvrv - 1.1 * mvrv * mvrv;
  return Math.max(28, Math.min(98.5, est));
}

export function calculateMarketBias(data, etfHistory = []) {
  if (!data) {
    return {
      score: 0,
      label: 'NEUTRAL',
      color: 'var(--text-slate-400)',
      confidence: 0,
      pillars: { institutional: 0, onChain: 0, newsRisk: 0, microstructure: 0 },
      signals: [],
      upcomingEvents: [],
    };
  }

  const signals = [];
  let availableWeight = 0;
  let calendarRiskLevel = 'LOW';

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
    if (netPos != null) {
      if (netPos > 3000) { cotSignal = 1.0; cotStatus = `CME Asset Mgr Net +${netPos} (Long áp đảo)`; }
      else if (netPos > 1000) { cotSignal = 0.5; cotStatus = `CME Asset Mgr Net +${netPos} (Long ưu thế)`; }
      else if (netPos > -1000) { cotSignal = 0.0; cotStatus = `CME Asset Mgr Net ${netPos} (Cân bằng)`; }
      else if (netPos > -3000) { cotSignal = -0.5; cotStatus = `CME Asset Mgr Net ${netPos} (Short ưu thế)`; }
      else { cotSignal = -1.0; cotStatus = `CME Asset Mgr Net ${netPos} (Short áp đảo)`; }

      instScoreSum += cotSignal * 0.12;
      availableWeight += 0.12;
      signals.push({ name: 'CME COT Flow', weight: '12%', score: cotSignal * 12, status: cotStatus, pillar: 'institutional' });
    }
  }

  // ----------------------------------------------------
  // PILLAR 2: ON-CHAIN FUNDAMENTALS & VALUATION (25%)
  // ----------------------------------------------------
  let onChainScoreSum = 0;
  const mvrv = toFiniteNumber(data.onChainMetrics?.mvrv);

  // 2A. MVRV Ratio (9%)
  let mvrvSignal = 0;
  let mvrvStatus = 'No data';
  if (mvrv != null) {
    if (mvrv < 1.0) { mvrvSignal = 1.0; mvrvStatus = `MVRV ${mvrv} (Rất rẻ / Vùng đáy)`; }
    else if (mvrv < 1.4) { mvrvSignal = 0.7; mvrvStatus = `MVRV ${mvrv} (Vùng tích lũy tốt)`; }
    else if (mvrv < 2.2) { mvrvSignal = 0.2; mvrvStatus = `MVRV ${mvrv} (Định giá hợp lý)`; }
    else if (mvrv < 2.8) { mvrvSignal = -0.3; mvrvStatus = `MVRV ${mvrv} (Giá hơi cao)`; }
    else { mvrvSignal = -1.0; mvrvStatus = `MVRV ${mvrv} (Vùng giá quá nóng / Quá định giá)`; }

    mvrvSignal = clamp(-Math.tanh((mvrv - 2.1) / 0.7));
    onChainScoreSum += mvrvSignal * 0.09;
    availableWeight += 0.09;
    signals.push({ name: 'MVRV Ratio', weight: '9%', score: mvrvSignal * 9, status: mvrvStatus, pillar: 'onChain' });
  }

  // 2B. NUPL (4%)
  let nuplSignal = 0;
  let nuplStatus = 'No data';
  if (mvrv != null) {
    const nupl = 1 - (1 / mvrv);
    if (nupl < 0) { nuplSignal = 1.0; nuplStatus = `NUPL ${(nupl*100).toFixed(1)}% (Đầu hàng)`; }
    else if (nupl < 0.25) { nuplSignal = 0.5; nuplStatus = `NUPL ${(nupl*100).toFixed(1)}% (Hy vọng/Tích lũy)`; }
    else if (nupl < 0.5) { nuplSignal = 0.0; nuplStatus = `NUPL ${(nupl*100).toFixed(1)}% (Lạc quan)`; }
    else if (nupl < 0.75) { nuplSignal = -0.5; nuplStatus = `NUPL ${(nupl*100).toFixed(1)}% (Niềm tin/Lãi cao)`; }
    else { nuplSignal = -1.0; nuplStatus = `NUPL ${(nupl*100).toFixed(1)}% (Hưng phấn tột độ)`; }
    
    onChainScoreSum += nuplSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'NUPL', weight: '4%', score: nuplSignal * 4, status: nuplStatus, pillar: 'onChain' });
  }

  // 2C. Supply in Profit (3%)
  let sipSignal = 0;
  let sipStatus = 'No data';
  if (mvrv != null) {
    const sip = calculateSupplyInProfit(mvrv);
    if (sip != null) {
      if (sip > 95) { sipSignal = -0.8; sipStatus = `Supply in Profit ${sip.toFixed(1)}% (Rủi ro xả cao)`; }
      else if (sip > 85) { sipSignal = -0.3; sipStatus = `Supply in Profit ${sip.toFixed(1)}% (Khá nóng)`; }
      else if (sip > 60) { sipSignal = 0.0; sipStatus = `Supply in Profit ${sip.toFixed(1)}% (Trung bình)`; }
      else if (sip > 40) { sipSignal = 0.5; sipStatus = `Supply in Profit ${sip.toFixed(1)}% (Lành mạnh)`; }
      else { sipSignal = 1.0; sipStatus = `Supply in Profit ${sip.toFixed(1)}% (Quá bán/Vùng đáy)`; }

      onChainScoreSum += sipSignal * 0.03;
      availableWeight += 0.03;
      signals.push({ name: 'Supply in Profit', weight: '3%', score: sipSignal * 3, status: sipStatus, pillar: 'onChain' });
    }
  }

  // 2D. SSR (Stablecoin Supply Ratio) (4%)
  let ssrSignal = 0;
  let ssrStatus = 'No data';
  const p = data.btc?.price;
  const m = (typeof data.ssrMa === 'object' && data.ssrMa?.stablecoinTotal) || data.stablecoins?.total;
  if (p && m && typeof data.ssrMa === 'object' && data.ssrMa?.ma200) {
     const ssr = (p * 19740000) / m;
     const z = data.ssrMa.stdDev200 > 0 ? (ssr - data.ssrMa.ma200) / data.ssrMa.stdDev200 : 0;
     if (z < -2) { ssrSignal = 1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Oversold - Tiền chờ mua nhiều)`; }
     else if (z < -1) { ssrSignal = 0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Sức mua mạnh)`; }
     else if (z < 1) { ssrSignal = 0.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Bình thường)`; }
     else if (z < 2) { ssrSignal = -0.6; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Cạn sức mua)`; }
     else { ssrSignal = -1.0; ssrStatus = `SSR Z-Score ${z.toFixed(2)} (Overheated - Hết tiền mua)`; }
     
     onChainScoreSum += ssrSignal * 0.04;
     availableWeight += 0.04;
     signals.push({ name: 'Stablecoin Supply Ratio', weight: '4%', score: ssrSignal * 4, status: ssrStatus, pillar: 'onChain' });
  }

  // 2E. Active Addresses (3%)
  let addrSignal = 0;
  let addrStatus = 'No data';
  if (data.onChainMetrics?.activeAddresses) {
    const addrs = toFiniteNumber(data.onChainMetrics.activeAddresses);
    if (addrs != null && addrs > 0) {
      if (addrs > 1000000) { addrSignal = 1.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng cực sôi động)`; }
      else if (addrs > 850000) { addrSignal = 0.5; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng hoạt động tốt)`; }
      else if (addrs > 700000) { addrSignal = 0.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng bình thường)`; }
      else { addrSignal = -0.6; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng suy giảm hoạt động)`; }

      onChainScoreSum += addrSignal * 0.03;
      availableWeight += 0.03;
      signals.push({ name: 'Active Addresses', weight: '3%', score: addrSignal * 3, status: addrStatus, pillar: 'onChain' });
    }
  }

  // 2F. Mining Production Cost Floor (2%)
  let miningSignal = 0;
  let miningStatus = 'No data';
  if (data.btc?.price > 0 && data.onChain?.difficulty > 0) {
    const hashRateEH = (data.onChain.difficulty * Math.pow(2, 32)) / (600 * 1e18);
    const estCostMid = Math.round(hashRateEH * 420 + 38000);
    const priceToCostRatio = data.btc.price / (estCostMid || 65000);

    if (priceToCostRatio < 1.05) { miningSignal = 1.0; miningStatus = `Giá sát phí đào ~$${(estCostMid/1000).toFixed(0)}k (Đáy hỗ trợ)`; }
    else if (priceToCostRatio < 1.30) { miningSignal = 0.5; miningStatus = `Biên lợi nhuận thợ đào thấp (Vùng an toàn)`; }
    else if (priceToCostRatio < 1.80) { miningSignal = 0.0; miningStatus = `Lợi nhuận thợ đào bình thường`; }
    else { miningSignal = -0.5; miningStatus = `Lợi nhuận thợ đào rất cao (Rủi ro xả)`; }

    onChainScoreSum += miningSignal * 0.02;
    availableWeight += 0.02;
    signals.push({ name: 'Mining Cost Floor', weight: '2%', score: miningSignal * 2, status: miningStatus, pillar: 'onChain' });
  }

  // ----------------------------------------------------
  // PILLAR 3: MACRO & RISK SHOCK (20%)
  // ----------------------------------------------------
  let newsRiskScoreSum = 0;
  const upcomingEvents = [];

  // 3A. Macro Health Pulse (14%)
  let macroSignal = 0;
  let macroStatus = 'No data';
  const fedVal = toFiniteNumber(data.fedFundsRate?.val ?? data.fedFundsRate);
  const cpiVal = toFiniteNumber(data.cpi?.val ?? data.cpi);
  const unrateVal = toFiniteNumber(data.unrate?.val ?? data.unrate);
  
  if (fedVal != null || cpiVal != null || unrateVal != null) {
      let mScore = 0;
      let count = 0;
      let desc = [];
      
      if (fedVal != null) {
          if (fedVal > 5.0) { mScore -= 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Thắt chặt)`); }
          else if (fedVal < 3.5) { mScore += 0.5; desc.push(`Fed ${fedVal.toFixed(1)}% (Nới lỏng)`); }
          else { desc.push(`Fed ${fedVal.toFixed(1)}%`); }
          count++;
      }
      if (cpiVal != null) {
          if (cpiVal > 3.5) { mScore -= 0.8; desc.push(`CPI ${cpiVal.toFixed(1)}% (Cao)`); }
          else if (cpiVal < 2.5) { mScore += 0.5; desc.push(`CPI ${cpiVal.toFixed(1)}% (Tốt)`); }
          else { desc.push(`CPI ${cpiVal.toFixed(1)}%`); }
          count++;
      }
      if (unrateVal != null) {
          if (unrateVal > 4.5) { mScore -= 0.5; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Rủi ro)`); }
          else if (unrateVal < 4.0) { mScore += 0.3; desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}% (Lao động khỏe)`); }
          else { desc.push(`Thất nghiệp ${unrateVal.toFixed(1)}%`); }
          count++;
      }
      
      macroSignal = count > 0 ? clamp(mScore / count) : 0;
      macroStatus = desc.length > 0 ? desc.join(' • ') : 'Macro ổn định';
      
      newsRiskScoreSum += macroSignal * 0.14;
      availableWeight += 0.14;
      signals.push({ name: 'Macro Pulse (Fed, CPI, Unrate)', weight: '14%', score: macroSignal * 14, status: macroStatus, pillar: 'newsRisk' });
  }

  // 3B. VIX Volatility Index (6%)
  let vixSignal = 0;
  let vixStatus = 'No data';
  const vixVal = toFiniteNumber(data.vix);
  if (vixVal != null && vixVal > 0) {
    if (vixVal < 15) { vixSignal = 0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-On ổn định)`; }
    else if (vixVal < 20) { vixSignal = 0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Biến động bình thường)`; }
    else if (vixVal < 25) { vixSignal = -0.3; vixStatus = `VIX ${vixVal.toFixed(1)} (Căng thẳng nhẹ)`; }
    else if (vixVal < 32) { vixSignal = -0.8; vixStatus = `VIX ${vixVal.toFixed(1)} (Risk-Off hoảng loạn)`; }
    else { vixSignal = -1.0; vixStatus = `VIX ${vixVal.toFixed(1)} (Khủng hoảng tâm lý)`; }

    newsRiskScoreSum += vixSignal * 0.06;
    availableWeight += 0.06;
    signals.push({ name: 'VIX Volatility Index', weight: '6%', score: vixSignal * 6, status: vixStatus, pillar: 'newsRisk' });
  }

  if (Array.isArray(data.news)) {
    const now = Date.now();
    const highImpactCalendarEvents = data.news.filter(n => {
      if (!n.tag?.includes('Calendar')) return false;
      const t = new Date(n.time).getTime();
      return (t - now) > 0 && (t - now) <= 24 * 60 * 60 * 1000;
    });

    if (highImpactCalendarEvents.length > 0) {
      calendarRiskLevel = 'HIGH';
      highImpactCalendarEvents.forEach(e => {
        upcomingEvents.push({
          title: e.title.replace('[LỊCH SỰ KIỆN]', '').trim(),
          time: e.time,
          tag: e.tag
        });
      });
    }
  }

  // ----------------------------------------------------
  // PILLAR 4: MARKET MICROSTRUCTURE (15%)
  // ----------------------------------------------------
  let microScoreSum = 0;
  const btcVolume = toFiniteNumber(data.btc?.volume);

  // 4A. Spot CVD (24h, 7d, 30d) (4%)
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

    microScoreSum += spotCvdSignal * 0.04;
    availableWeight += 0.04;
    signals.push({ name: 'Spot CVD (24h/7d/30d)', weight: '4%', score: spotCvdSignal * 4, status: spotCvdStatus, pillar: 'microstructure' });
  }

  // 4B. Futures CVD (24h, 7d, 30d) (3%)
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

    microScoreSum += futCvdSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'Futures CVD (24h/7d/30d)', weight: '3%', score: futCvdSignal * 3, status: futCvdStatus, pillar: 'microstructure' });
  }

  // 4C. Funding Rate & Leverage Heat (3%)
  let frSignal = 0;
  let frStatus = 'No data';
  const fr = toFiniteNumber(data.fundingRate);
  if (fr != null) {
    const frPct = (fr * 100).toFixed(3) + '%';
    if (fr > 0.0005) { frSignal = -0.8; frStatus = `Overheated Longs (${frPct})`; }
    else if (fr > 0.0002) { frSignal = 0.3; frStatus = `Bullish lành mạnh (${frPct})`; }
    else if (fr > 0.00005) { frSignal = 0.6; frStatus = `Bullish nhẹ (${frPct})`; }
    else if (fr > -0.00005) { frSignal = 0.0; frStatus = `Trung lập (${frPct})`; }
    else if (fr > -0.0002) { frSignal = -0.4; frStatus = `Bearish nhẹ (${frPct})`; }
    else { frSignal = 0.8; frStatus = `Extreme Shorts Squeeze potential (${frPct})`; }

    microScoreSum += frSignal * 0.03;
    availableWeight += 0.03;
    signals.push({ name: 'Funding Rate', weight: '3%', score: frSignal * 3, status: frStatus, pillar: 'microstructure' });
  }

  // 4D. Open Interest Surge + Price Action (2%)
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

  // 4E. Fear & Greed Index (2%)
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

  // 4F. Long/Short Ratio (1%)
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

  if (confidencePct < 60) {
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
  };
}
