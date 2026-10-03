// SPDX-License-Identifier: Apache-2.0
// Explicit opt-in per built-in character; never enable custom avatars by name.
const FLAGS = Object.freeze({ 'nike-avatar': 'jevNikePerformanceEnabled', 'amber-avatar': 'jevKohakuPerformanceEnabled' });
const KOHAKU_EMOTIONS = Object.freeze(['neutral', 'happy', 'thinking', 'surprised', 'soft', 'exasperated']);
function expressiveCharacterEnabled(id, preferences, expressionEnabled) {
  return Boolean(expressionEnabled && Object.hasOwn(FLAGS, id) && preferences[FLAGS[id]] === true);
}
module.exports = { FLAGS, KOHAKU_EMOTIONS, expressiveCharacterEnabled };
