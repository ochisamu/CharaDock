// Register imagegen masters to Nike's existing rig; only eyes/brows change.
// Reuses the validated composer: original alpha, nose and audio-owned mouths.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PNG } = require('pngjs');
const { composeEmotions } = require('../.agents/skills/build-purupuru-avatar/scripts/compose-emotions.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'assets/nike-avatar');
const canonical = PNG.sync.read(fs.readFileSync(path.join(directory, 'eyes-open-mouth-closed.png')));
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'character.json')));
const target = [[557,639],[731,614]];
// Reviewed structural anchors. Joy uses the eye socket rather than the raised
// smile's iris (there is none), so its intentional eyelid shape is retained.
const anchors = {joy:[[455,522],[597,501]], worried:[[457,529],[600,507]], exasperated:[[430,552],[603,521]]};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nike-extra-'));
const edits = {};
for (const [emotion, source] of Object.entries(anchors)) {
  const filename = emotion === 'exasperated' ? 'proud-v2-jitome' : emotion;
  const master = PNG.sync.read(fs.readFileSync(path.join(root, `assets/nike-performance-sources/${filename}.png`)));
  if (master.width !== 1254 || master.height !== 1254) throw Error(`${emotion}: review registration for changed master`);
  const out = new PNG({width:1536,height:1536});
  const sx=source[1][0]-source[0][0], sy=source[1][1]-source[0][1];
  const tx=target[1][0]-target[0][0], ty=target[1][1]-target[0][1], d=sx*sx+sy*sy;
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
  for(let y=670;y<1536;y++) for(let x=0;x<1536;x++) {
    const f=Math.min(1,(y-670)/14),i=(y*1536+x)*4;
    for(let c=0;c<4;c++) out.data[i+c]=Math.round(out.data[i+c]*(1-f)+canonical.data[i+c]*f);
  }
  edits[emotion]=path.join(tmp, `${emotion}.png`);
  fs.writeFileSync(edits[emotion],PNG.sync.write(out));
}
console.log(composeEmotions({directory, metadata, edits}));
require('./build-nike-doya.cjs').build();
