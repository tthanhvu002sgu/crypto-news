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
