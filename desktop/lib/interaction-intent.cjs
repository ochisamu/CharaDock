// SPDX-License-Identifier: Apache-2.0

function normalizedSocialText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function isSocialClause(value) {
  const text = normalizedSocialText(value)
    .replace(/^[\s、。,.!！?？〜～ー・]+|[\s、。,.!！?？〜～ー・]+$/gu, "")
    .trim();
  if (!text) return true;
  return /^(?:おはよう(?:ございます)?|こんにちは|こんちは|こんばんは|やっほー?|やあ|どうも|ありがとう(?:ございます|ございました)?(?:ね)?|ありがと(?:ね)?|どういたしまして|サンキュー|thanks?|thank\s+you|ごめん(?:なさい)?|すみません|すいません|sorry|お疲れ(?:さま|様)?(?:です|でした)?|おつかれ(?:さま)?|おつ|またね|じゃあね|ばいばい|さようなら|おやすみ(?:なさい)?|よろしく(?:お願いします)?|元気(?:ですか)?|調子(?:は)?どう|はい|うん|ううん|いいえ|了解|承知(?:しました)?|わかった|分かった|ok(?:ay)?|オーケー|いいね|そうだね|なるほど|たしかに|確かに)$/iu.test(text);
}

function isSocialConversationTurn(value) {
  const text = normalizedSocialText(value);
  if (!text || text.length > 80) return false;
  const clauses = text.split(/[、,。.!！?？\n]+/u).map((part) => part.trim()).filter(Boolean);
  return Boolean(clauses.length && clauses.every(isSocialClause));
}

module.exports = { isSocialConversationTurn, normalizedSocialText };
