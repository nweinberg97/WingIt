// Scenario validation, normalisation, safety screening and repetition checks.
import { MODES } from './modes.js';
import { newId, scenarioKey } from './deck.js';

export const LIMITS = Object.freeze({ title: 60, setup: 420, ask: 140, twist: 160, bonus: 120 });

// Generated scenarios must steer clear of these. Ordinary awkwardness, conflict, satire and absurdity are fine.
const UNSAFE = /\b(suicid\w*|self[- ]?harm\w*|kill (?:yourself|myself|himself|herself|themselves)|rap(?:e|ed|ist)\b|sexual\w*|sexy|porn\w*|nude\w*|naked|erotic\w*|genocid\w*|terroris\w*|bomb(?:s|ing)?|mass shooting|school shooting|nazi\w*|slur\w*|child abuse|molest\w*|overdos\w*|cocaine|heroin|meth)\b/i;

export function isUnsafeText(text) {
  return UNSAFE.test(String(text ?? ''));
}

function cleanString(v, max) {
  if (typeof v !== 'string') return '';
  // Strip control characters and markup-ish brackets; collapse whitespace.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/**
 * Validate and normalise a scenario (e.g. parsed model output). Returns {ok, scenario?, error?}.
 */
export function validateScenario(raw, { modeId, difficulty = 'normal', source = 'model' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not-an-object' };
  if (!MODES.some((m) => m.id === modeId)) return { ok: false, error: 'unknown-mode' };
  const title = cleanString(raw.title, LIMITS.title);
  const setup = cleanString(raw.setup, LIMITS.setup);
  const ask = cleanString(raw.ask, LIMITS.ask);
  const twist = cleanString(raw.twist, LIMITS.twist) || null;
  const bonus = cleanString(raw.bonus, LIMITS.bonus) || null;
  if (title.length < 3) return { ok: false, error: 'title-missing' };
  if (setup.length < 25) return { ok: false, error: 'setup-too-short' };
  if (ask.length < 3) return { ok: false, error: 'ask-missing' };
  if ([title, setup, ask, twist, bonus].some(isUnsafeText)) return { ok: false, error: 'unsafe' };
  return {
    ok: true,
    scenario: { id: newId(source), modeId, difficulty, source, title, setup, ask, twist, bonus, ingredients: [] },
  };
}

function words(s) {
  return new Set(
    String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3),
  );
}

/** Jaccard similarity of significant words. */
export function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** True if the scenario is a repeat or a trivial rewording of something recent. */
export function isRepeat(scenario, recent, threshold = 0.5) {
  const key = scenarioKey(scenario);
  return recent.some((r) => r.key === key || similarity(r.setup, scenario.setup) >= threshold);
}
