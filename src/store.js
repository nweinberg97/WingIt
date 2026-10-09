// Local-only persistence. No audio, no transcripts. Everything is resettable.
import { BRAND } from './brand.js';
import { scenarioKey } from './deck.js';

const P = BRAND.storagePrefix;
export const KEYS = Object.freeze({
  settings: `${P}:settings`,
  favorites: `${P}:favorites`,
  stats: `${P}:stats`,
  recent: `${P}:recent`, // sessionStorage
});

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system', // system | light | dark
  motion: 'system', // system | reduce | full
  timer: false,
  livePreview: true,
  reviewBeforeSend: false, // false = Finish sends the transcript straight to the coach
  modelsConsent: false, // true once the player agreed to save the models in this browser
  scenarioSource: 'auto', // auto (AI when the coach is awake) | deck
  coachModel: 'qwen2.5-1.5b',
  transcribeModel: 'whisper-base.en',
});

function safeGet(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class Store {
  constructor({ local = globalThis.localStorage, session = globalThis.sessionStorage } = {}) {
    this.local = local;
    this.session = session;
  }

  getSettings() {
    const s = safeGet(this.local, KEYS.settings, {});
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) out[k] = s[k];
    }
    return out;
  }
  saveSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    safeSet(this.local, KEYS.settings, next);
    return next;
  }

  getFavorites() {
    const f = safeGet(this.local, KEYS.favorites, []);
    return Array.isArray(f) ? f.filter((x) => x && typeof x.title === 'string' && typeof x.setup === 'string') : [];
  }
  isFavorite(s) {
    const k = scenarioKey(s);
    return this.getFavorites().some((f) => scenarioKey(f) === k);
  }
  toggleFavorite(s) {
    const k = scenarioKey(s);
    const favs = this.getFavorites();
    const idx = favs.findIndex((f) => scenarioKey(f) === k);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.unshift({ title: s.title, setup: s.setup, ask: s.ask, twist: s.twist ?? null, bonus: s.bonus ?? null, modeId: s.modeId, difficulty: s.difficulty });
    safeSet(this.local, KEYS.favorites, favs.slice(0, 50));
    return idx < 0;
  }

  getStats() {
    const s = safeGet(this.local, KEYS.stats, null);
    return s && typeof s.rounds === 'number' ? s : { rounds: 0, byMode: {}, dims: {}, best: 0 };
  }
  recordRound(modeId, feedback) {
    const st = this.getStats();
    st.rounds += 1;
    st.byMode[modeId] = (st.byMode[modeId] ?? 0) + 1;
    let total = 0;
    for (const sc of feedback.scores) {
      const d = (st.dims[sc.dimension] ??= { sum: 0, n: 0, label: sc.label });
      d.sum += sc.score;
      d.n += 1;
      total += sc.score;
    }
    st.best = Math.max(st.best ?? 0, total);
    safeSet(this.local, KEYS.stats, st);
    return st;
  }

  /** Session-level recent scenarios for repetition avoidance. */
  getRecent() {
    const r = safeGet(this.session, KEYS.recent, []);
    return Array.isArray(r) ? r : [];
  }
  pushRecent(s, max = 40) {
    const r = this.getRecent();
    r.push({ key: scenarioKey(s), title: s.title, setup: s.setup, ingredients: s.ingredients ?? [] });
    const trimmed = r.slice(-max);
    safeSet(this.session, KEYS.recent, trimmed);
    return trimmed;
  }

  clearHistory() {
    for (const [store, key] of [[this.local, KEYS.favorites], [this.local, KEYS.stats], [this.session, KEYS.recent]]) {
      try {
        store?.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }
  clearAll() {
    this.clearHistory();
    try {
      this.local?.removeItem(KEYS.settings);
    } catch {
      /* ignore */
    }
  }
}

/** Delete model files the browser cached for WebLLM and Transformers.js. */
export async function clearModelCaches(cachesApi = globalThis.caches) {
  if (!cachesApi?.keys) return 0;
  const names = await cachesApi.keys();
  let n = 0;
  for (const name of names) {
    if (/^webllm\/|transformers-cache/i.test(name)) {
      if (await cachesApi.delete(name)) n += 1;
    }
  }
  return n;
}
