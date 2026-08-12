// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const { WorkSlmFileCache } = require("../lib/work-slm-file-cache.cjs");
const { SIDECAR_CHANNEL, WorkSlmSidecarClient } = require("../lib/work-slm-sidecar-client.cjs");

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.connected = true;
  child.sent = [];
  child.send = (message) => child.sent.push(message);
  child.killed = false;
  child.kill = () => { child.killed = true; child.emit("exit", 0, null); };
  return child;
}

test("Work SLM sidecar keeps inference in a separate Electron process", async () => {
  const child = fakeChild();
  let spawnArgs = null;
  const progress = [];
  const client = new WorkSlmSidecarClient({
    executablePath: "electron.exe",
    appPath: "C:\\CharaDock",
    userDataPath: "C:\\SLM",
    spawnImpl: (_executable, args) => { spawnArgs = args; return child; },
    onProgress: (value) => progress.push(value),
  });
  const started = client.start();
  child.emit("message", { channel: SIDECAR_CHANNEL, event: "ready", payload: { webgpuAvailable: true } });
  assert.deepEqual(await started, { webgpuAvailable: true });
  assert.deepEqual(spawnArgs, ["C:\\CharaDock", "--work-slm-sidecar", "--work-slm-user-data", "C:\\SLM"]);

  const requested = client.request("rewrite", { sourceText: "確認中" });
  await new Promise((resolve) => setImmediate(resolve));
  const requestId = child.sent.find((message) => message.event === "request")?.payload?.requestId;
  assert.ok(requestId);
  child.emit("message", { channel: SIDECAR_CHANNEL, event: "progress", payload: { status: "loading", progress: 50 } });
  child.emit("message", { channel: SIDECAR_CHANNEL, event: "result", payload: { requestId, text: "確認しているよ", emotion: "thinking" } });
  assert.equal((await requested).text, "確認しているよ");
  assert.deepEqual(progress, [{ status: "loading", progress: 50 }]);
  client.stop();
});

test("Work SLM filesystem cache persists streamed model responses outside Chromium profile data", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-work-slm-cache-"));
  try {
    const cache = new WorkSlmFileCache(directory);
    const url = "https://huggingface.co/example/model/resolve/main/model.onnx";
    const progress = [];
    const response = new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream", "Content-Length": "4" },
    });
    await cache.put(url, response, (value) => progress.push(value));
    assert.equal(response.bodyUsed, true);
    const cached = await cache.match(url);
    assert.deepEqual([...new Uint8Array(await cached.arrayBuffer())], [1, 2, 3, 4]);
    assert.equal(cached.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(progress.at(-1), { progress: 100, loaded: 4, total: 4 });
    assert.equal(fs.readdirSync(path.join(directory, "files")).filter((name) => name.endsWith(".bin")).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Work SLM filesystem cache discards truncated entries", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-work-slm-cache-"));
  try {
    const cache = new WorkSlmFileCache(directory);
    const url = "https://huggingface.co/example/model/resolve/main/config.json";
    await cache.put(url, new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Length": "4" },
    }));
    const target = cache.paths(url);
    fs.truncateSync(target.data, 0);
    assert.equal(await cache.match(url), undefined);
    assert.equal(fs.existsSync(target.data), false);
    assert.equal(fs.existsSync(target.meta), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Work SLM filesystem cache accepts responses without a content length", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-work-slm-cache-"));
  try {
    const cache = new WorkSlmFileCache(directory);
    const url = "https://huggingface.co/example/model/resolve/main/tokenizer.json";
    await cache.put(url, new Response(new Uint8Array([5, 6, 7]), { status: 200 }));
    assert.deepEqual([...new Uint8Array(await (await cache.match(url)).arrayBuffer())], [5, 6, 7]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
