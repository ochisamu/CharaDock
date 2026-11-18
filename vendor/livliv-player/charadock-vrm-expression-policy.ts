// SPDX-License-Identifier: Apache-2.0
// Keep authored expression components while the host owns speech and blinking.
const FEELINGS=['happy','angry','sad','relaxed','surprised'];
const RESERVED=new Set(['neutral','aa','ih','ou','ee','oh','blink','blinkLeft','blinkRight','lookUp','lookDown','lookLeft','lookRight']);
export class VrmExpressionPolicy {
 private records: Map<string,{object:any,mouth:string,blink:string}>;
 private hold=0;
 constructor(private manager:any){
  this.records=new Map((manager?.expressions||[]).map((object:any)=>[object.expressionName,{object,mouth:object.overrideMouth||'none',blink:object.overrideBlink||'none'}]));
  // Overrides are resolved here, in memory. Never change or re-export the file.
  for(const [name,r] of this.records)if(!RESERVED.has(name)){r.object.overrideMouth='none';r.object.overrideBlink='none';}
 }
 apply(params:any,expression:Record<string,number>,dt:number){
  this.hold=params.mouthOpen>.015?.18:Math.max(0,this.hold-dt);
  const speaking=this.hold>0,open=Math.min(params.eyeLOpen,params.eyeROpen),weights=new Map<string,number>();
  const put=(name:string,value:number)=>{if(this.records.has(name))weights.set(name,Math.max(weights.get(name)||0,Math.max(0,Math.min(1,value))));};
  const safe=(name:string,value:number)=>{const r=this.records.get(name);if(!r)return;put(name,value*(speaking&&r.mouth!=='none'?0:1)*(r.blink!=='none'?open:1));};
  for(const feeling of FEELINGS){
   const value=Math.max(expression[feeling]||0,feeling==='happy'?(params.smile||0)*.6:0);
   if(this.records.has('brow_'+feeling)&&this.records.has(feeling+'_eye')){
    put('brow_'+feeling,value);put(feeling+'_eye',value*open);if(!speaking)put(feeling+'_mouth',value);
   }else safe(feeling,value);
  }
  for(const [name,value] of Object.entries(expression))if(!FEELINGS.includes(name)&&!RESERVED.has(name))safe(name,value);
  for(const name of this.records.keys())if(!RESERVED.has(name))this.manager.setValue(name,weights.get(name)||0);
  return {speaking,weights:Object.fromEntries(weights)};
 }
}
