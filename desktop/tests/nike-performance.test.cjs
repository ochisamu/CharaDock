const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { PNG } = require("pngjs");
const { JevClient } = require("../lib/jev-client.cjs");
const { JevExpressionDirector } = require("../lib/jev-expression-director.cjs");
const { PERFORMANCE_IMAGE_FILES } = require("../lib/performance-sprites.cjs");
const { createPerformanceController, PERFORMANCE_KINDS } = require("../../motion-runtime.js");
const { MascotStaticServer } = require("../lib/static-server.cjs");

test("mouth fade stays opaque normally and uses complementary additive pose weights", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const body = source.slice(source.indexOf("  function drawMouthBlendedExpression("), source.indexOf("  function drawFrontHairLayer("));
  for (const operation of ["source-over", "lighter"]) {
    const calls = [];
    const context = { blinkClosed: false, obsExternalInput: {}, images: { key0: {}, key1: {} }, expressionKeyForMouth: m => `key${m}`, mouthCrossfadeDurationMs: () => 100,
      mouthBlendFromState: 0, mouthBlendToState: 1, lastTimestamp: 50, mouthBlendStartedAt: 0,
      clamp: (v,a,b) => Math.min(b,Math.max(a,v)), drawMeshCroppedImage: ctx => calls.push(ctx.globalAlpha) };
    vm.createContext(context); vm.runInContext(body, context);
    const target = { globalAlpha: 1, globalCompositeOperation: operation };
    context.drawMouthBlendedExpression(target, {});
    assert.deepEqual(calls, operation === "lighter" ? [.5, .5] : [1, .5]);
    assert.equal(target.globalAlpha, 1);
  }
});

test("Live cues wait for a useful phrase instead of classifying every token", () => {
  const { readyForTranscriptCue } = require("../lib/jev-transcript-cue.cjs");
  assert.equal(readyForTranscriptCue("はい。"), false);
  assert.equal(readyForTranscriptCue("一緒に考えてみましょう。"), true);
  assert.equal(readyForTranscriptCue("一緒に考えてみましょう。まずは"), true);
  assert.equal(readyForTranscriptCue("私は、調べものや文章作成、"), false);
  assert.equal(readyForTranscriptCue("あ".repeat(56)), true);
  assert.equal(readyForTranscriptCue("えっ、"), true);
  for (const opening of ["え、", "え！？", "えぇー！", "わぁ！", "まさか！", "ふふん、", "やれやれ、"]) assert.equal(readyForTranscriptCue(opening), true, opening);
  assert.equal(readyForTranscriptCue("マスター、大丈夫、"), true);
  assert.equal(readyForTranscriptCue("あ".repeat(28)), true);
  assert.equal(readyForTranscriptCue("はい、"), false);
});

test("pose rendering uses the chosen emotion artwork rather than a baked face", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const body = source.slice(source.indexOf("  function drawMouthBlendedExpression("), source.indexOf("  function drawFrontHairLayer("));
  const neutral = {}, emotional = {}, pose = {}, composite = {}; const drawn = [];
  const context = { nikePerformanceOutput: { active: false }, blinkClosed: false, obsExternalInput: {},
    images: { normal: neutral, happy: emotional, performanceExplainEyesOpenMouthClosed: pose },
    expressionKeyForMouth: () => "happy", performanceFaceImage: (a,b) => { assert.equal(a,pose); assert.equal(b,emotional); return composite; },
    mouthCrossfadeDurationMs: () => 0, mouthBlendFromState: 0, mouthBlendToState: 0, mouthState: 0,
    drawMeshCroppedImage: (_, img) => drawn.push(img) };
  vm.createContext(context); vm.runInContext(body, context);
  context.drawMouthBlendedExpression({}, {}, "explain");
  assert.deepEqual(drawn, [composite]);
});

test("proud blink preserves the smiling mouth without replacing closed eyes", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
  const body = source.slice(source.indexOf("  function drawMouthBlendedExpression("), source.indexOf("  function drawFrontHairLayer("));
  const blink = {}, smile = {}, combined = {}, drawn = [];
  const context = { blinkClosed:true, obsExternalInput:{emotion:"proud"}, images:{closed:blink,open:smile,emotionProudMouthClosed:smile},
    expressionKeyForMouth: (_,closed=true)=>closed?"closed":"open", performanceFaceImage:(a,b,mouthOnly)=>{assert.equal(a,blink);assert.equal(b,smile);assert.equal(mouthOnly,true);return combined;},
    mouthCrossfadeDurationMs:()=>0,mouthBlendFromState:0,mouthBlendToState:0,mouthState:0,drawMeshCroppedImage:(_,img)=>drawn.push(img) };
  vm.createContext(context); vm.runInContext(body,context); context.drawMouthBlendedExpression({},{});
  assert.deepEqual(drawn,[combined]);
});

for (const emotion of ["Soft", "Joy", "Worried", "Proud", "Exasperated"]) test(`Nike ${emotion} exists as a registered audio-owned mouth triplet`, () => {
  const { validateEmotionSprites } = require("../lib/emotion-sprites.cjs");
  const directory = path.join(__dirname, "../../assets/nike-avatar");
  const avatar = {};
  for (const mouth of ["Closed", "Half", "Open"]) {
    avatar[`eyesOpenMouth${mouth}`] = fs.readFileSync(path.join(directory, `eyes-open-mouth-${mouth.toLowerCase()}.png`));
    avatar[`emotion${emotion}Mouth${mouth}`] = fs.readFileSync(path.join(directory, `emotion-${emotion.toLowerCase()}-mouth-${mouth.toLowerCase()}.png`));
  }
  assert.equal(validateEmotionSprites(avatar, { strict: true, rig: JSON.parse(fs.readFileSync(path.join(directory, "character.json"))).rig }), true);
});

test("control-owned Live shares status without handing its audio peer to mascot", () => {
  const main = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
  assert.ok(main.includes('send("mascot:externalRealtimeStatus", { live: method === "thread/realtime/started" })'));
  const preload = fs.readFileSync(path.join(__dirname, "../preload-mascot.cjs"), "utf8");
  const listener = preload.slice(preload.indexOf('ipcRenderer.on("mascot:externalRealtimeStatus"'), preload.indexOf('ipcRenderer.on("mascot:realtimeEvent"'));
  assert.ok(listener.includes('updateVoiceContext()'));
  assert.equal(/play|setRemoteDescription|realtimeSessionState\s*=/.test(listener), false);
});

test("speech drives independent articulated motion only when enabled", () => {
  const { performanceWarpPoint } = require("../../motion-runtime.js");
  const c = createPerformanceController(); let out;
  for (let t = 0; t <= 1000; t += 16) out = c.update(t, false, { enabled: true, speakingLevel: .8 });
  assert.ok(out.active); assert.notEqual(out.head, out.shoulder);
  const face = performanceWarpPoint(640, 650, out);
  assert.ok(Math.hypot(face.x - 640, face.y - 650) > .1);
  const bottom = performanceWarpPoint(750, 1536, { head: .03 });
  assert.deepEqual(bottom, { x: 750, y: 1536 });
  for (let t = 1016; t < 5000; t += 16) out = c.update(t, false, { enabled: false, speakingLevel: 1 });
  assert.equal(out.active, false);
});

test("speech gaps retain a living pose but late audio cannot resurrect it", () => {
  const c = createPerformanceController(); c.trigger("ponder", 0);
  let out;
  for (let t = 0; t <= 3000; t += 10) out = c.update(t, false, { enabled: true, speakingLevel: .5 });
  for (let t = 3010; t <= 3300; t += 10) out = c.update(t, false, { enabled: true });
  assert.ok(out.poses.ponder > .99);
  for (let t = 3310; t <= 5000; t += 10) out = c.update(t, false, { enabled: true });
  assert.ok(out.poses.ponder < .01);
  for (let t = 5010; t <= 5600; t += 10) out = c.update(t, false, { enabled: true, speakingLevel: .8 });
  assert.ok(out.poses.ponder < .001);
});

test("performance cue is transient: voice/cursor updates cannot restart it", () => {
  const server = new MascotStaticServer(path.resolve(__dirname, "../.."));
  const events = []; server.publish = (_, value) => events.push(value);
  server.pushInput({ nikePerformance: "celebrate", voiceLevel: 0 });
  server.pushInput({ voiceLevel: .5 });
  assert.equal(events[0].nikePerformance, "celebrate");
  assert.equal(Object.hasOwn(events[1], "nikePerformance"), false);
  assert.equal(Object.hasOwn(server.input, "nikePerformance"), false);
});

test("character switch reset clears all motion and pose weights immediately", () => {
  const c = createPerformanceController(); c.trigger("ponder", 0);
  for (let t = 0; t < 1000; t += 16) c.update(t);
  c.reset(); const result = c.update(1000);
  assert.equal(result.x, 0); assert.equal(result.kind, "none");
  assert.deepEqual(Object.values(result.poses), [0, 0, 0]);
});

test("performance classifier is opt-in and validates independent choice probabilities", async () => {
  const client = new JevClient(); let questions;
  client.ask = async (_, q) => { questions = q; return { performance: { type: "choice", choice: "explain", probabilities: { explain: .7 } } }; };
  assert.equal((await client.expression("例文")).nikePerformance, undefined);
  assert.equal(questions.performance, undefined);
  assert.equal((await client.expression("例文", { nikePerformance: true })).nikePerformance, "explain");
  client.ask = async () => ({ performance: { type: "choice", choice: "injected", probabilities: { injected: 1 } } });
  assert.equal((await client.expression("例文", { nikePerformance: true })).nikePerformance, "none");
});
test("independent confident body cue does not force an uncertain face or mouth", async () => {
  const applied = [];
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "nike-avatar",
    classify: async () => ({ emotion: null, nikePerformance: "ponder" }), apply: v => applied.push(v) });
  director.request("考えよう"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied[0].nikePerformance, "ponder");
  assert.equal(Object.hasOwn(applied[0], "emotion"), false);
  assert.equal(applied[0].forceMouth, null);
});
test("all motion cues stay bounded, settle and respect reduced motion", () => {
  for (const cue of PERFORMANCE_KINDS) {
    const controller = createPerformanceController(); controller.trigger(cue, 0);
    let out;
    for (let t = 0; t <= 6000; t += 16) {
      out = controller.update(t);
      for (const key of ["x", "y", "tilt", "scale"]) assert.ok(Number.isFinite(out[key]) && Math.abs(out[key]) < .08);
      assert.ok(Object.values(out.poses).reduce((a, b) => a + b, 0) <= 1.00001);
    }
    assert.equal(out.active, false);
    controller.trigger(cue, 6000);
    for (let t = 6000; t < 8000; t += 16) out = controller.update(t, true);
    assert.equal(out.active, false);
  }
});
test("interrupt starts from presented position and safely fades previous pose", () => {
  const controller = createPerformanceController(); controller.trigger("ponder", 0);
  let before;
  for (let t = 0; t <= 1000; t += 10) before = controller.update(t);
  controller.trigger("celebrate", 1000);
  const after = controller.update(1000);
  assert.equal(after.x, before.x); assert.equal(after.poses.ponder, before.poses.ponder);
});
test("three generated pose families have distinct six-frame registered speech/blink sets", () => {
  const groups = new Map();
  for (const [key, filename] of Object.entries(PERFORMANCE_IMAGE_FILES)) {
    const image = PNG.sync.read(fs.readFileSync(path.join(__dirname, "../../assets/nike-avatar", filename)));
    assert.equal(image.width, 1536); assert.equal(image.height, 1536);
    const group = filename.split("-")[1]; if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(image);
  }
  for (const frames of groups.values()) {
    assert.equal(frames.length, 6);
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) assert.equal(frames[i].data.equals(frames[j].data), false);
    // Arms, torso, hair and silhouette must not change when blinking/speaking.
    for (let i = 0; i < frames[0].data.length; i += 4) {
      const x = i / 4 % 1536, y = Math.floor(i / 4 / 1536);
      if (x >= 440 && x <= 840 && y >= 510 && y <= 830) continue;
      for (const frame of frames.slice(1)) for (let c = 0; c < 4; c++) assert.equal(frame.data[i + c], frames[0].data[i + c]);
    }
  }
});
