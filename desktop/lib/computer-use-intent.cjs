// SPDX-License-Identifier: Apache-2.0

const APPROVE_PATTERN = /(?:はい|うん|いいよ|どうぞ|お願い|許可(?:する)?|操作して(?:いいよ)?|進めて|ok|okay)/i;
const DENY_PATTERN = /(?:やめて|だめ|ダメ|キャンセル|操作しない|触らないで|許可しない|今はいい)/i;
const COMPUTER_NOUN = /(?:パソコン|PC|コンピューター|Windows|Mac|macOS|デスクトップ|アプリ|ウィンドウ|メモ帳|エクスプローラー|設定画面)/i;
const COMPUTER_ACTION = /(?:操作して|操作|動かして|クリックして|押して|入力して|開いて|起動して|切り替えて|設定して|やって)/i;
const STOP_CONTINUATION_PATTERN = /(?:コンピューター|パソコン|PC|Windows|Mac|macOS|画面)?(?:の)?操作(?:は)?(?:終了|終わり|ここまで)|もう(?:操作しなくて)?いい|ストップ|やめ(?:て|る)/i;
const CONTINUATION_PATTERN = /(?:続けて|そのまま|引き続き|次に|それから|さらに|もう一度|続きを|次の|さっきの|同じ|(?:その|この)(?:ボタン|項目|欄|アプリ|ウィンドウ)|(?:右|左|上|下)の(?:ボタン|項目|欄)|そこを)/i;
const CONTINUATION_ACTION_PATTERN = /(?:操作|動か|クリック|押|入力|開|起動|切り替|設定|スクロール|キー|ボタン|項目|欄|アプリ|ウィンドウ)/i;

function computerConversationAction(message, hasPendingRequest = false) {
  const text = String(message || "").trim().slice(0, 800);
  if (!text) return "";
  if (hasPendingRequest) {
    if (DENY_PATTERN.test(text)) return "deny";
    if (text.length <= 48 && APPROVE_PATTERN.test(text)) return "approve";
    return "replace";
  }
  return COMPUTER_NOUN.test(text) && COMPUTER_ACTION.test(text) ? "request" : "";
}

function normalizeComputerToolName(value) {
  const name = String(value || "");
  return name.startsWith("computer_") ? name.slice("computer_".length) : name;
}

function computerContinuationAction(message) {
  const text = String(message || "").trim().slice(0, 800);
  if (!text) return "";
  if (STOP_CONTINUATION_PATTERN.test(text)) return "stop";
  return CONTINUATION_PATTERN.test(text) && CONTINUATION_ACTION_PATTERN.test(text) ? "continue" : "";
}

module.exports = { computerContinuationAction, computerConversationAction, normalizeComputerToolName };
