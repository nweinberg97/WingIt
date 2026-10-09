// Builds WingIt's self-hosted, fingerprinted dependency set. Runs in GitHub Actions (needs network):
//   node scripts/vendor.mjs
// 1. Installs the pinned libraries from npm and bundles them into vendor/ (so no code is loaded from a CDN).
// 2. Copies the ONNX Runtime WebAssembly files and the WebLLM model libraries into vendor/.
// 3. Pins every model to the exact Hugging Face commit that is current right now.
// 4. Writes vendor/integrity.json: the SHA-256 of every file the app is allowed to load.
// The service worker (sw.js) blocks anything that is not in that list or does not match its hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const VENDOR = join(ROOT, 'vendor');
const cfg = JSON.parse(readFileSync(join(ROOT, 'vendor.config.json'), 'utf8'));
const HF = 'https://huggingface.co';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log('[vendor]', ...a);

async function get(url, { json = false, tries = 4 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return json ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// ---------- 1. libraries ----------
rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(join(VENDOR, 'ort'), { recursive: true });
mkdirSync(join(VENDOR, 'mlc'), { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'wingit-vendor-'));
writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'wingit-vendor', private: true, type: 'module' }));
const pkgs = Object.entries(cfg.packages).map(([n, v]) => `${n}@${v}`);
log('installing', pkgs.join(' '));
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', ...pkgs], { cwd: work, stdio: 'inherit' });
// esbuild ships its binary via an install script; run just that one.
execFileSync('node', [join(work, 'node_modules/esbuild/install.js')], { cwd: join(work, 'node_modules/esbuild'), stdio: 'inherit' });

writeFileSync(join(work, 'entry-webllm.js'), "export * from '@mlc-ai/web-llm';\n");
writeFileSync(join(work, 'entry-transformers.js'), "export * from '@huggingface/transformers';\n");
const esbuild = join(work, 'node_modules/.bin/esbuild');
for (const [entry, out] of [['entry-webllm.js', 'web-llm.js'], ['entry-transformers.js', 'transformers.js']]) {
  log('bundling', out);
  execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--minify', '--legal-comments=eof', `--outfile=${join(VENDOR, out)}`], { cwd: work, stdio: 'inherit' });
}

// ---------- 2a. ONNX Runtime wasm (used by Transformers.js for Whisper) ----------
const ortDist = join(work, 'node_modules/onnxruntime-web/dist');
for (const f of readdirSync(ortDist)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) copyFileSync(join(ortDist, f), join(VENDOR, 'ort', f));
}
log('ort files', readdirSync(join(VENDOR, 'ort')).join(', '));

// ---------- 2b. WebLLM model libraries ----------
const webllm = await import(pathToFileURL(join(work, 'node_modules/@mlc-ai/web-llm/lib/index.js')).href);
const pins = { webllm: {}, speech: {} };
const files = {};

async function pinRepo(repo) {
  const info = await get(`${HF}/api/models/${repo}/revision/main`, { json: true });
  const sha = info.sha;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no commit sha for ${repo}`);
  const tree = await get(`${HF}/api/models/${repo}/tree/${sha}?recursive=true`, { json: true });
  let n = 0;
  for (const entry of tree) {
    if (entry.type !== 'file') continue;
    const url = `${HF}/${repo}/resolve/${sha}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
    if (entry.lfs?.oid && /^[0-9a-f]{64}$/.test(entry.lfs.oid)) {
      files[url] = entry.lfs.oid; // Hugging Face publishes the SHA-256 of every large file
    } else {
      files[url] = sha256(await get(url));
    }
    n += 1;
  }
  log(`pinned ${repo}@${sha.slice(0, 10)} (${n} files)`);
  return sha;
}

for (const id of cfg.webllmModels) {
  const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  if (!rec) throw new Error(`model ${id} not in WebLLM ${cfg.packages['@mlc-ai/web-llm']}`);
  const repo = new URL(rec.model).pathname.replace(/^\/|\/$/g, '').replace(/\/resolve\/.*$/, '');
  const revision = await pinRepo(repo);
  const libName = basename(new URL(rec.model_lib).pathname);
  const libPath = join(VENDOR, 'mlc', libName);
  if (!existsSync(libPath)) writeFileSync(libPath, await get(rec.model_lib));
  pins.webllm[id] = { repo, revision, lib: `vendor/mlc/${libName}` };
}
for (const [key, repo] of Object.entries(cfg.speechModels)) {
  pins.speech[key] = { repo, revision: await pinRepo(repo) };
}

// ---------- 3. hash our own copies ----------
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!p.endsWith('integrity.json')) files[relative(ROOT, p).split('\\').join('/')] = sha256(readFileSync(p));
  }
}
walk(VENDOR);

const manifest = {
  _about: 'Every file WingIt may load besides its own source, with its SHA-256. Generated by scripts/vendor.mjs; enforced by sw.js.',
  version: sha256(JSON.stringify(files)).slice(0, 16),
  generatedAt: new Date().toISOString(),
  packages: cfg.packages,
  pins,
  files,
};
writeFileSync(join(VENDOR, 'integrity.json'), JSON.stringify(manifest, null, 1) + '\n');
for (const f of readdirSync(VENDOR, { recursive: true })) {
  const p = join(VENDOR, String(f));
  if (statSync(p).isFile() && statSync(p).size > 95 * 1024 * 1024) throw new Error(`${f} is too big for GitHub (>95 MB)`);
}
log(`wrote integrity.json: ${Object.keys(files).length} files, version ${manifest.version}`);
rmSync(work, { recursive: true, force: true });
