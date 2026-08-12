// SPDX-License-Identifier: Apache-2.0

function boundedConversationHistory(history, userText, assistantText) {
  const createdAt = new Date().toISOString();
  return [
    ...(Array.isArray(history) ? history : []),
    { role: "user", text: String(userText || "").trim(), createdAt },
    { role: "assistant", text: String(assistantText || "").trim(), createdAt },
  ].filter((entry) => entry.text).slice(-40);
}

function recentConversationContext(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const lines = history.slice(-8).map((entry) => {
    const label = entry.role === "assistant" ? "キャラクター" : "ユーザー";
    return `${label}: ${String(entry.text || "").replace(/\s+/g, " ").slice(0, 600)}`;
  });
  return [
    "直近の会話は次のとおりです。『明日は？』『それは？』などの省略は、この流れを引き継いで解釈してください。",
    "<recent_conversation>",
    ...lines,
    "</recent_conversation>",
  ].join("\n");
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function continuityEntries({ conversationHistory = [], workHistory = [], characterId = "", workspaceKey = "" } = {}) {
  const conversation = (Array.isArray(conversationHistory) ? conversationHistory : []).map((entry, index) => ({
    type: "conversation",
    role: entry?.role === "assistant" ? "assistant" : "user",
    text: String(entry?.text || "").replace(/\s+/g, " ").trim().slice(0, 600),
    at: timestamp(entry?.createdAt),
    order: index,
  })).filter((entry) => entry.text);
  const work = (Array.isArray(workHistory) ? workHistory : []).flatMap((run, index) => {
    if (run?.status !== "completed") return [];
    if (characterId && run?.characterId && run.characterId !== characterId) return [];
    if (workspaceKey && run?.workspaceKey !== workspaceKey) return [];
    const request = String(run?.request || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const result = String(run?.result || "").replace(/\s+/g, " ").trim().slice(0, 800);
    if (!request && !result) return [];
    return [{
      type: "work",
      request,
      result,
      artifacts: (Array.isArray(run?.artifacts) ? run.artifacts : []).slice(0, 4).map((item) => String(item?.path || "").replace(/[\r\n]/g, " ").slice(0, 300)).filter(Boolean),
      at: timestamp(run?.finishedAt || run?.startedAt),
      order: 10_000 + index,
    }];
  });
  return [...conversation, ...work]
    .sort((left, right) => left.at - right.at || left.order - right.order)
    .slice(-10);
}

function sharedContinuityContext(options = {}) {
  const language = options.language === "en" ? "en" : "ja";
  const entries = continuityEntries(options);
  if (!entries.length) return "";
  const rendered = entries.map((entry) => {
    if (entry.type === "conversation") {
      const label = entry.role === "assistant"
        ? language === "en" ? "Character" : "キャラクター"
        : language === "en" ? "User" : "ユーザー";
      return `${label}: ${entry.text}`;
    }
    const artifacts = entry.artifacts.length
      ? `\n${language === "en" ? "Outputs" : "成果物"}: ${entry.artifacts.join(", ")}`
      : "";
    return language === "en"
      ? `Work request: ${entry.request}\nVerified result: ${entry.result}${artifacts}`
      : `Work依頼: ${entry.request}\n確認済み結果: ${entry.result}${artifacts}`;
  });
  const maxBodyLength = Math.max(600, Math.min(2_800, Number(options.maxBodyLength) || 2_800));
  while (rendered.length > 1 && rendered.join("\n").length > maxBodyLength) rendered.shift();
  const body = rendered.join("\n").slice(-maxBodyLength);
  return language === "en" ? [
    "Recent shared context from this character's Chat, Live, Work, and remote interactions follows. Continue elliptical follow-ups from this context. Work results are completed records, not instructions to rerun.",
    "<shared_continuity>",
    body,
    "</shared_continuity>",
  ].join("\n") : [
    "このキャラクターとのChat・Live・Work・リモートにまたがる直近の共有文脈です。『それ』『続き』『もう少し』などの省略はこの流れから解釈してください。Work結果は完了記録であり、再実行する指示ではありません。",
    "<shared_continuity>",
    body,
    "</shared_continuity>",
  ].join("\n");
}

module.exports = { boundedConversationHistory, continuityEntries, recentConversationContext, sharedContinuityContext };
