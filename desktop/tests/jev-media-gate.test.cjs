const test = require("node:test");
const assert = require("node:assert/strict");
const { JevMediaGate } = require("../lib/jev-media-gate.cjs");
function fixture(classify = async () => "next") {
  const calls = [];
  const gate = new JevMediaGate({ classify, execute: async (args, key) => { calls.push({ args, key }); return { ok: true, accepted: true }; } });
  return { gate, calls };
}
test("fast and delayed native tool share one execution", async () => {
  const { gate, calls } = fixture();
  gate.begin(); gate.bind("turn1");
  await gate.finish("next track");
  await gate.tool({ action: "next" }, "turn1", () => assert.fail("duplicate"));
  await gate.tool({ action: "next" }, "turn1", () => assert.fail("duplicate"));
  assert.equal(calls.length, 1); gate.close();
});
test("native tool arriving while classification runs waits for same receipt", async () => {
  let resolve;
  const { gate, calls } = fixture(() => new Promise(r => { resolve = r; }));
  gate.begin(); gate.bind("turn1");
  const fast = gate.finish("next");
  const native = gate.tool({ action: "next" }, "turn1", () => assert.fail("duplicate"));
  resolve("next"); await Promise.all([fast, native]);
  assert.equal(calls.length, 1); gate.close();
});
test("two legitimate identical utterances each execute, delayed old call does not", async () => {
  const { gate, calls } = fixture();
  gate.begin(); gate.bind("one"); await gate.finish("next");
  gate.begin(); gate.bind("two"); await gate.finish("next");
  await gate.tool({ action: "next" }, "one", () => assert.fail("duplicate"));
  assert.equal(calls.length, 2); assert.notEqual(calls[0].key, calls[1].key); gate.close();
});
test("classification failure preserves normal tools", async () => {
  const { gate, calls } = fixture(async () => { throw new Error("offline"); });
  gate.begin(); gate.bind("one"); assert.equal(await gate.finish("next"), null);
  assert.equal(await gate.tool({ action: "next" }, "one", () => "fallback"), "fallback");
  assert.equal(calls.length, 0); gate.close();
});
test("closing during classification never acts", async () => {
  let resolve;
  const { gate, calls } = fixture(() => new Promise(r => { resolve = r; }));
  gate.begin(); const pending = gate.finish("next"); gate.close(); resolve("next");
  assert.equal(await pending, null); assert.equal(calls.length, 0);
});
test("inconsistent or uncorrelated handoff fails closed", async () => {
  const { gate, calls } = fixture(); gate.begin(); gate.bind("one"); await gate.finish("next");
  assert.equal((await gate.tool({ action: "previous" }, "one", () => assert.fail())).ok, false);
  assert.equal((await gate.tool({ action: "next" }, "unknown", () => assert.fail())).ok, false);
  assert.equal((await gate.tool({ action: "next", playerId: "other" }, "one", () => assert.fail())).ok, false);
  assert.equal(calls.length, 1); gate.close();
});
test("disabled gate makes no classifier call", async () => {
  const gate = new JevMediaGate({ enabled: () => false, classify: () => assert.fail(), execute: () => assert.fail() });
  gate.begin(); assert.equal(await gate.finish("next"), null); gate.close();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("concurrent finish calls await the same classification and execution receipt", async (t) => {
  const classification = deferred(), execution = deferred();
  let classifications = 0, executions = 0;
  const gate = new JevMediaGate({ classify: () => { classifications++; return classification.promise; }, execute: () => { executions++; return execution.promise; } });
  t.after(() => gate.close());
  const ticket = gate.begin(); gate.bind("one");
  const fast = gate.finish("next", ticket);
  let duplicateSettled = false;
  const duplicate = gate.finish("next", ticket).then(value => { duplicateSettled = true; return value; });
  const native = gate.tool({ action: "next" }, "one", () => assert.fail("duplicate action"));
  await Promise.resolve();
  assert.equal(duplicateSettled, false);
  classification.resolve("next");
  const receipt = { ok: true, accepted: true };
  execution.resolve(receipt);
  for (const result of await Promise.all([fast, duplicate, native])) assert.equal(result, receipt);
  assert.equal(classifications, 1); assert.equal(executions, 1);
});

for (const outcome of ["none", "failure", "disabled"]) {
  test(`concurrent native fallbacks share one receipt after ${outcome}`, async (t) => {
    const gate = new JevMediaGate({
      enabled: () => outcome !== "disabled",
      classify: async () => { if (outcome === "failure") throw Error("offline"); return null; },
      execute: () => assert.fail("unexpected fast action"),
    });
    t.after(() => gate.close());
    gate.begin(); gate.bind("one"); await gate.finish("next");
    const execution = deferred(); let calls = 0;
    const fallback = () => { calls++; return execution.promise; };
    const first = gate.tool({ action: "next" }, "one", fallback);
    const second = gate.tool({ action: "next" }, "one", fallback);
    const receipt = { ok: true, accepted: true };
    execution.resolve(receipt);
    assert.deepEqual(await Promise.all([first, second]), [receipt, receipt]);
    assert.equal(await gate.tool({ action: "next" }, "one", fallback), receipt);
    assert.equal(calls, 1);
    assert.equal((await gate.tool({ action: "previous" }, "one", fallback)).ok, false);
    assert.equal((await gate.tool({ action: "next", playerId: "another" }, "one", fallback)).ok, false);
    assert.equal(calls, 1);
  });
}

for (const route of ["fast", "fallback"]) {
  test(`uncertain ${route} execution never retries`, async (t) => {
    let calls = 0;
    const fail = async () => { calls++; throw Error("uncertain outcome"); };
    const gate = new JevMediaGate({ classify: async () => route === "fast" ? "next" : null, execute: fail });
    t.after(() => gate.close());
    gate.begin(); gate.bind("one"); await gate.finish("next");
    const first = await gate.tool({ action: "next" }, "one", fail);
    const second = await gate.tool({ action: "next" }, "one", fail);
    assert.equal(first, second);
    assert.deepEqual(first, { ok: false, reason: "media-operation-failed", outcomeUnknown: true });
    assert.equal(calls, 1);
  });
}

test("close releases a waiting native call without running its fallback", async () => {
  const classification = deferred();
  const { gate, calls } = fixture(() => classification.promise);
  gate.begin(); gate.bind("one");
  const fast = gate.finish("next");
  const native = gate.tool({ action: "next" }, "one", () => assert.fail("closed fallback"));
  gate.close();
  assert.equal((await native).reason, "jev-cancelled");
  classification.resolve("next");
  assert.equal(await fast, null); assert.equal(calls.length, 0);
  assert.equal((await gate.tool({ action: "next" }, "unknown", () => assert.fail())).reason, "jev-cancelled");
});

test("close cancels superseded unbound classifications and their waiting calls", async () => {
  const classification = deferred();
  const { gate, calls } = fixture(() => classification.promise);
  const old = gate.begin();
  const pending = gate.finish("next", old);
  gate.begin(); gate.close(); classification.resolve("next");
  assert.equal(await pending, null);
  assert.equal(await old.ready, null);
  assert.equal(calls.length, 0);
});

test("closing between reservation and execution prevents both routes", async () => {
  for (const fast of [true, false]) {
    const { gate, calls } = fixture();
    const ticket = gate.begin();
    const pending = fast ? gate.run(ticket, { action: "next" })
      : gate.tool({ action: "next" }, "unknown", () => assert.fail("closed fallback"));
    gate.close();
    assert.equal((await pending).reason, "jev-cancelled");
    assert.equal(calls.length, 0);
  }
});

test("native handoff before a transcript reserves the next ticket against duplication", async (t) => {
  const { gate, calls } = fixture(() => assert.fail("cancelled classification"));
  t.after(() => gate.close());
  const execution = deferred(); let nativeCalls = 0;
  const native = gate.tool({ action: "next" }, "unknown", () => { nativeCalls++; return execution.promise; });
  gate.begin(); gate.bind("one");
  assert.equal(await gate.finish("next"), null);
  const correlated = gate.tool({ action: "next" }, "one", () => assert.fail("duplicate fallback"));
  assert.equal((await gate.tool({ action: "next" }, "unknown", () => assert.fail())).reason, "uncorrelated-jev-handoff");
  const receipt = { ok: true, accepted: true }; execution.resolve(receipt);
  assert.deepEqual(await Promise.all([native, correlated]), [receipt, receipt]);
  assert.equal(nativeCalls, 1); assert.equal(calls.length, 0);
});

test("uncorrelated native call racing classification wins only once", async (t) => {
  const classification = deferred();
  const { gate, calls } = fixture(() => classification.promise);
  t.after(() => gate.close());
  gate.begin(); gate.bind("one"); const fast = gate.finish("next");
  let nativeCalls = 0;
  const receipt = { ok: true, accepted: true };
  const native = gate.tool({ action: "next" }, "unknown", () => { nativeCalls++; return receipt; });
  const correlated = gate.tool({ action: "next" }, "one", () => assert.fail("duplicate fallback"));
  classification.resolve("next");
  assert.equal(await fast, null);
  assert.equal(await native, receipt); assert.equal(await correlated, receipt);
  assert.equal(nativeCalls, 1); assert.equal(calls.length, 0);
});

test("late unknown handoff cannot duplicate an old action after a new transcript begins", async (t) => {
  const { gate, calls } = fixture(); t.after(() => gate.close());
  gate.begin(); gate.bind("one"); await gate.finish("next");
  gate.begin(); gate.bind("two");
  assert.equal((await gate.tool({ action: "next" }, "unknown", () => assert.fail())).reason, "uncorrelated-jev-handoff");
  await gate.finish("next");
  assert.equal(calls.length, 2);
});

test("unknown handoff with overlapping classifications cannot race either into a duplicate", async (t) => {
  const classification = deferred();
  const { gate, calls } = fixture(() => classification.promise); t.after(() => gate.close());
  const first = gate.begin(); gate.bind("one"); const fast = gate.finish("next", first);
  const second = gate.begin(); gate.bind("two");
  assert.equal((await gate.tool({ action: "next" }, "unknown", () => assert.fail("ambiguous fallback"))).reason, "uncorrelated-jev-handoff");
  classification.resolve("next"); await fast;
  await gate.finish("next", second);
  assert.equal(calls.length, 2);
});

test("disabling while classification is pending prevents fast execution", async (t) => {
  const classification = deferred(); let enabled = true;
  const gate = new JevMediaGate({ classify: () => classification.promise, enabled: () => enabled, execute: () => assert.fail() });
  t.after(() => gate.close());
  gate.begin(); const fast = gate.finish("next"); enabled = false; classification.resolve("next");
  assert.equal(await fast, null);
});

test("repeated turn binding cannot redirect a delayed old tool into a new utterance", async (t) => {
  const { gate, calls } = fixture(); t.after(() => gate.close());
  const old = gate.begin(); gate.bind("one"); await gate.finish("next");
  gate.begin(); gate.bind("one"); gate.bind("two");
  assert.equal(gate.turns.get("one"), old);
  await gate.tool({ action: "next" }, "one", () => assert.fail());
  await gate.finish("next"); assert.equal(calls.length, 2);
});

test("evicted turn IDs fail closed instead of issuing a duplicate fallback", async (t) => {
  const { gate, calls } = fixture(); t.after(() => gate.close());
  gate.begin(); gate.bind("old"); await gate.finish("next");
  for (let index = 0; index < 129; index++) gate.bind(`new-${index}`);
  gate.begin();
  assert.equal(gate.turns.has("old"), false);
  assert.equal((await gate.tool({ action: "next" }, "old", () => assert.fail())).ok, false);
  assert.equal(calls.length, 1);
});

test("list calls never wait for classification, cancel it, or consume an operation receipt", async (t) => {
  const { gate, calls } = fixture(); t.after(() => gate.close());
  const ticket = gate.begin(); gate.bind("one"); let lists = 0;
  for (const turnId of ["one", "unknown"]) {
    assert.equal(await gate.tool({ action: "list" }, turnId, () => ++lists), lists);
  }
  assert.equal(ticket.cancelled, false); assert.equal(ticket.execution, null);
  await gate.finish("next");
  await gate.tool({ action: "list" }, "unknown", () => ++lists);
  assert.equal(lists, 3); assert.equal(calls.length, 1);
});

test("timeout races share the native fallback and suppress late classification", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const classification = deferred();
  const { gate, calls } = fixture(() => classification.promise); t.after(() => gate.close());
  gate.begin(); gate.bind("one");
  const fast = gate.finish("next"); let nativeCalls = 0;
  const fallback = () => { nativeCalls++; return { ok: true }; };
  const first = gate.tool({ action: "next" }, "one", fallback);
  const second = gate.tool({ action: "next" }, "one", fallback);
  t.mock.timers.tick(15000);
  await Promise.all([first, second]);
  classification.resolve("next");
  assert.equal(await fast, null); assert.equal(nativeCalls, 1); assert.equal(calls.length, 0);
});
