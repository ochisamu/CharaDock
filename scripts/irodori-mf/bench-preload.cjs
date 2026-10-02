const {ipcRenderer}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createRequire}=require('node:module');
(async()=>{
 const {output,model,runtimeRoot,dependencies,mode,reference,suite}=await ipcRenderer.invoke('mf:config');
 const req=createRequire(path.join(dependencies,'package.json'));
 const ortRoot=path.dirname(req.resolve('onnxruntime-web/webgpu'));
 const ort=await import(pathToFileURL(path.join(ortRoot,'ort.webgpu.bundle.min.mjs')).href);
 ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=pathToFileURL(ortRoot+path.sep).href;
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter||adapter.info.isFallbackAdapter)throw new Error('Hardware WebGPU required');
 ipcRenderer.send('mf:log',{kind:'environment',mode,gpu:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description},ort:ort.env.versions});
 const config=JSON.parse(fs.readFileSync(path.join(model,'model-config.json')));
 const sessions={};const start=performance.now();
 for(const [key,name]of Object.entries({backbone:'text_backbone',text:'text_projector',caption:'caption_projector',speaker:'speaker_encoder',duration:'duration',dit:mode==='mf'?'dit_v4_mf':'dit_v4',dac:'dacvae_decoder',enc:'dacvae_encoder'})){
   const source=path.join(model,name+'.onnx');const external=source+'.data';
   sessions[key]=await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(source)),{executionProviders:['webgpu'],graphOptimizationLevel:'all',...(fs.existsSync(external)?{externalData:[{path:name+'.onnx.data',data:new Uint8Array(fs.readFileSync(external))}]}:{})});
   ipcRenderer.send('mf:log',{kind:'loaded',component:key});
 }
 ipcRenderer.send('mf:log',{kind:'load',elapsedMs:performance.now()-start});
 const {Tokenizer}=req('@huggingface/tokenizers');
 const tokenizerRoot=fs.existsSync(path.join(model,'tokenizer/tokenizer.json'))?path.join(model,'tokenizer'):path.join(model,'../tokenizer/irodori_v4');
 const tokenizer=new Tokenizer(JSON.parse(fs.readFileSync(path.join(tokenizerRoot,'tokenizer.json'))),JSON.parse(fs.readFileSync(path.join(tokenizerRoot,'tokenizer_config.json'))));
 const {IrodoriV4TTS,noSpeakerCondition}=await import(pathToFileURL(path.join(runtimeRoot,'v4-pipeline.mjs')).href);
 const {IrodoriV4MeanFlowTTS}=await import(pathToFileURL(path.join(runtimeRoot,'v4-mf-pipeline.mjs')).href);
 const engine=new (mode==='mf'?IrodoriV4MeanFlowTTS:IrodoriV4TTS)({ort,sessions,modelConfig:config,tokenizer:{encode:(text,options)=>tokenizer.encode(text,options).ids}});
 let speaker=noSpeakerCondition();
 if(reference){const context=new AudioContext({sampleRate:48000});const raw=fs.readFileSync(reference);const audio=await context.decodeAudioData(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length));if(audio.sampleRate!==48000)throw new Error('Reference must decode at 48 kHz');speaker=await engine.encodeReferenceAudio(audio.getChannelData(0),audio.sampleRate);await context.close();}
 const texts=suite==='long'?[
  '今日は音声モデルの速度を調べています。少し長めの文章を読み上げて、声が途切れないか、最後まで自然に話せるかを確認しましょう。結果はあとで一緒に見比べます。',
  'おはようございます。今日の予定を一緒に確認しましょう。午前中は昨日の作業を振り返り、残っている課題を整理します。昼食のあとは、新しい音声モデルを試して、読み上げの速さと聞き取りやすさを比べる予定です。急いで結論を出さず、良かったところと気になったところを分けて記録しておきましょう。',
  '窓を開けると、涼しい風が部屋に入ってきました。遠くから鳥の声が聞こえて、いつもより少し静かな朝です。机の上には、昨日の続きを書きかけたノートと、読み終えていない本が置いてあります。今日はまず、お茶を入れてから、気になっていたことを順番に片づけるつもりです。途中で疲れたら散歩に出て、帰りに近所のパン屋へ寄ってみましょう。すべてを一度に終わらせる必要はありません。小さな作業をひとつずつ進めながら、夕方には気持ちよく一日を振り返れるといいですね。'
 ]:['こんにちは。','今確認してるね。','まず資料を確認します。そのあと、要点をまとめます。'];
 ipcRenderer.send('mf:log',{kind:'protocol',suite,reference:reference?path.basename(reference):null,seed:42,repeats:3,maxSeconds:suite==='long'?60:30,splitSentences:false,texts:texts.map(text=>({text,characters:Array.from(text).length}))});
 const caption='自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。';
 for(let repeat=0;repeat<3;repeat++)for(let index=0;index<texts.length;index++){
  const t=performance.now(),stages=[];
  const result=await engine.synthesize(texts[index],caption,{speaker,seed:42,maxSeconds:suite==='long'?60:30,numSteps:mode==='mf'?4:16,schedule:'linear',...(mode==='rf'?{cfgExecution:'sequential'}:{}),onStage:event=>stages.push({...event,elapsedMs:performance.now()-t})});
  if(!result.audio.length||!result.audio.every(Number.isFinite))throw new Error('Invalid audio');
  const elapsedMs=performance.now()-t;
  const wav=Buffer.alloc(44+result.audio.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let i=0;i<result.audio.length;i++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,result.audio[i]))*32767),44+i*2);
  const name=`${mode}-${index}-${repeat}.wav`;fs.writeFileSync(path.join(output,name),wav);
  ipcRenderer.send('mf:log',{kind:'synthesis',mode,text:texts[index],repeat,name,elapsedMs,seconds:result.audio.length/48000,sequenceLength:result.sequenceLength,stages});
 }
 for(const session of Object.values(sessions))await session.release();
 ipcRenderer.send('mf:done');
})().catch(error=>ipcRenderer.send('mf:done',error.stack||String(error)));
