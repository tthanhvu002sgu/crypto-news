# Crypto News & HFT Dashboard

## 1. Tổng quan các tính năng (Features Overview)
Dự án là một Dashboard tổng hợp dữ liệu On-chain, Phân tích kỹ thuật (Technical Analysis), và Phân tích dòng tiền tần suất cao (High-Frequency Trading - HFT) cho thị trường Crypto (chủ yếu là BTC, ETH, SOL).

**Các tính năng cốt lõi:**
- **Thống kê ETF & Cấu trúc dòng tiền:** Biểu đồ dòng tiền (Inflow/Outflow) của các quỹ ETF Bitcoin, Ethereum, Solana.
- **HFT Radar (Phân tích dòng tiền Phái sinh):**
  - **CVD & Order Flow:** Theo dõi Cumulative Volume Delta realtime và phân cụm Footprint Volume (nhóm lệnh theo Gap giá).
  - **Live Whale Trades:** Phát hiện các lệnh Market lớn (trên $100k) theo thời gian thực.
  - **Advanced Price Action:** Biểu đồ TradingView tích hợp Volume Profile (POC, VAH, VAL), Limit Walls (Tường thanh khoản) và Liquidity Zones (Vùng thanh lý đòn bẩy).
  - **Order Book Imbalance (OBI):** Quét độ sâu sổ lệnh (Depth) từ nhiều sàn (Binance, Bybit, OKX, Bitget) để phân tích chênh lệch áp lực Mua/Bán (Bid/Ask Limit Walls).
- **AI Summary & Nupl / Supply in Profit:** Tích hợp AI (Gemini) để phân tích báo cáo thị trường, tâm lý, cảnh báo các mốc kháng cự/hỗ trợ. Hỗ trợ chọn **ngôn ngữ báo cáo** (Tiếng Việt / English) và 3 style (Professional / Tactical / Educational).
- **Cascade View:** Bảng theo dõi các chỉ số thanh lý (Liquidations), Long/Short Ratio, Funding Rate, Open Interest đa khung thời gian.

## 2. Kiến trúc hệ thống (System Architecture)
- **Frontend Framework:** React.js (Vite).
- **Biểu đồ (Charting):** `lightweight-charts` (nến / profile), `chart.js` & `react-chartjs-2` (ETF, CVD, macro).
- **Quản lý trạng thái:** React Hooks + Context (`ModuleVisibilityContext`, tooltip settings).
- **Nguồn dữ liệu:**
  - **REST API:** Binance, CoinGecko, FRED, CoinMetrics, ETF/COT scrapers, news RSS, Yahoo/FRED equities.
  - **WebSocket:** Binance multi-ticker + `markPrice` + `aggTrade` (CVD / footprint / whale).
- **Đồng bộ REST theo tầng (tiered sync):**
  - **HOT** mỗi 5 phút — Binance REST (ticker/klines/L-S/funding/OI), TTL cache 2–5 phút.
  - **WARM** mỗi 15 phút — global mcap, stablecoin, news, equities/yields, CVD 24h/7d.
  - **COLD** mỗi 60 phút — FRED macro, on-chain, ETF, COT, Fear&Greed, CVD 30d, daily klines (TTL 2–12h).
  - Nút **SYNC NGAY** / auto 08:00 = full force (bỏ qua cache).
- **Giảm tải realtime:** WS ticker flush UI ~250ms; CVD/UI+localStorage ~500ms; favicon/title cập nhật **ngoài React** (canvas PNG + throttle).
- **Lưu trữ cục bộ:** `localStorage` (theme, API keys, module visibility, `cache_*` REST, HFT session CVD/nodes/whales).

## 3. Các thành phần chính (Components)
### Giao diện / Bố cục (UI/Layout)
- `App.jsx`: Component gốc quản lý Routing/Tabs (HFT Radar, Cascade, AI Summary) và quản lý kết nối WebSocket tổng.
- `Dashboard.jsx`: Có thể là layout chính bao bọc các thành phần.
- `ModuleMenu.jsx`: Menu điều khiển bật/tắt (ẩn/hiện) các thẻ chức năng (widgets).

### Các Tabs chính
- `HftRadarTab.jsx`: Tab quan trọng nhất chứa các module phân tích HFT.
  - `CVDPanel`: Hiển thị CVD Line Chart, Gauge tỷ lệ Buy/Sell, và Bảng Footprint Node (được tính toán từ trade tick realtime).
  - `WhaleTradesPanel`: Danh sách lệnh cá mập quét từ WebSocket.
  - `AdvancedChart.jsx`: Biểu đồ Klines tích hợp Line (POC, VAH, VAL), Limit Walls và Liquidation Zones. Có nhúng module `TargetLiquidityPanel`.
  - `TargetLiquidityPanel`: Tích hợp vào trong Advanced Chart, hiển thị cụm lệnh chờ Limit Walls theo mức Gap do người dùng chọn.
  - `OrderBookPanel`: Phân tích sổ lệnh tổng hợp (OBI) từ các sàn với khả năng mở rộng/thu hẹp depth levels, hiển thị vùng giá và màu sắc heatmap theo Volume.
- `CascadeTab.jsx`: Bảng Heatmap/Grid hiển thị các chỉ số phái sinh đa khung.
- `SummaryTab.jsx`: Báo cáo AI (Gemini streaming) — chọn ngôn ngữ VI/EN, style, model; export Markdown.
- `services/aiPrompts.js`: System prompt EN + VI cho 3 style phân tích.

### Dịch vụ / Utils
- `services/api.js` — REST multi-source (Binance, FRED, ETF, COT, …).
- `services/websocket.js` — `useBinanceWebSocket` (giá/funding, throttle UI + browser chrome) + `useCVDStream` (aggTrade).
- `config/syncConfig.js` — TTL cache + interval HOT/WARM/COLD.
- `utils/cache.js` — `fetchCached` / đọc cache localStorage.
- `utils/browserChrome.js` — document title + favicon giá BTC (canvas, không phụ thuộc re-render).

## 4. Các Task đã làm (Completed Tasks)

### [2026-07-12] AI Summary chọn ngôn ngữ VI/EN `(FAST)`
- **Lane / Mode:** FEATURE FAST
- **Tóm tắt:** Thêm selector ngôn ngữ báo cáo AI (Tiếng Việt / English) và system prompt tiếng Việt đầy đủ cho 3 style.
- **Thay đổi chính:**
  - `src/services/aiPrompts.js` — prompt EN + VI (professional / tactical / educational).
  - `SummaryTab` — LANG selector (default VI, lưu `localStorage`), label UI theo ngôn ngữ, export file kèm lang.
- **Files / areas chạm:** `src/services/aiPrompts.js`, `src/components/SummaryTab.jsx`, `README.md`
- **Ảnh hưởng README:** §1, §3, §4
- **Verify:** `npm run build`

### [2026-07-12] Refactor sync tiered + favicon realtime `(FULL)`
- **Lane / Mode:** FEATURE FULL
- **Tóm tắt:** Làm code sync/WS tường minh hơn; giảm tải REST lặp lại; sửa favicon/title update chậm khi tab nền.
- **Thay đổi chính:**
  - Tách `fetchCached`, `CACHE_TTL`/`SYNC_INTERVAL`, favicon helper ra module riêng.
  - Sync 3 tầng HOT/WARM/COLD + cache Binance REST; full force giữ cho nút Sync / 08:00.
  - WS ticker batch/throttle 250ms; favicon canvas PNG cập nhật trực tiếp từ WS + re-apply khi tab focus.
  - Fix duplicate mouse listeners ở `useDraggableScroll`; truyền `apiKeys.fred` vào FRED fetch.
- **Files / areas chạm:** `src/App.jsx`, `src/services/websocket.js`, `src/utils/*`, `src/config/syncConfig.js`, `README.md`
- **Ảnh hưởng README:** §2, §3, §4, §5
- **Verify:** `npm run build` OK
- **Notes:** Trình duyệt vẫn có thể throttle tab nền nặng; favicon chỉ đổi khi short-price/màu đổi (vd. `67.1k` → `67.2k`).

- [x] Gộp module `TargetLiquidityPanel` vào bên trong 100% diện tích của `AdvancedChart`.
- [x] Mở rộng `OrderBookPanel` (OBI) và đưa `WhaleTradesPanel` lên cùng một hàng lưới.
- [x] Tạo hiệu ứng Dropdown (Accordion) cho bảng Limit Walls trong Target Liquidity (Cho phép xem chi tiết các lệnh cấu thành một cụm).
- [x] Hiệu chỉnh Heatmap (Gradient/Opacity) cho giá trị Volume trong bảng Limit Walls dựa trên kích thước lệnh so với lệnh lớn nhất (Max Volume).
- [x] Thêm thông tin "Vùng giá" quét được tương ứng với số Depth (Level) được chọn bên trong bảng Order Book Imbalance (OBI).
- [x] Sửa lỗi mất đường Liq Zones trên biểu đồ Advanced Chart (Do thư viện ném lỗi khi xóa đường không tồn tại `removePriceLine`).
- [x] Tích hợp tính năng Volume Footprint (Nodes) cho thẻ CVD & Order Flow, kèm thanh trượt chọn mức Gap ($10-$1000).
- [x] Tích hợp tính năng TPO Profile (Time Price Opportunity) vào Advanced Chart với cấu hình 30 phút, phân phiên theo ngày, hỗ trợ bật/tắt (Blocks/Letters) và được vẽ trực tiếp bằng Primitive API.
- [x] Loại bỏ thanh Volume (HistogramSeries) khỏi Advanced Chart để biểu đồ sạch sẽ hơn.
- [x] Tạo chu kỳ Reset độc lập (500ms) cho việc lọc Limit Walls nhằm tránh độ trễ từ API và hạn chế hiện tượng chớp nháy giao diện khi cập nhật liên tục theo tick.
- [x] Sửa triệt để lỗi mất TPO (Time Price Opportunity) và POC trên biểu đồ bằng cách đồng bộ định dạng thời gian (Unix timestamp) cho thư viện Lightweight-Charts.
- [x] Nâng cấp toàn diện UI bảng Footprint Nodes: Bố cục gọn gàng, định dạng font chữ tốt hơn, tích hợp background volume bars (thanh trạng thái ngầm) sau các con số Buy/Sell Vol để tăng tính trực quan.
- [x] Thêm Tooltips giải thích các thuật ngữ Volume Node, Buy Vol, Sell Vol, Delta cho người dùng.
- [x] Rà soát và tái cấu trúc Data Layer (WebSocket): Xây dựng cơ chế **Persistence Storage** lưu trữ cục bộ (LocalStorage) cho dữ liệu Footprint Nodes, CVD History và Whale Trades. Khắc phục triệt để lỗi mất dữ liệu tích lũy khi trình duyệt bị tải lại (Reload) hoặc crash, tích hợp cơ chế tự động clear rác khi qua ngày mới (Midnight Reset).

## 5. Các Task chưa làm (Pending/TODO Tasks)
- [ ] Code-split bundle JS (>500kB warning sau build)
- [ ] (Tuỳ chọn) Pause/giảm poll HFT orderbook khi tab ẩn (`document.visibilityState`)

---
*Ghi chú: Mọi update từ nay về sau bắt buộc phải ghi log lại vào file này.*