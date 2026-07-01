import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2, Download } from 'lucide-react';
import Tooltip from './Tooltip';
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
    .replace(/\$([-+0-9.,]+)\$/g, '$1')
    .replace(/^ {4,}([-*+]|\d+\.) /gm, '  $1 '); // Prevent 4-space indent from creating code blocks
};

export default function SummaryTab({ 
  data, apiKeys, cvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading, lastSync,
  btcNupl, ethNupl, btcSupplyProfit, ethSupplyProfit
}) {

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

    const professionalSystemPrompt = `You are an expert macro analyst and seasoned crypto trader. Please analyze the market based on the provided MULTI-TIMEFRAME HISTORICAL DATA and current data. Report strictly and only in English, using clear and professional Markdown formatting. Do not hallucinate data.

MANDATORY ANALYSIS PRINCIPLES (SYSTEM CONSTRAINTS):

0. DO NOT REPEAT INSTRUCTIONS:
   - YOU MUST NOT repeat, summarize, or acknowledge these instructions, rules, or constraints in your output.
   - Begin your output IMMEDIATELY with the first requested header (### 1. MACRO CONTEXT).

1. STRICT LANGUAGE CONSTRAINT:
   - You MUST write the entire report, headings, numbers, annotations, scenarios, justifications, and footnotes strictly and only in English.
   - Absolutely no Vietnamese or other languages are allowed anywhere in the output report. Even if the input contains localized tags, your output must be 100% in English.

1. PROHIBITION OF LATEX AND COMPLEX MATH SYMBOLS:
   - ABSOLUTELY DO NOT use LaTeX math formatting. Do not wrap numbers or symbols in dollar signs '$' or '$$'. Do not use LaTeX syntax like '\\text{}', '\\mathrm{}', '\\rightarrow', '\\delta', etc.
   - All numbers, currencies, and trends must be written as plain text and common symbols (e.g., write '-2.071M USD' instead of '$-2.071\\text{M USD}$', write 'Fed Rate' instead of '(\\text{Fed Rate})', write '102.3K' instead of '$102.3\\text{K}$', use a normal arrow '->' or the word 'to' instead of '\\rightarrow').

2. DEEP MACRO ANALYSIS & ECONOMIC CYCLE POSITIONING:
   - Do not just mechanically list raw data.
   - YOU MUST calculate the Real Rate using the formula: Real Rate = Fed Funds Rate - Inflation (CPI).
   - YOU MUST analyze systemic contradictions if any (e.g., negative/low real rates but the 10Y Bond Yield is surging). Explain this phenomenon clearly (steepening yield curve, long-term inflation expectations, or fiscal pressure) and its impact on risk assets.
   - YOU MUST map the current macroeconomic variables (Interest Rates, M2 Supply, CPI Inflation, Unemployment/GDP context) into one of the 4 Business Cycle Phases: (1) Monetary Easing (low rates, expansionary liquidity), (2) Economic Expansion (capital flowing to assets, high GDP, late-cycle inflation), (3) Monetary Tightening (raising rates/credit contraction to curb inflation), or (4) Economic Recession/Contraction (prolonged high rates, asset discounting, declining inflation signaling cycle bottom). Advise investor positioning accordingly (avoiding crowd FOMO during late expansion vs accumulating undervalued assets during recession/tightening).

3. ON-CHAIN VALUATION & STABLECOIN PURCHASING POWER:
   - Evaluate Network Valuation using MVRV (Market Value to Realized Value) and NUPL (Net Unrealized Profit/Loss) for both BTC and ETH. Highlight if MVRV indicates an overvalued (> 3.5) or undervalued (< 1.0) zone, and interpret NUPL zones (Capitulation < 0, Belief/Optimism > 0, Euphoria > 0.75) to assess market cycle positioning.
   - DO NOT consider Total Market Cap / Circulating Supply of USDT/Stablecoins as immediate latent demand ready to absorb BTC selling pressure. Explain clearly that: The circulating supply of USDT/Stablecoins might be in DeFi pools, used as collateral, or sitting in long-term wallets.
   - Point out that to analyze the potential direct demand for buying BTC, one must use Stablecoin Exchange Reserves. Since the current system does not provide this metric, you must highlight this limitation rather than extrapolating from Total Stablecoin Market Cap.

4. CME COT (COMMITMENT OF TRADERS) COMPREHENSIVE BREAKDOWN & LAG:
   - MANDATORY EXHAUSTIVE BREAKDOWN: You MUST explicitly report, analyze, and interpret the Net positioning and weekly Change for ALL 5 trader categories: (1) Dealer Intermediary, (2) Asset Manager/Institutional, (3) Leveraged Funds, (4) Other Reportables, and (5) Nonreportable Positions. DO NOT skip, merge, or omit any category.
   - Acknowledge that CME COT data is updated weekly (on Fridays, reflecting the previous Tuesday's data), meaning it has a 3-7 day lag.
   - MANDATORY: DO NOT use CME COT data to evaluate short-term price action (48h - 7-day timeframe). CME COT is strictly valuable for the Medium to Long-term picture (Position Trading). You must clearly separate the short-term outlook (based on ETF Flow, Order Book, CVD, HFT) and the long-term outlook (based on CME COT).

5. DERIVATIVES & FLOW CORRELATION (HFT):
   - Analyze the strong correlation between the Long/Short Ratio (counted by accounts) and CVD/Volume (calculated by monetary volume) alongside OBI.
   - Key Example: If Long orders dominate absolutely (L/S Ratio high, > 1.5) but CVD is heavily negative and OBI is negative, point out the conflict: the Long side is merely placing passive Limit Orders to support the price, while the Short/Sell side is aggressively placing Market Orders, pressing down hard. This reflects an active downtrend rather than aggressive buying.
   - Carefully analyze Short Squeeze (Price up + Open Interest down) or Long Squeeze (Price down + Open Interest down) phenomena if present.
   - Analyze the 7-day (4h timeframe) and 30-day (1d timeframe) historical CVD trend against BTC price movements. Point out divergences if any: e.g., if price makes a new high but CVD goes sideways/down (Selling absorption / Exhausted buying pressure) or price makes a new low but CVD gradually rises (Buying absorption / Whales accumulating).

6. WHALE WALLS SCALE METRICS (AGGREGATED ORDER BOOK):
   - The provided Whale Walls data is an Aggregated Order Book from the top 4 exchanges: Binance Spot, Binance Futures, Bybit Spot, Bybit Futures.
   - Apply a strict scale metric for BTC:
     * Total walls under 10M USD: Too small for BTC, practically meaningless as hard support/resistance (can be eaten in seconds by Market orders).
     * Total walls from 10M - 30M USD: Weak/micro support/resistance in ultra-short timeframes (HFT scalping).
     * Total walls from 30M - 50M USD: Medium support/resistance.
     * Total walls over 50M USD: Strong support/resistance (actual Whale Walls).
     * Total walls over 100M USD: Extremely strong barriers capable of causing short-term trend reversals.
   - Specifically cite the price level and the total aggregated USD value from the exchanges (Binance Spot, Binance Futures, Bybit Spot, Bybit Futures) as evidence.

7. SCORING MATRIX FOR PROJECTIONS:
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
   - You must print this scorecard specifically in section 5. YOU MUST use actual newline characters ('\n') for each row of the table (header, separator :---, and each data row). Absolutely do not compress all table rows onto a single line. Write a proper markdown table comprising: Line 1: Header (| Col 1 | Col 2 |), Line 2: Separator (| :--- | :---: |), Line 3+: Data rows.

8. FINANCIAL CAUSALITY PRINCIPLES (REAL CAUSAL FACTORS IN FINANCE):
   - You MUST analyze the market and explain price action using the following real causal factors from financial science:
     * Mechanical Supply-Demand Imbalance (Order Flow Imbalance): Asset price increases are the direct result of active buy volume fully matching passive limit sell orders and pushing prices to higher levels. This is a direct, mechanical causal relationship.
     * Information Asymmetry: Accurate analysis of macroeconomic data and capital flows helps traders discover the underlying causes of asset mispricing before the market self-corrects toward its intrinsic value.
     * Forced Dynamics from Market Structure: Understanding why a specific group of investor positions is forced to stop out or get liquidated (Liquidation) at a particular price zone helps traders identify high-probability reversal or trend continuation areas, driven by this forced liquidity.

MANDATORY REPORT STRUCTURE COMPLIANCE:
You MUST follow this exact template structure, including headers, list patterns, and bullet descriptions. Just fill in the brackets [like this] with actual metrics analysis and numbers from the input data:

### 1. MACRO CONTEXT
The global macroeconomic framework is [describe general macro climate based on VIX, DXY, and geopolitical inflation]. When analyzing news, ALWAYS explicitly state the date of the news being referenced.

* **Real Rate Calculation**: The Real Rate is calculated using the formula:
Real Rate = Fed Funds Rate - Inflation (CPI)
Real Rate = [Fed Funds Rate]% - [Inflation (CPI)]% = [Calculated Real Rate]%

* **Systemic Contradictions**: [Analyze contradiction between Real Rate and 10Y Yield, long-term expectations, fiscal pressure].
* **Economic Cycle Positioning**: [Map the global economy into one of the 4 Business Cycle Phases: Monetary Easing / Expansion / Tightening / Recession based on rates, CPI, M2, and employment data. Provide strategic cycle-based investment positioning advice, such as observing patiently or preparing capital to accumulate discounted assets instead of following crowd FOMO].
* **Liquidity and Market Volatility**: U.S. Net Liquidity stands at [Net Liquidity]B USD, M2 Supply is [M2 Supply]B USD. Broad market anxiety is [VIX level] (VIX). High Yield Spread is [Spread]%, indicating [credit conditions]. Equities: S&P 500 at [S&P 500 Price] and Nasdaq 100 at [Nasdaq 100 Price]. [Conclude how this affects appetite for high-beta risk assets like Bitcoin].

---

### 2. CRYPTO MARKET & ON-CHAIN SITUATION
Bitcoin is [describe price/onchain environment, e.g., structural distribution/accumulation/consolidation] across multiple timeframes.

* **Multi-Timeframe Comparison**:
* **Current Price**: $[Current Price] (24h Change: [Change]%, 24h Volume: $[Vol]B)
* **7-Day Performance**: Open: $[Open] -> Current: $[Current] ([Change]%) | High: $[High] | Low: $[Low]
* **30-Day Performance**: Open: $[Open] -> Current: $[Current] ([Change]%) | High: $[High] | Low: $[Low]
* **90-Day Performance**: Open: $[Open] -> Current: $[Current] ([Change]%) | High: $[High] | Low: $[Low]
* **1-Year Performance**: Open: $[Open] -> Current: $[Current] ([Change]%) | High: $[High] | Low: $[Low]

* **Market Structure**: Bitcoin Dominance stands at [BTC Dominance]%, while ETH Dominance is [ETH Dominance]% (with ETH and SOL pricing [describe trend or availability]). Network fundamentals: BTC Hashrate is [Hashrate] EH/s and [Active Addresses] Active Addresses.
* **Stablecoin Purchasing Power & Data Limitations**: The circulating supply of USDT stands at $[USDT Supply]B out of a Total Market Cap of $[Total Cap]B. It is critical to state that this total supply must not be considered immediate latent demand ready to absorb BTC selling pressure. The circulating supply of USDT/Stablecoins might be locked in DeFi pools, utilized as capital collateral, or sitting inertly in long-term cold wallets. Accurate analysis of direct, immediate purchasing demand requires Stablecoin Exchange Reserves. Because the current dataset does not provide this specific metric, this presents a severe analytical limitation that prevents any extrapolation regarding immediate buying support from total stablecoin capitalization.

---

### 3. INSTITUTIONAL FLOWS (ETF & CME)
Institutional sentiment shows [describe overall sentiment, e.g., divergence, selling pressure, etc.].

* **Institutional ETF Flows**: Total BTC ETF Holdings stand at [ETF Holdings] BTC (~$[Holdings Value]B). Daily Net Flows breakdown for the last 7 days:
[List the 7 dates and flows, e.g., Date: Flow M USD]
[Conclude if spot price failed/succeeded to absorb this].

* **CME COT Comprehensive Assessment**: You MUST systematically detail and interpret the positioning of ALL 5 categories (DO NOT summarize or skip any group):
  * **Dealer Intermediary**: [Net position, weekly change, and role as liquidity providers/market makers]
  * **Asset Manager / Institutional**: [Net position, weekly change, and directional bias of real-money funds]
  * **Leveraged Funds**: [Net position, weekly change, and speculative bias of hedge funds/CTA strategies]
  * **Other Reportables**: [Net position, weekly change, and positioning of family offices/large prop firms]
  * **Nonreportable Positions**: [Net position, weekly change, and sentiment of retail/small traders]
  * **Overall COT Synthesis**: [Analyze the structural divergence between institutional/real-money positioning vs leveraged speculators for the medium-to-long term outlook].
* **CME COT Lag Acknowledgement**: It must be explicitly acknowledged that CME COT data is updated weekly on Fridays (reflecting the previous Tuesday's data), establishing a 3-7 day lag. Consequently, this data cannot be utilized to evaluate short-term price action (48h - 7-day timeframe). While ETF flows track immediate spot demand shifts, the lagged CME COT metrics are strictly valuable for the medium-to-long-term position trading outlook.

---

### 4. DERIVATIVES & SHORT-TERM FLOWS (HFT)
High-frequency and derivatives metrics reveal [describe derivatives market structure].

* **Derivatives Metrics & Conflict Analysis**: Funding Rate is [Funding Rate]%, Open Interest is [Open Interest] BTC (trending [UP/DOWN] over the last 24 hours), and Long/Short Ratio is [L/S Ratio] (retail accounts are [Long percentage]% Long).
* **Market Order vs. Limit Order Conflict**: There is a [stark/subtle] tactical conflict between the high Long/Short Ratio (counted by accounts) and the Intraday Cumulative Volume Delta (CVD), which is [CVD Value], yet [CVD HTF Value] on higher timeframes. The Long side is primarily placing passive Limit Orders to support the price, while the Short/Sell side has historically been aggressively executing Market Orders. This asymmetry typically reflects [distribution/accumulation/consolidation] rather than aggressive spot accumulation. [Comment on Long/Short Squeezes based on Price and Open Interest trend].
* **CVD Trend & Divergence Analysis**:
  * **7-Day CVD vs. Price (4h TF)**: The 7-day CVD array shifted from [7d CVD Start] to [7d CVD End]. Price during this period [price movement]. [Divergence analysis].
  * **30-Day CVD vs. Price (1d TF)**: The 30-day CVD shifted from [30d CVD Start] to [30d CVD End], [divergence or tracking analysis].
* **Whale Walls Scale Metrics**: The Aggregated Order Book from Binance Spot, Binance Futures, Bybit Spot, and Bybit Futures reveals [describe liquidity].
  * *Scale Metrics Application*: [Classify walls according to scale: under 10M USD (too small/meaningless), 10M-30M (weak/micro), 30M-50M (medium), over 50M (strong/Whale walls), over 100M (extremely strong)].
  * *Support*: [Detail largest aggregated bids, e.g. Price (USD Value, Breakdown)].
  * *Resistance*: [Detail largest aggregated asks, e.g. Price (USD Value, Breakdown)].
  Whale Walls Bid/Ask Ratio is [Ratio]% Bid, indicating [sentiment].

---

### 5. CONCLUSION & TREND PROJECTION
* **BIAS**: [🟢 BULLISH / 🔴 BEARISH / 🟡 NEUTRAL] (Short-to-Medium Term)
* **RISK SCORE**: [Score]/10. The risk score is [justification based on VIX, ETF flow, wall strength, retail leverage, etc.].

#### SCORING MATRIX
| Scoring Category | Score (-2 to +2) | Technical Justification |
| --- | --- | --- |
| 1. Macro Context | [Score] | [Justification] |
| 2. Institutional ETF Flow | [Score] | [Justification] |
| 3. Spot & Onchain Price Action | [Score] | [Justification] |
| 4. Derivatives & Open Interest | [Score] | [Justification] |
| 5. HFT Flows & Aggregated Order Book | [Score] | [Justification] |
| **Total Score** | **[Total Score]** | **[Outlook Class, e.g., Bearish/Bullish/Neutral Outlook]**<br> |

#### KEY PRICE ZONES
* **Immediate Support**: $[Price] ([Value] USD aggregated support; [weak/strong] structural defense). Critical macro support remains at $[Price].
* **Immediate Resistance**: $[Price] ([Value] USD aggregated resistance). Stronger macro resistance sits at $[Price].

#### FINANCIAL CAUSALITY OF CURRENT TREND
* **Mechanical Supply-Demand Imbalance (Order Flow Imbalance)**: [Analyze how current price movements are the direct mechanical result of active buy/sell volume fully matching passive limit sell/buy orders and pushing prices to new levels].
* **Information Asymmetry**: [Explain how macroeconomic data and capital flows are causing the market to misprice BTC, before self-correction toward intrinsic value].
* **Forced Dynamics from Market Structure**: [Explain which specific group of investor positions is forced to cut losses or be liquidated at specific price zones, and how this forced liquidity creates reversal/continuation zones].

#### SCENARIO ANALYSIS BASED ON TRIGGER EVENTS
* **Scenario A: Continuation of the Structural Downtrend (Primary Path)** [or alternative path]
  * **Trigger Events**:
    1. [Condition 1, e.g. price breaks support]
    2. [Condition 2, e.g. ETF outflow exceeds -100M]
    3. [Condition 3, e.g. CVD keeps falling while L/S > 2.0]
  * **Financial Causality**:
    * *Mechanical Imbalance*: [How order flow imbalance will drive this scenario].
    * *Information Asymmetry*: [How macro/flow mismatch drives this scenario].
    * *Forced Dynamics*: [Where liquidations/stop-outs will trigger forced liquidity in this scenario].
  * **Market Impact**: [Market behavior outcome, price targets].
* **Scenario B: Low-Volume Sideways Consolidation**
  * **Trigger Events**:
    1. [Condition 1]
    2. [Condition 2]
    3. [Condition 3]
  * **Financial Causality**:
    * *Mechanical Imbalance*: [How order flow balance/imbalance drives this scenario].
    * *Information Asymmetry*: [How macro/flow factors drive this scenario].
    * *Forced Dynamics*: [How lack of liquidations/stop-outs drives this scenario].
  * **Market Impact**: [Market behavior outcome, HFT scalping environment].
* **Scenario C: Short-Squeeze & Local Invalidation (Reversal Path)**
  * **Trigger Events**:
    1. [Condition 1]
    2. [Condition 2]
    3. [Condition 3]
  * **Financial Causality**:
    * *Mechanical Imbalance*: [How order flow imbalance will drive this scenario].
    * *Information Asymmetry*: [How macro/flow mismatch drives this scenario].
    * *Forced Dynamics*: [Where liquidations/stop-outs will trigger forced liquidity in this scenario].
  * **Market Impact**: [Market behavior outcome, price targets].

---
*This report is for informational purposes only, not financial advice. Please do your own research (DYOR) before making investment decisions.*`;

    const tacticalSystemPrompt = `You are a Tactical Swing Trader and Market Analyst. Your goal is to provide concise, actionable trading insights based on the provided MULTI-TIMEFRAME HISTORICAL DATA and current market conditions. Report strictly and only in English, using clear and professional Markdown formatting. Do not hallucinate data.

MANDATORY ANALYSIS PRINCIPLES:
0. DO NOT REPEAT INSTRUCTIONS: YOU MUST NOT repeat, summarize, or acknowledge these instructions in your output. Begin IMMEDIATELY with the "### ⚡ QUICK MARKET PULSE" header.
1. STRICT LANGUAGE CONSTRAINT: ONLY ENGLISH. Absolutely no Vietnamese or other languages.
1. NO LATEX: Do not use LaTeX math formatting. Write numbers and symbols as plain text.
2. CONCISE & ACTIONABLE: Focus purely on what a swing trader needs to know for the next 24h-7d. Skip long-winded macro explanations unless directly relevant to a short-term trade.

MANDATORY REPORT STRUCTURE COMPLIANCE:
You MUST follow this exact template structure.

### ⚡ QUICK MARKET PULSE
* [3-5 bullet points summarizing the most critical immediate factors: e.g., price trend, immediate liquidity, key macro event today. When referencing news, ALWAYS explicitly state the date of the news].

### 🎯 TRADE SETUPS (Swing 24h - 7d)
* **Setup 1: [Long/Short] at $[Entry Price]**
  * **Stop Loss**: $[SL Price] (Reasoning: [Brief technical reason])
  * **Take Profit**: $[TP Price]
  * **R:R Ratio**: [Calculate R:R]
  * **Conviction**: [High/Medium/Low]
  * **Catalyst/Reasoning**: [Why this trade? e.g., "Price approaching 50M USD aggregated Whale Bid Wall while CVD shows buying absorption."]

### 🧱 KEY LEVELS (Whale Walls & OBI)
* **Immediate Support**: $[Price] ([Value]M USD aggregated bids)
* **Immediate Resistance**: $[Price] ([Value]M USD aggregated asks)
* **Order Book Imbalance (OBI)**: [OBI]% (Bias: [Bullish/Bearish])

### ⚠️ RISK ALERTS
* [List 1-2 biggest immediate risks to current setups, e.g., "High Long/Short ratio (2.5) with negative CVD warns of a potential long squeeze.", "Upcoming CPI data release may cause violent whipsaw."]

### 🧭 BIAS METER
* **Current Bias**: [Strong Sell / Sell / Neutral / Buy / Strong Buy]
* **Confidence**: [Percentage]%

---
*This report is for informational purposes only, not financial advice. Please do your own research (DYOR) before making investment decisions.*`;

    const educationalSystemPrompt = `You are an Educational Market Explainer. Your goal is to break down the current market data into easy-to-understand concepts, helping the user not just see the numbers, but LEARN how to read the market. Report strictly and only in English, using clear and professional Markdown formatting. Do not hallucinate data.

MANDATORY ANALYSIS PRINCIPLES:
0. DO NOT REPEAT INSTRUCTIONS: YOU MUST NOT repeat, summarize, or acknowledge these instructions in your output. Begin IMMEDIATELY with the "### 📖 THE MARKET STORY TODAY" header.
1. STRICT LANGUAGE CONSTRAINT: ONLY ENGLISH. Absolutely no Vietnamese or other languages.
1. NO LATEX: Do not use LaTeX math formatting. Write numbers and symbols as plain text.
2. EDUCATIONAL FOCUS: Use simple analogies. Explain *why* a metric matters before stating its value. Use "💡 Concept" boxes.
3. TRAFFIC LIGHT SYSTEM: Use 🟢 (Bullish/Good), 🟡 (Neutral/Caution), 🔴 (Bearish/Bad) for sections.

MANDATORY REPORT STRUCTURE COMPLIANCE:
You MUST follow this exact template structure.

### 📖 THE MARKET STORY TODAY
[Write a 2-3 paragraph narrative explaining what is happening right now. Who is in control: buyers or sellers? How does the macro environment affect this? Keep it engaging and easy to digest. When referencing news, ALWAYS explicitly state the date of the news].

### 🌍 MACRO & THE BIG PICTURE
* 💡 **Concept: The 4-Phase Economic Cycle**: Markets move in recurring cycles: (1) Monetary Easing -> (2) Expansion -> (3) Tightening -> (4) Recession. Understanding which phase we are in helps investors avoid crowd FOMO at market tops and prepare capital/knowledge to accumulate discounted assets during economic downturns.
* 💡 **Concept: Real Rate**: The Real Rate (Fed Funds Rate minus Inflation) tells us if borrowing money is actually expensive. If it's high, investors prefer safe assets over Bitcoin.
* **Current Situation**: The calculated Real Rate is [Rate]%. [Explain what this means for Bitcoin today in simple terms and state which phase of the Economic Cycle we are currently navigating].
* **Liquidity**: Net Liquidity is [Value]. [Explain if money is flowing into or out of the system].

### 🐋 WHALES & INSTITUTIONS
* 💡 **Concept: ETF Flows & Whale Walls**: ETFs show if traditional finance is buying. Whale Walls show where giant players have placed massive buy/sell orders.
* **ETF Flow**: Over 7 days, ETFs saw [Net Flow]. [Explain impact].
* **Whale Walls**: The biggest buyers are waiting at $[Price] ([Value]M USD), acting as a "floor". The biggest sellers are at $[Price] ([Value]M USD), acting as a "ceiling".

### 📊 TRADERS & LEVERAGE (HFT)
* 💡 **Concept: Long/Short Ratio & CVD**: Long/Short ratio shows crowd sentiment. CVD (Cumulative Volume Delta) shows actual money flowing. When the crowd is Long but CVD is negative, the "smart money" is selling to the crowd.
* **Current Situation**: The crowd is currently [Long/Short dominant]. Meanwhile, CVD is [Positive/Negative]. [Explain the conflict or alignment and what it signals].

### 🎯 WHAT THIS MEANS FOR YOU (KEY TAKEAWAYS)
1. **[Takeaway 1]**
2. **[Takeaway 2]**
3. **[Takeaway 3]**

---
*This report is for educational purposes only, not financial advice. Please do your own research (DYOR) before making investment decisions.*`;

    let systemPrompt = professionalSystemPrompt;
    if (selectedStyle === 'tactical') systemPrompt = tacticalSystemPrompt;
    if (selectedStyle === 'educational') systemPrompt = educationalSystemPrompt;

    return { promptData, systemPrompt };
  };

  const [isExporting, setIsExporting] = useState(false);

  const exportDataForAi = async () => {
    setIsExporting(true);
    try {
      const { promptData, systemPrompt } = await preparePromptAndData();
      
      const markdownContent = `# AI Market Analysis Request

This file contains the current market data and analysis instructions. You can upload or copy this content to ChatGPT, Claude, Gemini, or any other AI model for a professional market analysis.

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
      const link = document.createElement("a");
      
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.href = url;
      link.setAttribute("download", `crypto_market_data_for_ai_${dateStr}_${timeStr}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error exporting data:", e);
      alert("Failed to export data: " + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  const generateReport = async () => {
    const geminiKey = apiKeys?.gemini?.trim();

    if (!geminiKey) {
      alert("Please enter your Gemini API Key in the API Settings!");
      return;
    }

    setIsAiLoading(true);
    setAiSummary('');

    try {
      const { promptData, systemPrompt } = await preparePromptAndData();

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:streamGenerateContent?alt=sse&key=${geminiKey}`;
      const headers = { 
        "Content-Type": "application/json"
      };

      console.log(`[AI] Trying model: ${selectedModel} (${provider})`);
      const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          system_instruction: {
            parts: { text: systemPrompt }
          },
          contents: [
            { role: "user", parts: [{ text: promptData }] }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3000
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP status ${res.status}`);
      }

      console.log(`[AI] Success with model: ${selectedModel}`);

      const reader = res.body.getReader();
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
          if (cleaned.startsWith("data: ")) {
            let dataStr = cleaned.slice(6).trim();
            if (!dataStr) continue;
            
            let parsed = null;
            let isParseError = false;
            try {
              parsed = JSON.parse(dataStr);
            } catch (e) {
              isParseError = true;
            }

            if (!isParseError && parsed) {
              if (parsed.error) {
                throw new Error(parsed.error.message || JSON.stringify(parsed.error));
              }
              const choice = parsed.candidates?.[0];
              if (choice) {
                const text = choice.content?.parts?.[0]?.text || "";
                if (text) {
                  setAiSummary(prev => cleanLatex(prev + text));
                }
                if (choice.finishReason && choice.finishReason !== "STOP") {
                  if (choice.finishReason === "SAFETY") {
                    setAiSummary(prev => prev + "\n\n**[Report stopped due to AI Safety Filter]**");
                  } else if (choice.finishReason === "MAX_TOKENS") {
                    setAiSummary(prev => prev + "\n\n**[Report stopped: Max Output Tokens limit reached]**");
                  } else {
                    setAiSummary(prev => prev + `\n\n**[Report stopped early. Reason: ${choice.finishReason}]**`);
                  }
                }
              }
            }
          }
        }
      }

      setAiSummary(prev => prev + `\n\n---\n*Report generated by model: **${selectedModel}** (Gemini API)*`);
    } catch (err) {
      console.error(err);
      let friendlyError = err.message;
      if (
        err.message.includes('429') || 
        err.message.toLowerCase().includes('quota') || 
        err.message.toLowerCase().includes('rate limit') || 
        err.message.toLowerCase().includes('exhausted')
      ) {
        friendlyError = `Rate Limit hoặc hết hạn mức API.\n\n` +
          `**Hướng khắc phục đề xuất:**\n` +
          `Vui lòng kiểm tra lại hạn mức trên Google AI Studio hoặc thử lại sau.`;
      }
      setAiSummary(prev => prev + "\n\n**Error generating report:** " + friendlyError);
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
          {/* Style Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="font-mono">
            <span style={{ fontSize: '0.62rem', color: 'var(--text-slate-400)' }}>STYLE:</span>
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
                cursor: 'pointer'
              }}
            >
              <option value="professional">Professional Macro</option>
              <option value="tactical">Tactical Swing Trader</option>
              <option value="educational">Educational Explainer</option>
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
                cursor: 'pointer'
              }}
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite</option>
              <option value="gemma-4-31b-it">Gemma 4 31B</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
          <Tooltip content={{
            api: 'Hệ thống (Local)',
            def: 'Xuất dữ liệu thị trường hiện có (Macro, Crypto, ETF, Derivatives, HFT) và Hướng dẫn phân tích (System Prompt) thành một file Markdown (.md) để người dùng có thể mang đi phân tích ở các nền tảng AI khác.'
          }} lastUpdated={lastSync}>
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
                background: (isExporting || isAiLoading) ? 'var(--bg-slate-800)' : 'var(--bg-slate-900)',
                color: (isExporting || isAiLoading) ? 'var(--text-slate-500)' : 'var(--color-emerald-400)',
                border: (isExporting || isAiLoading) ? '1px solid var(--border-panel)' : '1px solid var(--border-emerald-500)',
                cursor: (isExporting || isAiLoading) ? 'not-allowed' : 'pointer',
                boxShadow: 'none',
                transition: 'all 0.2s ease'
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
              {isExporting ? 'EXPORTING...' : 'EXPORT DATA FOR AI'}
            </button>
          </Tooltip>
          <Tooltip content={{
            api: 'Gemini API',
            def: 'Yêu cầu AI (Gemini) đọc dữ liệu hiện có và tự động lập báo cáo tóm tắt vĩ mô & HFT theo cấu trúc nghiêm ngặt của hệ thống.'
          }} lastUpdated={lastSync}>
            <button 
              className="btn-sync font-mono" 
              onClick={generateReport} 
              disabled={isAiLoading || isExporting}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isAiLoading ? <Loader2 size={14} className="spinning" /> : <Sparkles size={14} />}
              {isAiLoading ? 'GENERATING REPORT...' : 'GENERATE AI REPORT'}
            </button>
          </Tooltip>
        </div>
      </div>
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
            Click "GENERATE AI REPORT" to have the AI (Gemini) summarize and analyze the current market data.
            <br/><br/>
            (Requires Gemini API Key in Settings)
          </div>
        )}
      </div>


    </div>
  );
}
