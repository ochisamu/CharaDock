// SPDX-License-Identifier: Apache-2.0
// Isolated real Electron renderer. Artificial speech levels, no AI/mic calls.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const [source, output] = process.argv.slice(2);
if (!source || !output || fs.existsSync(path.join(output, 'profile'))) throw new Error('Supply SOURCE and fresh OUTPUT');
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile'));
const { MascotStaticServer } = require(path.join(source, 'desktop/lib/static-server.cjs'));
const { JevClient } = require(path.join(source, 'desktop/lib/jev-client.cjs'));
const { JevExpressionDirector } = require(path.join(source, 'desktop/lib/jev-expression-director.cjs'));
const { KOHAKU_EMOTIONS } = require(path.join(source, 'desktop/lib/expressive-character.cjs'));
const server = new MascotStaticServer(source), errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const guard = setTimeout(() => { console.error('Kohaku UI QA timeout'); app.exit(1); }, 120000);
(async () => {
  await app.whenReady(); await server.start();
  const dir = path.join(source, 'assets/amber-avatar');
  const filenames = { backHair: 'back-hair.png', frontHair: 'front-hair.png' };
  for (const e of ['open', 'closed']) for (const m of ['closed', 'half', 'open']) filenames[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`] = `eyes-${e}-mouth-${m}.png`;
  const snapshot = { type: 'purupuru-obs-snapshot', characterId: 'amber-avatar', kohakuMotionEnabled: true,
    settings: JSON.parse(fs.readFileSync(path.join(dir, 'default-settings.json'))),
    avatarImages: Object.fromEntries(Object.entries(filenames).map(([k,f]) => [k, 'data:image/png;base64,' + fs.readFileSync(path.join(dir,f)).toString('base64')])) };
  snapshot.settings.state.avatarX = 0; snapshot.settings.state.avatarY = 30; server.setSnapshot(snapshot, false);
  const win = new BrowserWindow({ width: 850, height: 900, show: false, transparent: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (event, details, message) => { const m = event?.message || details?.message || message || ''; if (/Uncaught|TypeError|ReferenceError|authored.*failed|unavailable/.test(m)) errors.push(m); });
  const js = code => win.webContents.executeJavaScript(code);
  await win.loadURL(server.origin() + '/?mode=obs&desktop=1&kohakuMotion=1');
  win.showInactive();
  for (let i=0; i<200; i++) { if (await js('window.PuruPuruKohakuMotionPreview?.getStatus().ready')) break; await sleep(200); }
  assert.equal(await js('window.PuruPuruKohakuMotionPreview.getStatus().ready'), true);
  const states = {};
  for (const state of ['neutral', 'curious_tilt', 'attentive_listening', 'delighted_agreement', 'doubtful_side_eye', 'sleepy_yawn']) {
    await js(`window.PuruPuruKohakuMotionPreview.reset(); window.PuruPuruKohakuMotionPreview.trigger(${JSON.stringify(state)})`);
    await sleep(1600); states[state] = await js('window.PuruPuruKohakuMotionPreview.getStatus().output');
    assert.equal(states[state].pose, state);
    fs.writeFileSync(path.join(output, state+'.png'), (await win.capturePage()).toPNG());
  }
  // Exercise the production Jev parser -> director -> SSE input -> app.js
  // route, not the preview trigger. Deterministic provider fixtures: no key,
  // network call or assertion about the quality of the live classifier.
  let fixtureEmotion='neutral',classifications=0;
  const client=new JevClient();client.ask=async()=>{
    classifications++;const selected=value=>({type:'choice',choice:value,probabilities:{[value]:1}});
    return{emotion:selected(fixtureEmotion),gesture:selected('neutral'),performance:selected('none')};
  };
  const director=new JevExpressionDirector({enabled:()=>true,context:()=> 'amber-avatar',
    classify:(text,options)=>client.expression(text,{...options,nikePerformance:true,allowedEmotions:KOHAKU_EMOTIONS}),
    apply:expression=>server.pushInput({...expression,voiceRaw:0})});
  const expected={neutral:'neutral',happy:'delighted_agreement',thinking:'curious_tilt',
    surprised:'curious_tilt',soft:'attentive_listening',exasperated:'doubtful_side_eye'},jevStates={};
  for(const emotion of KOHAKU_EMOTIONS){
    await js('window.PuruPuruKohakuMotionPreview.reset()');fixtureEmotion=emotion;
    const id=await director.prepare('Synthetic '+emotion);assert.ok(id);assert.equal(director.activate(id),true);
    await sleep(1200);
    // Voice/cursor packets must not reset the chosen Jev expression.
    for(let i=0;i<4;i++){server.pushInput({voiceRaw:.4,targetX:.2,targetY:0});await sleep(100);}
    const state=await js('window.PuruPuruKohakuMotionPreview.getStatus().output');
    assert.equal(state.pose,expected[emotion],emotion+' must reach authored drawing through SSE');
    assert.equal(state.speaking,true,'Jev must leave mouth ownership to the voice stream');
    jevStates[emotion]={pose:state.pose,speaking:state.speaking};
    fs.writeFileSync(path.join(output,'jev-'+emotion+'.png'),(await win.capturePage()).toPNG());
  }
  assert.equal(classifications,KOHAKU_EMOTIONS.length);director.cancel();server.pushInput({voiceRaw:0});
  await js(`window.PuruPuruKohakuMotionPreview.reset();window.PuruPuruKohakuMotionPreview.trigger('curious_tilt')`); await sleep(1400);
  for (let i=0;i<5;i++) { server.pushInput({ voiceRaw: .7, forceMouth: 2, forceEyesClosed: true, durationMs: 1800 }); await sleep(100); }
  const speaking = await js('window.PuruPuruKohakuMotionPreview.getStatus().output');
  console.log('Speech QA', JSON.stringify(speaking));
  assert.equal(speaking.pose, 'curious_tilt'); assert.equal(speaking.mouthState, 2); assert.equal(speaking.blinkClosed, true);
  fs.writeFileSync(path.join(output, 'tilt-speech-blink.png'), (await win.capturePage()).toPNG());
  const fallback = await js(`(async()=>{const p=await window.PuruPuruDrawnPoseRuntime.createPlayer({manifestUrl:'./assets/amber-avatar/authored-motion/manifest.json',canvasOnly:true});p.trigger('curious_tilt',0);p.update(600,{mouthState:1,blinkClosed:true});const c=document.createElement('canvas');c.width=c.height=640;const ok=p.render(c.getContext('2d'),{width:640,height:640});const result={ok,renderer:p.update(700,{}).hairRenderer,png:c.toDataURL('image/png')};p.dispose();return result;})()`);
  const {png, ...canvas} = fallback;
  fs.writeFileSync(path.join(output, 'canvas2d-fallback.png'), Buffer.from(png.split(',')[1], 'base64'));
  assert.deepEqual(canvas, {ok:true,renderer:'canvas2d-fallback'});
  const frameStats = await js(`new Promise(resolve=>{let count=0,draws=0,previous=null,start=performance.now();function frame(){const output=window.PuruPuruKohakuMotionPreview.getStatus().output;if(output!==previous)draws++;previous=output;if(++count<100)requestAnimationFrame(frame);else resolve({raf:count,draws,elapsedMs:performance.now()-start});}requestAnimationFrame(frame);})`);
  assert.ok(frameStats.draws >= 20, 'Real renderer keeps updating, not only a static first frame');
  server.setSnapshot({...snapshot,characterId:'custom-kohaku'}); await sleep(1000);
  assert.equal(await js('window.PuruPuruKohakuMotionPreview.getStatus().enabled'), false);
  server.setSnapshot({...snapshot,kohakuMotionEnabled:false}); await sleep(1000);
  assert.equal(await js('window.PuruPuruKohakuMotionPreview.getStatus().ready'), false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({passed:true,states,jevStates,speaking,canvas,frameStats,errors,scope:'real isolated Electron renderer; synthetic speech and Jev provider fixtures; not live API/microphone/TTS QA'},null,2));
  clearTimeout(guard); win.destroy(); await server.stop(); console.log('PASS: Kohaku v9 real Electron rendering, states, speech/blink, fallback, character switch'); app.quit();
})().catch(error => { console.error(error.stack); app.exit(1); });
