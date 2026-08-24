// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { EmbeddedSherpaVad, SILERO_VAD_MODEL, SILERO_VAD_PROFILES } = require("../lib/sherpa-vad.cjs");

test("Silero VAD uses the verified official sherpa-onnx model", () => {
  assert.equal(SILERO_VAD_MODEL.bytes, 643_854);
  assert.match(SILERO_VAD_MODEL.downloadUrl, /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/asr-models\//);
  assert.match(SILERO_VAD_MODEL.sha256, /^[a-f0-9]{64}$/);
});

test("Silero VAD sensitivity raises the speech threshold in noisy environments", () => {
  assert.ok(SILERO_VAD_PROFILES.low.threshold > SILERO_VAD_PROFILES.normal.threshold);
  assert.ok(SILERO_VAD_PROFILES.normal.threshold > SILERO_VAD_PROFILES.high.threshold);
  assert.ok(SILERO_VAD_PROFILES.low.minSilenceDuration > SILERO_VAD_PROFILES.high.minSilenceDuration);
});

test("Silero VAD returns a copied authoritative segment before popping it", () => {
  const vad = new EmbeddedSherpaVad(".");
  const nativeSamples = Float32Array.of(.1, .2, .3);
  let popped = false;
  let externalBufferRequested = null;
  vad.detector = {
    acceptWaveform: () => {},
    isDetected: () => false,
    isEmpty: () => false,
    front: (enableExternalBuffer) => {
      externalBufferRequested = enableExternalBuffer;
      return { start: 42, samples: nativeSamples };
    },
    pop: () => {
      popped = true;
      nativeSamples.fill(0);
    },
  };
  const result = vad.accept(Float32Array.of(.4));
  assert.equal(result.segmentComplete, true);
  assert.equal(externalBufferRequested, false);
  assert.equal(popped, true);
  assert.deepEqual(result.segmentSamples, Float32Array.of(.1, .2, .3));
});
