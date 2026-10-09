// Main-thread client for the local Whisper worker. Stable interface so the runtime can be swapped.

export const TRANSCRIBE_MODELS = Object.freeze({
  'whisper-tiny.en': { id: 'onnx-community/whisper-tiny.en', label: 'Whisper Tiny (English)', sizeMB: 41, note: 'Fastest. Good for clear speech.' },
  'whisper-base.en': { id: 'onnx-community/whisper-base.en', label: 'Whisper Base (English)', sizeMB: 77, note: 'More accurate. A bit slower.' },
});
export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-base.en';

export class LocalTranscriber {
  constructor({ workerFactory } = {}) {
    this.workerFactory = workerFactory ?? (() => new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' }));
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.listeners = new Set();
    this.status = 'idle'; // idle | loading | ready | error
    this.modelKey = DEFAULT_TRANSCRIBE_MODEL;
    this.busy = false;
    this.progress = new Map();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }
  setStatus(status, extra = {}) {
    this.status = status;
    this.emit({ type: 'status', status, ...extra });
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = this.workerFactory();
    this.worker.onmessage = (e) => this.handle(e.data);
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Transcription worker crashed');
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
      this.setStatus('error', { message: err.message });
    };
    return this.worker;
  }

  handle(msg) {
    if (msg.type === 'progress') {
      this.progress.set(msg.file, { loaded: msg.loaded, total: msg.total });
      let loaded = 0;
      let total = 0;
      for (const v of this.progress.values()) {
        loaded += v.loaded;
        total += v.total;
      }
      this.emit({ type: 'progress', loaded, total, fraction: total ? loaded / total : 0 });
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  call(payload, transfer = []) {
    const id = this.nextId++;
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...payload, id }, transfer);
    });
  }

  setModel(key) {
    if (!TRANSCRIBE_MODELS[key] || key === this.modelKey) return;
    this.modelKey = key;
    if (this.status === 'ready') this.setStatus('idle');
  }

  async load() {
    if (this.status === 'ready') return;
    this.progress.clear();
    this.setStatus('loading');
    try {
      await this.call({ type: 'load', model: TRANSCRIBE_MODELS[this.modelKey].id });
      this.setStatus('ready');
    } catch (err) {
      this.setStatus('error', { message: err.message });
      throw err;
    }
  }

  /**
   * Transcribe 16 kHz mono PCM. The buffer is transferred (moved) to the worker, so the
   * caller's copy is detached immediately and no second copy lingers on the main thread.
   */
  async transcribe(pcm, { partial = false } = {}) {
    if (partial && this.busy) return null; // skip live previews while a pass is running
    await this.load();
    this.busy = true;
    try {
      const res = await this.call({ type: 'transcribe', model: TRANSCRIBE_MODELS[this.modelKey].id, audio: pcm, partial }, [pcm.buffer]);
      return res.text;
    } finally {
      this.busy = false;
    }
  }

  async unload() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new Error('unloaded'));
    this.pending.clear();
    this.busy = false;
    this.setStatus('idle');
  }
}
