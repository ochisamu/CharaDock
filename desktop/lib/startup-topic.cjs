// SPDX-License-Identifier: Apache-2.0
const { activeCharacterMemories } = require('./character-memory.cjs');
const { continuationEligibility } = require('./continuation-summary.cjs');
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeStartupOffers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, at]) => key.length < 300 && Number.isFinite(Date.parse(at))).slice(-200));
}

function selectStartupTopic({ characterId, scopeKey, summary, memories, offers, now = Date.now() }) {
  const seen = normalizeStartupOffers(offers);
  const allowed = key => !seen[key] || now - Date.parse(seen[key]) >= COOLDOWN_MS;
  const candidates = activeCharacterMemories(memories, characterId, now)
    .filter(entry => ['recent', 'preference', 'goal'].includes(entry.category))
    .map(entry => ({ kind: 'memory', key: `${characterId}:memory:${entry.id}`, updatedAt: entry.updatedAt, memory: entry,
      // Reuse grounded generation/validation, but a memory is a topic, never an unfinished task.
      summary: { scopeType: 'character', goal: '', nextStep: entry.content, pending: [], decisions: [], completed: [], updatedAt: entry.updatedAt },
      priority: entry.category === 'recent' ? 2 : 0 }));
  if (continuationEligibility(summary, new Date(now)).eligible) candidates.push({ kind: 'continuation',
    key: `${characterId}:${scopeKey}:continuation`, updatedAt: summary.updatedAt, summary, priority: 1 });
  return candidates.filter(candidate => allowed(candidate.key))
    .sort((a, b) => b.priority - a.priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null;
}

function markStartupOffered(offers, topic, now = Date.now()) {
  return normalizeStartupOffers({ ...normalizeStartupOffers(offers), [topic.key]: new Date(now).toISOString() });
}
module.exports = { selectStartupTopic, markStartupOffered, normalizeStartupOffers, COOLDOWN_MS };
