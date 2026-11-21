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
