// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { screenShareConversationAction } = require("../lib/screen-share-intent.cjs");
const { browserConversationAction, browserContinuationAction } = require("../lib/browser-permission.cjs");
const { computerConversationAction, computerContinuationAction } = require("../lib/computer-use-intent.cjs");

test("English screen, browser and computer requests open the same consent routes", () => {
  for (const message of ["Look at this screen and help me fix the layout.", "Can you take a look at my screen?", "Please inspect this screenshot."]) {
    assert.equal(screenShareConversationAction(message), "request", message);
  }
  for (const message of ["Open https://example.com and check the layout", "Use the browser to search for it", "Read this website"]) {
    assert.equal(browserConversationAction(message), "request", message);
  }
  for (const message of ["Open Notepad on my computer", "Please control the desktop app", "Can you click the button in this window?"]) {
    assert.equal(computerConversationAction(message), "request", message);
  }
});

test("consent is explicit, bounded and denial takes precedence on every route", () => {
  for (const route of [screenShareConversationAction, browserConversationAction, computerConversationAction]) {
    for (const text of ["Yes, please.", "Sure", "Go ahead", "Okay, thanks!"]) assert.equal(route(text, true), "approve", text);
    for (const text of ["No thanks", "Not now", "Yes, but don't do it", "Cancel"]) assert.equal(route(text, true), "deny", text);
    for (const text of ["Read my book", "It looks okay but I have a question", "Yes, use a different project", "Tell me a joke"]) assert.equal(route(text, true), "replace", text);
    assert.equal(route("Yes"), "", "no pending request means no authorization");
  }
});

test("explanations, negated requests and local authoring do not launch control", () => {
  assert.equal(screenShareConversationAction("Explain how to capture a screen"), "");
  assert.equal(screenShareConversationAction("Don't look at my screen"), "");
  assert.equal(computerConversationAction("How do I open an app?"), "");
  assert.equal(computerConversationAction("Don't open Notepad"), "");
  assert.equal(browserConversationAction("Don't open this website"), "");
  assert.equal(browserConversationAction("Create index.html for the website and check the styles"), "");
  assert.equal(browserConversationAction("Update README.md and check the code"), "");
});

test("English follow-ups retain only explicit operational intent and can stop", () => {
  assert.equal(browserContinuationAction("Next, click that link"), "continue");
  assert.equal(browserContinuationAction("Then read the next page"), "continue");
  assert.equal(computerContinuationAction("Next, type hello in that window"), "continue");
  for (const route of [browserContinuationAction, computerContinuationAction]) {
    assert.equal(route("Stop, please"), "stop");
    assert.equal(route("Next, what should we work on?"), "");
    assert.equal(route("Don't click that button"), "");
  }
});
