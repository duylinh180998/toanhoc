# MathGraph Arena

🎮 **Chơi ngay:** https://duylinh180998.github.io/toanhoc/ · bản 1 file: https://duylinh180998.github.io/toanhoc/mathgraph-arena.html

Game đối kháng 2D theo lượt: **ngắm bắn bằng đồ thị hàm số**. Thay vì chỉnh góc và lực, bạn nhập `f(x)` — tia đạn chính là đồ thị của hàm số, vẽ dần từ vị trí nhân vật trên hệ trục Oxy, phá huỷ địa hình khi va chạm.

- **1v1** hoặc **2v2** (có sát thương đồng đội), lượt luân phiên A1 → B1 → A2 → B2, 30 giây/lượt.
- **Chơi chung 1 máy** hoặc **online qua link mời** (P2P WebRTC) — không cần server riêng, không cần database.
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
| **GitHub Pages** (đang dùng) | Pages phục vụ từ nhánh **`gh-pages`**, nhánh này chỉ chứa bản build (*Settings → Pages → Deploy from a branch → gh-pages / root*). Mỗi lần push lên `main`, workflow `.github/workflows/deploy.yml` chạy test, build rồi ghi đè bản mới lên `gh-pages`. Khoảng 1 phút sau trang tự cập nhật. Repo khác: GitHub tự bật Pages ngay lần đầu có nhánh `gh-pages`, nếu không thì chọn như trên. Game ở `https://<user>.github.io/<repo>/`. |
| *Phiên bản* | Góc trên menu hiện mã phiên bản (`v` + mã commit) để so xem mọi người có cùng bản không. Mỗi lần deploy, đường dẫn JS/CSS được gắn `?v=<mã commit>`, nhờ đó trình duyệt không trộn file cũ với file mới. GitHub Pages cho trình duyệt giữ trang tới ~10 phút: thấy bản cũ thì nhấn **Ctrl+F5**. |
| **Netlify / Vercel / Cloudflare Pages** | Kéo-thả cả thư mục, hoặc kết nối repo với *build command* để trống, *publish directory* là `.` (thư mục gốc). |
| **Một file HTML duy nhất** | `npm install && npm run build` → `dist/mathgraph-arena.html` (~890 KB, đã nhúng math.js). Chơi chung máy offline 100%, mở bằng double-click; chơi online thì cần Internet (tải PeerJS từ CDN). |

## Chơi online (P2P, không cần database)

1. Menu → tab **Online** → nhập tên → chọn 1v1/2v2 → **Tạo phòng**.
2. Gửi **link mời** (hoặc mã 6 ký tự) cho bạn bè. Họ mở link, nhập tên, bấm **Vào phòng**.
3. Trong sảnh, mọi người có thể bấm vào ghế trống để đổi chỗ. Chủ phòng chọn chế độ, thời gian lượt, sát thương đồng đội rồi bấm **Bắt đầu trận**.
4. 2v2 không cần đủ 4 người: ghế trống do đồng đội cùng đội điều khiển thay (vd. 2 người, mỗi người điều khiển 2 nhân vật).

**Cách hoạt động.** Không có server riêng, không có database. Trạng thái phòng nằm trong bộ nhớ trình duyệt của **chủ phòng**. Có hai đường kết nối, game tự chọn:

1. **Trực tiếp (P2P, WebRTC qua [PeerJS](https://peerjs.com/))**: nhanh nhất. Máy chủ PeerJS công cộng chỉ giúp hai bên "bắt tay".
2. **Kênh chuyển tiếp (MQTT công cộng)**: dùng tự động khi P2P không thông sau ~7 giây. Các trường hợp hay gặp: mạng 4G hay mạng gia đình dùng NAT nhiều tầng (CGNAT), tường lửa công ty chặn UDP. Mọi máy chỉ cần mở được kết nối `wss://` ra ngoài tới một máy chủ MQTT miễn phí trong `NET.relayBrokers`. Các máy nối song song tới nhiều máy chủ và dùng cái nhanh nhất. Game theo lượt nên độ trễ thêm ~0.1 giây không ảnh hưởng.

Trong sảnh chờ, mỗi người có nhãn **P2P** hoặc **Chuyển tiếp** để biết họ đang kết nối kiểu nào. Nếu máy chủ PeerJS sập, chủ phòng vẫn mở được phòng và nhận khách qua kênh chuyển tiếp.

- Mọi người kết nối tới chủ phòng (hình sao). Chủ phòng kiểm tra từng hành động (đổi hướng, phép, bắn) rồi phát lại cho cả phòng.
- Vì cùng seed bản đồ và cùng hành động, mỗi máy tự mô phỏng ra cùng một phát bắn. Mỗi lượt chỉ tốn vài chục byte.
- Đầu mỗi lượt chủ phòng gửi một bản chốt trạng thái (vị trí, máu, phép, danh sách hố) để sửa mọi sai lệch nhỏ. Dữ liệu va chạm địa hình được tính thuần toán học (`js/core/mask.js`), không đọc pixel canvas, nên mọi máy cho kết quả giống hệt nhau.
- Chỉ chủ phòng quyết định chuyển lượt, hết giờ (có cộng 0.6 giây bù độ trễ mạng) và thắng/thua.
- Có người rời phòng: đồng đội điều khiển thay. Một đội không còn ai thì đội đó thua. Chủ phòng rời thì phòng đóng.

**Test online ngay trên 1 máy:** chạy `npm start`, mở `http://localhost:5173` ở **2 tab** (hoặc 1 tab thường + 1 tab ẩn danh), tab này tạo phòng, tab kia vào phòng. Lưu ý: 2 tab trên cùng máy **luôn** nối được P2P, nên không kiểm tra được trường hợp mạng chặn. Muốn thử kênh chuyển tiếp, thêm `?net=relay` vào URL của người vào phòng (bỏ qua P2P). Muốn thử bằng điện thoại cùng mạng Wi-Fi thì mở `http://<IP-máy-tính>:5173`.

**Tham số URL nâng cao**

| Tham số | Tác dụng |
| --- | --- |
| `?net=relay` | Vào phòng thẳng bằng kênh chuyển tiếp (bỏ qua P2P). |
| `?peer=https://may-chu-peerjs/` | Dùng máy chủ bắt tay PeerJS tự host (`npx peerjs --port 9000`). |
| `?mqtt=wss://broker1/mqtt,wss://broker2/mqtt` | Dùng máy chủ MQTT riêng cho kênh chuyển tiếp. |

Link mời tự giữ các tham số `peer`, `mqtt`. Muốn đặt cố định thì sửa `NET.server` / `NET.relayBrokers` trong `js/config.js`.

**Muốn P2P ổn định hơn nữa (tuỳ chọn):** đăng ký một máy chủ TURN miễn phí (Metered, ExpressTURN, Cloudflare…) rồi thêm vào `NET.iceServers`, ví dụ `{ urls: ['turns:ten-may:443?transport=tcp'], username: '…', credential: '…' }`.

**Giới hạn cần biết**
- Chủ phòng phải giữ tab mở suốt trận. Tab bị ẩn vẫn chạy nhưng trình duyệt có thể làm chậm.
- Kênh chuyển tiếp đi qua máy chủ MQTT **công cộng**: miễn phí, không đảm bảo luôn sống, và ai biết mã phòng cũng có thể "nghe" được nước đi (không có dữ liệu cá nhân nào được gửi).
- Rớt mạng giữa trận thì không vào lại được trận đó, phải chờ trận sau.

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
  core/terrain.js     sinh bản đồ theo seed, vẽ địa hình, khoét hố destination-out
  core/mask.js        dữ liệu va chạm thuần toán học (giống hệt nhau trên mọi máy)
  core/player.js      nhân vật, phép trợ giúp, trọng lực
  core/game.js        máy trạng thái trận đấu: lượt, bắn, nổ, sát thương, thắng/thua, bản chốt online
  net/peer.js         tải PeerJS, mã phòng, link mời, máy chủ bắt tay tự host
  net/relay.js        kênh chuyển tiếp qua MQTT công cộng (dự phòng khi P2P bị chặn)
  net/online.js       phòng online: sảnh, ghế, giao thức tin nhắn, P2P → chuyển tiếp, heartbeat
  render/renderer.js  vẽ canvas (lưới, trục tương đối, đồ thị phát sáng, nhân vật, công cụ ngắm)
  render/effects.js   hạt, sóng xung kích, chữ bay, rung màn hình
  audio/sfx.js        âm thanh WebAudio tổng hợp
  ui/hud.js           bảng điều khiển, bảng đội, banner, toast, phím tắt
  ui/screens.js       menu (tab Cùng máy / Online), kết thúc trận, hướng dẫn, tạm dừng
  ui/lobby.js         tab Online + màn hình sảnh chờ
tools/serve.mjs       static server không phụ thuộc
tools/build.mjs       đóng gói thành 1 file HTML
tests/                kiểm thử tracer + parser (node:test)
```

`Game` không chạm vào DOM. UI chỉ lắng nghe sự kiện (`turn`, `update`, `toast`, `over`…) và gửi thao tác qua `game.request({ kind: 'fire' | 'spell' | 'facing', … })`. Khi chơi online, `request()` chuyển thao tác cho chủ phòng thay vì tự áp dụng. Mở console và gõ `mga.game` hoặc `mga.session` để debug.

## Thuật toán chống "xuyên địa hình" (sub-stepping)

Với hàm dốc (`x^3`, `exp(x)`, `100x`), chỉ cần x tăng 1px là y có thể nhảy hàng trăm pixel — nếu lấy mẫu đều theo Δx, tia sẽ "nhảy cóc" qua tường mỏng hoặc qua người. `js/core/tracer.js` giải quyết bằng 2 tầng:

1. **Bước thích nghi**: từ mẫu hiện tại thử bước `h`; nếu đoạn nối 2 mẫu dài hơn 2px trên màn hình thì chia đôi `h` và thử lại. Mọi đoạn thẳng giữa hai mẫu liên tiếp đều ≤ 2px nên gần như trùng với đồ thị thật. Thành công thì nhân đôi `h` lại (tối đa 1px ngang) để chạy nhanh ở vùng thoải.
2. **Dò va chạm trên đoạn**: trên mỗi đoạn `(xᵢ, yᵢ) → (xᵢ₊₁, yᵢ₊₁)` đặt các điểm cách nhau ≤ 0.5px và kiểm tra mask địa hình, hitbox nhân vật, biên bản đồ.

Phép chia đôi cũng tự phát hiện **điểm gián đoạn**: hàm liên tục thì bước nhảy nhỏ dần khi `h → 0`, còn tại tiệm cận đứng (`1/(x−3)`, `tan x`) bước nhảy không giảm ⇒ tia dừng thay vì vẽ một vạch dọc giả xuyên bản đồ. Giá trị không phải số thực hữu hạn (chia 0, `sqrt(−1)` ra số phức…) được trả về `NaN` và tia dừng ở biên miền xác định. Phần bay khuất phía trên được kẹp y để không tốn bước tính và tia có thể rơi trở lại như đạn pháo.

## Kiểm thử

```bash
npm install
npm test             # tracer (tường mỏng 1px, tiệm cận, miền xác định…), parser, mask va chạm tất định
```
