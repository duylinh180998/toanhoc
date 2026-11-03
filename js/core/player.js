/** Nhân vật: máu, khiên, phép trợ giúp, thống kê và vật lý rơi đơn giản. */
import { PLAYER, PHYSICS, SPELLS, SPELL_BY_ID, WORLD } from '../config.js';

export class Player {
  constructor({ id, name, team, slot }) {
    this.id = id;          // 'A1', 'B2', ...
    this.name = name;
    this.team = team;      // 'A' | 'B'
    this.slot = slot;      // 0 | 1 trong đội

    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = false;

    this.hp = PLAYER.maxHp;
    this.hpLag = PLAYER.maxHp; // thanh "máu vừa mất" chạy chậm phía sau cho đẹp
    this.alive = true;
    this.gone = false;         // rơi khỏi bản đồ ⇒ không vẽ nữa
    this.shield = false;
    this.facing = team === 'A' ? 1 : -1;

    this.turns = 0;            // số lượt đã bắt đầu
    this.draft = null;         // công thức đang gõ dở
    this.history = [];         // các công thức đã bắn gần đây
    this.spells = Object.fromEntries(SPELLS.map((s) => [s.id, { charges: s.charges, readyAt: 0, usedAt: -1 }]));
    this.stats = { shots: 0, landed: 0, hits: 0, damage: 0, friendly: 0 };

    this.fx = { phase: Math.random() * 10, hit: 0, land: 0 }; // trạng thái hoạt ảnh
  }

  get hitRadius() {
    return this.shield ? PLAYER.shieldRadius : PLAYER.radius;
  }

  /**
   * cooldownLeft = số lượt (của chính mình) còn bị khoá, không tính lượt hiện tại nếu vừa dùng.
   * Ví dụ hồi 1 lượt: dùng ở lượt k → lượt k+1 bị khoá → lượt k+2 dùng lại được.
   */
  spellStatus(id) {
    const st = this.spells[id];
    const usedNow = st.usedAt === this.turns;
    const cooldownLeft = Math.max(0, st.readyAt - this.turns - (usedNow ? 1 : 0));
    return { charges: st.charges, cooldownLeft, usedNow, ready: st.charges > 0 && !usedNow && st.readyAt <= this.turns };
  }

  consumeSpell(id) {
    const st = this.spells[id];
    st.charges -= 1;
    st.usedAt = this.turns;
    st.readyAt = this.turns + SPELL_BY_ID[id].cooldown + 1;
  }

  pushHistory(formula) {
    this.history = [formula, ...this.history.filter((f) => f !== formula)].slice(0, 5);
  }
}

/* ───────────────────────────── Vật lý ───────────────────────────── */

const FOOT_PROBES = [-5, 0, 5];

/** Có đất ngay dưới chân không (kiểm tra 3 điểm dưới đáy thân)? */
export function isGrounded(p, terrain) {
  const fy = p.y + PLAYER.radius + 1;
  return FOOT_PROBES.some((dx) => terrain.isSolid(p.x + dx, fy));
}

/** Đẩy nhân vật lên trên nếu thân đang lún vào đất (sau khi dịch chuyển / sinh bản đồ). */
export function resolveEmbed(p, terrain, maxLift = 60) {
  for (let i = 0; i < maxLift && terrain.overlapsCircle(p.x, p.y, PLAYER.radius - 1); i++) p.y -= 1;
}

/** Đặt nhân vật lên mặt đất đầu tiên tính từ trên xuống tại cột x. */
export function dropOnSurface(p, terrain, x) {
  p.x = x;
  let y = PLAYER.radius + 2;
  while (y < WORLD.height && !terrain.overlapsCircle(x, y + 1, PLAYER.radius)) y += 1;
  p.y = y;
  p.vy = 0;
  p.grounded = isGrounded(p, terrain);
}

/**
 * Trọng lực: rơi theo các bước ≤ 1px để không xuyên qua lớp đất mỏng.
 * Trả về 'landed' | 'fell' | null.
 */
export function stepPhysics(p, terrain, dt) {
  if (p.gone) return null;
  if (isGrounded(p, terrain)) {
    p.vy = 0;
    p.grounded = true;
    return null;
  }
  p.grounded = false;
  p.vy = Math.min(p.vy + PHYSICS.gravity * dt, PHYSICS.maxFallSpeed);
  let remaining = p.vy * dt;
  while (remaining > 0) {
    const step = Math.min(1, remaining);
    p.y += step;
    remaining -= step;
    if (isGrounded(p, terrain)) {
      const impact = p.vy;
      p.vy = 0;
      p.grounded = true;
      return impact > 260 ? 'landed' : null;
    }
  }
  if (p.y - PLAYER.radius > WORLD.height + 10) return 'fell';
  return null;
}
