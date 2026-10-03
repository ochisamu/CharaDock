// SPDX-License-Identifier: Apache-2.0
// Isolated Chromium frames. No user profile, microphone, Jev or TTS calls.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('pngjs');
const [source,out]=process.argv.slice(2);
if(!source||!out||fs.existsSync(out))throw Error('Supply SOURCE and fresh OUTPUT');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const {MascotStaticServer}=require(path.join(source,'desktop/lib/static-server.cjs'));
const server=new MascotStaticServer(source),errors=[];
const guard=setTimeout(()=>app.exit(1),180000);
function difference(a,b,region){let sum=0;const [x0,y0,w,h]=region;for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*640+x)*4;for(let k=0;k<3;k++)sum+=Math.abs(a.data[i+k]*a.data[i+3]/255-b.data[i+k]*b.data[i+3]/255);}return sum/(w*h*3);}
(async()=>{
  await app.whenReady();await server.start();
  const win=new BrowserWindow({width:700,height:740,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(event,details,message)=>{const m=event?.message||details?.message||message||'';if(/Uncaught|TypeError|ReferenceError|failed|unavailable/.test(m))errors.push(m);});
  await win.loadURL(server.origin()+'/?mode=obs&desktop=1&kohakuMotion=1');
  const js=s=>win.webContents.executeJavaScript(s),reports=[];
  for(const [name,canvasOnly,reduced]of[['rapid',false,false],['fallback',true,false],['reduced',false,true]]){
    await js(`(async()=>{window.p=await PuruPuruDrawnPoseRuntime.createPlayer({manifestUrl:'./assets/amber-avatar/authored-motion/manifest.json',canvasOnly:${canvasOnly}});window.c=document.createElement('canvas');c.width=c.height=640;p.update(0,{idleEnabled:false});p.trigger('curious_tilt',0,10000);p.update(5000,{idleEnabled:false});})()`);
    const eyes=await js('p.eyeSources');
    assert.equal(eyes.length,28,'every expression eye is prepared before the first frame');
    assert.ok(eyes.every(s=>s.inkPixels>0&&s.inkPixels<5000),'no missing eye or full skin rectangle');
    for(let i=0;i<2;i++){
      const neutral=eyes.find(s=>s.key===`neutral/eyes-open-mouth-closed.png:${i}`);
      const closed=eyes.find(s=>s.key===`neutral/eyes-closed-mouth-closed.png:${i}`);
      const happy=eyes.find(s=>s.key===`cels/10_delighted_agreement/02_peak.png:${i}`);
      assert.ok(neutral.scleraPixels>50,'open eye owns its white sclera');
      assert.ok(closed.scleraPixels<neutral.scleraPixels*.07,'blink lash is really closed');
      assert.ok(happy.scleraPixels<neutral.scleraPixels*.07,'already-closed smile must not be squeezed again');
    }
    let previous=null;const frames=[];
    const cues={8:'delighted_agreement',15:'doubtful_side_eye',22:'attentive_listening',30:'sleepy_yawn',39:'delighted_agreement',45:'neutral',60:'curious_tilt',75:'doubtful_side_eye',100:'neutral'};
    for(let f=0;f<150;f++){
      const now=5500+f*1000/30,cue=cues[f];
      const r=await js(`(()=>{${cue?`p.trigger(${JSON.stringify(cue)},${now},10000);`:''}const state=p.update(${now},{mouthOpenness:${1-Math.cos(f*.4)},audioLevel:.3,blinkClosed:${f%30>=22&&f%30<25},idleEnabled:false,reducedMotion:${reduced}});const ctx=c.getContext('2d');ctx.clearRect(0,0,640,640);p.render(ctx,{width:640,height:640});return{state,face:p.facePresentation,png:c.toDataURL('image/png')};})()`);
      if(r.face.changed&&!reduced)assert.equal(r.face.blink,1,'a face texture may change only under fully closed lids');
      if(r.face.phase==='opening')assert.equal(r.face.changed,false,'pending cues wait until the next closure');
      const bytes=Buffer.from(r.png.split(',')[1],'base64'),png=PNG.sync.read(bytes);
      frames.push({frame:f,now,faceChange:previous?difference(png,previous,[215,225,240,200]):0,pose:r.state.pose,tilt:r.state.tilt,presentation:r.face});previous=png;
      fs.writeFileSync(path.join(out,name+'-'+String(f).padStart(4,'0')+'.png'),bytes);
    }
    // Held tilt and mouth, no body/hair movement: cheeks must not travel with
    // the eyes, unlike the old vertically compressed rectangular skin crop.
    await js("p.reset();p.update(0,{freeze:true});p.trigger('curious_tilt',0,10000);p.update(5000,{freeze:true});");
    const cheeks=await js("[[545,696],[765,645]].map(([x,y])=>{const q=PuruPuruDrawnPoseRuntime.headPoint(x,y,1254,1254,-.18);return[Math.round(q.x*640/1254)-3,Math.round(q.y*640/1254)-3,6,6];})");
    let baseline=null,maxCheekChange=0;
    for(let f=0;f<25;f++){
      const r=await js(`(()=>{p.update(${5000+f*1000/60},{freeze:true,blinkClosed:${f>0&&f<16}});const ctx=c.getContext('2d');ctx.clearRect(0,0,640,640);p.render(ctx,{width:640,height:640});return c.toDataURL('image/png');})()`);
      const bytes=Buffer.from(r.split(',')[1],'base64'),png=PNG.sync.read(bytes);
      if(!baseline)baseline=png;else for(const region of cheeks)maxCheekChange=Math.max(maxCheekChange,difference(png,baseline,region));
      fs.writeFileSync(path.join(out,name+'-blink-'+String(f).padStart(3,'0')+'.png'),bytes);
    }
    assert.ok(maxCheekChange<.2,'blink must not rescale/move cheek skin');
    reports.push({name,frames,eyes,maxCheekChange,top:[...frames].sort((a,b)=>b.faceChange-a.faceChange).slice(0,8)});
    await js('p.dispose()');
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,scope:'synthetic isolated renderer, not live Jev/TTS',reports,errors},null,2));
  console.log(JSON.stringify({passed:true,reports:reports.map(r=>({name:r.name,maxCheekChange:r.maxCheekChange,top:r.top.slice(0,2)})),errors}));
  win.destroy();await server.stop();clearTimeout(guard);app.quit();
})().catch(e=>{console.error(e.stack);app.exit(1);});
