# Irodori v4.1 Anime and speech-quality verification

## Using Anime

Settings → Voice → Irodori TTS → model generation → **v4.1 Anime**.
Only INT4 is offered (853,559,099 bytes, approximately 854 MB / 814 MiB).
Download once, then choose reference voice or Voice Design as for Small.
Anime and Small have independent model directories; the choice belongs to the
character. The phone can select Anime after the PC has installed it.

Weights are not bundled in CharaDock. The downloader verifies all 19 files using
the pinned manifest in `desktop/lib/irodori-anime-manifest.json`.

- Model: <https://huggingface.co/phasefield-audio/Irodori-TTS-v4.1-Anime>
- Artifacts: <https://github.com/ochisamu/irodori-tts-v4-webgpu-models/releases/tag/v4.1-anime-6b259f5-webgpu-int4-r1>
- Reproducible conversion/runtime patch: <https://github.com/ochisamu/irodori-tts-v4-webgpu-models/blob/feat/v41-anime-int4/conversion/v41-anime-runtime-r2.patch>

The conversion starts with the full checkpoint at
`6b259f5baa5e236b3d14cbd1f8555ca87d92b530`, exports FP16 ONNX, then applies
WebGPU MatMulNBits W4A16. It does not quantize already-quantized weights again.
Duration prediction, codec and small projections remain FP16. The export
preserves the official empty-condition attention fallback using tensor operations.
Caption/emoji behavior may differ from Small. Original licenses, consent
requirements and ethical restrictions still apply; SilentCipher is not included.

## Extra speech: cause, mitigation and remaining limitation

With some short reference-conditioned phrases, the duration predictor reserves
far more time than the text needs. Depending on sampling noise, the model may
fill it with unrelated speech. Matching the JavaScript sampling noise in the
official Python runtime reproduced this too; changing only model precision,
CFG batching, or the sampling step count did not reliably eliminate it.

The V4 runtime now computes a neutral text-only duration as a sanity check.
It bounds the allocation only when the reference-conditioned prediction is
over 1.5 times that estimate **and** over one second longer. Synthesis retains
the actual speaker and caption. Explicit `seconds` bypasses prediction, and
runtime callers can opt out with `guardReferenceDuration: false`.

This is not a content-verification system. Existing Small still occasionally
adds a word or changes a very short phrase (e.g. one tested seed appended a word
after `ありがとう`). Do not describe it as complete elimination of hallucinated
speech. No ASR dependency or silent switch to a different voice was added.

The existing silence-based tail cleanup also cut legitimate pauses in
`まず資料を確認します。そのあと、要点をまとめます。` and
`今日は晴れ、明日は雨です。`. It now declines inputs with internal clause or
sentence separators. A pause is not evidence that the next words are unwanted.

## Verification (2026-09-07)

- Windows Electron WebGPU: actual model loading and synthesis, not mocked output.
- Actual CharaDock IPC/preload: fresh-profile download from the release, hash
  verification, readiness, settings selection, `こんにちは。` synthesis and the
  normal UI voice-test button. The resulting app WAV transcribed as `こんにちは`.
- Anime: seven phrases, seeds 0 and 42, bundled Kohaku reference, 16 linear
  steps / sequential CFG; short speech, comma prose and multi-sentence output.
  Four additional Voice Design phrases were checked without reference audio.
- Small: the same reference/corpus, with before/after comparisons; improvements
  and residual word additions are retained rather than excluded from results.
- ReazonSpeech served as a regression signal, not the sole quality guarantee.
  Whole-file ASR sometimes returned only the second sentence; separately
  transcribing the first section confirmed that it was present in the audio.
- INT4 parity against FP16: finite outputs; cosine similarity 0.947832
  (backbone), 0.900893 (speaker encoder), 0.962819 (DiT).
- Unit tests exercise neutral-duration bounds, preserved pauses, character
  persistence, path privacy, download manifests and the actual remote model
  selection functions (including uninstalled/wrong-precision rejection).
- Final full suite: 755 Node tests and 58 Python tests passed, plus JavaScript
  runtime checks and the TypeScript runtime build. The separate conversion
  repository passed 23 Node tests and its tensor-mask regression test.

Local evidence: `work/evidence/irodori-anime/` contains the settings screenshot,
real app WAV, Anime/Small generated audio and transcripts. The experimental
harness remains in `work/irodori-anime-qa/`. The normal user profile was not edited.
Actual phone audio and macOS GPU execution were not tested in this change.
