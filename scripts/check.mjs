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
  if (/https:\/\/(?!cdn\.jsdelivr\.net\/npm\/@(mlc-ai\/web-llm|huggingface\/transformers)@\d)/.test(src.replace(/\/\/.*$/gm, ''))) fail(`${f}: unexpected or unpinned remote URL`);
}

// The capture module must never write audio anywhere.
const capture = readFileSync('src/speech/capture.js', 'utf8');
if (/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|caches\.|indexedDB|localStorage|MediaRecorder/.test(capture)) fail('capture.js must not persist or transmit audio');

console.log(problems ? `\n${problems} problem(s) in ${files.length} files` : `✓ ${files.length} files checked, no problems`);
process.exit(problems ? 1 : 0);
