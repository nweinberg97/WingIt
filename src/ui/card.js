import { h, icon } from './dom.js';
import { getMode, DIFFICULTIES } from '../modes.js';

const SOURCE_LABEL = {
  deck: 'From the deck',
  model: 'Written by your coach',
  favorite: 'From your favourites',
};

/** The scenario cue card: the heart of the game. */
export function cueCard(s, { compact = false, favorite = false, onFavorite } = {}) {
  const mode = getMode(s.modeId);
  const head = h(
    'div.card-head',
    {},
    h('span.card-mode', {}, icon(mode.glyph, { size: 16 }), mode.name),
    h('span.card-meta', { text: DIFFICULTIES[s.difficulty]?.label ?? '' }),
  );
  const body = h(
    'div.card-body',
    {},
    h(compact ? 'p.card-title' : 'h2.card-title', { text: s.title, id: compact ? undefined : 'scenario-title' }),
    h('p.card-setup', { text: s.setup }),
    h('p.card-ask', { text: s.ask }),
  );
  const extras = [];
  if (s.twist) extras.push(h('p.card-chip.chip-twist', { text: s.twist }));
  if (s.bonus) extras.push(h('p.card-chip.chip-bonus', { text: s.bonus }));
  const foot = h(
    'div.card-foot',
    {},
    h('span.card-source', { dataset: { source: s.source }, text: SOURCE_LABEL[s.source] ?? '' }),
    onFavorite
      ? h(
          'button.icon-btn.fav-btn',
          {
            type: 'button',
            'aria-pressed': favorite ? 'true' : 'false',
            'aria-label': favorite ? 'Remove from favourites' : 'Save to favourites',
            onclick: onFavorite,
          },
          icon('heart'),
        )
      : null,
  );
  return h(
    'article.cue-card',
    { dataset: { color: mode.color }, 'aria-labelledby': compact ? undefined : 'scenario-title', class: compact ? 'compact' : '' },
    head,
    body,
    extras.length ? h('div.card-extras', {}, extras) : null,
    foot,
  );
}
