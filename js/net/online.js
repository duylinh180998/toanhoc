/**
 * OnlineSession — phòng chơi P2P qua WebRTC (PeerJS). Không server riêng, không database:
 * toàn bộ trạng thái phòng nằm trong bộ nhớ trình duyệt của CHỦ PHÒNG.
 *
 * Mô hình hình sao: mọi người kết nối tới chủ phòng; chủ phòng chuyển tiếp cho những người còn lại.
 *
 *   Khách → Chủ phòng                    Chủ phòng → mọi người
 *   ─────────────────                    ─────────────────────
 *   hello  { name, protocol }            lobby   { lobby }                — danh sách người/ghế/cài đặt
 *   seat   { seat }                      start   { settings, owners }     — seed + ai điều khiển ghế nào
 *   rename { name }                      turn    { state }                — bản chốt đầu mỗi lượt
 *   action { turn, action }              action  { turn, action }         — hành động đã được duyệt
 *   pong   { t }                         reject  { text }                 — (chỉ gửi người vừa thao tác)
 *   leave  {}                            timeout { turn }
 *                                        over    { state }
 *                                        owners  { owners }               — đổi người điều khiển khi có ai rời
 *                                        notice  { text } · ping { t } · refused { text } · closed { text }
 *
 * Mỗi lượt chỉ có vài tin nhắn nhỏ: các máy tự mô phỏng phát bắn từ cùng seed + cùng hành động,
 * còn bản chốt 'turn' của chủ phòng sửa mọi sai lệch (vị trí, máu, hố trên địa hình...).
 */
import { DEFAULT_NAMES, NET } from '../config.js';
import { Emitter, randomSeed } from '../utils.js';
import { createPeer, describePeerError, inviteLink, loadPeerJs, makeRoomCode, peerIdFor } from './peer.js';
import { RelayHub, RelayLink, randomId, relayForced } from './relay.js';

export const SEAT_ORDER = Object.freeze({ '1v1': ['A1', 'B1'], '2v2': ['A1', 'B1', 'A2', 'B2'] });

const cleanName = (name, fallback) => String(name ?? '').trim().slice(0, 14) || fallback;
const teamOf = (seat) => seat[0];
const slotOf = (seat) => Number(seat[1]) - 1;

/** Chỉ giữ các trường hợp lệ của một hành động nhận từ mạng. */
function sanitizeAction(a = {}) {
  const action = { kind: String(a.kind) };
  if (a.dir !== undefined) action.dir = a.dir === -1 ? -1 : 1;
  if (a.id !== undefined) action.id = String(a.id);
  if (a.formula !== undefined) action.formula = String(a.formula).slice(0, 200);
  return action;
}

export class OnlineSession extends Emitter {
  constructor(game) {
    super();
    this.game = game;
    this.reset();

    // Chủ phòng phát các mốc quan trọng của trận cho mọi người.
    const hosting = () => this.isHost && this.lobby?.inGame;
    game.on('turn', () => hosting() && this.broadcast({ type: 'turn', state: game.snapshot() }));
    game.on('timeout', ({ turn }) => hosting() && this.broadcast({ type: 'timeout', turn }));
    game.on('over', ({ winner, forfeit }) => {
      if (hosting()) this.broadcast({ type: 'over', state: { ...game.snapshot(), winner, forfeit } });
    });
  }

  reset() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.role = null;        // 'host' | 'guest' | null
    this.peer = null;        // Peer của PeerJS (null nếu không dùng được P2P)
    this.relay = null;       // (chủ phòng) RelayHub — nhận khách qua kênh chuyển tiếp
    this.relayReady = 0;     // (chủ phòng) số máy chủ chuyển tiếp đang nối
    this.selfId = null;      // id của máy này trong phòng
    this.transport = null;   // (khách) 'p2p' | 'relay'
    this.clientIds = new Map(); // (chủ phòng) id thành viên → clientId (chống vào trùng 2 lần)
    this.code = null;
    this.lobby = null;
    this.owners = {};        // ghế → id người điều khiển
    this.conns = new Map();  // (chủ phòng) id → { conn, lastSeen }
    this.hostConn = null;    // (khách)
    this.lastHostSeen = 0;
    this.inbox = [];         // (khách) tin nhắn chờ xử lý theo đúng thứ tự
  }

  get active() {
    return this.role !== null;
  }

  get isHost() {
    return this.role === 'host';
  }

  get myId() {
    return this.selfId;
  }

  get me() {
    return this.lobby?.members.find((m) => m.id === this.myId) ?? null;
  }

  get link() {
    return this.code ? inviteLink(this.code) : '';
  }

  seats() {
    return SEAT_ORDER[this.lobby.mode];
  }

  freeSeats() {
    const taken = new Set(this.lobby.members.map((m) => m.seat));
    return this.seats().filter((s) => !taken.has(s));
  }

  /* ═══════════════════════════════ CHỦ PHÒNG ═══════════════════════════════ */

  async host({ name, mode, turnTime, friendlyFire }) {
    // 1) Giữ mã phòng trên máy chủ bắt tay PeerJS (để khách nối P2P).
    let peer = null;
    let code = null;
    let lastError = null;
    try {
      await loadPeerJs();
      for (let attempt = 0; attempt < 4 && !peer; attempt++) {
        code = makeRoomCode();
        try {
          peer = await createPeer(peerIdFor(code));
        } catch (err) {
          lastError = err;
          if (err.type !== 'unavailable-id') break; // trùng mã thì thử mã khác
        }
      }
    } catch (err) {
      lastError = err;
    }
    code = code ?? makeRoomCode();

    // 2) Kênh chuyển tiếp (dự phòng cho khách bị chặn P2P) — chạy song song.
    const relay = new RelayHub(code);
    relay.on('connection', (conn) => this.acceptConnection(conn));
    relay.on('status', (count) => {
      this.relayReady = count;
      this.emit('net');
    });
    relay.start();
    if (!peer) {
      // Máy chủ PeerJS lỗi: vẫn mở phòng nếu kênh chuyển tiếp dùng được.
      const ok = await relay.whenReady(NET.relayTimeout);
      if (!ok) {
        relay.stop();
        throw new Error(`${describePeerError(lastError)} Kênh chuyển tiếp cũng không khả dụng.`);
      }
      this.emit('notice', 'Máy chủ P2P đang lỗi — phòng chỉ nhận khách qua kênh chuyển tiếp.');
    }

    this.role = 'host';
    this.peer = peer;
    this.relay = relay;
    this.code = code;
    this.selfId = peer?.id ?? `h-${randomId()}`;
    this.lobby = {
      code,
      hostId: this.selfId,
      mode,
      turnTime,
      friendlyFire,
      inGame: false,
      members: [{ id: this.selfId, name: cleanName(name, 'Chủ phòng'), seat: 'A1', via: 'host' }],
    };
    if (peer) {
      peer.on('connection', (conn) => this.acceptConnection(conn));
      // Mất kết nối tới máy chủ bắt tay không làm rớt người đã vào; nối lại để người mới vào được.
      peer.on('disconnected', () => {
        if (this.peer === peer && !peer.destroyed) peer.reconnect();
      });
      peer.on('error', (err) => this.emit('notice', describePeerError(err)));
    }
    this.startHeartbeat();
    this.emitLobby();
    return code;
  }

  acceptConnection(conn) {
    conn.on('data', (msg) => this.onHostData(conn, msg));
    conn.on('close', () => this.dropMember(conn.peer));
    conn.on('error', () => this.dropMember(conn.peer));
    setTimeout(() => {
      if (!this.conns.has(conn.peer)) conn.close(); // không chào hỏi ⇒ đóng
    }, NET.connectTimeout);
  }

  onHostData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const entry = this.conns.get(conn.peer);
    if (entry) entry.lastSeen = Date.now();
    if (msg.type === 'hello') return this.admit(conn, msg);
    if (!entry) return; // chưa được nhận vào phòng
    const member = this.lobby.members.find((m) => m.id === conn.peer);
    switch (msg.type) {
      case 'seat':
        return this.moveSeat(conn.peer, msg.seat);
      case 'rename':
        if (member) member.name = cleanName(msg.name, member.name);
        return this.emitLobby();
      case 'action':
        return this.handleAction(conn.peer, msg);
      case 'leave':
        return this.dropMember(conn.peer);
      default:
    }
  }

  admit(conn, msg) {
    const refuse = (text) => {
      conn.send({ type: 'refused', text });
      setTimeout(() => conn.close(), 400);
    };
    if (this.conns.has(conn.peer)) return;
    if (msg.protocol !== NET.protocol) return refuse('Phiên bản game khác với chủ phòng — hãy tải lại trang (Ctrl+F5).');
    if (this.lobby.inGame) return refuse('Phòng đang trong trận đấu — hãy chờ trận sau.');

    // Cùng một người tới bằng cả P2P (muộn) lẫn chuyển tiếp ⇒ giữ kết nối mới nhất, đúng chỗ ngồi cũ.
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 40) : '';
    const previous = clientId ? this.lobby.members.find((m) => this.clientIds.get(m.id) === clientId) : null;
    if (previous) this.detachMember(previous.id);

    const seat = previous && this.freeSeats().includes(previous.seat) ? previous.seat : this.freeSeats()[0];
    if (!seat) return refuse('Phòng đã đủ người.');
    const name = cleanName(msg.name, `Người chơi ${this.lobby.members.length + 1}`);
    this.lobby.members.push({ id: conn.peer, name, seat, via: conn.relay ? 'relay' : 'p2p' });
    this.clientIds.set(conn.peer, clientId);
    if (!previous) this.notify(`${name} đã vào phòng.`); // gửi trước khi thêm kết nối ⇒ người mới không nhận
    this.conns.set(conn.peer, { conn, lastSeen: Date.now() });
    this.emitLobby();
  }

  /** Gỡ một thành viên mà không thông báo (dùng khi họ vào lại bằng kết nối khác). */
  detachMember(id) {
    const entry = this.conns.get(id);
    this.conns.delete(id);
    this.clientIds.delete(id);
    const idx = this.lobby.members.findIndex((m) => m.id === id);
    if (idx >= 0) this.lobby.members.splice(idx, 1);
    try {
      entry?.conn.close();
    } catch {
      /* đã đóng */
    }
  }

  moveSeat(id, seat) {
    const member = this.lobby.members.find((m) => m.id === id);
    if (!member || this.lobby.inGame || !this.freeSeats().includes(seat)) return;
    member.seat = seat;
    this.emitLobby();
  }

  /** Chủ phòng đổi chế độ / thời gian lượt / sát thương đồng đội (chỉ khi đang ở sảnh). */
  updateSettings(patch) {
    if (!this.isHost || this.lobby.inGame) return;
    const { lobby } = this;
    if (patch.mode && patch.mode !== lobby.mode) {
      const seats = SEAT_ORDER[patch.mode];
      if (lobby.members.length > seats.length) {
        this.emit('notice', `Phòng đang có ${lobby.members.length} người — không thể chuyển sang 1v1.`);
      } else {
        lobby.mode = patch.mode;
        const taken = new Set();
        const homeless = [];
        for (const m of lobby.members) {
          if (seats.includes(m.seat) && !taken.has(m.seat)) taken.add(m.seat);
          else homeless.push(m);
        }
        for (const m of homeless) {
          m.seat = seats.find((s) => !taken.has(s));
          taken.add(m.seat);
        }
      }
    }
    if (patch.turnTime) lobby.turnTime = patch.turnTime;
    if (typeof patch.friendlyFire === 'boolean') lobby.friendlyFire = patch.friendlyFire;
    this.emitLobby();
  }

  /** Lý do chưa thể bắt đầu (hoặc null nếu được). */
  startBlocker() {
    if (!this.lobby) return 'Chưa có phòng.';
    const teams = new Set(this.lobby.members.map((m) => teamOf(m.seat)));
    if (!teams.has('A') || !teams.has('B')) return 'Mỗi đội cần ít nhất 1 người chơi.';
    return null;
  }

  /** Bắt đầu trận (hoặc tái đấu) với bản đồ mới. Ghế trống do đồng đội cùng đội điều khiển. */
  startMatch() {
    if (!this.isHost) return;
    const blocker = this.startBlocker();
    if (blocker) return this.emit('notice', blocker);
    const { mode, turnTime, friendlyFire, members } = this.lobby;
    const owners = {};
    const names = { A: [], B: [] };
    for (const seat of SEAT_ORDER[mode]) {
      const occupant = members.find((m) => m.seat === seat);
      const heir = members
        .filter((m) => teamOf(m.seat) === teamOf(seat))
        .sort((a, b) => a.seat.localeCompare(b.seat))[0];
      owners[seat] = (occupant ?? heir).id;
      names[teamOf(seat)][slotOf(seat)] = occupant ? occupant.name : DEFAULT_NAMES[teamOf(seat)][slotOf(seat)];
    }
    const settings = { mode, turnTime, friendlyFire, seed: randomSeed(), names };
    this.lobby.inGame = true;
    this.emitLobby();
    this.broadcast({ type: 'start', settings, owners });
    this.beginMatch(settings, owners);
  }

  /** Sau khi trận kết thúc: đưa mọi người về sảnh để đổi ghế/chế độ. */
  backToLobby() {
    if (!this.isHost) return;
    this.lobby.inGame = false;
    this.emitLobby();
  }

  /** Chủ phòng kiểm tra rồi phát lại hành động cho mọi người (kể cả hành động của chính mình). */
  handleAction(fromId, msg) {
    const g = this.game;
    const reject = (text) => (fromId === this.myId ? this.onReject(text) : this.sendTo(fromId, { type: 'reject', text }));
    if (!this.lobby?.inGame || !g.current) return reject('Trận đấu chưa bắt đầu.');
    if (msg.turn !== g.turnNumber || !g.inTurn) return reject('Đã hết giờ hoặc lượt đã qua.');
    if (this.owners[g.current.id] !== fromId) return reject('Chưa tới lượt của bạn.');
    const action = sanitizeAction(msg.action);
    const result = g.apply(action);
    if (!result.ok) return reject(result.error || 'Hành động không hợp lệ.');
    return this.broadcast({ type: 'action', turn: msg.turn, action });
  }

  dropMember(id) {
    const entry = this.conns.get(id);
    if (!entry) return;
    this.conns.delete(id);
    this.clientIds.delete(id);
    try {
      entry.conn.close();
    } catch {
      /* đã đóng */
    }
    const idx = this.lobby.members.findIndex((m) => m.id === id);
    const [member] = idx >= 0 ? this.lobby.members.splice(idx, 1) : [];
    if (member) this.notify(`${member.name} đã rời phòng.`);
    if (this.lobby.inGame && this.game.phase !== 'over') this.reassignOwners(id);
    this.emitLobby();
  }

  /** Người rời phòng ⇒ đồng đội còn lại điều khiển thay; không còn ai trong đội ⇒ đội đó thua. */
  reassignOwners(goneId) {
    for (const seat of Object.keys(this.owners)) {
      if (this.owners[seat] !== goneId) continue;
      const heir = this.lobby.members.find((m) => teamOf(m.seat) === teamOf(seat));
      if (!heir) {
        this.game.forfeit(teamOf(seat));
        return;
      }
      this.owners[seat] = heir.id;
    }
    this.broadcast({ type: 'owners', owners: this.owners });
    this.applyOwners();
  }

  emitLobby() {
    this.broadcast({ type: 'lobby', lobby: this.lobby });
    this.emit('lobby', this.lobby);
  }

  notify(text) {
    this.broadcast({ type: 'notice', text });
    this.emit('notice', text);
  }

  broadcast(msg) {
    for (const { conn } of this.conns.values()) if (conn.open) conn.send(msg);
  }

  sendTo(id, msg) {
    const entry = this.conns.get(id);
    if (entry?.conn.open) entry.conn.send(msg);
  }

  /* ═══════════════════════════════ KHÁCH ═══════════════════════════════ */

  /**
   * Vào phòng: thử P2P trước (nhanh, trực tiếp); nếu sau NET.p2pTimeout không thông (NAT/tường lửa)
   * thì tự chuyển sang kênh chuyển tiếp — kênh này được khởi động song song nên chuyển gần như ngay.
   * `onStatus(text)` báo tiến trình cho giao diện.
   */
  async join(code, name, { onStatus } = {}) {
    this.role = 'guest';
    this.code = code;
    const hello = { type: 'hello', name, protocol: NET.protocol, clientId: randomId() };
    const relay = new RelayLink(code, `r-${randomId()}`);
    const relayStarted = relay.start().then(() => true, () => false);
    let p2pError = null;

    if (!relayForced()) {
      onStatus?.('Đang kết nối trực tiếp (P2P)…');
      try {
        await this.joinP2P(code, hello);
        relay.close();
        return;
      } catch (err) {
        if (err.refused || !this.active) {
          relay.close();
          this.leave({ silent: true });
          throw err;
        }
        p2pError = err;
      }
    }

    onStatus?.('Mạng chặn kết nối trực tiếp — đang chuyển sang kênh chuyển tiếp…');
    // Máy chủ bắt tay báo "không có phòng này" ⇒ gần như chắc chắn sai mã: chỉ thử chuyển tiếp ngắn.
    const relayTimeout = p2pError?.type === 'peer-unavailable' ? 4_000 : NET.relayTimeout;
    try {
      if (!(await relayStarted)) throw new Error('relay-unavailable');
      await this.handshake(relay, hello, relayTimeout);
    } catch (err) {
      relay.close();
      this.leave({ silent: true });
      if (err.refused) throw err;
      if (p2pError?.type === 'peer-unavailable') throw new Error('Không tìm thấy phòng — kiểm tra lại mã phòng.');
      throw new Error('Không kết nối được tới phòng: cả kết nối trực tiếp lẫn kênh chuyển tiếp đều không thông. '
        + 'Kiểm tra lại mã phòng, hoặc thử mạng khác (Wi-Fi ↔ 4G).');
    }
  }

  async joinP2P(code, hello) {
    await loadPeerJs();
    const peer = await createPeer();
    this.peer = peer;
    try {
      const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      await this.handshake(conn, hello, NET.p2pTimeout, peer);
    } catch (err) {
      this.peer = null;
      peer.destroy();
      throw err;
    }
  }

  /** Gửi lời chào qua `conn` rồi chờ chủ phòng nhận vào phòng ('lobby') hoặc từ chối ('refused'). */
  handshake(conn, hello, timeoutMs, peer = null) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      const fail = (text, extra = {}) => finish(Object.assign(new Error(text), extra));
      const timer = setTimeout(() => fail('Hết thời gian chờ.', { timeout: true }), timeoutMs);

      peer?.on('error', (err) => {
        if (!settled) fail(describePeerError(err), { type: err.type });
        else if (this.hostConn === conn) this.emit('notice', describePeerError(err));
      });
      if (conn.relay) conn.send(hello);
      else conn.on('open', () => conn.send(hello));

      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (!settled) {
          if (msg.type === 'refused') return fail(msg.text, { refused: true });
          if (msg.type !== 'lobby') return;
          // Xác định danh tính + kiểu kết nối TRƯỚC khi xử lý 'lobby' (sảnh vẽ ngay khi nhận).
          this.hostConn = conn;
          this.selfId = conn.relay ? conn.id : peer.id;
          this.transport = conn.relay ? 'relay' : 'p2p';
          finish();
          this.startHeartbeat();
        } else if (this.hostConn !== conn) {
          return; // kênh đã bị bỏ (vd. P2P trả lời quá muộn)
        }
        this.lastHostSeen = Date.now();
        this.inbox.push(msg);
        this.pump();
      });
      const closed = () => {
        if (!settled) fail('Kết nối bị đóng.', { closed: true });
        else if (this.hostConn === conn) this.lost('Mất kết nối với chủ phòng.');
      };
      conn.on('close', closed);
      conn.on('error', closed);
    });
  }

  /**
   * Xử lý tin nhắn của chủ phòng theo đúng thứ tự. Nếu trận đang chờ áp dụng bản chốt (tia đạn
   * trước đó còn đang bay trên máy này) thì dừng lại — gọi lại mỗi khung hình từ main.js.
   */
  pump() {
    while (this.inbox.length && this.role === 'guest' && !this.game.pending) this.dispatch(this.inbox.shift());
  }

  dispatch(msg) {
    const g = this.game;
    switch (msg.type) {
      case 'lobby':
        this.lobby = msg.lobby;
        this.emit('lobby', this.lobby);
        break;
      case 'start':
        this.beginMatch(msg.settings, msg.owners);
        break;
      case 'turn':
        g.receive('turn', msg.state);
        break;
      case 'action':
        if (msg.turn === g.turnNumber) {
          const result = g.apply(msg.action);
          if (!result.ok) console.warn('[online] lệch trạng thái:', result.error);
        }
        break;
      case 'reject':
        this.onReject(msg.text);
        break;
      case 'timeout':
        if (msg.turn === g.turnNumber) g.timeout();
        break;
      case 'over':
        g.receive('over', msg.state);
        break;
      case 'owners':
        this.owners = msg.owners;
        this.applyOwners();
        break;
      case 'notice':
        this.emit('notice', msg.text);
        break;
      case 'ping':
        this.hostConn?.send({ type: 'pong', t: msg.t });
        break;
      case 'closed':
        this.lost(msg.text);
        break;
      default:
    }
  }

  /* ═══════════════════════════════ CHUNG ═══════════════════════════════ */

  beginMatch(settings, owners) {
    this.owners = owners;
    this.game.configureNetwork({
      authority: this.isHost,
      localSeats: this.mySeats(),
      net: this,
      timeoutGrace: NET.timeoutGrace,
    });
    this.game.setup(settings);
    this.emit('started', { settings, owners });
    if (this.isHost) this.game.start();
  }

  mySeats() {
    return Object.keys(this.owners).filter((seat) => this.owners[seat] === this.myId);
  }

  applyOwners() {
    this.game.setLocalSeats(this.mySeats());
  }

  /** Gọi bởi Game.request() khi người chơi trên máy này thao tác. */
  sendAction(action) {
    const msg = { type: 'action', turn: this.game.turnNumber, action };
    if (this.isHost) this.handleAction(this.myId, msg);
    else this.hostConn?.send(msg);
  }

  onReject(text) {
    this.game.awaiting = false;
    this.game.toast(text, 'warn');
    this.game.emit('update');
  }

  requestSeat(seat) {
    if (this.isHost) this.moveSeat(this.myId, seat);
    else this.hostConn?.send({ type: 'seat', seat });
  }

  rename(name) {
    if (this.isHost) {
      const me = this.me;
      if (me) me.name = cleanName(name, me.name);
      this.emitLobby();
    } else {
      this.hostConn?.send({ type: 'rename', name });
    }
  }

  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (this.isHost) {
        this.broadcast({ type: 'ping', t: now });
        for (const [id, entry] of this.conns) if (now - entry.lastSeen > NET.dropAfter) this.dropMember(id);
      } else if (this.role === 'guest' && now - this.lastHostSeen > NET.dropAfter) {
        this.lost('Mất kết nối với chủ phòng.');
      }
    }, NET.heartbeat);
  }

  /** Mất kết nối ngoài ý muốn. */
  lost(text) {
    if (!this.active) return;
    this.leave({ silent: true });
    this.emit('closed', text);
  }

  /** Rời phòng (chủ phòng rời ⇒ phòng đóng). */
  leave({ silent = false } = {}) {
    if (!this.active) return;
    try {
      if (this.isHost) this.broadcast({ type: 'closed', text: 'Chủ phòng đã đóng phòng.' });
      else if (this.hostConn?.open) this.hostConn.send({ type: 'leave' });
    } catch {
      /* bỏ qua */
    }
    const { peer, relay, hostConn } = this;
    setTimeout(() => {
      // chờ tin nhắn cuối được gửi đi rồi mới đóng
      peer?.destroy();
      relay?.stop();
      hostConn?.close?.();
    }, 200);
    this.reset();
    this.game.resetNetwork();
    if (!silent) this.emit('left');
  }
}
