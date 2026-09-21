#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { isChromaGreen } = require("./validate-output.cjs");

function argumentsByName(values) {
  const result = {};
  for (let index = 2; index < values.length; index += 2) {
    const key = String(values[index] || "").replace(/^--/, "");
    if (key) result[key] = values[index + 1];
  }
  return result;
}

function readNormalized(filePath) {
  const png = PNG.sync.read(fs.readFileSync(path.resolve(filePath)));
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 3] <= 8 || isChromaGreen(png.data[index], png.data[index + 1], png.data[index + 2])) {
      png.data[index] = 0;
      png.data[index + 1] = 0;
      png.data[index + 2] = 0;
      png.data[index + 3] = 0;
    }
  }
  return png;
}

function sameSize(images) {
  const first = images[0];
  return images.every((image) => image.width === first.width && image.height === first.height);
}

function copyPng(png) {
  const result = new PNG({ width: png.width, height: png.height });
  png.data.copy(result.data);
  return result;
}

function blendRegion(target, edit, region) {
  const left = Math.max(0, Math.floor(region.x - region.rx));
  const right = Math.min(target.width - 1, Math.ceil(region.x + region.rx));
  const top = Math.max(0, Math.floor(region.y - region.ry));
  const bottom = Math.min(target.height - 1, Math.ceil(region.y + region.ry));
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const distance = Math.sqrt((((x - region.x) / region.rx) ** 2) + (((y - region.y) / region.ry) ** 2));
      if (distance >= 1) continue;
      const weight = distance <= .78 ? 1 : (1 - distance) / .22;
      const index = (y * target.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        target.data[index + channel] = Math.round(target.data[index + channel] * (1 - weight) + edit.data[index + channel] * weight);
      }
    }
  }
}

function withRegions(base, edit, regions) {
  const result = copyPng(base);
  for (const region of regions) blendRegion(result, edit, region);
  return result;
}

function writePng(directory, name, png) {
  fs.writeFileSync(path.join(directory, name), PNG.sync.write(png));
}

function main() {
  const args = argumentsByName(process.argv);
  for (const key of ["base", "mouth-half", "mouth-open", "eyes-closed", "front-hair", "hair-reference", "metadata", "output"]) {
    if (!args[key]) throw new Error(`missing --${key}`);
  }
  const metadata = JSON.parse(fs.readFileSync(path.resolve(args.metadata), "utf8"));
  const base = readNormalized(args.base);
  const mouthHalfEdit = readNormalized(args["mouth-half"]);
  const mouthOpenEdit = readNormalized(args["mouth-open"]);
  const eyesClosedEdit = readNormalized(args["eyes-closed"]);
  const frontHair = readNormalized(args["front-hair"]);
  const hairReference = readNormalized(args["hair-reference"]);
  const images = [base, mouthHalfEdit, mouthOpenEdit, eyesClosedEdit, frontHair, hairReference];
  if (!sameSize(images)) throw new Error("all generated source images must have exactly the same canvas size");
  const eyes = metadata.rig?.eyeCenters;
  const mouth = metadata.rig?.mouthCenter;
  if (!Array.isArray(eyes) || eyes.length !== 2 || !Array.isArray(mouth)) throw new Error("metadata rig eyeCenters and mouthCenter are required");
  const eyeDistance = Math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1]);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 20) throw new Error("metadata eye centers are invalid");
  const eyeRegions = eyes.map(([x, y]) => ({ x, y, rx: eyeDistance * .52, ry: eyeDistance * .38 }));
  const mouthRegions = [{ x: mouth[0], y: mouth[1], rx: eyeDistance * .62, ry: eyeDistance * .42 }];
  const openHalf = withRegions(base, mouthHalfEdit, mouthRegions);
  const openOpen = withRegions(base, mouthOpenEdit, mouthRegions);
  const closedClosed = withRegions(base, eyesClosedEdit, eyeRegions);
  const closedHalf = withRegions(closedClosed, mouthHalfEdit, mouthRegions);
  const closedOpen = withRegions(closedClosed, mouthOpenEdit, mouthRegions);
  const output = path.resolve(args.output);
  fs.mkdirSync(output, { recursive: true });
  writePng(output, "eyes-open-mouth-closed.png", base);
  writePng(output, "eyes-open-mouth-half.png", openHalf);
  writePng(output, "eyes-open-mouth-open.png", openOpen);
  writePng(output, "eyes-closed-mouth-closed.png", closedClosed);
  writePng(output, "eyes-closed-mouth-half.png", closedHalf);
  writePng(output, "eyes-closed-mouth-open.png", closedOpen);
  writePng(output, "front-hair.png", frontHair);
  writePng(output, "hair-reference.png", hairReference);
  fs.copyFileSync(path.resolve(args.metadata), path.join(output, "character.json"));
  process.stdout.write(`${JSON.stringify({ ok: true, output, size: [base.width, base.height] })}\n`);
}

module.exports = { readNormalized, withRegions };

if (require.main === module) try { main(); } catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
