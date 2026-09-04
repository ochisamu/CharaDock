// SPDX-License-Identifier: Apache-2.0

function truncateUtf8(value, maximumBytes) {
  const text = String(value || "").replace(/\u0000|[\u0001-\u0008\u000b-\u000d\u000e-\u001f\u007f]/g, " ");
  if (Buffer.byteLength(text, "utf8") <= maximumBytes) return text;
  let output = "";
  for (const character of text) {
    if (Buffer.byteLength(output + character, "utf8") > maximumBytes) break;
    output += character;
  }
  return output;
}

function buildRlcd42Scene({
  characterName = "CharaDock",
  interactionMode = "chat",
  turn = {},
  speechInputProvider = "",
  beatrice = false,
  captionMode = "auto",
  caption = "",
  activityOverride = "",
  language = "ja",
  transport = "usb",
  now = Date.now(),
} = {}) {
  const text = (japanese, english) => language === "en" ? english : japanese;
  const status = {
    listening: "listening",
    thinking: "thinking",
    working: "working",
    speaking: "speaking",
    completed: "completed",
    error: "error",
    approval: "approval",
    "approval-required": "approval",
  }[String(turn.status || "idle")] || "idle";
  const workMode = status === "idle" ? interactionMode === "work" : turn.mode === "work";
  const visibleCaption = captionMode === "auto" ? truncateUtf8(caption, 960).trim() : "";
  // Thinking/listening begins before answer text exists. Keep the portrait
  // full-height until there is something real to put in the caption panel.
  const scene = status === "error" ? "recovery" : workMode ? "work"
    : status === "idle" || !visibleCaption ? "home" : "conversation";
  const activity = {
    idle: text("準備できています", "Ready"),
    listening: text("聞いています…", "Listening…"),
    thinking: text("考えています…", "Thinking…"),
    working: text("作業を進めています…", "Working…"),
    speaking: text("話しています", "Speaking"),
    completed: text("完了しました", "Completed"),
    approval: text("PCで確認してください", "Check the PC"),
    error: text("PCとの状態を確認してください", "Check the PC connection"),
  }[status];
  const live = speechInputProvider === "realtime";
  const activeTransport = String(transport || "").toLowerCase() === "wifi"
    ? "wifi"
    : "usb";
  const startedAt = Number(turn.startedAt) || 0;
  const currentTime = Number(now) || Date.now();
  return {
    scene,
    state: status,
    characterName: truncateUtf8(characterName || "CharaDock", 48),
    modeLabel: workMode ? "WORK" : live ? "LIVE" : "CHAT",
    connected: true,
    live,
    beatrice: beatrice === true,
    approval: status === "approval",
    elapsedSeconds: startedAt ? Math.max(0, Math.min(0xffffffff, Math.floor((currentTime - startedAt) / 1000))) : 0,
    artifactCount: Math.min(0xffff, Array.isArray(turn.artifacts) ? turn.artifacts.length : 0),
    caption: scene === "conversation" ? visibleCaption : "",
    activity: truncateUtf8(activityOverride || activity, 384),
    nextAction: status === "approval" ? text("許可または却下を選択", "Approve or decline") : "",
    footer: activeTransport === "wifi"
      ? text("Wi-Fi接続  CharaDock", "Wi-Fi  CharaDock")
      : text("USB接続  CharaDock", "USB  CharaDock"),
  };
}

module.exports = { buildRlcd42Scene, truncateUtf8 };
