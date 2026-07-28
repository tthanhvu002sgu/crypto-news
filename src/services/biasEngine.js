/**
 * Market Bias Engine Service
 * Calculates an overall BTC market bias score from -100 to +100
 * using 4 weighted pillars calibrated for swing trading:
 * 
 * 1. Market Microstructure (35%): CVD 24h (15%), Funding Rate (10%), OI Change (10%)
 * 2. On-Chain Fundamentals (25%): MVRV Ratio (12%), Active Addresses (7%), Mining Production Cost (6%)
 * 3. Institutional Flows (20%): Spot ETF 7-Day Net Flow (12%), Stablecoin Dry Powder (8%)
 * 4. News & Risk Shock (20%): High Impact Calendar Risk (8%), Fear & Greed (7%), Long/Short Ratio (5%)
 */

export function calculateMarketBias(data, etfHistory = []) {
  if (!data) {
    return {
      score: 0,
      label: 'NEUTRAL',
      color: 'var(--text-slate-400)',
      confidence: 0,
      pillars: { microstructure: 0, onChain: 0, institutional: 0, newsRisk: 0 },
      signals: [],
      upcomingEvents: [],
    };
  }

  const signals = [];
  let availableWeight = 0;

  // ----------------------------------------------------
  // PILLAR 1: MARKET MICROSTRUCTURE (35%)
  // ----------------------------------------------------
  let microScoreSum = 0;

  // 1A. 24h Futures CVD Ratio (15%)
  let cvdSignal = 0;
  let cvdStatus = 'No data';
  if (Array.isArray(data.cvdHistory24h) && data.cvdHistory24h.length > 0 && data.btc?.volume > 0) {
    const latestCvd = data.cvdHistory24h[data.cvdHistory24h.length - 1]?.cvd || 0;
    const cvdRatio = latestCvd / data.btc.volume;
    
    if (cvdRatio > 0.08) { cvdSignal = 1.0; cvdStatus = 'Buy flow mạnh (+8% vol)'; }
    else if (cvdRatio > 0.03) { cvdSignal = 0.5; cvdStatus = 'Buy flow ưu thế (+3% vol)'; }
    else if (cvdRatio > -0.03) { cvdSignal = 0.0; cvdStatus = 'Cân bằng mua bán'; }
    else if (cvdRatio > -0.08) { cvdSignal = -0.5; cvdStatus = 'Sell flow ưu thế (-3% vol)'; }
    else { cvdSignal = -1.0; cvdStatus = 'Sell flow áp đảo (-8% vol)'; }

    microScoreSum += cvdSignal * 0.15;
    availableWeight += 0.15;
    signals.push({ name: '24h Futures CVD', weight: '15%', score: cvdSignal * 15, status: cvdStatus, pillar: 'microstructure' });
  }

  // 1B. Funding Rate & Leverage Heat (10%)
  let frSignal = 0;
  let frStatus = 'No data';
  if (data.fundingRate != null) {
    const fr = parseFloat(data.fundingRate);
    const frPct = (fr * 100).toFixed(3) + '%';
    
    if (fr > 0.0005) { frSignal = -0.8; frStatus = `Overheated Longs (${frPct})`; }
    else if (fr > 0.0002) { frSignal = 0.3; frStatus = `Bullish lành mạnh (${frPct})`; }
    else if (fr > 0.00005) { frSignal = 0.6; frStatus = `Bullish nhẹ (${frPct})`; }
    else if (fr > -0.00005) { frSignal = 0.0; frStatus = `Trung lập (${frPct})`; }
    else if (fr > -0.0002) { frSignal = -0.4; frStatus = `Bearish nhẹ (${frPct})`; }
    else { frSignal = 0.8; frStatus = `Extreme Shorts Squeeze potential (${frPct})`; }

    microScoreSum += frSignal * 0.10;
    availableWeight += 0.10;
    signals.push({ name: 'Funding Rate', weight: '10%', score: frSignal * 10, status: frStatus, pillar: 'microstructure' });
  }

  // 1C. Open Interest Surge + Price Action (10%)
  let oiSignal = 0;
  let oiStatus = 'No data';
  if (data.openInterest != null && Array.isArray(data.oiHistory) && data.oiHistory.length > 0) {
    const currentOi = parseFloat(data.openInterest);
    const prevOi = parseFloat(data.oiHistory[0]?.sumOpenInterest || currentOi);
    const oiChangePct = prevOi > 0 ? ((currentOi - prevOi) / prevOi) * 100 : 0;
    const priceChange = data.btc?.change || 0;

    if (oiChangePct > 5 && priceChange > 2) { oiSignal = 1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price +${priceChange.toFixed(1)}% (Longs in)`; }
    else if (oiChangePct > 5 && priceChange < -2) { oiSignal = -1.0; oiStatus = `OI +${oiChangePct.toFixed(1)}% & Price ${priceChange.toFixed(1)}% (Shorts in)`; }
    else if (oiChangePct > 2 && priceChange > 0) { oiSignal = 0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá tăng)`; }
    else if (oiChangePct > 2 && priceChange < 0) { oiSignal = -0.5; oiStatus = `OI tăng nhẹ +${oiChangePct.toFixed(1)}% (Giá giảm)`; }
    else if (oiChangePct < -5) { oiSignal = -0.2; oiStatus = `Deleveraging OI ${oiChangePct.toFixed(1)}%`; }
    else { oiSignal = 0.0; oiStatus = `OI ổn định (${oiChangePct >= 0 ? '+' : ''}${oiChangePct.toFixed(1)}%)`; }

    microScoreSum += oiSignal * 0.10;
    availableWeight += 0.10;
    signals.push({ name: 'Open Interest & Price', weight: '10%', score: oiSignal * 10, status: oiStatus, pillar: 'microstructure' });
  }

  // ----------------------------------------------------
  // PILLAR 2: ON-CHAIN FUNDAMENTALS & VALUATION (25%)
  // ----------------------------------------------------
  let onChainScoreSum = 0;

  // 2A. MVRV Ratio (12%)
  let mvrvSignal = 0;
  let mvrvStatus = 'No data';
  if (data.onChainMetrics?.mvrv != null) {
    const mvrv = parseFloat(data.onChainMetrics.mvrv);
    
    if (mvrv < 1.0) { mvrvSignal = 1.0; mvrvStatus = `MVRV ${mvrv} (Rất rẻ / Vùng đáy)`; }
    else if (mvrv < 1.4) { mvrvSignal = 0.7; mvrvStatus = `MVRV ${mvrv} (Vùng tích lũy tốt)`; }
    else if (mvrv < 2.2) { mvrvSignal = 0.2; mvrvStatus = `MVRV ${mvrv} (Định giá hợp lý)`; }
    else if (mvrv < 2.8) { mvrvSignal = -0.3; mvrvStatus = `MVRV ${mvrv} (Giá hơi cao)`; }
    else { mvrvSignal = -1.0; mvrvStatus = `MVRV ${mvrv} (Vùng giá quá nóng / Quá định giá)`; }

    onChainScoreSum += mvrvSignal * 0.12;
    availableWeight += 0.12;
    signals.push({ name: 'MVRV Ratio', weight: '12%', score: mvrvSignal * 12, status: mvrvStatus, pillar: 'onChain' });
  }

  // 2B. Active Addresses (7%)
  let addrSignal = 0;
  let addrStatus = 'No data';
  if (data.onChainMetrics?.activeAddresses) {
    const rawAddr = String(data.onChainMetrics.activeAddresses).replace(/,/g, '');
    const addrs = parseInt(rawAddr, 10);
    if (!isNaN(addrs)) {
      if (addrs > 1000000) { addrSignal = 1.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng cực sôi động)`; }
      else if (addrs > 850000) { addrSignal = 0.5; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng hoạt động tốt)`; }
      else if (addrs > 700000) { addrSignal = 0.0; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng bình thường)`; }
      else { addrSignal = -0.6; addrStatus = `${(addrs / 1000).toFixed(0)}k addrs (Mạng suy giảm hoạt động)`; }

      onChainScoreSum += addrSignal * 0.07;
      availableWeight += 0.07;
      signals.push({ name: 'Active Addresses', weight: '7%', score: addrSignal * 7, status: addrStatus, pillar: 'onChain' });
    }
  }

  // 2C. Mining Production Cost Floor (6%)
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

    onChainScoreSum += miningSignal * 0.06;
    availableWeight += 0.06;
    signals.push({ name: 'Mining Cost Floor', weight: '6%', score: miningSignal * 6, status: miningStatus, pillar: 'onChain' });
  }

  // ----------------------------------------------------
  // PILLAR 3: INSTITUTIONAL FLOWS & CAPITAL (20%)
  // ----------------------------------------------------
  let instScoreSum = 0;

  // 3A. Spot ETF 7-Day Net Flow (12%)
  let etfSignal = 0;
  let etfStatus = 'No data';
  if (Array.isArray(etfHistory) && etfHistory.length > 0) {
    const last7 = etfHistory.slice(-7);
    const sum7d = last7.reduce((acc, curr) => acc + (parseFloat(curr.flow) || 0), 0);
    const flowStr = `${sum7d >= 0 ? '+' : ''}$${sum7d.toFixed(1)}M`;

    if (sum7d > 800) { etfSignal = 1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Gom rất mạnh)`; }
    else if (sum7d > 250) { etfSignal = 0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Vào ổn định)`; }
    else if (sum7d > -250) { etfSignal = 0.0; etfStatus = `ETF Flow 7D: ${flowStr} (Đi ngang)`; }
    else if (sum7d > -800) { etfSignal = -0.5; etfStatus = `ETF Flow 7D: ${flowStr} (Rút nhẹ)`; }
    else { etfSignal = -1.0; etfStatus = `ETF Flow 7D: ${flowStr} (Rút rất mạnh)`; }

    instScoreSum += etfSignal * 0.12;
    availableWeight += 0.12;
    signals.push({ name: 'ETF 7D Net Flow', weight: '12%', score: etfSignal * 12, status: etfStatus, pillar: 'institutional' });
  }

  // 3B. Stablecoin Dry Powder (8%)
  let stbleSignal = 0;
  let stbleStatus = 'No data';
  if (data.stablecoins?.total > 0) {
    const totalBillion = (data.stablecoins.total / 1e9).toFixed(1);
    stbleSignal = 0.3;
    stbleStatus = `Dry Powder: $${totalBillion}B USDT+USDC`;

    instScoreSum += stbleSignal * 0.08;
    availableWeight += 0.08;
    signals.push({ name: 'Stablecoin Liquidity', weight: '8%', score: stbleSignal * 8, status: stbleStatus, pillar: 'institutional' });
  }

  // ----------------------------------------------------
  // PILLAR 4: NEWS & SENTIMENT RISK SHOCK (20%)
  // ----------------------------------------------------
  let newsRiskScoreSum = 0;
  const upcomingEvents = [];

  // 4A. Economic Calendar & High Impact News (8%)
  let newsSignal = 0.3;
  let newsStatus = 'Lịch sự kiện bình ổn';

  if (Array.isArray(data.news)) {
    const now = Date.now();
    const highImpactCalendarEvents = data.news.filter(n => {
      if (!n.tag?.includes('Calendar')) return false;
      const t = new Date(n.time).getTime();
      return (t - now) > 0 && (t - now) <= 24 * 60 * 60 * 1000;
    });

    if (highImpactCalendarEvents.length > 0) {
      const firstEvent = highImpactCalendarEvents[0];
      const eventTime = new Date(firstEvent.time);
      const hoursLeft = Math.max(0, Math.round((eventTime.getTime() - now) / (1000 * 60 * 60)));
      
      newsSignal = -0.4;
      newsStatus = `⚠️ ${firstEvent.title.replace('[LỊCH SỰ KIỆN]', '').trim()} trong ~${hoursLeft}h nữa`;
      
      highImpactCalendarEvents.forEach(e => {
        upcomingEvents.push({
          title: e.title.replace('[LỊCH SỰ KIỆN]', '').trim(),
          time: e.time,
          tag: e.tag
        });
      });
    }
  }

  newsRiskScoreSum += newsSignal * 0.08;
  availableWeight += 0.08;
  signals.push({ name: 'Calendar Risk Event', weight: '8%', score: newsSignal * 8, status: newsStatus, pillar: 'newsRisk' });

  // 4B. Fear & Greed Index (7%)
  let fngSignal = 0;
  let fngStatus = 'No data';
  if (data.fngData?.value != null) {
    const fng = parseInt(data.fngData.value, 10);
    
    if (fng <= 20) { fngSignal = 1.0; fngStatus = `Fear & Greed ${fng} (Extreme Fear -> Mua tốt)`; }
    else if (fng <= 35) { fngSignal = 0.5; fngStatus = `Fear & Greed ${fng} (Fear)`; }
    else if (fng <= 65) { fngSignal = 0.0; fngStatus = `Fear & Greed ${fng} (Neutral)`; }
    else if (fng <= 80) { fngSignal = -0.5; fngStatus = `Fear & Greed ${fng} (Greed)`; }
    else { fngSignal = -1.0; fngStatus = `Fear & Greed ${fng} (Extreme Greed -> Quá nóng)`; }

    newsRiskScoreSum += fngSignal * 0.07;
    availableWeight += 0.07;
    signals.push({ name: 'Fear & Greed Index', weight: '7%', score: fngSignal * 7, status: fngStatus, pillar: 'newsRisk' });
  }

  // 4C. Binance Futures Long/Short Account Ratio (5%)
  let lsSignal = 0;
  let lsStatus = 'No data';
  if (Array.isArray(data.lsHistory) && data.lsHistory.length > 0) {
    const latestLs = parseFloat(data.lsHistory[data.lsHistory.length - 1]?.longShortRatio || 1);
    
    if (latestLs > 2.5) { lsSignal = -0.8; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Quá nhiều Longs)`; }
    else if (latestLs > 1.8) { lsSignal = -0.3; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng về Long)`; }
    else if (latestLs > 1.2) { lsSignal = 0.2; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Hợp lý)`; }
    else if (latestLs <= 0.8) { lsSignal = 0.6; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Nghiêng Short -> Squeeze)`; }
    else { lsSignal = 0.0; lsStatus = `Retail L/S Ratio ${latestLs.toFixed(2)} (Cân bằng)`; }

    newsRiskScoreSum += lsSignal * 0.05;
    availableWeight += 0.05;
    signals.push({ name: 'Long/Short Ratio', weight: '5%', score: lsSignal * 5, status: lsStatus, pillar: 'newsRisk' });
  }

  // ----------------------------------------------------
  // TOTAL SCORE COMPUTATION
  // ----------------------------------------------------
  const totalWeightedRaw = microScoreSum + onChainScoreSum + instScoreSum + newsRiskScoreSum;
  
  const finalScore = availableWeight > 0 ? Math.round((totalWeightedRaw / availableWeight) * 100) : 0;
  const clampedScore = Math.max(-100, Math.min(100, finalScore));

  let label = 'NEUTRAL';
  let color = 'var(--text-slate-400)';
  let bgGradient = 'rgba(148, 163, 184, 0.15)';

  if (clampedScore >= 60) {
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

  const confidencePct = Math.round(availableWeight * 100);

  return {
    score: clampedScore,
    label,
    color,
    bgGradient,
    confidence: confidencePct,
    pillars: {
      microstructure: Math.round((microScoreSum / 0.35) * 100),
      onChain: Math.round((onChainScoreSum / 0.25) * 100),
      institutional: Math.round((instScoreSum / 0.20) * 100),
      newsRisk: Math.round((newsRiskScoreSum / 0.20) * 100),
    },
    signals,
    upcomingEvents,
  };
}
