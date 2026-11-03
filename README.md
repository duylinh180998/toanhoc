# MathGraph Arena

Game đối kháng 2D theo lượt: **ngắm bắn bằng đồ thị hàm số**. Thay vì chỉnh góc và lực, bạn nhập `f(x)` — tia đạn chính là đồ thị của hàm số, vẽ dần từ vị trí nhân vật trên hệ trục Oxy, phá huỷ địa hình khi va chạm.

- **1v1** hoặc **2v2** (có sát thương đồng đội), lượt luân phiên A1 → B1 → A2 → B2, 30 giây/lượt.
- **Địa hình phá huỷ được** (offscreen canvas + `destination-out`), nhân vật rơi theo trọng lực, rơi khỏi bản đồ là bị loại.
- **4 phép trợ giúp**: Dịch chuyển, Hồi máu (+30), Khiên (chặn 1 lần sát thương), x2 Sát thương (50 HP, nổ 50px).
- Lưới toạ độ, trục tương đối quanh nhân vật, thước đo Δx/Δy theo con trỏ, giữ 3 đồ thị gần nhất dạng nét mờ.
- Âm thanh tổng hợp bằng WebAudio (không cần file asset) — cao độ âm thanh bám theo độ cao của tia đạn.
- **Không cần build**: HTML + CSS + ES modules thuần, chỉ phụ thuộc `math.js` qua CDN.

## Chạy thử

```bash
npm start            # = node tools/serve.mjs → http://localhost:5173
```

Hoặc bất kỳ static server nào: `python3 -m http.server 5173`, `npx serve .`, Live Server của VS Code…

> Không mở `index.html` trực tiếp bằng `file://` — trình duyệt chặn ES module ở chế độ đó. Nếu muốn double-click để chơi, dùng bản 1 file bên dưới.

## Deploy

| Cách | Làm gì |
| --- | --- |
| **GitHub Pages** (tự động) | Vào *Settings → Pages → Build and deployment → Source* chọn **GitHub Actions** (làm 1 lần). Mỗi lần push lên `main`, workflow `.github/workflows/deploy.yml` sẽ chạy test, build và deploy. Game ở `https://<user>.github.io/<repo>/`, bản 1 file ở `…/mathgraph-arena.html`. |
| **Netlify / Vercel / Cloudflare Pages** | Kéo-thả cả thư mục, hoặc kết nối repo với *build command* để trống, *publish directory* là `.` (thư mục gốc). |
| **Một file HTML duy nhất** | `npm install && npm run build` → `dist/mathgraph-arena.html` (~820 KB, đã nhúng math.js). Chạy offline 100%, gửi cho ai cũng mở được bằng double-click. |

## Cách chơi

1. Nhập hàm số vào ô `f(x) =`, chọn hướng **Trái/Phải**, bấm **BẮN** (hoặc `Enter`).
2. Đồ thị luôn xuất phát từ nhân vật nhờ phép tịnh tiến

   ```
   Y(x) = y₀ + f(x − x₀) − f(0)
   ```

   Bắn sang phải thì x chạy về phía dương, bắn sang trái thì x chạy về phía âm (đây là đồ thị thật của hàm đã tịnh tiến — nên `-0.5*x` đi **lên** khi bắn trái). Nếu `f(0)` không xác định (vd. `log(x)`, `1/x`), đồ thị được neo tại điểm xác định đầu tiên cách nhân vật 1px.
3. Tia dừng khi chạm đất/nhân vật (phát nổ, R = 25px, −25 HP), bay ra khỏi bản đồ, gặp tiệm cận đứng / điểm gián đoạn, ra khỏi miền xác định, hoặc dao động quá dài.
4. Mỗi lượt dùng tối đa 1 phép trợ giúp. Mỗi phép dùng được 2 lần/trận và có thời gian hồi.

Ví dụ: `0.5*x`, `-0.05*x^2 + 2*x`, `3*sin(x/2)`, `x^3/400`, `x < 10 ? 0.8*x : 8 - 2*(x-10)`.
Hỗ trợ: `+ − * / ^`, `sin cos tan sqrt abs log (ln) exp pi e min max floor …`, viết tắt `2x`, `3sin(x)`, `x²`, `π`.

**Phím tắt**: `Enter` bắn · `Esc` thoát ô nhập / tạm dừng · ngoài ô nhập: `←`/`→` đổi hướng, `1`–`4` chọn phép, `F` gõ công thức.

## Cấu trúc mã

```
index.html            khung trang + các màn hình (menu, kết thúc, hướng dẫn)
css/style.css         giao diện (biến màu, layout co giãn, container queries)
js/
  main.js             khởi động: tải math.js (có CDN dự phòng) → tạo module → vòng lặp rAF
  config.js           MỌI hằng số gameplay (sát thương, bán kính, phép, thời gian…) — sửa ở đây để cân bằng game
  utils.js            clamp/lerp, RNG có seed, Emitter, localStorage an toàn
  math/formula.js     parse + whitelist AST + biên dịch f(x) bằng math.js, chuẩn hoá cách gõ, điểm neo f(0)
  core/coords.js      đổi toạ độ màn hình ↔ hệ trục Oxy (1 đơn vị = 20px, x ∈ [−25, 25], y ∈ [−15, 15])
  core/tracer.js      ★ thuật toán truy vết đồ thị: bước thích nghi + dò va chạm từng 0.5px
  core/terrain.js     sinh bản đồ theo seed, mask va chạm, khoét hố destination-out
  core/player.js      nhân vật, phép trợ giúp, trọng lực
  core/game.js        máy trạng thái trận đấu: lượt, bắn, nổ, sát thương, thắng/thua
  render/renderer.js  vẽ canvas (lưới, trục tương đối, đồ thị phát sáng, nhân vật, công cụ ngắm)
  render/effects.js   hạt, sóng xung kích, chữ bay, rung màn hình
  audio/sfx.js        âm thanh WebAudio tổng hợp
  ui/hud.js           bảng điều khiển, bảng đội, banner, toast, phím tắt
  ui/screens.js       menu, kết thúc trận, hướng dẫn, tạm dừng
tools/serve.mjs       static server không phụ thuộc
tools/build.mjs       đóng gói thành 1 file HTML
tests/                kiểm thử tracer + parser (node:test)
```

`Game` không chạm vào DOM — UI chỉ lắng nghe sự kiện (`turn`, `update`, `toast`, `over`…) và gọi `fire()`, `castSpell()`, `setFacing()`. Mở console và gõ `mga.game` để debug.

## Thuật toán chống "xuyên địa hình" (sub-stepping)

Với hàm dốc (`x^3`, `exp(x)`, `100x`), chỉ cần x tăng 1px là y có thể nhảy hàng trăm pixel — nếu lấy mẫu đều theo Δx, tia sẽ "nhảy cóc" qua tường mỏng hoặc qua người. `js/core/tracer.js` giải quyết bằng 2 tầng:

1. **Bước thích nghi**: từ mẫu hiện tại thử bước `h`; nếu đoạn nối 2 mẫu dài hơn 2px trên màn hình thì chia đôi `h` và thử lại. Mọi đoạn thẳng giữa hai mẫu liên tiếp đều ≤ 2px nên gần như trùng với đồ thị thật. Thành công thì nhân đôi `h` lại (tối đa 1px ngang) để chạy nhanh ở vùng thoải.
2. **Dò va chạm trên đoạn**: trên mỗi đoạn `(xᵢ, yᵢ) → (xᵢ₊₁, yᵢ₊₁)` đặt các điểm cách nhau ≤ 0.5px và kiểm tra mask địa hình, hitbox nhân vật, biên bản đồ.

Phép chia đôi cũng tự phát hiện **điểm gián đoạn**: hàm liên tục thì bước nhảy nhỏ dần khi `h → 0`, còn tại tiệm cận đứng (`1/(x−3)`, `tan x`) bước nhảy không giảm ⇒ tia dừng thay vì vẽ một vạch dọc giả xuyên bản đồ. Giá trị không phải số thực hữu hạn (chia 0, `sqrt(−1)` ra số phức…) được trả về `NaN` và tia dừng ở biên miền xác định. Phần bay khuất phía trên được kẹp y để không tốn bước tính và tia có thể rơi trở lại như đạn pháo.

## Kiểm thử

```bash
npm install
npm test             # tracer: tường mỏng 1px, tiệm cận, miền xác định, bắn trái/phải… + parser
```
