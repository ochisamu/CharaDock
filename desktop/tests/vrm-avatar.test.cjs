// SPDX-License-Identifier: Apache-2.0
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseVrm}=require('../lib/vrm-avatar.cjs'),{LivlivAvatarStore}=require('../lib/livliv-avatar-store.cjs'),{VrmExpressionPolicy}=require('../../vendor/livliv-player/vrm-policy.cjs'),{create}=require('../livliv-avatar-runtime.js');
const root=path.resolve(__dirname,'../..');
function fixture(edit=()=>{}){
 const raw={asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,count:3,type:'VEC3',componentType:5126}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[],extensions:{VRMC_vrm:{specVersion:'1.0',meta:{name:'Test avatar',authors:['Artist'],avatarPermission:'onlyAuthor',allowRedistribution:false,licenseUrl:'https://vrm.dev/licenses/1.0/'},expressions:{preset:{aa:{morphTargetBinds:[{node:0,index:0,weight:1}]},blink:{morphTargetBinds:[]},happy:{morphTargetBinds:[]},angry:{morphTargetBinds:[]}},custom:{brow_angry:{},angry_eye:{},pre111_happy:{},customFace:{}}}}}};edit(raw);
 let j=Buffer.from(JSON.stringify(raw));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(20+j.length+8+36,8);head.writeUInt32LE(j.length,12);head.writeUInt32LE(0x4e4f534a,16);const bin=Buffer.alloc(44);bin.writeUInt32LE(36);bin.writeUInt32LE(0x004e4942,4);return Buffer.concat([head,j,bin]);
}
test('VRM metadata and usable expressions survive exact-byte import, restart and character scope',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrm-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const body=fixture(),store=new LivlivAvatarStore(dir),saved=await store.import(body,'amber-avatar'),d=store.descriptor('amber-avatar',saved.id);
 assert.equal(d.kind,'vrm');assert.match(d.modelUrl,/model.vrm$/);assert.equal(d.capabilities.lipSync,true);assert.equal(d.meta.redistribution,false);assert.equal(d.meta.author.name,'Artist');assert.ok(d.expressions.some(e=>e.id==='angry'));assert.ok(d.expressions.some(e=>e.id==='customFace'));assert.ok(!d.expressions.some(e=>e.id==='pre111_happy'||e.id==='angry_eye'));
 assert.deepEqual(store.read('amber-avatar',saved.id,'model.vrm').body,body);assert.equal(store.read('other',saved.id,'model.vrm'),null);assert.equal(store.read('amber-avatar',saved.id,'import.json'),null);assert.equal(store.descriptor('other',saved.id),null);assert.equal((await store.import(body,'amber-avatar')).id,saved.id);assert.equal(new LivlivAvatarStore(dir).descriptor('amber-avatar',saved.id).version,d.version);
});
test('VRM rejects non-VRM, truncated GLBs, outside resources, invalid buffer views and mesh bombs',()=>{
 assert.throws(()=>parseVrm(Buffer.from('bad')));const broken=fixture();broken.writeUInt32LE(28,8);assert.throws(()=>parseVrm(broken),/形式/);
 for(const uri of ['https://outside/image.png','../private.png','file:///private'])assert.throws(()=>parseVrm(fixture(j=>j.buffers[0].uri=uri)),/外部/);
 assert.throws(()=>parseVrm(fixture(j=>j.bufferViews[0].byteLength=9000)),/範囲/);assert.throws(()=>parseVrm(fixture(j=>j.accessors[0].count=9000000)),/頂点/);assert.throws(()=>parseVrm(fixture(j=>delete j.extensions)),/情報/);
 assert.throws(()=>parseVrm(fixture(j=>j.accessors.push({count:0xffffffff,type:'VEC4',componentType:5126}))),/頂点・モーフ/);
 assert.throws(()=>parseVrm(fixture(j=>j.extensionsUsed=['KHR_draco_mesh_compression'])),/圧縮/);
});
test('VRM0 expression names and author terms are normalized',()=>{
 const body=fixture(j=>{j.extensions={VRM:{meta:{title:'Legacy',author:'Maker',allowedUserName:'Everyone',commercialUssageName:'Disallow'},blendShapeMaster:{blendShapeGroups:[{name:'Joy',presetName:'joy'},{name:'Sorrow',presetName:'sorrow'},{name:'A',presetName:'a',binds:[{}]},{name:'Blink',presetName:'blink',binds:[]}]}}};});const d=parseVrm(body);assert.equal(d.model.name,'Legacy');assert.equal(d.model.meta.spec,'0');assert.equal(d.model.meta.use,'everyone');assert.equal(d.capabilities.lipSync,true);assert.ok(d.model.expressions.some(e=>e.id==='happy'));assert.ok(d.model.expressions.some(e=>e.id==='sad'));
});
test('authored split expressions retain brows and eyes while actual speech and blink own their parts',()=>{
 const names=['happy','angry','brow_happy','happy_eye','happy_mouth','brow_angry','angry_eye','angry_mouth','aa','blink'],values={aa:.7},manager={expressions:names.map(expressionName=>({expressionName,overrideMouth:expressionName.endsWith('_mouth')?'block':'none',overrideBlink:expressionName.endsWith('_eye')?'block':'none'})),setValue:(id,v)=>values[id]=v};const p=new VrmExpressionPolicy(manager);
 p.apply({mouthOpen:.7,eyeLOpen:1,eyeROpen:1,smile:0},{angry:1},.016);assert.equal(values.angry,0);assert.equal(values.brow_angry,1);assert.equal(values.angry_eye,1);assert.equal(values.angry_mouth,0);assert.equal(values.aa,.7);
 p.apply({mouthOpen:.7,eyeLOpen:0,eyeROpen:0,smile:0},{angry:1},.016);assert.equal(values.brow_angry,1);assert.equal(values.angry_eye,0);assert.equal(values.angry_mouth,0);
 p.apply({mouthOpen:0,eyeLOpen:1,eyeROpen:1,smile:0},{happy:1},.25);assert.equal(values.angry_eye,0);assert.equal(values.brow_angry,0);assert.equal(values.happy_mouth,1);
});
test('a blocking unsplit expression yields to speech instead of locking the mouth',()=>{
 const values={},manager={expressions:[{expressionName:'angry',overrideMouth:'block',overrideBlink:'block'}],setValue:(id,v)=>values[id]=v},policy=new VrmExpressionPolicy(manager);
 policy.apply({mouthOpen:1,eyeLOpen:1,eyeROpen:1},{angry:1},.016);assert.equal(values.angry,0);policy.apply({mouthOpen:0,eyeLOpen:1,eyeROpen:1},{angry:1},.3);assert.equal(values.angry,1);assert.equal(manager.expressions[0].overrideMouth,'none');
});
function fakeVrm(loadVrm){let clock=0;const players=[];class VrmBody{constructor(options){this.options=options;}setFraming(mode,focalLengthMm){this.mode=mode;this.focalLengthMm=focalLengthMm;}setMotionEnabled(v){this.motion=v;}status(){return {mode:this.mode}}}
 class BodyPlayer{constructor(canvas,body){this.body=body;this.params={angleX:0,angleY:0,angleZ:0,bodyX:0,bodyZ:0};this.frameParams=this.params;this.view={};players.push(this);}async load(){}use(d){this.driver=d;}advance(dt){this.lastDt=dt;this.frameCount=(this.frameCount||0)+1;this.driver.update({params:this.params});}setExpression(){return true;}lookAt(){}act(){}dispose(){this.disposed=true;}}
 const api=create({engine:{},loadVrm:loadVrm||(async()=>({VrmBody,BodyPlayer})),makeCanvas:()=>({}),now:()=>clock});return {api,players,tick:()=>clock+=17};}
const descriptor={kind:'vrm',id:'00000000-0000-0000-0000-000000000001',version:'0123456789abcdef',width:768,height:768,modelUrl:'/api/livliv/00000000-0000-0000-0000-000000000001/model.vrm',expressions:[{id:'angry'}]};
test('VRM shares the existing mouth/blink frame owner and bust framing without needing a 2D puppet',async()=>{
 const {api,players,tick}=fakeVrm();await api.sync(descriptor,'amber-avatar');assert.equal(api.status().ready,true);assert.equal(players[0].body.options.framing,'bust');tick();api.draw({mouth:.8,level:.2,blink:true});assert.ok(Math.abs(api.status().parameters.mouthOpen - .44) < 1e-9);
 tick();api.draw({mouth:1,level:.5});assert.equal(api.status().parameters.mouthOpen,.55);
 tick();api.draw();assert.equal(api.status().parameters.mouthOpen,0);
 tick();api.draw({mouth:.8,level:.2,blink:true});assert.equal(api.status().parameters.eyeLOpen,0);api.setControls({view:{head:true},motionStrength:1.3});tick();api.draw();assert.equal(players[0].body.mode,'head');assert.equal(players[0].motionScale,1.3);api.dispose();assert.equal(players[0].disposed,true);
});
test('VRM focal length survives reopen, remains scoped by model and updates a paused portrait', async (t) => {
 const { LivlivControlStore } = require('../lib/livliv-control-store.cjs');
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrm-camera-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 const file = path.join(dir, 'controls.json');
 const store = new LivlivControlStore(file);
 const characterId = 'amber-avatar';
 const scope = { characterId, modelId: descriptor.id, version: descriptor.version };
 assert.equal(store.get(characterId, descriptor.id).view.focalLengthMm, 68);
 const patch = { paused: true, view: { focalLengthMm: 150, zoom: 1.2 } };
 store.patch(characterId, descriptor, { ...scope, patch });
 const saved = new LivlivControlStore(file).get(characterId, descriptor.id);
 assert.equal(saved.view.focalLengthMm, 150);
 assert.equal(saved.view.zoom, 1.2);
 assert.equal(store.get('other', descriptor.id).view.focalLengthMm, 68);
 const { api, players } = fakeVrm();
 await api.sync(descriptor, characterId);
 const player = players[0];
 assert.equal(player.body.focalLengthMm, 68);
 const frames = player.frameCount;
 await api.sync({ ...descriptor, controls: saved }, characterId);
 assert.equal(player.body.focalLengthMm, 150);
 assert.equal(player.view.zoom, 1.2);
 assert.equal(players.length, 1);
 assert.equal(player.frameCount, frames + 1);
 assert.equal(player.lastDt, 0);
 api.draw();
 assert.equal(player.frameCount, frames + 1);
 const bounded = store.patch(characterId, descriptor, { ...scope, patch: { view: { focalLengthMm: 500 } } });
 assert.equal(bounded.view.focalLengthMm, 250);
 assert.equal(bounded.view.zoom, 1.2);
 const reset = store.patch(characterId, descriptor, { ...scope, patch: { reset: true } });
 assert.equal(reset.view.focalLengthMm, 68);
});
test('switching away while the lazy VRM renderer loads cannot create an orphan player',async()=>{let finish;const {api,players}=fakeVrm(()=>new Promise(resolve=>finish=resolve));const pending=api.sync(descriptor,'amber-avatar');await api.sync(null,'amber-avatar');finish({});await pending;assert.equal(players.length,0);assert.equal(api.status().ready,false);assert.equal(api.status().loading,false);});
test('VRM resources require selected-model scope and Link pairing',async t=>{
 const {RemoteCompanionServer}=require('../lib/remote-server.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'vrm-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new LivlivAvatarStore(dir),saved=await store.import(fixture(),'amber-avatar');let selected=true;const server=new RemoteCompanionServer({rootDir:path.join(root,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getLivlivAsset:(id,file)=>selected?store.read('amber-avatar',id,file):null}});await server.start();t.after(()=>server.stop());const origin=server.origin(),url=store.descriptor('amber-avatar',saved.id).modelUrl;assert.equal((await fetch(origin+url)).status,401);
 const paired=await fetch(origin+'/api/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(server.pairingUrl()).hash.slice(7)})});const headers={Cookie:paired.headers.get('set-cookie').split(';')[0]};const loaded=await fetch(origin+url,{headers});assert.equal(loaded.status,200);assert.equal(loaded.headers.get('content-type'),'model/gltf-binary');selected=false;assert.equal((await fetch(origin+url,{headers})).status,404);assert.equal((await fetch(origin+'/vrm.js')).status,200);
});
