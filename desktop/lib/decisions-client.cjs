// SPDX-License-Identifier: Apache-2.0
const { JevClient } = require('./jev-client.cjs');
const ENDPOINT = 'https://api.openai.com/v1/decisions';
const MODEL = 'gpt-6-luna';
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;

// Reuse JEV questions and thresholds; adapt only the API wire format.
class DecisionsClient extends JevClient {
  async ask(state, questions, timeoutMs = this.timeoutMs) {
    let key;
    try { key = this.getApiKey(); }
    catch { throw new Error('Decisions request failed'); }
    if (typeof key !== 'string' || !key.trim()) throw new Error('Decisions API key is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(ENDPOINT, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, input: typeof state === 'string' ? state : JSON.stringify(state),
          questions: Object.entries(questions).map(([name, question]) => {
            if (question.type === 'noul') return { name, type: 'predicate', instructions: question.instructions };
            if (question.type !== 'choice') throw new Error('Unsupported decision question');
            return { name, type: 'choice', instructions: question.instructions,
              choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description })) };
          }),
        }),
      });
      if (!response.ok) throw new Error(`Decisions HTTP ${Number(response.status) || 0}`);
      const text = await response.text();
      if (text.length > 65536) throw new Error('Invalid Decisions response');
      const result = JSON.parse(text);
      if (!Array.isArray(result?.answers)) throw new Error('Invalid Decisions response');
      const answers = Object.create(null), seen = new Set();
      for (const answer of result.answers) {
        const name = answer?.name;
        if (typeof name !== 'string' || !Object.hasOwn(questions, name) || seen.has(name)) throw new Error('Invalid Decisions response');
        seen.add(name);
        const question = questions[name];
        if (answer.type === 'refusal') continue;
        if (question.type === 'noul' && answer.type === 'predicate' && probability(answer.probability)) {
          answers[name] = { type: 'noul', noul: answer.probability };
        } else if (question.type === 'choice' && answer.type === 'choice'
          && Object.hasOwn(question.criteria, answer.choice) && Array.isArray(answer.probabilities)) {
          const probabilities = Object.create(null);
          for (const entry of answer.probabilities) {
            if (!Object.hasOwn(question.criteria, entry?.value) || Object.hasOwn(probabilities, entry.value)
              || !probability(entry.probability)) throw new Error('Invalid Decisions response');
            probabilities[entry.value] = entry.probability;
          }
          // Use the selected option's probability, not the separate confidence.
          if (Object.hasOwn(probabilities, answer.choice)) answers[name] = { type: 'choice', choice: answer.choice, probabilities };
        }
      }
      return answers;
    } catch (error) {
      // Never expose request headers, credentials or provider error bodies.
      if (/^Decisions HTTP \d+$/.test(error?.message)) throw new Error(error.message);
      throw new Error(controller.signal.aborted ? 'Decisions request timed out' : 'Decisions request failed');
    } finally { clearTimeout(timeout); }
  }
  async test() {
    const started = Date.now();
    const answers = await this.ask('Connectivity test', { ready: { type: 'noul', instructions: 'Is this a connectivity test?' } }, 5000);
    if (answers.ready?.type !== 'noul' || !probability(answers.ready.noul)) throw new Error('Decisions request failed');
    return { ok: true, latencyMs: Date.now() - started };
  }
}
module.exports = { DecisionsClient, ENDPOINT, MODEL };
