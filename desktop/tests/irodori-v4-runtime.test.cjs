// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

async function runtimeModule() {
  return import(pathToFileURL(path.join(__dirname, "..", "irodori", "v4-pipeline.mjs")).href);
}

function sessions(overrides = {}) {
  const unused = { run: async () => { throw new Error("unexpected session call"); } };
  return {
    backbone: unused, text: unused, caption: unused, duration: unused,
    dit: unused, dac: unused, speaker: unused, enc: unused, ...overrides,
  };
}

test("Irodori v4 shares ModernBERT and applies separate projectors", async () => {
  const { IrodoriV4TTS } = await runtimeModule();
  const calls = [];
  const backbone = { run: async () => ({
    backbone_state: new Tensor("float32", new Float32Array(3 * 768), [1, 3, 768]),
  }) };
  const projector = (name) => ({ run: async () => {
    calls.push(name);
    return { [`${name}_state`]: new Tensor("float32", new Float32Array(3 * 512), [1, 3, 512]) };
  } });
  const runtime = new IrodoriV4TTS({
    ort: { Tensor },
    tokenizer: { encode: () => [12, 34] },
    sessions: sessions({ backbone, text: projector("text"), caption: projector("caption") }),
  });
  assert.equal((await runtime.encodeText("本文")).tokens, 3);
  assert.equal((await runtime.encodeCaption("声の指示")).tokens, 3);
  assert.equal((await runtime.encodeCaption("声の指示")).tokens, 3);
  assert.deepEqual(calls, ["text", "caption"]);
  assert.equal(runtime.captionCacheHits, 1);
});

test("Irodori v4 groups four DAC latent frames for the speaker encoder", async () => {
  const { IrodoriV4TTS } = await runtimeModule();
  let feed;
  const runtime = new IrodoriV4TTS({
    ort: { Tensor },
    tokenizer: { encode: () => [1] },
    sessions: sessions({ speaker: { run: async (value) => {
      feed = value;
      return {
        speaker_state: new Tensor("float32", new Float32Array(2 * 768), [1, 2, 768]),
        speaker_mask: new Tensor("bool", new Uint8Array([1, 1]), [1, 2]),
      };
    } } }),
  });
  await runtime.encodeReferenceLatent(Float32Array.from({ length: 10 * 32 }, (_, index) => index), 10);
  assert.deepEqual(feed.ref_latent.dims, [1, 2, 128]);
  assert.equal(feed.ref_latent.data.at(-1), 255);
  assert.deepEqual([...feed.ref_mask.data], [1, 1]);
});

test("Irodori v4 runtime trims at the first official-style near-zero latent window", async () => {
  const { findFlatteningPoint } = await import(pathToFileURL(path.join(__dirname, "..", "irodori", "voicedesign-pipeline.mjs")).href);
  const frames = 30;
  const latent = new Float32Array(frames * 32);
  latent.fill(1, 0, 8 * 32);
  assert.equal(findFlatteningPoint(latent, frames, { windowSize: 4 }), 8);
  assert.equal(findFlatteningPoint(new Float32Array(frames * 32).fill(1), frames, { windowSize: 4 }), frames);
});

test("Irodori v4 removes an unrelated utterance after a long silent gap", async () => {
  const { findTrailingUtteranceCutoff, shouldTrimTrailingUtterance } = await import(pathToFileURL(path.join(__dirname, "..", "irodori", "voicedesign-pipeline.mjs")).href);
  const sampleRate = 1000;
  const repeated = new Float32Array(3000);
  repeated.fill(0.5, 400, 1000);
  repeated.fill(0.5, 1600, 2200);
  assert.equal(findTrailingUtteranceCutoff(repeated, sampleRate), 1080);

  const shortPause = Float32Array.from(repeated);
  shortPause.fill(0.5, 1280, 1600);
  assert.equal(findTrailingUtteranceCutoff(shortPause, sampleRate), shortPause.length);

  const trailingSilence = new Float32Array(3000);
  trailingSilence.fill(0.5, 400, 1000);
  assert.equal(findTrailingUtteranceCutoff(trailingSilence, sampleRate), trailingSilence.length);

  const intermittentNoise = new Float32Array(3000);
  intermittentNoise.fill(0.5, 400, 1000);
  intermittentNoise.fill(0.5, 1600, 1680);
  intermittentNoise.fill(0.5, 1760, 1840);
  assert.equal(findTrailingUtteranceCutoff(intermittentNoise, sampleRate), intermittentNoise.length);

  assert.equal(shouldTrimTrailingUtterance("音声テストです。"), true);
  assert.equal(shouldTrimTrailingUtterance("これからよろしくね。"), true);
  assert.equal(shouldTrimTrailingUtterance("今、確認してるね。"), true);
  assert.equal(shouldTrimTrailingUtterance("うん、これから確認するね。"), true);
  assert.equal(shouldTrimTrailingUtterance("最高33℃、最低27℃。"), true);
  assert.equal(shouldTrimTrailingUtterance("午後に少し雨が降る見込みです。"), true);
  assert.equal(shouldTrimTrailingUtterance("今日は晴れ、明日は雨です。"), true);
  assert.equal(shouldTrimTrailingUtterance("はい、今、確認してるね。"), true);
  assert.equal(shouldTrimTrailingUtterance("午前の結果：晴れです。"), false);
  assert.equal(shouldTrimTrailingUtterance("折りたたみ傘と熱中症対策があると安心だよ。"), true);
});

test("Irodori v4 synthesis applies trailing-utterance cleanup to comma prose", async () => {
  const { IrodoriVoiceDesignTTS } = await import(pathToFileURL(path.join(__dirname, "..", "irodori", "voicedesign-pipeline.mjs")).href);
  const runtime = new IrodoriVoiceDesignTTS({
    ort: { Tensor },
    tokenizer: { encode: () => [1] },
    sessions: {
      text: {}, caption: {}, duration: {}, dit: {}, dac: {},
    },
  });
  const condition = { state: new Float32Array(1), mask: new Uint8Array([1]), tokens: 1, dim: 1 };
  runtime.encodeText = async () => condition;
  runtime.encodeCaption = async () => condition;
  runtime.predictDuration = async () => 75;
  runtime.rfLoop = async () => new Float32Array(75 * 32).fill(1);
  runtime.decode = async () => {
    const audio = new Float32Array(3 * 48_000);
    audio.fill(0.5, 0.4 * 48_000, 1 * 48_000);
    audio.fill(0.5, 1.6 * 48_000, 2.2 * 48_000);
    return audio;
  };

  const result = await runtime.synthesize("今、確認してるね。", "自然な日本語", {
    trimTrailingUtterance: true,
  });
  assert.equal(result.trailingUtteranceTrimmed, true);
  assert.equal(result.audio.length, 1.08 * 48_000);
});
