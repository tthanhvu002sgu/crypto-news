/**
 * Telegram AI Market Report Worker
 *
 * Pipeline: fetch FULL dữ liệu thị trường (reuse collectFullMarketData từ sync worker)
 * → tính Market Bias → AI tạo báo cáo Investment Committee đầy đủ (Gemini, fallback OpenRouter)
 * → chia thành nhiều tin nhắn ≤4096 ký tự gửi tuần tự tới Telegram.
 * Nếu cả 2 AI lỗi: gửi tóm tắt compact để vẫn có báo cáo.
 *
 * Cách chạy:
 *   node scripts/sendTelegramReport.mjs --dry-run
 *   TELEGRAM_BOT_TOKEN="..." TELEGRAM_CHAT_ID="..." GEMINI_API_KEY="..." node scripts/sendTelegramReport.mjs
 */

import axios from 'axios';
import { getCurrentSessionVN, buildGoogleSheetPayload } from '../src/services/googleSheetSync.js';
import { calculateMarketBias } from '../src/services/biasEngine.js';
import { getSystemPrompt, getGenerationConfig } from '../src/services/aiPrompts.js';
import { collectFullMarketData } from './syncGoogleSheet.mjs';

const IS_DRY_RUN = process.argv.includes('--dry-run');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FRED_API_KEY = process.env.FRED_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free';
const REPORT_LANG = process.env.REPORT_LANG || 'vi';
const CHUNK_LIMIT = 3900;

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

// ─── COMPACT SUMMARY (tin nhắn đầu + fallback khi AI lỗi) ─────────────────────

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

function buildCompactHtml(dashboardData, bias, session, timestampVn, alertLines) {
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

// ─── AI REPORT GENERATION ─────────────────────────────────────────────────────

async function generateWithGemini(systemPrompt, userPrompt, genConfig) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await axios.post(url, {
    system_instruction: { parts: { text: systemPrompt } },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: genConfig,
  }, { timeout: 180000 });

  const choice = res.data?.candidates?.[0];
  let text = (choice?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini trả về rỗng: ' + JSON.stringify(res.data?.promptFeedback || res.data?.error || {}));
  if (choice.finishReason === 'MAX_TOKENS') {
    text += REPORT_LANG === 'vi' ? '\n\n[Báo cáo dừng do giới hạn token AI]' : '\n\n[Report stopped at AI token limit]';
  }
  return { text, provider: `Gemini ${GEMINI_MODEL}` };
}

async function generateWithOpenRouter(systemPrompt, userPrompt, genConfig) {
  const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
    model: OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: genConfig.temperature ?? 0.2,
    top_p: genConfig.topP ?? 0.85,
    max_tokens: genConfig.maxOutputTokens ?? 6000,
    stream: false,
  }, {
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/tthanhvu002sgu/crypto-news',
      'X-Title': 'Crypto News Telegram Report',
    },
    timeout: 240000,
  });

  const text = res.data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter trả về rỗng: ' + JSON.stringify(res.data?.error || {}));
  return { text, provider: `OpenRouter ${OPENROUTER_MODEL}` };
}

async function generateAiReport(systemPrompt, userPrompt, genConfig) {
  if (GEMINI_API_KEY) {
    try {
      console.log(`[AI] Đang tạo báo cáo bằng Gemini (${GEMINI_MODEL})...`);
      return await generateWithGemini(systemPrompt, userPrompt, genConfig);
    } catch (err) {
      console.warn('[AI] Gemini lỗi:', err.response?.data?.error?.message || err.message);
    }
  }
  if (OPENROUTER_API_KEY) {
    try {
      console.log(`[AI] Fallback sang OpenRouter (${OPENROUTER_MODEL})...`);
      return await generateWithOpenRouter(systemPrompt, userPrompt, genConfig);
    } catch (err) {
      console.warn('[AI] OpenRouter lỗi:', err.response?.data?.error?.message || err.message);
    }
  }
  return null;
}

// ─── TELEGRAM DELIVERY ────────────────────────────────────────────────────────

function chunkText(text, limit = CHUNK_LIMIT) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (line.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if (current && (current.length + 1 + line.length) > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
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

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const session = getCurrentSessionVN();
  const timestampVn = new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' (GMT+7)';

  console.log(`[Telegram] ${timestampVn} — ${session.name}`);
  const { dashboardData, etfHoldingsLive, etfFlowLive, calendarEvents } = await collectFullMarketData(FRED_API_KEY);

  if (!dashboardData.btc?.price) {
    console.error('[Telegram] Không lấy được ticker BTC — hủy gửi báo cáo.');
    process.exit(1);
  }

  const bias = calculateMarketBias(dashboardData, etfFlowLive || []);
  bias.upcomingEvents = calendarEvents;
  console.log(`[Telegram] Bias: ${bias.score > 0 ? '+' : ''}${bias.score} (${bias.label}) | Confidence: ${bias.confidence}%`);

  const payload = buildGoogleSheetPayload(dashboardData, bias, etfHoldingsLive, etfFlowLive, {
    source: 'Telegram Report Worker',
    calendarEvents
  });

  const systemPrompt = getSystemPrompt('professional', REPORT_LANG, 'none');
  const genConfig = getGenerationConfig('professional');
  const ai = await generateAiReport(systemPrompt, payload.ai_summary_md, genConfig);
  if (ai) console.log(`[AI] Hoàn tất báo cáo qua ${ai.provider}: ${ai.text.length} ký tự`);
  else console.warn('[AI] Cả 2 provider đều lỗi hoặc chưa cấu hình API key — sẽ gửi tóm tắt compact.');

  const alertLines = buildAlertLines(bias);
  let compactHtml = buildCompactHtml(dashboardData, bias, session, timestampVn, alertLines);
  if (compactHtml.length > 4096) compactHtml = buildCompactHtml(dashboardData, bias, session, timestampVn, []);

  const reportHeader = REPORT_LANG === 'vi'
    ? `BÁO CÁO ĐẦU TƯ ĐẦY ĐỦ — ${timestampVn}`
    : `FULL INVESTMENT REPORT — ${timestampVn}`;
  const chunks = ai ? chunkText(`${reportHeader}\n\n${ai.text}`) : [];

  if (IS_DRY_RUN) {
    console.log(`\n[DRY RUN] Tin nhắn compact (${compactHtml.length} ký tự):\n`);
    console.log(compactHtml);
    if (ai) {
      console.log(`\n[DRY RUN] Báo cáo AI chia thành ${chunks.length} tin nhắn:\n`);
      console.log(ai.text);
    }
    return;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[Telegram] Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Xem docs/TELEGRAM_SETUP.md.');
    process.exit(1);
  }

  try {
    await sendTelegram(compactHtml, true);
    if (ai) {
      for (let i = 0; i < chunks.length; i++) {
        await new Promise(r => setTimeout(r, 1200));
        await sendTelegram(`[${i + 1}/${chunks.length}]\n${chunks[i]}`, false);
      }
      console.log(`[Telegram] Đã gửi tóm tắt + ${chunks.length} tin nhắn báo cáo AI (${ai.provider}).`);
    } else {
      await sendTelegram(REPORT_LANG === 'vi'
        ? '⚠ Không tạo được báo cáo AI (thiếu API key hoặc cả Gemini/OpenRouter đều lỗi). Chỉ gửi tóm tắt ở tin nhắn trước.'
        : '⚠ AI report unavailable (missing API key or both Gemini/OpenRouter failed). Only the summary above was sent.', false);
      console.warn('[Telegram] Đã gửi tóm tắt compact (AI không khả dụng).');
    }
  } catch (err) {
    console.error('[Telegram] Gửi thất bại:', err.response?.data || err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Telegram] Lỗi nghiêm trọng:', err);
  process.exit(1);
});