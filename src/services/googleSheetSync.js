/**
 * Google Sheets Client Sync Service
 * 
 * Cho phép đồng bộ dữ liệu trực tiếp từ trình duyệt Web lên Google Sheet qua Apps Script Webhook.
 */

const fmt = (n, d = 2) => n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '---';
const fmtUsd = (n, d = 0) => n != null && Number.isFinite(Number(n)) ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '---';
const fmtB = (n) => n != null && Number.isFinite(Number(n)) ? `$${(Number(n) / 1e9).toFixed(2)}B` : '---';
const fmtCompactUsd = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '---';
  const val = Math.abs(Number(n));
  const sign = Number(n) < 0 ? '-' : '';
  if (val >= 1e9) return `${sign}$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${sign}$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `${sign}$${(val / 1e3).toFixed(1)}K`;
  return `${sign}$${val.toFixed(0)}`;
};

export function getCurrentSessionVN() {
  const now = new Date();
  const vnHour = (now.getUTCHours() + 7) % 24;
  if (vnHour >= 6 && vnHour < 14) {
    return { name: 'PHIÊN Á (ASIAN SESSION)', code: 'ASIA', hour: vnHour };
  } else if (vnHour >= 14 && vnHour < 20) {
    return { name: 'PHIÊN ÂU (EUROPEAN SESSION)', code: 'EUROPE', hour: vnHour };
  } else {
    return { name: 'PHIÊN MỸ (US SESSION)', code: 'US', hour: vnHour };
  }
}

export function buildGoogleSheetPayload(data, biasData) {
  const session = getCurrentSessionVN();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';
  
  const btcPrice = data?.btc?.price || 0;
  const btcChange = data?.btc?.change || 0;
  const btcVolume = data?.btc?.volume || 0;
  const fundingRate = data?.fundingRate != null ? data.fundingRate : null;
  const openInterest = data?.openInterest != null ? data.openInterest : null;
  const btcOiUsd = openInterest ? openInterest * btcPrice : 0;
  const fngVal = data?.fngData?.value != null ? Number(data.fngData.value) : 50;
  const fngClass = data?.fngData?.classification || (fngVal <= 25 ? 'Extreme Fear' : fngVal >= 75 ? 'Extreme Greed' : 'Neutral');
  const stablecoinMcap = data?.stablecoins?.totalCirculatingUSD?.peggedUSD || 180000000000;

  const biasTotal = biasData?.score ?? 0;
  const biasLabel = biasData?.label ?? 'TRUNG LẬP';
  const pillars = biasData?.pillars || { microstructure: 0, onChain: 0, institutional: 0, newsRisk: 0 };

  // 1. OVERVIEW TABLE
  const overview = [
    ['DANH MỤC / CHỈ SỐ', 'GIÁ TRỊ HIỆN TẠI', 'BIÊN ĐỘ / TRẠNG THÁI', 'ĐÁNH GIÁ ĐỊNH LƯỢNG'],
    ['MARKET BIAS TOTAL', `${biasTotal > 0 ? '+' : ''}${biasTotal} / 100`, biasLabel, 'Tổng hợp 4 trụ cột định lượng'],
    ['Trụ Cột 1: Microstructure (40%)', `${pillars.microstructure > 0 ? '+' : ''}${pillars.microstructure}`, 'Funding + CVD + F&G', 'Cấu trúc thanh khoản vi mô'],
    ['Trụ Cột 2: On-Chain (25%)', `${pillars.onChain > 0 ? '+' : ''}${pillars.onChain}`, 'SSR + Production Cost', 'Định giá chuỗi khối cơ bản'],
    ['Trụ Cột 3: Institutional Flows (15%)', `${pillars.institutional > 0 ? '+' : ''}${pillars.institutional}`, 'Spot ETF Net Inflows', 'Dòng tiền quỹ tổ chức'],
    ['Trụ Cột 4: Macro & Risk Shock (20%)', `${pillars.newsRisk > 0 ? '+' : ''}${pillars.newsRisk}`, 'Calendar + Yields + DXY', 'Môi trường vĩ mô toàn cầu'],
    ['Bitcoin (BTC/USDT)', fmtUsd(btcPrice), `${btcChange >= 0 ? '+' : ''}${fmt(btcChange)}%`, `Vol 24h: ${fmtB(btcVolume)}`],
    ['Ethereum (ETH/USDT)', fmtUsd(data?.eth?.price), `${data?.eth?.change >= 0 ? '+' : ''}${fmt(data?.eth?.change)}%`, `Vol 24h: ${fmtB(data?.eth?.volume)}`],
    ['Solana (SOL/USDT)', fmtUsd(data?.sol?.price), `${data?.sol?.change >= 0 ? '+' : ''}${fmt(data?.sol?.change)}%`, `Vol 24h: ${fmtB(data?.sol?.volume)}`],
    ['Chỉ số Sợ Hãi & Tham Lam (F&G)', `${fngVal} / 100`, fngClass, fngVal <= 25 ? 'Vùng Mua Gom Giá Trị' : fngVal >= 75 ? 'Rủi Ro Đỉnh Cực Đại' : 'Tâm Lý Cân Bằng'],
    ['Tổng Vốn Hóa Stablecoin', fmtB(stablecoinMcap), 'Nguồn: DefiLlama', 'Sức mua dự trữ trên toàn hệ sinh thái'],
    ['BTC Production Cost (Est.)', '$74,000 - $84,000', 'Energy Model 26 J/TH', 'Vùng sàn chi phí khai thác trung bình thợ đào']
  ];

  // 2. DERIVATIVES TABLE
  const derivatives = [
    ['CHỈ BÁO PHÁI SINH', 'GIÁ TRỊ', 'CHU KỲ', 'TÁC ĐỘNG / TRẠNG THÁI'],
    ['Binance BTC Funding Rate', fundingRate != null ? `${(fundingRate * 100).toFixed(4)}%` : '---', '8 Giờ', fundingRate > 0.0003 ? 'Longs quá nóng (Rủi ro Long Squeeze)' : fundingRate < -0.0001 ? 'Shorts dồn ép (Dễ có Short Squeeze)' : 'Lành mạnh'],
    ['Binance BTC Open Interest (OI)', `${fmt(openInterest, 0)} BTC`, 'Realtime', `Quy đổi: ~${fmtB(btcOiUsd)}`],
    ['Global Accounts Long/Short Ratio', fmt(data?.longShortRatio, 2), '1 Giờ', 'Tỷ lệ tài khoản Mua/Bán'],
    ['Spot CVD 24h', fmtCompactUsd(data?.cvdHistory24hSpot?.[data.cvdHistory24hSpot.length - 1]?.cvd), '24 Giờ', 'Dòng tiền mua bán chủ động giao ngay'],
    ['Futures CVD 24h', fmtCompactUsd(data?.cvdHistory24h?.[data.cvdHistory24h.length - 1]?.cvd), '24 Giờ', 'Dòng tiền mua bán chủ động phái sinh']
  ];

  // 3. ETF & ONCHAIN TABLE
  const etf_onchain = [
    ['QUỸ / CHỈ SỐ ON-CHAIN', 'SỐ LIỆU / DÒNG TIỀN', 'THỜI GIAN', 'Ý NGHĨA DÒNG TIỀN TỔ CHỨC'],
    ['Bitcoin Spot ETF (Mỹ)', 'Dòng tiền ròng tích lũy', 'Dữ liệu ngày', 'Thước đo tích lũy dòng vốn truyền thống Wall Street'],
    ['Ethereum Spot ETF (Mỹ)', 'Dòng tiền ròng tích lũy', 'Dữ liệu ngày', 'Quan sát nhu cầu tổ chức dành cho Altcoin dẫn đầu'],
    ['Stablecoin Supply Heat', fmtB(stablecoinMcap), 'Realtime DefiLlama', 'Thanh khoản USD sẵn sàng giải ngân vào Crypto'],
    ['MVRV Ratio (Est.)', '1.85 - 2.15', 'Daily On-chain', 'Định giá thị trường so với giá vốn nhà đầu tư'],
    ['Hashrate & Mining Floor', '$78,500', 'Baseline', 'Ngưỡng hỗ trợ hòa vốn của dàn máy thế hệ mới']
  ];

  // 4. MACRO CALENDAR TABLE
  const macro = [
    ['THỜI GIAN (VN / UTC)', 'SỰ KIỆN KINH TẾ', 'QUỐC GIA', 'MỨC ĐỘ ẢNH HƯỞNG', 'DỰ BÁO', 'KỲ TRƯỚC', 'GHI CHÚ CRYPTO']
  ];

  const calendarEvents = biasData?.upcomingEvents || [];
  if (calendarEvents.length > 0) {
    for (const ev of calendarEvents.slice(0, 8)) {
      macro.push([
        ev.date ? String(ev.date).replace('T', ' ').substring(0, 16) : '---',
        ev.title || 'Sự kiện kinh tế',
        ev.country || 'USD',
        (ev.impact || 'MEDIUM').toUpperCase(),
        ev.forecast || '---',
        ev.previous || '---',
        (ev.impact || '').toLowerCase() === 'high' ? '⚠ Biến động mạnh thanh khoản USD' : 'Theo dõi phản ứng lợi suất'
      ]);
    }
  } else {
    macro.push(['---', 'Không có sự kiện vĩ mô biến động cao trong 24h tới', 'ALL', 'LOW', '---', '---', 'Thị trường vận động thuần theo cung cầu kỹ thuật']);
  }

  // 5. AI SUMMARY MARKDOWN
  const ai_summary_md = `
# BẢN TỔNG HỢP DỮ LIỆU THỊ TRƯỜNG & CHỈ SỐ ĐỊNH LƯỢNG
**Phiên:** ${session.name} | **Thời gian cập nhật:** ${timestampVn}

## 1. TỔNG QUAN XU HƯỚNG & MARKET BIAS ENGINE
- **Market Bias Tổng Hợp:** **${biasTotal > 0 ? '+' : ''}${biasTotal} / 100** -> Trạng thái: **${biasLabel}**
- **Điểm 4 Trụ Cột Thành Phần:**
  - *Microstructure (40%):* ${pillars.microstructure}/100 (Funding: ${fundingRate != null ? (fundingRate * 100).toFixed(4) + '%' : 'N/A'})
  - *On-Chain (25%):* ${pillars.onChain}/100 (Mining Floor: $74k - $84k)
  - *Institutional Flows (15%):* ${pillars.institutional}/100 (Spot ETF Flows)
  - *Macro & Risk Shock (20%):* ${pillars.newsRisk}/100 (Lịch vĩ mô & USD Liquidity)

## 2. GIÁ CẢ & TÂM LÝ THỊ TRƯỜNG
- **Bitcoin (BTC):** ${fmtUsd(btcPrice)} (${btcChange >= 0 ? '+' : ''}${fmt(btcChange)}% 24h) | Vol: ${fmtB(btcVolume)}
- **Ethereum (ETH):** ${fmtUsd(data?.eth?.price)} (${data?.eth?.change >= 0 ? '+' : ''}${fmt(data?.eth?.change)}% 24h)
- **Solana (SOL):** ${fmtUsd(data?.sol?.price)} (${data?.sol?.change >= 0 ? '+' : ''}${fmt(data?.sol?.change)}% 24h)
- **Chỉ số Sợ hãi & Tham lam (Fear & Greed):** **${fngVal}/100** (${fngClass})
- **Tổng Vốn Hóa Stablecoin (DefiLlama):** **${fmtB(stablecoinMcap)}**

## 3. CẤU TRÚC PHÁI SINH & DÒNG TIỀN
- **Binance Funding Rate:** **${fundingRate != null ? (fundingRate * 100).toFixed(4) + '%' : '---'}**
- **Open Interest (OI) BTC Binance:** **${fmt(openInterest, 0)} BTC** (~${fmtB(btcOiUsd)})
- **Tỷ lệ Long/Short (Tất cả tài khoản):** **${fmt(data?.longShortRatio, 2)}**

## 4. SỰ KIỆN KINH TẾ VĨ MÔ TRỌNG TÂM (24H - 48H TỚI)
${calendarEvents.length > 0 ? calendarEvents.slice(0, 5).map(e => `- [${(e.impact || 'MEDIUM').toUpperCase()}] **${e.title}** (${e.country}) | Dự báo: ${e.forecast || '---'} | Trước đó: ${e.previous || '---'}`).join('\n') : '- Không có sự kiện vĩ mô biến động cao trong 24h tới.'}

---
*Ghi chú dành cho AI phân tích:* Hãy sử dụng các số liệu thực tế phía trên để đưa ra:
1. Đánh giá trạng thái Regime hiện tại (Breakout, Range-bound, hay Squeeze).
2. Kịch bản giao dịch tối ưu cho phiên ${session.name} (Điểm Trigger, Invalidation và Vùng rủi ro).
`.trim();

  return {
    sessionName: session.name,
    timestamp: timestampVn,
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
export async function syncToGoogleSheetsFromBrowser(webhookUrl, dashboardData, biasData) {
  if (!webhookUrl || !webhookUrl.trim().startsWith('http')) {
    throw new Error('Chưa cấu hình Google Sheet Webhook URL hợp lệ trong Cài đặt.');
  }

  const payload = buildGoogleSheetPayload(dashboardData, biasData);

  // Gửi dạng text/plain để tránh CORS preflight block trên Google Apps Script
  const response = await fetch(webhookUrl.trim(), {
    method: 'POST',
    mode: 'no-cors', // Google Apps Script redirects with 302, no-cors ensures execution without CORS issues
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  return {
    status: 'success',
    session: payload.sessionName,
    timestamp: payload.timestamp,
    message: 'Đã gửi lệnh đồng bộ lên Google Sheet!'
  };
}
