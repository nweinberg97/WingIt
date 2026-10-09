// The Deck: an offline, procedural scenario generator built from structured ingredients.
// It is used instantly (no model needed) and whenever the AI coach is unavailable.
// Scenarios from here are always labelled source: 'deck' so the UI never presents them as AI output.

const pools = {
  places: [
    'a hot-air balloon stuck over a petting zoo', 'the lost-and-found office of a giant airport', 'a 24-hour laundromat at 3 a.m.',
    'the waiting room of a very small dentist', 'a lighthouse that has started taking reservations', 'a library where shushing is a competitive sport',
    'a ski lift that has stopped halfway up', 'a cruise ship\'s karaoke lounge', 'a museum of things people almost invented',
    'an elevator that only goes sideways', 'a farmers\' market on the Moon', 'a wedding held inside a car wash',
    'a support group for retired superheroes', 'a bakery during a power cut', 'a submarine on its first day of tourism',
    'the break room of a haunted theme park', 'a pet hotel during a thunderstorm', 'a silent retreat with a broken gong',
  ],
  roles: [
    'the new night manager', 'a substitute tour guide who has never been here', 'a wedding planner on their first job',
    'a customer-service rep for an invisible product', 'a museum docent', 'an overly proud grandparent', 'a botanist who talks to houseplants',
    'the official town crier', 'a spaceship\'s only flight attendant', 'a weather presenter on live TV', 'a dog-walker for seven very different dogs',
    'a hotel concierge', 'a nervous best person giving a toast', 'the head of the neighbourhood committee', 'an IKEA-style furniture instruction writer',
  ],
  things: [
    'a self-heating ice cube', 'an umbrella that only works indoors', 'a GPS that gives directions emotionally', 'a toaster with opinions',
    'socks that predict the weather', 'a candle that smells like Mondays', 'a fridge that refuses to open after 10 p.m.', 'a pillow that tells bedtime gossip',
    'a doorbell that plays dramatic music', 'a vacuum cleaner afraid of dust', 'a smart mirror that only gives compliments to other people',
    'a bicycle with a sense of direction', 'an alarm clock that negotiates', 'a pen that writes what you meant to say',
  ],
  complications: [
    'the microphone keeps cutting out every few words', 'your notes have been replaced with a pizza menu', 'your rival has just walked in',
    'a toddler has started copying everything you say', 'the lights go out halfway through', 'someone keeps taking photos with flash',
    'you realise you have been calling them by the wrong name', 'a pigeon has landed on your shoulder and will not leave',
    'your phone starts loudly playing your own voice memo', 'the person you most need to impress has fallen asleep',
    'everyone in the room is suddenly speaking in whispers', 'it turns out this is being livestreamed',
  ],
  bonusWords: [
    'kumquat', 'velcro', 'tuba', 'meringue', 'spreadsheet', 'flamingo', 'lasagne', 'trampoline', 'moustache', 'periscope',
    'cardigan', 'blimp', 'avocado', 'harpsichord', 'confetti', 'wombat', 'yodel', 'origami', 'snorkel', 'marmalade',
  ],
  bonusRules: [
    'Include a question you never answer.', 'Mention a specific number.', 'Name a smell.', 'Give a tiny character a name.',
    'End on a cliffhanger.', 'Use one sound effect, out loud.', 'Mention the weather.', 'Bring back something you said at the start.',
  ],
};

const templates = {
  'think-fast': [
    (p) => ({ title: 'The impossible request', setup: `You are ${p.role} at ${p.place}. A customer asks, with total confidence, for a refund on ${p.thing} they never bought.`, ask: 'Answer them right now.' }),
    (p) => ({ title: 'Surprise announcement', setup: `You are ${p.role}. You have just been handed a card and told to announce to everyone at ${p.place} that ${p.thing} has gone missing.`, ask: 'Make the announcement.' }),
    (p) => ({ title: 'The difficult question', setup: `A curious child at ${p.place} points at you and asks: "Why do you exist?" You are ${p.role}.`, ask: 'Give them an answer.' }),
    (p) => ({ title: 'Wrong meeting', setup: `You walk into what you thought was a team lunch. It is actually a product launch for ${p.thing}, and everyone thinks you are the keynote speaker.`, ask: 'Start the keynote.' }),
    (p) => ({ title: 'Elevator pitch, literally', setup: `You are stuck in an elevator with a billionaire who says you have until the doors open to pitch ${p.thing}.`, ask: 'Pitch it.' }),
  ],
  'yes-and': [
    (p) => ({ title: 'Scene partner offer', setup: `Your scene partner says: "Captain, the coffee shop on Mars has our names on the cups. We have never been here." You are both astronauts.`, ask: 'Accept it and add an unexpected development.' }),
    (p) => ({ title: 'Scene partner offer', setup: `Your scene partner says: "Welcome back to ${p.place}. We kept your old job open. And your old desk. And your old, very angry goldfish."`, ask: 'Say yes, and build the scene.' }),
    (p) => ({ title: 'Scene partner offer', setup: `Your scene partner hands you an imaginary box and says: "This is ${p.thing}. Grandma said only you would know what to do with it."`, ask: 'Accept the gift and add something new.' }),
    (p) => ({ title: 'Scene partner offer', setup: `Your scene partner says: "I can't believe you're ${p.role} now. Last week you were afraid of ${p.thing}."`, ask: 'Accept the history and push the scene forward.' }),
    (p) => ({ title: 'Scene partner offer', setup: `Your scene partner whispers: "Don't look now, but everyone at ${p.place} thinks we're royalty."`, ask: 'Yes, and…' }),
  ],
  funnier: [
    (p) => ({ title: 'The mundane memo', setup: 'The office printer is out of toner. Someone has to tell the team.', ask: 'Make this announcement as entertaining as you can.' }),
    (p) => ({ title: 'Grocery list, dramatised', setup: 'You need to buy milk, eggs and bin bags.', ask: 'Present your grocery list to an audience as if it matters enormously.' }),
    (p) => ({ title: 'Product review', setup: `Review a perfectly ordinary paperclip, as ${p.role}.`, ask: 'Make the review delightful.' }),
    (p) => ({ title: 'Weather report', setup: 'Tomorrow will be mild, slightly cloudy, with no rain.', ask: 'Deliver the forecast and make it entertaining.' }),
    (p) => ({ title: 'Instruction manual', setup: 'Explain how to boil an egg.', ask: 'Turn the instructions into something fun to listen to.' }),
    (p) => ({ title: 'Out-of-office message', setup: 'You will be away from work on Thursday afternoon.', ask: 'Record the most entertaining out-of-office message you can.' }),
  ],
  story: [
    (p) => ({ title: 'Opening line', setup: `"On the morning the town's clocks all started running backwards, I found ${p.thing} on my doorstep with a note addressed to someone who hadn't been born yet."`, ask: 'Continue the story.' }),
    (p) => ({ title: 'Opening line', setup: `"Nobody had ever opened the last door at ${p.place}. Then, on a Tuesday, it knocked."`, ask: 'What happens next?' }),
    (p) => ({ title: 'Opening line', setup: `"My grandmother left me two things: ${p.thing}, and a map with one place circled and the words DON'T BE LATE."`, ask: 'Keep the story going.' }),
    (p) => ({ title: 'Opening line', setup: `"The job advert said: ${p.role.charAt(0).toUpperCase() + p.role.slice(1)} wanted. No experience necessary. Must not be afraid of the dark, or of the light."`, ask: 'Continue from here.' }),
    (p) => ({ title: 'Opening line', setup: '"The dog came home wearing a tiny hat and a look that said: we need to talk."', ask: 'Tell us what happened next.' }),
  ],
  pressure: [
    (p) => ({ title: 'The awkward apology', setup: 'You accidentally sent your boss a voice note meant for your group chat. It is 45 seconds of you reviewing their presentation. They have replied: "Interesting."', ask: 'Call them back and handle it.' }),
    (p) => ({ title: 'The impossible customer', setup: 'You work at a hotel. A guest insists their room is haunted by a ghost who only complains about the Wi-Fi.', ask: 'Resolve the situation without losing the guest.' }),
    (p) => ({ title: 'Name blank', setup: 'A friendly person greets you warmly by name at a party. You have absolutely no idea who they are, and they are about to introduce you to their partner.', ask: 'Handle the introduction.' }),
    (p) => ({ title: 'Toast gone wrong', setup: 'You stand up to give a toast at a friend\'s birthday dinner and realise you\'ve forgotten everything you planned to say. Everyone is looking at you.', ask: 'Give the toast.' }),
    (p) => ({ title: 'Live question', setup: 'You are presenting to your team. A colleague asks a question you genuinely do not know the answer to, and your manager is listening.', ask: 'Answer them.' }),
    (p) => ({ title: 'Double-booked', setup: 'Two friends arrive at the same café, both believing they have dinner plans with you tonight. They have not met before.', ask: 'Talk your way through it.' }),
  ],
  wildcard: [
    (p) => ({ title: 'Ministry of Nonsense', setup: `You have been appointed Minister for ${p.thing}. Your first press conference starts now.`, ask: 'Announce your first new policy.' }),
    (p) => ({ title: 'Interspecies diplomacy', setup: 'The pigeons of your city have formed a government and requested a formal meeting. You are the human ambassador.', ask: 'Open negotiations.' }),
    (p) => ({ title: 'Gravity has opinions', setup: `Gravity now only works on things it likes. You are ${p.role} and must explain this to a nervous crowd at ${p.place}.`, ask: 'Calm them down.' }),
    (p) => ({ title: 'The pet translator', setup: 'You have invented a machine that translates what pets are really thinking. Your first live demo for investors is a disaster.', ask: 'Keep the demo alive.' }),
    (p) => ({ title: 'Award for the overlooked', setup: `You are presenting a lifetime achievement award to ${p.thing}.`, ask: 'Give the presentation speech.' }),
    (p) => ({ title: 'Time-travel customer service', setup: 'A caller from the year 1823 is ringing your helpline to complain about a product that will not be invented for another 200 years.', ask: 'Help them.' }),
  ],
};

/** Mulberry32 seeded PRNG so tests can be deterministic. */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFresh(rng, list, avoid) {
  const fresh = list.filter((x) => !avoid.has(x));
  const from = fresh.length ? fresh : list;
  return from[Math.floor(rng() * from.length)];
}

/** Returns random ingredients, avoiding recently used ones. Also used to seed AI generation. */
export function pickIngredients(rng, recentIngredients = new Set()) {
  return {
    place: pickFresh(rng, pools.places, recentIngredients),
    role: pickFresh(rng, pools.roles, recentIngredients),
    thing: pickFresh(rng, pools.things, recentIngredients),
    complication: pickFresh(rng, pools.complications, recentIngredients),
    bonusWord: pickFresh(rng, pools.bonusWords, recentIngredients),
    bonusRule: pickFresh(rng, pools.bonusRules, recentIngredients),
  };
}

let counter = 0;
export function newId(prefix = 's') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Build a scenario from the deck.
 * @param {{modeId:string, difficulty?:'easy'|'normal'|'spicy', rng?:()=>number, recentKeys?:Set<string>, recentIngredients?:Set<string>, bonusChance?:number}} opts
 */
export function deckScenario({ modeId, difficulty = 'normal', rng = Math.random, recentKeys = new Set(), recentIngredients = new Set(), bonusChance = 0.25 }) {
  const list = templates[modeId] ?? templates['think-fast'];
  const ing = pickIngredients(rng, recentIngredients);
  // Prefer a template whose rendered key hasn't been seen recently.
  const order = list.map((_, i) => i).sort(() => rng() - 0.5);
  let chosen = null;
  let key = '';
  for (const i of order) {
    const draft = list[i](ing);
    key = scenarioKey(draft);
    chosen = draft;
    if (!recentKeys.has(key)) break;
  }
  const scenario = {
    id: newId('deck'),
    modeId,
    difficulty,
    source: 'deck',
    title: chosen.title,
    setup: chosen.setup,
    ask: chosen.ask,
    twist: null,
    bonus: null,
    ingredients: [ing.place, ing.role, ing.thing].filter((x) => chosen.setup.includes(x)),
  };
  if (difficulty === 'spicy') {
    scenario.twist = `Twist: ${ing.complication}.`;
    scenario.ingredients.push(ing.complication);
  }
  if (difficulty !== 'easy' && rng() < bonusChance) {
    scenario.bonus = rng() < 0.5 ? `Bonus: work in the word "${ing.bonusWord}".` : `Bonus: ${ing.bonusRule}`;
  }
  return scenario;
}

/** Same scenario, one notch harder: adds a complication (and a bonus if still room). */
export function harderVersion(s, rng = Math.random) {
  if (s.difficulty === 'spicy' && s.twist && s.bonus) return s;
  const used = new Set(s.ingredients ?? []);
  const comp = pickFresh(rng, pools.complications, used);
  const next = { ...s, id: newId(s.source), difficulty: 'spicy', ingredients: [...(s.ingredients ?? []), comp] };
  if (!s.twist) next.twist = `Twist: ${comp}.`;
  else if (!s.bonus) next.bonus = `Bonus: ${pickFresh(rng, pools.bonusRules, used)}`;
  return next;
}

/** Same scenario, gentler: drops the twist and the bonus. */
export function easierVersion(s) {
  return { ...s, id: newId(s.source), difficulty: 'easy', twist: null, bonus: null };
}

export function scenarioKey(s) {
  return `${s.title}|${s.setup}`.toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
}

export const DECK_MODE_IDS = Object.keys(templates);
export const _pools = pools;
