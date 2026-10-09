// Injected by the browser tests BEFORE the app boots (Playwright add_init_script).
// Replaces only the model runtimes, so the real UI, controller, validation and (optionally) the real
// microphone capture pipeline are exercised. Never loaded by the app itself.
(() => {
  const params = new URLSearchParams(location.search);
  const slow = Number(params.get('slow') || 0);
  const noGpu = params.get('nogpu') === '1';
  const realMic = params.get('realmic') === '1';
  const denyMic = params.get('denymic') === '1';
  const metered = params.get('metered') === '1';
  const loadMs = Number(params.get('loadms') || 50);

  window.__e2e = { chatCalls: 0, transcribed: [], tracks: [] };

  function feedbackFor(messages) {
    const sys = messages[0].content;
    const dims = [...sys.matchAll(/^- "([a-z-]+)"/gm)].map((m) => m[1]);
    const transcript = (messages[1].content.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/) || [])[1] || '';
    const quote = transcript.split(/\s+/).slice(0, 4).join(' ');
    return {
      on_topic: true,
      overall_feedback: 'E2E: you jumped straight into the scene.',
      strongest_move: { quote, why: 'Opening with a concrete image pulled us in.' },
      what_worked: 'Specific nouns did the heavy lifting.',
      try_next: 'Raise the stakes once more before you finish.',
      alternative_approach: { technique: 'Reversal', example: 'Flip it: the problem is secretly the best feature.' },
      scores: dims.map((d, i) => ({ dimension: d, score: [4, 3, 5][i % 3], reason: `Because of ${d}.` })),
      closing_line: 'Encore!',
    };
  }

  const coachRuntime = {
    name: 'E2EFakeRuntime',
    async load(id, onProgress) {
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, loadMs / steps));
        onProgress?.({ fraction: i / steps });
      }
    },
    async isCached() {
      return false;
    },
    async chat(messages, opts) {
      window.__e2e.chatCalls += 1;
      if (slow) await new Promise((r) => setTimeout(r, slow));
      const isScenario = !!opts.schema?.properties?.setup;
      if (isScenario) {
        return { text: JSON.stringify({ title: `Coach card ${window.__e2e.chatCalls}`, setup: `You are the night manager of a lighthouse that has started taking brunch reservations, number ${window.__e2e.chatCalls}.`, ask: 'Greet the first guests.', twist: '' }), finishReason: 'stop' };
      }
      return { text: JSON.stringify(feedbackFor(messages)), finishReason: 'stop' };
    },
    async interrupt() {},
    async unload() {},
  };

  const listeners = new Set();
  const transcriber = {
    status: 'ready',
    busy: false,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setModel() {},
    async load() {},
    async transcribe(pcm, { partial } = {}) {
      if (partial) return null;
      window.__e2e.transcribed.push({ samples: pcm.length, rms: Math.sqrt(pcm.reduce((a, v) => a + v * v, 0) / Math.max(1, pcm.length)) });
      return 'The pigeons have formed a union and they want bread.';
    },
    async unload() {},
  };

  // Track every microphone track so tests can prove they were stopped.
  if (navigator.mediaDevices?.getUserMedia) {
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (denyMic) throw new DOMException('Permission denied', 'NotAllowedError');
      const s = await orig(c);
      s.getTracks().forEach((t) => window.__e2e.tracks.push(t));
      return s;
    };
  }

  class FakeMic {
    async start() {}
    level() {
      return 0.4;
    }
    async snapshot() {
      return null;
    }
    async stop() {
      return { pcm: new Float32Array(24000).fill(0.1), peak: 0.3, seconds: 1.5 };
    }
    async cancel() {}
  }

  window.__WINGIT_TEST__ = {
    connection: metered ? { saveData: true, type: 'cellular', effectiveType: '4g' } : null,
    coachRuntime,
    gpuDetector: async () => (noGpu ? { ok: false, f16: false } : { ok: true, f16: true }),
    transcriber,
    micFactory: realMic || denyMic ? undefined : () => new FakeMic(),
  };
})();
