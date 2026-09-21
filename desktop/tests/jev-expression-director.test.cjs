const test = require("node:test");
const assert = require("node:assert/strict");
const { JevExpressionDirector } = require("../lib/jev-expression-director.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
test('prepared expression waits for playback and is single-use', async () => {
  const applied=[];
  const d=new JevExpressionDirector({enabled:()=>true,context:()=> 'nike',apply:x=>applied.push(x),classify:async()=>({emotion:'proud',forceMouth:2})});
  const id=await d.prepare('ふふん');
  assert.equal(applied.length,0); assert.ok(id);
  assert.equal(d.activate(id),true); assert.equal(applied[0].forceMouth,null);
  assert.equal(d.activate(id),false);
});
test('prepared result cannot survive cancellation, expiry or a character change', async () => {
  let context='a', now=0, resolve;
  const d=new JevExpressionDirector({enabled:()=>true,context:()=>context,now:()=>now,apply:()=>assert.fail(),classify:()=>new Promise(r=>resolve=r)});
  const pending=d.prepare('one'); await tick(); d.cancel(); resolve({emotion:'proud'}); assert.equal(await pending,null);
  const second=d.prepare('two'); await tick(); resolve({emotion:'proud'}); const id=await second;
  context='b'; assert.equal(d.activate(id),false);
  const third=d.prepare('three'); await tick(); resolve({emotion:'proud'}); const expired=await third;
  now=60001; assert.equal(d.activate(expired),false);
});
test('future segment preparation does not supersede current playback', async () => {
  const applied=[];
  const d=new JevExpressionDirector({enabled:()=>true,context:()=> 'a',apply:x=>applied.push(x),classify:async text=>({emotion:text})});
  const first=await d.prepare('happy'),next=await d.prepare('proud');
  assert.equal(d.activate(first),true); assert.equal(d.activate(next),true);
  assert.deepEqual(applied.map(x=>x.emotion),['happy','proud']);
});
test('prepared abstention is handled without resetting the current face', async () => {
  const d=new JevExpressionDirector({enabled:()=>true,context:()=> 'a',apply:()=>assert.fail(),classify:async()=>({emotion:null,nikePerformance:'none'})});
  assert.equal(d.activate(await d.prepare('neutral continuation')),true);
});
test('preparation has bounded concurrency and a failed job does not block the next', async () => {
  const pending=[],calls=[];
  const d=new JevExpressionDirector({enabled:()=>true,context:()=> 'a',apply:()=>{},classify:text=>{calls.push(text);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}});
  const a=d.prepare('a'), b=d.prepare('b'), c=d.prepare('c');
  assert.equal(await d.prepare('overflow'),null); await tick(); assert.deepEqual(calls,['a']);
  pending.shift().reject(new Error('offline')); assert.equal(await a,null); await tick();
  pending.shift().resolve({emotion:'happy'}); assert.ok(await b); await tick();
  pending.shift().resolve({emotion:'proud'}); assert.ok(await c); assert.equal(d.prepareCount,0);
});
test('Live revisions are bounded and use only new meaningful phrases',()=>{
  const {nextTranscriptCue}=require('../lib/jev-transcript-cue.cjs'); const state={};
  assert.equal(nextTranscriptCue(state,'えっ！',{now:0}),'えっ！');
  assert.equal(nextTranscriptCue(state,'えっ！大きな花だね。',{now:100}),null);
  assert.equal(nextTranscriptCue(state,'えっ！大きな花だね。でもお世話も大変だね。',{now:800}),'大きな花だね。でもお世話も大変だね。');
  assert.equal(nextTranscriptCue(state,'えっ！大きな花だね。でもお世話も大変だね。',{final:true,now:900}),null);
});
test("listener and speaker jobs with identical words retain distinct roles", async () => {
  const roles = [];
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "nike",
    apply: () => {}, classify: async (_, options) => { roles.push(options.source); return { emotion: "soft" }; } });
  director.request("大丈夫", { source: "user" }); await tick();
  director.request("大丈夫"); await tick();
  assert.deepEqual(roles, ["user", "assistant"]);
});
test("uncertain face leaves current expression untouched; confident neutral still resets", async () => {
  const applied = [], events = [];
  let result = { emotion: "happy", reaction: "happy", durationMs: 4500 };
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "a", apply: x => applied.push(x),
    classify: async () => result, observe: (event, detail) => events.push({ event, ...detail }) });
  director.request("first"); await tick();
  result = { emotion: null, reaction: "surprised", durationMs: 4500 };
  director.request("unclear"); await tick();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].durationMs, 4500);
  assert.ok(events.some(e => e.event === "expression-skipped" && e.reason === "uncertain"));
  result = { emotion: "neutral", reaction: "neutral", durationMs: 4500 };
  director.request("plain"); await tick();
  assert.equal(applied.length, 2);
  assert.equal(applied[1].emotion, "neutral");
});
test("latest-only classification drops old results and preserves mouth/blink ownership", async () => {
  const pending = [], calls = [], applied = [];
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "amber", apply: x => applied.push(x), classify: text => { calls.push(text); return new Promise(resolve => pending.push(resolve)); } });
  director.request("one"); director.request("two"); director.request("three");
  assert.deepEqual(calls, ["one"]);
  pending.shift()({ emotion: "happy" }); await tick();
  assert.equal(applied.length, 0); assert.deepEqual(calls, ["one", "three"]);
  pending.shift()({ emotion: "thinking", forceMouth: 2, forceEyesClosed: true }); await tick();
  assert.equal(applied[0].emotion, "thinking"); assert.equal(applied[0].forceMouth, null); assert.equal(applied[0].forceEyesClosed, null);
});
test("disabled, cancelled, switched-character results cannot leak", async () => {
  let enabled = true, context = "a", resolve;
  const applied = [];
  const director = new JevExpressionDirector({ enabled: () => enabled, context: () => context, apply: x => applied.push(x), classify: () => new Promise(r => { resolve = r; }) });
  director.request("one"); context = "b"; resolve({}); await tick(); assert.equal(applied.length, 0);
  director.request("two"); enabled = false; resolve({}); await tick(); assert.equal(applied.length, 0);
  enabled = true; director.request("three"); director.cancel(); resolve({}); await tick(); assert.equal(applied.length, 0);
});
test("duplicate segment is coalesced and API failure is nonfatal", async () => {
  let count = 0;
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "a", apply: () => assert.fail(), classify: async () => { count++; throw new Error("offline"); } });
  director.request("same"); director.request("same"); await tick();
  assert.equal(count, 1); assert.equal(director.running, false);
});
