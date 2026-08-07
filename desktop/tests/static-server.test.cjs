// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MascotStaticServer } = require("../lib/static-server.cjs");

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-server-"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "source"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>");
  fs.writeFileSync(path.join(root, "assets", "avatar.png"), "png");
  fs.writeFileSync(path.join(root, "assets", "ui-font.ttf"), "font");
  fs.writeFileSync(path.join(root, "source", "secret.txt"), "secret");
  return root;
}

test("static server serves allowlisted app files and blocks source files", async () => {
  const server = new MascotStaticServer(fixtureRoot());
  await server.start();
  try {
    const index = await fetch(`${server.origin()}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), "<h1>ok</h1>");
    assert.equal((await fetch(`${server.origin()}/assets/avatar.png`)).status, 200);
    const font = await fetch(`${server.origin()}/assets/ui-font.ttf`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/ttf");
    assert.equal((await fetch(`${server.origin()}/source/secret.txt`)).status, 404);
    assert.equal((await fetch(`${server.origin()}/../source/secret.txt`)).status, 404);
  } finally {
    await server.stop();
  }
});

test("snapshot and input APIs retain state", async () => {
  const server = new MascotStaticServer(fixtureRoot());
  await server.start();
  try {
    server.setSnapshot({ type: "purupuru-obs-snapshot", version: 1 }, false);
    const snapshot = await (await fetch(`${server.origin()}/api/obs/snapshot`)).json();
    assert.equal(snapshot.type, "purupuru-obs-snapshot");
    server.pushInput({ voiceRaw: 0.4, forceMouth: 2, reaction: "happy", durationMs: 500 });
    const input = await (await fetch(`${server.origin()}/api/obs/input`)).json();
    assert.equal(input.voiceRaw, 0.4);
    assert.equal(Object.prototype.hasOwnProperty.call(input, "forceMouth"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(input, "reaction"), false);
  } finally {
    await server.stop();
  }
});
