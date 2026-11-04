/**
 * Tiện ích PeerJS: tải thư viện (lazy, chỉ khi chơi online), tạo Peer, mã phòng, link mời.
 *
 * PeerJS dùng WebRTC DataChannel để 2 trình duyệt nói chuyện TRỰC TIẾP với nhau. Máy chủ PeerJS
 * công cộng chỉ làm "người giới thiệu" lúc bắt tay (trao đổi địa chỉ), không đi qua dữ liệu trận
 * đấu và không lưu gì ⇒ không cần server riêng, không cần database.
 */
import { NET } from '../config.js';
import { loadScript } from '../utils.js';

const PEERJS_URLS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js',
];

export async function loadPeerJs() {
  for (const url of PEERJS_URLS) {
    if (globalThis.Peer) return;
    try {
      await loadScript(url);
    } catch {
      /* thử CDN tiếp theo */
    }
  }
  if (!globalThis.Peer) throw new Error('Không tải được thư viện PeerJS — hãy kiểm tra kết nối Internet.');
}

/** Máy chủ bắt tay tự host (nếu có): tham số URL ?peer=… ưu tiên hơn NET.server. */
function customServer() {
  try {
    return new URLSearchParams(location.search).get('peer') || NET.server;
  } catch {
    return NET.server;
  }
}

function peerOptions() {
  const custom = customServer();
  if (!custom) return { debug: 1 };
  const url = new URL(custom);
  const secure = url.protocol === 'https:';
  return {
    debug: 1,
    host: url.hostname,
    port: Number(url.port) || (secure ? 443 : 80),
    path: url.pathname || '/',
    secure,
  };
}

const ERROR_TEXT = {
  'browser-incompatible': 'Trình duyệt không hỗ trợ WebRTC.',
  network: 'Không kết nối được máy chủ bắt tay PeerJS.',
  'server-error': 'Máy chủ bắt tay PeerJS đang lỗi, thử lại sau.',
  'socket-error': 'Mất kết nối tới máy chủ bắt tay PeerJS.',
  'socket-closed': 'Mất kết nối tới máy chủ bắt tay PeerJS.',
  'peer-unavailable': 'Không tìm thấy phòng — kiểm tra lại mã phòng.',
  'unavailable-id': 'Mã phòng đang được dùng.',
  webrtc: 'Lỗi WebRTC — mạng có thể đang chặn kết nối trực tiếp.',
};

export function describePeerError(err) {
  return ERROR_TEXT[err?.type] ?? err?.message ?? 'Lỗi kết nối không xác định.';
}

/** Tạo Peer và chờ đăng ký xong với máy chủ bắt tay. `id` bỏ trống ⇒ ID ngẫu nhiên. */
export function createPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new globalThis.Peer(id, peerOptions()) : new globalThis.Peer(peerOptions());
    const timer = setTimeout(() => {
      peer.destroy();
      reject(Object.assign(new Error('Hết thời gian chờ máy chủ bắt tay PeerJS.'), { type: 'network' }));
    }, NET.connectTimeout);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
  });
}

export function makeRoomCode() {
  const { codeAlphabet: abc, codeLength } = NET;
  const bytes = crypto.getRandomValues(new Uint8Array(codeLength));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

/** Chuẩn hoá mã người dùng gõ: viết hoa, bỏ khoảng trắng/ký tự lạ. */
export function normalizeCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .split('')
    .filter((c) => NET.codeAlphabet.includes(c))
    .join('')
    .slice(0, NET.codeLength);
}

export const peerIdFor = (code) => `${NET.peerPrefix}${code}`;

/** Link mời: giữ nguyên ?peer=… nếu đang dùng máy chủ bắt tay tự host. */
export function inviteLink(code) {
  const url = new URL(location.href);
  url.hash = '';
  const peer = url.searchParams.get('peer');
  url.search = '';
  url.searchParams.set('room', code);
  if (peer) url.searchParams.set('peer', peer);
  return url.toString();
}

/** Mã phòng trong URL (?room=…) nếu người chơi mở link mời. */
export function roomFromUrl() {
  try {
    const code = normalizeCode(new URLSearchParams(location.search).get('room'));
    return code.length === NET.codeLength ? code : null;
  } catch {
    return null;
  }
}
