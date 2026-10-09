// Client side of the integrity guard (see /sw.js). Models never load until the guard is active and
// protecting this page; if it can't start (e.g. service workers are disabled in private browsing),
// the models stay off rather than loading unchecked.

export class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MANIFEST_URL = 'vendor/integrity.json';
let manifestPromise = null;

/** The pinned versions + fingerprints shipped with this deploy (fetched from our own site). */
export function loadManifest(fetchImpl = globalThis.fetch) {
  manifestPromise ??= fetchImpl(MANIFEST_URL, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (m && m.pins && m.files ? m : null))
    .catch(() => null);
  return manifestPromise;
}

export function resetManifestCache() {
  manifestPromise = null;
}

/** WebLLM app config built only from pinned, fingerprinted sources. */
export function pinnedWebLLMConfig(manifest, prebuilt, baseUrl) {
  const model_list = [];
  for (const [id, p] of Object.entries(manifest.pins.webllm ?? {})) {
    const base = prebuilt.model_list.find((m) => m.model_id === id);
    if (!base) continue;
    model_list.push({
      ...base,
      model: `https://huggingface.co/${p.repo}/resolve/${p.revision}/`,
      model_lib: new URL(p.lib, baseUrl).href,
    });
  }
  return { ...prebuilt, model_list, useIndexedDBCache: false };
}

export class IntegrityGuard {
  constructor({ nav = globalThis.navigator, swUrl = './sw.js', timeoutMs = 15000 } = {}) {
    this.nav = nav;
    this.swUrl = swUrl;
    this.timeoutMs = timeoutMs;
    this.status = 'idle'; // idle | starting | active | unavailable
    this.lastCheck = null;
    this.blocked = [];
    this.listeners = new Set();
    this.readyPromise = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  /** Resolves once this page is controlled by the guard and saved files have been re-checked. */
  ready() {
    this.readyPromise ??= this.start().catch((err) => {
      this.readyPromise = null;
      this.status = 'unavailable';
      this.emit({ type: 'status', status: this.status });
      throw err;
    });
    return this.readyPromise;
  }

  async start() {
    const sw = this.nav?.serviceWorker;
    if (!sw) throw new GuardError('guard', 'This browser has the safety check turned off (often in private browsing).');
    this.status = 'starting';
    this.emit({ type: 'status', status: this.status });
    sw.addEventListener?.('message', (e) => {
      const d = e.data || {};
      if (d.source !== 'wingit-guard') return;
      if (d.type === 'blocked') {
        this.blocked.push({ url: d.url, reason: d.reason, at: Date.now() });
        this.emit({ type: 'blocked', url: d.url, reason: d.reason });
      }
    });
    try {
      await sw.register(this.swUrl, { scope: './' });
    } catch (err) {
      throw new GuardError('guard', `The safety check couldn't start: ${err?.message ?? err}`);
    }
    await sw.ready;
    if (!sw.controller) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new GuardError('guard', 'The safety check didn\'t take over this page in time. Reload and try again.')), this.timeoutMs);
        sw.addEventListener('controllerchange', () => {
          clearTimeout(t);
          resolve();
        }, { once: true });
      });
    }
    const status = await this.ask('status');
    if (!status?.ok) throw new GuardError('guard', 'This copy of WingIt has no file fingerprints yet, so the AI models are switched off.');
    this.lastCheck = await this.ask('verify-saved', 120000);
    this.status = 'active';
    this.version = status.version;
    this.fileCount = status.files;
    this.emit({ type: 'status', status: this.status, check: this.lastCheck });
    return this.lastCheck;
  }

  ask(type, timeoutMs = 10000) {
    const ctl = this.nav.serviceWorker.controller;
    if (!ctl) return Promise.resolve(null);
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), timeoutMs);
      ch.port1.onmessage = (e) => {
        clearTimeout(t);
        resolve(e.data);
      };
      ctl.postMessage({ type }, [ch.port2]);
    });
  }
}
