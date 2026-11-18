// SPDX-License-Identifier: Apache-2.0
// Rebuilds the registered original artwork without drawing, scaling or generating new facial features.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{PNG}=require('pngjs');
const {readModel}=require('../vendor/livliv-player/validator.cjs');
const source=path.resolve(__dirname,'../assets/kohaku-livliv-sources/original'),out=path.resolve(__dirname,'../assets/amber-avatar/livliv');
const size=1254;
const buildFiles=new Set(),layers=[];fs.mkdirSync(path.join(out,'textures'),{recursive:true});
function crop(p,box){const [x,y,w,h]=box,result=new PNG({width:w,height:h});PNG.bitblt(p,result,x,y,w,h,0,0);return result;}
function bounds(p,roi=[0,0,p.width,p.height]){let x0=p.width,y0=p.height,x1=-1,y1=-1;for(let y=roi[1];y<roi[1]+roi[3];y++)for(let x=roi[0];x<roi[0]+roi[2];x++)if(p.data[(y*p.width+x)*4+3]>20){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
 if(x1<0)throw Error('Empty rig layer');x0=Math.max(roi[0],x0-3);y0=Math.max(roi[1],y0-3);x1=Math.min(roi[0]+roi[2]-1,x1+3);y1=Math.min(roi[1]+roi[3]-1,y1+3);return [x0,y0,x1-x0+1,y1-y0+1];}
function save(id,p){const file='textures/'+id+'.png';fs.writeFileSync(path.join(out,file),PNG.sync.write(p));buildFiles.add(file);return file;}
function add(id,plate,extra={},roi){const box=bounds(plate,roi),texture=save(id,crop(plate,box)),[x,y,w,h]=box;const layer={id,texture,x,y,w,h,group:'head',depth:0,...extra};layers.push(layer);return layer;}
function fromBox(id,plate,box,extra={}){const [x,y,w,h]=box;const layer={id,texture:save(id,crop(plate,box)),x,y,w,h,group:'head',depth:0,...extra};layers.push(layer);return layer;}
// Original artwork is authoritative for every visible facial feature. Never
// scale or redraw the original eyes; no generated plate is displayed.
const originalDir=source;
const originalRead=name=>PNG.sync.read(fs.readFileSync(path.join(originalDir,name+'.png')));
const original=originalRead('source'),erased=originalRead('base'),base=crop(original,[0,0,size,size]);
for(const [x,y,w,h] of [[446,556,160,141],[683,490,182,159]])PNG.bitblt(erased,base,x,y,w,h,x,y);
// Keep the original continuous silhouette. The experimental generated face and
// segmented hair introduced identity drift and edge gaps; neither is displayed.
// One continuous surface: full head follow above the collar, smoothly blending
// to the lagging torso below it. No cut seam and no independently moving eyes.
add('face',base,{group:'hair_back'});
const eyeBoxes=[[446,556,160,141],[683,490,182,159]];
for(const [i,side] of ['L','R'].entries()){
 const box=eyeBoxes[i],[x,y,w,h]=box;
 const lid=originalRead('eyes_closed_'+i),smile=originalRead('eyes_smile_'+i);
 layers.push({id:'lid_'+side,texture:save('lid_'+side,lid),x,y,w,h,group:'head',depth:0,role:'lid_'+side});
 fromBox('eye_'+side,original,box,{role:'eye_'+side,pivot:i===0?[536,637]:[756,585]});
 layers.push({id:'smile_'+side,texture:save('smile_'+side,smile),x,y,w,h,group:'head',depth:0,role:'expr',expression:'smile'});
}
const mouthBox=[601,687,131,89],mouthFrames=[];
for(const [id,file] of [['closed',null],['half','mouth_a_half'],['open','mouth_a'],['round','mouth_o'],['wide','mouth_i']])mouthFrames.push(save('mouth_'+id,file?originalRead(file):crop(original,mouthBox)));
layers.push({id:'mouth',texture:mouthFrames[0],frames:mouthFrames,visemes:['closed','half','open','round','wide'],x:601,y:687,w:131,h:89,group:'head',depth:0,role:'mouth',pivot:[665.5,720.5]});

const expressionDir=path.resolve(source,'../expressions-v5');
const {composeExpression}=require('./kohaku-expression-patches.cjs');
const hairMask=originalRead('hairmask'),expressionCorrections={};
for(const id of ['thinking','worried','angry','surprised']){
 const master=PNG.sync.read(fs.readFileSync(path.join(expressionDir,id+'.png')));
 const {art,talk,corrections}=composeExpression(original,master,hairMask),box=bounds(art),[x,y,w,h]=box;
 expressionCorrections[id]=corrections;
 layers.push({id:'expression_'+id,texture:save('expression_'+id,crop(art,box)),talk:save('expression_talk_'+id,crop(talk,box)),x,y,w,h,group:'head',depth:0,role:'expr',expression:id});
}
// LivLiv's lattice may sample just outside a crop. A transparent border is
// required: clamping an opaque skin edge otherwise paints blocky extensions.
for(const layer of layers){if(layer.id==='face')continue;const names=new Set([layer.texture,...(layer.frames||[]),layer.talk].filter(Boolean));for(const file of names){const image=PNG.sync.read(fs.readFileSync(path.join(out,file))),padded=new PNG({width:image.width+16,height:image.height+16});PNG.bitblt(image,padded,0,0,image.width,image.height,8,8);fs.writeFileSync(path.join(out,file),PNG.sync.write(padded));}layer.x-=8;layer.y-=8;layer.w+=16;layer.h+=16;}
const model={format:'livliv-model',version:4,name:'コハク · LivLiv',requires:[],
 meta:{generator:{name:'CharaDock original-pixel Kohaku rig; localized expression edits',build:'5'},author:{name:'CharaDock'},license:{id:'LicenseRef-CharaDock-Character',url:'https://github.com/ochisamu/CharaDock/blob/main/DISTRIBUTION_ASSET_LICENSE.md',text:'Original CharaDock Kohaku artwork and registered eye/mouth variants. See DISTRIBUTION_ASSET_LICENSE.md.'},watermark:{kind:'none'}},
 canvas:[size,size],profile:{id:'anime_half',facing:'three_quarter',glasses:false},
 anchors:{head:{cx:650,cy:470,rx:580,ry:440},face:[435,440,900,816],neck_y:835,top_y:30,bottom_y:size,hair_root_y:180,collar_y:845,eyes:[[446,556,606,697],[683,490,865,649]],brows:[[410,505,530,550],[610,440,795,494]],jaw:{top:750,chin:806,half:0,open:0,round:0,wide:0},chest:{cx:665,cy:1130,rx:265,ry:210}},
 rig:{yaw:.34,pitch:.28,roll:.72,bulge:.20,bulge_extent:[1.2,1.1,1],drift:[.09,.06],wind:0,hair_limit:0,hair_drive:[.65,.55,.40],breath:.9,sway:1,brow:0,jaw:0,neck:{twist:.18,reach:.3},body:{yaw:.32,roll:.38,breath:.9,bust:0},chains:[]},
 tuning:{turn:1,nod:.95,hair:0,hair_front:0,hair_back:0,blink:1,expr:1,mouth:1,breath:1},expressions:[{id:'smile',label:{ja:'笑顔',en:'Smile'}},{id:'thinking',label:{ja:'考える',en:'Thinking'}},{id:'worried',label:{ja:'困る',en:'Worried'}},{id:'angry',label:{ja:'怒る',en:'Angry'}},{id:'surprised',label:{ja:'驚く',en:'Surprised'}}],layers};
readModel(model);fs.writeFileSync(path.join(out,'model.json'),JSON.stringify(model,null,2)+'\n');buildFiles.add('model.json');
for(const name of ['base','body','bow','brows','collar_front','earring','hair_back','hair_front','head_underpaint','iris_L','iris_R','side_lock','white_mask_L','white_mask_R']){const file=path.join(out,'textures',name+'.png');if(fs.existsSync(file))fs.unlinkSync(file);}
const hashes={};for(const file of [...buildFiles].sort())hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex');
fs.writeFileSync(path.join(out,'BUILD.json'),JSON.stringify({converter:5,expressionCorrections,identitySource:crypto.createHash('sha256').update(fs.readFileSync(path.join(originalDir,'source.png'))).digest('hex'),files:hashes},null,2)+'\n');
// Flat assembly is QA only: the shipped model is drawn by the real WebGL player.
const { assembleNeutralKohaku } = require('./kohaku-flat-assembly.cjs');
const flat = assembleNeutralKohaku(model, file => fs.readFileSync(path.join(out, file)));
const evidence=path.resolve(__dirname,'../work/evidence/kohaku-livliv-v2');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'flat-assembly.png'),PNG.sync.write(flat));
console.log('Kohaku original-face rig:',layers.length,'layers,',model.rig.chains.length,'hair chains;',buildFiles.size,'files');
