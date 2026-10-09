// The waiting pop-up is a tiny comedy show: Mic, WingIt's microphone comedian, tells dad jokes
// in two beats while the coach reads your answer. The setup types out as Mic talks; the punchline
// lands with a jump, a rimshot, confetti and laughs. It also hosts the one-time coach download prompt.
import { h, append } from './dom.js';
import { COACH_MODELS } from '../ai/coach.js';
import { TRANSCRIBE_MODELS } from '../speech/transcriber.js';
import { shuffledJokes } from './jokes.js';
import { createStageShow } from './stage-show.js';

const TYPE_MS = 28; // per character while Mic "says" the setup
const BEAT_MS = 1100; // comic pause between setup and punchline
const PUNCH_MS = 4000; // time to enjoy the punchline before the next joke
const LAND_MS = 1700; // when feedback arrives mid-joke, land the punchline, then close

export class WaitingPopup {
  constructor(ctl, ui) {
    this.ctl = ctl;
    this.ui = ui;
    this.kind = null;
    this.timer = null;
    this.jokes = shuffledJokes();
    this.jokeIdx = 0;
    this.revealed = false;
    this.el = null;
    this.box = null;
    this.prevFocus = null;
    this.closing = null;
  }

  /** Decide what (if anything) the pop-up should show for the current state. */
  kindFor() {
    const { ctl } = this;
    const s = ctl.state;
    const c = ctl.coach;
    if (s.phase === 'evaluating') return 'thinking';
    if (s.phase !== 'review' && s.phase !== 'ready') return null;
    if (ctl.pendingSubmitAfterWake && (c.status === 'loading' || ctl.warming)) return 'loading';
    if (!ctl.gate) return null;
    if (c.status === 'unsupported') return 'unsupported';
    if (c.status === 'loading' || c.status === 'ready') return null; // already agreed; keep playing
    return 'gate';
  }

  sync() {
    const kind = this.kindFor();
    if (kind === this.kind) {
      if (kind === 'loading') this.updateProgress();
      return;
    }
    const prev = this.kind;
    this.kind = kind;
    if (kind) {
      clearTimeout(this.closing);
      this.closing = null;
      this.open(kind);
    } else if (prev === 'thinking' && this.ctl.state.phase === 'feedback' && !this.revealed && !this.ui.reducedMotion()) {
      // Feedback is in, but never leave a joke hanging: land the punchline first.
      this.reveal();
      clearTimeout(this.timer);
      this.closing = setTimeout(() => this.close({ restoreFocus: false }), LAND_MS);
    } else {
      this.close({ restoreFocus: this.ctl.state.phase !== 'feedback' });
    }
  }

  open(kind) {
    if (!this.el) {
      this.prevFocus = document.activeElement;
      this.el = h('div.wait-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wait-title', onkeydown: (e) => this.onKey(e) });
      document.body.append(this.el);
      document.body.classList.add('no-scroll');
    }
    clearTimeout(this.timer);
    clearInterval(this.typer);
    this.show?.destroy();
    this.timer = null;
    const box = h('div.wait-box', { dataset: { kind, color: this.ctl.mode.color, beat: 'idle' }, tabindex: '-1' });
    this.box = box;
    if (kind === 'thinking') this.renderShow(box, 'Your coach is on it', null);
    else if (kind === 'loading') this.renderShow(box, this.ctl.coach.cached ? 'Waking your coach…' : 'Your coach is warming up…', 'progress');
    else if (kind === 'gate') this.renderGate(box);
    else this.renderUnsupported(box);
    this.el.replaceChildren(box);
    const focusTarget = box.querySelector('[data-autofocus]') ?? box;
    requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  renderShow(box, title, extra) {
    this.show = createStageShow();
    this.srSetup = h('span.sr-only');
    this.setupEl = h('p.joke-setup', { 'aria-hidden': 'true' });
    this.punchEl = h('p.joke-punch', { hidden: true });
    this.jokeBtn = h('button.btn.btn-small.joke-btn', { type: 'button', onclick: () => (this.revealed ? this.nextJoke() : this.reveal()) });
    const parts = [
      h('div.stage-frame', {}, this.show.el),
      h('h2.wait-title', { id: 'wait-title', text: title }),
      h('div.joke', { 'aria-live': 'polite' }, this.srSetup, this.setupEl, this.punchEl),
      this.jokeBtn,
    ];
    if (extra === 'progress') {
      this.bar = h('span');
      this.pct = h('p.wait-small');
      parts.push(
        h('div.progress', { role: 'progressbar', 'aria-label': 'Coach model download', 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.bar),
        this.pct,
        h('p.wait-small', { text: 'First visit only: the coach runs on your device, so it\'s still loading. Your answer goes to it the moment it\'s ready. Next time it starts in seconds.' }),
      );
    } else {
      parts.push(h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => this.ctl.cancelEvaluation() }, 'Stop and edit my answer'));
    }
    append(box, parts);
    this.showJoke();
    if (extra === 'progress') this.updateProgress();
  }

  showJoke() {
    const j = this.jokes[this.jokeIdx % this.jokes.length];
    const reduced = this.ui.reducedMotion();
    this.revealed = false;
    this.srSetup.textContent = j.setup;
    this.punchEl.textContent = j.punch;
    this.punchEl.hidden = true;
    this.jokeBtn.textContent = 'Tell me!';
    clearTimeout(this.timer);
    clearInterval(this.typer);
    if (reduced) {
      this.setupEl.textContent = j.setup;
      this.show.idle();
      this.timer = setTimeout(() => this.reveal(), BEAT_MS * 2.5);
      return;
    }
    // Type the setup out while Mic talks.
    const typeMs = Math.min(2400, j.setup.length * TYPE_MS);
    this.setupEl.textContent = '';
    this.setupEl.classList.add('typing');
    let i = 0;
    this.typer = setInterval(() => {
      i += 1;
      this.setupEl.textContent = j.setup.slice(0, i);
      if (i >= j.setup.length) {
        clearInterval(this.typer);
        this.setupEl.classList.remove('typing');
      }
    }, typeMs / j.setup.length);
    this.show.talk(typeMs + 150, reduced);
    this.timer = setTimeout(() => this.reveal(), typeMs + BEAT_MS);
  }

  reveal() {
    if (!this.punchEl || this.revealed) return;
    const j = this.jokes[this.jokeIdx % this.jokes.length];
    clearInterval(this.typer);
    this.setupEl.textContent = j.setup;
    this.setupEl.classList.remove('typing');
    this.revealed = true;
    this.punchEl.hidden = false;
    this.jokeBtn.textContent = 'Another one';
    this.show.punch(this.ui.reducedMotion());
    if (this.box) this.box.dataset.beat = 'punch';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.nextJoke(), PUNCH_MS);
  }

  nextJoke() {
    this.jokeIdx += 1;
    if (this.box) this.box.dataset.beat = 'setup';
    this.show?.idle();
    if (this.setupEl) this.showJoke();
  }

  renderGate(box) {
    const { ctl } = this;
    const c = ctl.coach;
    const std = COACH_MODELS['qwen2.5-1.5b'];
    const lite = COACH_MODELS['qwen2.5-0.5b'];
    const speechMB = TRANSCRIBE_MODELS[ctl.settings.transcribeModel]?.sizeMB ?? 77;
    const gb = (coachGB) => (coachGB + speechMB / 1000).toFixed(1);
    this.show = createStageShow();
    if (c.cached) {
      append(box, [
        h('div.stage-frame', {}, this.show.el),
        h('h2.wait-title', { id: 'wait-title', text: 'Wake up your coach' }),
        h('p.wait-text', { text: 'Your coach is already saved in this browser. Waking it takes a few seconds, with no new download.' }),
        c.status === 'error' && c.error ? h('p.wait-error', { text: c.error.message }) : null,
        h('div.wait-actions', {},
          h('button.btn.btn-primary', { type: 'button', id: 'wake-btn', dataset: { autofocus: '' }, onclick: () => ctl.acceptDownload() }, 'Wake the coach'),
          h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.dismissGate() }, 'Not now')),
      ]);
      return;
    }
    append(box, [
      h('div.stage-frame', {}, this.show.el),
      h('h2.wait-title', { id: 'wait-title', text: 'One-time setup' }),
      h('p.wait-text', { text: 'WingIt listens and gives feedback using open AI models that run privately on your device. Nothing you say is sent anywhere.' }),
      h('ul.setup-facts', {},
        h('li', { text: `Your browser saves them once, about ${gb(std.approxDownloadGB)} GB, like a game download. Later visits start in seconds, even offline.` }),
        h('li', { text: 'They\'re stored only in this browser, never installed on your computer. Delete them anytime in Settings.' }),
        ctl.isMetered() ? h('li.setup-warn', { text: 'You seem to be on mobile data or Data Saver. Wi-Fi is a good idea for this.' }) : null),
      c.status === 'error' && c.error ? h('p.wait-error', { text: c.error.message }) : null,
      h(
        'div.wait-actions',
        {},
        h('button.btn.btn-primary', { type: 'button', id: 'wake-btn', dataset: { autofocus: '' }, onclick: () => ctl.acceptDownload() }, `Download (about ${gb(std.approxDownloadGB)} GB)`),
        h('button.btn.btn-small', { type: 'button', id: 'lite-btn', onclick: () => ctl.acceptDownload({ lite: true }) }, `Smaller download (about ${gb(lite.approxDownloadGB)} GB, simpler feedback)`),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.dismissGate() }, 'Not now'),
      ),
      h('button.link-btn.safety-link', { type: 'button', onclick: () => this.ui.openSafety() }, 'Is this safe? See how every file is checked'),
    ]);
  }

  renderUnsupported(box) {
    append(box, [
      h('h2.wait-title', { id: 'wait-title', text: 'This browser can\'t run the coach' }),
      h('p.wait-text', { text: 'The coach needs WebGPU: use a recent Chrome or Edge on desktop, Chrome on Android, or Safari 26 or newer. Your transcript is saved below, and you can keep practising out loud with new prompts.' }),
      h('div.wait-actions', {}, h('button.btn.btn-primary', { type: 'button', dataset: { autofocus: '' }, onclick: () => this.ctl.dismissGate() }, 'Got it')),
    ]);
  }

  updateProgress() {
    if (!this.bar) return;
    const p = Math.round((this.ctl.coach.progress || 0) * 100);
    this.bar.style.width = `${p}%`;
    this.bar.parentElement?.setAttribute('aria-valuenow', String(p));
    this.pct.textContent = `${p}%`;
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.kind === 'thinking') this.ctl.cancelEvaluation();
      else if (this.kind === 'gate' || this.kind === 'unsupported') this.ctl.dismissGate();
    }
    if (e.key === 'Tab') {
      const items = [...this.el.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !this.el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !this.el.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  close({ restoreFocus = true } = {}) {
    clearTimeout(this.timer);
    clearInterval(this.typer);
    this.show?.destroy();
    this.show = null;
    clearTimeout(this.closing);
    this.timer = null;
    this.closing = null;
    this.setupEl = this.srSetup = this.punchEl = this.jokeBtn = this.bar = this.pct = this.box = null;
    if (this.el) {
      this.el.remove();
      this.el = null;
      document.body.classList.remove('no-scroll');
      if (restoreFocus && this.prevFocus?.isConnected) this.prevFocus.focus({ preventScroll: true });
    }
    this.jokeIdx += 1; // fresh joke next time
  }

  destroy() {
    this.kind = null;
    this.close({ restoreFocus: false });
  }
}
