const test = require('node:test');
const assert = require('node:assert/strict');

class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
  dispose() { this.disposed = true; }
}
async function fixture(run, overrides = {}) {
  const { IrodoriV4MeanFlowTTS } = await import('../irodori/v4-mf-pipeline.mjs');
  const sessions={backbone:{},text:{},caption:{},duration:{},dac:{},dit:{inputNames:['delta_t'],run},...overrides.sessions};
  return new IrodoriV4MeanFlowTTS({ort:{Tensor},tokenizer:{},modelConfig:{model:{flow_parameterization:'meanflow'}},...overrides,sessions});
}
const condition = {state:new Float32Array(512),mask:new Uint8Array([1]),tokens:1,dim:512};
const speaker = {...condition,state:new Float32Array(768),dim:768};
test('MF uses four conditional calls from t=1 to 0 with positive delta and negative update', async()=>{
  const times=[]; const feeds=[]; const outputs=[];
  const engine=await fixture(async feed=>{times.push([feed.t.data[0],feed.delta_t.data[0]]);feeds.push(feed);const v=new Tensor('float32',new Float32Array(32).fill(2),[1,1,32]);outputs.push(v);return {v};});
  const x0=new Float32Array(32).fill(3);
  const result=await engine.rfLoop(condition,condition,speaker,1,{x0});
  assert.deepEqual(times,[[1,.25],[.75,.25],[.5,.25],[.25,.25]]);
  assert.ok(result.every(v=>v===1)); assert.ok(x0.every(v=>v===3));
  assert.ok(feeds.every(f=>Object.values(f).every(t=>t.disposed)));
  assert.ok(outputs.every(t=>t.disposed));
});
test('MF refuses RF checkpoint/graph and unsupported RF controls',async()=>{
  await assert.rejects(fixture(null,{modelConfig:{model:{flow_parameterization:'rf_velocity'}}}),/MF checkpoint/);
  await assert.rejects(fixture(null,{sessions:{backbone:{},dit:{inputNames:['t']}}}),/delta_t/);
  const engine=await fixture(()=>assert.fail('must reject before inference'));
  for(const opts of [{numSteps:0},{numSteps:1.5},{schedule:'sway'},{cfgText:3},{initScale:.999},{x0:new Float32Array(1)}]){
    await assert.rejects(engine.rfLoop(condition,condition,speaker,1,opts));
  }
});
test('MF seed is repeatable, supports step selection, and rejects nonfinite output',async()=>{
  let calls=0;
  const engine=await fixture(async()=>{calls++;return {v:new Tensor('float32',new Float32Array(32),[1,1,32])};});
  const first=await engine.rfLoop(condition,condition,speaker,1,{numSteps:2,seed:42});
  assert.deepEqual(first,await engine.rfLoop(condition,condition,speaker,1,{numSteps:2,seed:42}));
  assert.equal(calls,4);
  const invalid=await fixture(async()=>({v:new Tensor('float32',new Float32Array(32).fill(NaN),[1,1,32])}));
  await assert.rejects(invalid.rfLoop(condition,condition,speaker,1),/velocity/);
});
