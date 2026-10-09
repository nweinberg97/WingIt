// Game screen: prompt card on top, voice-reactive mic underneath, transcript, waiting pop-up, feedback.
import { h, icon, wingMark, announce } from './dom.js';
import { BRAND } from '../brand.js';
import { MODES } from '../modes.js';
import { TRANSCRIPT_MAX } from '../prompts.js';
import { cueCard } from './card.js';
import { renderFeedback } from './feedback-view.js';
import { VoiceRing } from './visualizer.js';
import { WaitingPopup } from './waiting.js';

export class GameView {
  constructor(ctl, ui) {
    this.ctl = ctl;
    this.ui = ui;
    this.renderedToken = -1;
    this.feedbackToken = -1;
    this.stageKey = '';
    this.popup = new WaitingPopup(ctl, ui);
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

    this.coachChip = h('button.coach-chip', { type: 'button', onclick: () => this.ui.openSettings() });
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

    // 1. The prompt
    this.cardSlot = h('div.card-slot', { 'aria-live': 'polite' });
    this.roundCount = h('span.round-count');
    this.timerToggle = h('button.chip-btn', { type: 'button', onclick: () => ctl.updateSettings({ timer: !ctl.settings.timer }), 'aria-pressed': 'false' }, h('span.timer-label'));
    this.cardTools = h(
      'div.card-tools',
      {},
      h('button.btn.btn-shuffle', { type: 'button', onclick: () => ctl.shuffle(), id: 'shuffle-btn' }, icon('shuffle'), 'New prompt'),
      h('button.chip-btn', { type: 'button', onclick: () => ctl.easier(), 'aria-label': 'Make this prompt easier' }, icon('down', { size: 16 }), 'Easier'),
      h('button.chip-btn', { type: 'button', onclick: () => ctl.harder(), 'aria-label': 'Make this prompt harder' }, icon('up', { size: 16 }), 'Harder'),
      this.timerToggle,
      this.roundCount,
    );

    // 2. The mic stage (contents swap by phase; the canvas + mic button persist so the ring animates smoothly)
    this.canvas = h('canvas.voice-ring', { 'aria-hidden': 'true', width: 300, height: 300 });
    this.ring = new VoiceRing(this.canvas);
    this.micBtn = h('button.mic-btn', { type: 'button', id: 'mic-btn', onclick: () => this.onMicButton() });
    this.micWrap = h('div.mic-wrap', {}, this.canvas, this.micBtn);
    this.stageHeadline = h('p.stage-headline', { id: 'stage-headline' });
    this.stageSub = h('p.stage-sub');
    this.preview = h('p.live-preview', { 'aria-live': 'off', hidden: true });
    this.stageActions = h('div.stage-actions');
    this.speechProgress = h('p.speech-progress', { hidden: true });

    this.textarea = h('textarea.answer', {
      id: 'answer',
      rows: 4,
      maxlength: TRANSCRIPT_MAX,
      placeholder: 'Type your answer here…',
      'aria-label': 'Your answer',
      oninput: (e) => ctl.edit(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          ctl.submit();
        }
      },
    });
    this.composer = h('div.composer', { hidden: true }, h('p.composer-label', {}), this.textarea, h('div.composer-actions'));

    this.youSaid = h('figure.you-said', { hidden: true }, h('figcaption', { text: 'You said' }), h('blockquote', {}, h('p')));
    this.errorSlot = h('div.error-slot');

    this.micStage = h(
      'section.mic-stage',
      { 'aria-label': 'Your answer', 'aria-describedby': 'stage-headline' },
      this.micWrap,
      this.stageHeadline,
      this.stageSub,
      this.speechProgress,
      this.preview,
      this.stageActions,
      this.composer,
      this.youSaid,
      this.errorSlot,
      h('p.privacy-note', {}, icon('lock', { size: 14 }), 'Your voice stays on this device. It\'s turned into text right here in your browser, then the audio is thrown away.'),
    );

    // 3. Feedback
    this.feedbackSlot = h('section.feedback-slot', { 'aria-label': 'Coach feedback', tabindex: '-1' });

    return h(
      'main.game',
      { id: 'main' },
      top,
      h('nav.mode-nav', { 'aria-label': 'Modes' }, tabs),
      h('div.play-column', {}, this.cardSlot, this.cardTools, this.micStage, this.feedbackSlot),
    );
  }

  onMicButton() {
    const { ctl } = this;
    const p = ctl.state.phase;
    if (p === 'recording') ctl.stopRecording();
    else if (p === 'ready' || p === 'review') {
      ctl.setInputMode('voice');
      ctl.toggleMic();
    }
  }

  /** Which layout the mic stage should show. */
  stageMode() {
    const { ctl } = this;
    const p = ctl.state.phase;
    if (p === 'recording') return 'recording';
    if (p === 'transcribing') return 'transcribing';
    if (p === 'evaluating') return 'sent';
    if (p === 'feedback') return 'done';
    if (p === 'review' && ctl.inputMode === 'voice') return 'review';
    if (ctl.inputMode === 'type') return 'typing';
    return 'idle';
  }

  update(change) {
    const { ctl } = this;
    const s = ctl.state;
    if (change === 'tick') return this.updateTimer();

    for (const [id, b] of this.modeButtons) b.setAttribute('aria-pressed', id === ctl.modeId ? 'true' : 'false');
    this.root.dataset.color = ctl.mode.color;
    this.root.dataset.phase = s.phase;

    this.renderCard(change);
    const rounds = s.roundsThisSession;
    this.roundCount.textContent = rounds ? `${rounds} round${rounds === 1 ? '' : 's'} this session` : '';
    this.timerToggle.setAttribute('aria-pressed', ctl.settings.timer ? 'true' : 'false');
    this.timerToggle.querySelector('.timer-label').textContent = ctl.settings.timer ? `Timer: ${ctl.mode.challenge.seconds}s` : 'Timer: off';
    const lockTools = ['recording', 'transcribing', 'evaluating'].includes(s.phase);
    for (const b of this.cardTools.querySelectorAll('button')) b.disabled = lockTools && b !== this.timerToggle;

    this.renderCoachChip();
    this.renderStage(change);
    this.renderError(s.error);
    this.renderFeedbackSlot(change);
    this.popup.sync();
    this.updateTimer();
  }

  renderCard(change) {
    const { ctl } = this;
    const s = ctl.state;
    if (!s.scenario || (this.renderedToken === s.token && change !== 'favorite')) return;
    const isNewCard = this.renderedScenarioId !== s.scenario.id;
    const card = cueCard(s.scenario, {
      favorite: ctl.isFavorite(),
      onFavorite: () => announce(ctl.toggleFavorite() ? 'Saved to favourites' : 'Removed from favourites'),
    });
    if (isNewCard && change !== 'favorite') card.classList.add('deal-in');
    this.cardSlot.replaceChildren(card);
    this.renderedScenarioId = s.scenario.id;
    this.renderedToken = s.token;
    if (isNewCard && change === 'NEW_SCENARIO') announce(`New prompt: ${s.scenario.title}. ${s.scenario.setup} ${s.scenario.ask}`);
  }

  renderCoachChip() {
    const c = this.ctl.coach;
    const text = {
      idle: c.cached ? 'Coach asleep' : 'Coach not set up',
      loading: `Coach ${Math.round((c.progress || 0) * 100)}%`,
      ready: 'Coach ready',
      unsupported: 'Coach unavailable',
      error: 'Coach error',
    }[c.status];
    this.coachChip.dataset.status = c.status;
    this.coachChip.replaceChildren(h('span.chip-text', { text }));
    this.coachChip.setAttribute('aria-label', `AI coach status: ${text}`);
  }

  renderStage(change) {
    const { ctl } = this;
    const s = ctl.state;
    const mode = this.stageMode();
    this.micStage.dataset.mode = mode;
    const reduced = this.ui.reducedMotion();

    // Mic button + ring
    const showMic = ['idle', 'recording', 'transcribing'].includes(mode);
    this.micWrap.hidden = !showMic;
    this.micBtn.replaceChildren(icon(mode === 'recording' ? 'stop' : 'mic', { size: 40 }));
    this.micBtn.dataset.state = mode;
    this.micBtn.disabled = mode === 'transcribing';
    this.micBtn.setAttribute('aria-label', mode === 'recording' ? 'Finish recording' : 'Start talking');
    this.micBtn.setAttribute('aria-pressed', mode === 'recording' ? 'true' : 'false');
    if (mode === 'recording') this.ring.start('live', () => ctl.mic?.frequencies?.() ?? ctl.mic?.level?.() ?? 0, { reduced });
    else if (mode === 'transcribing') this.ring.start('busy', null, { reduced });
    else if (mode === 'idle') this.ring.start('idle', null, { reduced });
    else this.ring.stop();

    // Headline + sub copy
    const copy = {
      idle: ['Tap the mic and start talking', 'Say the first thing that comes to mind. Tap Finish when you\'re done.'],
      recording: ['Listening…', ctl.settings.timer ? 'Beat the clock, or tap Finish when you\'re done.' : 'Keep going. Tap Finish when you\'re done.'],
      transcribing: ['Writing down what you said…', 'This happens on your device.'],
      review: ['Here\'s what we heard', 'Fix anything the transcription got wrong, then send it to your coach.'],
      typing: ['Type your answer', 'Short is fine. Press Send when you\'re ready.'],
      sent: ['Sent to your coach', ''],
      done: ['', ''],
    }[mode];
    this.stageHeadline.textContent = copy[0];
    this.stageHeadline.hidden = !copy[0];
    this.stageSub.textContent = copy[1];
    this.stageSub.hidden = !copy[1];

    const sp = ctl.speech;
    const downloading = (mode === 'recording' || mode === 'transcribing') && sp.status === 'loading';
    this.speechProgress.hidden = !downloading;
    if (downloading) this.speechProgress.textContent = `Getting the speech model ready (one time): ${Math.round((sp.fraction || 0) * 100)}%`;

    this.preview.hidden = !(mode === 'recording' && s.preview);
    this.preview.textContent = mode === 'recording' ? s.preview : '';

    // Action buttons under the mic
    const key = `${mode}`;
    if (key !== this.stageKey) {
      this.stageKey = key;
      const acts = [];
      if (mode === 'idle') {
        acts.push(h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { ctl.setInputMode('type'); requestAnimationFrame(() => this.textarea.focus()); } }, icon('keyboard', { size: 16 }), 'Rather type?'));
      } else if (mode === 'recording') {
        acts.push(
          h('button.btn.btn-primary.btn-xl.finish-btn', { type: 'button', id: 'finish-btn', onclick: () => ctl.stopRecording() }, 'Finish'),
          h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => ctl.cancelRecording() }, 'Start over'),
        );
      }
      this.stageActions.replaceChildren(...acts);
      this.stageActions.hidden = !acts.length;
      if (mode === 'recording') requestAnimationFrame(() => document.getElementById('finish-btn')?.focus({ preventScroll: true }));
    }

    // Composer (typing, or reviewing a transcript)
    const showComposer = mode === 'typing' || mode === 'review';
    this.composer.hidden = !showComposer;
    if (showComposer) {
      this.composer.querySelector('.composer-label').textContent = mode === 'review' ? 'Your transcript' : 'Your answer';
      this.textarea.readOnly = false;
      if (change !== 'EDIT' && this.textarea.value !== s.transcript) this.textarea.value = s.transcript;
      const sendBtn = h('button.btn.btn-primary', { type: 'button', id: 'submit-btn', disabled: !s.transcript.trim(), onclick: () => ctl.submit() }, 'Send to coach');
      const alt = mode === 'review'
        ? h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => { ctl.edit(''); ctl.setInputMode('voice'); ctl.toggleMic(); } }, icon('mic', { size: 16 }), 'Record again')
        : h('button.btn.btn-ghost.btn-small', { type: 'button', onclick: () => ctl.setInputMode('voice') }, icon('mic', { size: 16 }), 'Use the mic');
      this.composer.querySelector('.composer-actions').replaceChildren(sendBtn, alt);
      if (change === 'TRANSCRIBED') requestAnimationFrame(() => this.textarea.focus({ preventScroll: true }));
    }

    // "You said" bubble once the answer is sent
    const showSaid = mode === 'sent' || mode === 'done';
    this.youSaid.hidden = !showSaid;
    if (showSaid) this.youSaid.querySelector('blockquote p').textContent = s.submitted;
    if (change === 'SUBMIT') announce(`Sent: ${s.submitted}`);
  }

  renderError(err) {
    if (!err) {
      this.errorSlot.replaceChildren();
      this.lastErr = null;
      return;
    }
    if (this.lastErr === err) return;
    this.lastErr = err;
    const { ctl } = this;
    const canRetrySend = ['timeout', 'invalid-output', 'model', 'download', 'memory'].includes(err.code) && ctl.state.phase === 'review';
    const canRerecord = ['transcribe-failed', 'transcribe-download', 'silent', 'empty-transcript', 'busy'].includes(err.code);
    const box = h(
      'div.alert',
      { role: 'alert' },
      h('p.alert-title', { text: err.title }),
      h('p.alert-body', { text: err.body }),
      h(
        'div.alert-actions',
        {},
        canRetrySend ? h('button.btn.btn-small', { type: 'button', onclick: () => ctl.submit() }, 'Try sending again') : null,
        canRerecord ? h('button.btn.btn-small', { type: 'button', onclick: () => { ctl.dismissError(); ctl.setInputMode('voice'); ctl.toggleMic(); } }, 'Record again') : null,
        ['denied', 'no-mic', 'busy', 'unsupported', 'insecure'].includes(err.code)
          ? h('button.btn.btn-small', { type: 'button', onclick: () => { ctl.dismissError(); ctl.setInputMode('type'); requestAnimationFrame(() => this.textarea.focus()); } }, 'Type instead')
          : null,
        h('button.btn.btn-small.btn-ghost', { type: 'button', onclick: () => ctl.dismissError() }, 'Dismiss'),
      ),
    );
    this.errorSlot.replaceChildren(box);
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
      this.root.style.removeProperty('--timer-frac');
      if (this.ctl.state.phase !== 'recording') this.micStage.removeAttribute('data-time');
      return;
    }
    const secs = t.challenge ? Math.ceil(t.left) : Math.floor(t.elapsed);
    const label = t.challenge ? `${secs}s left` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.micStage.dataset.time = label;
    this.root.style.setProperty('--timer-frac', String(t.challenge ? t.left / t.total : 1));
    if (this.stageMode() === 'recording') this.stageHeadline.textContent = `Listening… ${label}`;
  }

  destroy() {
    this.ring.stop();
    this.popup.destroy();
  }
}
