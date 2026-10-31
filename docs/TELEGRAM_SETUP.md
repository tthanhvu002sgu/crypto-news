# Hướng dẫn cài đặt báo cáo Telegram định kỳ

Hệ thống gửi tóm tắt thị trường (giá BTC/ETH, Market Bias, funding, Fear & Greed, cảnh báo) tới Telegram **mỗi 4 giờ** qua GitHub Actions — không cần mở trình duyệt.

- Script: `scripts/sendTelegramReport.mjs`
- Workflow: `.github/workflows/telegram-report.yml` (cron `0 */4 * * *` UTC = 07:00, 11:00, 15:00, 19:00, 23:00, 03:00 giờ VN)

## Bước 1 — Tạo bot Telegram

1. Mở Telegram, tìm **@BotFather** (có dấu tích xanh).
2. Gửi lệnh `/newbot`.
3. Đặt tên hiển thị cho bot (ví dụ: `Crypto Market Report`).
4. Đặt username kết thúc bằng `bot` (ví dụ: `my_crypto_report_bot`).
5. BotFather trả về **token** dạng `123456789:AAExxxxx...` — đây là `TELEGRAM_BOT_TOKEN`. Giữ bí mật, không commit vào code.

## Bước 2 — Lấy Chat ID

1. Mở cuộc trò chuyện với bot vừa tạo, bấm **Start** (hoặc gửi `/start`).
   - Bắt buộc: bot chỉ gửi được tin cho bạn sau khi bạn đã nhắn cho nó trước.
   - Muốn nhận trong nhóm: thêm bot vào nhóm và gửi một tin nhắn bất kỳ trong nhóm.
2. Mở trình duyệt, truy cập (thay `<TOKEN>` bằng token thật):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Tìm `"chat":{"id":...}` trong kết quả — đó là `TELEGRAM_CHAT_ID`.
   - Chat cá nhân: số dương (ví dụ `123456789`).
   - Nhóm: số âm (ví dụ `-1001234567890`).
   - Nếu kết quả rỗng (`"result":[]`), gửi thêm một tin nhắn cho bot rồi tải lại trang.

## Bước 3 — Thêm GitHub Secrets

1. Vào repo GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. Bấm **New repository secret**, tạo lần lượt:
   - `TELEGRAM_BOT_TOKEN` = token từ BotFather
   - `TELEGRAM_CHAT_ID` = chat ID lấy ở Bước 2

## Bước 4 — Kiểm tra

### Test local (không cần secrets)

```bash
node scripts/sendTelegramReport.mjs --dry-run
```

In nội dung tin nhắn ra màn hình, không gửi đi.

### Test gửi thật từ máy local

Git Bash:
```bash
TELEGRAM_BOT_TOKEN="123456:AAE..." TELEGRAM_CHAT_ID="123456789" node scripts/sendTelegramReport.mjs
```

PowerShell:
```powershell
$env:TELEGRAM_BOT_TOKEN="123456:AAE..."
$env:TELEGRAM_CHAT_ID="123456789"
node scripts/sendTelegramReport.mjs
```

### Test trên GitHub Actions

1. Push code lên GitHub (workflow phải nằm trên nhánh mặc định thì cron mới chạy).
2. Vào tab **Actions** → **Telegram Market Report** → **Run workflow**.
3. Job xanh + tin nhắn tới Telegram là thành công. Các lần chạy sau tự động mỗi 4 giờ.

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân / cách sửa |
|---|---|
| `401 Unauthorized` | Token sai — kiểm tra lại `TELEGRAM_BOT_TOKEN`. |
| `400 chat not found` | Chat ID sai, hoặc bạn chưa nhắn `/start` cho bot. |
| `403 Forbidden: bot was blocked` | Bạn đã chặn bot — bỏ chặn và gửi lại `/start`. |
| Job báo thiếu secrets | Chưa thêm secrets ở Bước 3 (lưu ý chọn đúng repo). |
| Một số mục hiện `N/A` | API nguồn tạm lỗi; script vẫn gửi, bias tự chuẩn hóa lại theo dữ liệu sẵn có (confidence sẽ thấp hơn). |

## Ghi chú kỹ thuật

- Script chỉ fetch subset nhẹ (~11 nguồn: tickers, klines daily, funding/OI/long-short, CVD 24h, Fear & Greed, ETF flow) để an toàn rate limit với 6 lần chạy/ngày. Không fetch vĩ mô FRED/Yahoo/COT/on-chain — `calculateMarketBias` tự chuẩn hóa trọng số theo dữ liệu sẵn có nên score vẫn hợp lệ, kèm `confidence` phản ánh độ đầy đủ.
- Tin nhắn dùng `parse_mode: HTML` (an toàn với ký tự đặc biệt), tự cắt gọn nếu vượt giới hạn 4096 ký tự của Telegram.
- Dữ liệu WebSocket-only (liquidation realtime, HFT) không có trong báo cáo headless này.