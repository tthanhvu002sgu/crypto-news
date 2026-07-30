# Crypto News & HFT Dashboard

## 1. Tổng quan các tính năng (Features Overview)
Dự án là một Dashboard tổng hợp dữ liệu On-chain, Phân tích kỹ thuật (Technical Analysis), Phân tích vĩ mô (Macroeconomics) và Phân tích dòng tiền tần suất cao (High-Frequency Trading - HFT) cho thị trường Crypto (chủ yếu là BTC, ETH, SOL).

**Các tính năng cốt lõi:**
- **Lịch Kinh Tế Vĩ Mô 7 Ngày (7-Day Economic Calendar):** Hiển thị lịch sự kiện vĩ mô toàn cầu (CPI, FOMC, NFP, GDP, PMI...) dưới dạng bento grid 7 ô vuông tương ứng 7 ngày trong tuần (cố định 1 hàng trên PC, cuộn ngang trên Mobile). Tích hợp Modal phân tích chuyên sâu **tác động của từng sự kiện đến thanh khoản Bitcoin & Crypto** với dữ liệu thời gian thực và curated fallback.
- **Market Bias Engine (Công Thức Bias Total):** Định lượng chỉ số xu hướng BTC tổng hợp từ 4 trụ cột (-100 đến +100): *Microstructure (35%)*, *On-Chain (25%)*, *Institutional Flows (20%)*, *Macro & Risk Shock (20%)*. Tích hợp thanh thước đo Spectrum Gauge Bar với kim chỉ Pin chuyển màu dynamic, 4 bento card trụ cột và drawer bẻ nhỏ 10+ tín hiệu định lượng thành phần.
- **Pump & Dump Move Tracker:** Tự động phát hiện, đo lường và theo dõi các nhịp biến động giá mạnh realtime (dựa trên ATR dynamic hoặc Fixed USD threshold). Đánh giá nhãn thông minh: *Whale Push (Đẩy giá thật)* vs *Liquidity Sweep (Quét thanh khoản)* vs *Stop Hunt*. Lưu trữ lịch sử báo cáo cố định 7 ngày chống mất log khi F5.
- **Thống kê ETF & Cấu trúc dòng tiền:** Biểu đồ dòng tiền (Inflow/Outflow) của các quỹ ETF Bitcoin, Ethereum, Solana.
- **HFT Radar (Phân tích dòng tiền Phái sinh):**
  - **CVD & Order Flow:** Theo dõi Cumulative Volume Delta realtime và phân cụm Footprint Volume (nhóm lệnh theo Gap giá).
  - **Live Whale Trades:** Phát hiện các lệnh Market lớn (trên $100k) theo thời gian thực.
  - **Advanced Price Action:** Biểu đồ TradingView linh hoạt đa khung thời gian (`1m` -> `4h`) tích hợp Volume Profile (POC, VAH, VAL), Limit Walls (Tường thanh khoản), Liquidity Zones (Vùng thanh lý đòn bẩy) và **Anomaly Volume Bubbles** (Đánh dấu khối lượng đột biến). Tường Mua (Limit Buy) bắt buộc nằm dưới giá hiện tại, Tường Bán (Limit Sell) bắt buộc nằm trên giá hiện tại.
  - **Order Book Imbalance (OBI):** Quét độ sâu sổ lệnh (Depth) từ nhiều sàn (Binance, Bybit, OKX, Bitget) để phân tích chênh lệch áp lực Mua/Bán (Bid/Ask Limit Walls).
- **AI Market Decision Lab:** Tích hợp Gemini để kiểm định giả thuyết vĩ mô/on-chain/flow/phái sinh/HFT, phân biệt quan sát với suy luận, phản biện narrative, chấm chất lượng bằng chứng và tạo playbook quyết định có trigger/invalidation. Hỗ trợ **Tiếng Việt / English** và 3 chế độ: Investment Committee / Skeptical Execution Desk / Socratic Market Mentor.
- **BTC Production Cost (range):** Ước tính chi phí khai thác 1 BTC mới dưới dạng **khoảng low → high** quanh baseline energy model (26 J/TH @ $0.05 + 10% opex), biên sai số **−5% / +10%**.
- **Cascade View:** Bảng theo dõi các chỉ số thanh lý (Liquidations), Long/Short Ratio, Funding Rate, Open Interest đa khung thời gian.

## 2. Kiến trúc hệ thống (System Architecture)
- **Frontend Framework:** React.js (Vite).
- **Thiết kế UI/UX System:** **Minimalist-UI Protocol** (Editorial typography, High-contrast monospace, Bento Grid 1px borders, zero emojis, adaptive Light/Dark Theme).
- **Biểu đồ (Charting):** `lightweight-charts` (nến / profile / wall primitive / volume bubble primitive), `chart.js` & `react-chartjs-2` (ETF, CVD, macro, spectrum meter).
- **Quản lý trạng thái:** React Hooks + Context (`ModuleVisibilityContext`, tooltip settings).
- **Nguồn dữ liệu:**
  - **REST API:** Binance, FairEconomy/ForexFactory (weekly calendar), CoinGecko, FRED, CoinMetrics, ETF/COT scrapers, news RSS, Yahoo/FRED equities.
  - **WebSocket:** Binance multi-ticker + `markPrice` + `aggTrade` (CVD / footprint / whale / move tracker).
- **Đồng bộ REST theo tầng (tiered sync):**
  - **HOT** mỗi 5 phút — Binance REST (ticker/klines/L-S/funding/OI), TTL cache 2–5 phút.
  - **WARM** mỗi 15 phút — global mcap, stablecoin, news, equities/yields, CVD 24h/7d, Economic Calendar.
  - **COLD** mỗi 60 phút — FRED macro, on-chain, ETF, COT, Fear&Greed, CVD 30d, daily klines (TTL 2–12h).
  - Nút **SYNC NGAY** / auto 08:00 = full force (bỏ qua cache).
- **Lưu trữ cục bộ & Persistence Multi-layer:**
  - **0ms Synchronous Hydration:** `localStorage` (`hft_move_history_v1`, `hft_signal_log_ls_v1`, theme, module visibility) khôi phục tức thì khi F5.
  - **IndexedDB Asynchronous Storage:** `CryptoSignalLog` (store `signals`) lưu vết lịch sử tín hiệu và move reports 7 ngày.

## 3. Các thành phần chính (Components)
### Giao diện / Bố cục (UI/Layout)
- `App.jsx`: Component gốc quản lý Routing/Tabs (Dashboard, HFT Radar, Cascade, AI Market Decision Lab) và WebSocket manager.
- `DashboardTab.jsx`: Layout chính hiển thị Market Bias Engine, Economic Calendar, Macro Pulse, Polymarket Whales Tracker, L/S & OI charts, ETF Flows.
- `EconomicCalendarPanel.jsx`: Component Lịch kinh tế 7 ngày trong tuần với 7 ô bento card (nằm trên 1 hàng PC, scroll ngang Mobile), Modal phân tích tác động Crypto và bộ lọc Nhanh (ALL / HIGH / USD / CRYPTO).
- `MarketBiasCard.jsx`: Component định lượng xu hướng BTC với thanh Gauge Spectrum, 4 bento card trụ cột và drawer bẻ nhỏ 10+ tín hiệu định lượng.
- `HftRadarTab.jsx`: Tab quan trọng nhất chứa `MoveTrackerPanel`, `CVDPanel`, `WhaleTradesPanel`, `AdvancedChart`, `TargetLiquidityPanel`, `OrderBookPanel`.
- `ModuleMenu.jsx`: Menu điều khiển bật/tắt (ẩn/hiện) các thẻ chức năng (widgets).

### Dịch vụ / Utils (Services & Helpers)
- `services/moveTracker.js` — Phân tích biến động giá mạnh Pump & Dump, tính toán tỷ lệ nến hồi (Recovery %), phân loại hành vi cá mập và lưu vết 0ms sync + IndexedDB.
- `services/economicCalendarService.js` — Fetch lịch kinh tế tuần từ FairEconomy JSON, phân tích tác động Crypto và fallback curated schedule.
- `services/biasEngine.js` — Tính toán điểm xu hướng BTC (-100 đến +100) dựa trên 4 trụ cột định lượng.
- `services/signalStore.js` — Lưu trữ Signal Log kết hợp IndexedDB + localStorage persistence chống mất dữ liệu khi F5.
- `services/api.js` — REST multi-source (Binance, FRED, ETF, COT, …).
- `services/websocket.js` — `useBinanceWebSocket` + `useCVDStream`.

## 4. Các Task đã làm (Completed Tasks)

### [2026-07-30] Bổ Sung Tính Năng Tùy Chọn Timeframe M1 & Volume Bubble Dành Cho Advanced Chart `(FEATURE)`
- **Lane / Mode:** FEATURE FULL & VOLUME ANOMALY TRACKING
- **Tóm tắt:** Nâng cấp biểu đồ AdvancedChart hỗ trợ chuyển đổi linh hoạt các Timeframe (`1m`, `5m`, `15m`, `30m`, `1h`, `4h`). Đồng thời xây dựng lớp `VolumeBubblePrimitive` vẽ trực tiếp bong bóng tại các nến có Volume đột biến (lớn hơn 2x so với trung bình 20 phiên), mã hóa màu xanh/đỏ mượt mà để dễ dàng tracking dòng tiền cá mập.
- **Thay đổi chính:**
  - **Custom Canvas Primitive:** Phát triển `VolumeBubblePrimitive` lồng ghép ngay trong `lightweight-charts` giúp đánh dấu Volume Anomaly.
  - **Dynamic Timeframe & Realtime Data:** Điều chỉnh tự động API REST & WebSocket stream khớp với Khung thời gian do người dùng chọn trên UI (`1m` -> `4h`).
- **Files / areas chạm:** `src/components/AdvancedChart.jsx`, `README.md`
- **Ảnh hưởng README:** §1, §2, §4 (đã thêm log mới).
- **Verify:** Chạy build thành công; tùy chọn Timeframe và nút "Vol Bubbles" hoạt động chính xác.

### [2026-07-29] Đồng Bộ Cụm Footprint Nodes & TỔNG VOL Theo Nút Chọn Khung Thời Gian (1H, 24H, 7D, 30D) `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & FOOTPRINT TIMEFRAME SYNC
- **Tóm tắt:** Nâng cấp bảng **CỤM FOOTPRINT NODES** và **TỔNG VOL** đồng bộ 100% theo nút chọn khung thời gian (`1H`, `24H`, `7D`, `30D`). Khi chọn `1H`, `24H`, `7D` hay `30D`, Footprint Nodes và Tổng Volume tự động truy vấn và tính toán đúng theo khoảng thời gian tương ứng.
- **Thay đổi chính:**
  - **Hàm Dynamic Footprint Timeframe (`api.js`):** Xây dựng `getFootprintNodesForTimeframe(symbol, market, timeframe)` điều chỉnh linh hoạt nến klines (`1m`, `1h`, `4h`) và giới hạn limit theo từng khung (`1H`, `24H`, `7D`, `30D`).
  - **Auto Fetch & Render (`HftRadarTab.jsx`):** Thêm `useEffect` tự động tải lại Footprint Nodes khi thay đổi `cvdTf` hoặc `marketMode`. Cập nhật `TỔNG VOL (1H/24H/7D/30D)` và tiêu đề bảng đồng bộ 100%.
- **Files / areas chạm:** `src/services/api.js`, `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (1.82s); `TỔNG VOL` và cụm Footprint Nodes thay đổi chính xác theo từng nút timeframe `1H`, `24H`, `7D`, `30D`.

### [2026-07-29] Tự Động Tái Tạo Footprint Nodes Lịch Sử (1000 Phút ~ 16.6 Giờ) Cho Cả Spot & Futures `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & FOOTPRINT HYDRATION
- **Tóm tắt:** Giải quyết triệt để vấn đề mất dữ liệu Footprint Nodes khi đóng tab hoặc mới mở trang Web: Tự động tải và gộp 1000 nến 1 phút gần nhất (~16.6 giờ) từ Binance REST API cho cả 2 thị trường **Spot** và **Futures**, tái tạo ngay lập tức bảng Footprint Vùng giá đầy đủ 100% không phải chờ WebSocket tích lũy từ 0.
- **Thay đổi chính:**
  - **Hàm Reconstruct Footprint Nodes (`api.js`):** Xây dựng `getHistoricalFootprintNodes` truy vấn 1000 nến 1m (`/klines`), gộp Taker Buy / Taker Sell vào các nấc giá (Price Bins).
  - **Tự Động Nạp Khi Khởi Động (`websocket.js`):** Trong `useCVDStream()`, nạp song song dữ liệu Footprint 1000m cho cả Spot và Futures ngay khi mount, sau đó nối tiếp luồng khớp lệnh WebSocket realtime.
- **Files / areas chạm:** `src/services/api.js`, `src/services/websocket.js`, `README.md`
- **Verify:** `npm run build` pass (1.66s); mở trang hoặc đóng tab F5 lại lập tức có đầy đủ bảng Footprint Nodes 16.6h cho cả Spot & Futures.

### [2026-07-29] Đồng Bộ Volume Ratio Động Theo Nút Chọn Khung Thời Gian (1H, 24H, 7D, 30D) `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & TIMEFRAME SYNC
- **Tóm tắt:** Nâng cấp **Volume Ratio** (Thanh tỷ lệ % Buy/Sell Volume) đồng bộ 100% theo nút chọn khung thời gian (`1H`, `24H`, `7D`, `30D`), đồng thời làm rõ ranh giới hiển thị giữa Volume Ratio tích lũy theo khung và Footprint Gap Nodes tích lũy theo phiên Realtime.
- **Thay đổi chính:**
  - **Bổ Sung Taker Volumes Cho REST API (`api.js`):** Trả về `buyVol` và `sellVol` trong `getHistoricalCVD` và `getIntradayCVD` từ Binance klines (`takerBuyQuoteVolume` vs `quoteVolume`).
  - **Tính Toán Volume Ratio Động Theo Khung (`HftRadarTab.jsx`):** Khi chọn `24H`, `7D` hay `30D`, `Volume Ratio` tự động tính tổng Volume Mua/Bán ròng trong toàn bộ khoảng thời gian đó thay vì chỉ tính riêng cho phiên 1H.
  - **Ghi Nhãn Rõ Ràng (`HftRadarTab.jsx`):** Đổi nhãn `Volume Ratio (FUTURES/SPOT - 1H/24H/7D/30D)` và `FOOTPRINT GAP (REALTIME)` kèm Tooltip giải thích trực quan.
- **Files / areas chạm:** `src/services/api.js`, `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (2.37s); Volume Ratio tự động tính toán chính xác theo đúng khung thời gian đã chọn.

### [2026-07-29] Hiển Thị Thanh Tổng Volume Footprint & Trạng Thái Chờ Realtime Cho Tab SPOT/FUTURES `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & UI ENHANCEMENT
- **Tóm tắt:** Bổ sung thanh Header hiển thị tổng khối lượng tích lũy `TỔNG VOL: $...` ngay trên bảng Footprint Nodes kèm nhãn phân biệt thị trường rõ ràng (`BIN-F PROXY` vs `BIN-S PROXY`), giúp người dùng thấy ngay sự khác biệt về quy mô giao dịch giữa Spot và Futures.
- **Thay đổi chính:**
  - **Thanh Summary Header Footprint (`HftRadarTab.jsx`):** Tính toán và hiển thị `totalClusterVol` trực tiếp trên đầu bảng Footprint, đổi màu tím cho Futures và xanh lam cho Spot.
  - **Trạng Thái Chờ Tích Lũy Lệnh Realtime (`HftRadarTab.jsx`):** Thêm khung thông báo fallback khi thị trường vừa khởi tạo chưa có lệnh khớp để tránh trải nghiệm giao diện trống.
- **Files / areas chạm:** `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (1.65s); hiển thị tổng Volume rõ ràng giữa Futures và Spot.

### [2026-07-29] Phân Tách Footprint Nodes Theo Thị Trường & Bổ Sung Tooltip Giải Thích `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & TOOLTIPS
- **Tóm tắt:** Nâng cấp Volume Ratio và bảng Footprint Volume Nodes phân tách độc lập theo từng thị trường (`FUTURES` vs `SPOT`), đồng thời bổ sung bộ Tooltips giải thích chi tiết ý nghĩa tài chính và công thức của từng chỉ số.
- **Thay đổi chính:**
  - **Tách Luồng Footprint Nodes (`websocket.js`):** Quản lý 2 bộ đếm nấc giá `volNodesFutures` và `volNodesSpot` riêng biệt từ WebSocket stream.
  - **Đồng Bộ Volume Ratio & Nodes (`HftRadarTab.jsx`):** Cập nhật `activeBuyVolume`, `activeSellVolume` và `activeVolNodes` tự động chuyển đổi theo tab `FUTURES`/`SPOT`.
  - **Bổ Sung Tooltips Giải Thích (`HftRadarTab.jsx`):** Thêm chú thích chi tiết cho `Volume Ratio (Realtime)`, `FOOTPRINT GAP (NODE)`, `BUY VOL`, `SELL VOL` và `DELTA` theo ngữ cảnh thị trường.
- **Files / areas chạm:** `src/services/websocket.js`, `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (5.19s); Footprint Nodes & Volume Ratio tự động đổi theo tab SPOT/FUTURES kèm Tooltip rõ ràng.

### [2026-07-29] Sửa Lỗi Truyền Props Spot CVD & Đồng Bộ Style Tabs FUTURES/SPOT `(FIX)`
- **Lane / Mode:** FIX & DESIGN MATCH
- **Tóm tắt:** Sửa lỗi thiếu truyền props `spotStream` và các mảng lịch sử Spot (`cvd24hSpot`, `cvd7dSpot`, `cvd30dSpot`) xuống `MemoCVDPanel` làm cho tab Spot bị đứng dữ liệu, đồng thời đồng bộ 100% style tab FUTURES/SPOT với các nút Timeframe (`1H`, `24H`, `7D`, `30D`).
- **Thay đổi chính:**
  - **Sửa Lỗi Props Propagation (`HftRadarTab.jsx`):** Khai báo và truyền đầy đủ `futuresStream`, `spotStream`, `cvdHistory24hSpot`, `cvdHistory7dSpot`, `cvdHistory30dSpot` từ `HftRadarTab` xuống `<MemoCVDPanel>`.
  - **Đồng Bộ Visual Style Tab (`HftRadarTab.jsx`):** Loại bỏ inline style đè lệch kích thước, áp dụng chuẩn CSS class `.etf-timeframe-toggle .toggle-btn` giúp tab FUTURES/SPOT match hoàn hảo 100% với khung Timeframe kế bên.
- **Files / areas chạm:** `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (1.59s); tab Spot hiển thị dữ liệu khác biệt chính xác so với Futures, style tab khớp 100%.

### [2026-07-29] Thiết kế Dual-Market CVD Selector (FUTURES vs SPOT) chuẩn Hallmark UI `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & DESIGN
- **Tóm tắt:** Bổ sung tính năng phân tách và chuyển đổi tức thì giữa 2 thị trường CVD: **FUTURES (Phái sinh)** vs **SPOT (Cơ sở)**. Áp dụng chuẩn thiết kế Minimalist / Hallmark UI với bộ Segmented Control Tabs, Badge linh hoạt (`BIN-F PROXY` vs `BIN-S PROXY`) và lưu vết lựa chọn vào `localStorage`.
- **Thay đổi chính:**
  - **Hỗ trợ Dual WebSocket Stream (`websocket.js`):** `useCVDStream` khởi tạo song song 2 luồng kết nối WebSocket (Futures `fstream.binance.com` & Spot `stream.binance.com`) và quản lý bộ đếm volume rồng độc lập.
  - **Thêm tham số Market cho REST API (`api.js`):** Mở rộng `getDailyCVD`, `getHistoricalCVD`, `getIntradayCVD` hỗ trợ tham số `market` ('futures' | 'spot').
  - **Quản lý State Dual-Market (`App.jsx`):** Nạp dữ liệu lịch sử cho cả Spot (`cvd24hSpot`, `cvd7dSpot`, `cvd30dSpot`) và Futures, truyền trực tiếp vào `HftRadarTab`.
  - **Redesign UI Tab Dual-Market (`HftRadarTab.jsx`):** Thêm bộ nút chuyển đổi `FUTURES` vs `SPOT` chuẩn thiết kế Hallmark UI, tự động chuyển màu badge và dữ liệu biểu đồ realtime 0ms delay.
- **Files / areas chạm:** `src/services/api.js`, `src/services/websocket.js`, `src/App.jsx`, `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (1.31s); hiển thị chính xác CVD Futures vs Spot riêng biệt.

### [2026-07-29] Đồng bộ nguồn API Binance Futures cho CVD REST Endpoints `(FIX)`
- **Lane / Mode:** FEATURE FAST
- **Tóm tắt:** Sửa triệt để lỗi lệch quy mô volume CVD giữa WebSocket 1H (Futures `fstream.binance.com`) và REST API 24h/7d/30d (dùng nhầm Spot `api.binance.com`). Chuyển toàn bộ REST endpoints CVD sang Binance Futures API (`fapi.binance.com`) và cập nhật cache keys.
- **Thay đổi chính:**
  - **Sửa Nguồn REST Endpoint (`api.js`):** Chuyển `getDailyCVD`, `getHistoricalCVD`, `getIntradayCVD`, `getWhaleKlinesFlow` từ `api.binance.com/api/v3/klines` (Spot) sang `fapi.binance.com/fapi/v1/klines` (Binance Futures).
  - **Làm mới Cache Keys (`App.jsx`):** Nâng cấp cache keys (`cvdHistory24h_v3`, `cvdHistory7d_v2`, `cvdHistory30d_v2`) để xóa bỏ cache Spot cũ và nạp lại dữ liệu Binance Futures chính xác.
- **Files / areas chạm:** `src/services/api.js`, `src/App.jsx`, `README.md`
- **Verify:** `npm run build` pass (6.06s); dữ liệu CVD 1h và 24h đồng nhất 100% trên cùng Binance Futures proxy market.

### [2026-07-28] Sửa Lỗi Logic Orderbook Chart, Persistence Move Tracker & ReferenceErrors `(FIX & FULL)`
- **Lane / Mode:** FIX & PERSISTENCE
- **Tóm tắt:** Sửa lỗi ranh giới tường Buy/Sell Limit đè sai vị trí trên biểu đồ, khôi phục log Pump & Dump Move Tracker 100% không mất khi F5, và khắc phục các lỗi ReferenceError biến chưa khai báo.
- **Thay đổi chính:**
  - **Sửa Logic Orderbook Chart Boundaries (`AdvancedChart.jsx`):** Siết chặt quy tắc lọc tường cá mập: Tường Mua Limit (Bid) bắt buộc `< currentPrice`, Tường Bán Limit (Ask) bắt buộc `> currentPrice`. Cắt ranh giới tọa độ Y trên Canvas Primitive (`HeatmapWallPrimitive`) ngăn chặn hiện tượng vạch nến đè sang vùng giá đối diện.
  - **Khôi phục Log Move Tracker khi F5 (`moveTracker.js`):** Bổ sung lớp nạp dữ liệu đồng bộ 0ms (`localStorage` key `hft_move_history_v1`) ngay khi module load, kết hợp gộp và loại bỏ trùng lặp với IndexedDB (`signalStore.js`), giúp toàn bộ log Pump & Dump được bảo toàn tuyệt đối sau F5.
  - **Sửa Lỗi ReferenceError (`moveTracker.js` & `signalStore.js`):** Khai báo chính xác các biến `lastMoveEndTime` và `dbInstance` ở module scope, đảm bảo ứng dụng đạt độ ổn định 100% trong Strict Mode.
- **Files / areas chạm:** `src/components/AdvancedChart.jsx`, `src/services/moveTracker.js`, `src/services/signalStore.js`, `README.md`
- **Verify:** `npm run build` pass (2.04s, 0 errors); git pushed.

### [2026-07-28] Tải & Xây dựng Lịch Kinh Tế Vĩ Mô 7 Ngày & Redesign Market Bias Minimalist `(FULL)`
- **Lane / Mode:** FEATURE FULL & STYLING
- **Tóm tắt:** Xây dựng mới Lịch kinh tế vĩ mô 7 ngày trong tuần trên Dashboard, tái thiết kế Market Bias Engine chuẩn Minimalist-UI, tối ưu persistence Signal Log và tương thích hoàn hảo Light/Dark Theme.
- **Files / areas chạm:** `src/components/EconomicCalendarPanel.jsx`, `src/services/economicCalendarService.js`, `src/components/MarketBiasCard.jsx`, `src/services/biasEngine.js`, `src/components/DashboardTab.jsx`, `README.md`

### [2026-07-16] Sửa CPI index bị dùng nhầm thành lạm phát YoY `(FIX)`
- **Lane / Mode:** FIX
- **Tóm tắt:** Sửa lỗi `CPIAUCSL = 332.57` (index 1982–1984=100) bị gắn `%` và trừ trực tiếp khỏi Fed Funds.
- **Files / areas chạm:** `src/services/api.js`, `src/App.jsx`, `src/components/SummaryTab.jsx`, `src/components/DashboardTab.jsx`, `README.md`

---

- [x] Gộp module `TargetLiquidityPanel` vào bên trong 100% diện tích của `AdvancedChart`.
- [x] Mở rộng `OrderBookPanel` (OBI) và đưa `WhaleTradesPanel` lên cùng một hàng lưới.
- [x] Tích hợp tính năng Volume Footprint (Nodes) cho thẻ CVD & Order Flow, kèm thanh trượt chọn mức Gap ($10-$1000).
- [x] Tích hợp tính năng TPO Profile (Time Price Opportunity) vào Advanced Chart với cấu hình 30 phút.
- [x] Rà soát và tái cấu trúc Data Layer (WebSocket): Xây dựng cơ chế **Persistence Storage** cho dữ liệu Footprint Nodes, CVD History và Whale Trades.
- [x] Xây dựng Lịch kinh tế vĩ mô 7 ngày trong tuần trên Dashboard (`EconomicCalendarPanel.jsx`).
- [x] Redesign Market Bias Engine chuẩn Minimalist-UI với thanh Spectrum Gauge và 4 bento pillar cards.
- [x] Sửa lỗi ranh giới Orderbook Limit Walls đè sai vị trí trên Advanced Chart.
- [x] Tối ưu Persistence 0ms cho Pump & Dump Move Tracker log chống mất khi F5.

## 5. Các Task chưa làm (Pending/TODO Tasks)
- [ ] Code-split bundle JS (>500kB warning sau build)
- [ ] (Tuỳ chọn) Pause/giảm poll HFT orderbook khi tab ẩn (`document.visibilityState`)

---
*Ghi chú: Mọi update từ nay về sau bắt buộc phải ghi log lại vào file này.*
