# WingIt

**Say the first brilliant thing.** WingIt is a pocket improv gym. It deals you a ridiculous situation; you answer out loud; a coach that runs entirely in your browser tells you what landed and what to try next. Then you shuffle and go again.

No accounts, no installs, no servers, no API keys. Open the page and play.

---

## 1. Product overview

- **Name:** WingIt. "Wing it" is exactly the skill it trains: committing to an answer before you've had time to overthink it.
- **Brand direction:** the improv cue card under a stage light. The oversized, slightly tilted index card, taped down in the current mode's colour, is the single bold object; everything around it stays quiet. Rehearsal-room periwinkle in light mode, a dark stage in dark mode. Heavy rounded sans for the game voice, a bookish serif for the scenario "script". System fonts only, so nothing is fetched from font services.
- **Audience:** anyone who wants to think faster on their feet: improv students, people who freeze in meetings, storytellers, the socially curious, party-game fans.
- **Core differentiator:** specific, mode-aware feedback from a real open model, with a hard privacy guarantee. Your voice never leaves your device, and by default neither does your text.

### Modes
Each mode is a data entry in `src/modes.js`: objective, generation constraints, rubric, feedback style, and challenge timer. Adding a mode means adding data, not code.

| Mode | Trains | Scored on |
| --- | --- | --- |
| Think Fast | Instant, committed reactions | On the prompt · Specificity · Adaptability |
| Yes, And… | Accepting offers and building | Yes-and · Specificity · Surprise |
| Make It Funnier | Turning the mundane into a bit | Surprise · Heightening · Specificity |
| Story Builder | Moving a story forward | Story drive · Specificity · Surprise |
| Under Pressure | Staying composed when it's awkward | Composure · Clarity · Adaptability |
| Wildcard | Committing to surreal worlds | Yes-and · Surprise · On the prompt |

Each dimension has written 1–5 criteria, and the evaluator receives them.

### A round
1. **Prompt (top).** An improv card from the *deck* (a procedural generator that combines setting, role, object, complication, twist and bonus ingredients, so it's instant and works offline), or *written by your coach* (the local model, seeded with deck ingredients and prefetched in the background so a new prompt appears instantly). The card always says which.
2. **Mic (underneath).** Tap the big mic and talk. A ring of bars around it moves with your voice, and the headline counts the time (or counts down, if the challenge timer is on). Tap **Finish** when you're done, or **Start over**. Prefer typing? "Rather type?" swaps the mic for a text box.
3. **Transcript, sent.** Whisper writes down what you said on your device. The text appears as a "You said" bubble and goes straight to the coach. Turn on *Check my transcript before sending* in Settings if you'd rather fix it first.
4. **The waiting show.** Mic, WingIt's microphone comedian, stands in a spotlight between velvet curtains and tells dad jokes (mostly improv puns) while the coach reads your answer. The setup types out as Mic talks, with mouth flaps, gestures and raised eyebrows. On the punchline Mic does a squash-and-stretch jump with happy eyes and arms up, the drummer hits a *ba-dum-tss*, and confetti and "HA!"s fly. "Tell me!" reveals early and "Another one" skips ahead. If feedback arrives mid-joke, the punchline still lands before the show closes.
5. **Feedback.** Your strongest move (quoted from your own words and checked against the transcript), what worked, one thing to try next, a different direction (hidden until you ask), a 3-dimension scorecard, and a sign-off. Then **Next scenario**, **Try again**, **Harder version** or **Copy notes**.

---

## 2. Architecture

```
Browser mic ─► AudioWorklet (PCM in memory) ─► resample to 16 kHz ─► Whisper (Transformers.js, Web Worker, WASM)
                                                                          │ text
                                                                          ▼
                                       editable transcript ─► Coach (WebLLM, Web Worker, WebGPU) ─► JSON ─► validator ─► UI (textContent only)
```

- **No build step for the app, nothing to install for players.** WingIt's own code is plain ES modules. The two inference libraries (`@mlc-ai/web-llm@0.2.85`, `@huggingface/transformers@4.3.1`), ONNX Runtime's WebAssembly files and the WebLLM model libraries are **served from WingIt's own site** (`vendor/`), rebuilt on every deploy from a committed lockfile and verified against recorded SHA-256 fingerprints. See *Security*.
- **Speech:** OpenAI Whisper `tiny.en` (≈41 MB) or `base.en` (≈77 MB, the default), using the ONNX q8 builds from `onnx-community`. They run with Transformers.js on ONNX Runtime Web (WASM) in a module worker. WASM was chosen over WebGPU for speech because it works in every modern browser, and these models are small enough that the GPU adds little.
- **Coach:** WebLLM in a module worker, using WebGPU. The f16 build is used when the GPU supports `shader-f16`; otherwise the f32 build.

  | Option | Licence | GPU memory (WebLLM) | Approx. download |
  | --- | --- | --- | --- |
  | Qwen2.5 1.5B Instruct (default) | Apache-2.0 | ~1.6–1.9 GB | ~1 GB |
  | Qwen2.5 0.5B Instruct (Lite) | Apache-2.0 | ~0.9–1.1 GB | ~0.4 GB |
  | Phi-3.5 mini Instruct | MIT | ~3.7–5.5 GB | ~2.2 GB |

  Why these: they're genuinely open licences (Qwen2.5 **3B** was avoided because it uses a non-commercial research licence; Llama and Gemma were avoided because of their custom licences). They're in WebLLM's prebuilt list, and 1.5B is the smallest model that writes reliably specific feedback on typical laptops. GPU-memory figures come from WebLLM's model config; download sizes are approximate.
- **Reliable output:** evaluation uses WebLLM's grammar-constrained JSON mode with a per-mode JSON schema (the dimension names are an enum of that mode's rubric, and scores are an enum of 1–5). The result is then validated at runtime (`src/feedback.js`). Malformed or truncated output is retried once at a lower temperature. If it still fails, you see an honest error, your transcript is kept, and you get a retry button. There is never canned feedback.
- **Lifecycle:** the model loads once and is shared across rounds. Generations are serialized through a single queue, each with a 90-second timeout that interrupts the model, and stale jobs are skipped. Every async result carries a round token, so an old answer can never overwrite a newer round. Returning players whose model is already cached get it woken automatically.
- **Module map:**

  | Path | Role |
  | --- | --- |
  | `src/modes.js` | Mode and rubric data |
  | `src/deck.js` | Procedural scenarios, easier/harder |
  | `src/scenario.js` | Validation, safety screen, repetition checks |
  | `src/prompts.js` | Prompts, answer validation, injection hardening |
  | `src/feedback.js` | Schema, validation, quote verification |
  | `src/session.js` | Pure state machine |
  | `src/controller.js` | Orchestration |
  | `src/ai/coach.js` | Model lifecycle, queue, timeouts |
  | `src/ai/services.js` | Evaluate / generate |
  | `src/speech/*` | Capture, Whisper worker |
  | `src/store.js` | Local persistence |
  | `src/ui/*` | Views |

---

## 3. Privacy, precisely

| Data | Where it's processed | Stored? | Transmitted? |
| --- | --- | --- | --- |
| Microphone audio | In memory: AudioWorklet → main thread → *transferred* (not copied) to the Whisper worker | **Never.** Chunks are cleared on stop, and the PCM buffer is detached when it's handed to the worker | **Never** |
| Transcript / typed answer | Your browser; evaluated by the local model in a worker | No: answers are not saved | No |
| Settings, favourite scenarios, round counts and average scores | Your browser | `localStorage` (recent cards: `sessionStorage`) | No |
| Model files | Downloaded once, only after the player agrees: weights from Hugging Face at pinned commits; engine code from WingIt's own site. Every file is checked against its SHA-256 before use | Browser Cache Storage (deletable in Settings) | Download only |

- The mic starts only when you tap it. All tracks are stopped on stop, discard, scenario change, going home, tab hidden, and page close.
- There are no analytics, trackers or third-party scripts. All code is served from WingIt's own site.
- The network *is* used to load the app and, the first time, to download model files. WingIt claims that audio and answers never leave the device, not that the app makes no network requests.
- The Web Speech API is deliberately **not** used, because some browsers send that audio to a cloud service.

## Security

WingIt's rule: **no file runs unless its fingerprint is on the list.**

| Layer | What it does | Where |
| --- | --- | --- |
| Pinned versions | Libraries are locked to exact versions with a committed lockfile. Every model is pinned to one Hugging Face commit, and WebLLM's model libraries to one GitHub commit. | `vendor.config.json`, `vendor/lock/`, `vendor/integrity.json` |
| Fingerprint list | `vendor/integrity.json` holds the SHA-256 of every third-party file the app may load: 397 files covering the libraries, WebAssembly runtimes, model libraries and every model file. | Generated by `scripts/vendor.mjs pin` (the `vendor` workflow) |
| Verified deploys | Each deploy rebuilds `vendor/` from the lockfile and **refuses to publish** if any file differs from its recorded fingerprint. | `.github/workflows/pages.yml` → `scripts/vendor.mjs build` |
| Gatekeeper in the browser | A service worker (`sw.js`) intercepts every request from the page and its workers. A third-party file is handed over only if it's listed and its SHA-256 matches; unlisted or altered files are blocked. Non-download requests to other sites (POST etc.) are blocked, so nothing can be sent out. Saved model files are re-checked whenever the list changes, and mismatches are deleted. | `sw.js`, `src/security/guard.js` |
| Fail closed | Models load only after the gatekeeper controls the page. If the browser disables service workers (some private modes), voice and feedback stay off rather than loading unchecked. | `src/security/guard.js` |
| Content Security Policy | Scripts only from WingIt's own site; network connections only to WingIt and Hugging Face; no inline scripts or styles; no frames, objects or form posts. | `index.html` (checked by `scripts/check.mjs`) |
| Consent | Nothing is downloaded until the player agrees. Sizes and deletion are explained up front. | Setup prompt |
| Safe output | Model output is schema-validated, length-capped and rendered with `textContent`. No `innerHTML` anywhere (enforced). Transcripts are wrapped as data; the model is told to ignore instructions inside them. Fabricated quotes are dropped. | `src/feedback.js`, `src/prompts.js` |
| Content safety | Generated scenarios pass a safety screen and fall back to the deck if they fail. | `src/scenario.js` |

**What a model file is.** It's data, a large array of numbers. The browser's own WebGPU and WebAssembly engines do the maths inside the normal web sandbox. A model file can't install software, read files, or reach other tabs or apps.

**Why there is a download at all.** Running the AI on the device means the device must have it, just as a browser downloads any web page before showing it. Hosting the weights on WingIt's own domain wouldn't remove the download; the fingerprint check is what makes the source irrelevant. The only way to avoid a download is server-side inference, which would send players' answers off their device.

**Trust root and honest limits.** The trust root is WingIt's own site: its HTML, JS, `sw.js` and fingerprint list, all served from this repository. No website can promise perfect security; WingIt relies on the browser sandbox like every site does. Updating a pinned version is a deliberate act: edit `vendor.config.json`, which runs the `vendor` workflow and records new fingerprints in a reviewable commit.

The in-app **"Is WingIt safe?"** explainer (linked from the home page, the setup prompt, under the mic and in Settings) says all of this in plain language, with a live readout of the gatekeeper's status.

---

## 4. Setup

### For players
Open the hosted page in a recent desktop Chrome or Edge, Chrome on Android, or Safari 26+, and tap **Start playing**. Nothing is installed.
- **Nothing downloads without asking.** On the first visit, a one-time setup prompt explains that the speech model and the coach run privately on the device, so the browser needs to save them once. The default is about 1.1 GB; a smaller option is about 0.5 GB, with simpler feedback. The player chooses **Download**, **Smaller download**, or **Not now**.
- After they agree, the models load in the background while they play. If they finish an answer before the coach is ready, the waiting show runs with a progress bar and the answer is sent as soon as it's ready.
- The choice is remembered. Later visits load from the browser cache in seconds, even offline. **Delete downloaded models** in Settings removes the files and resets the choice, so nothing re-downloads without asking again.

### Host it (GitHub Pages, free)
1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Every push to `main` runs `.github/workflows/pages.yml`, which rebuilds `vendor/`, verifies every fingerprint and deploys. A mismatch stops the deploy.
3. To change a pinned version, edit `vendor.config.json` and push. The `vendor` workflow records the new fingerprints in a commit, then redeploys.

### Run locally
The page must be served over `http://localhost` or HTTPS for the mic and the safety check to work; opening it as `file://` won't. To run with the real models, build the verified vendor files first (needs network access to npm, GitHub and Hugging Face):
```bash
node scripts/vendor.mjs build    # rebuilds vendor/ and checks every fingerprint
python3 -m http.server 8080      # then open http://localhost:8080
```
Without `vendor/`, the app runs but voice and feedback stay off, by design.

### Develop and test
Node 20+ and Python 3 with Playwright. There is no `npm install` and no runtime dependencies.
```bash
node scripts/check.mjs                 # syntax + project rules (no innerHTML, no remote AI APIs, etc.)
node --test tests/*.test.js            # unit + integration
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e/run_e2e.py           # browser tests (writes screenshots to tests/e2e/screenshots/)
python3 tests/e2e/run_guard.py         # integrity guard, with a real service worker
```
CI runs all of these (`.github/workflows/test.yml`). The `real-models` workflow (run it by hand from the Actions tab) builds the verified site and runs the **real** models in Chromium.

---

## 5. Testing report

| Suite | Result | What's real vs mocked |
| --- | --- | --- |
| Static checks (`scripts/check.mjs`) | ✅ | Real. Syntax, no `innerHTML`/`eval`, no remote AI APIs, no CDN URLs in app code, CSP allows scripts from this site only, capture code can't persist or transmit audio |
| Unit + integration (`tests/*.test.js`) | ✅ 99 tests | Real controller, state machine, validation, prompts, store, coach queue, timeouts and retries, consent rules, guard helpers. **Model runtime, transcriber and microphone are fakes** |
| Browser (`tests/e2e/run_e2e.py`, Chromium) | ✅ 21/21 | Real UI. **Model runtimes are fakes.** The mic test uses the **real capture pipeline** with Chromium's fake audio device. Also covers consent before download, the waiting show, keyboard-only play, settings, theme, mobile layout, the safety explainer, and model output rendered as inert text |
| Integrity guard (`tests/e2e/run_guard.py`, Chromium) | ✅ 18/18 | **Real service worker**, real cross-origin server. Matching files load; tampered, unlisted and altered self-hosted files are blocked from both the page and a worker, including via `Cache.add` (how WebLLM downloads). Outgoing POSTs are blocked. Old unchecked saved files are deleted. The explainer shows the live status |
| Deploy verification (`pages` workflow) | ✅ | Real. On a fresh GitHub machine, all rebuilt vendor files matched their recorded SHA-256 fingerprints |
| **Real models** (`real-models` workflow, Chromium on GitHub) | ✅ speech · ⚠️ coach | **No fakes.** The real Whisper tiny.en, loaded through the guard, transcribed a spoken sentence ("The pigeons have formed a union…") in 9 s; the guard blocked nothing legitimate, and only WingIt's own site and Hugging Face were contacted. The real coach (Qwen2.5 0.5B) **downloaded and passed every fingerprint check**, but the runner's software-only GPU (SwiftShader) ran out of memory when generating, so feedback quality was not verified there |

**Still to verify by hand on a real device:** coach feedback quality and speed on a real GPU (Chrome/Edge laptop, Safari 26, Android Chrome), and iOS microphone behaviour.

---

## 6. Known limitations
- **The coach needs WebGPU.** Support varies: Chrome/Edge desktop, Chrome on Android, Safari 26+ and Firefox on Windows (141+) have it; Firefox on macOS/Linux, older Safari and many low-end phones may not. On those you can still play cards and transcribe; the app says so plainly. Lite (0.5B) helps on low-memory GPUs, but not on browsers without WebGPU.
- **Small-model feedback is good, not great.** 1.5B models occasionally misjudge humour or give generic tips. Validation stops malformed output, not mediocre output. Phi-3.5 mini is noticeably sharper if your GPU can take it.
- **First-run downloads are large** (~1 GB for the default coach), and the first load compiles GPU shaders (tens of seconds). Later visits come from cache.
- **Whisper `.en` models are English-only.** Long answers are capped at 2 minutes of recording.
- **The live transcript preview is approximate** and costs extra CPU; it can be turned off in Settings.
- The CSP is delivered via a `<meta>` tag because GitHub Pages can't set headers. Hosts that support headers should send the same policy as a header, plus `Permissions-Policy: microphone=(self)`.

## 7. Next steps
1. A manual real-device pass across Chrome / Edge / Safari 26 / Android Chrome, then tune prompts on real transcripts.
2. Self-host a distinctive open-licence display font (OFL) to sharpen the brand without third-party requests.
3. Let the service worker also cache the app shell, so WingIt opens fully offline after the first visit.
4. Add multilingual Whisper (`base`) plus a matching language setting.

## Licences
App code: © 2026 Nitai Weinberg, all rights reserved (see `LICENSE`). Whisper: MIT. Qwen2.5 0.5B/1.5B: Apache-2.0. Phi-3.5 mini: MIT. WebLLM: Apache-2.0. Transformers.js: Apache-2.0. ONNX Runtime Web: MIT.
