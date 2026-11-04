/**
 * Cấu hình trung tâm của MathGraph Arena.
 * Mọi "con số ma thuật" của gameplay nằm ở đây để dễ cân bằng game.
 */

/** Kích thước bản đồ (px logic) và tỉ lệ: 1 đơn vị toán = 20px ⇒ x ∈ [-25, 25], y ∈ [-15, 15]. */
export const WORLD = Object.freeze({ width: 1000, height: 600, unit: 20 });

export const PLAYER = Object.freeze({
  radius: 11,        // bán kính thân (hitbox) — px
  shieldRadius: 19,  // bán kính bong bóng khiên — px
  maxHp: 100,
});

export const PHYSICS = Object.freeze({
  gravity: 1500,     // px/s²
  maxFallSpeed: 950, // px/s
});

export const COMBAT = Object.freeze({
  damage: 25,        // sát thương cơ bản
  blastRadius: 25,   // bán kính nổ/phá địa hình — px
  doubleFactor: 2,   // hệ số của phép x2 (sát thương và bán kính)
});

/**
 * Tham số thuật toán truy vết đồ thị (xem js/core/tracer.js).
 * Đơn vị "px" là pixel logic của bản đồ.
 */
export const SHOT = Object.freeze({
  baseStepPx: 1,       // bước x tối đa giữa 2 mẫu (1px theo phương ngang)
  maxSegmentPx: 2,     // độ dài tối đa của 1 đoạn nội suy giữa 2 mẫu liên tiếp
  probeSpacingPx: 0.5, // khoảng cách giữa các điểm dò va chạm trên mỗi đoạn
  minStep: 1e-9,       // bước nhỏ nhất (đơn vị toán) khi chia đôi; nhỏ hơn ⇒ coi là gián đoạn
  maxEvaluations: 400_000,
  maxPathPx: 40_000,   // "năng lượng" tối đa của tia (độ dài đường đi)
  clampMarginPx: 40,   // y được kẹp trong [-margin, H + margin] khi vẽ/dò va chạm
  drawSpeed: 720,      // tốc độ vẽ tia — px/giây (theo độ dài cung)
  minDuration: 0.35,
  maxDuration: 3.2,
});

export const TURN = Object.freeze({
  duration: 30,        // giây cho mỗi lượt (có thể đổi ở menu)
  intro: 1.1,          // thời gian hiện banner "Lượt của..." trước khi đếm giờ
  resolveMin: 0.85,    // thời gian tối thiểu chờ hiệu ứng nổ sau mỗi phát bắn
  resolveMax: 5,       // chặn trên, tránh kẹt lượt nếu có gì đó rơi mãi
});

/**
 * Chơi online — không cần server riêng, không cần database. Hai kiểu kết nối:
 *
 * 1) P2P (WebRTC qua PeerJS): hai trình duyệt nói chuyện trực tiếp. Máy chủ PeerJS công cộng chỉ
 *    giúp "bắt tay". Nhanh nhất, nhưng có thể bị chặn bởi NAT nhiều tầng (4G, CGNAT) hoặc tường lửa.
 *    `server`: null = máy chủ bắt tay công cộng; tự host: `npx peerjs --port 9000` rồi đặt
 *    'https://ten-mien-cua-ban/' (hoặc thêm ?peer=http://localhost:9000/ vào URL khi test).
 *
 * 2) Chuyển tiếp (relay) qua MQTT công cộng: dự phòng tự động khi P2P không thông sau `p2pTimeout`.
 *    Mọi máy chỉ cần mở được WebSocket bảo mật (wss://) tới một máy chủ MQTT miễn phí trong
 *    `relayBrokers` ⇒ đi qua được hầu hết NAT/tường lửa. Có thể thay danh sách bằng ?mqtt=url1,url2.
 *    Ép dùng chuyển tiếp (bỏ qua P2P): thêm ?net=relay vào URL.
 */
export const NET = Object.freeze({
  protocol: 2,                    // tăng khi đổi định dạng tin nhắn ⇒ máy khác phiên bản sẽ bị từ chối
  peerPrefix: 'mathgraph-arena-', // ID trên máy chủ PeerJS = tiền tố + mã phòng
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // bỏ các ký tự dễ nhầm: I, L, O, 0, 1
  codeLength: 6,
  server: null,
  connectTimeout: 12_000,         // ms chờ máy chủ bắt tay PeerJS
  p2pTimeout: 7_000,              // ms thử P2P trước khi chuyển sang kênh chuyển tiếp
  relayTimeout: 12_000,           // ms chờ vào phòng qua kênh chuyển tiếp
  heartbeat: 2_000,               // ms giữa 2 lần ping
  dropAfter: 15_000,              // ms không nhận được gì ⇒ coi như mất kết nối
  timeoutGrace: 0.6,              // giây chủ phòng chờ thêm sau khi hết giờ (bù độ trễ mạng)

  /**
   * Máy STUN/TURN cho WebRTC. STUN giúp tìm địa chỉ công khai; TURN chuyển tiếp khi NAT quá chặt.
   * Muốn P2P ổn định hơn nữa: đăng ký TURN miễn phí (Metered, ExpressTURN, Cloudflare…) rồi thêm
   * { urls: ['turns:ten-may:443?transport=tcp'], username: '…', credential: '…' } vào đây.
   */
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    // TURN công cộng mặc định của PeerJS (dùng chung, không đảm bảo).
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ],

  /** Máy chủ MQTT công cộng (WebSocket bảo mật) cho kênh chuyển tiếp — nối song song, dùng cái nhanh nhất. */
  relayBrokers: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ],
  relayTopic: 'mathgraph-arena', // tiền tố topic MQTT
});

/** Mã phiên bản — workflow deploy thay 'dev' bằng mã commit (hiện ở góc menu để so phiên bản). */
export const BUILD = 'dev';

/** Số đồ thị cũ được giữ lại dạng nét mờ để căn chỉnh. */
export const TRAIL_COUNT = 3;

export const TEAMS = Object.freeze({
  A: Object.freeze({ id: 'A', name: 'Đội Lam', color: '#38d8ff', deep: '#0b5d86', soft: '#a5f0ff' }),
  B: Object.freeze({ id: 'B', name: 'Đội Hồng', color: '#ff4fa3', deep: '#8a1655', soft: '#ffc2df' }),
});

/**
 * Phép trợ giúp. `kind`:
 *  - 'instant': có hiệu lực ngay khi bấm (vẫn được bắn trong lượt đó)
 *  - 'shot'   : cường hoá/thay đổi phát bắn của lượt này (chỉ tiêu hao khi bắn)
 * `cooldown`: số lượt (của chính người chơi) bị khoá sau khi dùng.
 */
export const SPELLS = Object.freeze([
  {
    id: 'teleport', name: 'Dịch chuyển', kind: 'shot', charges: 2, cooldown: 1,
    desc: 'Phát bắn không gây sát thương — bạn dịch chuyển tới điểm cuối của đồ thị.',
  },
  {
    id: 'heal', name: 'Hồi máu', kind: 'instant', charges: 2, cooldown: 2, amount: 30,
    desc: 'Hồi ngay +30 HP (tối đa 100). Vẫn được bắn trong lượt này.',
  },
  {
    id: 'shield', name: 'Khiên', kind: 'instant', charges: 2, cooldown: 1,
    desc: 'Tạo khiên chặn hoàn toàn 1 lần sát thương tiếp theo.',
  },
  {
    id: 'double', name: 'x2 Sát thương', kind: 'shot', charges: 2, cooldown: 1,
    desc: 'Phát bắn gây 50 sát thương và bán kính nổ 50px.',
  },
]);

export const SPELL_BY_ID = Object.freeze(Object.fromEntries(SPELLS.map((s) => [s.id, s])));

export const DEFAULT_NAMES = Object.freeze({ A: ['Euler', 'Riemann'], B: ['Gauss', 'Newton'] });

/** Công thức gợi ý sẵn cho lượt đầu (theo hướng mặt mặc định của từng đội). */
export const STARTER_FORMULA = Object.freeze({ 1: '-0.02*x^2 + 0.6*x', [-1]: '-0.02*x^2 - 0.6*x' });
