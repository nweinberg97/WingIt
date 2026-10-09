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
1. **Card.** Comes from the *deck* (a procedural generator that combines setting, role, object, complication, twist and bonus ingredients, so it's instant and works offline) or is *written by your coach* (the local model, seeded with deck ingredients for variety and prefetched in the background so shuffling stays instant). The card always says which.
2. **Answer.** Tap the mic and talk. You get a live level meter, an elapsed timer, an optional rough live transcript, and an optional challenge countdown. Stop, and Whisper transcribes on your device. Edit the text if it slipped, or just type instead.
3. **Notes.** You get: your strongest move (quoted from your own words, and verified to actually appear in your transcript), what worked, one thing to try next, a different direction (hidden until you ask for it), a 3-dimension scorecard, and a sign-off.
4. **Keep playing.** Next scenario, try the same one again, a harder or easier version of the *same* situation, switch modes, copy your notes, or save the card to favourites.

---

## 2. Architecture

```
Browser mic ─► AudioWorklet (PCM in memory) ─► resample to 16 kHz ─► Whisper (Transformers.js, Web Worker, WASM)
                                                                          │ text
                                                                          ▼
                                       editable transcript ─► Coach (WebLLM, Web Worker, WebGPU) ─► JSON ─► validator ─► UI (textContent only)
```

- **No build step, no runtime dependencies.** Plain ES modules, served as static files. The two inference libraries are loaded from jsDelivr at pinned versions, only when needed: `@mlc-ai/web-llm@0.2.85` and `@huggingface/transformers@4.3.1`. Any static host works, including GitHub Pages.
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
| Model files | Downloaded once from Hugging Face / GitHub / jsDelivr | Browser Cache Storage (deletable in Settings) | Download only |

- The mic starts only when you tap it. All tracks are stopped on stop, discard, scenario change, going home, tab hidden, and page close.
- There are no analytics, trackers or third-party scripts beyond the two pinned inference libraries.
- The network *is* used to load the app and, the first time, to download model files. WingIt claims that audio and answers never leave the device, not that the app makes no network requests.
- The Web Speech API is deliberately **not** used, because some browsers send that audio to a cloud service.

## Security
- A strict CSP is set via a meta tag: `default-src 'self'`; scripts only from self and jsDelivr; `connect-src` limited to the model hosts; no inline scripts or styles; `object-src 'none'`.
- All model output is validated, length-capped and rendered with `textContent`. No `innerHTML` exists anywhere (`scripts/check.mjs` enforces this).
- Transcripts are capped at 2,000 characters, stripped of tag-like syntax, and wrapped as data; the system prompt tells the model to ignore instructions inside them. Fabricated quotes are dropped.
- Generated scenarios pass a safety screen (sexual content, self-harm, real violence, extremism, drugs) and fall back to the deck if they fail. Ordinary conflict, awkwardness, satire and absurdity are allowed.

---

## 4. Setup

### For players
Open the hosted page in a recent desktop Chrome or Edge, Chrome on Android, or Safari 26+. Tap **Start playing**.
- Speech: on the first tap of the mic, about 41–77 MB downloads, then it's cached.
- Coach: on your first **Get feedback**, WingIt explains the one-time download (~1 GB by default) and asks before starting it.

### Host it (GitHub Pages, free)
Repository **Settings → Pages → Deploy from a branch → `main` / root**. That's it: no build. The `.nojekyll` file is included.

### Run locally
Any static server works. The page must be served over `http://localhost` or HTTPS for the mic to work; opening it as `file://` won't.
```bash
python3 -m http.server 8080      # then open http://localhost:8080
```

### Develop and test
Node 20+ and Python 3 with Playwright. There is no `npm install` and no runtime dependencies.
```bash
node scripts/check.mjs                 # syntax + project rules (no innerHTML, no remote AI APIs, etc.)
node --test tests/*.test.js            # unit + integration
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e/run_e2e.py           # browser tests (writes screenshots to tests/e2e/screenshots/)
```
CI runs all three (`.github/workflows/test.yml`).

---

## 5. Testing report

| Suite | Result | What's real vs mocked |
| --- | --- | --- |
| Static checks (`scripts/check.mjs`) | ✅ 29 files | Real |
| Unit (`tests/unit.test.js`) | ✅ | Real code: modes and rubrics, deck generation and repetition avoidance, scenario validation and safety, feedback validation (incl. fabricated-quote removal and malformed JSON), answer validation, prompt-injection wrapping, state machine and stale tokens, persistence and corruption handling, cache clearing, resampling |
| Integration (`tests/integration.test.js`) | ✅ (81 tests total with unit) | Real controller, coach queue, timeouts, retries, validation, session and store. **Model runtime, transcriber and microphone are fakes** |
| Browser (`tests/e2e/run_e2e.py`, Chromium) | ✅ 13/13 | Real UI in a real browser. **Model runtimes are fakes** (`tests/e2e/fakes.js`). The mic test uses the **real capture pipeline** (getUserMedia → AudioWorklet → resample) with Chromium's fake audio device. It verifies ~2 s of PCM reached the transcriber, that every mic track ended, and that no network request was made during the audio flow. Also covered: the primary flow, coach-written card labelling, mic denial, no WebGPU, stale-result discard, keyboard-only play with visible focus, settings / dark mode / reduced motion / persistence, favourites and clear, easier/harder, all 6 modes, 375 px mobile with no horizontal overflow, and model output rendered as inert text |

**Not verified in this build environment.** Its network blocks jsDelivr and Hugging Face, so these need a manual check on a real device:
- [ ] Real Whisper download and transcription quality (`base.en` and `tiny.en`).
- [ ] Real WebLLM download, load time and feedback quality for each coach model, including the f32 fallback.
- [ ] That the pinned CDN builds import cleanly inside the module workers.
- [ ] Safari / Firefox WebGPU behaviour, and iOS microphone behaviour.

Everything around those calls (prompts, schemas, retries, validation, errors) is tested. The calls themselves are not.

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
3. Add a service worker so the app shell also works fully offline after the first visit.
4. Add multilingual Whisper (`base`) plus a matching language setting.

## Licences
App code: MIT. Whisper: MIT. Qwen2.5 0.5B/1.5B: Apache-2.0. Phi-3.5 mini: MIT. WebLLM: Apache-2.0. Transformers.js: Apache-2.0. ONNX Runtime Web: MIT.
