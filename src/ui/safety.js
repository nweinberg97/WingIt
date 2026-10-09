// "Is WingIt safe?" — a plain-language explainer with a live readout of the integrity guard.
import { h, icon } from './dom.js';
import { dialogShell } from './dialogs.js';
import { loadManifest } from '../security/guard.js';
import { COACH_MODELS } from '../ai/coach.js';
import { TRANSCRIBE_MODELS } from '../speech/transcriber.js';

const REPO_URL = 'https://github.com/nweinberg97/wingit';

function step(n, title, text) {
  return h('li.safety-step', {}, h('span.safety-num', { text: String(n), 'aria-hidden': 'true' }), h('div', {}, h('strong', { text: title }), h('p', { text })));
}

export function openSafety(ctl, ui) {
  const guard = ui.guard;
  const statusEl = h('div.safety-status', { role: 'status' });
  const paint = async () => {
    const m = await loadManifest();
    const g = guard?.status ?? 'idle';
    const rows = [];
    if (!m) {
      rows.push(h('p.safety-bad', {}, icon('lock', { size: 16 }), 'This copy of WingIt has no fingerprint list, so the AI models are switched off.'));
    } else if (g === 'active') {
      const c = guard.lastCheck;
      rows.push(h('p.safety-good', {}, icon('lock', { size: 16 }), `Safety check is on. ${Object.keys(m.files).length} files fingerprinted (list ${m.version}).`));
      if (c && !c.cached) rows.push(h('p.small', { text: `Re-checked ${c.checked} saved file${c.checked === 1 ? '' : 's'}${c.removed ? `, removed ${c.removed} that didn't match` : ', all good'}.` }));
    } else if (g === 'unavailable') {
      rows.push(h('p.safety-bad', {}, icon('lock', { size: 16 }), 'Your browser blocked the safety check (common in private windows), so the AI stays off here.'));
    } else {
      rows.push(h('p.small', {}, icon('lock', { size: 16 }), `Fingerprint list ready (${Object.keys(m.files).length} files). The safety check switches on the moment any AI file is needed.`));
    }
    if (guard?.blocked?.length) rows.push(h('p.safety-bad', { text: `Blocked this visit: ${guard.blocked.length} file(s) that didn't match.` }));
    statusEl.replaceChildren(...rows);
  };
  paint();
  const unsub = guard?.on?.(() => paint());

  const coachGB = COACH_MODELS[ctl.settings.coachModel]?.approxDownloadGB ?? 1;
  const speechMB = TRANSCRIBE_MODELS[ctl.settings.transcribeModel]?.sizeMB ?? 77;

  const body = h(
    'div.safety',
    {},
    statusEl,
    h('h3', { text: 'The short version' }),
    h('p', { text: 'Everything happens inside your browser. Your voice and your answers never leave your device. The AI files WingIt downloads are checked, one by one, against fingerprints before they\'re allowed to run.' }),

    h('h3', { text: 'What happens when you play' }),
    h('ol.safety-steps', {},
      step(1, 'You talk', 'The microphone turns on only when you tap it, and switches off when you finish.'),
      step(2, 'Your words are written down on your device', 'A speech model (Whisper) running in your browser turns the audio into text. The audio is then thrown away. It is never saved or uploaded.'),
      step(3, 'The coach reads the text on your device', 'An AI model (Qwen) running in your browser writes your feedback. Your answer is not sent to any server, ours or anyone else\'s.'),
      step(4, 'You get notes', 'Feedback is shown as plain text. The AI can\'t run code, click things or reach your files.'),
    ),

    h('h3', { text: 'Why there\'s a download' }),
    h('p', { text: `For the AI to run on your device, your browser has to have it, the same way it has to download any website before showing it. The AI is much bigger than a normal page: about ${(coachGB + speechMB / 1000).toFixed(1)} GB the first time. WingIt asks before downloading anything. The files are saved in this browser's storage, never installed on your computer, and you can delete them in Settings → Delete downloaded models.` }),
    h('p', { text: 'The alternative, running the AI on a server, would mean no download, but your answers would have to leave your device. WingIt chooses privacy.' }),

    h('h3', { text: 'How every file is checked' }),
    h('ul.safety-list', {},
      h('li', {}, h('strong', { text: 'Exact versions only. ' }), 'Each AI model is locked to one exact published version. WingIt\'s own copy of the code that runs the AI is served from WingIt\'s site, not a third-party CDN.'),
      h('li', {}, h('strong', { text: 'Fingerprints. ' }), 'WingIt carries a list of the SHA-256 fingerprint of every file it may load. Change even one byte of a file and its fingerprint changes completely.'),
      h('li', {}, h('strong', { text: 'A gatekeeper in your browser. ' }), 'A small built-in safety check (a "service worker") inspects every file as it arrives and only lets it through if its fingerprint matches the list. Anything unlisted or altered is blocked, even if the place it came from was hacked.'),
      h('li', {}, h('strong', { text: 'Saved files are re-checked ' }), 'whenever the list changes, and anything that doesn\'t match is deleted.'),
      h('li', {}, h('strong', { text: 'Nothing goes out. ' }), 'The gatekeeper only allows plain downloads of listed files to other sites. Sending data anywhere is blocked, and the page\'s security policy locks out everything else.'),
      h('li', {}, h('strong', { text: 'No accounts, ads, analytics or trackers. ' }), 'Settings, favourites and score totals stay in this browser.'),
    ),

    h('h3', { text: 'What a model file actually is' }),
    h('p', { text: 'An AI model file is data: a very large list of numbers. It can\'t run by itself. Your browser\'s own built-in engines (WebGPU and WebAssembly) do the maths, inside the same sandbox that keeps every website away from your files and other apps.' }),

    h('h3', { text: 'Honest limits' }),
    h('ul.safety-list', {},
      h('li', { text: 'No website can promise perfect security. WingIt relies on your browser\'s sandbox, which is the same protection every site relies on.' }),
      h('li', { text: 'WingIt\'s own code is trusted because it comes from WingIt\'s site. It\'s open source, so anyone can read it.' }),
      h('li', { text: 'The models are open-source projects from well-known teams (Qwen by Alibaba, Whisper by OpenAI), under Apache-2.0 and MIT licences.' }),
    ),
    h('p.safety-links', {},
      h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Read WingIt\'s code'),
      ' · ',
      h('a', { href: 'vendor/integrity.json', target: '_blank', rel: 'noopener' }, 'See the fingerprint list'),
    ),
  );
  return dialogShell('Is WingIt safe?', body, () => unsub?.());
}
