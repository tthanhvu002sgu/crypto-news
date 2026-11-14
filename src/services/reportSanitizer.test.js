import { describe, it } from 'node:test';
import assert from 'node:assert';
import { cleanReportMarkdown } from './reportSanitizer.js';

describe('reportSanitizer & cleanReportMarkdown', () => {
  it('1. Truncates raw pre-text, persona monologue, and input bullets before official Heading 1', () => {
    const rawMonologue = `Buy-side Crypto Research Head. Global macro, liquidity, on-chain, institutional flows, derivatives, market microstructure. Disciplined skepticism, evidence-based, anti-hallucination, clear formatting. Vietnamese. No LaTeX, bold key metrics, specific Markdown list format, separate macro/technical/on-chain/derivatives, chronological analysis of price moves. 4 mandatory sections: (1) Move Forensics, (2) Trapped Liquidity Map, (3) Future Forecast/Scenarios, (4) Execution Playbook.

- Macro:
- Net Liquidity: $5,586.90B .
- Real Rate Proxy: +0.16% (Fed Funds 3.88% - CPI 3.72% ).
- Upcoming: FOMC Decision (04/11). Wait, the report date is 2026-11-07...

## 1. 💥 GIẢI PHẪU CÁC ĐỢT DI CHUYỂN GIÁ MẠNH (TOP 3 TRONG 24H & TOP 5 TRONG 7D)
### 1.1. Top 3 Biến Động Trong 24h
- Ngày 04/11 lúc 14:00 (GMT+7) -> Biên độ: -4.96% -> CVD Delta âm.`;

    const cleaned = cleanReportMarkdown(rawMonologue);
    assert.strictEqual(cleaned.includes('Buy-side Crypto Research Head'), false);
    assert.strictEqual(cleaned.includes('Net Liquidity: $5,586.90B'), false);
    assert.strictEqual(cleaned.includes('Wait, the report date is'), false);
    assert.strictEqual(cleaned.startsWith('## 1. 💥 GIẢI PHẪU CÁC ĐỢT DI CHUYỂN GIÁ MẠNH'), true);
  });

  it('2. Strips self-verification checklist items at the end of the report', () => {
    const rawReportWithChecklist = `## 4. 🎯 KẾ HOẠCH HÀNH ĐỘNG CHIẾN THUẬT (EXECUTION PLAYBOOK)
- **Chiến lược cho Swing:** CHỜ / KHÔNG VÀO LỆNH.

**TÍN HIỆU THEN CHỐT ĐẦU TIÊN BUỘC PHẢI THAY ĐỔI GÓC NHÌN:** Đóng nến 4h vượt $76,325.

- Check: No LaTeX? Yes.
- Check: Bold key metrics? Yes.
- Check: Chronological order with Date/Time? Yes.
- Check: Separate Spot/Futures CVD? Yes.
- Check: No hallucinated indicators (RSI/MACD)? Yes.
- Check: R:R > 1.8 for recommendations? Yes.`;

    const cleaned = cleanReportMarkdown(rawReportWithChecklist);
    assert.strictEqual(cleaned.includes('Check: No LaTeX?'), false);
    assert.strictEqual(cleaned.includes('Check: Bold key metrics?'), false);
    assert.strictEqual(cleaned.includes('Check: R:R > 1.8'), false);
    assert.strictEqual(cleaned.includes('TÍN HIỆU THEN CHỐT ĐẦU TIÊN BUỘC PHẢI THAY ĐỔI GÓC NHÌN'), true);
  });

  it('3. Fixes bullet hierarchy between group headers and nested content items', () => {
    const unindentedBullets = `## 2. 🗺️ BẢN ĐỒ VỊ THẾ BỊ KẸP & VÙNG BẪY THANH KHOẢN (TRAPPED LIQUIDITY MAP)
- Phe Long bị kẹp (Trapped Longs):
  - Vùng tập trung lớn nhất: $80,000 - $84,000. Đây là vùng đỉnh ngắn hạn.
    - Các vị thế Long mở trong nhịp Pump ngày 04/11.
    - Tỷ lệ L/S Account cực cao (3.097).
- Phe Short bị kẹp (Trapped Shorts):
- Vùng kẹp ngắn hạn: $75,700 - $76,500. Những người Short đuổi theo cú Dump.
- Điểm kích nổ Short Squeeze: Nếu giá đóng nến 4h trên $76,325.
- Bể thanh khoản & Tường lệnh (Liquidity Pools):
- Buy-side Liquidity: Tập trung dày đặc tại $80,000 và $84,000.
- Sell-side Liquidity: Vùng hỗ trợ tâm lý tại $74,800.
- Vi cấu trúc sổ lệnh: OBI tổng hợp +5.10%.`;

    const cleaned = cleanReportMarkdown(unindentedBullets);
    
    // Check that Phe Short group children are properly indented
    assert.strictEqual(cleaned.includes('  - **Vùng kẹp ngắn hạn:** $75,700'), true);
    assert.strictEqual(cleaned.includes('  - **Điểm kích nổ Short Squeeze:** Nếu giá'), true);

    // Check that Liquidity Pools group children are properly indented
    assert.strictEqual(cleaned.includes('  - **Buy-side Liquidity:** Tập trung'), true);
    assert.strictEqual(cleaned.includes('  - **Sell-side Liquidity:** Vùng hỗ trợ'), true);
    assert.strictEqual(cleaned.includes('  - **Vi cấu trúc sổ lệnh:** OBI tổng hợp'), true);
  });

  it('4. Preserves headings with hyphens in parentheses and handles embedded bullets', () => {
    // 4a. Standalone heading with hyphen inside parentheses
    const headingOnly = `### 1.2. Top 5 Biến Động Trong 7 Ngày (Khung 1h - Trình tự thời gian)\n- Đợt biến động #1 [Ngày 02/11/2026 lúc 21:00 (GMT+7)] (DUMP -1.07% | Quét râu: 1.90%):`;
    const cleaned4a = cleanReportMarkdown(headingOnly);
    assert.strictEqual(cleaned4a.includes('### 1.2. Top 5 Biến Động Trong 7 Ngày (Khung 1h - Trình tự thời gian)'), true);
    assert.strictEqual(cleaned4a.includes('### 1.2. Top 5 Biến Động Trong 7 Ngày (Khung 1h\n'), false);

    // 4b. Heading concatenated with bullet on same line without space or with space
    const inlineHeadingAndBullet = `### 1.2. Top 5 Biến Động Trong 7 Ngày (Khung 1h - Trình tự thời gian)- Đợt biến động #1 [Ngày 02/11/2026 lúc 21:00 (GMT+7)] (DUMP -1.07% | Quét râu: 1.90%):
- Biên độ giá: $77,904 -> $77,069 ( -1.07% ).`;
    const cleaned4b = cleanReportMarkdown(inlineHeadingAndBullet);
    assert.strictEqual(cleaned4b.includes('### 1.2. Top 5 Biến Động Trong 7 Ngày (Khung 1h - Trình tự thời gian)'), true);
    assert.strictEqual(cleaned4b.includes('Trình tự thời gian)-'), false);
    // Timestamp 21:00 must remain intact, not broken into lúc 21:** 00
    assert.strictEqual(cleaned4b.includes('21:00'), true);
    assert.strictEqual(cleaned4b.includes('21:** 00'), false);
    assert.strictEqual(cleaned4b.includes('lúc 21: 00'), false);
    // Child bullet must be properly indented under group header
    assert.strictEqual(cleaned4b.includes('  - **Biên độ giá:** $77,904'), true);
  });

  it('5. Keeps Base / Bullish / Bearish scenarios at the same root bullet level even if nested', () => {
    const nestedScenarios = `## 3. 🔮 DỰ PHÓNG TƯƠNG LAI & MA TRẬN KỊCH BẢN (BASE / BULL / BEAR)
- **Kịch Bản Cơ Sở — Base Case [55%]:**
  - **Luận điểm cốt lõi:** Cần hấp thụ lực cung.
  - **Mục Tiêu Giá (Targets):** T1: $71,200 | T2: $73,500.
  - **Kịch Bản Tăng Giá — Bullish Scenario [20%]:**
    - **Luận điểm:** Short Squeeze ngắn hạn.
    - **Mục Tiêu Giá (Targets):** T1: $73,500 | T2: $76,000.
    - **Kịch Bản Giảm Giá — Bearish Scenario [25%]:**
      - **Luận điểm:** Dòng tiền bán tháo tiếp tục chi phối.
      - **Mục Tiêu Giá (Targets):** T1: $66,000 | T2: $63,500.`;

    const cleaned = cleanReportMarkdown(nestedScenarios);
    assert.strictEqual(cleaned.includes('\n- **Kịch Bản Cơ Sở — Base Case [55%]:**'), true);
    assert.strictEqual(cleaned.includes('\n- **Kịch Bản Tăng Giá — Bullish Scenario [20%]:**'), true);
    assert.strictEqual(cleaned.includes('\n- **Kịch Bản Giảm Giá — Bearish Scenario [25%]:**'), true);
    assert.strictEqual(cleaned.includes('\n  - **Luận điểm:** Short Squeeze ngắn hạn.'), true);
    assert.strictEqual(cleaned.includes('\n  - **Luận điểm:** Dòng tiền bán tháo tiếp tục chi phối.'), true);
  });
});
