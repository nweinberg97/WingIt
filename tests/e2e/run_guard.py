"""Browser tests for the integrity guard (sw.js), in real Chromium with a real service worker.

Sets up two local servers: the app (with a test fingerprint list) and a separate "other website"
that serves a good file, a tampered file and an unlisted file. Checks what the guard lets through,
from the page, from a background worker, and through the Cache API that WebLLM uses.

Run:  python3 tests/e2e/run_guard.py
"""
import functools
import hashlib
import http.server
import json
import os
import pathlib
import shutil
import socketserver
import sys
import tempfile
import threading
import traceback

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
FAKES = (ROOT / "tests/e2e/fakes.js").read_text()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class CorsQuiet(Quiet):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_POST(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"received")


def serve(directory, handler_cls, host):
    httpd = socketserver.ThreadingTCPServer((host, 0), functools.partial(handler_cls, directory=str(directory)))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://{host}:{httpd.server_address[1]}"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def build_sites():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="wingit-guard-"))
    app = tmp / "app"
    remote = tmp / "remote"
    remote.mkdir(parents=True)
    app.mkdir(parents=True)
    for item in ["index.html", "sw.js", "src", "assets"]:
        src = ROOT / item
        if src.is_dir():
            shutil.copytree(src, app / item)
        else:
            shutil.copy(src, app / item)
    good = b"model weights v1 " * 1000
    (remote / "good.bin").write_bytes(good)
    (remote / "tampered.bin").write_bytes(b"model weights v1 " * 999 + b"EVIL EVIL EVIL!! ")
    (remote / "unlisted.bin").write_bytes(b"who knows")
    (app / "vendor").mkdir()
    lib = b"export const answer = 42;\n"
    (app / "vendor" / "lib.js").write_bytes(lib)
    (app / "vendor" / "evil.js").write_bytes(b"export const answer = 666;\n")
    (app / "guard-test-worker.js").write_text(
        """
self.onmessage = async (e) => {
  const out = {};
  for (const [name, url] of Object.entries(e.data)) {
    try { const r = await fetch(url); out[name] = r.ok ? (await r.text()).length : 'status ' + r.status; }
    catch (err) { out[name] = 'blocked'; }
  }
  try { const c = await caches.open('webllm/model'); await c.add(e.data.good); out.cacheAddGood = 'ok'; }
  catch (err) { out.cacheAddGood = 'blocked'; }
  try { const c = await caches.open('webllm/model'); await c.add(e.data.tampered); out.cacheAddTampered = 'ok'; }
  catch (err) { out.cacheAddTampered = 'blocked'; }
  self.postMessage(out);
};
"""
    )
    return tmp, app, remote, good, lib


def main():
    tmp, app, remote, good, lib = build_sites()
    remote_srv, rbase = serve(remote, CorsQuiet, "127.0.0.1")
    manifest = {
        "version": "test-1",
        "pins": {"webllm": {}, "speech": {}},
        "files": {
            f"{rbase}/good.bin": sha(good),
            f"{rbase}/tampered.bin": sha(good),  # the list says what the file SHOULD be
            "vendor/lib.js": sha(lib),
            "vendor/evil.js": sha(lib),
        },
    }
    (app / "vendor" / "integrity.json").write_text(json.dumps(manifest))
    html = (app / "index.html").read_text().replace("connect-src 'self'", f"connect-src 'self' {rbase}")
    (app / "index.html").write_text(html)
    app_srv, abase = serve(app, Quiet, "localhost")

    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail))
        print(("PASS  " if cond else "FAIL  ") + name + (f"  ({detail})" if detail and not cond else ""))
        if not cond and os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=guard check failed::{name}: {str(detail)[:600]}")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        ctx.add_init_script(FAKES)
        page = ctx.new_page()
        page.goto(f"{abase}/")
        # A model file saved before the guard existed (or altered on disk) must be cleaned up.
        page.evaluate(
            """async (urls) => {
              const c = await caches.open('webllm/model');
              await c.put(urls.good, new Response('model weights v1 '.repeat(1000)));
              await c.put(urls.stale, new Response('old unchecked download'));
            }""",
            {"good": f"{rbase}/good.bin", "stale": f"{rbase}/old-unpinned.bin"},
        )
        check_result = page.evaluate("window.__WINGIT_GUARD__.ready().then(r => r, e => ({error: e.message}))")
        check("guard starts and controls the page", page.evaluate("!!navigator.serviceWorker.controller"), str(check_result))
        check("saved files re-checked: unpinned copy removed, good copy kept", check_result.get("removed") == 1 and check_result.get("checked") == 2, str(check_result))
        cache_left = page.evaluate("caches.open('webllm/model').then(c => c.keys()).then(k => k.map(r => r.url))")
        check("cache now only holds the fingerprinted file", cache_left == [f"{rbase}/good.bin"], str(cache_left))

        def page_fetch(url, method="GET"):
            return page.evaluate(
                """async ([url, method]) => { try { const r = await fetch(url, { method, body: method === 'POST' ? 'my secret answer' : undefined }); return r.ok ? (await r.text()).length : 'status ' + r.status; } catch (e) { return 'blocked'; } }""",
                [url, method],
            )

        check("page: listed file with matching fingerprint loads", page_fetch(f"{rbase}/good.bin") == len(good))
        check("page: tampered file is blocked", page_fetch(f"{rbase}/tampered.bin") == "blocked")
        check("page: unlisted file is blocked", page_fetch(f"{rbase}/unlisted.bin") == "blocked")
        check("page: sending data out (POST) is blocked", page_fetch(f"{rbase}/good.bin", "POST") == "blocked")
        check("page: our own copied library loads when it matches", page_fetch(f"{abase}/vendor/lib.js") == len(lib))
        check("page: our own copied library is blocked if altered", page_fetch(f"{abase}/vendor/evil.js") == "blocked")
        blocked = page.evaluate("window.__WINGIT_GUARD__.blocked.map(b => b.reason)")
        check("guard reports what it blocked", "hash-mismatch" in blocked and "not-allowed" in blocked and "outgoing-blocked" in blocked, str(blocked))

        worker_out = page.evaluate(
            """(urls) => new Promise((resolve) => {
              const w = new Worker('guard-test-worker.js');
              w.onmessage = (e) => resolve(e.data);
              w.postMessage(urls);
            })""",
            {"good": f"{rbase}/good.bin", "tampered": f"{rbase}/tampered.bin", "unlisted": f"{rbase}/unlisted.bin", "lib": f"{abase}/vendor/evil.js"},
        )
        check("worker: good file loads", worker_out.get("good") == len(good), str(worker_out))
        check("worker: tampered file blocked", worker_out.get("tampered") == "blocked", str(worker_out))
        check("worker: unlisted file blocked", worker_out.get("unlisted") == "blocked", str(worker_out))
        check("worker: altered copied library blocked", worker_out.get("lib") == "blocked", str(worker_out))
        check("worker Cache.add (how WebLLM downloads): good file saved", worker_out.get("cacheAddGood") == "ok", str(worker_out))
        check("worker Cache.add: tampered file refused", worker_out.get("cacheAddTampered") == "blocked", str(worker_out))

        # The app's own pages keep working under the guard.
        page.get_by_role("button", name="Start playing").click()
        check("app still works under the guard", page.locator("#mic-btn").is_visible())
        page.get_by_role("button", name="How we keep you safe").click()
        try:
            page.locator(".safety-status", has_text="Safety check is on").wait_for(timeout=10000)
        except Exception:
            pass
        status = page.locator(".safety-status").inner_text()
        check("explainer shows the live safety status", "Safety check is on" in status, status)
        page.wait_for_timeout(300)
        (ROOT / "tests/e2e/screenshots").mkdir(parents=True, exist_ok=True)
        page.locator("dialog").screenshot(path=str(ROOT / "tests/e2e/screenshots/safety-explainer-live.png"))
        browser.close()

    app_srv.shutdown()
    remote_srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} guard checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=guard test crashed::{repr(e)[:800]}")
        sys.exit(1)
