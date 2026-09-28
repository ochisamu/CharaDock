// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PNG } = require('pngjs');
const { expressiveCharacterEnabled, KOHAKU_EMOTIONS } = require('../lib/expressive-character.cjs');
const { JevClient } = require('../lib/jev-client.cjs');
const { Preferences } = require('../lib/preferences.cjs');
const { createPerformanceController, performanceWarpPoint } = require('../../motion-runtime.js');
test('Kohaku opt-in never enables Nike or custom characters',()=>{
  const p={jevKohakuPerformanceEnabled:true};
  assert.equal(expressiveCharacterEnabled('amber-avatar',p,true),true);
  for(const id of ['nike-avatar','custom-kohaku','__proto__']) assert.equal(expressiveCharacterEnabled(id,p,true),false);
  assert.equal(expressiveCharacterEnabled('amber-avatar',p,false),false);
  assert.equal(expressiveCharacterEnabled('amber-avatar',{jevKohakuPerformanceEnabled:'true'},true),false);
});
test('Kohaku flag defaults off, validates booleans and survives restart', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kohaku-prefs-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'preferences.json'),p=new Preferences(file);
  assert.equal(p.publicState().jevKohakuPerformanceEnabled,false);
  p.patch({jevKohakuPerformanceEnabled:'true'});assert.equal(p.data.jevKohakuPerformanceEnabled,false);
  p.patch({jevKohakuPerformanceEnabled:true});
  const reloaded=new Preferences(file);assert.equal(reloaded.publicState().jevKohakuPerformanceEnabled,true);
  assert.equal(reloaded.publicState().jevNikePerformanceEnabled,false);
});
test('Jev only selects Kohaku artwork that exists, while keeping speech audio-owned',async()=>{
  const c=new JevClient();let questions;
  c.ask=async(_,q)=>{questions=q;return {emotion:{type:'choice',choice:'proud',probabilities:{proud:1}},performance:{type:'choice',choice:'explain',probabilities:{explain:1}}};};
  const r=await c.expression('説明します',{nikePerformance:true,allowedEmotions:KOHAKU_EMOTIONS,source:'user'});
  assert.deepEqual(Object.keys(questions.emotion.criteria),KOHAKU_EMOTIONS);
  assert.match(questions.emotion.instructions,/LISTENER/);
  assert.equal(r.emotion,null);assert.equal(r.nikePerformance,'explain');assert.equal(r.forceMouth,null);assert.equal(r.forceEyesClosed,null);
});
test('smooth idle is opt-in, bounded, frame-rate stable and settles with reduced motion',()=>{
  const run=fps=>{const c=createPerformanceController();let out;for(let i=0;i<=fps*4;i++)out=c.update(i*1000/fps,false,{enabled:true,smoothIdle:true});return {c,out};};
  const a=run(30),b=run(60);
  assert.ok(a.out.active);assert.ok(Math.abs(a.out.head-b.out.head)<.0004);
  assert.ok(Math.abs(a.out.head)<.008);assert.equal(a.out.x,0);
  for(let t=4016;t<7000;t+=16)a.out=a.c.update(t,true,{enabled:true,smoothIdle:true});
  assert.equal(a.out.active,false);
  const c=createPerformanceController();assert.equal(c.update(1000,false,{smoothIdle:true}).active,false);
});
test('Kohaku interrupt preserves presentation values and pose continuity',()=>{
  const c=createPerformanceController();c.trigger('ponder',0);let before;
  for(let t=0;t<=1000;t+=10)before=c.update(t,false,{enabled:true,smoothIdle:true});
  c.trigger('celebrate',1000);const after=c.update(1000,false,{enabled:true,smoothIdle:true});
  for(const key of ['head','shoulder','x','y','tilt'])assert.equal(after[key],before[key]);
  assert.deepEqual(after.poses,before.poses);
});
test('Kohaku head/hand joints are separate and hand articulation cannot move the face',()=>{
  const p=performanceWarpPoint(668,730,{hand:.08},'celebrate',1254,1254,'amber-avatar');
  assert.deepEqual(p,{x:668,y:730});
  const a=performanceWarpPoint(548,604,{head:.02},'',1254,1254,'amber-avatar');
  const b=performanceWarpPoint(548,604,{head:.02},'',1254,1254,'nike-avatar');
  assert.notDeepEqual(a,b);assert.ok(Number.isFinite(a.x));
});
test('18 Kohaku pose frames preserve registered speech/blinks and independent hair',()=>{
  const dir=path.resolve(__dirname,'../../assets/amber-avatar');
  const read=f=>PNG.sync.read(fs.readFileSync(path.join(dir,f)));
  const families=[];
  for(const pose of ['ponder','explain','celebrate']) {
    const frames=[];
    for(const eye of ['open','closed']) for(const mouth of ['closed','half','open']){
      const p=read(`performance-${pose}-eyes-${eye}-mouth-${mouth}.png`);
      const name=eye==='open'&&pose!=='explain'?`emotion-${pose==='ponder'?'thinking':'happy'}-mouth-${mouth}.png`:`eyes-${eye}-mouth-${mouth}.png`;
      const original=read(name);assert.equal(p.width,1254);assert.equal(p.height,1254);
      // No regenerated face or bald scalp drift; retain every visible head pixel.
      for(let i=0;i<775*1254*4;i+=4){assert.equal(p.data[i+3],original.data[i+3]);if(original.data[i+3])for(let k=0;k<3;k++)assert.equal(p.data[i+k],original.data[i+k]);}
      frames.push(p);
    }
    for(let i=0;i<frames.length;i++)for(let j=i+1;j<frames.length;j++)assert.equal(frames[i].data.equals(frames[j].data),false);
    for(const p of frames.slice(1))assert.equal(p.data.subarray(815*1254*4).equals(frames[0].data.subarray(815*1254*4)),true);
    families.push(frames[0]);
  }
  for(let i=1;i<families.length;i++)assert.equal(families[i].data.subarray(815*1254*4).equals(families[0].data.subarray(815*1254*4)),false);
});
