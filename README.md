# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.



Viewed HftRadarTab.jsx:1-646

Tab **HFT (High-Frequency Trading) Radar** cung cấp các công cụ phân tích dòng tiền phái sinh (Derivatives Order Flow) theo thời gian thực để tìm ra các hành vi gom hàng/xả hàng của cá mập (Whales) và các bẫy thanh khoản. 

Dưới đây là hướng dẫn chi tiết cách đọc từng chỉ số và cách sử dụng các Input đi kèm:

---

### 📊 1. CVD & Order Flow (Cumulative Volume Delta)
**CVD** đo lường sự chênh lệch lũy kế giữa khối lượng khớp lệnh chủ động của bên mua (Taker Buy - lệnh Market) và bên bán (Taker Sell - lệnh Market).

*   **Cách đọc chỉ số CVD:**
    *   **CVD dương (+ / Màu xanh lá):** Lực mua chủ động đang chiếm ưu thế (Taker đang mua đuổi giá Market).
    *   **CVD âm (- / Màu đỏ):** Lực bán chủ động đang chiếm ưu thế (Taker đang bán tháo bằng giá Market).
*   **Hệ thống phát hiện Phân kỳ (Divergence):**
    *   **Phân kỳ Bullish (Mua hấp thụ):** Giá đi xuống nhưng đường CVD lại dốc lên. *Ý nghĩa:* Taker đang liên tục bán chủ động, nhưng bên dưới có các lệnh mua giới hạn (Limit Buy) cực lớn của Whales hấp thụ hết lực bán đó, khiến giá không thể giảm sâu hơn. Đây là tín hiệu **tạo đáy tiềm năng**.
    *   **Phân kỳ Bearish (Bán hấp thụ):** Giá đi lên nhưng đường CVD lại dốc xuống. *Ý nghĩa:* Taker liên tục mua chủ động, nhưng bên trên có các lệnh bán giới hạn (Limit Sell) của Whales hấp thụ hết lực mua, chặn đà tăng của giá. Đây là tín hiệu **tạo đỉnh tiềm năng**.
    *   **Momentum Tăng / Giảm:** Khi cả giá và CVD cùng đồng thuận tăng mạnh hoặc giảm mạnh, cho thấy xu hướng đang đi rất rõ ràng và mạnh mẽ.

---

### 🎯 2. Target Liquidity (Whale Walls)
Bảng này quét các tường lệnh giới hạn (Limit Order) có giá trị cực lớn (**≥ $500K**) trên sổ lệnh, đại diện cho ý đồ chặn giá hoặc gom/xả hàng của Cá mập.

*   **Cách đọc dữ liệu:**
    *   **SUPPORT (BID) WALLS (Màu xanh lá - Support):** Các tường lệnh mua của Whales treo sẵn ở bên dưới giá hiện tại. Đây là các vùng hỗ trợ mạnh. Whales thường dùng để đỡ giá hoặc ép người chơi bán khống (Short) phải mua cover lại tại đây.
    *   **RESISTANCE (ASK) WALLS (Màu đỏ - Resistance):** Các tường lệnh bán của Whales treo sẵn bên trên giá hiện tại. Đây là các vùng kháng cự mạnh, nơi Whales muốn xả hàng hoặc ép người chơi mua (Long) phải cắt lỗ.
    *   **Bid Ratio (Tỷ lệ Bid):** 
        *   **> 60% (Bullish):** Tường mua chiếm ưu thế tuyệt đối $\rightarrow$ Thị trường có bệ đỡ vững chắc phía dưới.
        *   **< 40% (Bearish):** Tường bán chiếm ưu thế tuyệt đối $\rightarrow$ Áp lực cản phía trên rất lớn.

---

### 📖 3. Order Book Imbalance (OBI)
Chỉ số này đo lường mức độ mất cân bằng giữa lượng lệnh chờ mua (Bids) và lượng lệnh chờ bán (Asks) trong sổ lệnh tại một độ sâu nhất định.

*   **Ý nghĩa của Input thanh trượt (Depth Limit / OBI Level):**
    *   **Các mức nhỏ (5, 10, 20 levels):** Chỉ quét các lệnh chờ nằm rất sát giá hiện tại. Mức này đại diện cho áp lực giá **ngay lập tức** (chỉ trong vài giây tới vài phút). Tuy nhiên chỉ số này thay đổi cực nhanh do các bot HFT chèn lệnh/hủy lệnh liên tục.
    *   **Các mức trung bình (50, 100 levels):** Phản ánh cung cầu trong ngắn hạn (vài chục đến vài trăm USD xung quanh giá hiện tại).
    *   **Các mức lớn (500, 1000 levels):** Phản ánh cấu trúc cung cầu vĩ mô của sổ lệnh (quét sâu hàng ngàn USD). Giúp bạn thấy rõ lực đỡ/cản thực sự của thị trường thay vì các lệnh nhiễu của bot.
*   **Cách đọc chỉ số OBI Percent:**
    *   Thang đo chạy từ **-100%** (Sổ lệnh trống rỗng bên mua, chỉ toàn lệnh bán Ask) đến **+100%** (Sổ lệnh trống rỗng bên bán, chỉ toàn lệnh mua Bid).
    *   **OBI > 0 (+ / Màu xanh lá):** Tổng số lượng BTC đặt mua (Bid) nhiều hơn đặt bán (Ask) $\rightarrow$ Lực cầu chờ mua mạnh hơn.
    *   **OBI < 0 (- / Màu đỏ):** Tổng số lượng BTC đặt bán (Ask) nhiều hơn đặt mua (Bid) $\rightarrow$ Lực cung chờ bán đè nặng hơn.

---

### 💥 4. Liquidation Feed (Thanh lý thực)
Bảng này theo dõi thời gian thực các lệnh phái sinh bị sàn buộc thanh lý (Force Order).

*   **Cách đọc dữ liệu:**
    *   **🔴 LONG BỊ THANH LÝ (Long Liquidation):** Xảy ra khi giá giảm nhanh làm cháy tài khoản của các vị thế Long. Sàn buộc phải **BÁN Market** lượng BTC đó ra thị trường. Khi có quá nhiều lệnh Long bị thanh lý cùng lúc sẽ tạo ra hiện tượng **Long Flush / Cascade** (giá sụt giảm rất nhanh).
    *   **🟢 SHORT BỊ THANH LÝ (Short Liquidation):** Xảy ra khi giá tăng nhanh làm cháy tài khoản của các vị thế Short. Sàn buộc phải **MUA Market** lượng BTC đó để đóng vị thế. Tạo ra hiện tượng **Short Squeeze** (giá bay thẳng đứng).
*   **Ý nghĩa của các nút lọc (Filter ≥):**
    *   Mặc định bạn có thể chọn lọc các lệnh thanh lý có giá trị từ **>$10K** lên đến **>$1M**.
    *   **Cách tận dụng:** Các lệnh thanh lý nhỏ xảy ra liên tục. Nhưng khi xuất hiện các lệnh thanh lý khổng lồ **>$1M** (được đánh dấu bằng biểu tượng quả bom 💣), đó thường là dấu hiệu của **sự kiệt sức (exhaustion)**. Ví dụ: Một chuỗi quả bom thanh lý Long nổ liên tiếp thường đánh dấu **đáy ngắn hạn** của nhịp giảm đó (vì lượng bán ép buộc lớn nhất đã bị thị trường hấp thụ hết).