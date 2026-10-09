import { BRAND } from './brand.js';
import { Controller } from './controller.js';
import { Coach } from './ai/coach.js';
import { renderHome } from './ui/home.js';
import { GameView } from './ui/game.js';
import { openSettings, openHelp, openHistory } from './ui/dialogs.js';

// Automated browser tests can inject fake hardware/model runtimes before the app boots.
// In normal use this is undefined and the real WebLLM / Whisper / microphone are used.
const testHooks = globalThis.__WINGIT_TEST__;

const coach = testHooks?.coachRuntime ? new Coach({ runtime: testHooks.coachRuntime, gpuDetector: testHooks.gpuDetector }) : new Coach({ gpuDetector: testHooks?.gpuDetector });
const ctl = new Controller({
  coach,
  transcriber: testHooks?.transcriber,
  micFactory: testHooks?.micFactory,
});

const root = document.getElementById('app');
document.title = `${BRAND.name}: pocket improv gym`;

const ui = {
  openSettings: () => openSettings(ctl, ui),
  openHelp: () => openHelp(),
  openHistory: () => openHistory(ctl),
  reducedMotion() {
    const m = ctl.settings.motion;
    if (m === 'reduce') return true;
    if (m === 'full') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  applyPrefs() {
    const { theme } = ctl.settings;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.motion = ui.reducedMotion() ? 'reduce' : 'full';
  },
};

let game = null;
let currentView = null;

function render(change) {
  if (ctl.view !== currentView) {
    currentView = ctl.view;
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
ui.applyPrefs();
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', ui.applyPrefs);
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

if (testHooks) globalThis.__WINGIT__ = ctl;
