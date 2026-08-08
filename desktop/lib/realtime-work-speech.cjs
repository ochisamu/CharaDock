// SPDX-License-Identifier: Apache-2.0

function comparableSpeechText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s、。！？!?.,・「」『』（）()]/g, "")
    .toLowerCase();
}

function speechMatches(expected, actual) {
  const left = comparableSpeechText(expected);
  const right = comparableSpeechText(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

class RealtimeWorkSpeechCoordinator {
  constructor({
    appendSpeech,
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
    acknowledgementTimeoutMs = 8_000,
    transcriptTimeoutMs = 45_000,
  } = {}) {
    this.appendSpeech = typeof appendSpeech === "function" ? appendSpeech : async () => false;
    this.schedule = schedule;
    this.cancel = cancel;
    this.acknowledgementTimeoutMs = Math.max(1000, Number(acknowledgementTimeoutMs) || 8_000);
    this.transcriptTimeoutMs = Math.max(5000, Number(transcriptTimeoutMs) || 45_000);
    this.awaitingAcknowledgement = false;
    this.acknowledgementTimer = null;
    this.active = null;
    this.queue = [];
    this.pumping = false;
    this.stopped = false;
  }

  beginAcknowledgement() {
    if (this.stopped) return false;
    // A spoken follow-up is a barge-in. The Realtime service may already have
    // interrupted the previous audio response, so do not leave the prior
    // app-injected update occupying the transcript slot for the new ack.
    if (this.active) {
      if (this.active.timeout) this.cancel(this.active.timeout);
      this.settle(this.active, false);
      this.active = null;
    }
    this.cancelQueued();
    if (this.acknowledgementTimer) this.cancel(this.acknowledgementTimer);
    this.awaitingAcknowledgement = true;
    this.acknowledgementTimer = this.schedule(() => {
      this.acknowledgementTimer = null;
      this.awaitingAcknowledgement = false;
      this.pump();
    }, this.acknowledgementTimeoutMs);
    return true;
  }

  cancelAcknowledgement() {
    if (this.acknowledgementTimer) this.cancel(this.acknowledgementTimer);
    this.acknowledgementTimer = null;
    this.awaitingAcknowledgement = false;
    this.pump();
  }

  enqueue(text, kind = "update") {
    const normalized = String(text || "").trim();
    if (this.stopped || !normalized) return Promise.resolve(false);
    if (kind === "completion") {
      const retained = [];
      for (const item of this.queue) {
        if (item.kind === "progress") this.settle(item, false);
        else retained.push(item);
      }
      this.queue = retained;
    }
    return new Promise((resolve) => {
      if (kind === "progress") {
        const staleIndex = this.queue.findIndex((item) => item.kind === "progress");
        if (staleIndex >= 0) this.settle(this.queue.splice(staleIndex, 1)[0], false);
      }
      this.queue.push({ text: normalized, kind, resolve, timeout: null, settled: false });
      this.pump();
    });
  }

  settle(item, value) {
    if (!item || item.settled) return;
    item.settled = true;
    item.resolve(Boolean(value));
  }

  async pump() {
    if (this.stopped || this.pumping || this.awaitingAcknowledgement || this.active || !this.queue.length) return;
    const item = this.queue.shift();
    this.active = item;
    this.pumping = true;
    let accepted = false;
    try {
      accepted = Boolean(await this.appendSpeech(item.text));
    } catch {
      accepted = false;
    }
    this.pumping = false;
    if (this.stopped) return;
    if (this.active !== item) {
      this.pump();
      return;
    }
    if (!accepted) {
      this.settle(item, false);
      this.active = null;
      this.pump();
      return;
    }
    item.timeout = this.schedule(() => {
      if (this.active !== item) return;
      this.settle(item, false);
      this.active = null;
      this.pump();
    }, this.transcriptTimeoutMs);
  }

  assistantTranscriptDone(text) {
    if (this.active && String(text || "").trim()) {
      const completed = this.active;
      if (completed.timeout) this.cancel(completed.timeout);
      this.settle(completed, true);
      this.active = null;
      this.pump();
      return {
        kind: completed.kind,
        text: completed.text,
        transcript: String(text || "").trim(),
        matched: speechMatches(completed.text, text),
        injected: true,
      };
    }
    if (this.awaitingAcknowledgement) {
      this.cancelAcknowledgement();
      return { kind: "ack", text: String(text || "").trim(), injected: false };
    }
    return null;
  }

  cancelQueued() {
    for (const item of this.queue.splice(0)) this.settle(item, false);
  }

  stop() {
    this.stopped = true;
    this.cancelAcknowledgement();
    this.cancelQueued();
    if (this.active?.timeout) this.cancel(this.active.timeout);
    this.settle(this.active, false);
    this.active = null;
  }
}

module.exports = { RealtimeWorkSpeechCoordinator, comparableSpeechText, speechMatches };
