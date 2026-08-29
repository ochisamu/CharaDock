# Changelog

All notable changes to CharaDock will be documented here.

## Unreleased

## 0.5.1 - 2026-08-29

- Smooth ATOM Voice Wi-Fi playback by keeping a bounded six-chunk PCM window in flight instead of serializing every 32 ms chunk behind a network round trip.

## 0.5.0 - 2026-08-29

- Add the first CharaDock ESP32 voice-device integration for ATOM Echo, with authenticated Wi-Fi or USB transport, push-to-talk and hands-free VAD, Chat/Work parity, standard TTS, GPT-Live, Beatrice 2, speaker DSP, adjustable gain, and microphone threshold controls.
- Separate CharaDock Link and ESP32 devices into focused settings pages, with device-specific controls isolated for future expansion.
- Add an opt-in five-minute idle close for the ATOM Echo GPT-Live session, disabled by default.
- Recover a standard Chat/Work voice follow-up as a new turn when it races the previous turn's completion, instead of leaving the device on a red error state.
- Recreate the ATOM Echo WebRTC audio bridge when switching between standard TTS and GPT-Live, and retain initial audio until the peer connection is ready.
- Reset the ATOM Echo audio session when switching between Work and Chat, discard in-flight input from the previous mode, and prevent a new Chat utterance from being steered into an older Work turn.

- Adopt the CharaDock identity across the application, package metadata, documentation, landing pages, release workflows, and internal service/storage identifiers; add the new format-neutral CharaDock icon.
- Route typed messages through the active GPT-Live session so its selected Live voice produces the reply, while keeping Realtime sessions record-button-only.
- Preserve every GPT-Live conversation turn when transcript events arrive consecutively or out of order, and let idle Live sessions speak character-click reactions without adding those reactions to conversation history.
- Move character voice controls into the Character page, clearly show whether Live or standard TTS is active, and disable the unused voice path.
- Keep the Settings conversation composer text-only, remove its nonfunctional microphone controls, and fix user-bubble contrast in light appearance.
- Make character memory proactive on every conversational turn and add in-place updates for corrected or changed preferences while retaining per-character isolation and sensitive-data rejection.

- Persist up to 20 conversation turns separately for each character and restore the latest 12 work records after restart; expose the same compact history panel in Chat and Work modes while limiting AI context to recent relevant entries.
- Add character-scoped long-term user memory with app-server save/list/forget tools, a bounded always-visible profile block, secret/sensitive-data rejection, and inspect/delete controls in Character settings.
- Sanitize only the TTS copy of an answer, skipping URLs, emails, file paths, code, hashes, citations, emoji, and dense markup while keeping readable Markdown link labels and the original displayed response intact.
- Add an optional personality/speaking-style field to single-image character creation, infer it only when omitted, remove automatic/Codex local-audio input choices in favor of explicit providers, and publish Windows packages as ochisamu.
- Remove the OmniVoice/VocoLoco provider from the app while leaving previously downloaded model files untouched for user-controlled cleanup.
- Add safe `.purupuru` import in the Character tab, copying all avatar states, hair layers, package settings, thumbnail, and embedded item PNGs into app-owned storage; imported characters can be switched, edited, and deleted like generated characters.
- Drive generated-audio lip sync from an adaptive real-waveform envelope with faster attack, natural release, dynamic loudness normalization, and 32ms updates instead of synthetic mouth pulses.
- Allow generated characters to be deleted from the Character tab, including their app-owned image files and per-character profile/TTS settings, while protecting bundled characters and the generated-character storage root.
- Rebuild single-image avatar generation around canonical registered edits and deterministic eye/mouth compositing; add independent pixel-level rejection for copied variants, baked checkerboards, opaque/oversized hair layers, missing expression changes, registration drift, invalid rig geometry, and bad six-state previews, with two automatic repair turns before installation.
- Accelerate Irodori WebGPU with selectable Sway sampling, an 8-step default, cached reference/speaker encodings, idle prewarming, BudouX-guided natural phrase chunks targeting 40 characters (up to 44 to avoid tiny tails), and chunk-by-chunk playback/prefetch with per-stage timing logs; keep the bubble on the segment being prepared/spoken instead of flashing the full answer first.
- Route Realtime through the workspace-write Codex worker while Work mode is selected, retain work history/progress/interruption, isolate Chat mode as read-only, and buffer assistant transcript deltas so the first displayed character is not lost.
- Start Realtime sessions only from the record button, group voices by approximate masculine/feminine/neutral impression with descriptive labels, and keep character clicks visual-only during Realtime, preventing preview or click speech from overlapping a live conversation.
- List GPT-Live voices from Codex app-server, save a separate Realtime voice per character, pass it to Realtime V3, suppress normal TTS during Live sessions, and stream delayed assistant transcripts into the persistent speech bubble.
- Improve long Irodori speech by always splitting at Japanese sentence endings, bounding unpunctuated inference chunks to 48 characters, and synthesizing one segment ahead while the current audio plays.
- Follow the proven Kokoro Web/Kokoro-JS WebGPU path by using the recommended FP32 model and explicitly downloading output tensors; detect zero or non-finite GPU output, regenerate it on CPU, and retain the working CPU setting instead of playing silence.
- Allow delayed local TTS audio to autoplay after synthesis finishes, and report an error instead of silently succeeding when a provider returns no audio segments.
- Fix Kokoro Japanese G2P initialization to compile its large WASM asynchronously, avoiding Electron's 8 MB synchronous-compilation limit on both CPU and GPU paths.
- Add Kokoro 82M with five Japanese voices, verified on-demand q8 model downloads, WebGPU-first inference, automatic CPU fallback, per-character voice selection, and local OpenJTalk-based Japanese G2P.
- Store Irodori reference audio as app-owned 48 kHz WAV files, accept common compressed audio formats, manage multiple named voices, preserve pitch during speed adjustment, and save the TTS provider/voice per character.
- Isolate Supertonic 3 native inference in a disposable Node-mode Electron worker so native external buffers cannot crash the main process; return only serialized WAV data to the app.
- Add 350 ms of piper-plus sentence-tail silence to prevent clipped endings, and relabel/retry experimental realtime voice as GPT-Live / Codex Voice in a new empty voice task.
- Add verified in-app downloads, live progress, automatic selection, removal, and manual-file fallbacks for the piper-plus Tsukuyomi-chan sample, Supertonic 3 int8, and the required Irodori FP16 artifacts.
- Add Supertonic 3 as an optional Japanese local TTS provider using the bundled sherpa-onnx CPU runtime, with ten voices, speed, and diffusion-step controls.
- Add Irodori TTS as an optional local WebGPU provider with a consented reference WAV, deterministic step/seed controls, and no model or voice upload.
- Add piper-plus as a local TTS provider with adjustable speed, sentence-synchronized playback and lip sync, plus prominent Tsukuyomi-chan credit and usage terms.
- Retain browser or foreground-computer permission for five minutes after a completed turn, reuse it only for explicit operational follow-ups, and revoke it on ordinary conversation, stop phrases, expiry, window close, or a different browser host.
- Normalize Latin words only at the TTS boundary with a configurable user dictionary, built-in technical readings, Japanese acronym names, and a CMUdict-to-Katakana fallback; preserve the original on-screen text and code-like identifiers.
- Keep the mascot continuously visible during screen/computer captures by temporarily excluding its window from Windows capture instead of hiding and restoring it.
- Expand the consented visible browser with referenced control clicks, safe text entry, option selection, keys, scrolling, and waits; disable built-in web search for the browser turn and reject any answer that did not use the dedicated browser tools.
- Add consent-gated Windows foreground control for one conversation turn, with screenshot-guided click, Unicode typing, hotkey, scroll, wait, a 30-operation cap, visible progress, interruption, and strict blocking instructions for destructive or sensitive actions.
- Recognize Japanese requests such as screen capture, desktop capture, browser search, and direct-URL reading as consent-gated actions; force approved browser turns through the visible browser tools instead of silently falling back to built-in web search.
- Slow and smooth speech-driven mouth/body motion, keep short two-line speech bubbles fully visible, and delay thinking fillers until 2.6 seconds without cutting them off when the answer becomes ready.
- Read screen/browser permission prompts aloud and accept spoken approval or denial while VAD is active.
- Register browser actions as flat app-server tools for broader model compatibility and report cross-host redirects or page-load failures explicitly.
- Synchronize happy, surprised, and soft expressions to each spoken sentence without pinning the mouth or eyes; drive Style-Bert-VITS2 lip sync from the real audio waveform, add stable threshold hysteresis, and show the sentence currently being spoken before restoring the full reply.
- Add switchable local sherpa-onnx ASR models (Japanese Parakeet CTC, Japanese ReazonSpeech Zipformer, SenseVoice, Whisper base, and Whisper tiny) with independent verified downloads, plus a verified Silero neural VAD with energy-based fallback.
- Strip internal Codex citation markers before display and speech, keep VAD recording alive with a 600ms pre-roll across repeated utterances, add conversation/work interruption controls, and show only the latest work update with full progress retained in a disclosure history.
- Fix Style-Bert-VITS2 playback by allowing generated `data:` audio in the desktop CSP, preserving the API response audio MIME type, and surfacing decoder-specific playback errors.
- Start Style-Bert-VITS2 playback from the first completed visible sentence and continue through an interruptible ordered queue, avoiding the former whole-response synthesis delay and duplicate final playback.
- Add selectable voice-input providers: automatic Japanese-local recognition, explicit Realtime, embedded sherpa-onnx ASR, device speech recognition, and OpenAI transcription.
- Add Codex CLI 0.145 `localAudio` input as a selectable provider, with direct VAD-to-turn sending and automatic cleanup of temporary recordings.
- Add adaptive VAD, silence-stop transcription, optional auto-send, and low/normal/high sensitivity for compact sherpa-onnx/OpenAI voice input; remove unreliable Japanese wake-word activation.
- Keep the latest chat reply visible and expand each character's filler variations.
- Preserve short follow-up context with a bounded in-session conversation backup, and make click reactions invoke bubble/TTS playback directly.
- Stop automatic Realtime attempts, prefer Japanese-local recognition in automatic mode, and move explicit Realtime sessions to the current experimental V3 voice path.
- Bundle the sherpa-onnx native runtime while downloading and SHA-256-verifying the optional 116MB multilingual Japanese model only on request.
- Populate conversation/work Codex model dropdowns from app-server `model/list` instead of requiring model IDs to be typed manually.
- Restore mouse following across the complete transparent mascot window, including its touch and compact-chat overlays.
- Expand per-character motion controls with follow speed, breathing, body lean/bounce, hair spring, and hair sway, all with live preview.
- Limit mouse following to the time the cursor is actually over the mascot and return its gaze to center immediately on leave.
- Read touch/click reactions aloud through the selected system or Style-Bert-VITS2 voice.
- Add separate Codex app-server model and reasoning-effort settings for conversation and work, while migrating the former shared model setting.
- Fix unreadable native select options in Windows light mode and move voice-input provider selection alongside the desktop audio controls.

- Add a responsive OS-adaptive GitHub Pages landing page, rebuild the README around the current product experience, and add pinned Actions workflows for Pages deployment and Windows installer/portable draft releases with SHA-256 manifests.
- Use fully composited hair-on character previews in README and Pages, and describe the human cast consistently as desktop companions rather than pets.
- Remove 366 Google Fonts unicode-subset files and their fetch pipeline; the browser editor now uses the operating-system font stack while the required offline MediaPipe runtime remains vendored.
- Replace the shared purple theme with an OS-adaptive neutral design system: light frost or dark graphite materials, character-linked amber/terracotta/slate accents, and the selected character portrait in the sidebar.
- Redesign the settings, onboarding, conversation, character, connection, and desktop surfaces with clearer type hierarchy, thicker task-focused materials, immediate press feedback, source-anchored transitions, live frame-level motion previews, and reduced-motion/transparency/high-contrast adaptations.
- Refine the transparent mascot UI with a face-anchored speech tail, denser readable long-answer and work-history surfaces, responsive press states, and uninterrupted 1:1 dragging before edge snap on release.
- Add a consent-gated Codex browser session: conversational approval opens a visible clean-profile window, exposes only read-only navigation tools, scopes access to one host for one answer, blocks cross-host navigation, and revokes agent control after the turn.
- Add consent-gated one-shot screen sharing for Codex: natural requests such as “今の画面を見て” trigger an in-character permission prompt that accepts conversational approval/denial or compact buttons, captures only the current display once, treats visible text as untrusted, and deletes the temporary image after the turn.
- Add a compact work-history panel that retains the latest 12 requests, observed operations, and completion results independently from the speech bubble, with interruption of the active Codex turn and automatic dismissal outside active use.
- Apply the selected character personality explicitly to short work-progress narration and final reports while keeping technical decisions, facts, commands, safety, and verification persona-neutral.
- Preserve the compact speech-bubble design for short replies while adding a fade cue, an accessible full-text toggle, and a bounded 270px scroll area for long replies; compact input now auto-grows up to a bounded height before scrolling.
- Clamp restored settings-window dimensions to a compact 720–900px height, eliminating the large empty dark lower region caused by a previously oversized window.
- Fade the compact composer in when hovering the character, widen the work-mode input while reducing its visual frame, and keep work progress in a dedicated status layer.
- Keep active work output intact when the character is touched, add animated touch feedback, avoid repeated phrases, and expand each bundled character to eight touch lines with varied expressions.
- Start the Codex app-server work client with live web search explicitly enabled; ordinary mascot chat remains constrained to conversation only.
- Remove residual low-alpha/chroma mattes from all three bundled desktop avatars and automatically clean newly generated avatars.
- Keep the settings window above the transparent mascot while it is open, preventing mouse-follow changes from covering the settings surface on Windows.
- Suppress the artificial contact shadow in transparent desktop/OBS output.
- Disable the Windows resize frame, rounded DWM corners, and system backdrop on the transparent mascot; size remains adjustable from settings.
- Detect ChatGPT-side Codex Realtime 404 responses, avoid repeated attempts for the current app session, and automatically continue with device speech recognition without exposing backend URLs.
- Prevent Windows compositor blackouts by keeping the settings renderer active, applying transparent-window styles only when their values change, and pausing cursor animation whenever settings are visible. Mouse following starts only after the mascot itself receives focus.
- Automatically reload only the settings renderer after mouse-follow is changed—the same recovery as Ctrl+R—while retaining the Character page and its scroll position.

- Added streaming desktop chat for Codex app-server and OpenAI Responses API.
- Added Codex Realtime WebRTC voice with automatic device-recognition fallback.
- Added a compact conversation/work switch directly on the transparent avatar, with workspace-write limited to the user-selected folder.
- Added first-run ChatGPT login, character selection, and audio onboarding.
- Added per-character motion-range and display-size previews, edge snapping, position locking, and multi-monitor handling.
- Added per-character names, inferred personalities, editable speech-bubble placement, and touch reactions.
- Added idle breathing/gaze motion and 27 generated emotion/mouth assets across the three custom characters.
- Added a Codex app-server-only avatar studio that runs the bundled `$build-purupuru-avatar` Skill to turn one uploaded illustration into validated standard PNGTuber differences, a hair layer, rig anchors, and an inferred character personality.

- Enriched hair spring physics for a snappier, more elastic look (reference-video based): stiffer tip springs with lower damping ratio (★5), vertical squash-and-stretch that fans hair outward on downward head motion (★9), and an S-curve bend term that propagates head motion from root to tip as a whip-like wave (★10).
- Added the "draw a new character" feature: paint face, eye, mouth, and hair layers in the browser and auto-compose the six expression PNGs into a new character, with brush stabilization, pen pressure, zoom/pan, expression previews, and keyboard shortcuts.
- Added re-editing of drawn characters from the character menu.
- Added character deletion from the character switcher, including suppression of automatic demo character re-seeding after deletion.
- Added a one-time managed refresh so bundled character 2/3 profiles stored in the browser are re-synced to the repository default settings.
- Added the standalone drawing tool export under `standalone_drawing_avatar_export/`.
- Vendored MediaPipe Tasks Vision assets locally for camera-based face tracking.
- Changed face tracking to CPU delegate by default, limited detection to 15fps, and kept GPU as explicit opt-in via `?faceDelegate=gpu`.
- Hardened autosave, IndexedDB profile writes, OBS helper communication, SSE reconnect handling, and local-server request body handling.
- Added CI, Dependabot, security headers/guards, and regression coverage for package/import/server safety checks.
- Prepared repository structure for a future public release.
- Renamed the bundled sample character directory to `assets/demo-avatar/`.
- Added public-facing documentation, support, security, contribution, and GitHub template files.
- Switched software code and documentation text to Apache License 2.0.
- Kept bundled visual assets under a separate asset license.
