// SPDX-License-Identifier: Apache-2.0
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const APPEARANCE='livliv-kohaku';
function kohakuLivliv(root){
 const directory=path.join(root,'assets/amber-avatar/livliv');
 const buildBody=fs.readFileSync(path.join(directory,'BUILD.json'));
 const build=JSON.parse(buildBody),files=new Set(Object.keys(build.files));
 const model=JSON.parse(fs.readFileSync(path.join(directory,'model.json')));
 return {descriptor:{id:'kohaku',version:crypto.createHash('sha256').update(buildBody).digest('hex').slice(0,16),modelUrl:'/api/livliv/kohaku/model.json',width:768,height:768,name:model.name,expressions:(model.expressions||[]).map(e=>({id:e.id,label:typeof e.label==='string'?e.label:e.label?.ja||e.label?.en||e.id})),meta:model.meta||null,watermark:model.meta?.watermark||null},
 read(file){if(!files.has(file)||!/^model\.json$|^textures\/[a-zA-Z0-9_-]+\.png$/.test(file))return null;
 const target=path.resolve(directory,file);if(!target.startsWith(path.resolve(directory)+path.sep))return null;
 return {body:fs.readFileSync(target),contentType:file.endsWith('.png')?'image/png':'application/json; charset=utf-8'};}};
}
module.exports={APPEARANCE,kohakuLivliv};
