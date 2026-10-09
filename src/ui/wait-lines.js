// Lines shown in the waiting pop-up while the coach reads an answer. Original, playful, never mean.
export const WAIT_LINES = [
  'Consulting the council of improv elders…',
  'Yes-and-ing your answer…',
  'Teaching a toaster to laugh…',
  'Rehearsing a dramatic pause…',
  'Sweeping the stage for loose puns…',
  'Asking the audience for a suggestion…',
  'Warming up the spotlight…',
  'Rereading your best line with feeling…',
  'Polishing the scorecard pips…',
  'Calming down an overexcited metaphor…',
  'Finding the callback you didn\'t know you made…',
  'Untangling the plot twist…',
  'Checking whether that was a bit…',
  'It was a bit. Noting that…',
  'Bribing the critic with snacks…',
  'Counting your specific details on tiny fingers…',
  'Doing a quick zip-zap-zop…',
  'Pacing backstage, nervously…',
  'Translating your genius into notes…',
  'Holding for laughter…',
  'Looking for the game of the scene…',
  'Raising the stakes, then lowering them gently…',
  'Writing notes on a very small napkin…',
  'Adjusting the coach\'s reading glasses…',
  'Practising a supportive nod…',
];

export function shuffledLines(rng = Math.random) {
  const a = [...WAIT_LINES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
