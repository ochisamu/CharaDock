// SPDX-License-Identifier: Apache-2.0
// Asset assembly only: generated arms/body, existing registered speech/blink art.
// Input masters must retain the canonical composition. Inspect the output sheet
// before installation; this is not an automatic arbitrary-character retargeter.
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { cleanAvatarAlpha, despillAvatarEdges } = require("../desktop/lib/png-alpha.cjs");
const poses = ["ponder", "explain", "celebrate"];
const directory = path.resolve(__dirname, "../assets/nike-avatar");
function sample(p, x, y, c) {
  const x0 = Math.max(0, Math.min(p.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(p.height - 1, Math.floor(y)));
  const x1 = Math.min(x0 + 1, p.width - 1), y1 = Math.min(y0 + 1, p.height - 1);
  const fx = Math.max(0, x - x0), fy = Math.max(0, y - y0);
  const a = p.data[(y0 * p.width + x0) * 4 + c], b = p.data[(y0 * p.width + x1) * 4 + c];
  const d = p.data[(y1 * p.width + x0) * 4 + c], e = p.data[(y1 * p.width + x1) * 4 + c];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}
function assemble(masters) {
  const { rig } = JSON.parse(fs.readFileSync(path.join(directory, "character.json")));
  const regions = [...rig.eyeCenters.map(([x, y]) => [x, y - 10, 100, 90, .16]), [...rig.mouthCenter, 68, 42, .6]];
  const sheet = new PNG({ width: 3 * 384, height: 6 * 384 });
  for (const [poseIndex, pose] of poses.entries()) {
    const master = PNG.sync.read(fs.readFileSync(path.join(masters, `${pose}.png`)));
    if (master.width !== master.height) throw new Error("Expected square pose master");
    for (const [eyeIndex, eyes] of ["open", "closed"].entries()) for (const [mouthIndex, mouth] of ["closed", "half", "open"].entries()) {
      const faceFile = eyes === "open" && pose !== "explain"
        ? `emotion-${pose === "celebrate" ? "happy" : "thinking"}-mouth-${mouth}.png`
        : `eyes-${eyes}-mouth-${mouth}.png`;
      const base = PNG.sync.read(fs.readFileSync(path.join(directory, faceFile)));
      const out = new PNG({ width: base.width, height: base.height });
      for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
        const i = (y * out.width + x) * 4;
        let weight = 0;
        for (const [cx, cy, rx, ry, feather] of regions) {
          const radius = Math.hypot((x - cx) / rx, (y - cy) / ry);
          const t = Math.max(0, Math.min(1, (1 - radius) / feather));
          weight = Math.max(weight, t * t * (3 - 2 * t));
        }
        const sx = x * master.width / out.width, sy = y * master.height / out.height;
        const alpha = sample(master, sx, sy, 3);
        // Face patches never own the generated pose silhouette. In particular,
        // a slightly different chin must not be punched out by canonical alpha.
        if (base.data[i + 3] < 250 || alpha < 250) weight = 0;
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(sample(master, sx, sy, c) * (1 - weight) + base.data[i + c] * weight);
        out.data[i + 3] = Math.round(alpha);
      }
      // Common bust baseline removes generator padding/fringe below the source
      // portrait; never trim hands/head. A short alpha ramp avoids a hard seam.
      for (let y = 1376; y < out.height; y++) for (let x = 0; x < out.width; x++) {
        const i = (y * out.width + x) * 4 + 3;
        out.data[i] *= Math.max(0, (1392 - y) / 16);
      }
      cleanAvatarAlpha(out); despillAvatarEdges(out);
      fs.writeFileSync(path.join(directory, `performance-${pose}-eyes-${eyes}-mouth-${mouth}.png`), PNG.sync.write(out));
      const row = eyeIndex * 3 + mouthIndex;
      for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) {
        const from = (y * 4 * out.width + x * 4) * 4;
        const to = ((row * 384 + y) * sheet.width + poseIndex * 384 + x) * 4;
        const alpha = out.data[from + 3] / 255;
        for (let c = 0; c < 3; c++) sheet.data[to + c] = out.data[from + c] * alpha + 235 * (1 - alpha);
        sheet.data[to + 3] = 255;
      }
    }
  }
  fs.writeFileSync(path.join(masters, "qa.png"), PNG.sync.write(sheet));
}
if (require.main === module) assemble(path.resolve(process.argv[2]));
module.exports = { assemble };
