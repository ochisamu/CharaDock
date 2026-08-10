// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeExternalHttpUrl, secureWindowNavigation } = require("../lib/window-navigation.cjs");

test("external window URLs allow only credential-free HTTP links", () => {
  assert.equal(normalizeExternalHttpUrl("https://nikechan.com/"), "https://nikechan.com/");
  assert.equal(normalizeExternalHttpUrl("http://example.com/path"), "http://example.com/path");
  for (const value of ["javascript:alert(1)", "file:///tmp/private", "https://user:secret@example.com/", "not a url"]) {
    assert.equal(normalizeExternalHttpUrl(value), "");
  }
});

test("secure windows send external links to the system browser and keep app navigation local", async () => {
  let windowOpenHandler = null;
  let willNavigateHandler = null;
  const opened = [];
  const webContents = {
    setWindowOpenHandler(handler) { windowOpenHandler = handler; },
    on(event, handler) { if (event === "will-navigate") willNavigateHandler = handler; },
  };
  secureWindowNavigation(webContents, {
    allowedPrefix: "http://127.0.0.1:41317/desktop/",
    openExternal: async (url) => opened.push(url),
  });

  assert.deepEqual(windowOpenHandler({ url: "https://x.com/tegnike" }), { action: "deny" });
  await Promise.resolve();
  assert.deepEqual(opened, ["https://x.com/tegnike"]);

  let prevented = false;
  willNavigateHandler({ preventDefault() { prevented = true; } }, "https://nikechan.com/");
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["https://x.com/tegnike", "https://nikechan.com/"]);

  prevented = false;
  willNavigateHandler({ preventDefault() { prevented = true; } }, "http://127.0.0.1:41317/desktop/control.html");
  assert.equal(prevented, false);

  windowOpenHandler({ url: "javascript:alert(1)" });
  await Promise.resolve();
  assert.equal(opened.length, 2);
});
