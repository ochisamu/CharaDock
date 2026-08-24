// SPDX-License-Identifier: Apache-2.0

const THEMES = new Set(["calm", "bright", "minimal"]);
const DELIVERIES = new Set(["text", "live"]);

function cleanGoal(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function normalizeOnboardingFirstWork(payload = {}) {
  const goal = cleanGoal(payload.goal);
  if (!goal) throw new Error("最初に取り組みたいことを入力してください。");
  const theme = THEMES.has(String(payload.theme || "")) ? String(payload.theme) : "calm";
  const delivery = DELIVERIES.has(String(payload.delivery || "")) ? String(payload.delivery) : "text";
  return { goal, theme, delivery };
}

function buildOnboardingFirstWorkPrompt({ goal, theme }, language = "ja") {
  const normalizedGoal = cleanGoal(goal);
  const normalizedTheme = THEMES.has(String(theme || "")) ? String(theme) : "calm";
  const themeLabels = language === "en"
    ? { calm: "calm and focused", bright: "bright and encouraging", minimal: "minimal and quiet" }
    : { calm: "落ち着いて集中しやすい", bright: "明るく前向きな", minimal: "静かでミニマルな" };

  if (language === "en") {
    return [
      `Let's make a useful first output together. My current goal is: “${normalizedGoal}”.`,
      "Create `artifacts/charadock-start.html` in Character Home as a polished personal start board for that goal.",
      `Use a ${themeLabels[normalizedTheme]} visual direction. Make it a self-contained offline HTML file with embedded CSS and JavaScript only—no CDN or network access.`,
      "Include the stated goal, one conservative first action, an editable checklist, and a notes area saved with localStorage. Clearly distinguish user-stated facts from your suggestions and do not invent progress.",
      "Open or inspect the finished file to verify that it renders, then report the result briefly and expose the HTML as the output to preview.",
    ].join("\n");
  }

  return [
    `最初の成果物を一緒に作りたいです。いまの目的は「${normalizedGoal}」です。`,
    "キャラクターホームの `artifacts/charadock-start.html` に、この目的のための自分専用スタートボードを作ってください。",
    `雰囲気は「${themeLabels[normalizedTheme]}」方向にして、CSSとJavaScriptを埋め込んだオフライン完結のHTMLにしてください。CDNや外部通信は使わないでください。`,
    "目的、無理のない最初の一手、編集できるチェックリスト、localStorageへ保存するメモ欄を入れてください。私が伝えた事実と提案を区別し、未確認の進捗は作らないでください。",
    "完成後は実際に開くか内容を確認して表示を検証し、短く報告して、HTMLをプレビューできる成果物として示してください。",
  ].join("\n");
}

module.exports = {
  buildOnboardingFirstWorkPrompt,
  cleanGoal,
  normalizeOnboardingFirstWork,
};
