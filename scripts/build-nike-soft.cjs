// Register an imagegen eye/brow edit to the canonical rig; preserve every
// pixel outside the existing emotion composer's eye regions and all mouths.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PNG } = require('pngjs');
const { composeEmotions } = require('../.agents/skills/build-purupuru-avatar/scripts/compose-emotions.cjs');
const root = path.resolve(__dirname,'..');
const master = PNG.sync.read(fs.readFileSync(path.join(root,'assets/nike-performance-sources/soft.png')));
if (master.width !== 1254 || master.height !== 1254) throw Error('Master registration requires review');
const out = new PNG({width:1536,height:1536});
// Reviewed iris anchors on the generated master -> canonical eye anchors.
const source = [[444,543],[611,516]], target=[[557,639],[731,614]];
const sx=167, sy=-27, tx=174, ty=-25, d=sx*sx+sy*sy;
const a=(tx*sx+ty*sy)/d, b=(ty*sx-tx*sy)/d, det=a*a+b*b;
for(let y=0;y<1536;y++) for(let x=0;x<1536;x++) {
  const dx=x-target[0][0],dy=y-target[0][1];
  const u=(a*dx+b*dy)/det+source[0][0],v=(-b*dx+a*dy)/det+source[0][1];
  const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
  if(ix<0||iy<0||ix+1>=1254||iy+1>=1254) continue;
  for(let c=0;c<4;c++) out.data[(y*1536+x)*4+c]=Math.round(
    master.data[(iy*1254+ix)*4+c]*(1-fx)*(1-fy)+master.data[(iy*1254+ix+1)*4+c]*fx*(1-fy)+
    master.data[((iy+1)*1254+ix)*4+c]*(1-fx)*fy+master.data[((iy+1)*1254+ix+1)*4+c]*fx*fy);
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nike-soft-'));
// Exclude the generated nose/cheek below the eyes; only brows and eyelids
// belong to this edit. Feather back into canonical skin before the nose.
const canonical=PNG.sync.read(fs.readFileSync(path.join(root,'assets/nike-avatar/eyes-open-mouth-closed.png')));
for(let y=670;y<1536;y++) for(let x=0;x<1536;x++) {
  const f=Math.min(1,(y-670)/14),i=(y*1536+x)*4;
  for(let c=0;c<4;c++) out.data[i+c]=Math.round(out.data[i+c]*(1-f)+canonical.data[i+c]*f);
}
const edit=path.join(tmp,'registered.png'); fs.writeFileSync(edit,PNG.sync.write(out));
const directory=path.join(root,'assets/nike-avatar');
console.log(composeEmotions({directory,metadata:JSON.parse(fs.readFileSync(path.join(directory,'character.json'))),edits:{soft:edit}}));
