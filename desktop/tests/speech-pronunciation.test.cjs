// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeSpeechPronunciation, parseUserPronunciations } = require("../lib/speech-pronunciation.cjs");

test("sentence periods and compound words keep useful pronunciations", () => {
  assert.equal(normalizeSpeechPronunciation("Hello. VoiceModel voice-model APIModel"),
    "ハロー. ボイスモデル ボイスモデル エーピーアイモデル");
  assert.equal(normalizeSpeechPronunciation("ChatGPTとWi-Fi、JSONとNASA"),
    "チャットジーピーティーとワイファイ、ジェイソンとナサ");
});

test("URLs, paths, versions and unknown compounds are not partially rewritten", () => {
  const text = "https://hello.world/test hello@example.com C:\\hello\\world /hello/world foo.js build_123 v2.1 hello-Xqzvpt";
  assert.equal(normalizeSpeechPronunciation(text), text);
});

test("user readings are terminal and longest entries win without cascading", () => {
  assert.equal(normalizeSpeechPronunciation("VoiceModelとVoice", {
    userDictionary: "Voice=音声\nVoiceModel=My Voice\nMy=マイ",
  }), "My Voiceと音声");
});

test("known alphabetic product names are pronounced as words", () => {
  assert.equal(
    normalizeSpeechPronunciation("CharaDockでCodexとsherpa-onnxを使う"),
    "キャラドックでコーデックスとシェルパオニキスを使う",
  );
});

test("all-caps abbreviations are expanded to Japanese letter names", () => {
  assert.equal(normalizeSpeechPronunciation("APIとGPUとVAD"), "エーピーアイとジーピーユーとブイエーディー");
});

test("unknown words and code-like identifiers are preserved", () => {
  assert.equal(normalizeSpeechPronunciation("Xqzvpt foo.js build_123"), "Xqzvpt foo.js build_123");
});

test("CMUdict supplies Japanese readings for general English words", () => {
  assert.equal(normalizeSpeechPronunciation("Hello world"), "ハロー ワールド");
  assert.equal(normalizeSpeechPronunciation("beautiful pronunciation"), "ビューティフル プロナンシエーション");
});

test("user entries override built-in and CMUdict readings without changing partial words", () => {
  const userDictionary = "browser=ブラウザーカスタム\nFooBar=フーバー\ncash=$キャッシュ";
  assert.equal(
    normalizeSpeechPronunciation("browser FooBar foobars cash", { userDictionary }),
    "ブラウザーカスタム フーバー foobars $キャッシュ",
  );
});

test("pronunciation conversion can be disabled", () => {
  assert.equal(
    normalizeSpeechPronunciation("Hello API browser", { enabled: false, userDictionary: "Hello=ハロー" }),
    "Hello API browser",
  );
});

test("user dictionary parser accepts equals or tab lines and ignores invalid lines", () => {
  assert.deepEqual(
    parseUserPronunciations("# コメント\nfoo=フー\ninvalid\nbar\tバー"),
    [["foo", "フー"], ["bar", "バー"]],
  );
});
