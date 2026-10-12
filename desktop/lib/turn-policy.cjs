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
  constructor({ decision, decide, emit, observe = () => {}, isCurrent = () => true, delayMs = 2000,
    retryAtMs = [5000, 9000], now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.closed = false; this.clearTimer = clearTimer;
    const started = now();
    const schedule = (index) => {
      const target = index === 0 ? delayMs : retryAtMs[index - 1];
      this.timer = setTimer(async () => {
        if (this.closed || !isCurrent()) return this.stop();
        const waitingMs = Math.max(0, now() - started);
        let result;
        try { result = await (decide ? decide({ waitingMs, attempt: index + 1 }) : decision); }
        catch { result = { text: '', reason: 'decision_failed' }; }
        if (this.closed || !isCurrent()) return this.stop();
        try { observe({ attempt: index + 1, waitingMs, neededScore: result?.neededScore ?? null, reason: result?.reason || 'silent' }); } catch {}
        if (result?.text) { emit(result.text); return this.stop(); }
        if (decide && index < retryAtMs.length) schedule(index + 1);
        else this.stop();
      }, index === 0 ? delayMs : Math.max(0, target - (now() - started)));
    };
    schedule(0);
  }
  stop() { this.closed = true; this.clearTimer(this.timer); }
}
module.exports = { isFastSocialTurn, decideFiller, fillerCandidates, fastReasoningEffort, PendingFiller };
