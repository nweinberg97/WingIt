"""Browser tests for WingIt (Playwright + Chromium, Python).

Model runtimes are replaced by tests/e2e/fakes.js because real model downloads are not
possible in CI. The microphone test uses Chromium's fake audio device with the REAL capture
pipeline (getUserMedia → AudioWorklet → resample), so audio capture itself is exercised.

Run:  python3 tests/e2e/run_e2e.py      (needs: pip install playwright && playwright install chromium)
"""
import functools
import http.server
import pathlib
import socketserver
import sys
import threading
import traceback

from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[2]
FAKES = (ROOT / "tests/e2e/fakes.js").read_text()
SHOTS = ROOT / "tests/e2e/screenshots"
SHOTS.mkdir(exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://localhost:{httpd.server_address[1]}"


RESULTS = []


def case(fn):
    RESULTS.append(fn)
    return fn


def new_page(browser, base, query="", viewport=(1280, 900), fakes=True, **ctx):
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, **ctx)
    if fakes:
        context.add_init_script(FAKES)
    page = context.new_page()
    page.errors = []
    page.external = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("request", lambda r: page.external.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
    page.goto(f"{base}/{query}")
    return page


def no_overflow(page):
    w = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    assert w[0] <= w[1], f"horizontal overflow {w}"


@case
def home_loads_cleanly(browser, base):
    page = new_page(browser, base, fakes=False)
    expect(page.get_by_role("heading", level=1)).to_contain_text("brilliant thing")
    expect(page.get_by_role("button", name="Start playing")).to_be_visible()
    assert page.locator(".ticket").count() == 6
    page.get_by_role("button", name="Deal a sample").click()
    expect(page.locator(".home-card-slot .cue-card")).to_be_visible()
    page.screenshot(path=str(SHOTS / "home-desktop.png"), full_page=True)
    assert not page.errors, page.errors
    assert not page.external, f"unexpected network on load: {page.external}"


@case
def primary_flow_typed(browser, base):
    page = new_page(browser, base)
    page.get_by_role("button", name="Start playing").click()
    setup1 = page.locator(".card-setup").inner_text()
    expect(page.get_by_role("button", name="Start recording")).to_be_visible()
    expect(page.locator("#submit-btn")).to_be_disabled()
    page.locator("#answer").fill("Ladies and gentlemen, the toaster has filed for divorce.")
    page.locator("#submit-btn").click()
    # Coach not loaded yet: the gate explains the one-time download and keeps the answer.
    expect(page.locator(".gate")).to_be_visible()
    expect(page.locator("#answer")).to_have_value("Ladies and gentlemen, the toaster has filed for divorce.")
    page.locator("#wake-btn").click()
    expect(page.locator(".feedback")).to_be_visible(timeout=10000)
    expect(page.locator(".fb-quote")).to_contain_text("Ladies and gentlemen, the")
    expect(page.get_by_role("heading", name="Try this next")).to_be_visible()
    assert page.locator(".score-row").count() == 3
    expect(page.locator(".coach-chip")).to_have_text("Coach ready")
    # Alternative is hidden until asked for.
    expect(page.locator("#alt-panel")).to_be_hidden()
    page.get_by_role("button", name="Show a different direction").click()
    expect(page.locator("#alt-panel")).to_be_visible()
    page.screenshot(path=str(SHOTS / "feedback-desktop.png"), full_page=True)
    page.get_by_role("button", name="Next scenario").click()
    expect(page.locator(".feedback")).to_have_count(0)
    assert page.locator(".card-setup").inner_text() != setup1, "shuffle dealt a new card"
    expect(page.locator("#answer")).to_have_value("")
    expect(page.locator(".round-count")).to_have_text("1 round this session")
    assert not page.errors, page.errors


@case
def coach_written_scenarios_are_labelled(browser, base):
    page = new_page(browser, base)
    page.get_by_role("button", name="Start playing").click()
    page.locator(".coach-chip").click()
    page.locator("#wake-btn").click()
    expect(page.locator(".coach-chip")).to_have_text("Coach ready")
    page.wait_for_function("window.__e2e.chatCalls >= 1")
    page.wait_for_timeout(200)
    page.locator("#shuffle-btn").click()
    expect(page.locator(".card-source")).to_have_text("Written by your coach")
    expect(page.locator("#scenario-title")).to_contain_text("Coach card")


@case
def real_microphone_capture_with_fake_device(browser, base):
    page = new_page(browser, base, "?realmic=1", permissions=["microphone"])
    page.get_by_role("button", name="Start playing").click()
    page.get_by_role("button", name="Start recording").click()
    expect(page.get_by_role("button", name="Stop recording")).to_be_visible()
    expect(page.locator(".dock-status")).to_contain_text("Listening")
    expect(page.locator(".meter")).to_be_visible()
    page.wait_for_timeout(2200)
    page.screenshot(path=str(SHOTS / "recording-desktop.png"))
    page.get_by_role("button", name="Stop recording").click()
    expect(page.locator("#answer")).to_have_value("The pigeons have formed a union and they want bread.", timeout=8000)
    got = page.evaluate("window.__e2e.transcribed")
    assert len(got) == 1 and got[0]["samples"] > 16000 * 1.5, got  # ~2s of 16 kHz audio reached the transcriber
    states = page.evaluate("window.__e2e.tracks.map(t => t.readyState)")
    assert states and all(s == "ended" for s in states), f"mic tracks still live: {states}"
    assert not page.external, f"audio flow touched the network: {page.external}"


@case
def leaving_while_recording_releases_mic(browser, base):
    page = new_page(browser, base, "?realmic=1", permissions=["microphone"])
    page.get_by_role("button", name="Start playing").click()
    page.get_by_role("button", name="Start recording").click()
    expect(page.get_by_role("button", name="Stop recording")).to_be_visible()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="WingIt home").click()
    page.wait_for_timeout(300)
    states = page.evaluate("window.__e2e.tracks.map(t => t.readyState)")
    assert states and all(s == "ended" for s in states), states


@case
def microphone_denied(browser, base):
    page = new_page(browser, base, "?denymic=1")
    page.get_by_role("button", name="Start playing").click()
    page.get_by_role("button", name="Start recording").click()
    expect(page.get_by_role("alert")).to_contain_text("Microphone is blocked")
    page.locator("#answer").fill("I'll type instead.")
    expect(page.locator("#submit-btn")).to_be_enabled()


@case
def no_webgpu(browser, base):
    page = new_page(browser, base, "?nogpu=1")
    page.get_by_role("button", name="Start playing").click()
    page.locator("#answer").fill("Hello there.")
    page.locator("#submit-btn").click()
    page.locator("#wake-btn").click()
    expect(page.locator(".gate")).to_contain_text("can't run the coach")
    expect(page.locator(".coach-chip")).to_have_text("Coach unavailable")
    expect(page.locator("#answer")).to_have_value("Hello there.")
    page.locator("#shuffle-btn").click()
    expect(page.locator("#scenario-title")).to_be_visible()


@case
def stale_feedback_is_discarded(browser, base):
    page = new_page(browser, base, "?slow=1200")
    page.get_by_role("button", name="Start playing").click()
    page.locator(".coach-chip").click()
    page.locator("#wake-btn").click()
    expect(page.locator(".coach-chip")).to_have_text("Coach ready")
    page.evaluate("window.__WINGIT__.updateSettings({ scenarioSource: 'deck' })")
    page.locator("#answer").fill("First answer.")
    page.locator("#submit-btn").click()
    expect(page.locator(".thinking")).to_be_visible()
    page.locator("#shuffle-btn").click()
    page.wait_for_timeout(1800)
    expect(page.locator(".feedback")).to_have_count(0)
    expect(page.locator("#answer")).to_have_value("")


@case
def keyboard_only_round(browser, base):
    page = new_page(browser, base)
    page.keyboard.press("Tab")  # skip link
    page.keyboard.press("Tab")
    for _ in range(4):
        if page.evaluate("document.activeElement.id") == "start-playing":
            break
        page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement.id") == "start-playing"
    page.keyboard.press("Enter")
    expect(page.locator("#mic-btn")).to_be_focused()
    page.locator("#answer").focus()
    page.keyboard.type("A keyboard-only answer about the moon.")
    page.keyboard.press("Control+Enter")
    expect(page.locator(".gate")).to_be_visible()
    page.locator("#wake-btn").focus()
    page.keyboard.press("Enter")
    expect(page.locator(".feedback")).to_be_visible(timeout=10000)
    expect(page.locator(".feedback-slot")).to_be_focused()
    # Visible focus indicator
    page.keyboard.press("Tab")
    outline = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
    assert outline != "none", outline


@case
def settings_theme_motion_and_clear(browser, base):
    page = new_page(browser, base)
    page.get_by_role("button", name="Start playing").click()
    page.get_by_role("button", name="Settings").click()
    dlg = page.get_by_role("dialog")
    expect(dlg).to_be_visible()
    dlg.get_by_role("radio", name="Dark").check()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    dlg.get_by_role("radio", name="Reduced").check()
    assert page.evaluate("document.documentElement.dataset.motion") == "reduce"
    dlg.get_by_role("switch", name="Challenge timer").check()
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.locator(".timer-label")).to_contain_text("Timer: 30s")
    page.screenshot(path=str(SHOTS / "game-dark.png"), full_page=True)
    # persisted
    page.reload()
    assert page.evaluate("document.documentElement.dataset.theme") == "dark"
    # favourites + clear
    page.get_by_role("button", name="Start playing").click()
    page.get_by_role("button", name="Save to favourites").click()
    page.get_by_role("button", name="Your rounds and favourites").click()
    expect(page.get_by_role("dialog")).to_contain_text("Favourite scenarios")
    expect(page.locator(".fav-list li")).to_have_count(1)
    page.keyboard.press("Escape")
    page.on("dialog", lambda d: d.accept())
    page.get_by_role("button", name="Settings").click()
    page.get_by_role("button", name="Clear history and favourites").click()
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Your rounds and favourites").click()
    expect(page.locator(".fav-list li")).to_have_count(0)


@case
def easier_harder_and_modes(browser, base):
    page = new_page(browser, base)
    page.get_by_role("button", name="Start playing").click()
    setup = page.locator(".card-setup").inner_text()
    page.get_by_role("button", name="Make this scenario harder").click()
    expect(page.locator(".chip-twist")).to_be_visible()
    assert page.locator(".card-setup").inner_text() == setup
    page.get_by_role("button", name="Make this scenario easier").click()
    expect(page.locator(".chip-twist")).to_have_count(0)
    for name in ["Yes, And…", "Make It Funnier", "Story Builder", "Under Pressure", "Wildcard", "Think Fast"]:
        page.locator(".mode-tab", has_text=name).click()
        expect(page.locator(".cue-card .card-mode")).to_contain_text(name)
        expect(page.locator(".mode-tab", has_text=name)).to_have_attribute("aria-pressed", "true")


@case
def mobile_layout(browser, base):
    page = new_page(browser, base, viewport=(375, 740), is_mobile=True, has_touch=True)
    no_overflow(page)
    page.screenshot(path=str(SHOTS / "home-mobile.png"), full_page=True)
    page.get_by_role("button", name="Start playing").tap()
    no_overflow(page)
    page.screenshot(path=str(SHOTS / "game-mobile.png"), full_page=True)
    box = page.locator("#mic-btn").bounding_box()
    assert box["width"] >= 44 and box["height"] >= 44
    page.locator("#answer").fill("Short and sweet.")
    page.locator("#submit-btn").tap()
    page.locator("#wake-btn").tap()
    expect(page.locator(".feedback")).to_be_visible(timeout=10000)
    no_overflow(page)
    page.screenshot(path=str(SHOTS / "feedback-mobile.png"), full_page=True)


@case
def model_output_rendered_as_text(browser, base):
    page = new_page(browser, base)
    page.get_by_role("button", name="Start playing").click()
    page.locator("#answer").fill('<img src=x onerror="window.__pwned=1"> hello')
    page.locator("#submit-btn").click()
    page.locator("#wake-btn").click()
    expect(page.locator(".feedback")).to_be_visible(timeout=10000)
    assert page.evaluate("window.__pwned") is None
    assert page.locator(".feedback img").count() == 0


def main():
    httpd, base = serve()
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        for fn in RESULTS:
            try:
                fn(browser, base)
                print(f"PASS  {fn.__name__}")
            except Exception:
                failures += 1
                print(f"FAIL  {fn.__name__}")
                traceback.print_exc()
        browser.close()
    httpd.shutdown()
    print(f"\n{len(RESULTS) - failures}/{len(RESULTS)} browser tests passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
