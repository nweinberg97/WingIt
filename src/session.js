// Pure game-session state machine. All async results carry a token; stale ones are ignored.

export const PHASES = Object.freeze(['ready', 'recording', 'transcribing', 'review', 'evaluating', 'feedback']);

export function initialState() {
  return {
    phase: 'ready',
    scenario: null,
    token: 0,
    transcript: '',
    preview: '',
    submitted: '',
    feedback: null,
    error: null,
    roundsThisSession: 0,
    takes: 0,
  };
}

const idleFor = (s) => (s.transcript.trim() ? 'review' : 'ready');

export function transition(state, event) {
  const s = state;
  switch (event.type) {
    case 'NEW_SCENARIO':
      return { ...s, phase: 'ready', scenario: event.scenario, token: s.token + 1, transcript: '', preview: '', submitted: '', feedback: null, error: null, takes: 0 };

    case 'RETRY':
      if (!s.scenario) return s;
      return { ...s, phase: 'ready', token: s.token + 1, transcript: '', preview: '', submitted: '', feedback: null, error: null, takes: s.takes + 1 };

    case 'RECORD_START':
      if (!['ready', 'review'].includes(s.phase)) return s;
      return { ...s, phase: 'recording', preview: '', error: null };

    case 'PARTIAL':
      if (s.phase !== 'recording' || event.token !== s.token) return s;
      return { ...s, preview: event.text };

    case 'RECORD_STOP':
      if (s.phase !== 'recording') return s;
      return { ...s, phase: 'transcribing' };

    case 'RECORD_CANCEL':
      if (s.phase !== 'recording' && s.phase !== 'transcribing') return s;
      return { ...s, phase: idleFor(s), preview: '' };

    case 'TRANSCRIBED':
      if (s.phase !== 'transcribing' || event.token !== s.token) return s;
      return { ...s, phase: 'review', transcript: event.text, preview: '', error: null };

    case 'TRANSCRIBE_FAILED':
      if (event.token !== s.token || !['transcribing', 'recording'].includes(s.phase)) return s;
      return { ...s, phase: idleFor(s), preview: '', error: event.error };

    case 'MIC_ERROR':
      return { ...s, phase: idleFor(s), preview: '', error: event.error };

    case 'EDIT':
      if (!['ready', 'review'].includes(s.phase)) return s;
      return { ...s, transcript: event.text, phase: event.text.trim() ? 'review' : 'ready' };

    case 'SUBMIT':
      if (s.phase !== 'review' || !event.text) return s;
      return { ...s, phase: 'evaluating', submitted: event.text, transcript: event.text, error: null };

    case 'EVALUATED':
      if (s.phase !== 'evaluating' || event.token !== s.token) return s;
      return { ...s, phase: 'feedback', feedback: event.feedback, roundsThisSession: s.roundsThisSession + 1 };

    case 'EVAL_FAILED':
      if (s.phase !== 'evaluating' || event.token !== s.token) return s;
      return { ...s, phase: 'review', error: event.error };

    case 'CANCEL_EVAL':
      if (s.phase !== 'evaluating') return s;
      return { ...s, phase: 'review', token: s.token + 1 };

    case 'SET_ERROR':
      return { ...s, error: event.error };

    case 'DISMISS_ERROR':
      return { ...s, error: null };

    default:
      return s;
  }
}
