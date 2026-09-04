// SPDX-License-Identifier: Apache-2.0
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { renderCharacterPortraitFrames } = require("../desktop/lib/rlcd42-monochrome.cjs");

const root = path.resolve(__dirname, "..");

function parseArguments(argv) {
  const options = { style: "manga", output: path.join(root, "work", "rlcd42-previews"), directories: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--style") options.style = String(argv[++index] || "");
    else if (argument === "--output") options.output = path.resolve(argv[++index] || "");
    else options.directories.push(path.resolve(argument));
  }
  if (!["illustration", "manga"].includes(options.style)) throw new Error("--style must be illustration or manga");
  return options;
}

function defaultCharacterDirectories() {
  const assets = path.join(root, "assets");
  return fs.readdirSync(assets)
    .map((name) => path.join(assets, name))
    .filter((directory) => fs.existsSync(path.join(directory, "eyes-open-mouth-closed.png")))
    .sort();
}

function safeOutputName(directory, usedNames) {
  const base = path.basename(directory).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "character";
  let name = base;
  for (let suffix = 2; usedNames.has(name); suffix += 1) name = `${base}-${suffix}`;
  usedNames.add(name);
  return name;
}

function portraitPng(portrait) {
  const png = new PNG({ width: portrait.width, height: portrait.height });
  const rowBytes = Math.ceil(portrait.width / 8);
  for (let y = 0; y < portrait.height; y += 1) {
    for (let x = 0; x < portrait.width; x += 1) {
      const black = Boolean(portrait.pixels[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)));
      const index = (y * portrait.width + x) * 4;
      png.data[index] = black ? 0 : 255;
      png.data[index + 1] = black ? 0 : 255;
      png.data[index + 2] = black ? 0 : 255;
      png.data[index + 3] = 255;
    }
  }
  return png;
}

function contactSheet(items) {
  const columns = 4;
  const rows = Math.ceil(items.length / columns);
  const gap = 8;
  const width = columns * 400 + (columns - 1) * gap;
  const height = rows * 300 + (rows - 1) * gap;
  const sheet = new PNG({ width, height });
  sheet.data.fill(255);
  items.forEach(({ png }, itemIndex) => {
    const offsetX = (itemIndex % columns) * (400 + gap);
    const offsetY = Math.floor(itemIndex / columns) * (300 + gap);
    for (let y = 0; y < png.height; y += 1) {
      const sourceStart = y * png.width * 4;
      const targetStart = ((offsetY + y) * width + offsetX) * 4;
      png.data.copy(sheet.data, targetStart, sourceStart, sourceStart + png.width * 4);
    }
  });
  return sheet;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const directories = options.directories.length ? options.directories : defaultCharacterDirectories();
  if (!directories.length) throw new Error("No character directories were found");
  fs.mkdirSync(options.output, { recursive: true });
  const usedNames = new Set();
  const characters = directories.map((directory) => {
    const settingsPath = path.join(directory, "default-settings.json");
    const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
    const name = safeOutputName(directory, usedNames);
    const portraits = renderCharacterPortraitFrames({ directory, settings, style: options.style });
    const frames = Object.entries(portraits).map(([frame, portrait]) => {
      const png = portraitPng(portrait);
      const file = path.join(options.output, `${name}-${frame}-${options.style}.png`);
      fs.writeFileSync(file, PNG.sync.write(png));
      return { frame, file, portrait, png };
    });
    return { name, directory, frames };
  });
  const items = characters.flatMap((character) => character.frames.map((frame) => ({ ...frame, name: `${character.name}-${frame.frame}` })));
  const contactFile = path.join(options.output, `contact-${options.style}.png`);
  fs.writeFileSync(contactFile, PNG.sync.write(contactSheet(items)));
  const manifest = {
    style: options.style,
    algorithm: items[0]?.portrait.algorithm,
    contactFile,
    characters: characters.map(({ name, directory, frames }) => ({
      name,
      directory,
      frames: Object.fromEntries(frames.map(({ frame, file, portrait }) => [frame, {
        file,
        revision: portrait.revision,
        crop: portrait.crop,
        metrics: portrait.metrics,
      }])),
    })),
  };
  fs.writeFileSync(path.join(options.output, `manifest-${options.style}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const character of manifest.characters) {
    const summary = Object.entries(character.frames)
      .map(([frame, item]) => `${frame}=black:${item.metrics.blackRatio}/face:${item.metrics.faceBlackRatio}`)
      .join(" ");
    console.log(`${character.name}: ${summary}`);
  }
  console.log(`contact: ${contactFile}`);
}

main();
