// SPDX-License-Identifier: Apache-2.0
// Deterministic registration/compositing of imagegen-authored brow and mouth
// edits. Original eyes, hair, nose, skin contour and body remain authoritative.
const {PNG}=require('pngjs');
const ZONES=[{id:'brow_L',box:[442,480,169,100],feather:10},{id:'brow_R',box:[632,413,220,151],feather:10},{id:'mouth',box:[601,687,131,89],feather:12}];
const PROTECTED_EYES=[[[443,577],[471,555],[518,557],[559,585],[589,619],[607,656],[588,694],[510,701],[452,670]],[[681,562],[701,522],[736,495],[775,491],[815,500],[866,524],[868,575],[842,632],[786,650],[718,649],[685,614]]];
function inside(poly,x,y){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)hit=!hit;}return hit;}
function median(values){values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length/2)]:0;}
function composeExpression(original,edit,hair){
 if([edit,hair].some(p=>p.width!==original.width||p.height!==original.height))throw Error('Expression master must preserve the original canvas; do not rescale the eyes');
 const art=new PNG({width:original.width,height:original.height}),talk=new PNG({width:original.width,height:original.height}),corrections={};
 for(const {id,box:[x0,y0,w,h],feather} of ZONES){
  const samples=[[],[],[]];
  // Estimate only the skin offset at the outer seam; never fit geometry or
  // change the generated ink. Hair and dark original/generated ink are excluded.
  for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){
   const edge=Math.min(x-x0,y-y0,x0+w-1-x,y0+h-1-y),k=(y*original.width+x)*4;
   if(edge>feather+3||edge<2||hair.data[k]>30||original.data[k+3]<250||edit.data[k+3]<250)continue;
   if(original.data[k]<195||original.data[k+1]<110||edit.data[k]<195||edit.data[k+1]<110)continue;
   for(let c=0;c<3;c++)samples[c].push(original.data[k+c]-edit.data[k+c]);
  }
  const offset=samples.map(values=>Math.max(-24,Math.min(24,median(values))));corrections[id]=offset;
  for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){
   const k=(y*original.width+x)*4,edge=Math.min(x-x0,y-y0,x0+w-1-x,y0+h-1-y),t=Math.max(0,Math.min(1,edge/feather)),smooth=t*t*(3-2*t);
   // Eyelashes/pupils are strictly outside all three zones. Hair is preserved
   // even where bangs cross a brow; alpha is inherited from the original art.
   const protectedEye=PROTECTED_EYES.some(poly=>inside(poly,x,y));
   const a=protectedEye?0:Math.round(original.data[k+3]*(1-hair.data[k]/255)*smooth*(edit.data[k+3]/255));
   for(let c=0;c<3;c++)art.data[k+c]=Math.max(0,Math.min(255,edit.data[k+c]+offset[c]));art.data[k+3]=a;
   if(id!=='mouth')art.data.copy(talk.data,k,k,k+4);
  }
 }
 return {art,talk,corrections};
}
module.exports={ZONES,PROTECTED_EYES,inside,composeExpression};
