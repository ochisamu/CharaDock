// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { AtomEchoHub } = require("../lib/atom-echo-hub.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(callbacks = {}) {
  const hub = new AtomEchoHub(callbacks);
  hub.enabled = true;
  hub.serial.enabled = true;
  hub.serial.connectionState = "ready";
  return {
    hub,
    usb: hub.serial.callbacks,
    wifi: hub.wifi.callbacks,
    connectWifi() {
      hub.wifi.activeCandidate = { socket: {} };
      hub.wifi.connectionState = "ready";
    },
  };
}

for (const source of ["usb", "wifi"]) {
  test(`old ATOM end preserves new ${source} capture and its disconnect cleanup`, async () => {
    const end = deferred();
    const events = [];
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttEnd: () => end.promise,
      onPcmChunk: () => events.push("pcm"),
      onInterrupt: () => events.push("interrupt"),
    });
    await usb.onPttStart();
    const oldEnd = usb.onPttEnd();
    if (source === "wifi") connectWifi();
    const current = source === "wifi" ? wifi : usb;
    await current.onPttStart();
    end.resolve();
    await oldEnd;
    await current.onPcmChunk(Buffer.alloc(2));
    assert.equal(hub.inputSource, source);
    hub[source === "wifi" ? "wifi" : "serial"].connectionState = "error";
    current.onStatus();
    current.onStatus();
    assert.deepEqual(events, ["pcm", "interrupt"]);
    assert.equal(hub.inputCapture, null);
  });

  test(`ATOM rejects ${source} duplicate without stealing USB recording`, async () => {
    let starts = 0;
    const chunks = [];
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttStart: () => { starts += 1; },
      onPcmChunk: (chunk) => chunks.push(chunk),
    });
    await usb.onPttStart();
    const owner = hub.inputCapture;
    if (source === "wifi") connectWifi();
    await assert.rejects((source === "wifi" ? wifi : usb).onPttStart(), /already capturing/);
    const pcm = Buffer.alloc(2);
    await wifi.onPcmChunk(pcm);
    await usb.onPcmChunk(pcm);
    assert.equal(hub.inputCapture, owner);
    assert.equal(starts, 1);
    assert.deepEqual(chunks, [pcm]);
  });

  test(`rejected ATOM ${source} follow-up preserves pending response interruption`, async () => {
    const end = deferred();
    const events = [];
    let starts = 0;
    const { hub, usb, wifi, connectWifi } = fixture({
      onPttStart: () => { if (++starts > 1) throw new Error("still recognizing"); },
      onPttEnd: () => { events.push("end"); return end.promise; },
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
    await current.onPcmChunk(Buffer.alloc(2));
    await current.onPttEnd();
    await current.onInterrupt();
    assert.deepEqual(events, ["end", "interrupt"]);
    end.resolve();
    await oldEnd;
    assert.equal(hub.inputCapture, null);
  });
}

for (const completion of ["response", "interrupt"]) {
  test(`ATOM rejected validation cannot resurrect owner after ${completion}`, async () => {
    const end = deferred();
    const start = deferred();
    let starts = 0;
    const { hub, usb } = fixture({
      onPttStart: () => ++starts === 1 ? undefined : start.promise,
      onPttEnd: () => end.promise,
    });
    await usb.onPttStart();
    const oldEnd = usb.onPttEnd();
    const rejected = assert.rejects(usb.onPttStart(), /validation failed/);
    if (completion === "response") {
      end.resolve();
      await oldEnd;
    } else await usb.onInterrupt();
    start.reject(new Error("validation failed"));
    await rejected;
    assert.equal(hub.inputCapture, null);
    end.resolve();
    await oldEnd;
  });
}

test("ATOM failed first start rejects orphan PCM and end", async () => {
  const events = [];
  const { hub, usb } = fixture({
    onPttStart: () => { throw new Error("start failed"); },
    onPcmChunk: () => events.push("pcm"),
    onPttEnd: () => events.push("end"),
  });
  await assert.rejects(usb.onPttStart(), /start failed/);
  await usb.onPcmChunk(Buffer.alloc(2));
  await usb.onPttEnd();
  assert.equal(hub.inputSource, "");
  assert.deepEqual(events, []);
});

for (const action of ["disconnect", "disable"]) {
  test(`ATOM ${action} cancels startup once and rejects late input after reconnect`, async () => {
    const start = deferred();
    const events = [];
    const { hub, usb } = fixture({
      onPttStart: () => { events.push("start"); return start.promise; },
      onPcmChunk: () => events.push("pcm"),
      onPttEnd: () => events.push("end"),
      onInterrupt: () => events.push("interrupt"),
    });
    const oldStart = usb.onPttStart();
    if (action === "disconnect") await hub.disconnect();
    else await hub.configure({ enabled: false });
    await usb.onPttStart();
    hub.enabled = true;
    hub.serial.connectionState = "ready";
    start.resolve();
    await oldStart;
    await usb.onPcmChunk(Buffer.alloc(2));
    await usb.onPttEnd();
    assert.deepEqual(events, ["start", "interrupt"]);
    assert.equal(hub.inputCapture, null);
  });
}

test("ATOM late startup rejection cannot clear a replacement after interrupt", async () => {
  const start = deferred();
  let starts = 0;
  const { hub, usb } = fixture({ onPttStart: () => ++starts === 1 ? start.promise : undefined });
  const rejected = assert.rejects(usb.onPttStart(), /start failed/);
  await usb.onInterrupt();
  await usb.onPttStart();
  const owner = hub.inputCapture;
  start.reject(new Error("start failed"));
  await rejected;
  assert.equal(hub.inputCapture, owner);
  assert.equal(hub.inputSource, "usb");
});

test("ATOM can interrupt playback without a recording", async () => {
  let interrupts = 0;
  const { usb } = fixture({ onInterrupt: () => { interrupts += 1; } });
  await usb.onInterrupt();
  assert.equal(interrupts, 1);
});
