// SPDX-License-Identifier: Apache-2.0
// Run with the installed platform's Node and native sherpa-onnx dependency.
// Uses shipped reference speech, not microphone recordings; sends no requests
// to speech recognition, conversation services, or physical speakers.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { EmbeddedSherpaVad } = require("../desktop/lib/sherpa-vad.cjs");
const { DeviceSpeechGate } = require("../desktop/lib/device-speech-gate.cjs");
const { decodePcmWaveDataUrl, resamplePcm16 } = require("../desktop/lib/device-audio.cjs");

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Pass the installed Silero model directory");
  const vad = new EmbeddedSherpaVad(directory);
  assert.ok(vad.isInstalled(), "Install the model first; this check does not download it");
  const wave = fs.readFileSync(path.join(__dirname, "../assets/reference-voices/kohaku.wav"));
  const decoded = decodePcmWaveDataUrl(`data:audio/wav;base64,${wave.toString("base64")}`);
  const speech = resamplePcm16(decoded.samples, decoded.sampleRate);
  const quietSpeech = Buffer.from(speech);
  for (let i = 0; i < quietSpeech.length; i += 2) quietSpeech.writeInt16LE(Math.round(quietSpeech.readInt16LE(i) / 8), i);
  const noise = Buffer.alloc(16000 * 2 * 2);
  let seed = 13;
  for (let i = 0; i < noise.length / 2; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    noise.writeInt16LE(((seed >>> 16) % 2001) - 1000, i * 2);
  }
  const impulses = Buffer.alloc(noise.length);
  for (let i = 0; i < impulses.length; i += 8000) impulses.writeInt16LE(12000, i);
  for (const [name, audio, expected] of [["silence", Buffer.alloc(noise.length), false],
    ["noise", noise, false], ["impulses", impulses, false], ["speech", speech, true], ["quiet-speech", quietSpeech, true]]) {
    let accepted = false;
    const gate = new DeviceSpeechGate({
      createVad: async () => { await vad.start("normal"); return vad; },
      onStart: async () => { accepted = true; }, onChunk: async () => {}, onEnd: async () => {},
    });
    await gate.begin();
    for (let offset = 0; offset < audio.length; offset += 1024) await gate.chunk(audio.subarray(offset, offset + 1024));
    await gate.end();
    assert.equal(accepted, expected, name);
    console.log(`${name}: ${accepted ? "accepted" : "rejected"}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
