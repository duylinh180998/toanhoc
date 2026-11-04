/**
 * Điểm khởi động: đảm bảo math.js đã tải → tạo các module → chạy vòng lặp requestAnimationFrame.
 */
import { Game } from './core/game.js';
import { Renderer } from './render/renderer.js';
import { Effects } from './render/effects.js';
import { Sfx } from './audio/sfx.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { OnlineSession } from './net/online.js';
import { loadScript } from './utils.js';

const MATHJS_FALLBACKS = [
  'https://unpkg.com/mathjs@13.2.0/lib/browser/math.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mathjs/13.2.0/math.min.js',
];

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

  const session = new OnlineSession(game);
  let screens = null;
  const hud = new Hud(game, sfx, { isOverlayOpen: () => screens?.isOverlayOpen() ?? true });
  screens = new Screens(game, sfx, session);

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); // chặn dt khi tab bị ẩn
    last = now;
    game.update(dt);
    session.pump();
    renderer.render(game, now / 1000);
    hud.frame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Tab bị ẩn thì requestAnimationFrame dừng. Khi đang online vẫn phải chạy logic (đồng hồ, lượt,
  // tin nhắn) để không làm kẹt trận của người khác ⇒ chạy bù bằng setInterval (không vẽ).
  setInterval(() => {
    if (!document.hidden || !session.active) return;
    const now = performance.now();
    let dt = Math.min(2, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const step = Math.min(0.05, dt);
      game.update(step);
      dt -= step;
    }
    session.pump();
  }, 250);

  // Đóng tab ⇒ báo cho phòng biết ngay thay vì chờ hết thời gian ping.
  addEventListener('pagehide', () => session.leave({ silent: true }));

  // Cho phép debug từ console: window.mga.game
  globalThis.mga = { game, renderer, hud, screens, sfx, session };
}

boot();
