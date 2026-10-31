/**
 * Telegram Market Report Worker
 *
 * Fetch subset dữ liệu thị trường (Binance, Alternative.me, ETF), tính Market Bias
 * và gửi tin nhắn tóm tắt HTML tới Telegram mỗi 4 giờ qua GitHub Actions.
 *
 * Cách chạy:
 *   node scripts/sendTelegramReport.mjs --dry-run
 *   TELEGRAM_BOT_TOKEN="..." TELEGRAM_CHAT_ID="..." node scripts/sendTelegramReport.mjs
 */

import axios from 'axios';
import { getCurrentSessionVN } from '../src/services/googleSheetSync.js';
import { calculateMarketBias } from '../src/services/biasEngine.js';
import {
  getBTCTicker24h,
  getFundingRate,
  getOpenInterest,
  getOIHistory,
  getLongShortRatio,
  getIntradayCVD,
  getFearAndGreed,
  getETFFlowHistory
} from '../src/services/api.js';

const IS_DRY_RUN = process.argv.includes('--dry-run');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_MAX_LEN = 4096;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtUsd(price) {
  if (price == null || !Number.isFinite(price)) return 'N/A';
  return '$' + price.toLocaleString('en-US', { maximumFractionDigits: price < 10 ? 4 : 0 });
}

function fmtChange(change) {
  if (change == null || !Number.isFinite(change)) return 'N/A';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

async function fetchDailyKlines() {
  const res = await axios.get('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=300', { timeout: 10000 });
  return res.data.map(k => ({
    time: new Date(k[0]),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    quoteVolume: parseFloat(k[7]),
    takerBuyQuoteVolume: parseFloat(k[10]),
    isClosed: true,
  }));
}

async function collectData() {
  const settled = await Promise.allSettled([
    getBTCTicker24h('BTCUSDT'),
    getBTCTicker24h('ETHUSDT'),
    fetchDailyKlines(),
    getFundingRate('BTCUSDT'),
    getOpenInterest('BTCUSDT'),
    getOIHistory('BTCUSDT', '1h', 24),
    getLongShortRatio('BTCUSDT', '1h', 24),
    getIntradayCVD('BTCUSDT', 'spot'),
    getIntradayCVD('BTCUSDT', 'futures'),
    getFearAndGreed(),
    getETFFlowHistory()
  ]);

  const pick = (i, fallback = null) => {
    const r = settled[i];
    if (r.status === 'fulfilled' && r.value != null) return r.value;
    if (r.status === 'rejected') console.warn(`[Telegram] Fetch #${i} lỗi:`, r.reason?.message || r.reason);
    return fallback;
  };

  const lsHistory = Array.isArray(pick(6)) ? pick(6) : [];

  return {
    dashboardData: {
      btc: pick(0),
      ethTicker: pick(1),
      btcDailyKlinesAll: pick(2, []),
      fundingRate: pick(3),
      openInterest: pick(4),
      oiHistory: Array.isArray(pick(5)) ? pick(5) : [],
      lsHistory,
      longShortRatio: lsHistory.length > 0 ? lsHistory[lsHistory.length - 1]?.longShortRatio ?? null : null,
      cvdHistory24hSpot: pick(7),
      cvdHistory24h: pick(8),
      fngData: pick(9),
    },
    etfFlow: Array.isArray(pick(10)) ? pick(10) : []
  };
}

function buildAlertLines(bias) {
  const alerts = [];
  const tactical = bias?.regime?.tactical;
  if (tactical === 'LONG_SQUEEZE_RISK') alerts.push('LONG_SQUEEZE_RISK — spot yếu + funding dương cao, rủi ro quét long');
  else if (tactical === 'SHORT_SQUEEZE_WATCH') alerts.push('SHORT_SQUEEZE_WATCH — spot mạnh + funding âm, theo dõi short squeeze');

  if (bias?.calendarRisk === 'HIGH') alerts.push('Rủi ro lịch sự kiện vĩ mô HIGH');

  const flagged = (bias?.signals || [])
    .filter(s => !s.isFallback && /Extreme|Trap|Squeeze/i.test(s.status || ''))
    .slice(0, 2)
    .map(s => `${s.name}: ${s.status}`);
  alerts.push(...flagged);

  return alerts.slice(0, 3).map(a => `• ${escapeHtml(a)}`);
}

function buildTelegramHtml(dashboardData, bias, session, timestampVn, alertLines) {
  const { btc, ethTicker, fundingRate, openInterest, longShortRatio, fngData } = dashboardData;
  const scoreStr = bias ? `${bias.score > 0 ? '+' : ''}${bias.score}` : 'N/A';
  const oiUsd = openInterest != null && btc?.price != null ? openInterest * btc.price : null;
  const fngValue = fngData?.value != null ? `${fngData.value} (${fngData.sentiment || 'N/A'})` : 'N/A';

  const lines = [
    '<b>CRYPTO MARKET REPORT</b>',
    `${escapeHtml(timestampVn)} — ${escapeHtml(session.name)}`,
    '',
    `<b>BTC:</b> ${escapeHtml(fmtUsd(btc?.price))} (${escapeHtml(fmtChange(btc?.change))})`,
    `<b>ETH:</b> ${escapeHtml(fmtUsd(ethTicker?.price))} (${escapeHtml(fmtChange(ethTicker?.change))})`,
    '',
    bias
      ? `<b>Bias: ${escapeHtml(scoreStr)} — ${escapeHtml(bias.label)}</b> (confidence ${bias.confidence}%)`
      : '<b>Bias:</b> N/A',
  ];

  if (bias) {
    lines.push(`Trend: ${escapeHtml(bias.regime?.trend || 'N/A')} | Tactical: ${escapeHtml(bias.regime?.tactical || 'N/A')}`);
    if (bias.confirmation?.shortLabel) lines.push(`Giá xác nhận: ${escapeHtml(bias.confirmation.shortLabel)}`);
  }

  lines.push(
    '',
    `<b>Funding:</b> ${fundingRate != null ? escapeHtml((fundingRate * 100).toFixed(4) + '%') : 'N/A'} | <b>OI:</b> ${oiUsd != null ? escapeHtml('$' + (oiUsd / 1e9).toFixed(2) + 'B') : 'N/A'}`,
    `<b>Long/Short:</b> ${longShortRatio != null ? escapeHtml(Number(longShortRatio).toFixed(2)) : 'N/A'} | <b>Fear &amp; Greed:</b> ${escapeHtml(fngValue)}`
  );

  if (alertLines.length > 0) {
    lines.push('', '<b>Cảnh báo:</b>', ...alertLines);
  }

  return lines.join('\n');
}

async function sendTelegram(text, useHtml) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text,
    disable_web_page_preview: true,
    ...(useHtml ? { parse_mode: 'HTML' } : {})
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await axios.post(url, payload, { timeout: 15000 });
      if (res.data?.ok) return res.data;
      throw new Error(res.data?.description || 'Telegram trả về ok=false');
    } catch (err) {
      const status = err.response?.status;
      const retryAfter = err.response?.data?.parameters?.retry_after;
      if (status === 429 && attempt === 0 && retryAfter) {
        console.warn(`[Telegram] Rate limit, chờ ${retryAfter}s rồi thử lại...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  const session = getCurrentSessionVN();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';

  console.log(`[Telegram] ${timestampVn} — ${session.name}`);
  console.log('[Telegram] Đang fetch dữ liệu thị trường (subset nhẹ)...');

  const { dashboardData, etfFlow } = await collectData();

  if (!dashboardData.btc?.price) {
    console.error('[Telegram] Không lấy được ticker BTC — hủy gửi báo cáo.');
    process.exit(1);
  }

  const bias = calculateMarketBias(dashboardData, etfFlow);
  console.log(`[Telegram] Bias: ${bias.score > 0 ? '+' : ''}${bias.score} (${bias.label}) | Confidence: ${bias.confidence}%`);

  const alertLines = buildAlertLines(bias);
  let html = buildTelegramHtml(dashboardData, bias, session, timestampVn, alertLines);
  let useHtml = true;

  if (html.length > TELEGRAM_MAX_LEN) {
    html = buildTelegramHtml(dashboardData, bias, session, timestampVn, []);
  }
  if (html.length > TELEGRAM_MAX_LEN) {
    html = html.replace(/<[^>]+>/g, '').substring(0, 4000) + '…';
    useHtml = false;
  }

  if (IS_DRY_RUN) {
    console.log('\n[DRY RUN] Nội dung tin nhắn (' + html.length + ' ký tự):\n');
    console.log(html);
    return;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[Telegram] Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Xem docs/TELEGRAM_SETUP.md.');
    process.exit(1);
  }

  try {
    await sendTelegram(html, useHtml);
    console.log('[Telegram] Đã gửi báo cáo thành công.');
  } catch (err) {
    console.error('[Telegram] Gửi thất bại:', err.response?.data || err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Telegram] Lỗi nghiêm trọng:', err);
  process.exit(1);
});