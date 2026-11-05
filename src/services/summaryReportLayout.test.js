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
