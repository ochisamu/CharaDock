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
  assert.equal(c.update(1250, { mouthState: 1 }).tilt, 1);
});
test('tilt reverse begins at current presentation and queues a cel until aligned', () => {
  const c = runtime.createController(manifest); c.update(0); c.trigger('curious_tilt', 0); const before = c.update(700);
  c.trigger('delighted_agreement', 700); assert.equal(c.update(700).tilt, before.tilt);
  assert.equal(c.update(2000).pose, 'delighted_agreement'); assert.equal(c.update(2200).tilt, 0);
});
test('pose expires, reset releases pose state and unknown triggers are ignored', () => {
  const c = runtime.createController(manifest); assert.equal(c.trigger('__proto__'), false); c.trigger('curious_tilt', 0, 1000);
  c.update(1000); c.update(2001); assert.equal(c.update(3500).tilt, 0); c.reset(); assert.equal(c.update(3500).pose, 'neutral');
});
test('interrupting a facial sequence retains presented pixels, not its target or neutral', () => {
  const c = runtime.createController(manifest); c.update(0); c.trigger('delighted_agreement', 0);
  const before = c.update(1500); c.trigger('doubtful_side_eye', 1500); const after = c.update(1500);
  assert.deepEqual(after.cels, before.cels);
  const blend = c.update(1600); assert.ok(blend.cels.some(f => f.name === 'delighted_agreement'));
  assert.ok(Math.abs(blend.cels.reduce((sum, f) => sum + f.weight, 0) - 1) < 1e-9);
});
test('four source cel sequences have real phases, no video background and automatic return', () => {
  for (const name of ['attentive_listening', 'delighted_agreement', 'doubtful_side_eye', 'sleepy_yawn']) {
    const c = runtime.createController(manifest); c.update(0); c.trigger(name, 0);
    const out = c.update(1600, { mouthState: 1, blinkClosed: true }); assert.equal(out.pose, name); assert.ok(out.cels.length);
    assert.ok(Math.abs(out.cels.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9);
    assert.equal(c.update(4100).pose, 'neutral');
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
