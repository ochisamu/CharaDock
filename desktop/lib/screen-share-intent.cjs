// SPDX-License-Identifier: Apache-2.0

const { englishControlConsent, englishControlRequest } = require("./english-control-intent.cjs");

const APPROVE_PATTERN = /(?:^|[、,。.!！?？\s])(?:はい|うん|いいよ|どうぞ|お願い|許可(?:する)?|見て(?:いいよ)?|みて(?:いいよ)?|共有して)(?:$|[、,。.!！?？\s])/i;
const DENY_PATTERN = /(?:やめて|だめ|ダメ|キャンセル|共有しない|共有しなくていい|見ないで|みないで|許可しない|今はいい)/i;
const SCREEN_NOUN = "(?:この|今の|現在の|いまの)?(?:画面|デスクトップ|スクリーン|ディスプレイ|スクショ|スクリーンショット)";
const SCREEN_ACTION = "(?:見て|みて|確認して|読んで|チェックして|撮影して|撮って|キャプチャして|共有して|解析して|状態|どうなって|どう見える|何が映って|おかしい|問題)";
const SCREEN_REQUEST_PATTERNS = [
  new RegExp(`${SCREEN_NOUN}.{0,18}${SCREEN_ACTION}`),
  new RegExp(`(?:見て|みて|確認して|チェックして|撮影して|撮って|キャプチャして|共有して).{0,12}${SCREEN_NOUN}`),
];

function screenShareConversationAction(message, hasPendingRequest = false) {
  const text = String(message || "").trim().slice(0, 500);
  if (!text) return "";
  if (hasPendingRequest) {
    const consent = englishControlConsent(text);
    if (consent) return consent;
    if (DENY_PATTERN.test(text)) return "deny";
    if (text.length <= 48 && APPROVE_PATTERN.test(` ${text} `)) return "approve";
    return "replace";
  }
  return SCREEN_REQUEST_PATTERNS.some((pattern) => pattern.test(text)) || englishControlRequest(text, "screen") ? "request" : "";
}

module.exports = { screenShareConversationAction };
