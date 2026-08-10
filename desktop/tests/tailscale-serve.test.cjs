// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TailscaleServeManager,
  normalizePort,
  preferredRemotePairingDestination,
  tailscalePairingUrl,
  tailscaleUrl,
} = require("../lib/tailscale-serve.cjs");

test("Tailscale Serve ports stay bounded and URLs are extracted safely", () => {
  assert.equal(normalizePort(80), 1024);
  assert.equal(normalizePort(70000), 65535);
  assert.equal(normalizePort(443, 443, { privileged: true }), 443);
  assert.equal(tailscaleUrl("Available at https://charadock.example.ts.net"), "https://charadock.example.ts.net");
});

test("Tailscale HTTPS becomes the preferred pairing destination without changing the token", () => {
  const token = "aBcDeFgHiJkLmNoPqRsTuVwXyZ_0123456789-ab";
  const lanPairingUrl = `http://192.168.1.8:41317/#token=${token}`;
  assert.equal(
    tailscalePairingUrl("https://charadock.example.ts.net:8443", lanPairingUrl),
    `https://charadock.example.ts.net:8443/#token=${token}`,
  );
  assert.deepEqual(preferredRemotePairingDestination({
    lanUrl: "http://192.168.1.8:41317",
    lanPairingUrl,
    tailscaleActive: true,
    tailscaleBaseUrl: "https://charadock.example.ts.net",
  }), {
    url: "https://charadock.example.ts.net",
    pairingUrl: `https://charadock.example.ts.net/#token=${token}`,
    transport: "tailscale",
    secure: true,
  });
});

test("pairing falls back to LAN when the Tailscale destination is inactive or untrusted", () => {
  const lan = {
    lanUrl: "http://192.168.1.8:41317",
    lanPairingUrl: "http://192.168.1.8:41317/#token=aBcDeFgHiJkLmNoPqRsTuVwXyZ_0123456789-ab",
  };
  assert.equal(preferredRemotePairingDestination({ ...lan, tailscaleActive: false, tailscaleBaseUrl: "https://charadock.example.ts.net" }).transport, "lan");
  assert.equal(preferredRemotePairingDestination({ ...lan, tailscaleActive: true, tailscaleBaseUrl: "https://attacker.example.com" }).pairingUrl, lan.lanPairingUrl);
  assert.equal(tailscalePairingUrl("https://user@example.ts.net", lan.lanPairingUrl), "");
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
