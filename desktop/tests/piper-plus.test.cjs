// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  onnxInputNames,
  piperPlusConfigPath,
  validatePiperPlusReference,
  piperPlusArguments,
  piperPlusStatus,
  piperPlusWorkingDirectory,
  synthesizePiperPlus,
  validatePiperPlusModel,
} = require("../lib/piper-plus.cjs");

function piperFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-piper-test-"));
  const bin = path.join(root, "bin");
  const models = path.join(root, "models");
  const temporaryRoot = path.join(root, "temporary");
  fs.mkdirSync(bin);
  fs.mkdirSync(models);
  fs.mkdirSync(temporaryRoot);
  const executablePath = path.join(bin, "piper-plus.exe");
  const modelPath = path.join(models, "voice.onnx");
  fs.writeFileSync(executablePath, "fixture");
  fs.writeFileSync(modelPath, "fixture");
  fs.writeFileSync(`${modelPath}.json`, "{}");
  return { root, executablePath, modelPath, temporaryRoot };
}

test("piper-plus uses its extracted package root and inverse length scale", () => {
  const fixture = piperFixture();
  try {
    assert.equal(piperPlusWorkingDirectory(fixture.executablePath), fixture.root);
    assert.deepEqual(
      piperPlusArguments({ modelPath: fixture.modelPath, text: "こんにちは", outputPath: "voice.wav", speed: 1.25 }),
      ["--model", fixture.modelPath, "--text", "こんにちは", "--output_file", "voice.wav", "--length-scale", "0.8", "--sentence_silence", "0.35", "--quiet"],
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("piper-plus status requires the runtime, ONNX model, and companion config", () => {
  const fixture = piperFixture();
  try {
    assert.equal(piperPlusStatus(fixture).ready, true);
    fs.rmSync(`${fixture.modelPath}.json`);
    assert.equal(piperPlusStatus(fixture).ready, false);
    assert.throws(() => validatePiperPlusModel(fixture.modelPath), /設定ファイル/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("piper-plus synthesis returns WAV data and deletes temporary output", async () => {
  const fixture = piperFixture();
  try {
    const calls = [];
    const execFileImpl = (command, args, options, callback) => {
      calls.push({ command, args, options });
      const outputPath = args[args.indexOf("--output_file") + 1];
      fs.writeFileSync(outputPath, Buffer.from("RIFF0000WAVE", "ascii"));
      callback(null, "", "");
    };
    const result = await synthesizePiperPlus({
      text: "音声テストです。",
      executablePath: fixture.executablePath,
      modelPath: fixture.modelPath,
      temporaryRoot: fixture.temporaryRoot,
      execFileImpl,
    });
    assert.deepEqual(result.audioDataUrls, ["data:audio/wav;base64,UklGRjAwMDBXQVZF"]);
    assert.equal(calls[0].command, fixture.executablePath);
    assert.equal(calls[0].options.windowsHide, true);
    assert.deepEqual(fs.readdirSync(fixture.temporaryRoot), []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function protoBytes(field, bytes) {
  const varint = (n) => {
    const result = [];
    do { result.push((n & 127) | (n > 127 ? 128 : 0)); n = Math.floor(n / 128); } while (n);
    return Buffer.from(result);
  };
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}
function referenceFixture(fixture) {
  fixture.executablePath = path.join(fixture.root, "piper-plus-cli.exe");
  fs.writeFileSync(fixture.executablePath, "rust fixture");
  const input = protoBytes(1, Buffer.from("speaker_embedding"));
  fs.writeFileSync(fixture.modelPath, protoBytes(7, Buffer.concat([
    protoBytes(5, Buffer.alloc(128)), protoBytes(11, input),
  ])));
  fixture.speakerEncoderPath = path.join(fixture.root, "encoder.onnx");
  fs.writeFileSync(fixture.speakerEncoderPath, "encoder fixture");
  fixture.referenceAudioPath = path.join(fixture.root, "reference.wav");
  const wave = Buffer.alloc(44 + 16_000 * 2);
  wave.write("RIFF", 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16_000, 24); wave.writeUInt32LE(32_000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write("data", 36); wave.writeUInt32LE(wave.length - 44, 40);
  fs.writeFileSync(fixture.referenceAudioPath, wave);
  fixture.referenceEnabled = true;
  return fixture;
}

test("v2 Rust synthesis passes compatible output flags, config, reference WAV and encoder", async (t) => {
  const fixture = referenceFixture(piperFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal(piperPlusStatus(fixture).ready, true);
  let calls = 0;
  const result = await synthesizePiperPlus({ ...fixture, text: "参照音声で話します。", execFileImpl(command, args, options, callback) {
    calls += 1;
    assert.equal(command, fixture.executablePath);
    assert.equal(options.cwd, fixture.root);
    for (const [flag, expected] of [["--reference-audio", fixture.referenceAudioPath],
      ["--speaker-encoder-model", fixture.speakerEncoderPath], ["--config", `${fixture.modelPath}.json`]]) {
      assert.equal(args[args.indexOf(flag) + 1], expected);
    }
    assert.ok(args.includes("--sentence-silence"));
    assert.ok(!args.includes("--output_file"));
    fs.writeFileSync(args[args.indexOf("--output-file") + 1], "RIFF0000WAVE");
    callback(null);
  } });
  assert.equal(calls, 1);
  assert.equal(result.audioDataUrls.length, 1);
  assert.deepEqual(fs.readdirSync(fixture.temporaryRoot), []);
});

test("reference audio cannot be silently ignored by legacy runtime or a regular voice model", async (t) => {
  const fixture = referenceFixture(piperFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const execFileImpl = () => assert.fail("Incomplete reference settings must not spawn a process");
  const legacy = path.join(fixture.root, "bin", "piper-plus.exe");
  await assert.rejects(synthesizePiperPlus({ ...fixture, executablePath: legacy, text: "test", execFileImpl }), /Rust版/);
  fs.writeFileSync(fixture.modelPath, protoBytes(7, protoBytes(11, protoBytes(1, Buffer.from("input")))));
  await assert.rejects(synthesizePiperPlus({ ...fixture, text: "test", execFileImpl }), /speaker_embedding/);
  assert.equal(piperPlusStatus(fixture).ready, false);
  assert.equal(piperPlusStatus({ ...fixture, referenceEnabled: false }).ready, true);
});

test("reference setup distinguishes missing encoder, bad WAV, and disabled references", (t) => {
  const fixture = referenceFixture(piperFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.match(piperPlusStatus({ ...fixture, speakerEncoderPath: "" }).referenceIssue, /エンコーダー/);
  fs.writeFileSync(fixture.referenceAudioPath, "not a wave");
  assert.throws(() => validatePiperPlusReference(fixture.referenceAudioPath), /WAV/);
  assert.match(piperPlusStatus(fixture).referenceIssue, /参照音声/);
  const args = piperPlusArguments({ ...fixture, referenceAudioPath: "", text: "usual voice", outputPath: "voice.wav" });
  assert.ok(!args.includes("--reference-audio"));
});

test("model validation resolves config.json and alternate JSON names explicitly", (t) => {
  const fixture = piperFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.rmSync(`${fixture.modelPath}.json`);
  const configPath = path.join(path.dirname(fixture.modelPath), "config.json");
  fs.writeFileSync(configPath, "{}");
  assert.equal(validatePiperPlusModel(fixture.modelPath), fixture.modelPath);
  assert.equal(piperPlusConfigPath(fixture.modelPath), configPath);
  assert.equal(piperPlusStatus(fixture).configReady, true);
});

test("ONNX metadata handles malformed lengths and detects replaced model inputs", (t) => {
  const fixture = referenceFixture(piperFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(onnxInputNames(fixture.modelPath), ["speaker_embedding"]);
  fs.writeFileSync(fixture.modelPath, Buffer.from([0x3a, 0xff, 0xff, 0x7f]));
  assert.deepEqual(onnxInputNames(fixture.modelPath), []);
  assert.equal(piperPlusStatus(fixture).referenceModelReady, false);
});

test("process failure cleans generated WAV directories", async (t) => {
  const fixture = piperFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  await assert.rejects(synthesizePiperPlus({ ...fixture, text: "test", execFileImpl(command, args, options, callback) {
    callback(new Error("exit"), "", "model incompatible");
  } }), /model incompatible/);
  assert.deepEqual(fs.readdirSync(fixture.temporaryRoot), []);
});
