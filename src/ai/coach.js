// Model lifecycle + serialized, cancellable, time-limited text generation.
// The UI talks to Coach only; Coach talks to a runtime adapter (WebLLM by default).

import { pinnedWebLLMConfig } from '../security/guard.js';

export const COACH_MODELS = Object.freeze({
  'qwen2.5-1.5b': {
    label: 'Qwen2.5 1.5B Instruct',
    blurb: 'Recommended. Good feedback on most laptops with WebGPU.',
    license: 'Apache-2.0',
    ids: { f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' },
    vramMB: { f16: 1630, f32: 1889 },
    approxDownloadGB: 1.0,
  },
  'qwen2.5-0.5b': {
    label: 'Qwen2.5 0.5B Instruct',
    blurb: 'Lite. Smaller download and memory; simpler feedback.',
    license: 'Apache-2.0',
    ids: { f16: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', f32: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC' },
    vramMB: { f16: 945, f32: 1060 },
    approxDownloadGB: 0.4,
  },
  'phi-3.5-mini': {
    label: 'Phi-3.5 mini Instruct',
    blurb: 'Sharpest feedback. Needs a strong GPU and a bigger download.',
    license: 'MIT',
    ids: { f16: 'Phi-3.5-mini-instruct-q4f16_1-MLC', f32: 'Phi-3.5-mini-instruct-q4f32_1-MLC' },
    vramMB: { f16: 3672, f32: 5483 },
    approxDownloadGB: 2.2,
  },
});
export const DEFAULT_COACH_MODEL = 'qwen2.5-1.5b';

export class CoachError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function classifyError(err) {
  if (err instanceof CoachError) return err;
  if (err?.code === 'guard') return new CoachError('guard', err.message);
  const m = String(err?.message ?? err).toLowerCase();
  if (/out of memory|oom|device (?:was )?lost|allocation|exceeds/.test(m)) return new CoachError('memory', 'Your device ran out of GPU memory for this model.');
  if (/webgpu|navigator\.gpu|adapter/.test(m)) return new CoachError('webgpu', 'WebGPU is not available in this browser.');
  if (/fetch|network|load failed|cache|quota|404|403/.test(m)) return new CoachError('download', 'Model files could not be downloaded.');
  return new CoachError('model', String(err?.message ?? err));
}

/** Detect WebGPU and whether the GPU supports 16-bit float shaders. */
export async function detectGpu(nav = globalThis.navigator) {
  if (!nav?.gpu) return { ok: false, f16: false };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { ok: false, f16: false };
    return { ok: true, f16: adapter.features?.has?.('shader-f16') ?? false };
  } catch {
    return { ok: false, f16: false };
  }
}

/**
 * Default runtime: WebLLM in a module worker. The library is served from this site (vendor/),
 * every model is pinned to an exact Hugging Face commit, and nothing loads until the integrity
 * guard is protecting the page, so every file is checked against its fingerprint on the way in.
 */
export function createWebLLMRuntime({ beforeLoad = async () => {}, getManifest = async () => null } = {}) {
  let engine = null;
  let lib = null;
  let appConfig = null;
  const libUrl = new URL('../../vendor/web-llm.js', import.meta.url).href;
  async function prepare() {
    await beforeLoad();
    const manifest = await getManifest();
    if (!manifest) throw new CoachError('guard', 'This copy of WingIt has no pinned model files, so the coach is switched off.');
    lib ??= await import(libUrl);
    appConfig ??= pinnedWebLLMConfig(manifest, lib.prebuiltAppConfig, document.baseURI);
  }
  return {
    name: 'WebLLM',
    async load(modelId, onProgress) {
      await prepare();
      if (!appConfig.model_list.some((m) => m.model_id === modelId)) throw new CoachError('guard', `${modelId} is not one of the pinned models.`);
      const cb = (r) => onProgress?.({ fraction: r.progress ?? 0, text: r.text ?? '' });
      if (engine) {
        engine.setInitProgressCallback?.(cb);
        await engine.reload(modelId);
      } else {
        const worker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
        engine = await lib.CreateWebWorkerMLCEngine(worker, modelId, { appConfig, initProgressCallback: cb });
      }
    },
    async chat(messages, { schema, temperature = 0.7, maxTokens = 700 }) {
      const req = { messages, temperature, max_tokens: maxTokens, stream: false };
      if (schema) req.response_format = { type: 'json_object', schema: JSON.stringify(schema) };
      const res = await engine.chat.completions.create(req);
      const choice = res.choices?.[0];
      return { text: choice?.message?.content ?? '', finishReason: choice?.finish_reason ?? null };
    },
    async isCached(modelId) {
      try {
        await prepare();
        return await lib.hasModelInCache(modelId, appConfig);
      } catch {
        return false;
      }
    },
    async interrupt() {
      try {
        await engine?.interruptGenerate();
      } catch {
        /* nothing running */
      }
    },
    async unload() {
      await engine?.unload?.();
    },
  };
}

export class Coach {
  /**
   * @param {{runtime?: object, gpuDetector?: () => Promise<{ok:boolean,f16:boolean}>, runtimeName?: string}} opts
   */
  constructor({ runtime, gpuDetector } = {}) {
    this.runtime = runtime ?? createWebLLMRuntime();
    this.gpuDetector = gpuDetector ?? detectGpu;
    this.status = 'idle'; // idle | unsupported | loading | ready | error
    this.error = null;
    this.modelKey = DEFAULT_COACH_MODEL;
    this.loadedModelId = null;
    this.progress = 0;
    this.listeners = new Set();
    this.tail = Promise.resolve();
    this.loadPromise = null;
    this.cached = false;
    this.gpuOk = null;
  }

  get runtimeName() {
    return this.runtime.name ?? 'runtime';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this);
  }
  set(patch) {
    Object.assign(this, patch);
    this.emit();
  }

  setModel(key) {
    if (!COACH_MODELS[key] || key === this.modelKey) return;
    this.modelKey = key;
    if (this.status === 'ready' || this.status === 'error') this.set({ status: 'idle', error: null });
    else this.emit();
  }

  /** Load (or switch) the model once; repeated calls share the same promise. */
  load() {
    if (this.status === 'ready') return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      this.set({ status: 'loading', progress: 0, error: null });
      const gpu = await this.gpuDetector();
      if (!gpu.ok) {
        const e = new CoachError('webgpu', 'WebGPU is not available in this browser.');
        this.set({ status: 'unsupported', error: e });
        throw e;
      }
      const model = COACH_MODELS[this.modelKey];
      const modelId = gpu.f16 ? model.ids.f16 : model.ids.f32;
      try {
        await this.runtime.load(modelId, ({ fraction }) => this.set({ progress: Math.max(this.progress, fraction || 0) }));
        this.set({ status: 'ready', progress: 1, loadedModelId: modelId, cached: true });
      } catch (err) {
        const e = classifyError(err);
        this.set({ status: 'error', error: e });
        throw e;
      }
    })().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  /**
   * Run one generation. Calls are serialized (one GPU, one model). Times out and interrupts.
   * If `isStale()` returns true once the job's turn comes, it is skipped.
   */
  complete(messages, { schema, temperature, maxTokens, timeoutMs = 90000, isStale } = {}) {
    const job = async () => {
      if (isStale?.()) throw new CoachError('stale', 'Superseded');
      if (this.status !== 'ready') await this.load();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CoachError('timeout', 'The coach took too long to answer.')), timeoutMs);
      });
      const run = this.runtime.chat(messages, { schema, temperature, maxTokens });
      try {
        return await Promise.race([run, timeout]);
      } catch (err) {
        if (err?.code === 'timeout') {
          await this.runtime.interrupt();
          await run.catch(() => {}); // let the runtime settle before the next job starts
          throw err;
        }
        throw classifyError(err);
      } finally {
        clearTimeout(timer);
      }
    };
    const p = this.tail.then(job, job);
    this.tail = p.catch(() => {});
    return p;
  }

  /** Resolve the concrete model id for this device (f16 when the GPU supports it). */
  async resolveModelId() {
    const gpu = await this.gpuDetector();
    if (!gpu.ok) return null;
    const m = COACH_MODELS[this.modelKey];
    return gpu.f16 ? m.ids.f16 : m.ids.f32;
  }

  /** Has the current model been downloaded already? (Lets returning players skip the wake-up prompt.) */
  async checkCached() {
    const id = await this.resolveModelId();
    const cached = id ? !!(await this.runtime.isCached?.(id)) : false;
    this.set({ cached, gpuOk: !!id });
    return cached;
  }

  /** Stop whatever generation is running (e.g. a background scenario prefetch). */
  async interrupt() {
    await this.runtime.interrupt?.();
  }

  async unload() {
    await this.runtime.interrupt?.();
    await this.runtime.unload?.();
    this.set({ status: 'idle', loadedModelId: null, progress: 0 });
  }
}
