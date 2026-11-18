// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { HaruServer } = require("../lib/haru-server.cjs");

function fixture() {
  const workers = [];
  const server = new HaruServer("haru-test-models", {
    spawnImpl(_command, args) {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), args });
      child.kill = () => { child.killed = true; child.emit("exit"); };
      workers.push(child);
      return child;
    },
  });
  server.models = {
    status: () => ({ installed: true }),
    installedPaths: () => ({ executablePath: "speech.exe", modelPath: "Haru-4B-Q8_0.gguf" }),
  };
  return { server, workers };
}

test("Haru accepts only a ready loopback listener and shares one engine across opens", async () => {
  const { server, workers } = fixture();
  const started = server.start({ language: "ja", name: "コハク" });
  assert.equal(server.start(), started);
  workers[0].stderr.write("Ready at http://0.0.0.0:43210/\n");
  workers[0].stderr.write("Ready at http://127.0.0.1:");
  workers[0].stderr.write("42310/\n");
  assert.equal(await started, "http://127.0.0.1:42310");
  assert.equal(workers.length, 1);
  assert.ok(workers[0].args.includes("--name=コハク"));
  server.stop();
  assert.equal(workers[0].killed, true);
});

test("Stopping an unfinished Haru launch releases it for a fresh start", async () => {
  const { server, workers } = fixture();
  const started = server.start();
  server.stop();
  await assert.rejects(started, /stopped/);
  const next = server.start();
  workers[0].stderr.write("Ready at http://127.0.0.1:42310/\n");
  workers[1].stdout.write("Ready at http://127.0.0.1:43210/\n");
  assert.equal(await next, "http://127.0.0.1:43210");
  server.stop();
});
