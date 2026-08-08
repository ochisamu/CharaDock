// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { RemoteCompanionServer, isPrivateIpv4, safeErrorMessage, sanitizedDeviceName } = require("../lib/remote-server.cjs");

test("private address validation never treats public or wildcard addresses as LAN", () => {
  for (const address of ["10.2.3.4", "172.16.0.1", "172.31.255.254", "192.168.1.9", "169.254.2.1"]) assert.equal(isPrivateIpv4(address), true);
  for (const address of ["0.0.0.0", "8.8.8.8", "172.32.0.1", "127.0.0.1", "::1", "not-an-ip"]) assert.equal(isPrivateIpv4(address), false);
  assert.equal(isPrivateIpv4("127.0.0.1", { allowLoopback: true }), true);
});

test("remote server requires pairing, same-origin CSRF, and strips token from the cookie session", async (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-remote-test-"));
  fs.writeFileSync(path.join(rootDir, "index.html"), "<!doctype html><title>Link</title>");
  fs.writeFileSync(path.join(rootDir, "remote.css"), "body{}");
  fs.writeFileSync(path.join(rootDir, "remote.js"), "void 0;");
  const messages = [];
  const settings = [];
  const server = new RemoteCompanionServer({
    rootDir,
    address: "127.0.0.1",
    port: 0,
    allowLoopbackForTests: true,
    callbacks: {
      getState: () => ({ character: { name: "Kohaku" }, conversationHistory: [] }),
      sendMessage: (payload) => { messages.push(payload); return { ok: true }; },
      setSettings: (payload) => { settings.push(payload); return { character: { name: "Towa" } }; },
      interrupt: () => ({ interrupted: true }),
    },
  });
  context.after(async () => { await server.stop(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  await server.start();
  const origin = server.origin();

  const unauthenticated = await fetch(`${origin}/api/state`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("access-control-allow-origin"), null);

  const paired = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token: new URL(server.pairingUrl()).hash.slice("#token=".length), deviceName: "My iPhone" }),
  });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get("set-cookie").split(";")[0];
  const payload = await paired.json();
  assert.ok(payload.csrfToken.length >= 24);
  assert.equal(cookie.includes(server.pairingToken), false);
  assert.equal(server.status().devices[0].name, "My iPhone");
  assert.equal(server.status().devices[0].address, "127.0.0.1");

  const missingCsrf = await fetch(`${origin}/api/message`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify({ message: "hello" }),
  });
  assert.equal(missingCsrf.status, 403);

  const sent = await fetch(`${origin}/api/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CharaDock-CSRF": payload.csrfToken },
    body: JSON.stringify({ message: "hello", mode: "chat" }),
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(messages, [{ message: "hello", mode: "chat" }]);

  const configured = await fetch(`${origin}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CharaDock-CSRF": payload.csrfToken },
    body: JSON.stringify({ characterId: "towa-avatar", pcAudioEnabled: false }),
  });
  assert.equal(configured.status, 200);
  assert.deepEqual(settings, [{ characterId: "towa-avatar", pcAudioEnabled: false }]);
  assert.equal((await configured.json()).state.character.name, "Towa");

  assert.equal(server.revokeSession(server.status().devices[0].id), true);
  assert.equal(server.status().devices.length, 0);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 401);
});

test("server refuses to bind to wildcard and public addresses", async () => {
  for (const address of ["0.0.0.0", "8.8.8.8"]) {
    const server = new RemoteCompanionServer({ rootDir: __dirname, address, port: 0 });
    await assert.rejects(server.start(), /private LAN IPv4/);
  }
});

test("remote errors never expose local filesystem paths", () => {
  assert.equal(safeErrorMessage(Object.assign(new Error("ENOENT: C:\\Users\\person\\secret.txt"), { code: "ENOENT" })), "The request could not be completed.");
  assert.equal(safeErrorMessage(new Error("Could not inspect /home/person/private/file.txt")), "Could not inspect [local path]");
});

test("remote device labels are bounded and fall back to a coarse browser family", () => {
  assert.equal(sanitizedDeviceName("  Living room\nphone  "), "Living room phone");
  assert.equal(sanitizedDeviceName("", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
  assert.equal(sanitizedDeviceName("", "Mozilla/5.0 (Linux; Android 15; Pixel) Mobile"), "Android phone");
});

test("the packaged phone surface loads locally with microphone and camera disabled", async (context) => {
  const server = new RemoteCompanionServer({
    rootDir: path.resolve(__dirname, "..", "remote"),
    address: "127.0.0.1",
    port: 0,
    allowLoopbackForTests: true,
    callbacks: { getState: () => ({}) },
  });
  context.after(() => server.stop());
  await server.start();
  const page = await fetch(server.origin());
  assert.equal(page.status, 200);
  assert.match(page.headers.get("permissions-policy"), /microphone=\(\)/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
  const html = await page.text();
  for (const id of ["companionView", "avatarFace", "messageForm", "interruptButton", "artifactList", "settingsSheet", "characterSelect", "responseModeSelect", "bubbleExpandButton"]) assert.match(html, new RegExp(`id="${id}"`));
  const font = await fetch(`${server.origin()}/noto-sans-jp.ttf`);
  assert.equal(font.status, 200);
  assert.equal(Number(font.headers.get("content-length")) || (await font.arrayBuffer()).byteLength, 9_590_732);
  const icon = await fetch(`${server.origin()}/icons/send.svg`);
  assert.equal(icon.status, 200);
  assert.match(await icon.text(), /@license Lucide/);
  assert.equal((await fetch(`${server.origin()}/icons/settings.svg`)).status, 200);
});
