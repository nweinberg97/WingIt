// Shared, mode-agnostic AI services: evaluate an answer, generate a scenario.
import { feedbackJsonSchema, parseModelJson, validateFeedback } from '../feedback.js';
import { evaluationMessages, scenarioMessages, SCENARIO_JSON_SCHEMA } from '../prompts.js';
import { validateScenario, isRepeat } from '../scenario.js';
import { CoachError } from './coach.js';

/**
 * Evaluate a transcript with the local model. Retries once on malformed/invalid output.
 * Never returns canned feedback: on failure it throws, and the caller keeps the transcript.
 */
export async function evaluateAnswer(coach, scenario, transcript, { isStale, timeoutMs } = {}) {
  const messages = evaluationMessages(scenario, transcript);
  const schema = feedbackJsonSchema(scenario.modeId);
  let lastError = 'unknown';
  let emptyReplies = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, finishReason } = await coach.complete(messages, {
      schema,
      temperature: attempt === 0 ? 0.6 : 0.3,
      maxTokens: 800,
      timeoutMs,
      isStale,
    });
    if (isStale?.()) throw new CoachError('stale', 'Superseded');
    if (!text || !String(text).trim()) {
      emptyReplies += 1;
      lastError = 'empty';
      continue;
    }
    if (finishReason === 'length') {
      lastError = 'incomplete';
      continue;
    }
    let raw;
    try {
      raw = parseModelJson(text);
    } catch {
      lastError = 'malformed-json';
      continue;
    }
    const v = validateFeedback(raw, { modeId: scenario.modeId, transcript });
    if (v.ok) return v.feedback;
    lastError = v.error;
  }
  if (emptyReplies === 2) {
    // A model that says nothing at all has usually lost its GPU (out of memory). Force a fresh load next time.
    coach.set?.({ status: 'error', error: new CoachError('stalled', 'The coach stopped responding.') });
    throw new CoachError('stalled', 'The coach returned nothing twice; the graphics card may have run out of memory.');
  }
  throw new CoachError('invalid-output', `The coach's answer didn't pass validation (${lastError}).`);
}

/** Ask the model for a new scenario seeded by deck ingredients. Returns null if it can't produce a valid, fresh one. */
export async function generateScenario(coach, { modeId, difficulty, ingredients, recent, isStale }) {
  const messages = scenarioMessages({ modeId, difficulty, ingredients, avoidTitles: recent.map((r) => r.title) });
  const { text } = await coach.complete(messages, { schema: SCENARIO_JSON_SCHEMA, temperature: 0.95, maxTokens: 300, timeoutMs: 45000, isStale });
  let raw;
  try {
    raw = parseModelJson(text);
  } catch {
    return null;
  }
  const v = validateScenario(raw, { modeId, difficulty, source: 'model' });
  if (!v.ok) return null;
  if (isRepeat(v.scenario, recent)) return null;
  if (difficulty !== 'spicy') v.scenario.twist = null;
  v.scenario.ingredients = [ingredients.place, ingredients.role, ingredients.thing, ingredients.complication];
  return v.scenario;
}
