// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { kohakuPackage, remoteExpression, remoteTtsWithExpression } = require('../lib/remote-kohaku.cjs');
const { create } = require('../remote/remote-authored-avatar.js');
const runtime = require('../../drawn-pose-runtime.js');
const manifest = require('../../assets/amber-avatar/authored-motion/manifest.json');
const { MascotStaticServer } = require('../lib/static-server.cjs');

test('Link exposes only current Kohaku drawings and whitelists expression metadata', () => {
  const pack = kohakuPackage(path.resolve(__dirname, '../..'));
  assert.equal(pack.files.size, 20); assert.match(pack.version, /^[a-f0-9]{16}$/);
  assert.equal(pack.read('manifest.json').contentType, 'application/json; charset=utf-8');
  assert.ok(pack.read('neutral/front-hair.png').body.length);
  for (const file of ['../preferences.json','neutral/../../../desktop/main.cjs','manifest.json/','cels/unknown.png','__proto__']) assert.equal(pack.read(file), null);
  assert.deepEqual(remoteExpression({ emotion:'happy',voiceRaw:1,text:'private',targetX:42, durationMs:999999 },'amber-avatar'),
    {characterId:'amber-avatar',emotion:'happy',durationMs:10000});
  assert.equal(remoteExpression({voiceRaw:1,emotion:'__proto__'},'amber-avatar'), null);
  assert.equal(remoteExpression({emotion:null,reaction:'neutral',nikePerformance:'none'},'amber-avatar'),null);
});

test('expression forwarding is transient and does not replay on audio/cursor packets', () => {
  const events=[];const server=new MascotStaticServer('.', {onInput: input => {
    const expression=remoteExpression(input,'amber-avatar');if(expression)events.push(expression);
  }});
  server.pushInput({emotion:'surprised',nikePerformance:'recoil'});
  for(let i=0;i<100;i++)server.pushInput({voiceRaw:.3,targetX:.4});
  assert.equal(events.length,1);assert.equal(events[0].emotion,'surprised');
});

test('Link TTS classifies once alongside synthesis, never fails audio or applies a stale character', async () => {
  let calls=0;let current=true;
  const options={characterId:'amber-avatar',synthesize:async()=>({audioDataUrls:['fixture']}),
    classify:async()=>{calls++;return{emotion:'happy'};},isCurrent:()=>current};
  const result=await remoteTtsWithExpression('fixture',options);
  assert.equal(calls,1);assert.equal(result.expression.emotion,'happy');
  current=false;assert.equal((await remoteTtsWithExpression('fixture',options)).expression,undefined);
  assert.deepEqual(await remoteTtsWithExpression('fixture',{...options,classify:async()=>{throw Error('offline');}}),{audioDataUrls:['fixture']});
});

function harness(load) {
  let time=0,visible=true;let next=1;const frames=new Map(), players=[];
  const canvas={hidden:true,width:640,height:640,getContext:()=>({clearRect(){}})};
  const classes=new Set();const shell={classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)}};
  const api={...runtime,createPlayer:load || (async()=>{
    const controller=runtime.createController(manifest);const player={trigger:controller.trigger,update:controller.update,
      render:()=>true,disposed:false,dispose(){this.disposed=true;}};players.push(player);return player;
  })};
  const avatar=create({canvas,shell,runtime:api,now:()=>time,visible:()=>visible,reduced:()=>false,
    raf:fn=>{const id=next++;frames.set(id,fn);return id;},cancel:id=>frames.delete(id)});
  return {avatar,canvas,classes,players,frames,step(ms=100){time+=ms;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());},
    visibility(value){visible=value;avatar.visibility();}};
}
const character={id:'amber-avatar',authoredMotion:{manifestUrl:'/api/authored/manifest.json',version:'fixture'},motion:{hairWarp:38,hairSpring:142}};

test('Link shared renderer supports all Jev expressions, audio/blink and one visible RAF lifecycle', async () => {
  const h=harness();await h.avatar.sync(character);h.step();
  assert.equal(h.canvas.hidden,false);assert.ok(h.classes.has('is-authored'));
  for(const emotion of ['neutral','happy','thinking','surprised','soft','exasperated']) {
    h.avatar.expression({characterId:'amber-avatar',emotion});h.avatar.audio('open',.3);h.avatar.blink(true);h.step();
    const state=h.avatar.status().output;
    assert.equal(state.mouthState,2);assert.equal(state.blinkClosed,true);
    if(emotion==='surprised')assert.ok(state.tilt>0);
  }
  await h.avatar.sync({...character,motion:{hairWarp:0}});assert.equal(h.players.length,1);
  h.visibility(false);assert.equal(h.frames.size,0);h.visibility(true);assert.equal(h.frames.size,1);
  await h.avatar.sync({id:'towa-avatar'});assert.equal(h.players[0].disposed,true);
  assert.equal(h.canvas.hidden,true);assert.equal(h.frames.size,0);
});

test('Link loading abort, latest character and expiring queued expressions cannot resurrect old graphics', async () => {
  let resolve;let disposed=0;
  const h=harness(()=>new Promise(r=>{resolve=r;}));
  const loading=h.avatar.sync(character);h.avatar.expression({emotion:'happy'});
  await h.avatar.sync({id:'custom'});
  resolve({dispose(){disposed++;}});await loading;
  assert.equal(disposed,1);assert.equal(h.canvas.hidden,true);assert.equal(h.frames.size,0);
  h.avatar.dispose();assert.equal(h.avatar.status().identity,'');
});

test('Link queues a still-current expression during loading, with remaining lifetime only', async () => {
  let resolve;const calls=[];
  const h=harness(()=>new Promise(r=>{resolve=r;}));const loading=h.avatar.sync(character);
  h.avatar.expression({emotion:'soft',durationMs:2000});h.step(500);
  resolve({trigger:(...args)=>calls.push(args),update:()=>({}),render:()=>true,dispose(){}});
  await loading;assert.deepEqual(calls,[['attentive_listening',500,1500]]);
  h.avatar.expression({characterId:'towa-avatar',emotion:'happy'});assert.equal(calls.length,1);
  h.avatar.dispose();
});

test('Link expired loading cues and renderer failure do not leave a blank canvas over the fallback', async () => {
  let resolve;const calls=[];
  const h=harness(()=>new Promise(r=>{resolve=r;}));const loading=h.avatar.sync(character);
  h.avatar.expression({emotion:'happy',durationMs:500});h.step(1000);
  let disposed=false;
  resolve({trigger:(...args)=>calls.push(args),update:()=>({}),render:()=>false,dispose(){disposed=true;}});
  await loading;assert.deepEqual(calls,[]);h.step();
  assert.equal(disposed,true);assert.equal(h.canvas.hidden,true);assert.equal(h.classes.has('is-authored'),false);
  assert.equal(h.frames.size,0);
});
