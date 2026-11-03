/**
 * Âm thanh tổng hợp bằng WebAudio — không cần file asset nào (dễ deploy).
 * Điểm nhấn: khi tia đang vẽ, cao độ âm thanh bám theo độ cao y của đầu tia ("nghe" được đồ thị).
 */
import { storage } from '../utils.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.trace = null;
    this.muted = storage.get('mga.muted', false);
  }

  /** Phải gọi trong một sự kiện người dùng (click) do chính sách autoplay của trình duyệt. */
  unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    storage.set('mga.muted', muted);
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  get ready() {
    return !!this.ctx && !this.muted;
  }

  /* ───────────── khối dựng âm thanh ───────────── */

  tone({ type = 'sine', from, to = from, dur = 0.2, gain = 0.2, delay = 0, attack = 0.005 }) {
    const { ctx } = this;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.4, gain = 0.4, freq = 900, to = 120, q = 0.8, delay = 0 }) {
    const { ctx } = this;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ───────────── âm thanh trong game ───────────── */

  play(name, opts = {}) {
    if (!this.ready) return;
    switch (name) {
      case 'click':
        this.tone({ type: 'triangle', from: 660, to: 520, dur: 0.06, gain: 0.08 });
        break;
      case 'fire':
        this.tone({ type: 'sawtooth', from: 180, to: 720, dur: 0.22, gain: 0.07 });
        this.noise({ dur: 0.18, gain: 0.12, freq: 3000, to: 600 });
        break;
      case 'explosion':
        this.noise({ dur: opts.big ? 1.1 : 0.75, gain: opts.big ? 0.9 : 0.65, freq: 1600, to: 60 });
        this.tone({ type: 'sine', from: opts.big ? 120 : 150, to: 38, dur: opts.big ? 0.7 : 0.5, gain: 0.5 });
        break;
      case 'fizzle':
        this.tone({ type: 'square', from: 420, to: 90, dur: 0.25, gain: 0.05 });
        break;
      case 'hit':
        this.tone({ type: 'square', from: 240, to: 110, dur: 0.16, gain: 0.08 });
        break;
      case 'block':
        this.tone({ type: 'triangle', from: 1400, to: 900, dur: 0.25, gain: 0.12 });
        this.tone({ type: 'sine', from: 2100, to: 1800, dur: 0.35, gain: 0.06, delay: 0.03 });
        break;
      case 'heal':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ from: f, dur: 0.22, gain: 0.1, delay: i * 0.07 }));
        break;
      case 'shield':
        this.tone({ type: 'triangle', from: 300, to: 900, dur: 0.35, gain: 0.1 });
        this.tone({ type: 'sine', from: 905, to: 905, dur: 0.4, gain: 0.05, delay: 0.2 });
        break;
      case 'arm':
        this.tone({ type: 'triangle', from: 440, to: 880, dur: 0.14, gain: 0.09 });
        break;
      case 'teleport':
        this.tone({ type: 'sine', from: 1200, to: 200, dur: 0.25, gain: 0.12 });
        this.tone({ type: 'sine', from: 200, to: 1400, dur: 0.3, gain: 0.1, delay: 0.22 });
        break;
      case 'tick':
        this.tone({ type: 'square', from: opts.urgent ? 1320 : 990, dur: 0.035, gain: 0.05 });
        break;
      case 'turn':
        this.tone({ type: 'sine', from: 660, dur: 0.18, gain: 0.08 });
        this.tone({ type: 'sine', from: 990, dur: 0.25, gain: 0.07, delay: 0.09 });
        break;
      case 'timeout':
        this.tone({ type: 'sawtooth', from: 300, to: 150, dur: 0.4, gain: 0.07 });
        break;
      case 'death':
        this.tone({ type: 'sawtooth', from: 400, to: 60, dur: 0.8, gain: 0.1 });
        break;
      case 'win':
        [523, 659, 784, 1046, 1318].forEach((f, i) =>
          this.tone({ type: 'triangle', from: f, dur: 0.35, gain: 0.1, delay: i * 0.11 }));
        break;
      case 'error':
        this.tone({ type: 'square', from: 180, to: 140, dur: 0.15, gain: 0.06 });
        break;
      default:
    }
  }

  /** Âm thanh "vẽ đồ thị": dao động liên tục, cao độ theo độ cao đầu tia. */
  startTrace() {
    if (!this.ready) return;
    this.stopTrace();
    const { ctx } = this;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc2.detune.value = 7;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.05);
    osc.connect(g);
    osc2.connect(g);
    g.connect(this.master);
    osc.start();
    osc2.start();
    this.trace = { osc, osc2, g };
  }

  /** level ∈ [0, 1]: 0 = đáy bản đồ, 1 = đỉnh. */
  updateTrace(level) {
    if (!this.trace) return;
    const f = 180 + Math.max(0, Math.min(1, level)) * 900;
    const t = this.ctx.currentTime;
    this.trace.osc.frequency.setTargetAtTime(f, t, 0.015);
    this.trace.osc2.frequency.setTargetAtTime(f * 2, t, 0.015);
  }

  stopTrace() {
    if (!this.trace) return;
    const { osc, osc2, g } = this.trace;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.03);
    osc.stop(t + 0.15);
    osc2.stop(t + 0.15);
    this.trace = null;
  }
}
