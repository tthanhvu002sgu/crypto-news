import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfessionalReportLayout } from './summaryReportLayout.js';

test('places charts beside their matching professional-report analysis block', () => {
  const report = `### 1. PHẦN A: PHÂN TÍCH VĨ MÔ & DÒNG TIỀN TỔ CHỨC
Mở đầu phần A.
- **Vĩ mô & Real Yield Proxy:** Phân tích thanh khoản.
- **Dòng tiền Tổ chức (ETF & CME COT):** Phân tích flow.

### 2. PHẦN B: ON-CHAIN & PHÁI SINH
- **Định giá On-Chain:** MVRV và NUPL.
- **Phái sinh & Vi cấu trúc:** Open Interest và Funding.

### 3. MA TRẬN ĐỐI CHIẾU
- **Giá vs CVD / OBI:** Phân kỳ dòng lệnh.`;

  const blocks = buildProfessionalReportLayout(report);
  const chartAnchor = (chart) => blocks.find((block) => block.charts.includes(chart))?.anchor;

  assert.match(chartAnchor('macro'), /Vĩ mô/);
  assert.match(chartAnchor('etf'), /Dòng tiền Tổ chức/);
  assert.match(chartAnchor('cot'), /Dòng tiền Tổ chức/);
  assert.match(chartAnchor('onchain'), /On-Chain/);
  assert.match(chartAnchor('oi'), /Phái sinh/);
  assert.match(chartAnchor('cvd'), /Giá vs CVD/);
});

test('never duplicates a chart when a topic is mentioned in several sections', () => {
  const report = `### 1. Macro & institutional liquidity
- **Macro & real-rate proxy:** Macro evidence.
- **Institutional flows (ETF & CME COT):** Flow evidence.
### 2. Cross-examination
- **Spot ETF vs Derivatives / CME COT:** Conflict evidence.`;

  const blocks = buildProfessionalReportLayout(report);
  const charts = blocks.flatMap((block) => block.charts);
  assert.equal(charts.length, new Set(charts).size);
  assert.equal(charts.filter((chart) => chart === 'etf').length, 1);
  assert.equal(charts.filter((chart) => chart === 'cot').length, 1);
});

test('places liquidation chart in the cross-examination block and options chart in the scenario block', () => {
  const report = `### 3. SIGNAL CROSS-EXAMINATION & CONFLICT RESOLUTION
- **Price vs CVD / OBI:** Taker flow divergence.
- **Liquidation Flow vs Price / CVD:** Forced flow vs demand.

### 4. SCENARIO MATRIX & ACTIVATION TRIGGERS
| Scenario | Weight (%) | Activation Trigger | Confirming Evidence | Invalidation Level | Expected Route |
| Base Case | 55 | Trigger | Evidence | Level | Route |

- **Options Positioning Walls:** Call Wall $120k, Put Wall $100k, Max Pain $110k.`;

  const blocks = buildProfessionalReportLayout(report);
  const chartAnchor = (chart) => blocks.find((block) => block.charts.includes(chart))?.anchor;

  assert.match(chartAnchor('liq'), /Liquidation/i);
  assert.match(chartAnchor('options'), /Options Positioning Walls/i);

  const charts = blocks.flatMap((block) => block.charts);
  assert.equal(charts.length, new Set(charts).size);
  assert.equal(charts.filter((chart) => chart === 'cvd').length, 1);
});

test('places charts accurately with H2 section and H3 subsection hierarchy', () => {
  const report = `## 1. GLOBAL MACRO & INSTITUTIONAL LIQUIDITY ANALYSIS
Executive overview of macro and institutional flows.

### 1.1. Macro & Real-Rate Proxy
- Ex-post real rate proxy and liquidity.

### 1.2. Institutional Flows (ETF & CME COT)
- Spot ETF flow persistence and CME positioning.

## 2. TECHNICAL, ON-CHAIN & DERIVATIVES MICROSTRUCTURE ANALYSIS
### 2.1. Technical Structure
- Multi-timeframe trend.

### 2.2. On-Chain Valuation
- BTC Production cost and MVRV ratio.

### 2.3. Derivatives & Microstructure
- Open interest and funding rates.

## 3. SIGNAL CROSS-EXAMINATION & CONFLICT RESOLUTION
### 3.1. Price vs CVD / OBI
- Taker flow divergence.

### 3.2. Liquidation Flow vs Price / CVD
- Liquidation cascade analysis.

## 4. SCENARIO MATRIX & ACTIVATION TRIGGERS
| Scenario | Weight (%) | Trigger |
| Base | 60 | $90k |
### 4.1. Options Positioning Walls
- Call wall and gamma regime.`;

  const blocks = buildProfessionalReportLayout(report);
  const chartAnchor = (chart) => blocks.find((block) => block.charts.includes(chart))?.anchor;

  assert.match(chartAnchor('macro'), /1\.1\. Macro & Real-Rate Proxy/);
  assert.match(chartAnchor('etf'), /1\.2\. Institutional Flows/);
  assert.match(chartAnchor('cot'), /1\.2\. Institutional Flows/);
  assert.match(chartAnchor('onchain'), /2\.2\. On-Chain Valuation/);
  assert.match(chartAnchor('oi'), /2\.3\. Derivatives & Microstructure/);
  assert.match(chartAnchor('cvd'), /3\.1\. Price vs CVD/);
  assert.match(chartAnchor('liq'), /3\.2\. Liquidation Flow/);
  assert.match(chartAnchor('options'), /4\.1\. Options Positioning Walls/);
});

test('places charts accurately in Vietnamese long-term Spot Investment Committee layout', () => {
  const report = `## 1. BỐI CẢNH VĨ MÔ & DÒNG TIỀN TỔ CHỨC
### 1.1. Vĩ mô & Lãi suất thực
- Thanh khoản ròng và lãi suất thực.

### 1.2. Dòng tiền tổ chức (ETF & CME COT)
- Dòng tiền ETF và vị thế CME COT.

## 2. PHÂN TÍCH KỸ THUẬT, ON-CHAIN & PHÁI SINH
### 2.1. Cấu trúc kỹ thuật & Hành động giá
- Xu hướng đa khung.

### 2.2. Định giá On-Chain
- MVRV, NUPL và Production Cost.

### 2.3. Phái sinh & Vi cấu trúc
- Open Interest, Funding Rate.

## 3. ĐỐI CHIẾU TÍN HIỆU & XỬ LÝ XUNG ĐỘT DỮ LIỆU
### 3.1. Giá vs CVD / OBI
- Đối chiếu giá và CVD.

### 3.2. Dòng thanh lý (Liquidations) vs Giá / CVD
- Thanh lý cưỡng bức.

### 3.4. Tín hiệu chi phối (Dominant Driver)
- Động lực tích lũy Spot trung-dài hạn.

## 4. MA TRẬN KỊCH BẢN & ĐIỀU KIỆN KÍCH HOẠT
| Kịch bản đầu tư Spot | Trọng số (%) | Kế hoạch gom Spot / Vùng giá mục tiêu |
| Kịch bản cơ sở (Base Case — Tích lũy & Hấp thụ) | 50 | DCA theo đợt |
### 4.1. Tường định vị Options
- Call Wall, Put Wall và Max Pain hỗ trợ timing giải ngân Spot.

## 5. KHUYẾN NGHỊ HÀNH ĐỘNG & BẢN ĐỒ CHIẾN LƯỢC ĐA KHUNG THỜI GIAN
| Khung đầu tư Spot | Trạng thái chu kỳ | Khuyến nghị hành động Spot |
| Ngắn hạn (1-4 tuần: Timing giải ngân / Chờ nhịp rũ) | Tích lũy | DCA CÓ ĐIỀU KIỆN |
| Trung hạn (1-3 tháng: Tích lũy theo dòng tiền ETF / Vĩ mô) | Tích lũy | TÍCH LŨY MẠNH |
| Dài hạn (3-12 tháng+: Nắm giữ theo chu kỳ On-chain MVRV / Chi phí đào) | Chu kỳ tăng | NẮM GIỮ & QUAN SÁT |`;

  const blocks = buildProfessionalReportLayout(report);
  const chartAnchor = (chart) => blocks.find((block) => block.charts.includes(chart))?.anchor;

  assert.match(chartAnchor('macro'), /1\.1\. Vĩ mô & Lãi suất thực/);
  assert.match(chartAnchor('etf'), /1\.2\. Dòng tiền tổ chức/);
  assert.match(chartAnchor('cot'), /1\.2\. Dòng tiền tổ chức/);
  assert.match(chartAnchor('onchain'), /2\.2\. Định giá On-Chain/);
  assert.match(chartAnchor('oi'), /2\.3\. Phái sinh & Vi cấu trúc/);
  assert.match(chartAnchor('cvd'), /3\.1\. Giá vs CVD/);
  assert.match(chartAnchor('liq'), /3\.2\. Dòng thanh lý/);
  assert.match(chartAnchor('options'), /4\.1\. Tường định vị Options/);

  const charts = blocks.flatMap((block) => block.charts);
  assert.equal(charts.length, new Set(charts).size);
});


test('skips Executive Summary (Section 0) for charts and anchors options chart inside Section 2.3 in table-free layout', () => {
  const report = `## 0. TÓM TẮT ĐIỀU HÀNH (EXECUTIVE SUMMARY)
- **Giá BTC hiện tại:** $57,056 | Vĩ mô thắt chặt, ETF rút vốn, Options gamma âm.

## 1. BỐI CẢNH VĨ MÔ, TÁC NHÂN BIẾN ĐỘNG & DÒNG TIỀN TỔ CHỨC
### 1.1. Vĩ mô, Lãi suất thực & Tác nhân biến động (Catalysts)
- Lãi suất thực ước tính +0.30%, VIX 35.89.
### 1.2. Dòng tiền tổ chức (Spot ETF & CME COT)
- Spot ETF rút ròng -$1,303.4 triệu; CME COT Leveraged Funds đóng vị thế Short.

## 2. CẤU TRÚC KỸ THUẬT, ĐỊNH GIÁ ON-CHAIN & PHÁI SINH BTC
### 2.1. Cấu trúc kỹ thuật & Các mốc khung lớn (HTF)
- Giá dưới MA50 và MA200.
### 2.2. Định giá On-Chain BTC
- MVRV 1.16, Giá thực tế suy dẫn $49,186.
### 2.3. Phái sinh, Định vị Options & Vi cấu trúc
- **Đòn bẩy & Chênh lệch kỳ hạn:** Open Interest 95,431 BTC.
- **Định vị quyền chọn Deribit Options & Kỳ đáo hạn:** Call Wall $80,000, Put Wall $40,000, GEX flip $59,494.

## 3. ĐỐI CHIẾU TÍN HIỆU & XỬ LÝ XUNG ĐỘT DỮ LIỆU
### 3.1. Giá vs CVD / OBI
- Binance Spot CVD và Futures CVD đồng thuận giảm.
### 3.2. Dòng thanh lý vs Giá / CVD
- Thanh lý Long 1h đạt $52.9 triệu.

## 4. KỊCH BẢN ĐẦU TƯ SPOT & ĐIỀU KIỆN KÍCH HOẠT
- **Kịch bản cơ sở (Base Case) — 50%:** Chờ chiết khấu về $49,500 - $53,500.`;

  const blocks = buildProfessionalReportLayout(report);
  const execSummaryBlock = blocks.find((b) => /0\. TÓM TẮT ĐIỀU HÀNH/.test(b.anchor));
  assert.ok(execSummaryBlock, 'Executive Summary block should exist');
  assert.equal(execSummaryBlock.charts.length, 0, 'Executive Summary must not capture evidence charts');

  const chartAnchor = (chart) => blocks.find((block) => block.charts.includes(chart))?.anchor;
  assert.match(chartAnchor('macro'), /1\.1\. Vĩ mô/);
  assert.match(chartAnchor('etf'), /1\.2\. Dòng tiền tổ chức/);
  assert.match(chartAnchor('cot'), /1\.2\. Dòng tiền tổ chức/);
  assert.match(chartAnchor('onchain'), /2\.2\. Định giá On-Chain/);
  assert.match(chartAnchor('options'), /Deribit Options/);
  assert.match(chartAnchor('cvd'), /3\.1\. Giá vs CVD/);
  assert.match(chartAnchor('liq'), /3\.2\. Dòng thanh lý/);
});

test('never leaks COT, On-chain, ETF, Macro, or Liq charts into Sections 0, 4, 5, 6 in full Vietnamese canonical report', () => {
  const report = `## 0. TÓM TẮT ĐIỀU HÀNH (EXECUTIVE SUMMARY)
- **Dòng tiền tổ chức & Định giá On-chain:** ETF rút vốn, MVRV 1.1, rủi ro thanh lý ngắn hạn.

## 1. BỐI CẢNH VĨ MÔ, TÁC NHÂN BIẾN ĐỘNG & DÒNG TIỀN TỔ CHỨC
### 1.1. Vĩ mô, Lãi suất thực & Tác nhân biến động (Catalysts)
- Lãi suất thực +0.30%, DXY 104, VIX 22.
- **Tác nhân gây biến động & Lịch sự kiện 1-2 tuần tới:** FOMC và CPI.
### 1.2. Dòng tiền tổ chức (Spot ETF & CME COT)
- **Độ bền dòng tiền BTC Spot ETF:** Rút ròng -$450M trong 7 phiên.
- **Vị thế CME COT (trễ 3-7 ngày):** Asset Manager Net Long, Leveraged Funds đóng Short.

## 2. CẤU TRÚC KỸ THUẬT, ĐỊNH GIÁ ON-CHAIN & PHÁI SINH BTC
### 2.1. Cấu trúc kỹ thuật & Các mốc khung lớn (HTF)
- Giá dưới MA50 và MA200.
### 2.2. Định giá On-Chain BTC
- **MVRV & Giá thực tế suy dẫn:** MVRV 1.1, NUPL 0.09.
- **Chi phí khai thác & Stablecoin:** BTC Price tiệm cận vùng Production Cost.
### 2.3. Phái sinh, Định vị Options & Vi cấu trúc
- **Đòn bẩy & Chênh lệch kỳ hạn:** Open Interest 95,431 BTC, Funding 0.01%.
- **Dòng lệnh thực thi & Thanh lý:** Spot CVD giảm, thanh lý Long 1h.
- **Định vị quyền chọn Deribit Options & Kỳ đáo hạn:** Call Wall $80k, Put Wall $50k, Max Pain $62k.

## 3. ĐỐI CHIẾU TÍN HIỆU & XỬ LÝ XUNG ĐỘT DỮ LIỆU
### 3.1. Giá vs CVD / OBI
- Đối chiếu giá với Binance Spot CVD và Futures CVD.
### 3.2. Dòng thanh lý vs Giá / CVD
- Thanh lý cưỡng bức so với dòng lệnh chủ động.
### 3.3. Spot ETF vs Phái sinh / CME COT
- **Spot ETF vs CME COT:** Tổ chức thận trọng hơn bán lẻ.
### 3.4. Tín hiệu chi phối (Dominant Driver)
- Động lực trung dài hạn.

## 4. KỊCH BẢN ĐẦU TƯ SPOT & ĐIỀU KIỆN KÍCH HOẠT
- **Kịch bản cơ sở (Base Case) — 50%:**
  - **Bằng chứng xác nhận (Spot CVD / ETF):** Chờ ETF dương trở lại.

## 5. KHUYẾN NGHỊ HÀNH ĐỘNG & BẢN ĐỒ CHIẾN LƯỢC ĐA KHUNG
- **Luận điểm đầu tư Spot cốt lõi:** Thị trường rũ bỏ đòn bẩy tiệm cận chi phí khai thác.
- **Phản biện mạnh nhất / Rủi ro cấu trúc:** Dòng tiền rút ròng ETF kéo dài.
- **Điểm trụ cột (-2..+2):** Vĩ mô [-2] · Spot [-2] · Dòng tiền tổ chức [-2] · On-chain [+1] · Phái sinh [-1] · Vi cấu trúc [-2] → Tổng -8/12.
- **Khung Ngắn hạn (1-4 tuần — Căn thời điểm giải ngân / Chờ nhịp rũ):**
  - **Trạng thái & Phán quyết:** CHỜ CHIẾT KHẤU SÂU
- **Khung Trung hạn (1-3 tháng — Tích lũy theo dòng tiền ETF / Vĩ mô):**
  - **Trạng thái & Phán quyết:** DCA CÓ ĐIỀU KIỆN
- **Khung Dài hạn (3-12 tháng+ — Nắm giữ theo chu kỳ On-chain BTC):**
  - **Trạng thái & Phán quyết:** NẮM GIỮ & QUAN SÁT

## 6. NHẬN ĐỊNH PHI ĐỒNG THUẬN & KẾ HOẠCH PHÂN BỔ VỐN SPOT
### 6.1. Nhận định phi đồng thuận (Asymmetric Insights)
- Quan sát phi đồng thuận.
### 6.2. Kế hoạch giải ngân theo đợt & Quản trị rủi ro Spot
- **Kỷ luật tối ưu giá vốn (Anti-FOMO):** Tận dụng nhịp quét thanh lý Long và Spot CVD.`;

  const blocks = buildProfessionalReportLayout(report);
  const blockForChart = (chart) => blocks.find((b) => b.charts.includes(chart));

  assert.match(blockForChart('macro').anchor, /1\.1\. Vĩ mô/);
  assert.match(blockForChart('etf').anchor, /Độ bền dòng tiền BTC Spot ETF/);
  assert.match(blockForChart('cot').anchor, /Vị thế CME COT/);
  assert.match(blockForChart('onchain').anchor, /2\.2\. Định giá On-Chain/);
  assert.match(blockForChart('oi').anchor, /Đòn bẩy & Chênh lệch kỳ hạn/);
  assert.match(blockForChart('oi').subsectionAnchor, /2\.3\. Phái sinh/);
  assert.match(blockForChart('options').anchor, /Deribit Options/);
  assert.match(blockForChart('cvd').anchor, /3\.1\. Giá vs CVD/);
  assert.match(blockForChart('liq').anchor, /3\.2\. Dòng thanh lý/);

  // Ensure Sections 0, 4, 5, 6 and 3.3 have zero charts
  const forbiddenSections = /(?:^0\.|^3\.3\.|^4\.|^5\.|^6\.)/;
  blocks.forEach((b) => {
    const sec = b.sectionAnchor || b.subsectionAnchor || b.anchor;
    if (forbiddenSections.test(sec) || /^3\.3\./.test(b.subsectionAnchor || b.anchor)) {
      assert.equal(b.charts.length, 0, `Expected no charts in "${sec}" (block "${b.anchor}"), got: ${b.charts.join(', ')}`);
    }
  });
});

test('places all 8 charts accurately in English canonical report without leaking into Sections 0, 3.3, 4, 5, 6', () => {
  const report = `## 0. EXECUTIVE SUMMARY
- **Institutional Flow & On-Chain Valuation:** ETF outflows, MVRV 1.1, liquidation risk.

## 1. GLOBAL MACRO, CATALYSTS & INSTITUTIONAL FLOWS
### 1.1. Macro Liquidity, Real-Rate Proxy & Volatility Catalysts
- Real rate +0.3%, DXY 104, VIX 22.
### 1.2. Institutional Flows (Spot ETF & CME COT)
- **BTC Spot ETF Flow Persistence:** -$450M net outflow over 7 sessions.
- **CME COT Positioning (3-7 day lag):** Asset Managers Net Long, Leveraged Funds covering shorts.

## 2. BTC TECHNICAL STRUCTURE, ON-CHAIN VALUATION & DERIVATIVES
### 2.1. Technical Structure & HTF Anchors
- Below MA50 and MA200.
### 2.2. BTC On-Chain Valuation
- **MVRV & Implied Realized Price:** MVRV 1.1, NUPL 0.09.
- **Miner Production Cost & Stablecoins:** Spot near production cost.
### 2.3. Derivatives, Options Positioning & Microstructure
- **Leverage & Basis:** Open Interest 95k BTC, Funding 0.01%.
- **Executed Flow & Liquidations:** Spot CVD negative, Long liquidations elevated.
- **Deribit Options Positioning & Expiry Context:** Call Wall $80k, Put Wall $50k, Max Pain $62k.

## 3. SIGNAL CROSS-EXAMINATION & CONFLICT RESOLUTION
### 3.1. Price vs CVD / OBI
- Price vs Binance Spot CVD and Futures CVD.
### 3.2. Liquidation Flow vs Price / CVD
- Forced liquidations vs price response.
### 3.3. Spot ETF vs Derivatives / CME COT
- Institutional Spot ETF flows vs CME COT and retail leverage.

## 4. SPOT INVESTMENT SCENARIOS & ACTIVATION TRIGGERS
- **Base Case — 50%:**
  - **Confirming Evidence:** Spot CVD and ETF stabilization.

## 5. EXECUTIVE DECISION & MULTI-HORIZON SPOT PLAYBOOK
- **Medium-Term Horizon (1-3 months — ETF Flow & Macro Accumulation):**
  - **Regime & Verdict:** CONDITIONAL DCA
- **Long-Term Horizon (3-12+ months — On-Chain Cycle Holding):**
  - **Regime & Verdict:** HOLD & MONITOR

## 6. ASYMMETRIC INSIGHTS & STAGED SPOT ACCUMULATION PLAN
### 6.2. Staged Spot Accumulation & Risk Management Plan
- **Microstructure Anti-FOMO Execution:** Wait for liquidation flushes and Spot CVD absorption.`;

  const blocks = buildProfessionalReportLayout(report);
  const blockForChart = (chart) => blocks.find((b) => b.charts.includes(chart));

  assert.match(blockForChart('macro').anchor, /1\.1\. Macro Liquidity/);
  assert.match(blockForChart('etf').anchor, /BTC Spot ETF Flow Persistence/);
  assert.match(blockForChart('cot').anchor, /CME COT Positioning/);
  assert.match(blockForChart('onchain').anchor, /2\.2\. BTC On-Chain Valuation/);
  assert.match(blockForChart('oi').anchor, /Leverage & Basis/);
  assert.match(blockForChart('options').anchor, /Deribit Options Positioning/);
  assert.match(blockForChart('cvd').anchor, /3\.1\. Price vs CVD/);
  assert.match(blockForChart('liq').anchor, /3\.2\. Liquidation Flow/);

  const charts = blocks.flatMap((b) => b.charts);
  assert.equal(charts.length, 8);
  assert.equal(new Set(charts).size, 8);
});
