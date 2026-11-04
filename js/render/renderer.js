/**
 * Renderer — vẽ toàn bộ khung hình lên canvas chính.
 * Thứ tự lớp: nền + lưới (cache) → trục tương đối → đồ thị cũ → địa hình → tia đang bay
 *            → nhân vật → hiệu ứng → công cụ ngắm → chỉ báo ngoài màn hình.
 */
import { PLAYER, TEAMS, WORLD } from '../config.js';
import { AXIS, toPxX, toPxY, toUnitX, toUnitY } from '../core/coords.js';
import { TAU, clamp, formatNumber } from '../utils.js';

const W = WORLD.width;
const H = WORLD.height;
const U = WORLD.unit;
const FONT_UI = '"Be Vietnam Pro", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function hpColor(ratio) {
  if (ratio > 0.6) return '#4ade80';
  if (ratio > 0.3) return '#fbbf24';
  return '#f87171';
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.mouse = null;
    this.resize();
    this.bindPointer();
  }

  /** Độ phân giải lưu địa hình (1x hoặc 2x) — chọn theo màn hình. */
  get terrainScale() {
    return this.dpr >= 1.5 ? 2 : 1;
  }

  resize() {
    this.canvas.width = W * this.dpr;
    this.canvas.height = H * this.dpr;
    this.background = this.buildBackground();
  }

  bindPointer() {
    const toLogical = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
    };
    this.canvas.addEventListener('pointermove', (e) => { this.mouse = toLogical(e); });
    this.canvas.addEventListener('pointerdown', (e) => { this.mouse = toLogical(e); });
    this.canvas.addEventListener('pointerleave', () => { this.mouse = null; });
  }

  /* ───────────────────────────── Nền + lưới toạ độ (vẽ 1 lần) ───────────────────────────── */

  buildBackground() {
    const c = document.createElement('canvas');
    c.width = W * this.dpr;
    c.height = H * this.dpr;
    const ctx = c.getContext('2d');
    ctx.scale(this.dpr, this.dpr);

    const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 40, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, '#141c40');
    bg.addColorStop(0.55, '#0b1029');
    bg.addColorStop(1, '#060915');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Vài "ngôi sao" mờ tạo chiều sâu.
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(190, 205, 255, ${0.03 + Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * W, Math.random() * H * 0.8, 1.2, 1.2);
    }

    const line = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // Lưới phụ (mỗi 1 đơn vị) và lưới chính (mỗi 5 đơn vị).
    ctx.lineWidth = 1;
    for (let x = Math.ceil(AXIS.xMin); x <= AXIS.xMax; x++) {
      if (x === 0) continue;
      ctx.strokeStyle = x % 5 === 0 ? 'rgba(130, 155, 255, 0.13)' : 'rgba(130, 155, 255, 0.05)';
      const px = Math.round(toPxX(x)) + 0.5;
      line(px, 0, px, H);
    }
    for (let y = Math.ceil(AXIS.yMin); y <= AXIS.yMax; y++) {
      if (y === 0) continue;
      ctx.strokeStyle = y % 5 === 0 ? 'rgba(130, 155, 255, 0.13)' : 'rgba(130, 155, 255, 0.05)';
      const py = Math.round(toPxY(y)) + 0.5;
      line(0, py, W, py);
    }

    // Trục Ox, Oy + mũi tên.
    const ox = toPxX(0) + 0.5;
    const oy = toPxY(0) + 0.5;
    ctx.strokeStyle = 'rgba(175, 195, 255, 0.4)';
    ctx.fillStyle = 'rgba(175, 195, 255, 0.55)';
    ctx.lineWidth = 1.4;
    line(0, oy, W - 2, oy);
    line(ox, H, ox, 2);
    ctx.beginPath();
    ctx.moveTo(W - 1, oy);
    ctx.lineTo(W - 9, oy - 4);
    ctx.lineTo(W - 9, oy + 4);
    ctx.closePath();
    ctx.moveTo(ox, 1);
    ctx.lineTo(ox - 4, 9);
    ctx.lineTo(ox + 4, 9);
    ctx.closePath();
    ctx.fill();

    // Vạch chia + nhãn số.
    ctx.font = `500 10px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(165, 185, 240, 0.6)';
    ctx.strokeStyle = 'rgba(175, 195, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = Math.ceil(AXIS.xMin); x <= AXIS.xMax; x++) {
      if (x === 0) continue;
      const px = Math.round(toPxX(x)) + 0.5;
      const major = x % 5 === 0;
      line(px, oy - (major ? 4 : 2), px, oy + (major ? 4 : 2));
      if (major && Math.abs(x) < 25) ctx.fillText(formatNumber(x, 0), px, oy + 6);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(AXIS.yMin); y <= AXIS.yMax; y++) {
      if (y === 0) continue;
      const py = Math.round(toPxY(y)) + 0.5;
      const major = y % 5 === 0;
      line(ox - (major ? 4 : 2), py, ox + (major ? 4 : 2), py);
      if (major && Math.abs(y) < 15) ctx.fillText(formatNumber(y, 0), ox - 7, py);
    }
    ctx.font = `600 12px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(190, 205, 255, 0.75)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('O', ox - 5, oy + 5);
    ctx.fillText('x', W - 6, oy + 7);
    ctx.textAlign = 'left';
    ctx.fillText('y', ox + 8, 4);

    // Vignette.
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,8,0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    return c;
  }

  /* ───────────────────────────── Khung hình ───────────────────────────── */

  render(game, t) {
    const { ctx, dpr } = this;
    const fx = game.effects;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.background, 0, 0, W, H);

    ctx.save();
    ctx.translate(fx.shakeX, fx.shakeY);
    const active = game.canAct ? game.current : null;
    this.drawTrails(game);
    ctx.drawImage(game.terrain.canvas, 0, 0, W, H);
    if (active) this.drawLocalAxes(active);
    if (game.shot) this.drawShot(game.shot);
    for (const p of game.players) this.drawPlayer(p, game, t);
    fx.draw(ctx);
    if (active && this.mouse) this.drawAimHelper(active, this.mouse);
    ctx.restore();

    if (game.shot?.head) this.drawOffscreenIndicator(game.shot);
    if (fx.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 236, 210, ${fx.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /** Trục toạ độ tương đối gốc tại nhân vật — chính là hệ trục của f(x − x0) − f(0). */
  drawLocalAxes(p) {
    const { ctx } = this;
    const color = TEAMS[p.team].color;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.22);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(W, p.y);
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, H);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = `600 9.5px ${FONT_MONO}`;
    ctx.fillStyle = hexToRgba(color, 0.7);
    ctx.strokeStyle = hexToRgba(color, 0.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = -50; k <= 50; k += 5) {
      const px = p.x + k * U;
      if (k === 0 || px < 8 || px > W - 8) continue;
      ctx.beginPath();
      ctx.moveTo(px, p.y - 3);
      ctx.lineTo(px, p.y + 3);
      ctx.stroke();
      ctx.fillText(formatNumber(k, 0), px, p.y + 5);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let k = -30; k <= 30; k += 5) {
      const py = p.y - k * U;
      if (k === 0 || py < 8 || py > H - 8) continue;
      ctx.beginPath();
      ctx.moveTo(p.x - 3, py);
      ctx.lineTo(p.x + 3, py);
      ctx.stroke();
      ctx.fillText(formatNumber(k, 0), p.x + 6, py);
    }
    ctx.restore();
  }

  strokeGlow(path, color, width = 2.2, alpha = 1) {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hexToRgba(color, 0.14);
    ctx.lineWidth = width * 4.5;
    ctx.stroke(path);
    ctx.strokeStyle = hexToRgba(color, 0.32);
    ctx.lineWidth = width * 2.2;
    ctx.stroke(path);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = width * 0.4;
    ctx.stroke(path);
    ctx.restore();
  }

  drawTrails(game) {
    const { ctx } = this;
    game.trails.forEach((trail, i) => {
      if (!trail.path) {
        trail.path = new Path2D();
        trail.points.forEach((pt, j) => (j ? trail.path.lineTo(pt.x, pt.y) : trail.path.moveTo(pt.x, pt.y)));
      }
      const age = game.time - trail.born;
      // Vệt mới nhất loé sáng rồi mờ dần thành nét đứt.
      if (i === 0 && age < 1) this.strokeGlow(trail.path, trail.color, 2.2, 1 - age);
      ctx.save();
      ctx.globalAlpha = [0.55, 0.32, 0.18][i] ?? 0.12;
      ctx.strokeStyle = trail.color;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.setLineDash([7, 6]);
      ctx.stroke(trail.path);
      ctx.restore();

      // Nhãn công thức ở cuối vệt.
      const end = trail.points[trail.points.length - 1];
      ctx.save();
      ctx.globalAlpha = ([0.85, 0.5, 0.3][i] ?? 0.2);
      ctx.font = `600 10px ${FONT_MONO}`;
      const label = trail.formula.length > 26 ? `${trail.formula.slice(0, 25)}…` : trail.formula;
      const w = ctx.measureText(label).width;
      const lx = clamp(end.x, w / 2 + 6, W - w / 2 - 6);
      const ly = clamp(end.y - 16, 14, H - 14);
      ctx.fillStyle = 'rgba(6, 9, 24, 0.7)';
      ctx.beginPath();
      ctx.roundRect(lx - w / 2 - 5, ly - 8, w + 10, 16, 5);
      ctx.fill();
      ctx.fillStyle = trail.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 0.5);
      ctx.restore();
    });
  }

  drawShot(shot) {
    if (!shot.head) return;
    const { ctx } = this;
    const pts = shot.trace.points;
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= shot.head.index; i++) path.lineTo(pts[i].x, pts[i].y);
    path.lineTo(shot.head.x, shot.head.y);
    this.strokeGlow(path, shot.color, shot.double ? 3.2 : 2.3);

    const { x, y } = shot.head;
    const r = shot.double ? 16 : 11;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, shot.double ? '#ffb46b' : shot.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawOffscreenIndicator(shot) {
    const { head } = shot;
    if (head.ry >= 0) return;
    const { ctx } = this;
    const x = clamp(head.x, 14, W - 14);
    ctx.save();
    ctx.fillStyle = shot.color;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x - 7, 15);
    ctx.lineTo(x + 7, 15);
    ctx.closePath();
    ctx.fill();
    ctx.font = `600 10px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`y=${formatNumber(toUnitY(head.ry), 1)}`, x, 18);
    ctx.restore();
  }

  /* ───────────────────────────── Nhân vật ───────────────────────────── */

  drawPlayer(p, game, t) {
    if (p.gone) return;
    const { ctx } = this;
    const team = TEAMS[p.team];
    const R = PLAYER.radius;

    if (!p.alive) {
      this.drawGrave(p);
      return;
    }

    const isActive = game.current === p && game.phase !== 'over';
    const bob = Math.sin(t * 2.4 + p.fx.phase) * 0.7;
    const sx = 1 + p.fx.land * 0.14;
    const sy = 1 - p.fx.land * 0.18;
    const hitShake = p.fx.hit > 0 ? Math.sin(t * 90) * p.fx.hit * 2.5 : 0;
    const x = p.x + hitShake;
    const y = p.y + bob + (1 - sy) * R;

    ctx.save();
    // Bóng dưới chân.
    ctx.fillStyle = 'rgba(0, 0, 10, 0.35)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + R + 1, 10, 2.6, 0, 0, TAU);
    ctx.fill();

    // Vòng sáng lượt hiện tại + hào quang phép đang chuẩn bị.
    if (isActive) {
      const pulse = (Math.sin(t * 5) + 1) / 2;
      ctx.strokeStyle = hexToRgba(team.color, 0.25 + pulse * 0.25);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R + 6 + pulse * 2, 0, TAU);
      ctx.stroke();
      if (game.armed === 'double') {
        ctx.strokeStyle = `rgba(255, 140, 70, ${0.5 + pulse * 0.4})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.arc(x, y, R + 10, 0, TAU);
        ctx.stroke();
      } else if (game.armed === 'teleport') {
        ctx.strokeStyle = `rgba(182, 156, 255, ${0.55 + pulse * 0.35})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 5]);
        ctx.lineDashOffset = t * 25;
        ctx.beginPath();
        ctx.arc(x, y, R + 10, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Thân (co giãn nhẹ khi tiếp đất).
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    const body = ctx.createRadialGradient(-3, -4, 1, 0, 0, R);
    body.addColorStop(0, team.soft);
    body.addColorStop(0.45, team.color);
    body.addColorStop(1, team.deep);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (p.fx.hit > 0) {
      ctx.fillStyle = `rgba(255,255,255,${p.fx.hit * 0.7})`;
      ctx.fill();
    }

    // Mắt nhìn theo hướng bắn (thỉnh thoảng chớp mắt).
    const f = p.facing;
    const blink = (t + p.fx.phase) % 4.2 < 0.12;
    for (const ex of [-2.8, 2.8]) {
      const cx = ex + f * 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx, -2, 2.5, blink ? 0.5 : 3, 0, 0, TAU);
      ctx.fill();
      if (!blink) {
        ctx.fillStyle = '#0a0f25';
        ctx.beginPath();
        ctx.arc(cx + f * 1, -1.6, 1.35, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // Mũi chỉ hướng bắn.
    ctx.fillStyle = hexToRgba(team.color, isActive ? 0.95 : 0.55);
    ctx.beginPath();
    const tipX = x + f * (R + 9);
    ctx.moveTo(tipX, y);
    ctx.lineTo(tipX - f * 6, y - 4.5);
    ctx.lineTo(tipX - f * 6, y + 4.5);
    ctx.closePath();
    ctx.fill();

    // Khiên.
    if (p.shield) {
      const SR = PLAYER.shieldRadius;
      const g = ctx.createRadialGradient(x, y, SR * 0.5, x, y, SR);
      g.addColorStop(0, 'rgba(140, 230, 255, 0.02)');
      g.addColorStop(1, 'rgba(140, 230, 255, 0.24)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, SR, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(165, 243, 255, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, SR - 2.5, t * 1.6, t * 1.6 + 0.9);
      ctx.stroke();
    }

    // Tên + thanh máu.
    const top = y - (p.shield ? PLAYER.shieldRadius : R) - 8;
    const bw = 36;
    const bh = 5;
    ctx.fillStyle = 'rgba(5, 8, 22, 0.8)';
    ctx.beginPath();
    ctx.roundRect(x - bw / 2 - 1, top - bh - 1, bw + 2, bh + 2, 3);
    ctx.fill();
    const ratio = p.hp / PLAYER.maxHp;
    const lag = p.hpLag / PLAYER.maxHp;
    if (lag > ratio) {
      ctx.fillStyle = 'rgba(255, 240, 240, 0.75)';
      ctx.fillRect(x - bw / 2, top - bh, bw * lag, bh);
    }
    ctx.fillStyle = hpColor(ratio);
    ctx.fillRect(x - bw / 2, top - bh, bw * ratio, bh);

    ctx.font = `700 11px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5, 8, 22, 0.85)';
    // Online: đánh dấu nhân vật do máy này điều khiển.
    const label = game.online && game.isLocal(p) ? `${p.name} · bạn` : p.name;
    ctx.strokeText(label, x, top - bh - 4);
    ctx.fillStyle = isActive ? '#fff' : team.soft;
    ctx.fillText(label, x, top - bh - 4);

    if (isActive) {
      const ay = top - bh - 22 + Math.sin(t * 5) * 2.5;
      ctx.fillStyle = team.color;
      ctx.shadowColor = team.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, ay + 7);
      ctx.lineTo(x - 6, ay);
      ctx.lineTo(x + 6, ay);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawGrave(p) {
    const { ctx } = this;
    const x = p.x;
    const y = p.y + PLAYER.radius;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 10, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 10, 2.5, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createLinearGradient(x, y - 20, x, y);
    g.addColorStop(0, '#8b93b8');
    g.addColorStop(1, '#4b5276');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x - 7, y - 13);
    ctx.arc(x, y - 13, 7, Math.PI, 0);
    ctx.lineTo(x + 7, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 24, 50, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y - 17);
    ctx.lineTo(x, y - 7);
    ctx.moveTo(x - 3.5, y - 13.5);
    ctx.lineTo(x + 3.5, y - 13.5);
    ctx.stroke();
    ctx.font = `600 10px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(160, 170, 210, 0.7)';
    ctx.fillText(p.name, x, y - 25);
    ctx.restore();
  }

  /* ───────────────────────────── Công cụ ngắm ───────────────────────────── */

  /** Tam giác vuông Δx, Δy từ nhân vật tới con trỏ — giúp ước lượng hệ số mà không lộ đáp án. */
  drawAimHelper(p, m) {
    const { ctx } = this;
    const dxU = (m.x - p.x) / U;
    const dyU = (p.y - m.y) / U;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(m.x, p.y);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 6, 0, TAU);
    ctx.moveTo(m.x - 10, m.y);
    ctx.lineTo(m.x - 3, m.y);
    ctx.moveTo(m.x + 3, m.y);
    ctx.lineTo(m.x + 10, m.y);
    ctx.moveTo(m.x, m.y - 10);
    ctx.lineTo(m.x, m.y - 3);
    ctx.moveTo(m.x, m.y + 3);
    ctx.lineTo(m.x, m.y + 10);
    ctx.stroke();

    const pill = (text, x, y, color) => {
      ctx.font = `600 10.5px ${FONT_MONO}`;
      const w = ctx.measureText(text).width + 12;
      const px = clamp(x - w / 2, 2, W - w - 2);
      const py = clamp(y - 9, 2, H - 20);
      ctx.fillStyle = 'rgba(6, 9, 24, 0.82)';
      ctx.beginPath();
      ctx.roundRect(px, py, w, 18, 6);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px + 6, py + 9.5);
    };
    if (Math.abs(m.x - p.x) > 30) pill(`Δx ${formatNumber(dxU)}`, (p.x + m.x) / 2, p.y + (m.y > p.y ? -14 : 14), '#e2e8ff');
    if (Math.abs(m.y - p.y) > 24) pill(`Δy ${formatNumber(dyU)}`, m.x + (m.x > p.x ? 40 : -40), (p.y + m.y) / 2, '#e2e8ff');
    pill(`(${formatNumber(toUnitX(m.x), 1)}; ${formatNumber(toUnitY(m.y), 1)})`, m.x, m.y + 22, 'rgba(170, 185, 235, 0.9)');
    ctx.restore();
  }
}
