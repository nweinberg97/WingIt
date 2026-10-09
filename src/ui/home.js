import { h, icon, wingMark } from './dom.js';
import { BRAND } from '../brand.js';
import { MODES } from '../modes.js';
import { deckScenario } from '../deck.js';
import { cueCard } from './card.js';

export function renderHome(ctl, ui) {
  let sample = deckScenario({ modeId: 'wildcard', difficulty: 'normal', bonusChance: 0 });
  const cardSlot = h('div.home-card-slot');
  const drawSample = () => {
    const modes = MODES.map((m) => m.id);
    sample = deckScenario({ modeId: modes[Math.floor(Math.random() * modes.length)], bonusChance: 0 });
    cardSlot.replaceChildren(cueCard(sample, { compact: true }));
    cardSlot.firstChild.classList.add('deal-in');
  };
  cardSlot.append(cueCard(sample, { compact: true }));

  const header = h(
    'header.topbar.home-top',
    {},
    h('div.brand', {}, wingMark(34), h('span.wordmark', { text: BRAND.name })),
    h(
      'nav.top-actions',
      { 'aria-label': 'App' },
      h('button.icon-btn', { type: 'button', onclick: () => ui.openHelp(), 'aria-label': 'How it works and privacy' }, icon('help')),
      h('button.icon-btn', { type: 'button', onclick: () => ui.openSettings(), 'aria-label': 'Settings' }, icon('gear')),
    ),
  );

  const hero = h(
    'section.hero',
    {},
    h(
      'div.hero-copy',
      {},
      h('h1.hero-title', {}, h('span', { text: 'Say the first' }), h('span', { text: 'brilliant thing.' })),
      h(
        'p.hero-lede',
        { text: `${BRAND.name} deals you a ridiculous situation. You answer out loud. A coach running inside your browser tells you what landed and what to try next.` },
      ),
      h(
        'div.hero-actions',
        {},
        h('button.btn.btn-primary.btn-xl', { type: 'button', onclick: () => ctl.startGame(), id: 'start-playing' }, 'Start playing'),
        h('button.btn.btn-ghost', { type: 'button', onclick: drawSample }, icon('shuffle'), 'Deal a sample'),
      ),
      h('p.privacy-line', {}, icon('lock', { size: 16 }), 'Your voice stays on this device. Speech is turned into text in your browser; audio is never uploaded or saved.'),
    ),
    cardSlot,
  );

  const modes = h(
    'section.modes',
    { 'aria-labelledby': 'modes-title' },
    h('h2.section-title', { id: 'modes-title', text: 'Pick a warm-up' }),
    h(
      'ul.mode-tickets',
      {},
      MODES.map((m) =>
        h(
          'li',
          {},
          h(
            'button.ticket',
            { type: 'button', dataset: { color: m.color }, onclick: () => ctl.startGame(m.id) },
            h('span.ticket-glyph', {}, icon(m.glyph, { size: 26 })),
            h('span.ticket-name', { text: m.name }),
            h('span.ticket-short', { text: m.short }),
          ),
        ),
      ),
    ),
  );

  const how = h(
    'section.how',
    { 'aria-labelledby': 'how-title' },
    h('h2.section-title', { id: 'how-title', text: 'How a round works' }),
    h(
      'ol.how-steps',
      {},
      h('li', {}, h('strong', { text: 'Get a card.' }), ' A strange situation, a role and a goal.'),
      h('li', {}, h('strong', { text: 'Talk.' }), ' Tap the mic and answer before you overthink it. Typing works too.'),
      h('li', {}, h('strong', { text: 'Get notes.' }), ' Your strongest move, why it worked, and one thing to try next.'),
    ),
  );

  const footer = h(
    'footer.footer',
    {},
    h('p', { text: 'Free and open: Whisper (MIT) for speech, Qwen2.5 (Apache-2.0) for coaching. Models download once and run on your device.' }),
  );

  return h('main.home', { id: 'main' }, header, hero, modes, how, footer);
}
