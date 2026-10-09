// Test doubles. These replace hardware and model downloads in automated tests only.
import { getMode } from '../src/modes.js';

export class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

export function goodFeedback(modeId, quote = 'self-heating ice cube', overrides = {}) {
  return {
    on_topic: true,
    overall_feedback: 'You committed to the pitch and gave the board a concrete reason to care.',
    strongest_move: { quote, why: 'Naming the product precisely made the absurd idea feel real.' },
    what_worked: 'The specific detail grounded the joke.',
    try_next: 'Add one escalating benefit, each bigger than the last.',
    alternative_approach: { technique: 'Reversal', example: 'Admit it melts instantly, then sell that as the feature.' },
    scores: getMode(modeId).rubric.map((d, i) => ({ dimension: d, score: 3 + (i % 2), reason: `Reason for ${d}.` })),
    closing_line: 'The board is warming up to you.',
    ...overrides,
  };
}

/** Fake model runtime: scripted responses, records calls, detects concurrent use. */
export function fakeRuntime({ responses = [], delayMs = 5, onChat } = {}) {
  const rt = {
    name: 'FakeRuntime',
    calls: [],
    loads: 0,
    active: 0,
    maxActive: 0,
    interrupted: 0,
    queue: [...responses],
    cached: false,
    async load() {
      rt.loads += 1;
    },
    async isCached() {
      return rt.cached;
    },
    async chat(messages, opts) {
      rt.active += 1;
      rt.maxActive = Math.max(rt.maxActive, rt.active);
      rt.calls.push({ messages, opts });
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        if (onChat) return await onChat(messages, opts, rt);
        const next = rt.queue.length ? rt.queue.shift() : null;
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return await next(messages, opts);
        return { text: typeof next === 'string' ? next : JSON.stringify(next), finishReason: 'stop' };
      } finally {
        rt.active -= 1;
      }
    },
    async interrupt() {
      rt.interrupted += 1;
    },
    async unload() {},
  };
  return rt;
}

export const gpuOk = async () => ({ ok: true, f16: true });
export const gpuMissing = async () => ({ ok: false, f16: false });

export class FakeTranscriber {
  constructor(results = []) {
    this.results = [...results];
    this.status = 'ready';
    this.busy = false;
    this.received = [];
  }
  on() {
    return () => {};
  }
  setModel() {}
  async load() {}
  async transcribe(pcm) {
    this.received.push(pcm.length);
    const r = this.results.shift();
    if (r instanceof Error) throw r;
    return r ?? '';
  }
  async unload() {}
}

export class FakeMic {
  constructor({ startError, pcmLength = 32000, peak = 0.3 } = {}) {
    this.startError = startError;
    this.pcmLength = pcmLength;
    this.peakValue = peak;
    this.started = false;
    this.stopped = false;
    this.cancelled = false;
  }
  async start() {
    if (this.startError) throw this.startError;
    this.started = true;
  }
  level() {
    return 0.5;
  }
  async snapshot() {
    return null;
  }
  async stop() {
    this.stopped = true;
    return { pcm: new Float32Array(this.pcmLength), peak: this.peakValue, seconds: this.pcmLength / 16000 };
  }
  async cancel() {
    this.cancelled = true;
  }
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, { timeout = 2000, step = 5 } = {}) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('until(): timed out');
    await tick(step);
  }
}
