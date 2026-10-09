// Dad jokes for the waiting pop-up. Mostly improv and stage puns written for WingIt, plus a few
// groan-worthy classics. Each joke is a setup and a punchline so the show can land the beat.
export const JOKES = [
  { setup: 'Why did the improviser bring a ladder to the show?', punch: 'Someone told them to raise the stakes.' },
  { setup: 'How many improvisers does it take to change a light bulb?', punch: 'Yes. And the bulb is actually your long-lost brother.' },
  { setup: 'Why don\'t improvisers ever lose their keys?', punch: 'They always find a way to make it work.' },
  { setup: 'What do you call a mime who breaks the rules?', punch: 'Someone who says too much.' },
  { setup: 'Why was the mime arrested?', punch: 'He was resisting a rest.' },
  { setup: 'Why did the scene partner bring a pencil?', punch: 'To draw on the suggestion.' },
  { setup: 'What\'s an improviser\'s favourite kind of math?', punch: 'Addition. Yes, and…' },
  { setup: 'Why are improv shows so calm?', punch: 'Nobody ever says "no" to anybody.' },
  { setup: 'What did the spotlight say to the nervous actor?', punch: 'Don\'t worry, I\'ve got you covered.' },
  { setup: 'Why did the stage curtain break up with the audience?', punch: 'It needed some time to draw itself together.' },
  { setup: 'How does an improviser order coffee?', punch: '"I\'ll have a latte, and…"' },
  { setup: 'What do you call an improv show with no suggestions?', punch: 'A monologue with commitment issues.' },
  { setup: 'Why did the microphone go to therapy?', punch: 'People kept tapping it to see if it was OK.' },
  { setup: 'Why are pianos so hard to open?', punch: 'The keys are inside.' },
  { setup: 'What do you call a fake noodle?', punch: 'An impasta.' },
  { setup: 'Why don\'t skeletons fight each other?', punch: 'They don\'t have the guts.' },
  { setup: 'Why did the scarecrow win an award?', punch: 'He was outstanding in his field.' },
  { setup: 'What do you call a bear with no teeth?', punch: 'A gummy bear.' },
  { setup: 'Why did the cookie go to the doctor?', punch: 'It was feeling a bit crumby.' },
  { setup: 'What did the ocean say to the beach?', punch: 'Nothing. It just waved.' },
  { setup: 'Why do improvisers make great chefs?', punch: 'They can cook up a scene from nothing.' },
  { setup: 'Why did the actor fall through the stage floor?', punch: 'It was just a stage they were going through.' },
  { setup: 'Why was the improv troupe so good at volleyball?', punch: 'They never drop an offer.' },
  { setup: 'What\'s a stand-up comedian\'s least favourite furniture?', punch: 'The chair. They\'d rather stand.' },
  { setup: 'What did one improviser say to the other at the bakery?', punch: '"Let\'s make this scene rise."' },
  { setup: 'How do you know an improviser liked your idea?', punch: 'They yes-and it into a three-act opera.' },
  { setup: 'Why did the drummer get a job at the comedy club?', punch: 'Someone has to land the punchlines.' },
  { setup: 'What do you call two improvisers stuck in an elevator?', punch: 'A long-form show.' },
  { setup: 'Why was the clock on stage so nervous?', punch: 'It kept getting wound up before its big second.' },
  { setup: 'I asked the audience for a suggestion.', punch: 'They suggested I stop asking. Yes, and I won\'t.' },
  { setup: 'Why did the egg do improv?', punch: 'It wanted to come out of its shell.' },
  { setup: 'What do you call a dinosaur that can\'t stop improvising?', punch: 'A thesaurus-rex. Always another word.' },
  { setup: 'Why did the coach bring a notebook to your round?', punch: 'You were giving it material.' },
  { setup: 'What\'s an improviser\'s favourite exercise?', punch: 'Jumping to conclusions. With full commitment.' },
  { setup: 'Why don\'t eggs tell each other jokes?', punch: 'They\'d crack each other up.' },
  { setup: 'Why did the bicycle fall over?', punch: 'It was two tired.' },
];

export function shuffledJokes(rng = Math.random) {
  const a = [...JOKES];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
