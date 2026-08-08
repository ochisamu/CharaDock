// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  browserConversationAction,
  browserContinuationAction,
  browserLoadErrorMessage,
  extractBrowserTarget,
  isAllowedBrowserUrl,
  normalizeBrowserToolName,
  normalizeBrowserUrl,
} = require("../lib/browser-permission.cjs");

test("browser use is requested and approved in natural conversation", () => {
  assert.equal(browserConversationAction("ブラウザで https://example.com を確認して"), "request");
  assert.equal(browserConversationAction("サイトを開いて内容を見て"), "request");
  assert.equal(browserConversationAction("ブラウザで名古屋の天気を検索して"), "request");
  assert.equal(browserConversationAction("https://example.com/docs を読んで"), "request");
  assert.equal(browserConversationAction("ブラウザ操作できなくなった"), "request");
  assert.equal(browserConversationAction("ブラウザの意味を教えて"), "");
  assert.equal(browserConversationAction("artifacts/index.htmlを作って、HTMLとCSSの連携を確認して"), "");
  assert.equal(browserConversationAction("README.mdとapp.jsを更新して確認して"), "");
  assert.equal(browserConversationAction("web/index.htmlを作って確認して"), "");
  assert.equal(browserConversationAction("assets/preview.webpを更新して確認して"), "");
  assert.equal(browserConversationAction("サイト用のindex.htmlを作って確認して"), "");
  assert.equal(browserConversationAction("ブラウザでindex.htmlを開いて"), "request");
  assert.equal(browserConversationAction("example.com/index.htmlを開いて"), "request");
  assert.equal(browserConversationAction("docs.example.com/report.pdfを開いて"), "request");
  assert.equal(browserConversationAction("いいよ、開いて", true), "approve");
  assert.equal(browserConversationAction("今は使わない", true), "deny");
});

test("browser permission continuation requires an explicit operational follow-up", () => {
  assert.equal(browserContinuationAction("続けてそのリンクを開いて"), "continue");
  assert.equal(browserContinuationAction("そのページを下へスクロールして"), "continue");
  assert.equal(browserContinuationAction("ブラウザ操作は終わり"), "stop");
  assert.equal(browserContinuationAction("あと、明日の天気は？"), "");
});

test("browser URL parsing rejects active and credential-bearing schemes", () => {
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), null);
  assert.equal(normalizeBrowserUrl("https://user:pass@example.com"), null);
  assert.equal(normalizeBrowserUrl("example.com/docs").href, "https://example.com/docs");
  assert.equal(normalizeBrowserUrl("localhost:3000/settings").href, "http://localhost:3000/settings");
});

test("browser permission is scoped to one normalized host", () => {
  assert.equal(extractBrowserTarget("https://www.example.com/docs を見て").hostname, "www.example.com");
  assert.equal(isAllowedBrowserUrl("https://example.com/next", "www.example.com"), true);
  assert.equal(isAllowedBrowserUrl("https://other.example.com/", "example.com"), false);
});

test("browser tool aliases work without namespace-tool model support", () => {
  assert.equal(normalizeBrowserToolName("browser_open_page"), "open_page");
  assert.equal(normalizeBrowserToolName("read_page"), "read_page");
});

test("cross-host redirects report the permission boundary clearly", () => {
  const message = browserLoadErrorMessage({
    allowedHost: "example.com",
    blockedUrl: "https://login.example.net/",
    error: new Error("ERR_ABORTED"),
  });
  assert.match(message, /別のサイト「login\.example\.net」/);
});
