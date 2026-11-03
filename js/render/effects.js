/** Hiệu ứng hình ảnh: hạt, sóng xung kích, chữ bay, rung màn hình. Toạ độ px logic. */
import { TAU, clamp, easeOutCubic } from '../utils.js';

const MAX_PARTICLES = 900;

export class Effects {
  constructor() {
    this.clear();
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  clear() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.glows = [];
    this.shakeAmp = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flash = 0;
  }

  /* ───────────────────────────── Tạo hiệu ứng ───────────────────────────── */

  particle(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ life: 1, max: 1, size: 2, gravity: 0, drag: 0.9, additive: false, ...p, age: 0 });
  }

  explosion(x, y, radius, color, big = false) {
    const n = big ? 90 : 55;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = (0.35 + Math.random()) * radius * (big ? 9 : 8);
      this.particle({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: 0.35 + Math.random() * 0.45, size: 1.2 + Math.random() * 2.4,
        color: Math.random() < 0.55 ? color : '#ffe7b0', additive: true, drag: 0.86, gravity: 300,
      });
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = -Math.PI * Math.random();
      const v = 120 + Math.random() * 320;
      this.particle({
        x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.7 + Math.random() * 0.8, size: 1.5 + Math.random() * 2.5,
        color: Math.random() < 0.5 ? '#3a4685' : '#5d6bc0', gravity: 900, drag: 0.985, square: true,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.particle({
        x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius,
        vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40,
        life: 1 + Math.random() * 0.8, size: radius * (0.4 + Math.random() * 0.4),
        color: 'rgba(120, 130, 190, 0.16)', drag: 0.96, smoke: true,
      });
    }
    this.rings.push({ x, y, r: radius * 0.4, to: radius * (big ? 2.4 : 2.1), life: 0.5, age: 0, color, width: 3 });
    this.rings.push({ x, y, r: radius * 0.9, to: radius * 1.05, life: 1.3, age: 0, color: '#ff9b5e', width: 2.5, ember: true });
    this.glows.push({ x, y, r: radius * 2.2, life: 0.35, age: 0, color });
    this.shake(big ? 13 : 8);
    this.flash = Math.max(this.flash, big ? 0.35 : 0.2);
  }

  fizzle(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      const v = 40 + Math.random() * 90;
      this.particle({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4,
        size: 1 + Math.random() * 1.5, color, additive: true, drag: 0.9,
      });
    }
    this.rings.push({ x, y, r: 2, to: 18, life: 0.45, age: 0, color, width: 1.5 });
  }

  sparkle(x, y, color) {
    this.particle({
      x, y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60 + 20,
      life: 0.25 + Math.random() * 0.35, size: 0.8 + Math.random() * 1.6, color, additive: true, drag: 0.92,
    });
  }

  heal(x, y) {
    for (let i = 0; i < 26; i++) {
      this.particle({
        x: x + (Math.random() - 0.5) * 30, y: y + 8 - Math.random() * 10,
        vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 70,
        life: 0.8 + Math.random() * 0.6, size: 2 + Math.random() * 2, color: '#5dfca0',
        additive: true, drag: 0.97, plus: true,
      });
    }
    this.rings.push({ x, y, r: 6, to: 34, life: 0.6, age: 0, color: '#5dfca0', width: 2 });
  }

  shieldUp(x, y) {
    this.rings.push({ x, y, r: 30, to: 19, life: 0.4, age: 0, color: '#8fe8ff', width: 3 });
    this.rings.push({ x, y, r: 19, to: 40, life: 0.6, age: 0, color: '#8fe8ff', width: 1.5 });
  }

  shieldBreak(x, y) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * TAU;
      const v = 80 + Math.random() * 160;
      this.particle({
        x: x + Math.cos(a) * 19, y: y + Math.sin(a) * 19, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.4, size: 1.5 + Math.random() * 2, color: '#a5f3ff',
        additive: true, drag: 0.9, gravity: 200, square: true,
      });
    }
    this.rings.push({ x, y, r: 19, to: 46, life: 0.5, age: 0, color: '#a5f3ff', width: 2.5 });
  }

  teleport(x, y, color) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU;
      const r = 4 + Math.random() * 22;
      this.particle({
        x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.sin(a) * 90, vy: Math.cos(a) * 90 - 40,
        life: 0.5 + Math.random() * 0.5, size: 1 + Math.random() * 2, color: Math.random() < 0.5 ? color : '#c4b5fd',
        additive: true, drag: 0.93,
      });
    }
    this.rings.push({ x, y, r: 34, to: 4, life: 0.45, age: 0, color: '#c4b5fd', width: 2 });
    this.glows.push({ x, y, r: 46, life: 0.4, age: 0, color: '#a78bfa' });
  }

  death(x, y, color) {
    this.explosion(x, y, 18, color, false);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU;
      const v = 60 + Math.random() * 200;
      this.particle({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 100, life: 1 + Math.random() * 0.6,
        size: 2 + Math.random() * 2.5, color, gravity: 600, drag: 0.98, square: true,
      });
    }
  }

  dust(x, y) {
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      this.particle({
        x: x + side * 6, y, vx: side * (30 + Math.random() * 70), vy: -10 - Math.random() * 40,
        life: 0.4 + Math.random() * 0.3, size: 3 + Math.random() * 3, color: 'rgba(160, 170, 230, 0.25)',
        drag: 0.92, smoke: true,
      });
    }
  }

  text(x, y, text, color, size = 18) {
    this.texts.push({ x, y, text, color, size, age: 0, life: 1.25, vy: -42 });
  }

  shake(amount) {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /* ───────────────────────────── Cập nhật & vẽ ───────────────────────────── */

  update(dt) {
    for (const p of this.particles) {
      p.age += dt;
      const drag = p.drag ** (dt * 60);
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const g of this.glows) g.age += dt;
    this.glows = this.glows.filter((g) => g.age < g.life);
    for (const t of this.texts) {
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= 0.96 ** (dt * 60);
    }
    this.texts = this.texts.filter((t) => t.age < t.life);

    this.shakeAmp *= 0.86 ** (dt * 60);
    if (this.shakeAmp < 0.2) this.shakeAmp = 0;
    this.shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp;
    this.shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp;
    this.flash = Math.max(0, this.flash - dt * 1.6);
  }

  draw(ctx) {
    ctx.save();
    for (const g of this.glows) {
      const k = g.age / g.life;
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      grad.addColorStop(0, 'rgba(255, 245, 220, 0.9)');
      grad.addColorStop(0.25, g.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (0.7 + 0.3 * k), 0, TAU);
      ctx.fill();
    }

    for (const p of this.particles) {
      const k = p.age / p.life;
      ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      ctx.globalAlpha = clamp(1 - k, 0, 1);
      ctx.fillStyle = p.color;
      if (p.smoke) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + k * 0.8), 0, TAU);
        ctx.fill();
      } else if (p.square) {
        const s = p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.plus) {
        const s = p.size * 1.6;
        ctx.fillRect(p.x - s / 2, p.y - s / 6, s, s / 3);
        ctx.fillRect(p.x - s / 6, p.y - s / 2, s / 3, s);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = r.age / r.life;
      const e = easeOutCubic(k);
      ctx.globalAlpha = r.ember ? (1 - k) * 0.85 : (1 - k);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (r.ember ? 1 : 1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + (r.to - r.r) * e, 0, TAU);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.age / t.life;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.5);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${Math.round(t.size * pop)}px "Be Vietnam Pro", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 8, 22, 0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
