/**
 * ───────────────────────────────────────────────────────────────────────────────
 *  TRUY VẾT ĐỒ THỊ (GRAPH TRACER) — trái tim của MathGraph Arena
 * ───────────────────────────────────────────────────────────────────────────────
 *
 *  Đường đạn là đồ thị đã được tịnh tiến để luôn xuất phát từ nhân vật (x0, y0):
 *
 *          Y(x) = y0 + f(x − x0) − f(0)            (x chạy từ x0 theo hướng bắn)
 *
 *  Đặt t = |x − x0| ≥ 0 là quãng đường đã đi theo phương ngang, dir = ±1 là hướng bắn:
 *
 *          x(t) = x0 + dir·t,    Y(t) = y0 + f(dir·t) − f(0)
 *
 *  VẤN ĐỀ "NHẢY CÓC": nếu chỉ lấy mẫu mỗi Δx = 1px, hàm dốc (x³, eˣ, 50x...) có thể nhảy
 *  hàng trăm pixel theo y giữa 2 mẫu ⇒ tia xuyên qua tường mỏng hoặc xuyên qua người.
 *
 *  GIẢI PHÁP — 2 tầng:
 *   ① Bước thích nghi (adaptive sub-stepping): từ mẫu hiện tại tại t, thử bước h. Nếu điểm
 *     mới cách điểm cũ > maxSegmentPx (2px) trên màn hình thì chia đôi h và thử lại. Nhờ vậy
 *     mọi đoạn thẳng giữa 2 mẫu liên tiếp đều ngắn ≤ 2px — đồ thị thực gần như trùng đoạn
 *     thẳng nối 2 mẫu đó. Sau mỗi bước thành công, h được nhân đôi trở lại (tối đa 1px ngang)
 *     để vùng thoải chạy nhanh.
 *   ② Nội suy dò va chạm (raymarching trên đoạn): trên mỗi đoạn (x_i, y_i) → (x_{i+1}, y_{i+1})
 *     ta đặt các điểm dò cách nhau ≤ 0.5px và kiểm tra từng điểm với mask địa hình, hitbox
 *     nhân vật và biên bản đồ ⇒ bắt va chạm chính xác tới từng pixel.
 *
 *  TRƯỜNG HỢP ĐẶC BIỆT:
 *   • Ngoài miền xác định (sqrt(-1), log(0), số phức...): f trả về NaN. Ta chia đôi h để tiến
 *     sát biên miền; khi h < minStep mà vẫn NaN ⇒ tia dừng ('domain').
 *   • Tiệm cận đứng / gián đoạn (1/(x−3), tan x, floor x): hàm liên tục thì chia đôi h luôn làm
 *     bước nhảy nhỏ dần; còn tại điểm gián đoạn, bước nhảy KHÔNG nhỏ đi dù h → 0. Khi h < minStep
 *     mà đoạn vẫn dài > 2px ⇒ kết luận gián đoạn, tia dừng ('asymptote') — không vẽ "vạch dọc"
 *     giả xuyên cả bản đồ.
 *   • Bay lên trên mép bản đồ: y được kẹp trong [−margin, H + margin] khi tính độ dài đoạn và
 *     dò va chạm. Phía trên không có gì để chạm nên tia "trượt" ngang ngoài màn hình và có thể
 *     rơi trở lại (như cầu vồng đạn pháo). Kẹp y cũng giúp không phải chia bước vô ích khi
 *     |y| khổng lồ (vd. x^10).
 *   • Ra khỏi mép trái/phải hoặc rơi xuống đáy ⇒ 'bounds'.
 *   • Hàm dao động quá dữ (sin(1000x)) ⇒ giới hạn độ dài/số lần tính ⇒ 'limit'.
 *
 *  Kết quả là toàn bộ polyline đường đạn + điểm kết thúc. Vì địa hình và nhân vật đứng yên
 *  trong lúc bay, ta tính trước một lần (đồng bộ, vài ms) rồi hoạt ảnh chỉ việc "vẽ dần"
 *  polyline theo độ dài cung — tốc độ vẽ đều kể cả ở đoạn rất dốc.
 * ───────────────────────────────────────────────────────────────────────────────
 */
import { SHOT, WORLD } from '../config.js';
import { toPxY, toUnitY } from './coords.js';
import { clamp } from '../utils.js';

/**
 * @param {object}   o
 * @param {Function} o.fn       f(x) đã biên dịch (trả NaN khi không xác định)
 * @param {{offset:number, value:number}} o.anchor  điểm neo — xem anchorPoint() (thường offset = 0, value = f(0))
 * @param {{x,y}}    o.origin   vị trí xuất phát (px) = tâm nhân vật
 * @param {1|-1}     o.dir      hướng bắn
 * @param {Terrain}  o.terrain
 * @param {Player[]} o.players  các nhân vật còn sống (kể cả người bắn)
 * @param {Player}   o.shooter
 * @returns {{ points: {x,y,ry,s}[], length: number, end: {reason,x,y,freeX,freeY,target} }}
 *          points[i].s = quãng hoạt ảnh tích luỹ (px) — đoạn bay khuất phía trên bản đồ chỉ tính 25%
 *          để không phải chờ lâu; ry = y thật (không kẹp).
 */
export function traceGraph({ fn, anchor, origin, dir, terrain, players, shooter }) {
  const { width: W, height: H, unit: U } = WORLD;
  const y0 = toUnitY(origin.y);
  const yLo = -SHOT.clampMarginPx;
  const yHi = H + SHOT.clampMarginPx;
  const baseStep = SHOT.baseStepPx / U; // bước ngang tối đa theo đơn vị toán

  /** Điểm của đồ thị tại quãng t (đơn vị toán) — null nếu f không xác định tại đó. */
  const sample = (t) => {
    const y = y0 + fn(dir * t) - anchor.value;
    if (!Number.isFinite(y)) return null;
    const ry = toPxY(y);
    return { x: origin.x + dir * t * U, y: clamp(ry, yLo, yHi), ry };
  };

  const points = [{ x: origin.x, y: origin.y, ry: origin.y, s: 0 }];
  let prev = points[0];
  let length = 0;
  let evaluations = 0;
  let freeX = origin.x;    // điểm dò cuối cùng KHÔNG va chạm (dùng cho Dịch chuyển)
  let freeY = origin.y;
  let leftShooter = false; // tia đã rời hitbox người bắn chưa (tránh tự nổ ngay lúc xuất phát)

  const finish = (reason, at, target = null) => ({
    points,
    length,
    end: { reason, x: at.x, y: at.y, freeX, freeY, target },
  });

  /**
   * Dò va chạm dọc đoạn thẳng prev → next, mỗi ≤ 0.5px một điểm (raymarching trên đoạn).
   * Trả về kết quả kết thúc nếu chạm gì đó, ngược lại null (đoạn an toàn).
   */
  const probeSegment = (next) => {
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const probes = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SHOT.probeSpacingPx));
    for (let i = 1; i <= probes; i++) {
      const k = i / probes;
      const qx = prev.x + dx * k;
      const qy = prev.y + dy * k;
      let hit = null;
      let target = null;

      if (qx < 0 || qx >= W || qy >= H) hit = 'bounds';
      else if (terrain.isSolid(qx, qy)) hit = 'terrain';
      else {
        for (const p of players) {
          const d = Math.hypot(qx - p.x, qy - p.y);
          if (p === shooter && !leftShooter) {
            if (d > p.hitRadius + 1) leftShooter = true;
            continue;
          }
          if (d <= p.hitRadius) {
            hit = 'player';
            target = p;
            break;
          }
        }
      }
      if (hit) {
        length += Math.hypot(qx - prev.x, qy - prev.y);
        const end = { x: qx, y: qy, ry: qy, s: length };
        points.push(end);
        return finish(hit, end, target);
      }
      freeX = qx;
      freeY = qy;
    }
    return null;
  };

  /** Nhận một mẫu vào polyline. */
  const accept = (next) => {
    const seg = Math.hypot(next.x - prev.x, next.y - prev.y);
    const offTop = prev.y <= yLo + 0.01 && next.y <= yLo + 0.01;
    length += offTop ? seg * 0.25 : seg;
    prev = { x: next.x, y: next.y, ry: next.ry, s: length };
    points.push(prev);
  };

  // Nếu neo lệch khỏi 0 (f(0) không xác định) thì nối một đoạn ngang ngắn từ nhân vật tới điểm neo.
  let t = anchor.offset;
  if (t > 0) {
    const start = { x: origin.x + dir * t * U, y: origin.y, ry: origin.y };
    const stopped = probeSegment(start);
    if (stopped) return stopped;
    accept(start);
  }
  let h = baseStep;

  for (;;) {
    // ── ① Tìm mẫu kế tiếp với bước thích nghi ────────────────────────────────
    let next = null;
    for (;;) {
      if (++evaluations > SHOT.maxEvaluations) return finish('limit', prev);
      const cand = sample(t + h);
      if (cand) {
        if (Math.hypot(cand.x - prev.x, cand.y - prev.y) <= SHOT.maxSegmentPx) {
          next = cand;
          break;
        }
        // Bước đã nhỏ tới mức vô nghĩa mà vẫn nhảy xa ⇒ gián đoạn (tiệm cận đứng).
        if (h <= SHOT.minStep) return finish('asymptote', prev);
      } else if (h <= SHOT.minStep) {
        return finish('domain', prev); // chạm biên miền xác định
      }
      h *= 0.5; // chia đôi bước rồi thử lại
    }

    // ── ② Dò va chạm dọc đoạn prev → next, mỗi 0.5px một điểm ──────────────────
    const stopped = probeSegment(next);
    if (stopped) return stopped;

    // ── ③ Chấp nhận mẫu, nới bước cho lần sau ─────────────────────────────────
    accept(next);
    t += h;
    if (length > SHOT.maxPathPx) return finish('limit', prev);
    h = Math.min(baseStep, h * 2);
  }
}

/**
 * Tìm vị trí trên polyline tại độ dài cung s (tìm nhị phân) — dùng cho đầu tia khi hoạt ảnh.
 * Trả về { x, y, ry, index } với index là số điểm đầy đủ đã đi qua.
 */
export function pointAtLength(points, s) {
  let lo = 0;
  let hi = points.length - 1;
  if (s >= points[hi].s) return { ...points[hi], index: hi };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ry: a.ry + (b.ry - a.ry) * k, index: lo };
}
