# SOP Chiến Lược DCA Green Bubble (`MathClean v3`)

**Cấu hình chuẩn áp dụng:**
- **Engine:** `math_v3` (`MathClean v3`)
- **Locked TF:** `W` (Tuần)
- **Cost Basis:** `VWAP` (`RVWAP` chống nhiễu wash-trade)
- **Cohort Weight:** `Equal` (4 chu kỳ rời nhau 1Y/2Y/3Y/4Y)
- **PnL Zone:** `Percentile`
- **Z Mode:** `Structural` (MAD 4 năm)
- **Dual confirm:** `ON` (`true`)
- **Hysteresis:** `ON` (`true`)

---

## Chuẩn bị chung (Bắt buộc cho cả 2 quy tắc)

1. **Giờ kiểm tra tín hiệu cố định:** Sáng **Thứ Hai `07:00` (giờ Việt Nam, tức `00:00 UTC`)** ngay khi nến Tuần (`W`) trên Binance đóng cửa hoàn toàn. **Không nhìn nến đang chạy giữa tuần** để tránh nhiễu và repaint.
2. **Điều kiện vào lệnh duy nhất (Green Bubble):**
   - Trên biểu đồ hiện **chấm tròn xanh (`Strong Accum`)**, tức **`Score >= +3` và `Divergence = NO`**.
   - Nếu không có chấm xanh (dù là `ACCUMULATE +1/+2` hay `MIXED / WAIT`): **Tuyệt đối KHÔNG mua BTC**.
3. **Quản lý Quỹ dự phòng (`Cash Reserve`):**
   - Hàng tuần trích đúng ngân sách cố định (ví dụ `X = $1,000/tuần`) bỏ vào **Quỹ dự phòng tiền mặt `R`**.
   - Nên gửi quỹ này vào kênh sinh lời an toàn (Stablecoin Earn / T-Bill ~`4% APY`) để triệt tiêu *Cash Drag* trong 2–3 năm chờ đáy.

---

## Quy tắc 1 — Hiệu suất Tốt nhất (`GB-7: All-In 100% Reserve on Green Bubble`)

> **Mục tiêu:** Đạt giá vốn thấp nhất, ROI & XIRR cao nhất bằng cách dồn toàn bộ hỏa lực tiền mặt ngay tại tuần đầu tiên hệ thống xác nhận đáy đầu hàng.

### Các bước thực hiện
- **Bước 1 (Tích lũy quỹ):** Mỗi tuần nạp đều số tiền `$X` vào Quỹ dự phòng `R`.
- **Bước 2 (Kiểm tra sáng Thứ Hai 07:00 VN):**
  - Nếu **KHÔNG** có Green Bubble → Tiếp tục giữ `100%` tiền trong `R` hưởng lãi suất an toàn.
  - Nếu **CÓ** Green Bubble → Chuyển sang Bước 3.
- **Bước 3 (Giải ngân):**
  - Đặt lệnh **Market Buy** (hoặc Limit `-1% đến -2%` trong ngày Thứ Hai, khớp bù vào cuối ngày nếu chưa chạm) bằng **100% số tiền đang có trong Quỹ dự phòng `R`**.
  - Nếu tuần kế tiếp vẫn còn Green Bubble → Mua tiếp **100%** phần tiền `$X` mới nạp của tuần đó.
- **Bước 4 (Nắm giữ):** Sau khi hết cụm Green Bubble, chuyển toàn bộ BTC về ví lạnh/hold dài hạn và lặp lại Bước 1 cho chu kỳ tiếp theo.

### Ví dụ thực tiễn (Chu kỳ `2021–2026`, ngân sách `$1,000/tuần`)
- Từ `26/04/2021` đến `13/11/2022` (**81 tuần**): Không có Green Bubble nào → nạp đều mỗi tuần `$1,000`, tích lũy được **`R = $81,000`** tiền mặt (tránh mua khi giá rơi từ `$56,578` xuống `$16,280`).
- **Sáng Thứ Hai `21/11/2022`** (nến tuần `14/11/2022` đóng cửa ở `$16,280` bật Green Bubble đầu tiên): Giải ngân **toàn bộ `$81,000`** mua BTC ngay giá mở cửa.
- Các tuần GB tiếp theo (`21/11/2022`, `12/12/2022 → 02/01/2023`, thêm 5 tuần vùng `$16,429 – $17,128`): Giải ngân hết phần nạp mới mỗi tuần (tổng giải ngân cả chu kỳ **`$89,000`**; tiền nạp từ `2023–2026` tiếp tục tích thành **`$201,000`** tiền mặt chờ đáy sau).
- **Kết quả backtest:**
  - **Giá vốn trung bình:** **`$16,331`** (Equal DCA là `$43,072`).
  - **ROI / Giá trị cuối (`11/2026`):** **`+84.4%`** (`$534,904`) | **`+93.3%`** (`$560,481`) nếu quỹ gửi `4% APY` (XIRR **`+24.2%/năm`**, Sharpe **`0.89`**).
  - **Tại đỉnh chu kỳ `09/2025` (`$123k`):** ROI **`+252.8%`**, Max Drawdown **`-20.9%`**, Sharpe **`1.37`**.
  - **Đa chu kỳ 8.3 năm (`2018–2026`):** Giá vốn **`$12,502`**, ROI **`+208.2%`** (**`+226.1%`** với `4% APY`), Sharpe **`0.84`** (`0.87` với `4% APY`).

---

## Quy tắc 2 — Cân bằng Toàn diện (`GB-6: Fractional 50% Reserve / Green Bubble Week`)

> **Mục tiêu:** Lợi nhuận tiệm cận mức tối đa nhưng loại bỏ rủi ro dồn hết 100% tiền vào cây nến đầu tiên nếu thị trường gấu còn rơi tiếp, đồng thời giữ sự ổn định tâm lý cao nhất qua nhiều chu kỳ.

### Các bước thực hiện
- **Bước 1 (Tích lũy quỹ):** Mỗi tuần nạp đều `$X` vào Quỹ dự phòng `R`.
- **Bước 2 (Kiểm tra sáng Thứ Hai 07:00 VN):** Nếu chưa có Green Bubble → giữ nguyên tiền trong `R`.
- **Bước 3 (Giải ngân chia lớp `50%`):**
  - Hễ tuần vừa đóng có Green Bubble → Giải ngân đúng **50% lượng tiền mặt hiện có trong `R`** (`Spend = 0.50 × R`).
  - Nếu cụm Green Bubble kéo dài 4–5 tuần: tự động rải vốn theo cấp số nhân giảm dần (`50% → 25% → 12.5% → 6.25% → 3.1%`), giải ngân được **`~94–97%` quỹ** tại vùng đáy mà vẫn luôn còn tiền mặt dự phòng nếu giá sập sâu hơn.
- **Bước 4 (Tùy chọn xoay vòng chu kỳ — Biến thể `CY-4`):**
  - Nếu muốn chủ động thu hồi vốn khi thị trường quá nóng: Khi cụm **Red Bubble (`Score <= -3 && !div`)** đầu tiên xuất hiện, **bán 50% lượng BTC đang giữ đúng 1 lần duy nhất**, đưa tiền về lại `R` hưởng lãi `4% APY`, **giữ 50% BTC còn lại** làm Core Hold ăn trọn sóng tăng nếu bull market kéo dài.

### Ví dụ thực tiễn (Chu kỳ `2021–2026`, ngân sách `$1,000/tuần`)
- Đến `21/11/2022` có **`R = $82,000`** → Green Bubble tuần 1: mua **`$41,000`** (`50%`), còn lại `$41,000`.
- Tuần `28/11/2022` (tuần GB thứ 2, `+ $1k` nạp mới → `R = $42,000`): mua **`$21,000`** (`50%`), còn lại `$21,000`.
- 4 tuần GB liên tiếp `12/12/2022 → 02/01/2023` (vùng `$16.6k–$17.1k`): lần lượt giải ngân **`$12,000 → $6,500 → $3,750 → $2,375`**.
- Tổng giải ngân: **`$86,625`** (rải mượt qua cả 6 tuần đáy).
- **Kết quả backtest:**
  - **Giá vốn trung bình:** **`$16,472`** (chỉ chênh `$141` so với All-In).
  - **ROI / Giá trị cuối (`11/2026`):** **`+81.2%`** (`$525,592`) | **`+90.2%`** (`$551,705`) nếu quỹ gửi `4% APY` (XIRR **`+23.6%/năm`**, Sharpe **`0.88`**, MaxDD **`-41.4%`**).
  - **Tại đỉnh chu kỳ `09/2025`:** ROI **`+243.6%`**, MaxDD **`-20.7%`**, Sharpe **`1.36`**.
  - **Đa chu kỳ 8.3 năm (`2018–2026`):** Giá vốn **`$12,868`**, ROI **`+197.0%`** (**`+215.5%`** với `4% APY`), Sharpe **`0.84`** (`0.87` với `4% APY`; hoặc **`0.89`** nếu bật biến thể chốt 50% `CY-4`).

---

## Tóm tắt lựa chọn nhanh

- **Chọn Quy tắc 1 (`100% Reserve`)** nếu bạn kỷ luật tuyệt đối, tin tưởng bộ lọc đáy `MathClean v3` và muốn **tối ưu từng % lợi nhuận** trên số vốn giải ngân.
- **Chọn Quy tắc 2 (`50% Reserve / tuần GB`)** nếu bạn ưu tiên **an toàn tâm lý & phân bổ rủi ro**: giữ được `96%` hiệu suất của Quy tắc 1 (`+90.2%` vs `+93.3%`), nhưng vẫn còn tiền mặt dự phòng nếu sau tuần mua đầu tiên thị trường có thêm nhịp rũ bỏ.
