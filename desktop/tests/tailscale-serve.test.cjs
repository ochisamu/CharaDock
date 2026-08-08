// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { TailscaleServeManager, normalizePort, tailscaleUrl } = require("../lib/tailscale-serve.cjs");

test("Tailscale Serve ports stay bounded and URLs are extracted safely", () => {
  assert.equal(normalizePort(80), 1024);
  assert.equal(normalizePort(70000), 65535);
  assert.equal(normalizePort(443, 443, { privileged: true }), 443);
  assert.equal(tailscaleUrl("Available at https://charadock.example.ts.net"), "https://charadock.example.ts.net");
});

test("Tailscale Serve starts only when it will not overwrite another root proxy", async () => {
  const calls = [];
  const manager = new TailscaleServeManager({
    platform: "linux",
    exists: () => true,
    run: async (_executable, args) => {
      calls.push(args);
      if (args.join(" ") === "serve status") return { stdout: "No serve config" };
      return { stdout: "https://charadock.example.ts.net\n|--> http://127.0.0.1:42000" };
    },
  });
  const result = await manager.start({ localPort: 42000, httpsPort: 8443 });
  assert.equal(result.active, true);
  assert.equal(result.url, "https://charadock.example.ts.net");
  assert.deepEqual(calls[1], ["serve", "--bg", "--https=8443", "42000"]);

  const occupied = new TailscaleServeManager({
    platform: "linux",
    exists: () => true,
    run: async () => ({ stdout: "https://other.example.ts.net\n|--> http://127.0.0.1:9000" }),
  });
  await assert.rejects(occupied.start({ localPort: 42000 }), /既存設定を保護/);
});

test("Tailscale Serve stop targets only the configured HTTPS listener", async () => {
  let args;
  const manager = new TailscaleServeManager({ platform: "linux", exists: () => true, run: async (_executable, value) => { args = value; return { stdout: "Serve stopped" }; } });
  assert.equal((await manager.stop({ httpsPort: 8443 })).active, false);
  assert.deepEqual(args, ["serve", "--https=8443", "off"]);
});
