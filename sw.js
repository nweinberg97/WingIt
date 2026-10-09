/* WingIt integrity guard.
 *
 * A service worker that sits between WingIt (including its background workers) and the network.
 * Every file the app loads that is not WingIt's own source code must be listed in
 * vendor/integrity.json with its SHA-256 fingerprint. This worker downloads the file, computes
 * its fingerprint, and hands it over only if it matches exactly. Anything unlisted or altered is
 * blocked. Requests other than plain downloads (GET/HEAD) to other sites are blocked too, so
 * nothing the user says or types can be sent anywhere.
 *
 * It also re-checks model files already saved in the browser when the manifest changes, and
 * deletes any that don't match.
 */
'use strict';

const SCOPE = new URL(self.registration.scope);
const MANIFEST_PATH = 'vendor/integrity.json';
const VERIFIED_CACHE = 'wingit-integrity-verified';
const MODEL_CACHE_NAME = /^(webllm\/|tvmjs|transformers-cache)/;

let manifestPromise = null;
function loadManifest(force = false) {
  if (!manifestPromise || force) {
    manifestPromise = fetch(new URL(MANIFEST_PATH, SCOPE).href, { cache: 'no-cache', credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => (m && m.files && typeof m.files === 'object' ? m : null))
      .catch(() => null);
  }
  return manifestPromise;
}

self.addEventListener('install', (event) => {
  event.waitUntil(loadManifest(true).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** The manifest key for a URL: our own files by path, others by full URL (no query string). */
function keyFor(url) {
  if (url.origin === SCOPE.origin) {
    return url.pathname.startsWith(SCOPE.pathname) ? decodeURI(url.pathname.slice(SCOPE.pathname.length)) : null;
  }
  return url.origin + url.pathname;
}

function normaliseKey(k) {
  try {
    const u = new URL(k);
    return u.origin + decodeURI(u.pathname);
  } catch {
    return decodeURI(k);
  }
}

let lookup = null;
let lookupFor = null;
async function expectedHash(key) {
  const m = await loadManifest();
  if (!m) return { manifest: null, hash: null };
  if (lookupFor !== m) {
    lookup = new Map(Object.entries(m.files).map(([k, v]) => [normaliseKey(k), v]));
    lookupFor = m;
  }
  return { manifest: m, hash: lookup.get(normaliseKey(key)) ?? null };
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tell(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage({ source: 'wingit-guard', ...message });
}

function block(url, reason) {
  tell({ type: 'blocked', url, reason });
  return Response.error();
}

const PASS_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified'];

async function verified(request, key) {
  const { manifest, hash } = await expectedHash(key);
  if (!manifest) return block(request.url, 'no-manifest');
  if (!hash) return block(request.url, 'not-allowed');
  if (request.method === 'HEAD') return fetch(request.url, { method: 'HEAD', mode: 'cors', credentials: 'omit' });
  let res;
  try {
    res = await fetch(request.url, { mode: 'cors', credentials: 'omit', redirect: 'follow', signal: request.signal });
  } catch (err) {
    return Response.error(); // network failure: the app shows its normal "download failed" message
  }
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  const got = await sha256Hex(buf);
  if (got !== hash) return block(request.url, 'hash-mismatch');
  const headers = new Headers();
  for (const h of PASS_HEADERS) if (res.headers.has(h)) headers.set(h, res.headers.get(h));
  headers.set('content-length', String(buf.byteLength));
  return new Response(buf, { status: 200, statusText: 'OK', headers });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin === SCOPE.origin) {
    const key = keyFor(url);
    // WingIt's own source (HTML, CSS, JS) loads normally; copied third-party files are checked.
    if (key && key.startsWith('vendor/') && key !== MANIFEST_PATH) event.respondWith(verified(request, key));
    return;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    event.respondWith(block(request.url, 'outgoing-blocked'));
    return;
  }
  event.respondWith(verified(request, keyFor(url)));
});

/** Re-check model files the browser already saved; delete anything unlisted or altered. */
async function verifySaved() {
  const m = await loadManifest(true);
  if (!m) return { ok: false, reason: 'no-manifest' };
  const marker = await caches.open(VERIFIED_CACHE);
  if (await marker.match(`/verified/${m.version}`)) return { ok: true, checked: 0, removed: 0, cached: true };
  let checked = 0;
  let removed = 0;
  for (const name of await caches.keys()) {
    if (!MODEL_CACHE_NAME.test(name)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      checked += 1;
      const { hash } = await expectedHash(keyFor(new URL(req.url)) ?? req.url);
      let good = false;
      if (hash) {
        const res = await cache.match(req);
        good = !!res && (await sha256Hex(await res.arrayBuffer())) === hash;
      }
      if (!good) {
        await cache.delete(req);
        removed += 1;
      }
    }
  }
  await marker.put(`/verified/${m.version}`, new Response('ok'));
  return { ok: true, checked, removed, version: m.version };
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  if (msg.type === 'verify-saved' && port) {
    verifySaved()
      .then((r) => port.postMessage(r))
      .catch((err) => port.postMessage({ ok: false, reason: String(err && err.message || err) }));
  } else if (msg.type === 'status' && port) {
    loadManifest().then((m) => port.postMessage({ ok: !!m, version: m && m.version, files: m ? Object.keys(m.files).length : 0 }));
  }
});
