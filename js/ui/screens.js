/** Các màn hình phủ: menu bắt đầu, kết thúc trận, hướng dẫn, tạm dừng. */
import { DEFAULT_NAMES, PLAYER, SPELLS, TEAMS, TURN } from '../config.js';
import { randomSeed, storage } from '../utils.js';

const $ = (id) => document.getElementById(id);

export class Screens {
  constructor(game, sfx) {
    this.game = game;
    this.sfx = sfx;
    this.el = {
      menu: $('menuScreen'),
      over: $('overScreen'),
      help: $('helpModal'),
      confirm: $('confirmModal'),
      roster: $('roster'),
      seedBtn: $('seedBtn'),
      seedText: $('seedText'),
      ff: $('ffToggle'),
      sound: $('soundBtn'),
    };
    const saved = storage.get('mga.settings', {});
    this.settings = {
      mode: saved.mode === '2v2' ? '2v2' : '1v1',
      turnTime: [20, 30, 45, 60].includes(saved.turnTime) ? saved.turnTime : TURN.duration,
      friendlyFire: saved.friendlyFire ?? true,
      names: {
        A: [...(saved.names?.A ?? DEFAULT_NAMES.A)],
        B: [...(saved.names?.B ?? DEFAULT_NAMES.B)],
      },
      seed: randomSeed(),
    };

    this.bindMenu();
    this.bindOver();
    this.bindModals();
    this.syncMenu();
    this.preview();
    game.on('over', (result) => setTimeout(() => this.showOver(result), 1300));
  }

  isOverlayOpen() {
    return [this.el.menu, this.el.over, this.el.help, this.el.confirm].some((n) => !n.hidden);
  }

  save() {
    const { mode, turnTime, friendlyFire, names } = this.settings;
    storage.set('mga.settings', { mode, turnTime, friendlyFire, names });
  }

  /** Dựng bản đồ + nhân vật phía sau menu để người chơi xem trước. */
  preview() {
    this.game.setup({ ...this.settings });
  }

  /* ───────────────────────────── Menu ───────────────────────────── */

  bindMenu() {
    document.querySelectorAll('.mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.settings.mode = card.dataset.mode;
        this.sfx.play('click');
        this.syncMenu();
        this.preview();
        this.save();
      });
    });
    document.querySelectorAll('#timeSeg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.turnTime = Number(btn.dataset.time);
        this.syncMenu();
        this.save();
      });
    });
    this.el.ff.addEventListener('change', () => {
      this.settings.friendlyFire = this.el.ff.checked;
      this.save();
    });
    this.el.seedBtn.addEventListener('click', () => {
      this.settings.seed = randomSeed();
      this.el.seedBtn.classList.remove('spin');
      void this.el.seedBtn.offsetWidth;
      this.el.seedBtn.classList.add('spin');
      this.sfx.play('click');
      this.syncMenu();
      this.preview();
    });
    $('startBtn').addEventListener('click', () => this.startMatch());
    $('menuHelpBtn').addEventListener('click', () => this.openHelp());
    this.el.menu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) this.startMatch();
    });
  }

  syncMenu() {
    const { settings, el } = this;
    document.querySelectorAll('.mode-card').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.mode === settings.mode)));
    document.querySelectorAll('#timeSeg button').forEach((b) => {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(Number(b.dataset.time) === settings.turnTime));
    });
    el.ff.checked = settings.friendlyFire;
    el.seedText.textContent = `#${settings.seed}`;

    const perTeam = settings.mode === '2v2' ? 2 : 1;
    el.roster.innerHTML = '';
    for (const team of ['A', 'B']) {
      const box = document.createElement('div');
      box.className = `roster-team ${team.toLowerCase()}`;
      box.innerHTML = `<div class="roster-head">${TEAMS[team].name}</div>`;
      for (let i = 0; i < perTeam; i++) {
        const field = document.createElement('label');
        field.className = 'roster-field';
        field.innerHTML = `<span>${team}${i + 1}</span><input maxlength="14" autocomplete="off" spellcheck="false">`;
        const input = field.querySelector('input');
        input.value = settings.names[team][i] ?? DEFAULT_NAMES[team][i];
        input.placeholder = DEFAULT_NAMES[team][i];
        input.setAttribute('aria-label', `Tên ${team}${i + 1}`);
        input.addEventListener('input', () => {
          settings.names[team][i] = input.value;
          const p = this.game.players.find((q) => q.id === `${team}${i + 1}`);
          if (p) p.name = input.value.trim() || DEFAULT_NAMES[team][i];
          this.save();
        });
        box.append(field);
      }
      el.roster.append(box);
    }
  }

  startMatch() {
    this.sfx.unlock();
    this.sfx.play('click');
    this.el.menu.hidden = true;
    this.el.over.hidden = true;
    this.preview(); // cùng seed ⇒ đúng bản đồ đang xem trước
    this.game.start();
  }

  showMenu() {
    this.el.over.hidden = true;
    this.el.confirm.hidden = true;
    this.game.setPaused(false);
    this.settings.seed = randomSeed();
    this.syncMenu();
    this.preview();
    this.el.menu.hidden = false;
  }

  /* ───────────────────────────── Kết thúc trận ───────────────────────────── */

  bindOver() {
    $('rematchBtn').addEventListener('click', () => {
      this.settings.seed = randomSeed();
      this.syncMenu();
      this.startMatch();
    });
    $('toMenuBtn').addEventListener('click', () => this.showMenu());
  }

  showOver({ winner, players, turns }) {
    if (this.game.phase !== 'over') return;
    const title = $('overTitle');
    const trophy = $('overTrophy');
    const color = winner ? TEAMS[winner].color : 'var(--accent)';
    title.textContent = winner ? `${TEAMS[winner].name} chiến thắng!` : 'Hoà — cả hai đội cùng gục ngã!';
    title.style.color = color;
    trophy.style.setProperty('--c', color);
    const mvp = [...players].sort((a, b) => b.stats.damage - a.stats.damage)[0];
    $('overSub').textContent = `Sau ${turns} lượt` + (mvp?.stats.damage ? ` · MVP: ${mvp.name} (${mvp.stats.damage} sát thương)` : '');

    const body = $('statsBody');
    body.innerHTML = '';
    for (const p of players) {
      const tr = document.createElement('tr');
      if (!p.alive) tr.className = 'dead';
      const acc = p.stats.shots ? Math.round((p.stats.landed / p.stats.shots) * 100) : 0;
      tr.innerHTML = `<td><span class="dot" style="background:${TEAMS[p.team].color}"></span></td>`
        + `<td>${p.alive ? `${p.hp}/${PLAYER.maxHp}` : '✕'}</td><td>${p.stats.shots}</td>`
        + `<td>${p.stats.landed} <small>(${acc}%)</small></td><td>${p.stats.damage}</td><td>${p.stats.friendly}</td>`;
      tr.firstChild.append(`${p.id} · ${p.name}`);
      body.append(tr);
    }
    this.el.over.hidden = false;
  }

  /* ───────────────────────────── Modal ───────────────────────────── */

  bindModals() {
    const help = $('spellHelp');
    help.innerHTML = '';
    for (const s of SPELLS) {
      const li = document.createElement('li');
      li.innerHTML = `<b style="color:var(--sp-${s.id})"></b><span></span>`;
      li.firstChild.textContent = s.name;
      li.lastChild.textContent = `${s.desc} (${s.charges} lần/trận, hồi ${s.cooldown} lượt)`;
      help.append(li);
    }

    $('helpBtn').addEventListener('click', () => this.openHelp());
    this.el.help.addEventListener('click', (e) => {
      if (e.target === this.el.help || e.target.closest('[data-close]')) this.closeHelp();
    });

    $('menuBtn').addEventListener('click', () => {
      if (!this.el.menu.hidden) return;
      if (this.inMatch()) this.pause();
      else this.showMenu();
    });
    $('resumeBtn').addEventListener('click', () => this.resume());
    $('quitBtn').addEventListener('click', () => this.showMenu());

    this.el.sound.classList.toggle('muted', this.sfx.muted);
    this.el.sound.addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      this.el.sound.classList.toggle('muted', this.sfx.muted);
      this.sfx.play('click');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.el.help.hidden) this.closeHelp();
      else if (!this.el.confirm.hidden) this.resume();
      else if (this.el.menu.hidden && this.el.over.hidden && this.inMatch() && e.target !== $('formula')) this.pause();
    });
  }

  inMatch() {
    return !['idle', 'over'].includes(this.game.phase);
  }

  openHelp() {
    if (this.inMatch() && !this.game.paused) {
      this.game.setPaused(true);
      this.pausedByHelp = true;
    }
    this.el.help.hidden = false;
    this.el.help.querySelector('[data-close]').focus();
  }

  closeHelp() {
    this.el.help.hidden = true;
    if (this.pausedByHelp) {
      this.pausedByHelp = false;
      this.game.setPaused(false);
    }
  }

  pause() {
    this.game.setPaused(true);
    this.el.confirm.hidden = false;
    $('resumeBtn').focus();
  }

  resume() {
    this.el.confirm.hidden = true;
    this.game.setPaused(false);
  }
}
