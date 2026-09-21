const test = require('node:test');
const assert = require('node:assert/strict');
const { selectNowPlaying, createNowPlayingMonitor } = require('../lib/device-now-playing.cjs');
const { buildRlcd42Scene } = require('../lib/rlcd42-presentation.cjs');
const { displayTextPayload } = require('../lib/device-protocol-v2.cjs');
const track = (status = 'Playing', title = '夕暮れの散歩') => ({title, artist:'サンプル',status});
const result = (...players) => ({ok:true,players});
const flush = () => new Promise(resolve => setImmediate(resolve));
test('selects one playing source, or one paused source, never guesses among multiples', () => {
  assert.deepEqual(selectNowPlaying(result(track())),track());
  assert.deepEqual(selectNowPlaying(result(track('Paused'),track())),track());
  assert.equal(selectNowPlaying(result(track(),track())),null);
  assert.equal(selectNowPlaying(result(track('Paused'),track('Paused'))),null);
  assert.equal(selectNowPlaying(result(track('Stopped'))),null);
  assert.equal(selectNowPlaying(result(track('Playing',''))),null);
  assert.equal(selectNowPlaying(result(track(),track('Playing',''))),null);
  assert.equal(selectNowPlaying({ok:false}),null);
});
test('metadata is bounded plain text, with no bidi or line injection', () => {
  const p=selectNowPlaying(result(track('Playing','a\n\u202eb'.repeat(200))));
  assert.equal(Array.from(p.title).length,160);
  assert.doesNotMatch(p.title,/[\n\u202e]/);
});
test('monitor reads only when connected, deduplicates changes and clears failures', async () => {
  let reads=0, value=result(track()), pending;
  const updates=[];
  const monitor=createNowPlayingMonitor({read:async()=>{reads++;return value;},onChange:x=>updates.push(x),schedule:f=>(pending=f),cancel:()=>{pending=null;}});
  assert.equal(reads,0);
  monitor.setConnection('usb:1'); await flush();
  assert.equal(reads,1);assert.equal(updates.length,1);
  monitor.setConnection('usb:1');assert.equal(reads,1);
  await pending(); assert.equal(updates.length,1);
  value={ok:false};await pending();assert.equal(updates.at(-1),null);
  monitor.stop();assert.equal(pending,null);assert.equal(monitor.snapshot(),null);
});
test('disconnect and reconnect discard old reads without overlapping helpers', async () => {
  let finish, calls=0, pending;
  const updates=[];
  const monitor=createNowPlayingMonitor({read:()=>{calls++;return new Promise(r=>finish=r);},onChange:x=>updates.push(x),schedule:f=>(pending=f),cancel:()=>{pending=null;}});
  monitor.setConnection('usb');monitor.stop();monitor.setConnection('wifi');
  assert.equal(calls,1);
  finish(result(track()));await flush();assert.equal(updates.length,0);
  void pending();assert.equal(calls,2);
  finish(result(track('Paused')));await flush();assert.equal(updates[0].status,'Paused');
  monitor.stop();assert.equal(updates.at(-1),null);
});
test('failed reader clears previous track, and repeated stop is harmless', async () => {
  let pending, fail=false;
  const monitor=createNowPlayingMonitor({read:async()=>{if(fail)throw Error();return result(track());},onChange:()=>{},schedule:f=>(pending=f),cancel:()=>{pending=null;}});
  monitor.setConnection('wifi');await flush();fail=true;await pending();
  assert.equal(monitor.snapshot(),null);monitor.stop();monitor.stop();
});
test('music uses only bounded footer; dialogue and work retain priority', () => {
  const p=track('Playing','日本語'.repeat(100));p.artist='歌手'.repeat(100);
  for(const language of ['ja','en']){
    const scene=buildRlcd42Scene({nowPlaying:p,language});
    assert.equal(scene.scene,'home');assert.equal(scene.caption,'');
    assert.equal(scene.footer.split('\n').length,3);
    assert.ok(Buffer.byteLength(scene.footer)<=160);
    assert.doesNotThrow(()=>displayTextPayload({revision:1,target:'footer',text:scene.footer,fontSize:12}));
  }
  for(const status of ['speaking','thinking','listening','approval','error','working']){
    const scene=buildRlcd42Scene({nowPlaying:p,turn:{status},caption:'会話の本文'});
    assert.doesNotMatch(scene.footer,/\n/);
  }
  const scene=buildRlcd42Scene({nowPlaying:null,transport:'wifi'});
  assert.match(scene.footer,/Wi-Fi/);
});
