// Approved imagegen face + registered speech apertures; not a full-body redraw.
const fs=require('node:fs'),path=require('node:path'),{PNG}=require('pngjs');
const {validateEmotionSprites}=require('../desktop/lib/emotion-sprites.cjs');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'assets/nike-avatar');
const read=name=>PNG.sync.read(fs.readFileSync(path.join(root,name)));
function sample(p,x,y,c){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  if(ix<0||iy<0||ix+1>=p.width||iy+1>=p.height)throw Error('Registration outside master');
  return p.data[(iy*p.width+ix)*4+c]*(1-fx)*(1-fy)+p.data[(iy*p.width+ix+1)*4+c]*fx*(1-fy)+p.data[((iy+1)*p.width+ix)*4+c]*(1-fx)*fy+p.data[((iy+1)*p.width+ix+1)*4+c]*fx*fy;
}
function build(){
 const metadata=JSON.parse(fs.readFileSync(path.join(dir,'character.json')));
 const face=read('assets/nike-performance-sources/proud-v3-doya-candidate.png');
 const mouths=[face,read('assets/nike-performance-sources/proud-v3-half.png'),read('assets/nike-performance-sources/proud-v3-open.png')];
 if(mouths.some(p=>p.width!==1254||p.height!==1254))throw Error('Review master registration');
 const base=read('assets/nike-avatar/eyes-open-mouth-closed.png');
 // Reviewed eye anchors on v3 -> canonical. Mouth registers independently so
 // generated face proportions never move the avatar's speaking pivot.
 const sx=600-430,sy=495-535,tx=174,ty=-25,d=sx*sx+sy*sy;
 const a=(tx*sx+ty*sy)/d,b=(ty*sx-tx*sy)/d,det=a*a+b*b;
 const inverse=(x,y,cx,cy,ux,uy)=>[(a*(x-cx)+b*(y-cy))/det+ux,(-b*(x-cx)+a*(y-cy))/det+uy];
 const avatar={},names=['closed','half','open'];
 for(let m=0;m<3;m++){
  const canonical=read('assets/nike-avatar/eyes-open-mouth-'+names[m]+'.png');
  const out=new PNG({width:1536,height:1536});canonical.data.copy(out.data);
  for(let y=500;y<810;y++)for(let x=450;x<825;x++){
   const i=(y*1536+x)*4;if(base.data[i+3]!==255)continue;
   const eye=Math.min(Math.hypot((x-557)/91,(y-621)/84),Math.hypot((x-731)/91,(y-596)/84));
   const mouth=Math.hypot((x-641)/68,(y-756)/42);
   const weight=r=>{const t=Math.max(0,Math.min(1,(1-r)/.18));return t*t*(3-2*t)};
   const ew=weight(eye)*Math.max(0,Math.min(1,(684-y)/14));
   const mw=weight(mouth);
   const [ex,ey]=inverse(x,y,557,639,430,535),[mx,my]=inverse(x,y,641,756,519,622);
   for(let c=0;c<3;c++){
    let v=base.data[i+c];
    if(ew>0)v=v*(1-ew)+sample(face,ex,ey,c)*ew;
    if(mw>0)v=v*(1-mw)+sample(mouths[m],mx,my,c)*mw;
    if(mw>0 || Math.round(v)!==base.data[i+c]) out.data[i+c]=Math.round(v);
   }
  }
  const cap=names[m][0].toUpperCase()+names[m].slice(1);
  avatar['eyesOpenMouth'+cap]=fs.readFileSync(path.join(dir,'eyes-open-mouth-'+names[m]+'.png'));
  avatar['emotionProudMouth'+cap]=PNG.sync.write(out);
 }
 validateEmotionSprites(avatar,{strict:true,rig:metadata.rig});
 for(const [i,name]of names.entries())fs.writeFileSync(path.join(dir,'emotion-proud-mouth-'+name+'.png'),avatar['emotionProudMouth'+name[0].toUpperCase()+name.slice(1)]);
 return ['closed','half','open'].map(m=>'emotion-proud-mouth-'+m+'.png');
}
module.exports={build};if(require.main===module)console.log(build());
