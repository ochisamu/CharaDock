// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const {
  MANGA_PIPELINE,
  characterPortraitLayerPaths,
  portraitCrop,
  renderCharacterPortrait,
  renderCharacterPortraitFrames,
  renderMonochromePortrait,
} = require("../lib/rlcd42-monochrome.cjs");

const ROOT = path.resolve(__dirname, "../..");

function solidLayer(width, height, rgba) {
  const layer = new PNG({ width, height });
  for (let index = 0; index < layer.data.length; index += 4) layer.data.set(rgba, index);
  return layer;
}

function blackPixelRatio(portrait) {
  let black = 0;
  for (const byte of portrait.pixels) {
    for (let bit = 0; bit < 8; bit += 1) black += (byte >> bit) & 1;
  }
  return black / (portrait.width * portrait.height);
}

test("RLCD portrait conversion is deterministic and exactly 400x300 raw1-msb", () => {
  const base = solidLayer(80, 80, [255, 255, 255, 255]);
  const ink = solidLayer(80, 80, [0, 0, 0, 0]);
  for (let y = 12; y < 68; y += 1) {
    for (let x = 22; x < 58; x += 1) {
      const index = (y * 80 + x) * 4;
      ink.data.set([35, 45, 65, 255], index);
    }
  }
  const first = renderMonochromePortrait({ layers: [base, ink], faceCenter: { x: 40, y: 34 } });
  const second = renderMonochromePortrait({ layers: [base, ink], faceCenter: { x: 40, y: 34 } });
  assert.equal(first.pixels.length, 15000);
  assert.equal(first.style, "manga");
  assert.equal(first.algorithm, MANGA_PIPELINE);
  assert.ok(Math.abs(first.metrics.blackRatio - blackPixelRatio(first)) < 0.0001);
  assert.deepEqual(first.pixels, second.pixels);
  assert.equal(first.revision, second.revision);
  assert.match(first.revision, /^sha256:[a-f0-9]{32}$/);
  assert.ok(first.pixels.some((byte) => byte !== 0), "expected visible black pixels");
  assert.ok(first.pixels.some((byte) => byte !== 0xff), "expected visible white pixels");
});

test("RLCD manga and illustration styles have stable but distinct output", () => {
  const gradient = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const index = (y * 64 + x) * 4;
      gradient.data.set([x * 4, y * 4, Math.round((x + y) * 2), 255], index);
    }
  }
  const illustration = renderMonochromePortrait({ layers: [gradient], style: "illustration" });
  const manga = renderMonochromePortrait({ layers: [gradient], style: "manga" });
  assert.notDeepEqual(illustration.pixels, manga.pixels);
  assert.notEqual(illustration.revision, manga.revision);
});

test("RLCD manga leaves flat color fields clean instead of adding periodic dots", () => {
  const dark = renderMonochromePortrait({
    layers: [solidLayer(64, 64, [20, 20, 20, 255])],
    style: "manga",
    width: 64,
    height: 64,
  });
  const pale = renderMonochromePortrait({
    layers: [solidLayer(64, 64, [180, 180, 180, 255])],
    style: "manga",
    width: 64,
    height: 64,
  });
  assert.equal(blackPixelRatio(dark), 0);
  assert.equal(blackPixelRatio(pale), 0);
});

test("RLCD manga protects the face from becoming a dark halftone mass", () => {
  const portrait = renderMonochromePortrait({
    layers: [solidLayer(400, 300, [170, 170, 170, 255])],
    faceCenter: { x: 200, y: 126 },
    style: "manga",
  });
  let facePixels = 0;
  let blackFacePixels = 0;
  for (let y = 63; y <= 189; y += 1) {
    for (let x = 132; x <= 268; x += 1) {
      const dx = (x - 200) / 68;
      const dy = (y - 126) / 63;
      if ((dx * dx) + (dy * dy) > 1) continue;
      facePixels += 1;
      const byte = portrait.pixels[y * 50 + (x >> 3)];
      if (byte & (0x80 >> (x & 7))) blackFacePixels += 1;
    }
  }
  assert.ok(blackFacePixels / facePixels < 0.08);
});

test("RLCD manga preserves a one-pixel dark stroke after color downsampling", () => {
  const layer = solidLayer(400, 300, [245, 245, 245, 255]);
  for (let y = 30; y < 270; y += 1) {
    const index = (y * 400 + 200) * 4;
    layer.data.set([20, 30, 45, 255], index);
  }
  const portrait = renderMonochromePortrait({ layers: [layer], style: "manga" });
  let retained = 0;
  let expanded = 0;
  for (let y = 30; y < 270; y += 1) {
    for (let x = 198; x <= 202; x += 1) {
      const byte = portrait.pixels[y * 50 + (x >> 3)];
      if (!(byte & (0x80 >> (x & 7)))) continue;
      if (x === 200) retained += 1;
      else expanded += 1;
    }
  }
  assert.ok(retained > 210, `retained ${retained}/240 stroke pixels`);
  assert.ok(expanded < 80, `stroke expanded by ${expanded} neighbor pixels`);
});

test("RLCD portrait crop keeps the face above center and remains in bounds", () => {
  const crop = portraitCrop({ width: 1000, height: 1000 }, { x: 900, y: 100 }, 400, 300);
  assert.equal(crop.width, 1000);
  assert.equal(crop.height, 750);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
});

test("RLCD-specific portrait is optional and takes precedence over animation layers", () => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rlcd42-portrait-"));
  const dedicated = path.join(directory, "rlcd42-portrait.png");
  const layered = path.join(directory, "back-hair.png");
  fs.writeFileSync(dedicated, "dedicated");
  fs.writeFileSync(layered, "layered");
  assert.deepEqual(characterPortraitLayerPaths(directory), [dedicated]);
});

test("RLCD-specific line art preserves broad ink instead of extracting a thin edge", () => {
  const layer = solidLayer(80, 60, [255, 255, 255, 255]);
  for (let y = 5; y < 55; y += 1) {
    for (let x = 36; x < 44; x += 1) layer.data.set([0, 0, 0, 255], (y * 80 + x) * 4);
  }
  const portrait = renderMonochromePortrait({
    layers: [layer],
    style: "manga",
    width: 80,
    height: 60,
    lineArtSource: true,
  });
  assert.equal(portrait.algorithm, "selective-fill-v2-direct-ink");
  for (let x = 36; x < 44; x += 1) {
    const byte = portrait.pixels[30 * 10 + (x >> 3)];
    assert.ok(byte & (0x80 >> (x & 7)), `expected ink at x=${x}`);
  }
});

test("RLCD-specific manga keeps a light antialiased contour for the reflective panel", () => {
  const layer = solidLayer(80, 60, [255, 255, 255, 255]);
  for (let y = 5; y < 55; y += 1) layer.data.set([216, 216, 216, 255], (y * 80 + 40) * 4);
  const portrait = renderMonochromePortrait({
    layers: [layer],
    style: "manga",
    width: 80,
    height: 60,
    lineArtSource: true,
  });
  for (let y = 5; y < 55; y += 1) {
    const byte = portrait.pixels[y * 10 + (40 >> 3)];
    assert.ok(byte & (0x80 >> (40 & 7)), `expected antialiased ink at y=${y}`);
  }
});

test("RLCD-specific portrait never falls back to visually unrelated generic animation frames", () => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rlcd42-dedicated-frames-"));
  const dedicated = solidLayer(80, 60, [255, 255, 255, 255]);
  for (let y = 8; y < 52; y += 1) dedicated.data.set([0, 0, 0, 255], (y * 80 + 40) * 4);
  fs.writeFileSync(path.join(directory, "rlcd42-portrait.png"), PNG.sync.write(dedicated));
  for (const name of ["back-hair.png", "front-hair.png", "eyes-closed-mouth-closed.png", "eyes-open-mouth-half.png", "eyes-open-mouth-open.png"]) {
    fs.writeFileSync(path.join(directory, name), PNG.sync.write(solidLayer(80, 60, [0, 0, 0, 255])));
  }
  const frames = renderCharacterPortraitFrames({ directory, style: "manga" });
  assert.deepEqual(Object.keys(frames), ["neutral", "blink", "mouthHalf", "mouthOpen"]);
  assert.equal(frames.neutral.algorithm, "selective-fill-v2-direct-ink");
  assert.equal(frames.blink.revision, frames.neutral.revision);
  assert.equal(frames.mouthHalf.revision, frames.neutral.revision);
  assert.equal(frames.mouthOpen.revision, frames.neutral.revision);
});

test("RLCD manga stays within readable density bounds for every bundled character", () => {
  const characterIds = ["amber-avatar", "bronze-avatar", "nike-avatar", "sage-avatar", "towa-avatar"];
  const revisions = new Set();
  for (const characterId of characterIds) {
    const directory = path.join(ROOT, "assets", characterId);
    const settings = JSON.parse(fs.readFileSync(path.join(directory, "default-settings.json"), "utf8"));
    const portrait = renderCharacterPortrait({ directory, settings, style: "manga" });
    assert.ok(portrait.metrics.blackRatio >= 0.1 && portrait.metrics.blackRatio <= 0.18,
      `${characterId} black ratio ${portrait.metrics.blackRatio}`);
    assert.ok(portrait.metrics.faceBlackRatio >= 0.15 && portrait.metrics.faceBlackRatio <= 0.36,
      `${characterId} face ratio ${portrait.metrics.faceBlackRatio}`);
    revisions.add(portrait.revision);
  }
  assert.equal(revisions.size, characterIds.length, "each character should retain a distinct portrait");
});

test("RLCD animation frames are generated generically when dedicated portraits are absent", () => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rlcd42-generic-frames-"));
  const names = [
    "eyes-open-mouth-closed.png",
    "eyes-closed-mouth-closed.png",
    "eyes-open-mouth-half.png",
    "eyes-open-mouth-open.png",
  ];
  names.forEach((name, imageIndex) => {
    const image = solidLayer(80, 60, [255, 255, 255, 255]);
    for (let y = 10; y < 50; y += 1) image.data.set([0, 0, 0, 255], (y * 80 + 30 + imageIndex * 4) * 4);
    fs.writeFileSync(path.join(directory, name), PNG.sync.write(image));
  });
  const frames = renderCharacterPortraitFrames({ directory, style: "manga" });
  assert.deepEqual(Object.keys(frames), ["neutral", "blink", "mouthHalf", "mouthOpen"]);
  for (const frame of Object.values(frames)) assert.equal(frame.pixels.length, 15000);
  assert.notEqual(frames.neutral.revision, frames.blink.revision);
  assert.notEqual(frames.neutral.revision, frames.mouthOpen.revision);
});

test("every bundled character has four distinct dedicated RLCD 4.2 animation portraits", () => {
  for (const characterId of ["amber-avatar", "bronze-avatar", "nike-avatar", "sage-avatar", "towa-avatar"]) {
    const directory = path.join(ROOT, "assets", characterId);
    const settings = JSON.parse(fs.readFileSync(path.join(directory, "default-settings.json"), "utf8"));
    const frames = renderCharacterPortraitFrames({ directory, settings, style: "manga" });
    assert.equal(new Set(Object.values(frames).map((frame) => frame.revision)).size, 4, `${characterId} frames should be distinct`);
    for (const frame of Object.values(frames)) assert.equal(frame.algorithm, "selective-fill-v2-direct-ink");
  }
});

test("RLCD conversion rejects mismatched animation layers", () => {
  assert.throws(
    () => renderMonochromePortrait({ layers: [solidLayer(20, 20, [0, 0, 0, 255]), solidLayer(21, 20, [0, 0, 0, 255])] }),
    /大きさが一致しません/,
  );
});
