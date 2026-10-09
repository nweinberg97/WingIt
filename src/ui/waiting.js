// The waiting pop-up is a tiny comedy show: two improvisers act out a scene under a sweeping
// spotlight while dad jokes play out in two beats. Every punchline gets a rimshot and a laugh from
// the audience. It also hosts the one-time "download your coach" prompt.
import { h, svg, append } from './dom.js';
import { COACH_MODELS } from '../ai/coach.js';
import { shuffledJokes } from './jokes.js';

const SETUP_MS = 2600; // time to read the setup before the punchline lands
const PUNCH_MS = 3800; // time to enjoy the punchline before the next joke
const LAND_MS = 1500; // when feedback arrives mid-joke, land the punchline, then close

function improviser(cls, x, color) {
  // A round, friendly performer: body, eyes, and two arms that act out the scene.
  return svg(
    'g',
    { class: `imp ${cls}`, transform: `translate(${x} 0)` },
    svg('g', { class: 'imp-body' },
      svg('line', { class: 'imp-arm arm-l', x1: -14, y1: 98, x2: -30, y2: 112 }),
      svg('line', { class: 'imp-arm arm-r', x1: 14, y1: 98, x2: 30, y2: 112 }),
      svg('rect', { x: -18, y: 82, width: 36, height: 44, rx: 18, fill: color, class: 'imp-torso' }),
      svg('circle', { cx: 0, cy: 70, r: 15, fill: color, class: 'imp-head' }),
      svg('circle', { cx: -5, cy: 68, r: 2.4, class: 'imp-eye' }),
      svg('circle', { cx: 5, cy: 68, r: 2.4, class: 'imp-eye' }),
      svg('path', { d: 'M-5 75 q5 5 10 0', class: 'imp-mouth' }),
    ),
  );
}

function bubble(cls, x, y, text) {
  return svg(
    'g',
    { class: `bub ${cls}`, transform: `translate(${x} ${y})` },
    svg('rect', { x: -24, y: -14, width: 48, height: 24, rx: 12, class: 'bub-box' }),
    svg('path', { d: 'M-4 10 l4 8 l4 -8z', class: 'bub-box' }),
    svg('text', { x: 0, y: 3, 'text-anchor': 'middle', class: 'bub-text' }, document.createTextNode(text)),
  );
}

export function comedyStage(modeColor = 'var(--mode)') {
  const audience = [];
  for (let i = 0; i < 9; i++) {
    const x = 18 + i * 33;
    audience.push(svg('g', { class: `fan f${i % 3}` }, svg('circle', { cx: x, cy: 178, r: 11 }), svg('rect', { x: x - 16, y: 186, width: 32, height: 20, rx: 10 })));
  }
  return svg(
    'svg',
    { viewBox: '0 0 300 200', class: 'stage-show', 'aria-hidden': 'true' },
    svg('rect', { x: 0, y: 0, width: 300, height: 200, class: 'st-bg' }),
    svg('polygon', { class: 'st-beam', points: '150,0 92,150 208,150' }),
    svg('rect', { x: 0, y: 140, width: 300, height: 60, class: 'st-floor' }),
    // the invisible-rope bit
    svg('line', { class: 'st-rope', x1: 120, y1: 108, x2: 180, y2: 108 }),
    improviser('imp-a', 110, modeColor),
    improviser('imp-b', 190, '#ffd23f'),
    bubble('bub-a', 92, 34, 'Yes!'),
    bubble('bub-b', 208, 34, '…and!'),
    bubble('bub-c', 150, 30, 'Wall?'),
    // curtains + valance
    svg('path', { class: 'st-curtain', d: 'M0 0h44c-8 50 6 100 -10 150H0z' }),
    svg('path', { class: 'st-curtain', d: 'M300 0h-44c8 50 -6 100 10 150H300z' }),
    svg('path', { class: 'st-valance', d: 'M0 0h300v14q-18 12 -37 0q-19 12 -38 0q-19 12 -37 0q-19 12 -38 0q-19 12 -37 0q-19 12 -38 0q-19 12 -37 0q-19 12 -38 0z' }),
    // drum kit for the rimshot
    svg('g', { class: 'drums' },
      svg('ellipse', { class: 'cymbal', cx: 268, cy: 118, rx: 18, ry: 4 }),
      svg('line', { class: 'cym-stand', x1: 268, y1: 120, x2: 268, y2: 150 }),
      svg('rect', { class: 'drum', x: 228, y: 128, width: 30, height: 20, rx: 4 }),
      svg('ellipse', { class: 'drum-top', cx: 243, cy: 128, rx: 15, ry: 4 }),
      svg('line', { class: 'stick', x1: 232, y1: 104, x2: 248, y2: 124 }),
      svg('text', { class: 'badum', x: 246, y: 90, 'text-anchor': 'middle' }, document.createTextNode('ba-dum-tss!')),
    ),
    // audience in the foreground
    svg('g', { class: 'crowd' }, audience,
      svg('text', { class: 'ha h1', x: 60, y: 168 }, document.createTextNode('HA!')),
      svg('text', { class: 'ha h2', x: 150, y: 164 }, document.createTextNode('HA HA')),
      svg('text', { class: 'ha h3', x: 228, y: 168 }, document.createTextNode('HA!')),
    ),
  );
}

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
    if (s.phase !== 'review') return null;
    if (ctl.pendingSubmitAfterWake && c.status === 'loading') return 'loading';
    if (ctl.gate && c.status === 'unsupported') return 'unsupported';
    if (ctl.gate && c.status !== 'ready') return c.status === 'loading' ? 'loading' : 'gate';
    return null;
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
    this.timer = null;
    const box = h('div.wait-box', { dataset: { kind, color: this.ctl.mode.color, beat: 'idle' }, tabindex: '-1' });
    this.box = box;
    if (kind === 'thinking') this.renderShow(box, 'Your coach is on it', null);
    else if (kind === 'loading') this.renderShow(box, this.ctl.coach.cached ? 'Waking your coach…' : 'Bringing your coach on stage…', 'progress');
    else if (kind === 'gate') this.renderGate(box);
    else this.renderUnsupported(box);
    this.el.replaceChildren(box);
    const focusTarget = box.querySelector('[data-autofocus]') ?? box;
    requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  renderShow(box, title, extra) {
    this.setupEl = h('p.joke-setup');
    this.punchEl = h('p.joke-punch', { hidden: true });
    this.jokeBtn = h('button.btn.btn-small.joke-btn', { type: 'button', onclick: () => (this.revealed ? this.nextJoke() : this.reveal()) });
    const parts = [
      comedyStage(),
      h('h2.wait-title', { id: 'wait-title', text: title }),
      h('div.joke', { 'aria-live': 'polite' }, this.setupEl, this.punchEl),
      this.jokeBtn,
    ];
    if (extra === 'progress') {
      this.bar = h('span');
      this.pct = h('p.wait-small');
      parts.push(
        h('div.progress', { role: 'progressbar', 'aria-label': 'Coach model download', 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.bar),
        this.pct,
        h('p.wait-small', { text: 'One-time setup. After this the coach starts in seconds, even offline. Your answer goes to it as soon as it\'s ready.' }),
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
    this.revealed = false;
    this.setupEl.textContent = j.setup;
    this.punchEl.textContent = j.punch;
    this.punchEl.hidden = true;
    this.jokeBtn.textContent = 'Tell me!';
    if (this.box) this.box.dataset.beat = 'setup';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reveal(), SETUP_MS);
  }

  reveal() {
    if (!this.punchEl || this.revealed) return;
    this.revealed = true;
    this.punchEl.hidden = false;
    this.jokeBtn.textContent = 'Another one';
    if (this.box) this.box.dataset.beat = 'punch'; // rimshot + audience laugh
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.nextJoke(), PUNCH_MS);
  }

  nextJoke() {
    this.jokeIdx += 1;
    if (this.box) this.box.dataset.beat = 'idle';
    // Restart the beat animations on the next frame.
    requestAnimationFrame(() => this.setupEl && this.showJoke());
  }

  renderGate(box) {
    const c = this.ctl.coach;
    const m = COACH_MODELS[c.modelKey];
    append(box, [
      comedyStage(),
      h('h2.wait-title', { id: 'wait-title', text: c.cached ? 'Wake up your coach' : 'One quick thing: meet your coach' }),
      h('p.wait-text', {
        text: c.cached
          ? `${m.label} is already on this device. Waking it takes a few seconds.`
          : `Feedback comes from ${m.label}, an open AI model that runs inside your browser. It's a one-time download of about ${m.approxDownloadGB} GB, then it works offline. Your answer never leaves this device.`,
      }),
      c.status === 'error' && c.error ? h('p.wait-error', { text: c.error.message }) : null,
      h(
        'div.wait-actions',
        {},
        h('button.btn.btn-primary', { type: 'button', id: 'wake-btn', dataset: { autofocus: '' }, onclick: () => this.ctl.wakeCoach({ thenSubmit: true }) }, c.cached ? 'Wake the coach' : `Download coach (≈${m.approxDownloadGB} GB)`),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => this.ui.openSettings() }, 'Pick a smaller model'),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => this.ctl.dismissGate() }, 'Not now'),
      ),
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
    clearTimeout(this.closing);
    this.timer = null;
    this.closing = null;
    this.setupEl = this.punchEl = this.jokeBtn = this.bar = this.pct = this.box = null;
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
