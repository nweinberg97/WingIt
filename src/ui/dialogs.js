import { h, icon, announce } from './dom.js';
import { BRAND } from '../brand.js';
import { COACH_MODELS } from '../ai/coach.js';
import { TRANSCRIBE_MODELS } from '../speech/transcriber.js';
import { getMode, MODES } from '../modes.js';

function dialogShell(title, body, onClose) {
  const dlg = h('dialog.sheet', { 'aria-labelledby': 'dlg-title' });
  const close = () => dlg.close();
  dlg.append(
    h('div.sheet-head', {}, h('h2', { id: 'dlg-title', text: title }), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('div.sheet-body', {}, body),
  );
  dlg.addEventListener('close', () => {
    onClose?.();
    dlg.remove();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function radioGroup(name, legend, options, value, onChange) {
  return h(
    'fieldset.field',
    {},
    h('legend', { text: legend }),
    h(
      'div.radio-row',
      {},
      options.map(([v, label, hint]) =>
        h(
          'label.radio',
          {},
          h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }),
          h('span.radio-text', {}, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
        ),
      ),
    ),
  );
}

function toggle(label, hint, checked, onChange) {
  return h(
    'label.toggle',
    {},
    h('input', { type: 'checkbox', role: 'switch', checked, onchange: (e) => onChange(e.target.checked) }),
    h('span.toggle-text', {}, h('span', { text: label }), hint ? h('small', { text: hint }) : null),
  );
}

export function openSettings(ctl, ui) {
  const st = ctl.settings;
  const coachStatus = h('p.small');
  const updateCoachStatus = () => {
    const c = ctl.coach;
    const map = {
      idle: c.cached ? 'Downloaded, asleep.' : 'Not downloaded yet.',
      loading: `Loading… ${Math.round((c.progress || 0) * 100)}%`,
      ready: `Running: ${c.loadedModelId}`,
      unsupported: 'Not available: this browser has no WebGPU.',
      error: `Error: ${c.error?.message ?? 'unknown'}`,
    };
    coachStatus.textContent = `Coach status: ${map[c.status] ?? c.status}`;
  };
  updateCoachStatus();
  const unsub = ctl.subscribe(updateCoachStatus);

  const body = h(
    'div.settings',
    {},
    h('h3', { text: 'Play' }),
    toggle('Challenge timer', 'Adds a countdown to each answer (length depends on the mode). Recording stops when it hits zero.', st.timer, (v) => ctl.updateSettings({ timer: v })),
    toggle('Check my transcript before sending', 'When on, Finish shows your transcript so you can fix it first. When off, it goes straight to your coach.', st.reviewBeforeSend, (v) => ctl.updateSettings({ reviewBeforeSend: v })),
    toggle('Live transcript preview', 'Shows rough text while you talk. Uses a little more processing power.', st.livePreview, (v) => ctl.updateSettings({ livePreview: v })),
    radioGroup('src', 'Where scenarios come from', [
      ['auto', 'Coach + deck', 'Once the coach is awake it writes fresh scenarios; the deck fills in instantly.'],
      ['deck', 'Deck only', 'Hand-built scenario combinations. No model needed.'],
    ], st.scenarioSource, (v) => ctl.updateSettings({ scenarioSource: v })),

    h('h3', { text: 'Look and feel' }),
    radioGroup('theme', 'Theme', [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], st.theme, (v) => {
      ctl.updateSettings({ theme: v });
      ui.applyPrefs();
    }),
    radioGroup('motion', 'Motion', [['system', 'Match device'], ['reduce', 'Reduced'], ['full', 'Full']], st.motion, (v) => {
      ctl.updateSettings({ motion: v });
      ui.applyPrefs();
    }),

    h('h3', { text: 'Models (all run on this device)' }),
    radioGroup(
      'coach',
      'Coach model',
      Object.entries(COACH_MODELS).map(([k, m]) => [k, `${m.label}`, `${m.blurb} ≈${m.approxDownloadGB} GB download, ${m.license}.`]),
      st.coachModel,
      (v) => ctl.updateSettings({ coachModel: v }),
    ),
    coachStatus,
    radioGroup(
      'speech',
      'Speech model',
      Object.entries(TRANSCRIBE_MODELS).map(([k, m]) => [k, m.label, `${m.note} About ${m.sizeMB} MB, MIT licence.`]),
      st.transcribeModel,
      (v) => ctl.updateSettings({ transcribeModel: v }),
    ),
    h(
      'div.btn-row',
      {},
      h('button.btn.btn-small', { type: 'button', onclick: async () => { await ctl.unloadModels(); announce('Models unloaded from memory'); } }, 'Free up memory'),
      h('button.btn.btn-small.btn-danger', {
        type: 'button',
        onclick: async () => {
          if (!confirm('Delete downloaded model files from this browser? You can download them again later.')) return;
          const n = await ctl.deleteModelDownloads();
          announce(n ? 'Downloaded models deleted' : 'No downloaded models found');
        },
      }, 'Delete downloaded models'),
    ),

    h('h3', { text: 'Your data' }),
    h('p.small', { text: 'Rounds played, average scores and favourites are kept in this browser only. Answers and audio are never saved.' }),
    h('div.btn-row', {}, h('button.btn.btn-small.btn-danger', {
      type: 'button',
      onclick: () => {
        if (!confirm('Clear your rounds, scores and favourites?')) return;
        ctl.clearHistory();
        announce('History cleared');
      },
    }, 'Clear history and favourites')),
  );
  return dialogShell('Settings', body, unsub);
}

export function openHelp() {
  const body = h(
    'div.help',
    {},
    h('h3', { text: 'How to play' }),
    h('p', { text: 'Read the prompt, tap the mic and answer out loud. The ring around the mic moves with your voice. Tap Finish and your words are written down on your device and sent to your coach. Moments later you get notes, then try again or grab a new prompt. Prefer typing? Tap \u201cRather type?\u201d under the mic.' }),
    h('ul.mode-list', {}, MODES.map((m) => h('li', {}, h('strong', { text: `${m.name}: ` }), m.objective))),
    h('h3', { text: 'Keyboard' }),
    h('p', { text: 'Tab moves between controls. Space or Enter presses buttons. Ctrl+Enter (or ⌘+Enter) in the answer box gets feedback. Press S anywhere else to shuffle.' }),
    h('h3', { text: 'Privacy, precisely' }),
    h('ul', {},
      h('li', { text: 'The microphone turns on only when you tap it, and every track is stopped when you stop, discard, change scenario or leave.' }),
      h('li', { text: 'Raw audio stays in memory on this device. It is turned into text by Whisper running in your browser, then dropped. It is never uploaded, stored or used for anything else.' }),
      h('li', { text: 'Your answer text is evaluated by an open model running in your browser via WebGPU. It is not sent to any server.' }),
      h('li', { text: `${BRAND.name} has no accounts, analytics or trackers. Settings, favourites and score totals are saved in this browser only; you can clear them in Settings.` }),
      h('li', { text: 'The network is used to load the app and, the first time, to download model files from Hugging Face, GitHub and jsDelivr. After that they come from your browser cache.' }),
    ),
    h('h3', { text: 'Models and licences' }),
    h('ul', {},
      h('li', { text: 'Speech: OpenAI Whisper tiny.en / base.en (MIT), ONNX builds by onnx-community, run with Transformers.js (Apache-2.0).' }),
      h('li', { text: 'Coach: Qwen2.5 0.5B / 1.5B Instruct (Apache-2.0) or Phi-3.5 mini (MIT), run with WebLLM (Apache-2.0).' }),
    ),
  );
  return dialogShell(`About ${BRAND.name}`, body);
}

export function openHistory(ctl) {
  const stats = ctl.store.getStats();
  const favs = ctl.store.getFavorites();
  const dims = Object.entries(stats.dims ?? {}).map(([k, d]) => ({ k, label: d.label ?? k, avg: d.sum / d.n, n: d.n })).sort((a, b) => b.n - a.n);
  const body = h(
    'div.history',
    {},
    h('p.big-stat', {}, h('strong', { text: String(stats.rounds) }), ` round${stats.rounds === 1 ? '' : 's'} played on this device`),
    stats.rounds
      ? h(
          'div',
          {},
          h('h3', { text: 'Modes you\'ve played' }),
          h('ul.chips', {}, Object.entries(stats.byMode).map(([id, n]) => h('li', { dataset: { color: getMode(id).color } }, `${getMode(id).name} × ${n}`))),
          h('h3', { text: 'Skills practised' }),
          h('ul.skill-list', {}, dims.map((d) => h('li', {}, h('span', { text: d.label }), h('span.skill-bar', {}, h('i', { style: { width: `${(d.avg / 5) * 100}%` } })), h('small', { text: `${d.avg.toFixed(1)} avg over ${d.n}` })))),
        )
      : h('p', { text: 'Play a round to start your tally.' }),
    h('h3', { text: 'Favourite scenarios' }),
    favs.length
      ? h(
          'ul.fav-list',
          {},
          favs.map((f) =>
            h(
              'li',
              {},
              h('div', {}, h('strong', { text: f.title }), h('p', { text: f.setup })),
              h('button.btn.btn-small', {
                type: 'button',
                onclick: (e) => {
                  e.target.closest('dialog').close();
                  ctl.playScenario(f);
                },
              }, 'Play'),
            ),
          ),
        )
      : h('p', { text: 'Tap the heart on any card to keep it here.' }),
  );
  return dialogShell('Your rounds', body);
}
