/**
 * Chuyển đổi giữa toạ độ màn hình (px, trục y hướng xuống) và hệ trục Oxy (đơn vị toán, y hướng lên).
 * Gốc O nằm giữa bản đồ.
 */
import { WORLD } from '../config.js';

const ORIGIN_X = WORLD.width / 2;
const ORIGIN_Y = WORLD.height / 2;
const UNIT = WORLD.unit;

export const toPxX = (x) => ORIGIN_X + x * UNIT;
export const toPxY = (y) => ORIGIN_Y - y * UNIT;
export const toUnitX = (px) => (px - ORIGIN_X) / UNIT;
export const toUnitY = (py) => (ORIGIN_Y - py) / UNIT;

/** Giới hạn trục theo đơn vị toán: x ∈ [-25, 25], y ∈ [-15, 15]. */
export const AXIS = Object.freeze({
  xMin: toUnitX(0),
  xMax: toUnitX(WORLD.width),
  yMin: toUnitY(WORLD.height),
  yMax: toUnitY(0),
});
