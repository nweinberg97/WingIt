// Microphone capture. Starts only on an explicit user action, keeps PCM in memory,
// stops every track on stop/cancel, and hands back 16 kHz mono PCM for local transcription.

export const MAX_RECORD_SECONDS = 120;
export const TARGET_RATE = 16000;

export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function captureSupport(win = globalThis) {
  if (!win.isSecureContext) return { ok: false, code: 'insecure' };
  if (!win.navigator?.mediaDevices?.getUserMedia) return { ok: false, code: 'unsupported' };
  const AC = win.AudioContext || win.webkitAudioContext;
  if (!AC || !('audioWorklet' in AC.prototype)) return { ok: false, code: 'unsupported' };
  return { ok: true };
}

function mapError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new CaptureError('denied', 'Microphone permission was denied.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new CaptureError('no-mic', 'No microphone was found.');
  if (name === 'NotReadableError' || name === 'AbortError') return new CaptureError('busy', 'The microphone is busy or unavailable.');
  return new CaptureError('unknown', err?.message || 'Could not start the microphone.');
}

/** Concatenate Float32 chunks. */
export function concatChunks(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Linear-interpolation resampler (used when OfflineAudioContext is unavailable, and in tests). */
export function resampleLinear(input, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return input.slice(0);
  const ratio = fromRate / toRate;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

export async function resampleTo16k(pcm, fromRate) {
  if (fromRate === TARGET_RATE) return pcm.slice(0);
  const OAC = globalThis.OfflineAudioContext;
  if (!OAC || pcm.length === 0) return resampleLinear(pcm, fromRate);
  const outLen = Math.ceil((pcm.length * TARGET_RATE) / fromRate);
  const ctx = new OAC(1, outLen, TARGET_RATE);
  const buf = ctx.createBuffer(1, pcm.length, fromRate);
  buf.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice(0);
}

export function rms(pcm) {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / pcm.length);
}

export class MicCapture {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.source = null;
    this.analyser = null;
    this.chunks = [];
    this.active = false;
    this.startedAt = 0;
    this.peak = 0;
  }

  async start() {
    const support = captureSupport();
    if (!support.ok) throw new CaptureError(support.code, 'This browser cannot capture audio here.');
    if (this.active) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      throw mapError(err);
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      await this.ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.node = new AudioWorkletNode(this.ctx, 'wingit-pcm-capture');
      this.node.port.onmessage = (e) => {
        if (!this.active) return;
        this.chunks.push(e.data);
        const v = e.data;
        for (let i = 0; i < v.length; i += 8) this.peak = Math.max(this.peak, Math.abs(v[i]));
      };
      this.source.connect(this.analyser);
      this.source.connect(this.node);
      // Keep the graph pulling without making sound.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
      this.chunks = [];
      this.peak = 0;
      this.active = true;
      this.startedAt = performance.now();
    } catch (err) {
      await this.release();
      throw new CaptureError('unsupported', err?.message || 'Audio processing is not available.');
    }
  }

  get seconds() {
    return this.active ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Current input level 0..1 for the meter. */
  level() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let s = 0;
    for (const v of data) s += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(s / data.length) * 4);
  }

  /** A 16 kHz copy of what has been captured so far (for live preview). */
  async snapshot() {
    if (!this.active || !this.chunks.length) return null;
    return resampleTo16k(concatChunks(this.chunks), this.ctx.sampleRate);
  }

  /** Stop capturing, release the mic, and return 16 kHz PCM plus the peak level. */
  async stop() {
    if (!this.active) {
      await this.release();
      return { pcm: new Float32Array(0), peak: 0, seconds: 0 };
    }
    const rate = this.ctx.sampleRate;
    const seconds = this.seconds;
    this.active = false;
    const raw = concatChunks(this.chunks);
    this.chunks = [];
    const peak = this.peak;
    await this.release();
    const pcm = await resampleTo16k(raw, rate);
    return { pcm, peak, seconds };
  }

  /** Discard everything and release the microphone. */
  async cancel() {
    this.active = false;
    this.chunks = [];
    await this.release();
  }

  async release() {
    try {
      this.node?.port && (this.node.port.onmessage = null);
      this.node?.disconnect();
      this.source?.disconnect();
      this.analyser?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node = null;
    this.source = null;
    this.analyser = null;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
