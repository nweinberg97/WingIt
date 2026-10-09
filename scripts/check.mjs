// Dependency-free static checks: syntax of every JS file plus a few project rules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'tests', 'scripts'];
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.m?js$/.test(f)) files.push(p);
  }
};
roots.forEach(walk);

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.error(`✗ ${msg}`);
};

for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail(`${f}: syntax error\n${e.stderr}`);
  }
}

for (const f of files.filter((f) => f.startsWith('src'))) {
  const src = readFileSync(f, 'utf8');
  if (/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(src)) fail(`${f}: HTML injection API used; render text with textContent`);
  if (/\beval\(|new Function\(/.test(src)) fail(`${f}: eval/new Function is not allowed`);
  if (/console\.log\(/.test(src)) fail(`${f}: stray console.log`);
  if (/localStorage|sessionStorage|indexedDB/.test(src) && !/store\.js$/.test(f)) fail(`${f}: persistence must go through src/store.js`);
  if (/api\.openai|anthropic\.com|generativelanguage|api\.groq|replicate\.com|api-inference\.huggingface/.test(src)) fail(`${f}: remote AI API referenced`);
  // Only these remote origins may appear in app code: pinned model downloads (checked by the
  // integrity guard) and a plain link to the source repo. No code may load from a CDN.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const m of code.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    const u = m[0];
    const ok = /^https:\/\/huggingface\.co\/(\$\{|api\/)?/.test(u) || /^https:\/\/github\.com\/nweinberg97\/wingit/.test(u) || /^http:\/\/www\.w3\.org\/2000\/svg/.test(u);
    if (!ok) fail(`${f}: remote URL not allowed in app code: ${u}`);
  }
}

// The page may only run scripts from its own site.
const html = readFileSync('index.html', 'utf8');
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
if (!csp) fail('index.html: missing Content-Security-Policy');
else if (scriptSrc.trim() !== "'self' 'wasm-unsafe-eval'") fail(`index.html: script-src must be 'self' only, got: ${scriptSrc}`);
if (/connect-src[^;]*(jsdelivr|unpkg|githubusercontent)/.test(csp)) fail('index.html: connect-src allows a code CDN');

// The capture module must never write audio anywhere.
const capture = readFileSync('src/speech/capture.js', 'utf8');
if (/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|caches\.|indexedDB|localStorage|MediaRecorder/.test(capture)) fail('capture.js must not persist or transmit audio');

console.log(problems ? `\n${problems} problem(s) in ${files.length} files` : `✓ ${files.length} files checked, no problems`);
process.exit(problems ? 1 : 0);
