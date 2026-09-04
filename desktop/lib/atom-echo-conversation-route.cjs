// SPDX-License-Identifier: Apache-2.0

function atomEchoConversationRoute({
  speechInputProvider = "browser",
  backend = "codex",
  activeRealtime = false,
  activeRealtimeTarget = "",
  activeWork = false,
  deviceTarget = "atom-echo",
} = {}) {
  const ownTarget = deviceTarget === "rlcd42" ? "rlcd42" : "atom-echo";
  if (speechInputProvider !== "realtime") return { mode: "standard", startLive: false, blocked: "" };
  if (backend !== "codex") return { mode: "live", startLive: false, blocked: "backend" };
  if (activeRealtime && activeRealtimeTarget !== ownTarget) return { mode: "live", startLive: false, blocked: "other-live" };
  if (activeWork && activeRealtimeTarget !== ownTarget) return { mode: "live", startLive: false, blocked: "work" };
  return { mode: "live", startLive: activeRealtimeTarget !== ownTarget, blocked: "" };
}

function atomEchoStandardCaptureRoute(submitRoute = "") {
  const route = String(submitRoute || "");
  return {
    route,
    allowed: route === "new-turn" || route === "follow-up",
    followUp: route === "follow-up",
  };
}

function atomEchoStandardDeliveryOptions(submitRoute = "") {
  // Do not force Chat or Work here. sendChatMessage must remain the single
  // authority for the PC interaction mode and its conversational-Work rules.
  const route = String(submitRoute || "");
  return {
    suppressPcAudio: true,
    ...(route === "new-turn" || route === "follow-up"
      ? { capturedSubmitRoute: route }
      : {}),
  };
}

module.exports = {
  atomEchoConversationRoute,
  atomEchoStandardCaptureRoute,
  atomEchoStandardDeliveryOptions,
};
