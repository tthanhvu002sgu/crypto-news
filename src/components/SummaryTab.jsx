import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2, Download } from 'lucide-react';
import Tooltip from './Tooltip';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines, getHistoricalCVD, fetchRealtimeFeed } from '../services/api';
import { getSystemPrompt, AI_STYLE_LABELS } from '../services/aiPrompts';
import { useModuleVisibility } from '../context/ModuleVisibilityContext';
import ModuleMenu from './ModuleMenu';

const cleanLatex = (text) => {
  if (!text) return text;
  return text
    .replace(/\$?\\ref\$?/gi, '')
    .replace(/\$?\\rightarrow\$?/gi, '->')
    .replace(/\$?\\delta\$?/gi, 'delta')
    .replace(/\$?\\Delta\$?/gi, 'Delta')
    .replace(/\\text\{([^}]+)\}/gi, '$1')
    .replace(/\\mathrm\{([^}]+)\}/gi, '$1')
    .replace(/\$([-+0-9.,]+)\$/g, '$1')
    .replace(/^ {4,}([-*+]|\d+\.) /gm, '  $1 '); // Prevent 4-space indent from creating code blocks
};

export default function SummaryTab({ 
  data, apiKeys, cvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading, lastSync,
  btcNupl, ethNupl, btcSupplyProfit, ethSupplyProfit
}) {
  const { isModuleHidden } = useModuleVisibility();
  if (isModuleHidden('tab_summary')) return null;

  const provider = 'gemini';
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('ai-model') || 'gemini-2.5-flash';
  });

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    localStorage.setItem('ai-model', newModel);
  };

  const [selectedStyle, setSelectedStyle] = useState(() => {
    return localStorage.getItem('ai-analysis-style') || 'professional';
  });

  const handleStyleChange = (newStyle) => {
    setSelectedStyle(newStyle);
    localStorage.setItem('ai-analysis-style', newStyle);
  };

  /** Report language: vi | en — persists across reloads */
  const [selectedLang, setSelectedLang] = useState(() => {
    const saved = localStorage.getItem('ai-report-lang');
    return saved === 'en' || saved === 'vi' ? saved : 'vi';
  });

  const handleLangChange = (lang) => {
    setSelectedLang(lang);
    localStorage.setItem('ai-report-lang', lang);
  };

  const isVi = selectedLang === 'vi';
  const styleLabels = AI_STYLE_LABELS[selectedLang] || AI_STYLE_LABELS.en;

  const preparePromptAndData = async () => {
    // Fetch HFT Data + multi-timeframe klines + latest calendar/news for the report
    let orderBook = null;
    let whaleWalls = null;
    let klines7d = [], klines30d = [], klines90d = [], klines1y = [];
    let cvd7d = [], cvd30d = [];
    let latestNews = [];
    try {
      [orderBook, whaleWalls, klines7d, klines30d, klines90d, klines1y, cvd7d, cvd30d, latestNews] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100),
        getWhaleWalls(),
        getBTCKlines('BTCUSDT', '4h', 42),   // 7d  = 42 x 4h candles
        getBTCKlines('BTCUSDT', '1d', 30),   // 30d = 30 x 1d candles
        getBTCKlines('BTCUSDT', '1d', 90),   // 90d = 90 x 1d candles
        getBTCKlines('BTCUSDT', '1w', 52),   // 1y  = 52 x 1w candles
        getHistoricalCVD('BTCUSDT', '4h', 42),
        getHistoricalCVD('BTCUSDT', '1d', 30),
        fetchRealtimeFeed(),
      ]);
    } catch (e) {
      console.warn("Error fetching data for report:", e);
    }

    const activeCvd7d = cvd7d.length > 0 ? cvd7d : (data.cvdHistory7d || []);
    const activeCvd30d = cvd30d.length > 0 ? cvd30d : (data.cvdHistory30d || []);
    const activeNews = latestNews && latestNews.length > 0 ? latestNews : (data.news || []);

    // --- Historical Data Helpers ---
    const klines48h = data.klines || [];
    // Sample every 4 candles (1h each = every 4h) to reduce tokens
    const klinesSampled = klines48h.filter((_, i) => i % 4 === 0).slice(-12);
    const klinesStr = klinesSampled.length > 0
      ? klinesSampled.map(k => `  ${new Date(k.time).toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${k.close.toFixed(0)}`).join('\n')
      : 'N/A';

    const priceNow = data.btc?.price || klines48h[klines48h.length - 1]?.close || 0;
    const price48hAgo = klines48h[0]?.close || 0;
    const price48hChange = price48hAgo > 0 ? (((priceNow - price48hAgo) / price48hAgo) * 100).toFixed(2) : 'N/A';
    const priceHigh48h = klines48h.length > 0 ? Math.max(...klines48h.map(k => k.high)).toFixed(0) : 'N/A';
    const priceLow48h = klines48h.length > 0 ? Math.min(...klines48h.map(k => k.low)).toFixed(0) : 'N/A';

    const lsHistory24h = data.lsHistory || [];
    // Sample every 4 records (1h each = every 4h)
    const lsSampled = lsHistory24h.filter((_, i) => i % 4 === 0).slice(-6);
    const lsStr = lsSampled.length > 0
      ? lsSampled.map(r => `  ${new Date(r.timestamp).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })}: Ratio=${parseFloat(r.longShortRatio).toFixed(2)} (Long ${(parseFloat(r.longAccount)*100).toFixed(1)}% / Short ${(parseFloat(r.shortAccount)*100).toFixed(1)}%)`).join('\n')
      : 'N/A';

    const oiHistory24h = data.oiHistory || [];
    const oiSampled = oiHistory24h.filter((_, i) => i % 4 === 0).slice(-6);
    const oiStr = oiSampled.length > 0
      ? oiSampled.map(r => `  ${new Date(r.timestamp).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' })}: ${parseFloat(r.sumOpenInterest).toFixed(0)} BTC ($${parseFloat(r.sumOpenInterestValue).toFixed(0)})`).join('\n')
      : 'N/A';
    const oiFirst = oiSampled[0] ? parseFloat(oiSampled[0].sumOpenInterest) : null;
    const oiLast = oiSampled[oiSampled.length - 1] ? parseFloat(oiSampled[oiSampled.length - 1].sumOpenInterest) : null;
    const oiTrend = oiFirst && oiLast ? (oiLast > oiFirst ? 'UP' : 'DOWN') : 'N/A';

    const etfFlow7d = etfHistory?.slice(-7) || [];
    const etfFlowStr = etfFlow7d.length > 0
      ? etfFlow7d.map(h => `  ${h.date}: ${h.flow > 0 ? '+' : ''}${h.flow}M USD`).join('\n')
      : 'N/A';
    const etfNetTotal = etfFlow7d.reduce((sum, h) => sum + (h.flow || 0), 0);

    // --- Multi-timeframe price stats helper ---
    const tfStats = (candles, label) => {
      if (!candles || candles.length === 0) return `${label}: N/A`;
      const first = candles[0].close;
      const last = candles[candles.length - 1].close;
      const high = Math.max(...candles.map(k => k.high));
      const low  = Math.min(...candles.map(k => k.low));
      const chg  = first > 0 ? (((last - first) / first) * 100).toFixed(2) : '?';
      const startDate = new Date(candles[0].time).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit' });
      return `${label}: Initial Price on ${startDate}: $${first.toFixed(0)} → Current: $${last.toFixed(0)} (${chg > 0 ? '+' : ''}${chg}%) | High: $${high.toFixed(0)} | Low: $${low.toFixed(0)}`;
    };

    // --- Sampled candles for 7d trend line (sample every 2 of 42 = 21 points) ---
    const klines7dSampled = klines7d.filter((_, i) => i % 2 === 0);
    const klines7dStr = klines7dSampled.length > 0
      ? klines7dSampled.map(k => `  ${new Date(k.time).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' })}: $${k.close.toFixed(0)}`).join('\n')
      : 'N/A';

    // --- Whale Walls price-level details ---
    const fmtWalls = (walls) => {
      if (!walls || walls.length === 0) return '  No data';
      return walls.slice(0, 5).map(w => {
        const srcStr = Object.entries(w.sources || {})
          .map(([name, val]) => `${name}: $${(val/1e6).toFixed(1)}M`)
          .join(', ');
        return `  $${w.price.toFixed(0)} — ${(w.usdValue/1e6).toFixed(2)}M USD (${w.qty.toFixed(2)} BTC) [Aggregated from: ${srcStr}]`;
      }).join('\n');
    };

    const formatCotRow = (name, r) => {
      if (!r) return '';
      return `  * ${name}: Long ${r.long} (${r.longChange}), Short ${r.short} (${r.shortChange}), Spread ${r.spread || 0} (${r.spreadChange || 0}), Net ${r.net} (${r.netChange})`;
    };
    const cotStr = data.cotData ? 
      `Date: ${data.cotData.date}\n${formatCotRow('Dealer Intermediary', data.cotData.dealerIntermediary)}\n${formatCotRow('Asset Manager/Institutional', data.cotData.assetManager)}\n${formatCotRow('Leveraged Funds', data.cotData.leveragedFunds)}\n${formatCotRow('Other Reportables', data.cotData.otherReportables)}\n${formatCotRow('Nonreportable Positions', data.cotData.nonReportable)}` : 'N/A';

    // Format Data for Prompt
    const promptData = `
# MARKET DATA

## 1. MACRO
- US Net Liquidity: ${data.netLiquidity ? '$' + data.netLiquidity + 'B' : 'N/A'}
- Fed Funds Rate: ${data.fedFundsRate ? data.fedFundsRate + '%' : 'N/A'}
- 10Y Bond Yield: ${data.tenYearYield ? data.tenYearYield + '%' : 'N/A'}
- DXY Index: ${data.dxy ? data.dxy.toFixed(2) : 'N/A'}
- VIX (Volatility Index): ${data.vix?.price != null ? data.vix.price.toFixed(2) : 'N/A'}
- High Yield Spread (Default Risk): ${data.highYield ? data.highYield + '%' : 'N/A'}
- Inflation (CPI): ${data.cpi ? data.cpi : 'N/A'}
- US Unemployment: ${data.unrate ? data.unrate + '%' : 'N/A'}
- Equities: S&P 500 (${data.sp500?.price || 'N/A'}), Nasdaq 100 (${data.qqq?.price || 'N/A'})
- M2 Supply: ${data.m2Supply ? '$' + data.m2Supply + 'B' : 'N/A'}

## 2. CRYPTO GLOBAL & ON-CHAIN
### Current BTC Price & 48h Volatility
- Current Price: ${data.btc?.price ? '$' + data.btc.price : 'N/A'} | 24h Change: ${data.btc?.change ? data.btc.change + '%' : 'N/A'} | 24h Volume: ${data.btc?.volume ? '$' + (data.btc.volume/1e9).toFixed(2) + 'B' : 'N/A'}
- 48h Change: ${price48hChange !== 'N/A' ? price48hChange + '%' : 'N/A'} | High: $${priceHigh48h} | Low: $${priceLow48h}
- BTC Price History (sampled every 4 hours in the last 48h):
${klinesStr}

### BTC Price Multi-timeframe Comparison
- ${tfStats(klines7d,  '7 days ')}
- ${tfStats(klines30d, '30 days')}
- ${tfStats(klines90d, '90 days')}
- ${tfStats(klines1y,  '1 year ')}
- 7-day price trend (sampled every 8 hours):
${klines7dStr}

### Major Altcoins (Risk Appetite)
- ETH: ${data.ethPrice?.price ? '$' + data.ethPrice.price + ' (' + (data.ethPrice.change || 'N/A') + '%)' : 'N/A'}
- SOL: ${data.solPrice?.price ? '$' + data.solPrice.price + ' (' + (data.solPrice.change || 'N/A') + '%)' : 'N/A'}

### On-chain Valuation & Network Data
- Dominance: BTC (${data.globalData?.btcDominance || 'N/A'}%), ETH (${data.globalData?.ethDominance || 'N/A'}%)
- Total Market Cap: ${data.globalData?.totalMarketCap ? '$' + (data.globalData.totalMarketCap/1e9).toFixed(0) + 'B' : 'N/A'}
- Stablecoin Supply (Purchasing Power): USDT (${data.stablecoins?.usdt ? '$' + (data.stablecoins.usdt/1e9).toFixed(1) + 'B' : 'N/A'})
- BTC Hashrate: ${data.onChain?.hashRate || 'N/A'} EH/s | Active Addresses: ${data.onChainMetrics?.activeAddresses || 'N/A'}
- BTC MVRV: ${data.onChainMetrics?.mvrv || 'N/A'} | BTC NUPL: ${btcNupl || 'N/A'} | BTC Supply in Profit (Est): ${btcSupplyProfit || 'N/A'}
- ETH MVRV: ${data.ethOnChainMetrics?.mvrv || 'N/A'} | ETH NUPL: ${ethNupl || 'N/A'} | ETH Supply in Profit (Est): ${ethSupplyProfit || 'N/A'}

## 3. INSTITUTIONAL FLOWS (CME & ETF)
- Total BTC ETF Holdings: ${etfHoldings?.total ? etfHoldings.total.toLocaleString() + ' BTC (~$' + ((etfHoldings.total * (data.btc?.price || 0)) / 1e9).toFixed(1) + 'B)' : 'N/A'}
- 7-day ETF Net Flow (Total: ${etfNetTotal > 0 ? '+' : ''}${etfNetTotal.toFixed(0)}M USD):
${etfFlowStr}
- CME COT (Futures Only):
${cotStr}

## 4. DERIVATIVES & HIGH-FREQUENCY TRADING (HFT)
- Funding Rate: ${data.fundingRate != null ? (data.fundingRate * 100).toFixed(4) + '%' : 'N/A'}
- Current Open Interest: ${data.openInterest ? (data.openInterest / 1000).toFixed(1) + 'K BTC' : 'N/A'} (24h Trend: ${oiTrend})
- 24h Open Interest History (sampled every 4 hours):
${oiStr}
- Current Long/Short Ratio: ${lsHistory24h.length > 0 ? parseFloat(lsHistory24h[lsHistory24h.length - 1].longShortRatio).toFixed(3) : 'N/A'}
- 24h L/S Ratio History:
${lsStr}
- CVD (Cumulative Volume Delta Intraday): ${cvd >= 0 ? '+' : ''}$${(cvd/1000).toFixed(1)}K (Buy: $${(buyVolume/1000).toFixed(1)}K, Sell: $${(sellVolume/1000).toFixed(1)}K)
- 7-day CVD Array (4h TF accumulation): [${activeCvd7d.map(c => c.cvd).join(', ')}]
- 7-day BTC Price Array corresponding: [${activeCvd7d.map(c => c.price).join(', ')}]
- 30-day CVD Array (1d TF accumulation): [${activeCvd30d.map(c => c.cvd).join(', ')}]
- 30-day BTC Price Array corresponding: [${activeCvd30d.map(c => c.price).join(', ')}]
- Aggregated Order Book Imbalance (OBI): ${orderBook ? orderBook.obiPercent + '%' : 'N/A'} (Signal: ${orderBook?.signal || 'N/A'})
  Multi-exchange OBI Breakdown:
${orderBook?.exchanges ? orderBook.exchanges.map(ex => `  * ${ex.name}: ${ex.obi >= 0 ? '+' : ''}${ex.obi}%`).join('\n') : '  * N/A'}
- Whale Walls Bid/Ask Ratio: ${whaleWalls ? (whaleWalls.bidRatio * 100).toFixed(1) + '% Bid' : 'N/A'} — Signal: ${whaleWalls?.signal || 'N/A'}
- Whale Support Walls (Bids):
${whaleWalls ? fmtWalls(whaleWalls.whaleBids) : '  N/A'}
- Whale Resistance Walls (Asks):
${whaleWalls ? fmtWalls(whaleWalls.whaleAsks) : '  N/A'}

## 5. TOP NEWS & MACRO EVENTS TODAY (LATEST)
${activeNews.slice(0, 30).map(n => '- [' + (n.timeStr || new Date(n.time).toLocaleString('en-US')) + '] ' + n.title + ' (' + n.tag + ')').join('\n')}
    `;

    // System prompt by style + language (vi | en)
    const systemPrompt = getSystemPrompt(selectedStyle, selectedLang);
    return { promptData, systemPrompt };
  };

  const [isExporting, setIsExporting] = useState(false);

  const exportDataForAi = async () => {
    setIsExporting(true);
    try {
      const { promptData, systemPrompt } = await preparePromptAndData();
      const langNote = isVi ? 'Tiếng Việt' : 'English';

      const markdownContent = isVi
        ? `# Yêu cầu phân tích thị trường AI

File này chứa dữ liệu thị trường hiện tại và hướng dẫn phân tích (system prompt). Bạn có thể tải/copy sang ChatGPT, Claude, Gemini hoặc AI khác.

**Ngôn ngữ báo cáo mong muốn:** ${langNote}

---

## 1. System Prompt (Hướng dẫn phân tích)

\`\`\`markdown
${systemPrompt}
\`\`\`

## 2. Market Data (Dữ liệu đầu vào)

\`\`\`markdown
${promptData}
\`\`\`
`
        : `# AI Market Analysis Request

This file contains the current market data and analysis instructions. You can upload or copy this content to ChatGPT, Claude, Gemini, or any other AI model for a professional market analysis.

**Report language:** ${langNote}

---

## 1. System Prompt (Analysis Instructions)

\`\`\`markdown
${systemPrompt}
\`\`\`

## 2. Market Data (Input Data)

\`\`\`markdown
${promptData}
\`\`\`
`;

      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.href = url;
      link.setAttribute(
        'download',
        `crypto_market_data_for_ai_${selectedLang}_${dateStr}_${timeStr}.md`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exporting data:', e);
      alert((isVi ? 'Xuất dữ liệu thất bại: ' : 'Failed to export data: ') + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  const generateReport = async () => {
    const geminiKey = apiKeys?.gemini?.trim();

    if (!geminiKey) {
      alert(
        isVi
          ? 'Vui lòng nhập Gemini API Key trong phần API Settings!'
          : 'Please enter your Gemini API Key in the API Settings!'
      );
      return;
    }

    setIsAiLoading(true);
    setAiSummary('');

    try {
      const { promptData, systemPrompt } = await preparePromptAndData();

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse&key=${geminiKey}`;
      const headers = {
        'Content-Type': 'application/json',
      };

      console.log(`[AI] model=${selectedModel} lang=${selectedLang} style=${selectedStyle}`);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          system_instruction: {
            parts: { text: systemPrompt },
          },
          contents: [{ role: 'user', parts: [{ text: promptData }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3000,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleaned = line.trim();
          if (!cleaned) continue;
          if (cleaned.startsWith('data: ')) {
            const dataStr = cleaned.slice(6).trim();
            if (!dataStr) continue;

            let parsed = null;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (parsed.error) {
              throw new Error(parsed.error.message || JSON.stringify(parsed.error));
            }
            const choice = parsed.candidates?.[0];
            if (choice) {
              const text = choice.content?.parts?.[0]?.text || '';
              if (text) {
                setAiSummary((prev) => cleanLatex(prev + text));
              }
              if (choice.finishReason && choice.finishReason !== 'STOP') {
                if (choice.finishReason === 'SAFETY') {
                  setAiSummary((prev) =>
                    prev +
                    (isVi
                      ? '\n\n**[Báo cáo dừng do bộ lọc an toàn AI]**'
                      : '\n\n**[Report stopped due to AI Safety Filter]**')
                  );
                } else if (choice.finishReason === 'MAX_TOKENS') {
                  setAiSummary((prev) =>
                    prev +
                    (isVi
                      ? '\n\n**[Báo cáo dừng: đã đạt giới hạn token đầu ra]**'
                      : '\n\n**[Report stopped: Max Output Tokens limit reached]**')
                  );
                } else {
                  setAiSummary((prev) =>
                    prev +
                    (isVi
                      ? `\n\n**[Báo cáo dừng sớm. Lý do: ${choice.finishReason}]**`
                      : `\n\n**[Report stopped early. Reason: ${choice.finishReason}]**`)
                  );
                }
              }
            }
          }
        }
      }

      const footer = isVi
        ? `\n\n---\n*Báo cáo tạo bởi model: **${selectedModel}** (Gemini API) · Ngôn ngữ: Tiếng Việt*`
        : `\n\n---\n*Report generated by model: **${selectedModel}** (Gemini API) · Language: English*`;
      setAiSummary((prev) => prev + footer);
    } catch (err) {
      console.error(err);
      let friendlyError = err.message;
      if (
        err.message.includes('429') ||
        err.message.toLowerCase().includes('quota') ||
        err.message.toLowerCase().includes('rate limit') ||
        err.message.toLowerCase().includes('exhausted')
      ) {
        friendlyError = isVi
          ? `Rate limit hoặc hết hạn mức API.\n\n**Hướng khắc phục:** Kiểm tra hạn mức trên Google AI Studio hoặc thử lại sau.`
          : `Rate limit or API quota exhausted.\n\n**Fix:** Check your quota on Google AI Studio or try again later.`;
      }
      setAiSummary(
        (prev) =>
          prev +
          (isVi ? '\n\n**Lỗi tạo báo cáo:** ' : '\n\n**Error generating report:** ') +
          friendlyError
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="summary-tab glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 className="panel-title font-mono text-emerald" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
          <Sparkles size={18} /> AI MACRO & HFT SUMMARY
        </h3>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Language Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
              {isVi ? 'NGÔN NGỮ:' : 'LANG:'}
            </span>
            <select
              value={selectedLang}
              onChange={(e) => handleLangChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              title={isVi ? 'Ngôn ngữ báo cáo AI' : 'AI report language'}
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Style Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>
              {isVi ? 'PHONG CÁCH:' : 'STYLE:'}
            </span>
            <select
              value={selectedStyle}
              onChange={(e) => handleStyleChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="professional">{styleLabels.professional}</option>
              <option value="tactical">{styleLabels.tactical}</option>
              <option value="educational">{styleLabels.educational}</option>
            </select>
          </div>

          {/* Model Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>MODEL:</span>
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isAiLoading || isExporting}
              className="text-slate-300 font-mono"
              style={{
                background: 'var(--bg-slate-900)',
                border: '1px solid var(--border-panel)',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
              <option value="gemma-4-31b-it">Gemma 4 31B</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Tooltip
              content={{
                api: 'Hệ thống (Local)',
                def: isVi
                  ? 'Xuất dữ liệu thị trường + system prompt (theo ngôn ngữ đã chọn) thành file Markdown để dùng với AI khác.'
                  : 'Export market data + system prompt (in the selected language) as Markdown for other AI tools.',
              }}
              lastUpdated={lastSync}
            >
              <button
                className="font-mono"
                onClick={exportDataForAi}
                disabled={isExporting || isAiLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  borderRadius: '4px',
                  background: isExporting || isAiLoading ? 'var(--bg-slate-800)' : 'var(--bg-slate-900)',
                  color: isExporting || isAiLoading ? 'var(--text-slate-500)' : 'var(--color-emerald-400)',
                  border:
                    isExporting || isAiLoading
                      ? '1px solid var(--border-panel)'
                      : '1px solid var(--border-emerald-500)',
                  cursor: isExporting || isAiLoading ? 'not-allowed' : 'pointer',
                  boxShadow: 'none',
                  transition: 'all 0.2s ease',
                }}
                onMouseOver={(e) => {
                  if (!isExporting && !isAiLoading) {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.borderColor = 'var(--text-contrast)';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isExporting && !isAiLoading) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.borderColor = 'var(--border-emerald-500)';
                  }
                }}
              >
                {isExporting ? <Loader2 size={14} className="spinning" /> : <Download size={14} />}
                {isExporting
                  ? isVi
                    ? 'ĐANG XUẤT...'
                    : 'EXPORTING...'
                  : isVi
                    ? 'XUẤT DATA CHO AI'
                    : 'EXPORT DATA FOR AI'}
              </button>
            </Tooltip>
            <Tooltip
              content={{
                api: 'Gemini API',
                def: isVi
                  ? 'Gemini đọc dữ liệu và lập báo cáo vĩ mô & HFT bằng ngôn ngữ đã chọn, theo cấu trúc system prompt.'
                  : 'Gemini reads market data and writes a macro & HFT report in the selected language.',
              }}
              lastUpdated={lastSync}
            >
              <button
                className="btn-sync font-mono"
                onClick={generateReport}
                disabled={isAiLoading || isExporting}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {isAiLoading ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}
                {isAiLoading
                  ? isVi
                    ? 'ĐANG TẠO BÁO CÁO...'
                    : 'GENERATING REPORT...'
                  : isVi
                    ? 'TẠO BÁO CÁO AI'
                    : 'GENERATE AI REPORT'}
              </button>
            </Tooltip>
            <ModuleMenu moduleId="tab_summary" />
          </div>
        </div>
      </div>

      <div
        className="summary-content font-mono"
        style={{
          background: 'var(--bg-slate-950)',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--border-panel)',
          minHeight: '300px',
          color: 'var(--text-contrast)',
          lineHeight: '1.6',
          fontSize: '0.85rem',
          overflowY: 'auto',
        }}
      >
        {aiSummary ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: 'var(--text-slate-500)', textAlign: 'center', marginTop: '100px' }}>
            {isVi ? (
              <>
                Bấm &quot;TẠO BÁO CÁO AI&quot; để Gemini tóm tắt và phân tích dữ liệu thị trường hiện tại
                (theo ngôn ngữ đã chọn).
                <br />
                <br />
                (Cần Gemini API Key trong Settings)
              </>
            ) : (
              <>
                Click &quot;GENERATE AI REPORT&quot; to have the AI (Gemini) summarize and analyze the
                current market data (in the selected language).
                <br />
                <br />
                (Requires Gemini API Key in Settings)
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
