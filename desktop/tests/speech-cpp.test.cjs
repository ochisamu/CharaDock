// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { SpeechCppClient, waveDataUrl } = require("../lib/speech-cpp-client.cjs");
const { create, decodePcm } = require("../pcm-speech-player.js");
const pcm = Buffer.alloc(960,32).toString("base64");
// Tiny protocol fixtures bypass the independent duration and speech-tail guards.
const options = { executablePath:"speech.exe",modelPath:"model.gguf",referenceAudioPath:"reference.wav",mode:"reference",playbackRate:1.1,trimTrailingUtterance:false,guardReferenceDuration:false };
function fakeWorker({ready = true,onRequest = () => {}} = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
  child.messages = []; child.send = m => child.stdout.write(JSON.stringify(m)+"\n");
  child.stdin = new EventEmitter(); child.stdin.write = value => { const m = JSON.parse(value); child.messages.push(m); onRequest(m,child); };
  child.kill = () => {child.killed = true;};
  if (ready) setImmediate(() => child.send({type:"ready",protocol:3,version:"0.8.3",model:{sample_rate:48000}}));
  return child;
}
function response(m,c) { if (m.type === "synthesize") { c.send({type:"chunk",id:m.id,seq:0,pcm}); c.send({type:"chunk",id:m.id,seq:1,pcm}); c.send({type:"end",id:m.id,samples:960,stop:"complete"}); } }
test("native worker is reused, streams PCM in order and preserves sentence captions", async () => {
  const children = []; const client = new SpeechCppClient({spawnImpl:(exe,args,config)=>{assert.equal(config.windowsHide,true);assert.ok(args.includes("character=reference.wav"));const c=fakeWorker({onRequest:response});children.push(c);return c;}});
  try {
    const first = await client.start({...options,ownerId:7,chunks:[{text:"一文目。",instructions:"明るい声"},{text:"二文目。"}]});
    assert.equal(first.audioTexts[0],"一文目。");assert.equal(first.sampleRate,48000);assert.ok(first.audioDataUrls[0].startsWith("data:audio/wav;base64,"));
    assert.deepEqual(await client.next(first.streamId,8),{done:true});
    assert.equal(client.cancel(first.streamId,8),false);
    const chunks=[];let value;
    do {value=await client.next(first.streamId,7);if(value.pcmChunk)chunks.push(value);}while(!value.done);
    assert.deepEqual(chunks.map(c=>c.audioText),["一文目。","二文目。","二文目。"]);
    assert.equal(client.streams.size,0);
    const second=await client.start({...options,ownerId:7,chunks:[{text:"もう一度。"}]}); client.cancel(second.streamId,7);
    assert.equal(children.length,1); assert.equal(children[0].messages[0].instructions,"明るい声");
  } finally {client.stop();}
});
test("cancelling an owner during warmup settles before ready and never synthesizes", async () => {
  const child=fakeWorker({ready:false});const client=new SpeechCppClient({spawnImpl:()=>child});
  const pending=client.start({...options,ownerId:1,chunks:[{text:"停止。"}]});
  assert.equal(client.cancelOwner(2),false);assert.equal(client.cancelOwner(1),true);
  assert.equal((await pending).done,true);assert.equal(child.messages.length,0);client.stop();
});
test("cancellation stops a pending read and rejects late audio",async()=>{
  const child=fakeWorker({onRequest(m,c){if(m.type==="synthesize")c.send({type:"chunk",id:m.id,seq:0,pcm});}});
  const client=new SpeechCppClient({spawnImpl:()=>child});
  try {
    const result=await client.start({...options,ownerId:9,chunks:[{text:"長い文。"}]});
    const pending=client.next(result.streamId,9);client.cancelOwner(9);assert.equal((await pending).done,true);
    const request=child.messages.find(m=>m.type==="synthesize");assert.ok(child.messages.some(m=>m.type==="cancel"&&m.id===request.id));
    child.send({type:"chunk",id:request.id,seq:1,pcm});assert.deepEqual(await client.next(result.streamId,9),{done:true});
  }finally{client.stop();}
});
test("malformed protocol and wrong chunk sequences fail instead of hanging",async()=>{
  for(const mode of ["ready","sequence","exit"]){
    const child=fakeWorker({ready:false});const client=new SpeechCppClient({spawnImpl:()=>child});
    const pending=client.start({...options,ownerId:1,chunks:[{text:"確認。"}]});
    if(mode==="ready")child.send({type:"ready",protocol:2,version:"0.8.3",model:{sample_rate:48000}});
    else{child.send({type:"ready",protocol:3,version:"0.8.3",model:{sample_rate:48000}});await new Promise(r=>setImmediate(r));if(mode==="exit")child.emit("exit",1);else child.send({type:"chunk",id:child.messages[0].id,seq:4,pcm});}
    await assert.rejects(pending);assert.equal(child.killed,true);client.stop();
  }
});
test("PCM decoder and WAV fallback preserve signed 16-bit samples",()=>{
  const bytes=Buffer.alloc(6);bytes.writeInt16LE(-32768);bytes.writeInt16LE(0,2);bytes.writeInt16LE(32767,4);
  assert.deepEqual([...decodePcm(bytes.toString("base64"))],[-1,0,32767/32768]);
  const wave=Buffer.from(waveDataUrl(bytes.toString("base64"),48000).split(",")[1],"base64");assert.equal(wave.readUInt32LE(24),48000);assert.deepEqual(wave.subarray(44),bytes);
});
function audioContext(){
  const origin=Date.now();const context={state:"running",destination:{},sources:[],resume:async()=>{},get currentTime(){return(Date.now()-origin)/1000;},createAnalyser(){return{fftSize:256,connect(){},disconnect(){},getFloatTimeDomainData(data){data.fill(.1);}};},createBuffer(channels,length,rate){return{length,sampleRate:rate,copyToChannel(){}};},createBufferSource(){const source={playbackRate:{value:1},connect(){},disconnect(){},start(at){this.at=at;this.timer=setTimeout(()=>this.onended?.(),Math.max(0,(at-context.currentTime+this.buffer.length/this.buffer.sampleRate/this.playbackRate.value)*1000));},stop(){this.stopped=true;clearTimeout(this.timer);}};context.sources.push(source);return source;}};return context;
}
test("PCM player schedules adjacent buffers without waiting for each one to finish",async()=>{
  const context=audioContext();const captions=[],levels=[];let count=0;
  const player=create({context,next:async()=>++count===1?{pcmChunk:pcm,sampleRate:48000,audioText:"同じ文。",done:false}:{done:true},cancel:()=>{},onStart:t=>captions.push(t),onLevel:l=>levels.push(l),scheduleFrame:cb=>setTimeout(cb,5),cancelFrame:clearTimeout});
  await player.play({pcmChunk:pcm,sampleRate:48000,audioText:"同じ文。",streamId:"id"});
  assert.equal(context.sources.length,2);assert.ok(Math.abs(context.sources[1].at-context.sources[0].at-.01)<.005);assert.deepEqual(captions,["同じ文。"]);assert.equal(levels.at(-1),0);
});
test("PCM stop settles a pending fetch immediately and prevents late scheduling",async()=>{
  const context=audioContext();let resolveNext,cancels=0;const captions=[],levels=[];
  const player=create({context,next:()=>new Promise(r=>{resolveNext=r;}),cancel:()=>cancels++,onStart:t=>captions.push(t),onLevel:l=>levels.push(l),scheduleFrame:cb=>setTimeout(cb,5),cancelFrame:clearTimeout});
  const pending=player.play({pcmChunk:pcm,sampleRate:48000,audioText:"中断。",streamId:"id"});await new Promise(r=>setImmediate(r));player.stop();await pending;
  resolveNext({pcmChunk:pcm,sampleRate:48000,audioText:"後から届く声。"});await new Promise(r=>setImmediate(r));
  assert.equal(cancels,1);assert.equal(context.sources.length,1);assert.equal(context.sources[0].stopped,true);assert.deepEqual(captions,[]);assert.equal(levels.at(-1),0);
});


test("native tail cleanup keeps the first chunk fast and withholds resumed speech across chunk boundaries", async () => {
  const wave=Buffer.alloc(48000*3*2);
  for(let i=.4*48000;i<48000;i++)wave.writeInt16LE(16384,i*2);
  for(let i=1.6*48000;i<Math.round(2.2*48000);i++)wave.writeInt16LE(16384,i*2);
  const children=[];
  const client=new SpeechCppClient({spawnImpl:()=>{const c=fakeWorker();children.push(c);return c;}});
  const collect=async(text,ownerId)=>{
    const pending=client.start({...options,trimTrailingUtterance:true,ownerId,chunks:[{text}]});
    while(!children[0]?.messages.some(m=>m.type==="synthesize"&&m.text===text))await new Promise(r=>setImmediate(r));
    const child=children[0],request=child.messages.filter(m=>m.type==="synthesize").at(-1);
    // Worker is still generating: the first normal PCM chunk must already resolve.
    child.send({type:"chunk",id:request.id,seq:0,pcm:wave.subarray(0,.48*96000).toString("base64")});
    const first=await pending,output=[Buffer.from(first.pcmChunk,"base64")];
    assert.equal(output[0].length,.44*96000);
    // Deliberately split the silent gap and resume proof across three messages.
    const ends=[1.3*96000,1.7*96000,wave.length];let start=.48*96000;
    for(let i=0;i<ends.length;i++){child.send({type:"chunk",id:request.id,seq:i+1,pcm:wave.subarray(start,ends[i]).toString("base64")});start=ends[i];}
    child.send({type:"end",id:request.id,samples:wave.length/2,stop:"complete"});
    let next;do{next=await client.next(first.streamId,ownerId);if(next.pcmChunk){assert.equal(next.audioText,text);output.push(Buffer.from(next.pcmChunk,"base64"));}}while(!next.done);
    return Buffer.concat(output);
  };
  try {
    const short=await collect("これからよろしくね。",11);
    assert.equal(short.length,1.08*96000);assert.equal(short.readInt16LE(.9*96000),16384);
    for(const text of ["今、確認してるね。","確認します。そのあとまとめます。","午前の結果：晴れです。"]){
      const kept=await collect(text,12);
      assert.equal(kept.length,Math.round(2.28*96000)); // final quiet padding, not an internal pause
      assert.deepEqual(kept.subarray(0,2.2*96000),wave.subarray(0,2.2*96000),"Real clause pauses and resumed words must be preserved");
    }
  }finally{client.stop();}
});

test("native cancellation settles while a candidate tail gap is withheld",async()=>{
  const child=fakeWorker();const client=new SpeechCppClient({spawnImpl:()=>child});
  try{
    const pending=client.start({...options,trimTrailingUtterance:true,ownerId:1,chunks:[{text:"これからよろしくね。"}]});
    while(!child.messages.some(m=>m.type==="synthesize"))await new Promise(r=>setImmediate(r));
    const id=child.messages.find(m=>m.type==="synthesize").id;
    const speech=Buffer.alloc(.48*96000);for(let i=0;i<speech.length;i+=2)speech.writeInt16LE(16384,i);
    child.send({type:"chunk",id,seq:0,pcm:speech.toString("base64")});const first=await pending;
    child.send({type:"chunk",id,seq:1,pcm:Buffer.alloc(.56*96000).toString("base64")});
    const reading=client.next(first.streamId,1);client.cancelOwner(1);assert.equal((await reading).done,true);
    child.send({type:"chunk",id,seq:2,pcm:speech.toString("base64")});assert.deepEqual(await client.next(first.streamId,1),{done:true});
  }finally{client.stop();}
});


async function requestAfter(child, count) {
  const until=Date.now()+5000;
  while(child.messages.filter(m=>m.type==="synthesize").length<count){
    if(Date.now()>until)throw Error("Worker request did not arrive");
    await new Promise(r=>setImmediate(r));
  }
  return child.messages.filter(m=>m.type==="synthesize")[count-1];
}
function complete(child,request,bytes){
  child.send({type:"chunk",id:request.id,seq:0,pcm:bytes.toString("base64")});
  child.send({type:"end",id:request.id,samples:bytes.length/2,stop:"complete"});
}
async function drain(client,first,owner){
  const chunks=[Buffer.from(first.pcmChunk,"base64")];let next;
  do{next=await client.next(first.streamId,owner);if(next.pcmChunk)chunks.push(Buffer.from(next.pcmChunk,"base64"));}while(!next.done);
  return Buffer.concat(chunks);
}
test("reference timing is private, cached across seeds/captions/speeds, and preserves whole clauses",async()=>{
  const child=fakeWorker(),client=new SpeechCppClient({spawnImpl:()=>child});
  const probe=Buffer.alloc(96000,11),actual=Buffer.alloc(96000,22);
  const text="新しい音声を、スマートフォンからも聞けるよ。";
  const guarded={...options,guardReferenceDuration:true};
  try{
    let settled=false;
    const pending=client.start({...guarded,ownerId:4,seed:42,chunks:[{text,instructions:"親しみやすい声"}]}).then(value=>{settled=true;return value;});
    const timing=await requestAfter(child,1);
    assert.equal(timing.text,text);assert.equal(timing.voice,"none");assert.equal(timing.instructions,"");
    assert.equal(timing.steps,1);assert.equal(timing.speed,1);assert.equal(timing.keep_tail,true);
    child.send({type:"chunk",id:timing.id,seq:0,pcm:probe.toString("base64")});
    await new Promise(r=>setImmediate(r));assert.equal(settled,false,"Probe PCM must never reach the player");
    assert.equal(child.messages.length,1,"Real synthesis waits for validated probe completion");
    child.send({type:"end",id:timing.id,samples:48000,stop:"complete"});
    const voiced=await requestAfter(child,2);
    assert.equal(voiced.text,text);assert.equal(voiced.voice,"character");assert.equal(voiced.instructions,"親しみやすい声");
    assert.equal(voiced.seed,42);assert.equal(voiced.speed,1.1);assert.equal(voiced.seconds,1);
    assert.equal(voiced.steps,6);assert.equal(voiced.keep_tail,undefined);
    complete(child,voiced,actual);const first=await pending;
    assert.deepEqual(await drain(client,first,4),actual);assert.equal(first.audioText,text);
    const repeated=client.start({...guarded,ownerId:4,seed:1,playbackRate:2,chunks:[{text,instructions:"明るい声"}]});
    const repeat=await requestAfter(child,3);
    assert.equal(repeat.voice,"character");assert.equal(repeat.seed,1);assert.equal(repeat.instructions,"明るい声");
    assert.equal(repeat.seconds,1);assert.equal(repeat.speed,2);
    complete(child,repeat,actual);await drain(client,await repeated,4);assert.equal(child.messages.filter(m=>m.type==="synthesize").length,3);
    assert.equal(client.durationCache.size,1);
  }finally{client.stop();}
});
test("cancelling during private timing settles immediately without synthesizing or exposing late PCM",async()=>{
  const child=fakeWorker(),client=new SpeechCppClient({spawnImpl:()=>child});
  try{
    const pending=client.start({...options,guardReferenceDuration:true,ownerId:3,chunks:[{text:"確認するね。"}]});
    const probe=await requestAfter(child,1);
    child.send({type:"chunk",id:probe.id,seq:0,pcm:Buffer.alloc(96000).toString("base64")});
    assert.equal(client.cancelOwner(3),true);assert.equal((await pending).done,true);
    child.send({type:"end",id:probe.id,samples:48000,stop:"complete"});await new Promise(r=>setImmediate(r));
    assert.equal(child.messages.filter(m=>m.type==="synthesize").length,1);assert.equal(client.durationCache.size,0);
    assert.equal(child.messages.at(-1).type,"cancel");assert.equal(child.messages.at(-1).id,probe.id);
  }finally{client.stop();}
});
test("Voice Design uses its caption directly without the reference duration probe",async()=>{
  const child=fakeWorker({onRequest:response}),client=new SpeechCppClient({spawnImpl:()=>child});
  try{
    const first=await client.start({...options,mode:"design",guardReferenceDuration:true,ownerId:1,chunks:[{text:"確認。",instructions:"落ち着いた声"}]});
    await drain(client,first,1);
    const requests=child.messages.filter(m=>m.type==="synthesize");assert.equal(requests.length,1);
    assert.equal(requests[0].voice,"none");assert.equal(requests[0].instructions,"落ち着いた声");assert.equal(requests[0].seconds,undefined);assert.equal(requests[0].steps,6);
  }finally{client.stop();}
});
test("short timing respects native duration bounds at fast speed and failed probes never fall back to audio",async()=>{
  for(const fails of [false,true]){
    const child=fakeWorker(),client=new SpeechCppClient({spawnImpl:()=>child});
    try{
      const pending=client.start({...options,guardReferenceDuration:true,playbackRate:2,ownerId:1,chunks:[{text:"うん。"}]});
      const probe=await requestAfter(child,1);assert.equal(probe.speed,1);
      if(fails){
        child.send({type:"error",id:probe.id,error:{message:"prediction failed"}});
        await assert.rejects(pending,/prediction failed/);assert.equal(client.durationCache.size,0);
        assert.equal(child.messages.filter(m=>m.type==="synthesize").length,1);
      }else{
        complete(child,probe,Buffer.alloc(48000));const voiced=await requestAfter(child,2);
        assert.equal(voiced.speed,2);assert.equal(voiced.seconds,1); // native divides by speed, minimum 0.5 s
        complete(child,voiced,Buffer.alloc(48000));await drain(client,await pending,1);
      }
    }finally{client.stop();}
  }
});

test("terminal bursts are withheld until validated EOF, removed for PC/Link/WAV, and faded without changing captions",async()=>{
  for(const text of ["スマートフォンから聞けるよ。","新しい音声を、スマートフォンからも聞けるよ。"]){
    const child=fakeWorker(),client=new SpeechCppClient({spawnImpl:()=>child});
    try{
      const pending=client.start({...options,trimTrailingUtterance:true,ownerId:1,chunks:[{text}]});
      const request=await requestAfter(child,1);
      const raw=Buffer.alloc(1.52*96000);
      for(let i=0;i<48000;i++)raw.writeInt16LE(16000,i*2);
      // Four hundred forty ms of silence, then an 80 ms codec-like terminal burst.
      for(let i=1.44*48000;i<1.52*48000;i++)raw.writeInt16LE(24000,i*2);
      child.send({type:"chunk",id:request.id,seq:0,pcm:raw.subarray(0,.48*96000).toString("base64")});
      const first=await pending;assert.equal(Buffer.byteLength(first.pcmChunk,"base64"),.44*96000);
      child.send({type:"chunk",id:request.id,seq:1,pcm:raw.subarray(.48*96000).toString("base64")});
      const middle=await client.next(first.streamId,1);
      const finish=client.next(first.streamId,1);let finished=false;finish.then(()=>{finished=true;});
      await new Promise(r=>setImmediate(r));assert.equal(finished,false,"A terminal candidate cannot be committed before EOF");
      child.send({type:"end",id:request.id,samples:raw.length/2,stop:"complete"});
      const tail=await finish;
      const pcm=Buffer.concat([first,middle,tail].map(row=>Buffer.from(row.pcmChunk,"base64")));
      assert.equal(pcm.length,1.08*96000);assert.equal(pcm.readInt16LE(pcm.length-2),0);
      assert.deepEqual(pcm.subarray(0,96000),raw.subarray(0,96000));
      for(const row of [first,middle,tail]){
        assert.equal(row.audioText,text);
        assert.deepEqual(Buffer.from(row.audioDataUrl.split(",")[1],"base64").subarray(44),Buffer.from(row.pcmChunk,"base64"));
      }
      assert.equal((await client.next(first.streamId,1)).done,true);
    }finally{client.stop();}
  }
});

test("selected MF and Small step counts reach real synthesis without changing captions",async()=>{
  for(const [variant,steps,expected] of [["mf",4,4],["mf",12,12],["small",undefined,16],["small",32,32],["mf",1000,64],["small",0,1]]) {
    const child=fakeWorker({onRequest:response}),client=new SpeechCppClient({spawnImpl:()=>child});
    try {
      const first=await client.start({...options,variant,steps,ownerId:9,chunks:[{text:"音声テストです。"},{text:"これからよろしくね。"}]});
      await drain(client,first,9);
      const requests=child.messages.filter(m=>m.type==="synthesize");
      assert.deepEqual(requests.map(m=>m.steps),[expected,expected]);
      assert.deepEqual(requests.map(m=>m.text),["音声テストです。","これからよろしくね。"]);
    } finally {client.stop();}
  }
});
