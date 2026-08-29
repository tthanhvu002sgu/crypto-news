# Crypto News & HFT Dashboard

## 1. Tổng quan các tính năng (Features Overview)
Dự án là một Dashboard tổng hợp dữ liệu On-chain, Phân tích kỹ thuật (Technical Analysis), Phân tích vĩ mô (Macroeconomics) và Phân tích dòng tiền tần suất cao (High-Frequency Trading - HFT) cho thị trường Crypto (chủ yếu là BTC, ETH, SOL).

**Các tính năng cốt lõi:**
- **Lịch Kinh Tế Vĩ Mô 7 Ngày (7-Day Economic Calendar):** Hiển thị lịch sự kiện vĩ mô toàn cầu (CPI, FOMC, NFP, GDP, PMI...) dưới dạng bento grid 7 ô vuông tương ứng 7 ngày trong tuần (cố định 1 hàng trên PC, cuộn ngang trên Mobile). Tích hợp Modal phân tích chuyên sâu **tác động của từng sự kiện đến thanh khoản Bitcoin & Crypto** với dữ liệu thời gian thực và curated fallback.
- **Market Bias Engine (Công Thức Bias Total & 3-Layer Regime):** Định lượng chỉ số xu hướng BTC tổng hợp từ 4 trụ cột (-100 đến +100): *Dòng tiền Định chế (40%)*, *On-Chain Fundamentals & Network (25%)*, *Vĩ mô & Thanh khoản Toàn cầu (20%)*, *Vi cấu trúc & BTC Trend Regime (15%)*. Loại bỏ tính trùng lặp MVRV, đưa DXY, US 10Y Yield, Net Liquidity, High-Yield Spread và 1.000 nến Daily BTC vào tính điểm thực tế. Đồng thời bóc tách 3 tầng nhận định trực quan: `Valuation Bias` (Định giá), `Trend Bias` (Cấu trúc xu hướng), `Tactical Bias` (Chiến thuật/Đòn bẩy ngắn hạn).
- **MOVE TRACKER Research v2:** Phát hiện nhịp biến động BTCUSDT realtime bằng champion ATR/Fixed USD, trong đó ATR(14) lấy từ **Binance Futures 5m đã đóng**. Mỗi event tách riêng snapshot tại trigger, snapshot cuối move và outcome `+15s/+30s/+60s/+5m/+15m`; shadow layer đo participation percentile và xác nhận executed flow Spot/Futures nhưng chưa lọc alert. Event được lưu IndexedDB 90 ngày, có thống kê theo detection horizon `15/30/60/120s`, context `5m/15m/1h`, và export CSV/JSON.
- **Thống kê ETF & Cấu trúc dòng tiền:** Biểu đồ dòng tiền (Inflow/Outflow) của các quỹ ETF Bitcoin, Ethereum, Solana.
- **HFT Radar (Phân tích dòng tiền Phái sinh):**
  - **CVD & Order Flow:** Theo dõi Cumulative Volume Delta đa khung (`1H`, `24H`, `7D`, `30D`) với **Mốc Neo Cố Định UTC Anchor (`2020-01-01T00:00:00.000Z`)** và **Sổ Cái Snapshot Ngày Đóng Bất Biến v1 (`hft_cvd_daily_snapshots_v1`)**. Biểu đồ rebase riêng từng cửa sổ về mốc 0 bằng `cumulativeWithinWindow`, nên điểm cuối và dấu trên hai trục Y Spot/Futures luôn khớp số `windowNetDelta` ở thẻ Hero; `cumulativeFromAnchor` vẫn được bảo toàn cho lưu trữ/audit và chống trôi dữ liệu. Market Bias Engine, Google Sheets sync và AI Market Decision Lab tiếp tục tiêu thụ độc lập `windowNetDelta`. Tích hợp phân cụm Footprint Volume (nhóm lệnh theo Gap giá).
  - **Live Whale Trades:** Phát hiện các lệnh Market lớn (trên $100k) theo thời gian thực.
  - **Advanced Price Action:** Biểu đồ TradingView linh hoạt đa khung thời gian (`1m` -> `4h`) tích hợp Volume Profile (POC, VAH, VAL), Limit Walls (Tường thanh khoản), Liquidity Zones (Vùng thanh lý đòn bẩy) và **Anomaly Volume Bubbles** (Đánh dấu khối lượng đột biến bằng Robust Z-Score & Taker Delta). Tường Mua (Limit Buy) bắt buộc nằm dưới giá hiện tại, Tường Bán (Limit Sell) bắt buộc nằm trên giá hiện tại.
  - **Order Book Imbalance (OBI):** Quét độ sâu sổ lệnh (Depth) từ nhiều sàn (Binance, Bybit, OKX, Bitget) để phân tích chênh lệch áp lực Mua/Bán (Bid/Ask Limit Walls).
- **AI Market Decision Lab:** Tích hợp Gemini để kiểm định giả thuyết vĩ mô/on-chain/flow/phái sinh/HFT, phân biệt quan sát với suy luận, phản biện narrative, chấm chất lượng bằng chứng và tạo playbook quyết định có trigger/invalidation. Hỗ trợ **Tiếng Việt / English** và 3 chế độ: Investment Committee / Skeptical Execution Desk / Socratic Market Mentor.
- **BTC Production Cost (range):** Ước tính chi phí khai thác 1 BTC mới dưới dạng **khoảng low → high** quanh baseline energy model (26 J/TH @ $0.05 + 10% opex), biên sai số **−5% / +10%**.
- **BTC SSR Oscillator (Glassnode Z-Score):** Đo lường sức mua Stablecoin so với Vốn hóa BTC chuẩn hóa bằng Z-Score (vị trí so với đường trung bình SMA 200 ngày và độ lệch chuẩn 2σ theo phương pháp Glassnode Oscillator). Tự động xác định vùng Mua/Bán cực đoan (Z < -2 / Z > +2) và đồng bộ nguồn vốn hóa DefiLlama.
- **Cascade View:** Bảng theo dõi các chỉ số thanh lý (Liquidations), Long/Short Ratio, Funding Rate, Open Interest đa khung thời gian.
- **Scanner Shortlist Engine v7 (BUY & SELL):** Hệ thống xếp hạng shortlist khách quan theo 4 Pillars (*Quality 5đ, Relative Strength vs BTC 8đ, Flow CVD/OI 6đ, Market Context 6đ* — Thang 25đ). Bảo tồn quota momentum (30 liquid + 10 gainer + 10 loser), phân tích Price Action thuần nến đóng không lookahead (`4H uptrend · gần range high · volume expansion`), progressive disclosure 5 cột (Coin, Strength, Flow, Quality, Rank Score), accordion mở rộng hiển thị raw metrics, top 3 lý do và cảnh báo vi cấu trúc.
- **Google Sheets Auto-Sync 3 Phiên (Á - Âu - Mỹ) & AI Prompt Staging:** Tự động tổng hợp và đồng bộ toàn bộ snapshot thị trường (Market Bias, On-Chain, Phái sinh, ETF, Macro Calendar, và Markdown Summary) lên file Google Sheets công khai thông qua Google Apps Script Webhook. Hoạt động tự động 24/7 theo 3 phiên giao dịch chính bằng GitHub Actions (08:00 Á, 14:00 Âu, 20:00 Mỹ) và hỗ trợ nút "SYNC SHEET" kích hoạt trực tiếp từ trình duyệt, giúp các mô hình AI độc lập dễ dàng truy xuất để phân tích định kỳ.

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
- **Tự động hóa đồng bộ Google Sheets 3 Phiên:**
  - **GitHub Actions Worker:** Cron 3 phiên Á (01:00 UTC = 08:00 VN), Âu (07:00 UTC = 14:00 VN), Mỹ (13:00 UTC = 20:00 VN) chạy ngầm serverless hoàn toàn độc lập với web hosting (Vercel).
  - **Google Apps Script Webhook:** Nhận payload JSON và ghi đè tự động 5 Tab: `OVERVIEW_BIAS`, `DERIVATIVES_FLOW`, `ETF_ONCHAIN`, `MACRO_CALENDAR`, `AI_PROMPT_SUMMARY`.
  - **Client-side Web Sync:** Cho phép gửi trực tiếp từ browser mà không lo lỗi CORS.
- **Lưu trữ cục bộ & Persistence Multi-layer:**
  - **0ms Synchronous Hydration:** `localStorage` giữ settings và preview MOVE TRACKER gần nhất (`hft_move_preview_v2`) cùng theme/module visibility.
  - **Immutable Daily CVD Snapshot Ledger (`hft_cvd_daily_snapshots_v1`):** Lưu trữ sổ cái snapshot ngày đóng UTC bất biến của Spot và Futures từ mốc neo cố định `CVD_ANCHOR_UTC = '2020-01-01T00:00:00.000Z'`. Đảm bảo nến đang chạy được đánh dấu `isClosed: false` và chỉ khóa vào sổ cái một lần duy nhất khi kết thúc ngày UTC, loại bỏ hoàn toàn hiện tượng look-ahead và trôi dạt baseline.
  - **Versioned CVD Series Cache (`hft_cvd_series_*_v4`):** Cache đa khung thời gian 24h/7d/30d với Data Contract 3 lớp: `cumulativeFromAnchor` cho lưu trữ/audit bất biến, `cumulativeWithinWindow` cho biểu đồ rebase theo khung, và `windowNetDelta` cho Hero/các bộ tính toán chỉ báo/xuất dữ liệu.
  - **IndexedDB Research Storage:** `MoveTrackerResearch` (store `events`) lưu event schema v2 trong 90 ngày; migration một lần từ `hft_move_history_v1` và legacy `CryptoSignalLog/MOVE_REPORT`, có dedupe theo stable event ID.

## 3. Các thành phần chính (Components)
### Giao diện / Bố cục (UI/Layout)
- `App.jsx`: Component gốc quản lý Routing/Tabs (Dashboard, HFT Radar, Cascade, AI Market Decision Lab) và WebSocket manager, tích hợp nút SYNC SHEET và modal cài đặt API/Webhook.
- `DashboardTab.jsx`: Layout chính hiển thị Market Bias Engine, Economic Calendar, Macro Pulse, Polymarket Whales Tracker, L/S & OI charts, ETF Flows.
- `EconomicCalendarPanel.jsx`: Component Lịch kinh tế 7 ngày trong tuần với 7 ô bento card (nằm trên 1 hàng PC, scroll ngang Mobile), Modal phân tích tác động Crypto và bộ lọc Nhanh (ALL / HIGH / USD / CRYPTO).
- `MarketBiasCard.jsx`: Component định lượng xu hướng BTC với thanh Gauge Spectrum, 4 bento card trụ cột, thanh tóm tắt 3 tầng Regime và drawer bẻ nhỏ 14+ tín hiệu định lượng.
- `HftRadarTab.jsx`: Tab quan trọng nhất chứa `MoveTrackerPanel`, `CVDPanel` (tích hợp UTC Anchor và phân tách Net Delta), `WhaleTradesPanel`, `AdvancedChart` (tích hợp Bubble Anomaly Robust Z-Score), `TargetLiquidityPanel`, `OrderBookPanel`.
- `ModuleMenu.jsx`: Menu điều khiển bật/tắt (ẩn/hiện) các thẻ chức năng (widgets).

### Dịch vụ / Utils (Services & Helpers)
- `src/services/cvdService.js` — Động cơ CVD trung tâm quản lý mốc neo cố định UTC Anchor (2020-01-01), sổ cái snapshot ngày đóng bất biến (`hft_cvd_daily_snapshots_v1`), cơ chế tự động backfill từ Binance, và Data Contract 3 lớp (`cumulativeFromAnchor`, `cumulativeWithinWindow`, `windowNetDelta`).
- `src/services/cvdService.test.js` — Bộ 11 unit test tự động kiểm chứng tính bất biến của timestamp, tính độc lập Spot/Futures, an toàn rollover nửa đêm UTC, miễn nhiễm quy mô cho Bias Engine và đối chiếu đồng nhất Google Sheets.
- `scripts/syncGoogleSheet.mjs` — Script Node.js độc lập cào dữ liệu từ Binance, DefiLlama, Alternative.me, FairEconomy, tính Bias trực tiếp bằng `biasEngine.js` và gửi webhook.
- `google-apps-script/Code.gs` — Mã nguồn Google Apps Script nhận POST webhook, xóa cũ và ghi đè bảng dữ liệu formatted lên Google Sheet.
- `src/services/googleSheetSync.js` — Client service format payload và gọi webhook trực tiếp từ Web UI.
- `src/services/biasEngine.js` — Tính toán điểm xu hướng BTC (-100 đến +100) và 3-layer regime (Valuation, Trend, Tactical) dựa trên 4 trụ cột định lượng chuẩn hóa (tiêu thụ `windowNetDelta`).
- `src/services/biasEngine.test.js` — Bộ unit test tự động cho toàn bộ logic định lượng, parsing VIX an toàn, MVRV deduplication và trend calculation.
- `.github/workflows/sync-sheets.yml` — Workflow GitHub Actions chạy định kỳ 3 phiên theo cron.
- `services/moveTracker.js` — Điều phối champion detector, shadow flow research, trigger/end/outcome lifecycle và context OI/Funding/OBI.
- `services/moveTrackerCore.js` — Các phép tính thuần cho detection windows, participation percentile, flow labels, MFE/MAE, recovery và thống kê timeframe.
- `services/moveEventStore.js` — IndexedDB 90 ngày, migration legacy, query/filter, thống kê và export CSV/JSON cho MOVE TRACKER.
- `services/economicCalendarService.js` — Fetch lịch kinh tế tuần từ FairEconomy JSON, phân tích tác động Crypto và fallback curated schedule.
- `services/api.js` — REST multi-source (Binance, DefiLlama, FRED, ETF, COT, …) hỗ trợ SSR Z-Score Oscillator 200-day và `getStableCvdSeries`.
- `services/websocket.js` — `useBinanceWebSocket` + `useCVDStream`.

## 4. Các Task đã làm (Completed Tasks)

### [2026-08-29] Đồng Bộ Trục Y CVD Spot/Futures Với Net Delta Theo Cửa Sổ `(FAST)`
- **Mode / Type / Action / Lane:** FEATURE / BUGFIX / EXECUTE / FAST
- **Tóm tắt:** Sửa lỗi chart 24H/7D/30D vẽ giá trị tích lũy từ anchor 2020 trong khi Hero hiển thị net delta của cửa sổ, khiến dấu và trị số trên hai trục Y không khớp số tổng Spot/Futures.
- **Thay đổi chính:** Thêm projection `cumulativeWithinWindow` rebase từ 0, buộc điểm cuối chart bằng `windowNetDelta`, cập nhật live candle trên cùng hệ quy chiếu, cho hai scale luôn chứa mốc 0 và hỗ trợ cache v4 cũ bằng normalize lúc render; thêm regression test bảo toàn đồng thời projection theo cửa sổ và giá trị anchor audit.
- **Files / areas chạm:** `src/services/cvdService.js`, `src/services/cvdService.test.js`, `src/components/HftRadarTab.jsx`, `README.md`
- **Ảnh hưởng README:** §1 / §2 / §3
- **Verify:** Toàn bộ 71 test scanner/move/macro/sheets/bias/CVD pass (CVD 15/15), `npm run build` pass; smoke-test local 7D và 30D xác nhận điểm cuối/trục Y khớp Hero ở cả Futures và Spot. Targeted ESLint không phát sinh lỗi mới nhưng vẫn fail bởi 12 lỗi tồn đọng ngoài diff trong cùng các file.

### [2026-08-29] Khắc Phục Triệt Để Sai Lệch Baseline CVD Với Mốc Neo Cố Định UTC Anchor (2020-01-01), Immutable Daily Snapshot Ledger & Data Contract Hai Tầng (cumulativeFromAnchor vs windowNetDelta) `(BUGFIX FULL)`
- **Lane / Mode:** BUGFIX FULL & DATA INTEGRITY
- **Tóm tắt:** Sửa dứt điểm lỗi cơ bản khiến giá trị Cumulative Volume Delta (CVD) của nến/ngày đã đóng bị thay đổi giá trị hoặc đổi dấu khi cửa sổ trượt dịch chuyển (do cơ chế rebase `CVD[0] = 0` cũ). Thiết lập mốc neo thời gian bất biến chuẩn quốc tế `CVD_ANCHOR_UTC = '2020-01-01T00:00:00.000Z'` (`1577836800000`), xây dựng sổ cái snapshot ngày đóng bất biến `hft_cvd_daily_snapshots_v1`, tách bạch hoàn toàn 2 khái niệm trong Data Contract (`cumulativeFromAnchor` cho chart vs `windowNetDelta` cho Bias/Sheets/AI), và nâng cấp đồng bộ toàn bộ consumer.
- **Thay đổi chính:**
  - **Động Cơ Sổ Cái Snapshot Ngày Đóng Bất Biến (`cvdService.js`):**
    - Thiết lập mốc neo chuẩn `CVD_ANCHOR_TIMESTAMP = 1577836800000`.
    - Chuẩn hóa nến Binance (`normalizeKline`), phân định rõ nến đã đóng (`isClosed: true`) và nến đang chạy (`isClosed: false`).
    - Lưu trữ snapshot ngày đóng bất biến (`hft_cvd_daily_snapshots_v1`) phân tách độc lập giữa 2 thị trường `spot` và `futures`. Snapshot một khi đã đóng sẽ không bao giờ bị ghi đè.
    - Cơ chế đồng bộ bù tự động (`syncDailySnapshots`) tự động truy vấn các ngày còn thiếu từ Binance daily klines từ mốc gần nhất đến hôm qua.
  - **Data Contract Hai Tầng Chuẩn Hóa (`buildCvdSeries` & `extractCvdNetDelta`):**
    - `cumulativeFromAnchor`: Giá trị tích lũy liên tục từ mốc 2020-01-01, đảm bảo timestamp `T` luôn cho ra một giá trị duy nhất trên chart dù nạp 24, 48 hay 100 nến.
    - `windowNetDelta`: Tổng delta mua/bán ròng thực tế của chính khung thời gian yêu cầu (24H/7D/30D), độc lập với mốc tích lũy hàng tỷ USD của anchor.
    - Hàm trích xuất an toàn `extractCvdNetDelta` bảo vệ tất cả consumer không bị đọc nhầm số tích lũy hàng tỷ đô.
  - **Cập Nhật Toàn Bộ Consumer Dữ Liệu:**
    - `biasEngine.js`: Chuyển toàn bộ 6 metric CVD Spot & Futures (24h/7d/30d) sang tiêu thụ `windowNetDelta`, bảo toàn chính xác logic định lượng Bias (-100 đến +100).
    - `googleSheetSync.js` & `syncGoogleSheet.mjs`: Chuyển đổi toàn bộ bộ kiểm tra tính đầy đủ, bảng dòng tiền phái sinh và AI prompt Markdown sang tiêu thụ `windowNetDelta`, đối chiếu phân kỳ Spot vs Futures chính xác 100%.
    - `HftRadarTab.jsx`: Biểu đồ sử dụng `cumulativeFromAnchor` để vẽ đồ thị đường ổn định, tooltip hiển thị chi tiết (CVD tích lũy, Delta nến, trạng thái Đã chốt/Đang chạy, giá BTC), Hero card hiển thị `netDelta` của khung thời gian hiện tại, gắn nhãn badge `UTC ANCHOR 2020`.
    - `App.jsx`: Nâng cấp cache keys sang v4 (`hft_cvd_series_*_v4`), nạp nhanh an toàn và tương thích ngược với cấu trúc object/array.
  - **Bộ Kiểm Thử Tự Động 11 Ca Kiểm Chứng (`cvdService.test.js`):**
    - Kiểm chứng mốc neo 2020-01-01.
    - Kiểm chứng tính bất biến của `cumulativeFromAnchor` khi thay đổi kích thước cửa sổ.
    - Kiểm chứng tính bất biến của snapshot ngày đóng (không bị ghi đè).
    - Kiểm chứng tính độc lập tuyệt đối giữa Spot và Futures ledger.
    - Kiểm chứng đánh dấu nến provisional và khóa nến khi đóng.
    - Kiểm chứng an toàn rollover nửa đêm UTC (không cộng dồn trùng lặp).
    - Kiểm chứng tự động backfill chuỗi ngày bị thiếu.
    - Kiểm chứng `windowNetDelta` bằng đúng tổng delta các nến trong khung.
    - Kiểm chứng Bias Engine miễn nhiễm với quy mô anchor.
    - Kiểm chứng đồng nhất dữ liệu giữa trình duyệt và Google Sheets export.
    - Kiểm chứng bảo toàn metadata xuất xứ (source, anchorTime, asOf, version).
- **Files / areas chạm:** `src/services/cvdService.js` (NEW), `src/services/cvdService.test.js` (NEW), `src/services/api.js`, `src/services/biasEngine.js`, `src/services/googleSheetSync.js`, `scripts/syncGoogleSheet.mjs`, `src/components/HftRadarTab.jsx`, `src/components/Tooltip.jsx`, `src/App.jsx`, `package.json`, `README.md`.
- **Verify:** `npm run test:cvd` pass 11/11 tests; `npm test` pass 58/58 tests toàn hệ thống; `npm run sync:sheets:dry` hoàn thành 93% độ hoàn thiện với 5 tab đầy đủ; `npm run build` pass 100% (2.02s, 0 errors).

### [2026-08-27] Tái Cấu Trúc Toàn Diện SCANNER Thành Shortlist Ranking Engine 4 Pillars & Progressive Disclosure UI `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & QUANT / UI REFACTOR
- **Tóm tắt:** Chuyển đổi toàn diện Scanner từ giao diện nhiều chỉ báo sang **Shortlist Ranking Engine** tinh gọn tập trung trả lời 3 câu hỏi cốt lõi: (1) *Coin nào đáng xem?*, (2) *Vì sao được chọn?*, (3) *Dữ liệu có đủ tin cậy không?* Tuyệt đối không đưa entry, stop hay target. Tái cấu trúc chấm điểm theo 4 Pillars độc lập (Quality 5đ, Relative Strength 8đ, Flow CVD/OI 6đ, Market Context 6đ — Thang chuẩn 25đ); bảo tồn quota momentum universe (30 liquid + 10 gainer + 10 loser); bổ sung công cụ phân tích Price Action thuần nến đóng không lookahead (`4H uptrend · gần range high · volume expansion`); tái thiết kế giao diện Desktop 5 cột trọng tâm kết hợp accordion mở rộng chi tiết và chế độ Compact Card thông minh trên Mobile.
- **Thay đổi chính:**
  - **Bảo Tồn Quota Universe & Tránh Mất Momentum (`coinScanner.js`):** Cơ chế lọc chia quota rõ ràng (30 Core Liquid + 10 Top Gainers + 10 Top Losers 24H); loại bỏ hoàn toàn lỗi sort volume 30D cuối đè mất các ứng viên momentum mới nổi.
  - **Mô Hình Điểm 4 Pillars Độc Lập & Đối Xứng BUY/SELL (`coinScanner.js`):**
    - *Quality (5.0):* Thanh khoản 30D, Vốn hóa, VolCV ổn định (&le;0.6), Spread Futures hẹp (&le;0.03%), Data coverage.
    - *Relative Strength vs BTC (8.0):* Phân vị RS composite đa khung (1H/4H/24H) trong universe và Breakout/Breakdown ATR.
    - *Flow CVD/OI (6.0):* CVD Futures chuẩn hóa, CVD Spot gom/xả ròng, CVD Trend Ratio gia tốc và OI đồng thuận biến động giá 4H.
    - *Market Context (6.0):* Xu hướng EMA 4H & Slope, Daily Trend 1D, RSI sweet spot (42-68 / 32-58) và Macro BTC/ETF. Trừ điểm phạt nếu bị kéo xa EMA21 (&gt;8%) hoặc trade quá crowded (Funding cao / Basis giãn rộng).
    - *Metadata xuất ra:* Tự động sinh `pillarState`, `positiveReasons` (top 3 lý do mạnh nhất), `warnings` (cảnh báo vi cấu trúc), `flowState`, `trendState`.
  - **Công Cụ Phân Tích Price Action Thuần Nến Đóng (`detectPriceActionContext`):** Xác định 4H Structure (UPTREND / DOWNTREND / RANGE / UNCLEAR), Vị trí giá (IN_RANGE / NEAR_RANGE_HIGH / NEAR_RANGE_LOW / BREAKOUT / EXTENDED), Chất lượng Breakout (STRONG_CLOSE / WICK_HEAVY_SWEEP), và Trạng thái biến động (COMPRESSION / NORMAL / EXPANSION). Xuất ra câu bối cảnh súc tích hiển thị trực tiếp trên UI.
  - **Công Cụ Đánh Giá Chất Lượng Shortlist (`evaluateShortlistUtility`):** Đo lường Precision@5 (tỷ lệ Top 5 outperform BTC), Relative Return trung bình so với Universe, và Candidate Turnover mà không overfit threshold.
  - **Giao diện Progressive Disclosure 5 Cột Desktop & Mobile Compact Cards (`ScannerTab.jsx`, `App.css`):**
    - Bảng Desktop 5 cột: `Coin`, `Strength` (STRONG/NEUTRAL/WEAK), `Flow` (FLOW CONFIRMED/DIVERGENT), `Quality` (LIQUID/ACCEPTABLE), `Rank Score` (ƯU TIÊN CAO/ĐÁNG THEO DÕI/THEO DÕI THÊM + Chevron).
    - Click row hoặc phím Enter/Space mở accordion chi tiết: hiển thị bối cảnh Price Action, Top 3 lý do, Cảnh báo vi cấu trúc, 4 thẻ điểm Pillars, và bảng Raw Decision Metrics bento grid.
    - Mobile Card View: Tự động chuyển đổi thành thẻ bo góc compact, tránh hoàn toàn lỗi tràn ngang màn hình.
    - Modal / Drawer "Cách Scanner Hoạt Động": Giải thích cặn kẽ 4 pillars, cơ chế CVD proxy và disclaimer miễn trừ trách nhiệm.
    - Phân loại rõ ràng 3 trạng thái lỗi/rỗng: `PROVIDER_UNAVAILABLE`, `INSUFFICIENT_COVERAGE`, `NO_CANDIDATES`.
- **Files / areas chạm:** `src/services/coinScanner.js`, `src/services/coinScanner.test.js`, `src/components/ScannerTab.jsx`, `src/App.css`, `README.md`.
### [2026-08-29] Khắc Phục Toàn Diện 4 Lỗi Cửa Sổ Trượt, Contract Object AI Summary, Incremental Sync & Net Delta Bucket Trong Stable CVD Engine `(BUGFIX FULL)`
- **Lane / Mode:** BUGFIX FULL & CVD STABILITY
- **Tóm tắt:** Triệt tiêu hoàn toàn hiện tượng lệch mỏ neo khi cửa sổ trượt (rolling baseline shift), hỗ trợ chuẩn hóa contract object `{ points, windowNetDelta }` trong AI Summary & Charts, tự động backfill snapshot hàng ngày (incremental ledger sync khi browser mở lại sau nhiều ngày), và chuẩn hóa số lượng bucket chính xác (24 nến cho 24H, 42 nến cho 7D, 30 nến cho 30D) trong `windowNetDelta`.
- **Thay đổi chính:**
  - **Khắc phục Baseline Shift Khi Cửa Sổ Trượt (`cvdService.js`, `api.js`):** Tích hợp tích lũy liên tục bắt đầu từ mốc UTC midnight (`00:00:00 UTC`) của ngày sớm nhất trong cửa sổ hiển thị, lấy baseline từ snapshot ngày trước đó. Mọi timestamp nến cùng thời điểm đều nhận chính xác 100% `cumulativeFromAnchor` bất biến dù query ở bất kỳ thời điểm nào trong ngày.
  - **Tách Biệt Display Slicing & Window Net Delta:** `buildCvdSeries` nhận `targetCount` (24 cho 24H, 42 cho 7D, 30 cho 30D) để cắt đúng $N$ nến hiển thị và tính `windowNetDelta` nghiêm ngặt trên $N$ nến này, không bao gồm nến đệm dùng dựng baseline.
  - **Incremental Sync Cho Ledger Daily Snapshots:** Bổ sung `isLedgerStale()` và `ensureDailySnapshots()`. Khi phát hiện snapshot gần nhất nhỏ hơn ngày UTC hôm qua, hệ thống tự động fetch và chốt các ngày đã đóng còn thiếu mà không cần reset store hay chạy full backfill thừa thãi.
  - **Chuẩn Hóa Contract Object Trong AI Summary & Charts (`SummaryTab.jsx`, `SummaryCharts.jsx`):** Trích xuất an toàn `getSeriesPoints(series)` và `getSeriesNetDelta(series)`, loại bỏ nguy cơ `filter is not a function`, hiển thị biểu đồ và so sánh phân kỳ Spot/Futures Net Delta minh bạch.
- **Files / areas chạm:** `src/services/cvdService.js`, `src/services/cvdService.test.js`, `src/services/api.js`, `src/components/SummaryTab.jsx`, `src/components/SummaryCharts.jsx`, `README.md`.
- **Verify:** `npm test` pass 59/59 unit tests (cvdService: 13 tests, biasEngine: 19 tests, googleSheetSync: 6 tests, moveTracker: 16 tests, macroDashboard: 5 tests); `npm run sync:sheets:dry` pass 100%; `npm run build` thành công 100% (15.71s).

### [2026-08-27] Tích Hợp Hiển Thị Song Song BTC Price (Đối Chứng Khách Quan), Ma Trận Phân Kỳ/Xác Nhận & Provenance Snapshot Store `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & UX/DATA INTEGRITY
- **Tóm tắt:** Nâng cấp toàn diện giao diện `MarketBiasCard` sang cấu trúc Dual-Benchmark hiển thị song song BTC Price với vai trò "đối chứng khách quan" (không coi giá tăng là bằng chứng mặc định Bias đúng); tự động phân loại 4 trạng thái xác nhận & phân kỳ (Confirmed Bullish, Bullish Divergence, Bearish Divergence, Confirmed Bearish); bổ sung Data Freshness Engine nhận diện nguồn dữ liệu cũ nhất thực tế (`Data oldest: COT 5d`, `ETF 1d`); ghi chú minh bạch 3% trọng số xu hướng giá & 97% độc lập; tích hợp `biasSnapshotStore.js` lưu trữ snapshot thời gian thực trong `localStorage` loại bỏ 100% look-ahead bias.
- **Thay đổi chính:**
  - **Dual-Benchmark Layout (`MarketBiasCard.jsx`):** Cột trái hiển thị `BTC PRICE` (Giá hiện tại, % thay đổi 24H, Timestamp cập nhật giá, Vol 24H); Cột phải hiển thị `MARKET BIAS` (Score -100 đến +100, Confidence %, Data oldest freshness, Zero-Fallback indicator).
  - **Ma Trận Phân Kỳ & Xác Nhận (`evaluateBiasPriceConfirmation`):** Đánh giá đồng thuận/phân kỳ giữa Bias định lượng và hành vi giá 24h:
    - *Tăng / Tăng:* `Bullish được price xác nhận` (Xanh lá).
    - *Tăng / Giảm:* `Bullish divergence — thesis chưa được xác nhận` (Vàng hổ phách).
    - *Giảm / Tăng:* `Bearish divergence — cảnh giác` (Đỏ hồng / Bẫy giá).
    - *Giảm / Giảm:* `Bearish được price xác nhận` (Đỏ hồng).
    - *Trung lập:* `Thị trường cân bằng / Chưa có phân kỳ`.
  - **Data Freshness Engine (`calculateDataFreshness`):** Phân tích độ trễ thực tế của từng nguồn (BTC Price, Spot ETF, CME COT, On-chain MVRV, Macro US Net Liquidity); phát hiện nguồn cũ nhất và hiển thị dạng `Data oldest: COT 5d`; loại trừ ngày của fallback khỏi chỉ số độ tươi hoạt động.
  - **Minh Bạch Trọng Số (Transparency Disclaimer):** Thêm ghi chú khẳng định Bias Engine chỉ chứa 3% tín hiệu xu hướng giá (MA50/200 & Realized Vol); 97% còn lại độc lập từ định chế, on-chain, vĩ mô và phái sinh.
  - **Real-Time Snapshot Store (`biasSnapshotStore.js`):** Quản lý snapshot thực tế phát sinh trong phiên, có cơ chế throttling (1 phút) và giới hạn 500 bản ghi. Tuyệt đối không backfill giả lập để bảo toàn tính trung thực của dữ liệu lịch sử.
- **Files / areas chạm:** `src/services/biasEngine.js`, `src/services/biasEngine.test.js`, `src/services/biasSnapshotStore.js` (new), `src/components/MarketBiasCard.jsx`, `src/components/DashboardTab.jsx`, `src/App.css`, `README.md`.
- **Verify:** `npm test` pass 46/46 unit tests (biasEngine: 19 tests, googleSheetSync: 6 tests, moveTracker: 16 tests, macroDashboard: 5 tests); `npm run build` thành công 100% (7.92s).

### [2026-08-26] Đại Tu Toàn Diện Data Integrity & Triệt Tiêu Fake Hard-Code / Fallback Masquerading Trong Bias Engine & Google Sheets Worker `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & DATA INTEGRITY
- **Tóm tắt:** Triệt tiêu hoàn toàn hiện tượng worker Google Sheets và browser dùng dữ liệu tĩnh/hard-code fake (ETF 1.25M BTC, ETF flow 4 phiên cố định, CME COT 19/08/2026, DXY 103.5, VIX 15.5, S&P 500 5,900) mà vẫn báo "Hoàn thiện 100%"; tích hợp Data Provenance Gate vào Bias Engine (chỉ tính Confidence từ dữ liệu LIVE/LAGGED_VALID thực tế; loại bỏ 100% trọng số của fallback); chuẩn hóa đơn vị Mining Cost (Trillion vs Raw Difficulty) và bảo vệ CPI FRED YoY (`pc1` units vs unscaled raw index); chuyển worker `syncGoogleSheet.mjs` sang dùng chung pipeline fetcher thực tế với browser (CVD đa khung 24h/7d/30d, L/S history, OI history, live Bitbo ETF, live CFTC COT, Yahoo Finance realtime).
- **Thay đổi chính:**
  - **Data Provenance & Zero-Fallback Gate (`biasEngine.js`):** Thêm hàm `isItemFallback()`. Toàn bộ tín hiệu fallback (`isFallback: true` hoặc `status: 'FALLBACK'/'UNAVAILABLE'`) tự động bị loại khỏi `availableWeight` và gán nhãn `0% (FALLBACK)`. Chỉ số Confidence % được tính nghiêm ngặt từ tỷ lệ trọng số thực (`availableWeight / 0.95 * 100`).
  - **Đồng bộ Live Pipeline Cho Standalone Worker (`syncGoogleSheet.mjs`):** Xóa bỏ 100% biến mock fake. Tích hợp các fetcher thực tế từ `api.js`: Tickers, Klines, CVD Đa khung (Spot/Futures 24h/7d/30d), OI history, L/S history, OBI Depth 100 & Whale Walls, Blockchain.info stats, CoinMetrics MVRV (BTC/ETH), SSR MA, DefiLlama stablecoins, Yahoo Finance (DXY, VIX, S&P 500, QQQ, US 10Y Yield), Bitbo ETF Holdings, Farside ETF Flows, và CFTC CME COT.
  - **Sửa Đơn vị Mining Difficulty & CPI YoY Fred:** Chuẩn hóa tự động `calculateBtcProductionCostRange` và `estimateBtcProductionCost` cho cả 2 định dạng độ khó (Trillion `< 1e6` và Raw `> 1e6`). Thêm sanity guard cho CPI FRED: loại bỏ các giá trị chỉ số raw thô `> 50` để tránh ngộ nhận điểm lạm phát.
  - **Kiểm định Độ Đầy Đủ Trung Thực (`googleSheetSync.js`):** Cập nhật `validateExportReadiness()` quét 14 chiều dữ liệu thực; tự động trừ điểm `completenessScore` và sinh cảnh báo minh bạch khi phát hiện fallback/chưa tải được dữ liệu.
  - **Bảo Vệ Bộ Nhớ Đệm (`cache.js`):** Thêm `maxStaleAgeMs` (giới hạn tối đa 7 ngày) và cờ `isStale` để ngăn chặn cache quá hạn giả mạo làm dữ liệu tươi mới.
- **Files / areas chạm:** `src/services/api.js`, `src/services/biasEngine.js`, `src/services/biasEngine.test.js`, `src/services/googleSheetSync.js`, `src/services/googleSheetSync.test.js`, `src/utils/cache.js`, `scripts/syncGoogleSheet.mjs`, `src/App.jsx`, `README.md`.
- **Verify:** `npm test` pass 38/38 unit tests (biasEngine: 11 tests, googleSheetSync: 6 tests, moveTracker: 16 tests, macroDashboard: 5 tests); `npm run sync:sheets:dry` pass 100% với dữ liệu live thực tế (DXY 99.15, VIX 15.54, SP500 7678.80, ETF live rows appended, độ hoàn thiện 93%); `npm run build` thành công 100%.

### [2026-08-26] Nâng Cấp Toàn Diện Market Bias Engine & Tích Hợp Macro Liquidity / BTC Trend Regime `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & QUANT REFACTOR
- **Tóm tắt:** Nâng cấp toàn diện công thức định lượng của Market Bias Engine; khắc phục lỗi parsing object VIX, xóa bỏ tính trùng lặp MVRV (triple-counting), đưa Macro Liquidity (DXY, 10Y Yield, Net Liquidity, High-Yield Spread, Equities) và 1.000 nến Daily BTC (MA50/200, Slopes, Momentum, Realized Vol) vào tính điểm thực tế; đồng bộ 100% logic tính toán giữa Web Dashboard và GitHub Actions Google Sheets Worker.
- **Thay đổi chính:**
  - **Sửa VIX & Parity Sync:** Đọc an toàn `data.vix?.price ?? data.vix?.val ?? data.vix`. Chuyển `syncGoogleSheet.mjs` sang import trực tiếp `calculateMarketBias` từ `biasEngine.js`, loại bỏ hoàn toàn các biến mock hard-code.
  - **Triệt tiêu MVRV Triple-Count:** Chuyển MVRV thành mỏ neo định giá duy nhất (8%), không cộng dồn thêm điểm từ NUPL (4%) và Supply in Profit (3%). Phân bổ trọng số cho SSR Oscillator (5%), Active Addresses (4%), Mining Cost Floor (4%), và On-chain Network Tx Demand (4%).
  - **Trụ cột 3 (Vĩ mô & Thanh khoản - 20%):** Tích hợp Monetary Pulse (6%), US Net Liquidity `(Walcl - TGA - RRP)` & High-Yield Credit Spread (5%), DXY & US 10Y Yield (4%), S&P500/QQQ Equities Risk Appetite (2%), VIX & 24h High Impact Calendar Event Dampening (3%).
  - **Trụ cột 4 (Vi cấu trúc & Trend Regime - 15%):** Tính toán MA50, MA200, MA50 Slope, 7D/30D/90D Returns và 30D Realized Volatility từ nến daily Binance. Nâng cấp kiểm định chéo Funding Rate âm: nếu đi kèm Spot CVD gom hàng $\rightarrow$ Short Squeeze; nếu đi kèm Spot CVD xả hàng $\rightarrow$ Xác nhận Downtrend thực.
  - **Phân tầng 3 lớp Bias (3-Layer Regime):** Xuất ra và hiển thị trực quan `Valuation Bias` (Rẻ/Đắt), `Trend Bias` (Xu hướng cấu trúc MA), `Macro Liquidity` (Mở rộng/Co hẹp), và `Tactical Bias` (Chiến thuật ngắn hạn) trên cả UI Card và Google Sheets export.
- **Files / areas chạm:** `src/services/biasEngine.js`, `src/services/biasEngine.test.js` (new), `src/components/MarketBiasCard.jsx`, `src/services/googleSheetSync.js`, `scripts/syncGoogleSheet.mjs`, `package.json`, `README.md`.
- **Verify:** `npm test` pass 38/38 unit tests (5 test suites: scanner, move, macro, sheets, bias); `npm run sync:sheets:dry` pass 100% với điểm +49 Bullish; `npm run build` thành công 100% (5.95s).

### [2026-08-23] Tái Cấu Trúc Trọng Số Total Bias Engine (40% Định Chế - 25% On-Chain - 20% Vĩ Mô - 15% Vi Mô) `(FEATURE FAST)`
- **Lane / Mode:** FEATURE FAST & QUANT MODEL
- **Tóm tắt:** Tái cân bằng hệ thống trọng số của Market Bias Engine từ mô hình vi cấu trúc ngắn hạn (40% Micro cũ) sang mô hình theo dấu dòng tiền định chế và định giá chu kỳ bền vững, triệt tiêu hiện tượng nhiễu tín hiệu (data whipsaw/whiplash).
- **Thay đổi chính:**
  - **Dòng tiền Định chế (40%):** Spot ETF 7-Day Net Flow (28%), CME COT Institutional Asset Managers (12%).
  - **Dữ liệu On-Chain & Định giá (25%):** MVRV Ratio (9%), NUPL (4%), SSR (4%), Supply in Profit (3%), Active Addresses (3%), Mining Cost Floor (2%).
  - **Vĩ mô & Môi trường Rủi ro (20%):** Macro Pulse Fed/CPI/Unemployment (14%), VIX Volatility Index (6%).
  - **Vi cấu trúc thị trường (15%):** Spot CVD (4%), Futures CVD (3%), Funding Rate (3%), Open Interest & Price Action (2%), Fear & Greed (2%), Long/Short Ratio (1%).
  - Đồng bộ thứ tự, trọng số, thang đo `fillRatio` và hiển thị trên thẻ `MarketBiasCard.jsx`, `googleSheetSync.js` và `syncGoogleSheet.mjs`.
- **Files / areas chạm:** `src/services/biasEngine.js`, `src/components/MarketBiasCard.jsx`, `src/services/googleSheetSync.js`, `scripts/syncGoogleSheet.mjs`, `README.md`.
- **Verify:** `node --test` pass 32/32 unit tests; `npm run build` thành công 100% (9.27s).

### [2026-08-22] Khôi Phục Ô Nhập Khóa Gemini API Key Trong Modal Cài Đặt `(FEATURE FAST)`
- **Lane / Mode:** FEATURE FAST & UI SETTINGS
- **Tóm tắt:** Bổ sung lại trường nhập khóa `GEMINI API KEY (GOOGLE AI STUDIO)` vào modal Cài đặt hệ thống (`App.jsx`), bảo đảm người dùng có thể cấu hình và lưu trực tiếp key vào `localStorage` phục vụ tính năng AI Decision Lab & AI Prompt Staging.
- **Thay đổi chính:** Thêm `settings-modal-input-group` cho Gemini API key với link lấy key từ Google AI Studio (`aistudio.google.com`) và cập nhật mô tả hướng dẫn.
- **Files / areas chạm:** `src/App.jsx`, `README.md`.
- **Verify:** `npm test` pass 28/28 tests; `npm run build` pass (7.65s).

### [2026-08-21] Tích Hợp Google Sheets Auto-Sync 3 Phiên Qua GitHub Actions & Webhook `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & DATA PIPELINE
- **Tóm tắt:** Xây dựng cơ chế tự động tổng hợp toàn bộ chỉ số định lượng, vĩ mô và phái sinh lên Google Sheets công khai 3 lần/ngày (theo phiên Á, Âu, Mỹ) phục vụ AI phân tích tự động.
- **Thay đổi chính:**
  - **Google Apps Script Webhook (`google-apps-script/Code.gs`):** Tiếp nhận dữ liệu, tự động xóa và ghi đè 5 Tab dữ liệu (`OVERVIEW_BIAS`, `DERIVATIVES_FLOW`, `ETF_ONCHAIN`, `MACRO_CALENDAR`, `AI_PROMPT_SUMMARY`) với giao diện bảng kẻ viền, header màu và tự căn chỉnh độ rộng cột.
  - **Node.js Aggregator (`scripts/syncGoogleSheet.mjs`):** Script cào dữ liệu từ Binance, DefiLlama, Fear & Greed, FairEconomy, tính điểm Bias Engine và hỗ trợ cờ `--dry-run`.
  - **GitHub Actions Cron (`.github/workflows/sync-sheets.yml`):** Tự động kích hoạt vào 08:00 (Á), 14:00 (Âu), 20:00 (Mỹ) hoàn toàn miễn phí trên Cloud mà không cần mở trình duyệt hay ảnh hưởng Vercel.
  - **Client Sync & Settings Modal:** Thêm trường cấu hình Webhook URL trong Settings và nút `SYNC SHEET` trên Header Web App để kích hoạt đồng bộ tức thì.
- **Files / areas chạm:** `scripts/syncGoogleSheet.mjs`, `google-apps-script/Code.gs`, `.github/workflows/sync-sheets.yml`, `src/services/googleSheetSync.js`, `src/services/googleSheetSync.test.js`, `src/App.jsx`, `package.json`, `README.md`.
- **Ảnh hưởng README:** §1 / §2 / §3 / §4.
- **Verify:** `npm run sync:sheets:dry` thành công; `npm test` pass 28/28 tests; `npm run build` thành công 100% (1.68s).

### [2026-08-21] Redesign MOVE TRACKER Thành Decision-Friendly Interface `(UX + RESEARCH SAFETY)`
- **Tóm tắt:** Chuyển MOVE TRACKER từ màn hình research nhiều thuật ngữ thành giao diện giải thích theo thứ tự: hệ thống vừa quan sát gì, ý nghĩa là gì, điều gì không được suy ra và cần theo dõi gì tiếp theo.
- **Decision layer:** Bổ sung các trạng thái mô tả `XUNG LỰC VỪA XUẤT HIỆN`, `XUNG LỰC ĐƯỢC XÁC NHẬN` và `THEO DÕI CHUYỂN REGIME`. `REGIME WATCH` chỉ xuất hiện khi event có dữ liệu đầy đủ, tier `CONFLUENT`, flow `SPOT_CONFIRMED` và cấu trúc 1h đồng thuận; tuyệt đối không dùng outcome hậu sự kiện để tạo trạng thái.
- **Information hierarchy:** Đưa bốn bằng chứng chính lên trước gồm cường độ, nguồn dòng tiền, bối cảnh đa khung và chất lượng dữ liệu. Raw CVD, ATR threshold, OI/Funding/OBI, detection scores và outcome +5m/+15m được thu gọn vào `Xem dữ liệu nghiên cứu và outcome ngắn hạn`.
- **Ngôn ngữ & lịch sử:** Dịch nhãn kỹ thuật thành diễn giải tiếng Việt, làm rõ PUMP/DUMP chỉ là xung lực đã xảy ra, thêm guardrail “không dự báo giá chắc chắn tiếp tục”, và nâng cấp Event Log thành diễn giải tại trigger.
- **Responsive:** Decision brief chuyển từ hai cột sang một cột trên mobile; evidence grid thích nghi 4 → 2 → 1 cột.
- **Verify:** MOVE TRACKER tests pass 16/16; production build pass. Visual QA desktop xác nhận hierarchy mới hiển thị đúng; lint toàn repo vẫn bị chặn bởi 174 lỗi tồn tại sẵn ngoài phạm vi thay đổi.
- **Files / areas chạm:** `src/services/moveTrackerCore.js`, `src/services/moveTrackerCore.test.js`, `src/components/HftRadarTab.jsx`, `src/App.css`, `README.md`.

### [2026-08-16] Nâng Cấp MOVE TRACKER Thành Realtime Detector + Research Log `(FEATURE FULL)`
- **Tóm tắt:** Sửa lỗi runtime `getMoveReports is not defined`, thay persistence 50 event/7 ngày bằng IndexedDB 90 ngày, và tách dữ liệu tại trigger khỏi end/recovery/forward outcome để loại lookahead khỏi research log.
- **Detection integrity:** ATR(14) chuyển sang Binance USD-M Futures 5m, chỉ dùng nến đã đóng, có trạng thái LIVE/STALE/UNAVAILABLE; champion ATR/Fixed tiếp tục tạo event như trước, còn participation và Spot/Futures flow chỉ chạy shadow.
- **Event schema v2:** Ghi đủ score `15/30/60/120s`, trigger snapshot bất biến, end snapshot, outcome `+15s/+30s/+60s/+5m/+15m`, MFE/MAE, data gap, OI/Funding/OBI và context closed-candle `5m/15m/1h`.
- **Nhãn mô tả:** Thay pseudo-causal Whale Push/Stop Hunt/Liquidity Sweep bằng flow labels `SPOT_CONFIRMED/FUTURES_LED/SPOT_LED/MIXED_FLOW/DATA_INCOMPLETE` và outcomes `CONTINUATION/PARTIAL_RETRACE/MEAN_REVERSION`.
- **Research UI:** Bổ sung bảng thống kê hai lớp, sample-size warning `N<30`, event filters và export CSV/JSON; không hiển thị confidence giả xác suất.
- **Verify:** `npm test` pass 19 tests; `npm run build` pass; browser local xác nhận ATR Futures LIVE, research/migration hiển thị và không còn lỗi `getMoveReports`.
- **Files / areas chạm:** `src/services/moveTracker.js`, `src/services/moveTrackerCore.js`, `src/services/moveEventStore.js`, `src/services/atrCalculator.js`, `src/components/HftRadarTab.jsx`, `src/App.css`, tests, `package.json`, `README.md`.

### [2026-08-01] Bổ Sung Chú Thích Trực Quan Cho Volume Bubbles Dưới Chân Biểu Đồ Advanced Chart `(FEATURE FAST)`
- **Lane / Mode:** FEATURE FAST & UI LEGEND
- **Tóm tắt:** Bổ sung dòng chú thích chi tiết cho chỉ báo Volume Bubbles ở phần footer của `AdvancedChart.jsx`, giúp người dùng dễ dàng phân biệt màu sắc Taker Delta (Xanh = Buy, Đỏ = Sell, Vàng = Neutral) và ký hiệu Price Action (Hình thoi = Initiative / Phá vỡ, Hình tròn = Absorption / Hấp thụ).
- **Thay đổi chính:** Cập nhật nội dung thẻ chú thích `hft-empty font-mono` tại chân biểu đồ Advanced Chart.
- **Files / areas chạm:** `src/components/AdvancedChart.jsx`, `README.md`
- **Ảnh hưởng README:** §4 (đã thêm log mới).
- **Verify:** Chú thích hiển thị rõ ràng, màu sắc khớp chính xác với thuật toán vẽ Bubble.

### [2026-08-01] Loại Bỏ Toàn Bộ Mã Nguồn Tín Hiệu Signal Log Theo Yêu Cầu `(CLEANUP)`
- **Lane / Mode:** REFACTOR & CODE CLEANUP
- **Tóm tắt:** Xóa sạch toàn bộ mã nguồn, dịch vụ, component UI và CSS liên quan đến module Signal Log (`SignalLogPanel`, `signalEngine.js`, `signalStore.js`, `hft_signal_log`) theo yêu cầu người dùng để tinh gọn hệ thống và giảm tải overhead.
- **Thay đổi chính:**
  - **Xóa file dịch vụ:** Xóa `src/services/signalEngine.js` và `src/services/signalStore.js`.
  - **Dọn dẹp HftRadarTab & MoveTracker:** Gỡ bỏ component `SignalLogPanel`, các state/effect phát hiện tín hiệu định kỳ trong `HftRadarTab.jsx`, và bỏ gọi `addSignal` trong `moveTracker.js`.
  - **Dọn dẹp Context & CSS:** Xóa key `hft_signal_log` khỏi `ModuleVisibilityContext.jsx` và toàn bộ block CSS `.signal-log-*` khỏi `App.css`.
- **Files / areas chạm:** `src/context/ModuleVisibilityContext.jsx`, `src/services/moveTracker.js`, `src/components/HftRadarTab.jsx`, `src/App.css`, `src/services/signalEngine.js` (deleted), `src/services/signalStore.js` (deleted), `README.md`
- **Verify:** `npm run build` thành công 100% (4.52s, 0 errors).

### [2026-08-01] Xây Dựng Lại Thuật Toán Phân Tích Volume Bubble Nâng Cao (Robust Z-Score & Price Impact) `(FEATURE FULL)`
- **Lane / Mode:** FEATURE FULL & VOLUME ANOMALY
- **Tóm tắt:** Nâng cấp toàn diện bộ lọc Volume Bubble trên Advanced Chart. Thay thế thuật toán Standard Deviation cũ bằng Robust Z-Score (Rolling Median & MAD) để hạn chế nhiễu từ các đuôi dài của Volume. Đưa vào đánh giá Price Impact (Initiative vs Absorption) thông qua hệ số Displacement so với ATR. Đồng thời tính toán delta bằng Taker Volume để xác định chính xác phe Mua/Bán chủ động.
- **Thay đổi chính:**
  - **Data Layer (api.js & WS):** Cập nhật `getBTCKlines` và WebSocket stream để lấy thêm `quoteVolume`, `takerBuyQuoteVolume` và trạng thái đóng nến `isClosed`.
  - **Thuật toán Volume (AdvancedChart.jsx):** Chuyển tính toán Z-Score sang dùng log của Quote Volume. Tính Median và Median Absolute Deviation (MAD) trên cửa sổ 60 nến gần nhất (chỉ dùng nến đã đóng). Phân tích NMS (Non-Maximum Suppression) loại bỏ bubble ảo liên tiếp.
  - **Giao diện Bubble Mới:** Render bán kính bubble mượt mà hơn. Đổi màu linh hoạt theo Taker Volume Delta (Xanh = Buy, Đỏ = Sell, Vàng = Neutral). Ký hiệu Hình thoi cho Initiative (phá vỡ giá) và Hình tròn cho Absorption (hấp thụ).
- **Files / areas chạm:** `src/services/api.js`, `src/components/AdvancedChart.jsx`, `README.md`
- **Ảnh hưởng README:** §1, §3, §4 (đã thêm log mới).
- **Verify:** Cập nhật thành công, logic tính toán không báo lỗi, bubble chỉ hiển thị tại những nến đã đóng.

### [2026-07-31] Chuyển Đổi Chỉ Báo BTC SSR Sang Mô Hình Chuẩn Glassnode SSR Oscillator (Z-Score) `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & ON-CHAIN MODELING
- **Tóm tắt:** Loại bỏ mô hình Fair Price tự chế không có cơ sở lý thuyết; chuyển đổi chỉ báo BTC SSR thành mô hình chuẩn Glassnode SSR Oscillator dựa trên Z-Score (SMA200 & ±2σ Bollinger Bands). Đồng thời đồng bộ dữ liệu vốn hóa stablecoin từ DefiLlama cho cả SSR realtime và SSR MA.
- **Thay đổi chính:**
  - **Tính Toán Z-Score Dynamic (`api.js`):** Mở rộng `getSsrMovingAverageData` truy vấn 200 ngày dữ liệu klines Binance & DefiLlama stablecoin aggregate, tính toán SMA200, StdDev và Z-Score.
  - **Redesign UI MetricCard (`App.jsx`):** Bỏ hiển thị M1/M2 Fair Price (Est $xxxk). Thay thế bằng SSR realtime, SMA200 và Z-Score với phân vùng màu sắc trực quan (Mua mạnh / Vùng mua / Rủi ro / Bán mạnh).
  - **Cập Nhật Tooltip & Backtest (`Tooltip.jsx` & Walkthrough):** Cập nhật mô tả giải thích thuật toán Z-Score Oscillator. Thực hiện backtest 1000 ngày quá khứ xác nhận tín hiệu đảo chiều chính xác tại các mốc đáy $53k và đỉnh $101k.
- **Files / areas chạm:** `src/services/api.js`, `src/App.jsx`, `src/components/Tooltip.jsx`, `README.md`
- **Ảnh hưởng README:** §1, §3, §4 (đã thêm log mới).
- **Verify:** `npm run build` pass (1.42s); backtest lịch sử cho tín hiệu Z-Score khớp chính xác với biến động đỉnh/đáy của BTC.

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

### [2026-08-23] Gộp CVD FUTURES & SPOT Thành Một View Song Song `(REFACTOR)`
- **Lane / Mode:** REFACTOR & UX MERGE
- **Tóm tắt:** Loại bỏ bộ tab chuyển đổi `FUTURES`/`SPOT` trong panel **CVD & Order Flow**, gộp thành một view duy nhất hiển thị song song cả hai thị trường để tiện đối chiếu, so sánh phân kỳ và đánh giá xu hướng dòng tiền.
- **Thay đổi chính:**
  - **Biểu Đồ 2 Đường CVD (`HftRadarTab.jsx`):** Chart hiển thị đồng thời đường `FUTURES` (tím `#a78bfa`) và `SPOT` (xanh `#34d399`) trên cùng trục thời gian; tooltip hiển thị giá trị cả hai thị trường kèm giá BTC.
  - **Hero Dual Values (`HftRadarTab.jsx`):** Hiển thị song song `CVD RÒNG FUTURES` và `CVD RÒNG SPOT` cho cùng khung thời gian.
  - **Dual Volume Gauges (`HftRadarTab.jsx`):** Hai thanh Volume Ratio Buy/Sell độc lập (Futures & Spot) xếp dọc để so sánh áp lực mua/bán hai thị trường.
  - **Dual Footprint Tables (`HftRadarTab.jsx`):** Trích xuất component `FootprintSection`, render hai bảng Footprint Nodes (FUTURES & SPOT) dùng chung slider `FOOTPRINT GAP`; fetch nodes + completed-hour CVD song song qua `Promise.all` cho cả hai market.
  - **Hook `useMarketCvdSeries` + `useSessionDelta` (`HftRadarTab.jsx`):** Tái cấu trúc logic series CVD / delta realtime / displayVol thành hook dùng chung, chạy độc lập cho từng thị trường; xóa state `marketMode` và localStorage key `hft_cvd_market`.
- **Files / areas chạm:** `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (10.33s); panel hiển thị đồng thời CVD Futures & Spot trên cùng biểu đồ.

### [2026-08-23] Trục Y Kép Cho Biểu Đồ CVD & Tooltip Gộp 2 Thị Trường `(FEATURE)`
- **Lane / Mode:** FEATURE FAST & CHART UX
- **Tóm tắt:** Biểu đồ CVD chuyển sang trục Y kép: trục trái (tím) là quy mô CVD **Futures**, trục phải (xanh) là quy mô CVD **Spot** — mỗi thị trường có thang đo riêng vì chênh lệch lớn về volume. Tooltip gộp chung hiển thị đồng thời giá trị cả hai thị trường khi hover vào bất kỳ điểm nào.
- **Thay đổi chính:**
  - **Dual Y-Axes (`HftRadarTab.jsx`):** Thêm scale `y1` position right cho SPOT (`drawOnChartArea: false`), tick màu đồng bộ màu đường line tương ứng; axis tự ẩn khi market không có dữ liệu.
  - **Merged Tooltip (`HftRadarTab.jsx`):` Đặt `interaction/tooltip mode: 'index'` để một lần hover hiện cả FUTURES + SPOT kèm giá BTC.
- **Files / areas chạm:** `src/components/HftRadarTab.jsx`, `README.md`
- **Verify:** `npm run build` pass (3.63s); hover 1 điểm hiện tooltip gộp cả hai thị trường, hai trục Y có thang độc lập.

### [2026-08-23] Nâng Cấp ADVANCED PRICE ACTION: Info Chip, Wall Aging, Alert & Crosshair Sync `(FEATURE)`
- **Lane / Mode:** FEATURE UX/UI + WALL INTELLIGENCE
- **Tóm tắt:** Gói nâng cấp lớn cho panel **Advanced Price Action**: (UX) info chip POC/VAH/VAL kèm % distance + trạng thái Value Area, axis label cho POC & wall mạnh nhất, hover tooltip chi tiết từng price line, wall aging theo thời gian tồn tại, gom toolbar thành nhóm [Nav] | [Overlays ▾] | 🔔 Alert | TF, alert khi giá chạm mốc; (Tính năng) phát hiện wall bị **EATEN/PULLED** kèm event feed, đồng bộ crosshair AdvancedChart → CVD Panel.
- **Thay đổi chính:**
  - **Info Chip Overlay (`AdvancedChart.jsx`):** Badge `POC/VAH/VAL + %distance` ở góc trái chart, tự đổi màu + hiển thị `IN VA / ABOVE VA / BELOW VA` theo vị trí giá realtime.
  - **Hover Highlight & Tooltip (`AdvancedChart.jsx`):** Crosshair detect price line gần nhất trong bán kính 6px → tooltip nổi (giá, USD, số lệnh, tuổi wall, cảnh báo ăn mòn); registry tách `staticLinesRef` (POC/LIQ) và `wallRegRef` (walls).
  - **Wall Aging (`AdvancedChart.jsx`):** Wall mới (<45s) mờ + icon 🆕, wall ≥5 phút đậm + lineWidth 2 + icon ⏳ + số phút trên title; axis label bật cho wall có USD lớn nhất.
  - **Wall Lifecycle Detection (`AdvancedChart.jsx`):** Track lịch sử wall qua `wallHistoryRef` — USD giảm >50% → event `EATEN`, mất khỏi top list ≥4s → `PULLED`, xuất hiện mới → `NEW`; hiển thị **WALL EVENTS feed** co giãn được dưới chart.
  - **Price Alert (`AdvancedChart.jsx`):** Toggle 🔔 (persist localStorage) — giá chạm POC/Wall/Liq trong biên 0.15% → toast góc phải chart, cooldown 2 phút mỗi mốc chống spam.
  - **Toolbar Regroup (`AdvancedChart.jsx`):** Chia nhóm Navigation (OFF/Latest/Auto), dropdown Overlays (Walls/Liq/Vol/TPO/Wall W), Alert, TF.
  - **Crosshair Sync (`services/crosshairSync.js`, `HftRadarTab.jsx`):** Service pub/sub nhẹ — hover nến trên AdvancedChart phát `{timeMs}`; CVD Panel tìm điểm gần nhất, vẽ đường dọc vàng (plugin `cvdSync`) + chip `⌖ time · F $ · S $` hiển thị CVD Futures/Spot tại đúng thời điểm đó để đối chiếu phản ứng giá vs dòng tiền.
- **Files / areas chạm:** `src/components/AdvancedChart.jsx`, `src/components/HftRadarTab.jsx`, `src/services/crosshairSync.js` (mới), `README.md`
- **Verify:** `npm run build` pass (2.38s); chip VA cập nhật realtime, hover line hiện tooltip, wall events log NEW/EATEN/PULLED, crosshair chart sync sang CVD panel.

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
