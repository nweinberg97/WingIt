"""Real-model smoke test (needs internet; runs in GitHub Actions via .github/workflows/real.yml).

Serves the deployable site (_site/, built with vendored + fingerprint-checked libraries), opens it
in Chromium with NO test fakes, feeds a spoken sentence through a fake microphone, and checks that
the real Whisper model transcribes it, with every file passing the integrity guard. If the browser
exposes a WebGPU adapter it also runs the real coach model end to end.

Results are printed and also emitted as GitHub annotations.
"""
import functools
import http.server
import json
import os
import pathlib
import socketserver
import sys
import threading
import time
import traceback

from playwright.sync_api import sync_playwright

SITE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
WAV = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "speech.wav").resolve()
RUN_COACH = os.environ.get("RUN_COACH", "1") == "1"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def note(level, title, msg):
    msg = str(msg).replace("\n", " ")[:900]
    print(f"::{level} title={title}::{msg}")


def main():
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE)))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://localhost:{httpd.server_address[1]}"
    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={WAV}%noloop",
                "--enable-unsafe-webgpu",
                "--enable-features=Vulkan",
                "--use-vulkan=swiftshader",
                "--use-webgpu-adapter=swiftshader",
                "--use-angle=swiftshader",
                "--ignore-gpu-blocklist",
            ]
        )
        ctx = browser.new_context(permissions=["microphone"])
        hosts = set()
        ctx.on("request", lambda r: hosts.add(r.url.split("/")[2]))
        # A returning player who already agreed to the download, using the smaller coach.
        ctx.add_init_script(
            """localStorage.setItem('wingit:settings', JSON.stringify({modelsConsent: true, coachModel: 'qwen2.5-0.5b', transcribeModel: 'whisper-tiny.en', reviewBeforeSend: true, livePreview: false}));
               window.__guardMsgs = [];
               navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => window.__guardMsgs.push(e.data));"""
        )
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(f"{base}/")
        page.get_by_role("button", name="Start playing").click()
        gpu = page.evaluate("navigator.gpu ? navigator.gpu.requestAdapter().then(a => !!a) : false")
        note("notice", "webgpu adapter", gpu)

        # --- real speech recognition through the guard ---
        def wait_until(fn, timeout):
            end = time.time() + timeout
            while time.time() < end:
                v = fn()
                if v:
                    return v
                page.wait_for_timeout(1000)
            return None

        t0 = time.time()
        page.get_by_role("button", name="Start talking").click()
        page.wait_for_selector("#finish-btn", timeout=60000)
        page.wait_for_timeout(6000)  # let the spoken sentence play into the mic
        page.locator("#finish-btn").click()
        got = wait_until(lambda: (page.locator("#answer").count() and page.locator("#answer").is_visible() and len(page.locator("#answer").input_value()) > 3) or page.locator(".alert").count(), 900)
        speech_ok = False
        if page.locator(".alert").count():
            ok = False
            details = page.locator(".alert").inner_text()
            note("error", "transcription failed", f"{details} | guard: {page.evaluate('window.__guardMsgs')[-6:]}")
        elif got:
            text = page.locator("#answer").input_value()
            note("notice", "real Whisper transcript", f"{text!r} in {time.time() - t0:.0f}s")
            speech_ok = "pigeon" in text.lower() or "union" in text.lower()
            if not speech_ok:
                ok = False
                note("error", "transcript mismatch", text)
        else:
            ok = False
            note("error", "transcription timed out", page.evaluate("window.__guardMsgs"))

        guard = page.evaluate("navigator.serviceWorker.controller ? 'active' : 'inactive'")
        note("notice", "guard", guard)
        if guard != "active":
            ok = False

        # --- real coach, if this machine can run WebGPU ---
        if RUN_COACH and gpu:
            t1 = time.time()
            try:
                if not speech_ok:
                    # Still test the coach with a typed answer.
                    for b in page.locator(".alert button", has_text="Dismiss").all():
                        b.click()
                    if page.get_by_role("button", name="Rather type?").count():
                        page.get_by_role("button", name="Rather type?").click()
                    page.locator("#answer").fill("Ladies and gentlemen, the pigeons have formed a union and they want more bread.")
                page.locator("#submit-btn").click()
                done = wait_until(lambda: page.locator(".feedback").count() or page.locator(".alert").count(), 1500)
                if page.locator(".feedback").count():
                    fb = page.locator(".feedback").inner_text()[:700]
                    note("notice", "real coach feedback", f"{time.time() - t1:.0f}s: {fb}")
                else:
                    ok = False
                    alerts = page.locator(".alert, .wait-error").all_inner_texts()
                    note("error", "coach failed", f"{'timeout' if not done else ''} {alerts} | chip: {page.locator('.coach-chip').inner_text()} | guard: {page.evaluate('window.__guardMsgs')[-6:]}")
            except Exception as e:
                ok = False
                note("error", "coach crashed", f"{e} | {errors[-5:]}")
        elif RUN_COACH:
            note("warning", "coach skipped", "no WebGPU adapter on this runner")

        note("notice", "hosts contacted", sorted(hosts))
        allowed = ("localhost", "127.0.0.1", "huggingface.co", ".huggingface.co", ".hf.co", "hf.co")
        bad = [h for h in hosts if not any(h.split(":")[0] == a or h.split(":")[0].endswith(a) for a in allowed)]
        if bad:
            ok = False
            note("error", "unexpected hosts", bad)
        if errors:
            note("warning", "console errors", errors[-6:])
        browser.close()
    httpd.shutdown()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        note("error", "real test crashed", repr(e))
        sys.exit(1)
