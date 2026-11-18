// SPDX-License-Identifier: Apache-2.0
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {normalize,merge,actions}=require('../livliv-controls.js');
class LivlivControlStore{
 constructor(file,{now=Date.now}={}){this.file=file;this.now=now;this.data={};try{const value=JSON.parse(fs.readFileSync(file));for(const [key,state] of Object.entries(value))if(/^[a-zA-Z0-9_-]{1,100}:[a-zA-Z0-9_-]{1,100}$/.test(key))this.data[key]=normalize(state);}catch{}}
 key(character,id){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(character)||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Invalid avatar identity');return character+':'+id;}
 get(character,id){return normalize(this.data[this.key(character,id)]);}
 patch(character,descriptor,input){
  this.assertScope(character,descriptor,input);const next=merge(this.get(character,descriptor.id),input.patch);
  if(next.expression&&!descriptor.expressions?.some(e=>e.id===next.expression))throw Error('このモデルにない表情です。');
  this.data[this.key(character,descriptor.id)]=next;fs.mkdirSync(path.dirname(this.file),{recursive:true});const temporary=this.file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(this.data));fs.renameSync(temporary,this.file);return next;
 }
 assertScope(character,descriptor,input){if(!descriptor||input?.characterId!==character||input?.modelId!==descriptor.id||input?.version!==descriptor.version)throw Error('見た目が変わりました。選び直してください。');}
 command(character,descriptor,input){this.assertScope(character,descriptor,input);if(![...actions,'blink'].includes(input.action))throw Error('Invalid avatar action');return {id:randomUUID(),characterId:character,modelId:descriptor.id,version:descriptor.version,action:input.action,expiresAt:this.now()+3000};}
}
module.exports={LivlivControlStore};
