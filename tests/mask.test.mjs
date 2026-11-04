/**
 * Kiểm thử mask va chạm thuần toán học — nền tảng để các máy chơi online luôn khớp nhau.
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carveCircle, rasterizeShapes } from '../js/core/mask.js';

const W = 200;
const H = 120;
const count = (mask) => mask.reduce((n, v) => n + v, 0);

test('raster hoá elip: diện tích ≈ π·rx·ry (cộng viền 1px)', () => {
  const mask = rasterizeShapes([{ type: 'ellipse', x: 100, y: 60, rx: 40, ry: 20 }], W, H);
  const expected = Math.PI * 41 * 21; // nới 1px mỗi phía
  assert.ok(Math.abs(count(mask) - expected) / expected < 0.04, `${count(mask)} vs ${expected}`);
});

test('raster hoá đa giác mặt đất: mọi pixel dưới đường mặt đất là đất', () => {
  const ground = [[-10, H + 10], [-10, 80], [W + 10, 80], [W + 10, H + 10]];
  const mask = rasterizeShapes([{ type: 'poly', points: ground }], W, H);
  for (let x = 0; x < W; x++) {
    assert.equal(mask[78 * W + x], 0, 'trên mặt đất (ngoài viền) phải trống');
    assert.equal(mask[79 * W + x], 1, 'viền 1px');
    assert.equal(mask[100 * W + x], 1);
  }
});

test('hình chữ nhật bo góc: góc bị bo, cạnh thẳng đầy đủ', () => {
  const mask = rasterizeShapes([{ type: 'rect', x: 50, y: 20, w: 60, h: 40, r: 12 }], W, H);
  assert.equal(mask[40 * W + 50], 1, 'giữa cạnh trái');
  assert.equal(mask[21 * W + 51], 0, 'góc trên-trái đã bo');
  assert.equal(mask[21 * W + 80], 1, 'giữa cạnh trên');
});

test('khoét hố: xoá đúng hình tròn, khoét lại lần 2 không xoá thêm', () => {
  const mask = new Uint8Array(W * H).fill(1);
  const removed = carveCircle(mask, W, H, 100.3, 60.7, 25);
  assert.ok(Math.abs(removed - Math.PI * 25 * 25) < 60, `removed = ${removed}`);
  assert.equal(count(mask), W * H - removed);
  assert.equal(carveCircle(mask, W, H, 100.3, 60.7, 25), 0);
  assert.equal(mask[60 * W + 100], 0);
  assert.equal(mask[60 * W + 130], 1);
});

test('tất định: cùng đầu vào ⇒ mask giống hệt từng bit (điều kiện để online không lệch)', () => {
  const shapes = [
    { type: 'poly', points: [[-10, H + 10], [-10, 70], [50, 64.37], [120, 81.2], [W + 10, 75], [W + 10, H + 10]] },
    { type: 'ellipse', x: 77.7, y: 30.3, rx: 23.1, ry: 9.9 },
  ];
  const a = rasterizeShapes(shapes, W, H);
  const b = rasterizeShapes(shapes, W, H);
  for (const [x, y, r] of [[60.2, 70.9, 25], [140.55, 77.1, 50]]) {
    carveCircle(a, W, H, x, y, r);
    carveCircle(b, W, H, x, y, r);
  }
  assert.deepEqual(a, b);
});
