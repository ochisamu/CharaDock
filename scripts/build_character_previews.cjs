// SPDX-License-Identifier: Apache-2.0
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "docs", "images", "characters");
const characters = [
  ["amber-avatar", "amber-complete-v2.png"],
  ["bronze-avatar", "bronze-complete-v2.png"],
  ["towa-avatar", "towa-complete-v1.png"],
  ["sage-avatar", "sage-complete-v1.png"],
  ["nike-avatar", "nike-complete-v1.png"],
];

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function compositeOver(bottom, top) {
  if (bottom.width !== top.width || bottom.height !== top.height) {
    throw new Error("Character preview layers must have identical dimensions");
  }
  const result = new PNG({ width: bottom.width, height: bottom.height });
  for (let i = 0; i < result.data.length; i += 4) {
    const bottomAlpha = bottom.data[i + 3] / 255;
    const topAlpha = top.data[i + 3] / 255;
    const alpha = topAlpha + bottomAlpha * (1 - topAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      result.data[i + channel] = alpha === 0
        ? 0
        : Math.round((top.data[i + channel] * topAlpha + bottom.data[i + channel] * bottomAlpha * (1 - topAlpha)) / alpha);
    }
    result.data[i + 3] = Math.round(alpha * 255);
  }
  return result;
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [characterId, outputName] of characters) {
  const directory = path.join(root, "assets", characterId);
  const back = readPng(path.join(directory, "back-hair.png"));
  const faceAndBody = readPng(path.join(directory, "eyes-open-mouth-closed.png"));
  const front = readPng(path.join(directory, "front-hair.png"));
  const complete = compositeOver(compositeOver(back, faceAndBody), front);
  fs.writeFileSync(path.join(outputDir, outputName), PNG.sync.write(complete, { deflateLevel: 9 }));
  console.log(`preview: ${characterId} -> docs/images/characters/${outputName}`);
}
