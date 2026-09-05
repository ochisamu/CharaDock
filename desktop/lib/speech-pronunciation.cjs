// SPDX-License-Identifier: Apache-2.0

// Japanese voices often spell Latin text one character at a time. Keep this
// mapping deliberately small and predictable: known product/technical words
// are read as words, while all-caps abbreviations are read as letter names.
const { cmuWordToKatakana } = require("./cmu-katakana.cjs");

const WORD_PRONUNCIATIONS = Object.freeze(new Map([
  ["charadock", "キャラドック"],
  ["style-bert-vits2", "スタイルバートビッツツー"],
  ["sherpa-onnx", "シェルパオニキス"],
  ["javascript", "ジャバスクリプト"],
  ["typescript", "タイプスクリプト"],
  ["microsoft", "マイクロソフト"],
  ["windows", "ウィンドウズ"],
  ["openai", "オープンエーアイ"],
  ["codex", "コーデックス"],
  ["realtime", "リアルタイム"],
  ["electron", "エレクトロン"],
  ["github", "ギットハブ"],
  ["python", "パイソン"],
  ["chrome", "クローム"],
  ["browser", "ブラウザー"],
  ["computer", "コンピューター"],
  ["desktop", "デスクトップ"],
  ["server", "サーバー"],
  ["model", "モデル"],
  ["stream", "ストリーム"],
  ["audio", "オーディオ"],
  ["voice", "ボイス"],
  ["download", "ダウンロード"],
  ["update", "アップデート"],
  ["mouse", "マウス"],
  ["click", "クリック"],
  ["google", "グーグル"],
  ["style", "スタイル"],
  ["bert", "バート"],
  ["sherpa", "シェルパ"],
  ["onnx", "オニキス"],
  ["app", "アプリ"],
  ["beautiful", "ビューティフル"],
  ["pronunciation", "プロナンシエーション"],
  ["test", "テスト"],
  ["hello", "ハロー"],
  ["world", "ワールド"],
  ["this", "ディス"],
  ["that", "ザット"],
  ["with", "ウィズ"],
  ["from", "フロム"],
  ["the", "ザ"],
  ["and", "アンド"],
  ["for", "フォー"],
  ["of", "オブ"],
  ["to", "トゥ"],
  ["is", "イズ"],
  ["chatgpt", "チャットジーピーティー"],
  ["wifi", "ワイファイ"],
  ["wi-fi", "ワイファイ"],
  ["bluetooth", "ブルートゥース"],
  ["linux", "リナックス"],
  ["docker", "ドッカー"],
  ["json", "ジェイソン"],
  ["nasa", "ナサ"],
  ["vits2", "ビッツツー"],
]));

const LETTER_NAMES = Object.freeze({
  A: "エー", B: "ビー", C: "シー", D: "ディー", E: "イー", F: "エフ", G: "ジー",
  H: "エイチ", I: "アイ", J: "ジェー", K: "ケー", L: "エル", M: "エム", N: "エヌ",
  O: "オー", P: "ピー", Q: "キュー", R: "アール", S: "エス", T: "ティー", U: "ユー",
  V: "ブイ", W: "ダブリュー", X: "エックス", Y: "ワイ", Z: "ゼット",
});

function parseUserPronunciations(value, maxEntries = 200) {
  const entries = [];
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.includes("=") ? line.indexOf("=") : line.indexOf("\t");
    if (separator < 1) continue;
    const word = line.slice(0, separator).trim().slice(0, 80);
    const reading = line.slice(separator + 1).trim().slice(0, 160);
    if (!word || !reading || !/[A-Za-z]/.test(word)) continue;
    entries.push([word, reading]);
    if (entries.length >= maxEntries) break;
  }
  return entries.sort((a, b) => b[0].length - a[0].length);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readEnglishToken(token) {
    const known = WORD_PRONUNCIATIONS.get(token.toLowerCase());
    if (known) return known;
    // File names, versions, hashes, and paths should remain intact rather than
    // being turned into misleading words.
    if (/[._\\/]/.test(token) || /\d/.test(token)) return token;
    const parts = token.replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").split(/[ -]+/);
    if (parts.length > 1) {
      const readings = parts.map(readEnglishToken);
      // Unknown compounds remain intact; do not invent a partial reading.
      return readings.every((reading, index) => reading !== parts[index]) ? readings.join("") : token;
    }
    if (/^[A-Z]{2,8}$/.test(token)) return [...token].map((letter) => LETTER_NAMES[letter]).join("");
    if (/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token) && token.length <= 32) {
      const cmuReading = cmuWordToKatakana(token);
      if (cmuReading) return cmuReading;
    }
    return token;
}

function normalizeSpeechPronunciation(value, { enabled = true, userDictionary = "" } = {}) {
  const text = String(value || "");
  if (!text || !enabled) return text;
  const entries = parseUserPronunciations(userDictionary);
  const normalize = (part) => part.replace(
    /https?:\/\/[^\s<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|[\\/][A-Za-z0-9._\\/-]+|[A-Za-z0-9][A-Za-z0-9+#._'\\/:-]*/g,
    (token) => {
      if (/[@\\/:]/.test(token)) return token;
      const suffix = token.match(/[.]+$/)?.[0] || "";
      const core = suffix ? token.slice(0, -suffix.length) : token;
      return readEnglishToken(core) + suffix;
    },
  );
  if (!entries.length) return normalize(text);
  // User readings are final: do not re-normalize them or let another entry
  // rewrite their output. Longest literal entry wins at the same position.
  const pattern = new RegExp(`(?<![A-Za-z0-9])(?:${entries.map(([word]) => escapeRegExp(word)).join("|")})(?![A-Za-z0-9])`, "gi");
  let result = "", offset = 0;
  for (const match of text.matchAll(pattern)) {
    result += normalize(text.slice(offset, match.index));
    result += entries.find(([word]) => word.toLowerCase() === match[0].toLowerCase())[1];
    offset = match.index + match[0].length;
  }
  return result + normalize(text.slice(offset));
}

module.exports = { normalizeSpeechPronunciation, parseUserPronunciations };
