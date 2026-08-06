// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { computerContinuationAction, computerConversationAction, normalizeComputerToolName } = require("../lib/computer-use-intent.cjs");
const { normalizedComputerInput, windowsInputScript } = require("../lib/windows-input.cjs");

test("computer control is requested and approved in Japanese conversation", () => {
  assert.equal(computerConversationAction("コンピューターを操作してメモ帳を開いて"), "request");
  assert.equal(computerConversationAction("Windowsの設定画面を開いて"), "request");
  assert.equal(computerConversationAction("Macの設定画面を開いて"), "request");
  assert.equal(computerConversationAction("macOSのウィンドウを操作して"), "request");
  assert.equal(computerConversationAction("コンピューターの意味を教えて"), "");
  assert.equal(computerConversationAction("いいよ、操作して", true), "approve");
  assert.equal(computerConversationAction("やめて", true), "deny");
});

test("computer permission continuation is explicit and stoppable", () => {
  assert.equal(computerContinuationAction("続けてそのボタンを押して"), "continue");
  assert.equal(computerContinuationAction("次に入力欄へ文字を入力して"), "continue");
  assert.equal(computerContinuationAction("コンピューターの操作はここまで"), "stop");
  assert.equal(computerContinuationAction("Macの操作はここまで"), "stop");
  assert.equal(computerContinuationAction("それから明日の予定は？"), "");
});

test("computer tool aliases and input limits are normalized", () => {
  assert.equal(normalizeComputerToolName("computer_click"), "click");
  assert.deepEqual(normalizedComputerInput("click", { x: 12.4, y: 18.6, clicks: 7 }), { action: "click", x: 12, y: 19, button: "left", clicks: 1 });
  assert.deepEqual(normalizedComputerInput("key", { keys: ["ctrl", "a"] }), { action: "key", keys: ["CTRL", "A"] });
  assert.throws(() => normalizedComputerInput("key", { keys: ["CTRL", "Q"] }), /未対応/);
});

test("typed text is transported as base64 instead of PowerShell source", () => {
  const payload = normalizedComputerInput("type", { text: "'; Remove-Item C:\\\\*; # 日本語" });
  const script = windowsInputScript(payload);
  assert.doesNotMatch(script, /Remove-Item/);
  assert.match(script, /FromBase64String/);
});
