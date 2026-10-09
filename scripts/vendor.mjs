// Builds WingIt's self-hosted, fingerprinted dependency set. Runs in GitHub Actions (needs network).
//
//   node scripts/vendor.mjs pin    Resolve everything fresh: install the pinned libraries, lock their
//                                  exact dependency tree (vendor/lock/), pin every model to its current
//                                  Hugging Face commit and the WebLLM model libraries to a GitHub commit,
//                                  and write vendor/integrity.json with the SHA-256 of every file.
//   node scripts/vendor.mjs build  Rebuild vendor/ from the committed lock + manifest for a deploy, and
//                                  fail unless every rebuilt file matches its recorded SHA-256.
//
// Only vendor/integrity.json and vendor/lock/ are committed; the bundles are rebuilt on each deploy.
// The service worker (sw.js) blocks anything not listed in integrity.json or not matching its hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODE = process.argv[2];
if (MODE !== 'pin' && MODE !== 'build') {
  console.error('usage: node scripts/vendor.mjs pin|build');
  process.exit(2);
}
const ROOT = process.cwd();
const VENDOR = join(ROOT, 'vendor');
const cfg = JSON.parse(readFileSync(join(ROOT, 'vendor.config.json'), 'utf8'));
const HF = 'https://huggingface.co';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log('[vendor]', ...a);

async function get(url, { json = false, tries = 4 } = {}) {
  const headers = {};
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return json ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// ---------- 1. libraries ----------
const LOCK = join(VENDOR, 'lock');
const MANIFEST = join(VENDOR, 'integrity.json');
const committed = MODE === 'build' ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
for (const f of existsSync(VENDOR) ? readdirSync(VENDOR) : []) {
  if (f !== 'lock' && f !== 'integrity.json') rmSync(join(VENDOR, f), { recursive: true, force: true });
}
mkdirSync(join(VENDOR, 'ort'), { recursive: true });
mkdirSync(join(VENDOR, 'mlc'), { recursive: true });
mkdirSync(LOCK, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'wingit-vendor-'));
if (MODE === 'pin') {
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'wingit-vendor', private: true, type: 'module' }));
  const pkgs = Object.entries(cfg.packages).map(([n, v]) => `${n}@${v}`);
  log('installing', pkgs.join(' '));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', ...pkgs], { cwd: work, stdio: 'inherit' });
  copyFileSync(join(work, 'package.json'), join(LOCK, 'package.json'));
  copyFileSync(join(work, 'package-lock.json'), join(LOCK, 'package-lock.json'));
} else {
  // Exact same dependency tree as when the fingerprints were recorded.
  copyFileSync(join(LOCK, 'package.json'), join(work, 'package.json'));
  copyFileSync(join(LOCK, 'package-lock.json'), join(work, 'package-lock.json'));
  execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: work, stdio: 'inherit' });
}
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

// ---------- 2b. WebLLM model libraries + model pins ----------
const files = {};
let pins = { webllm: {}, speech: {} };

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

/** Turn a mutable raw.githubusercontent.com/<owner>/<repo>/main/... URL into one pinned to a commit. */
const libCommits = new Map();
async function pinLibUrl(url) {
  const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return url;
  const [, owner, repo, ref, path] = m;
  if (/^[0-9a-f]{40}$/.test(ref)) return url;
  const k = `${owner}/${repo}@${ref}`;
  if (!libCommits.has(k)) libCommits.set(k, (await get(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, { json: true })).sha);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${libCommits.get(k)}/${path}`;
}

if (MODE === 'pin') {
  const webllm = await import(pathToFileURL(join(work, 'node_modules/@mlc-ai/web-llm/lib/index.js')).href);
  for (const id of cfg.webllmModels) {
    const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
    if (!rec) throw new Error(`model ${id} not in WebLLM ${cfg.packages['@mlc-ai/web-llm']}`);
    const repo = new URL(rec.model).pathname.replace(/^\/|\/$/g, '').replace(/\/resolve\/.*$/, '');
    const revision = await pinRepo(repo);
    const libUrl = await pinLibUrl(rec.model_lib);
    pins.webllm[id] = { repo, revision, lib: `vendor/mlc/${basename(new URL(libUrl).pathname)}`, libUrl };
  }
  for (const [key, repo] of Object.entries(cfg.speechModels)) {
    pins.speech[key] = { repo, revision: await pinRepo(repo) };
  }
} else {
  pins = committed.pins;
}
for (const p of Object.values(pins.webllm)) {
  const out = join(ROOT, p.lib);
  if (!existsSync(out)) writeFileSync(out, await get(p.libUrl));
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

if (MODE === 'build') {
  // Every rebuilt file must match the fingerprint recorded when it was pinned.
  const problems = [];
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith('vendor/lock/')) continue;
    if (committed.files[k] !== v) problems.push(`${k}: ${committed.files[k] ? 'hash differs' : 'not in manifest'}`);
  }
  for (const k of Object.keys(committed.files)) {
    if (k.startsWith('vendor/') && !k.startsWith('vendor/lock/') && !(k in files)) problems.push(`${k}: missing from build`);
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    throw new Error(`${problems.length} vendored file(s) do not match vendor/integrity.json`);
  }
  log(`verified ${Object.keys(files).length} vendored files against integrity.json ${committed.version}`);
} else {
  for (const k of Object.keys(files)) if (k.startsWith('vendor/lock/')) delete files[k];
  const manifest = {
    _about: 'Every file WingIt may load besides its own source, with its SHA-256. Generated by scripts/vendor.mjs; enforced by sw.js.',
    version: sha256(JSON.stringify(files)).slice(0, 16),
    generatedAt: new Date().toISOString(),
    packages: cfg.packages,
    pins,
    files,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
  log(`wrote integrity.json: ${Object.keys(files).length} files, version ${manifest.version}`);
}
for (const f of readdirSync(VENDOR, { recursive: true })) {
  const p = join(VENDOR, String(f));
  if (statSync(p).isFile() && statSync(p).size > 95 * 1024 * 1024) throw new Error(`${f} is too big for GitHub Pages (>95 MB)`);
}
rmSync(work, { recursive: true, force: true });
