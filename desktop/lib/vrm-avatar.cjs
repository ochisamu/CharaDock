// SPDX-License-Identifier: Apache-2.0
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkGlb,vrmTerms}=require('../../vendor/livliv-player/vrm-reader.cjs');
const MAX_VRM_BYTES=128*1024*1024;
const FEELINGS={happy:'喜び',angry:'怒り',sad:'悲しい',relaxed:'リラックス',surprised:'驚き'};
const TECHNICAL=/^(?:pre111_|brow_|blink|look)|_(?:eye|mouth)$/i;
const RESERVED=new Set(['aa','ih','ou','ee','oh','a','i','u','e','o','neutral']);
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function imageSize(b){
 if(b.length>=24&&b.readUInt32BE(0)===0x89504e47)return [b.readUInt32BE(16),b.readUInt32BE(20)];
 if(b.length>=30&&b.toString('ascii',8,12)==='WEBP'){
  const tag=b.toString('ascii',12,16);if(tag==='VP8X')return[b.readUIntLE(24,3)+1,b.readUIntLE(27,3)+1];
  if(tag==='VP8L')return[(b.readUInt32LE(21)&16383)+1,((b.readUInt32LE(21)>>>14)&16383)+1];
  if(tag==='VP8 ')return[b.readUInt16LE(26)&16383,b.readUInt16LE(28)&16383];
 }
 if(b.length>4&&b.readUInt16BE(0)===0xffd8)for(let i=2;i+9<b.length;){if(b[i]!==255){i++;continue;}const tag=b[i+1];if(tag>=192&&tag<=207&&![196,200,204].includes(tag))return[b.readUInt16BE(i+7),b.readUInt16BE(i+5)];if(i+4>b.length)break;const length=b.readUInt16BE(i+2);if(length<2)break;i+=length+2;}
 return null;
}
function parseVrm(body,fallback='VRM'){
 assert(Buffer.isBuffer(body)&&body.length>=28&&body.length<=MAX_VRM_BYTES,'VRMは128MB以下のファイルを選んでください。');
 assert(body.readUInt32LE(0)===0x46546c67&&body.readUInt32LE(4)===2&&body.readUInt32LE(8)===body.length,'VRMファイルの形式が正しくありません。');
 const length=body.readUInt32LE(12),end=20+length;assert(body.readUInt32LE(16)===0x4e4f534a&&length<=32*1024*1024&&end+8<=body.length,'VRMの設定が大きすぎるか、壊れています。');
 let raw;try{raw=JSON.parse(body.toString('utf8',20,end));}catch{throw Error('VRMの設定を読み込めません。');}
 let entries=0;function walk(o,depth=0){assert(depth<48&&++entries<1500000,'VRMの設定が複雑すぎます。');if(o&&typeof o==='object')for(const [k,v] of Object.entries(o)){assert(!['__proto__','prototype','constructor'].includes(k),'VRMの設定に不正な項目があります。');walk(v,depth+1);}}walk(raw);
 const vrm1=raw.extensions?.VRMC_vrm,vrm0=raw.extensions?.VRM;assert(vrm1||vrm0,'VRMの情報がない3Dファイルです。');
 assert(Array.isArray(raw.meshes)&&raw.meshes.length>0&&raw.meshes.length<=2048&&(raw.nodes||[]).length<=20000&&(raw.images||[]).length<=256&&(raw.materials||[]).length<=2048,'VRMのメッシュや画像が多すぎます。');
 assert(!raw.extensionsUsed?.some(x=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(x)),'圧縮されたVRMには未対応です。圧縮なしで書き出してください。');
 assert(body.readUInt32LE(end+4)===0x004e4942&&end+8+body.readUInt32LE(end)<=body.length,'VRMのバイナリデータが壊れています。');
 const bin=body.subarray(end+8,end+8+body.readUInt32LE(end));
 for(const buffer of raw.buffers||[])assert(!buffer.uri&&Number.isInteger(buffer.byteLength)&&buffer.byteLength>=0&&buffer.byteLength<=bin.length,'外部ファイルを参照するVRMは読み込めません。');
 for(const view of raw.bufferViews||[])assert((view.buffer??0)===0&&Number.isInteger(view.byteLength)&&view.byteLength>=0&&Number.isInteger(view.byteOffset??0)&&(view.byteOffset??0)>=0&&(view.byteOffset??0)+view.byteLength<=bin.length,'VRMのデータ範囲が不正です。');
 let pixels=0;for(const image of raw.images||[]){
  assert(!image.uri,'画像を内蔵したVRMを選んでください。');const v=raw.bufferViews?.[image.bufferView];assert(v,'VRMの画像データがありません。');const bytes=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),size=imageSize(bytes.subarray(0,65536));
  assert(size&&size.every(n=>Number.isInteger(n)&&n>0&&n<=8192)&&(pixels+=size[0]*size[1])<=128*1024*1024,'VRMの画像が大きすぎるか、対応形式ではありません。');
 }
 let components=0;const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
 for(const a of raw.accessors||[])assert(Number.isInteger(a.count)&&a.count>=0&&a.count<=4*1024*1024&&sizes[a.type]&&(components+=a.count*sizes[a.type])<=64*1024*1024,'VRMの頂点・モーフデータが大きすぎるか、不正です。');
 const positions=new Set((raw.meshes||[]).flatMap(m=>(m.primitives||[]).map(p=>p.attributes?.POSITION)).filter(x=>x!==undefined));let vertices=0;
 for(const index of positions){const count=raw.accessors?.[index]?.count;assert(Number.isInteger(count)&&count>0&&(vertices+=count)<=4*1024*1024,'VRMの頂点数が多すぎるか、不正です。');}
 const old=vrm0?.blendShapeMaster?.blendShapeGroups||[],preset=vrm1?.expressions?.preset||{},custom=vrm1?.expressions?.custom||{};
 const remap={joy:'happy',fun:'relaxed',sorrow:'sad'};
 const names=vrm1?[...Object.keys(preset),...Object.keys(custom)]:old.map(g=>remap[g.presetName]||(!['unknown','neutral'].includes(g.presetName)?g.presetName:g.name)).filter(Boolean);
 const expressions=[...new Set(names.map(n=>Object.keys(FEELINGS).includes(n.toLowerCase())?n.toLowerCase():n))].filter(n=>typeof n==='string'&&!RESERVED.has(n)&&!TECHNICAL.test(n)&&n.length<=256).map(id=>({id,label:FEELINGS[id]||id}));
 if(names.includes('happy')&&!expressions.some(e=>e.id==='smile'))expressions.push({id:'smile',label:'笑顔'});
 const meta=vrmTerms({...((vrm1||vrm0).meta||{}),metaVersion:vrm1?'1':'0'});
 const name=String((vrm1||vrm0).meta?.name||(vrm1||vrm0).meta?.title||fallback).slice(0,80);
 return {kind:'vrm',model:{name,meta,expressions,watermark:null},capabilities:{lipSync:vrm1?['aa','ih','ou','ee','oh'].some(n=>preset[n]?.morphTargetBinds?.length):old.some(g=>['a','i','u','e','o'].includes(g.presetName)&&g.binds?.length),blink:vrm1?Boolean(preset.blink||preset.blinkLeft):old.some(g=>String(g.presetName).startsWith('blink'))},bytes:body.length,vertices,pixels};
}
async function readVrm(input){const body=Buffer.isBuffer(input)?input:(()=>{const stat=fs.statSync(input);assert(stat.isFile()&&stat.size<=MAX_VRM_BYTES,'VRMは128MB以下にしてください。');return fs.readFileSync(input);})();const parsed=parseVrm(body,Buffer.isBuffer(input)?'VRM':path.basename(input,'.vrm'));await checkGlb(new Blob([body]),'model.vrm',true);return {...parsed,files:new Map([['model.vrm',body]]),version:crypto.createHash('sha256').update(body).digest('hex').slice(0,16)};}
module.exports={MAX_VRM_BYTES,parseVrm,readVrm};
