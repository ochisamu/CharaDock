// SPDX-License-Identifier: Apache-2.0
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CharaDockLivlivControls=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const ranges={angleX:[-30,30],angleY:[-30,30],angleZ:[-30,30],eyeLOpen:[0,1],eyeROpen:[0,1],eyeBallX:[-1,1],eyeBallY:[-1,1],browLY:[-1,1],browRY:[-1,1],mouthOpen:[0,1],vowel:[-1,1],smile:[0,1],bodyX:[-10,10],bodyZ:[-10,10],breath:[0,1]};
 const vrmFocalLength={min:35,max:250,default:68,portrait:150};
 const actions=['nod','shake','tilt','hop','shy'];
 const finite=(value,min,max,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
 function normalize(raw={}){
  if(!raw||typeof raw!=='object')raw={};const params={};
  for(const [key,[lo,hi]] of Object.entries(ranges))if(typeof raw.params?.[key]==='number'&&Number.isFinite(raw.params[key]))params[key]=finite(raw.params[key],lo,hi,lo);
  return {params,motionStrength:finite(raw.motionStrength,.5,1.5,1),expression:typeof raw.expression==='string'&&raw.expression.length>0&&raw.expression.length<=256&&!['__proto__','constructor','prototype'].includes(raw.expression)&&!raw.expression.includes('\0')?raw.expression:null,weight:finite(raw.weight,0,1,1),
   gaze:raw.gaze&&typeof raw.gaze.x==='number'&&typeof raw.gaze.y==='number'?{x:finite(raw.gaze.x,-1,1,0),y:finite(raw.gaze.y,-1,1,0)}:null,
   view:{x:finite(raw.view?.x,-1,1,0),y:finite(raw.view?.y,-1,1,0),zoom:finite(raw.view?.zoom,.25,4,1),head:raw.view?.head===true,focalLengthMm:finite(raw.view?.focalLengthMm,vrmFocalLength.min,vrmFocalLength.max,vrmFocalLength.default)},idle:raw.idle!==false,paused:raw.paused===true,away:raw.away===true};
 }
 function merge(current,patch){
  if(!patch||typeof patch!=='object')throw Error('Invalid avatar settings');
  if(patch.reset===true)return normalize();
  const next={...current,...patch,view:{...current.view,...patch.view},params:{...current.params}};
  if(patch.params&&typeof patch.params==='object')for(const key of Object.keys(ranges)){if(patch.params[key]===null)delete next.params[key];else if(Object.hasOwn(patch.params,key))next.params[key]=patch.params[key];}
  return normalize(next);
 }
 return {ranges,actions,vrmFocalLength,normalize,merge};
});
