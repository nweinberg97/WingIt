// Feedback schema, JSON-schema builder for constrained decoding, and runtime validation.
import { DIMENSIONS, getMode } from './modes.js';

export const FEEDBACK_LIMITS = Object.freeze({
  overall: 320, quote: 160, why: 300, worked: 360, tryNext: 300, technique: 60, example: 320, reason: 200, closing: 140,
});

/** JSON schema handed to the model runtime for grammar-constrained output. */
export function feedbackJsonSchema(modeId) {
  const dims = getMode(modeId).rubric;
  return {
    type: 'object',
    properties: {
      on_topic: { type: 'boolean' },
      overall_feedback: { type: 'string' },
      strongest_move: {
        type: 'object',
        properties: { quote: { type: 'string' }, why: { type: 'string' } },
        required: ['quote', 'why'],
      },
      what_worked: { type: 'string' },
      try_next: { type: 'string' },
      alternative_approach: {
        type: 'object',
        properties: { technique: { type: 'string' }, example: { type: 'string' } },
        required: ['technique', 'example'],
      },
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string', enum: dims },
            score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
            reason: { type: 'string' },
          },
          required: ['dimension', 'score', 'reason'],
        },
      },
      closing_line: { type: 'string' },
    },
    required: ['on_topic', 'overall_feedback', 'strongest_move', 'what_worked', 'try_next', 'alternative_approach', 'scores', 'closing_line'],
  };
}

/** Extract a JSON object from model text, tolerating code fences or stray prose. */
export function parseModelJson(text) {
  if (typeof text !== 'string') throw new Error('empty-output');
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error('malformed-json');
  }
}

function str(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

/** Does the quote really appear (approximately) in the transcript? Guards against fabricated quotes. */
export function quoteAppearsIn(quote, transcript) {
  const q = normalise(quote);
  const t = normalise(transcript);
  if (!q) return false;
  if (t.includes(q)) return true;
  const qw = q.split(' ');
  if (qw.length < 3) return false;
  // Accept if most consecutive 3-word windows of the quote appear in the transcript (minor transcription drift).
  let hits = 0;
  let total = 0;
  for (let i = 0; i + 3 <= qw.length; i++) {
    total += 1;
    if (t.includes(qw.slice(i, i + 3).join(' '))) hits += 1;
  }
  return total > 0 && hits / total >= 0.6;
}

/**
 * Validate model feedback. Returns {ok, feedback?, error?}.
 * The validated object is plain data; the UI renders every field with textContent.
 */
export function validateFeedback(raw, { modeId, transcript }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not-an-object' };
  const rubric = getMode(modeId).rubric;
  const L = FEEDBACK_LIMITS;

  const overall = str(raw.overall_feedback, L.overall);
  const worked = str(raw.what_worked, L.worked);
  const tryNext = str(raw.try_next, L.tryNext);
  const closing = str(raw.closing_line, L.closing);
  if (!overall || !tryNext) return { ok: false, error: 'missing-core-fields' };

  const sm = raw.strongest_move && typeof raw.strongest_move === 'object' ? raw.strongest_move : {};
  let quote = str(sm.quote, L.quote).replace(/^["“']+|["”']+$/g, '');
  if (quote && !quoteAppearsIn(quote, transcript)) quote = ''; // never show words the user didn't say
  const strongest = { quote, why: str(sm.why, L.why) };

  const alt = raw.alternative_approach && typeof raw.alternative_approach === 'object' ? raw.alternative_approach : null;
  const alternative = alt && str(alt.example, L.example)
    ? { technique: str(alt.technique, L.technique) || 'Another way in', example: str(alt.example, L.example) }
    : null;

  if (!Array.isArray(raw.scores)) return { ok: false, error: 'scores-missing' };
  const seen = new Map();
  for (const s of raw.scores) {
    if (!s || typeof s !== 'object') continue;
    const dim = typeof s.dimension === 'string' ? s.dimension : '';
    if (!rubric.includes(dim) || seen.has(dim)) continue;
    const n = Number(s.score);
    if (!Number.isInteger(n) || n < 1 || n > 5) continue;
    seen.set(dim, { dimension: dim, label: DIMENSIONS[dim].label, score: n, reason: str(s.reason, L.reason) });
  }
  if (seen.size < rubric.length) return { ok: false, error: 'scores-incomplete' };
  const scores = rubric.map((d) => seen.get(d));

  return {
    ok: true,
    feedback: {
      onTopic: raw.on_topic !== false,
      overall,
      strongest,
      worked,
      tryNext,
      alternative,
      scores,
      closing,
    },
  };
}

/** A friendly reaction keyed off the actual average score (not hardcoded praise). */
export function reactionFor(feedback) {
  const avg = feedback.scores.reduce((a, s) => a + s.score, 0) / feedback.scores.length;
  if (!feedback.onTopic) return { word: 'Detour!', tone: 'detour' };
  if (avg >= 4.5) return { word: 'Standing ovation', tone: 'top' };
  if (avg >= 3.7) return { word: 'That landed', tone: 'high' };
  if (avg >= 2.7) return { word: 'Good bones', tone: 'mid' };
  return { word: 'Warm-up round', tone: 'low' };
}

/** Plain-text export for the copy button. */
export function feedbackToText(feedback, scenario, transcript) {
  const lines = [
    `${scenario.title}`,
    `${scenario.setup} ${scenario.ask}`,
    '',
    `My answer: ${transcript}`,
    '',
    `Overall: ${feedback.overall}`,
  ];
  if (feedback.strongest.why) lines.push(`Strongest move: ${feedback.strongest.quote ? `"${feedback.strongest.quote}" – ` : ''}${feedback.strongest.why}`);
  if (feedback.worked) lines.push(`What worked: ${feedback.worked}`);
  lines.push(`Try this next: ${feedback.tryNext}`);
  if (feedback.alternative) lines.push(`A different direction (${feedback.alternative.technique}): ${feedback.alternative.example}`);
  for (const s of feedback.scores) lines.push(`${s.label}: ${s.score}/5 – ${s.reason}`);
  return lines.join('\n');
}
