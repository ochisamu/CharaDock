// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "app-icon.png");
const outputDirectory = path.join(projectRoot, "packaging", "windows-store", "Assets");

function resizeArea(source, width, height) {
  const output = new PNG({ width, height, colorType: 6 });
  const scaleX = source.width / width;
  const scaleY = source.height / height;
  for (let targetY = 0; targetY < height; targetY += 1) {
    const top = targetY * scaleY;
    const bottom = (targetY + 1) * scaleY;
    for (let targetX = 0; targetX < width; targetX += 1) {
      const left = targetX * scaleX;
      const right = (targetX + 1) * scaleX;
      const totals = [0, 0, 0, 0];
      let totalWeight = 0;
      for (let sourceY = Math.floor(top); sourceY < Math.ceil(bottom); sourceY += 1) {
        if (sourceY < 0 || sourceY >= source.height) continue;
        const verticalWeight = Math.max(0, Math.min(bottom, sourceY + 1) - Math.max(top, sourceY));
        for (let sourceX = Math.floor(left); sourceX < Math.ceil(right); sourceX += 1) {
          if (sourceX < 0 || sourceX >= source.width) continue;
          const horizontalWeight = Math.max(0, Math.min(right, sourceX + 1) - Math.max(left, sourceX));
          const weight = horizontalWeight * verticalWeight;
          const offset = (sourceY * source.width + sourceX) * 4;
          const alpha = source.data[offset + 3] / 255;
          totals[0] += source.data[offset] * alpha * weight;
          totals[1] += source.data[offset + 1] * alpha * weight;
          totals[2] += source.data[offset + 2] * alpha * weight;
          totals[3] += alpha * weight;
          totalWeight += weight;
        }
      }
      const targetOffset = (targetY * width + targetX) * 4;
      const outputAlpha = totalWeight ? totals[3] / totalWeight : 0;
      output.data[targetOffset] = outputAlpha ? Math.round(totals[0] / totals[3]) : 0;
      output.data[targetOffset + 1] = outputAlpha ? Math.round(totals[1] / totals[3]) : 0;
      output.data[targetOffset + 2] = outputAlpha ? Math.round(totals[2] / totals[3]) : 0;
      output.data[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
  return output;
}

function withoutBackground(source) {
  const output = new PNG({ width: source.width, height: source.height, colorType: 6 });
  source.data.copy(output.data);
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const red = output.data[offset];
    const green = output.data[offset + 1];
    const blue = output.data[offset + 2];
    // The established CharaDock icon has a near-white warm plate. Target-size
    // Windows icons are unplated, so remove only that neutral background while
    // retaining the navy, coral, and teal dock symbol.
    const backgroundDistance = Math.max(0, 244 - red) + Math.max(0, 234 - green) + Math.max(0, 218 - blue);
    if (red > 218 && green > 210 && blue > 198) {
      output.data[offset + 3] = Math.min(output.data[offset + 3], Math.round(Math.min(1, backgroundDistance / 28) * 255));
    }
  }
  return output;
}

function solidCanvas(width, height, color = [255, 255, 255, 255]) {
  const output = new PNG({ width, height, colorType: 6 });
  for (let offset = 0; offset < output.data.length; offset += 4) {
    output.data[offset] = color[0];
    output.data[offset + 1] = color[1];
    output.data[offset + 2] = color[2];
    output.data[offset + 3] = color[3];
  }
  return output;
}

function composite(destination, source, left, top) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (y * source.width + x) * 4;
      const targetOffset = ((top + y) * destination.width + left + x) * 4;
      const alpha = source.data[sourceOffset + 3] / 255;
      const inverse = 1 - alpha;
      destination.data[targetOffset] = Math.round(source.data[sourceOffset] * alpha + destination.data[targetOffset] * inverse);
      destination.data[targetOffset + 1] = Math.round(source.data[sourceOffset + 1] * alpha + destination.data[targetOffset + 1] * inverse);
      destination.data[targetOffset + 2] = Math.round(source.data[sourceOffset + 2] * alpha + destination.data[targetOffset + 2] * inverse);
      destination.data[targetOffset + 3] = 255;
    }
  }
}

function writePng(name, image) {
  fs.writeFileSync(path.join(outputDirectory, name), PNG.sync.write(image, { colorType: 6 }));
}

function squareAsset(source, name, size) {
  writePng(name, resizeArea(source, size, size));
}

function wideAsset(source, name, width, height) {
  const output = solidCanvas(width, height);
  const iconSize = Math.round(height * 0.92);
  const icon = resizeArea(source, iconSize, iconSize);
  composite(output, icon, Math.round((width - iconSize) / 2), Math.round((height - iconSize) / 2));
  writePng(name, output);
}

const source = PNG.sync.read(fs.readFileSync(sourcePath));
if (source.width !== source.height || source.width < 512) throw new Error("app-icon.png must be a square source of at least 512px.");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const [name, size] of [
  ["StoreLogo.png", 50],
  ["StoreLogo.scale-200.png", 100],
  ["AppList.png", 44],
  ["AppList.scale-200.png", 88],
  ["SmallTile.png", 71],
  ["SmallTile.scale-200.png", 142],
  ["MedTile.png", 150],
  ["MedTile.scale-200.png", 300],
  ["LargeTile.png", 310],
  ["LargeTile.scale-200.png", 620],
]) squareAsset(source, name, size);

wideAsset(source, "WideTile.png", 310, 150);
wideAsset(source, "WideTile.scale-200.png", 620, 300);

const unplated = withoutBackground(source);
for (const size of [16, 24, 32, 48, 256]) {
  squareAsset(unplated, `AppList.targetsize-${size}_altform-unplated.png`, size);
}

console.log(`Windows Store assets generated from ${path.relative(projectRoot, sourcePath)}.`);
