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
  const pets = [];
  const liveStarts = [];
  let liveStops = 0;
  const server = new RemoteCompanionServer({
    rootDir,
    address: "127.0.0.1",
    port: 0,
    allowLoopbackForTests: true,
    callbacks: {
      getState: () => ({ character: { name: "Kohaku" }, conversationHistory: [] }),
      sendMessage: (payload) => { messages.push(payload); return { ok: true }; },
      pet: (payload) => { pets.push(payload); return { text: "Hello!", emotion: "happy" }; },
      setSettings: (payload) => { settings.push(payload); return { character: { name: "Towa" } }; },
      startLive: (payload) => { liveStarts.push(payload); return { accepted: true }; },
      stopLive: () => { liveStops += 1; return { stopped: true }; },
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

  const petted = await fetch(`${origin}/api/pet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CharaDock-CSRF": payload.csrfToken },
    body: JSON.stringify({ zone: "head", ignored: "value" }),
  });
  assert.equal(petted.status, 200);
  assert.deepEqual(await petted.json(), { text: "Hello!", emotion: "happy" });
  assert.deepEqual(pets, [{ zone: "head" }]);

  const configured = await fetch(`${origin}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CharaDock-CSRF": payload.csrfToken },
    body: JSON.stringify({ characterId: "towa-avatar", pcAudioEnabled: false, ttsModel: { key: "kokoroVoice", value: "jm_kumo" } }),
  });
  assert.equal(configured.status, 200);
  assert.deepEqual(settings, [{ characterId: "towa-avatar", pcAudioEnabled: false, ttsModel: { key: "kokoroVoice", value: "jm_kumo" } }]);
  assert.equal((await configured.json()).state.character.name, "Towa");

  const liveHeaders = { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CharaDock-CSRF": payload.csrfToken };
  assert.equal((await fetch(`${origin}/api/live/start`, { method: "POST", headers: liveHeaders, body: JSON.stringify({ sdp: "v=0\r\n...", mode: "chat" }) })).status, 200);
  assert.deepEqual(liveStarts, [{ sdp: "v=0\r\n...", mode: "chat" }]);
  assert.equal((await fetch(`${origin}/api/live/stop`, { method: "POST", headers: liveHeaders, body: "{}" })).status, 200);
  assert.equal(liveStops, 1);

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

test("a trusted paired device renews its short session without scanning another QR code", async (context) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-remote-renew-"));
  for (const [name, value] of [["index.html", "<!doctype html>"], ["remote.css", ""], ["remote.js", ""]]) fs.writeFileSync(path.join(rootDir, name), value);
  let clock = Date.UTC(2026, 7, 9, 0, 0, 0);
  let trustedDevices = [];
  const createServer = () => new RemoteCompanionServer({
    rootDir,
    address: "127.0.0.1",
    port: 0,
    sessionMinutes: 15,
    allowLoopbackForTests: true,
    now: () => clock,
    trustedDevices,
    callbacks: {
      getState: () => ({ ok: true }),
      onTrustedDevices: (devices) => { trustedDevices = devices; },
    },
  });
  let server = createServer();
  context.after(async () => { await server.stop(); fs.rmSync(rootDir, { recursive: true, force: true }); });
  await server.start();
  let origin = server.origin();
  const paired = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token: server.pairingCode, deviceName: "Remembered phone" }),
  });
  const cookie = paired.headers.get("set-cookie").split(";")[0];
  assert.match(paired.headers.get("set-cookie"), /Max-Age=15552000/);
  assert.equal(trustedDevices.length, 1);

  clock += 16 * 60_000;
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal(server.status().devices[0].name, "Remembered phone");

  await server.stop();
  server = createServer();
  await server.start();
  origin = server.origin();
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
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

test("Tailscale Serve is accepted only as an identified localhost HTTPS proxy", () => {
  const server = new RemoteCompanionServer({ rootDir: __dirname, address: "192.168.1.8" });
  const request = (remoteAddress, host, login = "") => ({ socket: { remoteAddress }, headers: { host, "tailscale-user-login": login } });
  assert.equal(server.isTrustedTailscaleRequest(request("127.0.0.1", "charadock.example.ts.net", "user@example.com")), true);
  assert.equal(server.requestOrigin(request("127.0.0.1", "charadock.example.ts.net", "user@example.com")), "https://charadock.example.ts.net");
  assert.equal(server.isTrustedTailscaleRequest(request("192.168.1.4", "charadock.example.ts.net", "user@example.com")), false);
  assert.equal(server.isTrustedTailscaleRequest(request("127.0.0.1", "attacker.example.com", "user@example.com")), false);
  assert.equal(server.isTrustedTailscaleRequest(request("127.0.0.1", "charadock.example.ts.net")), false);
});

test("the packaged phone surface keeps camera disabled and permits microphone only for a secure origin", async (context) => {
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
  assert.match(page.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.match(page.headers.get("content-security-policy"), /img-src 'self' data: blob:/);
  const html = await page.text();
  for (const id of ["companionView", "avatarTapTarget", "avatarReactionShell", "avatarFace", "messageForm", "microphoneButton", "remoteLiveAudio", "interruptButton", "artifactList", "historySheet", "settingsSheet", "settingsStatus", "characterSelect", "responseModeSelect", "ttsModelSettings", "ttsModelFields", "bubbleExpandButton", "pairingCodeInput"]) assert.match(html, new RegExp(`id="${id}"`));
  const script = await fetch(`${server.origin()}/remote.js`).then((response) => response.text());
  assert.match(script, /request\("\/api\/pet"/);
  assert.match(script, /remote-touch-spark/);
  assert.match(script, /ttsModel: \{ key: field\.key, value:/);
  assert.match(script, /setSettingsStatus\(text\("保存中…", "Saving…"\), "saving"\)/);
  assert.match(script, /setSettingsStatus\(text\("保存しました", "Saved"\), "success"\)/);
  const font = await fetch(`${server.origin()}/noto-sans-jp.ttf`);
  assert.equal(font.status, 200);
  assert.equal(Number(font.headers.get("content-length")) || (await font.arrayBuffer()).byteLength, 9_590_732);
  const icon = await fetch(`${server.origin()}/icons/send.svg`);
  assert.equal(icon.status, 200);
  assert.match(await icon.text(), /@license Lucide/);
  assert.equal((await fetch(`${server.origin()}/icons/settings.svg`)).status, 200);
  assert.equal((await fetch(`${server.origin()}/icons/microphone.svg`)).status, 200);
});
