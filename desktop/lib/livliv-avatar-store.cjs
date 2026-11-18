// SPDX-License-Identifier: Apache-2.0
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readModel,LIMITS}=require('../../vendor/livliv-player/validator.cjs');
const {unzip}=require('../../vendor/livliv-player/package-reader.cjs');
const {parseVrm,readVrm}=require('./vrm-avatar.cjs');
const ID=/^[a-f0-9-]{36}$/,FILE=/^(?:model\.(?:json|vrm)|[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*\.(?:png|webp|json))$/;
const MAX=256*1024*1024;function check(ok,message){if(!ok)throw Error(message);}
function json(body,limit=LIMITS.modelJson){check(body.length<=limit,'モデル設定が大きすぎます。');const value=JSON.parse(body);let count=0;function walk(v,depth){check(depth<48&&++count<2000000,'モデル設定が複雑すぎます。');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){check(!['__proto__','prototype','constructor'].includes(k),'不正な設定項目です。');walk(x,depth+1);}}walk(value,0);return value;}
function imageSize(b){
 if(b.length>=33&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return [b.readUInt32BE(16),b.readUInt32BE(20)];
 check(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP','PNGまたはWebP画像を使用してください。');
 const kind=b.toString('ascii',12,16);if(kind==='VP8X')return [b.readUIntLE(24,3)+1,b.readUIntLE(27,3)+1];
 if(kind==='VP8L'&&b[20]===47)return [(b.readUInt32LE(21)&0x3fff)+1,((b.readUInt32LE(21)>>>14)&0x3fff)+1];
 if(kind==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42)return [b.readUInt16LE(26)&0x3fff,b.readUInt16LE(28)&0x3fff];
 throw Error('WebP画像を読み込めません。');
}
async function readPackage(input){
 if(Buffer.isBuffer(input)&&input.subarray(0,4).toString()==='glTF'||typeof input==='string'&&/\.vrm$/i.test(input))return readVrm(input);
 const buffer=Buffer.isBuffer(input),stat=buffer?{isFile:()=>true,size:input.length}:fs.statSync(input),archive=stat.isFile()&&(buffer||!input.endsWith('.json'));let zipped=null,root;
 if(archive){check(stat.size<=80*1024*1024,'パッケージは80MB以下にしてください。');zipped=await unzip(new Blob([buffer?input:fs.readFileSync(input)]));const models=[...zipped.keys()].filter(x=>/(^|\/)model\.json$/.test(x)).sort((a,b)=>a.split('/').length-b.split('/').length);check(models.length,'model.jsonがありません。');root=models[0].slice(0,-10);}
 else root=fs.realpathSync(stat.isDirectory()?input:path.dirname(input));
 const files=new Map();let total=0,pixels=0;
 const read=async(file,limit=MAX)=>{check(FILE.test(file)&&!file.split('/').some(x=>x==='.'||x==='..'),'不正なモデルのパスです。');if(files.has(file))return files.get(file);let body;
  if(zipped){const blob=zipped.get(root+file);check(blob&&blob.size<=limit,'モデルのファイルがないか、大きすぎます: '+file);body=Buffer.from(await blob.arrayBuffer());}
  else{const target=fs.realpathSync(path.join(root,file));check(target.startsWith(root+path.sep),'モデルの外のファイルは読めません。');const info=fs.statSync(target);check(info.isFile()&&info.size<=limit,'モデルのファイルが大きすぎます。');body=fs.readFileSync(target);}
  check((total+=body.length)<=MAX,'展開後のモデルは256MB以下にしてください。');files.set(file,body);return body;};
 const raw=json(await read('model.json',LIMITS.modelJson)),model=readModel(raw,'ja');
 const images=new Set(model.layers.flatMap(l=>[l.texture,...(l.frames||[]),l.mask,l.talk,l.brow_tex].filter(Boolean).map(f=>l.webp?f.replace(/\.png$/,'.webp'):f)));
 for(const file of images){const [w,h]=imageSize(await read(file));check(w>0&&h>0&&w<=LIMITS.texture&&h<=LIMITS.texture&&(pixels+=w*h)<=LIMITS.texels,'モデルの画像が大きすぎます。');}
 if(model.keyforms)json(await read(model.keyforms,LIMITS.keyforms),LIMITS.keyforms);
 const hash=crypto.createHash('sha256');for(const [name,body] of [...files].sort(([a],[b])=>a.localeCompare(b)))hash.update(name).update(body);
 return {files,version:hash.digest('hex').slice(0,16),model};
}
function info(model){return {name:String(model.name||'LivLiv').slice(0,80),expressions:(model.expressions||[]).map(e=>({id:e.id,label:e.label||e.labels?.ja||e.id})),meta:model.meta||null,watermark:model.watermark||null};}
class LivlivAvatarStore{
 constructor(directory){this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true});this.records=new Map();for(const id of fs.readdirSync(this.directory)){if(!ID.test(id))continue;try{const record=json(fs.readFileSync(path.join(this.directory,id,'import.json')));check(record.id===id&&/^[a-zA-Z0-9_-]{1,100}$/.test(record.characterId)&&/^[a-f0-9]{16}$/.test(record.version)&&Array.isArray(record.files)&&record.files.length<=2050&&record.files.includes(record.kind==='vrm'?'model.vrm':'model.json')&&record.files.every(f=>FILE.test(f)&&!f.split('/').includes('..')),'Invalid import');const model=record.kind==='vrm'?parseVrm(fs.readFileSync(path.join(this.directory,id,'model.vrm'))).model:readModel(json(fs.readFileSync(path.join(this.directory,id,'model.json'))),'ja');this.records.set(id,{...record,...info(model)});}catch{}}}
 list(character){return [...this.records.values()].filter(r=>r.characterId===character).map(r=>({id:r.id,label:(r.kind==='vrm'?'VRM':'LivLiv')+' · '+r.name}));}
 async import(input,character){check(/^[a-zA-Z0-9_-]{1,100}$/.test(character),'Invalid character');const pack=await readPackage(input),existing=[...this.records.values()].find(r=>r.characterId===character&&r.version===pack.version);if(existing)return {id:existing.id};check(this.list(character).length<20,'このキャラクターに読み込めるVRM・LivLivモデルは合計20個までです。');const id=crypto.randomUUID(),target=path.join(this.directory,id),record={id,characterId:character,version:pack.version,kind:pack.kind||'livliv',capabilities:pack.capabilities,files:[...pack.files.keys()],...info(pack.model)};fs.mkdirSync(target);try{for(const [name,body] of pack.files){const output=path.join(target,name);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,body);}fs.writeFileSync(path.join(target,'import.json'),JSON.stringify(record));this.records.set(id,record);return {id};}catch(error){fs.rmSync(target,{recursive:true,force:true});throw error;}}
 removeVrm(character, id) {
  const record = this.records.get(id);
  check(ID.test(id) && record?.characterId === character && record?.kind === 'vrm', '読み込んだVRMを選んでください。');
  const root = fs.realpathSync(this.directory);
  const target = path.join(root, id);
  check(fs.lstatSync(target).isDirectory(), 'VRMの保存先が不正です。');
  fs.rmSync(path.join(target, 'model.vrm'), { force: true });
  this.records.delete(id);
  // The avatar bytes are gone. Stale metadata cannot restore a missing model.
  try {
   fs.rmSync(path.join(target, 'import.json'), { force: true });
   fs.rmdirSync(target);
  } catch (error) {
   console.warn('Could not clean up VRM metadata:', error.code);
  }
 }
 descriptor(character,id){const r=this.records.get(id);return r?.characterId===character?{id,version:r.version,kind:r.kind||'livliv',capabilities:r.capabilities,modelUrl:'/api/livliv/'+id+(r.kind==='vrm'?'/model.vrm':'/model.json'),width:768,height:768,...info(r)}:null;}
 read(character,id,file){const r=this.records.get(id);if(r?.characterId!==character||!r.files.includes(file)||!FILE.test(file))return null;const root=fs.realpathSync(path.join(this.directory,id)),target=fs.realpathSync(path.join(root,file));check(target.startsWith(root+path.sep),'Invalid asset');return {body:fs.readFileSync(target),contentType:file.endsWith('.vrm')?'model/gltf-binary':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'application/json; charset=utf-8'};}
}
module.exports={LivlivAvatarStore,readPackage,imageSize};
