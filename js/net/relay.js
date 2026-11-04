/**
 * Kênh CHUYỂN TIẾP qua máy chủ MQTT công cộng — dự phòng khi WebRTC P2P không thông
 * (NAT nhiều tầng của mạng 4G/CGNAT, tường lửa công ty chặn UDP...).
 *
 * Mọi máy chỉ mở kết nối WebSocket bảo mật (wss://) RA NGOÀI tới máy chủ MQTT ⇒ đi qua được hầu
 * hết NAT/tường lửa. Máy chủ MQTT chỉ chuyển tin nhắn theo "topic", không lưu gì ⇒ vẫn không cần
 * server riêng hay database. Một game theo lượt chỉ gửi vài tin nhắn nhỏ mỗi lượt.
 *
 * Topic (theo mã phòng):
 *   <tiền tố>/<protocol>/<MÃ>/h        khách → chủ phòng   { from, data } | { from, bye }  (bye = di chúc MQTT)
 *   <tiền tố>/<protocol>/<MÃ>/p/<id>   chủ phòng → 1 khách { data }
 *   <tiền tố>/<protocol>/<MÃ>/all      chủ phòng → mọi khách { bye }                (di chúc khi chủ phòng rớt)
 *
 * Mỗi bên nối SONG SONG tới nhiều máy chủ (NET.relayBrokers). Khách gửi lời chào qua mọi máy chủ
 * đã nối; chủ phòng trả lời qua máy chủ mà lời chào tới ĐẦU TIÊN, từ đó cả hai "khoá" vào máy chủ
 * đó (một kết nối WebSocket ⇒ tin nhắn đến đúng thứ tự).
 *
 * Kết nối trả về mô phỏng giao diện DataConnection của PeerJS: on('data'|'close'|'error'), send(),
 * close(), open, peer ⇒ OnlineSession dùng chung một logic cho cả P2P lẫn chuyển tiếp.
 */
import { NET } from '../config.js';
import { Emitter, loadScript } from '../utils.js';

const MQTT_URLS = [
  'https://cdn.jsdelivr.net/npm/mqtt@5.14.1/dist/mqtt.min.js',
  'https://unpkg.com/mqtt@5.14.1/dist/mqtt.min.js',
];

export async function loadMqtt() {
  for (const url of MQTT_URLS) {
    if (globalThis.mqtt?.connect) return;
    try {
      await loadScript(url);
    } catch {
      /* thử CDN tiếp theo */
    }
  }
  if (!globalThis.mqtt?.connect) throw new Error('Không tải được thư viện MQTT.');
}

const params = () => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
};

/** Danh sách máy chủ MQTT: ?mqtt=url1,url2 (test / tự host) ưu tiên hơn cấu hình. */
export function relayBrokers() {
  const custom = params().get('mqtt');
  return custom ? custom.split(',').map((s) => s.trim()).filter(Boolean) : [...NET.relayBrokers];
}

/** ?net=relay ⇒ bỏ qua P2P, vào phòng thẳng bằng kênh chuyển tiếp. */
export const relayForced = () => params().get('net') === 'relay';

export const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
};

function topicsFor(code) {
  const base = `${NET.relayTopic}/${NET.protocol}/${code}`;
  return { host: `${base}/h`, all: `${base}/all`, peer: (id) => `${base}/p/${id}` };
}

function parse(payload) {
  try {
    const msg = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
    return msg && typeof msg === 'object' ? msg : null;
  } catch {
    return null;
  }
}

/** Một kết nối tới một máy chủ MQTT. */
class Broker {
  constructor(url, { will, subscribe, onMessage, onConnect }) {
    this.url = url;
    this.client = globalThis.mqtt.connect(url, {
      clientId: `mga_${randomId()}`,
      clean: true,
      keepalive: 20,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      will,
    });
    this.everConnected = false;
    this.failures = 0;
    this.client.on('connect', () => {
      this.everConnected = true;
      for (const topic of subscribe) this.client.subscribe(topic, { qos: 0 });
      onConnect?.(this);
    });
    this.client.on('message', (topic, payload) => onMessage(this, topic, payload));
    this.client.on('error', () => {}); // lỗi từng máy chủ không làm hỏng cả kênh
    // Máy chủ bị chặn / không tồn tại: thử 3 lần rồi thôi (không thử lại mãi).
    this.client.on('close', () => {
      if (!this.everConnected && ++this.failures >= 3) this.client.end(true);
    });
  }

  get connected() {
    return this.client.connected;
  }

  publish(topic, msg) {
    if (this.client.connected) this.client.publish(topic, JSON.stringify(msg), { qos: 0 });
  }

  /** Ngắt có chào (gói DISCONNECT) ⇒ máy chủ KHÔNG phát di chúc. */
  end() {
    try {
      this.client.end(false);
    } catch {
      /* đã đóng */
    }
  }
}

/** Kết nối ảo — cùng giao diện với DataConnection của PeerJS. */
class RelayConnection extends Emitter {
  constructor(peer, send, onClose) {
    super();
    this.peer = peer;
    this.open = true;
    this.relay = true;
    this.sendFn = send;
    this.onClose = onClose;
  }

  send(data) {
    if (this.open) this.sendFn(data);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.onClose?.();
    this.emit('close');
  }
}

/* ═════════════════════════════ Phía CHỦ PHÒNG ═════════════════════════════ */

/** Lắng nghe khách vào phòng qua kênh chuyển tiếp; phát sự kiện 'connection' (RelayConnection). */
export class RelayHub extends Emitter {
  constructor(code) {
    super();
    this.topics = topicsFor(code);
    this.brokers = [];
    this.links = new Map(); // id khách → { conn, broker }
    this.stopped = false;
  }

  /** Số máy chủ đang nối (để hiển thị trạng thái kênh dự phòng). */
  get readyCount() {
    return this.brokers.filter((b) => b.connected).length;
  }

  /** Chờ tới khi có ít nhất 1 máy chủ nối được (true) hoặc hết giờ / không khả dụng (false). */
  whenReady(timeoutMs) {
    return new Promise((resolve) => {
      if (this.readyCount > 0) return resolve(true);
      if (this.failed) return resolve(false);
      const done = (ok) => {
        clearTimeout(timer);
        off();
        resolve(ok);
      };
      const off = this.on('status', (count) => {
        if (count > 0) done(true);
        else if (this.failed) done(false);
      });
      const timer = setTimeout(() => done(this.readyCount > 0), timeoutMs);
    });
  }

  async start() {
    try {
      await loadMqtt();
    } catch {
      this.failed = true;
      this.emit('status', 0);
      return;
    }
    if (this.stopped) return;
    const will = { topic: this.topics.all, payload: JSON.stringify({ bye: true }), qos: 0, retain: false };
    for (const url of relayBrokers()) {
      this.brokers.push(new Broker(url, {
        will,
        subscribe: [this.topics.host],
        onMessage: (broker, topic, payload) => this.onMessage(broker, topic, payload),
        onConnect: () => this.emit('status', this.readyCount),
      }));
    }
  }

  onMessage(broker, topic, payload) {
    if (topic !== this.topics.host) return;
    const msg = parse(payload);
    if (!msg || typeof msg.from !== 'string' || !msg.from) return;
    const id = msg.from.slice(0, 40);
    let link = this.links.get(id);
    if (msg.bye) {
      if (link && link.broker === broker) link.conn.close(); // khách rớt mạng (di chúc MQTT)
      return;
    }
    if (!link) {
      if (msg.data?.type !== 'hello') return; // chỉ lời chào mới mở kết nối mới
      const conn = new RelayConnection(
        id,
        (data) => broker.publish(this.topics.peer(id), { data }),
        () => this.links.delete(id),
      );
      link = { conn, broker };
      this.links.set(id, link);
      this.emit('connection', conn);
    } else if (link.broker !== broker) {
      return; // bản trùng của cùng tin nhắn đi qua máy chủ khác
    }
    link.conn.emit('data', msg.data);
  }

  stop() {
    this.stopped = true;
    for (const { conn } of [...this.links.values()]) conn.close();
    for (const b of this.brokers) b.end();
    this.brokers = [];
  }
}

/* ═════════════════════════════ Phía KHÁCH ═════════════════════════════ */

/** Kết nối tới chủ phòng qua kênh chuyển tiếp — cùng giao diện DataConnection của PeerJS. */
export class RelayLink extends Emitter {
  constructor(code, id) {
    super();
    this.id = id;
    this.peer = `relay:${code}`;
    this.open = true;
    this.relay = true;
    this.topics = topicsFor(code);
    this.brokers = [];
    this.locked = null;  // máy chủ đã chọn (nơi chủ phòng trả lời đầu tiên)
    this.pending = null; // lời chào chờ gửi tới các máy chủ nối muộn
  }

  async start() {
    await loadMqtt();
    if (!this.open) return;
    const will = { topic: this.topics.host, payload: JSON.stringify({ from: this.id, bye: true }), qos: 0, retain: false };
    for (const url of relayBrokers()) {
      this.brokers.push(new Broker(url, {
        will,
        subscribe: [this.topics.peer(this.id), this.topics.all],
        onMessage: (broker, topic, payload) => this.onMessage(broker, topic, payload),
        onConnect: (broker) => {
          if (!this.locked && this.pending) broker.publish(this.topics.host, { from: this.id, data: this.pending });
        },
      }));
    }
  }

  send(data) {
    if (!this.open) return;
    const msg = { from: this.id, data };
    if (this.locked) {
      this.locked.publish(this.topics.host, msg);
      return;
    }
    this.pending = data; // chưa chọn máy chủ: gửi qua mọi máy chủ đã nối (và cả máy chủ nối muộn)
    for (const b of this.brokers) b.publish(this.topics.host, msg);
  }

  onMessage(broker, topic, payload) {
    const msg = parse(payload);
    if (!msg) return;
    if (topic === this.topics.all) {
      if (msg.bye && (!this.locked || this.locked === broker)) this.close(); // chủ phòng rớt mạng
      return;
    }
    if (topic !== this.topics.peer(this.id)) return;
    if (!this.locked) {
      this.locked = broker;
      this.pending = null;
      for (const b of this.brokers) if (b !== broker) b.end();
      this.brokers = [broker];
    } else if (broker !== this.locked) {
      return;
    }
    this.emit('data', msg.data);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    for (const b of this.brokers) b.end();
    this.brokers = [];
    this.emit('close');
  }
}
