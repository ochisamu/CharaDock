// SPDX-License-Identifier: Apache-2.0
const { isSocialConversationTurn, normalizedSocialText } = require('./interaction-intent.cjs');
const { fillerCandidates, decideFiller } = require('./contextual-filler.cjs');

// Context-sensitive confirmations must retain the configured reasoning effort.
function isFastSocialTurn(text, { previousReply = '', hasAttachments = false, hasTools = false } = {}) {
  const value = normalizedSocialText(text);
  return !hasAttachments && !hasTools && isSocialConversationTurn(value)
    && !/[?？]|(?:していい|してよい|してもいい|確認して|確認ください)|\b(?:confirm|approve|shall I|may I)\b/iu.test(previousReply)
    && !value.split(/[、,。.!！?？\n]+/u).some(clause => /^(?:はい|うん|ううん|いいえ|了解|承知|わかった|分かった|ok|okay|いいね|そうだね|なるほど|たしかに|確かに)/iu.test(clause.trim()));
}

function fastReasoningEffort(model, supported = []) {
  const efforts = supported.map(item => typeof item === 'string' ? item : item.reasoningEffort).filter(Boolean);
  if (efforts.length) return efforts.includes('none') ? 'none' : efforts.includes('low') ? 'low' : undefined;
  if (/^gpt-6-(?:sol|luna)(?:$|-)/i.test(model)) return 'none';
  if (/^gpt-6(?:\.1)?-(?:astra|sol)(?:$|-)/i.test(model)) return 'low';
  return undefined;
}

class PendingFiller {
  constructor({ decision, emit, isCurrent = () => true, delayMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.closed = false;
    this.clearTimer = clearTimer;
    this.timer = setTimer(async () => {
      const result = await Promise.resolve(decision).catch(() => null);
      if (!this.closed && isCurrent() && result?.text) emit(result.text);
      this.stop();
    }, delayMs);
  }
  stop() { this.closed = true; this.clearTimer(this.timer); }
}
module.exports = { isFastSocialTurn, decideFiller, fillerCandidates, fastReasoningEffort, PendingFiller };
