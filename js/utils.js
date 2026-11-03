/** Tiện ích dùng chung — không phụ thuộc module nào khác. */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/** RNG có seed (mulberry32) — cùng seed ⇒ cùng bản đồ. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

export const randomSeed = () => Math.floor(Math.random() * 900000) + 100000;

/** Định dạng số cho UI: dùng dấu trừ thật (−) và bỏ "-0". */
export function formatNumber(n, digits = 2) {
  if (!Number.isFinite(n)) return '∞';
  const s = n.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s.replace('-', '−');
}

/** Event emitter tối giản cho giao tiếp Game → UI. */
export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event).delete(fn);
  }

  emit(event, payload) {
    this.handlers.get(event)?.forEach((fn) => fn(payload));
  }
}

/** localStorage có thể bị chặn (chế độ ẩn danh, iframe...) — luôn bọc try/catch. */
export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* bỏ qua */
    }
  },
};
