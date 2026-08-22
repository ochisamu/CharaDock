// SPDX-License-Identifier: Apache-2.0

function boundedConversationHistory(history, userText, assistantText) {
  const previous = Array.isArray(history) ? history : [];
  const normalizedUser = String(userText || "").replace(/\s+/g, " ").trim();
  const normalizedAssistant = String(assistantText || "").replace(/\s+/g, " ").trim();
  const lastUser = previous.at(-2);
  const lastAssistant = previous.at(-1);
  const lastTimestamp = Date.parse(String(lastAssistant?.createdAt || lastUser?.createdAt || ""));
  const recentlyRecorded = Number.isFinite(lastTimestamp) && Date.now() - lastTimestamp < 60_000;
  if (recentlyRecorded
    && lastUser?.role === "user"
    && lastAssistant?.role === "assistant"
    && String(lastUser.text || "").replace(/\s+/g, " ").trim() === normalizedUser
    && String(lastAssistant.text || "").replace(/\s+/g, " ").trim() === normalizedAssistant) {
    return previous.slice(-40);
  }
  const createdAt = new Date().toISOString();
  return [
    ...previous,
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

function continuityEntries({ conversationHistory = [], workHistory = [], characterId = "", workspaceKey = "", since = 0, limit = 10 } = {}) {
  const minimumTimestamp = Math.max(0, Number(since) || 0);
  const maximumEntries = Math.max(1, Math.min(60, Number(limit) || 10));
  const conversation = (Array.isArray(conversationHistory) ? conversationHistory : []).map((entry, index) => ({
    type: "conversation",
    role: entry?.role === "assistant" ? "assistant" : "user",
    text: String(entry?.text || "").replace(/\s+/g, " ").trim().slice(0, 600),
    at: timestamp(entry?.createdAt),
    order: index,
  })).filter((entry) => entry.text && (!minimumTimestamp || entry.at >= minimumTimestamp));
  const work = (Array.isArray(workHistory) ? workHistory : []).flatMap((run, index) => {
    // Work is always project-scoped. With no active workspace, returning no
    // Work is safer than mixing tasks from every project for this character.
    if (!workspaceKey) return [];
    if (run?.status !== "completed") return [];
    if (characterId && run?.characterId && run.characterId !== characterId) return [];
    if (workspaceKey && run?.workspaceKey !== workspaceKey) return [];
    const request = String(run?.request || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const result = String(run?.result || "").replace(/\s+/g, " ").trim().slice(0, 800);
    const at = timestamp(run?.finishedAt || run?.startedAt);
    if ((!request && !result) || (minimumTimestamp && at < minimumTimestamp)) return [];
    return [{
      type: "work",
      request,
      result,
      artifacts: (Array.isArray(run?.artifacts) ? run.artifacts : []).slice(0, 4).map((item) => String(item?.path || "").replace(/[\r\n]/g, " ").slice(0, 300)).filter(Boolean),
      at,
      order: 10_000 + index,
    }];
  });
  return [...conversation, ...work]
    .sort((left, right) => left.at - right.at || left.order - right.order)
    .slice(-maximumEntries);
}

function searchContinuityEntries(options = {}) {
  const query = String(options.query || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const resultLimit = Math.max(1, Math.min(10, Number(options.resultLimit) || 6));
  const entries = continuityEntries({ ...options, limit: 60 });
  if (!query) return entries.slice(-resultLimit).reverse();
  const terms = [...new Set(query.split(/[\s、。,.!?！？/]+/).filter(Boolean))];
  return entries.map((entry) => {
    const haystack = (entry.type === "work"
      ? `${entry.request}\n${entry.result}\n${entry.artifacts.join("\n")}`
      : entry.text).toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), haystack.includes(query) ? 4 : 0);
    return { entry, score };
  }).filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.at - left.entry.at)
    .slice(0, resultLimit)
    .map((candidate) => candidate.entry);
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

function unfinishedWorkContext(options = {}) {
  const language = options.language === "en" ? "en" : "ja";
  const characterId = String(options.characterId || "");
  const workspaceKey = String(options.workspaceKey || "");
  if (!workspaceKey) return "";
  const resumableStatuses = new Set(["running", "stopping", "interrupted"]);
  const latest = (Array.isArray(options.workHistory) ? options.workHistory : [])
    .filter((run) => resumableStatuses.has(String(run?.status || "")))
    .filter((run) => !characterId || !run?.characterId || run.characterId === characterId)
    .filter((run) => run?.workspaceKey === workspaceKey)
    .sort((left, right) => timestamp(right?.finishedAt || right?.startedAt) - timestamp(left?.finishedAt || left?.startedAt))[0];
  if (!latest) return "";
  const request = String(latest.request || "").replace(/\s+/g, " ").trim().slice(0, 900);
  if (!request) return "";
  const latestActivity = String(Array.isArray(latest.activities) ? latest.activities.at(-1) || "" : "")
    .replace(/\s+/g, " ").trim().slice(0, 240);
  if (language === "en") return [
    "The following is the latest unverified Work request from this character in the current workspace. Its previous Live connection ended before completion was verified.",
    "Use it only to understand references such as 'continue' or 'from before'. Never claim it completed, and do not resume it automatically without the user's request. If resuming, inspect the current files and actual state first.",
    "<unfinished_work>",
    `Request: ${request}`,
    ...(latestActivity ? [`Last observed activity: ${latestActivity}`] : []),
    "Status: unfinished and unverified",
    "</unfinished_work>",
  ].join("\n");
  return [
    "同じキャラクター・現在の作業フォルダーに紐づく、直前の未検証Workです。前回のLive接続は完了確認前に終了しました。",
    "『続き』『さっきの作業』などを解釈する参考にだけ使ってください。完了したとは言わず、ユーザーの依頼なしに自動再開もしないでください。再開時は、現在のファイルと実際の状態を先に確認してください。",
    "<unfinished_work>",
    `依頼: ${request}`,
    ...(latestActivity ? [`最後に確認できた進捗: ${latestActivity}`] : []),
    "状態: 未完了・未検証",
    "</unfinished_work>",
  ].join("\n");
}

module.exports = { boundedConversationHistory, continuityEntries, recentConversationContext, searchContinuityEntries, sharedContinuityContext, unfinishedWorkContext };
