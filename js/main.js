/**
 * Điểm khởi động: đảm bảo math.js đã tải → tạo các module → chạy vòng lặp requestAnimationFrame.
 */
import { Game } from './core/game.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';

const MATHJS_FALLBACKS = [
  'https://unpkg.com/mathjs@13.2.0/lib/browser/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/13.2.0/math.min.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

async function ensureMathJs() {
  for (const url of MATHJS_FALLBACKS) {
    if (globalThis.math?.parse) return true;
    try {
      await loadScript(url);
    } catch {
      /* thử CDN tiếp theo */
    }
  }
  return !!globalThis.math?.parse;
}

async function boot() {
  if (!(await ensureMathJs())) {
    document.getElementById('bootError').hidden = false;
    return;
  }
  // Đợi font tải xong để chữ vẽ trên canvas dùng đúng font (tối đa 1.5s).
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  const effects = new Effects();
  const sfx = new Sfx();
  const game = new Game({ effects, sfx, terrainScale: renderer.terrainScale });

  let screens = null;
  const hud = new Hud(game, sfx, { isOverlayOpen: () => screens?.isOverlayOpen() ?? true });
  screens = new Screens(game, sfx);

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); // chặn dt khi tab bị ẩn
    last = now;
    game.update(dt);
    renderer.render(game, now / 1000);
    hud.frame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Cho phép debug từ console: window.mga.game
  globalThis.mga = { game, renderer, hud, screens, sfx };
}

boot();
