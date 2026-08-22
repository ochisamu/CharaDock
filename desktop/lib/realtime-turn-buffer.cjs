// SPDX-License-Identifier: Apache-2.0

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 12_000);
}

class RealtimeTurnBuffer {
  constructor() {
    this.pendingUsers = [];
    this.pendingAssistants = [];
    this.pendingTyped = [];
    this.consumedTyped = [];
    this.nextSequence = 1;
  }

  inputEntry(text, followUp = false, sequence = null) {
    return {
      text,
      followUp: Boolean(followUp),
      sequence: Number.isFinite(sequence) ? sequence : this.nextSequence++,
    };
  }

  addTyped(text, options = {}) {
    const normalized = normalizedText(text);
    if (!normalized) return;
    // appendSpeech can emit its user transcript before its request promise
    // resolves. In that ordering addUser already queued the same turn.
    const pendingUserIndex = this.pendingUsers.findIndex((entry) => entry.text === normalized);
    if (pendingUserIndex >= 0) {
      const [pendingUser] = this.pendingUsers.splice(pendingUserIndex, 1);
      this.pendingTyped.push(this.inputEntry(normalized, options.followUp, pendingUser.sequence));
      return;
    }
    this.pendingTyped.push(this.inputEntry(normalized, options.followUp));
  }

  addUser(text, options = {}) {
    const normalized = normalizedText(text);
    if (!normalized) return null;
    const cutoff = Date.now() - 15_000;
    this.consumedTyped = this.consumedTyped.filter((entry) => entry.createdAt >= cutoff);
    const consumedIndex = this.consumedTyped.findIndex((entry) => entry.text === normalized);
    if (consumedIndex >= 0) {
      this.consumedTyped.splice(consumedIndex, 1);
      return null;
    }
    const typedIndex = this.pendingTyped.findIndex((entry) => entry.text === normalized);
    // Realtime can echo a typed request as a user transcript before the
    // assistant audio begins. Keep the typed request queued so the eventual
    // transcript remains presentation-only instead of becoming a second
    // persisted conversation turn.
    if (typedIndex >= 0) return null;
    if (this.pendingAssistants.length) return { user: normalized, assistant: this.pendingAssistants.shift(), source: "voice" };
    this.pendingUsers.push(this.inputEntry(normalized, options.followUp));
    return null;
  }

  addAssistant(text) {
    const normalized = normalizedText(text);
    if (!normalized) return null;
    const pendingInputs = () => [
      ...this.pendingUsers.map((entry) => ({ ...entry, source: "voice" })),
      ...this.pendingTyped.map((entry) => ({ ...entry, source: "typed" })),
    ].sort((left, right) => left.sequence - right.sequence);
    const removeInput = (entry) => {
      const queue = entry.source === "typed" ? this.pendingTyped : this.pendingUsers;
      const index = queue.findIndex((candidate) => candidate.sequence === entry.sequence);
      if (index >= 0) queue.splice(index, 1);
    };
    const first = pendingInputs()[0];
    if (first) {
      removeInput(first);
      const inputs = [first.text];
      const consumedTypedInputs = first.source === "typed" ? [first.text] : [];
      for (const followUp of pendingInputs()) {
        if (!followUp.followUp) break;
        removeInput(followUp);
        inputs.push(followUp.text);
        if (followUp.source === "typed") consumedTypedInputs.push(followUp.text);
      }
      if (consumedTypedInputs.length) {
        this.consumedTyped.push(...consumedTypedInputs.map((input) => ({ text: input, createdAt: Date.now() })));
        this.consumedTyped = this.consumedTyped.slice(-8);
      }
      const turn = { user: inputs.join("\n"), assistant: normalized, source: first.source };
      if (inputs.length > 1) turn.followUps = inputs.slice(1);
      return turn;
    }
    this.pendingAssistants.push(normalized);
    return null;
  }

  hasPendingInput() {
    return this.pendingUsers.length > 0 || this.pendingTyped.length > 0;
  }

  discardInput(text) {
    const normalized = normalizedText(text);
    if (!normalized) return false;
    const typedIndex = this.pendingTyped.findIndex((entry) => entry.text === normalized);
    if (typedIndex >= 0) {
      this.pendingTyped.splice(typedIndex, 1);
      return true;
    }
    const userIndex = this.pendingUsers.findIndex((entry) => entry.text === normalized);
    if (userIndex >= 0) {
      this.pendingUsers.splice(userIndex, 1);
      return true;
    }
    return false;
  }

  clear() {
    this.pendingUsers.length = 0;
    this.pendingAssistants.length = 0;
    this.pendingTyped.length = 0;
    this.consumedTyped.length = 0;
    this.nextSequence = 1;
  }
}

module.exports = { RealtimeTurnBuffer, normalizedText };
