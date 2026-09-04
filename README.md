<p align="center">
  <img src="./app-icon.png" width="88" height="88" alt="CharaDock app icon">
</p>

<h1 align="center">CharaDock</h1>

<p align="center"><strong>Give your character a place—and a pulse.</strong></p>
<p align="center">Talk, remember, and work together. A Windows desktop companion that connects transparent characters with Codex.</p>

<p align="center">
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Code: Apache-2.0" src="https://img.shields.io/badge/code-Apache--2.0-20201f?style=flat-square">
  <img alt="Platform: Windows; macOS source preview" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20source-20201f?style=flat-square">
  <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-20201f?style=flat-square">
  <img alt="Status: pre-release" src="https://img.shields.io/badge/status-pre--release-df9848?style=flat-square">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#create-a-character-from-one-image">Avatar Studio</a> ·
  <a href="./DESKTOP_APP.md">Desktop guide</a> ·
  <a href="./docs/usage.md">Browser editor guide</a>
</p>

<p align="center">
  <img src="./docs/images/charadock-hero.webp" alt="Kohaku, Sepia, Towa, and Sage in CharaDock" width="960">
</p>

CharaDock is an unofficial derivative of [rotejin/PuruPuruPNGTuber](https://github.com/rotejin/PuruPuruPNGTuber). Its characters breathe, look around, speak with you, and—when asked—work with Codex inside a folder you choose. The input, history, and work controls appear only when needed; the character stays quietly at the edge of your desktop the rest of the time.

> [!IMPORTANT]
> This project is currently a pre-release. The software is Apache-2.0, but visual assets have separate terms. Review [Licenses and assets](#licenses-and-assets) before publishing, forking, or distributing it.

## What it does

| Talk | Work | Create your own character |
| --- | --- | --- |
| Responses stream beside the character's face. Configure voice input, speech, expressions, and lip sync per character. | Switch between `Chat / Work` from a compact control. Codex works only inside one selected folder and keeps its progress and results in history. | `Codex Avatar Studio` turns one illustration into eye, mouth, expression, and hair layers, initial rig settings, and a personality. |

### Motion that belongs on the desktop

- Transparent, frameless, always-on-top character window
- Breathing, blinking, hair motion, quiet idle gaze, and three-stage lip sync driven by the real audio waveform
- Mouse tracking only while the pointer is over the character
- Edge snapping, position locking, and multi-monitor support
- Per-character size, motion range, tracking speed, movement, personality, speaking style, and bubble position
- Light/dark appearance, high contrast, reduced motion, and reduced transparency support

### Conversations that can continue

- ChatGPT sign-in through Codex app-server, or the OpenAI Responses API
- Long-response bubbles show the sentence currently being spoken, then return to the full response
- Conversation and work history restored after restarting the app
- Up to 20 recent conversation turns per character
- Character-specific long-term memory that automatically extracts useful names, preferences, relationships, and ongoing goals
- Up to 24 local memory entries, with review and individual or complete deletion
- A durable Character Home for each avatar, plus switchable references to existing projects without moving their files
- In-app output cards for text, images, audio, video, PDF, folders, and sandboxed static web previews
- Live previews for Next.js, Vite, Nuxt, Astro, SvelteKit, and other package-script web apps, with server status and logs kept inside CharaDock

Temporary requests, guesses, content copied from external websites, secrets, contact details, addresses, and sensitive attributes are not stored as long-term memory. Memories are never shared between characters.

### CharaDock Link — experimental remote access

From Settings, you can explicitly enable an avatar-first remote view on the same private Wi-Fi. Pair each device with a short-lived QR code; an approved device then reconnects without rescanning until it is removed from CharaDock. You can send text to Chat or an opt-in Work mode, inspect a live activity timeline and elapsed time, queue a follow-up that safely interrupts the current turn, open full-screen history, and preview output cards. The phone can switch characters, ready standard-TTS providers, and provider-specific voice models saved for each character, with independent PC and phone playback. GPT-Live can be started and stopped on the phone, with response audio and synchronized captions delivered directly to that phone. When opened over HTTPS, the phone microphone can feed Live directly. A phone-direct Live session plays the selected GPT-Live voice without the PC-side Beatrice 2 conversion stage.

Over a verified Tailscale HTTPS connection, screen-capture, browser-control, and foreground computer-control requests appear as expiring approval cards on the phone. The same secure route can install CharaDock Link as a Home Screen PWA, optionally keep the display awake during Work or Live, and show completion or approval-waiting notifications while Link remains active in the background. When Tailscale Serve is active, the pairing QR code and copied pairing URL automatically switch from the LAN address to the verified HTTPS address. Plain LAN HTTP deliberately cannot answer sensitive approval requests.

The pairing URL expires after its first use or 10 minutes. Trusted-device records are stored on the PC as hashes, so a paired device reconnects automatically after its short active session expires. Device trust lasts for 180 days and can be revoked individually or globally at any time. Pair again after clearing the browser cookie, trust expiry, or revocation.

The normal local-LAN route remains plain HTTP and is intended for text control. Browser microphone APIs require HTTPS, so voice input and remote access outside the LAN can optionally use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Settings lets you choose both the local listening port and Tailscale HTTPS port, then inspect, start, and stop the route. CharaDock refuses to overwrite an existing Serve root and stops only a route it started. Tailscale is optional; do not forward the router port or use the public Tailscale Funnel mode.

### ESP32 voice devices

The separate [CharaDock-ESP32](https://github.com/ochisamu/CharaDock-ESP32) project provides firmware that turns the M5Stack ATOM Voice (formerly sold as ATOM Echo) into a compact wireless voice device. After one USB-assisted Wi-Fi pairing, it can use button or hands-free input and play standard character TTS, GPT-Live, or Beatrice 2 audio through its built-in speaker. Chat/Work, character, voice, and workspace remain authoritative on the PC.

> **Product-name note:** Product code `M5STACK-C008-C` was renamed from “ATOM Echo” to “ATOM Voice” in April 2026; it remains the same original ESP32-PICO-D4 device. See the [Switch Science ATOM Voice product page](https://www.switch-science.com/products/6347) for purchasing and specifications. CharaDock v0.5.1 retains “ATOM Echo” in its settings and firmware names for compatibility.

Settings has an independent **ESP32 devices** page with output gain, live microphone level and threshold controls, and an optional five-minute idle close for the device's Live connection. The idle close is on by default to avoid leaving a paid Live session connected, and can be disabled when continuous standby is preferred. Device-specific controls are isolated so future hardware can be added without mixing its settings into ATOM Echo.

The same page supports the **Waveshare ESP32-S3-RLCD-4.2** as a USB/Wi-Fi character display and voice device. CharaDock verifies Device Protocol v2 capabilities, converts the selected character to deterministic 400×300 1-bit neutral, blink, and three-stage mouth portraits, and atomically synchronizes Home, Conversation, Work, and recovery scenes. All five bundled characters use registered, image-generated RLCD manga-ink sets with white faces, strong contours, and restrained black fills; the in-app character generator creates the same four-frame set for a completely new character. Imported `.purupuru` packages may bundle that set, while older packages without it keep the generic eye/mouth-layer fallback. Frames are loaded before speech and switched locally from measured PCM at up to 4 fps. Variable blink timing and an occasional double blink add life without shifting the full image, which avoids reflective-panel ghosting. Manga conversion is the default because its clean outlines and selective fills preserve faces without visible halftone dots; the earlier illustration dither remains selectable. The RLCD-specific card manages transport, USB-only Wi-Fi provisioning, captions, firmware identity, sensors, speaker, microphone, push-to-talk or hands-free capture, live VAD threshold, and a bounded 50–150% speaker level. Standard character TTS, GPT-Live, and optional Beatrice audio are generated on the PC, converted to 16 kHz mono, buffered on the device, and played through its ES8311 path. The onboard ES7210 sends 16 kHz microphone PCM back to the PC for the currently selected Chat, Work, or Live route; push-to-talk starts a bounded local preroll at KEY press so the beginning is retained while the long press is recognized. CharaDock prefers authenticated Wi-Fi and keeps USB as setup/fallback; heartbeats and bounded reconnect restore the complete portrait/scene Snapshot while the powered display retains its last verified character offline. After five idle minutes the device switches locally to a clock/environment dashboard that retains a pixel-exact center crop of the character; KEY toggles it immediately and voice activity exits it. An enabled ESP32-device Live session also closes after five idle minutes by default while USB/Wi-Fi remains available; recording and response playback suspend the timer, and the next long press reconnects automatically. No TTS engine, model, conversation runtime, or OpenAI credential is installed on the RLCD. Build and flashing instructions are in the [CharaDock-ESP32 RLCD 4.2 firmware project](https://github.com/ochisamu/CharaDock-ESP32/tree/main/firmware/waveshare-rlcd-4.2).

The device protocol is intended for a trusted private LAN. RLCD provisioning creates a random 256-bit pairing secret and uses it for mutual HMAC-SHA256 authentication so the PC verifies the device and the device verifies the host. CharaDock does not expose the router port or place OpenAI credentials in firmware. See the [ATOM Echo guide](./docs/atom-echo-mvp.md) and [CharaDock-ESP32 protocol](https://github.com/ochisamu/CharaDock-ESP32/blob/main/docs/protocol.md) for behavior and troubleshooting.

### Choose how the character listens and speaks

The input provider is always selected explicitly. CharaDock does not start Codex Realtime automatically or silently fall back to another provider after a failure.

- **Input:** Codex Realtime, local sherpa-onnx, system speech recognition, or OpenAI transcription
- **Local recognition:** Japanese Parakeet CTC, ReazonSpeech Zipformer, SenseVoice, and Whisper base / tiny
- **VAD:** Silero VAD with automatic pause detection, optional auto-send, and three sensitivity levels
- **Output:** Windows system speech, Style-Bert-VITS2, piper-plus, Supertonic 3, Kokoro, or Irodori TTS
- **Realtime:** Select a Live voice per character. A session runs only while recording is enabled, and typed messages use the same Live voice. On Windows, optionally route the 48 kHz stream through a separately installed Beatrice 2 VST3, manage multiple referenced models, and tune voice, pitch, formant, gain, intonation, and pitch correction per character
- **Speech cleanup:** Skip URLs, email addresses, paths, code, long hashes, and Markdown symbols; override pronunciation with a user dictionary

<details>
<summary><strong>Local speech models</strong></summary>

Download only the models you want from Settings. Downloads are SHA-256 verified, and the selected provider and voice are stored per character.

- **piper-plus:** Official C++ runtime and the Tsukuyomi-chan FP16 model, or a manually selected compatible ONNX model
- **Supertonic 3:** CPU inference through the bundled sherpa-onnx runtime, with F1–F5 / M1–M5 voices, speed, and generation-step controls
- **Kokoro:** Five Japanese voices. Automatic mode prefers WebGPU and regenerates on CPU when invalid or silent GPU output is detected
- **Irodori TTS:** Choose between v4 Small (recommended) and the previous 500M-v3 WebGPU Voice Clone model. v4 Small can use the high-quality FP16 set (about 1.7 GB) or a lightweight W4A16 WebGPU set (about 853 MB) converted from the official INT4 checkpoint. It supports Voice Design captions or consented Voice Clone references up to 120 seconds. Per-character base captions can automatically follow each spoken segment's emotion at three intensity levels without an extra AI request; caption and speaker conditions are cached to keep latency low. The 500M-v3 option preserves existing reference-voice setups and supports references up to 60 seconds. WAV, MP3, M4A, AAC, OGG, FLAC, and WebM references are converted to 48 kHz WAV and copied into app-managed storage. Each pinned model can be downloaded and SHA-256 verified in the app, or selected manually; none is bundled with CharaDock

Long responses are divided at sentence or natural phrase boundaries. The next segment is generated while the current one plays. Style-Bert-VITS2 supports a local API URL, model ID, and speed setting.
</details>

## Included characters

Desktop builds include five bundled characters.

| Kohaku | Sepia | Towa | Sage | AI Nike-chan |
|:---:|:---:|:---:|:---:|:---:|
| <img src="./docs/images/characters/amber-complete-v2.png" alt="Kohaku" width="160"> | <img src="./docs/images/characters/bronze-complete-v2.png" alt="Sepia" width="160"> | <img src="./docs/images/characters/towa-complete-v1.png" alt="Towa" width="160"> | <img src="./docs/images/characters/sage-complete-v1.png" alt="Sage" width="160"> | <img src="./docs/images/characters/nike-complete-v1.png" alt="AI Nike-chan" width="160"> |
| Bright and candid; gives you a positive push. | Perceptive, composed, and dependable. | Quick-witted; enjoys discovering and trying things together. | Calm and thoughtful; brings structure to complex ideas. | Connects AI-character research, creation, and real-world practice. |

Kohaku, Sepia, Towa, and Sage include standard eye and mouth states plus happy, surprised, and gentle expression variants. AI Nike-chan includes open/closed eye states and three mouth states from the authorized character asset set. The settings UI and companion controls adopt the selected character's accent color.

AI Nike-chan is bundled with permission. Credit: [tegnike](https://x.com/tegnike) · [AI Nike-chan official site](https://nikechan.com/). The character assets are not licensed under Apache-2.0; see [the asset notice](./assets/nike-avatar/ASSET_NOTICE.md).

## Quick start

### Windows — download a release

Download the newest installer or portable executable from [GitHub Releases](https://github.com/ochisamu/CharaDock/releases):

- **Installer:** download `CharaDock.Setup.*.exe` and follow the setup flow
- **Portable:** download `CharaDock.*.exe` and run it from any folder

Current pre-release builds are unsigned, so Windows may display a SmartScreen warning. The app can check GitHub Releases at startup and guide both installed and portable editions to a newer version.

### Requirements for running from source

- Windows 10 / 11 x64
- Node.js 22 or later; Node.js 24 is recommended
- A sign-in-capable [Codex CLI](https://github.com/openai/codex) installation for Codex features
- Python 3.11 and [uv](https://docs.astral.sh/uv/) only when running Python validation

### Run the development build

```bash
npm ci
npm run desktop
```

When developing under WSL, launch the real Windows Electron runtime without creating distributable executables:

```bash
npm run desktop:win:dev
```

Windows dependencies are installed only on the first launch or when the package manifests change. Later launches incrementally sync into `%LOCALAPPDATA%\CharaDockDev\source`, while settings and downloaded models persist in an isolated `CharaDockDev` profile. Use `npm run desktop:win:dev:profile` only when a test explicitly needs the installed app's settings and models, after closing every installed or portable CharaDock instance. Development code may migrate the shared profile, so the isolated command is the safer default.

### macOS — experimental source preview

CharaDock does not currently provide a signed macOS application, DMG, or ZIP. To try it on macOS, clone the repository and run the Electron development build with Node.js 24:

```bash
git clone https://github.com/ochisamu/CharaDock.git
cd CharaDock
npm ci
npm run desktop
```

macOS support is an unsigned, experimental arm64 preview and is not covered by the Windows release tests. Download the macOS DMG or ZIP from the GitHub Release; its CharaDock app already contains the native Beatrice host. On macOS, computer control delegates to the official bundled Codex Computer Use skill when available; Windows system speech is unavailable. Other local speech and WebGPU features may depend on the Mac model and OS version. Source builds can check for newer releases but do not update themselves.

The first-run guide configures the AI connection, character, and speech provider. CharaDock also detects the Windows Store Codex installation. If `codex` is not on `PATH`, set `CODEX_CLI_PATH` to the executable.

1. Move the pointer over the `✦` beside the character to open the input.
2. Start a conversation, or select `Conversation` to switch into `Work` mode.
3. The first time you use Work, choose the folder Codex may modify.
4. Open `History` to revisit conversations, instructions, operations, and results.

| Action | Shortcut |
| --- | --- |
| Open the current mode's input | `Ctrl + Shift + Enter` |
| Open Settings | `Ctrl + Shift + M` |
| Toggle click-through | `Ctrl + Shift + L` |
| Toggle character visibility | `Ctrl + Shift + H` |

## Safe work and screen control

- Chat is read-only
- Work grants workspace-write access only to the active Home/project and the selected character's managed Home context
- Attached projects remain in their original location and can be switched or removed without deleting source files
- Static web outputs run in a sandboxed in-app preview with network access disabled
- Dynamic web previews run one visible local development server at a time. CharaDock shows the exact `dev`, `preview`, or `start` package command and asks before launching it; it never installs dependencies automatically
- A preview server is bound to `127.0.0.1`, stopped when its project changes or the app exits, and its bounded logs are not saved. Network requests made by the previewed application still follow that project's own implementation
- Conversation and work use separate tasks and permissions; each can use its own model and reasoning effort
- An active turn can be interrupted from history
- Screen capture, the dedicated browser, and computer control request permission in the conversation
- An explicit continuation such as “continue” may reuse permission for the same operation for up to five minutes
- Permission expires for another site or purpose, an ending phrase, five minutes of inactivity, or when the dedicated browser closes
- Deletion, sending, purchasing, installation, authentication or payment changes, and secret entry are never automated
- Temporary screenshots are deleted after the response

Browser actions run in a visible, dedicated window and support navigation, links, clicks, search input, selection, keys, scrolling, and Back. While browser permission is active, ordinary web search is disabled and an answer that did not use the dedicated browser is stopped. Computer control checks the screen after each step and is limited to 30 actions per turn.

## AI connections and privacy

See the [CharaDock Privacy Policy](https://ochisamu.github.io/CharaDock/privacy.html) for the complete description of local storage, external AI and speech services, device permissions, remote access, retention, and deletion controls.

### Codex app-server

CharaDock starts the local `codex app-server --stdio` process. Codex manages the ChatGPT authentication token; CharaDock never receives it. Models returned by app-server appear in a dropdown, and conversation and work can use separate models and reasoning-effort settings.

GPT-Live / Codex Voice is experimental and its availability depends on the account and upstream implementation. Realtime starts as a new empty task only when recording is enabled. In Work it connects to a workspace-write task scoped to the selected folder, and voice-requested work is also saved to history.

CharaDock's Beatrice 2 voice-conversion integration uses its own small native VST3 host: `charadock-beatrice-host.exe` on Windows and an extensionless arm64 helper bundled inside the experimental macOS app. CharaDock does not redistribute Beatrice, its inference library, or voice models. Select an extracted official Beatrice folder in Voice settings, then add model folders to the referenced-model library. CharaDock never copies or deletes those external model files. Review each model's terms separately; the JVS sample model shipped with Beatrice 2.0.0-rc.2 prohibits unauthorized commercial use. See the [native host build guide](./native/beatrice-host/README.md) for source-build instructions.

### OpenAI API and local processing

CharaDock can use the Responses API for conversation and the Transcriptions API for speech recognition. API keys are never passed to the renderer and use OS-encrypted storage where available. sherpa-onnx, system recognition, normal lip sync, and supported TTS engines run locally. Audio leaves the device only when Codex Realtime or OpenAI transcription is explicitly selected.

## Create a character from one image

When connected to Codex app-server, select a PNG, JPEG, or WebP image in `Codex Avatar Studio`. The bundled [`.agents/skills/build-purupuru-avatar/`](./.agents/skills/build-purupuru-avatar/) workflow runs in an isolated workspace-write job and independently validates:

- Two eye states × three mouth states
- Happy, surprised, and gentle expression variants
- Movable front-hair and back-hair layers
- Initial rig, display size, and motion range
- A user-supplied or automatically suggested personality, speaking style, and click reactions

Only upload images for which you have all rights required to upload, modify, and use the result.

Existing `.purupuru` packages can also be added or deleted in character settings. Edited characters can be exported as a portable, self-contained `.purupuru` avatar package containing their images. It does not depend on the original PNG asset folder, so it can be backed up or moved to another PC.

## Windows binaries and GitHub Pages

Most Windows users should download the installer or portable executable from [GitHub Releases](https://github.com/ochisamu/CharaDock/releases). The following command is for maintainers building the packages locally.

Build the NSIS installer and portable executable locally:

```bash
npm run dist:win:installer
```

The [`Windows package`](./.github/workflows/release.yml) workflow runs the same build on a Windows runner. Manual runs keep artifacts for 14 days. A tag such as `v0.1.0` attaches both `.exe` files and `SHA256SUMS.txt` to a Draft Release. Development builds are currently unsigned.

The landing-page source is in [`site/`](./site/). `npm run site:build` generates `site-dist/`, and the [`GitHub Pages`](./.github/workflows/pages.yml) workflow builds the public artifact on updates to `main`.

## Browser PuruPuru editor

The original browser editor and transparent OBS view remain available:

```bash
uv run python scripts/run_local_server.py
```

Open the displayed `http://127.0.0.1:8223/` URL in Chrome or Chromium. See [docs/usage.md](./docs/usage.md) for asset formats, OBS setup, and tuning.

## Development and tests

```bash
npm test
npm run site:build
```

| Path | Contents |
| --- | --- |
| `desktop/` | Electron main process, preload, settings, and conversation UI |
| `assets/` | Character images and PuruPuru settings |
| `.agents/skills/` | Codex skill for creating a character from one image |
| `site/` | GitHub Pages landing page |
| `vendor/mediapipe/` | MediaPipe runtime, WASM, and models required for offline face tracking |
| `scripts/` | Local server, site build, and validation helpers |
| `tests/` | Node, JavaScript, and Python tests |

Only the MediaPipe runtime and models that cannot be restored by `npm install` are kept in `vendor/`. See [docs/vendor-update.md](./docs/vendor-update.md) for the update process.

## Licenses and assets

- Software code and documentation: [Apache License 2.0](./LICENSE)
- Upstream project and changes: [NOTICE](./NOTICE), [MODIFICATIONS.md](./MODIFICATIONS.md)
- Third-party dependencies: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
- Bundled Irodori reference voices: `hiro.wav` is recorded and authorized by ochisamu; `kohaku.wav` uses voice material from [あみたろの声素材工房 (Amitaro's Voice Material Workshop)](https://amitaro.net/) under its [current voice terms](https://amitaro.net/voice/voice_rule/)
- Four project-original desktop characters and the CharaDock icon: [DISTRIBUTION_ASSET_LICENSE.md](./DISTRIBUTION_ASSET_LICENSE.md)
- AI Nike-chan: bundled with permission; credit [tegnike](https://x.com/tegnike) and the [official site](https://nikechan.com/). See [assets/nike-avatar/ASSET_NOTICE.md](./assets/nike-avatar/ASSET_NOTICE.md)
- Upstream sample assets retained by the browser editor: [ASSET_LICENSE.md](./ASSET_LICENSE.md)

Desktop distributions exclude the upstream legacy demo characters and legacy favicon. Upstream samples left in the source tree are retained only for browser-editor compatibility and validation; they are not covered by Apache-2.0.

### Bundled visual asset provenance

The source illustrations and derived variants for Kohaku, Sepia, Towa, and Sage were created for this project with OpenAI `gpt-image-2`; they are not the upstream repository's legacy demo characters. Their RLCD line-art sets, and AI Nike-chan's separately authorized RLCD presentation derivatives, were also produced with OpenAI image generation from the applicable character references. The CharaDock icon was created with OpenAI image generation and finalized locally as a multi-resolution app asset. Under the [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/), as between the creator and OpenAI and to the extent permitted by law, the creator owns the generated Output. AI-generated Output may not be unique, and independently existing third-party rights are not waived or guaranteed by that provision. Distribution-specific usage conditions are recorded in [DISTRIBUTION_ASSET_LICENSE.md](./DISTRIBUTION_ASSET_LICENSE.md).

AI Nike-chan is a separately authorized character and is not covered by the project-original asset statement above. Its bundled eye and mouth variants come from the character data supplied in the CharaDock profile and are included with permission from tegnike. No broader reuse license is granted.

## Contributing

- [Sponsor CharaDock development](https://github.com/sponsors/ochisamu)
- [Contributing](./.github/CONTRIBUTING.md)
- [Security policy](./.github/SECURITY.md)
- [Support](./.github/SUPPORT.md)
- [GitHub release checklist](./docs/github-release-checklist.md)

CharaDock is not endorsed by or affiliated with the original PuruPuru PNGTuber developer.
