// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { OpenAIClient, responseOutputText } = require("../backend/openai-client.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function jsonResponse(id = "resp_ok", text = "reply", extra = {}) {
  return { ok: true, json: async () => ({ id, output_text: text, ...extra }) };
}

function sse(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function streamResponse(wire, { chunkSize, close = true, cancel = () => {} } = {}) {
  const bytes = new TextEncoder().encode(wire);
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        const size = chunkSize || bytes.length || 1;
        for (let offset = 0; offset < bytes.length; offset += size) {
          controller.enqueue(bytes.slice(offset, offset + size));
        }
        if (close) controller.close();
      },
      cancel,
    }),
  };
}

const deltaEvent = { type: "response.output_text.delta", delta: "partial" };
const completedEvent = { type: "response.completed", response: { id: "resp_stream", status: "completed" } };

test("responseOutputText supports SDK helper and raw Responses API output", () => {
  assert.equal(responseOutputText({ output_text: " hello " }), "hello");
  assert.equal(responseOutputText({
    output: [{ type: "message", content: [{ type: "output_text", text: "こん" }, { type: "output_text", text: "にちは" }] }],
  }), "こん\nにちは");
});

test("OpenAIClient sends API key only in the main-process request and continues response state", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ id: `resp_${calls.length}`, output_text: `reply ${calls.length}` }),
    };
  };
  try {
    const client = new OpenAIClient();
    assert.equal((await client.sendMessage({ apiKey: "sk-secret", model: "test-model", message: "hello" })).text, "reply 1");
    assert.equal((await client.sendMessage({ apiKey: "sk-secret", model: "test-model", message: "again" })).text, "reply 2");
    assert.equal(calls[0].options.headers.Authorization, "Bearer sk-secret");
    assert.equal(calls[0].body.model, "test-model");
    assert.equal(calls[0].body.previous_response_id, undefined);
    assert.equal(calls[1].body.previous_response_id, "resp_1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenAIClient streams Responses API text deltas", async () => {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  global.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"こん"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"にちは"}\n\ndata: {"type":"response.completed","response":{"id":"resp_stream"}}\n\n'));
          controller.close();
        },
      }),
    };
  };
  try {
    const deltas = [];
    const client = new OpenAIClient();
    const result = await client.sendMessage({
      apiKey: "sk-secret",
      model: "test-model",
      message: "hello",
      instructions: "やさしく答える",
      onDelta: (delta, text) => deltas.push([delta, text]),
    });
    assert.equal(result.text, "こんにちは");
    assert.equal(result.responseId, "resp_stream");
    assert.deepEqual(deltas, [["こん", "こん"], ["にちは", "こんにちは"]]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("OpenAIClient can interrupt an active response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  try {
    const client = new OpenAIClient();
    const pending = client.sendMessage({ apiKey: "sk-secret", model: "test-model", message: "hello" });
    await Promise.resolve();
    assert.equal(await client.interruptActiveTurn(), true);
    await assert.rejects(pending, /中断/);
    assert.equal(await client.interruptActiveTurn(), false);
  } finally {
    global.fetch = originalFetch;
  }
});

for (const action of ["reset", "interruptActiveTurn"]) {
  for (const phase of ["fetch", "json"]) {
    test(`OpenAIClient ${action} rejects a late ${phase} result and protects conversation history`, async (t) => {
      const gate = deferred();
      const entered = deferred();
      const calls = [];
      t.mock.method(global, "fetch", async (_url, options) => {
        calls.push(options);
        if (calls.length !== 1) return jsonResponse("resp_new");
        if (phase === "fetch") {
          entered.resolve();
          await gate.promise; // Deliberately ignore abort, as a settled transport can do.
          return jsonResponse("resp_stale");
        }
        return { ok: true, json: async () => {
          entered.resolve();
          await gate.promise;
          return { id: "resp_stale", output_text: "stale" };
        } };
      });
      const client = new OpenAIClient();
      client.previousResponseId = "resp_prior";
      assert.equal(client.hasActiveTurn(), false);
      const pending = client.sendMessage({ apiKey: "test", message: "old" });
      const outcome = pending.then((value) => ({ value }), (error) => ({ error }));
      await entered.promise;
      try {
        assert.equal(client.hasActiveTurn(), true);
        await client[action]();
        assert.equal(calls[0].signal.aborted, true);
        if (action === "reset") {
          assert.equal(client.hasActiveTurn(), false);
          await client.sendMessage({ apiKey: "test", message: "new" });
          assert.equal(JSON.parse(calls[1].body).previous_response_id, undefined);
        } else {
          assert.equal(client.hasActiveTurn(), true);
          await assert.rejects(client.sendMessage({ apiKey: "test", message: "too soon" }), /進行中/);
          assert.equal(calls.length, 1);
        }
      } finally {
        gate.resolve();
      }
      const result = await outcome;
      assert.match(result.error?.message || "unexpected success", /中断/);
      assert.equal(client.hasActiveTurn(), false);
      if (action === "interruptActiveTurn") {
        assert.equal(client.previousResponseId, "resp_prior");
        await client.sendMessage({ apiKey: "test", message: "new" });
        assert.equal(JSON.parse(calls[1].body).previous_response_id, "resp_prior");
      }
      assert.equal(client.previousResponseId, "resp_new");
      assert.equal(await client.interruptActiveTurn(), false);
    });
  }

  test(`OpenAIClient ${action} inside a delta suppresses remaining buffered events`, async (t) => {
    t.mock.method(global, "fetch", async () => streamResponse(
      sse(deltaEvent) + sse({ ...deltaEvent, delta: " stale" }) + sse(completedEvent),
    ));
    const client = new OpenAIClient();
    client.previousResponseId = "resp_prior";
    const deltas = [];
    await assert.rejects(client.sendMessage({
      apiKey: "test",
      onDelta(delta) {
        deltas.push(delta);
        void client[action]();
      },
    }), /中断/);
    assert.deepEqual(deltas, ["partial"]);
    assert.equal(client.previousResponseId, action === "reset" ? null : "resp_prior");
  });
}

test("OpenAIClient rejects concurrent sends without losing the active request", async (t) => {
  const gate = deferred();
  const calls = [];
  t.mock.method(global, "fetch", async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) await gate.promise;
    return jsonResponse();
  });
  const client = new OpenAIClient();
  const pending = client.sendMessage({ apiKey: "test" });
  const outcome = pending.then((value) => ({ value }), (error) => ({ error }));
  try {
    await assert.rejects(client.sendMessage({ apiKey: "test" }), /進行中/);
    assert.equal(calls.length, 1);
    assert.equal(await client.interruptActiveTurn(), true);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(await client.interruptActiveTurn(), false);
    assert.equal(client.hasActiveTurn(), true);
  } finally {
    gate.resolve();
    await outcome;
  }
  assert.match((await outcome).error?.message || "unexpected success", /中断/);
  assert.equal(client.hasActiveTurn(), false);
  assert.equal((await client.sendMessage({ apiKey: "test" })).responseId, "resp_ok");
});

test("OpenAIClient old cleanup cannot clear the replacement turn's controller", async (t) => {
  const gates = [deferred(), deferred()];
  const calls = [];
  t.mock.method(global, "fetch", async (_url, options) => {
    const index = calls.push(options) - 1;
    await gates[index].promise;
    return jsonResponse(`resp_${index}`);
  });
  const client = new OpenAIClient();
  const old = client.sendMessage({ apiKey: "test" }).catch((error) => error);
  client.reset();
  const replacement = client.sendMessage({ apiKey: "test" }).catch((error) => error);
  gates[0].resolve();
  await old;
  try {
    assert.equal(client.hasActiveTurn(), true);
    assert.equal(await client.interruptActiveTurn(), true);
    assert.equal(calls[1].signal.aborted, true);
  } finally {
    gates[1].resolve();
    await replacement;
  }
  assert.equal(client.previousResponseId, null);
  assert.equal(client.hasActiveTurn(), false);
});

for (const [name, ending, error] of [
  ["EOF without completion", "", /完了/],
  ["DONE without completion", "data: [DONE]\n\n", /完了/],
  ["incomplete response", sse({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }), /max_output_tokens/],
  ["failed response", sse({ type: "response.failed", response: { error: { message: "server failed" } } }), /server failed/],
  ["error event", sse({ type: "error", message: "stream failed" }), /stream failed/],
  ["malformed event before completion", 'data: {broken}\n\n' + sse(completedEvent), /ストリーム/],
]) {
  test(`OpenAIClient rejects ${name} and keeps the last successful response`, async (t) => {
    const requests = [];
    t.mock.method(global, "fetch", async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? streamResponse(sse(deltaEvent) + ending) : jsonResponse("resp_recovery");
    });
    const client = new OpenAIClient();
    client.previousResponseId = "resp_prior";
    await assert.rejects(client.sendMessage({ apiKey: "test", onDelta() {} }), error);
    assert.equal(client.previousResponseId, "resp_prior");
    assert.equal(await client.interruptActiveTurn(), false);
    await client.sendMessage({ apiKey: "test" });
    assert.equal(requests[1].previous_response_id, "resp_prior");
  });
}

test("OpenAIClient handles split UTF-8, CRLF, multiline data, and a final unterminated event", async (t) => {
  const wire = ': heartbeat\r\n\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"こんにちは 🌸"}\r\n\r\n'
    + sse(completedEvent).trimEnd();
  t.mock.method(global, "fetch", async () => streamResponse(wire, { chunkSize: 1 }));
  const client = new OpenAIClient();
  const deltas = [];
  assert.deepEqual(await client.sendMessage({ apiKey: "test", onDelta: (delta) => deltas.push(delta) }), {
    text: "こんにちは 🌸", provider: "openai", responseId: "resp_stream",
  });
  assert.deepEqual(deltas, ["こんにちは 🌸"]);
  assert.equal(client.previousResponseId, "resp_stream");
});

test("OpenAIClient releases and cancels the reader when a delta callback fails", async (t) => {
  let cancelled = false;
  const response = streamResponse(sse(deltaEvent), { close: false, cancel() { cancelled = true; } });
  t.mock.method(global, "fetch", async () => response);
  const client = new OpenAIClient();
  client.previousResponseId = "resp_prior";
  const error = new Error("callback failed");
  await assert.rejects(client.sendMessage({ apiKey: "test", onDelta() { throw error; } }), (actual) => actual === error);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
  assert.equal(client.previousResponseId, "resp_prior");
});

for (const status of ["incomplete", "failed"]) {
  test(`OpenAIClient rejects JSON status ${status} even with partial text`, async (t) => {
    t.mock.method(global, "fetch", async () => jsonResponse("resp_bad", "partial", {
      status, incomplete_details: { reason: "max_output_tokens" }, error: { message: "response failed" },
    }));
    const client = new OpenAIClient();
    client.previousResponseId = "resp_prior";
    await assert.rejects(client.sendMessage({ apiKey: "test" }));
    assert.equal(client.previousResponseId, "resp_prior");
  });
}

for (const action of ["reset", "interruptActiveTurn", "timeout"]) {
  test(`OpenAIClient ${action} unblocks a pending stream read and retains the cancellation reason`, async (t) => {
    if (action === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
    let cancelled = false;
    const delivered = deferred();
    const response = streamResponse(sse(deltaEvent), { close: false, cancel() { cancelled = true; } });
    t.mock.method(global, "fetch", async () => response);
    const client = new OpenAIClient();
    client.previousResponseId = "resp_prior";
    const deltas = [];
    const pending = client.sendMessage({ apiKey: "test", onDelta(delta) {
      deltas.push(delta);
      delivered.resolve();
    } });
    const rejection = assert.rejects(pending, action === "timeout" ? /タイムアウト/ : /中断/);
    await delivered.promise;
    assert.equal(client.hasActiveTurn(), true);
    if (action === "timeout") t.mock.timers.tick(120_000);
    else void client[action]();
    // Interrupt/timeout keep the slot until the asynchronous read settles.
    assert.equal(client.hasActiveTurn(), action !== "reset");
    await rejection;
    assert.deepEqual(deltas, ["partial"]);
    assert.equal(cancelled, true);
    assert.equal(response.body.locked, false);
    assert.equal(client.hasActiveTurn(), false);
    assert.equal(client.previousResponseId, action === "reset" ? null : "resp_prior");
  });
}

for (const [name, terminal, error] of [
  ["completion", completedEvent, null],
  ["failure", { type: "response.failed", response: { error: { message: "terminal failure" } } }, /terminal failure/],
  ["incomplete", { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, /max_output_tokens/],
]) {
  test(`OpenAIClient settles on stream ${name} without waiting for EOF`, async (t) => {
    let streamController;
    let cancelled = false;
    const response = { ok: true, body: new ReadableStream({
      start(controller) {
        streamController = controller;
        controller.enqueue(new TextEncoder().encode(sse(deltaEvent) + sse(terminal)));
      },
      cancel() { cancelled = true; },
    }) };
    t.mock.method(global, "fetch", async () => response);
    const client = new OpenAIClient();
    client.previousResponseId = "resp_prior";
    let result;
    const pending = client.sendMessage({ apiKey: "test", onDelta() {} })
      .then((value) => { result = { value }; }, (failure) => { result = { error: failure }; });
    // Allow queued stream microtasks to run, while the transport stays open.
    await new Promise(setImmediate);
    try {
      assert.ok(result, "terminal event must settle the turn before transport EOF");
      if (error) {
        assert.match(result.error?.message || "unexpected success", error);
        assert.equal(client.previousResponseId, "resp_prior");
      } else {
        assert.equal(result.value?.responseId, "resp_stream");
        assert.equal(client.previousResponseId, "resp_stream");
      }
      assert.equal(cancelled, true);
      assert.equal(response.body.locked, false);
      assert.equal(client.hasActiveTurn(), false);
    } finally {
      if (!cancelled) streamController.close();
      await pending;
    }
  });
}

test("OpenAIClient rejects a transport failure after streamed text and releases ownership", async (t) => {
  let streamController;
  const response = { ok: true, body: new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(new TextEncoder().encode(sse(deltaEvent)));
    },
  }) };
  t.mock.method(global, "fetch", async () => response);
  const client = new OpenAIClient();
  client.previousResponseId = "resp_prior";
  const networkError = new Error("connection lost");
  await assert.rejects(client.sendMessage({ apiKey: "test", onDelta() {
    streamController.error(networkError);
  } }), (error) => error === networkError);
  assert.equal(client.previousResponseId, "resp_prior");
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(response.body.locked, false);
});

test("OpenAIClient timeout rejects a late JSON body and prevents history advancement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred();
  const gate = deferred();
  t.mock.method(global, "fetch", async () => ({ ok: true, json: async () => {
    entered.resolve();
    await gate.promise;
    return { id: "resp_late", output_text: "late" };
  } }));
  const client = new OpenAIClient();
  client.previousResponseId = "resp_prior";
  const rejection = assert.rejects(client.sendMessage({ apiKey: "test" }), /タイムアウト/);
  await entered.promise;
  try {
    t.mock.timers.tick(120_000);
    assert.equal(client.hasActiveTurn(), true);
    await assert.rejects(client.sendMessage({ apiKey: "test" }), /進行中/);
  } finally {
    gate.resolve();
    await rejection;
  }
  assert.equal(client.previousResponseId, "resp_prior");
  assert.equal(client.hasActiveTurn(), false);
});

test("OpenAIClient HTTP errors retain status and conversation state for a retry", async (t) => {
  let calls = 0;
  t.mock.method(global, "fetch", async () => ++calls === 1
    ? { ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) }
    : jsonResponse("resp_retry"));
  const client = new OpenAIClient();
  client.previousResponseId = "resp_prior";
  await assert.rejects(client.sendMessage({ apiKey: "test" }), { status: 429, message: "rate limited" });
  assert.equal(client.previousResponseId, "resp_prior");
  assert.equal(client.hasActiveTurn(), false);
  assert.equal((await client.sendMessage({ apiKey: "test" })).responseId, "resp_retry");
  assert.equal(client.hasActiveTurn(), false);
});
