// SPDX-License-Identifier: Apache-2.0
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

const MASCOT_INSTRUCTIONS = [
  "あなたはデスクトップに常駐する親しみやすいコンパニオンです。",
  "ユーザーと自然な日本語で会話し、通常は簡潔に1〜4文で答えてください。",
  "明るく気が利く相棒として振る舞いますが、知らないことは正直に伝えてください。",
  "Markdownの見出しや長い箇条書きは、ユーザーが求めた場合だけ使ってください。",
].join("\n");

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const pieces = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") pieces.push(content.text);
    }
  }
  return pieces.join("\n").trim();
}

async function parseError(response) {
  let detail = "";
  try {
    const payload = await response.json();
    detail = payload?.error?.message || payload?.message || "";
  } catch {
    detail = await response.text().catch(() => "");
  }
  const error = new Error(detail || `OpenAI API request failed (${response.status})`);
  error.status = response.status;
  return error;
}

function responseFailure(payload) {
  const detail = payload?.incomplete_details?.reason || payload?.status;
  return new Error(payload?.error?.message || payload?.message
    || `OpenAI APIの応答が完了しませんでした。${detail ? ` (${detail})` : ""}`);
}

class OpenAIClient {
  constructor() {
    this.previousResponseId = null;
    this.activeAbortController = null;
  }

  hasActiveTurn() {
    return this.activeAbortController !== null;
  }

  reset() {
    const controller = this.activeAbortController;
    this.activeAbortController = null;
    this.previousResponseId = null;
    controller?.abort(new Error("応答を中断しました。"));
  }

  async interruptActiveTurn() {
    const controller = this.activeAbortController;
    if (!controller || controller.signal.aborted) return false;
    // Keep ownership until sendMessage settles; reset explicitly invalidates it.
    controller.abort(new Error("応答を中断しました。"));
    return true;
  }

  async sendMessage({ apiKey, model, message, instructions = "", onDelta } = {}) {
    if (!apiKey) throw new Error("OpenAI APIキーを設定してください。");
    if (this.hasActiveTurn()) throw new Error("OpenAI APIの応答が進行中です。");
    const body = {
      model: String(model || "gpt-5.6-luna"),
      instructions: [MASCOT_INSTRUCTIONS, String(instructions || "").trim()].filter(Boolean).join("\n\n"),
      input: String(message || "").trim(),
      max_output_tokens: 800,
    };
    if (this.previousResponseId) body.previous_response_id = this.previousResponseId;
    if (onDelta) body.stream = true;
    const controller = new AbortController();
    this.activeAbortController = controller;
    const timeout = setTimeout(() => controller.abort(new Error("OpenAI APIの応答がタイムアウトしました。")), 120_000);
    try {
      const response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response.ok) throw await parseError(response);
      let result;
      if (onDelta) {
        result = await this.parseStream(response, onDelta, controller.signal);
      } else {
        const payload = await response.json();
        controller.signal.throwIfAborted();
        if (payload.status && payload.status !== "completed") throw responseFailure(payload);
        const text = responseOutputText(payload);
        if (!text) throw new Error("OpenAI APIからテキスト応答を取得できませんでした。");
        result = { text, provider: "openai", responseId: payload.id || null };
      }
      // Only the still-active turn may advance conversation history.
      controller.signal.throwIfAborted();
      if (this.activeAbortController !== controller) throw new Error("応答を中断しました。");
      this.previousResponseId = result.responseId;
      return result;
    } finally {
      clearTimeout(timeout);
      if (this.activeAbortController === controller) this.activeAbortController = null;
    }
  }

  async parseStream(response, onDelta, signal) {
    if (!response.body) throw new Error("OpenAI APIのストリームを開始できませんでした。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let responseId = null;
    let completed = false;
    // Cancel the reader as well as fetch so pending reads unblock on interruption.
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener("abort", cancelReader, { once: true });
    const consumeEvent = (block) => {
      signal?.throwIfAborted();
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return;
      if (data === "[DONE]") throw new Error("OpenAI APIのストリームが完了前に終了しました。");
      let event;
      try { event = JSON.parse(data); } catch {
        throw new Error("OpenAI APIのストリームを解析できませんでした。");
      }
      if (event.type === "response.output_text.delta") {
        const delta = String(event.delta || "");
        text += delta;
        if (delta) onDelta(delta, text);
      } else if (event.type === "response.completed") {
        if (event.response?.status && event.response.status !== "completed") throw responseFailure(event.response);
        responseId = event.response?.id || responseId;
        completed = true;
      } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
        throw responseFailure(event.response || event);
      }
    };
    try {
      while (!completed) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          consumeEvent(block);
          if (completed) break;
        }
        if (done) {
          if (!completed && buffer.trim()) consumeEvent(buffer);
          break;
        }
      }
      signal?.throwIfAborted();
      if (!completed) throw new Error("OpenAI APIのストリームが完了前に終了しました。");
      if (!text.trim()) throw new Error("OpenAI APIからテキスト応答を取得できませんでした。");
      return { text: text.trim(), provider: "openai", responseId };
    } finally {
      signal?.removeEventListener("abort", cancelReader);
      cancelReader();
      reader.releaseLock();
    }
  }

  async transcribe({ apiKey, model, bytes, mimeType = "audio/webm" }) {
    if (!apiKey) throw new Error("音声認識にはOpenAI APIキーが必要です。");
    if (!bytes?.byteLength) throw new Error("録音データが空です。");
    const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mimeType }), `speech.${extension}`);
    form.append("model", String(model || "gpt-4o-mini-transcribe"));
    form.append("response_format", "json");
    form.append("language", "ja");
    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw await parseError(response);
    const payload = await response.json();
    const text = String(payload?.text || "").trim();
    if (!text) throw new Error("音声を文字に変換できませんでした。");
    return text;
  }
}

module.exports = { MASCOT_INSTRUCTIONS, OpenAIClient, responseOutputText };
