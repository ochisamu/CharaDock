// SPDX-License-Identifier: Apache-2.0
class JevAddressGate {
  constructor({ classify, enabled, mode, context, now = Date.now, observe = () => {} }) {
    Object.assign(this, { classify, enabled, mode, context, now, observe });
    this.recent = null;
    this.busy = new Set();
    this.livingTurns = new Map();
    this.generation = 0;
  }
  reset() {
    this.generation++;
    this.recent = null;
    this.livingTurns.clear();
  }
  remember(text, { userText = '' } = {}) {
    this.recent = { context: this.context(), text: String(text || '').slice(0, 600), at: this.now() };
    // Only an admitted handsfree turn on this input can open its reply window.
    // A manual PC conversation must not wake an unattended RLCD/ATOM Echo.
    for (const [source, turn] of this.livingTurns) {
      if (this.mode() !== 'living' || turn.context !== this.context() || this.now() - turn.at >= 180000) {
        this.livingTurns.delete(source);
      } else if (turn.pending && String(userText).trim() === turn.userText) {
        turn.reply = this.recent.text;
        turn.replyAt = this.recent.at;
        turn.pending = false;
      }
    }
  }
  async check(text, { handsfree = false, source = 'desktop' } = {}) {
    const mode = this.mode();
    if (!handsfree || mode === 'off') return { accepted: true, reason: 'bypass' };
    const started = this.now();
    const finish = (accepted, reason) => {
      this.observe('address-classified', { accepted, reason, latencyMs: this.now() - started });
      return { accepted, reason };
    };
    if (!this.enabled()) return finish(false, 'unavailable');
    if (!String(text || '').trim()) return finish(false, 'empty');
    if (this.busy.has(source)) return finish(false, 'busy');
    const context = this.context();
    const generation = this.generation;
    const recent = this.recent;
    const turn = this.livingTurns.get(source);
    const previousReply = mode === 'living'
      ? turn?.context === context && this.now() - turn.replyAt < 15000 ? turn.reply || '' : ''
      : recent?.context === context && this.now() - recent.at < (mode === 'strict' ? 15000 : 30000) ? recent.text : '';
    this.busy.add(source);
    try {
      const result = await this.classify(text, { mode, character: context, previousReply });
      if (generation !== this.generation || context !== this.context() || mode !== this.mode() || !this.enabled()) return finish(false, 'stale');
      if (result === 'non_speech' || result === 'unclear_speech') return finish(false, result);
      const valid = ['greeting', 'addressed', 'reply', 'unrelated', 'uncertain'].includes(result);
      if (!valid) return finish(false, 'unavailable');
      // Standard is a veto AFTER VAD/ASR, not a wake-word replacement.
      const accepted = mode === 'standard' ? result !== 'unrelated'
        : result === 'greeting' || result === 'addressed' || (result === 'reply' && Boolean(previousReply));
      if (accepted && mode === 'living') {
        this.livingTurns.set(source, { ...(turn?.context === context ? turn : {}), context,
          userText: String(text).trim(), at: this.now(), pending: true });
      }
      return finish(accepted, result);
    } catch { return finish(false, 'unavailable'); }
    finally { this.busy.delete(source); }
  }
}
module.exports = { JevAddressGate };
