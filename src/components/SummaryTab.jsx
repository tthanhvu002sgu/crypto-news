import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2 } from 'lucide-react';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines, getHistoricalCVD, fetchRealtimeFeed } from '../services/api';

const cleanLatex = (text) => {
  if (!text) return text;
  return text
    .replace(/\$?\\ref\$?/gi, '')
    .replace(/\$?\\rightarrow\$?/gi, '->')
    .replace(/\$?\\delta\$?/gi, 'delta')
    .replace(/\$?\\Delta\$?/gi, 'Delta')
    .replace(/\\text\{([^}]+)\}/gi, '$1')
    .replace(/\\mathrm\{([^}]+)\}/gi, '$1')
    .replace(/\$([-+0-9.,]+)\$/g, '$1');
};

export default function SummaryTab({ 
  data, apiKeys, cvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading
}) {

  const provider = 'openrouter';
  const selectedModel = 'google/gemma-4-31b-it:free';

  const generateReport = async () => {
    const openRouterKey = apiKeys?.openRouter?.trim();
    const geminiKey = apiKeys?.gemini?.trim();

    if (provider === 'openrouter' && !openRouterKey) {
      alert("Please enter your OpenRouter API Key in the API Settings!");
      return;
    }
    if (provider === 'gemini' && !geminiKey) {
      alert("Please enter your Google AI Studio (Gemini) API Key in the API Settings!");
      return;
    }

    setIsAiLoading(true);
    setAiSummary('');

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

### On-chain Data
- Dominance: BTC (${data.globalData?.btcDominance || 'N/A'}%), ETH (${data.globalData?.ethDominance || 'N/A'}%)
- Total Market Cap: ${data.globalData?.totalMarketCap ? '$' + (data.globalData.totalMarketCap/1e9).toFixed(0) + 'B' : 'N/A'}
- Stablecoin Supply (Purchasing Power): USDT (${data.stablecoins?.usdt ? '$' + (data.stablecoins.usdt/1e9).toFixed(1) + 'B' : 'N/A'})
- BTC Hashrate: ${data.onChain?.hashRate || 'N/A'} EH/s
- Active Addresses: ${data.onChainMetrics?.activeAddresses || 'N/A'}

## 3. INSTITUTIONAL FLOWS (CME & ETF)
- Total BTC ETF Holdings: ${etfHoldings?.total ? etfHoldings.total.toLocaleString() + ' BTC (~$' + ((etfHoldings.total * (data.btc?.price || 0)) / 1e9).toFixed(1) + 'B)' : 'N/A'}
- 7-day ETF Net Flow (Total: ${etfNetTotal > 0 ? '+' : ''}${etfNetTotal.toFixed(0)}M USD):
${etfFlowStr}
- CME COT (Fund Positions): Asset Managers Net (${data.cotData?.assetManager?.net || 'N/A'}), Leveraged Funds Net (${data.cotData?.leveragedFunds?.net || 'N/A'})

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
${activeNews.slice(0, 15).map(n => '- ' + n.title + ' (' + n.tag + ')').join('\n')}
    `;

    try {
      const systemPrompt = `You are an expert macro analyst and seasoned crypto trader. Please analyze the market based on the provided MULTI-TIMEFRAME HISTORICAL DATA and current data. Report in English, using clear and professional Markdown formatting. Do not hallucinate data.

MANDATORY ANALYSIS PRINCIPLES (SYSTEM CONSTRAINTS):

0. PROHIBITION OF LATEX AND COMPLEX MATH SYMBOLS:
   - ABSOLUTELY DO NOT use LaTeX math formatting. Do not wrap numbers or symbols in dollar signs '$' or '$$'. Do not use LaTeX syntax like '\\text{}', '\\mathrm{}', '\\rightarrow', '\\delta', etc.
   - All numbers, currencies, and trends must be written as plain text and common symbols (e.g., write '-2.071M USD' instead of '$-2.071\\text{M USD}$', write 'Fed Rate' instead of '(\\text{Fed Rate})', write '102.3K' instead of '$102.3\\text{K}$', use a normal arrow '->' or the word 'to' instead of '\\rightarrow').

1. DEEP MACRO ANALYSIS:
   - Do not just mechanically list raw data.
   - YOU MUST calculate the Real Rate using the formula: Real Rate = Fed Funds Rate - Inflation (CPI).
   - YOU MUST analyze systemic contradictions if any (e.g., negative/low real rates but the 10Y Bond Yield is surging). Explain this phenomenon clearly (steepening yield curve, long-term inflation expectations, or fiscal pressure) and its impact on risk assets.

2. ON-CHAIN LOGIC & STABLECOIN PURCHASING POWER:
   - DO NOT consider Total Market Cap / Circulating Supply of USDT/Stablecoins as immediate latent demand ready to absorb BTC selling pressure. Explain clearly that: The circulating supply of USDT/Stablecoins might be in DeFi pools, used as collateral, or sitting in long-term wallets.
   - Point out that to analyze the potential direct demand for buying BTC, one must use Stablecoin Exchange Reserves. Since the current system does not provide this metric, you must highlight this limitation rather than extrapolating from Total Stablecoin Market Cap.

3. CME COT (COMMITMENT OF TRADERS) LAG:
   - Acknowledge that CME COT data is updated weekly (on Fridays, reflecting the previous Tuesday's data), meaning it has a 3-7 day lag.
   - MANDATORY: DO NOT use CME COT data to evaluate short-term price action (48h - 7-day timeframe). CME COT is only valuable for the Medium to Long-term picture (Position Trading). You must clearly separate the short-term outlook (based on ETF Flow, Order Book, CVD, HFT) and the long-term outlook (based on CME COT).

4. DERIVATIVES & FLOW CORRELATION (HFT):
   - Analyze the strong correlation between the Long/Short Ratio (counted by accounts) and CVD/Volume (calculated by monetary volume) alongside OBI.
   - Key Example: If Long orders dominate absolutely (L/S Ratio high, > 1.5) but CVD is heavily negative and OBI is negative, point out the conflict: the Long side is merely placing passive Limit Orders to support the price, while the Short/Sell side is aggressively placing Market Orders, pressing down hard. This reflects an active downtrend rather than aggressive buying.
   - Carefully analyze Short Squeeze (Price up + Open Interest down) or Long Squeeze (Price down + Open Interest down) phenomena if present.
   - Analyze the 7-day (4h timeframe) and 30-day (1d timeframe) historical CVD trend against BTC price movements. Point out divergences if any: e.g., if price makes a new high but CVD goes sideways/down (Selling absorption / Exhausted buying pressure) or price makes a new low but CVD gradually rises (Buying absorption / Whales accumulating).

5. WHALE WALLS SCALE METRICS (AGGREGATED ORDER BOOK):
   - The provided Whale Walls data is an Aggregated Order Book from the top 4 exchanges: Binance Spot, Binance Futures, Bybit Spot, Bybit Futures.
   - Apply a strict scale metric for BTC:
     * Total walls under 10M USD: Too small for BTC, practically meaningless as hard support/resistance (can be eaten in seconds by Market orders).
     * Total walls from 10M - 30M USD: Weak/micro support/resistance in ultra-short timeframes (HFT scalping).
     * Total walls from 30M - 50M USD: Medium support/resistance.
     * Total walls over 50M USD: Strong support/resistance (actual Whale Walls).
     * Total walls over 100M USD: Extremely strong barriers capable of causing short-term trend reversals.
   - Specifically cite the price level and the total aggregated USD value from the exchanges (Binance Spot, Binance Futures, Bybit Spot, Bybit Futures) as evidence.

6. SCORING MATRIX FOR PROJECTIONS:
   - Do not arbitrarily guess probabilities (e.g., 70% / 30%) based on feeling.
   - YOU MUST construct and print a **Scoring Matrix** to calculate the trend score.
   - Scoring categories (from -2 to +2 each: extremely bad is -2, bad is -1, neutral is 0, good is +1, extremely good is +2):
     * 1. Macro Context
     * 2. Institutional ETF Flow
     * 3. Spot & Onchain Price Action
     * 4. Derivatives & Open Interest
     * 5. HFT Flows & Aggregated Order Book
   - Calculate the total score (max +10, min -10). Convert to probabilities as follows:
     * Total score >= +6: Bullish (>75% probability of upward trend), Bearish (<25%)
     * Total score from +2 to +5: Moderately Bullish (60% - 70% upward prob.), Bearish (30% - 40%)
     * Total score from -1 to +1: Neutral (50% up / 50% down)
     * Total score from -5 to -2: Moderately Bearish (60% - 70% downward prob.), Bullish (30% - 40%)
     * Total score <= -6: Bearish (>75% downward prob.), Bullish (<25%)
   - You must print this scorecard specifically in section 5. YOU MUST use actual newline characters ('\\n') for each row of the table (header, separator :---, and each data row). Absolutely do not compress all table rows onto a single line. Write a proper markdown table comprising: Line 1: Header (| Col 1 | Col 2 |), Line 2: Separator (| :--- | :---: |), Line 3+: Data rows.

MANDATORY REPORT STRUCTURE COMPLIANCE:
### 1. MACRO CONTEXT
Analyze net liquidity, real rate, inflation, DXY, VIX, and High Yield Spread. Identify systemic contradictions and their impact on BTC.
### 2. CRYPTO MARKET & ON-CHAIN SITUATION
BTC price action compared to 7d/30d/90d/1y historical highs/lows. Analyze Altcoins, Volume, and cyclical nature. Comment on Stablecoins and the limitations of Exchange Reserves data.
### 3. INSTITUTIONAL FLOWS (ETF & CME)
7-day ETF Net Flows and selling absorption. Medium-to-long-term CME COT positions, emphasizing their lag regarding short-term analysis.
### 4. DERIVATIVES & SHORT-TERM FLOWS (HFT)
Correlation of Funding Rate, Open Interest, L/S Ratio, and CVD. Evaluate aggregated Whale Walls according to the scale metrics (strength of support/resistance barriers). Comment on the 7-day and 30-day historical CVD trend to find signs of divergence or short-to-medium-term accumulation/distribution.
### 5. CONCLUSION & TREND PROJECTION
- **BIAS**: Clearly state 🟢 BULLISH / 🔴 BEARISH / 🟡 NEUTRAL.
- **RISK SCORE**: Score from 1 (very safe) to 10 (very risky), explain briefly.
- **SCORING MATRIX**: Print the detailed scorecard for the 5 indicators and the total score to deduce up/down probabilities.
- **KEY PRICE ZONES**: Specifically list support and resistance based on actual aggregated Whale Walls data.
- **SCENARIOS**: Describe bullish and bearish scenarios with activation conditions.

⚠️ The report must be objective, logically rigorous, and based entirely on the provided actual numbers. At the end of the report, add the disclaimer: "This report is for informational purposes only, not financial advice. Please do your own research (DYOR) before making investment decisions."`;

      let url = "";
      let headers = { "Content-Type": "application/json" };

      if (provider === 'openrouter') {
        url = "https://openrouter.ai/api/v1/chat/completions";
        headers["Authorization"] = `Bearer ${openRouterKey}`;
      } else {
        url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
        headers["Authorization"] = `Bearer ${geminiKey}`;
      }

      const modelsToTry = provider === 'openrouter' ? [
        selectedModel,
        ...["google/gemma-4-31b-it:free", "meta-llama/llama-3.3-70b-instruct:free", "google/gemma-4-26b-a4b-it:free", "qwen/qwen3-coder:free"].filter(m => m !== selectedModel)
      ] : [
        selectedModel,
        ...["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"].filter(m => m !== selectedModel)
      ];

      let response = null;
      let successfulModel = "";
      let errorMsg = "";

      for (const modelName of modelsToTry) {
        try {
          console.log(`[AI] Trying model: ${modelName} (${provider})`);
          const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: promptData }
              ],
              temperature: 0.3,
              max_tokens: 3000,
              stream: true
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || `HTTP status ${res.status}`);
          }

          response = res;
          successfulModel = modelName;
          console.log(`[AI] Success with model: ${modelName}`);
          break;
        } catch (e) {
          console.warn(`[AI] Failed with model ${modelName}:`, e.message);
          errorMsg = e.message;
        }
      }

      if (!response) {
        throw new Error(errorMsg || "Unable to connect to AI provider.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        // Split by either \r\n, \n, or \r
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleaned = line.trim();
          if (!cleaned) continue;
          if (cleaned === "data: [DONE]") continue;

          let dataStr = "";
          if (cleaned.startsWith("data: ")) {
            dataStr = cleaned.slice(6);
          } else if (cleaned.startsWith("data:")) {
            dataStr = cleaned.slice(5);
          }

          if (dataStr) {
            dataStr = dataStr.trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error.message || JSON.stringify(parsed.error));
              }
              const choice = parsed.choices?.[0];
              if (choice) {
                if (choice.finish_reason === "safety") {
                  setAiSummary(prev => prev + "\n\n**[Report stopped due to AI Safety Filter]**");
                }
                const text = choice.delta?.content || "";
                if (text) {
                  setAiSummary(prev => cleanLatex(prev + text));
                }
              }
            } catch (e) {
              console.warn("[AI Stream Parse Error]", e, "Line:", cleaned);
            }
          }
        }
      }

      setAiSummary(prev => prev + `\n\n---\n*Report generated by model: **${successfulModel}** (${provider === 'openrouter' ? 'OpenRouter' : 'Google AI Studio'})*`);
    } catch (err) {
      console.error(err);
      setAiSummary(prev => prev + "\n\n**Error generating report:** " + err.message);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="summary-tab glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="panel-title font-mono text-emerald" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={18} /> AI MACRO & HFT SUMMARY
        </h3>
        <button 
          className="btn-sync font-mono" 
          onClick={generateReport} 
          disabled={isAiLoading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {isAiLoading ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}
          {isAiLoading ? 'GENERATING REPORT...' : 'GENERATE AI REPORT'}
        </button>
      </div>


      <div className="summary-content font-mono" style={{ 
        background: 'var(--bg-slate-950)', 
        padding: '20px', 
        borderRadius: '8px',
        border: '1px solid var(--border-panel)',
        minHeight: '300px',
        color: 'var(--text-contrast)',
        lineHeight: '1.6',
        fontSize: '0.85rem',
        overflowY: 'auto'
      }}>
        {aiSummary ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: 'var(--text-slate-500)', textAlign: 'center', marginTop: '100px' }}>
            Click "GENERATE AI REPORT" to have the AI (Gemma) summarize and analyze the current market data.
            <br/><br/>
            (Requires OpenRouter API Key in Settings)
          </div>
        )}
      </div>

      {/* CVD Array Export / Display Panel */}
      <div className="cvd-arrays-panel" style={{
        background: 'var(--bg-slate-900)',
        border: '1px solid var(--border-panel)',
        borderRadius: '8px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <h4 className="font-mono text-emerald" style={{ marginTop: 0, marginBottom: 0, fontSize: '0.8rem' }}>
          📊 HISTORICAL CVD ARRAY DATA (7D &amp; 30D)
        </h4>
        <p className="text-xs text-slate-400 font-mono" style={{ margin: 0, lineHeight: 1.4 }}>
          This data is automatically attached to the AI Input for trend analysis. You can also manually copy the array below for your own use.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span>7-DAY CVD ARRAY (4h TF, {data.cvdHistory7d?.length || 0} points)</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data.cvdHistory7d?.map(c => c.cvd) || []));
                  alert("Copied 7d CVD array!");
                }}
                className="text-emerald hover:underline"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}
              >
                Copy CVD array
              </button>
            </div>
            <textarea
              readOnly
              value={JSON.stringify(data.cvdHistory7d?.map(c => c.cvd) || [])}
              style={{ width: '100%', height: '50px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '6px', color: 'var(--text-contrast)', fontSize: '0.62rem', fontFamily: 'var(--font-mono)', resize: 'none', outline: 'none' }}
            />
          </div>

          <div>
            <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span>30-DAY CVD ARRAY (1d TF, {data.cvdHistory30d?.length || 0} points)</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data.cvdHistory30d?.map(c => c.cvd) || []));
                  alert("Copied 30d CVD array!");
                }}
                className="text-emerald hover:underline"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}
              >
                Copy CVD array
              </button>
            </div>
            <textarea
              readOnly
              value={JSON.stringify(data.cvdHistory30d?.map(c => c.cvd) || [])}
              style={{ width: '100%', height: '50px', background: 'var(--bg-slate-950)', border: '1px solid var(--border-panel)', borderRadius: '4px', padding: '6px', color: 'var(--text-contrast)', fontSize: '0.62rem', fontFamily: 'var(--font-mono)', resize: 'none', outline: 'none' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
