// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { installStdioGuard } = require("../lib/stdio-guard.cjs");

test("partial recognition succeeds even when its diagnostic log fails", async () => {
  const main = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
  const result = { changed: true, text: "こんにちは", modelId: "test" };
  const ctx = vm.createContext({ app: { isPackaged: false },
    diagnosticLog: { write: () => { throw Object.assign(new Error("closed"), { code: "EPIPE" }); } },
    console: { info: () => { throw new Error("must not write to console"); } },
    streamingSpeechRecognition: { append: async () => result },
  });
  vm.runInContext(main.slice(main.indexOf("function debugStreamingSpeech("), main.indexOf("function registerIpc(")), ctx);
  assert.equal(await ctx.appendStreamingSpeechSession("test", {}), result);
});

test("synchronous EPIPE disables diagnostic writes without blocking callbacks", async () => {
  const stream = new EventEmitter(); let writes = 0, callbacks = 0;
  stream.write = () => { writes++; throw Object.assign(new Error("closed"), { code: "EPIPE" }); };
  installStdioGuard([stream]); installStdioGuard([stream]);
  assert.equal(stream.listenerCount("error"), 1);
  assert.equal(stream.write("log", () => callbacks++), true);
  stream.write("next", () => callbacks++);
  await new Promise(queueMicrotask);
  assert.equal(writes, 1); assert.equal(callbacks, 2);
});

test("asynchronous EPIPE is contained, other errors are still surfaced", () => {
  const stream = new EventEmitter(); let writes = 0;
  stream.write = () => { writes++; return true; };
  installStdioGuard([stream]);
  stream.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
  stream.write("after closure"); assert.equal(writes, 0);
  assert.throws(() => stream.emit("error", new Error("other failure")), /other failure/);
  const other = new EventEmitter(); other.write = () => { throw new Error("unexpected"); };
  installStdioGuard([other]);
  assert.throws(() => other.write("test"), /unexpected/);
});

test("process keeps running when its launcher's stdout pipe disappears", { timeout: 10000 }, async () => {
  const modulePath = require.resolve("../lib/stdio-guard.cjs");
  const child = spawn(process.execPath, ["-e", `
    require(${JSON.stringify(modulePath)}).installStdioGuard();
    process.on('message', () => {
      console.info('first partial recognition');
      setTimeout(() => {
        console.info('second partial recognition');
        process.send('survived', () => process.exit(0));
      }, 100);
    });
    process.send('ready');
  `], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let survived = false, stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("message", (message) => {
    if (message === "ready") { child.stdout.destroy(); child.send("write"); }
    if (message === "survived") survived = true;
  });
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
    assert.equal(code, 0, stderr); assert.equal(survived, true);
  } finally { if (child.exitCode === null) child.kill(); }
});
