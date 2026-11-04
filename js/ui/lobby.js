/** Giao diện chơi online: tab "Online" ở menu + màn hình sảnh chờ (ghế, cài đặt, link mời). */
import { DEFAULT_NAMES, NET, TEAMS } from '../config.js';
import { randomSeed, storage } from '../utils.js';
import { SEAT_ORDER } from '../net/online.js';
import { normalizeCode, roomFromUrl } from '../net/peer.js';

const $ = (id) => document.getElementById(id);
const isCoarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Trang http (không phải https/localhost) không có Clipboard API ⇒ cách cũ.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export class LobbyUI {
  constructor({ game, sfx, session, screens }) {
    this.game = game;
    this.sfx = sfx;
    this.session = session;
    this.screens = screens;
    this.busy = false;
    this.el = {
      name: $('onlineName'),
      code: $('joinCode'),
      hostBtn: $('hostBtn'),
      joinBtn: $('joinBtn'),
      status: $('onlineStatus'),
      screen: $('lobbyScreen'),
      lobbyCode: $('lobbyCode'),
      role: $('lobbyRole'),
      copyLink: $('copyLinkBtn'),
      copyLinkLabel: $('copyLinkLabel'),
      copyCode: $('copyCodeBtn'),
      invite: $('inviteLink'),
      mode: $('lobbyMode'),
      time: $('lobbyTime'),
      ff: $('lobbyFF'),
      seats: $('seats'),
      feed: $('lobbyFeed'),
      lobbyStatus: $('lobbyStatus'),
      leave: $('leaveLobbyBtn'),
      start: $('lobbyStartBtn'),
      badge: $('netBadge'),
      badgeText: $('netBadgeText'),
    };
    this.el.name.value = storage.get('mga.onlineName', '');
    this.invited = roomFromUrl();
    if (this.invited) {
      this.el.code.value = this.invited;
      this.setStatus(`Bạn được mời vào phòng ${this.invited} — nhập tên rồi bấm “Vào phòng”.`, 'info');
    }
    this.bindMenu();
    this.bindLobby();
    this.bindSession();
  }

  get visible() {
    return !this.el.screen.hidden;
  }

  playerName() {
    return this.el.name.value.trim().slice(0, 14);
  }

  setStatus(text, kind = '') {
    this.el.status.textContent = text;
    this.el.status.className = `online-status ${kind}`;
  }

  setBusy(busy) {
    this.busy = busy;
    this.el.hostBtn.disabled = busy;
    this.el.joinBtn.disabled = busy;
  }

  /* ───────────────────────────── Tab Online ở menu ───────────────────────────── */

  bindMenu() {
    const { el } = this;
    el.name.addEventListener('input', () => {
      storage.set('mga.onlineName', el.name.value);
      clearTimeout(this.renameTimer);
      if (this.session.active) this.renameTimer = setTimeout(() => this.session.rename(this.playerName()), 400);
    });
    el.code.addEventListener('input', () => {
      const pos = el.code.selectionStart;
      el.code.value = normalizeCode(el.code.value);
      el.code.setSelectionRange(pos, pos);
    });
    el.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join();
    });
    el.hostBtn.addEventListener('click', () => this.host());
    el.joinBtn.addEventListener('click', () => this.join());
  }

  requireName() {
    if (this.playerName()) return true;
    this.setStatus('Hãy nhập tên của bạn trước.', 'error');
    this.el.name.focus();
    return false;
  }

  async host() {
    if (this.busy || !this.requireName()) return;
    this.sfx.unlock();
    this.setBusy(true);
    this.setStatus('Đang tạo phòng…', 'info');
    try {
      const { mode, turnTime, friendlyFire } = this.screens.settings;
      await this.session.host({ name: this.playerName(), mode, turnTime, friendlyFire });
      this.setStatus('');
    } catch (err) {
      this.setStatus(err.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  async join() {
    if (this.busy || !this.requireName()) return;
    const code = normalizeCode(this.el.code.value);
    if (code.length !== NET.codeLength) {
      this.setStatus(`Mã phòng gồm ${NET.codeLength} ký tự.`, 'error');
      this.el.code.focus();
      return;
    }
    this.sfx.unlock();
    this.setBusy(true);
    this.setStatus(`Đang kết nối tới phòng ${code}…`, 'info');
    try {
      await this.session.join(code, this.playerName(), { onStatus: (text) => this.setStatus(text, 'info') });
      this.setStatus('');
    } catch (err) {
      this.setStatus(err.message, 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /* ───────────────────────────── Sảnh chờ ───────────────────────────── */

  bindLobby() {
    const { el, session } = this;
    el.mode.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (btn) session.updateSettings({ mode: btn.dataset.mode });
    });
    el.time.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-time]');
      if (btn) session.updateSettings({ turnTime: Number(btn.dataset.time) });
    });
    el.ff.addEventListener('change', () => session.updateSettings({ friendlyFire: el.ff.checked }));
    el.seats.addEventListener('click', (e) => {
      const seat = e.target.closest('button[data-seat]');
      if (seat && !seat.disabled) {
        this.sfx.play('click');
        session.requestSeat(seat.dataset.seat);
      }
    });
    el.copyLink.addEventListener('click', async () => {
      const link = session.link;
      if (isCoarsePointer && navigator.share) {
        try {
          await navigator.share({ title: 'MathGraph Arena', text: `Vào phòng ${session.code} chơi cùng mình!`, url: link });
          return;
        } catch {
          /* người dùng huỷ ⇒ sao chép */
        }
      }
      this.flash(el.copyLinkLabel, (await copyText(link)) ? 'Đã sao chép!' : 'Không sao chép được', 'Sao chép link mời');
    });
    el.copyCode.addEventListener('click', async () => {
      if (await copyText(session.code)) this.addFeed(`Đã sao chép mã ${session.code}.`);
    });
    el.leave.addEventListener('click', () => {
      session.leave();
      this.screens.showMenu('online');
    });
    el.start.addEventListener('click', () => {
      this.sfx.unlock();
      session.startMatch();
    });
  }

  flash(node, text, original) {
    node.textContent = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      node.textContent = original;
    }, 1600);
  }

  addFeed(text) {
    const li = document.createElement('li');
    li.textContent = text;
    this.el.feed.prepend(li);
    while (this.el.feed.children.length > 3) this.el.feed.lastElementChild.remove();
  }

  bindSession() {
    const { session, game } = this;
    session.on('lobby', (lobby) => {
      this.updateBadge();
      if (lobby.inGame) return;
      if (!this.visible) this.show();
      this.render();
    });
    session.on('started', () => {
      this.el.screen.hidden = true;
      this.screens.hideAll();
      this.updateBadge();
    });
    session.on('notice', (text) => {
      if (this.visible) this.addFeed(text);
      else if (session.lobby?.inGame) game.toast(text, 'info');
    });
    session.on('closed', (text) => {
      this.screens.showMenu('online');
      this.setStatus(text, 'error');
      this.updateBadge();
    });
    session.on('left', () => this.updateBadge());
    session.on('net', () => {
      if (this.visible) this.render();
    });
  }

  show() {
    this.screens.hideAll();
    this.el.feed.innerHTML = '';
    this.el.screen.hidden = false;
    this.lastPreviewMode = null;
  }

  hide() {
    this.el.screen.hidden = true;
  }

  updateBadge() {
    const { session, el } = this;
    el.badge.hidden = !session.active;
    if (session.active) {
      el.badgeText.textContent = `Phòng ${session.code}`;
      el.badge.title = session.transport === 'relay'
        ? 'Đang chơi online qua kênh chuyển tiếp'
        : 'Đang chơi online (P2P)';
    }
  }

  /** Vẽ lại sảnh theo trạng thái phòng (mọi máy dùng chung dữ liệu chủ phòng gửi). */
  render() {
    const { session, el } = this;
    const { lobby } = session;
    if (!lobby) return;
    const isHost = session.isHost;
    const me = session.me;

    el.lobbyCode.textContent = lobby.code;
    el.role.textContent = isHost ? 'Bạn là chủ phòng' : 'Khách';
    el.invite.textContent = session.link;
    el.mode.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.mode === lobby.mode));
      b.setAttribute('role', 'radio');
      b.disabled = !isHost;
    });
    el.time.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.time) === lobby.turnTime));
      b.setAttribute('role', 'radio');
      b.disabled = !isHost;
    });
    el.ff.checked = lobby.friendlyFire;
    el.ff.disabled = !isHost;

    // Ghế ngồi theo đội.
    el.seats.innerHTML = '';
    const seats = SEAT_ORDER[lobby.mode];
    for (const team of ['A', 'B']) {
      const col = document.createElement('div');
      col.className = `seat-team ${team.toLowerCase()}`;
      const head = document.createElement('div');
      head.className = 'roster-head';
      head.textContent = TEAMS[team].name;
      col.append(head);
      for (const seat of seats.filter((s) => s[0] === team).sort()) {
        const member = lobby.members.find((m) => m.seat === seat);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `seat${member ? ' taken' : ''}${member?.id === session.myId ? ' me' : ''}`;
        btn.dataset.seat = seat;
        btn.disabled = !!member;
        const id = document.createElement('span');
        id.className = 'seat-id';
        id.textContent = seat;
        const name = document.createElement('span');
        name.className = 'seat-name';
        const tags = document.createElement('span');
        tags.className = 'seat-tags';
        if (member) {
          name.textContent = member.name;
          if (member.id === lobby.hostId) tags.insertAdjacentHTML('beforeend', '<i class="tag host">Chủ phòng</i>');
          if (member.id === session.myId) tags.insertAdjacentHTML('beforeend', '<i class="tag me">Bạn</i>');
          if (member.via === 'relay') tags.insertAdjacentHTML('beforeend', '<i class="tag relay" title="Mạng chặn P2P — đi qua máy chủ chuyển tiếp">Chuyển tiếp</i>');
          else if (member.via === 'p2p') tags.insertAdjacentHTML('beforeend', '<i class="tag p2p" title="Kết nối trực tiếp">P2P</i>');
        } else {
          name.textContent = 'Trống';
          tags.textContent = lobby.mode === '2v2' ? 'Bấm để ngồi · bỏ trống thì đồng đội điều khiển thay' : 'Bấm để ngồi';
        }
        btn.append(id, name, tags);
        col.append(btn);
      }
      el.seats.append(col);
    }

    // Trạng thái + nút bắt đầu.
    const count = lobby.members.length;
    const blocker = session.startBlocker();
    el.start.hidden = !isHost;
    el.start.disabled = !!blocker;
    let status = `${count}/${seats.length} người · `;
    if (isHost) status += blocker ? `${blocker} Gửi link mời cho bạn bè!` : 'Sẵn sàng! Bấm “Bắt đầu trận”.';
    else status += 'Đang chờ chủ phòng bắt đầu…';
    if (me) status += ` Bạn ngồi ghế ${me.seat}.`;
    if (isHost) {
      status += session.peer ? ' Kết nối: P2P sẵn sàng' : ' Kết nối: chỉ qua kênh chuyển tiếp';
      status += session.relayReady > 0 ? ' · kênh dự phòng sẵn sàng.' : ' · kênh dự phòng đang kết nối…';
    } else {
      status += session.transport === 'relay'
        ? ' Bạn đang kết nối qua kênh chuyển tiếp (mạng chặn P2P).'
        : ' Bạn đang kết nối trực tiếp (P2P).';
    }
    el.lobbyStatus.textContent = status;

    // Bản đồ xem trước phía sau sảnh (chỉ minh hoạ — bản đồ thật do chủ phòng chọn khi bắt đầu).
    if (this.lastPreviewMode !== lobby.mode) {
      this.lastPreviewMode = lobby.mode;
      const names = { A: [], B: [] };
      for (const seat of seats) {
        const m = lobby.members.find((q) => q.seat === seat);
        names[seat[0]][Number(seat[1]) - 1] = m?.name ?? DEFAULT_NAMES[seat[0]][Number(seat[1]) - 1];
      }
      this.game.setup({ mode: lobby.mode, seed: randomSeed(), names });
    }
  }
}
