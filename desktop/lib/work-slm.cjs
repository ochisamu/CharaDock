// SPDX-License-Identifier: Apache-2.0
const { sanitizeSpeechText } = require("./speech-stream.cjs");

const WORK_SLM_MODELS = Object.freeze([
  Object.freeze({
    id: "onnx-community/Qwen3.5-0.8B-ONNX-OPT",
    family: "qwen3.5",
    label: "Qwen 3.5 0.8B Q4 · WebGPU",
    shortLabel: "Qwen 3.5 0.8B",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT",
    approximateBytes: 850_000_000,
    dtype: "q4",
    licenseName: "Apache-2.0",
    recommended: true,
  }),
  Object.freeze({
    id: "LiquidAI/LFM2.5-1.2B-JP-202606-ONNX",
    family: "lfm2.5-jp",
    label: "LFM2.5 1.2B JP Q4F16 · WebGPU",
    shortLabel: "LFM2.5 1.2B JP",
    sourceUrl: "https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX",
    licenseUrl: "https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-202606-ONNX/blob/main/LICENSE",
    approximateBytes: 744_000_000,
    dtype: "q4f16",
    licenseName: "LFM Open License v1.0",
    licenseNotice: "法人の商用利用には年間売上1,000万米ドルのしきい値があります。詳細はモデルライセンスを確認してください。",
    japaneseSpecialized: true,
    experimental: true,
    recommended: false,
  }),
  Object.freeze({
    id: "onnx-community/Qwen2.5-0.5B-Instruct",
    family: "qwen2.5",
    label: "Qwen 2.5 0.5B Q8 · WebGPU",
    shortLabel: "Qwen 2.5 0.5B",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct",
    approximateBytes: 530_000_000,
    dtype: "q8",
    licenseName: "Apache-2.0",
    recommended: false,
  }),
]);
const DEFAULT_WORK_SLM_MODEL_ID = WORK_SLM_MODELS[0].id;
const WORK_SLM_RUNTIME = Object.freeze({
  version: "4.2.0",
  name: "transformers.web.js",
  url: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.web.js",
  bytes: 1_099_109,
  sha256: "25e0cbdf5df922996299fcd2cf835101ba979b134389a0dcc54f92022ca7e0ff",
});
const WORK_SLM_EMOTIONS = Object.freeze(["neutral", "thinking", "happy", "soft", "concerned", "excited"]);

function bounded(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeWorkSlmModelId(value) {
  const id = String(value || "");
  return WORK_SLM_MODELS.some((model) => model.id === id) ? id : DEFAULT_WORK_SLM_MODEL_ID;
}

function workSlmModel(value) {
  const id = normalizeWorkSlmModelId(value);
  return WORK_SLM_MODELS.find((model) => model.id === id) || WORK_SLM_MODELS[0];
}

function workSlmAnchors(...values) {
  const ignored = new Set(["現在", "作業", "進捗", "状況", "内容", "確認"]);
  const candidates = values.flatMap((value) => String(value || "").match(/[A-Za-z][A-Za-z0-9._-]{1,}|[ァ-ヶー]{3,}|[一-龯々]{2,}/g) || []);
  return [...new Set(candidates.filter((value) => !ignored.has(value)))].slice(0, 6);
}

function workSlmMessages({ language = "ja", request, sourceText, kind, characterName, personality }) {
  const english = language === "en";
  const acknowledgement = kind === "ack";
  const system = english
    ? [
      `You rewrite one desktop companion Work ${acknowledgement ? "start acknowledgement" : "progress announcement"}.`,
      "Return exactly one JSON object and nothing else. It must have a text string and an emotion chosen from neutral, thinking, happy, soft, concerned, or excited.",
      acknowledgement
        ? "Write one natural spoken sentence, 4 to 18 words. Say specifically what you are about to begin, using wording such as 'I'll start with...' or 'Let me first...'."
        : "Write one natural spoken sentence, 4 to 18 words. This is an in-progress update: use present-progressive wording.",
      "Never use completed or past-tense wording.",
      "Stay faithful to the supplied activity; never invent completion, results, files, URLs, commands, or technical details.",
      "Do not quote the request, ask a question, or tell the user to do the work. Avoid generic stock phrases. Match the character gently without roleplay narration.",
    ].join(" ")
    : [
      `デスクトップキャラクターがWorkの${acknowledgement ? "着手内容" : "進捗"}を一度だけ伝える発話へ書き換えてください。`,
      "出力はJSONオブジェクト一つだけです。textには発話を入れ、emotionはneutral、thinking、happy、soft、concerned、excitedのどれかにします。",
      acknowledgement
        ? "これは着手時の返事です。自然な話し言葉の一文を12〜60文字で書き、「まず〜から進めるね」「〜を見ていくね」のように、何から始めるかを具体的に伝えます。助詞が不自然な文や、依頼文をそのまま末尾へつないだ文は禁止です。"
        : "これは作業途中の報告です。自然な話し言葉の一文を12〜60文字で書き、必ず「〜しているよ」「〜を確認中だよ」のような進行形にします。",
      "「〜しました」「〜できました」などの完了形や過去形は禁止です。与えられた作業状況だけに忠実にし、完了、結果、ファイル、URL、コマンド、技術詳細を捏造しません。",
      "依頼を復唱せず、疑問文や利用者への依頼にせず、定型句を避け、キャラクターらしさは控えめに反映します。",
    ].join("");
  const anchors = workSlmAnchors(sourceText, request);
  const user = english
    ? `Kind: ${bounded(kind, 32)}\nRequest: ${bounded(request, 500)}\nCurrent activity: ${bounded(sourceText, 400)}\nThe sentence must contain at least one of these exact grounding terms: ${anchors.join(", ") || "(none)"}\nCharacter: ${bounded(characterName, 80)}\nPersonality: ${bounded(personality, 600)}`
    : `種類: ${bounded(kind, 32)}\n依頼: ${bounded(request, 500)}\n現在の作業状況: ${bounded(sourceText, 400)}\n発話には次の根拠語を最低1つそのまま含める: ${anchors.join("、") || "指定なし"}\nキャラクター: ${bounded(characterName, 80)}\n性格と話し方: ${bounded(personality, 600)}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function generatedTextFromPipeline(output) {
  const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text ?? output;
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated)) {
    const assistant = [...generated].reverse().find((entry) => entry?.role === "assistant");
    return String(assistant?.content || "");
  }
  return String(generated || "");
}

function prefilledWorkSlmJson(raw) {
  const continuation = String(raw || "").trimStart();
  const quoted = continuation.match(/^((?:\\.|[^"\\])*)"/);
  let text = quoted?.[1] || continuation.split(/[\r\n}]/, 1)[0] || "";
  try {
    if (quoted) text = JSON.parse(`"${quoted[1]}"`);
  } catch {
    text = quoted[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
  const emotion = WORK_SLM_EMOTIONS.find((candidate) => new RegExp(`emotion["']?\\s*[:：]\\s*["']?${candidate}`, "i").test(continuation)) || "neutral";
  return JSON.stringify({ text: bounded(text, 90), emotion });
}

function naturalizeGeneratedWorkJapanese(value, kind = "") {
  let text = String(value || "");
  if (kind === "ack") {
    text = text
      .replace(/([^\s、。]{1,40})を公開準備で(?:整理|確認|作業)して/u, "$1の公開準備を進めて")
      .replace(/^(.{1,36}?)を(.{1,28}?)で(?=始め)/u, "$1の$2から")
      .replace(/始めましょう(?:ね|か)?[。]?$/u, "始めるね。")
      .replace(/進めましょう(?:ね|か)?[。]?$/u, "進めるね。")
      .replace(/確認しましょう(?:ね|か)?[。]?$/u, "確認していくね。");
  }
  if (kind === "progress") {
    text = text
      .replace(/確認しました(?:よ|ね)?(?:[。！？]|$)/gu, "確認しているよ。")
      .replace(/(整理|更新|修正|作成|準備|検証|調査|検索|実装)しました(?:よ|ね)?[。]?$/u, "$1しているよ。");
  }
  return text;
}

function parseWorkSlmOutput(raw, { sourceText = "", request = "", kind = "" } = {}) {
  const text = generatedTextFromPipeline(raw).trim();
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("SLM output did not contain JSON.");
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("SLM output JSON was malformed.");
  }
  let announcement = bounded(naturalizeGeneratedWorkJapanese(sanitizeSpeechText(parsed?.text), kind), 90);
  if (announcement.length < 4) throw new Error("SLM announcement was too short.");
  const completionAllowed = /完了|完成|終わ|done|complete|finish/i.test(`${sourceText} ${kind}`);
  const prematureCompletion = /完了|完成|終わった|できた|整理しました|更新しました|修正しました|作成しました|用意しました|まとめました|揃った|done|complete|finished/i;
  if (!completionAllowed && prematureCompletion.test(announcement)) {
    const safeSentences = (announcement.match(/[^。！？!?]+[。！？!?]?/g) || [])
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence && !prematureCompletion.test(sentence));
    if (safeSentences.length > 0) announcement = bounded(safeSentences[0], 90);
  }
  if (!completionAllowed && prematureCompletion.test(announcement)) {
    throw new Error("SLM announcement claimed completion too early.");
  }
  if (/^(依頼|お願い|質問)[:：]|[?？]$|いただけますか|してください|お願いします|ましょう/.test(announcement)) {
    throw new Error("SLM announcement asked the user to act.");
  }
  const anchors = workSlmAnchors(sourceText, request);
  if (anchors.length > 0 && !anchors.some((anchor) => announcement.includes(anchor))) {
    throw new Error("SLM announcement was not grounded in the current activity.");
  }
  const emotion = WORK_SLM_EMOTIONS.includes(parsed?.emotion) ? parsed.emotion : "neutral";
  return { text: announcement, emotion };
}

function workSlmExpression(emotion, text) {
  const reaction = {
    thinking: "thinking",
    happy: "happy",
    soft: "soft",
    concerned: "sad",
    excited: "surprised",
  }[emotion] || "neutral";
  return {
    reaction,
    emotion: ["happy", "soft", "excited"].includes(emotion) ? (emotion === "excited" ? "surprised" : emotion) : null,
    durationMs: Math.max(900, Math.min(3600, bounded(text, 90).length * 85)),
  };
}

module.exports = {
  WORK_SLM_EMOTIONS,
  DEFAULT_WORK_SLM_MODEL_ID,
  WORK_SLM_MODELS,
  WORK_SLM_RUNTIME,
  generatedTextFromPipeline,
  naturalizeGeneratedWorkJapanese,
  parseWorkSlmOutput,
  normalizeWorkSlmModelId,
  workSlmExpression,
  workSlmModel,
  workSlmMessages,
  workSlmAnchors,
  prefilledWorkSlmJson,
};
