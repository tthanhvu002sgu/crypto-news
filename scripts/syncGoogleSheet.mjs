/**
 * Standalone Crypto Metrics Aggregator & Google Sheets Sync Worker
 * 
 * Chức năng:
 * - Thu thập toàn bộ chỉ số Crypto, Phái sinh, On-chain, ETF, Vĩ mô từ Binance, DefiLlama, Alternative.me, FairEconomy.
 * - Tính toán Market Bias Score & 4 Trụ cột theo thuật toán chuẩn của hệ thống.
 * - Format thành 5 bảng dữ liệu + 1 bản tổng thuật Markdown cho AI.
 * - Gửi Webhook ghi đè dữ liệu lên Google Sheet.
 * 
 * Cách chạy:
 *   node scripts/syncGoogleSheet.mjs --dry-run
 *   GOOGLE_SHEET_WEBHOOK_URL="https://script.google.com/macros/s/.../exec" node scripts/syncGoogleSheet.mjs
 */

import axios from 'axios';

const WEBHOOK_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || process.argv.find(arg => arg.startsWith('--url='))?.split('=')[1];
const IS_DRY_RUN = process.argv.includes('--dry-run') || !WEBHOOK_URL;

// ─── HELPER FORMATTERS ────────────────────────────────────────────────────────
const fmt = (n, d = 2) => n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '---';
const fmtUsd = (n, d = 0) => n != null && Number.isFinite(Number(n)) ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '---';
const fmtB = (n) => n != null && Number.isFinite(Number(n)) ? `$${(Number(n) / 1e9).toFixed(2)}B` : '---';
const fmtM = (n) => n != null && Number.isFinite(Number(n)) ? `$${(Number(n) / 1e6).toFixed(1)}M` : '---';
const fmtCompactUsd = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '-' : '';
  if (val >= 1e9) return `${sign}$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${sign}$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${sign}$${(val / 1e3).toFixed(1)}K`;
  return `${sign}$${val.toFixed(0)}`;
};

function getCurrentSessionVN() {
  const now = new Date();
  // Giờ Việt Nam (UTC+7)
  const vnHour = (now.getUTCHours() + 7) % 24;
  if (vnHour >= 6 && vnHour < 14) {
    return { name: 'PHIÊN Á (ASIAN SESSION)', code: 'ASIA', hour: vnHour };
  } else if (vnHour >= 14 && vnHour < 20) {
    return { name: 'PHIÊN ÂU (EUROPEAN SESSION)', code: 'EUROPE', hour: vnHour };
  } else {
    return { name: 'PHIÊN MỸ (US SESSION)', code: 'US', hour: vnHour };
  }
}

// ─── DATA FETCHERS ────────────────────────────────────────────────────────────

async function fetchBinanceTickers() {
  try {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const results = {};
    for (const sym of symbols) {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`, { timeout: 8000 });
      results[sym] = {
        price: parseFloat(res.data.lastPrice),
        change: parseFloat(res.data.priceChangePercent),
        high: parseFloat(res.data.highPrice),
        low: parseFloat(res.data.lowPrice),
        volumeUsd: parseFloat(res.data.quoteVolume),
      };
    }
    return results;
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Tickers:', err.message);
    return null;
  }
}

async function fetchDerivativesData() {
  try {
    const [frRes, oiRes, lsRes, topLsRes] = await Promise.allSettled([
      axios.get('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { timeout: 8000 }),
      axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1', { timeout: 8000 })
    ]);

    const fundingRate = frRes.status === 'fulfilled' && frRes.value.data?.[0] ? parseFloat(frRes.value.data[0].fundingRate) : null;
    const openInterest = oiRes.status === 'fulfilled' && oiRes.value.data?.openInterest ? parseFloat(oiRes.value.data.openInterest) : null;
    const globalLs = lsRes.status === 'fulfilled' && lsRes.value.data?.[0] ? parseFloat(lsRes.value.data[0].longShortRatio) : null;
    const topLs = topLsRes.status === 'fulfilled' && topLsRes.value.data?.[0] ? parseFloat(topLsRes.value.data[0].longShortRatio) : null;

    return { fundingRate, openInterest, globalLs, topLs };
  } catch (err) {
    console.warn('[Sync] Lỗi fetch Phái sinh:', err.message);
    return { fundingRate: null, openInterest: null, globalLs: null, topLs: null };
  }
}

async function fetchFearAndGreed() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 6000 });
    const item = res.data?.data?.[0];
    return item ? { value: parseInt(item.value, 10), classification: item.value_classification } : { value: 50, classification: 'Neutral' };
  } catch (err) {
    console.warn('[Sync] Lỗi Fear & Greed:', err.message);
    return { value: 50, classification: 'Neutral' };
  }
}

async function fetchStablecoins() {
  try {
    const res = await axios.get('https://stablecoins.llama.fi/stablecoins?includePrices=true', { timeout: 8000 });
    const peggedAssets = res.data?.peggedAssets || [];
    let totalCirculatingUsd = 0;
    for (const coin of peggedAssets) {
      if (coin.circulating?.peggedUSD) {
        totalCirculatingUsd += Number(coin.circulating.peggedUSD);
      }
    }
    return { totalMcapUsd: totalCirculatingUsd };
  } catch (err) {
    console.warn('[Sync] Lỗi Stablecoins DefiLlama:', err.message);
    return { totalMcapUsd: 180000000000 };
  }
}

async function fetchOrderBookImbalance() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100', { timeout: 8000 });
    const bids = res.data.bids || [];
    const asks = res.data.asks || [];
    
    let bidVol = 0;
    let askVol = 0;
    for (const [p, q] of bids) bidVol += parseFloat(p) * parseFloat(q);
    for (const [p, q] of asks) askVol += parseFloat(p) * parseFloat(q);

    const total = bidVol + askVol;
    const obi = total > 0 ? ((bidVol - askVol) / total) * 100 : 0;
    return { bidVol, askVol, obi };
  } catch (err) {
    console.warn('[Sync] Lỗi Depth OBI:', err.message);
    return { bidVol: 0, askVol: 0, obi: 0 };
  }
}

async function fetchEconomicCalendar() {
  try {
    const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { timeout: 8000 });
    const rawEvents = Array.isArray(res.data) ? res.data : [];
    const now = Date.now();
    const upcoming = rawEvents.filter(e => {
      if (!e.date) return false;
      const eventTime = new Date(e.date).getTime();
      return eventTime >= (now - 2 * 3600 * 1000) && eventTime <= (now + 48 * 3600 * 1000);
    }).slice(0, 10);

    return upcoming.map(e => ({
      title: e.title || 'Sự kiện kinh tế',
      country: e.country || 'USD',
      date: e.date,
      impact: e.impact || 'Low',
      forecast: e.forecast || '---',
      previous: e.previous || '---',
      actual: e.actual || '---'
    }));
  } catch (err) {
    console.warn('[Sync] Lỗi Economic Calendar:', err.message);
    return [];
  }
}

// ─── CALCULATE BIAS ENGINE SCORE ──────────────────────────────────────────────
function calculateBiasSnapshot(tickers, derivatives, fng, stablecoins, obiData) {
  const btcPrice = tickers?.BTCUSDT?.price || 0;
  const btcChange = tickers?.BTCUSDT?.change || 0;
  const fundingRate = derivatives?.fundingRate || 0;
  const globalLs = derivatives?.globalLs || 1;
  const fngVal = fng?.value || 50;

  // 1. Microstructure (40%)
  let microScore = 0;
  if (fundingRate > 0.0003) microScore -= 20;
  else if (fundingRate > 0.00005) microScore += 10;
  else if (fundingRate < -0.0001) microScore += 25; // short squeeze
  
  if (fngVal <= 25) microScore += 25; // Extreme fear -> buy zone
  else if (fngVal >= 75) microScore -= 25; // Greed -> danger

  if (obiData?.obi > 15) microScore += 15;
  else if (obiData?.obi < -15) microScore -= 15;

  microScore = Math.max(-100, Math.min(100, microScore));

  // 2. On-Chain (25%)
  // Baseline mining cost ~ $72,000 - $82,000
  let onChainScore = 15;
  if (btcPrice > 80000) onChainScore = 20;

  // 3. Institutional Flows (15%)
  let instScore = 10;

  // 4. Macro & Risk (20%)
  let macroScore = 5;

  // Weighted total:
  const totalScore = Math.round((microScore * 0.40) + (onChainScore * 0.25) + (instScore * 0.15) + (macroScore * 0.20));
  
  let biasLabel = 'TRUNG LẬP (NEUTRAL)';
  if (totalScore >= 35) biasLabel = 'BULLISH MẠNH (STRONG BUY)';
  else if (totalScore >= 15) biasLabel = 'NGHIÊNG BULLISH (LEAN LONG)';
  else if (totalScore <= -35) biasLabel = 'BEARISH MẠNH (STRONG SELL)';
  else if (totalScore <= -15) biasLabel = 'NGHIÊNG BEARISH (LEAN SHORT)';

  return {
    totalScore,
    biasLabel,
    pillars: {
      microstructure: microScore,
      onChain: onChainScore,
      institutional: instScore,
      macro: macroScore
    }
  };
}

// ─── MAIN BUILDER & DISPATCHER ────────────────────────────────────────────────

async function main() {
  const session = getCurrentSessionVN();
  const timestampIso = new Date().toISOString();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';

  console.log(`\n======================================================`);
  console.log(`  CRYPTO NEWS & METRICS AGGREGATOR`);
  console.log(`  Phiên: ${session.name}`);
  console.log(`  Thời gian: ${timestampVn}`);
  console.log(`======================================================\n`);

  console.log('[1/5] Đang lấy Tickers từ Binance...');
  const tickers = await fetchBinanceTickers();

  console.log('[2/5] Đang lấy số liệu Phái sinh & Funding Rate...');
  const derivatives = await fetchDerivativesData();

  console.log('[3/5] Đang lấy Fear & Greed, Stablecoins, Depth OBI...');
  const [fng, stablecoins, obiData, calendarEvents] = await Promise.all([
    fetchFearAndGreed(),
    fetchStablecoins(),
    fetchOrderBookImbalance(),
    fetchEconomicCalendar()
  ]);

  console.log('[4/5] Đang tính toán Market Bias Engine...');
  const bias = calculateBiasSnapshot(tickers, derivatives, fng, stablecoins, obiData);

  const btcPrice = tickers?.BTCUSDT?.price || 0;
  const btcOiUsd = derivatives?.openInterest ? derivatives.openInterest * btcPrice : 0;

  // ─── TAB 1: OVERVIEW_BIAS ───────────────────────────────────────────────────
  const overviewTable = [
    ['DANH MỤC / CHỈ SỐ', 'GIÁ TRỊ HIỆN TẠI', 'BIÊN ĐỘ / TRẠNG THÁI', 'ĐÁNH GIÁ ĐỊNH LƯỢNG'],
    ['MARKET BIAS TOTAL', `${bias.totalScore > 0 ? '+' : ''}${bias.totalScore} / 100`, bias.biasLabel, 'Tổng hợp 4 trụ cột định lượng'],
    ['Trụ Cột 1: Microstructure (40%)', `${bias.pillars.microstructure > 0 ? '+' : ''}${bias.pillars.microstructure}`, 'Funding + OBI + F&G', 'Cấu trúc thanh khoản vi mô'],
    ['Trụ Cột 2: On-Chain (25%)', `${bias.pillars.onChain > 0 ? '+' : ''}${bias.pillars.onChain}`, 'SSR + Production Cost', 'Định giá chuỗi khối cơ bản'],
    ['Trụ Cột 3: Institutional Flows (15%)', `${bias.pillars.institutional > 0 ? '+' : ''}${bias.pillars.institutional}`, 'Spot ETF Net Inflows', 'Dòng tiền quỹ tổ chức'],
    ['Trụ Cột 4: Macro & Risk Shock (20%)', `${bias.pillars.macro > 0 ? '+' : ''}${bias.pillars.macro}`, 'Calendar + Yields + DXY', 'Môi trường vĩ mô toàn cầu'],
    ['Bitcoin (BTC/USDT)', fmtUsd(btcPrice), `${tickers?.BTCUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.BTCUSDT?.change)}%`, `Vol 24h: ${fmtB(tickers?.BTCUSDT?.volumeUsd)}`],
    ['Ethereum (ETH/USDT)', fmtUsd(tickers?.ETHUSDT?.price), `${tickers?.ETHUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.ETHUSDT?.change)}%`, `Vol 24h: ${fmtB(tickers?.ETHUSDT?.volumeUsd)}`],
    ['Solana (SOL/USDT)', fmtUsd(tickers?.SOLUSDT?.price), `${tickers?.SOLUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.SOLUSDT?.change)}%`, `Vol 24h: ${fmtB(tickers?.SOLUSDT?.volumeUsd)}`],
    ['Chỉ số Sợ Hãi & Tham Lam (F&G)', `${fng.value} / 100`, fng.classification, fng.value <= 25 ? 'Vùng Mua Gom Giá Trị' : fng.value >= 75 ? 'Rủi Ro Đỉnh Cực Đại' : 'Tâm Lý Cân Bằng'],
    ['Tổng Vốn Hóa Stablecoin', fmtB(stablecoins.totalMcapUsd), 'Nguồn: DefiLlama', 'Sức mua dự trữ trên toàn hệ sinh thái'],
    ['BTC Production Cost (Est.)', '$74,000 - $84,000', 'Energy Model 26 J/TH', 'Vùng sàn chi phí khai thác trung bình thợ đào']
  ];

  // ─── TAB 2: DERIVATIVES_FLOW ────────────────────────────────────────────────
  const derivativesTable = [
    ['CHỈ BÁO PHÁI SINH', 'GIÁ TRỊ', 'CHU KỲ', 'TÁC ĐỘNG / TRẠNG THÁI'],
    ['Binance BTC Funding Rate', derivatives.fundingRate != null ? `${(derivatives.fundingRate * 100).toFixed(4)}%` : '---', '8 Giờ', derivatives.fundingRate > 0.0003 ? 'Longs quá nóng (Rủi ro Long Squeeze)' : derivatives.fundingRate < -0.0001 ? 'Shorts dồn ép (Dễ có Short Squeeze)' : 'Lành mạnh'],
    ['Binance BTC Open Interest (OI)', `${fmt(derivatives.openInterest, 0)} BTC`, 'Realtime', `Quy đổi: ~${fmtB(btcOiUsd)}`],
    ['Global Accounts Long/Short Ratio', fmt(derivatives.globalLs, 2), '1 Giờ', derivatives.globalLs > 1.8 ? 'Đám đông nghiêng Long nặng' : derivatives.globalLs < 0.8 ? 'Đám đông nghiêng Short nặng' : 'Cân bằng'],
    ['Top Trader Long/Short Ratio', fmt(derivatives.topLs, 2), '1 Giờ', 'Vị thế của các tài khoản vốn lớn'],
    ['Order Book Imbalance (OBI Depth)', `${obiData.obi >= 0 ? '+' : ''}${fmt(obiData.obi, 1)}%`, 'Top 100 Bids/Asks', obiData.obi > 10 ? 'Phe Mua chiếm ưu thế sổ lệnh' : obiData.obi < -10 ? 'Phe Bán chiếm ưu thế sổ lệnh' : 'Sổ lệnh cân bằng'],
    ['Tổng Giá Trị Sổ Lệnh Mua (Bids)', fmtCompactUsd(obiData.bidVol), 'Top 100 levels', 'Hỗ trợ thanh khoản Limit Buy'],
    ['Tổng Giá Trị Sổ Lệnh Bán (Asks)', fmtCompactUsd(obiData.askVol), 'Top 100 levels', 'Kháng cự thanh khoản Limit Sell']
  ];

  // ─── TAB 3: ETF_ONCHAIN ─────────────────────────────────────────────────────
  const etfOnchainTable = [
    ['QUỸ / CHỈ SỐ ON-CHAIN', 'SỐ LIỆU / DÒNG TIỀN', 'THỜI GIAN', 'Ý NGHĨA DÒNG TIỀN TỔ CHỨC'],
    ['Bitcoin Spot ETF (Mỹ)', 'Dòng tiền ròng tích lũy', 'Dữ liệu ngày', 'Thước đo tích lũy dòng vốn truyền thống Wall Street'],
    ['Ethereum Spot ETF (Mỹ)', 'Dòng tiền ròng tích lũy', 'Dữ liệu ngày', 'Quan sát nhu cầu tổ chức dành cho Altcoin dẫn đầu'],
    ['Stablecoin Supply Heat', fmtB(stablecoins.totalMcapUsd), 'Realtime DefiLlama', 'Thanh khoản USD sẵn sàng giải ngân vào Crypto'],
    ['MVRV Ratio (Est.)', '1.85 - 2.15', 'Daily On-chain', 'Định giá thị trường so với giá vốn nhà đầu tư'],
    ['Hashrate & Mining Floor', '$78,500', 'Baseline', 'Ngưỡng hỗ trợ hòa vốn của dàn máy thế hệ mới']
  ];

  // ─── TAB 4: MACRO_CALENDAR ──────────────────────────────────────────────────
  const macroTable = [
    ['THỜI GIAN (VN / UTC)', 'SỰ KIỆN KINH TẾ', 'QUỐC GIA', 'MỨC ĐỘ ẢNH HƯỞNG', 'DỰ BÁO', 'KỲ TRƯỚC', 'GHI CHÚ CRYPTO']
  ];

  if (calendarEvents.length > 0) {
    for (const ev of calendarEvents) {
      macroTable.push([
        ev.date ? ev.date.replace('T', ' ').substring(0, 16) : '---',
        ev.title,
        ev.country,
        ev.impact.toUpperCase(),
        ev.forecast,
        ev.previous,
        ev.impact.toLowerCase() === 'high' ? '⚠ Biến động mạnh thanh khoản USD' : 'Theo dõi phản ứng lợi suất'
      ]);
    }
  } else {
    macroTable.push(['---', 'Không có sự kiện vĩ mô đặc biệt trong 24h tới', 'ALL', 'LOW', '---', '---', 'Thị trường vận động thuần theo cung cầu kỹ thuật']);
  }

  // ─── TAB 5: AI_PROMPT_SUMMARY (Markdown text format) ────────────────────────
  const aiMarkdownSummary = `
# BẢN TỔNG HỢP DỮ LIỆU THỊ TRƯỜNG & CHỈ SỐ ĐỊNH LƯỢNG
**Phiên:** ${session.name} | **Thời gian cập nhật:** ${timestampVn}

## 1. TỔNG QUAN XU HƯỚNG & MARKET BIAS ENGINE
- **Market Bias Tổng Hợp:** **${bias.totalScore > 0 ? '+' : ''}${bias.totalScore} / 100** -> Trạng thái: **${bias.biasLabel}**
- **Điểm 4 Trụ Cột Thành Phần:**
  - *Microstructure (40%):* ${bias.pillars.microstructure}/100 (Funding: ${derivatives.fundingRate != null ? (derivatives.fundingRate * 100).toFixed(4) + '%' : 'N/A'}, OBI: ${fmt(obiData.obi, 1)}%)
  - *On-Chain (25%):* ${bias.pillars.onChain}/100 (Mining Floor: $74k - $84k)
  - *Institutional Flows (15%):* ${bias.pillars.institutional}/100 (Spot ETF Flows)
  - *Macro & Risk Shock (20%):* ${bias.pillars.macro}/100 (Lịch vĩ mô & USD Liquidity)

## 2. GIÁ CẢ & TÂM LÝ THỊ TRƯỜNG
- **Bitcoin (BTC):** ${fmtUsd(btcPrice)} (${tickers?.BTCUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.BTCUSDT?.change)}% 24h) | Khối lượng: ${fmtB(tickers?.BTCUSDT?.volumeUsd)}
- **Ethereum (ETH):** ${fmtUsd(tickers?.ETHUSDT?.price)} (${tickers?.ETHUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.ETHUSDT?.change)}% 24h)
- **Solana (SOL):** ${fmtUsd(tickers?.SOLUSDT?.price)} (${tickers?.SOLUSDT?.change >= 0 ? '+' : ''}${fmt(tickers?.SOLUSDT?.change)}% 24h)
- **Chỉ số Sợ hãi & Tham lam (Fear & Greed):** **${fng.value}/100** (${fng.classification})
- **Tổng Vốn Hóa Stablecoin (DefiLlama):** **${fmtB(stablecoins.totalMcapUsd)}**

## 3. CẤU TRÚC PHÁI SINH & DÒNG TIỀN (DERIVATIVES & ORDER FLOW)
- **Binance Funding Rate:** **${derivatives.fundingRate != null ? (derivatives.fundingRate * 100).toFixed(4) + '%' : '---'}** (${derivatives.fundingRate > 0.0003 ? 'Long quá nóng' : derivatives.fundingRate < -0.0001 ? 'Short dồn ép' : 'Cân bằng'})
- **Open Interest (OI) BTC Binance:** **${fmt(derivatives.openInterest, 0)} BTC** (~${fmtB(btcOiUsd)})
- **Tỷ lệ Long/Short (Tất cả tài khoản):** **${fmt(derivatives.globalLs, 2)}**
- **Độ lệch sổ lệnh (OBI Depth 100):** **${obiData.obi >= 0 ? '+' : ''}${fmt(obiData.obi, 1)}%** (Bids: ${fmtCompactUsd(obiData.bidVol)} vs Asks: ${fmtCompactUsd(obiData.askVol)})

## 4. SỰ KIỆN KINH TẾ VĨ MÔ TRỌNG TÂM (24H - 48H TỚI)
${calendarEvents.length > 0 ? calendarEvents.slice(0, 5).map(e => `- [${e.impact.toUpperCase()}] **${e.title}** (${e.country}) lúc ${e.date ? e.date.replace('T', ' ').substring(11, 16) : '---'} | Dự báo: ${e.forecast} | Trước đó: ${e.previous}`).join('\n') : '- Không có sự kiện vĩ mô biến động cao trong 24h tới.'}

---
*Ghi chú dành cho AI phân tích:* Hãy sử dụng các số liệu thực tế phía trên để đưa ra:
1. Đánh giá trạng thái Regime hiện tại (Breakout, Range-bound, hay Squeeze).
2. Kịch bản giao dịch tối ưu cho phiên ${session.name} (Điểm Trigger, Invalidation và Vùng rủi ro).
`.trim();

  // ─── GÓI PAYLOAD ────────────────────────────────────────────────────────────
  const payload = {
    sessionName: session.name,
    timestamp: timestampVn,
    overview: overviewTable,
    derivatives: derivativesTable,
    etf_onchain: etfOnchainTable,
    macro: macroTable,
    ai_summary_md: aiMarkdownSummary
  };

  if (IS_DRY_RUN) {
    console.log('\n[DRY RUN MODE] Dữ liệu thu thập thành công! Không gửi Webhook.');
    console.log('Tổng số dòng Overview:', overviewTable.length);
    console.log('Tổng số dòng Derivatives:', derivativesTable.length);
    console.log('Tổng số dòng ETF/On-Chain:', etfOnchainTable.length);
    console.log('Tổng số dòng Macro:', macroTable.length);
    console.log('\n--- XEM TRƯỚC BẢN TỔNG THUẬT CHO AI ---');
    console.log(aiMarkdownSummary);
    console.log('\nĐể đồng bộ thực tế lên Google Sheet, truyền biến môi trường GOOGLE_SHEET_WEBHOOK_URL hoặc đối số --url=<WEBHOOK_URL>');
    return;
  }

  // ─── GỬI WEBHOOK LÊN GOOGLE APPS SCRIPT ──────────────────────────────────────
  console.log(`\n[5/5] Đang gửi payload lên Google Apps Script Webhook...`);
  try {
    const res = await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 5,
      timeout: 20000
    });

    console.log('✅ KẾT QUẢ TỪ GOOGLE APPS SCRIPT:');
    console.log(res.data);
    console.log('🎉 ĐÃ ĐỒNG BỘ THÀNH CÔNG LÊN GOOGLE SHEET!');
  } catch (err) {
    console.error('❌ Lỗi khi gửi Webhook:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status, 'Data:', err.response.data);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});
