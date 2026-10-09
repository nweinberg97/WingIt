// Mode registry. Every mode is pure data: adding a mode means adding an entry here
// (plus deck ingredients in deck.js). Generation, evaluation, scoring and UI read from it.

/** Scoring dimensions shared across modes. Each has explicit 1–5 criteria. */
export const DIMENSIONS = Object.freeze({
  acceptance: {
    label: 'Yes-and',
    criteria: {
      1: 'Rejects, ignores or resets the premise.',
      2: 'Acknowledges the premise but adds nothing to it.',
      3: 'Accepts the premise and adds one modest new element.',
      4: 'Clearly builds on the premise with a specific new development.',
      5: 'Embraces the premise and adds a development that makes the scene bigger or richer.',
    },
  },
  specificity: {
    label: 'Specificity',
    criteria: {
      1: 'Vague or generic; could fit any scenario.',
      2: 'Mostly general with one hint of detail.',
      3: 'Includes at least one concrete, vivid detail.',
      4: 'Several concrete details that make the moment feel real.',
      5: 'Details are precise, surprising and do real work in the response.',
    },
  },
  surprise: {
    label: 'Surprise',
    criteria: {
      1: 'Entirely predictable.',
      2: 'One mildly unexpected beat.',
      3: 'A clear unexpected choice or reframe.',
      4: 'An inventive turn that recontextualises the situation.',
      5: 'A genuinely delightful twist that still fits the scene.',
    },
  },
  escalation: {
    label: 'Heightening',
    criteria: {
      1: 'Stays flat or deflates the premise.',
      2: 'Hints at raising the stakes.',
      3: 'Raises stakes or absurdity once.',
      4: 'Builds in clear steps, each bigger than the last.',
      5: 'Escalates with a satisfying pattern or payoff.',
    },
  },
  progression: {
    label: 'Story drive',
    criteria: {
      1: 'Nothing happens; the story stalls.',
      2: 'Describes but does not advance.',
      3: 'Moves the story one meaningful step.',
      4: 'Advances the story and introduces tension or a question.',
      5: 'Advances, deepens and leaves a strong hook for what comes next.',
    },
  },
  composure: {
    label: 'Composure',
    criteria: {
      1: 'The response unravels or escalates the conflict unhelpfully.',
      2: 'Engages but loses the thread.',
      3: 'Handles the moment adequately and stays on track.',
      4: 'Handles it gracefully, acknowledging others and steering constructively.',
      5: 'Turns a tough moment into a win for everyone involved.',
    },
  },
  clarity: {
    label: 'Clarity',
    criteria: {
      1: 'Hard to follow what is being said.',
      2: 'The main point is muddy.',
      3: 'The main point comes across.',
      4: 'Clear and well organised for something improvised.',
      5: 'Crisp, memorable and easy to follow.',
    },
  },
  adaptability: {
    label: 'Adaptability',
    criteria: {
      1: 'Ignores the complication.',
      2: 'Mentions the complication but does not deal with it.',
      3: 'Deals with the complication sensibly.',
      4: 'Uses the complication to move forward.',
      5: 'Turns the complication into the best part of the response.',
    },
  },
  responsiveness: {
    label: 'On the prompt',
    criteria: {
      1: 'Unrelated to the scenario.',
      2: 'Loosely connected to the scenario.',
      3: 'Addresses the scenario.',
      4: 'Addresses the scenario and its objective directly.',
      5: 'Nails the objective in a way only this scenario could inspire.',
    },
  },
});

export const MODES = Object.freeze([
  {
    id: 'think-fast',
    name: 'Think Fast',
    short: 'Instant reactions to strange moments.',
    color: 'tomato',
    glyph: 'bolt',
    objective: 'Respond quickly and commit to a clear, specific choice in an unexpected situation.',
    generation:
      'A sudden, specific situation that demands an immediate reply: a strange customer request, an awkward encounter, an unexpected announcement or a difficult question. The user speaks as themselves or as a clearly given role.',
    rubric: ['responsiveness', 'specificity', 'adaptability'],
    feedbackStyle: 'Energetic and quick. Celebrate decisiveness; point out where a sharper detail would land harder.',
    challenge: { seconds: 30, label: '30-second answer' },
  },
  {
    id: 'yes-and',
    name: 'Yes, And…',
    short: 'Accept the offer. Add something new.',
    color: 'lime',
    glyph: 'plus',
    objective: 'Accept everything your scene partner has established, then add one new, specific development.',
    generation:
      'A scene partner has just made an offer (a line of dialogue establishing who, where and what). Quote the partner\'s line. The user must continue the scene in character.',
    rubric: ['acceptance', 'specificity', 'surprise'],
    feedbackStyle: 'Warm and collaborative, like a good scene partner. Name exactly what was accepted and what was added.',
    challenge: { seconds: 45, label: '45-second scene' },
  },
  {
    id: 'funnier',
    name: 'Make It Funnier',
    short: 'Turn the mundane into a bit.',
    color: 'violet',
    glyph: 'squiggle',
    objective: 'Take an ordinary premise and make it more entertaining through specificity, contrast, escalation or reinterpretation.',
    generation:
      'A deliberately mundane premise (an everyday task, object or announcement). The user must make it entertaining. Do not require jokes; any playful approach counts.',
    rubric: ['surprise', 'escalation', 'specificity'],
    feedbackStyle: 'Playful, like a comedy writer in a writers\' room. Never require a particular comedic style; explain why a choice is funny.',
    challenge: { seconds: 45, label: '45-second bit' },
  },
  {
    id: 'story',
    name: 'Story Builder',
    short: 'Take the opening line somewhere.',
    color: 'teal',
    glyph: 'spiral',
    objective: 'Continue an unusual opening and move the story forward with detail, tension or a turn.',
    generation:
      'The first one or two sentences of a story with an unusual hook. The user continues the story out loud.',
    rubric: ['progression', 'specificity', 'surprise'],
    feedbackStyle: 'Like an encouraging storyteller. Point to the moment the story moved and the question it now raises.',
    challenge: { seconds: 60, label: '60-second chapter' },
  },
  {
    id: 'pressure',
    name: 'Under Pressure',
    short: 'Stay composed when it gets awkward.',
    color: 'amber',
    glyph: 'gauge',
    objective: 'Handle an awkward or challenging moment clearly and constructively while staying composed.',
    generation:
      'An awkward or tense but low-stakes, everyday situation (work, social, service) where someone is waiting for the user\'s reply. Include who is waiting and what just happened.',
    rubric: ['composure', 'clarity', 'adaptability'],
    feedbackStyle:
      'Calm and practical, like a supportive coach. Do not treat assertiveness as the only good style; warmth, humour and honesty can all work.',
    challenge: { seconds: 45, label: '45-second save' },
  },
  {
    id: 'wildcard',
    name: 'Wildcard',
    short: 'Surreal, absurd, anything goes.',
    color: 'pink',
    glyph: 'star',
    objective: 'Commit fully to a surreal premise and play it with confidence and invention.',
    generation:
      'A surreal, absurd or dreamlike premise that does not fit other modes: talking objects, impossible jobs, strange laws of physics, ceremonies for nonsense. Give the user a role and a goal.',
    rubric: ['acceptance', 'surprise', 'responsiveness'],
    feedbackStyle: 'Delighted and a little weird. Reward full commitment to the logic of the absurd world.',
    challenge: { seconds: 45, label: '45-second wild ride' },
  },
]);

export function getMode(id) {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

export const DIFFICULTIES = Object.freeze({
  easy: { label: 'Gentle', guidance: 'Keep the situation simple, friendly and easy to enter.' },
  normal: { label: 'Classic', guidance: 'One clear complication.' },
  spicy: { label: 'Spicy', guidance: 'Add an extra complication or a tricky constraint that makes it harder.' },
});

export function harder(level) {
  return level === 'easy' ? 'normal' : 'spicy';
}
export function easier(level) {
  return level === 'spicy' ? 'normal' : 'easy';
}
