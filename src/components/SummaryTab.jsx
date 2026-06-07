import React from 'react';
import { OpenRouter } from "@openrouter/sdk";
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2 } from 'lucide-react';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines } from '../services/api';

export default function SummaryTab({ 
  data, apiKeys, cvd, buyVolume, sellVolume, etfHoldings, etfHistory,
  aiSummary, setAiSummary, isAiLoading, setIsAiLoading
}) {

  const generateReport = async () => {
    const apiKey = apiKeys?.openRouter?.trim();
    if (!apiKey) {
      alert("Vui lòng nhập OpenRouter API Key trong phần Cài đặt API!");
      return;
    }

    setIsAiLoading(true);
    setAiSummary('');

    // Fetch HFT Data + multi-timeframe klines for the report
    let orderBook = null;
    let whaleWalls = null;
    let klines7d = [], klines30d = [], klines90d = [], klines1y = [];
    try {
      [orderBook, whaleWalls, klines7d, klines30d, klines90d, klines1y] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100),
        getWhaleWalls(),
        getBTCKlines('BTCUSDT', '4h', 42),   // 7d  = 42 x 4h candles
        getBTCKlines('BTCUSDT', '1d', 30),   // 30d = 30 x 1d candles
        getBTCKlines('BTCUSDT', '1d', 90),   // 90d = 90 x 1d candles
        getBTCKlines('BTCUSDT', '1w', 52),   // 1y  = 52 x 1w candles
      ]);
    } catch (e) {
      console.warn("Lỗi khi lấy dữ liệu cho báo cáo:", e);
    }

    // --- Historical Data Helpers ---
    const klines48h = data.klines || [];
    // Sample every 4 candles (1h each = every 4h) to reduce tokens
    const klinesSampled = klines48h.filter((_, i) => i % 4 === 0).slice(-12);
    const klinesStr = klinesSampled.length > 0
      ? klinesSampled.map(k => `  ${new Date(k.time).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: ${k.close.toFixed(0)}`).join('\n')
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
      ? lsSampled.map(r => `  ${new Date(r.timestamp).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })}: Ratio=${parseFloat(r.longShortRatio).toFixed(2)} (Long ${(parseFloat(r.longAccount)*100).toFixed(1)}% / Short ${(parseFloat(r.shortAccount)*100).toFixed(1)}%)`).join('\n')
      : 'N/A';

    const oiHistory24h = data.oiHistory || [];
    const oiSampled = oiHistory24h.filter((_, i) => i % 4 === 0).slice(-6);
    const oiStr = oiSampled.length > 0
      ? oiSampled.map(r => `  ${new Date(r.timestamp).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })}: ${parseFloat(r.sumOpenInterest).toFixed(0)} BTC ($${parseFloat(r.sumOpenInterestValue).toFixed(0)})`).join('\n')
      : 'N/A';
    const oiFirst = oiSampled[0] ? parseFloat(oiSampled[0].sumOpenInterest) : null;
    const oiLast = oiSampled[oiSampled.length - 1] ? parseFloat(oiSampled[oiSampled.length - 1].sumOpenInterest) : null;
    const oiTrend = oiFirst && oiLast ? (oiLast > oiFirst ? 'TĂNG' : 'GIẢM') : 'N/A';

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
      const startDate = new Date(candles[0].time).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
      return `${label}: Giá đầu kỳ ${startDate}: $${first.toFixed(0)} → Hiện tại: $${last.toFixed(0)} (${chg > 0 ? '+' : ''}${chg}%) | High: $${high.toFixed(0)} | Low: $${low.toFixed(0)}`;
    };

    // --- Sampled candles for 7d trend line (sample every 2 of 42 = 21 points) ---
    const klines7dSampled = klines7d.filter((_, i) => i % 2 === 0);
    const klines7dStr = klines7dSampled.length > 0
      ? klines7dSampled.map(k => `  ${new Date(k.time).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}: $${k.close.toFixed(0)}`).join('\n')
      : 'N/A';

    // --- Whale Walls price-level details ---
    const fmtWalls = (walls) => {
      if (!walls || walls.length === 0) return '  Không có dữ liệu';
      return walls.slice(0, 5).map(w => `  $${w.price.toFixed(0)} — ${(w.usdValue/1e6).toFixed(2)}M USD (${w.qty.toFixed(2)} BTC)`).join('\n');
    };

    // Format Data for Prompt
    const promptData = `
# DỮ LIỆU THỊ TRƯỜNG

## 1. VĨ MÔ (MACRO)
- Thanh khoản ròng Mỹ: ${data.netLiquidity ? '$' + data.netLiquidity + 'B' : 'N/A'}
- Lãi suất Fed: ${data.fedFundsRate ? data.fedFundsRate + '%' : 'N/A'}
- Lợi suất trái phiếu 10 năm (10Y Yield): ${data.tenYearYield ? data.tenYearYield + '%' : 'N/A'}
- Chỉ số DXY: ${data.dxy ? data.dxy.toFixed(2) : 'N/A'}
- VIX (Chỉ số biến động/hoảng loạn): ${data.vix?.price != null ? data.vix.price.toFixed(2) : 'N/A'}
- High Yield Spread (Rủi ro vỡ nợ): ${data.highYield ? data.highYield + '%' : 'N/A'}
- Lạm phát (CPI): ${data.cpi ? data.cpi : 'N/A'}
- Thất nghiệp Mỹ: ${data.unrate ? data.unrate + '%' : 'N/A'}
- Chứng khoán: S&P 500 (${data.sp500?.price || 'N/A'}), Nasdaq 100 (${data.qqq?.price || 'N/A'})
- M2 Supply: ${data.m2Supply ? '$' + data.m2Supply + 'B' : 'N/A'}

## 2. CRYPTO GLOBAL & ON-CHAIN
### Giá BTC Hiện tại & Biến động 48 giờ qua
- Giá hiện tại: ${data.btc?.price ? '$' + data.btc.price : 'N/A'} | 24h Change: ${data.btc?.change ? data.btc.change + '%' : 'N/A'} | Volume 24h: ${data.btc?.volume ? '$' + (data.btc.volume/1e9).toFixed(2) + 'B' : 'N/A'}
- Biến động 48h: ${price48hChange !== 'N/A' ? price48hChange + '%' : 'N/A'} | High: $${priceHigh48h} | Low: $${priceLow48h}
- Lịch sử giá BTC (mẫu mỗi 4 giờ trong 48h gần nhất):
${klinesStr}

### So sánh giá BTC đa khung thời gian
- ${tfStats(klines7d,  '7 ngày  ')}
- ${tfStats(klines30d, '30 ngày ')}
- ${tfStats(klines90d, '90 ngày ')}
- ${tfStats(klines1y,  '1 năm   ')}
- Diễn biến giá 7 ngày (mẫu mỗi 8 giờ):
${klines7dStr}


### Altcoin chính (đo risk appetite)
- ETH: ${data.ethPrice?.price ? '$' + data.ethPrice.price + ' (' + (data.ethPrice.change || 'N/A') + '%)' : 'N/A'}
- SOL: ${data.solPrice?.price ? '$' + data.solPrice.price + ' (' + (data.solPrice.change || 'N/A') + '%)' : 'N/A'}

### Dữ liệu On-chain
- Dominance: BTC (${data.globalData?.btcDominance || 'N/A'}%), ETH (${data.globalData?.ethDominance || 'N/A'}%)
- Tổng vốn hóa thị trường: ${data.globalData?.totalMarketCap ? '$' + (data.globalData.totalMarketCap/1e9).toFixed(0) + 'B' : 'N/A'}
- Nguồn cung Stablecoin (Sức mua): USDT (${data.stablecoins?.usdt ? '$' + (data.stablecoins.usdt/1e9).toFixed(1) + 'B' : 'N/A'})
- BTC Hashrate: ${data.onChain?.hashRate || 'N/A'} EH/s
- Ví đang hoạt động (Active Addresses): ${data.onChainMetrics?.activeAddresses || 'N/A'}

## 3. DÒNG TIỀN TỔ CHỨC (CME & ETF)
- Tổng BTC ETF đang nắm giữ: ${etfHoldings?.total ? etfHoldings.total.toLocaleString() + ' BTC (~$' + ((etfHoldings.total * (data.btc?.price || 0)) / 1e9).toFixed(1) + 'B)' : 'N/A'}
- Net Flow ETF 7 ngày qua (tổng: ${etfNetTotal > 0 ? '+' : ''}${etfNetTotal.toFixed(0)}M USD):
${etfFlowStr}
- CME COT (Vị thế các quỹ): Asset Managers Net (${data.cotData?.assetManager?.net || 'N/A'}), Leveraged Funds Net (${data.cotData?.leveragedFunds?.net || 'N/A'})

## 4. PHÁI SINH & NGẮN HẠN (HFT)
- Funding Rate: ${data.fundingRate != null ? (data.fundingRate * 100).toFixed(4) + '%' : 'N/A'}
- Open Interest hiện tại: ${data.openInterest ? (data.openInterest / 1000).toFixed(1) + 'K BTC' : 'N/A'} (Xu hướng 24h: ${oiTrend})
- Lịch sử Open Interest 24h (mẫu mỗi 4 giờ):
${oiStr}
- Long/Short Ratio hiện tại: ${lsHistory24h.length > 0 ? parseFloat(lsHistory24h[lsHistory24h.length - 1].longShortRatio).toFixed(3) : 'N/A'}
- Lịch sử L/S Ratio 24h:
${lsStr}
- CVD (Delta Khối lượng tích lũy trong ngày): ${cvd >= 0 ? '+' : ''}$${(cvd/1000).toFixed(1)}K (Buy: $${(buyVolume/1000).toFixed(1)}K, Sell: $${(sellVolume/1000).toFixed(1)}K)
- Order Book Imbalance (OBI): ${orderBook ? orderBook.obiPercent + '%' : 'N/A'}
- Whale Walls Bid/Ask Ratio: ${whaleWalls ? (whaleWalls.bidRatio * 100).toFixed(1) + '% Bid' : 'N/A'} — Tín hiệu: ${whaleWalls?.signal || 'N/A'}
- Whale Support Walls (Bid - vùng đỡ giá):
${whaleWalls ? fmtWalls(whaleWalls.whaleBids) : '  N/A'}
- Whale Resistance Walls (Ask - vùng chặn giá):
${whaleWalls ? fmtWalls(whaleWalls.whaleAsks) : '  N/A'}

## 5. TIN TỨC NỔI BẬT
${data.news.slice(0, 4).map(n => '- ' + n.title + ' (' + n.tag + ')').join('\n')}
    `;

    try {
      const openrouter = new OpenRouter({ apiKey: apiKey });

      const systemPrompt = `Bạn là chuyên gia phân tích vĩ mô và giao dịch tiền điện tử (Crypto) lão luyện. Hãy phân tích thị trường dựa trên DỮ LIỆU LỊCH SỬ ĐA KHUNG THỜI GIAN và dữ liệu hiện tại được cung cấp. Báo cáo bằng tiếng Việt, định dạng Markdown rõ ràng, chuyên nghiệp. Không bịa đặt dữ liệu.

QUY TẮC BẮT BUỘC:
1. LUÔN ĐỐI CHIẾU LỊCH SỬ: Khi nhận xét giá "cao" hay "thấp", BẮT BUỘC so sánh với dữ liệu 7d/30d/90d/1y được cấp. Ví dụ: "Giá $X hiện tại thấp hơn X% so với đỉnh 90 ngày ($Y), và cao hơn X% so với đáy 1 năm ($Z)."
2. PHÂN TÍCH XU HƯỚNG THEO NHIỀU KHUNG: Xác định xu hướng ngắn hạn (48h-7d), trung hạn (30d-90d), dài hạn (1y). Chỉ rõ đây là giai đoạn tích lũy / phục hồi / suy giảm dựa trên số liệu cụ thể.
3. TƯƠNG QUAN LIÊN THỊ TRƯỜNG: Phân tích mối liên hệ DXY ↔ BTC (DXY tăng thường ép BTC), VIX ↔ BTC (VIX cao = risk-off), ETF Flow ↔ Giá (flow vào nhưng giá giảm = absorb selling pressure).
4. TRÁNH NHẬN ĐỊNH CHỦ QUAN: Không nói "giá cao" hay "giá thấp" chung chung. Luôn kèm theo dữ liệu % so với mốc cụ thể (48h/7d/30d/90d/1y).

BẮT BUỘC TUÂN THỦ CẤU TRÚC SAU:
### 1. BỐI CẢNH VĨ MÔ (MACRO)
Đánh giá thanh khoản, lãi suất, DXY, VIX, High Yield Spread và ảnh hưởng đến tài sản rủi ro. Phân tích tương quan DXY ↔ BTC, VIX ↔ BTC.
### 2. TÌNH HÌNH THỊ TRƯỜNG CRYPTO & ON-CHAIN
Đánh giá hành vi giá BTC đa khung: vị trí hiện tại so với 7d/30d/90d/1y (High/Low), sức khỏe altcoin (ETH/SOL), volume xác nhận xu hướng, và dữ liệu on-chain. Nêu rõ giá đang trong giai đoạn nào của chu kỳ.
### 3. DÒNG TIỀN TỔ CHỨC (ETF & CME)
Phân tích tổng BTC ETF đang nắm, xu hướng ETF Flow 7 ngày (tổng net flow, ngày flow dương/âm), đối chiếu flow với hành vi giá, và vị thế CME COT.
### 4. PHÁI SINH & DÒNG TIỀN NGẮN HẠN (HFT)
Phân tích Funding Rate, xu hướng OI 24h (tăng/giảm bao nhiêu), xu hướng L/S Ratio, CVD, OBI và Whale Walls (nêu cụ thể vùng giá hỗ trợ/kháng cự từ dữ liệu) để xác định áp lực mua/bán trong ngắn hạn.
### 5. KẾT LUẬN & DỰ PHÓNG XU HƯỚNG
BẮT BUỘC bao gồm:
- **BIAS**: Ghi rõ 🟢 BULLISH / 🔴 BEARISH / 🟡 NEUTRAL ngay đầu kết luận.
- **ĐIỂM RỦI RO**: Cho điểm từ 1 (rất an toàn) đến 10 (rất rủi ro), giải thích ngắn gọn.
- **VÙNG GIÁ QUAN TRỌNG**: Nêu cụ thể vùng hỗ trợ (từ Whale Bid Walls + đáy lịch sử) và kháng cự (từ Whale Ask Walls + đỉnh lịch sử).
- **KỊCH BẢN**: Mô tả kịch bản tăng (điều kiện gì cần xảy ra) và kịch bản giảm (điều kiện gì cần xảy ra).
- Căn cứ hoàn toàn vào dữ liệu thực tế.

⚠️ Lưu ý cuối: "Báo cáo này chỉ mang tính chất tham khảo, không phải lời khuyên đầu tư. Hãy tự nghiên cứu (DYOR) trước khi ra quyết định."`;

      const stream = await openrouter.chat.send({
        chatRequest: {
          model: "google/gemma-4-31b-it:free",
          temperature: 0.3,
          max_tokens: 3000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: promptData }
          ],
          stream: true
        }
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          setAiSummary(prev => prev + content);
        }
      }
    } catch (err) {
      console.error(err);
      setAiSummary(prev => prev + "\n\n**Lỗi khi tạo báo cáo:** " + err.message);
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
          {isAiLoading ? 'ĐANG TẠO BÁO CÁO...' : 'TẠO BÁO CÁO AI'}
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
            <ReactMarkdown>{aiSummary}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: 'var(--text-slate-500)', textAlign: 'center', marginTop: '100px' }}>
            Nhấn "TẠO BÁO CÁO AI" để AI (Gemma) tổng hợp và phân tích dữ liệu thị trường hiện tại.
            <br/><br/>
            (Yêu cầu cung cấp OpenRouter API Key trong Cài đặt)
          </div>
        )}
      </div>
    </div>
  );
}
