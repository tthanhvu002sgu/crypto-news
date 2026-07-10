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
- **AI Summary & Nupl / Supply in Profit:** Tích hợp AI (Gemini) để phân tích báo cáo thị trường, tâm lý, cảnh báo các mốc kháng cự/hỗ trợ.
- **Cascade View:** Bảng theo dõi các chỉ số thanh lý (Liquidations), Long/Short Ratio, Funding Rate, Open Interest đa khung thời gian.

## 2. Kiến trúc hệ thống (System Architecture)
- **Frontend Framework:** React.js (Sử dụng Vite hoặc Create React App).
- **Biểu đồ (Charting):** `lightweight-charts` (Biểu đồ nến và các mức giá), `chart.js` & `react-chartjs-2` (Biểu đồ cột/đường cho ETF, CVD).
- **Quản lý trạng thái (State Management):** React Hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`), Context API (`ModuleVisibilityContext`).
- **Nguồn dữ liệu (Data Sources):**
  - **REST API:** Binance, Bybit, OKX, Bitget (Lấy Order Book, Klines, Funding Rate, Open Interest). Coinglass API (Lấy ETF Flows, Liquidations).
  - **WebSocket:** Binance `aggTrade` (Lấy tick-level trades để tính toán CVD, Footprint Nodes và Whale Trades realtime).
- **Lưu trữ cục bộ:** `localStorage` để lưu cấu hình giao diện người dùng (Gap, Theme, API Keys, Module Visibility, v.v.).

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
- `SummaryTab.jsx`: Bảng tóm tắt nội dung AI dựa trên dữ liệu.

### Dịch vụ (Services)
- `api.js`: File chứa hàm gọi HTTP REST API đa sàn. Đáng chú ý có `getOrderBookDepth` (gom orderbook).
- `websocket.js`: Khởi tạo và quản lý WebSocket (`useCVDStream` để lấy aggTrade).
- `coinglass.js`: Giao tiếp với API của Coinglass.

## 4. Các Task đã làm (Completed Tasks)
- [x] Gộp module `TargetLiquidityPanel` vào bên trong 100% diện tích của `AdvancedChart`.
- [x] Mở rộng `OrderBookPanel` (OBI) và đưa `WhaleTradesPanel` lên cùng một hàng lưới.
- [x] Tạo hiệu ứng Dropdown (Accordion) cho bảng Limit Walls trong Target Liquidity (Cho phép xem chi tiết các lệnh cấu thành một cụm).
- [x] Hiệu chỉnh Heatmap (Gradient/Opacity) cho giá trị Volume trong bảng Limit Walls dựa trên kích thước lệnh so với lệnh lớn nhất (Max Volume).
- [x] Thêm thông tin "Vùng giá" quét được tương ứng với số Depth (Level) được chọn bên trong bảng Order Book Imbalance (OBI).
- [x] Sửa lỗi mất đường Liq Zones trên biểu đồ Advanced Chart (Do thư viện ném lỗi khi xóa đường không tồn tại `removePriceLine`).
- [x] Tích hợp tính năng Volume Footprint (Nodes) cho thẻ CVD & Order Flow, kèm thanh trượt chọn mức Gap ($10-$1000).

## 5. Các Task chưa làm (Pending/TODO Tasks)
- [ ] *[Thêm các task sắp tới vào đây...]*

---
*Ghi chú: Mọi update từ nay về sau bắt buộc phải ghi log lại vào file này.*