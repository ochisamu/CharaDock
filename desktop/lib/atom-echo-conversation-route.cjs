// SPDX-License-Identifier: Apache-2.0

function atomEchoConversationRoute({
  speechInputProvider = "browser",
  backend = "codex",
  activeRealtime = false,
  activeRealtimeTarget = "",
  activeWork = false,
} = {}) {
  if (speechInputProvider !== "realtime") return { mode: "standard", startLive: false, blocked: "" };
  if (backend !== "codex") return { mode: "live", startLive: false, blocked: "backend" };
  if (activeRealtime && activeRealtimeTarget !== "atom-echo") return { mode: "live", startLive: false, blocked: "other-live" };
  if (activeWork && activeRealtimeTarget !== "atom-echo") return { mode: "live", startLive: false, blocked: "work" };
  return { mode: "live", startLive: activeRealtimeTarget !== "atom-echo", blocked: "" };
}

function atomEchoStandardCaptureRoute(submitRoute = "") {
  const route = String(submitRoute || "");
  return {
    route,
    allowed: route === "new-turn" || route === "follow-up",
    followUp: route === "follow-up",
  };
}

function atomEchoStandardDeliveryOptions() {
  // Do not force Chat or Work here. sendChatMessage must remain the single
  // authority for the PC interaction mode and its conversational-Work rules.
  return { suppressPcAudio: true };
}

module.exports = {
  atomEchoConversationRoute,
  atomEchoStandardCaptureRoute,
  atomEchoStandardDeliveryOptions,
};
