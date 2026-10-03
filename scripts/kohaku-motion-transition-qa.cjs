// SPDX-License-Identifier: Apache-2.0
// Deterministic real Chromium animation frames, no profile or API access.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const [source, output] = process.argv.slice(2);
if (!source || !output || fs.existsSync(output)) throw Error('Supply source and fresh output');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile'));
const { MascotStaticServer } = require(path.join(source, 'desktop/lib/static-server.cjs'));
const server = new MascotStaticServer(source);
const guard = setTimeout(() => app.exit(1), 180000);
function difference(a, b, region) {
  let sum = 0, peak = 0, count = 0;
  for(let y=region[1]; y<region[1]+region[3]; y++) for(let x=region[0]; x<region[0]+region[2]; x++) {
    const i=(y*a.width+x)*4; let pixel=0;
    for(let k=0;k<3;k++) pixel+=Math.abs(a.data[i+k]*a.data[i+3]/255-b.data[i+k]*b.data[i+3]/255)/3;
    pixel+=Math.abs(a.data[i+3]-b.data[i+3])*.25; sum+=pixel; peak=Math.max(peak,pixel);count++;
  }
  return {mean:sum/count,peak};
}
(async()=>{
  await app.whenReady(); await server.start();
  const win=new BrowserWindow({width:700,height:740,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  await win.loadURL(server.origin()+'/?mode=obs&desktop=1&kohakuMotion=1');
  const js=s=>win.webContents.executeJavaScript(s);
  await js(`(async()=>{window.qaPlayer=await PuruPuruDrawnPoseRuntime.createPlayer({manifestUrl:'./assets/amber-avatar/authored-motion/manifest.json'});window.qaCanvas=document.createElement('canvas');qaCanvas.width=qaCanvas.height=640;})()`);
  const cues={90:'curious_tilt',160:'delighted_agreement',200:'doubtful_side_eye',235:'attentive_listening',285:'neutral',310:'sleepy_yawn'};
  let previous=null; const metrics=[], states=[];
  for(let frame=0;frame<420;frame++) {
    const now=frame*1000/30,cue=cues[frame];
    const r=await js(`(()=>{${cue?`qaPlayer.trigger(${JSON.stringify(cue)},${now},4500);`:''}
      const speaking=${frame>=115&&frame<151||frame>=185&&frame<216};
      const s=qaPlayer.update(${now},{mouthState:speaking?${frame%9<4?2:0}:0,blinkClosed:${frame>=137&&frame<141},audioLevel:speaking?.3:0});
      const c=qaCanvas.getContext('2d');c.clearRect(0,0,640,640);qaPlayer.render(c,{width:640,height:640});
      return {state:s,png:qaCanvas.toDataURL('image/png')};})()`);
    const bytes=Buffer.from(r.png.split(',')[1],'base64'), png=PNG.sync.read(bytes);
    fs.writeFileSync(path.join(output,String(frame).padStart(4,'0')+'.png'),bytes);
    if(previous)metrics.push({frame,whole:difference(png,previous,[0,0,640,640]).mean,face:difference(png,previous,[220,220,235,210]).mean});
    previous=png;states.push({frame,...r.state});
  }
  const top=key=>[...metrics].sort((a,b)=>b[key]-a[key]).slice(0,12);
  fs.writeFileSync(path.join(output,'metrics-pending.json'),JSON.stringify({passed:false,topWhole:top('whole'),topFace:top('face')},null,2));
  const mouthSources=await js('qaPlayer.mouthSources');
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'assets/amber-avatar/authored-motion/manifest.json')));
  const requiredMouthSources=[manifest.poses.neutral.variants['open-closed'],manifest.poses.neutral.variants['open-half'],manifest.poses.neutral.variants['open-open'],
    ...Object.values(manifest.cels.sequences).flatMap(s=>s.frames)];
  assert.ok(requiredMouthSources.every(file=>mouthSources.some(s=>s.file===file)),'every pose frame and cel needs an extracted mouth');
  assert.ok(mouthSources.every(s=>s.inkPixels>0),'no source face may retain its undetected old mouth');
  const renderDiagnostics=await js('qaPlayer.renderDiagnostics');
  assert.deepEqual(renderDiagnostics,{poseMode:'shared-rigid-head',eyeLayers:2,mouthLayers:1,decodedImages:20});
  assert.ok(top('whole')[0].whole<9,'large full-character frame discontinuity');
  assert.ok(top('face')[0].face<12,'large facial frame discontinuity');
  assert.ok(states[160].tilt>.8,'expression must not snap the tilted head to neutral');
  assert.ok(states.some(s=>s.blinkAmount>0&&s.blinkAmount<1),'blink needs intermediate presentation');
  assert.ok(Math.max(...states.slice(0,90).map(s=>s.life.x))-Math.min(...states.slice(0,90).map(s=>s.life.x))>.01,'idle must not be a still frame');
  assert.ok(Math.max(...states.map(s=>s.hair[0]))-Math.min(...states.map(s=>s.hair[0]))>15,'hair needs visible independent follow-through');
  assert.ok(states.some(s=>Math.abs(s.hair[0]-s.hairMiddle[0])>1),'lengths and tips must not move as one rigid sheet');
  // Exercise held tilt, repeated eye closures, continuous lip articulation and
  // interruption separately from the short mixed-expression demonstration.
  await js("qaPlayer.reset();qaPlayer.update(0,{idleEnabled:false});qaPlayer.trigger('curious_tilt',0,10000);qaPlayer.update(5000,{idleEnabled:false});");
  const tiltStress=[];
  for(let f=0;f<180;f++){
    const now=5500+f*1000/30;
    const r=await js(`(()=>{${f===120?`qaPlayer.trigger('neutral',${now},10000);`:''}
      const s=qaPlayer.update(${now},{mouthOpenness:${(1-Math.cos(f*.35))},audioLevel:.25,blinkClosed:${f%45>=28&&f%45<34}});
      const c=qaCanvas.getContext('2d');c.clearRect(0,0,640,640);qaPlayer.render(c,{width:640,height:640});
      return{state:s,png:qaCanvas.toDataURL('image/png'),render:qaPlayer.renderDiagnostics};})()`);
    assert.equal(r.render.eyeLayers,2);assert.equal(r.render.mouthLayers,1);assert.equal(r.state.transitionFrame,null);
    if(f<120)assert.equal(r.state.tilt,1,'speaking/blinks cannot disturb the held head pose');
    tiltStress.push({frame:f,...r.state});
    fs.writeFileSync(path.join(output,'tilt-'+String(f).padStart(4,'0')+'.png'),Buffer.from(r.png.split(',')[1],'base64'));
  }
  const report={scope:'deterministic Chromium frames; synthetic audio; no real Jev/TTS',passed:true,fps:30,frames:420,tiltStress,metrics,states,mouthSources,renderDiagnostics,topWhole:top('whole'),topFace:top('face')};
  fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({topWhole:report.topWhole.slice(0,5),topFace:report.topFace.slice(0,5)}));
  await js('qaPlayer.dispose()');win.destroy();await server.stop();clearTimeout(guard);app.quit();
})().catch(e=>{console.error(e.stack);app.exit(1);});
