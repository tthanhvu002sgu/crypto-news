# Crypto News & HFT Dashboard

## 1. Tổng quan các tính năng (Features Overview)
Dự án là một Dashboard tổng hợp dữ liệu On-chain, Phân tích kỹ thuật (Technical Analysis), Phân tích vĩ mô (Macroeconomics) và Phân tích dòng tiền tần suất cao (High-Frequency Trading - HFT) cho thị trường Crypto (chủ yếu là BTC, ETH, SOL).

**Các tính năng cốt lõi:**
- **Lịch Kinh Tế Vĩ Mô 7 Ngày (7-Day Economic Calendar):** Hiển thị lịch sự kiện vĩ mô toàn cầu (CPI, FOMC, NFP, GDP, PMI...) dưới dạng bento grid 7 ô vuông tương ứng 7 ngày trong tuần. Tích hợp Modal phân tích chuyên sâu **tác động của từng sự kiện đến thanh khoản Bitcoin & Crypto** với dữ liệu thời gian thực và curated fallback.
- **Market Bias Engine (Công Thức Bias Total):** Định lượng chỉ số xu hướng BTC tổng hợp từ 4 trụ cột (-100 đến +100): *Microstructure (35%)*, *On-Chain (25%)*, *Institutional Flows (20%)*, *Macro & Risk Shock (20%)*. Tích hợp thanh thước đo Spectrum Gauge Bar và bảng bento bẻ nhỏ 10+ tín hiệu định lượng thành phần.
- **Thống kê ETF & Cấu trúc dòng tiền:** Biểu đồ dòng tiền (Inflow/Outflow) của các quỹ ETF Bitcoin, Ethereum, Solana.
- **HFT Radar (Phân tích dòng tiền Phái sinh):**
  - **CVD & Order Flow:** Theo dõi Cumulative Volume Delta realtime và phân cụm Footprint Volume (nhóm lệnh theo Gap giá).
  - **Live Whale Trades:** Phát hiện các lệnh Market lớn (trên $100k) theo thời gian thực.
  - **Advanced Price Action:** Biểu đồ TradingView tích hợp Volume Profile (POC, VAH, VAL), Limit Walls (Tường thanh khoản) và Liquidity Zones (Vùng thanh lý đòn bẩy).
  - **Order Book Imbalance (OBI):** Quét độ sâu sổ lệnh (Depth) từ nhiều sàn (Binance, Bybit, OKX, Bitget) để phân tích chênh lệch áp lực Mua/Bán (Bid/Ask Limit Walls).
- **AI Market Decision Lab:** Tích hợp Gemini để kiểm định giả thuyết vĩ mô/on-chain/flow/phái sinh/HFT, phân biệt quan sát với suy luận, phản biện narrative, chấm chất lượng bằng chứng và tạo playbook quyết định có trigger/invalidation. Hỗ trợ **Tiếng Việt / English** và 3 chế độ: Investment Committee / Skeptical Execution Desk / Socratic Market Mentor.
- **BTC Production Cost (range):** Ước tính chi phí khai thác 1 BTC mới dưới dạng **khoảng low → high** quanh baseline energy model (26 J/TH @ $0.05 + 10% opex), biên sai số **−5% / +10%**.
- **Cascade View:** Bảng theo dõi các chỉ số thanh lý (Liquidations), Long/Short Ratio, Funding Rate, Open Interest đa khung thời gian.

## 2. Kiến trúc hệ thống (System Architecture)
- **Frontend Framework:** React.js (Vite).
- **Thiết kế UI/UX System:** **Minimalist-UI Protocol** (Editorial typography, High-contrast monospace, Bento Grid 1px borders, zero emojis, adaptive Light/Dark Theme).
- **Biểu đồ (Charting):** `lightweight-charts` (nến / profile), `chart.js` & `react-chartjs-2` (ETF, CVD, macro, spectrum meter).
- **Quản lý trạng thái:** React Hooks + Context (`ModuleVisibilityContext`, tooltip settings).
- **Nguồn dữ liệu:**
  - **REST API:** Binance, FairEconomy/ForexFactory (weekly calendar), CoinGecko, FRED, CoinMetrics, ETF/COT scrapers, news RSS, Yahoo/FRED equities.
  - **WebSocket:** Binance multi-ticker + `markPrice` + `aggTrade` (CVD / footprint / whale).
- **Đồng bộ REST theo tầng (tiered sync):**
  - **HOT** mỗi 5 phút — Binance REST (ticker/klines/L-S/funding/OI), TTL cache 2–5 phút.
  - **WARM** mỗi 15 phút — global mcap, stablecoin, news, equities/yields, CVD 24h/7d, Economic Calendar.
  - **COLD** mỗi 60 phút — FRED macro, on-chain, ETF, COT, Fear&Greed, CVD 30d, daily klines (TTL 2–12h).
  - Nút **SYNC NGAY** / auto 08:00 = full force (bỏ qua cache).
- **Lưu trữ cục bộ & Persistence:** `localStorage` + `IndexedDB` (theme, API keys, module visibility, signal logs persistence, HFT session CVD/nodes/whales).

## 3. Các thành phần chính (Components)
### Giao diện / Bố cục (UI/Layout)
- `App.jsx`: Component gốc quản lý Routing/Tabs (Dashboard, HFT Radar, Cascade, AI Market Decision Lab) và WebSocket manager.
- `DashboardTab.jsx`: Layout chính hiển thị Market Bias Engine, Economic Calendar, Macro Pulse, Polymarket Whales Tracker, L/S & OI charts, ETF Flows.
- `EconomicCalendarPanel.jsx`: Component Lịch kinh tế 7 ngày trong tuần với 7 ô bento card (nằm trên 1 hàng PC, scroll ngang Mobile), Modal phân tích tác động Crypto và bộ lọc Nhanh (ALL / HIGH / USD / CRYPTO).
- `MarketBiasCard.jsx`: Component định lượng xu hướng BTC với thanh Gauge Spectrum, 4 bento card trụ cột và drawer bẻ nhỏ 10+ tín hiệu định lượng.
- `ModuleMenu.jsx`: Menu điều khiển bật/tắt (ẩn/hiện) các thẻ chức năng (widgets).

### Dịch vụ / Utils (Services & Helpers)
- `services/economicCalendarService.js` — Fetch lịch kinh tế tuần từ FairEconomy JSON, phân tích tác động Crypto và fallback curated schedule.
- `services/biasEngine.js` — Tính toán điểm xu hướng BTC (-100 đến +100) dựa trên 4 trụ cột định lượng.
- `services/signalStore.js` — Lưu trữ Signal Log kết hợp IndexedDB + localStorage persistence chống mất dữ liệu khi F5.
- `services/api.js` — REST multi-source (Binance, FRED, ETF, COT, …).
- `services/websocket.js` — `useBinanceWebSocket` + `useCVDStream`.
- `config/syncConfig.js` — TTL cache + interval HOT/WARM/COLD.

## 4. Các Task đã làm (Completed Tasks)

### [2026-07-28] Tải & Xây dựng Lịch Kinh Tế Vĩ Mô 7 Ngày & Redesign Market Bias Minimalist `(FULL)`
- **Lane / Mode:** FEATURE FULL & STYLING
- **Tóm tắt:** Xây dựng mới Lịch kinh tế vĩ mô 7 ngày trong tuần trên Dashboard, tái thiết kế Market Bias Engine chuẩn Minimalist-UI, tối ưu persistence Signal Log và tương thích hoàn hảo Light/Dark Theme.
- **Thay đổi chính:**
  - **Lịch Kinh Tế 7 Ngày (`EconomicCalendarPanel.jsx`):** Bố cục bento 7 ô vuông đại diện cho 7 ngày trong tuần (cố định 1 hàng trên PC, scroll ngang trên Mobile), tự động đánh dấu `TODAY`. Modal mở rộng hiển thị bảng Actual vs Forecast và phân tích tác động chuyên sâu đến Bitcoin & Crypto.
  - **Market Bias Redesign (`MarketBiasCard.jsx`):** Thay thế thanh đo cũ bằng **Spectrum Gauge Meter** với kim chỉ Pin chuyển động dynamic; chia 4 trụ cột thành 4 bento card có progress bar và status badge (`MẠNH`, `TÍCH CỰC`, `TRUNG LẬP`, `TIÊU CỰC`, `YẾU`).
  - **Quy chuẩn Minimalist-UI:** Loại bỏ 100% các emoji rác (`⚪`, `🚀`, `🟢`, `💥`, `🔴`), chuyển font chữ metadata về Monospace, sử dụng viền mỏng crisp borders và biến CSS adaptive cho cả Light Mode & Dark Mode.
  - **Dữ liệu & Persistence (`economicCalendarService.js` & `signalStore.js`):** Tự động fetch dữ liệu ForexFactory thời gian thực với cơ chế Curated Fallback; lưu trữ Signal Logs chống mất dữ liệu khi reload F5 và giảm latency snapshot giá BTC xuống 3s.
- **Files / areas chạm:** `src/components/EconomicCalendarPanel.jsx`, `src/services/economicCalendarService.js`, `src/components/MarketBiasCard.jsx`, `src/services/biasEngine.js`, `src/components/DashboardTab.jsx`, `src/context/ModuleVisibilityContext.jsx`, `src/services/signalStore.js`, `README.md`
- **Ảnh hưởng README:** §1, §2, §3, §4
- **Verify:** `npm run build` pass (1.46s, 0 errors); git pushed.

### [2026-07-16] Sửa CPI index bị dùng nhầm thành lạm phát YoY `(FIX)`
- **Lane / Mode:** FIX
- **Tóm tắt:** Sửa lỗi `CPIAUCSL = 332.57` (index 1982–1984=100) bị gắn `%` và trừ trực tiếp khỏi Fed Funds.
- **Files / areas chạm:** `src/services/api.js`, `src/App.jsx`, `src/components/SummaryTab.jsx`, `src/components/DashboardTab.jsx`, `README.md`

### [2026-07-16] Nâng AI Summary thành Market Decision Lab `(FULL)`
- **Lane / Mode:** FEATURE FULL
- **Tóm tắt:** Viết lại toàn bộ system prompt theo phong cách chuyên gia buy-side hoài nghi; thêm evidence taxonomy và 3 chế độ phân tích.
- **Files / areas chạm:** `src/services/aiPrompts.js`, `src/components/SummaryTab.jsx`, `README.md`

---

- [x] Gộp module `TargetLiquidityPanel` vào bên trong 100% diện tích của `AdvancedChart`.
- [x] Mở rộng `OrderBookPanel` (OBI) và đưa `WhaleTradesPanel` lên cùng một hàng lưới.
- [x] Tích hợp tính năng Volume Footprint (Nodes) cho thẻ CVD & Order Flow, kèm thanh trượt chọn mức Gap ($10-$1000).
- [x] Tích hợp tính năng TPO Profile (Time Price Opportunity) vào Advanced Chart với cấu hình 30 phút.
- [x] Rà soát và tái cấu trúc Data Layer (WebSocket): Xây dựng cơ chế **Persistence Storage** cho dữ liệu Footprint Nodes, CVD History và Whale Trades.
- [x] Xây dựng Lịch kinh tế vĩ mô 7 ngày trong tuần trên Dashboard (`EconomicCalendarPanel.jsx`).
- [x] Redesign Market Bias Engine chuẩn Minimalist-UI với thanh Spectrum Gauge và 4 bento pillar cards.

## 5. Các Task chưa làm (Pending/TODO Tasks)
- [ ] Code-split bundle JS (>500kB warning sau build)
- [ ] (Tuỳ chọn) Pause/giảm poll HFT orderbook khi tab ẩn (`document.visibilityState`)

---
*Ghi chú: Mọi update từ nay về sau bắt buộc phải ghi log lại vào file này.*
