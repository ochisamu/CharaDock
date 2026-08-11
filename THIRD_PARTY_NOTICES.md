# Third-Party Notices

PuruPuru PNGTuber vendors the MediaPipe face-tracking runtime assets used by the optional camera tracking feature so the app does not need to execute JavaScript from external CDNs at runtime.

## Vendored libraries and model assets

### PuruPuru PNGTuber

- Project: PuruPuru PNGTuber
- Author: masa / rotejin
- Source: https://github.com/rotejin/PuruPuruPNGTuber
- License: Apache License 2.0

CharaDock is an unofficial modified work. The upstream demo character
images and favicon are intentionally excluded from the packaged desktop binary.
Any upstream samples retained in the source tree for browser-editor compatibility
remain governed by their separate asset terms in ASSET_LICENSE.md.

### AIニケちゃん / AI Nike-chan

- Character: AIニケちゃん / AI Nike-chan
- Credit: tegnike
- Creator link: https://x.com/tegnike
- Official site: https://nikechan.com/
- Terms: included as a bundled CharaDock character with permission; not licensed under Apache License 2.0

The eye and mouth variants under `assets/nike-avatar` are included with
permission for use as part of CharaDock. This permission does not grant a
standalone extraction, redistribution, resale, model-training, or reuse
license. See `assets/nike-avatar/ASSET_NOTICE.md` and
`DISTRIBUTION_ASSET_LICENSE.md`.

### Electron

- Project: Electron
- Copyright: Electron contributors; GitHub Inc.
- Source: https://github.com/electron/electron
- License: MIT License

The packaged Electron runtime also supplies `LICENSE.electron.txt` and
`LICENSES.chromium.html` alongside the executable.

### Transformers.js and optional Work SLM models

- Runtime: Transformers.js 4.2.0
- Source: https://github.com/huggingface/transformers.js
- License: Apache License 2.0
- Optional model: onnx-community/Qwen3.5-0.8B-ONNX-OPT
- Model source: https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT
- Optional model: onnx-community/Qwen2.5-0.5B-Instruct
- Model source: https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct
- Qwen model licenses: Apache License 2.0
- Optional model: LiquidAI/LFM2.5-1.2B-JP-202606-ONNX
- Model source: https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX
- Model license: LFM Open License v1.0
- License source: https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX/blob/main/LICENSE

Commercial use under the LFM Open License is subject to its annual-revenue
threshold of USD 10 million. Users must review that license before using the
optional LFM model.

Neither Transformers.js nor the model weights are redistributed with
CharaDock. A pinned, SHA-256-verified browser runtime and the model files are
downloaded only after the user explicitly selects “Prepare model”. The
experimental SLM rewrites brief Work progress announcements and does not
replace Codex reasoning or final answers.

### Steinberg VST 3 SDK (Beatrice 2 host helper)

- Project: VST 3 Plug-in SDK
- Copyright: Steinberg Media Technologies GmbH
- Source: https://github.com/steinbergmedia/vst3sdk
- License: MIT License

CharaDock's optional Beatrice 2 integration includes a small, independently
built VST3 host helper linked against the SDK's MIT-licensed hosting sources.
The Beatrice VST3 plug-in and voice models are not redistributed by CharaDock.
Users select their separately obtained Beatrice folder at runtime and remain
responsible for the model's terms. In particular, the sample JVS model included
with Beatrice 2.0.0-rc.2 prohibits unauthorized commercial use.

MIT License — Copyright (c) 2025, Steinberg Media Technologies GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Lucide Icons

- Project: Lucide
- Copyright: Lucide Contributors
- Source: https://github.com/lucide-icons/lucide
- License: ISC License

Selected SVG interface icons are vendored under `assets/ui/icons/` and retain a
license marker in each file. Permission to use, copy, modify, and/or distribute
this software for any purpose with or without fee is hereby granted, provided
that the above copyright notice and this permission notice appear in all copies.
THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

### Noto Sans JP

- Project: Noto CJK / Noto Sans JP
- Copyright: 2014-2021 Adobe; Google and the Noto Project Authors
- Source: https://github.com/notofonts/noto-cjk
- Source commit: `f8d157532fbfaeda587e826d4cd5b21a49186f7c`
- Bundled file: `assets/fonts/NotoSansJP-VF.ttf`
- SHA-256: `f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369`
- License: SIL Open Font License 1.1

The variable Japanese subset is bundled so every CharaDock window can render
Japanese text consistently without downloading a web font at runtime. The
complete license is retained at `assets/fonts/LICENSE-NotoSansJP.txt`.

### pngjs

- Project: pngjs
- Copyright: Luke Page, Kuba Niegowski, and contributors
- Source: https://github.com/pngjs/pngjs
- License: MIT License

The MIT permission notices for Electron and pngjs are retained with the
corresponding installed packages and packaged runtime license files.

### node-qrcode

- Project: node-qrcode
- Copyright: Ryan Day and contributors
- Source: https://github.com/soldair/node-qrcode
- Runtime package: `qrcode` 1.5.4
- License: MIT License

The package generates CharaDock Link pairing QR codes locally. Pairing tokens
are not sent to an external QR-code service. The MIT license is retained with
the installed package and packaged runtime license files.

### highlight.js

- Project: highlight.js
- Copyright: Ivan Sagalaev and contributors
- Source: https://github.com/highlightjs/highlight.js
- Vendored browser runtime: 11.11.1
- License: BSD 3-Clause License

The local browser build and GitHub Dark Dimmed theme are used only to highlight
text and source-code artifact previews. CharaDock does not load highlighting
scripts from a CDN. The complete BSD 3-Clause license is retained at
`vendor/highlightjs/11.11.1/LICENSE`.

### markdown-it

- Project: markdown-it
- Copyright: Vitaly Puzrin, Alex Kocharin, and contributors
- Source: https://github.com/markdown-it/markdown-it
- Vendored browser runtime: 14.3.0
- License: MIT License

The local browser build renders Markdown artifacts without enabling embedded
HTML. The complete MIT license is retained at
`vendor/markdown-it/14.3.0/LICENSE`.

### DOMPurify

- Project: DOMPurify
- Copyright: Mario Heiderich and contributors
- Source: https://github.com/cure53/DOMPurify
- Vendored browser runtime: 3.4.13
- License used by CharaDock: Apache License 2.0

The local browser build sanitizes rendered Markdown before it enters the
document. CharaDock uses the Apache-2.0 option offered by the project. The
complete license is retained at `vendor/dompurify/3.4.13/LICENSE`.

### CMU Pronouncing Dictionary

- Project: CMU Pronouncing Dictionary (CMUdict)
- Provider: Carnegie Mellon University
- Source: https://github.com/cmusphinx/cmudict
- Runtime package: `cmu-pronouncing-dictionary` 3.0.0
- Package copyright: Zeke Sikelianos and contributors
- Package license: ISC License
- Dictionary terms: public domain; use is unrestricted

CMUdict supplies ARPABET pronunciations for the local English-to-Katakana
fallback used only at the text-to-speech boundary. The original displayed text
is not replaced. The ISC permission and warranty notice is retained with the
installed package.

### BudouX

- Project: BudouX
- Copyright: Google LLC
- Source: https://github.com/google/budoux
- Runtime package: `budoux` 0.7.0
- License: Apache License 2.0

The Japanese phrase segmenter is used locally to choose natural text-to-speech
chunk boundaries. Its model and parser remain inside the packaged application;
no response text is sent to an additional service.

### piper-plus (optional external runtime)

- Project: piper-plus
- Author: ayutaz and contributors
- Source: https://github.com/ayutaz/piper-plus
- License: MIT License

piper-plus's MIT-licensed multilingual WebAssembly G2P runtime is bundled for
Japanese phonemization. The native piper-plus executable and voice models are
not bundled. On Windows, the user may choose to download the pinned official
`piper-windows-x64.zip` runtime and Tsukuyomi-chan FP16 model from their original
distribution servers. Each file is verified against a fixed SHA-256 digest and
stored in the app user-data directory. A separately obtained compatible runtime
and voice model can still be selected manually.

The optional sample voice is based on the Tsukuyomi-chan Corpus. Its required
credit and use restrictions are shown prominently in the model download UI:

> 本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」（© Rei Yumesaki）が無料公開している音声データを使用しています。
>
> ■つくよみちゃんコーパス（CV.夢前黎）
> https://tyc.rei-yumesaki.net/material/corpus/

The corpus terms prohibit using this voice for attacks or criticism of people,
calls to support or oppose political positions, religions, or ideologies,
publication of strong content without appropriate zoning, or publication that
permits the generated audio to be reused as material. The complete current
terms at the URL above control.

### Kokoro 82M (optional model)

- Project: Kokoro
- Author: hexgrad and contributors
- Source: https://github.com/hexgrad/kokoro
- Model: https://huggingface.co/hexgrad/Kokoro-82M
- License: Apache License 2.0

Kokoro model and Japanese voice files are not bundled. The user may download
the pinned q8 ONNX WebGPU/CPU files and five Japanese voice style files from
the original model repository. Every file is verified against a fixed SHA-256
digest and stored in the app user-data directory. Inference and Japanese G2P
then run locally.

### sherpa-onnx

- Project: sherpa-onnx
- Copyright: sherpa-onnx contributors / k2-fsa
- Source: https://github.com/k2-fsa/sherpa-onnx
- Runtime package: `sherpa-onnx-node`
- License: Apache License 2.0

The native runtime is packaged with the desktop app. Speech-recognition models
(Japanese ReazonSpeech Zipformer, Japanese NeMo Parakeet CTC, SenseVoice, and
multilingual Whisper base/tiny) are not bundled. The model selected by the user
is downloaded on demand from the official sherpa-onnx GitHub releases, verified
against its pinned SHA-256 digest, and stored in the app user-data directory.

The Silero VAD ONNX model used for neural voice activity detection is also not
bundled. It is downloaded on first use from the official sherpa-onnx release,
verified against a pinned SHA-256 digest, and stored beside the ASR models.

Supertonic 3 model files are not bundled. The user may download the official
sherpa-onnx int8 archive on demand; it is verified against a pinned SHA-256
digest and stored in the app user-data directory. The model archive includes
the Supertonic 3 MIT license and copyright notice (Copyright (c) 2025 Supertone
Inc.).

### Irodori TTS WebGPU runtime

- Project: irodori-tts-webgpu
- Copyright: 2026 NOGUCHI Shoji
- Source: https://github.com/ngc-shj/irodori-tts-webgpu
- License: MIT License

CharaDock includes modified, environment-specific WebGPU inference cores for
Irodori-TTS 500M-v3 and Irodori-TTS v4 Small.
The MIT copyright and permission notice are retained in the vendored source.
Irodori model files are not bundled. Users may download the pinned v4 Small
FP16 ONNX conversion from
https://github.com/ochisamu/irodori-tts-v4-webgpu-models through the app; every
asset is verified against its fixed byte size and SHA-256 digest before it is
installed. The app also retains the pinned Irodori-TTS 500M-v3 FP16 ONNX set
from https://huggingface.co/noguchis/irodori-tts-onnx for compatibility with
existing CharaDock voices. Its runtime is derived from
https://github.com/ngc-shj/irodori-tts-webgpu. A compatible local conversion
folder can also be selected manually for either generation.
Two reference WAV files are bundled as described below, and users may also
select a consented reference WAV from local storage.
Inference stays on the device. The v4 model is based on
Aratako/Irodori-TTS-v4-Small, Aratako/Semantic-DACVAE-Japanese-32dim, and
sbintuitions/modernbert-ja-310m. Their license notices must remain with any
distributed model artifacts. Voice cloning or impersonation without explicit
consent, deepfakes, and misleading speech are prohibited by the ethical-use
notice carried from the model card.

### Bundled Irodori reference voices

`assets/reference-voices/hiro.wav` is a recording of ochisamu and is bundled
with the speaker and rights holder's permission.

`assets/reference-voices/kohaku.wav` is derived from `rusuden_02`, a voice
material from あみたろの声素材工房.

- Credit: あみたろの声素材工房（https://amitaro.net/）
- Terms: https://amitaro.net/voice/voice_rule/

These files are included only as application reference voices and are not a
standalone voice-material pack. `kohaku.wav` remains subject to the current
upstream terms, including the restrictions on standalone redistribution,
prohibited content, impersonation, fraud, and misleading use. If this summary
and the upstream terms differ, the current upstream terms control.

### ONNX Runtime Web

- Project: ONNX Runtime
- Provider: Microsoft
- Source: https://github.com/microsoft/onnxruntime
- Runtime package: `onnxruntime-web` 1.27.0
- License: MIT License

### Style-Bert-VITS2 JP-Extra local runtime

- Project: sbv2-web
- Author: hdae and contributors
- Source: https://github.com/hdae/sbv2-web
- Runtime package: `@hdae/sbv2-web` 0.4.1
- License: MIT License

The optional local JP-Extra provider imports user-selected AIVMX models into
the app user-data directory and runs inference with ONNX Runtime Node. Native
WebGPU is preferred and CPU is available as a fallback. CharaDock does not
bundle or redistribute an AIVMX voice model; each model remains subject to the
license shown by its creator.

Japanese text analysis uses `@hdae/yomi` 0.4.2 (MIT) and its pinned NAIST-JDIC
derived dictionary (`hdae/yomi-dict`, BSD 3-Clause). The quantized Japanese
DeBERTa assets are downloaded on first use from the revision pinned by
`@hdae/sbv2-web`, verified by the runtime, and cached locally. Those model
assets are a derivative of `ku-nlp/deberta-v2-large-japanese-char-wwm` and are
provided under CC BY-SA 4.0. They are not bundled in CharaDock.

The runtime also uses `@hdae/fetch-cache` 0.3.1 (MIT) and `onnxruntime-node`
1.27.0 (MIT). Package license files remain included in the packaged app.

### Tokenizers.js

- Project: Tokenizers.js
- Provider: Hugging Face
- Source: https://github.com/huggingface/tokenizers.js
- Runtime package: `@huggingface/tokenizers` 0.1.3
- License: Apache License 2.0

### MediaPipe Tasks Vision

- Project: MediaPipe Tasks Vision / Face Landmarker
- Provider: Google
- Version referenced by the app: `@mediapipe/tasks-vision@0.10.35`
- Runtime module path: `vendor/mediapipe/tasks-vision/0.10.35/vision_bundle.mjs`
- Runtime WASM path: `vendor/mediapipe/tasks-vision/0.10.35/wasm/`
- Face Landmarker model path: `vendor/mediapipe/face_landmarker/float16/face_landmarker.task`
- License: Apache License 2.0

MediaPipe assets are loaded from the local `vendor/` directory at runtime only when camera-based face tracking is used. If face tracking is not used, the core PNG avatar rendering can still run without loading MediaPipe.

Vendored MediaPipe file checksums are recorded in `vendor/mediapipe/SHASUMS256.txt`. See `docs/vendor-update.md` for verification and update notes.

## Browser and platform APIs

The app uses standard browser APIs including Canvas 2D, WebGL, MediaDevices, Web Audio, FileReader, localStorage, EventSource, and fetch.
