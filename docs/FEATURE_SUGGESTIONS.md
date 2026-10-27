# Gợi Ý Tính Năng Mới — Roadmap Bổ Sung

> Ngày lập: 2026-10-26
> Bối cảnh: Hệ thống đã mạnh về thu thập & hiển thị số liệu (21+ module, CVD ledger bất biến, scanner snapshot, Sheets sync 3 phiên). Ba khoảng trống lớn nhất về mặt sản phẩm:
> 1. **Thụ động** — phải mở app mới biết điều gì xảy ra, chưa có alert/push.
> 2. **Chưa kiểm chứng edge** — chưa có chỗ nào đo tín hiệu nào thực sự có giá trị dự báo.
> 3. **Thiếu vài nguồn dữ liệu free quan trọng** (liquidation thực, options ETH, funding đa sàn).
>
> Mọi gợi ý dưới đây tận dụng hạ tầng sẵn có: GitHub Actions, Google Apps Script webhook, IndexedDB, tiered sync (HOT/WARM/COLD), openrouter AI.

---

## Nhóm 1 — Biến dashboard thụ động thành chủ động (ưu tiên làm đầu tiên)

### 1. Alert Center + Push (Telegram / Discord / Web Notification) ⭐
- **Giá trị:** cao nhất; không cần nguồn dữ liệu mới.
- **Nội dung:** lớp luật cảnh báo chạy trên các tín hiệu sẵn có:
  - Bias vượt ngưỡng (±60)
  - Funding cực trị
  - ΔOI spike
  - Giá chạm Max Pain / Call Wall / Put Wall
  - Move Tracker trigger event
  - Scanner rank nhảy vào top 10
  - Sự kiện kinh tế HIGH sắp diễn ra (T-60 phút)
- **Kiến trúc:** thêm 1 phiên GitHub Actions (mỗi 5–15 phút) tái dùng `biasEngine` + Binance REST, đẩy qua Telegram Bot. Hạ tầng `scripts/syncGoogleSheet.mjs` đã có gần hết.

### 2. PWA (cài làm app trên điện thoại)
- **Giá trị:** mobile đã responsive tốt (đã test 390px); chỉ thiếu manifest + service worker.
- **Nội dung:** cài lên home screen, chạy offline khi mất mạng, và là nền tảng nhận **push notification** từ Alert Center khi tab đóng.

---

## Nhóm 2 — Kiểm chứng "edge" (đúng tinh thần định lượng của dự án)

### 3. Signal Scoreboard — Backtest tự động các tín hiệu hiện có ⭐
- **Giá trị:** trả lời câu hỏi app chưa trả lời được: *"Capital Flow = IN + Spot Confluence trong 90 ngày qua → giá thường đi tiếp bao nhiêu % sau 24h?"*
- **Nội dung:** thống kê hit-rate / median forward return cho từng tín hiệu:
  - Capital Flow classification (IN/OUT + Spot Alignment)
  - Bias regime
  - Scanner rank (từ snapshot đã lưu trên nhánh `codex/scanner-data`)
  - Move Tracker outcomes (đã lưu +15s/+30s/+60s/+5m/+15m trong 90 ngày IndexedDB)
- **Nguồn dữ liệu:** đối chiếu với klines Binance đã fetch sẵn; tuân thủ nguyên tắc **no-look-ahead** hiện có.

### 4. Bias History trang sâu
- **Hiện trạng:** `biasHistoryService` đã tính correlation bias–giá.
- **Nội dung:** mở rộng thành overlay Bias vs Price + phân phối forward return theo từng bucket bias (7d / 30d).

---

## Nhóm 3 — Dữ liệu mới, effort thấp

### 5. Liquidation feed THỰC (stream `btcusdt@forceOrder`) ⭐
- **Hiện trạng:** liquidity zones hiện là **ước tính** từ mật độ đòn bẩy.
- **Nội dung:** Binance WebSocket forceOrder (free) → lệnh thanh lý thật + aggregate 5m/1h; nuôi thêm context cho Move Tracker.

### 6. ETH Options Regime
- **Hiện trạng:** `deribitOptionsService` viết cho `currency=BTC`.
- **Nội dung:** thêm `currency=ETH` → có ngay GEX / Max Pain / Call-Put Walls cho ETH, gần như không viết thuật toán mới.

### 7. Funding & Basis đa sàn
- **Hiện trạng:** funding chỉ từ Binance markPrice; OBI đã đa sàn (Binance/Bybit/OKX/Bitget).
- **Nội dung:** thêm funding REST của Bybit/OKX/Bitget → funding spread + crowding cực trị (tín hiệu squeeze tốt).

### 8. Correlation Matrix đa tài sản
- **Nội dung:** BTC/ETH/SOL vs SPX / DXY / Vàng / 10Y, rolling 30d / 90d.
- **Hiện trạng:** dữ liệu Yahoo/FRED đã nằm trong tiered sync; chỉ thiếu bảng ma trận hiển thị.

---

## Nhóm 4 — AI & cá nhân hóa

### 9. AI Chat hỏi-đáp trên dữ liệu thật
- **Hiện trạng:** openrouter đã tích hợp (3 personas trong AI Decision Lab).
- **Nội dung:** cho AI ngữ cảnh = snapshot hiện tại + dữ liệu Sheets → hỏi kiểu *"tại sao bias hôm nay âm?"* và được trả lời dựa trên số liệu của chính app (kèm trích dẫn module), thay vì kiến thức chung chung.

### 10. Watchlist cá nhân
- **Nội dung:** chọn subset coin từ Scanner, theo dõi delta rank/score riêng; gắn với Alert Center (mục 1).

---

## Đề xuất lộ trình

**Bắt đầu với combo: Alert Center (1) + Signal Scoreboard (3)** — giải quyết đúng hai điểm yếu lớn nhất (thụ động, chưa kiểm chứng), không thêm nguồn dữ liệu mới.

**Cái "ăn liền" rẻ tiền:** forceOrder liquidation (5) + ETH Options (6) — làm trong một buổi là ra.
