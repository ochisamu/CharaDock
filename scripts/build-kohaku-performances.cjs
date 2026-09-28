// SPDX-License-Identifier: Apache-2.0
// Reviewed Kohaku-only assembly. Generated body + original registered head.
// Hair is deliberately absent: existing independent hair layers stay in use.
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { cleanAvatarAlpha, despillAvatarEdges } = require('../desktop/lib/png-alpha.cjs');
const root = path.resolve(__dirname, '..');
const poses = ['ponder', 'explain', 'celebrate'];
function assemble(masters, output = path.join(root, 'assets/amber-avatar')) {
  const directory = path.join(root, 'assets/amber-avatar');
  fs.mkdirSync(output, { recursive: true });
  const read = file => PNG.sync.read(fs.readFileSync(file));
  const hair = ['back-hair.png', 'front-hair.png'].map(f => read(path.join(directory, f)));
  const cell = 314, sheet = new PNG({width: cell * 3, height: cell * 6});
  for (const [column, pose] of poses.entries()) {
    const master = read(path.join(masters, pose + '.png'));
    if (master.width !== 1254 || master.height !== 1254) throw new Error('Kohaku master must be registered 1254 square');
    if (!master.data.some((v, i) => i % 4 === 3 && v === 0)) throw new Error('Master requires genuine transparency');
    cleanAvatarAlpha(master); despillAvatarEdges(master);
    for (const [eyeIndex, eye] of ['open', 'closed'].entries()) for (const [mouthIndex, mouth] of ['closed', 'half', 'open'].entries()) {
      const file = eye === 'open' && pose !== 'explain'
        ? `emotion-${pose === 'ponder' ? 'thinking' : 'happy'}-mouth-${mouth}.png`
        : `eyes-${eye}-mouth-${mouth}.png`;
      const face = read(path.join(directory, file));
      const out = new PNG({width:1254,height:1254});
      for (let y=0;y<1254;y++) for(let x=0;x<1254;x++) {
        const i=(y*1254+x)*4;
        // Upper face, scalp and mouth are bit-identical to shipped art.
        // Blend only the lower chin/neck transition into the authored torso.
        const t=Math.max(0,Math.min(1,(y-775)/40)), w=t*t*(3-2*t);
        const a=face.data[i+3]/255*(1-w), b=master.data[i+3]/255*w, alpha=a+b;
        for(let c=0;c<3;c++) out.data[i+c]=alpha ? Math.round((face.data[i+c]*a+master.data[i+c]*b)/alpha) : 0;
        out.data[i+3]=Math.round(alpha*255);
      }
      fs.writeFileSync(path.join(output,`performance-${pose}-eyes-${eye}-mouth-${mouth}.png`), PNG.sync.write(out));
      const row=eyeIndex*3+mouthIndex;
      for(let y=0;y<cell;y++) for(let x=0;x<cell;x++) {
        const i=(Math.min(1253,y*4)*1254+Math.min(1253,x*4))*4;
        const j=((row*cell+y)*sheet.width+column*cell+x)*4;
        let rgb=[240,237,231];
        for(const layer of [hair[0],out,hair[1]]) {const a=layer.data[i+3]/255;rgb=rgb.map((v,c)=>layer.data[i+c]*a+v*(1-a));}
        for(let c=0;c<3;c++)sheet.data[j+c]=Math.round(rgb[c]);sheet.data[j+3]=255;
      }
    }
  }
  fs.writeFileSync(path.join(masters,'qa.png'),PNG.sync.write(sheet));
}
if(require.main===module)assemble(path.resolve(process.argv[2]),process.argv[3]&&path.resolve(process.argv[3]));
module.exports={assemble};
