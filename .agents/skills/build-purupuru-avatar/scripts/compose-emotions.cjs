#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { readNormalized, withRegions } = require("./compose-variants.cjs");
const { EMOTIONS, OPTIONAL_AVATAR_IMAGE_FILES, validateEmotionSprites, emotionRig, isEmotionEyePixel } = require("./emotion-sprites.cjs");

function composeEmotions({ directory, metadata, edits }) {
  const rig = emotionRig(metadata);
  if (!Array.isArray(rig?.eyeCenters) || rig.eyeCenters.length !== 2 ||
      !rig.eyeCenters.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    throw new Error("Two rig.eyeCenters are required");
  }
  const distance = Math.hypot(rig.eyeCenters[1][0] - rig.eyeCenters[0][0], rig.eyeCenters[1][1] - rig.eyeCenters[0][1]);
  if (distance < 20) throw new Error("Invalid eye distance");
  const regions = rig.eyeCenters.map(([x, y]) => ({ x, y: y - distance * .1, rx: distance * .52, ry: distance * .48 }));
  const mouths = ["closed", "half", "open"];
  const bases = mouths.map((mouth) => PNG.sync.read(fs.readFileSync(path.join(directory, `eyes-open-mouth-${mouth}.png`))));
  const base = bases[0];
  if (bases.some((frame) => frame.width !== base.width || frame.height !== base.height)) throw new Error("Canonical mouth canvas mismatch");
  if (rig.eyeCenters.some(([x, y]) => x < 0 || y < 0 || x >= base.width || y >= base.height)) throw new Error("Eye center outside canvas");
  const avatar = Object.fromEntries(mouths.map((mouth, m) => [`eyesOpenMouth${mouth[0].toUpperCase() + mouth.slice(1)}`, PNG.sync.write(bases[m])]));
  const outputs = [];
  for (const emotion of EMOTIONS) {
    if (!edits[emotion]) continue;
    const edit = readNormalized(edits[emotion]);
    if (edit.width !== base.width || edit.height !== base.height) throw new Error(`${emotion} edit canvas mismatch`);
    const localized = withRegions(base, edit, regions);
    // Freeze alpha and exclude every pixel used by the canonical speech frames.
    for (let i = 0; i < base.data.length; i += 4) {
      localized.data[i + 3] = base.data[i + 3];
      const canReplaceEyeDifference = isEmotionEyePixel(rig, (i / 4) % base.width, Math.floor(i / 4 / base.width));
      if (!base.data[i + 3] || (!canReplaceEyeDifference && bases.some((frame) => frame.data.subarray(i, i + 4).some((v, c) => v !== base.data[i + c])))) {
        base.data.copy(localized.data, i, i, i + 4);
      }
    }
    for (let m = 0; m < 3; m += 1) {
      const frame = new PNG({ width: base.width, height: base.height });
      bases[m].data.copy(frame.data);
      for (let i = 0; i < base.data.length; i += 4) {
        if (localized.data.subarray(i, i + 4).some((v, c) => v !== base.data[i + c])) localized.data.copy(frame.data, i, i, i + 3);
      }
      const key = `emotion${emotion[0].toUpperCase() + emotion.slice(1)}Mouth${mouths[m][0].toUpperCase() + mouths[m].slice(1)}`;
      avatar[key] = PNG.sync.write(frame);
      outputs.push(key);
    }
  }
  if (!outputs.length) throw new Error("Supply a --happy, --thinking, --surprised, --soft, --joy, --worried or --proud imagegen edit");
  validateEmotionSprites(avatar, { strict: true, rig });
  for (const key of outputs) fs.writeFileSync(path.join(directory, OPTIONAL_AVATAR_IMAGE_FILES[key]), avatar[key]);
  return outputs.map((key) => OPTIONAL_AVATAR_IMAGE_FILES[key]);
}

module.exports = { composeEmotions };
if (require.main === module) {
  try {
    const args = Object.fromEntries(Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [process.argv[2 + i * 2].replace(/^--/, ""), process.argv[3 + i * 2]]));
    const directory = path.resolve(args.output || "output");
    const metadata = JSON.parse(fs.readFileSync(args.metadata || path.join(directory, "character.json"), "utf8"));
    process.stdout.write(`${JSON.stringify({ files: composeEmotions({ directory, metadata, edits: args }) })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
