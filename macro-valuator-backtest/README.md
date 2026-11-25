# Macro Valuator + PnL Matrix · Pine Parity Backtest

Folder độc lập (zero external runtime dependencies, Node.js >= 18 ESM) tách toàn bộ logic tính toán từ `Macro Dashboard v2` (`src/services/macroDashboardEngine.js`) và `getBTCMacroKlines` (`src/services/api.js`) để chạy backtest định lượng hoàn toàn tách biệt khỏi app React.

## Cấu trúc thư mục

```text
macro-valuator-backtest/
├── package.json         # Standalone ESM package (Node >= 18, no npm install required)
├── README.md
├── src/
│   ├── engine.js        # Logic Valuator + PnL Matrix (100% Pine parity, strictly causal)
│   ├── dataLoader.js    # Tải Binance Spot klines (data-api.binance.vision) hoặc đọc CSV/JSON
│   ├── backtester.js    # Forward return studies, Strategy simulation, DCA comparison, CSV/JSON export
│   └── cli.js           # Command-line runner
└── test/
    ├── engine.test.js   # Kiểm tra Pine parity & causal no-lookahead invariance
    └── backtester.test.js
```

## Chạy nhanh

Di chuyển vào folder `macro-valuator-backtest`:

```bash
cd macro-valuator-backtest
```

### 1. Chạy bộ test (parity + causality + backtest math)

```bash
npm test
```

### 2. Chạy backtest mặc định (tự tải dữ liệu BTCUSDT khung W từ Binance & cache vào `./data`)

```bash
node src/cli.js
```

### 3. Các ví dụ tùy biến tham số

```bash
# Chạy khung Ngày (D), dùng dữ liệu có sẵn trong CSV/JSON
node src/cli.js --input ./data/btc_daily.csv --timeframe D --horizons 30,90,180,365

# Chỉ định khoảng thời gian & phí giao dịch (bps), lưu kết quả vào thư mục riêng
node src/cli.js --timeframe W --from 2019-01-01 --to 2026-01-01 --fee-bps 10 --out-dir ./outputs/btc_w_2019

# Thử nghiệm thay đổi cấu hình Pine parity
node src/cli.js --cost-method EMA --weight-scheme Short-heavy --z-mode Adaptive --no-hysteresis

# Khớp giá đóng cửa (close) thay vì giá mở cửa nến kế tiếp (next_open)
node src/cli.js --exec close
```

## Các chiến lược tích hợp sẵn

1. **`buy_and_hold`**: Benchmark giữ 100% tài sản trong toàn bộ cửa sổ đánh giá.
2. **`regime_long_flat`**: Mua 100% khi `ACCUMULATE` / `STRONG ACCUM` (`composite >= +1`, không divergence), thoát về cash khi `DISTRIBUTE` / `STRONG DIST` (`composite <= -1`, không divergence).
3. **`extreme_reversal`**: Chỉ vào lệnh ở vùng cực trị `STRONG ACCUM` (`composite >= +3`), thoát ở `STRONG DIST` (`composite <= -3`).
4. **`composite_allocation`**: Tỷ trọng động theo composite score (`+3/+4 -> 100%`, `+1/+2 -> 75%`, `0 -> 50%`, `-1/-2 -> 25%`, `-3/-4 -> 0%`, giữ nguyên khi divergence).
5. **`valuator_only`** & **`pnl_only`**: Tách riêng từng module để đối chiếu xem việc kết hợp cả hai có cải thiện Sharpe/MaxDD hay không.
6. **Equal DCA vs Value-Weighted DCA**: So sánh DCA đều ($1,000/bar) với DCA theo hệ số định giá (`2.0x` ở `STRONG ACCUM`, `1.5x` ở `ACCUMULATE`, `1.0x` ở `NEUTRAL`, `0.5x` ở `DISTRIBUTE`, `0x` ở `STRONG DIST`, phần tiền chưa giải ngân giữ ở cash reserve để dồn mua ở vùng rẻ).

## File xuất ra (`./outputs`)

- `summary.json`: Meta, snapshot mới nhất, bảng thống kê forward return theo Decision / ValZone / PnLZone / Alert, kết quả các chiến lược và DCA.
- `series.csv`: Toàn bộ chuỗi thời gian theo từng nến (`fairValue`, `bandUpper`, `bandLower`, `valZLong`, `valZShort`, `weightedAverage`, `percentile`, `valZone`, `pnlZone`, `composite`, `decision`, ...).
- `trades.csv`: Nhật ký khớp lệnh chi tiết của từng chiến lược.
