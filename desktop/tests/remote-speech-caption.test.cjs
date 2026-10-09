// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict');
const { create, audioChunks } = require('../remote/remote-speech-caption.js');
test('caption advances only at audio start and keeps the previous two chunks', () => {
  const c = create(); c.begin(); c.full('一。二。三。');
  assert.equal(c.state().visibleText,'');
  c.audio('一。'); assert.equal(c.state().visibleText,'一。');
  c.full('一。二。三。四。'); assert.equal(c.state().visibleText,'一。');
  c.audio('二。'); assert.equal(c.state().visibleText,'一。\n二。');
  c.audio('三。'); assert.equal(c.state().visibleText,'二。\n三。');
});
test('PC snapshots cannot replace the audio caption during or after playback', () => {
  const c = create(); c.text('前の答え'); c.begin('全文'); c.audio('現在の文');
  c.snapshot('PC側の全文'); assert.equal(c.state().visibleText,'現在の文');
  c.finish(); c.snapshot('PC側の全文');
  assert.equal(c.state().visibleText,'現在の文'); assert.equal(c.state().fullText,'全文');
  c.text('次のテキスト回答'); assert.equal(c.state().visibleText,'次のテキスト回答');
});
test('the full answer remains available separately after stop and next turn', () => {
  const c = create(); c.begin('長い全文'); c.audio('一'); c.audio('二'); c.cancel();
  assert.equal(c.state().fullText,'長い全文'); assert.equal(c.state().visibleText,'一\n二');
  assert.equal(c.state().reading,false); c.begin('次の全文'); c.audio('次');
  assert.deepEqual(c.state().captions,['次']); assert.equal(c.state().fullText,'次の全文');
  c.reset(); c.snapshot('別のキャラ'); assert.equal(c.state().visibleText,'別のキャラ');
});
test('empty-audio completion still shows text and ordinary muted replies stay normal', () => {
  const c = create(); c.begin('音声なし'); c.finish(); assert.equal(c.state().visibleText,'音声なし');
  c.snapshot('通常の回答'); assert.equal(c.state().visibleText,'通常の回答');
});
test('Live shows recent sentences, preserves full text and bounds unpunctuated transcripts', () => {
  const c = create(); c.live('最初。次。現在。');
  assert.equal(c.state().visibleText,'次。現在。'); assert.equal(c.state().fullText,'最初。次。現在。');
  c.snapshot('以前の全文'); assert.equal(c.state().visibleText,'次。現在。');
  c.live('🙂'.repeat(400)); assert.equal(Array.from(c.state().visibleText).length,240);
});
test('array bundles and singular streamed audio both carry their own matching caption', () => {
  assert.deepEqual(audioChunks({audioDataUrls:['a','b'],audioTexts:['一','二']}),[{url:'a',text:'一'},{url:'b',text:'二'}]);
  assert.deepEqual(audioChunks({audioDataUrl:'c',audioText:'三',done:true}),[{url:'c',text:'三'}]);
  assert.deepEqual(audioChunks({audioDataUrls:['d']},'代替'),[{url:'d',text:'代替'}]);
  assert.deepEqual(audioChunks({done:true}),[]);
});
