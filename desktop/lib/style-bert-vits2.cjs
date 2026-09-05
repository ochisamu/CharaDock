// SPDX-License-Identifier: Apache-2.0

const { splitNaturalSpeechText } = require("./natural-speech-chunks.cjs");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function styleBertVoiceEndpoint(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || "http://localhost:5000")); } catch {
    throw new Error("Style-Bert-VITS2のURLが正しくありません。");
  }
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error("Style-Bert-VITS2にはlocalhostのHTTP URLを指定してください。");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = !path || path === "/docs" ? "/voice" : path.endsWith("/voice") ? path : `${path}/voice`;
  url.search = "";
  url.hash = "";
  return url;
}

function splitTtsText(value, maxLength = 80, maxChunks = 100) {
  const sentences = String(value || "").replace(/\s+/g, " ").trim()
    .match(/[\s\S]+?(?:[。！？!?]+[」』】）)\]"'”’]*|$)/gu) || [];
  const chunks = [];
  for (const sentence of sentences) {
    if (chunks.length >= maxChunks) break;
    chunks.push(...splitNaturalSpeechText(sentence, maxLength, maxChunks - chunks.length));
  }
  return chunks;
}

function audioMimeType(bytes, responseType = "") {
  const type = String(responseType || "").split(";", 1)[0].trim().toLowerCase();
  if (type.startsWith("audio/")) return type;
  if (bytes.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return "audio/wav";
}

async function synthesizeStyleBertVits2({
  text,
  url,
  modelId = 0,
  speed = 1,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("音声APIへ接続できません。");
  const chunks = splitTtsText(text);
  if (!chunks.length) return { audioDataUrls: [] };
  const endpoint = styleBertVoiceEndpoint(url);
  const normalizedModelId = Math.round(numberInRange(modelId, 0, 0, 9999));
  const normalizedSpeed = numberInRange(speed, 1, .5, 2);
  const audioDataUrls = [];
  for (const chunk of chunks) {
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set("text", chunk);
    requestUrl.searchParams.set("model_id", String(normalizedModelId));
    requestUrl.searchParams.set("length", String(Number((1 / normalizedSpeed).toFixed(3))));
    requestUrl.searchParams.set("language", "JP");
    requestUrl.searchParams.set("auto_split", "true");
    let response;
    try {
      response = await fetchImpl(requestUrl, { signal: AbortSignal.timeout(45_000) });
    } catch (error) {
      throw new Error(`Style-Bert-VITS2へ接続できません: ${error.message}`);
    }
    if (!response.ok) {
      const detail = String(await response.text().catch(() => "")).slice(0, 240);
      throw new Error(`Style-Bert-VITS2が音声を生成できませんでした（HTTP ${response.status}）${detail ? `: ${detail}` : ""}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("Style-Bert-VITS2の音声データが正しくありません。");
    const mimeType = audioMimeType(bytes, response.headers.get("content-type"));
    audioDataUrls.push(`data:${mimeType};base64,${bytes.toString("base64")}`);
  }
  return { audioDataUrls, audioTexts: chunks };
}

module.exports = { audioMimeType, splitTtsText, styleBertVoiceEndpoint, synthesizeStyleBertVits2 };
