/**
 * Địa hình phá huỷ được.
 *
 * - `canvas` (offscreen) chứa hình ảnh địa hình, vẽ ở độ phân giải `scale` (1x hoặc 2x cho màn retina).
 * - `mask` (Uint8Array W×H, độ phân giải logic) là dữ liệu va chạm: 1 = đất, 0 = trống.
 *   Mask được đọc lại từ kênh alpha (getImageData) sau mỗi lần thay đổi ⇒ "thấy gì, chạm nấy".
 * - Phá huỷ: vẽ hình tròn với globalCompositeOperation = 'destination-out' rồi cập nhật mask
 *   cho vùng bị ảnh hưởng.
 */
import { createRng, TAU } from '../utils.js';

const SOLID_ALPHA = 110; // ngưỡng alpha để coi một pixel là đất

const PALETTE = {
  top: '#2c3770',
  mid: '#1b2352',
  bottom: '#0e1330',
  outline: '#8494ff',
  outlineGlow: 'rgba(120, 136, 255, 0.85)',
  rim: '#b9c4ff',
  hatch: 'rgba(170, 186, 255, 0.075)',
  scorch: 'rgba(4, 6, 18, 0.9)',
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class Terrain {
  constructor(width, height, scale = 1) {
    this.w = width;
    this.h = height;
    this.scale = scale;
    this.canvas = makeCanvas(width * scale, height * scale);
    this.ctx = this.canvas.getContext('2d');
    this.mask = new Uint8Array(width * height);
    this.seed = 0;
  }

  /* ───────────────────────────── Truy vấn va chạm ───────────────────────────── */

  isSolid(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return false;
    return this.mask[yi * this.w + xi] === 1;
  }

  /** Thân hình tròn (cx, cy, r) có chồng lên đất không? (lấy mẫu trên chu vi + tâm) */
  overlapsCircle(cx, cy, r) {
    if (this.isSolid(cx, cy)) return true;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      if (this.isSolid(cx + Math.cos(a) * r, cy + Math.sin(a) * r)) return true;
    }
    return false;
  }

  /** y của mặt đất đầu tiên bên dưới (x, fromY), hoặc null nếu không có. */
  surfaceBelow(x, fromY = 0) {
    for (let y = Math.max(0, Math.floor(fromY)); y < this.h; y++) if (this.isSolid(x, y)) return y;
    return null;
  }

  /* ───────────────────────────── Sinh bản đồ ───────────────────────────── */

  generate(seed) {
    this.seed = seed;
    const rng = createRng(seed);
    const { w, h } = this;

    // 1) Mặt đất: tổng các sóng sin với pha/tần số ngẫu nhiên.
    const base = h * rng.range(0.7, 0.78);
    const waves = [
      { a: rng.range(16, 32), f: rng.range(0.004, 0.007), p: rng.range(0, TAU) },
      { a: rng.range(7, 15), f: rng.range(0.012, 0.02), p: rng.range(0, TAU) },
      { a: rng.range(2, 4), f: rng.range(0.04, 0.06), p: rng.range(0, TAU) },
    ];
    const middle = rng.pick(['pillar', 'hill', 'twin', 'arch']);
    const cx = w / 2 + rng.range(-25, 25);
    const hill = middle === 'hill' || middle === 'arch'
      ? { a: rng.range(150, 215), s: rng.range(48, 70) }
      : null;
    const groundY = (x) => {
      let y = base;
      for (const wv of waves) y += wv.a * Math.sin(wv.f * x + wv.p);
      if (hill) y -= hill.a * Math.exp(-(((x - cx) / hill.s) ** 2));
      return y;
    };

    const shapes = [];
    const ground = [[-12, h + 12]];
    for (let x = -12; x <= w + 12; x += 4) ground.push([x, groundY(x)]);
    ground.push([w + 12, h + 12]);
    shapes.push({ type: 'poly', points: ground });

    // 2) Chướng ngại giữa bản đồ.
    const blocked = []; // các vùng chữ nhật không đặt đảo nổi
    if (middle === 'pillar') {
      const pw = rng.range(54, 80);
      const top = rng.range(170, 245);
      shapes.push({ type: 'rect', x: cx - pw / 2, y: top, w: pw, h: h - top + 12, r: 12 });
      if (rng() < 0.6) {
        const capW = rng.range(110, 150);
        shapes.push({ type: 'rect', x: cx - capW / 2, y: top - 4, w: capW, h: 20, r: 10 });
      }
      blocked.push([cx - 110, 0, cx + 110, h]);
    } else if (middle === 'twin') {
      for (const side of [-1, 1]) {
        const pw = rng.range(32, 44);
        const top = rng.range(190, 280);
        const px = cx + side * rng.range(52, 70);
        shapes.push({ type: 'rect', x: px - pw / 2, y: top, w: pw, h: h - top + 12, r: 10 });
      }
      blocked.push([cx - 130, 0, cx + 130, h]);
    } else if (middle === 'arch') {
      const barW = rng.range(140, 190);
      const barY = groundY(cx) - rng.range(85, 115);
      shapes.push({ type: 'rect', x: cx - barW / 2, y: barY, w: barW, h: 18, r: 9 });
      blocked.push([cx - 140, 0, cx + 140, h]);
    } else {
      blocked.push([cx - 100, 0, cx + 100, h]);
    }

    // 3) Đảo nổi: hợp của vài elip, tránh vùng giữa và sát mép trên.
    const islandCount = rng.int(2, 4);
    for (let i = 0, tries = 0; i < islandCount && tries < 40; tries++) {
      const ix = rng.range(110, w - 110);
      const rw = rng.range(36, 66);
      const iy = rng.range(165, 330);
      if (iy > groundY(ix) - 95) continue;
      if (blocked.some(([x0, y0, x1, y1]) => ix + rw > x0 && ix - rw < x1 && iy > y0 && iy < y1)) continue;
      const rh = rng.range(11, 17);
      shapes.push({ type: 'ellipse', x: ix, y: iy, rx: rw, ry: rh });
      shapes.push({ type: 'ellipse', x: ix + rng.range(-0.35, 0.35) * rw, y: iy + rh * 0.55, rx: rw * 0.55, ry: rh * 1.05 });
      shapes.push({ type: 'ellipse', x: ix + rng.range(-0.2, 0.2) * rw, y: iy + rh * 1.2, rx: rw * 0.22, ry: rh * 0.9 });
      blocked.push([ix - rw - 50, iy - 70, ix + rw + 50, iy + 70]);
      i++;
    }

    this.paint(shapes, rng);
    this.rebuildMask(0, 0, w, h);
  }

  /** Vẽ địa hình: thân gradient + hoạ tiết gạch chéo + viền phát sáng + ánh sáng mép trên. */
  paint(shapes, rng) {
    const { w, h, scale } = this;
    const W = w * scale;
    const H = h * scale;

    // Mặt nạ hình dạng (trắng đặc) — hợp của mọi hình.
    const shape = makeCanvas(W, H);
    const sctx = shape.getContext('2d');
    sctx.setTransform(scale, 0, 0, scale, 0, 0);
    sctx.fillStyle = '#fff';
    for (const s of shapes) {
      sctx.beginPath();
      if (s.type === 'poly') {
        s.points.forEach(([x, y], i) => (i ? sctx.lineTo(x, y) : sctx.moveTo(x, y)));
        sctx.closePath();
      } else if (s.type === 'rect') {
        sctx.roundRect(s.x, s.y, s.w, s.h, s.r);
      } else {
        sctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, TAU);
      }
      sctx.fill();
    }

    const tinted = (fill) => {
      const c = makeCanvas(W, H);
      const cx = c.getContext('2d');
      cx.drawImage(shape, 0, 0);
      cx.globalCompositeOperation = 'source-in';
      cx.fillStyle = fill;
      cx.fillRect(0, 0, W, H);
      return c;
    };

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // a) Viền ngoài: vẽ bản tô màu viền lệch 8 hướng (đằng sau thân) + glow.
    const outline = tinted(PALETTE.outline);
    ctx.save();
    ctx.shadowColor = PALETTE.outlineGlow;
    ctx.shadowBlur = 10 * scale;
    const o = 1.6 * scale;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.drawImage(outline, Math.cos(a) * o, Math.sin(a) * o);
    }
    ctx.restore();

    // b) Thân địa hình: gradient dọc.
    const grad = ctx.createLinearGradient(0, 140 * scale, 0, H);
    grad.addColorStop(0, PALETTE.top);
    grad.addColorStop(0.45, PALETTE.mid);
    grad.addColorStop(1, PALETTE.bottom);
    ctx.drawImage(tinted(grad), 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // c) Hoạ tiết gạch chéo kiểu "miền tô dưới đồ thị".
    const tile = makeCanvas(12 * scale, 12 * scale);
    const tctx = tile.getContext('2d');
    tctx.scale(scale, scale);
    tctx.strokeStyle = PALETTE.hatch;
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(-3, 15);
    tctx.lineTo(15, -3);
    tctx.moveTo(-3, 3);
    tctx.lineTo(3, -3);
    tctx.moveTo(9, 15);
    tctx.lineTo(15, 9);
    tctx.stroke();
    const pattern = ctx.createPattern(tile, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(1 / scale));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);

    // d) Đốm nhiễu nhẹ tạo chất liệu.
    for (let i = 0; i < 900; i++) {
      const light = rng() < 0.5;
      ctx.fillStyle = light ? 'rgba(190, 200, 255, 0.05)' : 'rgba(0, 0, 10, 0.18)';
      const r = rng.range(0.6, 2.2);
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // e) Ánh sáng mép trên: (hình dạng) − (hình dạng dịch xuống d px) = dải sáng ở mặt trên.
    const rimBand = (shift, color, alpha) => {
      const band = tinted(color);
      const bctx = band.getContext('2d');
      bctx.globalCompositeOperation = 'destination-out';
      bctx.drawImage(shape, 0, shift * scale);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.drawImage(band, 0, 0);
      ctx.restore();
    };
    rimBand(16, PALETTE.rim, 0.07);
    rimBand(6, PALETTE.rim, 0.16);
    rimBand(2.5, PALETTE.rim, 0.55);
  }

  /* ───────────────────────────── Phá huỷ ───────────────────────────── */

  /** Khoét một hố tròn bán kính r tại (cx, cy) — trả về true nếu có đất bị phá. */
  carve(cx, cy, r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    // 1) Xoá hình tròn: destination-out giữ lại phần KHÔNG giao với hình vẽ.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();

    // 2) Viền cháy sém quanh hố — 'source-atop' chỉ tô lên phần đất còn lại.
    ctx.globalCompositeOperation = 'source-atop';
    const scorch = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 10);
    scorch.addColorStop(0, PALETTE.scorch);
    scorch.addColorStop(1, 'rgba(4, 6, 18, 0)');
    ctx.fillStyle = scorch;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 10, 0, TAU);
    ctx.fill();

    // 3) Nét viền sáng mảnh để mép hố đồng bộ với viền địa hình.
    ctx.strokeStyle = PALETTE.outline;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 0.8, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const pad = 14;
    return this.rebuildMask(cx - r - pad, cy - r - pad, cx + r + pad, cy + r + pad);
  }

  /** Đọc lại kênh alpha của vùng [x0,x1)×[y0,y1) vào mask. Trả về số pixel đất bị mất. */
  rebuildMask(x0, y0, x1, y1) {
    const { w, h, scale } = this;
    const ax = Math.max(0, Math.floor(x0));
    const ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(w, Math.ceil(x1));
    const by = Math.min(h, Math.ceil(y1));
    if (bx <= ax || by <= ay) return 0;

    const bw = bx - ax;
    const data = this.ctx.getImageData(ax * scale, ay * scale, bw * scale, (by - ay) * scale).data;
    const rowStride = bw * scale * 4;
    const half = scale >> 1; // lấy mẫu giữa mỗi khối scale×scale
    let removed = 0;
    for (let y = ay; y < by; y++) {
      const row = ((y - ay) * scale + half) * rowStride;
      for (let x = ax; x < bx; x++) {
        const alpha = data[row + ((x - ax) * scale + half) * 4 + 3];
        const idx = y * w + x;
        const solid = alpha > SOLID_ALPHA ? 1 : 0;
        if (this.mask[idx] && !solid) removed++;
        this.mask[idx] = solid;
      }
    }
    return removed;
  }
}
