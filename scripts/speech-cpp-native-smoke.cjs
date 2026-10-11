// SPDX-License-Identifier: Apache-2.0
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {SpeechCppClient}=require("../desktop/lib/speech-cpp-client.cjs");
const [profile,output]=process.argv.slice(2);fs.mkdirSync(output,{recursive:true});
const base=path.join(profile,"tts-models","speech-cpp-irodori-mf-v0.8.3");
const options={executablePath:path.join(base,"runtime/speech.exe"),modelPath:path.join(base,"models/Irodori-TTS-866M-MF-v4.1-F16.gguf"),referenceAudioPath:path.join(profile,"irodori-voices/builtin-kohaku.wav"),mode:"reference",seed:42,playbackRate:1.1};
const client=new SpeechCppClient();
(async()=>{
 const readyStart=performance.now();const ready=await client.ensureWorker(options);const startupMs=Math.round(performance.now()-readyStart);console.log("READY",startupMs,ready.model);
 const measurements=[];
 for(let i=0;i<2;i++){
  const start=performance.now();const first=await client.start({...options,ownerId:1,chunks:[{text:"新しい音声エンジンでも、いつもの声で話せるよ。",instructions:"明るく親しみやすい日本語。"}]});
  const firstAudioMs=Math.round(performance.now()-start),pcm=[Buffer.from(first.pcmChunk,"base64")];let chunks=1,next;
  do{next=await client.next(first.streamId,1);if(next.pcmChunk){pcm.push(Buffer.from(next.pcmChunk,"base64"));chunks++;}}while(!next.done);
  const elapsedMs=Math.round(performance.now()-start);const bytes=Buffer.concat(pcm);
  const {waveDataUrl}=require("../desktop/lib/speech-cpp-client.cjs");fs.writeFileSync(path.join(output,`native-${i}.wav`),Buffer.from(waveDataUrl(bytes.toString("base64"),48000).split(",")[1],"base64"));
  assert.ok(bytes.length>48000);measurements.push({firstAudioMs,elapsedMs,chunks,durationSeconds:bytes.length/96000});console.log("SPOKEN",measurements.at(-1));
 }
 const first=await client.start({...options,ownerId:1,chunks:[{text:"これは途中停止の確認です。音声を止めたあとに、後から届いた声が流れないことを確認します。"}]});
 const pending=client.next(first.streamId,1);client.cancelOwner(1);await pending;assert.equal((await client.next(first.streamId,1)).done,true);
 fs.writeFileSync(path.join(output,"native-verification.json"),JSON.stringify({passed:true,startupMs,model:ready.model,measurements,cancellation:true},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(output,"native-error.txt"),e.stack);process.exitCode=1;}).finally(()=>client.stop());
