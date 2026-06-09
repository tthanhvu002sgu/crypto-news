import { OpenRouter } from "@openrouter/sdk";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2 } from 'lucide-react';
import { getOrderBookDepth, getWhaleWalls, getBTCKlines, getHistoricalCVD } from '../services/api';

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
    let cvd7d = [], cvd30d = [];
    try {
      [orderBook, whaleWalls, klines7d, klines30d, klines90d, klines1y, cvd7d, cvd30d] = await Promise.all([
        getOrderBookDepth('BTCUSDT', 100),
        getWhaleWalls(),
        getBTCKlines('BTCUSDT', '4h', 42),   // 7d  = 42 x 4h candles
        getBTCKlines('BTCUSDT', '1d', 30),   // 30d = 30 x 1d candles
        getBTCKlines('BTCUSDT', '1d', 90),   // 90d = 90 x 1d candles
        getBTCKlines('BTCUSDT', '1w', 52),   // 1y  = 52 x 1w candles
        getHistoricalCVD('BTCUSDT', '4h', 42),
        getHistoricalCVD('BTCUSDT', '1d', 30),
      ]);
    } catch (e) {
      console.warn("Lỗi khi lấy dữ liệu cho báo cáo:", e);
    }

    const activeCvd7d = cvd7d.length > 0 ? cvd7d : (data.cvdHistory7d || []);
    const activeCvd30d = cvd30d.length > 0 ? cvd30d : (data.cvdHistory30d || []);

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
      return walls.slice(0, 5).map(w => {
        const srcStr = Object.entries(w.sources || {})
          .map(([name, val]) => `${name}: $${(val/1e6).toFixed(1)}M`)
          .join(', ');
        return `  $${w.price.toFixed(0)} — ${(w.usdValue/1e6).toFixed(2)}M USD (${w.qty.toFixed(2)} BTC) [Gộp từ: ${srcStr}]`;
      }).join('\n');
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
- Mảng CVD 7 ngày (tích lũy khung 4h): [${activeCvd7d.map(c => c.cvd).join(', ')}]
- Mảng Giá BTC 7 ngày tương ứng: [${activeCvd7d.map(c => c.price).join(', ')}]
- Mảng CVD 30 ngày (tích lũy khung 1d): [${activeCvd30d.map(c => c.cvd).join(', ')}]
- Mảng Giá BTC 30 ngày tương ứng: [${activeCvd30d.map(c => c.price).join(', ')}]
- Order Book Imbalance (OBI) gộp: ${orderBook ? orderBook.obiPercent + '%' : 'N/A'} (Tín hiệu: ${orderBook?.signal || 'N/A'})
  Breakdown OBI đa sàn:
${orderBook?.exchanges ? orderBook.exchanges.map(ex => `  * ${ex.name}: ${ex.obi >= 0 ? '+' : ''}${ex.obi}%`).join('\n') : '  * N/A'}
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

CÁC NGUYÊN TẮC PHÂN TÍCH BẮT BUỘC (RÀNG BUỘC CỦA HỆ THỐNG):

0. CẤM SỬ DỤNG LATEX VÀ KÝ HIỆU TOÁN HỌC PHỨC TẠP:
   - TUYỆT ĐỐI CẤM sử dụng định dạng toán học LaTeX. Không bọc số liệu hoặc ký hiệu trong các ký tự dollar '$' hoặc '$$'. Không sử dụng các cú pháp LaTeX như '\\text{}', '\\mathrm{}', '\\rightarrow', '\\delta', v.v.
   - Tất cả con số, đơn vị tiền tệ và xu hướng phải được viết dưới dạng văn bản thường và ký hiệu phổ thông (Ví dụ: viết '-2,071M USD' thay vì '$-2,071\\text{M USD}$', viết 'Fed Rate' hoặc 'Lãi suất Fed' thay vì '(\\text{Fed Rate})', viết '102.3K' thay vì '$102.3\\text{K}$', sử dụng dấu mũi tên thông thường '->' hoặc chữ 'đến' thay vì '\\rightarrow').

1. PHÂN TÍCH VĨ MÔ SÂU SẮC (MACRO):
   - Không được liệt kê số liệu thô một cách máy móc.
   - BẮT BUỘC tính toán Lãi suất thực (Real Rate) theo công thức: Lãi suất thực = Lãi suất Fed - Lạm phát (CPI).
   - BẮT BUỘC phân tích mâu thuẫn hệ thống nếu có (Ví dụ: Lãi suất thực âm/thấp nhưng Lợi suất trái phiếu 10 năm (10Y Yield) lại vọt lên cao). Giải thích rõ hiện tượng này (đường cong lợi suất dốc lên, kỳ vọng lạm phát dài hạn, hoặc áp lực tài chính) và ảnh hưởng của nó đến tài sản rủi ro.

2. LOGIC ON-CHAIN & SỨC MUA STABLECOIN:
   - KHÔNG ĐƯỢC coi Tổng vốn hóa/Tổng cung lưu hành của USDT/Stablecoin là lực cầu tiềm năng đang chờ để hấp thụ lực bán BTC. Giải thích rõ rằng: Tổng cung USDT/Stablecoin lưu hành có thể nằm trong các pool DeFi, làm tài sản thế chấp hoặc nằm trong ví dài hạn của người dùng.
   - Chỉ ra rằng để phân tích lực cầu tiềm năng mua BTC trực tiếp, bắt buộc phải dùng số liệu Stablecoin trên các sàn giao dịch (Stablecoin Exchange Reserves). Do hệ thống hiện tại chưa cung cấp số liệu này, bạn phải nhấn mạnh điểm hạn chế này thay vì suy diễn từ Tổng vốn hóa Stablecoin.

3. ĐỘ TRỄ CỦA CME COT (COMMITMENT OF TRADERS):
   - Nhận thức rõ dữ liệu CME COT được cập nhật hàng tuần (vào thứ Sáu, phản ánh dữ liệu thứ Ba trước đó), có độ trễ từ 3-7 ngày.
   - BẮT BUỘC: KHÔNG ĐƯỢC sử dụng dữ liệu CME COT để nhận định hay phân tích hành vi giá ngắn hạn (khung 48h - 7 ngày). CME COT chỉ có giá trị cho bức tranh Trung - Dài hạn (Position Trading). Phải phân tách rõ nhận định ngắn hạn (dựa trên ETF Flow, Order Book, CVD, HFT) và nhận định dài hạn (dựa trên CME COT).

4. TƯƠNG QUAN PHÁI SINH & DÒNG TIỀN (HFT):
   - Phân tích mối tương quan chặt chẽ giữa Long/Short Ratio (đếm theo số tài khoản) và CVD/Volume (tính theo khối lượng tiền) kèm OBI.
   - Ví dụ quan trọng: Nếu lệnh Long chiếm ưu thế tuyệt đối (L/S Ratio cao, > 1.5) nhưng CVD âm nặng và OBI âm, hãy chỉ ra sự xung đột: phe Long chỉ đang đặt lệnh giới hạn (Limit Orders) thụ động để đỡ giá, trong khi phe Short/Bán đang rải lệnh thị trường (Market Orders) ép xuống rất rát. Điều này phản ánh xu hướng giảm chủ động chứ không phải tích cực mua lên.
   - Phân tích kỹ hiện tượng Short Squeeze (Giá tăng + Open Interest giảm) hoặc Long Squeeze (Giá giảm + Open Interest giảm) nếu có.
   - Phân tích xu hướng CVD lịch sử 7 ngày (khung 4h) và 30 ngày (khung 1d) so với biến động giá BTC. Chỉ ra các phân kỳ (divergences) nếu có: ví dụ, nếu giá tạo đỉnh mới nhưng CVD lại đi ngang/đi xuống (Bán hấp thụ/Cạn kiệt lực mua) hoặc giá tạo đáy mới nhưng CVD tăng dần (Mua hấp thụ/Cá mập gom hàng).

5. THANG ĐO QUY MÔ WHALE WALLS (SỔ LỆNH GỘP):
   - Dữ liệu Whale Walls được cung cấp là sổ lệnh gộp (Aggregated Order Book) từ 4 sàn lớn nhất: Binance Spot, Binance Futures, Bybit Spot, Bybit Futures.
   - Áp dụng thang đo quy mô nghiêm ngặt cho BTC:
     * Tổng tường lệnh dưới 10M USD: Quá nhỏ đối với BTC, không đủ ý nghĩa làm vùng hỗ trợ/kháng cự cứng (có thể bị nuốt chửng trong vòng vài giây bởi các lệnh Market).
     * Tổng tường lệnh từ 10M - 30M USD: Hỗ trợ/kháng cự yếu/vi mô trong khung thời gian siêu ngắn (HFT scalping).
     * Tổng tường lệnh từ 30M - 50M USD: Vùng hỗ trợ/kháng cự trung bình.
     * Tổng tường lệnh trên 50M USD: Vùng hỗ trợ/kháng cự mạnh (tường cá voi Whale Walls thực sự).
     * Tổng tường lệnh trên 100M USD: Vùng cản cực mạnh có khả năng gây đảo chiều xu hướng ngắn hạn.
   - Chỉ ra cụ thể mức giá và tổng giá trị USD gộp từ các sàn (Binance Spot, Binance Futures, Bybit Spot, Bybit Futures) để chứng minh.

6. MA TRẬN TRỌNG SỐ (SCORING MATRIX) CHO DỰ PHÒNG:
   - Cấm tự phán đoán ngẫu nhiên xác suất (ví dụ: 70% / 30%) một cách cảm tính.
   - BẮT BUỘC tự xây dựng và in ra một **Bảng Ma trận trọng số (Scoring Matrix)** để tính toán điểm xu hướng.
   - Các danh mục chấm điểm (từ -2 đến +2 mỗi danh mục: cực xấu là -2, xấu là -1, trung lập là 0, tốt là +1, cực tốt là +2):
     * 1. Bối cảnh Vĩ mô (Macro)
     * 2. Dòng tiền ETF Tổ chức (ETF Flow)
     * 3. Hành vi giá Spot & Onchain
     * 4. Phái sinh & Open Interest (Derivatives/OI)
     * 5. Dòng tiền HFT & Sổ lệnh gộp (HFT/Aggregated Order Book)
   - Tính tổng điểm (tối đa +10, tối thiểu -10). Quy đổi ra xác suất như sau:
     * Tổng điểm >= +6: Bullish (>75% xác suất tăng), Bearish (<25%)
     * Tổng điểm từ +2 đến +5: Moderately Bullish (60% - 70% xác suất tăng), Bearish (30% - 40%)
     * Tổng điểm từ -1 đến +1: Neutral (50% tăng / 50% giảm)
     * Tổng điểm từ -5 đến -2: Moderately Bearish (60% - 70% xác suất giảm), Bullish (30% - 40%)
     * Tổng điểm <= -6: Bearish (>75% xác suất giảm), Bullish (<25%)
   - Phải in bảng điểm này cụ thể trong phần 5. BẮT BUỘC xuống dòng (sử dụng ký tự xuống dòng '\\n' thực sự) cho từng dòng của bảng (tiêu đề, dòng phân cách :---, và từng hàng dữ liệu). Tuyệt đối không được viết dồn tất cả các hàng của bảng trên cùng một dòng. Hãy viết bảng chuẩn markdown gồm: Dòng 1: Tiêu đề (| Cột 1 | Cột 2 |), Dòng 2: Phân cách (| :--- | :---: |), Dòng 3+: Các hàng dữ liệu.

BẮT BUỘC TUÂN THỦ CẤU TRÚC BÁO CÁO SAU:
### 1. BỐI CẢNH VĨ MÔ (MACRO)
Phân tích thanh khoản ròng, lãi suất thực, lạm phát, DXY, VIX, và High Yield Spread. Chỉ rõ các mâu thuẫn hệ thống và ảnh hưởng đến BTC.
### 2. TÌNH HÌNH THỊ TRƯỜNG CRYPTO & ON-CHAIN
Hành vi giá BTC so với đỉnh/đáy lịch sử 7d/30d/90d/1y. Phân tích Altcoin, Volume và tính chất chu kỳ. Nhận định về Stablecoin và hạn chế dữ liệu Exchange Reserves.
### 3. DÒNG TIỀN TỔ CHỨC (ETF & CME)
Dòng tiền ETF 7 ngày qua và sự hấp thụ lực bán. Vị thế CME COT trung-dài hạn và nhấn mạnh tính trễ đối với phân tích ngắn hạn.
### 4. PHÁI SINH & DÒNG TIỀN NGẮN HẠN (HFT)
Tương quan Funding Rate, Open Interest, L/S Ratio và CVD. Đánh giá Whale Walls gộp theo thang đo quy mô (độ mạnh yếu của các bức tường hỗ trợ/kháng cự). Nhận định về xu hướng CVD lịch sử 7 ngày và 30 ngày để tìm kiếm các dấu hiệu phân kỳ hoặc tích lũy/phân phối ngắn-trung hạn.
### 5. KẾT LUẬN & DỰ PHÓNG XU HƯỚNG
- **BIAS**: Ghi rõ 🟢 BULLISH / 🔴 BEARISH / 🟡 NEUTRAL.
- **ĐIỂM RỦI RO**: Cho điểm từ 1 (rất an toàn) đến 10 (rất rủi ro), giải thích ngắn gọn.
- **MA TRẬN CHẤM ĐIỂM (SCORING MATRIX)**: In bảng điểm chi tiết cho 5 chỉ số và tổng điểm để quy ra xác suất tăng/giảm.
- **VÙNG GIÁ QUAN TRỌNG**: Nêu cụ thể hỗ trợ và kháng cự theo số liệu Whale Walls gộp thực tế.
- **KỊCH BẢN**: Mô tả kịch bản tăng và giảm kèm điều kiện kích hoạt.

⚠️ Báo cáo phải khách quan, logic chặt chẽ, dựa hoàn toàn trên các con số thực tế được cung cấp. Cuối báo cáo thêm cảnh báo: "Báo cáo này chỉ mang tính chất tham khảo, không phải lời khuyên đầu tư. Hãy tự nghiên cứu (DYOR) trước khi ra quyết định."`;

      const modelsToTry = [
        "google/gemma-4-31b-it:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemma-4-26b-a4b-it:free",
        "qwen/qwen3-coder:free"
      ];

      let stream = null;
      let errorMsg = "";

      for (const modelName of modelsToTry) {
        try {
          console.log(`[AI] Đang thử model: ${modelName}`);
          stream = await openrouter.chat.send({
            chatRequest: {
              model: modelName,
              temperature: 0.3,
              max_tokens: 3000,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: promptData }
              ],
              stream: true
            }
          });
          console.log(`[AI] Thành công với model: ${modelName}`);
          break;
        } catch (e) {
          console.warn(`[AI] Thất bại với model ${modelName}:`, e.message);
          errorMsg = e.message;
        }
      }

      if (!stream) {
        throw new Error(errorMsg || "Tất cả các model miễn phí đều lỗi.");
      }


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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ color: 'var(--text-slate-500)', textAlign: 'center', marginTop: '100px' }}>
            Nhấn "TẠO BÁO CÁO AI" để AI (Gemma) tổng hợp và phân tích dữ liệu thị trường hiện tại.
            <br/><br/>
            (Yêu cầu cung cấp OpenRouter API Key trong Cài đặt)
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
          📊 DỮ LIỆU MẢNG CVD LỊCH SỬ (7D &amp; 30D)
        </h4>
        <p className="text-xs text-slate-400 font-mono" style={{ margin: 0, lineHeight: 1.4 }}>
          Dữ liệu này được tự động đính kèm vào Input của AI để phân tích xu hướng. Bạn cũng có thể copy thủ công mảng dưới đây để sử dụng riêng.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div className="font-mono text-slate-400" style={{ fontSize: '0.62rem', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
              <span>MẢNG CVD 7 NGÀY (Khung 4h, {data.cvdHistory7d?.length || 0} điểm)</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data.cvdHistory7d?.map(c => c.cvd) || []));
                  alert("Đã copy mảng CVD 7d!");
                }}
                className="text-emerald hover:underline"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}
              >
                Copy mảng CVD
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
              <span>MẢNG CVD 30 NGÀY (Khung 1d, {data.cvdHistory30d?.length || 0} điểm)</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(data.cvdHistory30d?.map(c => c.cvd) || []));
                  alert("Đã copy mảng CVD 30d!");
                }}
                className="text-emerald hover:underline"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}
              >
                Copy mảng CVD
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
