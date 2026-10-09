import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Coach, classifyError, COACH_MODELS } from '../src/ai/coach.js';
import { evaluateAnswer, generateScenario } from '../src/ai/services.js';
import { Controller } from '../src/controller.js';
import { Store } from '../src/store.js';
import { deckScenario, makeRng, pickIngredients } from '../src/deck.js';
import { CaptureError } from '../src/speech/capture.js';
import { MemoryStorage, fakeRuntime, gpuOk, gpuMissing, goodFeedback, FakeTranscriber, FakeMic, until, tick } from './helpers.js';

function makeController({ runtime, gpu = gpuOk, transcriber = new FakeTranscriber(), mic = () => new FakeMic(), settings, connection = null } = {}) {
  const store = new Store({ local: new MemoryStorage(), session: new MemoryStorage() });
  // Tests play as a player who already agreed to the download unless they say otherwise.
  store.saveSettings({ modelsConsent: true, ...(settings ?? {}) });
  const coach = new Coach({ runtime: runtime ?? fakeRuntime(), gpuDetector: gpu });
  const ctl = new Controller({ store, coach, transcriber, micFactory: mic, rng: makeRng(11), connection });
  return { ctl, store, coach };
}

describe('coach lifecycle', () => {
  test('loads once even when asked many times', async () => {
    const rt = fakeRuntime();
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await Promise.all([coach.load(), coach.load(), coach.load()]);
    assert.equal(rt.loads, 1);
    assert.equal(coach.status, 'ready');
    assert.equal(coach.loadedModelId, COACH_MODELS['qwen2.5-1.5b'].ids.f16);
  });
  test('picks the f32 build when the GPU lacks shader-f16', async () => {
    const coach = new Coach({ runtime: fakeRuntime(), gpuDetector: async () => ({ ok: true, f16: false }) });
    await coach.load();
    assert.equal(coach.loadedModelId, COACH_MODELS['qwen2.5-1.5b'].ids.f32);
  });
  test('reports unsupported when WebGPU is missing', async () => {
    const coach = new Coach({ runtime: fakeRuntime(), gpuDetector: gpuMissing });
    await assert.rejects(coach.load(), (e) => e.code === 'webgpu');
    assert.equal(coach.status, 'unsupported');
  });
  test('classifies load failures and can recover', async () => {
    let fail = true;
    const rt = fakeRuntime();
    rt.load = async () => {
      if (fail) throw new Error('Failed to fetch model shard');
    };
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await assert.rejects(coach.load(), (e) => e.code === 'download');
    assert.equal(coach.status, 'error');
    fail = false;
    await coach.load();
    assert.equal(coach.status, 'ready');
  });
  test('error classification', () => {
    assert.equal(classifyError(new Error('GPUDevice was lost: out of memory')).code, 'memory');
    assert.equal(classifyError(new Error('navigator.gpu is undefined')).code, 'webgpu');
    assert.equal(classifyError(new Error('NetworkError when attempting to fetch')).code, 'download');
    assert.equal(classifyError(new Error('weird')).code, 'model');
  });
  test('generations are serialized, never concurrent', async () => {
    const rt = fakeRuntime({ delayMs: 15, responses: ['1', '2', '3'] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    const out = await Promise.all([coach.complete([]), coach.complete([]), coach.complete([])]);
    assert.deepEqual(out.map((o) => o.text), ['1', '2', '3']);
    assert.equal(rt.maxActive, 1);
  });
  test('times out, interrupts, and the next job still runs', async () => {
    let first = true;
    const rt = fakeRuntime({
      onChat: async () => {
        if (first) {
          first = false;
          await tick(80);
          return { text: 'late', finishReason: 'stop' };
        }
        return { text: 'ok', finishReason: 'stop' };
      },
    });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await assert.rejects(coach.complete([], { timeoutMs: 20 }), (e) => e.code === 'timeout');
    assert.equal(rt.interrupted, 1);
    const next = await coach.complete([]);
    assert.equal(next.text, 'ok');
    assert.equal(rt.maxActive, 1);
  });
  test('stale jobs are skipped before they start', async () => {
    const rt = fakeRuntime({ responses: ['x'] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await assert.rejects(coach.complete([], { isStale: () => true }), (e) => e.code === 'stale');
    assert.equal(rt.calls.length, 0);
  });
});

describe('evaluation service', () => {
  const scenario = deckScenario({ modeId: 'think-fast', rng: makeRng(1) });
  const transcript = 'Board members, the self-heating ice cube is the future of lukewarm drinks.';

  test('passes schema + rubric to the model and validates the result', async () => {
    const rt = fakeRuntime({ responses: [goodFeedback('think-fast')] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    const fb = await evaluateAnswer(coach, scenario, transcript);
    assert.equal(fb.scores.length, 3);
    const { opts, messages } = rt.calls[0];
    assert.ok(opts.schema.properties.scores);
    assert.ok(messages[1].content.includes(transcript));
  });
  test('retries once after malformed output', async () => {
    const rt = fakeRuntime({ responses: ['{"oops": ', goodFeedback('think-fast')] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    const fb = await evaluateAnswer(coach, scenario, transcript);
    assert.ok(fb.tryNext);
    assert.equal(rt.calls.length, 2);
  });
  test('retries after truncated output', async () => {
    const rt = fakeRuntime({ responses: [() => ({ text: '{"overall', finishReason: 'length' }), goodFeedback('think-fast')] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await evaluateAnswer(coach, scenario, transcript);
    assert.equal(rt.calls.length, 2);
  });
  test('a coach that goes silent (lost GPU) is reported as stalled and reloaded next time', async () => {
    const rt = fakeRuntime({ responses: ['', '   '] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await assert.rejects(evaluateAnswer(coach, scenario, transcript), (e) => e.code === 'stalled');
    assert.equal(coach.status, 'error', 'next attempt reloads the model');
  });

  test('fails honestly instead of inventing feedback', async () => {
    const rt = fakeRuntime({ responses: ['not json', { overall_feedback: 'hi' }] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    await assert.rejects(evaluateAnswer(coach, scenario, transcript), (e) => e.code === 'invalid-output');
  });
});

describe('scenario generation service', () => {
  test('returns a validated model scenario', async () => {
    const rt = fakeRuntime({ responses: [{ title: 'Moon market', setup: 'You sell cheese at a farmers market on the Moon and a crater just ate your stall.', ask: 'Win back your customers.', twist: '' }] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    const s = await generateScenario(coach, { modeId: 'wildcard', difficulty: 'normal', ingredients: pickIngredients(makeRng(1)), recent: [] });
    assert.equal(s.source, 'model');
    assert.equal(s.twist, null);
  });
  test('rejects unsafe or repeated generations', async () => {
    const setup = 'You sell cheese at a farmers market on the Moon and a crater just ate your stall.';
    const rt = fakeRuntime({ responses: [{ title: 'Bad', setup: 'You plan a terrorist attack on the cheese market today.', ask: 'Go.', twist: '' }, { title: 'Moon', setup, ask: 'Go now.', twist: '' }] });
    const coach = new Coach({ runtime: rt, gpuDetector: gpuOk });
    const args = { modeId: 'wildcard', difficulty: 'normal', ingredients: pickIngredients(makeRng(1)) };
    assert.equal(await generateScenario(coach, { ...args, recent: [] }), null);
    assert.equal(await generateScenario(coach, { ...args, recent: [{ key: 'x', title: 'Moon', setup }] }), null);
  });
});

describe('controller: full rounds', () => {
  test('typed answer → real (fake-runtime) evaluation → feedback → shuffle', async () => {
    const rt = fakeRuntime({ responses: [goodFeedback('think-fast', 'banana')] });
    const { ctl, store } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('think-fast');
    await ctl.wakeCoach();
    const first = ctl.state.scenario;
    ctl.edit('I would like to return this banana phone.');
    await ctl.submit();
    assert.equal(ctl.state.phase, 'feedback');
    assert.equal(ctl.state.feedback.strongest.quote, 'banana');
    assert.equal(store.getStats().rounds, 1);
    ctl.shuffle();
    assert.equal(ctl.state.phase, 'ready');
    assert.notEqual(ctl.state.scenario.id, first.id);
    assert.equal(ctl.state.feedback, null);
  });

  test('shows the coach gate instead of evaluating when the model is not loaded', async () => {
    const { ctl } = makeController();
    ctl.startGame('yes-and');
    ctl.edit('Yes, and the cups are warm because we left them here in 2031.');
    await ctl.submit();
    assert.equal(ctl.state.phase, 'review', 'nothing sent anywhere yet');
    assert.equal(ctl.gate, true);
    assert.equal(ctl.state.transcript.startsWith('Yes, and'), true, 'answer preserved');
  });

  test('wake-then-submit sends the waiting answer once the coach loads', async () => {
    const rt = fakeRuntime({ responses: [goodFeedback('yes-and', 'cups are warm')] });
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('yes-and');
    ctl.edit('Yes, and the cups are warm because we left them here in 2031.');
    await ctl.submit();
    await ctl.wakeCoach({ thenSubmit: true });
    await until(() => ctl.state.phase === 'feedback');
    assert.equal(rt.calls.length, 1);
  });

  test('shuffling during evaluation discards the stale result', async () => {
    let release;
    const rt = fakeRuntime({
      onChat: () => new Promise((r) => (release = () => r({ text: JSON.stringify(goodFeedback('think-fast')), finishReason: 'stop' }))),
    });
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('think-fast');
    await ctl.wakeCoach();
    ctl.edit('An answer for the first card.');
    const pending = ctl.submit();
    await until(() => typeof release === 'function');
    ctl.shuffle();
    const newToken = ctl.state.token;
    release();
    await pending;
    assert.equal(ctl.state.phase, 'ready');
    assert.equal(ctl.state.feedback, null, 'old feedback did not leak into the new round');
    assert.equal(ctl.state.token, newToken);
  });

  test('evaluation failure keeps the transcript and offers retry', async () => {
    const rt = fakeRuntime({ responses: ['garbage', 'more garbage', goodFeedback('pressure')] });
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('pressure');
    await ctl.wakeCoach();
    ctl.edit('Ha, that voice note was a dramatic reading exercise. Interesting, right?');
    await ctl.submit();
    assert.equal(ctl.state.phase, 'review');
    assert.equal(ctl.state.error.code, 'invalid-output');
    assert.ok(ctl.state.transcript.includes('voice note'));
    await ctl.submit(); // retry
    assert.equal(ctl.state.phase, 'feedback');
  });

  test('double submit only evaluates once', async () => {
    const rt = fakeRuntime({ responses: [goodFeedback('story')], delayMs: 20 });
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('story');
    await ctl.wakeCoach();
    ctl.edit('The door knocked twice, then slid a note underneath.');
    await Promise.all([ctl.submit(), ctl.submit(), ctl.submit()]);
    assert.equal(rt.calls.length, 1);
  });

  test('empty answers are rejected before reaching the model', async () => {
    const rt = fakeRuntime();
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck' } });
    ctl.startGame('story');
    await ctl.wakeCoach();
    ctl.edit('   ');
    await ctl.submit();
    assert.equal(rt.calls.length, 0);
  });
});

describe('controller: speech handoff', () => {
  test('mic → local transcription → editable answer → evaluation', async () => {
    const tr = new FakeTranscriber(['  The pigeons demand bread.  ']);
    const mic = new FakeMic();
    const rt = fakeRuntime({ responses: [goodFeedback('wildcard', 'pigeons demand bread')] });
    const { ctl } = makeController({ runtime: rt, transcriber: tr, mic: () => mic, settings: { scenarioSource: 'deck', livePreview: false } });
    ctl.startGame('wildcard');
    await ctl.toggleMic();
    assert.equal(ctl.state.phase, 'recording');
    await ctl.toggleMic();
    assert.equal(mic.stopped, true, 'microphone released');
    assert.equal(ctl.state.phase, 'review');
    assert.equal(ctl.state.transcript, 'The pigeons demand bread.');
    assert.deepEqual(tr.received, [32000]);
    ctl.edit('The pigeons demand bread. And dental.');
    await ctl.wakeCoach();
    await ctl.submit();
    assert.equal(ctl.state.phase, 'feedback');
    assert.ok(rt.calls[0].messages[1].content.includes('And dental.'), 'edited text is what gets evaluated');
  });

  test('Finish sends the transcript straight to the coach', async () => {
    const tr = new FakeTranscriber(['Ladies and gentlemen, the self-heating ice cube.']);
    const rt = fakeRuntime({ responses: [goodFeedback('think-fast')] });
    const { ctl } = makeController({ runtime: rt, transcriber: tr, settings: { scenarioSource: 'deck', livePreview: false } });
    ctl.startGame('think-fast');
    await ctl.wakeCoach();
    await ctl.toggleMic();
    await ctl.stopRecording();
    assert.equal(ctl.state.phase, 'feedback', 'no extra click needed');
    assert.equal(ctl.state.submitted, 'Ladies and gentlemen, the self-heating ice cube.');
    assert.equal(rt.calls.length, 1);
  });

  test('Finish with an asleep coach asks to wake it, then sends automatically', async () => {
    const tr = new FakeTranscriber(['Yes, and the cups are warm.']);
    const rt = fakeRuntime({ responses: [goodFeedback('yes-and', 'cups are warm')] });
    const { ctl } = makeController({ runtime: rt, transcriber: tr, settings: { scenarioSource: 'deck', livePreview: false } });
    ctl.startGame('yes-and');
    await ctl.toggleMic();
    await ctl.stopRecording();
    assert.equal(ctl.state.phase, 'review');
    assert.equal(ctl.gate, true);
    await ctl.wakeCoach({ thenSubmit: true });
    await until(() => ctl.state.phase === 'feedback');
  });

  test('with "check my transcript" on, Finish stops at the transcript', async () => {
    const tr = new FakeTranscriber(['Hello moon.']);
    const rt = fakeRuntime();
    const { ctl } = makeController({ runtime: rt, transcriber: tr, settings: { scenarioSource: 'deck', livePreview: false, reviewBeforeSend: true } });
    ctl.startGame();
    await ctl.wakeCoach();
    await ctl.toggleMic();
    await ctl.stopRecording();
    assert.equal(ctl.state.phase, 'review');
    assert.equal(ctl.state.transcript, 'Hello moon.');
    assert.equal(rt.calls.length, 0);
  });

  test('input mode switches between voice and typing only when idle', async () => {
    const { ctl } = makeController({ settings: { livePreview: false } });
    ctl.startGame();
    ctl.setInputMode('type');
    assert.equal(ctl.inputMode, 'type');
    ctl.setInputMode('voice');
    await ctl.toggleMic();
    ctl.setInputMode('type');
    assert.equal(ctl.inputMode, 'voice', 'cannot switch mid-recording');
    await ctl.cancelRecording();
  });

  test('silence is caught before transcription', async () => {
    const tr = new FakeTranscriber(['should not be used']);
    const { ctl } = makeController({ transcriber: tr, mic: () => new FakeMic({ peak: 0.001 }), settings: { livePreview: false } });
    ctl.startGame();
    await ctl.toggleMic();
    await ctl.toggleMic();
    assert.equal(ctl.state.error.code, 'silent');
    assert.equal(tr.received.length, 0);
  });

  test('microphone denial shows a recoverable error and typing still works', async () => {
    const { ctl } = makeController({ mic: () => new FakeMic({ startError: new CaptureError('denied', 'nope') }) });
    ctl.startGame();
    await ctl.toggleMic();
    assert.equal(ctl.state.phase, 'ready');
    assert.equal(ctl.state.error.code, 'denied');
    ctl.edit('Typed instead.');
    assert.equal(ctl.state.phase, 'review');
  });

  test('transcription failure and empty transcripts are reported', async () => {
    const tr = new FakeTranscriber([new Error('wasm crashed'), '[BLANK_AUDIO]']);
    const { ctl } = makeController({ transcriber: tr, settings: { livePreview: false } });
    ctl.startGame();
    await ctl.toggleMic();
    await ctl.toggleMic();
    assert.equal(ctl.state.error.code, 'transcribe-failed');
    await ctl.toggleMic();
    await ctl.toggleMic();
    assert.equal(ctl.state.error.code, 'empty-transcript');
  });

  test('leaving mid-recording cancels capture', async () => {
    const mic = new FakeMic();
    const { ctl } = makeController({ mic: () => mic, settings: { livePreview: false } });
    ctl.startGame();
    await ctl.toggleMic();
    await ctl.goHome();
    assert.equal(mic.cancelled, true);
    assert.equal(ctl.state.phase, 'ready');
  });

  test('challenge timer stops recording automatically', async () => {
    const mic = new FakeMic();
    const tr = new FakeTranscriber(['Quick answer.']);
    const { ctl } = makeController({ mic: () => mic, transcriber: tr, settings: { timer: true, livePreview: false } });
    ctl.startGame('think-fast');
    await ctl.toggleMic();
    ctl.timer.seconds = 0.3; // shorten for the test
    await until(() => ctl.state.phase === 'review', { timeout: 3000 });
    assert.equal(mic.stopped, true);
  });
});

describe('controller: scenarios, persistence, settings', () => {
  test('shuffle avoids repeats across a session', () => {
    const { ctl } = makeController({ settings: { scenarioSource: 'deck' } });
    ctl.startGame('pressure');
    const keys = new Set([ctl.state.scenario.setup]);
    for (let i = 0; i < 5; i++) {
      ctl.shuffle();
      keys.add(ctl.state.scenario.setup);
    }
    assert.equal(keys.size, 6);
  });

  test('uses a coach-written scenario when one was prefetched', async () => {
    const generated = { title: 'Moon market', setup: 'You sell cheese at a farmers market on the Moon and a crater just ate your stall.', ask: 'Win back your customers.', twist: '' };
    const rt = fakeRuntime({ responses: [generated] });
    const { ctl } = makeController({ runtime: rt });
    ctl.startGame('wildcard');
    await ctl.wakeCoach();
    await until(() => ctl.prefetched !== null);
    ctl.shuffle();
    assert.equal(ctl.state.scenario.source, 'model');
    assert.equal(ctl.state.scenario.title, 'Moon market');
  });

  test('easier / harder keep the same situation', () => {
    const { ctl } = makeController({ settings: { scenarioSource: 'deck' } });
    ctl.startGame('story');
    const setup = ctl.state.scenario.setup;
    ctl.harder();
    assert.equal(ctl.state.scenario.setup, setup);
    assert.ok(ctl.state.scenario.twist);
    ctl.easier();
    assert.equal(ctl.state.scenario.twist, null);
  });

  test('favourites and history clear completely', async () => {
    const { ctl, store } = makeController();
    ctl.startGame();
    assert.equal(ctl.toggleFavorite(), true);
    assert.equal(store.getFavorites().length, 1);
    ctl.clearHistory();
    assert.equal(store.getFavorites().length, 0);
  });

  test('switching coach model resets it to idle and persists', async () => {
    const { ctl, store } = makeController();
    await ctl.wakeCoach();
    assert.equal(ctl.coach.status, 'ready');
    ctl.updateSettings({ coachModel: 'qwen2.5-0.5b' });
    assert.equal(ctl.coach.status, 'idle');
    assert.equal(store.getSettings().coachModel, 'qwen2.5-0.5b');
  });

  test('returning players with a cached model get the coach woken automatically', async () => {
    const rt = fakeRuntime();
    rt.cached = true;
    const { ctl } = makeController({ runtime: rt });
    ctl.startGame();
    await until(() => ctl.coach.status === 'ready');
    assert.equal(rt.loads, 1);
  });

  test('without WebGPU the game still plays and the gate explains why', async () => {
    const { ctl } = makeController({ gpu: gpuMissing });
    ctl.startGame();
    await ctl.wakeCoach();
    assert.equal(ctl.coach.status, 'unsupported');
    assert.equal(ctl.gate, true);
    ctl.shuffle();
    assert.equal(ctl.state.phase, 'ready');
  });
});

describe('controller: download consent', () => {
  test('nothing downloads before the player agrees; the setup prompt asks up front', async () => {
    const rt = fakeRuntime();
    const tr = new FakeTranscriber();
    tr.status = 'idle';
    let speechLoads = 0;
    tr.load = async () => { speechLoads += 1; };
    const { ctl } = makeController({ runtime: rt, transcriber: tr, settings: { modelsConsent: false } });
    ctl.startGame();
    await until(() => ctl.gate === true);
    assert.equal(rt.loads, 0);
    assert.equal(speechLoads, 0);
  });

  test('the mic asks first too, because voice needs the speech model', async () => {
    const tr = new FakeTranscriber();
    tr.status = 'idle';
    const mic = new FakeMic();
    const { ctl } = makeController({ transcriber: tr, mic: () => mic, settings: { modelsConsent: false } });
    ctl.startGame();
    ctl.dismissGate();
    await ctl.toggleMic();
    assert.equal(mic.started, false);
    assert.equal(ctl.gate, true);
  });

  test('agreeing downloads both models and remembers the answer', async () => {
    const rt = fakeRuntime();
    const { ctl, store } = makeController({ runtime: rt, settings: { modelsConsent: false } });
    ctl.startGame();
    await until(() => ctl.gate === true);
    await ctl.acceptDownload();
    assert.equal(ctl.coach.status, 'ready');
    assert.equal(store.getSettings().modelsConsent, true);
  });

  test('the smaller option switches to the lite coach', async () => {
    const rt = fakeRuntime();
    const { ctl, store } = makeController({ runtime: rt, settings: { modelsConsent: false } });
    ctl.startGame();
    await ctl.acceptDownload({ lite: true });
    assert.equal(store.getSettings().coachModel, 'qwen2.5-0.5b');
  });

  test('after agreeing once, later visits get ready quietly with no prompt', async () => {
    const rt = fakeRuntime();
    const { ctl } = makeController({ runtime: rt, settings: { modelsConsent: true } });
    ctl.startGame();
    await until(() => ctl.coach.status === 'ready');
    assert.equal(ctl.gate, false);
  });

  test('an already-saved coach wakes up without asking', async () => {
    const rt = fakeRuntime();
    rt.cached = true;
    const { ctl } = makeController({ runtime: rt, settings: { modelsConsent: false } });
    ctl.startGame();
    await until(() => ctl.coach.status === 'ready');
    assert.equal(ctl.gate, false);
  });

  test('an answer finished while the coach is still loading is sent when it is ready', async () => {
    const rt = fakeRuntime({ responses: [goodFeedback('think-fast')] });
    const slowLoad = rt.load;
    rt.load = async (...a) => {
      await tick(60);
      return slowLoad(...a);
    };
    const { ctl } = makeController({ runtime: rt, settings: { scenarioSource: 'deck', modelsConsent: true } });
    ctl.startGame('think-fast');
    ctl.edit('A quick answer.');
    await ctl.submit();
    assert.notEqual(ctl.coach.status, 'ready');
    assert.equal(ctl.pendingSubmitAfterWake, true, 'waits for the coach instead of prompting');
    await until(() => ctl.state.phase === 'feedback');
  });

  test('deleting the models resets consent, so nothing re-downloads silently', async () => {
    const { ctl, store } = makeController({ settings: { modelsConsent: true } });
    await ctl.deleteModelDownloads();
    assert.equal(store.getSettings().modelsConsent, false);
  });
});
