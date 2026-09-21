#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { OPTIONAL_AVATAR_IMAGE_FILES, validateEmotionSprites, emotionRig } = require("./emotion-sprites.cjs");

// Rows: happy, thinking, surprised. Columns: closed, half, open mouth.
function previewEmotions(directory, referenceDirectory = directory, emotions = ["happy", "thinking", "surprised"]) {
  const read = (file) => PNG.sync.read(fs.readFileSync(file));
  const avatar = {};
  for (const mouth of ["Closed", "Half", "Open"]) {
    avatar[`eyesOpenMouth${mouth}`] = fs.readFileSync(path.join(directory, `eyes-open-mouth-${mouth.toLowerCase()}.png`));
  }
  for (const [key, filename] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) {
    if (fs.existsSync(path.join(directory, filename))) avatar[key] = fs.readFileSync(path.join(directory, filename));
  }
  const metadataPath = ["character.json", "default-settings.json"].map((name) => path.join(referenceDirectory, name)).find((file) => fs.existsSync(file));
  const rig = metadataPath ? emotionRig(JSON.parse(fs.readFileSync(metadataPath))) : null;
  validateEmotionSprites(avatar, { strict: true, required: true, rig });
  const layers = ["back-hair.png", "front-hair.png"].map((name) => fs.existsSync(path.join(referenceDirectory, name)) ? read(path.join(referenceDirectory, name)) : null);
  const tile = 420;
  const sheet = new PNG({ width: tile * 3, height: tile * emotions.length });
  for (const [row, emotion] of emotions.entries()) {
    for (const [col, mouth] of ["closed", "half", "open"].entries()) {
      const frame = read(path.join(directory, `emotion-${emotion}-mouth-${mouth}.png`));
      if (layers.some((layer) => layer && (layer.width !== frame.width || layer.height !== frame.height))) throw new Error("Hair canvas mismatch");
      for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
        const dest = ((row * tile + y) * sheet.width + col * tile + x) * 4;
        const sx = Math.floor(x * frame.width / tile), sy = Math.floor(y * frame.height / tile);
        const src = (sy * frame.width + sx) * 4;
        const bg = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 240 : 222;
        sheet.data.fill(bg, dest, dest + 3);
        sheet.data[dest + 3] = 255;
        for (const layer of [layers[0], frame, layers[1]]) {
          if (!layer) continue;
          const alpha = layer.data[src + 3] / 255;
          for (let c = 0; c < 3; c++) sheet.data[dest + c] = Math.round(layer.data[src + c] * alpha + sheet.data[dest + c] * (1 - alpha));
        }
      }
    }
  }
  const output = path.join(directory, "qa-emotions-preview.png");
  fs.writeFileSync(output, PNG.sync.write(sheet));
  return output;
}
module.exports = { previewEmotions };
if (require.main === module) {
  try { console.log(previewEmotions(path.resolve(process.argv[2] || "output"), process.argv[3] ? path.resolve(process.argv[3]) : undefined)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
