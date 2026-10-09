// Module worker: runs Whisper locally with Transformers.js (ONNX Runtime Web, WASM).
// Receives Float32Array PCM at 16 kHz, returns text. Audio never leaves this worker.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

let lib = null;
let asr = null;
let loadedModel = null;
let loading = null;

async function ensure(model) {
  if (asr && loadedModel === model) return asr;
  if (loading) await loading.catch(() => {});
  if (asr && loadedModel === model) return asr;
  loading = (async () => {
    lib ??= await import(TRANSFORMERS_URL);
    lib.env.allowLocalModels = false;
    if (asr?.dispose) await asr.dispose().catch(() => {});
    asr = null;
    asr = await lib.pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        }
      },
    });
    loadedModel = model;
    return asr;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await ensure(msg.model);
      self.postMessage({ type: 'loaded', id: msg.id });
    } else if (msg.type === 'transcribe') {
      const pipe = await ensure(msg.model);
      let audio = msg.audio; // Float32Array, transferred
      const out = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5 });
      audio = null; // drop our reference to the PCM buffer immediately
      msg.audio = null;
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text ?? '';
      self.postMessage({ type: 'result', id: msg.id, text: text.trim(), partial: !!msg.partial });
    } else if (msg.type === 'unload') {
      if (asr?.dispose) await asr.dispose().catch(() => {});
      asr = null;
      loadedModel = null;
      self.postMessage({ type: 'unloaded', id: msg.id });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
  }
};
