import { h, icon, announce } from './dom.js';
import { reactionFor } from '../feedback.js';
import { DIMENSIONS } from '../modes.js';

function pips(score) {
  return h(
    'span.pips',
    { role: 'img', 'aria-label': `${score} out of 5` },
    [1, 2, 3, 4, 5].map((n) => h('i', { class: n <= score ? 'on' : '' })),
  );
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.lastChild.textContent;
    btn.lastChild.textContent = 'Copied';
    announce('Copied to clipboard');
    setTimeout(() => (btn.lastChild.textContent = old), 1500);
  } catch {
    announce('Copy failed. Your browser blocked clipboard access.');
  }
}

export function renderFeedback(ctl, s) {
  const f = s.feedback;
  const reaction = reactionFor(f);

  const header = h(
    'div.fb-head',
    { dataset: { tone: reaction.tone } },
    h('p.fb-reaction', { text: reaction.word }),
    h('p.fb-overall', { text: f.overall }),
  );

  const strongest = f.strongest.why
    ? h(
        'div.fb-block.fb-strongest',
        {},
        h('h3', { text: 'Your strongest move' }),
        f.strongest.quote ? h('blockquote.fb-quote', {}, h('p', { text: `“${f.strongest.quote}”` })) : null,
        h('p', { text: f.strongest.why }),
      )
    : null;

  const worked = f.worked ? h('div.fb-block', {}, h('h3', { text: 'What worked' }), h('p', { text: f.worked })) : null;
  const tryNext = h('div.fb-block.fb-try', {}, h('h3', { text: 'Try this next' }), h('p', { text: f.tryNext }));

  let alt = null;
  if (f.alternative) {
    const panel = h(
      'div.alt-panel',
      { id: 'alt-panel', hidden: true },
      h('p.alt-technique', { text: f.alternative.technique }),
      h('p.alt-example', { text: f.alternative.example }),
      h('p.alt-note', { text: 'One option among many, not the right answer.' }),
    );
    const toggle = h('button.btn.btn-ghost.alt-toggle', {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'alt-panel',
      onclick: () => {
        const open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.lastChild.textContent = open ? 'Hide the different direction' : 'Show a different direction';
      },
    }, icon('spiral', { size: 16 }), h('span', { text: 'Show a different direction' }));
    alt = h('div.fb-block.fb-alt', {}, toggle, panel);
  }

  const scorecard = h(
    'div.fb-scores',
    {},
    h('h3', { text: 'Scorecard' }),
    h(
      'ul',
      {},
      f.scores.map((sc) =>
        h(
          'li.score-row',
          {},
          h('span.score-label', { text: sc.label, title: DIMENSIONS[sc.dimension]?.criteria?.[sc.score] ?? '' }),
          pips(sc.score),
          h('span.score-reason', { text: sc.reason }),
        ),
      ),
    ),
    h('p.score-note', { text: 'Scores are practice signals from a small AI model, not a verdict on your creativity.' }),
  );

  const copyBtn = h('button.btn.btn-ghost', { type: 'button', onclick: () => copy(ctl.feedbackText(), copyBtn) }, icon('copy', { size: 16 }), h('span', { text: 'Copy notes' }));

  const actions = h(
    'div.fb-actions',
    {},
    h('button.btn.btn-primary.btn-xl', { type: 'button', onclick: () => ctl.shuffle(), id: 'next-round' }, icon('shuffle'), 'Next scenario'),
    h('button.btn', { type: 'button', onclick: () => ctl.retry() }, icon('retry'), 'Try again'),
    h('button.btn.btn-ghost', { type: 'button', onclick: () => { ctl.harder(); } }, icon('up', { size: 16 }), 'Harder version'),
    copyBtn,
  );

  return h(
    'div.feedback',
    { dataset: { color: ctl.mode.color } },
    header,
    h('div.fb-grid', {}, h('div.fb-main', {}, strongest, worked, tryNext, alt), scorecard),
    f.closing ? h('p.fb-closing', { text: f.closing }) : null,
    actions,
    h('p.fb-provenance', { text: `Feedback written by ${ctl.coach.loadedModelId ?? 'your local model'}, running in this browser.` }),
  );
}
