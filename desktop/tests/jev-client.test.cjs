// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JevClient, choice, ENDPOINT } = require("../lib/jev-client.cjs");

const selected = (value, probability = 1) => ({ type: "choice", choice: value, probabilities: { [value]: probability } });
const explicit = (noul = 1) => ({ type: "noul", noul });
for (const emotion of ["joy", "worried", "proud", "exasperated"]) test(`extended ${emotion} is opt-in and does not override the audio-owned mouth`, async () => {
  const {client,calls} = setup({emotion:selected(emotion)});
  assert.equal((await client.expression("synthetic")).emotion,null);
  assert.equal(Object.hasOwn(calls[0].body.questions.emotion.criteria,emotion),false);
  const result = await client.expression("synthetic",{nikePerformance:true});
  assert.equal(result.emotion,emotion);
  assert.equal(result.forceMouth,null);
  assert.equal(result.forceEyesClosed,null);
});
test("Nike listener classification does not treat user distress as assistant speech", async () => {
  const {client,calls} = setup({emotion:selected("soft"),performance:selected("reassure")});
  const result = await client.expression("失敗して落ち込んでいる", {nikePerformance:true,source:"user"});
  assert.equal(result.emotion,"soft");
  assert.deepEqual(calls[0].body.state,{userUtterance:"失敗して落ち込んでいる"});
  assert.match(calls[0].body.questions.emotion.instructions,/LISTENER/);
  assert.match(calls[0].body.questions.performance.instructions,/unfinished task/);
  await client.expression("同じ入力",{source:"user"});
  assert.deepEqual(calls[1].body.state,{responseText:"同じ入力"});
});
test("pride and dry exasperation do not raise celebration fists", async () => {
  for (const emotion of ["proud", "exasperated"]) {
    const {client} = setup({emotion:selected(emotion),performance:selected("celebrate")});
    assert.equal((await client.expression("test", {nikePerformance:true})).nikePerformance,"none");
  }
});
function setup(answers = {}, options = {}) {
  const calls = [];
  const client = new JevClient({
    getApiKey: () => "synthetic-test-key",
    fetchImpl: async (url, request) => {
      calls.push({ url, request, body: JSON.parse(request.body) });
      return { ok: true, text: async () => JSON.stringify({ answers }) };
    },
    ...options,
  });
  return { client, calls };
}
async function rejectsSafely(promise, message = "Jev request failed") {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("request uses the fixed HTTPS endpoint and places credentials only in authorization", async () => {
  const { client, calls } = setup({ action: selected("next"), explicit: explicit() });
  assert.equal(await client.media("Next track, please."), "next");
  assert.equal(calls.length, 1);
  const { url, request, body } = calls[0];
  assert.equal(url, ENDPOINT);
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer synthetic-test-key");
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(body.state, { userUtterance: "Next track, please." });
  assert.deepEqual(Object.keys(body.questions), ["action", "explicit"]);
  assert.equal(request.body.includes("synthetic-test-key"), false);
  assert.deepEqual(Object.keys(body.questions.action.criteria), ["none", "next", "previous", "pause", "play"]);
  assert.match(body.questions.action.instructions, /Quoted commands/);
  assert.match(body.questions.action.instructions, /negated commands/);
  assert.match(body.questions.action.instructions, /multiple actions/);
});

test("keys are read afresh and surrounding whitespace is normalized", async () => {
  let key = " first-key ";
  const { client, calls } = setup({}, { getApiKey: () => key });
  await client.ask({}, {});
  key = "second-key";
  await client.ask({}, {});
  assert.equal(calls[0].request.headers.Authorization, "Bearer first-key");
  assert.equal(calls[1].request.headers.Authorization, "Bearer second-key");
});

for (const key of [undefined, null, "", "  ", 42, {}]) {
  test(`missing or non-string key (${typeof key}, ${JSON.stringify(key)}) prevents fetching`, async () => {
    const { client, calls } = setup({}, { getApiKey: () => key });
    await rejectsSafely(client.ask({}, {}), "Jev API key is not configured");
    assert.equal(calls.length, 0);
  });
}
test("key provider exceptions cannot expose credentials", async () => {
  const { client, calls } = setup({}, { getApiKey: () => { throw Error("synthetic-secret"); } });
  await rejectsSafely(client.ask({}, {}));
  assert.equal(calls.length, 0);
});

test("choice accepts only typed, allowed values with finite numeric confidence", () => {
  assert.equal(choice(selected("happy", .75), ["happy"]), "happy");
  assert.equal(choice(selected("happy", 1), ["happy"]), "happy");
  for (const probability of [-1, 0, .74999, 1.001, NaN, Infinity, -Infinity, "1", null, undefined, true]) {
    assert.equal(choice(selected("happy", probability === undefined ? null : probability), ["happy"]), null);
  }
  for (const answer of [null, undefined, {}, [], selected("unknown"), { ...selected("happy"), type: "text" }, { type: "choice", choice: "happy" }]) {
    assert.equal(choice(answer, ["happy"]), null);
  }
  assert.equal(choice(selected("happy", .8), ["happy"], .85), null);
});

for (const action of ["next", "previous", "pause", "play"]) {
  test(`media accepts ${action} at both confidence thresholds`, async () => {
    assert.equal(await setup({ action: selected(action, .85), explicit: explicit(.9) }).client.media("synthetic request"), action);
  });
}
for (const [label, answers] of [
  ["none", { action: selected("none"), explicit: explicit() }],
  ["unknown action", { action: selected("stop"), explicit: explicit() }],
  ["low action confidence", { action: selected("next", .849999), explicit: explicit() }],
  ["missing explicit answer", { action: selected("next") }],
  ["wrong explicit type", { action: selected("next"), explicit: { type: "choice", noul: 1 } }],
  ["missing action", { explicit: explicit() }],
  ...[.899999, -1, 1.001, "1", null, true].map(value => [`invalid explicit ${JSON.stringify(value)}`, { action: selected("next"), explicit: explicit(value) }]),
]) {
  test(`media fails closed for ${label}`, async () => {
    assert.equal(await setup(answers).client.media("synthetic request"), null);
  });
}

test("next, pause, negated and quoted synthetic utterances stay request data; only parsed answers determine classifications", async () => {
  // Mocked replies exercise parsing, not model accuracy. Live verification is separate.
  for (const [text, action, score, expected] of [
    ["Skip to the next music track now.", "next", .98, "next"],
    ["Pause the music now.", "pause", .98, "pause"],
    ["Do not pause the music.", "none", .42, null],
    ['She said "skip to the next track" yesterday.', "none", .02, null],
  ]) {
    const { client, calls } = setup({ action: selected(action), explicit: explicit(score) });
    assert.equal(await client.media(text), expected);
    assert.deepEqual(calls[0].body.state, { userUtterance: text });
    assert.equal(calls.length, 1);
  }
});

test("only bounded utterance/response text is sent, without conversation or metadata", async () => {
  const { client, calls } = setup();
  await client.media("x".repeat(2500));
  await client.expression("y".repeat(1800));
  assert.deepEqual(calls[0].body.state, { userUtterance: "x".repeat(2000) });
  assert.deepEqual(calls[1].body.state, { responseText: "y".repeat(1200) });
});

test("expression validates both channels independently and fixes animation output bounds", async () => {
  const { client } = setup({ emotion: selected("soft", .75), gesture: selected("sad", .75), durationMs: 999999, forceMouth: 1 });
  assert.deepEqual(await client.expression("That sounds difficult."), {
    emotion: "soft", reaction: "sad", forceMouth: null, forceEyesClosed: null, durationMs: 4500, intensity: .65,
  });
  for (const [emotion, gesture, expectedEmotion, expectedReaction] of [
    [selected("sad"), selected("soft"), null, "neutral"],
    [selected("happy", .7499), selected("surprised"), null, "surprised"],
    [selected("thinking"), null, "thinking", "neutral"],
    [null, null, null, "neutral"],
  ]) {
    const result = await setup({ emotion, gesture }).client.expression("synthetic response");
    assert.equal(result.emotion, expectedEmotion);
    assert.equal(result.reaction, expectedReaction);
  }
  for (const value of ["neutral", "happy", "thinking", "surprised"]) {
    const result = await setup({ emotion: selected(value), gesture: selected(value) }).client.expression("text");
    assert.equal(result.emotion, value);
    assert.equal(result.reaction, value);
  }
});

for (const [label, body] of [
  ["non-JSON", "provider secret"], ["null", "null"], ["missing answers", "{}"],
  ["null answers", '{"answers":null}'], ["array answers", '{"answers":[]}'],
  ["string answers", '{"answers":"secret"}'], ["number answers", '{"answers":1}'],
  ["oversized", " ".repeat(65537)],
]) {
  test(`ask rejects ${label} with a sanitized failure`, async () => {
    const { client } = setup({}, { fetchImpl: async () => ({ ok: true, text: async () => body }) });
    await rejectsSafely(client.ask({}, {}));
  });
}
test("response size boundary is accepted", async () => {
  const body = '{"answers":{}}'.padEnd(65536, " ");
  const { client } = setup({}, { fetchImpl: async () => ({ ok: true, text: async () => body }) });
  assert.deepEqual(await client.ask({}, {}), {});
});
for (const status of [401, 403, 429, 500]) {
  test(`HTTP ${status} reveals only the status and does not read or retry the body`, async () => {
    let calls = 0;
    const { client } = setup({}, { fetchImpl: async () => {
      calls++;
      return { ok: false, status, text: async () => { assert.fail("Must not read error body"); } };
    } });
    await rejectsSafely(client.ask({}, {}), `Jev HTTP ${status}`);
    assert.equal(calls, 1);
  });
}
for (const thrown of [Error("synthetic-secret"), "synthetic-secret", null, undefined]) {
  test(`transport rejection (${typeof thrown}) is sanitized`, async () => {
    const { client } = setup({}, { fetchImpl: async () => { throw thrown; } });
    await rejectsSafely(client.ask({}, {}));
  });
}
test("body read errors are sanitized", async () => {
  const { client } = setup({}, { fetchImpl: async () => ({ ok: true, text: async () => { throw Error("synthetic-secret"); } }) });
  await rejectsSafely(client.ask({}, {}));
});

for (const duringBody of [false, true]) {
  test(`timeout aborts ${duringBody ? "body read" : "fetch"} without retry`, async () => {
    let calls = 0;
    let signal;
    const { client } = setup({}, { timeoutMs: 10, fetchImpl: async (_url, request) => {
      calls++;
      signal = request.signal;
      const pending = () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Error("synthetic-secret")), { once: true });
      });
      return duringBody ? { ok: true, text: pending } : pending();
    } });
    await rejectsSafely(client.ask({}, {}), "Jev request timed out");
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
  });
}

test("timer cleanup occurs on success/failure, and connectivity uses the longer timeout", async () => {
  const durations = [];
  const cleared = [];
  const sandbox = { module: { exports: {} }, AbortController, Buffer,
    setTimeout: (_callback, delay) => { durations.push(delay); return durations.length; },
    clearTimeout: id => cleared.push(id),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../lib/jev-client.cjs"), "utf8"), sandbox);
  let fail = false;
  const client = new sandbox.module.exports.JevClient({ getApiKey: () => "test", fetchImpl: async () => {
    if (fail) throw Error("secret");
    return { ok: true, text: async () => '{"answers":{"ready":{"type":"noul","noul":0.92}}}' };
  } });
  await client.ask({}, {});
  await client.test();
  fail = true;
  await rejectsSafely(client.ask({}, {}));
  assert.deepEqual(durations, [1500, 5000, 1500]);
  assert.deepEqual(cleared, [1, 2, 3]);
});

test("connectivity reports elapsed latency after parsing a typed ready answer", async () => {
  const { client, calls } = setup({ ready: explicit(.92) });
  const result = await client.test();
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
  assert.deepEqual(Object.keys(result), ["ok", "latencyMs"]);
  assert.equal(calls[0].body.state, "Connectivity test");
  assert.deepEqual(Object.keys(calls[0].body.questions), ["ready"]);
});
for (const ready of [undefined, null, {}, { type: "choice", noul: 1 }, explicit("1"), explicit(-1), explicit(1.1)]) {
  test(`connectivity does not report success for malformed ready (${JSON.stringify(ready)})`, async () => {
    await rejectsSafely(setup({ ready }).client.test());
  });
}
