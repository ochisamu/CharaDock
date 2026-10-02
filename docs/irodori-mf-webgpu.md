# Irodori MeanFlow / WebGPU feasibility experiment

2026-09-29. Status: **available as an opt-in experimental CharaDock model; not the default**.

## CharaDock integration

Select **音声 → キャラの声 → Irodori TTS → v4.1 Small MF（実験用・FP16・4ステップ）**.
Restart a running development app after updating its source. The Windows
development source mirror has been updated; no installer/release was built.

- MF has its own saved directory and per-character `v4-mf` selection. Small,
  Anime and legacy selections remain unchanged. MF is fixed to FP16 / four
  linear steps, with no RF CFG or Sway options forwarded to its sampler.
- MF graphs must include `dit_v4_mf.onnx[.data]` and a `model-config.json` whose
  `model.flow_parameterization` is `meanflow`. RF/MF mix-ups fail validation.
- Models use the same layout as v4: `models/` plus `tokenizer/irodori_v4/`.
  A complete `tts-models/irodori-v41-mf-webgpu` under the active profile is
  discovered on startup if no MF path has been chosen. Manual folder selection
  is also available. Automatic downloading is **not** offered: no published,
  checksummed MF ONNX distribution has been registered.
- The converted candidate is installed in the local development profile and
  linked into the shared `AppData/Roaming/charadock` profile using NTFS hard links
  (same immutable model files, no duplicate weight storage). No active character
  selection was changed in either user profile.
- PC and remote selectors share the same main-process model settings. Normal
  sentence splitting, speaker/caption caching and stream cancellation remain
  in use. Old sessions are released when the preload switches models, and
  partially loaded sessions are released on failure.
- No CUDA application code/dependency was added. The native Large experiment
  remains outside this repository.

Verification: 996 desktop tests passed. All 58 Python static tests ran; one
unrelated existing avatar test failed (`test_item_layer_deform_follow_is_opt_in`,
expecting `faceRigidFollowPoint` in unmodified `app.js`). MF-related tests passed.
Windows Electron production preload/IPC generated real audio for sentence chunks,
reference/design, queued requests, RF switching and switching back to MF.
The real app in an isolated QA profile saved MF through settings IPC, normalized
INT4 to FP16, generated a streamed voice preview and cancelled it. Live phone
interaction and full Chat/Work/Live conversation turns were not exercised.
Rendered settings were inspected: the MF card says four steps and experimental
quality, and the RF download panel is actually hidden by computed CSS display
(not just the HTML `hidden` attribute). Screenshot, preview audio and IPC metrics
are retained in `work/irodori-mf/evidence/app-integration/`.
The experimental quality warnings below remain unresolved, not waived.

Reproducible integration probes:

```text
electron.exe scripts/irodori-mf/app-smoke.cjs SOURCE MF_MODEL REFERENCE OUTPUT [RF_MODEL]
electron.exe scripts/irodori-mf/ui-smoke.cjs SOURCE MF_MODEL FRESH_OUTPUT
```

## Original feasibility experiment

The pre-experiment working tree was saved as `7e79c68` (`feat: checkpoint Kohaku
expressive performance prototype`). Nothing was pushed. At that checkpoint the
production provider and preload were unchanged; the opt-in integration above was
added subsequently. The model download catalog and user selections remain unchanged.

## What works

- Official v4.1 Small MF weights exported to FP16 ONNX, including `delta_t`.
- `IrodoriV4MeanFlowTTS` reuses the existing v4 text/caption encoders, duration,
  reference-speaker and DACVAE paths. Only its flow sampler is different.
- Four conditional DiT calls, `t=1,.75,.5,.25`, `delta_t=.25`, with
  `x_next = x - delta_t * velocity`. No inference-time RF CFG branches.
- Standalone Windows Electron / ONNX Runtime Web 1.27.0 / hardware WebGPU
  synthesis succeeded, including the existing Kohaku reference WAV.
- Three sampler tests and six existing v4 runtime tests passed (9/9).

MF is a separate distilled checkpoint, not a four-step setting for the RF model.
The experimental class rejects RF checkpoints, graphs without `delta_t`, and
RF-only guidance controls. It is now selectable only as the explicit MF variant.

## Performance observed

RTX 5060 Ti 16 GB; Windows Electron; hardware adapter reports NVIDIA Blackwell.
Same Japanese caption, seed 42, three texts repeated three times in one process.
Warm numbers below average repetitions 1 and 2; repetition 0 is excluded.
Times include encoding, duration, diffusion/flow and decoding, but not model
loading or playback. No concurrent RF/MF benchmark instances were used.

| Text | Current v4.1 RF INT4, 16 steps | MF FP16, 4 steps | Ratio |
| --- | ---: | ---: | ---: |
| こんにちは。 | 2.465 s | 0.457 s | 5.4× |
| 今確認してるね。 | 2.511 s | 0.451 s | 5.6× |
| まず資料を確認します。そのあと、要点をまとめます。 | 3.652 s | 0.571 s | 6.4× |

Reference-free runs. RF uses sequential CFG with the runtime defaults and a
linear schedule. Different weight precision and predicted durations mean this
is a practical configuration comparison, **not an isolated MF algorithm speedup**.
MF output durations were 2.48, 2.20 and 4.96 seconds; RF 2.68, 2.60 and 4.88.

MF session loading: 3.903 s; RF: 3.484 s. First synthesis after session loading:
MF 4.072 s; RF 6.816 s. These are fresh-process measurements, not cold-disk or
download measurements. Shader warm-up still matters.

With Kohaku reference conditioning, MF warm generation was 0.421 / 0.464 /
0.605 s. Reference encoding occurred before these timings. This confirms the
reference path runs, not that voice similarity has been accepted by listening.
The FP16 model bundle is about 1.7 GiB; the installed RF INT4 models are about
808 MiB. MF quantization, peak VRAM and lower-end GPUs have not been evaluated.

## Open quality gates — do not ship this as the default yet

1. **Numerical parity has an unresolved failure.** The first export specialized
   latent length to 40 and failed for real inputs. Upstream SDPA plan construction
   casts `query_len` to `int`; the export wrapper preserves its symbolic value
   while retaining the SDPA mask and disabling CUDA-only FA3 packing. Variable
   lengths now execute. The seeded CPU parity check reports:

   | Batch 1 latent length | Maximum absolute error | Mean absolute error |
   | --- | ---: | ---: |
   | 17 | 0.063858 | 0.002314 |
   | 40 | 0.004861 | 0.001067 |
   | 62 | 0.006522 | 0.000999 |
   | 128 | 0.005671 | 0.000946 |

   Length 17 fails the chosen `atol=.05, rtol=.05` elementwise threshold.
   `--verify` intentionally exits nonzero; it is not a passed conversion gate.
   A previous unseeded test had a larger outlier (~0.195). Do not simply relax
   the tolerance: investigate FP16/SDPA/export differences and validate against
   the original inference path with realistic encoded conditions.
2. **Long-text fidelity is not accepted.** ReazonSpeech CPU ASR recovered the
   two short MF sentences, with and without Kohaku reference. For the two-sentence
   sample it recovered only `そのあと要点をまとめます` in all three configurations
   (MF, MF+Kohaku, RF). RF also added `まだ` to the second short sample. ASR can
   be wrong: listen and inspect the waveform before attributing this to MF or
   claiming a confirmed omission. Same seed/repeated runs are not independent
   quality samples. The production sentence-splitting pipeline was not tested.
3. Broader texts/seeds, pronunciation, speaker similarity, long-running resource
   use, cancellation, production routing and quantized MF remain untested.

Recommended next step: numerical/voice-quality validation of this candidate,
then a separate opt-in model entry. Do not lower the existing RF step setting or
replace its assets with MF files.

## Sources and reproduction

- [Official MF model](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small-MF),
  revision `ccc78f5d480b6e51b69b2d5042a14c4da04fea6e`.
- [Upstream inference](https://github.com/Aratako/Irodori-TTS),
  commit `89f9d8fbd4d51ea019867ee1197725ede1df13c5`,
  `irodori_tts/meanflow.py:sample_euler_meanflow`.
- Existing WebGPU exporter checkout: `/home/ikai/workspace/irodori_webgpu`,
  commit `5f530b650ee304de58366038cfc85df3278975cd`. Its existing unrelated local
  edits were preserved. This experiment did not modify that checkout.
- Export environment: that checkout's `.venv`; PyTorch 2.10.0+cu128,
  ONNX 1.22.0, CPU ONNX Runtime 1.23.2.

```sh
/home/ikai/workspace/irodori_webgpu/.venv/bin/python scripts/irodori-mf/export_mf.py \
  --webgpu-source /home/ikai/workspace/irodori_webgpu \
  --source work/irodori-mf/upstream \
  --checkpoint work/irodori-mf/checkpoint/model.safetensors \
  --repo Aratako/Irodori-TTS-v4.1-Small-MF \
  --revision ccc78f5d480b6e51b69b2d5042a14c4da04fea6e \
  --precision fp16 --out-dir work/irodori-mf/onnx --components all --verify

node --test desktop/tests/irodori-mf-runtime.test.cjs desktop/tests/irodori-v4-runtime.test.cjs
```

The upstream clone/checkpoint must already exist. The exporter emits candidate
files before verification, even when verification fails. `--components dit`
re-exports only the flow graph; `--verify-only --components dit --verify` checks
the existing graph without replacing it (the underlying exporter still writes
model metadata). Copy checkpoint tokenizer files into `onnx/tokenizer`, and
the existing checkpoint-independent `dacvae_encoder/decoder.onnx[.data]` into
the bundle. Those codecs were reused from `artifacts/v4-small/onnx_fp16`.

Benchmark invocation, using local Windows paths and a separate output directory:

```text
electron.exe scripts/irodori-mf/bench.cjs OUTPUT MODEL RUNTIME_ROOT DEPENDENCIES [mf|rf] [REFERENCE_WAV] [short|long]
```

`RUNTIME_ROOT` contains `desktop/irodori/*pipeline.mjs`. `DEPENDENCIES` is a
CharaDock source directory with installed Electron/onnxruntime-web/tokenizers.
The standalone harness uses its own `OUTPUT/profile`, writes WAV/results JSONL,
and exits without opening the production app. Use a new OUTPUT for each run.
All three measured runs exited 0; Electron logged a GPU teardown warning after
the completed output. This is not a long-running stability test.

Local evidence (ignored, not committed): `work/irodori-mf/evidence/{mf,rf,kohaku}`
contains WAVs and measured JSONL. `work/irodori-mf/asr-*.jsonl` contains diagnostic
ASR results; `verify-r2.log` retains the failed parity check. The ASR diagnostic
used `work/irodori-anime-qa/transcribe.cjs` with ReazonSpeech CPU, including its
simple 48→16 kHz decimation; it is not an audio-quality benchmark.

Measured candidate DiT SHA-256:

```text
dit_v4_mf.onnx       d0620ff20113eb47d3572ba25152d689c4474bff58b874d4a66907f32a785917
dit_v4_mf.onnx.data  e31545ac2530b9f84819c840691b1c311e6e05da84260c57b55928717f6aa48a
```

## Longer-text follow-up (2026-09-29)

The `long` suite adds 77 / 141 / 222 Japanese characters, including punctuation.
Each entire paragraph is submitted to a single `synthesize` call, **not** the
production sentence-splitting path. Both models use `kohaku.wav`, the same caption
and seed 42. Each text is run three times; warm averages exclude repetition 0.
Models run sequentially, not simultaneously. Model loading, reference encoding,
WAV writing and playback are excluded from synthesis timing.

The initial longest run hit the default 30-second duration cap. It was excluded
from the reported comparison. The final suite explicitly uses `maxSeconds=60`
for both models, leaving production defaults unchanged. No final MF paragraph
hit that cap. The harness now records timestamps for individual stages too.

MF warm means: 1.284 / 2.204 / 3.365 seconds, producing 14.96 / 25.08 / 33.76
seconds of audio. Real-time factors are 0.086 / 0.088 / 0.100 respectively.
These are full-buffer generation times, not time to first streamed audio.

| Characters | MF FP16 / 4 steps | RF INT4 / 16 steps | RF / MF | MF / RF audio duration |
| --- | ---: | ---: | ---: | ---: |
| 77 | 1.284 s | 12.003 s | 9.35× | 14.96 / 14.48 s |
| 141 | 2.204 s | 22.158 s | 10.06× | 25.08 / 24.40 s |
| 222 | 3.365 s | 32.034 s | 9.52× | 33.76 / 32.32 s |

Both final benchmark processes exited 0 and produced all nine WAVs each.
These ratios compare actual configurations, not equal-precision/equal-duration
model kernels. Unlike the first reference-free short comparison, both long runs
have an enabled speaker condition (RF therefore has another CFG branch).

Diagnostic ASR now uses FFmpeg resampling to 16 kHz rather than simple
decimation, followed by ReazonSpeech on CPU. Only the last repetition is
transcribed because repeats share the same seed. MF's 77-character paragraph
was mostly recovered, but `結果は` was absent. The 141-character output transcript
missed the first several sentences; the 222-character transcript contained
major omissions and repetition. This is **not a demonstrated correct long-form
reading**, and ASR is not a substitute for listening. Numerical parity remains
unresolved as described above.

RF ASR recovered the complete 77-character passage apart from punctuation, but
only the final sentence of the 141-character passage. Its 222-character result
also had omissions. Therefore this test does not establish that MF alone causes
the long-form fidelity problem; retain both sets of audio for listening.

```sh
node scripts/irodori-mf/transcribe.cjs WAV_DIRECTORY REAZONSPEECH_MODEL_ROOT
```

Final long-run evidence is under `work/irodori-mf/evidence/mf-long` and `rf-long`.
Raw Windows output directory names end in `long-60`; the earlier `results-mf-long`
run is the excluded 30-second-cap diagnostic. Diagnostic transcripts are in
`work/irodori-mf/asr-{mf,rf}-long-60.jsonl`.
