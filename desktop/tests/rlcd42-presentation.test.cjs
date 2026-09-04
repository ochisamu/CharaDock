// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRlcd42Scene, truncateUtf8 } = require("../lib/rlcd42-presentation.cjs");

test("RLCD presentation keeps the selected idle mode instead of a stale turn mode", () => {
  const scene = buildRlcd42Scene({
    characterName: "コハク",
    interactionMode: "work",
    turn: { status: "idle", mode: "chat" },
  });
  assert.equal(scene.scene, "work");
  assert.equal(scene.state, "idle");
  assert.equal(scene.modeLabel, "WORK");
  assert.equal(scene.caption, "");
});

test("RLCD presentation follows an active conversation and bounds its local fields", () => {
  const scene = buildRlcd42Scene({
    characterName: "長い名前".repeat(20),
    interactionMode: "work",
    speechInputProvider: "realtime",
    beatrice: true,
    caption: "回答".repeat(500),
    turn: {
      status: "speaking",
      mode: "chat",
      startedAt: 1_000,
      artifacts: [{}, {}],
    },
    now: 6_500,
  });
  assert.equal(scene.scene, "conversation");
  assert.equal(scene.state, "speaking");
  assert.equal(scene.modeLabel, "LIVE");
  assert.equal(scene.live, true);
  assert.equal(scene.beatrice, true);
  assert.equal(scene.elapsedSeconds, 5);
  assert.equal(scene.artifactCount, 2);
  assert.ok(Buffer.byteLength(scene.characterName, "utf8") <= 48);
  assert.ok(Buffer.byteLength(scene.caption, "utf8") <= 960);
});

test("RLCD presentation never opens an empty black caption panel", () => {
  const scene = buildRlcd42Scene({
    turn: { status: "thinking", mode: "chat" },
    captionMode: "auto",
    caption: "",
  });
  assert.equal(scene.scene, "home");
  assert.equal(scene.caption, "");
});

test("RLCD presentation can explain the microphone handoff without opening a caption panel", () => {
  const scene = buildRlcd42Scene({
    turn: { status: "thinking", mode: "chat" },
    caption: "",
    activityOverride: "返事を待っています…",
  });
  assert.equal(scene.scene, "home");
  assert.equal(scene.state, "thinking");
  assert.equal(scene.activity, "返事を待っています…");
  assert.equal(scene.caption, "");
});

test("RLCD presentation exposes approval and recovery as distinct physical states", () => {
  const approval = buildRlcd42Scene({ language: "en", turn: { status: "approval-required", mode: "work" } });
  assert.equal(approval.scene, "work");
  assert.equal(approval.state, "approval");
  assert.equal(approval.approval, true);
  assert.equal(approval.nextAction, "Approve or decline");

  const recovery = buildRlcd42Scene({ language: "en", turn: { status: "error", mode: "chat" } });
  assert.equal(recovery.scene, "recovery");
  assert.equal(recovery.state, "error");
});

test("RLCD presentation labels the active USB or Wi-Fi route", () => {
  const usb = buildRlcd42Scene({ language: "ja", transport: "usb" });
  const wifi = buildRlcd42Scene({ language: "ja", transport: "wifi" });
  const wifiEnglish = buildRlcd42Scene({ language: "en", transport: "wifi" });
  assert.equal(usb.footer, "USB接続  CharaDock");
  assert.equal(wifi.footer, "Wi-Fi接続  CharaDock");
  assert.equal(wifiEnglish.footer, "Wi-Fi  CharaDock");
});

test("RLCD UTF-8 truncation never splits a Japanese code point", () => {
  assert.equal(truncateUtf8("あいう", 7), "あい");
  assert.equal(Buffer.from(truncateUtf8("あいう", 7), "utf8").toString("utf8"), "あい");
});
