// SPDX-License-Identifier: Apache-2.0

const APPROVE_PATTERN = /(?:はい|うん|いいよ|どうぞ|お願い|許可(?:する)?|開いて(?:いいよ)?|見て(?:いいよ)?|みて(?:いいよ)?|ok|okay)/i;
const DENY_PATTERN = /(?:やめて|だめ|ダメ|キャンセル|開かない|使わない|許可しない|今はいい)/i;
const STOP_CONTINUATION_PATTERN = /(?:ブラウザ(?:ー)?(?:操作|利用)?(?:は)?(?:終了|終わり)|操作(?:は)?ここまで|もう(?:ブラウザ(?:ー)?を)?使わない|もういい|閉じて|やめ(?:て|る))/i;
const CONTINUATION_PATTERN = /(?:続けて|そのまま|引き続き|次に|それから|さらに|もう一度|続きを|次の|さっきの|同じ|(?:その|この)(?:ページ|サイト|リンク|ボタン|項目|欄)|(?:最初|最後|[一二三四五]|[1-9])つ?目の(?:リンク|ボタン|項目)|(?:右|左|上|下)の(?:リンク|ボタン|項目)|下へ|上へ|戻って)/i;
const CONTINUATION_ACTION_PATTERN = /(?:ブラウザ|サイト|ページ|リンク|ボタン|項目|欄|タブ|検索|開|押|クリック|入力|選択|スクロール|戻|進|読|見|確認|操作)/i;

function normalizeBrowserUrl(raw) {
  let value = String(raw || "").trim().replace(/[、。）」』】>,]+$/g, "");
  if (!value) return null;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(value)) value = `http://${value}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
  url.hash = "";
  return url;
}

function extractBrowserTarget(message) {
  const text = String(message || "");
  const explicit = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (explicit) return normalizeBrowserUrl(explicit);
  const domain = text.match(/(?:localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/i)?.[0];
  return domain ? normalizeBrowserUrl(domain) : null;
}

function comparableHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

function isAllowedBrowserUrl(rawUrl, allowedHost) {
  const url = rawUrl instanceof URL ? rawUrl : normalizeBrowserUrl(rawUrl);
  return Boolean(url && comparableHost(url.hostname) === comparableHost(allowedHost));
}

function normalizeBrowserToolName(value) {
  const name = String(value || "");
  return name.startsWith("browser_") ? name.slice("browser_".length) : name;
}

function browserLoadErrorMessage({ allowedHost = "", blockedUrl = "", error = null } = {}) {
  const blocked = normalizeBrowserUrl(blockedUrl);
  if (blocked && allowedHost && !isAllowedBrowserUrl(blocked, allowedHost)) {
    return `許可したサイト「${allowedHost}」から別のサイト「${blocked.hostname}」へ移動しようとしたため停止しました。移動先を開く場合は、改めてそのサイトを指定してください。`;
  }
  const code = String(error?.code || error?.errno || "").trim();
  const detail = String(error?.message || "").replace(/^Error:\s*/i, "").trim();
  return `ページを開けませんでした${code ? `（${code}）` : ""}${detail ? `: ${detail}` : "。URL、ネットワーク、サイト側の制限を確認してください。"}`;
}

function browserConversationAction(message, hasPendingRequest = false) {
  const text = String(message || "").trim().slice(0, 800);
  if (!text) return "";
  if (hasPendingRequest) {
    if (DENY_PATTERN.test(text)) return "deny";
    if (text.length <= 48 && APPROVE_PATTERN.test(text)) return "approve";
    return "replace";
  }
  const explicitBrowserMentioned = /(?:ブラウザ|browser|URL|リンク)/i.test(text);
  const siteMentioned = /(?:ウェブ|web|サイト|ホームページ)/i.test(text);
  const browserAction = /(?:開いて|開く|見て|みて|確認して|読んで|調べて|検索して|探して|閲覧して|アクセスして|移動して|操作して|操作|使って|起動して)/i.test(text);
  const localArtifactMentioned = !/https?:\/\//i.test(text)
    && /(?:^|[\s"'`/\\])[^\s"'`/\\]+\.(?:html?|css|js|cjs|mjs|ts|tsx|jsx|json|md|pdf|png|jpe?g|webp|svg|wav|mp3)(?=$|[\s、。"'`をのにへでと])/i.test(text);
  const artifactAuthoring = localArtifactMentioned
    && /(?:作って|作る|作成|生成|実装|更新|修正|直して|書いて|保存|変換|連携)/i.test(text);
  const target = extractBrowserTarget(text);
  const fileLikeHostname = Boolean(target)
    && /\.(?:html?|css|js|cjs|mjs|ts|tsx|jsx|json|md|pdf|png|jpe?g|webp|svg|wav|mp3)$/i.test(target.hostname);
  const explicitTarget = Boolean(target) && (Boolean(text.match(/https?:\/\//i)) || !fileLikeHostname);
  const browserMentioned = explicitBrowserMentioned || (siteMentioned && !artifactAuthoring);
  return (browserMentioned || explicitTarget) && browserAction ? "request" : "";
}

function browserContinuationAction(message) {
  const text = String(message || "").trim().slice(0, 800);
  if (!text) return "";
  if (STOP_CONTINUATION_PATTERN.test(text)) return "stop";
  return CONTINUATION_PATTERN.test(text) && CONTINUATION_ACTION_PATTERN.test(text) ? "continue" : "";
}

module.exports = {
  browserConversationAction,
  browserContinuationAction,
  comparableHost,
  extractBrowserTarget,
  browserLoadErrorMessage,
  isAllowedBrowserUrl,
  normalizeBrowserToolName,
  normalizeBrowserUrl,
};
