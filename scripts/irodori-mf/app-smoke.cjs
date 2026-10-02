// Real CharaDock preload/IPC integration, not the standalone benchmark engine.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const [source,model,reference,output,rfModel]=process.argv.slice(2);
if(!output)throw new Error('app-smoke.cjs SOURCE MF_MODEL REFERENCE OUTPUT [RF_MODEL]');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));
let window;
let serial=0;
function send(channel,payload,response){
  return new Promise((resolve,reject)=>{
    const requestId=String(++serial);
    const timer=setTimeout(()=>{ipcMain.removeListener(response,receive);reject(new Error('IPC timeout'));},120000);
    function receive(event,result){
      if(event.sender!==window.webContents||result.requestId!==requestId)return;
      clearTimeout(timer);ipcMain.removeListener(response,receive);resolve(result);
    }
    ipcMain.on(response,receive);
    window.webContents.send(channel,{...payload,requestId});
  });
}
async function synthesize(request,name){
  const result=await send('irodori:synthesize',request,'irodori:result');
  if(result.error)throw new Error(result.error);
  assert.match(result.audioDataUrl,/^data:audio\/wav;base64,/);
  const bytes=Buffer.from(result.audioDataUrl.split(',')[1],'base64');
  assert.ok(bytes.length>44);
  fs.writeFileSync(path.join(output,name+'.wav'),bytes);
  fs.appendFileSync(path.join(output,'results.jsonl'),JSON.stringify({name,...result.metrics})+'\n');
  return result.metrics;
}
app.whenReady().then(async()=>{
  window=new BrowserWindow({show:false,webPreferences:{preload:path.join(source,'desktop/preload-irodori.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
  await window.loadFile(path.join(source,'desktop/irodori.html'));
  const request={version:'v4-mf',precision:'fp16',modelDirectory:model,referenceAudioPath:reference,mode:'reference',numSteps:40,tScheduleMode:'sway',cfgExecution:'batched',seed:42,caption:'自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。',text:'こんにちは。'};
  const {splitIrodoriText}=require(path.join(source,'desktop/lib/irodori-webgpu.cjs'));
  const chunks=splitIrodoriText('今日は音声モデルの速度を調べています。少し長めの文章を読み上げて、声が途切れないか、最後まで自然に話せるかを確認しましょう。結果はあとで一緒に見比べます。');
  for(let i=0;i<chunks.length;i++){
    const metrics=await synthesize({...request,text:chunks[i]},`mf-chunk-${i}`);
    assert.equal(metrics.generationSteps,4);assert.equal(metrics.generationCfgExecution,'none');assert.equal(metrics.modelVersion,'v4-mf');
  }
  const queued=await Promise.all([synthesize({...request,mode:'design'},'mf-design'),synthesize(request,'mf-after-design')]);
  assert.equal(queued.length,2);
  if(rfModel){
    const rf=await synthesize({...request,version:'v4-small',precision:'int4',modelDirectory:rfModel,numSteps:4},'rf-switch');
    assert.equal(rf.generationSteps,16);
    const mf=await synthesize(request,'mf-switch-back');assert.equal(mf.generationSteps,4);
  }
  console.log('PASS: production IPC, sentence chunks, reference/design, queue, RF/MF switching');
  app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
