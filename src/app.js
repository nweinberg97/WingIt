import { BRAND } from './brand.js';
import { Controller } from './controller.js';
import { Coach, createWebLLMRuntime } from './ai/coach.js';
import { LocalTranscriber } from './speech/transcriber.js';
import { IntegrityGuard, loadManifest } from './security/guard.js';
import { openSafety } from './ui/safety.js';
import { describeError } from './errors.js';
import { renderHome } from './ui/home.js';
import { GameView } from './ui/game.js';
import { openSettings, openHelp, openHistory } from './ui/dialogs.js';
import { h, icon } from './ui/dom.js';

// Automated browser tests can inject fake hardware/model runtimes before the app boots.
// In normal use this is undefined and the real WebLLM / Whisper / microphone are used.
const testHooks = globalThis.__WINGIT_TEST__;

// Integrity guard: no model or third-party file loads until it is protecting this page, and every
// such file must match the SHA-256 fingerprint recorded in vendor/integrity.json.
const guard = testHooks?.guard ?? new IntegrityGuard();
const beforeLoad = () => guard.ready();
const runtime = testHooks?.coachRuntime ?? createWebLLMRuntime({ beforeLoad, getManifest: loadManifest });
const coach = new Coach({ runtime, gpuDetector: testHooks?.gpuDetector });
const ctl = new Controller({
  coach,
  transcriber: testHooks?.transcriber ?? new LocalTranscriber({ beforeLoad, getManifest: loadManifest }),
  micFactory: testHooks?.micFactory,
  connection: testHooks?.connection,
});

const root = document.getElementById('app');
document.title = `${BRAND.name}: pocket improv gym`;

const ui = {
  guard,
  openSafety: () => openSafety(ctl, ui),
  openSettings: () => openSettings(ctl, ui),
  openHelp: () => openHelp(ui),
  openHistory: () => openHistory(ctl),
  reducedMotion() {
    const m = ctl.settings.motion;
    if (m === 'reduce') return true;
    if (m === 'full') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  isDark() {
    const { theme } = ctl.settings;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  },
  /** Light/dark switch, separate from Settings. Shows what you'll switch to. */
  themeButton() {
    const btn = h('button.icon-btn.theme-btn', { type: 'button' });
    const paint = () => {
      const dark = ui.isDark();
      btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = dark ? 'Light mode' : 'Dark mode';
    };
    btn.addEventListener('click', () => {
      ctl.updateSettings({ theme: ui.isDark() ? 'light' : 'dark' });
      ui.applyPrefs();
    });
    ui.themeButtons.add(paint);
    paint();
    return btn;
  },
  themeButtons: new Set(),
  applyPrefs() {
    const { theme } = ctl.settings;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = ui.reducedMotion() ? 'reduce' : 'full';
    for (const paint of ui.themeButtons) paint();
  },
};

let game = null;
let currentView = null;

function render(change) {
  if (ctl.view !== currentView) {
    currentView = ctl.view;
    ui.themeButtons.clear();
    if (ctl.view === 'home') {
      game?.destroy();
      game = null;
      root.replaceChildren(renderHome(ctl, ui));
    } else {
      game = new GameView(ctl, ui);
      root.replaceChildren(game.root);
      game.update('NEW_SCENARIO');
      document.getElementById('mic-btn')?.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
    return;
  }
  if (game) game.update(change);
}

ctl.subscribe(render);
// If the guard ever blocks a file, say so plainly.
guard.on?.((ev) => {
  if (ev.type === 'blocked' && ev.reason === 'hash-mismatch') ctl.dispatch({ type: 'SET_ERROR', error: describeError('integrity-blocked', ev.url) });
});
ui.applyPrefs();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', ui.applyPrefs);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', ui.applyPrefs);
render('init');

// Never leave the microphone running when the page is hidden or closed.
const releaseMic = () => {
  if (ctl.state.phase === 'recording') ctl.cancelRecording();
};
addEventListener('pagehide', releaseMic);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') releaseMic();
});

// Keyboard shortcut: "S" shuffles when focus isn't in a text field.
addEventListener('keydown', (e) => {
  if (ctl.view !== 'game' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 's' || e.key === 'S') {
    if (!['recording', 'transcribing'].includes(ctl.state.phase)) ctl.shuffle();
  }
});

if (testHooks) {
  globalThis.__WINGIT__ = ctl;
  globalThis.__WINGIT_GUARD__ = guard;
}
