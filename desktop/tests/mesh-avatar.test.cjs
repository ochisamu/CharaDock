// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PNG}=require('pngjs');
const {MeshAvatarStore,readProject}=require('../lib/mesh-avatar-store.cjs');
const {create}=require('../mesh-avatar-runtime.js');
const {MascotStaticServer}=require('../lib/static-server.cjs');
const {RemoteCompanionServer}=require('../lib/remote-server.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mesh-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project=path.join(root,'avatar');fs.mkdirSync(path.join(project,'built'),{recursive:true});
 const e={cx:16,cy:16,rx:3,ry:3},band=[0,32],poly=[[0,0],[3,0],[3,3],[0,3]];
 const rig={version:1,image:{width:32,height:32},head:{...e,shiftX:0,shiftY:0,pivotX:16,pivotY:16,maxRoll:2,weightBand:band,turnBand:band},
 body:{pivotX:16,pivotY:24,maxRoll:2,breathBand:band,rollBand:band,chest:e,shoulders:[]},
 face:{nose:e,mouth:e,eyeA:e,eyeB:e,earL:e,earR:e,brow:{...e,band},jaw:{...e,band}},
 eyes:[0,1].map(()=>({opening:poly,roi:poly,x0:0,x1:3,top:Array(24).fill(0),bot:Array(24).fill(3)})),
 mouth:{cx:16,cy:16,angle:0,halfLen:2,bow:0,area:{...e,angle:0}},cheeks:[[10,16],[22,16]],strands:[],accessories:[],
 mesh:{baseCell:8,fine:{x0:0,x1:32,y0:0,y1:32,cell:4},handCell:8,tasselCell:8,eyeBallCell:8,eyeCell:8,spriteCell:8},view:{padTop:0,padSide:0}};
 fs.writeFileSync(path.join(project,'rig.json'),JSON.stringify(rig));const meta={size:[32,32],layers:{}};
 for(const name of ['base','hairmask',...[0,1].flatMap(i=>['ball','low','crease','lash'].map(p=>`eye${i}_${p}`))]){
 const large=['base','hairmask'].includes(name);const png=new PNG({width:large?32:4,height:large?32:4});png.data.fill(255);
 fs.writeFileSync(path.join(project,'built',name+'.png'),PNG.sync.write(png));meta.layers[name]=large?[0,0,32,32]:[0,0,4,4];
 }
 fs.writeFileSync(path.join(project,'built/layers.json'),JSON.stringify(meta));fs.writeFileSync(path.join(project,'source.png'),'private original');
 return {root,project,rig,store:new MeshAvatarStore(path.join(root,'imports'))};
}
test('import saves only validated runtime assets and survives restart without the source project',t=>{
 const {root,project,store}=fixture(t),source=fs.readFileSync(path.join(project,'rig.json'));const imported=store.import(project,'kohaku');
 assert.deepEqual(fs.readFileSync(path.join(project,'rig.json')),source);
 assert.deepEqual(store.import(project,'kohaku'),imported);assert.equal(store.list('kohaku').length,1);
 assert.equal(fs.existsSync(path.join(root,'imports',imported.id,'source.png')),false);
 assert.equal(JSON.stringify(store.descriptor('kohaku',imported.id)).includes(root),false);
 fs.rmSync(project,{recursive:true});const restored=new MeshAvatarStore(path.join(root,'imports'));
 assert.deepEqual(restored.list('kohaku'),[imported]);assert.ok(restored.read('kohaku',imported.id,'built/base.png').body.length);
 assert.equal(restored.descriptor('other',imported.id),null);assert.equal(restored.read('other',imported.id,'rig.json'),null);
 assert.equal(restored.read('kohaku',imported.id,'../import.json'),null);
});
test('bad or excessive rig, mismatched PNG and external symlinks leave no partial imports',t=>{
 const {root,project,rig,store}=fixture(t);rig.mesh.fine.x1=99999;fs.writeFileSync(path.join(project,'rig.json'),JSON.stringify(rig));
 assert.throws(()=>store.import(project,'kohaku'),/画像内/);assert.deepEqual(store.list('kohaku'),[]);
 rig.mesh.fine.x1=32;fs.writeFileSync(path.join(project,'rig.json'),JSON.stringify(rig));
 const base=path.join(project,'built/base.png'),saved=fs.readFileSync(base);fs.writeFileSync(base,PNG.sync.write(new PNG({width:33,height:32})));
 assert.throws(()=>readProject(project),/サイズ/);fs.writeFileSync(path.join(root,'outside.png'),saved);fs.unlinkSync(base);fs.symlinkSync(path.join(root,'outside.png'),base);
 assert.throws(()=>store.import(project,'kohaku'),/外に/);assert.deepEqual(fs.readdirSync(store.directory),[]);
});
test('local and paired Link serve mesh assets only through the current character selection',async t=>{
 const {project,store}=fixture(t),a=store.import(project,'kohaku'),b=store.import(project,'other');let selected=a.id;
 const get=(id,file)=>id===selected?store.read('kohaku',id,file):null;
 const local=new MascotStaticServer(path.resolve(__dirname,'../..'),{getMeshAsset:get});await local.start();t.after(()=>local.stop());
 assert.equal((await fetch(local.origin()+store.descriptor('kohaku',a.id).rigUrl)).status,200);
 assert.equal((await fetch(local.origin()+`/api/mesh/${b.id}/rig.json`)).status,404);selected='standard';
 assert.equal((await fetch(local.origin()+`/api/mesh/${a.id}/rig.json`)).status,404);
 const remote=new RemoteCompanionServer({rootDir:path.resolve(__dirname,'../remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getMeshAsset:get}});
 await remote.start();t.after(()=>remote.stop());
 assert.equal((await fetch(remote.origin()+`/api/mesh/${a.id}/rig.json`)).status,401);
 for(const file of ['mesh-avatar.js','mesh-avatar-runtime.js','remote-mesh-avatar.js']) assert.equal((await fetch(remote.origin()+'/'+file)).status,200,file);
});
const descriptor={id:'12345678-1234-1234-1234-123456789abc',version:'v1',width:32,height:32,
 rigUrl:'/api/mesh/12345678-1234-1234-1234-123456789abc/rig.json',assetsBase:'/api/mesh/12345678-1234-1234-1234-123456789abc/built/'};
function runtime(options={}){let clock=1000;const players=[];const engine={create:async()=>{
 const p={parameters:{},emotions:[],motions:[],destroyed:false,setParameters(v){this.parameters={...v};},getParameters(){return this.parameters;},
 setEmotion(e){this.emotions.push(e);},play(){},advance(){},destroy(){this.destroyed=true;},setAutoIdle(){},setAutoMotion(){},setSwayGain(){},setTalkGain(){},setVoiceLevel(){},setSpeaking(){}};
 players.push(p);return p;}};
 const api=create({engine,makeCanvas:()=>({}),fetchImpl:async()=>({ok:true,json:async()=>({})}),now:()=>clock,...options});
 return {api,players,advance(ms){clock+=ms;}};
}
test('shared renderer queues expressions, clears closed eyes and mouth, expires expressions, and keeps character scope',async()=>{
 const {api,players,advance}=runtime();const loading=api.sync(descriptor,'kohaku');api.expression({emotion:'happy',forceEyesClosed:true,durationMs:200});await loading;
 api.draw({mouth:1,level:.2});assert.equal(players[0].parameters.mouthOpen,1);assert.equal(players[0].parameters.eyeLOpen,0);
 api.expression({characterId:'other',emotion:'angry'});assert.deepEqual(players[0].emotions,['happy']);advance(201);
 api.draw({mouth:0,reduced:true});assert.equal(players[0].parameters.mouthOpen,0);assert.equal(players[0].parameters.eyeLOpen,undefined);
 assert.equal(players[0].parameters.angleZ,0);assert.equal(players[0].emotions.at(-1),'neutral');
 await api.sync(null,'kohaku');assert.equal(api.status().ready,false);assert.equal(players[0].destroyed,true);
});
test('late engine completion after switching appearance is disposed and never drawn',async()=>{
 let resolve;const {api}=runtime({engine:{create:()=>new Promise(r=>resolve=r)}});const first=api.sync(descriptor,'kohaku');
 await new Promise(r=>setImmediate(r));await api.sync(null,'kohaku');let destroyed=false;resolve({destroy(){destroyed=true;}});await first;
 assert.equal(destroyed,true);assert.equal(api.draw(),null);assert.equal(api.status().identity,'');
});
test('initial draw failure settles loading and permits reverting to the original appearance',async()=>{
 const errors=[];const {api,players}=runtime({onError:e=>errors.push(e.message)});await api.sync(descriptor,'kohaku');api.dispose();
 const bad=runtime({engine:{create:async()=>({destroy(){},advance(){throw Error('GL failed');},getParameters(){}})},onError:e=>errors.push(e.message)});
 await bad.api.sync(descriptor,'kohaku');assert.equal(bad.api.status().ready,false);assert.equal(bad.api.status().loading,false);assert.equal(bad.api.status().error,'GL failed');
 await bad.api.sync(null,'kohaku');assert.equal(bad.api.status().error,'');assert.deepEqual(errors,['GL failed']);assert.equal(players[0].destroyed,true);
});
