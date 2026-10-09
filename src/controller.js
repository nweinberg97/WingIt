// The game controller: owns session state, settings, and the AI/speech services.
// Views call these methods; they never touch models or the microphone directly.
import { getMode, MODES } from './modes.js';
import { deckScenario, harderVersion, easierVersion, pickIngredients } from './deck.js';
import { isRepeat } from './scenario.js';
import { initialState, transition } from './session.js';
import { validateAnswer } from './prompts.js';
import { describeError } from './errors.js';
import { feedbackToText } from './feedback.js';
import { Store, clearModelCaches } from './store.js';
import { Coach, COACH_MODELS } from './ai/coach.js';
import { evaluateAnswer, generateScenario } from './ai/services.js';
import { LocalTranscriber, TRANSCRIBE_MODELS } from './speech/transcriber.js';
import { MicCapture, CaptureError, MAX_RECORD_SECONDS } from './speech/capture.js';

const SILENCE_PEAK = 0.015;
const PREVIEW_EVERY_MS = 3000;

export class Controller {
  constructor({ store, coach, transcriber, micFactory, rng, connection } = {}) {
    this.store = store ?? new Store();
    this.settings = this.store.getSettings();
    this.coach = coach ?? new Coach();
    this.transcriber = transcriber ?? new LocalTranscriber();
    this.micFactory = micFactory ?? (() => new MicCapture());
    this.rng = rng ?? Math.random;
    this.connection = connection === undefined ? globalThis.navigator?.connection ?? null : connection;
    this.coach.setModel(this.settings.coachModel);
    this.transcriber.setModel(this.settings.transcribeModel);

    this.view = 'home';
    this.modeId = MODES[0].id;
    this.difficulty = 'normal';
    this.state = initialState();
    this.mic = null;
    this.timer = null; // { endsAt, seconds }
    this.speech = { status: this.transcriber.status, fraction: 0 };
    this.prefetched = null; // { modeId, difficulty, scenario }
    this.prefetching = false;
    this.gate = false; // show the "wake the coach" prompt
    this.inputMode = 'voice'; // voice | type
    this.warming = false; // background download about to start
    this.pendingSubmitAfterWake = false;
    this.listeners = new Set();
    this.ticker = null;
    this.previewTimer = null;

    this.coach.on(() => this.emit());
    this.transcriber.on((ev) => {
      if (ev.type === 'status') this.speech = { ...this.speech, status: ev.status };
      if (ev.type === 'progress') this.speech = { ...this.speech, fraction: ev.fraction };
      this.emit();
    });
  }

  // ---------- plumbing ----------
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(change = 'state') {
    for (const fn of this.listeners) fn(change);
  }
  dispatch(event) {
    const prev = this.state;
    this.state = transition(this.state, event);
    if (this.state !== prev) this.emit(event.type);
  }
  get mode() {
    return getMode(this.modeId);
  }

  // ---------- navigation ----------
  startGame(modeId = this.modeId) {
    this.modeId = getMode(modeId).id;
    this.view = 'game';
    if (!this.state.scenario || this.state.scenario.modeId !== this.modeId) this.nextScenario();
    this.emit('view');
    this.warmUp();
  }

  /** True on mobile data or Data Saver, where a surprise 1 GB download isn't OK. */
  isMetered() {
    const c = this.connection;
    if (!c) return false;
    return !!c.saveData || c.type === 'cellular' || ['slow-2g', '2g', '3g'].includes(c.effectiveType);
  }

  /**
   * Get the models ready in the background as soon as play starts, so nobody has to press
   * "download". Cached models just wake up. On metered connections we only wake cached ones
   * and ask before downloading anything new.
   */
  async warmUp() {
    if (this.coach.status !== 'idle' || this.warming) return;
    const auto = this.settings.autoDownload && !this.isMetered();
    this.warming = auto; // an answer submitted now should wait for this download, not prompt
    let cached = false;
    try {
      cached = await this.coach.checkCached();
    } catch {
      /* treat as not cached */
    }
    try {
      if (this.coach.status !== 'idle' || this.coach.gpuOk === false) return;
      if (auto || cached) {
        if (auto) this.transcriber.load().catch(() => {});
        const p = this.wakeCoach({ silent: true });
        this.warming = false;
        await p;
      }
    } finally {
      this.warming = false;
      this.emit('coach');
    }
  }
  async goHome() {
    await this.cancelRecording();
    this.view = 'home';
    this.emit('view');
  }

  // ---------- scenarios ----------
  setMode(modeId) {
    if (modeId === this.modeId && this.state.scenario) return;
    this.modeId = getMode(modeId).id;
    this.nextScenario();
  }

  nextScenario({ difficulty = this.difficulty } = {}) {
    this.difficulty = difficulty;
    this.abortInFlight();
    const recent = this.store.getRecent();
    let scenario = null;
    const p = this.prefetched;
    if (p && p.modeId === this.modeId && p.difficulty === difficulty && !isRepeat(p.scenario, recent)) scenario = p.scenario;
    this.prefetched = null;
    if (!scenario) {
      const recentKeys = new Set(recent.map((r) => r.key));
      const recentIngredients = new Set(recent.flatMap((r) => r.ingredients ?? []));
      scenario = deckScenario({ modeId: this.modeId, difficulty, rng: this.rng, recentKeys, recentIngredients });
    }
    this.store.pushRecent(scenario);
    this.gate = false;
    this.dispatch({ type: 'NEW_SCENARIO', scenario });
    this.prefetch();
  }

  shuffle() {
    this.nextScenario();
  }

  retry() {
    this.abortInFlight();
    this.gate = false;
    this.dispatch({ type: 'RETRY' });
  }

  harder() {
    const s = this.state.scenario;
    if (!s) return;
    this.abortInFlight();
    this.difficulty = 'spicy';
    this.dispatch({ type: 'NEW_SCENARIO', scenario: harderVersion(s, this.rng) });
  }
  easier() {
    const s = this.state.scenario;
    if (!s) return;
    this.abortInFlight();
    this.difficulty = 'easy';
    this.dispatch({ type: 'NEW_SCENARIO', scenario: easierVersion(s) });
  }

  playScenario(s) {
    this.abortInFlight();
    this.modeId = getMode(s.modeId).id;
    this.view = 'game';
    const scenario = { ...s, id: `fav-${Date.now()}`, source: s.source ?? 'favorite', ingredients: [] };
    this.dispatch({ type: 'NEW_SCENARIO', scenario });
    this.emit('view');
  }

  /** Quietly ask the coach for the next scenario while the player is busy. */
  async prefetch() {
    if (this.settings.scenarioSource !== 'auto' || this.coach.status !== 'ready' || this.prefetching) return;
    const modeId = this.modeId;
    const difficulty = this.difficulty;
    this.prefetching = true;
    try {
      const recent = this.store.getRecent();
      const ingredients = pickIngredients(this.rng, new Set(recent.flatMap((r) => r.ingredients ?? [])));
      const scenario = await generateScenario(this.coach, {
        modeId,
        difficulty,
        ingredients,
        recent,
        isStale: () => this.modeId !== modeId || this.difficulty !== difficulty || this.state.phase === 'evaluating',
      });
      if (scenario && this.modeId === modeId && this.difficulty === difficulty) this.prefetched = { modeId, difficulty, scenario };
    } catch {
      /* prefetch is best-effort; the deck always has a card */
    } finally {
      this.prefetching = false;
      this.emit('prefetch');
    }
  }

  abortInFlight() {
    if (this.state.phase === 'recording' || this.state.phase === 'transcribing') this.cancelRecording();
    if (this.state.phase === 'evaluating') this.coach.interrupt();
    this.pendingSubmitAfterWake = false;
  }

  // ---------- microphone ----------
  async toggleMic() {
    if (this.state.phase === 'recording') return this.stopRecording();
    if (!['ready', 'review'].includes(this.state.phase)) return;
    return this.startRecording();
  }

  async startRecording() {
    const token = this.state.token;
    this.mic = this.micFactory();
    try {
      await this.mic.start();
    } catch (err) {
      this.mic = null;
      const code = err instanceof CaptureError ? err.code : 'unknown';
      this.dispatch({ type: 'MIC_ERROR', error: describeError(code, err.message) });
      return;
    }
    if (token !== this.state.token) {
      await this.mic.cancel();
      this.mic = null;
      return;
    }
    this.dispatch({ type: 'RECORD_START' });
    // Warm up the speech model while the player talks (one-time download).
    this.transcriber.load().catch(() => {});
    const limit = this.settings.timer ? this.mode.challenge.seconds : MAX_RECORD_SECONDS;
    this.timer = { startedAt: Date.now(), seconds: limit, challenge: this.settings.timer };
    this.ticker = setInterval(() => {
      const elapsed = (Date.now() - this.timer.startedAt) / 1000;
      if (elapsed >= this.timer.seconds) this.stopRecording();
      else this.emit('tick');
    }, 200);
    if (this.settings.livePreview) this.previewTimer = setInterval(() => this.livePreview(token), PREVIEW_EVERY_MS);
  }

  async livePreview(token) {
    if (this.state.phase !== 'recording' || this.transcriber.status !== 'ready' || this.transcriber.busy || !this.mic) return;
    try {
      const pcm = await this.mic.snapshot();
      if (!pcm || pcm.length < 16000) return;
      const text = await this.transcriber.transcribe(pcm, { partial: true });
      if (text !== null) this.dispatch({ type: 'PARTIAL', token, text: validateAnswer(text).text ?? '' });
    } catch {
      /* preview is best-effort */
    }
  }

  stopTimers() {
    clearInterval(this.ticker);
    clearInterval(this.previewTimer);
    this.ticker = null;
    this.previewTimer = null;
  }

  async stopRecording() {
    if (this.state.phase !== 'recording' || !this.mic) return;
    this.stopTimers();
    const token = this.state.token;
    const mic = this.mic;
    this.mic = null;
    this.dispatch({ type: 'RECORD_STOP' });
    let result;
    try {
      result = await mic.stop(); // mic tracks are released here
    } catch (err) {
      this.dispatch({ type: 'TRANSCRIBE_FAILED', token, error: describeError('unsupported', err.message) });
      return;
    }
    let { pcm } = result;
    if (result.peak < SILENCE_PEAK || pcm.length < 16000 * 0.4) {
      pcm = null;
      this.dispatch({ type: 'TRANSCRIBE_FAILED', token, error: describeError('silent') });
      return;
    }
    try {
      const text = await this.transcriber.transcribe(pcm); // buffer is transferred to the worker and detached here
      pcm = null;
      const v = validateAnswer(text ?? '');
      if (!v.ok && v.error === 'empty') {
        this.dispatch({ type: 'TRANSCRIBE_FAILED', token, error: describeError('empty-transcript') });
      } else {
        this.dispatch({ type: 'TRANSCRIBED', token, text: v.text });
        // Finish → straight to the coach, unless the player wants to check the transcript first.
        if (!this.settings.reviewBeforeSend && this.state.token === token && this.state.phase === 'review') await this.submit();
      }
    } catch (err) {
      pcm = null;
      const code = /fetch|network|download|404|403/i.test(err.message) ? 'transcribe-download' : 'transcribe-failed';
      this.dispatch({ type: 'TRANSCRIBE_FAILED', token, error: describeError(code, err.message) });
    }
  }

  async cancelRecording() {
    this.stopTimers();
    const mic = this.mic;
    this.mic = null;
    if (mic) await mic.cancel();
    this.dispatch({ type: 'RECORD_CANCEL' });
  }

  timeLeft() {
    if (!this.timer || this.state.phase !== 'recording') return null;
    const elapsed = (Date.now() - this.timer.startedAt) / 1000;
    return { elapsed, left: Math.max(0, this.timer.seconds - elapsed), total: this.timer.seconds, challenge: this.timer.challenge };
  }

  // ---------- answer + evaluation ----------
  setInputMode(mode) {
    if (!['voice', 'type'].includes(mode) || !['ready', 'review'].includes(this.state.phase)) return;
    this.inputMode = mode;
    this.emit('inputMode');
  }

  edit(text) {
    this.dispatch({ type: 'EDIT', text });
  }

  async submit() {
    if (this.state.phase !== 'review') return;
    const v = validateAnswer(this.state.transcript);
    if (!v.ok) {
      this.dispatch({ type: 'SET_ERROR', error: describeError(v.error) });
      return;
    }
    if (this.coach.status !== 'ready') {
      if (this.coach.status === 'loading' || this.warming) {
        this.pendingSubmitAfterWake = true;
      }
      this.gate = true;
      this.emit('gate');
      return;
    }
    this.gate = false;
    if (this.prefetching) this.coach.interrupt(); // the player comes first
    const token = this.state.token + 0;
    const scenario = this.state.scenario;
    this.dispatch({ type: 'SUBMIT', text: v.text });
    try {
      const feedback = await evaluateAnswer(this.coach, scenario, v.text, { isStale: () => this.state.token !== token });
      if (this.state.token !== token || this.state.phase !== 'evaluating') return;
      this.store.recordRound(scenario.modeId, feedback);
      this.dispatch({ type: 'EVALUATED', token, feedback });
      this.prefetch();
    } catch (err) {
      if (err?.code === 'stale') return;
      this.dispatch({ type: 'EVAL_FAILED', token, error: describeError(err?.code ?? 'model', err?.message) });
    }
  }

  cancelEvaluation() {
    if (this.state.phase !== 'evaluating') return;
    this.coach.interrupt();
    this.dispatch({ type: 'CANCEL_EVAL' });
  }

  async wakeCoach({ silent = false, thenSubmit = false } = {}) {
    if (thenSubmit) this.pendingSubmitAfterWake = true;
    try {
      await this.coach.load();
      this.gate = false;
      this.emit('coach');
      if (this.pendingSubmitAfterWake && this.state.phase === 'review') {
        this.pendingSubmitAfterWake = false;
        await this.submit();
      } else {
        this.prefetch();
      }
    } catch (err) {
      this.pendingSubmitAfterWake = false;
      if (!silent) this.gate = true;
      this.emit('coach');
    }
  }

  dismissError() {
    this.dispatch({ type: 'DISMISS_ERROR' });
  }
  dismissGate() {
    this.gate = false;
    this.pendingSubmitAfterWake = false;
    this.emit('gate');
  }

  // ---------- favourites, copy, history ----------
  toggleFavorite() {
    const s = this.state.scenario;
    if (!s) return false;
    const added = this.store.toggleFavorite(s);
    this.emit('favorite');
    return added;
  }
  isFavorite() {
    return this.state.scenario ? this.store.isFavorite(this.state.scenario) : false;
  }
  feedbackText() {
    const { feedback, scenario, submitted } = this.state;
    return feedback ? feedbackToText(feedback, scenario, submitted) : '';
  }

  // ---------- settings ----------
  updateSettings(patch) {
    this.settings = this.store.saveSettings(patch);
    if ('coachModel' in patch) this.coach.setModel(this.settings.coachModel);
    if ('transcribeModel' in patch) this.transcriber.setModel(this.settings.transcribeModel);
    if ('scenarioSource' in patch && patch.scenarioSource === 'deck') this.prefetched = null;
    this.emit('settings');
  }
  clearHistory() {
    this.store.clearHistory();
    this.state = { ...this.state, roundsThisSession: 0 };
    this.emit('history');
  }
  async unloadModels() {
    await this.cancelRecording();
    await this.coach.unload();
    await this.transcriber.unload();
    this.prefetched = null;
    this.emit('models');
  }
  async deleteModelDownloads() {
    await this.unloadModels();
    const n = await clearModelCaches();
    this.coach.set({ cached: false });
    this.emit('models');
    return n;
  }

  modelInfo() {
    return { coach: COACH_MODELS, speech: TRANSCRIBE_MODELS };
  }
}
