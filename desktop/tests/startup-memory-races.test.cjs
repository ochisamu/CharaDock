// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { selectStartupTopic, markStartupOffered } = require('../lib/startup-topic.cjs');
const { activeCharacterMemories, saveCharacterMemory } = require('../lib/character-memory.cjs');
const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
function harness() {
  let complete;
  const generated = new Promise(resolve => { complete = resolve; });
  const spoken = [];
  const preferences = { data: { ttsEnabled: true, onboardingComplete: true, startupTopicOffers: {},
    characterMemories: saveCharacterMemory({}, 'a', { content: '将棋を始めた', category: 'recent' }).memoriesByCharacter },
    patch(values) { Object.assign(this.data, values); } };
  const ctx = vm.createContext({ preferences, process: { argv: [] }, codexCompanion: { state: {} }, companionTransitioning: false,
    activeCharacter: () => ({ id: 'a' }), currentContinuationScope: () => ({ key: 'common', type: 'character' }),
    continuationSummary: () => null, currentContinuationSummary: () => null,
    selectStartupTopic, markStartupOffered, startupContinuationAttempts: new Set(), startupContinuationMessages: new Map(),
    conversationHistory: Array.from({ length: 40 }, () => ({ text: 'old' })),
    characterMemories: id => activeCharacterMemories(preferences.data.characterMemories, id),
    generateStartupContinuationMessage: () => generated, continuationFallbackMessage: () => '', interfaceLanguage: () => 'ja',
    activeWorkRunId: '', activeRealtimeStarting: false, currentRealtimeClient: () => null, codexClient: null,
    diagnosticLog: null, rememberAssistantAnnouncement: text => spoken.push(text), showMascotSpeech: () => {},
  });
  vm.runInContext(main.slice(main.indexOf('async function maybeOfferStartupContinuation('), main.indexOf('function scheduleStartupContinuation(')), ctx);
  return { ctx, complete, spoken, preferences };
}
test('startup greeting cannot overtake a conversation whose bounded history length stayed at forty', async () => {
  const h = harness(), pending = h.ctx.maybeOfferStartupContinuation();
  h.ctx.conversationHistory = Array.from({ length: 40 }, () => ({ text: 'new' }));
  h.complete('将棋はその後どう？');
  assert.equal(await pending, false); assert.equal(h.spoken.length, 0);
  assert.deepEqual(h.preferences.data.startupTopicOffers, {});
});
test('forgetting a topic while its startup greeting generates suppresses the late speech', async () => {
  const h = harness(), pending = h.ctx.maybeOfferStartupContinuation();
  h.preferences.data.characterMemories = {};
  h.complete('将棋はその後どう？');
  assert.equal(await pending, false); assert.equal(h.spoken.length, 0);
});
test('successful grounded startup speech records a persistent cooldown; failure does not invent a task', async () => {
  for (const valid of [true, false]) {
    const h = harness(), pending = h.ctx.maybeOfferStartupContinuation();
    h.complete(valid ? '将棋はその後どう？' : '');
    assert.equal(await pending, valid);
    assert.equal(h.spoken.length, valid ? 1 : 0);
    assert.equal(Object.keys(h.preferences.data.startupTopicOffers).length > 0, valid);
    h.ctx.startupContinuationAttempts.clear();
    if (valid) assert.equal(await h.ctx.maybeOfferStartupContinuation(), false);
  }
});

test('Link cannot offer a cached greeting after its continuation was cleared or changed', () => {
  const cache = new Map([['a:common', { text: '作業の続きはどう？', summaryUpdatedAt: 'old' }]]);
  const ctx = vm.createContext({ preferences: { data: { onboardingComplete: true } },
    activeCharacter: () => ({ id: 'a' }), currentContinuationScope: () => ({ key: 'common' }),
    startupContinuationMessages: cache, characterMemories: () => [], continuationSummary: () => null,
    continuationEligibility: summary => ({ eligible: Boolean(summary) }),
    remoteStartupGreetingAttempts: new Set(), createHash: require('node:crypto').createHash, appSessionStartedAt: 1,
    mobileTtsAvailable: () => false, characterTtsSettings: () => ({}), remotePublicText: text => text,
  });
  vm.runInContext(main.slice(main.indexOf('function remoteStartupGreeting('), main.indexOf('function publicTurnState(')), ctx);
  assert.equal(ctx.remoteStartupGreeting({ tokenHash: 'test' }), null);
  ctx.continuationSummary = () => ({ updatedAt: 'new' });
  assert.equal(ctx.remoteStartupGreeting({ tokenHash: 'test' }), null);
  ctx.continuationSummary = () => ({ updatedAt: 'old' });
  assert.equal(ctx.remoteStartupGreeting({ tokenHash: 'test' }).text, '作業の続きはどう？');
});
