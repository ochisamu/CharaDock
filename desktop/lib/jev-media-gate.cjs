// SPDX-License-Identifier: Apache-2.0
// One operation per final user utterance, shared by the fast route and native
// tool handoff. Never retry an uncertain skip or infer a player identifier.
class JevMediaGate {
  constructor({ classify, execute, enabled = () => true }) {
    this.classify = classify; this.execute = execute; this.enabled = enabled;
    this.serial = 0; this.current = null; this.turns = new Map();
    this.pending = new Set(); this.closed = false; this.hasExecution = false;
  }
  begin() {
    const ticket = { id: `jev-${++this.serial}`, action: null, execution: null, finished: false };
    ticket.cancelled = this.closed || Boolean(this.unboundExecution);
    if (this.unboundExecution) {
      ticket.execution = this.unboundExecution.execution;
      ticket.command = this.unboundExecution.command;
    }
    this.unboundExecution = null;
    ticket.ready = new Promise(resolve => { ticket.resolve = resolve; });
    if (ticket.cancelled) ticket.resolve(null);
    else {
      this.pending.add(ticket);
      ticket.timer = setTimeout(() => { ticket.cancelled = true; ticket.resolve(null); this.pending.delete(ticket); }, 15000);
      ticket.timer.unref?.();
    }
    this.current = ticket;
    return ticket;
  }
  bind(turnId) {
    if (turnId && this.current && !this.turns.has(turnId)) this.turns.set(turnId, this.current);
    while (this.turns.size > 128) this.turns.delete(this.turns.keys().next().value);
  }
  async finish(text, ticket = this.current || this.begin()) {
    if (ticket.finished) return ticket.completion;
    ticket.finished = true;
    ticket.completion = this.finishTicket(text, ticket);
    return ticket.completion;
  }
  async finishTicket(text, ticket) {
    try {
      ticket.action = !ticket.cancelled && !this.closed && this.enabled() ? await this.classify(text) : null;
      if (!this.enabled() || ticket.cancelled || this.closed) ticket.action = null;
    } catch { ticket.action = null; }
    clearTimeout(ticket.timer); this.pending.delete(ticket); ticket.resolve(ticket.action);
    if (!ticket.action) return null;
    ticket.result = await this.run(ticket, { action: ticket.action });
    return ticket.result;
  }
  run(ticket, args) {
    return this.claim(ticket, args, () => ticket.cancelled || !this.enabled()
      ? { ok: false, reason: "jev-cancelled" }
      : this.execute(args, ticket.id));
  }
  claim(ticket, args, operation) {
    const command = JSON.stringify([args?.action, args?.playerId || ""]);
    if (ticket.execution && ticket.command !== command) return Promise.resolve({ ok: false, reason: "jev-command-already-resolved" });
    if (!ticket.execution) {
      this.hasExecution = true;
      ticket.command = command;
      ticket.execution = Promise.resolve().then(() => this.closed
        ? { ok: false, reason: "jev-cancelled" }
        : operation()).catch(() => ({ ok: false, reason: "media-operation-failed", outcomeUnknown: true }));
    }
    return ticket.execution;
  }
  async tool(args, turnId, fallback) {
    if (this.closed) return { ok: false, reason: "jev-cancelled" };
    if (args?.action === "list") return fallback();
    const ticket = this.turns.get(turnId);
    if (!ticket) {
      // A native handoff without a correlatable turn must not double a fast
      // action. Fail closed; the model may report the existing receipt.
      // Once any operation has been reserved, an unknown turn could be its
      // delayed duplicate, even after current changes or the turn is evicted.
      // Multiple pending utterances likewise cannot be correlated safely.
      if (this.hasExecution || this.current?.action || this.pending.size > 1) return { ok: false, reason: "uncorrelated-jev-handoff" };
      if (this.current) {
        this.current.cancelled = true; clearTimeout(this.current.timer); this.current.resolve(null);
        this.pending.delete(this.current);
        return this.claim(this.current, args, fallback);
      }
      this.unboundExecution = {};
      return this.claim(this.unboundExecution, args, fallback);
    }
    const action = await ticket.ready;
    if (this.closed) return { ok: false, reason: "jev-cancelled" };
    if (!action) return this.claim(ticket, args, fallback);
    if (args?.action !== action || args?.playerId) return { ok: false, reason: "jev-command-already-resolved" };
    return this.run(ticket, { action });
  }
  close() {
    this.closed = true;
    for (const ticket of new Set([...this.pending, ...this.turns.values(), this.current])) {
      if (ticket) { ticket.cancelled = true; clearTimeout(ticket.timer); ticket.resolve(null); }
    }
    this.current = null; this.turns.clear(); this.pending.clear(); this.unboundExecution = null;
  }
}
module.exports = { JevMediaGate };
