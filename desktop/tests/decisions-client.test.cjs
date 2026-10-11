// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DecisionsClient, ENDPOINT, MODEL } = require('../lib/decisions-client.cjs');
const { DecisionClient } = require('../lib/decision-client.cjs');
const { JevAddressGate } = require('../lib/jev-address-gate.cjs');
const { JevExpressionDirector } = require('../lib/jev-expression-director.cjs');
const { JevMediaGate } = require('../lib/jev-media-gate.cjs');
const { jevFailureReason } = require('../lib/jev-debug.cjs');
const choice = (name, value, p=1, confidence=0) => ({name,type:'choice',choice:value,confidence,probabilities:[{value,probability:p}]});
const predicate = (name, probability=1) => ({name,type:'predicate',probability});
function setup(answers, options={}) {
  const calls=[];
  const client = new DecisionsClient({getApiKey:()=> ' profile-key ',fetchImpl:async(url,request)=> {
    calls.push({url,request,body:JSON.parse(request.body)});
    return {ok:true,text:async()=>JSON.stringify({answers})};
  },...options});
  return {client,calls};
}
test('Decisions maps JEV questions to named choice/predicate questions using fixed endpoint and profile key',async()=> {
  const {client,calls}=setup([predicate('explicit',.9),choice('action','next',.85)]);
  assert.equal(await client.media('次の曲にして'),'next');
  const {url,request,body}=calls[0];
  assert.equal(url,ENDPOINT);assert.equal(url,'https://api.openai.com/v1/decisions');
  assert.equal(body.model,MODEL);assert.equal(MODEL,'gpt-6-luna');
  assert.equal(request.headers.Authorization,'Bearer profile-key');
  assert.equal(request.body.includes('profile-key'),false);
  assert.deepEqual(JSON.parse(body.input),{userUtterance:'次の曲にして'});
  assert.deepEqual(body.questions.map(q=>q.type),['choice','predicate']);
  assert.deepEqual(body.questions[0].choices.map(c=>c.value),['none','next','previous','pause','play']);
  assert.match(body.questions[0].instructions,/Quoted commands/);
  assert.equal(body.questions[1].name,'explicit');
});
test('selected probability retains existing thresholds and confidence is not substituted',async()=> {
  assert.equal(await setup([choice('action','next',.84,1),predicate('explicit')]).client.media('next'),null);
  assert.equal(await setup([choice('action','next',1,0),predicate('explicit',.89)]).client.media('next'),null);
  assert.equal(await setup([choice('action','none'),predicate('explicit')]).client.media('negated'),null);
});
test('shared expression rules keep mouth/eyes owned by audio and support Kohaku and Nike',async()=> {
  const {client,calls}=setup([choice('emotion','soft'),choice('gesture','sad'),choice('performance','reassure')]);
  const result=await client.expression('落ち込んでいる',{nikePerformance:true,source:'user',allowedEmotions:['neutral','happy','thinking','soft','surprised']});
  assert.equal(result.emotion,'soft');assert.equal(result.nikePerformance,'reassure');
  assert.equal(result.forceMouth,null);assert.equal(result.forceEyesClosed,null);
  assert.match(calls[0].body.questions[0].instructions,/LISTENER/);
  assert.equal(JSON.parse(calls[0].body.input).userUtterance,'落ち込んでいる');
  const pride=await setup([choice('emotion','proud'),choice('performance','celebrate')]).client.expression('ふふん',{nikePerformance:true});
  assert.equal(pride.nikePerformance,'none');
});
test('address shares strict/living filtering and bounded evidence',async()=> {
  const {client,calls}=setup([choice('recipient','addressed',.95),choice('communicative','speech')]);
  assert.equal(await client.address('x'.repeat(2500),{mode:'living',character:'test',previousReply:''}),'addressed');
  assert.equal(JSON.parse(calls[0].body.input).utterance.length,2000);
  assert.equal(await setup([choice('recipient','addressed',.91),choice('communicative','speech')]).client.address('hello',{mode:'strict'}),null);
  assert.equal(await setup([choice('recipient','addressed'),choice('communicative','non_speech')]).client.address('フッ',{mode:'living'}),'non_speech');
});
test('refused, missing, malformed or out-of-range answers abstain without media actions',async()=> {
  for (const answers of [[],[{name:'action',type:'refusal'},predicate('explicit')],
    [choice('action','next'),{name:'explicit',type:'predicate',probability:'1'}],
    [choice('action','next'),predicate('explicit',1.01)],
    [choice('action','stop'),predicate('explicit')]]) {
    assert.equal(await setup(answers).client.media('next'),null);
  }
  const expression=await setup([{name:'emotion',type:'refusal'},choice('gesture','happy')]).client.expression('test');
  assert.equal(expression.emotion,null);assert.equal(expression.reaction,'happy');
});
test('invalid response structure, duplicate names and duplicate probabilities fail safely',async()=> {
  for (const answers of [{},null,[choice('action','next'),choice('action','pause')],
    [choice('unknown','next')],[{...choice('action','next'),probabilities:[{value:'next',probability:1},{value:'next',probability:1}]}],
    [choice('action','next',NaN)], [null]]) {
    await assert.rejects(setup(answers).client.media('next'),/^Error: Decisions request failed$/);
  }
});
test('HTTP/transport/body failures and missing keys never expose credentials or retry',async()=> {
  for (const status of [401,403,429,500]) {
    let calls=0;
    await assert.rejects(setup([],{fetchImpl:async()=>{calls++;return {ok:false,status,text:()=>assert.fail('Do not read body')};}}).client.media('next'),new RegExp('Decisions HTTP '+status));
    assert.equal(calls,1);
  }
  for (const fetchImpl of [async()=>{throw Error('secret');},async()=>({ok:true,text:async()=>{throw Error('secret');}}),async()=>({ok:true,text:async()=> 'secret'}),async()=>({ok:true,text:async()=> ' '.repeat(65537)})]) {
    await assert.rejects(setup([],{fetchImpl}).client.media('next'),/^Error: Decisions request failed$/);
  }
  const {client,calls}=setup([],{getApiKey:()=>''});
  await assert.rejects(client.media('next'),/Decisions API key is not configured/);assert.equal(calls.length,0);
  await assert.rejects(setup([],{getApiKey:()=>{throw Error('secret');}}).client.media('next'),/^Error: Decisions request failed$/);
});
test('timeout aborts fetch and body read with sanitized diagnostics',async()=> {
  for (const body of [false,true]) {
    let signal;
    const {client}=setup([],{timeoutMs:5,fetchImpl:async(_url,request)=> {
      signal=request.signal;
      const pending=()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('secret')),{once:true}));
      return body ? {ok:true,text:pending} : pending();
    }});
    await assert.rejects(client.media('next'),/Decisions request timed out/);assert.equal(signal.aborted,true);
  }
  assert.equal(jevFailureReason(Error('Decisions HTTP 429')),'http-429');
  assert.equal(jevFailureReason(Error('Decisions request timed out')),'timeout');
});
test('connectivity requires a valid named predicate',async()=> {
  const result=await setup([predicate('ready',.92)]).client.test();
  assert.equal(result.ok,true);assert.ok(result.latencyMs>=0);
  for (const answers of [[],[{name:'ready',type:'refusal'}],[predicate('ready',-1)]]) await assert.rejects(setup(answers).client.test(),/Decisions request failed/);
});
function router(options={}) {
  let provider='jev', openai='profile-key', jev='jev-key';
  const calls=[];
  const client=new DecisionClient({getProvider:()=>provider,getOpenAIApiKey:()=>openai,getJevApiKey:()=>jev,
    fetchImpl:async(url,request)=>{calls.push({url,request});return {ok:true,text:async()=>JSON.stringify({answers:url===ENDPOINT ? [predicate('ready')] : {ready:{type:'noul',noul:1}}})};},...options});
  return {client,calls,setProvider:value=>{provider=value;client.invalidate();},setOpenAI:value=>{openai=value;},setJev:value=>{jev=value;}};
}
test('switching providers reads their own current key and never falls back to the other service',async()=> {
  const r=router();await r.client.test();assert.match(r.calls[0].url,/typesafe/);assert.equal(r.calls[0].request.headers.Authorization,'Bearer jev-key');
  r.setProvider('decisions');r.setJev('');assert.equal(r.client.isConfigured(),true);
  await r.client.test();assert.equal(r.calls[1].request.headers.Authorization,'Bearer profile-key');
  r.setOpenAI('changed-key');await r.client.test();assert.equal(r.calls[2].request.headers.Authorization,'Bearer changed-key');
  r.setOpenAI('');assert.equal(r.client.isConfigured(),false);await assert.rejects(r.client.test(),/not configured/);assert.equal(r.calls.length,3);
});
for (const surface of ['desktop','settings','remote','atom-echo','rlcd42']) test('late address result is rejected after switching on '+surface,async()=> {
  let resolve;
  const r=router({fetchImpl:()=>new Promise(done=>{resolve=done;})});r.setProvider('decisions');
  const gate=new JevAddressGate({classify:(...args)=>r.client.address(...args),enabled:()=>true,mode:()=> 'strict',context:()=> 'same-character'});
  const pending=gate.check('こんにちは',{handsfree:true,source:surface});
  r.setProvider('jev');r.setProvider('decisions');
  resolve({ok:true,text:async()=>JSON.stringify({answers:[choice('communicative','speech'),choice('recipient','greeting')]})});
  assert.equal((await pending).accepted,false);
});
test('late expression and media results cannot apply after switching',async()=> {
  for (const kind of ['expression','media']) {
    let resolve,applied=0;
    const r=router({fetchImpl:()=>new Promise(done=>{resolve=done;})});r.setProvider('decisions');
    const owner=kind==='media' ? new JevMediaGate({classify:text=>r.client.media(text),execute:()=>{applied++;},enabled:()=>true})
      : new JevExpressionDirector({classify:text=>r.client.expression(text),enabled:()=>true,context:()=> 'same',apply:()=>{applied++;}});
    const pending=kind==='media' ? owner.finish('next') : (owner.request('hello'),null);
    r.setProvider('jev');r.setProvider('decisions');
    resolve({ok:true,text:async()=>JSON.stringify({answers:kind==='media' ? [choice('action','next'),predicate('explicit')] : [choice('emotion','happy'),choice('gesture','happy')]})});
    if (pending) await pending;else await new Promise(done=>setImmediate(done));
    assert.equal(applied,0);
  }
});
test('real config/test IPC handler persists provider and invalidates shared owners',async()=> {
  const source=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  const handlers={},calls=[];
  const context={ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},assertTrustedSender:()=>{},nikePerformanceEnabled:()=>false,
    preferences:{patch:values=>{calls.push(values);},setJevApiKey:()=>{}},jevClient:{invalidate:()=>calls.push('invalidate'),test:async()=>({ok:true})},
    jevAddressGate:{reset:()=>calls.push('address-reset')},jevExpressionDirector:{cancel:()=>calls.push('expression-cancel')},
    localServer:{pushInput:()=>{},setSnapshot:()=>{}},currentCursorInput:()=>({}),broadcastAppState:()=>({ok:true})};
  vm.runInNewContext(source.slice(source.indexOf('  ipcMain.handle("jev:setConfig"'),source.indexOf('  ipcMain.handle("jev:previewPerformance"')),context);
  await handlers['jev:setConfig']({}, {provider:'decisions',enabled:true});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{decisionProvider:'decisions',jevEnabled:true},'invalidate','address-reset','expression-cancel']);
  assert.equal((await handlers['jev:testConnection']({})).ok,true);
  await assert.rejects(handlers['jev:setConfig']({}, {provider:'unknown'}),/Invalid decision provider/);
});


test('Decisions-only API key change invalidates Decisions results without resetting Chat through the production IPC handler',async()=> {
  const source=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  const handlers={},calls=[];
  const context={ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},assertTrustedSender:()=>{},
    preferences:{data:{decisionProvider:'decisions'},setDecisionApiKey:key=>calls.push(['save',key])},
    jevClient:{invalidate:()=>calls.push('invalidate')},jevAddressGate:{reset:()=>calls.push('address-reset')},
    jevExpressionDirector:{cancel:()=>calls.push('expression-cancel')},openAIClient:{reset:()=>calls.push('chat-reset')},publicAppState:()=>({hasApiKey:true})};
  vm.runInNewContext(source.slice(source.indexOf('  ipcMain.handle("decisions:setApiKey"'),source.indexOf('  ipcMain.handle("mcp:save"')),context);
  assert.equal(handlers['decisions:setApiKey']({},'updated-key').hasApiKey,true);
  assert.deepEqual(calls,[['save','updated-key'],'invalidate','address-reset','expression-cancel']);
  calls.length=0;context.preferences.data.decisionProvider='jev';handlers['decisions:setApiKey']({},'another-key');
  assert.deepEqual(calls,[['save','another-key']]);
});
