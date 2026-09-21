const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../preload-mascot.cjs'), 'utf8');
test('expression preparation starts before synthesis and activation stays at playback', () => {
  const code = preload.slice(preload.indexOf('const prepareSpeechSegment ='), preload.indexOf('const playSpeechSegment ='));
  assert.ok(code.indexOf('mascotInline:prepareExpression') < code.indexOf('mascotInline:synthesizeTts'));
  assert.match(code, /expression = await preparedExpression\(\)/);
  assert.match(code, /playAudioSource\(source, caption, token, \(\) => activate\(caption\)/);
  assert.match(code, /token !== ttsPlaybackToken/);
});
test('prepared activation does not launch another classifier and Live uses revisions', () => {
  assert.match(main, /!expression\?\.jevPrepared && typeof expression\?\.jevText/);
  assert.match(main, /nextTranscriptCue\(assistantTranscript, assistantTranscript\.text, \{ final: true \}\)/);
  assert.match(main, /thinkingFillerEnabled === true/);
});
