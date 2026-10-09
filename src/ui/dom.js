// Tiny DOM builder. All text goes through textContent — model output is never parsed as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button.primary', { onclick, 'aria-label': 'x' }, 'Text', child)
 * Attributes starting with "on" become listeners. `class` / `dataset` / `style` objects supported.
 */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

const GLYPHS = {
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  plus: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z',
  squiggle: 'M3 13c2-5 4-5 6 0s4 5 6 0 4-5 6 0',
  spiral: 'M12 12a1.5 1.5 0 1 1 1.5-1.5M12 12m-4 0a4 4 0 1 1 4 4M12 12m-7 0a7 7 0 1 1 7 7',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-6',
  star: 'M12 2l2.6 6.6L21 9.3l-5 4.6 1.5 7.1L12 17.3 6.5 21l1.5-7.1-5-4.6 6.4-.7z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8',
  stop: 'M7 7h10v10H7z',
  shuffle: 'M3 7h4c4 0 6 10 10 10h4M3 17h4c1.6 0 2.8-1.6 3.8-3.4M14 9.2C15 7.9 15.9 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3',
  retry: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4',
  gear: 'M19.45 10.49 L22.40 10.53 L22.40 13.47 L19.45 13.51 L18.33 16.20 L20.39 18.32 L18.32 20.39 L16.20 18.33 L13.51 19.45 L13.47 22.40 L10.53 22.40 L10.49 19.45 L7.80 18.33 L5.68 20.39 L3.61 18.32 L5.67 16.20 L4.55 13.51 L1.60 13.47 L1.60 10.53 L4.55 10.49 L5.67 7.80 L3.61 5.68 L5.68 3.61 L7.80 5.67 L10.49 4.55 L10.53 1.60 L13.47 1.60 L13.51 4.55 L16.20 5.67 L18.32 3.61 L20.39 5.68 L18.33 7.80Z M15 12a3 3 0 1 0 -6 0a3 3 0 1 0 6 0Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  close: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

export function icon(name, { size = 20, label } = {}) {
  const filled = ['bolt', 'plus', 'star', 'stop', 'gear'].includes(name);
  const el = svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: filled ? 'currentColor' : 'none',
      stroke: filled ? 'none' : 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: `icon icon-${name}`,
      'aria-hidden': label ? undefined : 'true',
      role: label ? 'img' : undefined,
      'aria-label': label,
    },
    svg('path', { d: GLYPHS[name] ?? GLYPHS.star, 'fill-rule': name === 'gear' ? 'evenodd' : undefined }),
  );
  return el;
}

/** The WingIt wing mark. */
export function wingMark(size = 40) {
  return svg(
    'svg',
    { viewBox: '0 0 64 64', width: size, height: size, class: 'wingmark', 'aria-hidden': 'true' },
    svg('path', {
      d: 'M8 42c11-1 20-7 26-17 3-5 9-11 18-12-2 7-6 10-10 12 5 0 8-1 11-3-2 7-8 11-14 12 3 1 7 0 10-1-4 7-12 10-21 10-8 0-14 0-20-1z',
      fill: 'currentColor',
    }),
  );
}

let announceTimer;
export function announce(text) {
  const el = document.getElementById('announcer');
  if (!el) return;
  el.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    el.textContent = text;
  }, 60);
}
