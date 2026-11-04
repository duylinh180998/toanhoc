/**
 * HUD — nối DOM (bảng điều khiển, bảng đội, banner, toast, phím tắt) với Game.
 * Chỉ đọc trạng thái Game; mọi thao tác đi qua game.request() (chơi online sẽ được gửi cho chủ phòng).
 */
import { PLAYER, SPELLS, SPELL_BY_ID, TEAMS } from '../config.js';
import { anchorPoint, compileFormula } from '../math/formula.js';
import { formatNumber } from '../utils.js';

const SPELL_ICONS = {
  teleport: '<svg viewBox="0 0 24 24"><path d="M4 19c2.5-7 6.5-11 14-12.5"/><path d="M14.5 3.5 18.5 6.5 15.5 10.5"/><circle cx="5" cy="19" r="1.8"/></svg>',
  heal: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-8.9-9.6C2.1 7.4 4.4 4.5 7.6 4.5c1.9 0 3.3 1 4.4 2.5 1.1-1.5 2.5-2.5 4.4-2.5 3.2 0 5.5 2.9 4.5 6.4-1.4 5-8.9 9.6-8.9 9.6z"/><path d="M12 9.5v5M9.5 12h5"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>',
  double: '<svg viewBox="0 0 24 24"><path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/></svg>',
};

/** [nhãn, đoạn chèn] — đoạn kết thúc bằng "()" sẽ đặt con trỏ vào giữa ngoặc. */
const QUICK_INSERTS = [
  ['x', 'x'], ['x²', '^2'], ['^', '^'], ['sin', 'sin()'], ['cos', 'cos()'], ['tan', 'tan()'],
  ['√', 'sqrt()'], ['|x|', 'abs()'], ['ln', 'log()'], ['eˣ', 'exp()'], ['π', 'pi'], ['( )', '()'],
];

const $ = (id) => document.getElementById(id);
const isFinePointer = globalThis.matchMedia?.('(pointer: fine)').matches ?? true;
const RING = 2 * Math.PI * 20;

export class Hud {
  constructor(game, sfx, { isOverlayOpen }) {
    this.game = game;
    this.sfx = sfx;
    this.isOverlayOpen = isOverlayOpen;
    this.el = {
      panel: $('panel'),
      scoreboard: $('scoreboard'),
      input: $('formula'),
      field: $('formulaField'),
      state: $('formulaState'),
      msg: $('formulaMsg'),
      quick: $('quickChips'),
      history: $('historyChips'),
      spells: $('spells'),
      fire: $('fireBtn'),
      fireLabel: $('fireLabel'),
      timer: $('timer'),
      timerRing: $('timerRing'),
      timerText: $('timerText'),
      avatar: $('ppAvatar'),
      name: $('ppName'),
      team: $('ppTeam'),
      hpFill: $('ppHpFill'),
      hpLag: $('ppHpLag'),
      hpText: $('ppHpText'),
      badges: $('ppBadges'),
      banner: $('turnBanner'),
      bannerName: $('turnBannerName'),
      bannerTeam: $('turnBannerTeam'),
      toasts: $('toasts'),
      dirButtons: [...document.querySelectorAll('.dir-toggle button')],
    };
    this.lastTimer = '';
    this.validateTimer = 0;

    this.buildSpells();
    this.buildQuickChips();
    this.bindControls();
    this.bindKeyboard();
    this.bindGame();
    this.refresh();
  }

  /* ───────────────────────────── Dựng DOM ───────────────────────────── */

  buildSpells() {
    this.spellButtons = {};
    for (const [i, spell] of SPELLS.entries()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spell';
      btn.dataset.spell = spell.id;
      btn.dataset.tip = `${spell.name} (phím ${i + 1}) — ${spell.desc} ${spell.charges} lần/trận, hồi ${spell.cooldown} lượt.`;
      btn.setAttribute('aria-label', spell.name);
      btn.innerHTML = `${SPELL_ICONS[spell.id]}<span class="spell-name">${spell.name.replace(' Sát thương', '')}</span>`
        + `<span class="spell-pips">${'<i></i>'.repeat(spell.charges)}</span><span class="spell-cd" hidden></span>`;
      btn.addEventListener('click', () => {
        this.game.request({ kind: 'spell', id: spell.id });
        this.focusInput();
      });
      this.el.spells.append(btn);
      this.spellButtons[spell.id] = btn;
    }
  }

  buildQuickChips() {
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = 'Chèn';
    this.el.quick.append(label);
    for (const [text, snippet] of QUICK_INSERTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = text;
      chip.addEventListener('mousedown', (e) => e.preventDefault()); // giữ focus ở ô nhập
      chip.addEventListener('click', () => this.insertSnippet(snippet));
      this.el.quick.append(chip);
    }
  }

  buildScoreboard(players) {
    const sb = this.el.scoreboard;
    sb.innerHTML = '';
    const teamBox = (team) => {
      const box = document.createElement('div');
      box.className = `sb-team ${team.toLowerCase()}`;
      for (const p of players.filter((q) => q.team === team)) {
        const card = document.createElement('div');
        card.className = `sb-player ${team.toLowerCase()}`;
        card.innerHTML = `<div class="sb-top"><span class="sb-name"></span><span class="sb-hpnum"></span></div><div class="sb-bar"><i></i></div>`;
        card.querySelector('.sb-name').textContent = p.name;
        card.title = `${p.id} · ${p.name} — ${TEAMS[team].name}`;
        box.append(card);
        p.ui = { card, hp: card.querySelector('.sb-hpnum'), bar: card.querySelector('.sb-bar i') };
      }
      return box;
    };
    const mid = document.createElement('div');
    mid.className = 'sb-mid';
    mid.innerHTML = '<span class="sb-vs">VS</span><span class="sb-turn" id="sbTurn"></span>';
    sb.append(teamBox('A'), mid, teamBox('B'));
    this.el.turnNo = mid.querySelector('#sbTurn');
  }

  /* ───────────────────────────── Sự kiện ───────────────────────────── */

  bindControls() {
    const { input, fire, dirButtons } = this.el;
    input.addEventListener('input', () => {
      if (this.game.current) this.game.current.draft = input.value;
      clearTimeout(this.validateTimer);
      this.validateTimer = setTimeout(() => this.validate(), 90);
    });
    fire.addEventListener('click', () => this.fire());
    for (const btn of dirButtons) {
      btn.addEventListener('click', () => {
        this.game.request({ kind: 'facing', dir: Number(btn.dataset.dir) });
        this.focusInput();
      });
    }
  }

  bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (this.isOverlayOpen()) return;
      const inFormula = e.target === this.el.input;
      if (inFormula) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.fire();
        } else if (e.key === 'Escape') {
          this.el.input.blur();
        }
        return;
      }
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
      const { game } = this;
      if (!game.canAct) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') game.request({ kind: 'facing', dir: -1 });
      else if (key === 'arrowright' || key === 'd') game.request({ kind: 'facing', dir: 1 });
      else if (key >= '1' && key <= '4') game.request({ kind: 'spell', id: SPELLS[Number(key) - 1].id });
      else if (key === 'enter') this.fire();
      else if (key === 'f') this.focusInput();
      else return;
      e.preventDefault();
    });
  }

  bindGame() {
    const { game } = this;
    game.on('setup', ({ players }) => {
      this.buildScoreboard(players);
      this.refresh();
    });
    game.on('turn', ({ player, number }) => {
      // Online: lượt của người khác thì ô nhập để trống (sẽ hiện công thức họ bắn).
      this.el.input.value = game.isLocal(player) ? player.draft ?? '' : '';
      this.validate();
      this.showBanner(player);
      if (this.el.turnNo) this.el.turnNo.textContent = `Lượt ${number}`;
      this.refresh();
      this.focusInput();
    });
    game.on('fired', ({ player, formula }) => {
      if (!game.isLocal(player)) this.el.input.value = formula; // xem đối thủ vừa bắn hàm gì
    });
    game.on('phase', () => this.refresh());
    game.on('update', () => this.refresh());
    game.on('toast', ({ text, type }) => this.toast(text, type));
  }

  /* ───────────────────────────── Công thức ───────────────────────────── */

  focusInput() {
    if (isFinePointer && this.game.canAct) this.el.input.focus({ preventScroll: true });
  }

  insertSnippet(snippet) {
    const { input } = this.el;
    if (input.disabled) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const selected = input.value.slice(start, end);
    let text = snippet;
    let caret = start + snippet.length;
    if (snippet.endsWith('()')) {
      text = `${snippet.slice(0, -1)}${selected})`; // bọc phần đang chọn: sin(x/2)
      caret = start + text.length - (selected ? 0 : 1);
    }
    input.setRangeText(text, start, end, 'end');
    input.setSelectionRange(caret, caret);
    input.focus();
    input.dispatchEvent(new Event('input'));
  }

  /** Kiểm tra cú pháp trực tiếp khi gõ (không tiết lộ quỹ đạo). */
  validate() {
    const { input, field, state, msg } = this.el;
    const result = compileFormula(input.value);
    const p = this.game.current;
    let text = 'Đồ thị xuất phát tại nhân vật: Y = y₀ + f(x − x₀) − f(0)';
    let kind = '';

    if (!result.ok) {
      if (!result.empty) {
        text = result.error;
        kind = 'error';
      }
    } else if (p) {
      const dir = p.facing;
      const anchor = anchorPoint(result.fn, dir);
      if (!anchor) {
        text = 'f(x) không xác định quanh x = 0 — đồ thị không thể xuất phát từ nhân vật';
        kind = 'error';
      } else if ([0.5, 1, 2, 5].every((t) => !Number.isFinite(result.fn(dir * t)))) {
        text = `Cảnh báo: f không xác định khi x ${dir > 0 ? '> 0' : '< 0'} (bắn ${dir > 0 ? 'phải' : 'trái'})`;
        kind = 'error';
      } else {
        text = anchor.offset === 0
          ? `Hợp lệ · f(0) = ${formatNumber(anchor.value, 3)} · Y = y₀ + f(x − x₀) − f(0)`
          : `Hợp lệ · f(0) không xác định ⇒ neo tại x = ${formatNumber(dir * anchor.offset)}, f = ${formatNumber(anchor.value, 3)}`;
        kind = 'ok';
      }
    }
    msg.textContent = text;
    msg.className = `formula-msg ${kind}`;
    field.classList.toggle('invalid', kind === 'error');
    state.className = `formula-state ${kind === 'ok' ? 'ok' : kind === 'error' ? 'bad' : ''}`;
    state.textContent = kind === 'ok' ? '✓' : kind === 'error' ? '!' : '';
  }

  fire() {
    const { game } = this;
    if (!game.canAct) return;
    const res = game.request({ kind: 'fire', formula: this.el.input.value, dir: game.current.facing });
    if (!res.ok) {
      this.el.field.classList.remove('shake');
      void this.el.field.offsetWidth; // khởi động lại animation
      this.el.field.classList.add('shake');
      this.focusInput();
    } else {
      this.el.input.blur();
    }
  }

  /* ───────────────────────────── Hiển thị ───────────────────────────── */

  showBanner(p) {
    const { banner, bannerName, bannerTeam } = this.el;
    bannerName.textContent = `${p.id} · ${p.name}`;
    bannerTeam.textContent = TEAMS[p.team].name;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => banner.classList.remove('show'), 1500);
  }

  toast(text, type = 'info') {
    if (!text) return;
    const { toasts } = this.el;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = text;
    toasts.prepend(node);
    while (toasts.children.length > 3) toasts.lastElementChild.remove();
    setTimeout(() => {
      node.classList.add('out');
      node.addEventListener('animationend', () => node.remove(), { once: true });
    }, 2600);
  }

  /** Cập nhật toàn bộ trạng thái nút/thẻ theo Game (gọi khi có sự kiện, không phải mỗi khung hình). */
  refresh() {
    const { game, el } = this;
    const p = game.current;
    const canAct = game.canAct;
    const root = document.documentElement;
    if (p) root.style.setProperty('--team', TEAMS[p.team].color);

    el.panel.classList.toggle('locked', !canAct);
    el.input.disabled = !canAct;
    el.fire.disabled = !canAct;
    el.fire.classList.toggle('teleport', game.armed === 'teleport');
    el.fire.classList.toggle('double', game.armed === 'double');
    el.fireLabel.textContent = game.awaiting
      ? 'ĐANG GỬI…'
      : game.armed === 'teleport' ? 'DỊCH CHUYỂN' : game.armed === 'double' ? 'BẮN x2' : 'BẮN';
    this.renderHint();
    for (const btn of el.dirButtons) {
      btn.disabled = !canAct;
      btn.classList.toggle('on', !!p && Number(btn.dataset.dir) === p.facing);
    }

    // Thẻ người chơi hiện tại.
    if (p) {
      el.avatar.textContent = p.name.charAt(0).toUpperCase();
      el.name.textContent = `${p.id} · ${p.name}`;
      el.team.textContent = TEAMS[p.team].name;
      const ratio = p.hp / PLAYER.maxHp;
      el.hpFill.style.transform = `scaleX(${ratio})`;
      el.hpLag.style.transform = `scaleX(${ratio})`;
      el.hpFill.className = `hpbar-fill ${ratio <= 0.3 ? 'low' : ratio <= 0.6 ? 'mid' : ''}`;
      el.hpText.textContent = String(p.hp);
      const badges = [];
      if (p.shield) badges.push(['Khiên', 'var(--sp-shield)']);
      if (game.armed) badges.push([`Đã chọn: ${SPELL_BY_ID[game.armed].name}`, `var(--sp-${game.armed})`]);
      else if (game.spellUsed) badges.push(['Đã dùng phép lượt này', null]);
      el.badges.innerHTML = '';
      for (const [label, color] of badges) {
        const b = document.createElement('span');
        b.className = `badge${color ? '' : ' muted'}`;
        if (color) b.style.setProperty('--c', color);
        b.textContent = label;
        el.badges.append(b);
      }
      this.renderHistory(p);
    }

    // Phép trợ giúp.
    for (const spell of SPELLS) {
      const btn = this.spellButtons[spell.id];
      const cd = btn.querySelector('.spell-cd');
      if (!p) {
        btn.disabled = true;
        continue;
      }
      const st = p.spellStatus(spell.id);
      const armed = game.armed === spell.id;
      btn.classList.toggle('armed', armed);
      btn.disabled = !canAct || (!armed && (!st.ready || game.spellUsed));
      btn.querySelectorAll('.spell-pips i').forEach((pip, i) => pip.classList.toggle('spent', i >= st.charges));
      btn.classList.toggle('active', st.usedNow);
      if (st.usedNow) {
        cd.hidden = false;
        cd.innerHTML = '<span>✓<small>đã dùng</small></span>';
      } else if (st.charges <= 0) {
        cd.hidden = false;
        cd.innerHTML = 'Hết';
      } else if (st.cooldownLeft > 0) {
        cd.hidden = false;
        cd.innerHTML = `<span>${st.cooldownLeft}<small>lượt</small></span>`;
      } else {
        cd.hidden = true;
      }
    }

    // Bảng đội.
    for (const q of game.players) {
      if (!q.ui) continue;
      q.ui.card.classList.toggle('active', q === p && game.phase !== 'over');
      q.ui.card.classList.toggle('dead', !q.alive);
      q.ui.card.classList.toggle('me', game.online && game.isLocal(q));
      q.ui.hp.textContent = q.alive ? `${q.hp}` : '✕';
      q.ui.bar.style.transform = `scaleX(${q.hp / PLAYER.maxHp})`;
    }
  }

  /** Online: thông báo đang chờ người khác / đang gửi phát bắn thay cho dòng kiểm tra công thức. */
  renderHint() {
    const { game, el } = this;
    const p = game.current;
    let wait = null;
    if (game.online && game.inTurn && p && !game.isLocal(p)) wait = `⏳ Đang chờ ${p.name} ra đòn…`;
    else if (game.awaiting) wait = 'Đang gửi phát bắn tới chủ phòng…';
    if (wait) {
      el.msg.textContent = wait;
      el.msg.className = 'formula-msg wait';
      el.state.className = 'formula-state';
      el.state.textContent = '';
      el.field.classList.remove('invalid');
      this.waiting = true;
    } else if (this.waiting) {
      this.waiting = false;
      this.validate();
    }
  }

  renderHistory(p) {
    const box = this.el.history;
    const key = `${p.id}:${p.history.join('|')}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = '';
    if (!p.history.length) return;
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = 'Đã bắn';
    box.append(label);
    for (const f of p.history) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = f;
      chip.title = 'Dùng lại công thức này';
      chip.addEventListener('mousedown', (e) => e.preventDefault());
      chip.addEventListener('click', () => {
        if (this.el.input.disabled) return;
        this.el.input.value = f;
        this.el.input.dispatchEvent(new Event('input'));
        this.focusInput();
      });
      box.append(chip);
    }
  }

  /** Gọi mỗi khung hình — chỉ cập nhật đồng hồ (rẻ). */
  frame() {
    const { game, el } = this;
    const total = game.settings?.turnTime ?? 30;
    const counting = game.phase === 'aiming' || game.phase === 'intro';
    const remaining = counting ? game.timer : 0;
    const sec = Math.ceil(remaining);
    const key = `${counting}:${sec}:${Math.round((remaining / total) * 200)}:${game.paused}`;
    if (key === this.lastTimer) return;
    this.lastTimer = key;
    el.timerText.textContent = counting ? String(sec) : '–';
    el.timerRing.style.strokeDashoffset = String(RING * (1 - (counting ? remaining / total : 0)));
    el.timer.classList.toggle('warn', counting && sec <= 10 && sec > 5);
    el.timer.classList.toggle('danger', counting && sec <= 5 && !game.paused);
    el.timer.classList.toggle('paused', !counting || game.paused);
  }
}
