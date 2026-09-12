// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { compositePngLayers } = require("./rlcd42-monochrome.cjs");

function rgb565Portrait(image) {
  const { width, height, data } = image || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || data?.length !== width * height * 4) throw new Error("Invalid colour portrait.");
  const pixels = Buffer.alloc(320 * 240 * 2);
  const scale = Math.min(320 / width, 240 / height);
  const left = (320 - width * scale) / 2, top = (240 - height * scale) / 2;
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
    const sx = (x - left + .5) / scale - .5, sy = (y - top + .5) / scale - .5;
    const rgb = [255, 245, 223];
    if (sx >= -.5 && sy >= -.5 && sx < width - .5 && sy < height - .5) {
      const cx = Math.max(0, Math.min(width - 1, sx)), cy = Math.max(0, Math.min(height - 1, sy));
      const x0 = Math.floor(cx), y0 = Math.floor(cy), dx = cx - x0, dy = cy - y0;
      const samples = [[x0,y0,(1-dx)*(1-dy)], [Math.min(width-1,x0+1),y0,dx*(1-dy)],
        [x0,Math.min(height-1,y0+1),(1-dx)*dy], [Math.min(width-1,x0+1),Math.min(height-1,y0+1),dx*dy]];
      const accum = [0,0,0];
      for (const [px,py,w] of samples) {
        const i = (py*width+px)*4, a = data[i+3]/255;
        for (let c=0;c<3;c++) accum[c] += w * (data[i+c]*a + rgb[c]*(1-a));
      }
      for (let c=0;c<3;c++) rgb[c] = Math.round(accum[c]);
    }
    pixels.writeUInt16LE(((rgb[0]&248)<<8)|((rgb[1]&252)<<3)|(rgb[2]>>3), (y*320+x)*2);
  }
  return { width: 320, height: 240, pixels, revision: createHash("sha256").update(pixels).digest("hex") };
}

function renderStackchanPortrait(directory) {
  const face = path.join(directory, "eyes-open-mouth-closed.png");
  // The full-colour layer set, never the RLCD-specific monochrome derivative.
  const layers = fs.existsSync(face)
    ? ["back-hair.png", "eyes-open-mouth-closed.png", "front-hair.png"].map((n) => path.join(directory,n)).filter(fs.existsSync)
    : ["thumbnail.png", "reference.png"].map((n) => path.join(directory,n)).filter(fs.existsSync).slice(0,1);
  if (!layers.length) return null;
  return rgb565Portrait(compositePngLayers(layers));
}
module.exports = { rgb565Portrait, renderStackchanPortrait };
