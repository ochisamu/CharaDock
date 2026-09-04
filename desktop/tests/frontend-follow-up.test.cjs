// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const sources = {
  control: fs.readFileSync(path.join(__dirname, "../control.js"), "utf8"),
  mascot: fs.readFileSync(path.join(__dirname, "../preload-mascot.cjs"), "utf8"),
};
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing renderer section: ${start}`);
  return source.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(setImmediate);

// Exercise the production submit, stream, Stop, and finally handlers together;
// only DOM/media services and the asynchronous IPC boundary are substituted.
function renderer(surface, backend, { hiddenHistory = false } = {}) {
  const listeners = new Map();
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", textContent: "", disabled: false, hidden: false, isConnected: true,
      firstChild: { textContent: "" }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}, focus() {}, appendChild() {}, remove() {},
      querySelector: () => node(`${id}:p`),
      addEventListener: (event, handler) => listeners.set(`${id}:${event}`, handler),
    });
    return nodes.get(id);
  };
  const c = vm.createContext({
    queueMicrotask, performance, clearTimeout() {},
    $: node, input: node("#chatInput"), form: node("#form"),
    sendButton: node("#sendButton"), stopButton: node("#stopButton"),
    modeButton: node("#modeButton"), workTarget: node("#workTarget"), workOpenButton: node("#workOpen"),
    bubble: node("#bubble"), bubbleText: node("#bubbleText"), bubbleMore: node("#bubbleMore"), artifactActions: node("#artifacts"),
    state: { backend: "openai", interactionMode: "chat", language: "en" },
    appState: { backend: "openai", interactionMode: "chat", language: "en" },
    chatAttachments: [], chatSelectedSkillIds: [], chatSelectedMcpServerIds: [],
    mascotAttachments: [], mascotSelectedSkillIds: [], mascotSelectedMcpServerIds: [],
    chatBusy: false, sending: false, pendingChatFollowUp: null, pendingFollowUp: null,
    localChatSendPending: false, localMascotSendPending: 0,
    realtimeStarting: false, realtimePeerConnection: null, realtimeSessionState: "idle",
    realtimeUnavailable: false, startCodexRealtimeVoice: async () => { throw new Error("Live failed"); },
    closeRealtimeAudio() {}, setRealtimeOutputSuppressed() {},
    realtimeAssistantMessage: null, realtimePendingTypedText: "", realtimeTypedChatTurnActive: false,
    streamingMessage: null, streamingMessageMode: "", activeStreamMode: "", activeStreamTurnId: "", activeStreamWorkRunId: "",
    workHistoryState: {}, detachedRealtimeWorkBusy: false, detachedRealtimeWorkRunId: "",
    streamWorkMode: false, streamHasActivity: false, streamFullText: "", streamCurrentSpeechText: "",
    streamTtsConfig: { enabled: false }, streamTtsFinished: false, streamTtsDraining: false,
    streamTtsQueue: [], ttsBusy: false, bubbleHideDuration: 9000, hideTimer: null,
    localized: (_ja, en) => en, uiText: (_ja, en) => en,
    friendlyConversationErrorMessage: (error) => error?.message || error,
    friendlyInteractionErrorMessage: (error) => error?.message || error,
    historyShowsMode: () => !hiddenHistory, historyViewForMode: () => "conversation", setChatHistoryView() {},
    appendMessage: () => node("#reply"), appendWorkArtifactActions() {}, syncCharacterSwitchAvailability() {},
    renderChatAttachments() {}, renderChatSelectedSkills() {}, closeChatAddPopover() {},
    renderMascotAttachments() {}, renderMascotSelectedSkills() {}, closeMascotAddPopover() {}, resizeInput() {},
    clearAutoSendCountdown() {}, clearBubbleArtifactActions() {}, stopTtsPlayback() {}, clearPermission() {},
    hasRealtimeTransport: () => false, setStatus() {}, setWorkActivity() {}, syncBubbleOverflow() {},
    normalizeDisplayText: (text) => String(text || ""), queueStreamSpeech() {}, renderArtifactActions() {},
    scheduleBubbleArtifactActionsClear() {}, scheduleBubbleHide() {}, finishTtsPlayback() {},
  });
  c.mergeMascotAttachments = (items) => {
    c.mascotAttachments = [...new Map([...c.mascotAttachments, ...items].map((item) => [item.path, item])).values()];
  };
  c.api = {
    sendChat: (payload) => backend.send(payload),
    followUpChat: (payload) => backend.followUp(payload),
    interruptChat: () => backend.interrupt(),
    stopCodexRealtime: async () => {},
    appendCodexRealtimeText: async () => { throw new Error("Live append failed"); },
    onChatStream: (handler) => listeners.set("stream", handler),
  };
  c.ipcRenderer = {
    invoke(channel, payload) {
      if (channel === "mascotInline:chat") return backend.send(payload);
      if (channel === "mascotInline:followUp") return backend.followUp(payload);
      if (channel === "mascotInline:interruptActive") return backend.interrupt();
      return Promise.resolve({});
    },
    on(channel, handler) { if (channel === "mascot:stream") listeners.set("stream", (payload) => handler(null, payload)); },
  };
  const source = sources[surface];
  if (surface === "control") {
    vm.runInContext([
      section(source, "  function setChatBusy(", "  function bindEvents("),
      section(source, "    api.onChatStream?.(", "    api.onChatHistory?.("),
      section(source, '    $("#stopButton").addEventListener(', '    $("#chatInput").addEventListener("input"'),
      "globalThis.submit = (...args) => sendChat(...args); globalThis.drain = drainPendingChatFollowUp;",
    ].join("\n"), c);
  } else {
    vm.runInContext([
      section(source, "  const setSendingControls =", "  const elapsedActivityLabel ="),
      section(source, "  const restoreMascotFollowUp =", '  modeButton.addEventListener("click"'),
      section(source, '  ipcRenderer.on("mascot:stream"', '  ipcRenderer.on("mascot:realtimeEvent"'),
      "globalThis.drain = drainPendingMascotFollowUp;",
    ].join("\n"), c);
    c.submit = () => listeners.get("#form:submit")({ preventDefault() {} });
  }
  return {
    c, input: c.input,
    submit(text) { c.input.value = text; return c.submit(); },
    emit(payload) { listeners.get("stream")({ mode: "chat", turnId: "original-turn", ...payload }); },
    stop() { return listeners.get("#stopButton:click")(); },
    pending: () => surface === "control" ? c.pendingChatFollowUp : c.pendingFollowUp,
    busy: () => surface === "control" ? c.chatBusy : c.sending,
  };
}

function backendHarness() {
  const requests = [];
  const interrupt = deferred();
  let interrupts = 0;
  return {
    requests, interruptResult: interrupt,
    interruptCount: () => interrupts,
    send(payload) { const result = deferred(); requests.push({ payload, result }); return result.promise; },
    followUp: async () => ({ accepted: false, retryAsNewTurn: true }),
    interrupt() { interrupts += 1; return interrupt.promise; },
  };
}

for (const surface of ["control", "mascot"]) {
  for (const phase of ["done", "error", "interrupted"]) {
    test(`${surface}: ${phase} drains an OpenAI follow-up from the other window exactly once`, async () => {
      const backend = backendHarness();
      const origin = renderer(surface === "control" ? "mascot" : "control", backend);
      const follower = renderer(surface, backend);
      const original = origin.submit("original request");
      origin.emit({ phase: "start" });
      follower.emit({ phase: "start" });
      const followUp = follower.submit("queued revision");
      await tick();
      follower.input.value = "next unsent draft";
      origin.emit({ phase, message: "interrupted" });
      follower.emit({ phase, message: "interrupted" });
      await tick();
      assert.equal(backend.requests.length, 1, "wait for interrupt acknowledgement");
      backend.requests[0].result.reject(new Error("interrupted"));
      await original;
      backend.interruptResult.resolve({ interrupted: true });
      await followUp;
      await tick();
      assert.equal(backend.requests.length, 2);
      assert.equal(backend.requests[1].payload.message, "queued revision");
      assert.equal(follower.input.value, "next unsent draft");
      assert.equal(follower.pending(), null);
      follower.c.drain();
      await tick();
      assert.equal(backend.requests.length, 2);
      backend.requests[1].result.resolve({ mode: "chat", provider: "openai", streamed: true });
      await tick();
    });
  }

  test(`${surface}: stream termination waits for local finally and does not duplicate its drain`, async () => {
    const backend = backendHarness();
    const r = renderer(surface, backend);
    const original = r.submit("original");
    r.emit({ phase: "start" });
    const followUp = r.submit("revision");
    await tick();
    backend.interruptResult.resolve({ interrupted: true });
    await followUp;
    r.emit({ phase: "error", message: "interrupted" });
    r.emit({ phase: "interrupted" });
    await tick();
    assert.equal(backend.requests.length, 1, "old local IPC still owns cleanup");
    backend.requests[0].result.reject(new Error("interrupted"));
    await original;
    await tick();
    assert.equal(backend.requests.length, 2);
    assert.equal(r.busy(), true, "old finally cannot unlock the new send");
    assert.equal(backend.requests[1].payload.message, "revision");
    backend.requests[1].result.resolve({ mode: "chat", provider: "openai", streamed: true });
    await tick();
  });

  test(`${surface}: interrupt failure restores the queued revision beside a newer draft`, async () => {
    const backend = backendHarness();
    const r = renderer(surface, backend);
    r.emit({ phase: "start" });
    const followUp = r.submit("revision");
    await tick();
    r.input.value = "new draft";
    r.emit({ phase: "error", message: "network error" });
    backend.interruptResult.reject(new Error("interrupt failed"));
    await followUp;
    await tick();
    assert.equal(backend.requests.length, 0);
    assert.equal(r.pending(), null);
    assert.equal(r.input.value, "revision\n\nnew draft");
  });

  test(`${surface}: failed queued send restores its payload without losing the newer draft`, async () => {
    const backend = backendHarness();
    const r = renderer(surface, backend);
    r.emit({ phase: "start" });
    const followUp = r.submit("revision");
    await tick();
    backend.interruptResult.resolve({ interrupted: true });
    await followUp;
    r.input.value = "new draft";
    r.emit({ phase: "interrupted" });
    await tick();
    backend.requests[0].result.reject(new Error("network unavailable"));
    await tick();
    assert.equal(backend.requests.length, 1);
    assert.equal(r.input.value, "revision\n\nnew draft");
    assert.equal(r.busy(), false);
  });

  test(`${surface}: explicit Stop cancels the pending drain and restores its draft`, async () => {
    const backend = backendHarness();
    const r = renderer(surface, backend);
    r.emit({ phase: "start" });
    const pending = { message: "revision", attachments: [], selectedSkillIds: [], selectedMcpServerIds: [] };
    if (surface === "control") r.c.pendingChatFollowUp = pending;
    else r.c.pendingFollowUp = pending;
    r.input.value = "new draft";
    const stop = r.stop();
    r.emit({ phase: "interrupted" });
    backend.interruptResult.resolve({ interrupted: true });
    await stop;
    await tick();
    assert.equal(backend.requests.length, 0);
    assert.equal(r.pending(), null);
    assert.equal(r.input.value, "revision\n\nnew draft");
  });
}

test("control drains cross-window Chat while the Work history tab is displayed", async () => {
  const backend = backendHarness();
  const r = renderer("control", backend, { hiddenHistory: true });
  r.emit({ phase: "start" });
  const followUp = r.submit("revision");
  await tick();
  backend.interruptResult.resolve({ interrupted: true });
  await followUp;
  r.emit({ phase: "error", message: "interrupted" });
  await tick();
  assert.equal(backend.requests.length, 1);
  assert.equal(backend.requests[0].payload.message, "revision");
  backend.requests[0].result.resolve({ provider: "openai", streamed: true });
  await tick();
});

test("control ignores a DOM event passed to sendChat and clears the submitted composer", async () => {
  const backend = backendHarness();
  const r = renderer("control", backend);
  r.input.value = "typed message";
  r.c.chatAttachments = [{ path: "/typed.txt", name: "typed.txt" }];
  r.c.chatSelectedSkillIds = ["typed-skill"];
  r.c.chatSelectedMcpServerIds = ["typed-mcp"];
  const send = r.c.submit({ type: "click", preventDefault() {} });
  assert.equal(backend.requests[0].payload.message, "typed message");
  assert.deepEqual([...backend.requests[0].payload.attachmentPaths], ["/typed.txt"]);
  assert.equal(r.input.value, "");
  assert.equal(r.c.chatAttachments.length, 0);
  assert.equal(r.c.chatSelectedSkillIds.length, 0);
  assert.equal(r.c.chatSelectedMcpServerIds.length, 0);
  backend.requests[0].result.resolve({ provider: "openai", streamed: true });
  await send;
});

for (const reason of ["connecting", "auto-attachments", "auto-skills", "unavailable", "startup-error", "live-attachments", "live-skills", "append-error"]) {
  test(`control restores queued payload and newer composer after Live ${reason}`, async () => {
    const backend = backendHarness();
    const r = renderer("control", backend);
    const attachments = reason.includes("attachments") ? [{ path: "/queued.txt", name: "queued.txt" }] : [];
    const skills = reason.includes("skills") ? ["queued-skill"] : [];
    r.c.pendingChatFollowUp = { message: "queued revision", attachments, selectedSkillIds: skills, selectedMcpServerIds: ["queued-mcp"] };
    r.input.value = "new draft";
    r.c.chatAttachments = [{ path: "/new.txt", name: "new.txt" }];
    r.c.chatSelectedMcpServerIds = ["new-mcp"];
    r.c.state = { backend: "codex", interactionMode: "chat", speechInputProvider: "realtime" };
    if (reason === "connecting") r.c.realtimeStarting = true;
    if (reason === "unavailable") r.c.realtimeUnavailable = true;
    if (reason.startsWith("live-") || reason === "append-error") r.c.realtimePeerConnection = {};
    r.c.drain();
    await tick();
    assert.equal(backend.requests.length, 0);
    assert.equal(r.pending(), null);
    assert.equal(r.input.value, "queued revision\n\nnew draft");
    assert.deepEqual([...r.c.chatAttachments].map((item) => item.path), [...attachments.map((item) => item.path), "/new.txt"]);
    assert.deepEqual([...r.c.chatSelectedSkillIds], skills);
    assert.deepEqual([...r.c.chatSelectedMcpServerIds], ["queued-mcp", "new-mcp"]);
  });
}
