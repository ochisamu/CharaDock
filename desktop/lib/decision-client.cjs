// SPDX-License-Identifier: Apache-2.0
const { JevClient } = require('./jev-client.cjs');
const { DecisionsClient } = require('./decisions-client.cjs');
const { jevFailureReason } = require('./jev-debug.cjs');

// Main-process owner shared by every input surface. Preserve legacy JEV flags.
class DecisionClient extends JevClient {
  constructor({ getProvider = () => 'jev', getJevApiKey, getOpenAIApiKey, observe = () => {}, ...options } = {}) {
    super(options);
    this.getProvider = getProvider;
    this.clients = {
      jev: new JevClient({ ...options, getApiKey: getJevApiKey }),
      decisions: new DecisionsClient({ ...options, getApiKey: getOpenAIApiKey }),
    };
    this.observe = (event, detail) => { try { observe(event, detail); } catch {} };
    this.generation = 0;
  }
  provider() { return this.getProvider() === 'decisions' ? 'decisions' : 'jev'; }
  isConfigured() { return Boolean(this.clients[this.provider()].getApiKey()); }
  invalidate() { this.generation++; }
  async run(method, args) {
    const provider = this.provider(), generation = this.generation, started = Date.now();
    // Capture the actual client at dispatch. A switch while awaiting its reply
    // must not relabel the previous provider's late success or failure.
    this.observe('request-started', { provider });
    try {
      const result = await this.clients[provider][method](...args);
      if (provider !== this.provider() || generation !== this.generation) throw new Error('Decision request superseded');
      this.observe('request-succeeded', { provider, latencyMs: Date.now() - started });
      return result;
    } catch (error) {
      this.observe('request-failed', { provider, latencyMs: Date.now() - started,
        reason: error?.message === 'Decision request superseded' ? 'superseded' : jevFailureReason(error) });
      throw error;
    }
  }
  ask(state, questions, timeoutMs) { return this.run('ask', [state, questions, timeoutMs]); }
  test() { return this.run('test', []); }
}
module.exports = { DecisionClient };
