import { h, icon, wingMark, clear, announce } from './dom.js';
import { BRAND } from '../brand.js';
import { MODES } from '../modes.js';
import { COACH_MODELS } from '../ai/coach.js';
import { TRANSCRIPT_MAX } from '../prompts.js';
import { cueCard } from './card.js';
import { renderFeedback } from './feedback-view.js';

const PHASE_STATUS = {
  ready: 'Mic is off. Tap it when you\'re ready.',
  recording: 'Listening… tap stop when you\'re done.',
  transcribing: 'Turning your speech into text on this device…',
  review: 'Check your answer, edit if you like, then get feedback.',
  evaluating: 'Your coach is reading your answer…',
  feedback: 'Notes are in.',
};

export class GameView {
  constructor(ctl, ui) {
    this.ctl = ctl;
    this.ui = ui;
    this.renderedToken = -1;
    this.feedbackToken = -1;
    this.raf = null;
    this.root = this.build();
  }

  build() {
    const ctl = this.ctl;
    this.modeButtons = new Map();
    const tabs = h(
      'div.mode-tabs',
      { role: 'group', 'aria-label': 'Game mode' },
      MODES.map((m) => {
        const b = h(
          'button.mode-tab',
          { type: 'button', dataset: { color: m.color }, onclick: () => ctl.setMode(m.id), 'aria-pressed': 'false' },
          icon(m.glyph, { size: 16 }),
          h('span', { text: m.name }),
        );
        this.modeButtons.set(m.id, b);
        return b;
      }),
    );

    this.coachChip = h('button.coach-chip', { type: 'button', onclick: () => this.onCoachChip() });
    const top = h(
      'header.topbar',
      {},
      h('button.brand.brand-btn', { type: 'button', onclick: () => ctl.goHome(), 'aria-label': `${BRAND.name} home` }, wingMark(30), h('span.wordmark', { text: BRAND.name })),
      h(
        'div.top-actions',
        {},
        this.coachChip,
        h('button.icon-btn', { type: 'button', onclick: () => this.ui.openHistory(), 'aria-label': 'Your rounds and favourites' }, icon('heart')),
        h('button.icon-btn', { type: 'button', onclick: () => this.ui.openSettings(), 'aria-label': 'Settings' }, icon('gear')),
      ),
    );

    this.cardSlot = h('div.card-slot', { 'aria-live': 'polite' });
    this.roundCount = h('span.round-count');
    this.timerToggle = h('button.chip-btn', { type: 'button', onclick: () => ctl.updateSettings({ timer: !ctl.settings.timer }), 'aria-pressed': 'false' }, h('span.timer-label'));
    const cardTools = h(
      'div.card-tools',
      {},
      h('button.btn.btn-shuffle', { type: 'button', onclick: () => ctl.shuffle(), id: 'shuffle-btn' }, icon('shuffle'), 'Shuffle'),
      h('button.chip-btn', { type: 'button', onclick: () => ctl.easier(), 'aria-label': 'Make this scenario easier' }, icon('down', { size: 16 }), 'Easier'),
      h('button.chip-btn', { type: 'button', onclick: () => ctl.harder(), 'aria-label': 'Make this scenario harder' }, icon('up', { size: 16 }), 'Harder'),
      this.timerToggle,
      this.roundCount,
    );

    // --- answer dock ---
    this.micBtn = h('button.mic-btn', { type: 'button', onclick: () => ctl.toggleMic(), id: 'mic-btn' });
    this.meter = h('div.meter', { 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => h('span')));
    this.timerText = h('span.timer-text', { 'aria-hidden': 'true' });
    this.statusText = h('p.dock-status', { id: 'dock-status' });
    this.speechProgress = h('p.speech-progress');
    this.preview = h('p.live-preview', { 'aria-live': 'off' });
    this.textarea = h('textarea.answer', {
      id: 'answer',
      rows: 4,
      maxlength: TRANSCRIPT_MAX,
      placeholder: 'Tap the mic and talk, or type your answer here.',
      'aria-describedby': 'dock-status privacy-note',
      oninput: (e) => ctl.edit(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          ctl.submit();
        }
      },
    });
    this.submitBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => ctl.submit(), id: 'submit-btn' }, 'Get feedback');
    this.cancelBtn = h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.cancelRecording() }, 'Discard recording');
    this.cancelEvalBtn = h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.cancelEvaluation() }, 'Stop coach');
    this.clearBtn = h('button.btn.btn-ghost', { type: 'button', onclick: () => { ctl.edit(''); this.textarea.value = ''; this.textarea.focus(); } }, 'Clear');
    this.errorSlot = h('div.error-slot');
    this.gateSlot = h('div.gate-slot');
    this.thinking = h('div.thinking', { hidden: true }, h('span.dots', {}, h('i'), h('i'), h('i')), h('span', { text: 'Your coach is reading your answer' }));

    const dock = h(
      'section.dock',
      { 'aria-label': 'Your answer' },
      h(
        'div.mic-row',
        {},
        this.micBtn,
        h('div.mic-info', {}, this.statusText, h('div.mic-live', {}, this.meter, this.timerText), this.speechProgress),
      ),
      this.preview,
      h('label.answer-label', { for: 'answer', text: 'Your answer' }),
      this.textarea,
      this.errorSlot,
      this.gateSlot,
      this.thinking,
      h('div.dock-actions', {}, this.submitBtn, this.cancelEvalBtn, this.cancelBtn, this.clearBtn),
      h('p.privacy-note', { id: 'privacy-note' }, icon('lock', { size: 14 }), 'Audio stays on this device and is discarded after transcription. Only the text goes to the coach, which also runs in your browser.'),
    );

    this.feedbackSlot = h('section.feedback-slot', { 'aria-label': 'Coach feedback', tabindex: '-1' });

    return h(
      'main.game',
      { id: 'main' },
      top,
      h('nav.mode-nav', { 'aria-label': 'Modes' }, tabs),
      h('div.stage', {}, h('div.stage-left', {}, this.cardSlot, cardTools), h('div.stage-right', {}, dock)),
      this.feedbackSlot,
    );
  }

  onCoachChip() {
    const c = this.ctl.coach;
    if (c.status === 'idle' || c.status === 'error') {
      this.ctl.gate = true;
      this.ctl.emit('gate');
      this.gateSlot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else this.ui.openSettings();
  }

  update(change) {
    const { ctl } = this;
    const s = ctl.state;
    if (change === 'tick') return this.updateTimer();

    for (const [id, b] of this.modeButtons) b.setAttribute('aria-pressed', id === ctl.modeId ? 'true' : 'false');
    this.root.dataset.color = ctl.mode.color;
    this.root.dataset.phase = s.phase;

    // Card
    if (s.scenario && (this.renderedToken !== s.token || change === 'favorite')) {
      const isNewCard = this.renderedScenarioId !== s.scenario.id;
      const card = cueCard(s.scenario, { favorite: ctl.isFavorite(), onFavorite: () => {
        const added = ctl.toggleFavorite();
        announce(added ? 'Saved to favourites' : 'Removed from favourites');
      } });
      if (isNewCard && change !== 'favorite') card.classList.add('deal-in');
      this.cardSlot.replaceChildren(card);
      this.renderedScenarioId = s.scenario.id;
      this.renderedToken = s.token;
      if (isNewCard && change === 'NEW_SCENARIO') announce(`New scenario: ${s.scenario.title}. ${s.scenario.setup} ${s.scenario.ask}`);
    }
    const rounds = s.roundsThisSession;
    this.roundCount.textContent = rounds ? `${rounds} round${rounds === 1 ? '' : 's'} this session` : '';
    this.timerToggle.setAttribute('aria-pressed', ctl.settings.timer ? 'true' : 'false');
    this.timerToggle.querySelector('.timer-label').textContent = ctl.settings.timer ? `Timer: ${ctl.mode.challenge.seconds}s` : 'Timer: off';

    // Mic button + status
    const recording = s.phase === 'recording';
    const busy = s.phase === 'transcribing' || s.phase === 'evaluating';
    clear(this.micBtn).append(icon(recording ? 'stop' : 'mic', { size: 34 }));
    this.micBtn.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording');
    this.micBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
    this.micBtn.disabled = busy || s.phase === 'feedback';
    this.micBtn.dataset.state = s.phase;
    this.statusText.textContent = PHASE_STATUS[s.phase];
    this.preview.textContent = recording && s.preview ? s.preview : '';
    this.preview.hidden = !(recording && s.preview);

    const sp = ctl.speech;
    if ((recording || s.phase === 'transcribing') && sp.status === 'loading') {
      this.speechProgress.textContent = `Downloading the speech model (one time): ${Math.round((sp.fraction || 0) * 100)}%`;
      this.speechProgress.hidden = false;
    } else this.speechProgress.hidden = true;

    // Textarea
    const editable = s.phase === 'ready' || s.phase === 'review';
    this.textarea.readOnly = !editable;
    if (change !== 'EDIT' && this.textarea.value !== s.transcript) this.textarea.value = s.transcript;
    if (change === 'TRANSCRIBED') {
      this.textarea.focus();
      announce(`Transcribed: ${s.transcript}`);
    }

    this.submitBtn.hidden = !(s.phase === 'ready' || s.phase === 'review');
    this.submitBtn.disabled = s.phase !== 'review';
    this.cancelBtn.hidden = !recording;
    this.cancelEvalBtn.hidden = s.phase !== 'evaluating';
    this.clearBtn.hidden = s.phase !== 'review';
    this.thinking.hidden = s.phase !== 'evaluating';
    if (change === 'SUBMIT') announce('Your coach is reading your answer.');

    const c = ctl.coach;
    const chipText = {
      idle: c.cached ? 'Coach asleep' : 'Set up coach',
      loading: `Coach ${Math.round((c.progress || 0) * 100)}%`,
      ready: 'Coach ready',
      unsupported: 'Coach unavailable',
      error: 'Coach error',
    }[c.status];
    this.coachChip.dataset.status = c.status;
    this.coachChip.textContent = chipText;
    this.coachChip.setAttribute('aria-label', `AI coach: ${chipText}`);

    this.renderError(s.error);
    this.renderGate();
    this.renderFeedbackSlot(change);

    if (recording) this.startMeter();
    else this.stopMeter();
    this.updateTimer();
  }

  renderError(err) {
    if (!err) {
      this.errorSlot.replaceChildren();
      this.lastErr = null;
      return;
    }
    if (this.lastErr === err) return;
    this.lastErr = err;
    const box = h(
      'div.alert',
      { role: 'alert' },
      h('p.alert-title', { text: err.title }),
      h('p.alert-body', { text: err.body }),
      h(
        'div.alert-actions',
        {},
        ['timeout', 'invalid-output', 'model', 'download', 'memory'].includes(err.code) && this.ctl.state.phase === 'review'
          ? h('button.btn.btn-small', { type: 'button', onclick: () => this.ctl.submit() }, 'Try again')
          : null,
        ['transcribe-failed', 'transcribe-download', 'silent', 'empty-transcript', 'busy'].includes(err.code)
          ? h('button.btn.btn-small', { type: 'button', onclick: () => { this.ctl.dismissError(); this.ctl.toggleMic(); } }, 'Record again')
          : null,
        h('button.btn.btn-small.btn-ghost', { type: 'button', onclick: () => this.ctl.dismissError() }, 'Dismiss'),
      ),
    );
    this.errorSlot.replaceChildren(box);
  }

  renderGate() {
    const { ctl } = this;
    const c = ctl.coach;
    if (!ctl.gate || c.status === 'ready') {
      this.gateSlot.replaceChildren();
      return;
    }
    const model = COACH_MODELS[c.modelKey];
    let body;
    if (c.status === 'loading') {
      const pct = Math.round((c.progress || 0) * 100);
      body = [
        h('p.gate-title', { text: c.cached ? 'Waking your coach…' : 'Downloading your coach…' }),
        h('div.progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Coach model download' }, h('span', { style: { width: `${pct}%` } })),
        h('p.gate-small', { text: `${pct}%. ${ctl.pendingSubmitAfterWake ? 'Your answer will be sent to the coach as soon as it\'s ready.' : ''}` }),
      ];
    } else if (c.status === 'unsupported') {
      body = [
        h('p.gate-title', { text: 'Your browser can\'t run the coach' }),
        h('p', { text: 'The coach needs WebGPU. Use a recent Chrome or Edge on desktop, Chrome on Android, or Safari 26 or newer. You can keep practising out loud with the cards in the meantime.' }),
        h('div.gate-actions', {}, h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.dismissGate() }, 'Keep practising')),
      ];
    } else {
      const errText = c.status === 'error' && c.error ? `${c.error.message} ` : '';
      body = [
        h('p.gate-title', { text: c.cached ? 'Wake up your coach' : 'Meet your coach' }),
        h('p', {
          text: c.cached
            ? `${model.label} is already on this device. Waking it takes a few seconds.`
            : `Feedback comes from ${model.label} (${model.license}), an open model that runs entirely in your browser. It's a one-time download of about ${model.approxDownloadGB} GB, then it works offline. Your answers never leave this device.`,
        }),
        errText ? h('p.gate-error', { text: errText }) : null,
        h(
          'div.gate-actions',
          {},
          h('button.btn.btn-primary', { type: 'button', id: 'wake-btn', onclick: () => ctl.wakeCoach({ thenSubmit: ctl.state.phase === 'review' }) }, c.cached ? 'Wake the coach' : `Download coach (≈${model.approxDownloadGB} GB)`),
          h('button.btn.btn-ghost', { type: 'button', onclick: () => this.ui.openSettings() }, 'Choose a smaller model'),
          h('button.btn.btn-ghost', { type: 'button', onclick: () => ctl.dismissGate() }, 'Not now'),
        ),
      ];
    }
    this.gateSlot.replaceChildren(h('div.gate', { role: 'region', 'aria-label': 'AI coach setup' }, body));
  }

  renderFeedbackSlot(change) {
    const s = this.ctl.state;
    if (s.phase !== 'feedback' || !s.feedback) {
      if (this.feedbackToken !== -1) {
        this.feedbackSlot.replaceChildren();
        this.feedbackToken = -1;
      }
      return;
    }
    if (this.feedbackToken === s.token) return;
    this.feedbackToken = s.token;
    this.feedbackSlot.replaceChildren(renderFeedback(this.ctl, s));
    if (change === 'EVALUATED') {
      announce('Feedback is ready.');
      requestAnimationFrame(() => {
        this.feedbackSlot.scrollIntoView({ behavior: this.ui.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        this.feedbackSlot.focus({ preventScroll: true });
      });
    }
  }

  updateTimer() {
    const t = this.ctl.timeLeft();
    if (!t) {
      this.timerText.textContent = '';
      this.root.style.removeProperty('--timer-frac');
      return;
    }
    const secs = t.challenge ? Math.ceil(t.left) : Math.floor(t.elapsed);
    this.timerText.textContent = t.challenge ? `${secs}s left` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.root.style.setProperty('--timer-frac', String(t.challenge ? t.left / t.total : 1));
  }

  startMeter() {
    if (this.raf) return;
    const bars = [...this.meter.children];
    const loop = () => {
      const lvl = this.ctl.mic?.level?.() ?? 0;
      bars.forEach((b, i) => {
        b.style.transform = `scaleY(${Math.max(0.15, Math.min(1, lvl * (1.4 - Math.abs(i - 2) * 0.25)))})`;
      });
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stopMeter() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    for (const b of this.meter.children) b.style.transform = '';
  }
}
