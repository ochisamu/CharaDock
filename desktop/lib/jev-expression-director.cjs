// SPDX-License-Identifier: Apache-2.0
// Latest-only, bounded concurrency; late classification never changes a new
// character/utterance. Classification never owns mouth or blink state.
const { jevFailureReason } = require("./jev-debug.cjs");
class JevExpressionDirector {
  constructor({ classify, enabled, context, apply, now = Date.now, observe = () => {} }) {
    Object.assign(this, { classify, enabled, context, apply, now });
    this.observe = (event, detail) => { try { observe(event, detail); } catch {} };
    this.sequence = 0; this.running = false; this.pending = null; this.last = null;
    this.prepared = new Map(); this.prepareEpoch = 0; this.prepareTail = Promise.resolve(); this.prepareCount = 0;
  }
  cancel() { this.sequence++; this.pending = null; this.last = null; this.prepareEpoch++; this.prepared.clear(); }
  async prepare(text) {
    if (!this.enabled() || !String(text || '').trim() || this.prepareCount >= 3) return null;
    const epoch = this.prepareEpoch, context = this.context();
    this.prepareCount++;
    const job = this.prepareTail.then(async () => {
      if (epoch !== this.prepareEpoch || context !== this.context() || !this.enabled()) return null;
      const started = this.now();
      this.observe('expression-started', { source: 'assistant' });
      try {
        const expression = await this.classify(String(text).slice(0, 1200), { source: 'assistant' });
        const detail = { ...expression, source: 'assistant', latencyMs: this.now() - started };
        this.observe('expression-classified', detail);
        if (epoch !== this.prepareEpoch || context !== this.context() || !this.enabled()) return null;
        for (const [key, value] of this.prepared) if (this.now() - value.at > 60000) this.prepared.delete(key);
        while (this.prepared.size >= 8) this.prepared.delete(this.prepared.keys().next().value);
        const id = require('node:crypto').randomUUID();
        this.prepared.set(id, { expression, detail, context, at: this.now() });
        return id;
      } catch (error) {
        this.observe('expression-failed', { reason: jevFailureReason(error), latencyMs: this.now() - started });
        return null;
      }
    });
    this.prepareTail = job.catch(() => null);
    try { return await job; } finally { this.prepareCount--; }
  }
  activate(id) {
    // Playback, not speculative preparation, supersedes the previous reaction.
    this.sequence++; this.pending = null; this.last = null;
    const job = this.prepared.get(id); this.prepared.delete(id);
    if (!job || !this.enabled() || job.context !== this.context() || this.now() - job.at > 60000) return false;
    const expression = job.expression;
    if (!expression) return false;
    if (expression.emotion === null && !['nod','ponder','celebrate','recoil','reassure','explain'].includes(expression.nikePerformance)) {
      this.observe('expression-skipped', { ...job.detail, reason: 'uncertain' });
      return true; // A valid abstention preserves the current face, not a legacy reset.
    }
    const result = { ...expression, forceMouth: null, forceEyesClosed: null };
    if (expression.emotion === null) { delete result.emotion; delete result.reaction; }
    this.apply(result);
    this.observe('expression-applied', job.detail);
    return true;
  }
  request(text, options = {}) {
    if (!this.enabled() || !String(text || "").trim()) {
      this.observe("expression-skipped", { reason: this.enabled() ? "empty" : "disabled" });
      this.cancel(); return;
    }
    const context = this.context();
    const value = String(text).slice(0, 1200);
    const source = options.source === "user" ? "user" : "assistant";
    if (this.last?.text === value && this.last.source === source && this.last.context === context && this.now() - this.last.at < 5000) {
      this.observe("expression-skipped", { reason: "duplicate" }); return;
    }
    this.last = { text: value, source, context, at: this.now() };
    if (this.pending) this.observe("expression-skipped", { reason: "superseded" });
    this.pending = { text: value, source, context, sequence: ++this.sequence };
    if (!this.running) void this.drain();
  }
  async drain() {
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending; this.pending = null;
        const started = this.now();
        this.observe("expression-started", { source: job.source });
        try {
          const expression = await this.classify(job.text, { source: job.source });
          const detail = { source: job.source, emotion: expression?.emotion, reaction: expression?.reaction, nikePerformance: expression?.nikePerformance, latencyMs: this.now() - started };
          this.observe("expression-classified", detail);
          if (this.enabled() && this.context() === job.context && this.sequence === job.sequence) {
            if (expression?.emotion === null) {
              if (["nod", "ponder", "celebrate", "recoil", "reassure", "explain"].includes(expression.nikePerformance)) {
                this.apply({ nikePerformance: expression.nikePerformance, forceMouth: null, forceEyesClosed: null });
                this.observe("expression-applied", detail);
                continue;
              }
              this.observe("expression-skipped", { ...detail, reason: "uncertain" });
              continue;
            }
            this.apply({ ...expression, forceMouth: null, forceEyesClosed: null });
            this.observe("expression-applied", detail);
          } else this.observe("expression-skipped", { ...detail, reason: "stale" });
        } catch (error) {
          this.observe("expression-failed", { reason: jevFailureReason(error), latencyMs: this.now() - started });
        }
      }
    } finally { this.running = false; }
  }
}
module.exports = { JevExpressionDirector };
