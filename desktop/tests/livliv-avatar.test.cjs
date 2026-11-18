// SPDX-License-Identifier: Apache-2.0
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {create}=require('../livliv-avatar-runtime.js');
const {APPEARANCE,kohakuLivliv}=require('../lib/livliv-avatar.cjs');
const {MascotStaticServer}=require('../lib/static-server.cjs');
const {RemoteCompanionServer}=require('../lib/remote-server.cjs');
const root=path.resolve(__dirname,'../..'),pack=kohakuLivliv(root),descriptor=pack.descriptor;
function fake({load}={}){let clock=1000;const players=[],errors=[];
 class Player{constructor(canvas){this.params={angleX:0,angleY:0,angleZ:0,bodyX:0,bodyZ:0,breath:0};this.puppet={params:this.params,tuning:{turn:.8,breath:.9}};this.canvas=canvas;players.push(this);this.expressions=[];this.actions=[];}
 async load(url){if(load)await load(this,url);}dispose(){this.disposed=true;}setExpression(id){this.expressions.push(id);}act(id){this.actions.push(id);}setAway(value){(this.away ||= []).push(value);}use(driver){this.driver=driver;return()=>{};}advance(){this.driver?.update({params:this.params});}}
 const api=create({engine:{Player},makeCanvas:()=>({toDataURL:()=> 'data:image/png;base64,QA'}),now:()=>clock,onError:e=>errors.push(e.message)});
 return {api,players,errors,tick:ms=>{clock+=ms;}};
}
test('bundled Kohaku uses valid v4 data and asset access is allowlisted',()=>{
 const model=JSON.parse(pack.read('model.json').body);const {readModel}=require('../../vendor/livliv-player/validator.cjs');readModel(model);
 assert.equal(APPEARANCE,'livliv-kohaku');assert.equal(model.meta.watermark.kind,'none');assert.notEqual(model.meta.license.id,'Apache-2.0');
 for(const layer of model.layers)for(const file of [layer.texture,...(layer.frames||[])])assert.ok(pack.read(file));
 for(const bad of ['../model.json','textures/../../LICENSE','BUILD.json','textures/nope.png','https://external/asset.png'])assert.equal(pack.read(bad),null);
});
test('local and paired Link serve only the selected Kohaku package',async t=>{
 let selected=true;const get=(id,file)=>selected&&id==='kohaku'?pack.read(file):null;
 const local=new MascotStaticServer(root,{getLivlivAsset:get});await local.start();t.after(()=>local.stop());
 const url=descriptor.modelUrl;assert.equal((await fetch(local.origin()+url)).status,200);selected=false;assert.equal((await fetch(local.origin()+url)).status,404);selected=true;
 const remote=new RemoteCompanionServer({rootDir:path.join(root,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getLivlivAsset:get}});await remote.start();t.after(()=>remote.stop());
 assert.equal((await fetch(remote.origin()+url)).status,401);
 const paired=await fetch(remote.origin()+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json',Origin:remote.origin()},body:JSON.stringify({token:new URL(remote.pairingUrl()).hash.slice(7),deviceName:'QA'})});
 assert.equal(paired.status,200);const headers={Cookie:paired.headers.get('set-cookie').split(';')[0]};
 assert.equal((await fetch(remote.origin()+url,{headers})).status,200);selected=false;assert.equal((await fetch(remote.origin()+url,{headers})).status,404);
 for(const file of ['livliv.js','livliv-avatar-runtime.js'])assert.equal((await fetch(remote.origin()+'/'+file)).status,200);
});
test('mouth, host blink, decision cues, expiry and reduced motion share one frame owner',async()=>{
 const {api,players,tick}=fake();const loading=api.sync(descriptor,'amber-avatar');api.expression({emotion:'happy',forceMouth:2,forceEyesClosed:true,durationMs:200});await loading;
 api.draw();const p=players[0];assert.equal(p.params.mouthOpen,1);assert.equal(p.params.eyeLOpen,0);assert.equal(p.expressions.at(-1),'smile');
 api.expression({characterId:'other',emotion:'neutral'});assert.equal(p.expressions.at(-1),'smile');tick(201);
 api.draw({mouth:.5,blink:false,reduced:true});assert.equal(p.params.mouthOpen,.5);assert.equal(p.params.eyeLOpen,1);assert.equal(p.params.angleX,0);assert.equal(p.expressions.at(-1),null);
 api.expression({nikePerformance:'nod'});assert.equal(p.actions.at(-1),'nod');api.dispose();assert.equal(p.disposed,true);assert.equal(api.status().ready,false);
});
test('a late load cannot revive a switched or removed appearance',async()=>{
 let resolve;const {api,players}=fake({load:()=>new Promise(r=>resolve=r)});const loading=api.sync(descriptor,'amber-avatar');await api.sync(null,'amber-avatar');resolve();await loading;
 assert.equal(api.status().ready,false);assert.equal(api.status().loading,false);assert.equal(players[0].disposed,true);assert.equal(api.draw(),null);
});
test('load and draw failures settle loading and allow the original appearance',async()=>{
 const {api,errors}=fake({load:async()=>{throw Error('GPU unavailable');}});await api.sync(descriptor,'amber-avatar');assert.equal(api.status().loading,false);assert.equal(api.status().ready,false);assert.deepEqual(errors,['GPU unavailable']);
 await api.sync(null,'amber-avatar');assert.equal(api.status().error,'');
 const second=fake();await second.api.sync(descriptor,'amber-avatar');second.players[0].advance=()=>{throw Error('context lost');};assert.equal(second.api.draw(),null);assert.equal(second.api.status().ready,false);
});

test('Kohaku selection survives restart and cannot attach the built-in prototype to another character',t=>{
 const os=require('node:os'),{Preferences}=require('../lib/preferences.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livliv-prefs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'preferences.json');const preferences=new Preferences(file);preferences.patch({characterAvatarSelections:{'amber-avatar':'livliv-kohaku','sage-avatar':'livliv-kohaku'}});
 const restored=new Preferences(file);assert.equal(restored.data.characterAvatarSelections['amber-avatar'],'livliv-kohaku');assert.equal(restored.data.characterAvatarSelections['sage-avatar'],undefined);
});

test('production rig preserves original registered facial pixels and dimension-matched textures',()=>{
 const {PNG}=require('pngjs'),model=JSON.parse(pack.read('model.json').body);
 assert.ok(model.layers.some(l=>l.id==='face'));assert.ok(!model.layers.some(l=>l.role?.startsWith('iris_')),'regenerated eyes must not replace original artwork');
 for(const l of model.layers)for(const f of [l.texture,...(l.frames||[]),l.mask,l.talk].filter(Boolean)){const p=PNG.sync.read(pack.read(f).body);assert.deepEqual([p.width,p.height],[l.w,l.h],f);assert.ok(p.data.some((v,i)=>i%4===3&&v>0),'nonempty texture: '+f);}
 const original=PNG.sync.read(fs.readFileSync(path.join(root,'assets/kohaku-livliv-sources/original/source.png')));
 for(const side of ['L','R']){
  const eye=model.layers.find(l=>l.role==='eye_'+side),texture=PNG.sync.read(pack.read(eye.texture).body);
  for(let y=0;y<eye.h;y++)for(let x=0;x<eye.w;x++){
   const a=(y*eye.w+x)*4,b=((eye.y+y)*original.width+eye.x+x)*4;
   if(texture.data[a+3])assert.deepEqual(texture.data.subarray(a,a+4),original.data.subarray(b,b+4),'original eye pixels: '+side);
  }
 }
 const flat=PNG.sync.read(fs.readFileSync(path.join(root,'work/evidence/kohaku-livliv-v2/flat-assembly.png')));
 for(let y=450;y<795;y++)for(let x=450;x<880;x++){
  const k=(y*original.width+x)*4;
  if(original.data[k+3]===255)assert.deepEqual(flat.data.subarray(k,k+4),original.data.subarray(k,k+4),'neutral face identity at '+x+','+y);
 }
 const mouth=model.layers.find(l=>l.role==='mouth'),closed=PNG.sync.read(pack.read(mouth.frames[0]).body);
 for(let y=0;y<mouth.h;y++)for(let x=0;x<mouth.w;x++){
  const k=(y*mouth.w+x)*4,j=((mouth.y+y)*original.width+mouth.x+x)*4;
  if(closed.data[k+3])assert.deepEqual(closed.data.subarray(k,k+4),original.data.subarray(j,j+4),'original mouth pixels');
 }

});
test('original face patches have transparent borders so clamping cannot extend skin outside the crop',()=>{
 const {PNG}=require('pngjs'),model=JSON.parse(pack.read('model.json').body);
 for(const layer of model.layers.filter(l=>l.id!=='face'))for(const file of new Set([layer.texture,...(layer.frames||[]),layer.talk].filter(Boolean))){
  const p=PNG.sync.read(pack.read(file).body);for(let x=0;x<p.width;x++){assert.equal(p.data[x*4+3],0,file);assert.equal(p.data[((p.height-1)*p.width+x)*4+3],0,file);}
  for(let y=0;y<p.height;y++){assert.equal(p.data[(y*p.width)*4+3],0,file);assert.equal(p.data[(y*p.width+p.width-1)*4+3],0,file);}
 }
});
test('emotion and gaze are applied after upstream idle; speech owns the mouth during a surprise',async()=>{
 const {api,players,tick}=fake();await api.sync(descriptor,'amber-avatar');api.expression({emotion:'thinking'});tick(100);api.draw({gazeX:.4,gazeY:.2});assert.ok(players[0].params.browRY>0);assert.ok(players[0].params.eyeBallX<.4);
 api.expression({emotion:'surprised'});tick(100);api.draw({mouth:.1,level:.2});assert.equal(players[0].params.mouthOpen,.1);assert.equal(players[0].params.vowel,0);tick(100);api.draw({mouth:0,level:0});assert.ok(players[0].params.mouthOpen>.1);assert.equal(players[0].params.vowel,-1);
 api.draw({reduced:true});assert.equal(players[0].puppet.physicsScale,0);assert.equal(players[0].params.angleZ,0);
});

// The owner validates controls once; PC and Link consume the same scoped descriptor.
test('LivLiv settings persist by character/model and stale commands cannot cross a switch',t=>{
 const os=require('node:os'),{LivlivControlStore}=require('../lib/livliv-control-store.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livliv-controls-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'controls.json'),store=new LivlivControlStore(file),input={characterId:'amber-avatar',modelId:descriptor.id,version:descriptor.version};
 const state=store.patch('amber-avatar',descriptor,{...input,patch:{params:{angleX:100,mouthOpen:.4},view:{zoom:8},away:true}});
 assert.equal(state.params.angleX,30);assert.equal(state.view.zoom,4);assert.equal(new LivlivControlStore(file).get('amber-avatar','kohaku').away,true);
 assert.equal(store.get('other','kohaku').away,false);
 assert.throws(()=>store.patch('other',descriptor,{...input,patch:{idle:false}}),/見た目/);
 assert.throws(()=>store.patch('amber-avatar',descriptor,{...input,patch:{expression:'missing'}}),/表情/);
 assert.throws(()=>store.command('amber-avatar',descriptor,{...input,action:'execute'}),/Invalid/);
 const command=store.command('amber-avatar',descriptor,{...input,action:'nod'});assert.equal(command.action,'nod');assert.ok(command.expiresAt>Date.now());
 assert.equal(store.patch('amber-avatar',descriptor,{...input,patch:{params:{angleX:null}}}).params.angleX,undefined);
 assert.equal(store.patch('amber-avatar',descriptor,{...input,patch:{reset:true}}).away,false);
});
test('shared renderer applies manual pose/view, idempotent dozing, bounded commands and pause without stealing speech',async()=>{
 const {api,players,tick}=fake();await api.sync(descriptor,'amber-avatar');const p=players[0];p.view={};p.snapshot=()=>{throw Error('snapshot must not redraw the player');};
 api.setControls({params:{angleX:14,mouthOpen:1,vowel:1},view:{zoom:1.5},away:true});api.draw({mouth:.2,level:.2,vowel:-1});
 assert.equal(p.params.angleX,14);assert.equal(p.params.mouthOpen,.2);assert.equal(p.params.vowel,-1);assert.equal(p.view.zoom,1.5);
 api.setControls({params:{angleX:14,mouthOpen:1,vowel:1},view:{zoom:1.5},away:true});assert.deepEqual(p.away,[true]);
 api.draw();assert.equal(p.params.mouthOpen,1);
 const command={id:'test1',characterId:'amber-avatar',modelId:descriptor.id,version:descriptor.version,action:'shy',expiresAt:Date.now()+3000};
 assert.equal(api.command(command),true);assert.equal(api.command(command),false);assert.equal(p.actions.at(-1),'shy');
 assert.equal(api.command({...command,id:'wrong',characterId:'other'}),false);assert.equal(api.command({...command,id:'expired',expiresAt:0}),false);
 assert.equal(api.command({...command,id:'blink',action:'blink'}),true);api.draw();assert.equal(p.params.eyeLOpen,0);tick(181);api.draw();assert.equal(p.params.eyeLOpen,1);
 api.setControls({paused:true});assert.deepEqual(p.away,[true,false]);const before={...p.params};api.draw({mouth:.8,level:.5});assert.deepEqual(p.params,before);assert.equal(api.command({...command,id:'paused'}),false);assert.equal(api.snapshot(),'data:image/png;base64,QA');
 api.setControls({paused:false});api.draw({mouth:.3,level:.1});assert.equal(p.params.mouthOpen,.3);
});
test('LivLiv imports retain metadata, textures and model expressions; invalid archives leave the existing store intact',async t=>{
 const os=require('node:os'),AdmZip=require('adm-zip'),{LivlivAvatarStore,readPackage}=require('../lib/livliv-avatar-store.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'livliv-import-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new LivlivAvatarStore(path.join(dir,'store')),source=path.join(root,'assets/amber-avatar/livliv');
 const imported=await store.import(source,'amber-avatar'),d=store.descriptor('amber-avatar',imported.id);assert.equal(d.meta.license.id,'LicenseRef-CharaDock-Character');assert.equal(d.expressions[0].id,'smile');assert.ok(store.read('amber-avatar',d.id,'model.json'));assert.equal(store.descriptor('other',d.id),null);
 assert.equal(store.read('amber-avatar',d.id,'../../preferences.json'),null);assert.equal((await store.import(source,'amber-avatar')).id,d.id);
 assert.equal(new LivlivAvatarStore(path.join(dir,'store')).descriptor('amber-avatar',d.id).version,d.version);
 const archive=new AdmZip();for(const file of Object.keys(JSON.parse(fs.readFileSync(path.join(source,'BUILD.json'))).files))archive.addFile('avatar/'+file,fs.readFileSync(path.join(source,file)));
 const packed=await store.import(archive.toBuffer(),'other');assert.ok(store.descriptor('other',packed.id));
 const bad=JSON.parse(fs.readFileSync(path.join(source,'model.json')));bad.layers[0].texture='https://external/image.png';const broken=new AdmZip();broken.addFile('model.json',Buffer.from(JSON.stringify(bad)));
 await assert.rejects(readPackage(broken.toBuffer()),/model|texture|path/);await assert.rejects(store.import(Buffer.from('not a zip'),'amber-avatar'));assert.equal(store.list('amber-avatar').length,1);
 const huge=new AdmZip();const model=JSON.parse(fs.readFileSync(path.join(source,'model.json')));huge.addFile('model.json',Buffer.from(JSON.stringify(model)));const png=Buffer.from(pack.read(model.layers[0].texture).body);png.writeUInt32BE(65535,16);huge.addFile(model.layers[0].texture,png);await assert.rejects(readPackage(huge.toBuffer()),/大きすぎ/);
});

test('Link avatar mutations and binary imports require pairing, Origin and CSRF',async t=>{
 const calls=[],server=new RemoteCompanionServer({rootDir:path.join(root,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getState:()=>({}),setLivlivControls:input=>{calls.push(input);return {};},livlivCommand:input=>{calls.push(input);return {ok:true};},importLivliv:(body,id)=>{calls.push({bytes:body.length,id});return {};},selectAppearance:input=>{calls.push(input);return {};}}});
 await server.start();t.after(()=>server.stop());const origin=server.origin();
 for(const endpoint of ['/api/livliv/settings','/api/livliv/command','/api/livliv/import','/api/appearance'])assert.equal((await fetch(origin+endpoint,{method:'POST',headers:{Origin:origin},body:'{}'})).status,401);
 const paired=await fetch(origin+'/api/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(server.pairingUrl()).hash.slice(7)})});const {csrfToken}=await paired.json(),cookie=paired.headers.get('set-cookie').split(';')[0];
 for(const endpoint of ['/api/livliv/settings','/api/livliv/command','/api/livliv/import','/api/appearance']){
  const missing=await fetch(origin+endpoint,{method:'POST',headers:{Origin:origin,Cookie:cookie},body:'{}'});assert.equal(missing.status,403);
  const allowed=await fetch(origin+endpoint+'?characterId=amber-avatar',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CharaDock-CSRF':csrfToken,'Content-Type':endpoint.endsWith('import')?'application/octet-stream':'application/json'},body:endpoint.endsWith('import')?Buffer.from('zipfixture'):JSON.stringify({action:'nod'})});assert.equal(allowed.status,200);
 }
 assert.equal(calls.length,4);assert.deepEqual(calls[2],{bytes:10,id:'amber-avatar'});
 for(const file of ['livliv-controls.js','livliv-controls-ui.js','livliv-controls.css']){const response=await fetch(origin+'/'+file);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').includes(file.endsWith('.css')?'text/css':'text/javascript'));}
});

test('local speech adds eased pose motion; disabling idle and reduced motion keep it still without stopping mouth sync',async()=>{
 const {api,players,tick}=fake();await api.sync(descriptor,'amber-avatar');const p=players[0];
 tick(100);api.draw({mouth:.6,level:.2});assert.ok(p.params.angleY<0);assert.equal(p.params.mouthOpen,.6);assert.ok(Number.isFinite(p.params.angleZ));
 api.draw({mouth:.6,level:.2,reduced:true});assert.equal(p.params.angleY,0);assert.equal(p.params.angleZ,0);assert.equal(p.params.mouthOpen,.6);
 api.setControls({idle:false});p.params.angleX=p.params.angleY=p.params.angleZ=0;tick(100);api.draw({mouth:.4,level:.2});assert.equal(p.params.angleY,0);assert.equal(p.params.angleZ,0);assert.equal(p.params.mouthOpen,.4);
});
test('movement size is bounded, persists, and scales from the loaded rig instead of compounding every frame',async t=>{
 const {api,players,tick}=fake();await api.sync(descriptor,'amber-avatar');const p=players[0];
 api.setControls({motionStrength:1.5});for(let i=0;i<10;i++){tick(17);api.draw();}assert.ok(Math.abs(p.puppet.tuning.turn-1.2)<1e-8);assert.equal(p.puppet.tuning.breath,1.35);
 api.setControls({motionStrength:.5});api.draw();assert.equal(p.puppet.tuning.turn,.4);api.setControls({reset:true});api.draw();assert.equal(p.puppet.tuning.turn,.8);
 const {normalize}=require('../livliv-controls.js');assert.equal(normalize({motionStrength:999}).motionStrength,1.5);assert.equal(normalize({motionStrength:0}).motionStrength,.5);
 const os=require('node:os'),{LivlivControlStore}=require('../lib/livliv-control-store.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'livliv-strength-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'controls.json'),store=new LivlivControlStore(file);
 store.patch('amber-avatar',descriptor,{characterId:'amber-avatar',modelId:descriptor.id,version:descriptor.version,patch:{motionStrength:1.3}});assert.equal(new LivlivControlStore(file).get('amber-avatar',descriptor.id).motionStrength,1.3);
});

test('native expression artwork is selected by shared decision cues, manual selection wins and zero weight restores neutral eyes',async()=>{
 const {api,players,tick}=fake();await api.sync(descriptor,'amber-avatar');const p=players[0];
 for(const id of ['thinking','worried','angry','surprised']){api.expression({emotion:id,durationMs:200});assert.equal(p.expressions.at(-1),id);tick(210);api.draw();assert.equal(p.expressions.at(-1),null);}
 api.expression({emotion:'sad'});assert.equal(p.expressions.at(-1),'worried');
 api.setControls({expression:'angry',weight:1});api.expression({emotion:'happy'});assert.equal(p.expressions.at(-1),'angry');
 tick(100);api.draw();assert.ok(p.params.eyeLOpen<1);
 api.setControls({expression:'angry',weight:0});for(let i=0;i<60;i++){tick(17);api.draw();}assert.ok(p.params.eyeLOpen>.999);
 api.setControls({expression:null});assert.equal(p.expressions.at(-1),'smile');
});
test('new expression plates cannot paint over the original eyes, silhouette or talking mouth',()=>{
 const {PNG}=require('pngjs'),{ZONES,PROTECTED_EYES,inside}=require('../../scripts/kohaku-expression-patches.cjs'),model=JSON.parse(pack.read('model.json').body);
 for(const id of ['thinking','worried','angry','surprised']){
  assert.ok(model.expressions.some(e=>e.id===id));const layer=model.layers.find(l=>l.id==='expression_'+id),p=PNG.sync.read(pack.read(layer.texture).body),talk=PNG.sync.read(pack.read(layer.talk).body);let painted=0,brows=0,mouth=0;
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
   const k=(y*p.width+x)*4,X=x+layer.x,Y=y+layer.y;
   if(p.data[k+3]){painted++;assert.ok(ZONES.some(({box:[x,y,w,h]})=>X>=x&&X<x+w&&Y>=y&&Y<y+h));assert.ok(!PROTECTED_EYES.some(poly=>inside(poly,X,Y)),'protected original eyes: '+id);if(Y>=687)mouth++;else brows++;}
   if(Y>=687)assert.equal(talk.data[k+3],0,'speech keeps canonical mouth: '+id);
  }
  assert.ok(painted>1000&&brows>500&&mouth>300,id+' has visible authored brows and mouth');
 }
});
