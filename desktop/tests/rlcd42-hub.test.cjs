// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { Rlcd42Hub } = require("../lib/rlcd42-hub.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(callbacks = {}) {
  const hub = new Rlcd42Hub(callbacks);
  hub.enabled = true;
  hub.serial.enabled = true;
  hub.serial.connectionState = "ready";
  const usb = hub.serial.callbacks;
  const wifi = hub.wifi.inner.callbacks;
  const connectWifi = () => {
    hub.transportPreference = "wifi";
    hub.wifi.activeCandidate = {};
    hub.wifi.inner.connectionState = "ready";
  };
  return { hub, usb, wifi, connectWifi };
}

test("auto prefers USB, falls back to Wi-Fi, and explicit Wi-Fi disables USB", async () => {
  const { hub, connectWifi } = fixture();
  hub.hasPairing = true;
  hub.serialOptions = { port: "COM7" };
  const changes = [];
  hub.serial.configure = async (options) => {
    hub.serial.enabled = options.enabled;
    changes.push(options);
  };
  connectWifi();
  hub.transportPreference = "auto";
  assert.equal(hub.activeSource(), "usb");
  await hub.syncSerialPolicy();
  assert.equal(changes.length, 0);
  hub.serial.connectionState = "off";
  assert.equal(hub.activeSource(), "wifi");
  hub.serial.enabled = false;
  await hub.syncSerialPolicy();
  assert.equal(changes.at(-1).enabled, true);
  assert.equal(changes.at(-1).port, "COM7");
  hub.transportPreference = "wifi";
  await hub.syncSerialPolicy();
  assert.equal(changes.at(-1).enabled, false);
  hub.hasPairing = false;
  assert.equal(hub.shouldEnableSerial(), true);
  hub.enabled = false;
  assert.equal(hub.shouldEnableSerial(), false);
});

test("failed PCM admission releases the RLCD capture for an immediate retry", async () => {
  let fail = true;
  const { hub, usb } = fixture({ onPcmChunk: async () => { if (fail) throw new Error("recognizer failed"); } });
  await usb.onPttStart();
  await assert.rejects(usb.onPcmChunk(Buffer.alloc(2)), /recognizer failed/);
  assert.equal(hub.inputCapture, null);
  fail = false;
  await usb.onPttStart(); await usb.onPcmChunk(Buffer.alloc(2)); await usb.onPttEnd();
  assert.equal(hub.inputCapture, null);
});

test("standby capture telemetry remains diagnostic-only", async () => {
  const logs = [], updates = [];
  const { hub, wifi, connectWifi } = fixture({ logger: (...args) => logs.push(args), onCaptureStatus: (s) => updates.push(s) });
  connectWifi();
  hub.transportPreference = "auto";
  await wifi.onCaptureStatus({ rms: 42 });
  assert.equal(updates.length, 0);
  assert.equal(logs.at(-1)[1], "rlcd42-standby-capture-status");
  assert.equal(logs.at(-1)[2].source, "wifi");
});

for (const source of ["usb", "wifi"]) {
  test(`old PTT end preserves the newer ${source} capture and its disconnect cleanup`, async () => {
    const ending = deferred();
    let interrupts = 0;
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttEnd: () => ending.promise,
      onInterrupt: () => { interrupts += 1; },
    });
    await usb.onPttStart();
    const oldEnd = usb.onPttEnd();
    if (source === "wifi") connectWifi();
    await (source === "wifi" ? wifi : usb).onPttStart();
    ending.resolve();
    await oldEnd;
    assert.equal(hub.inputSource, source);
    if (source === "wifi") {
      hub.wifi.activeCandidate = null;
      wifi.onStatus();
    } else {
      hub.serial.connectionState = "error";
      usb.onStatus();
    }
    assert.equal(interrupts, 1);
    assert.equal(hub.inputSource, "");
  });

  test(`old startup rejection preserves a newer ${source} capture`, async () => {
    const starting = deferred();
    let starts = 0;
    const chunks = [];
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttStart: () => ++starts === 1 ? starting.promise : undefined,
      onPcmChunk: (chunk) => chunks.push(chunk),
    });
    const oldStart = usb.onPttStart();
    const rejected = assert.rejects(oldStart, /old startup failed/);
    await usb.onInterrupt();
    if (source === "wifi") connectWifi();
    const current = source === "wifi" ? wifi : usb;
    await current.onPttStart();
    starting.reject(new Error("old startup failed"));
    await rejected;
    assert.equal(hub.inputSource, source);
    const pcm = Buffer.alloc(2);
    await current.onPcmChunk(pcm);
    assert.deepEqual(chunks, [pcm]);
  });
}

test("PCM and end require an admitted capture, including after failed startup", async () => {
  const events = [];
  const { hub, usb } = fixture({
    onPttStart: () => { throw new Error("startup failed"); },
    onPcmChunk: () => events.push("pcm"),
    onPttEnd: () => events.push("end"),
  });
  await usb.onPcmChunk(Buffer.alloc(2));
  await usb.onPttEnd();
  await assert.rejects(usb.onPttStart(), /startup failed/);
  await usb.onPcmChunk(Buffer.alloc(2));
  await usb.onPttEnd();
  assert.equal(hub.inputSource, "");
  assert.deepEqual(events, []);
});

test("capture stays on USB when Wi-Fi becomes preferred", async () => {
  const events = [];
  const { hub, usb, wifi, connectWifi } = fixture({
    onPcmChunk: () => events.push("pcm"),
    onPttEnd: () => events.push("end"),
  });
  await usb.onPttStart();
  connectWifi();
  await assert.rejects(wifi.onPttStart(), /already capturing/);
  await wifi.onPcmChunk(Buffer.alloc(2));
  await wifi.onPttEnd();
  assert.equal(hub.inputSource, "usb");
  await usb.onPcmChunk(Buffer.alloc(2));
  await usb.onPttEnd();
  assert.deepEqual(events, ["pcm", "end"]);
  assert.equal(hub.inputSource, "");
});

test("duplicate start preserves the current capture and subsequent PCM", async () => {
  let starts = 0;
  const chunks = [];
  const { hub, usb } = fixture({
    onPttStart: () => { starts += 1; },
    onPcmChunk: (chunk) => chunks.push(chunk),
  });
  await usb.onPttStart();
  const owner = hub.inputCapture;
  await assert.rejects(usb.onPttStart(), /already capturing/);
  const pcm = Buffer.alloc(2);
  await usb.onPcmChunk(pcm);
  assert.equal(starts, 1);
  assert.equal(hub.inputCapture, owner);
  assert.equal(hub.inputSource, "usb");
  assert.deepEqual(chunks, [pcm]);
});

for (const source of ["usb", "wifi"]) {
  test(`rejected ${source} follow-up preserves recognition owner and can interrupt pending response`, async () => {
    const ending = deferred();
    const events = [];
    let starts = 0;
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttStart: () => {
        if (++starts > 1) throw new Error("still recognizing");
      },
      onPttEnd: () => { events.push("end"); return ending.promise; },
      onPcmChunk: () => events.push("pcm"),
      onInterrupt: () => events.push("interrupt"),
    });
    await usb.onPttStart();
    const owner = hub.inputCapture;
    const oldEnd = usb.onPttEnd();
    if (source === "wifi") connectWifi();
    const current = source === "wifi" ? wifi : usb;
    await assert.rejects(current.onPttStart(), /still recognizing/);
    assert.equal(hub.inputCapture, owner);
    assert.equal(hub.inputSource, "usb");
    // Rejected follow-up frames must not reopen or finish recognition again.
    await current.onPcmChunk(Buffer.alloc(2));
    await current.onPttEnd();
    await current.onInterrupt();
    assert.deepEqual(events, ["end", "interrupt"]);
    assert.equal(hub.inputCapture, null);
    ending.resolve();
    await oldEnd;
  });
}

test("follow-up startup rejection cannot restore a response that completed during validation", async () => {
  const ending = deferred();
  const starting = deferred();
  let starts = 0;
  const { hub, usb } = fixture({
    onPttStart: () => ++starts === 1 ? undefined : starting.promise,
    onPttEnd: () => ending.promise,
  });
  await usb.onPttStart();
  const oldEnd = usb.onPttEnd();
  const followUp = usb.onPttStart();
  const rejected = assert.rejects(followUp, /validation failed/);
  ending.resolve();
  await oldEnd;
  starting.reject(new Error("validation failed"));
  await rejected;
  assert.equal(hub.inputCapture, null);
  assert.equal(hub.inputSource, "");
});

test("interrupt during follow-up validation prevents restoration of the previous response owner", async () => {
  const ending = deferred();
  const starting = deferred();
  let starts = 0;
  let interrupts = 0;
  const { hub, usb } = fixture({
    onPttStart: () => ++starts === 1 ? undefined : starting.promise,
    onPttEnd: () => ending.promise,
    onInterrupt: () => { interrupts += 1; },
  });
  await usb.onPttStart();
  const oldEnd = usb.onPttEnd();
  const followUp = usb.onPttStart();
  const rejected = assert.rejects(followUp, /validation failed/);
  await usb.onInterrupt();
  starting.reject(new Error("validation failed"));
  await rejected;
  assert.equal(hub.inputCapture, null);
  assert.equal(interrupts, 1);
  ending.resolve();
  await oldEnd;
});

for (const teardown of ["disconnect", "disable"]) {
  test(`${teardown} cancels capture once and rejects input during teardown`, async () => {
    const cleanup = deferred();
    const events = [];
    const { hub, usb } = fixture({
      onPttStart: () => events.push("start"),
      onPcmChunk: () => events.push("pcm"),
      onPttEnd: () => events.push("end"),
      onInterrupt: () => { events.push("interrupt"); return cleanup.promise; },
    });
    await usb.onPttStart();
    const stopping = teardown === "disconnect" ? hub.disconnect() : hub.configure({ enabled: false });
    assert.equal(hub.inputSource, "");
    await usb.onPttStart();
    await usb.onPcmChunk(Buffer.alloc(2));
    await usb.onPttEnd();
    cleanup.resolve();
    await stopping;
    assert.deepEqual(events, ["start", "interrupt"]);
    assert.equal(hub.status().connected, false);
  });
}

test("disconnect invalidates capture before stale startup completes", async () => {
  const starting = deferred();
  const events = [];
  const { hub, usb } = fixture({
    onPttStart: () => starting.promise,
    onPcmChunk: () => events.push("pcm"),
    onPttEnd: () => events.push("end"),
    onInterrupt: () => events.push("interrupt"),
  });
  const oldStart = usb.onPttStart();
  await hub.disconnect();
  hub.enabled = true;
  hub.serial.connectionState = "ready";
  starting.resolve();
  await oldStart;
  await usb.onPcmChunk(Buffer.alloc(2));
  await usb.onPttEnd();
  assert.deepEqual(events, ["interrupt"]);
});

test("interrupt can stop playback without capture; disabled microphone cannot start capture", async () => {
  const events = [];
  const { hub, usb } = fixture({
    onPttStart: () => events.push("start"),
    onInterrupt: () => events.push("interrupt"),
  });
  hub.microphoneEnabled = false;
  await usb.onPttStart();
  await usb.onInterrupt();
  assert.deepEqual(events, ["interrupt"]);
});
