// SPDX-License-Identifier: Apache-2.0
// Opt-in real-profile native synthesis and diagnostic ASR, without preference writes.
const fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url");
const [source,profile,output]=process.argv.slice(2);fs.mkdirSync(output,{recursive:true});
const {SpeechCppClient,waveDataUrl}=require(path.join(source,"desktop/lib/speech-cpp-client.cjs"));
const {splitIrodoriText}=require(path.join(source,"desktop/lib/irodori-webgpu.cjs"));
const {dynamicIrodoriCaption}=require(path.join(source,"desktop/lib/irodori-caption.cjs"));
const p=JSON.parse(fs.readFileSync(path.join(profile,"preferences.json"))),voice=p.characterTtsProfiles[p.characterId];
const options={...require(path.join(source,"desktop/lib/speech-cpp-settings.cjs")).speechCppConfiguration(p),referenceAudioPath:path.join(profile,"irodori-voices",voice.irodoriVoiceId+".wav"),mode:voice.irodoriMode,playbackRate:p.irodoriSpeed,seed:p.irodoriSeed};
const client=new SpeechCppClient();let recognizer;
const baselineIndex=process.argv.indexOf("--baseline"),baseline=baselineIndex<0?"":process.argv[baselineIndex+1];
function asr(wav,paddingSeconds=.9){
 if(!recognizer){const sherpa=require(path.join(source,"node_modules/sherpa-onnx-node")),root=path.join(profile,"sherpa-onnx-models/sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01");recognizer=new sherpa.OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{numThreads:4,provider:"cpu",tokens:path.join(root,"tokens.txt"),transducer:{encoder:path.join(root,"encoder-epoch-99-avg-1.int8.onnx"),decoder:path.join(root,"decoder-epoch-99-avg-1.onnx"),joiner:path.join(root,"joiner-epoch-99-avg-1.int8.onnx")}}});}
 const count=Math.floor(wav.length/6),offset=Math.round(paddingSeconds*16000),samples=new Float32Array(count+offset*2);
 for(let i=0;i<count;i++)samples[i+offset]=(wav.readInt16LE(i*6)+wav.readInt16LE(i*6+2)+wav.readInt16LE(i*6+4))/98304;
 const stream=recognizer.createStream();stream.acceptWaveform({sampleRate:16000,samples});recognizer.decode(stream);return recognizer.getResult(stream).text;
}
(async()=>{
 const {findTrailingUtteranceCutoff,shouldTrimTrailingUtterance}=await import(pathToFileURL(path.join(source,"desktop/irodori/voicedesign-pipeline.mjs")));
 const results=[];
 const inputTexts=["音声テストです。これからよろしくね。","新しい音声を、スマートフォンからも聞けるよ。","うん、これから確認するね。","スマートフォンから聞けるよ。"];
 for(const seed of [options.seed,42,1])for(const input of inputTexts){
  const fullPcm=[]; const split=splitIrodoriText;
  for(const text of split(input)){
  const instructions=dynamicIrodoriCaption(voice.irodoriCaption,text,{enabled:voice.irodoriAutoEmotion,strength:voice.irodoriEmotionStrength}).caption;
  const started=performance.now();const first=await client.start({...options,seed,trimTrailingUtterance:!process.argv.includes("--raw"),guardReferenceDuration:!process.argv.includes("--raw"),ownerId:1,chunks:[{text,instructions}]});const firstAudioMs=Math.round(performance.now()-started);
  const buffers=[Buffer.from(first.pcmChunk,"base64")];let next;do{next=await client.next(first.streamId,1);if(next.pcmChunk)buffers.push(Buffer.from(next.pcmChunk,"base64"));}while(!next.done);
  const pcm=Buffer.concat(buffers),audio=new Float32Array(pcm.length/2);for(let i=0;i<audio.length;i++)audio[i]=pcm.readInt16LE(i*2)/32768;
  const cutoff=shouldTrimTrailingUtterance(text)?findTrailingUtteranceCutoff(audio,48000):audio.length;
  const stem=`seed-${seed}-${results.length}`; fullPcm.push(pcm);
  fs.writeFileSync(path.join(output,stem+".wav"),Buffer.from(waveDataUrl(pcm.toString("base64"),48000).split(",")[1],"base64"));
  const item={seed,input,text,instructions,firstAudioMs,durationSeconds:pcm.length/96000,cutoffSeconds:cutoff/48000,transcription:asr(pcm)};
  const normalize=value=>value.replace(/[\s。、，,.！？!?]/g,"");
  // A larger recognizer context hid the audible extra syllable in the voice
  // test. Always retain both results and flag a disagreement for WAV review.
  item.shortContextMatches=normalize(item.transcription)===normalize(text);
  item.transcriptionLongContext=asr(pcm,1.5);
  item.longContextMatches=normalize(item.transcriptionLongContext)===normalize(text);
  item.transcriptionMatches=item.shortContextMatches&&item.longContextMatches;
  const end=audio.subarray(Math.max(0,audio.length-960));
  item.endpoint={lastSample:audio.at(-1),peakLast20ms:Math.max(...end),absolutePeakLast20ms:Math.max(...end.map(Math.abs)),rmsLast20ms:Math.sqrt(end.reduce((sum,value)=>sum+value*value,0)/end.length)};
  if(baseline&&fs.existsSync(path.join(baseline,stem+".wav"))){
    const before=fs.readFileSync(path.join(baseline,stem+".wav")).subarray(44);
    const compared=Math.max(0,Math.min(before.length,pcm.length)-9600);let maximumDelta=0;
    for(let i=0;i<compared;i+=2)maximumDelta=Math.max(maximumDelta,Math.abs(before.readInt16LE(i)-pcm.readInt16LE(i)));
    item.baselineComparison={durationSeconds:before.length/96000,comparedSpeechSeconds:compared/96000,maximumPcmDelta:maximumDelta};
  }
  if(cutoff<audio.length)item.filteredTranscription=asr(pcm.subarray(0,cutoff*2));
  results.push(item);console.log(JSON.stringify(item));fs.writeFileSync(path.join(output,"tail-verification.json"),JSON.stringify({characterId:p.characterId,voiceId:voice.irodoriVoiceId,raw:process.argv.includes("--raw"),results},null,2));
  }
  const all=Buffer.concat(fullPcm);console.log("FULL_UTTERANCE",JSON.stringify({seed,input,transcription:asr(all)}));
  fs.writeFileSync(path.join(output,`full-${seed}-${inputTexts.indexOf(input)}.wav`),Buffer.from(waveDataUrl(all.toString("base64"),48000).split(",")[1],"base64"));
 }
 if(!process.argv.includes("--raw")&&results.some(row=>row.endpoint.lastSample!==0||row.endpoint.absolutePeakLast20ms>.01))throw Error("A regression sentence retains a non-quiet or discontinuous audio endpoint.");
 if(!process.argv.includes("--raw")&&results.some(row=>!row.transcriptionMatches))throw Error("Diagnostic ASR differs from a regression sentence; inspect the recorded WAV before accepting this voice check.");
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>client.stop());
