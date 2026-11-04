/**
 * Game — máy trạng thái của một trận đấu.
 *
 *   idle ─start()→ intro ─(1.1s)→ aiming ─fire()→ firing ─(vẽ xong)→ resolving ─(ổn định)→ intro …
 *                    └───────────── hết giờ ──────────────────────────↗            └→ over
 *
 * Game không chạm vào DOM: UI lắng nghe các sự kiện 'setup' | 'turn' | 'phase' | 'update' |
 * 'fired' | 'timeout' | 'toast' | 'over' và gửi hành động qua request({ kind, ... }).
 *
 * CHƠI ONLINE (xem js/net/online.js) — mô hình "chủ phòng quyết định":
 *  - Mọi hành động (đổi hướng / phép / bắn) đi qua request() → gửi cho chủ phòng → chủ phòng kiểm
 *    tra rồi phát lại cho tất cả → mỗi máy gọi apply(). Vì cùng seed + cùng hành động, các máy tự
 *    mô phỏng ra cùng một phát bắn (chỉ vài chục byte mỗi lượt qua mạng).
 *  - Chỉ chủ phòng (authority = true) được chuyển lượt, xử lý hết giờ và kết thúc trận. Đầu mỗi
 *    lượt chủ phòng gửi bản chốt trạng thái (snapshot) để các máy khác sửa mọi sai lệch nhỏ.
 */
import { COMBAT, DEFAULT_NAMES, PLAYER, SHOT, SPELL_BY_ID, STARTER_FORMULA, TEAMS, TRAIL_COUNT, TURN, WORLD } from '../config.js?v=7eab9c2';
import { Emitter, clamp, createRng, randomSeed } from '../utils.js?v=7eab9c2';
import { anchorPoint, compileFormula } from '../math/formula.js?v=7eab9c2';
import { Terrain } from './terrain.js?v=7eab9c2';
import { Player, dropOnSurface, resolveEmbed, stepPhysics } from './player.js?v=7eab9c2';
import { traceGraph, pointAtLength } from './tracer.js?v=7eab9c2';

/** Vùng xuất phát (px) theo chế độ chơi — mỗi phần tử: [xMin, xMax]. */
const SPAWN_ZONES = {
  '1v1': { A: [[80, 230]], B: [[770, 920]] },
  '2v2': { A: [[60, 150], [205, 305]], B: [[850, 940], [695, 795]] },
};

const END_MESSAGES = {
  domain: 'Đồ thị ra khỏi miền xác định — tia đạn tắt.',
  asymptote: 'Gặp tiệm cận / điểm gián đoạn — tia đạn dừng.',
  bounds: 'Tia đạn bay ra ngoài bản đồ.',
  limit: 'Tia đạn cạn năng lượng (đồ thị dao động quá dài).',
};

const sameCraters = (a, b) =>
  a.length === b.length && a.every((c, i) => c.every((v, j) => Math.abs(v - b[i][j]) < 1e-6));

export class Game extends Emitter {
  constructor({ effects, sfx, terrainScale = 1 }) {
    super();
    this.effects = effects;
    this.sfx = sfx;
    this.terrain = new Terrain(WORLD.width, WORLD.height, terrainScale);
    this.players = [];
    this.settings = null;
    this.phase = 'idle';
    this.phaseTime = 0;
    this.paused = false;
    this.time = 0;
    this.current = null;
    this.timer = 0;
    this.overtime = 0;
    this.turnNumber = 0;
    this.shot = null;
    this.trails = [];
    this.craters = [];       // [x, y, r] theo thứ tự nổ — đủ để dựng lại địa hình từ seed
    this.armed = null;       // 'teleport' | 'double' | null
    this.spellUsed = false;  // mỗi lượt chỉ 1 phép
    this.winner = null;
    this.resetNetwork();
  }

  /* ───────────────────────────── Chế độ mạng ───────────────────────────── */

  /** Về chế độ chơi chung 1 máy. */
  resetNetwork() {
    this.authority = true;   // máy này có quyền chuyển lượt / kết thúc trận
    this.localSeats = null;  // Set id nhân vật do máy này điều khiển (null = tất cả)
    this.net = null;         // phiên online: nhận hành động để gửi đi
    this.timeoutGrace = 0;
    this.pending = null;     // trạng thái từ chủ phòng chờ áp dụng khi tia đang bay xong
    this.awaiting = false;   // đã gửi phát bắn, chờ chủ phòng xác nhận
  }

  configureNetwork({ authority, localSeats, net, timeoutGrace }) {
    this.authority = authority;
    this.localSeats = new Set(localSeats);
    this.net = net;
    this.timeoutGrace = timeoutGrace;
  }

  setLocalSeats(seats) {
    this.localSeats = new Set(seats);
    this.emit('update');
  }

  get online() {
    return !!this.net;
  }

  isLocal(p) {
    return !!p && (!this.localSeats || this.localSeats.has(p.id));
  }

  /* ───────────────────────────── Thiết lập trận ───────────────────────────── */

  /** Sinh bản đồ + đặt nhân vật (dùng cả cho màn hình xem trước ở menu). */
  setup(options = {}) {
    const settings = {
      mode: '1v1',
      seed: randomSeed(),
      turnTime: TURN.duration,
      friendlyFire: true,
      names: DEFAULT_NAMES,
      ...options,
    };
    this.settings = settings;
    this.terrain.generate(settings.seed);
    this.effects.clear();
    this.sfx.stopTrace();
    this.trails = [];
    this.craters = [];
    this.shot = null;
    this.current = null;
    this.armed = null;
    this.winner = null;
    this.turnNumber = 0;
    this.paused = false;
    this.pending = null;
    this.awaiting = false;

    const perTeam = settings.mode === '2v2' ? 2 : 1;
    const spawnRng = createRng(settings.seed ^ 0x9e3779b9); // cùng seed ⇒ cùng vị trí xuất phát
    this.players = [];
    for (const team of ['A', 'B']) {
      for (let slot = 0; slot < perTeam; slot++) {
        const fallback = DEFAULT_NAMES[team][slot];
        const name = (settings.names?.[team]?.[slot] || fallback).trim().slice(0, 14) || fallback;
        const p = new Player({ id: `${team}${slot + 1}`, name, team, slot });
        const [lo, hi] = SPAWN_ZONES[settings.mode][team][slot];
        dropOnSurface(p, this.terrain, spawnRng.range(lo, hi));
        p.draft = STARTER_FORMULA[p.facing];
        this.players.push(p);
      }
    }
    this.teamCursor = { A: 0, B: 0 };
    this.nextTeam = 'A';
    this.setPhase('idle');
    this.emit('setup', { players: this.players, settings });
  }

  start() {
    if (!this.settings) this.setup();
    this.beginTurn();
  }

  /* ───────────────────────────── Lượt chơi ───────────────────────────── */

  /** Đang trong lượt (chưa bắn), bất kể ai điều khiển. */
  get inTurn() {
    return !this.paused && (this.phase === 'aiming' || this.phase === 'intro');
  }

  /** Người chơi trên MÁY NÀY có được thao tác không. */
  get canAct() {
    return this.inTurn && !this.awaiting && this.isLocal(this.current);
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) this.sfx.stopTrace();
    else if (this.shot) this.sfx.startTrace();
    this.emit('update');
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
    this.emit('phase', { phase });
  }

  /**
   * Luân phiên theo đội A → B → A → B; trong mỗi đội xoay vòng các thành viên còn sống.
   * Khi đủ người: A1 → B1 → A2 → B2 → A1 … Khi một người đã chết, đội đó vẫn giữ 1 lượt/vòng.
   */
  pickNextPlayer() {
    for (let k = 0; k < 2; k++) {
      const team = this.nextTeam;
      this.nextTeam = team === 'A' ? 'B' : 'A';
      const members = this.players.filter((p) => p.team === team);
      for (let i = 0; i < members.length; i++) {
        const idx = (this.teamCursor[team] + i) % members.length;
        if (members[idx].alive) {
          this.teamCursor[team] = idx + 1;
          return members[idx];
        }
      }
    }
    return null;
  }

  /** Chỉ máy có quyền (chơi chung máy / chủ phòng) gọi hàm này. */
  beginTurn() {
    const p = this.pickNextPlayer();
    if (!p) return this.finish();
    p.turns += 1;
    this.turnNumber += 1;
    return this.enterTurn(p);
  }

  enterTurn(p) {
    this.current = p;
    this.armed = null;
    this.spellUsed = false;
    this.awaiting = false;
    this.timer = this.settings.turnTime;
    this.overtime = 0;
    this.lastTick = Math.ceil(this.timer);
    this.setPhase('intro');
    this.sfx.play('turn');
    this.emit('turn', { player: p, number: this.turnNumber });
    this.emit('update');
  }

  timeout() {
    if (!this.inTurn) return;
    this.sfx.play('timeout');
    this.toast(`⏱ Hết giờ! ${this.current.name} mất lượt.`, 'warn');
    this.armed = null;
    this.awaiting = false;
    this.setPhase('resolving');
    this.emit('timeout', { turn: this.turnNumber });
  }

  /* ───────────────────────────── Hành động ───────────────────────────── */

  /**
   * Hành động của người chơi trên máy này (từ HUD / phím tắt):
   *   { kind: 'facing', dir } | { kind: 'spell', id } | { kind: 'fire', formula, dir }
   * Kiểm tra ngay tại chỗ để báo lỗi tức thì; online thì gửi cho chủ phòng thay vì tự áp dụng.
   */
  request(action) {
    if (!this.canAct) return { ok: false };
    const error = this.validate(action);
    if (error) {
      this.sfx.play('error');
      this.toast(error, action.kind === 'fire' ? 'error' : 'warn');
      return { ok: false, error };
    }
    if (this.net) {
      if (action.kind === 'fire') {
        this.awaiting = true;
        this.emit('update');
      }
      this.net.sendAction(action);
      return { ok: true, pending: true };
    }
    return this.apply(action);
  }

  /** Trả về thông báo lỗi nếu hành động không hợp lệ ở thời điểm hiện tại, ngược lại null. */
  validate(action) {
    if (!this.inTurn || !this.current) return 'Chưa tới lượt.';
    switch (action?.kind) {
      case 'facing':
        return action.dir === 1 || action.dir === -1 ? null : 'Hướng bắn không hợp lệ.';
      case 'spell':
        return this.spellError(action.id);
      case 'fire': {
        const prep = this.prepareShot(action.formula, action.dir);
        return prep.ok ? null : prep.error;
      }
      default:
        return 'Hành động không hợp lệ.';
    }
  }

  /** Áp dụng hành động (đã được kiểm tra; online: đã được chủ phòng xác nhận). */
  apply(action) {
    const error = this.validate(action);
    if (error) return { ok: false, error };
    if (action.kind === 'facing') return this.setFacing(action.dir);
    if (action.kind === 'spell') return this.castSpell(action.id);
    return this.fire(action.formula, action.dir);
  }

  setFacing(dir) {
    if (this.current.facing !== dir) {
      this.current.facing = dir;
      this.sfx.play('click');
      this.emit('update');
    }
    return { ok: true };
  }

  /* ───────────────────────────── Phép trợ giúp ───────────────────────────── */

  spellError(id) {
    const p = this.current;
    const spell = SPELL_BY_ID[id];
    if (!spell) return 'Phép không tồn tại.';
    if (this.armed === id) return null; // bấm lại để huỷ
    const status = p.spellStatus(id);
    if (this.spellUsed) return 'Mỗi lượt chỉ dùng được 1 phép trợ giúp.';
    if (status.charges <= 0) return `${spell.name}: đã dùng hết lượt trong trận.`;
    if (status.cooldownLeft > 0) return `${spell.name}: hồi chiêu còn ${status.cooldownLeft} lượt.`;
    if (id === 'heal' && p.hp >= PLAYER.maxHp) return 'Máu đang đầy, chưa cần hồi.';
    if (id === 'shield' && p.shield) return 'Bạn đang có khiên rồi.';
    return null;
  }

  castSpell(id) {
    const p = this.current;
    const spell = SPELL_BY_ID[id];

    if (this.armed === id) { // huỷ phép đang chuẩn bị
      this.armed = null;
      this.sfx.play('click');
      this.emit('update');
      return { ok: true };
    }
    if (spell.kind === 'instant') {
      if (id === 'heal') {
        const gained = Math.min(spell.amount, PLAYER.maxHp - p.hp);
        p.hp += gained;
        this.effects.heal(p.x, p.y);
        this.effects.text(p.x, p.y - 28, `+${gained}`, '#5dfca0', 20);
        this.sfx.play('heal');
      } else if (id === 'shield') {
        p.shield = true;
        this.effects.shieldUp(p.x, p.y);
        this.sfx.play('shield');
      }
      p.consumeSpell(id);
      this.spellUsed = true;
      this.armed = null;
    } else {
      this.armed = id; // tiêu hao khi bắn
      this.sfx.play('arm');
    }
    this.emit('update');
    return { ok: true };
  }

  /* ───────────────────────────── Bắn ───────────────────────────── */

  /** Biên dịch + truy vết thử phát bắn (không đổi trạng thái). */
  prepareShot(formula, dir = this.current?.facing) {
    const compiled = compileFormula(formula);
    if (!compiled.ok) return compiled;
    const p = this.current;
    const anchor = anchorPoint(compiled.fn, dir);
    if (!anchor) {
      return { ok: false, error: 'f(x) không xác định quanh x = 0 nên đồ thị không thể xuất phát từ nhân vật.' };
    }
    const trace = traceGraph({
      fn: compiled.fn,
      anchor,
      origin: { x: p.x, y: p.y },
      dir,
      terrain: this.terrain,
      players: this.players.filter((q) => q.alive),
      shooter: p,
    });
    // Đồ thị không thể rời nhân vật (vd. sqrt(x) khi bắn trái) ⇒ báo lỗi, không mất lượt/phép.
    if (trace.points.length <= 1 && trace.end.reason === 'domain') {
      return { ok: false, error: `f(x) không xác định khi x ${dir > 0 ? '> 0' : '< 0'} — hãy đổi hướng bắn hoặc sửa hàm.` };
    }
    return { ok: true, compiled, trace };
  }

  fire(formula, dir = this.current.facing) {
    const p = this.current;
    p.facing = dir;
    const prep = this.prepareShot(formula, dir);
    if (!prep.ok) return prep;
    const { trace, compiled } = prep;

    const kind = this.armed === 'teleport' ? 'teleport' : 'damage';
    const double = this.armed === 'double';
    if (this.armed) {
      p.consumeSpell(this.armed);
      this.spellUsed = true;
    }
    p.stats.shots += 1;
    p.pushHistory(formula.trim());
    p.draft = formula;

    this.shot = {
      trace,
      kind,
      double,
      shooter: p,
      formula: compiled.text,
      color: kind === 'teleport' ? '#b69cff' : TEAMS[p.team].color,
      elapsed: 0,
      duration: clamp(trace.length / SHOT.drawSpeed, SHOT.minDuration, SHOT.maxDuration),
      head: null,
    };
    this.armed = null;
    this.awaiting = false;
    this.setPhase('firing');
    this.sfx.play('fire');
    this.sfx.startTrace();
    this.emit('fired', { player: p, formula: formula.trim() });
    this.emit('update');
    return { ok: true };
  }

  updateShot(dt) {
    const shot = this.shot;
    shot.elapsed += dt;
    const k = Math.min(1, shot.elapsed / shot.duration);
    shot.head = pointAtLength(shot.trace.points, k * shot.trace.length);
    this.sfx.updateTrace(1 - shot.head.y / WORLD.height);
    if (shot.head.y > -4 && Math.random() < 0.9) this.effects.sparkle(shot.head.x, shot.head.y, shot.color);
    if (k >= 1) this.resolveShot();
  }

  resolveShot() {
    const shot = this.shot;
    const { end } = shot.trace;
    this.sfx.stopTrace();
    this.trails.unshift({
      points: shot.trace.points,
      color: shot.color,
      team: shot.shooter.team,
      formula: shot.formula,
      born: this.time,
      end,
    });
    this.trails.length = Math.min(this.trails.length, TRAIL_COUNT);
    this.shot = null;

    if (shot.kind === 'teleport') this.teleport(shot.shooter, end);
    else if (end.reason === 'terrain' || end.reason === 'player') this.explode(end.x, end.y, shot.double, shot.shooter);
    else {
      this.effects.fizzle(clamp(end.x, 4, WORLD.width - 4), clamp(end.y, 4, WORLD.height - 4), shot.color);
      this.sfx.play('fizzle');
      this.toast(END_MESSAGES[end.reason], 'info');
    }
    this.setPhase('resolving');
  }

  explode(x, y, double, shooter) {
    const radius = COMBAT.blastRadius * (double ? COMBAT.doubleFactor : 1);
    const damage = COMBAT.damage * (double ? COMBAT.doubleFactor : 1);
    this.craters.push([x, y, radius]);
    this.terrain.carve(x, y, radius);
    this.effects.explosion(x, y, radius, TEAMS[shooter.team].color, double);
    this.sfx.play('explosion', { big: double });

    let landed = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - x, p.y - y) > radius + p.hitRadius) continue;
      if (!this.settings.friendlyFire && p.team === shooter.team) continue;
      if (p.team !== shooter.team) landed = true;
      this.applyDamage(p, damage, shooter);
    }
    if (landed) shooter.stats.landed += 1;
  }

  applyDamage(p, amount, source) {
    if (p.shield) {
      p.shield = false;
      this.effects.shieldBreak(p.x, p.y);
      this.effects.text(p.x, p.y - 30, 'CHẶN!', '#a5f3ff', 18);
      this.sfx.play('block');
      this.emit('update');
      return;
    }
    p.hp = Math.max(0, p.hp - amount);
    p.fx.hit = 1;
    this.effects.text(p.x, p.y - 30, `−${amount}`, amount > COMBAT.damage ? '#ff9b5e' : '#ff6b8b', amount > COMBAT.damage ? 26 : 20);
    this.sfx.play('hit');
    if (p.team !== source.team) {
      source.stats.damage += amount;
      source.stats.hits += 1;
    } else {
      source.stats.friendly += amount;
    }
    if (p.hp <= 0) this.kill(p, 'hp');
    this.emit('update');
  }

  kill(p, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.shield = false;
    p.deathCause = cause;
    if (cause === 'fell') {
      p.gone = true;
      p.hp = 0;
      this.toast(`${p.name} rơi khỏi bản đồ!`, 'error');
    } else {
      this.effects.death(p.x, p.y, TEAMS[p.team].color);
      this.toast(`${p.name} đã bị hạ gục!`, 'error');
    }
    this.sfx.play('death');
    this.emit('update');
  }

  teleport(p, end) {
    if (end.reason === 'bounds') {
      this.effects.fizzle(clamp(end.x, 4, WORLD.width - 4), clamp(end.y, 4, WORLD.height - 4), '#b69cff');
      this.sfx.play('fizzle');
      this.toast('Dịch chuyển thất bại — điểm cuối nằm ngoài bản đồ.', 'warn');
      return;
    }
    this.effects.teleport(p.x, p.y, TEAMS[p.team].color);
    p.x = clamp(end.freeX, PLAYER.radius, WORLD.width - PLAYER.radius);
    p.y = clamp(end.freeY, PLAYER.radius + 2, WORLD.height - PLAYER.radius);
    resolveEmbed(p, this.terrain);
    // Không đứng chồng lên người khác: lùi dần ngược hướng bắn.
    for (let i = 0; i < 40; i++) {
      const blocker = this.players.find((q) => q !== p && q.alive && Math.hypot(q.x - p.x, q.y - p.y) < PLAYER.radius * 2);
      if (!blocker) break;
      p.x = clamp(p.x - p.facing, PLAYER.radius, WORLD.width - PLAYER.radius);
      resolveEmbed(p, this.terrain);
    }
    p.vy = 0;
    p.grounded = false;
    this.effects.teleport(p.x, p.y, TEAMS[p.team].color);
    this.sfx.play('teleport');
  }

  /* ───────────────────────────── Đồng bộ online ───────────────────────────── */

  /** Bản chốt trạng thái (gửi từ chủ phòng) — nhỏ gọn, JSON được. */
  snapshot() {
    return {
      turn: this.turnNumber,
      current: this.current?.id ?? null,
      winner: this.winner,
      nextTeam: this.nextTeam,
      teamCursor: { ...this.teamCursor },
      craters: this.craters.map((c) => [...c]),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        hp: p.hp,
        alive: p.alive,
        gone: p.gone,
        shield: p.shield,
        facing: p.facing,
        turns: p.turns,
        deathCause: p.deathCause ?? null,
        spells: JSON.parse(JSON.stringify(p.spells)),
        stats: { ...p.stats },
      })),
    };
  }

  /** Ghi đè trạng thái bằng bản chốt của chủ phòng (sửa mọi sai lệch nhỏ). */
  applyState(s) {
    this.turnNumber = s.turn;
    this.nextTeam = s.nextTeam;
    this.teamCursor = { ...s.teamCursor };
    if (!sameCraters(this.craters, s.craters)) this.terrain.rebuild(this.settings.seed, s.craters);
    this.craters = s.craters.map((c) => [...c]);
    for (const ps of s.players) {
      const p = this.players.find((q) => q.id === ps.id);
      if (!p) continue;
      const { spells, stats, ...fields } = ps;
      Object.assign(p, fields);
      p.spells = spells;
      p.stats = stats;
      p.vy = 0;
      p.grounded = false;
    }
    this.emit('update');
  }

  /** Máy khách nhận 'turn' | 'over' từ chủ phòng — áp dụng ngay khi không còn tia đang bay. */
  receive(kind, state) {
    this.pending = { kind, state };
    this.flushPending();
  }

  flushPending() {
    if (!this.pending || this.phase === 'firing') return;
    const { kind, state } = this.pending;
    this.pending = null;
    this.applyState(state);
    if (kind === 'turn') this.enterTurn(this.players.find((p) => p.id === state.current));
    else this.finish(state.winner, state.forfeit ?? null);
  }

  /** Một đội không còn ai điều khiển (rời phòng) ⇒ xử thua. */
  forfeit(team) {
    if (this.phase === 'over') return;
    this.sfx.stopTrace();
    this.shot = null;
    this.finish(team === 'A' ? 'B' : 'A', team);
  }

  /* ───────────────────────────── Vòng lặp ───────────────────────────── */

  update(dt) {
    if (this.paused) return;
    this.time += dt;
    this.phaseTime += dt;
    this.effects.update(dt);
    this.updatePhysics(dt);

    switch (this.phase) {
      case 'intro':
        if (this.phaseTime >= TURN.intro) this.setPhase('aiming');
        break;
      case 'aiming': {
        this.timer = Math.max(0, this.timer - dt);
        const sec = Math.ceil(this.timer);
        if (sec !== this.lastTick) {
          this.lastTick = sec;
          if (sec <= 5 && sec > 0) this.sfx.play('tick', { urgent: sec <= 3 });
        }
        // Online: chủ phòng chờ thêm một chút để phát bắn "phút chót" kịp tới qua mạng.
        if (this.timer <= 0 && this.authority) {
          this.overtime += dt;
          if (this.overtime >= this.timeoutGrace) this.timeout();
        }
        break;
      }
      case 'firing':
        this.updateShot(dt);
        break;
      case 'resolving': {
        const settled = this.players.every((p) => p.gone || p.grounded);
        const done = (this.phaseTime >= TURN.resolveMin && settled) || this.phaseTime >= TURN.resolveMax;
        if (done && this.authority) this.afterResolve();
        break;
      }
      default:
    }
    if (this.pending) this.flushPending();
  }

  updatePhysics(dt) {
    for (const p of this.players) {
      p.hpLag += (p.hp - p.hpLag) * Math.min(1, dt * (p.hpLag > p.hp ? 2.2 : 8));
      p.fx.hit = Math.max(0, p.fx.hit - dt * 3);
      p.fx.land = Math.max(0, p.fx.land - dt * 4);
      const event = stepPhysics(p, this.terrain, dt);
      if (event === 'landed') {
        p.fx.land = 1;
        this.effects.dust(p.x, p.y + PLAYER.radius);
      } else if (event === 'fell') {
        if (p.alive) this.kill(p, 'fell');
        else p.gone = true;
      }
    }
  }

  afterResolve() {
    const aliveA = this.players.some((p) => p.team === 'A' && p.alive);
    const aliveB = this.players.some((p) => p.team === 'B' && p.alive);
    if (!aliveA || !aliveB) return this.finish();
    return this.beginTurn();
  }

  /** Kết thúc trận. `winner` bỏ trống ⇒ tự tính theo số người còn sống. */
  finish(winner, forfeit = null) {
    if (winner === undefined) {
      const aliveA = this.players.some((p) => p.team === 'A' && p.alive);
      const aliveB = this.players.some((p) => p.team === 'B' && p.alive);
      winner = aliveA && !aliveB ? 'A' : aliveB && !aliveA ? 'B' : null;
    }
    this.winner = winner;
    this.current = null;
    this.awaiting = false;
    this.setPhase('over');
    this.sfx.play('win');
    this.emit('over', { winner, forfeit, players: this.players, turns: this.turnNumber });
  }

  toast(text, type = 'info') {
    this.emit('toast', { text, type });
  }
}
