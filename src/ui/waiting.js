// The waiting pop-up: a tiny stage with a sweeping spotlight and a juggler, plus rotating funny lines.
// Also hosts the one-time "download your coach" prompt so the whole hand-off happens in one place.
import { h, svg, append } from './dom.js';
import { COACH_MODELS } from '../ai/coach.js';
import { shuffledLines } from './wait-lines.js';

function stageArt() {
  return svg(
    'svg',
    { viewBox: '0 0 240 150', class: 'wait-art', 'aria-hidden': 'true' },
    // spotlight cone (sweeps)
    svg('polygon', { class: 'wa-beam', points: '120,0 70,150 170,150' }),
    // floor
    svg('rect', { class: 'wa-floor', x: 0, y: 128, width: 240, height: 22, rx: 3 }),
    // curtains
    svg('path', { class: 'wa-curtain', d: 'M0 0h46c-6 40 4 90 -12 150H0z' }),
    svg('path', { class: 'wa-curtain', d: 'M240 0h-46c6 40 -4 90 12 150H240z' }),
    // mic stand
    svg('line', { class: 'wa-stand', x1: 120, y1: 128, x2: 120, y2: 82 }),
    svg('line', { class: 'wa-stand', x1: 106, y1: 128, x2: 134, y2: 128 }),
    svg('rect', { class: 'wa-mic', x: 113, y: 62, width: 14, height: 24, rx: 7 }),
    // juggling balls
    svg('circle', { class: 'wa-ball b1', cx: 120, cy: 50, r: 7 }),
    svg('circle', { class: 'wa-ball b2', cx: 120, cy: 50, r: 7 }),
    svg('circle', { class: 'wa-ball b3', cx: 120, cy: 50, r: 7 }),
  );
}

export class WaitingPopup {
  constructor(ctl, ui) {
    this.ctl = ctl;
    this.ui = ui;
    this.kind = null;
    this.timer = null;
    this.lines = shuffledLines();
    this.lineIdx = 0;
    this.el = null;
    this.prevFocus = null;
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
    if (kind !== this.kind) {
      this.kind = kind;
      if (!kind) this.close();
      else this.open(kind);
    } else if (kind === 'loading') {
      this.updateProgress();
    }
  }

  open(kind) {
    const mounted = !!this.el;
    if (!mounted) {
      this.prevFocus = document.activeElement;
      this.el = h('div.wait-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wait-title', onkeydown: (e) => this.onKey(e) });
      document.body.append(this.el);
      document.body.classList.add('no-scroll');
    }
    clearInterval(this.timer);
    this.timer = null;
    const box = h('div.wait-box', { dataset: { kind, color: this.ctl.mode.color } });
    if (kind === 'thinking') this.renderThinking(box);
    else if (kind === 'loading') this.renderLoading(box);
    else if (kind === 'gate') this.renderGate(box);
    else this.renderUnsupported(box);
    this.el.replaceChildren(box);
    const focusTarget = box.querySelector('[data-autofocus]') ?? box;
    box.tabIndex = -1;
    requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  renderThinking(box) {
    this.line = h('p.wait-line', { 'aria-live': 'polite' });
    this.nextLine();
    this.timer = setInterval(() => this.nextLine(), 2400);
    box.append(
      stageArt(),
      h('h2.wait-title', { id: 'wait-title', text: 'Your coach is on it' }),
      this.line,
      h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => this.ctl.cancelEvaluation() }, 'Stop and edit my answer'),
    );
  }

  renderLoading(box) {
    const c = this.ctl.coach;
    this.line = h('p.wait-line', { 'aria-live': 'off' });
    this.bar = h('span');
    this.pct = h('p.wait-small');
    this.nextLine();
    this.timer = setInterval(() => this.nextLine(), 2600);
    box.append(
      stageArt(),
      h('h2.wait-title', { id: 'wait-title', text: c.cached ? 'Waking your coach…' : 'Bringing your coach on stage…' }),
      this.line,
      h('div.progress', { role: 'progressbar', 'aria-label': 'Coach model download', 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.bar),
      this.pct,
      h('p.wait-small', { text: 'One-time setup. After this it starts in seconds, even offline. Your answer is waiting and goes to the coach as soon as it\'s ready.' }),
    );
    this.updateProgress();
  }

  renderGate(box) {
    const c = this.ctl.coach;
    const m = COACH_MODELS[c.modelKey];
    append(box, [
      stageArt(),
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
    box.append(
      h('h2.wait-title', { id: 'wait-title', text: 'This browser can\'t run the coach' }),
      h('p.wait-text', { text: 'The coach needs WebGPU: use a recent Chrome or Edge on desktop, Chrome on Android, or Safari 26 or newer. Your transcript is saved below, and you can keep practising out loud with new cards.' }),
      h('div.wait-actions', {}, h('button.btn.btn-primary', { type: 'button', dataset: { autofocus: '' }, onclick: () => this.ctl.dismissGate() }, 'Got it')),
    );
  }

  updateProgress() {
    if (!this.bar) return;
    const p = Math.round((this.ctl.coach.progress || 0) * 100);
    this.bar.style.width = `${p}%`;
    this.bar.parentElement?.setAttribute('aria-valuenow', String(p));
    this.pct.textContent = `${p}%`;
  }

  nextLine() {
    if (!this.line) return;
    this.line.textContent = this.lines[this.lineIdx % this.lines.length];
    this.lineIdx += 1;
  }

  onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.kind === 'thinking') this.ctl.cancelEvaluation();
      else if (this.kind === 'gate' || this.kind === 'unsupported') this.ctl.dismissGate();
    }
    if (e.key === 'Tab') {
      const items = [...this.el.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  close() {
    clearInterval(this.timer);
    this.timer = null;
    this.line = null;
    this.bar = null;
    if (this.el) {
      this.el.remove();
      this.el = null;
      document.body.classList.remove('no-scroll');
      if (this.prevFocus?.isConnected) this.prevFocus.focus({ preventScroll: true });
    }
  }

  destroy() {
    this.kind = null;
    this.close();
  }
}

