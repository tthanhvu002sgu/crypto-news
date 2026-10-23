/**
 * Sovereign Macro Terminal — Comprehensive Markdown Export Service
 * Exports exhaustive market data across all 12 analytical pillars:
 * 1. Market Bias Engine (Latest & History)
 * 2. Options Regime — BTC Deribit (Latest & Strike/Expiry Distribution)
 * 3. Spot Bitcoin ETF Flows (Latest & History)
 * 4. CME Bitcoin Futures COT (Latest & History)
 * 5. Macro Dashboard v2 (Valuator, PnL Matrix, Production Cost, FRED Macro - Latest & History)
 * 6. CVD & Order Flow (Futures & Spot - 24h, 7d, 30d History & Divergence)
 * 7. Flow Regime · 24H (Classification, Crowding, Quality)
 * 8. Long / Short Ratio (Binance Futures Global & Top Trader Accounts/Positions - Latest & 24h History)
 * 9. Open Interest (Latest BTC/USD & 24h History)
 * 10. Limit Orders (Whale Walls >= $500K across Binance, Bybit, OKX, Bitget)
 * 11. Order Book Imbalance (Aggregated OBI & Exchange Breakdown)
 * 12. Altcoin Scanner (Universe Rankings, 4-Pillar Scores, Flow Labels & Historical Tracking Deltas)
 */

import { calculateMarketBias } from './biasEngine.js';
import { getBiasSnapshots } from './biasSnapshotStore.js';
import { buildDailyBiasHistory, calculateBiasPriceCorrelation, detectBiasPriceDivergence } from './biasHistoryService.js';
import { getDeribitOptionsAnalysis } from './deribitOptionsService.js';
import { getOrderBookDepth, getWhaleWalls } from './api.js';
import { calculateMacroDashboard } from './macroDashboardEngine.js';
import { classifyCapitalFlow } from './capitalFlowEngine.js';
import {
  loadScannerManifest,
  loadDailySnapshot,
  findPriorSnapshotDates,
  hydrateAssetsWithTracking,
  triggerFileDownload,
  DEFAULT_WINDOW,
  WINDOW_LABELS,
} from './coinScanner.js';
import { getCurrentSessionVN } from './googleSheetSync.js';

// ─── Formatters & Utility Functions ──────────────────────────────────────────

const toFiniteNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
};

const fmtNum = (val, decimals = 2, fallback = '---') => {
  const num = toFiniteNumber(val);
  if (num === null) return fallback;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtSigned = (val, decimals = 2, suffix = '', fallback = '---') => {
  const num = toFiniteNumber(val);
  if (num === null) return fallback;
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${suffix}`;
};

const fmtUsd = (val, decimals = 2, fallback = '---') => {
  const num = toFiniteNumber(val);
  if (num === null) return fallback;
  return `$${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

const fmtCompactUsd = (val, fallback = '---') => {
  const num = toFiniteNumber(val);
  if (num === null) return fallback;
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtDateStr = (dateInput) => {
  if (!dateInput) return '---';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  } catch {
    return String(dateInput);
  }
};

const fmtDateVn = (dateInput = new Date()) => {
  if (!dateInput) return '---';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '---';
    const vnTime = new Date(d.getTime() + 7 * 3600 * 1000);
    return vnTime.toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';
  } catch {
    return '---';
  }
};

// ─── Section 1: Market Bias Engine Builder ────────────────────────────────────

function buildMarketBiasSection(dashboardData, biasData, etfHistory) {
  const score = toFiniteNumber(biasData?.score);
  const verdict = biasData?.verdict || 'NEUTRAL';
  const regime = biasData?.regime || 'CHOP / CONSOLIDATION';
  const confidence = toFiniteNumber(biasData?.confidence) ?? 85;
  const breakdown = biasData?.breakdown || {};
  const pillars = biasData?.pillars || {};

  // Historical snapshots from store and reconstructed 30d history
  const localSnapshots = getBiasSnapshots(15);
  const dailyHistory = buildDailyBiasHistory(dashboardData, etfHistory, 30);
  const divergenceAnalysis = detectBiasPriceDivergence(dailyHistory);
  const correlation = calculateBiasPriceCorrelation(dailyHistory);

  let md = `## 1. MARKET BIAS ENGINE (MỚI NHẤT & LỊCH SỬ)\n\n`;

  md += `### 1.1. Nhận Định Thị Trường Mới Nhất (Current Bias Snapshot)\n\n`;
  md += `- **Điểm Số Thị Trường (Market Bias Score):** \`${score != null ? fmtSigned(score, 0) : '0'}/100\`\n`;
  md += `- **Phán Quyết Tổng Thể (Verdict):** **${verdict}**\n`;
  md += `- **Chế Độ Thị Trường (Market Regime):** \`${regime}\`\n`;
  md += `- **Độ Tin Cậy Định Lượng (Confidence Level):** \`${confidence}%\`\n`;
  md += `- **Đánh Giá Tóm Lược:** ${biasData?.summary || biasData?.strategicNote || 'Dữ liệu được lượng hóa độc lập từ 5 trụ cột đa khung thời gian.'}\n\n`;

  md += `#### Bảng Phân Rã 5 Trụ Cột Định Lượng (5-Pillar Decomposition)\n\n`;
  md += `| Trụ Cột (Pillar) | Trọng Số | Điểm Thành Phần (-100 đến +100) | Trạng Thái Đánh Giá | Tín Hiệu Chi Tiết |\n`;
  md += `| :--- | :---: | :---: | :---: | :--- |\n`;

  const pillarRows = [
    { name: '1. Xu Hướng & Cấu Trúc Giá (Trend)', weight: '30%', key: 'trend', data: pillars.trend || breakdown.trend },
    { name: '2. Thanh Khoản & Dòng Tiền (Liquidity)', weight: '25%', key: 'liquidity', data: pillars.liquidity || breakdown.liquidity },
    { name: '3. Định Vị Phái Sinh (Derivatives)', weight: '20%', key: 'derivatives', data: pillars.derivatives || breakdown.derivatives },
    { name: '4. Tâm Lý & Đòn Bẩy (Sentiment)', weight: '15%', key: 'sentiment', data: pillars.sentiment || breakdown.sentiment },
    { name: '5. Môi Trường Vĩ Mô (Macro)', weight: '10%', key: 'macro', data: pillars.macro || breakdown.macro },
  ];

  pillarRows.forEach((p) => {
    const pScore = toFiniteNumber(p.data?.score ?? p.data);
    const pStatus = p.data?.status || p.data?.label || (pScore > 20 ? 'TÍCH CỰC' : pScore < -20 ? 'TIÊU CỰC' : 'TRUNG LẬP');
    const pDetail = p.data?.reason || p.data?.detail || p.data?.desc || '---';
    md += `| **${p.name}** | ${p.weight} | \`${pScore != null ? fmtSigned(pScore, 1) : '---'}\` | **${pStatus}** | ${pDetail} |\n`;
  });
  md += `\n`;

  md += `### 1.2. Phân Tích Lịch Sử & Tương Quan Giá (Historical Bias & Divergence)\n\n`;
  if (correlation) {
    const pearsonR = toFiniteNumber(correlation.r ?? correlation.pearson);
    const pearsonLabel = correlation.label || correlation.interpretation || '---';
    md += `- **Hệ Số Tương Quan Pearson (30D Bias vs Price):** \`${pearsonR != null ? fmtSigned(pearsonR, 2) : '---'}\` (${pearsonLabel})\n`;
  }
  if (divergenceAnalysis) {
    const divState = divergenceAnalysis.label || divergenceAnalysis.type || 'Chưa phát hiện phân kỳ';
    const divDesc = divergenceAnalysis.desc || divergenceAnalysis.description || 'Giá và điểm Bias đang đồng thuận xu hướng.';
    md += `- **Tín Hiệu Phân Kỳ (Divergence State):** **${divState}**\n`;
    md += `- **Mô Tả Phân Kỳ:** ${divDesc}\n\n`;
  }

  if (dailyHistory && dailyHistory.length > 0) {
    md += `#### Chuỗi Lịch Sử Market Bias 30 Ngày Qua\n\n`;
    md += `| Ngày (UTC) | Giá BTC Đóng ($) | Bias Score | Verdict | Chế Độ (Regime) | Trend | Liquidity | Deriv | Sent | Macro |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    // Take recent 15 entries for readability
    const recentHistory = dailyHistory.slice(-15);
    recentHistory.forEach((h) => {
      const p = h.pillars || {};
      const dateVal = h.fullDateStr || h.dateStr || h.date || h.time || (h.timestamp ? new Date(h.timestamp).toISOString().slice(0, 10) : '---');
      const priceVal = toFiniteNumber(h.btcPrice ?? h.price);
      const scoreVal = toFiniteNumber(h.biasScore ?? h.score);
      const verdictVal = h.label || h.verdict || '---';
      const regimeVal = h.regime || (scoreVal != null ? (scoreVal > 20 ? 'TĂNG TRƯỞNG' : scoreVal < -20 ? 'SUY YẾU' : 'CHOP / CONSOLIDATION') : '---');
      const trendScore = p.trend?.score ?? p.trend;
      const liqScore = p.liquidity?.score ?? p.liquidity;
      const derivScore = p.derivatives?.score ?? p.derivatives;
      const sentScore = p.sentiment?.score ?? p.sentiment;
      const macroScore = p.macro?.score ?? p.macro;

      md += `| ${dateVal} | ${fmtNum(priceVal, 0)} | \`${fmtSigned(scoreVal, 0)}\` | ${verdictVal} | ${regimeVal} | ${fmtNum(trendScore, 0)} | ${fmtNum(liqScore, 0)} | ${fmtNum(derivScore, 0)} | ${fmtNum(sentScore, 0)} | ${fmtNum(macroScore, 0)} |\n`;
    });
    md += `\n`;
  }

  if (localSnapshots && localSnapshots.length > 0) {
    md += `#### Các Bản Ghi Snapshot Gần Nhất Được Lưu Trữ (Local Snapshot Log)\n\n`;
    md += `| Thời Gian (GMT+7) | Giá BTC ($) | Điểm Bias | Verdict | Ghi Chú |\n`;
    md += `| :--- | :---: | :---: | :---: | :--- |\n`;
    localSnapshots.slice(0, 8).forEach((s) => {
      md += `| ${s.timestampVn || fmtDateVn(s.timestamp)} | ${fmtNum(s.btcPrice, 0)} | \`${fmtSigned(s.score, 0)}\` | ${s.verdict || '---'} | ${s.note || 'Snapshot định kỳ'} |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 2: Options Regime Builder ─────────────────────────────────────────

function buildOptionsRegimeSection(optionsAnalysis, btcSpotPrice) {
  let md = `## 2. OPTIONS REGIME — BTC (DERIBIT) (MỚI NHẤT & LỊCH SỬ PHÂN BỔ)\n\n`;

  if (!optionsAnalysis) {
    md += `*Chưa có dữ liệu Options Deribit hoặc API Deribit chưa phản hồi tại thời điểm xuất.*\n\n`;
    return md;
  }

  const spot = toFiniteNumber(optionsAnalysis.meta?.underlyingPrice ?? btcSpotPrice);
  const regime = optionsAnalysis.gammaRegime || 'NEUTRAL';
  const gexFlip = toFiniteNumber(optionsAnalysis.gexFlip);
  const callWall = optionsAnalysis.walls?.callWall;
  const putWall = optionsAnalysis.walls?.putWall;
  const maxPain = toFiniteNumber(optionsAnalysis.maxPain?.maxPainPrice ?? optionsAnalysis.maxPain);
  const pcrOi = toFiniteNumber(optionsAnalysis.pcr?.oiPcr);
  const pcrVol = toFiniteNumber(optionsAnalysis.pcr?.volumePcr);
  const totalCalls = toFiniteNumber(optionsAnalysis.totalOI?.calls);
  const totalPuts = toFiniteNumber(optionsAnalysis.totalOI?.puts);
  const totalOI = toFiniteNumber(optionsAnalysis.totalOI?.total);

  md += `### 2.1. Cấu Trúc Quyền Chọn & Trạng Thái Gamma Mới Nhất\n\n`;
  md += `- **Giá BTC Cơ Sở (Underlying Spot Price):** ${fmtUsd(spot, 2)}\n`;
  md += `- **Chế Độ Gamma (Gamma Regime):** \`${regime}\` ${
    regime === 'POSITIVE_GAMMA'
      ? '*(Market Makers giao dịch ngược chiều, triệt tiêu biến động -> Thị trường có xu hướng đi ngang/mean-revert)*'
      : regime === 'NEGATIVE_GAMMA'
      ? '*(Market Makers giao dịch thuận chiều, khuếch đại biến động -> Nguy cơ nổ vol/breakout mạnh)*'
      : '*(Vùng chuyển tiếp nhạy cảm)*'
  }\n`;
  md += `- **Điểm Lật Gamma (GEX Flip Level):** ${gexFlip != null ? fmtUsd(gexFlip, 0) : '---'}\n`;
  md += `- **Call Wall (Kháng Cự Quyền Chọn Mạnh Nhất):** ${callWall?.strike ? `${fmtUsd(callWall.strike, 0)} (${fmtNum(callWall.callOI, 1)} BTC OI)` : '---'}\n`;
  md += `- **Put Wall (Hỗ Trợ Quyền Chọn Mạnh Nhất):** ${putWall?.strike ? `${fmtUsd(putWall.strike, 0)} (${fmtNum(putWall.putOI, 1)} BTC OI)` : '---'}\n`;
  md += `- **Mức Giá Đau Đớn Cực Đại (Max Pain):** ${maxPain != null ? fmtUsd(maxPain, 0) : '---'}\n`;
  md += `- **Tỷ Lệ Put/Call (PCR theo OI):** \`${fmtNum(pcrOi, 3)}\` ${pcrOi > 0.8 ? '(Thiên về Hedging Bảo Vệ Rủi Ro)' : pcrOi < 0.5 ? '(Thiên về Lạc Quan/Call Mua Đuổi)' : '(Cân Bằng)'}\n`;
  md += `- **Tỷ Lệ Put/Call (PCR theo Khối Lượng 24h):** \`${fmtNum(pcrVol, 3)}\`\n`;
  md += `- **Tổng Khối Lượng Mở Quyền Chọn (Total Options OI):** \`${fmtNum(totalOI, 0)} BTC\` (Calls: ${fmtNum(totalCalls, 0)} BTC | Puts: ${fmtNum(totalPuts, 0)} BTC)\n\n`;

  if (optionsAnalysis.narrative) {
    const narrativeText = typeof optionsAnalysis.narrative === 'string'
      ? optionsAnalysis.narrative
      : (optionsAnalysis.narrative?.fullText || [
          optionsAnalysis.narrative?.executive,
          optionsAnalysis.narrative?.positioning,
          optionsAnalysis.narrative?.sentiment,
          optionsAnalysis.narrative?.action,
        ].filter(Boolean).join('\n\n') || '');

    if (narrativeText) {
      md += `#### Báo Cáo Phân Tích Định Lượng Quyền Chọn (ASP-100 Synthesis)\n\n`;
      md += `> ${narrativeText.replace(/\n/g, '\n> ')}\n\n`;
    }
  }

  // Expiries Breakdown
  if (Array.isArray(optionsAnalysis.expiries) && optionsAnalysis.expiries.length > 0) {
    md += `### 2.2. Phân Bổ Theo Ngày Đáo Hạn (Term Structure Breakdown)\n\n`;
    md += `| Kỳ Đáo Hạn (Expiry) | DTE (Số Ngày) | Tổng Call OI (BTC) | Tổng Put OI (BTC) | PCR Kỳ | Call/Put Trọng Tâm |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :--- |\n`;
    optionsAnalysis.expiries.slice(0, 10).forEach((exp) => {
      const expCall = toFiniteNumber(exp.callOI ?? exp.calls);
      const expPut = toFiniteNumber(exp.putOI ?? exp.puts);
      const expPcr = expCall && expPut ? expPut / expCall : null;
      md += `| **${exp.expiry || exp.date || '---'}** | ${exp.dte ?? '---'} | ${fmtNum(expCall, 1)} | ${fmtNum(expPut, 1)} | \`${fmtNum(expPcr, 2)}\` | Calls: ${exp.topCallStrike || '---'} / Puts: ${exp.topPutStrike || '---'} |\n`;
    });
    md += `\n`;
  }

  // Strike Distribution (Top 12 Strikes by OI)
  if (Array.isArray(optionsAnalysis.strikeDistribution) && optionsAnalysis.strikeDistribution.length > 0) {
    md += `### 2.3. Top 12 Mức Strike Có Khối Lượng OI Lớn Nhất (Major Strike Distribution)\n\n`;
    md += `| Mức Strike ($) | Call OI (BTC) | Put OI (BTC) | Tổng OI (BTC) | Net GEX ($/BTC) | Khoảng Cách So Với Spot (%) | Vai Trò |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;
    const sortedStrikes = [...optionsAnalysis.strikeDistribution]
      .sort((a, b) => (toFiniteNumber(b.totalOI) || 0) - (toFiniteNumber(a.totalOI) || 0))
      .slice(0, 12);

    sortedStrikes.forEach((s) => {
      const diffPct = spot ? ((s.strike - spot) / spot) * 100 : null;
      const role = s.strike === callWall?.strike ? '🏆 CALL WALL' : s.strike === putWall?.strike ? '🛡️ PUT WALL' : s.strike === maxPain ? '🎯 MAX PAIN' : s.strike > (spot || 0) ? 'Kháng cự tiềm năng' : 'Hỗ trợ tiềm năng';
      md += `| **$${s.strike.toLocaleString()}** | ${fmtNum(s.callOI, 1)} | ${fmtNum(s.putOI, 1)} | ${fmtNum(s.totalOI, 1)} | ${fmtCompactUsd(s.gex)} | \`${fmtSigned(diffPct, 1, '%')}\` | ${role} |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 3: Spot Bitcoin ETF Flows Builder ─────────────────────────────────

function buildEtfFlowSection(etfHoldings, etfHistory, btcSpotPrice) {
  let md = `## 3. SPOT BITCOIN ETF FLOW (MỚI NHẤT & LỊCH SỬ)\n\n`;

  const totalBtc = toFiniteNumber(etfHoldings?.total);
  const spotPrice = toFiniteNumber(btcSpotPrice);
  const totalUsd = totalBtc && spotPrice ? totalBtc * spotPrice : null;
  const funds = Array.isArray(etfHoldings?.funds) ? etfHoldings.funds : [];

  const flows = Array.isArray(etfHistory) ? etfHistory : [];
  const latestFlow = flows.length > 0 ? flows[flows.length - 1] : null;
  const validFlows7d = flows.slice(-7).map((f) => toFiniteNumber(f.flow)).filter((f) => f != null);
  const sum7d = validFlows7d.reduce((acc, v) => acc + v, 0);
  const validFlows30d = flows.slice(-30).map((f) => toFiniteNumber(f.flow)).filter((f) => f != null);
  const sum30d = validFlows30d.reduce((acc, v) => acc + v, 0);

  const posDays7d = validFlows7d.filter((v) => v > 0).length;
  const negDays7d = validFlows7d.filter((v) => v < 0).length;

  md += `### 3.1. Tổng Quan Dòng Vốn Thể Chế ETF Mới Nhất\n\n`;
  md += `- **Tổng Lượng BTC Do Các Quỹ ETF Nắm Giữ:** \`${fmtNum(totalBtc, 0)} BTC\`\n`;
  md += `- **Tổng Giá Trị Tài Sản Quản Lý (AUM):** \`${fmtCompactUsd(totalUsd)}\` (${fmtUsd(spotPrice, 0)}/BTC)\n`;
  md += `- **Ngày Báo Cáo Gần Nhất:** \`${latestFlow?.date || etfHoldings?.date || '---'}\`\n`;
  md += `- **Dòng Tiền Ròng Phiên Gần Nhất (Latest Day Net Flow):** \`${fmtSigned(toFiniteNumber(latestFlow?.flow), 1, 'M USD')}\`\n`;
  md += `- **Tổng Dòng Tiền Ròng 7 Ngày (7-Day Cumulative):** \`${fmtSigned(sum7d, 1, 'M USD')}\` (${posDays7d} ngày bơm ròng / ${negDays7d} ngày rút ròng)\n`;
  md += `- **Tổng Dòng Tiền Ròng 30 Ngày (30-Day Cumulative):** \`${fmtSigned(sum30d, 1, 'M USD')}\`\n\n`;

  // Detailed Flow History Table
  if (flows.length > 0) {
    md += `### 3.2. Lịch Sử Dòng Tiền ETF Hằng Ngày (30 Phiên Gần Nhất)\n\n`;
    md += `| Ngày (Date) | Dòng Tiền Ròng ($M USD) | Quy Đổi BTC Tương Đương | Trạng Thái Dòng Tiền | Ghi Chú |\n`;
    md += `| :--- | :---: | :---: | :---: | :--- |\n`;
    const recentFlows = flows.slice(-30).reverse();
    recentFlows.forEach((row) => {
      const fl = toFiniteNumber(row.flow);
      const btcEq = fl && spotPrice ? (fl * 1e6) / spotPrice : null;
      const status = fl > 50 ? '🟢 BƠM MẠNH' : fl > 0 ? '🟢 Bơm ròng' : fl < -50 ? '🔴 XẢ MẠNH' : fl < 0 ? '🔴 Rút ròng' : '⚪ Trung lập / Nghỉ';
      md += `| **${row.date || '---'}** | \`${fmtSigned(fl, 1, 'M')}\` | ${fmtSigned(btcEq, 0)} BTC | ${status} | ${row.status || 'Đã xác nhận'} |\n`;
    });
    md += `\n`;
  }

  // Holdings by Issuers Table
  if (funds.length > 0) {
    md += `### 3.3. Danh Mục Nắm Giữ Theo Từng Quỹ Phát Hành (ETF Fund Holdings)\n\n`;
    md += `| Mã Quỹ (Ticker) | Tên Quỹ & Đơn Vị Phát Hành | Số BTC Nắm Giữ | Tỷ Trọng Thị Phần (%) | Biến Động Gần Nhất |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: |\n`;
    funds.forEach((fund) => {
      const fundBtc = toFiniteNumber(fund.btc ?? fund.holdings);
      const sharePct = totalBtc && fundBtc ? (fundBtc / totalBtc) * 100 : null;
      md += `| **${fund.ticker || '---'}** | ${fund.name || fund.issuer || '---'} | ${fmtNum(fundBtc, 0)} BTC | \`${fmtNum(sharePct, 2)}%\` | ${fmtSigned(fund.change, 0)} BTC |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 4: CME Bitcoin Futures COT Builder ───────────────────────────────

function buildCmeCotSection(cotData) {
  let md = `## 4. CME BITCOIN FUTURES COT (COMMITMENTS OF TRADERS) (MỚI NHẤT & LỊCH SỬ)\n\n`;

  if (!cotData) {
    md += `*Chưa có dữ liệu CME COT hoặc đang chờ đồng bộ từ CFTC.*\n\n`;
    return md;
  }

  const am = cotData.assetManager || cotData.assetManagerInstitutional || {};
  const lf = cotData.leveragedFunds || {};
  const dealer = cotData.dealer || cotData.dealerIntermediary || {};
  const nonRept = cotData.nonRept || cotData.nonReportable || {};
  const totalOi = toFiniteNumber(cotData.openInterest);

  md += `### 4.1. Báo Cáo Vị Thế Thể Chế CME Mới Nhất\n\n`;
  md += `- **Ngày Báo Cáo CFTC (Report Date):** \`${cotData.date || cotData.rawDate || '---'}\` *(Dữ liệu chốt Thứ Ba, công bố tối Thứ Sáu hàng tuần)*\n`;
  md += `- **Tổng Open Interest Hợp Đồng CME:** \`${fmtNum(totalOi, 0)} hợp đồng\` (tương đương ~${fmtNum(totalOi ? totalOi * 5 : null, 0)} BTC)\n`;
  md += `- **Chế Độ Định Vị COT (Regime):** **${cotData.regime?.label || cotData.regime || 'THEO DÕI ĐỊNH KỲ'}**\n`;
  md += `- **Tổng Quan Chiến Lược (Narrative):** ${cotData.narrative?.overview || (typeof cotData.narrative === 'string' ? cotData.narrative : 'Theo dõi hành vi dịch chuyển giữa Quản lý tài sản (Asset Managers) và Quỹ đòn bẩy (Leveraged Funds).')}\n\n`;

  md += `#### Bảng Vị Thế Các Nhóm Nhà Đầu Tư Trên CME\n\n`;
  md += `| Phân Loại Nhóm (Category) | Vị Thế Long | Vị Thế Short | Vị Thế Ròng (Net) | Thay Đổi Tuần (WoW) | Chỉ Số COT Index 3Y |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  const categories = [
    { name: 'Quản Lý Tài Sản (Asset Managers - Long Only ETF/Hedge)', data: am },
    { name: 'Quỹ Đòn Bẩy (Leveraged Funds - Arbitrage/Basis)', data: lf },
    { name: 'Đại Lý & Trung Gian (Dealers / Intermediaries)', data: dealer },
    { name: 'Nhỏ Lẻ Phi Báo Cáo (Non-Reportable / Retail)', data: nonRept },
  ];

  categories.forEach((cat) => {
    const l = toFiniteNumber(cat.data.long);
    const s = toFiniteNumber(cat.data.short);
    const net = toFiniteNumber(cat.data.net ?? (l != null && s != null ? l - s : null));
    const wow = toFiniteNumber(cat.data.netChange ?? cat.data.changeWoW ?? cat.data.change);
    const zIndex = toFiniteNumber(cat.data.cotIndex ?? cat.data.index3y);
    md += `| **${cat.name}** | ${fmtNum(l, 0)} | ${fmtNum(s, 0)} | \`${fmtSigned(net, 0)}\` | ${fmtSigned(wow, 0)} | ${zIndex != null ? `${fmtNum(zIndex, 1)}%` : '---'} |\n`;
  });
  md += `\n`;

  // Historical COT Table
  const history = Array.isArray(cotData.history) ? cotData.history : [];
  if (history.length > 0) {
    md += `### 4.2. Lịch Sử Vị Thế CME COT (16 Tuần Gần Nhất)\n\n`;
    md += `| Ngày Báo Cáo | Tổng OI | Asset Mgr Net | Leveraged Net | WoW Shift Asset Mgr | WoW Shift Lev Funds | Chế Độ COT |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;
    history.slice(0, 16).forEach((h) => {
      const amNet = h.assetManager?.net ?? h.assetManagerNet ?? h.amNet;
      const lfNet = h.leveragedFunds?.net ?? h.leveragedFundsNet ?? h.lfNet;
      const amWoW = h.assetManager?.netChange ?? h.amChangeWoW ?? h.assetManager?.changeWoW;
      const lfWoW = h.leveragedFunds?.netChange ?? h.lfChangeWoW ?? h.leveragedFunds?.changeWoW;
      const hDate = h.date || h.rawDate || '---';
      const hRegime = h.regime?.label ?? (typeof h.regime === 'string' ? h.regime : null) ?? (cotData.regime?.label ?? (typeof cotData.regime === 'string' ? cotData.regime : '---'));
      md += `| **${hDate}** | ${fmtNum(h.openInterest, 0)} | \`${fmtSigned(amNet, 0)}\` | \`${fmtSigned(lfNet, 0)}\` | ${fmtSigned(amWoW, 0)} | ${fmtSigned(lfWoW, 0)} | ${hRegime} |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 5: Macro Dashboard v2 Builder ────────────────────────────────────

function buildMacroDashboardSection(dashboardData, liveBtcPrice, macroDashboardCalculated) {
  let md = `## 5. MACRO DASHBOARD v2 (MỚI NHẤT & LỊCH SỬ)\n\n`;

  const spotPrice = toFiniteNumber(liveBtcPrice ?? dashboardData?.btc?.price);
  const current = macroDashboardCalculated?.current || {};
  const valZone = current.valZone ?? current.valuationZone ?? 'FAIR VALUE';
  const valZLong = toFiniteNumber(current.valZLong ?? current.longValuator?.z);
  const valZShort = toFiniteNumber(current.valZShort ?? current.shortValuator?.z);
  const bandLower = toFiniteNumber(current.bandLower ?? current.longValuator?.lower);
  const bandUpper = toFiniteNumber(current.bandUpper ?? current.longValuator?.upper);
  const pnlZone = current.pnlZone ?? current.pnl?.zone ?? 'NEUTRAL / ACCUMULATION';
  const weightedAvg = toFiniteNumber(current.weightedAverage ?? current.pnl?.weightedAverage);
  const pnlPercentile = toFiniteNumber(current.percentile ?? current.pnl?.percentile);
  const pnlUnderwater = toFiniteNumber(current.underwater ?? current.pnl?.underwater);
  const rois = Array.isArray(current.rois) ? current.rois : (Array.isArray(current.pnl?.rois) ? current.pnl.rois : []);

  md += `### 5.1. Định Giá Vĩ Mô & Ma Trận PnL Nhà Đầu Tư (Macro Valuator & PnL Matrix)\n\n`;
  md += `- **Giá BTC Giao Ngay:** ${fmtUsd(spotPrice, 2)}\n`;
  md += `- **Vùng Định Giá Valuator (Zone):** **${valZone}**\n`;
  md += `- **Hệ Số Z-Score Dài Hạn (Long-term Z):** \`${fmtSigned(valZLong, 2)}\`${bandLower != null && bandUpper != null ? ` (Dải: [${fmtUsd(bandLower, 0)} - ${fmtUsd(bandUpper, 0)}])` : ''}\n`;
  md += `- **Hệ Số Z-Score Ngắn Hạn (Short-term Z):** \`${fmtSigned(valZShort, 2)}\`\n`;
  md += `- **Chế Độ PnL Nhóm Tuổi (PnL Regime):** **${pnlZone}**\n`;
  md += `- **Lợi Nhuận Trung Bình Gia Quyền (Weighted ROI):** \`${fmtSigned(weightedAvg, 2, '%')}\`\n`;
  md += `- **Xếp Hạng Bách Phân Vị Lịch Sử (Percentile Ranking):** \`${fmtNum(pnlPercentile, 1)}%\`\n`;
  md += `- **Tỷ Lệ Nhóm Nhà Đầu Tư Bị Lỗ (Underwater Cohort):** \`${fmtNum(pnlUnderwater, 1)}%\`\n\n`;

  if (rois.length >= 4) {
    md += `#### Chi Tiết Lợi Nhuận (ROI) Theo Từng Nhóm Tuổi Nhà Đầu Tư\n\n`;
    md += `| Nhóm Nhà Đầu Tư | Thời Gian Nắm Giữ | ROI Hiện Tại (%) | Trạng Thái Lời/Lỗ |\n`;
    md += `| :--- | :---: | :---: | :--- |\n`;
    const cohorts = ['1 Năm (1Y Cohort)', '2 Năm (2Y Cohort)', '3 Năm (3Y Cohort)', '4 Năm (4Y Cohort)'];
    cohorts.forEach((name, i) => {
      const roiVal = rois[i];
      md += `| **${name}** | ~${i + 1} Năm | \`${fmtSigned(roiVal, 2, '%')}\` | ${roiVal > 50 ? '🟢 Lãi lớn' : roiVal > 0 ? '🟢 Có lãi' : '🔴 Đang lỗ'} |\n`;
    });
    md += `\n`;
  }

  // Production Cost & On-Chain Network
  const diffT = toFiniteNumber(dashboardData?.onChain?.difficulty);
  const hashEH = toFiniteNumber(dashboardData?.onChain?.hashRate);
  let floorCost = null;
  let baseCost = null;
  let upperCost = null;
  if (diffT) {
    const rawCost = (diffT / 1e12) * 580;
    floorCost = Math.round(rawCost * 0.7);
    baseCost = Math.round(rawCost);
    upperCost = Math.round(rawCost * 1.35);
  }

  md += `### 5.2. Chi Phí Sản Xuất Khai Thác Bitcoin (Mining Production Cost)\n\n`;
  md += `- **Độ Khó Khai Thác (Network Difficulty):** \`${fmtNum(diffT, 2)} T\`\n`;
  md += `- **Tốc Độ Băm Toàn Mạng (Hashrate):** \`${fmtNum(hashEH, 2)} EH/s\`\n`;
  md += `- **Chi Phí Sàn Sản Xuất (Floor Cost):** ${fmtUsd(floorCost, 0)}\n`;
  md += `- **Chi Phí Sản Xuất Cơ Sở (Baseline Cost):** ${fmtUsd(baseCost, 0)}\n`;
  md += `- **Chi Phí Trần Biên Giới (Upper Boundary Cost):** ${fmtUsd(upperCost, 0)}\n`;
  if (baseCost && spotPrice) {
    const costRatio = spotPrice / baseCost;
    md += `- **Tỷ Số Giá / Chi Phí Sản Xuất:** \`${fmtNum(costRatio, 2)}x\` ${costRatio < 1 ? '⚠️ Thợ đào chịu áp lực bán tháo/cắt lỗ' : costRatio > 1.8 ? '🟢 Thợ đào siêu lợi nhuận' : '⚪ Vùng cân bằng kinh tế'}\n\n`;
  }

  // Macro Indicators from FRED
  const fedRate = toFiniteNumber(dashboardData?.fedFundsRate?.val ?? dashboardData?.fedFundsRate);
  const cpi = toFiniteNumber(dashboardData?.cpi?.val ?? dashboardData?.cpi);
  const realRate = fedRate != null && cpi != null ? parseFloat((fedRate - cpi).toFixed(2)) : null;
  const yield10y = toFiniteNumber(dashboardData?.tenYearYield?.val ?? dashboardData?.tenYearYield);
  const dxy = toFiniteNumber(dashboardData?.dxy?.price ?? dashboardData?.dxy);
  const vix = toFiniteNumber(dashboardData?.vix?.price ?? dashboardData?.vix);
  const sp500 = toFiniteNumber(dashboardData?.sp500?.price ?? dashboardData?.sp500);
  const sp500Chg = toFiniteNumber(dashboardData?.sp500?.changePercent);
  const qqq = toFiniteNumber(dashboardData?.qqq?.price ?? dashboardData?.qqq);
  const qqqChg = toFiniteNumber(dashboardData?.qqq?.changePercent);
  const highYield = toFiniteNumber(dashboardData?.highYield?.val ?? dashboardData?.highYield);
  const unrate = toFiniteNumber(dashboardData?.unrate?.val ?? dashboardData?.unrate);
  const m2 = toFiniteNumber(dashboardData?.m2Supply?.val ?? dashboardData?.m2Supply);
  const netLiq = toFiniteNumber(dashboardData?.netLiquidity);
  const fng = dashboardData?.fngData;

  md += `### 5.3. Bảng Tổng Hợp Chỉ Số Vĩ Mô Đa Tài Sản (Global Macro Dashboard)\n\n`;
  md += `| Chỉ Số Vĩ Mô (Metric) | Giá Trị Hiện Tại | Đơn Vị | Đánh Giá Tác Động Lên Crypto |\n`;
  md += `| :--- | :---: | :---: | :--- |\n`;
  md += `| **Thanh Khoản Ròng Mỹ (US Net Liquidity)** | \`${netLiq != null ? fmtCompactUsd(netLiq * 1e9) : '---'}\` | Tỷ USD | ${netLiq > 6000 ? '🟢 Dư thừa thanh khoản' : '🟡 Thanh khoản thắt chặt'} |\n`;
  md += `| **Lãi Suất Điều Hành Fed (Fed Funds Rate)** | \`${fmtNum(fedRate, 2)}%\` | % | ${fedRate > 4 ? 'Chi phí vốn cao' : 'Thanh khoản nới lỏng'} |\n`;
  md += `| **Lạm Phát CPI YoY** | \`${fmtNum(cpi, 2)}%\` | % | Mục tiêu Fed 2.0% |\n`;
  md += `| **Lãi Suất Thực Ước Tính (Fed Funds - CPI)** | \`${fmtSigned(realRate, 2, '%')}\` | % | ${realRate > 2 ? '⚠️ Lãi suất thực thắt chặt mạnh' : 'Thuận lợi cho tài sản rủi ro'} |\n`;
  md += `| **Lợi Suất Trái Phiếu Mỹ 10 Năm (10Y Yield)** | \`${fmtNum(yield10y, 2)}%\` | % | Benchmark phi rủi ro toàn cầu |\n`;
  md += `| **Chỉ Số Sức Mạnh Đô La Mỹ (DXY)** | \`${fmtNum(dxy, 2)}\` | Điểm | ${dxy > 104 ? '🔴 Đô la mạnh gây áp lực giá BTC' : '🟢 Đô la suy yếu hỗ trợ giá BTC'} |\n`;
  md += `| **Chỉ Số Đo Biến Động Sợ Hãi VIX** | \`${fmtNum(vix, 2)}\` | Điểm | ${vix > 25 ? '⚠️ Hoảng loạn thị trường cổ phiếu' : 'Tâm lý ổn định'} |\n`;
  md += `| **Chỉ Số Chứng Khoán S&P 500** | \`${fmtNum(sp500, 2)}\` (${fmtSigned(sp500Chg, 2, '%')}) | Điểm | Khẩu vị rủi ro TradFi |\n`;
  md += `| **Chỉ Số Công Nghệ Nasdaq 100 (QQQ)** | \`${fmtNum(qqq, 2)}\` (${fmtSigned(qqqChg, 2, '%')}) | Điểm | Tương quan cao với tài sản số |\n`;
  md += `| **Chênh Lệch Tín Dụng Rủi Ro (High Yield Spread)** | \`${fmtNum(highYield, 2)}%\` | % | Đo lường rủi ro thanh khoản doanh nghiệp |\n`;
  md += `| **Tỷ Lệ Thất Nghiệp Mỹ (Unemployment Rate)** | \`${fmtNum(unrate, 2)}%\` | % | Sức khỏe thị trường lao động |\n`;
  md += `| **Cung Tiền Toàn Cầu M2 Mỹ** | \`${m2 != null ? fmtCompactUsd(m2 * 1e9) : '---'}\` | Tỷ USD | Chu kỳ bơm tiền thanh khoản |\n`;
  md += `| **Chỉ Số Sợ Hãi & Tham Lam (Crypto F&G)** | \`${fng?.value || '---'}\` (${fng?.sentiment || '---'}) | /100 | Tâm lý đám đông phái sinh |\n\n`;

  // Macro Dashboard Historical Series
  const series = Array.isArray(macroDashboardCalculated?.series) ? macroDashboardCalculated.series : [];
  if (series.length > 0) {
    md += `### 5.4. Chuỗi Lịch Sử Định Giá Macro Valuator (15 Mốc Nến Gần Nhất)\n\n`;
    md += `| Thời Gian | Giá BTC ($) | Long Z-Score | Vùng Định Giá | PnL Weighted ROI (%) | Percentile (%) | Underwater (%) |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    series.slice(-15).reverse().forEach((bar) => {
      const barPrice = toFiniteNumber(bar.price ?? bar.close);
      const barZ = toFiniteNumber(bar.valZLong ?? bar.longValuator?.z);
      const barZone = bar.valZone ?? bar.valuationZone ?? '---';
      const barRoi = toFiniteNumber(bar.weightedAverage ?? bar.pnl?.weightedAverage);
      const barPerc = toFiniteNumber(bar.percentile ?? bar.pnl?.percentile);
      const barUnder = toFiniteNumber(bar.underwater ?? bar.pnl?.underwater);
      const barDate = bar.time ? new Date(bar.time).toISOString().slice(0, 10) : '---';
      md += `| **${barDate}** | ${fmtNum(barPrice, 0)} | \`${fmtSigned(barZ, 2)}\` | ${barZone} | \`${fmtSigned(barRoi, 2, '%')}\` | ${fmtNum(barPerc, 1)}% | ${fmtNum(barUnder, 1)}% |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 6: CVD & Order Flow Builder ──────────────────────────────────────

function buildCvdOrderFlowSection(dashboardData) {
  let md = `## 6. CVD & ORDER FLOW (MỚI NHẤT & LỊCH SỬ 24H, 7D, 30D)\n\n`;

  // 24H series
  const fut24 = Array.isArray(dashboardData?.cvdHistory24h?.points) ? dashboardData.cvdHistory24h.points : (Array.isArray(dashboardData?.cvdHistory24h) ? dashboardData.cvdHistory24h : []);
  const spot24 = Array.isArray(dashboardData?.cvdHistory24hSpot?.points) ? dashboardData.cvdHistory24hSpot.points : (Array.isArray(dashboardData?.cvdHistory24hSpot) ? dashboardData.cvdHistory24hSpot : []);

  const lastFut24 = fut24.length > 0 ? fut24[fut24.length - 1] : null;
  const lastSpot24 = spot24.length > 0 ? spot24[spot24.length - 1] : null;

  const futCvd24Val = toFiniteNumber(dashboardData?.cvdHistory24h?.windowNetDelta ?? lastFut24?.cumulativeWithinWindow ?? lastFut24?.cvd);
  const spotCvd24Val = toFiniteNumber(dashboardData?.cvdHistory24hSpot?.windowNetDelta ?? lastSpot24?.cumulativeWithinWindow ?? lastSpot24?.cvd);

  // Divergence calculation
  let divStatus = 'Đồng thuận biến động';
  let divDesc = 'Cả lực mua giao ngay và dòng tiền phái sinh di chuyển cùng hướng.';
  if (spotCvd24Val != null && futCvd24Val != null) {
    if (spotCvd24Val > 0 && futCvd24Val < 0) {
      divStatus = 'Spot Mua / Futures Short (DIVERGENCE)';
      divDesc = 'Dòng tiền giao ngay hấp thụ cung, phái sinh Short đuổi -> Dễ kích hoạt Short Squeeze.';
    } else if (spotCvd24Val < 0 && futCvd24Val > 0) {
      divStatus = 'Spot Bán / Futures Long (BULL TRAP)';
      divDesc = 'Phái sinh fomo Long đuổi nhưng Spot xả mạnh -> Rủi ro Long Squeeze thanh lý cao.';
    } else if (spotCvd24Val > 0 && futCvd24Val > 0) {
      divStatus = 'Đồng Thuận Mua (Spot + Futures Bullish)';
      divDesc = 'Cả bên mua giao ngay và lực đẩy phái sinh xác nhận đà tăng lành mạnh.';
    } else if (spotCvd24Val < 0 && futCvd24Val < 0) {
      divStatus = 'Đồng Thuận Bán (Spot + Futures Bearish)';
      divDesc = 'Áp lực bán tháo lan tỏa cả thị trường giao ngay và hợp đồng tương lai.';
    }
  }

  md += `### 6.1. Dòng Tiền Taker Mua Bán Chủ Động (CVD Mới Nhất)\n\n`;
  md += `- **CVD Futures 24 Giờ (Binance Futures Net Delta):** \`${fmtCompactUsd(futCvd24Val)}\`\n`;
  md += `- **CVD Spot 24 Giờ (Binance Spot Net Delta):** \`${fmtCompactUsd(spotCvd24Val)}\`\n`;
  md += `- **Trạng Thái Phân Kỳ Spot vs Futures:** **${divStatus}**\n`;
  md += `- **Ý Nghĩa Thực Chiến:** ${divDesc}\n\n`;

  // 24H History Table (Hourly)
  if (fut24.length > 0) {
    md += `### 6.2. Lịch Sử CVD 24 Giờ Qua (Chi Tiết Từng Giờ)\n\n`;
    md += `| Mốc Thời Gian (UTC) | Giá BTC ($) | Futures CVD Net Delta | Spot CVD Net Delta | Taker Mua ($) | Taker Bán ($) |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    fut24.slice(-12).reverse().forEach((row, i) => {
      const spotRow = spot24[spot24.length - 1 - i] || {};
      const fDelta = toFiniteNumber(row.netDelta ?? row.cumulativeWithinWindow ?? row.cvd);
      const sDelta = toFiniteNumber(spotRow.netDelta ?? spotRow.cumulativeWithinWindow ?? spotRow.cvd);
      md += `| **${row.time ? new Date(row.time).toISOString().substring(11, 16) : '---'}** | ${fmtNum(row.price ?? row.close, 0)} | \`${fmtCompactUsd(fDelta)}\` | \`${fmtCompactUsd(sDelta)}\` | ${fmtCompactUsd(row.buyVol)} | ${fmtCompactUsd(row.sellVol)} |\n`;
    });
    md += `\n`;
  }

  // 7D History
  const fut7d = Array.isArray(dashboardData?.cvdHistory7d?.points) ? dashboardData.cvdHistory7d.points : [];
  if (fut7d.length > 0) {
    md += `### 6.3. Lịch Sử CVD Đa Khung Thời Gian (7-Day & 30-Day Synthesis)\n\n`;
    const f7Val = toFiniteNumber(dashboardData?.cvdHistory7d?.windowNetDelta ?? fut7d[fut7d.length - 1]?.cumulativeWithinWindow);
    const s7Val = toFiniteNumber(dashboardData?.cvdHistory7dSpot?.windowNetDelta ?? dashboardData?.cvdHistory7dSpot?.points?.at(-1)?.cumulativeWithinWindow);
    const f30Val = toFiniteNumber(dashboardData?.cvdHistory30d?.windowNetDelta ?? dashboardData?.cvdHistory30d?.points?.at(-1)?.cumulativeWithinWindow);
    const s30Val = toFiniteNumber(dashboardData?.cvdHistory30dSpot?.windowNetDelta ?? dashboardData?.cvdHistory30dSpot?.points?.at(-1)?.cumulativeWithinWindow);

    md += `- **CVD 7 Ngày Futures Net Delta:** \`${fmtCompactUsd(f7Val)}\` | **Spot 7D:** \`${fmtCompactUsd(s7Val)}\`\n`;
    md += `- **CVD 30 Ngày Futures Net Delta:** \`${fmtCompactUsd(f30Val)}\` | **Spot 30D:** \`${fmtCompactUsd(s30Val)}\`\n\n`;
  }

  return md;
}

// ─── Section 7: Flow Regime · 24H Builder ─────────────────────────────────────

function buildFlowRegimeSection(dashboardData, liveChangePct) {
  let md = `## 7. FLOW REGIME · 24H (MỚI NHẤT & BỐI CẢNH VỊ THẾ)\n\n`;

  const futPoints = Array.isArray(dashboardData?.cvdHistory24h?.points) ? dashboardData.cvdHistory24h.points : [];
  const spotPoints = Array.isArray(dashboardData?.cvdHistory24hSpot?.points) ? dashboardData.cvdHistory24hSpot.points : [];

  const buyVol = futPoints.reduce((acc, p) => acc + (toFiniteNumber(p.buyVol) || 0), 0);
  const sellVol = futPoints.reduce((acc, p) => acc + (toFiniteNumber(p.sellVol) || 0), 0);
  const totVol = buyVol + sellVol;
  const netDelta = toFiniteNumber(dashboardData?.cvdHistory24h?.windowNetDelta ?? (buyVol - sellVol));
  const cvdRatio = totVol > 0 && netDelta != null ? (netDelta / totVol) * 100 : null;

  const buyVolSpot = spotPoints.reduce((acc, p) => acc + (toFiniteNumber(p.buyVol) || 0), 0);
  const sellVolSpot = spotPoints.reduce((acc, p) => acc + (toFiniteNumber(p.sellVol) || 0), 0);
  const totVolSpot = buyVolSpot + sellVolSpot;
  const netDeltaSpot = toFiniteNumber(dashboardData?.cvdHistory24hSpot?.windowNetDelta ?? (buyVolSpot - sellVolSpot));
  const cvdRatioSpot = totVolSpot > 0 && netDeltaSpot != null ? (netDeltaSpot / totVolSpot) * 100 : null;

  // OI change
  const oiHist = Array.isArray(dashboardData?.oiHistory) ? dashboardData.oiHistory : [];
  const firstOi = toFiniteNumber(oiHist[0]?.sumOpenInterest);
  const lastOi = toFiniteNumber(dashboardData?.openInterest ?? oiHist[oiHist.length - 1]?.sumOpenInterest);
  const oiChangePct = firstOi && lastOi ? ((lastOi - firstOi) / firstOi) * 100 : null;

  const regime = classifyCapitalFlow({
    priceChangePct: toFiniteNumber(liveChangePct ?? dashboardData?.btc?.change),
    cvdRatioPct: cvdRatio,
    oiChangePct: oiChangePct,
    fundingRate: toFiniteNumber(dashboardData?.fundingRate),
    basisPct: null,
    coveragePct: Math.min(100, (futPoints.length / 24) * 100),
    spotCvdRatioPct: cvdRatioSpot,
    spotNetDelta: netDeltaSpot,
  });

  md += `### 7.1. Phân Loại Chế Độ Dòng Tiền 24 Giờ\n\n`;
  md += `- **Trạng Thái Chế Độ (State):** \`${regime.state || 'CAPITAL_BALANCED'}\`\n`;
  md += `- **Huy Hiệu Hành Động (Action Badge):** **${regime.actionBadge || regime.flow}**\n`;
  md += `- **Nhãn Diễn Giải (Label):** **${regime.label}**\n`;
  md += `- **Chi Tiết Cơ Chế (Mechanism):** ${regime.detail || '---'} (Cơ chế: \`${regime.mechanism}\`)\n`;
  md += `- **Hướng Dòng Tiền (Flow Direction):** \`${regime.flow}\` | **Sắc Thái (Tone):** \`${regime.tone}\`\n`;
  md += `- **Bối Cảnh Chen Lấn Vị Thế (Crowding):** **${regime.crowding?.label || 'Cân bằng'}** (${regime.crowding?.detail || '---'})\n`;
  md += `- **Chất Lượng Dữ Liệu (Quality):** \`${regime.quality?.level || 'GOOD'}\` (Độ bao phủ: ${fmtNum(regime.quality?.coveragePct, 0)}%)\n\n`;

  md += `#### Các Tham Số Đầu Vào Cấu Thành (24H Component Inputs)\n\n`;
  md += `| Tham Số (Parameter) | Giá Trị Quan Sát | Ngưỡng Kích Hoạt | Hướng Nhận Diện |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  md += `| **Biến Động Giá 24H (Price Change)** | \`${fmtSigned(liveChangePct ?? dashboardData?.btc?.change, 2, '%')}\` | ±0.15% | ${regime.priceDirection?.toUpperCase()} |\n`;
  md += `| **Tỷ Lệ Futures CVD Ratio** | \`${fmtSigned(cvdRatio, 2, '%')}\` | ±0.15% | ${regime.cvdDirection?.toUpperCase()} |\n`;
  md += `| **Tỷ Lệ Biến Động Hợp Đồng OI** | \`${fmtSigned(oiChangePct, 2, '%')}\` | ±0.15% | ${regime.oiDirection?.toUpperCase()} |\n`;
  md += `| **Tỷ Lệ Spot CVD Ratio** | \`${fmtSigned(cvdRatioSpot, 2, '%')}\` | ±0.15% | ${netDeltaSpot != null && netDeltaSpot > 0 ? 'BUY' : 'SELL'} |\n`;
  md += `| **Funding Rate Hiện Tại** | \`${fmtSigned(toFiniteNumber(dashboardData?.fundingRate) ? dashboardData.fundingRate * 100 : null, 4, '%')}\` | ±0.05% | ${regime.crowding?.state || 'NORMAL'} |\n\n`;

  return md;
}

// ─── Section 8: Long / Short Ratio Builder ─────────────────────────────────────

function buildLongShortRatioSection(dashboardData) {
  let md = `## 8. LONG / SHORT RATIO (L/S RATIO) (MỚI NHẤT & LỊCH SỬ 24H)\n\n`;

  const lsHist = Array.isArray(dashboardData?.lsHistory) ? dashboardData.lsHistory : [];
  const latestLs = lsHist.length > 0 ? lsHist[lsHist.length - 1] : null;
  const currentRatio = toFiniteNumber(dashboardData?.longShortRatio ?? latestLs?.longShortRatio);
  const rawLong = toFiniteNumber(latestLs?.longAccount);
  const rawShort = toFiniteNumber(latestLs?.shortAccount);
  const longPct = rawLong != null ? (Math.abs(rawLong) <= 1.0 ? rawLong * 100 : rawLong) : null;
  const shortPct = rawShort != null ? (Math.abs(rawShort) <= 1.0 ? rawShort * 100 : rawShort) : null;

  md += `### 8.1. Tỷ Lệ Vị Thế Long/Short Toàn Sàn Mới Nhất\n\n`;
  md += `- **Tỷ Lệ Global Accounts Long/Short:** \`${fmtNum(currentRatio, 3)}\`\n`;
  if (longPct != null && shortPct != null) {
    md += `- **Tỷ Lệ Tài Khoản Phe Long:** \`${fmtNum(longPct, 2)}%\`\n`;
    md += `- **Tỷ Lệ Tài Khoản Phe Short:** \`${fmtNum(shortPct, 2)}%\`\n`;
  }
  md += `- **Đánh Giá Tâm Lý:** ${
    currentRatio > 1.6
      ? '⚠️ Đám đông đang fomo Long quá mức -> Dễ bị giật quét Long Liquidation.'
      : currentRatio < 0.8
      ? '🟢 Đám đông đang Short đông đảo -> Dễ có Short Squeeze kích nổ giá tăng.'
      : '⚪ Tỷ lệ vị thế hai phe đang ở trạng thái cân bằng tương đối.'
  }\n\n`;

  if (lsHist.length > 0) {
    md += `### 8.2. Lịch Sử Biến Động Tỷ Lệ L/S 24 Giờ Qua\n\n`;
    md += `| Thời Gian (UTC) | Tỷ Lệ L/S Ratio | % Phe Long | % Phe Short | Chiều Dịch Chuyển |\n`;
    md += `| :---: | :---: | :---: | :---: | :--- |\n`;
    lsHist.slice(-12).reverse().forEach((row) => {
      const r = toFiniteNumber(row.longShortRatio);
      const rawL = toFiniteNumber(row.longAccount);
      const rawS = toFiniteNumber(row.shortAccount);
      const l = rawL != null ? (Math.abs(rawL) <= 1.0 ? rawL * 100 : rawL) : null;
      const s = rawS != null ? (Math.abs(rawS) <= 1.0 ? rawS * 100 : rawS) : null;
      const timeStr = row.timestamp ? new Date(row.timestamp).toISOString().substring(11, 16) : '---';
      md += `| **${timeStr}** | \`${fmtNum(r, 3)}\` | ${fmtNum(l, 1)}% | ${fmtNum(s, 1)}% | ${r > 1.2 ? 'Nghiêng Long' : r < 0.9 ? 'Nghiêng Short' : 'Cân bằng'} |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 9: Open Interest Builder ──────────────────────────────────────────

function buildOpenInterestSection(dashboardData, liveBtcPrice) {
  let md = `## 9. OPEN INTEREST (OI) (MỚI NHẤT & LỊCH SỬ 24H)\n\n`;

  const spot = toFiniteNumber(liveBtcPrice ?? dashboardData?.btc?.price);
  const currentOi = toFiniteNumber(dashboardData?.openInterest);
  const oiUsd = currentOi && spot ? currentOi * spot : null;

  const oiHist = Array.isArray(dashboardData?.oiHistory) ? dashboardData.oiHistory : [];
  const firstOi = toFiniteNumber(oiHist[0]?.sumOpenInterest);
  const oiChange24h = firstOi && currentOi ? ((currentOi - firstOi) / firstOi) * 100 : null;

  md += `### 9.1. Lượng Hợp Đồng Mở (Open Interest Mới Nhất)\n\n`;
  md += `- **Tổng Open Interest (Số lượng BTC):** \`${fmtNum(currentOi, 0)} BTC\`\n`;
  md += `- **Tổng Giá Trị Quy Đổi (USD Value):** \`${fmtCompactUsd(oiUsd)}\`\n`;
  md += `- **Biến Động OI Trong 24 Giờ Qua:** \`${fmtSigned(oiChange24h, 2, '%')}\`\n\n`;

  md += `#### Ma Trận Ý Nghĩa Phối Hợp Giá & OI\n\n`;
  md += `| Trạng Thái Giá | Trạng Thái OI | Bản Chất Dòng Tiền | Khuyến Nghị Phân Tích |\n`;
  md += `| :---: | :---: | :--- | :--- |\n`;
  md += `| **GIÁ TĂNG** | **OI TĂNG** | Tiền mới đổ vào mở vị thế Long | Xu hướng tăng mạnh mẽ và có sự xác nhận của đòn bẩy |\n`;
  md += `| **GIÁ TĂNG** | **OI GIẢM** | Phe Short đóng lệnh cắt lỗ (Short Covering) | Đợt tăng yếu, dễ đảo chiều khi lực đóng short cạn kiệt |\n`;
  md += `| **GIÁ GIẢM** | **OI TĂNG** | Tiền mới đổ vào mở vị thế Short | Xu hướng giảm mạnh mẽ, phe bán chủ động đè nén |\n`;
  md += `| **GIÁ GIẢM** | **OI GIẢM** | Phe Long bị thanh lý cưỡng bức (Long Liquidation) | Lực bán kiệt quệ sau đợt rũ bỏ đòn bẩy |\n\n`;

  if (oiHist.length > 0) {
    md += `### 9.2. Lịch Sử Biến Động OI 24 Giờ Qua (Chi Tiết Từng Giờ)\n\n`;
    md += `| Thời Gian (UTC) | Lượng OI (BTC) | Giá Trị Ước Tính ($) | Thay Đổi So Với Giờ Trước |\n`;
    md += `| :---: | :---: | :---: | :---: |\n`;
    oiHist.slice(-12).reverse().forEach((row, i, arr) => {
      const oiVal = toFiniteNumber(row.sumOpenInterest);
      const nextVal = arr[i + 1] ? toFiniteNumber(arr[i + 1].sumOpenInterest) : null;
      const hourlyDelta = oiVal && nextVal ? ((oiVal - nextVal) / nextVal) * 100 : null;
      const timeStr = row.timestamp ? new Date(row.timestamp).toISOString().substring(11, 16) : '---';
      md += `| **${timeStr}** | ${fmtNum(oiVal, 0)} BTC | ${fmtCompactUsd(oiVal && spot ? oiVal * spot : null)} | \`${fmtSigned(hourlyDelta, 2, '%')}\` |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 10: Limit Orders (Whale Walls) Builder ───────────────────────────

function buildWhaleWallsSection(whaleWalls, btcSpotPrice) {
  let md = `## 10. LIMIT ORDERS (WHALE WALLS >= $500K)\n\n`;

  if (!whaleWalls) {
    md += `*Chưa có dữ liệu sổ lệnh cá voi đa sàn tại thời điểm xuất.*\n\n`;
    return md;
  }

  const spot = toFiniteNumber(btcSpotPrice);
  const bidRatio = toFiniteNumber(whaleWalls.bidRatio);
  const askRatio = toFiniteNumber(whaleWalls.askRatio ?? (bidRatio != null ? 1 - bidRatio : null));
  const bids = Array.isArray(whaleWalls.whaleBids) ? whaleWalls.whaleBids : [];
  const asks = Array.isArray(whaleWalls.whaleAsks) ? whaleWalls.whaleAsks : [];

  md += `### 10.1. Tỷ Trọng Tường Cá Voi Đa Sàn (Binance, Bybit, OKX, Bitget)\n\n`;
  md += `- **Tiêu Chuẩn Lọc Lệnh Lớn:** Các lệnh treo có giá trị \`>= $500,000 USD\`\n`;
  md += `- **Tỷ Trọng Tường Mua Cá Voi (Whale Bid Share):** \`${fmtNum(bidRatio != null ? bidRatio * 100 : null, 1)}%\`\n`;
  md += `- **Tỷ Trọng Tường Bán Cá Voi (Whale Ask Share):** \`${fmtNum(askRatio != null ? askRatio * 100 : null, 1)}%\`\n`;
  md += `- **Đánh Giá Cán Cân Lực Treo:** **${whaleWalls.signal || (bidRatio > 0.6 ? 'Lực mua đỡ giá chiếm ưu thế' : bidRatio < 0.4 ? 'Lực bán chặn trên đè nén' : 'Cân bằng hai đầu')}**\n\n`;

  if (bids.length > 0) {
    md += `### 10.2. Top Tường Mua Cá Voi Lớn Nhất (Key Bid Walls - Hỗ Trợ)\n\n`;
    md += `| Mức Giá ($) | Khối Lượng (BTC) | Giá Trị Ước Tính ($) | Sàn Giao Dịch | Khoảng Cách Tới Spot (%) |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: |\n`;
    bids.slice(0, 10).forEach((w) => {
      const p = toFiniteNumber(w.price);
      const q = toFiniteNumber(w.qty ?? w.quantity ?? w.amount);
      const usd = toFiniteNumber(w.usdValue ?? w.totalUsd ?? (p && q ? p * q : null));
      const dist = spot && p ? ((p - spot) / spot) * 100 : null;
      const exStr = w.exchange || (w.sources ? Object.keys(w.sources).join(', ') : 'Đa sàn');
      md += `| **${fmtUsd(p, 1)}** | ${fmtNum(q, 2)} BTC | \`${fmtCompactUsd(usd)}\` | ${exStr} | \`${fmtSigned(dist, 2, '%')}\` |\n`;
    });
    md += `\n`;
  }

  if (asks.length > 0) {
    md += `### 10.3. Top Tường Bán Cá Voi Lớn Nhất (Key Ask Walls - Kháng Cự)\n\n`;
    md += `| Mức Giá ($) | Khối Lượng (BTC) | Giá Trị Ước Tính ($) | Sàn Giao Dịch | Khoảng Cách Tới Spot (%) |\n`;
    md += `| :---: | :---: | :---: | :---: | :---: |\n`;
    asks.slice(0, 10).forEach((w) => {
      const p = toFiniteNumber(w.price);
      const q = toFiniteNumber(w.qty ?? w.quantity ?? w.amount);
      const usd = toFiniteNumber(w.usdValue ?? w.totalUsd ?? (p && q ? p * q : null));
      const dist = spot && p ? ((p - spot) / spot) * 100 : null;
      const exStr = w.exchange || (w.sources ? Object.keys(w.sources).join(', ') : 'Đa sàn');
      md += `| **${fmtUsd(p, 1)}** | ${fmtNum(q, 2)} BTC | \`${fmtCompactUsd(usd)}\` | ${exStr} | \`${fmtSigned(dist, 2, '%')}\` |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 11: Order Book Imbalance (OBI) Builder ───────────────────────────

function buildOrderBookImbalanceSection(orderBook) {
  let md = `## 11. ORDER BOOK IMBALANCE (OBI & CẤU TRÚC ĐỘ SÂU SỔ LỆNH)\n\n`;

  if (!orderBook) {
    md += `*Chưa có dữ liệu độ sâu sổ lệnh tổng hợp tại thời điểm xuất.*\n\n`;
    return md;
  }

  const obiPct = toFiniteNumber(orderBook.obiPercent ?? (toFiniteNumber(orderBook.obi) != null ? (Math.abs(orderBook.obi) <= 1 ? orderBook.obi * 100 : orderBook.obi) : null));
  const bidVol = toFiniteNumber(orderBook.bidVolUsd ?? orderBook.bidVolumeUsd ?? orderBook.bidVol);
  const askVol = toFiniteNumber(orderBook.askVolUsd ?? orderBook.askVolumeUsd ?? orderBook.askVol);
  const exchanges = Array.isArray(orderBook.exchanges) ? orderBook.exchanges : [];

  md += `### 11.1. Chỉ Số Mất Cân Bằng Sổ Lệnh Tổng Hợp (Aggregated OBI)\n\n`;
  md += `- **Chỉ Số OBI Tổng Hợp:** \`${fmtSigned(obiPct, 2, '%')}\` *(Công thức: \`(ΣBid - ΣAsk) / (ΣBid + ΣAsk)\`)*\n`;
  md += `- **Phân Loại Tín Hiệu Sổ Lệnh:** **${orderBook.signal || (obiPct > 15 ? 'Áp lực Mua áp đảo' : obiPct < -15 ? 'Áp lực Bán đè nén' : 'Sổ lệnh cân bằng')}**\n`;
  md += `- **Tổng Khối Lượng Bids Đang Treo:** \`${fmtCompactUsd(bidVol)}\`\n`;
  md += `- **Tổng Khối Lượng Asks Đang Treo:** \`${fmtCompactUsd(askVol)}\`\n\n`;

  if (exchanges.length > 0) {
    md += `### 11.2. Mất Cân Bằng OBI Chi Tiết Từng Sàn Giao Dịch\n\n`;
    md += `| Sàn Giao Dịch | Chỉ Số OBI (%) | Lực Mua Khả Dụng ($) | Lực Bán Khả Dụng ($) | Nhận Định Sàn |\n`;
    md += `| :--- | :---: | :---: | :---: | :--- |\n`;
    exchanges.forEach((ex) => {
      const eObi = toFiniteNumber(ex.obi != null ? (Math.abs(ex.obi) <= 1 ? ex.obi * 100 : ex.obi) : null);
      const bV = toFiniteNumber(ex.bidVolUsd ?? ex.bidVol);
      const aV = toFiniteNumber(ex.askVolUsd ?? ex.askVol);
      md += `| **${ex.name || ex.exchange || '---'}** | \`${fmtSigned(eObi, 2, '%')}\` | ${bV != null ? fmtCompactUsd(bV) : '---'} | ${aV != null ? fmtCompactUsd(aV) : '---'} | ${eObi > 10 ? 'Phe Mua chiếm ưu thế' : eObi < -10 ? 'Phe Bán áp đảo' : 'Cân bằng'} |\n`;
    });
    md += `\n`;
  }

  return md;
}

// ─── Section 12: Altcoin Scanner Builder ──────────────────────────────────────

function buildAltcoinScannerSection(scannerData) {
  let md = `## 12. ALTCOIN SCANNER (MỚI NHẤT & LỊCH SỬ TRACKING)\n\n`;

  const snapshot = scannerData?.currentSnapshot;
  if (!snapshot || !Array.isArray(snapshot.assets)) {
    md += `*Chưa có snapshot Altcoin Scanner được nạp. Hệ thống sẽ tự động quét khi truy cập tab Scanner.*\n\n`;
    return md;
  }

  const asOf = snapshot.asOf ? snapshot.asOf.slice(0, 10) : '---';
  const totalAssets = snapshot.assets.length;
  const windowKey = scannerData?.windowKey || DEFAULT_WINDOW || '24h';
  const winLabel = WINDOW_LABELS[windowKey] || windowKey.toUpperCase();
  const summary = snapshot.summary?.[windowKey] || {};

  md += `### 12.1. Tổng Quan Vũ Trụ Altcoins (Snapshot Mới Nhất)\n\n`;
  md += `- **Ngày Snapshot (As Of Date):** \`${asOf}\`\n`;
  md += `- **Quy Mô Vũ Trụ Theo Dõi:** \`${totalAssets} Altcoin USDT thanh khoản lớn nhất\`\n`;
  md += `- **Khung Thời Gian Khảo Sát:** **${winLabel}**\n`;
  md += `- **Tỷ Lệ Altcoin Thắng Giá BTC (RS/BTC > 0):** \`${summary.rsBtcPositiveRatio != null ? `${summary.rsBtcPositiveRatio}%` : '---'}\`\n`;
  md += `- **Tỷ Lệ Altcoin Thắng Giá ETH (RS/ETH > 0):** \`${summary.rsEthPositiveRatio != null ? `${summary.rsEthPositiveRatio}%` : '---'}\`\n`;
  md += `- **Phân Bổ Dòng Tiền Toàn Thị Trường:**\n`;
  if (summary.flowDistribution) {
    const fd = summary.flowDistribution;
    md += `  - 🟢 **Spot Hỗ Trợ (Spot Supported):** ${fd.SPOT_SUPPORTED ?? 0} coins\n`;
    md += `  - 🔵 **Phái Sinh Chi Phối (Derivatives Dominated):** ${fd.DERIVATIVES_DOMINATED ?? 0} coins\n`;
    md += `  - 🟣 **Short Covering:** ${fd.SHORT_COVERING ?? 0} coins\n`;
    md += `  - ⚪ **Hỗn Hợp / Chưa Đủ:** ${fd.MIXED_OR_INSUFFICIENT ?? 0} coins\n\n`;
  }

  // Top 25 Ranked Altcoins Table
  md += `### 12.2. Bảng Xếp Hạng Top 25 Altcoins Điểm Định Lượng Cao Nhất (Khung ${winLabel})\n\n`;
  md += `| Hạng | Cặp Giao Dịch | Nhóm Ngành | Giá ($) | Biến Động 24H (%) | Điểm Tổng (/100) | Nhãn Dòng Tiền | Sức Mạnh RS/BTC (%) | Spot CVD ($) | Futures CVD ($) |\n`;
  md += `| :---: | :--- | :--- | :---: | :---: | :---: | :--- | :---: | :---: | :---: |\n`;

  const sortedAssets = [...snapshot.assets].sort((a, b) => {
    const sA = toFiniteNumber(a.windows?.[windowKey]?.scores?.totalScore) ?? -1;
    const sB = toFiniteNumber(b.windows?.[windowKey]?.scores?.totalScore) ?? -1;
    return sB - sA;
  }).slice(0, 25);

  sortedAssets.forEach((asset, idx) => {
    const win = asset.windows?.[windowKey] || {};
    const scores = win.scores || {};
    const metrics = win.metrics || {};
    const rank = win.rank ?? idx + 1;
    const totalScore = toFiniteNumber(scores.totalScore);
    const rsBtc = toFiniteNumber(metrics.rsBtc);
    const flowText = metrics.flowLabelText || metrics.flowLabel || 'Hỗn hợp';

    const priceVal = toFiniteNumber(metrics.currentPrice ?? metrics.closePrice ?? asset.price);

    md += `| **#${rank}** | **${asset.symbol}** | ${asset.sector || 'Other'} | ${fmtNum(priceVal, 4)} | ${fmtSigned(metrics.priceChangePct ?? metrics.rsBtc, 2, '%')} | \`${totalScore != null ? fmtNum(totalScore, 1) : '---'}\` | ${flowText} | \`${fmtSigned(rsBtc, 2, '%')}\` | ${fmtCompactUsd(metrics.spotCvd)} | ${fmtCompactUsd(metrics.futuresCvd)} |\n`;
  });
  md += `\n`;

  // Historical Tracking Deltas Table
  md += `### 12.3. Lịch Sử Biến Động Vị Thế & Điểm Số (Tracking Deltas vs 1D & 7D Ago)\n\n`;
  md += `| Cặp Giao Dịch | Hạng Hiện Tại | Thay Đổi Hạng (ΔRank 1D) | Thay Đổi Điểm (ΔScore 1D) | Thay Đổi Hạng (ΔRank 7D) | Thay Đổi Điểm (ΔScore 7D) | Đánh Giá Dịch Chuyển |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |\n`;

  sortedAssets.slice(0, 15).forEach((asset) => {
    const win = asset.windows?.[windowKey] || {};
    const tracking = asset.tracking || {};
    const d1 = tracking.diff1d || {};
    const d7 = tracking.diff7d || {};
    const rank = win.rank ?? '---';
    const dRank1 = toFiniteNumber(d1.deltaRank);
    const dScore1 = toFiniteNumber(d1.deltaScore);
    const dRank7 = toFiniteNumber(d7.deltaRank);
    const dScore7 = toFiniteNumber(d7.deltaScore);

    const shiftText = dRank1 > 3 ? '🚀 Thăng hạng vượt trội' : dRank1 < -3 ? '🔻 Tụt hạng' : '⚪ Ổn định';

    md += `| **${asset.symbol}** | #${rank} | ${dRank1 != null ? fmtSigned(dRank1, 0) : '---'} | ${dScore1 != null ? fmtSigned(dScore1, 1) : '---'} | ${dRank7 != null ? fmtSigned(dRank7, 0) : '---'} | ${dScore7 != null ? fmtSigned(dScore7, 1) : '---'} | ${shiftText} |\n`;
  });
  md += `\n`;

  return md;
}

// ─── Main Report Orchestrator ─────────────────────────────────────────────────

/**
 * Builds the complete Markdown report string from all analytical pillars.
 */
export function buildComprehensiveMarkdownReport({
  dashboardData = {},
  biasData = null,
  optionsAnalysis = null,
  etfHoldings = null,
  etfHistory = [],
  whaleWalls = null,
  orderBook = null,
  macroDashboard = null,
  scannerData = null,
  options = {},
} = {}) {
  const now = new Date();
  const session = getCurrentSessionVN(now);
  const spotPrice = toFiniteNumber(options.livePrice ?? dashboardData.btc?.price);
  const liveChange = toFiniteNumber(options.liveChange ?? dashboardData.btc?.change);
  const liveVol = toFiniteNumber(options.liveVolume ?? dashboardData.btc?.volume);

  let doc = `# SOVEREIGN MACRO TERMINAL — COMPREHENSIVE MARKET DATA EXPORT\n\n`;

  doc += `> **Mục Đích Sử Dụng:** File dữ liệu chuẩn hóa toàn diện dùng để import trực tiếp vào các mô hình AI (ChatGPT, Claude, Gemini, DeepSeek) hoặc các nền tảng ghi chú/quản lý tri thức (Obsidian, Notion, Logseq) để phân tích định lượng, backtest giả thuyết và lập kế hoạch giao dịch.\n\n`;

  doc += `## THÔNG TIN TỔNG QUAN PHIÊN XUẤT (DOCUMENT METADATA)\n\n`;
  doc += `- **Thời Gian Xuất (UTC):** \`${fmtDateStr(now)}\`\n`;
  doc += `- **Thời Gian Xuất (Giờ Việt Nam):** \`${fmtDateVn(now)}\`\n`;
  doc += `- **Phiên Giao Dịch:** \`${session?.code || '---'}\` - **${session?.name || 'Phiên Toàn Cầu'}**\n`;
  doc += `- **Giá Bitcoin Giao Ngay (BTC/USDT):** \`${fmtUsd(spotPrice, 2)}\` (${fmtSigned(liveChange, 2, '%')})\n`;
  doc += `- **Khối Lượng Giao Dịch 24H:** \`${fmtCompactUsd(liveVol)}\`\n`;
  doc += `- **Biên Độ 24H (High / Low):** \`$${fmtNum(dashboardData.btc?.high, 0)} / $${fmtNum(dashboardData.btc?.low, 0)}\`\n`;
  doc += `- **Giá Ethereum:** \`${fmtUsd(dashboardData.ethTicker?.price ?? dashboardData.ethPrice?.price, 2)}\` (${fmtSigned(dashboardData.ethTicker?.change ?? dashboardData.ethPrice?.change, 2, '%')})\n`;
  doc += `- **Tỷ Trọng Thống Trị Bitcoin (BTC Dominance):** \`${fmtNum(dashboardData.globalData?.btcDominance, 1)}%\`\n`;
  doc += `- **Tổng Vốn Hóa Thị Trường (Total Crypto Cap):** \`${fmtCompactUsd(dashboardData.globalData?.totalMarketCap)}\`\n\n`;

  doc += `### MỤC LỤC DỮ LIỆU (TABLE OF CONTENTS)\n\n`;
  doc += `1. [Market Bias Engine (Mới Nhất & Lịch Sử)](#1-market-bias-engine-mới-nhất--lịch-sử)\n`;
  doc += `2. [Options Regime — BTC Deribit (Mới Nhất & Lịch Sử Phân Bổ)](#2-options-regime--btc-deribit-mới-nhất--lịch-sử-phân-bổ)\n`;
  doc += `3. [Spot Bitcoin ETF Flow (Mới Nhất & Lịch Sử)](#3-spot-bitcoin-etf-flow-mới-nhất--lịch-sử)\n`;
  doc += `4. [CME Bitcoin Futures COT (Mới Nhất & Lịch Sử)](#4-cme-bitcoin-futures-cot-commitments-of-traders-mới-nhất--lịch-sử)\n`;
  doc += `5. [Macro Dashboard v2 (Mới Nhất & Lịch Sử)](#5-macro-dashboard-v2-mới-nhất--lịch-sử)\n`;
  doc += `6. [CVD & Order Flow (Mới Nhất & Lịch Sử 24h, 7d, 30d)](#6-cvd--order-flow-mới-nhất--lịch-sử-24h-7d-30d)\n`;
  doc += `7. [Flow Regime · 24H (Mới Nhất & Bối Cảnh Vị Thế)](#7-flow-regime--24h-mới-nhất--bối-cảnh-vị-thế)\n`;
  doc += `8. [Long / Short Ratio (L/S Ratio) (Mới Nhất & Lịch Sử 24h)](#8-long--short-ratio-ls-ratio-mới-nhất--lịch-sử-24h)\n`;
  doc += `9. [Open Interest (OI) (Mới Nhất & Lịch Sử 24h)](#9-open-interest-oi-mới-nhất--lịch-sử-24h)\n`;
  doc += `10. [Limit Orders (Whale Walls >= $500K)](#10-limit-orders-whale-walls--500k)\n`;
  doc += `11. [Order Book Imbalance (OBI & Cấu Trúc Độ Sâu)](#11-order-book-imbalance-obi--cấu-trúc-độ-sâu-sổ-lệnh)\n`;
  doc += `12. [Altcoin Scanner (Mới Nhất & Lịch Sử Tracking)](#12-altcoin-scanner-mới-nhất--lịch-sử-tracking)\n`;
  doc += `13. [Phụ Lục: Nguyên Tắc Dữ Liệu & Kiểm Toán](#13-phụ-lục-nguyên-tắc-dữ-liệu--kiểm-toán-data-provenance)\n\n`;
  doc += `---\n\n`;

  // 1. Market Bias
  doc += buildMarketBiasSection(dashboardData, biasData, etfHistory);
  doc += `---\n\n`;

  // 2. Options Regime
  doc += buildOptionsRegimeSection(optionsAnalysis, spotPrice);
  doc += `---\n\n`;

  // 3. ETF Flows
  doc += buildEtfFlowSection(etfHoldings, etfHistory, spotPrice);
  doc += `---\n\n`;

  // 4. CME COT
  doc += buildCmeCotSection(dashboardData.cotData);
  doc += `---\n\n`;

  // 5. Macro Dashboard v2
  doc += buildMacroDashboardSection(dashboardData, spotPrice, macroDashboard);
  doc += `---\n\n`;

  // 6. CVD & Order Flow
  doc += buildCvdOrderFlowSection(dashboardData);
  doc += `---\n\n`;

  // 7. Flow Regime 24H
  doc += buildFlowRegimeSection(dashboardData, liveChange);
  doc += `---\n\n`;

  // 8. L/S Ratio
  doc += buildLongShortRatioSection(dashboardData);
  doc += `---\n\n`;

  // 9. Open Interest
  doc += buildOpenInterestSection(dashboardData, spotPrice);
  doc += `---\n\n`;

  // 10. Limit Orders (Whale Walls)
  doc += buildWhaleWallsSection(whaleWalls, spotPrice);
  doc += `---\n\n`;

  // 11. Order Book Imbalance
  doc += buildOrderBookImbalanceSection(orderBook || dashboardData.orderBook);
  doc += `---\n\n`;

  // 12. Altcoin Scanner
  doc += buildAltcoinScannerSection(scannerData);
  doc += `---\n\n`;

  // 13. Appendix & Provenance
  doc += `## 13. PHỤ LỤC: NGUYÊN TẮC DỮ LIỆU & KIỂM TOÁN (DATA PROVENANCE)\n\n`;
  doc += `- **Quy Tắc Tách Biệt CVD:** Spot CVD và Futures CVD là hai thước đo dòng tiền độc lập. Spot đại diện cho dòng tiền tích lũy rút ví, Futures đại diện cho đòn bẩy ngắn hạn. Không bao giờ gộp chung hai chỉ số này.\n`;
  doc += `- **Độ Trễ Báo Cáo:** CME COT phản ánh vị thế Thứ Ba tuần trước công bố Thứ Sáu (trễ 3-7 ngày); ETF flows công bố sau giờ đóng cửa thị trường Mỹ (T+1); Macro FRED công bố theo lịch thống kê chính phủ.\n`;
  doc += `- **Sổ Lệnh Treo (Limit Orders):** Các tường mua/bán cá voi có thể bị hủy bỏ (cancel/spoofing) trước khi khớp lệnh. Xem các tường này như vùng thanh khoản có điều kiện, không phải cam kết tuyệt đối.\n`;
  doc += `- **Bản Quyền & Thiết Kế:** Tạo bởi Sovereign Macro Terminal v5.1. Dữ liệu phục vụ phân tích kỹ thuật và định lượng khách quan.\n`;

  return doc;
}

// ─── High-Level Async Export Handler ──────────────────────────────────────────

/**
 * Orchestrates fetching any missing sub-datasets (Deribit options, Whale walls,
 * Altcoin scanner snapshots, Macro Valuator), formats the markdown document,
 * and triggers immediate file download.
 */
export async function exportMarketDataToMarkdown({
  dashboardData = {},
  biasData = null,
  etfHoldings = null,
  etfHistory = [],
  options = {},
  onProgress = null,
} = {}) {
  const updateProgress = (step, msg) => {
    if (typeof onProgress === 'function') {
      onProgress({ step, message: msg });
    }
  };

  updateProgress('init', 'Đang thu thập dữ liệu tổng quan...');

  // 1. Calculate Market Bias if not passed
  let resolvedBias = biasData;
  if (!resolvedBias) {
    try {
      resolvedBias = calculateMarketBias(dashboardData, etfHistory);
    } catch (e) {
      console.warn('[MarkdownExport] calculateMarketBias fallback:', e.message);
    }
  }

  // 2. Fetch or resolve Deribit Options Analysis
  updateProgress('options', 'Đang nạp dữ liệu Options Deribit...');
  let optionsAnalysis = options.optionsAnalysis || null;
  if (!optionsAnalysis) {
    try {
      optionsAnalysis = await getDeribitOptionsAnalysis('BTC');
    } catch (e) {
      console.warn('[MarkdownExport] Deribit options fetch error:', e.message);
    }
  }

  // 3. Fetch or resolve Whale Walls & Order Book Depth
  updateProgress('orderflow', 'Đang nạp cấu trúc sổ lệnh & Whale Walls...');
  let whaleWalls = options.whaleWalls || null;
  let orderBook = options.orderBook || null;
  try {
    const [wRes, obRes] = await Promise.allSettled([
      whaleWalls ? Promise.resolve(whaleWalls) : getWhaleWalls('BTCUSDT', 500000),
      orderBook ? Promise.resolve(orderBook) : getOrderBookDepth('BTCUSDT', 100),
    ]);
    if (wRes.status === 'fulfilled') whaleWalls = wRes.value;
    if (obRes.status === 'fulfilled') orderBook = obRes.value;
  } catch (e) {
    console.warn('[MarkdownExport] Orderbook/Whale fetch error:', e.message);
  }

  // 4. Calculate Macro Dashboard candles & valuator
  updateProgress('macro', 'Đang tính toán Macro Dashboard & PnL Matrix...');
  let macroDashboard = options.macroDashboard || null;
  if (!macroDashboard) {
    try {
      const candles = dashboardData?.btcDailyKlinesAll ?? dashboardData?.dailyKlines ?? dashboardData?.klines ?? [];
      if (Array.isArray(candles) && candles.length > 0) {
        macroDashboard = calculateMacroDashboard(candles);
      }
    } catch (e) {
      console.warn('[MarkdownExport] Macro dashboard calculation error:', e.message);
    }
  }

  // 5. Fetch Altcoin Scanner Snapshot & Deltas
  updateProgress('scanner', 'Đang nạp dữ liệu Altcoin Scanner...');
  let scannerData = options.scannerData || null;
  if (!scannerData) {
    try {
      const manifest = await loadScannerManifest();
      const latestDate = manifest?.latestDate;
      if (latestDate) {
        const currentSnapshot = await loadDailySnapshot(latestDate, manifest);
        let prior1d = null;
        let prior7d = null;
        const priors = findPriorSnapshotDates(manifest, latestDate);
        if (priors.date1d) {
          prior1d = await loadDailySnapshot(priors.date1d, manifest).catch(() => null);
        }
        if (priors.date7d) {
          prior7d = await loadDailySnapshot(priors.date7d, manifest).catch(() => null);
        }

        const hydrated = hydrateAssetsWithTracking(currentSnapshot, prior1d, prior7d, null, DEFAULT_WINDOW);
        scannerData = {
          currentSnapshot: { ...currentSnapshot, assets: hydrated },
          manifest,
          windowKey: DEFAULT_WINDOW,
        };
      }
    } catch (e) {
      console.warn('[MarkdownExport] Scanner snapshot load error:', e.message);
    }
  }

  // 6. Generate Markdown
  updateProgress('build', 'Đang biên dịch file Markdown toàn diện...');
  const markdown = buildComprehensiveMarkdownReport({
    dashboardData,
    biasData: resolvedBias,
    optionsAnalysis,
    etfHoldings,
    etfHistory,
    whaleWalls,
    orderBook,
    macroDashboard,
    scannerData,
    options,
  });

  // 7. Download File
  updateProgress('download', 'Đang tải file xuống máy tính...');
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const filename = `crypto_macro_terminal_export_${dateStr}_${timeStr}.md`;

  triggerFileDownload(markdown, filename, 'text/markdown;charset=utf-8;');

  updateProgress('done', 'Xuất file thành công!');

  return {
    success: true,
    filename,
    markdown,
    stats: {
      length: markdown.length,
      lines: markdown.split('\n').length,
      generatedAt: now.toISOString(),
    },
  };
}
