// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PNG } = require('pngjs');
const runtime = require('../../drawn-pose-runtime.js');
const root = path.resolve(__dirname, '../../assets/amber-avatar/authored-motion');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
test('v9 manifest has bounded resized decode, local paths and every registered source', () => {
  const budget = runtime.validateManifest(manifest); assert.equal(budget.imageCount, 118); assert.ok(budget.decodedBytes < 140 * 1024 * 1024);
  const files = new Map();
  for (const p of Object.values(manifest.poses)) for (const f of [p.hair, ...Object.values(p.variants)]) files.set(f, [1254, 1254]);
  for (const c of manifest.transitions) for (const f of c.frames) for (const v of Object.values(f)) files.set(v, [512, 512]);
  files.set(manifest.cels.mask, [1254, 1254]);
  for (const seq of Object.values(manifest.cels.sequences)) seq.frames.forEach(f => files.set(f, [1254, 1254]));
  for (const [file, expected] of files) { const p = PNG.sync.read(fs.readFileSync(path.join(root, file))); assert.deepEqual([p.width, p.height], expected, file); }
});
test('v9 rejects traversal, invalid timings, missing neutral variants and decode inflation', () => {
  for (const edit of [m => m.poses.neutral.hair = '../secret.png', m => delete m.poses.neutral.variants['closed-open'], m => m.decodeSize = 4096, m => m.transitions[0].durationMs = NaN]) {
    const m = structuredClone(manifest); edit(m); assert.throws(() => runtime.validateManifest(m));
  }
});
test('tilt survives speech and blink without neutral snapping', () => {
  const c = runtime.createController(manifest); c.update(0); c.trigger('curious_tilt', 0);
  const before = c.update(500), after = c.update(500, { mouthState: 2, blinkClosed: true });
  assert.equal(after.tilt, before.tilt); assert.equal(after.transitionFrame, before.transitionFrame); assert.equal(after.pose, 'curious_tilt');
  assert.equal(after.mouthState, 2); assert.equal(after.blinkClosed, true);
  assert.ok(c.update(1250, { mouthState: 1 }).tilt > .90);
  assert.equal(c.update(4000, { mouthState: 1 }).tilt, 1);
});
test('tilt reverse retains presentation while a registered expression starts immediately', () => {
  const c = runtime.createController(manifest); c.update(0); c.trigger('curious_tilt', 0); const before = c.update(700);
  c.trigger('delighted_agreement', 700); assert.equal(c.update(700).tilt, before.tilt);
  assert.ok(c.update(1100).cels.some(f=>f.name==='delighted_agreement'&&f.index>=0));
  assert.equal(c.update(4200).pose, 'delighted_agreement'); assert.equal(c.update(4400).tilt, 0);
});
test('pose expires, reset releases pose state and unknown triggers are ignored', () => {
  const c = runtime.createController(manifest); assert.equal(c.trigger('__proto__'), false); c.trigger('curious_tilt', 0, 1000);
  c.update(1000); c.update(2001); assert.equal(c.update(4500).tilt, 0); c.reset(); assert.equal(c.update(4500).pose, 'neutral');
});
test('feature morph aligns eye and mouth geometry, leaves face silhouette untouched and stays bounded',()=>{
  const a=[{x:548,y:630,w:100,h:70},{x:764,y:579,w:100,h:70},{x:668,y:730,w:80,h:20}];
  const b=a.map(f=>({...f,y:f.y+12,h:f.h*.5}));
  assert.deepEqual(runtime.featureWarp(20,20,a,b),{x:20,y:20});
  assert.deepEqual(runtime.featureWarp(548,630,a,a),{x:548,y:630});
  const center=runtime.featureWarp(548,630,a,b);assert.equal(center.y,642);
  for(let y=0;y<1254;y+=30)for(let x=0;x<1254;x+=30){const p=runtime.featureWarp(x,y,a,b);assert.ok(Math.abs(p.x-x)<=24);assert.ok(Math.abs(p.y-y)<=32);}
});
test('interrupting a facial sequence retains presented pixels, not its target or neutral', () => {
  const c = runtime.createController(manifest); c.update(0); c.trigger('delighted_agreement', 0);
  const before = c.update(1500); c.trigger('doubtful_side_eye', 1500); const after = c.update(1500);
  assert.deepEqual(after.cels, before.cels);
  const blend = c.update(1600); assert.ok(blend.cels.some(f => f.name === 'delighted_agreement'));
  assert.ok(Math.abs(blend.cels.reduce((sum, f) => sum + f.weight, 0) - 1) < 1e-9);
});
test('an emotion change goes to its incoming onset without a neutral detour',()=>{
  const c=runtime.createController(manifest);c.update(0);c.trigger('delighted_agreement',0);
  const before=c.update(1500);c.trigger('doubtful_side_eye',1500);
  assert.deepEqual(c.update(1500).cels,before.cels);
  const blending=c.update(1600);
  assert.ok(blending.cels.some(f=>f.name==='doubtful_side_eye'&&f.index>=0&&f.weight>0));
  assert.ok(blending.cels.every(f=>f.index>=0),'do not briefly flash a neutral drawing');
});
test('feature registration and inverse share the same presented coordinates during tilt',()=>{
  for(let t=0;t<=1;t+=.05){
    const m=runtime.landmarkTransform(t),inverse=runtime.inverseAffine(m);
    const source={x:672,y:729,w:80,h:30},posed=runtime.transformFeature(source,m),back=runtime.transformFeature(posed,inverse);
    assert.ok(Math.abs(back.x-source.x)<1e-6);assert.ok(Math.abs(back.y-source.y)<1e-6);
    assert.ok(posed.w>0&&posed.h>0);
  }
});
test('blink and mouth presentation ease through intermediate values, without replacing the pose',()=>{
  const c=runtime.createController(manifest);c.update(0);c.trigger('curious_tilt',0);
  c.update(600);const first=c.update(617,{mouthState:2,blinkClosed:true});
  assert.ok(first.mouthValue>0&&first.mouthValue<2);assert.ok(first.blinkAmount>0&&first.blinkAmount<1);
  assert.equal(first.pose,'curious_tilt');
  const opening=c.update(634,{mouthState:0,blinkClosed:false});
  assert.ok(opening.blinkAmount>=0&&opening.blinkAmount<=1);assert.ok(Number.isFinite(opening.speechMix));
});
test('four source cel sequences have real phases, no video background and automatic return', () => {
  for (const name of ['attentive_listening', 'delighted_agreement', 'doubtful_side_eye', 'sleepy_yawn']) {
    const c = runtime.createController(manifest); c.update(0); c.trigger(name, 0);
    const out = c.update(1600, { mouthState: 1, blinkClosed: true }); assert.equal(out.pose, name); assert.ok(out.cels.length);
    assert.ok(Math.abs(out.cels.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9);
    assert.equal(c.update(4100).pose, name, 'keep expression for the conversation hold');
    c.update(4501); assert.equal(c.update(5300).pose, 'neutral');
  }
});
test('idle breathing, head, chest and speech accent are alive, bounded and respect user settings', () => {
  const c=runtime.createController(manifest), samples=[];
  for(let i=0;i<180;i++)samples.push(c.update(i*1000/60).life);
  for(const key of ['x','y','rotation','head','chest']) assert.ok(Math.max(...samples.map(s=>s[key]))-Math.min(...samples.map(s=>s[key]))>.001,key);
  const quiet=c.update(3010).life.accent;
  for(let i=0;i<30;i++)c.update(3020+i*1000/60,{audioLevel:.8});
  assert.ok(c.update(3530,{audioLevel:.8}).life.accent>quiet+.1);
  assert.ok(Math.abs(c.update(3540).life.rotation)<.02);
  assert.deepEqual(Object.values(c.update(3550,{reducedMotion:true}).life),[0,0,0,0,0,0,0]);
  const off=runtime.createController(manifest);
  for(let i=0;i<180;i++)off.update(i*1000/60,{idleEnabled:false});
  assert.equal(off.update(3000,{idleEnabled:false}).life.head,0);
});
test('reversal carries tilt velocity instead of hard stopping at the decision', () => {
  const c=runtime.createController(manifest);c.update(0);c.trigger('curious_tilt',0);
  const a=c.update(150);c.trigger('neutral',150);const b=c.update(150);
  assert.equal(b.tilt,a.tilt);assert.equal(b.tiltVelocity,a.tiltVelocity);
  const next=c.update(155);assert.ok(Math.abs(next.tilt-b.tilt)<.025);
});
test('fractional authored frames include both endpoints, no nearest-frame jumps', () => {
  assert.deepEqual(runtime.poseSamples(0,48),[{index:-1,weight:1}]);
  assert.deepEqual(runtime.poseSamples(1,48),[{index:48,weight:1}]);
  const sample=runtime.poseSamples(.111,48);assert.equal(sample.length,2);
  assert.ok(Math.abs(sample.reduce((s,f)=>s+f.weight,0)-1)<1e-9);
});
test('rapid expression changes have bounded weights and never accumulate unlimited render layers', () => {
  const c=runtime.createController(manifest);c.update(0);
  for(let i=0;i<200;i++) {
    const t=i*33;c.trigger(i%2?'delighted_agreement':'doubtful_side_eye',t);
    const s=c.update(t);assert.ok(s.cels.length<=13);assert.ok(s.cels.every(f=>Number.isFinite(f.weight)));
  }
});
test('hair root pinned, extremes bounded, reduced motion static, long resume finite', () => {
  for (const fps of [30, 60, 144]) {
    const c = runtime.createController(manifest); for (let i = 0; i < fps * 3; i++) c.update(i * 1000 / fps);
    assert.deepEqual(c.hairPoint(500, 100), { x: 500, y: 100 }); const p = c.hairPoint(500, 1000, () => ({ x: 99999, y: 99999 })); assert.ok(p.x <= 507 && p.y <= 1003);
    c.update(100000, { reducedMotion: true }); assert.deepEqual(c.hairPoint(500, 1000), { x: 500, y: 1000 });
  }
});
test('registered local patch landmarks align at the endpoints, intermediate determinant stays positive', () => {
  for (let t = 0; t <= 1; t += .05) { const [a,b,c,d] = runtime.landmarkTransform(t); assert.ok(a*d-b*c > .5); }
  const [a,b,c,d,e,f] = runtime.landmarkTransform(1);
  assert.ok(Math.abs(a*668+c*730+e-706) < .0001); assert.ok(Math.abs(b*668+d*730+f-718) < .0001);
});
test('Jev mapping uses supported drawings, silence-only yawn never runs over conversation', () => {
  assert.equal(runtime.stateForInput({ emotion: 'exasperated' }), 'doubtful_side_eye');
  assert.equal(runtime.stateForInput({ emotion: 'happy' }), 'delighted_agreement');
  assert.equal(runtime.stateForInput({ reaction: 'listening' }), 'attentive_listening');
  assert.equal(runtime.stateForInput({ nikePerformance: 'ponder' }), 'curious_tilt');
  const c = runtime.createController(manifest); c.update(0); assert.equal(c.update(100001, { mouthState: 1 }).pose, 'neutral');
  assert.equal(c.update(200002).pose, 'sleepy_yawn');
});
test('packaging includes runtime on Windows/macOS and opt-in is explicit in snapshots', () => {
  const pkg = require('../../package.json'); for (const b of [pkg.build, pkg.build.win, pkg.build.mac]) { assert.ok(b.files.includes('drawn-pose-runtime.js')); assert.ok(b.files.includes('assets/amber-avatar/**/*')); }
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8'); assert.match(main, /kohakuMotionEnabled: character\.id === "amber-avatar" && nikePerformanceEnabled/);
  const app = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8'); assert.match(app, /snapshot\?\.kohakuMotionEnabled === true/);
});
