// SPDX-License-Identifier: Apache-2.0

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  mobileTtsAvailable,
  remoteTurnTtsEnabled,
} = require("../lib/remote-voice-route.cjs");

test("phone TTS availability is independent from the desktop read-aloud toggle", () => {
  assert.equal(mobileTtsAvailable({ remoteTtsEnabled: true, desktopTtsEnabled: false, provider: "sbv2-jp-extra" }), true);
  assert.equal(mobileTtsAvailable({ remoteTtsEnabled: false, provider: "sbv2-jp-extra" }), false);
  assert.equal(mobileTtsAvailable({ remoteTtsEnabled: true, provider: "realtime" }), false);
});

test("remote turns use one mobile TTS route only for non-Live output", () => {
  assert.equal(remoteTurnTtsEnabled({
    remoteTtsOutput: true,
    realtimeOutput: false,
    remoteTtsEnabled: true,
    provider: "style-bert-vits2",
  }), true);
  assert.equal(remoteTurnTtsEnabled({
    remoteTtsOutput: true,
    realtimeOutput: true,
    remoteTtsEnabled: true,
    provider: "style-bert-vits2",
  }), false);
  assert.equal(remoteTurnTtsEnabled({
    remoteTtsOutput: false,
    realtimeOutput: false,
    remoteTtsEnabled: true,
    provider: "style-bert-vits2",
  }), false);
});

test("remote renderer routes normal TTS and Live audio through the shared mouth tracker", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "remote", "remote.js"), "utf8");
  assert.match(source, /createThreeStageMouthTracker/);
  assert.match(source, /source\.connect\(analyser\);\s*analyser\.connect\(audioContext\.destination\)/);
  assert.match(source, /updateRemoteMouth\(analyserRms\(analyser, samples\), now\)/);
  assert.match(source, /updateRemoteMouth\(rms\)/);
  assert.match(source, /resetRemoteMouth\(\)/);
  assert.equal((source.match(/speak\(result\.spokenText \|\| result\.text\)\.catch/g) || []).length, 1);
});

test("main process keeps phone synthesis independent while preserving desktop audio policy", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  assert.match(source, /mobileTtsAllowed: mobileTtsAvailable\(/);
  assert.match(source, /synthesizeConfiguredTts\(String\(text \|\| ""\)\.slice\(0, 4000\), REMOTE_TTS_OWNER_ID, \{ enabled: true \}\)/);
  assert.match(source, /const remoteTtsEnabled = remoteTurnTtsEnabled\(/);
  assert.match(source, /const pcTtsEnabled = Boolean\(result\.ttsEnabled\)/);
});
