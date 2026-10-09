// "Mic" — WingIt's stand-up comedian. A hand-built SVG scene (velvet curtains, spotlight, drum kit)
// with an expressive microphone character. CSS drives the idle loops (blink, glance, sway);
// the waiting pop-up drives the beats: talk() while a joke types out, punch() when it lands.
import { svg } from './dom.js';

const g = (attrs, ...kids) => svg('g', attrs, ...kids);

function defs() {
  const stop = (offset, color, opacity = 1) => svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity });
  return svg(
    'defs',
    {},
    svg('linearGradient', { id: 'ws-curtain', x1: 0, x2: 1, y1: 0, y2: 0 },
      stop(0, '#a8262d'), stop(0.18, '#f0565c'), stop(0.36, '#b52b32'), stop(0.55, '#f26a6f'), stop(0.75, '#b52b32'), stop(1, '#e24c52')),
    svg('linearGradient', { id: 'ws-valance', x1: 0, x2: 0, y1: 0, y2: 1 }, stop(0, '#d63c42'), stop(1, '#a8262d')),
    svg('linearGradient', { id: 'ws-beam', x1: 0, x2: 0, y1: 0, y2: 1 }, stop(0, '#fff3b0', 0.65), stop(1, '#fff3b0', 0.05)),
    svg('radialGradient', { id: 'ws-pool', cx: 0.5, cy: 0.5, r: 0.5 }, stop(0, '#fff3b0', 0.55), stop(1, '#fff3b0', 0)),
    svg('linearGradient', { id: 'ws-floor', x1: 0, x2: 0, y1: 0, y2: 1 }, stop(0, '#3d2d7c'), stop(1, '#1e1546')),
    svg('linearGradient', { id: 'ws-wall', x1: 0, x2: 0, y1: 0, y2: 1 }, stop(0, '#150e33'), stop(1, '#26195a')),
    svg('radialGradient', { id: 'ws-head', cx: 0.38, cy: 0.32, r: 0.75 }, stop(0, '#ffffff'), stop(0.55, '#dcd7f2'), stop(1, '#9d95c7')),
    svg('linearGradient', { id: 'ws-handle', x1: 0, x2: 1, y1: 0, y2: 0 }, stop(0, '#2a1f63'), stop(0.45, '#4b3d9a'), stop(1, '#211547')),
    svg('pattern', { id: 'ws-grille', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#7d74ad', 'stroke-width': 1 })),
    svg('clipPath', { id: 'ws-headclip' }, svg('ellipse', { cx: 160, cy: 76, rx: 31, ry: 33 })),
  );
}

function curtains() {
  const left = 'M0 0 H58 C50 40 62 80 50 120 C46 140 52 150 46 162 H0 Z';
  const right = 'M320 0 H262 C270 40 258 80 270 120 C274 140 268 150 274 162 H320 Z';
  return g({ class: 'ws-curtains' },
    g({ class: 'ws-curtain ws-curtain-l' }, svg('path', { d: left, fill: 'url(#ws-curtain)' })),
    g({ class: 'ws-curtain ws-curtain-r' }, svg('path', { d: right, fill: 'url(#ws-curtain)' })),
    svg('path', {
      fill: 'url(#ws-valance)',
      d: 'M0 0H320V16Q300 30 280 16Q260 30 240 16Q220 30 200 16Q180 30 160 16Q140 30 120 16Q100 30 80 16Q60 30 40 16Q20 30 0 16Z',
    }),
    svg('path', { class: 'ws-fringe', d: 'M0 17Q20 31 40 17Q60 31 80 17Q100 31 120 17Q140 31 160 17Q180 31 200 17Q220 31 240 17Q260 31 280 17Q300 31 320 17' }),
  );
}

function mic() {
  return g(
    { class: 'mc' },
    svg('ellipse', { class: 'mc-shadow', cx: 160, cy: 167, rx: 30, ry: 6 }),
    g(
      { class: 'mc-jump' },
      g(
        { class: 'mc-squash' },
        g(
          { class: 'mc-sway' },
          // arms (behind body)
          g({ class: 'mc-arm mc-arm-l' }, svg('path', { class: 'mc-limb', d: 'M148 122 Q132 124 126 138' }), svg('circle', { class: 'mc-hand', cx: 126, cy: 139, r: 5.5 })),
          g({ class: 'mc-arm mc-arm-r' }, svg('path', { class: 'mc-limb', d: 'M172 122 Q188 124 194 138' }), svg('circle', { class: 'mc-hand', cx: 194, cy: 139, r: 5.5 })),
          // feet + handle
          svg('ellipse', { class: 'mc-foot', cx: 150, cy: 162, rx: 10, ry: 5 }),
          svg('ellipse', { class: 'mc-foot', cx: 170, cy: 162, rx: 10, ry: 5 }),
          svg('path', { class: 'mc-handle', d: 'M146 112 H174 L168 156 Q160 162 152 156 Z', fill: 'url(#ws-handle)' }),
          svg('path', { class: 'mc-shine', d: 'M151 118 L155 150' }),
          svg('rect', { class: 'mc-band', x: 140, y: 104, width: 40, height: 11, rx: 5.5 }),
          // head: grille + face
          svg('ellipse', { class: 'mc-head', cx: 160, cy: 76, rx: 31, ry: 33, fill: 'url(#ws-head)' }),
          svg('rect', { x: 120, y: 40, width: 80, height: 72, fill: 'url(#ws-grille)', 'clip-path': 'url(#ws-headclip)', opacity: 0.35 }),
          svg('ellipse', { class: 'mc-gloss', cx: 148, cy: 58, rx: 9, ry: 5 }),
          g(
            { class: 'mc-face' },
            svg('ellipse', { class: 'mc-cheek', cx: 141, cy: 89, rx: 6, ry: 3.5 }),
            svg('ellipse', { class: 'mc-cheek', cx: 179, cy: 89, rx: 6, ry: 3.5 }),
            g({ class: 'mc-brows' },
              svg('path', { class: 'mc-brow', d: 'M142 63 Q149 59 155 62' }),
              svg('path', { class: 'mc-brow', d: 'M165 62 Q171 59 178 63' })),
            g({ class: 'mc-eyes' },
              svg('ellipse', { class: 'mc-eye', cx: 149, cy: 74, rx: 7, ry: 8.5 }),
              svg('ellipse', { class: 'mc-eye', cx: 171, cy: 74, rx: 7, ry: 8.5 }),
              g({ class: 'mc-pupils' },
                svg('circle', { class: 'mc-pupil', cx: 150, cy: 75, r: 3.6 }),
                svg('circle', { class: 'mc-pupil', cx: 172, cy: 75, r: 3.6 }),
                svg('circle', { class: 'mc-glint', cx: 151.4, cy: 73.4, r: 1.2 }),
                svg('circle', { class: 'mc-glint', cx: 173.4, cy: 73.4, r: 1.2 }))),
            g({ class: 'mc-happy' },
              svg('path', { class: 'mc-happy-eye', d: 'M142 76 Q149 67 156 76' }),
              svg('path', { class: 'mc-happy-eye', d: 'M164 76 Q171 67 178 76' })),
            svg('path', { class: 'mc-mouth-closed', d: 'M152 91 Q160 98 168 91' }),
            g({ class: 'mc-mouth-open' },
              svg('path', { class: 'mc-mouth-hole', d: 'M151 90 Q160 89 169 90 Q168 101 160 101 Q152 101 151 90 Z' }),
              svg('ellipse', { class: 'mc-tongue', cx: 160, cy: 98, rx: 5, ry: 2.6 })),
          ),
        ),
      ),
    ),
  );
}

function drums() {
  return g(
    { class: 'ws-drums' },
    svg('line', { class: 'ws-stand', x1: 246, y1: 124, x2: 246, y2: 162 }),
    g({ class: 'ws-cymbal' }, svg('ellipse', { cx: 246, cy: 122, rx: 15, ry: 3.4 })),
    svg('rect', { class: 'ws-drum', x: 204, y: 138, width: 30, height: 21, rx: 5 }),
    svg('ellipse', { class: 'ws-drum-top', cx: 219, cy: 138, rx: 15, ry: 4 }),
    g({ class: 'ws-stick' }, svg('line', { x1: 212, y1: 115, x2: 224, y2: 134 })),
  );
}

function burst() {
  // comic "ba-dum-tss!" starburst
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const r = i % 2 ? 22 : 34;
    pts.push(`${(250 + Math.cos(a) * r * 1.78).toFixed(1)},${(64 + Math.sin(a) * r * 0.78).toFixed(1)}`);
  }
  return g(
    { class: 'ws-burst' },
    svg('polygon', { class: 'ws-burst-shape', points: pts.join(' ') }),
    svg('text', { class: 'ws-burst-text', x: 250, y: 68, 'text-anchor': 'middle' }, document.createTextNode('ba-dum-tss!')),
  );
}

export function createStageShow() {
  const confetti = g({ class: 'ws-confetti' });
  const laughs = g(
    { class: 'ws-laughs' },
    svg('text', { class: 'ws-ha ha1', x: 34, y: 186 }, document.createTextNode('HA!')),
    svg('text', { class: 'ws-ha ha2', x: 84, y: 192 }, document.createTextNode('HA HA')),
    svg('text', { class: 'ws-ha ha3', x: 204, y: 190 }, document.createTextNode('HA!')),
  );
  const root = svg(
    'svg',
    { viewBox: '0 0 320 200', class: 'stage-show', 'aria-hidden': 'true', 'data-beat': 'idle' },
    defs(),
    svg('rect', { x: 0, y: 0, width: 320, height: 200, fill: 'url(#ws-wall)' }),
    svg('rect', { x: 0, y: 160, width: 320, height: 40, fill: 'url(#ws-floor)' }),
    svg('path', { class: 'ws-boards', d: 'M0 172H320M0 186H320' }),
    g({ class: 'ws-light' },
      svg('polygon', { class: 'ws-beam', points: '160,0 110,166 210,166', fill: 'url(#ws-beam)' }),
      svg('ellipse', { class: 'ws-pool', cx: 160, cy: 166, rx: 62, ry: 12, fill: 'url(#ws-pool)' })),
    drums(),
    mic(),
    curtains(),
    burst(),
    confetti,
    laughs,
  );

  let flapTimer = null;
  const show = {
    el: root,
    /** Flap the mouth for `ms` milliseconds (the joke is being "told"). */
    talk(ms, reduced) {
      clearInterval(flapTimer);
      root.dataset.beat = 'talk';
      if (reduced) return;
      let open = false;
      flapTimer = setInterval(() => {
        open = !open && Math.random() > 0.15;
        root.classList.toggle('mouth-open', open);
      }, 95);
      setTimeout(() => show.stopTalking(), ms);
    },
    stopTalking() {
      clearInterval(flapTimer);
      flapTimer = null;
      root.classList.remove('mouth-open');
      if (root.dataset.beat === 'talk') root.dataset.beat = 'wait';
    },
    /** The punchline lands: jump, rimshot, confetti, laughs. */
    punch(reduced) {
      show.stopTalking();
      root.dataset.beat = 'idle';
      // reflow so the CSS animations restart even on back-to-back punchlines
      void root.getBoundingClientRect();
      root.dataset.beat = 'punch';
      if (!reduced) show.confetti();
    },
    idle() {
      show.stopTalking();
      root.dataset.beat = 'idle';
    },
    confetti() {
      const colors = ['#ffd23f', '#ff6fb5', '#9fd33a', '#8c6bff', '#12a596', '#ff5b35', '#ffffff'];
      for (let i = 0; i < 26; i++) {
        const w = 3 + Math.random() * 4;
        const piece = svg('rect', { x: 160 - w / 2, y: 60, width: w, height: w * 1.8, rx: 1, fill: colors[i % colors.length] });
        confetti.append(piece);
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const dist = 60 + Math.random() * 70;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const spin = (Math.random() - 0.5) * 720;
        piece.style.transformBox = 'fill-box';
        piece.style.transformOrigin = 'center';
        const anim = piece.animate(
          [
            { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px, ${dy + 70}px) rotate(${spin}deg)`, opacity: 0 },
          ],
          { duration: 1400 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.35,1)', delay: 120 + Math.random() * 80 },
        );
        anim.onfinish = () => piece.remove();
      }
    },
    destroy() {
      clearInterval(flapTimer);
    },
  };
  return show;
}
