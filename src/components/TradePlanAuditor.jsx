import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ShieldCheck, Loader2, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';
import Tooltip from './Tooltip';
import { cleanLatex } from './SummaryTab';
import { getGenerationConfig } from '../services/aiPrompts';
import { streamOpenRouterCompletion } from '../services/openrouter';
import { getOrderBookDepth, getWhaleWalls } from '../services/api';
import ModuleMenu from './ModuleMenu';

export default function TradePlanAuditor({
  data,
  cvd,
  buyVolume,
  sellVolume,
  apiKeys,
  aiProvider,
  selectedModel,
  selectedOpenRouterModel,
  openrouterModels,
  isVi,
  lastSync,
  moduleId = 'dash_trade_auditor',
}) {
  const priceNow =
    typeof data.btc?.price === 'number'
      ? data.btc.price
      : Number.parseFloat(data.btc?.price) || 0;

  const [tradeDirection, setTradeDirection] = useState('LONG');
  const [customPrice, setCustomPrice] = useState('');
  const [auditResult, setAuditResult] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);

  const effectivePrice = customPrice ? Number.parseFloat(customPrice) || priceNow : priceNow;

  const runTradeAudit = async () => {
    const geminiKey = apiKeys?.gemini?.trim();
    const openrouterKey = apiKeys?.openrouter?.trim();

    if (aiProvider === 'gemini' && !geminiKey) {
      alert(
        isVi
          ? 'Vui lòng nhập Gemini API Key trong phần ⚙️ Cài đặt!'
          : 'Please enter your Gemini API Key in ⚙️ Settings!'
      );
      return;
    }

    if (aiProvider === 'openrouter' && !openrouterKey) {
      alert(
        isVi
          ? 'Vui lòng nhập OpenRouter API Key trong phần ⚙️ Cài đặt!'
          : 'Please enter your OpenRouter API Key in ⚙️ Settings!'
      );
      return;
    }

    setIsAuditing(true);
    setAuditResult('');

    const formattedSpotPrice = effectivePrice
      ? `$${effectivePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'N/A';

    const systemPrompt = isVi
      ? `Bạn là Trưởng phòng Execution & Risk Desk hoài nghi chuyên sâu về crypto.
Nhiệm vụ: Kiểm định TRỰC TIẾP setup lệnh [${tradeDirection}] tại giá spot hiện tại (${formattedSpotPrice}) dựa trên dữ liệu vi cấu trúc 0-24h thực tế.

⚠️ HỢP ĐỒNG DỮ LIỆU & CHỐNG HALLUCINATION:
- Chỉ sử dụng dữ liệu được cung cấp trực tiếp trong input. Nếu một chỉ số không có trong dữ liệu hoặc hiển thị N/A, BẮT BUỘC ghi rõ '[CHƯA BIẾT]' thay vì tự suy đoán con số cụ thể.

⚠️ QUY TRÌNH TƯ DUY BẮT BUỘC (REASONING-FIRST):
- Trước khi sinh ra phán quyết ở Mục 1, bạn BẮT BUỘC phải thực hiện đánh giá và đối chiếu đầy đủ dữ liệu vi cấu trúc ở Mục 2 và Mục 3 trong tư duy/quá trình suy luận nội bộ. Chỉ tổng hợp phán quyết vào Mục 1 sau khi đã hoàn thành xong bước lập luận.

⚠️ QUY TẮC TRÌNH BÀY BẮT BUỘC:
1. XUỐNG DÒNG RIÊNG BIỆT cho mỗi gạch đầu dòng (bullet point). Trước mỗi dấu gạch ngang (-) BẮT BUỘC phải là một dòng mới.
2. CẤM TUYỆT ĐỐI viết gộp hoặc viết nối tiếp hai gạch đầu dòng trên cùng một hàng.
3. IN ĐẬM rõ ràng các tiêu đề mục, phán quyết và mốc giá quan trọng.

CẤU TRÚC BÁO CÁO KIỂM ĐỊNH YÊU CẦU (Luôn giữ 1 dòng trống giữa các gạch đầu dòng):

### 1. 🎯 PHÁN QUYẾT & ĐỘ TIN CẨY

- **Phán quyết Lệnh [${tradeDirection} @ ${formattedSpotPrice}]:** [**🟢 THỰC HIỆN** | **⏸️ CHỜ XÁC NHẬN** | **🔴 KHÔNG NÊN**]

- **Cảnh báo Rủi ro Chính:** [Nêu 1 loại rủi ro thực tế chính từ dữ liệu — ví dụ: Short Squeeze, Bull Trap, Liquidity Grab, Quá đòn bẩy, R:R không đủ, v.v.]

- **Mức độ Tin cậy:** [**CAO** | **TRUNG BÌNH** | **THẤP**]

- **Tóm tắt Edge trong 1 câu:** [Đánh giá nhanh lý do cốt lõi]

### 2. 🔬 BẰNG CHỨNG VI CẤU TRÚC TẠI SPOT

- **Lực mua/bán chủ động (CVD):** [Diễn giải CVD dựa trên dữ liệu cung cấp — đồng pha, phân kỳ, hay không đủ bằng chứng để kết luận]

- **Đòn bẩy phái sinh (OI & Funding):** [Đánh giá OI và Funding dựa trên dữ liệu — rủi ro đòn bẩy mới, short cover, long liquidation, hay trung tính]

- **Sổ lệnh & Whale Walls:** [Khoảng cách tới tường Bid Wall (hỗ trợ) và Ask Wall (kháng cự) gần nhất — xem xét rủi ro rút lệnh/spoofing]

### 3. 🛡️ PLAYBOOK VÀO LỆNH & ĐIỀU KIỆN VÔ HIỆU

- **Vùng Mua/Bán Đề xuất:** [Vùng giá vào lệnh tối ưu]

- **Dừng Lỗ Cấu Trúc (Stop Loss):** [Mức giá cụ thể dưới đáy/trên đỉnh cấu trúc]

- **Mục tiêu Chốt Lãi (Take Profit):** [Mức giá chốt lời kèm tỷ lệ R:R ước tính]

- **Điều kiện Vô Hiệu Lập Tức:** [Nêu 1 tín hiệu hoặc mốc giá khiến setup lệnh hỏng hoàn toàn]`
      : `You are a Skeptical Execution & Risk Desk Lead in crypto trading.
Your mission: Directly audit a [${tradeDirection}] trade setup at current price (${formattedSpotPrice}) using real-time 0-24h microstructure data.

⚠️ DATA CONTRACT & ANTI-HALLUCINATION:
- Use ONLY data explicitly provided in the input. If a metric is unprovided or missing (N/A), explicitly state '[UNKNOWN]' instead of speculating or inventing numbers.

⚠️ MANDATORY REASONING ORDER (REASONING-FIRST):
- Before rendering the verdict in Section 1, you MUST complete full evaluation and cross-examination of Section 2 and Section 3 microstructure data in your internal reasoning process. Only synthesize the final verdict into Section 1 after completing data cross-examination.

⚠️ MANDATORY FORMATTING RULES:
1. SEPARATE LINE FOR EVERY BULLET POINT. Every bullet item MUST begin on a new line starting with '- '.
2. NEVER concatenate or join multiple bullet points on the same line.
3. BOLD all section titles, directional verdicts, and price targets.

REQUIRED AUDIT FORMAT (Always keep a blank line between bullet items):

### 1. 🎯 TRADE VERDICT & CONVICTION

- **Verdict for [${tradeDirection} @ ${formattedSpotPrice}]:** [**🟢 CONFIRMED VALID** | **⏸️ WAIT FOR CONFIRMATION** | **🔴 INVALIDATED - DO NOT TRADE**]

- **Primary Risk Warning:** [State exact empirical risk — e.g., Short Squeeze, Bull Trap, Liquidity Grab, Over-leverage, Poor R:R, etc.]

- **Conviction:** [**HIGH** | **MEDIUM** | **LOW**]

- **One-line Edge:** [Concise core rationale]

### 2. 🔬 MICROSTRUCTURE EVIDENCE AT SPOT

- **Aggressive Flow (CVD):** [Evaluate CVD based on provided data — aligned, diverging, or insufficient evidence]

- **Leverage (OI & Funding):** [Evaluate OI and Funding based on data — fresh leverage, short cover, long liquidation, or neutral]

- **Book Liquidity & Whale Walls:** [Distance to nearest Bid (support) and Ask (resistance) walls — evaluate spoofing risk]

### 3. 🛡️ EXECUTION PLAYBOOK & INVALIDATION

- **Recommended Zone:** [Optimal entry price zone]

- **Structural Stop Loss:** [Specific price level below/above structure]

- **Take Profit Targets:** [Target price and estimated R:R ratio]

- **Emergency Invalidation:** [Specific signal or price breakdown that immediately invalidates setup]`;

    // Fetch fresh microstructure depth and whale walls if not already attached
    let orderBook = data?.orderBook || null;
    let whaleWalls = data?.whaleWalls || null;

    try {
      const [obRes, wwRes] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100).catch(() => null),
        getWhaleWalls().catch(() => null),
      ]);
      if (obRes) orderBook = obRes;
      if (wwRes) whaleWalls = wwRes;
    } catch (err) {
      console.warn('[TradeAuditor] Microstructure fetch fallback:', err);
    }

    const formattedCvd =
      cvd !== undefined && cvd !== null && !Number.isNaN(Number(cvd))
        ? (Number(cvd) > 0 ? '+' : '') + Number(cvd).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USD'
        : 'N/A';

    const formattedBuyVol =
      buyVolume !== undefined && buyVolume !== null && !Number.isNaN(Number(buyVolume))
        ? Number(buyVolume).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USD'
        : 'N/A';

    const formattedSellVol =
      sellVolume !== undefined && sellVolume !== null && !Number.isNaN(Number(sellVolume))
        ? Number(sellVolume).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USD'
        : 'N/A';

    const userPrompt = `
# TRADE AUDIT INPUT DATA

- Direction Requested: **${tradeDirection}**
- Target Spot Price: **${formattedSpotPrice}**
- BTC Live Spot Price: $${priceNow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- BTC 24h Change: ${data.btc?.change !== undefined && data.btc?.change !== null ? (Number(data.btc.change) > 0 ? '+' : '') + Number(data.btc.change).toFixed(2) + '%' : 'N/A'}
- Current Funding Rate: ${data.fundingRate !== undefined && data.fundingRate !== null ? (data.fundingRate * 100).toFixed(4) + '%' : 'N/A'}
- Current Open Interest: ${data.openInterest ? Number(data.openInterest).toLocaleString('en-US') + ' BTC' : 'N/A'}
- Intraday Cumulative Volume Delta (CVD): ${formattedCvd}
- Intraday Taker Buy Volume: ${formattedBuyVol}
- Intraday Taker Sell Volume: ${formattedSellVol}
- Order Book Imbalance (OBI): ${orderBook?.obiPercent !== undefined && orderBook?.obiPercent !== null ? (orderBook.obiPercent > 0 ? '+' : '') + orderBook.obiPercent.toFixed(2) + '%' : 'N/A'}
- Whale Bid Ratio: ${whaleWalls?.bidRatio !== undefined && whaleWalls?.bidRatio !== null ? (whaleWalls.bidRatio * 100).toFixed(1) + '%' : 'N/A'}
`;

    try {
      if (aiProvider === 'openrouter') {
        await streamOpenRouterCompletion({
          apiKey: openrouterKey,
          model: selectedOpenRouterModel,
          systemPrompt,
          userPrompt,
          generationConfig: getGenerationConfig('compact'),
          onChunk: (accumulatedText) => {
            setAuditResult(cleanLatex(accumulatedText));
          },
        });
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse&key=${geminiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: { text: systemPrompt } },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: getGenerationConfig('compact'),
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || `HTTP status ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split(/\r?\n|\r/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanedStr = line.trim();
            if (cleanedStr.startsWith('data: ')) {
              const dataStr = cleanedStr.slice(6).trim();
              if (!dataStr) continue;
              try {
                const parsed = JSON.parse(dataStr);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) {
                  currentText = cleanLatex(currentText + text);
                  setAuditResult(currentText);
                }
              } catch {
                continue;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[TradeAuditor] Audit failed:', err);
      setAuditResult((prev) => prev + `\n\n**Lỗi kiểm định:** ${err.message}`);
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '18px 20px',
        marginBottom: '20px',
        border: '1px solid var(--border-panel)',
        borderRadius: '12px',
        background: 'var(--bg-panel)',
      }}
    >
      {/* ── Top Header Toolbar ────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          borderBottom: '1px solid var(--border-panel)',
          paddingBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h3
            className="font-mono text-emerald"
            style={{
              margin: 0,
              fontSize: '0.95rem',
              letterSpacing: '0.04em',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <ShieldCheck size={18} /> TRADE PLAN AUDITOR
          </h3>
          <span
            className="font-mono"
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'var(--bg-slate-950)',
              border: '1px solid var(--border-panel)',
              color: 'var(--color-emerald-400)',
            }}
          >
            SPOT: ${priceNow ? priceNow.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'}
          </span>
        </div>

        <ModuleMenu moduleId={moduleId} />
      </div>

      {/* ── Interactive Input Form ─────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--bg-slate-950)',
          border: '1px solid var(--border-panel)',
          borderRadius: '10px',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          marginBottom: '16px',
        }}
      >
        {/* Direction Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', fontWeight: 600 }}>
            {isVi ? 'HƯỚNG LỆNH:' : 'DIRECTION:'}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="font-mono"
              onClick={() => setTradeDirection('LONG')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 14px',
                fontSize: '0.72rem',
                fontWeight: 800,
                borderRadius: '6px',
                background: tradeDirection === 'LONG' ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-slate-900)',
                color: tradeDirection === 'LONG' ? 'var(--color-emerald-400)' : 'var(--text-slate-400)',
                border: tradeDirection === 'LONG' ? '1px solid var(--color-emerald-500)' : '1px solid var(--border-panel)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <ArrowUpRight size={14} /> LONG
            </button>
            <button
              type="button"
              className="font-mono"
              onClick={() => setTradeDirection('SHORT')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 14px',
                fontSize: '0.72rem',
                fontWeight: 800,
                borderRadius: '6px',
                background: tradeDirection === 'SHORT' ? 'rgba(244, 63, 94, 0.2)' : 'var(--bg-slate-900)',
                color: tradeDirection === 'SHORT' ? 'var(--color-rose-400)' : 'var(--text-slate-400)',
                border: tradeDirection === 'SHORT' ? '1px solid var(--color-rose-500)' : '1px solid var(--border-panel)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <ArrowDownRight size={14} /> SHORT
            </button>
          </div>
        </div>

        {/* Spot Price Input (Optional override) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-slate-400)', fontWeight: 600 }}>
            {isVi ? 'MỨC GIÁ ENTRY:' : 'ENTRY PRICE:'}
          </span>
          <input
            type="text"
            placeholder={`Current ($${priceNow ? priceNow.toLocaleString('en-US') : ''})`}
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            className="font-mono"
            style={{
              background: 'var(--bg-slate-900)',
              border: '1px solid var(--border-panel)',
              color: 'var(--text-contrast)',
              borderRadius: '6px',
              padding: '5px 10px',
              fontSize: '0.72rem',
              width: '160px',
              outline: 'none',
            }}
          />
        </div>

        {/* Action Button */}
        <Tooltip
          content={{
            api: 'Microstructure Audit Engine',
            def: isVi
              ? 'Kiểm định lập tức phản ứng giá, CVD, OI và tường hỗ trợ/kháng cự gần nhất tại giá hiện tại.'
              : 'Instantly audit CVD divergence, OI leverage, and nearby whale walls at current spot price.',
          }}
          lastUpdated={lastSync}
        >
          <button
            type="button"
            className="font-mono"
            onClick={runTradeAudit}
            disabled={isAuditing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              fontSize: '0.72rem',
              fontWeight: 800,
              borderRadius: '6px',
              background: isAuditing ? 'var(--bg-slate-800)' : 'var(--color-emerald-500)',
              color: isAuditing ? 'var(--text-slate-500)' : '#ffffff',
              border: '1px solid var(--color-emerald-400)',
              cursor: isAuditing ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: isAuditing ? 'none' : '0 0 10px rgba(16, 185, 129, 0.3)',
            }}
          >
            {isAuditing ? <Loader2 size={14} className="spinning" /> : <Zap size={14} />}
            {isAuditing
              ? isVi
                ? 'ĐANG AUDIT LỆNH...'
                : 'AUDITING...'
              : isVi
                ? `KIỂM ĐỊNH LỆNH ${tradeDirection}`
                : `AUDIT ${tradeDirection} SETUP`}
          </button>
        </Tooltip>
      </div>

      {/* ── Audit Output Box ───────────────────────────────────────────── */}
      {auditResult && (
        <div
          className="summary-content"
          style={{
            background: 'var(--bg-slate-950)',
            padding: '18px 20px',
            borderRadius: '8px',
            border: '1px solid var(--border-panel)',
            color: 'var(--text-contrast)',
            lineHeight: '1.6',
            fontSize: '0.85rem',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{auditResult}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
