// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { StreamingReplyPhrases, StreamingTextSegmenter, sanitizeSpeechText } = require("../lib/speech-stream.cjs");

test("streaming speech emits complete sentences once and flushes the remainder", () => {
  const segmenter = new StreamingTextSegmenter();
  assert.deepEqual(segmenter.push("今日は晴れ"), []);
  assert.deepEqual(segmenter.push("今日は晴れです。次は"), ["今日は晴れです。"]);
  assert.deepEqual(segmenter.push("今日は晴れです。次は買い物です！あとで"), ["次は買い物です！"]);
  assert.deepEqual(segmenter.push("今日は晴れです。次は買い物です！あとで", { flush: true }), ["あとで"]);
  assert.deepEqual(segmenter.push("今日は晴れです。次は買い物です！あとで", { flush: true }), []);
});

test("device reply phrases become available before completion and flush the final revision once", async () => {
  const reply = new StreamingReplyPhrases();
  const first = reply.next();
  assert.equal(reply.push("今日は"), false);
  assert.equal(reply.push("今日は晴れです。夕方に"), true);
  assert.deepEqual(await first, { value: "今日は晴れです。", done: false });
  assert.equal(reply.push("今日は晴れです。夕方に"), false);
  reply.finish("今日は晴れです。夕方に散歩しよう");
  assert.deepEqual(await reply.next(), { value: "夕方に散歩しよう", done: false });
  assert.equal((await reply.next()).done, true);
});

test("cancelling a device reply settles a waiting reader and rejects late deltas", async () => {
  const reply = new StreamingReplyPhrases();
  const waiting = reply.next();
  reply.cancel();
  assert.equal(reply.push("遅れて届いた文です。"), false);
  assert.equal((await waiting).done, true);
});

test("device reply phrases skip a fenced code block split across deltas", async () => {
  const reply = new StreamingReplyPhrases();
  reply.push("こちらです。\n" + "``");
  assert.deepEqual(await reply.next(), { value: "こちらです。", done: false });
  const code = "```js\n" + "alert('内部コマンド！');\n".repeat(6);
  assert.equal(reply.push("こちらです。\n" + code), false);
  assert.equal(reply.push("こちらです。\n" + code + "```\n続きです。"), true);
  assert.deepEqual(await reply.next(), { value: "続きです。", done: false });
  reply.finish("こちらです。\n" + code + "```\n続きです。");
  assert.equal((await reply.next()).done, true);
});

test("streaming speech bounds long text before punctuation", () => {
  const segmenter = new StreamingTextSegmenter({ maxLength: 24 });
  const result = segmenter.push("これは句読点を含まない非常に長い文章なので途中でも音声生成を始められるように分割します追加文章");
  assert.equal(result.length, 1);
  assert.ok(result[0].length <= 24);
});

test("streaming speech avoids a tiny final utterance around the soft limit", () => {
  const segmenter = new StreamingTextSegmenter({ maxLength: 40 });
  const text = "自然な読み上げを維持するため、この文章は少しだけ上限を超えて終わります。短い末尾です。";
  const chunks = segmenter.push(text, { flush: true });
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.length === 1 || chunks.at(-1).length >= 10, `unexpected tiny tail: ${chunks.at(-1)}`);
});

test("speech text removes markdown links and raw URLs", () => {
  assert.equal(sanitizeSpeechText("- [公式サイト](https://example.com) を確認 https://example.com/a"), "公式サイト を確認");
  assert.equal(sanitizeSpeechText("詳細は www.example.com/path または docs.example.jp/guide を確認"), "詳細は または を確認");
  assert.equal(sanitizeSpeechText("晴れです。 citeturn5search2"), "晴れです。");
  assert.equal(sanitizeSpeechText("詳細：https://example.com/path?x=1#topです。"), "詳細： です。");
  assert.equal(sanitizeSpeechText("docs.example.dev/guideを開きました。"), "を開きました。");
  assert.equal(sanitizeSpeechText("<HTTPS://EXAMPLE.COM/a> を参照してください。"), "を参照してください。");
  assert.equal(sanitizeSpeechText("[資料][guide]\n\n[guide]: https://example.com/long/path"), "資料 guide");
});

test("streamed long URLs never become spoken domain fragments", () => {
  const segmenter = new StreamingTextSegmenter({ maxLength: 40 });
  const text = "詳しい手順は https://example.com/a/very/long/documentation/path?source=charadock を確認してください。";
  const chunks = segmenter.push(text, { flush: true });
  assert.equal(chunks.join(" "), "詳しい手順は を確認してください。");
  assert.doesNotMatch(chunks.join(" "), /https?|example|com|documentation|charadock/i);
});

test("speech text skips code, file paths, hashes, emoji, and symbol-only content", () => {
  assert.equal(
    sanitizeSpeechText("結果はこちら ✅ `npm test` C:\\work\\app.js --verbose abcdef0123456789abcdef0123456789 ***"),
    "結果はこちら",
  );
  assert.equal(sanitizeSpeechText("```js\nconsole.log('hello')\n``` https://example.com | ==="), "");
  assert.equal(sanitizeSpeechText("本文です。 [1] © 2026 $20 → 完了"), "本文です。 2026 20 完了");
  assert.equal(sanitizeSpeechText("```js\nconsole.log('unclosed')"), "");
  assert.equal(sanitizeSpeechText("[インストーラー](https://example.com/app.exe)を保存しました。"), "インストーラーを保存しました。");
});

test("StackChan can start a stable opening clause while a long first sentence is still streaming", async () => {
  const reply = new StreamingReplyPhrases({ openingClause: true });
  const opening = "この話をわかりやすく順に整理してみると、";
  assert.equal(reply.push(opening), false);
  assert.equal(reply.push(opening + "最初に身近な実例から"), true);
  assert.equal((await reply.next()).value, opening);
  assert.equal(reply.finish(opening + "最初に身近な実例から始めましょう。"), true);
  assert.equal((await reply.next()).value, "最初に身近な実例から始めましょう。");
  assert.equal((await reply.next()).done, true);
});

test("a waiting filler shares the device queue and a ready answer supersedes it", async () => {
  const reply = new StreamingReplyPhrases();
  assert.equal(reply.offerFiller("少し考えてみるね。"), true);
  assert.equal(reply.offerFiller("重複したフィラー。"), false);
  assert.equal(reply.push("これが返事です。"), true);
  assert.equal((await reply.next()).value, "これが返事です。");
  assert.equal(reply.offerFiller("遅れて届いたフィラー。"), false);

  const waiting = new StreamingReplyPhrases();
  const reader = waiting.next();
  assert.equal(waiting.offerFiller("考えてみるね。"), true);
  assert.deepEqual((await reader).value, { value: "考えてみるね。", filler: true });
  waiting.finish("こちらが回答です。");
  assert.equal((await waiting.next()).value, "こちらが回答です。");
  assert.equal((await waiting.next()).done, true);
});
