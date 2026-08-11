// SPDX-License-Identifier: Apache-2.0
const { sanitizeSpeechText } = require("./speech-stream.cjs");

const WORK_SLM_MODELS = Object.freeze([
  Object.freeze({
    id: "onnx-community/Qwen3.5-0.8B-ONNX-OPT",
    family: "qwen3.5",
    label: "Qwen 3.5 0.8B Q4 · WebGPU",
    shortLabel: "Qwen 3.5 0.8B",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT",
    approximateBytes: 750_000_000,
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
    label: "Qwen 2.5 0.5B Q4 · WebGPU",
    shortLabel: "Qwen 2.5 0.5B",
    sourceUrl: "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct",
    approximateBytes: 800_000_000,
    dtype: "q4",
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

function workSlmMessages({ language = "ja", request, sourceText, kind, characterName, personality }) {
  const english = language === "en";
  const system = english
    ? [
      "You rewrite one desktop companion Work progress announcement.",
      "Return exactly one JSON object and nothing else: {\"text\":\"...\",\"emotion\":\"neutral|thinking|happy|soft|concerned|excited\"}.",
      "Write one natural spoken sentence, 4 to 18 words. Stay faithful to the supplied activity; never invent completion, results, files, URLs, commands, or technical details.",
      "Do not quote the request. Avoid generic stock phrases. Match the character gently without roleplay narration.",
    ].join(" ")
    : [
      "デスクトップキャラクターがWorkの進捗を一度だけ伝える発話へ書き換えてください。",
      "出力は次のJSONオブジェクト一つだけです: {\"text\":\"...\",\"emotion\":\"neutral|thinking|happy|soft|concerned|excited\"}。",
      "自然な話し言葉の一文を12〜60文字で書きます。与えられた作業状況だけに忠実にし、完了、結果、ファイル、URL、コマンド、技術詳細を捏造しません。",
      "依頼を復唱せず、定型句を避け、キャラクターらしさは控えめに反映します。",
    ].join("");
  const user = english
    ? `Kind: ${bounded(kind, 32)}\nRequest: ${bounded(request, 500)}\nCurrent activity: ${bounded(sourceText, 400)}\nCharacter: ${bounded(characterName, 80)}\nPersonality: ${bounded(personality, 600)}`
    : `種類: ${bounded(kind, 32)}\n依頼: ${bounded(request, 500)}\n現在の作業状況: ${bounded(sourceText, 400)}\nキャラクター: ${bounded(characterName, 80)}\n性格と話し方: ${bounded(personality, 600)}`;
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

function parseWorkSlmOutput(raw, { sourceText = "", kind = "" } = {}) {
  const text = generatedTextFromPipeline(raw).trim();
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("SLM output did not contain JSON.");
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("SLM output JSON was malformed.");
  }
  const announcement = bounded(sanitizeSpeechText(parsed?.text), 90);
  if (announcement.length < 4) throw new Error("SLM announcement was too short.");
  const completionAllowed = /完了|完成|終わ|done|complete|finish/i.test(`${sourceText} ${kind}`);
  if (!completionAllowed && /完了|完成|終わった|できた|done|complete|finished/i.test(announcement)) {
    throw new Error("SLM announcement claimed completion too early.");
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
  parseWorkSlmOutput,
  normalizeWorkSlmModelId,
  workSlmExpression,
  workSlmModel,
  workSlmMessages,
};
