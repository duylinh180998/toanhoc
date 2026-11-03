/**
 * Kiểm thử thuật toán truy vết đồ thị + parser công thức (không cần trình duyệt).
 *   npm install && npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

globalThis.math = mathjs; // formula.js dùng biến toàn cục `math` như khi chạy trên trình duyệt

const { compileFormula, anchorPoint } = await import('../js/math/formula.js');
const { traceGraph } = await import('../js/core/tracer.js');
const { WORLD } = await import('../js/config.js');

const U = WORLD.unit;
const ORIGIN = { x: 300, y: 300 };

/** Địa hình giả: một hàm (x, y) → boolean. */
const terrainOf = (solid = () => false) => ({ isSolid: (x, y) => solid(Math.floor(x), Math.floor(y)) });
const shooter = { x: ORIGIN.x, y: ORIGIN.y, hitRadius: 11 };

function shoot(formula, { dir = 1, terrain = terrainOf(), players = [shooter] } = {}) {
  const compiled = compileFormula(formula);
  assert.ok(compiled.ok, compiled.error);
  const anchor = anchorPoint(compiled.fn, dir);
  assert.ok(anchor, 'anchor phải xác định');
  return traceGraph({ fn: compiled.fn, anchor, origin: ORIGIN, dir, terrain, players, shooter });
}

test('đồ thị luôn xuất phát tại nhân vật: Y = y0 + f(x − x0) − f(0)', () => {
  const { points } = shoot('x^2 + 5');
  assert.deepEqual([points[0].x, points[0].y], [ORIGIN.x, ORIGIN.y]);
  // Sau 1 đơn vị (20px) theo x, y phải cao hơn đúng f(1) − f(0) = 1 đơn vị.
  const p = points.find((q) => Math.abs(q.x - (ORIGIN.x + U)) < 0.6);
  assert.ok(Math.abs(p.y - (ORIGIN.y - U)) < 1.5, `y = ${p.y}`);
});

test('hàm rất dốc không xuyên qua tường mỏng 1px (sub-stepping)', () => {
  // Trần mỏng 1px nằm ngang phía trên nhân vật 100px; 1000x tăng 1000px cho mỗi 1px ngang.
  const ceilingY = ORIGIN.y - 100;
  const terrain = terrainOf((x, y) => y === ceilingY && x >= ORIGIN.x && x < ORIGIN.x + 40);
  const { end } = shoot('1000*x', { terrain });
  assert.equal(end.reason, 'terrain');
  assert.equal(Math.floor(end.y), ceilingY);
});

test('tường đứng mỏng 1px chặn được đường nằm ngang', () => {
  const wallX = ORIGIN.x + 50;
  const terrain = terrainOf((x) => x === wallX);
  const { end } = shoot('0', { terrain });
  assert.equal(end.reason, 'terrain');
  assert.equal(Math.floor(end.x), wallX);
});

test('trúng nhân vật khác trên đường đi', () => {
  const enemy = { x: ORIGIN.x + 120, y: ORIGIN.y, hitRadius: 11 };
  const { end } = shoot('0', { players: [shooter, enemy] });
  assert.equal(end.reason, 'player');
  assert.equal(end.target, enemy);
  assert.ok(Math.abs(end.x - (enemy.x - 11)) <= 1);
});

test('không tự trúng chính mình lúc xuất phát', () => {
  const { end } = shoot('0.2*x');
  assert.notEqual(end.reason, 'player');
});

test('tiệm cận đứng: tia dừng tại x = 3 thay vì vẽ vạch dọc giả', () => {
  const { end, points } = shoot('-1/(x-3)');
  assert.equal(end.reason, 'asymptote');
  assert.ok(Math.abs(points.at(-1).x - (ORIGIN.x + 3 * U)) < 1);
});

test('ra ngoài miền xác định: sqrt(4 − x) dừng tại x = 4', () => {
  const { end, points } = shoot('sqrt(4 - x)');
  assert.equal(end.reason, 'domain');
  assert.ok(Math.abs(points.at(-1).x - (ORIGIN.x + 4 * U)) < 1);
});

test('bắn sang trái dùng phần x < 0 của f', () => {
  const { points } = shoot('-0.5*x', { dir: -1 });
  const p = points.find((q) => Math.abs(q.x - (ORIGIN.x - 2 * U)) < 0.6);
  assert.ok(p.y < ORIGIN.y - U * 0.9, 'đi lên khi x âm');
});

test('f(0) không xác định (log x) ⇒ neo lệch 1px và vẫn vẽ được', () => {
  const { points } = shoot('log(x)');
  assert.ok(points.length > 50);
});

test('hàm dao động quá dữ bị giới hạn năng lượng', () => {
  const { end, points } = shoot('5*sin(40x)', { players: [] });
  assert.equal(end.reason, 'limit');
  assert.ok(points.length < 60_000);
});

test('dao động biên độ lớn có thể quay lại trúng chính người bắn', () => {
  const { end } = shoot('40*sin(40x)');
  assert.equal(end.reason, 'player');
  assert.equal(end.target, shooter);
});

test('parser: whitelist + chuẩn hoá cách gõ tự nhiên', () => {
  for (const ok of ['2x', '3sin(x)', 'x²', '−x + 1', 'f(x) = x/2', 'ln(x)', 'x < 2 ? x : 2', 'π*x']) {
    assert.ok(compileFormula(ok).ok, ok);
  }
  for (const bad of ['x = 3', 'y + 1', 'sin x', 'evaluate("1")', '[1,2]', 'x.constructor', '0,5*x']) {
    assert.equal(compileFormula(bad).ok, false, bad);
  }
  assert.ok(Number.isNaN(compileFormula('sqrt(x)').fn(-1)), 'số phức ⇒ NaN');
  assert.ok(Number.isNaN(compileFormula('1/x').fn(0)), 'chia 0 ⇒ NaN');
});
