// SPDX-License-Identifier: Apache-2.0
class JevAddressGate {
  constructor({ classify, enabled, mode, context, now = Date.now, observe = () => {} }) {
    Object.assign(this, { classify, enabled, mode, context, now, observe });
    this.recent = null;
    this.busy = new Set();
  }
  remember(text) {
    this.recent = { context: this.context(), text: String(text || '').slice(0, 600), at: this.now() };
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
    const recent = this.recent;
    const previousReply = recent?.context === context && this.now() - recent.at < (mode === 'strict' ? 15000 : 30000) ? recent.text : '';
    this.busy.add(source);
    try {
      const result = await this.classify(text, { mode, character: context, previousReply });
      if (context !== this.context() || mode !== this.mode() || !this.enabled()) return finish(false, 'stale');
      if (result === 'non_speech' || result === 'unclear_speech') return finish(false, result);
      const valid = ['greeting', 'addressed', 'reply', 'unrelated', 'uncertain'].includes(result);
      if (!valid) return finish(false, 'unavailable');
      // Standard is a veto AFTER VAD/ASR, not a wake-word replacement.
      const accepted = mode === 'standard' ? result !== 'unrelated'
        : result === 'greeting' || result === 'addressed' || (result === 'reply' && Boolean(previousReply));
      return finish(accepted, result);
    } catch { return finish(false, 'unavailable'); }
    finally { this.busy.delete(source); }
  }
}
module.exports = { JevAddressGate };
