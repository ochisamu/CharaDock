// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { CodexAppServerClient } = require("../backend/codex-client.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function emit(client, method, params) { client.handleLine(JSON.stringify({ method, params })); }
function complete(client, turnId, text = "answer", threadId = "thread") {
  emit(client, "item/completed", { threadId, turnId, item: { id: "answer", type: "agentMessage", phase: "final_answer", text } });
  emit(client, "turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
}
function harness(t) {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.threadId = "thread";
  client.request = async () => ({});
  t.after(() => client.handleExit(0));
  return client;
}
async function soon(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("test: operation did not settle")), 150);
    })]);
  } finally { clearTimeout(timer); }
}

test("early deltas are replayed exactly once with their phase", async (t) => {
  const client = harness(t);
  const deltas = [];
  client.request = async () => {
    emit(client, "item/started", { turnId: "early", item: { id: "a", type: "agentMessage", phase: "final_answer" } });
    emit(client, "item/agentMessage/delta", { turnId: "early", itemId: "a", delta: "hello" });
    emit(client, "turn/completed", { turn: { id: "early", status: "completed" } });
    return { turn: { id: "early" } };
  };
  assert.equal((await soon(client.sendMessage("hi", { onDelta: (delta) => deltas.push(delta) }))).text, "hello");
  assert.deepEqual(deltas, ["hello"]);
});

test("early buffer overflow fails promptly instead of losing completion and hanging", async (t) => {
  const client = harness(t);
  client.request = async (method) => {
    if (method !== "turn/start") return {};
    for (let i = 0; i < 260; i++) emit(client, "item/started", { turnId: "many", item: { id: String(i), type: "reasoning" } });
    complete(client, "many");
    return { turn: { id: "many" } };
  };
  await assert.rejects(soon(client.sendMessage("hi")), /buffer|overflow/i);
  assert.equal(client.hasActiveTurn(), false);
});

test("interrupt during startup installs the collector before sending interrupt", async (t) => {
  const client = harness(t);
  const start = deferred();
  client.request = async (method) => {
    if (method === "turn/start") return start.promise;
    if (method === "turn/interrupt") emit(client, "turn/completed", { turn: { id: "interrupted", status: "interrupted" } });
    return {};
  };
  const sending = client.sendMessage("hi");
  const outcome = assert.rejects(soon(sending), /interrupted/);
  await tick();
  await client.interruptActiveTurn();
  start.resolve({ turn: { id: "interrupted" } });
  await outcome;
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(client.turnCollectors.size, 0);
});

test("a missing collector does not establish that the server turn is finished", (t) => {
  const client = harness(t);
  client.activeTurnId = "still-running";
  client.activeTurnSource = "message";
  assert.equal(client.recoverOrphanedActiveTurn(), false);
  assert.equal(client.hasActiveTurn(), true);
});

test("reset rejects active and queued messages and permits a fresh conversation", async (t) => {
  const client = harness(t);
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "fresh" } };
    if (method === "turn/start") return { turn: { id: params.threadId === "fresh" ? "new" : "old" } };
    return {};
  };
  const old = client.sendMessage("old");
  const queued = client.sendMessage("queued");
  const rejected = [assert.rejects(soon(old), /reset/i), assert.rejects(soon(queued), /reset/i)];
  await tick();
  client.reset();
  await Promise.all(rejected);
  const fresh = client.sendMessage("fresh");
  await tick();
  complete(client, "new", "fresh answer", "fresh");
  assert.equal((await soon(fresh)).text, "fresh answer");
  assert.deepEqual(calls.filter(({ method }) => method === "turn/start").map(({ params }) => params.input[0].text), ["old", "fresh"]);
});

test("reset during turn/start cannot resurrect the cancelled turn", async (t) => {
  const client = harness(t);
  const start = deferred();
  const interrupts = [];
  client.request = async (method, params) => {
    if (method === "turn/start") return start.promise;
    if (method === "turn/interrupt") interrupts.push(params);
    return {};
  };
  const sending = client.sendMessage("hi");
  const rejected = assert.rejects(soon(sending), /reset/i);
  await tick();
  client.reset();
  await rejected;
  start.resolve({ turn: { id: "late" } });
  await tick();
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(client.turnCollectors.size, 0);
  assert.deepEqual(interrupts, [{ threadId: "thread", turnId: "late" }]);
});

test("concurrent thread creation is shared and reset discards a late thread response", async (t) => {
  const client = harness(t);
  client.threadId = null;
  const start = deferred();
  let calls = 0;
  client.request = async () => { calls++; return start.promise; };
  const first = client.ensureThread();
  const second = client.ensureThread();
  const outcomes = [assert.rejects(soon(first), /reset/i), assert.rejects(soon(second), /reset/i)];
  await tick();
  const observedCalls = calls;
  client.reset();
  start.resolve({ thread: { id: "stale" } });
  await Promise.all(outcomes);
  assert.equal(observedCalls, 1);
  assert.equal(client.threadId, null);
});

test("completed turn retains its original thread after configuration changes", async (t) => {
  const client = harness(t);
  client.request = async () => ({ turn: { id: "answer" } });
  const sending = client.sendMessage("hi");
  await tick();
  client.setModel("another-model");
  complete(client, "answer");
  assert.equal((await sending).threadId, "thread");
});

test("known commentary alone is not reported as the final answer", async (t) => {
  const client = harness(t);
  client.request = async () => ({ turn: { id: "commentary" } });
  const sending = client.sendMessage("hi");
  const rejected = assert.rejects(sending, /テキスト応答/);
  await tick();
  emit(client, "item/agentMessage/delta", { turnId: "commentary", phase: "commentary", delta: "working" });
  emit(client, "turn/completed", { turn: { id: "commentary", status: "completed" } });
  await rejected;
});

test("observer exceptions cannot strand collectors or prevent terminal cleanup", async (t) => {
  const client = harness(t);
  client.request = async () => ({ turn: { id: "observer" } });
  const sending = client.sendMessage("hi", { onDelta: () => { throw new Error("UI failed"); }, onEvent: () => { throw new Error("UI failed"); } });
  sending.catch(() => {});
  await tick();
  assert.doesNotThrow(() => emit(client, "item/agentMessage/delta", { turnId: "observer", delta: "hello" }));
  assert.doesNotThrow(() => emit(client, "turn/completed", { turn: { id: "observer", status: "completed" } }));
  assert.equal((await soon(sending)).text, "hello");
  assert.equal(client.hasActiveTurn(), false);
});

test("synchronous transport failure removes the pending request and timer", async (t) => {
  const client = harness(t);
  client.request = CodexAppServerClient.prototype.request;
  await assert.rejects(client.request("account/read", {}), /接続/);
  assert.equal(client.pending.size, 0);
});

test("dynamic tool responses from an exited process are never sent to its replacement", async (t) => {
  const client = harness(t);
  const tool = deferred();
  client.proc = { stdin: { writable: true } };
  client.onDynamicToolCall = () => tool.promise;
  const responses = [];
  client.send = (payload) => responses.push(payload);
  const handling = client.handleDynamicToolCall({ id: 1, params: {} });
  client.handleExit(0);
  client.proc = { stdin: { writable: true } };
  tool.resolve({ contentItems: [] });
  await handling;
  assert.deepEqual(responses, []);
});

function voiceHarness(t) {
  const client = harness(t);
  client.ensureThread = async () => { client.threadId = "voice"; return "voice"; };
  return client;
}

test("Realtime closed during startup rejects immediately", async (t) => {
  const client = voiceHarness(t);
  const starting = client.startRealtime({ sdp: "v=0" });
  const rejected = assert.rejects(soon(starting), /closed/i);
  await tick();
  emit(client, "thread/realtime/closed", { threadId: "voice" });
  await rejected;
  assert.equal(client.hasActiveRealtime(), false);
});

test("Realtime cannot accept appended speech or text before started", async (t) => {
  const client = voiceHarness(t);
  const calls = [];
  client.request = async (method) => { calls.push(method); return {}; };
  const starting = client.startRealtime({ sdp: "v=0" });
  starting.catch(() => {});
  await tick();
  assert.equal(client.hasActiveRealtime(), false);
  assert.equal(await client.appendRealtimeText("early"), false);
  assert.equal(await client.appendRealtimeSpeech("early"), false);
  emit(client, "thread/realtime/started", { threadId: "voice" });
  await starting;
  assert.equal(client.hasActiveRealtime(), true);
  assert.deepEqual(calls, ["thread/realtime/start"]);
});

test("exit clears Realtime ownership before notifying even a throwing observer", (t) => {
  const client = voiceHarness(t);
  client.threadId = "voice";
  let active;
  client.realtimeHandlers.set("voice", () => { active = client.hasActiveRealtime(); throw new Error("UI failed"); });
  assert.doesNotThrow(() => client.handleExit(1));
  assert.equal(active, false);
  assert.equal(client.realtimeHandlers.size, 0);
  assert.equal(client.proc, null);
});

test("ending Realtime does not forget a still-running delegated work turn", async (t) => {
  const client = voiceHarness(t);
  client.threadId = "voice";
  client.realtimeHandlers.set("voice", () => {});
  emit(client, "turn/started", { threadId: "voice", turn: { id: "work" } });
  emit(client, "thread/realtime/closed", { threadId: "voice" });
  assert.equal(client.hasActiveRealtime(), false);
  assert.equal(client.hasActiveTurn(), true);
  assert.equal(client.recoverOrphanedActiveTurn(), false);
  emit(client, "turn/completed", { threadId: "voice", turn: { id: "work", status: "completed" } });
  assert.equal(client.hasActiveTurn(), false);
});

test("queued turn cleanup preserves startup ownership and an immediate interrupt", async (t) => {
  const client = harness(t);
  const secondStart = deferred();
  let starts = 0;
  let interrupts = 0;
  client.request = async (method) => {
    if (method === "turn/start") return ++starts === 1 ? { turn: { id: "first" } } : secondStart.promise;
    if (method === "turn/interrupt") {
      interrupts++;
      emit(client, "turn/completed", { turn: { id: "second", status: "interrupted" } });
    }
    return {};
  };
  const first = client.sendMessage("first");
  const second = client.sendMessage("second");
  const rejected = assert.rejects(soon(second), /interrupted/);
  await tick();
  complete(client, "first");
  await first;
  await tick();
  assert.equal(client.activeTurnState().turnStarting, true);
  assert.equal(await client.interruptActiveTurn(), true);
  secondStart.resolve({ turn: { id: "second" } });
  await rejected;
  assert.equal(interrupts, 1);
});

test("an early unsupported approval rejects locally and replies to the server once", async (t) => {
  const client = harness(t);
  client.rejectInteractiveRequests = true;
  client.proc = { stdin: { writable: true } };
  const responses = [];
  client.send = (message) => responses.push(message);
  client.request = async (method) => {
    if (method !== "turn/start") return {};
    client.handleLine(JSON.stringify({ id: 5, method: "tool/requestUserInput", params: { threadId: "thread", turnId: "approval" } }));
    return { turn: { id: "approval" } };
  };
  await assert.rejects(soon(client.sendMessage("hi")), /実行しませんでした/);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 5);
  assert.equal(client.turnCollectors.size, 0);
});

test("startup interrupt failure releases the collector and detaches the uncertain thread", async (t) => {
  const client = harness(t);
  const start = deferred();
  client.request = async (method) => {
    if (method === "turn/start") return start.promise;
    throw new Error("interrupt rejected");
  };
  const sending = client.sendMessage("hi");
  const rejected = assert.rejects(soon(sending), /interrupt rejected/);
  await tick();
  await client.interruptActiveTurn();
  start.resolve({ turn: { id: "work" } });
  await rejected;
  assert.equal(client.turnCollectors.size, 0);
  assert.equal(client.threadId, null);
  assert.equal(client.hasActiveTurn(), false);
});

test("collector timeout interrupts its original thread and permits new work", async (t) => {
  const client = harness(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    return { turn: { id: "timed-out" } };
  };
  const sending = client.sendMessage("hi", { timeoutMs: 30_000 });
  const rejected = assert.rejects(sending, /タイムアウト/);
  await tick();
  t.mock.timers.tick(30_001);
  await rejected;
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(client.threadId, null);
  assert.deepEqual(calls[1], { method: "turn/interrupt", params: { threadId: "thread", turnId: "timed-out" } });
});

test("reset cancels a blocked preflight without allowing a later turn/start", async (t) => {
  const client = harness(t);
  const preflight = deferred();
  client.ensureMcpServersReady = () => preflight.promise;
  const calls = [];
  client.request = async (method) => { calls.push(method); return {}; };
  const sending = client.sendMessage("hi");
  const rejected = assert.rejects(soon(sending), /reset/i);
  await tick();
  client.reset();
  await rejected;
  preflight.resolve();
  await tick();
  assert.deepEqual(calls, []);
  assert.equal(client.hasActiveTurn(), false);
});

test("steer and interrupt retain the active thread after changing model", async (t) => {
  const client = harness(t);
  const calls = [];
  client.request = async (method, params) => { calls.push({ method, params }); return { turn: { id: "work" } }; };
  const sending = client.sendMessage("hi");
  sending.catch(() => {});
  await tick();
  client.setModel("another-model");
  assert.equal(await client.steerActiveTurn("follow-up"), true);
  assert.equal(await client.interruptActiveTurn(), true);
  assert.equal(calls[1].params.threadId, "thread");
  assert.equal(calls[2].params.threadId, "thread");
  complete(client, "work");
  await sending;
});

test("stale exit callbacks cannot reject a replacement process's requests", async (t) => {
  const client = harness(t);
  const old = { stdin: { writable: true } };
  const current = { stdin: { writable: true, write: () => {} } };
  client.proc = current;
  client.request = CodexAppServerClient.prototype.request;
  const pending = client.request("account/read", {});
  pending.catch(() => {});
  client.handleExit(1, null, old);
  assert.equal(client.proc, current);
  assert.equal(client.pending.size, 1);
  client.handleLine(JSON.stringify({ id: client.nextId - 1, result: { ok: true } }));
  assert.deepEqual(await pending, { ok: true });
});

test("failed initialization discards the child and a retry really initializes", async (t) => {
  const fixture = (fail) => `
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.method === 'initialize') process.stdout.write(JSON.stringify({
        id: message.id, ${fail ? "error: { message: 'initialize rejected' }" : "result: {}"}
      }) + '\\n');
    });
  `;
  const client = new CodexAppServerClient({ command: process.execPath, commandArgs: ["-e", fixture(true), "--"] });
  t.after(() => client.stop());
  await assert.rejects(client.ensureStarted(), /initialize rejected/);
  assert.equal(client.proc, null);
  assert.equal(client.pending.size, 0);
  client.commandArgs = ["-e", fixture(false), "--"];
  await client.ensureStarted();
  const replacement = client.proc;
  await tick();
  assert.equal(client.proc, replacement);
  assert.equal(replacement.killed, false);
});

test("exit cancels queued sends instead of silently restarting and sending them", async (t) => {
  const client = harness(t);
  let starts = 0;
  client.request = async () => { starts++; return { turn: { id: "work" } }; };
  const first = client.sendMessage("first");
  const second = client.sendMessage("second");
  const rejected = [assert.rejects(soon(first), /終了/), assert.rejects(soon(second), /終了/)];
  await tick();
  client.handleExit(1);
  await Promise.all(rejected);
  assert.equal(starts, 1);
  assert.equal(client.turnCollectors.size, 0);
});

test("Realtime error after started but before RPC response cannot return success", async (t) => {
  const client = voiceHarness(t);
  const response = deferred();
  client.request = () => response.promise;
  const starting = client.startRealtime({ sdp: "v=0" });
  const rejected = assert.rejects(soon(starting), /connection lost/);
  await tick();
  emit(client, "thread/realtime/started", { threadId: "voice" });
  emit(client, "thread/realtime/error", { threadId: "voice", message: "connection lost" });
  response.resolve({});
  await rejected;
  assert.equal(client.hasActiveRealtime(), false);
});

test("reset cancels Realtime preflight before it can recreate voice ownership", async (t) => {
  const client = voiceHarness(t);
  const preflight = deferred();
  client.ensureMcpServersReady = () => preflight.promise;
  let starts = 0;
  client.request = async () => { starts++; return {}; };
  const starting = client.startRealtime({ sdp: "v=0" });
  const rejected = assert.rejects(soon(starting), /reset/i);
  await tick();
  client.reset();
  await rejected;
  preflight.resolve();
  await tick();
  assert.equal(starts, 0);
  assert.equal(client.hasActiveRealtime(), false);
});

test("concurrent Realtime starts cannot replace each other's startup handler", async (t) => {
  const client = voiceHarness(t);
  const first = client.startRealtime({ sdp: "v=0" });
  first.catch(() => {});
  await tick();
  await assert.rejects(client.startRealtime({ sdp: "v=0" }), /already in progress/);
  emit(client, "thread/realtime/started", { threadId: "voice" });
  assert.equal((await soon(first)).threadId, "voice");
});

test("Realtime stop finds the owned voice thread after configuration invalidates threadId", async (t) => {
  const client = voiceHarness(t);
  const starting = client.startRealtime({ sdp: "v=0" });
  await tick();
  emit(client, "thread/realtime/started", { threadId: "voice" });
  await starting;
  client.setPersona("new persona");
  const calls = [];
  client.request = async (method, params) => { calls.push({ method, params }); return {}; };
  assert.equal(await client.stopRealtime(), true);
  assert.deepEqual(calls, [{ method: "thread/realtime/stop", params: { threadId: "voice" } }]);
  assert.equal(client.realtimeHandlers.size, 0);
});

test("terminal event observers run after collector cleanup and receive turn.id events", async (t) => {
  const client = harness(t);
  client.request = async () => ({ turn: { id: "work" } });
  const observations = [];
  const sending = client.sendMessage("hi", { onEvent: (event) => {
    if (event.method === "turn/completed") observations.push({ active: client.hasActiveTurn(), collectors: client.turnCollectors.size });
  } });
  await tick();
  complete(client, "work");
  await sending;
  assert.deepEqual(observations, [{ active: false, collectors: 0 }]);
});

test("asynchronous transport write failure immediately cleans up the request", async (t) => {
  const client = harness(t);
  client.request = CodexAppServerClient.prototype.request;
  client.proc = { stdin: { writable: true, write: (_, callback) => queueMicrotask(() => callback(new Error("broken pipe"))) } };
  await assert.rejects(soon(client.request("account/read", {})), /broken pipe/);
  assert.equal(client.pending.size, 0);
});

test("Realtime startup error removes the outstanding start RPC and its timer", async (t) => {
  const client = voiceHarness(t);
  client.request = CodexAppServerClient.prototype.request;
  client.send = () => {};
  const starting = client.startRealtime({ sdp: "v=0" });
  const rejected = assert.rejects(soon(starting), /startup failed/);
  await tick();
  assert.equal(client.pending.size, 1);
  emit(client, "thread/realtime/error", { threadId: "voice", message: "startup failed" });
  await rejected;
  assert.equal(client.pending.size, 0);
});
