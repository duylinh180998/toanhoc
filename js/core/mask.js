/**
 * Dữ liệu va chạm địa hình tính THUẦN TOÁN HỌC (không đọc lại pixel từ canvas).
 *
 * Vì sao? Pixel của canvas phụ thuộc độ phân giải màn hình (1x/2x) và cách khử răng cưa của từng
 * trình duyệt ⇒ khi chơi online, mép hố trên hai máy có thể lệch nhau 1px và tia đạn cho kết quả
 * khác nhau. Các phép tính số học dưới đây (cộng/nhân/sqrt — đều được IEEE 754 làm tròn chính xác)
 * cho kết quả GIỐNG HỆT NHAU trên mọi máy và mọi trình duyệt.
 *
 * Quy ước: pixel (x, y) là đất nếu TÂM pixel (x + 0.5, y + 0.5) nằm trong hình.
 * Mask: Uint8Array w×h, 1 = đất, 0 = trống.
 */

/** Tô một đa giác đơn (quét theo hàng — scanline, quy tắc chẵn-lẻ). */
function fillPolygon(mask, w, h, points) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const xs = [];
  const n = points.length;
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) fillSpan(mask, w, y, xs[k], xs[k + 1], 1);
  }
}

/** Đặt giá trị cho các pixel có tâm nằm trong [xa, xb] trên hàng y. Trả về số pixel đổi giá trị. */
function fillSpan(mask, w, y, xa, xb, value) {
  const from = Math.max(0, Math.ceil(xa - 0.5));
  const to = Math.min(w - 1, Math.floor(xb - 0.5));
  let changed = 0;
  for (let x = from, i = y * w + from; x <= to; x++, i++) {
    if (mask[i] !== value) {
      mask[i] = value;
      changed++;
    }
  }
  return changed;
}

function fillEllipse(mask, w, h, { x: cx, y: cy, rx, ry }) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, Math.ceil(cy + ry)); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (dy * dy > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    fillSpan(mask, w, y, cx - half, cx + half, 1);
  }
}

function fillRoundRect(mask, w, h, { x, y: top, w: rw, h: rh, r }) {
  const bottom = top + rh;
  for (let y = Math.max(0, Math.floor(top)); y <= Math.min(h - 1, Math.ceil(bottom)); y++) {
    const yc = y + 0.5;
    if (yc < top || yc > bottom) continue;
    // Thụt vào ở các góc bo tròn.
    let d = 0;
    if (yc < top + r) d = top + r - yc;
    else if (yc > bottom - r) d = yc - (bottom - r);
    const inset = d > 0 ? r - Math.sqrt(Math.max(0, r * r - d * d)) : 0;
    fillSpan(mask, w, y, x + inset, x + rw - inset, 1);
  }
}

/** Nới mask thêm 1px (lân cận 8 hướng) để khớp với nét viền phát sáng vẽ quanh địa hình. */
function dilate(src, w, h) {
  const out = new Uint8Array(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      search: for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && src[yy * w + xx]) {
            out[y * w + x] = 1;
            break search;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Raster hoá danh sách hình (poly | rect | ellipse — cùng định dạng Terrain dùng để vẽ).
 * @returns {Uint8Array}
 */
export function rasterizeShapes(shapes, w, h) {
  const mask = new Uint8Array(w * h);
  for (const s of shapes) {
    if (s.type === 'poly') fillPolygon(mask, w, h, s.points);
    else if (s.type === 'rect') fillRoundRect(mask, w, h, s);
    else if (s.type === 'ellipse') fillEllipse(mask, w, h, s);
  }
  return dilate(mask, w, h);
}

/** Khoét hố tròn tâm (cx, cy) bán kính r. Trả về số pixel đất bị phá. */
export function carveCircle(mask, w, h, cx, cy, r) {
  let removed = 0;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    const dy = y + 0.5 - cy;
    if (dy * dy > r * r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    removed += fillSpan(mask, w, y, cx - half, cx + half, 0);
  }
  return removed;
}
