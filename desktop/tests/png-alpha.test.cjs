// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PNG } = require("pngjs");
const { cleanAvatarAlpha, despillAvatarEdges } = require("../lib/png-alpha.cjs");

test("avatar alpha cleanup removes generated background matte", () => {
  const png = new PNG({ width: 3, height: 1 });
  png.data.set([
    20, 40, 30, 57,
    180, 120, 90, 191,
    220, 180, 140, 255,
  ]);

  const result = cleanAvatarAlpha(png);

  assert.deepEqual([...png.data.subarray(0, 4)], [0, 0, 0, 0]);
  assert.equal(png.data[7], 128);
  assert.equal(png.data[11], 255);
  assert.deepEqual(result, { cleared: 1, remapped: 1, transparentCutoff: 127 });
});

test("avatar alpha cleanup removes green spill only at transparent edges", () => {
  const png = new PNG({ width: 3, height: 1 });
  png.data.set([
    0, 0, 0, 0,
    20, 110, 10, 255,
    20, 110, 10, 255,
  ]);

  const result = despillAvatarEdges(png, 1);

  assert.equal(png.data[5], 24);
  assert.equal(png.data[9], 110);
  assert.deepEqual(result, { corrected: 1, radius: 1 });
});

test("bundled desktop avatars have fully transparent background corners", () => {
  const projectRoot = path.resolve(__dirname, "../..");
  for (const directory of ["amber-avatar", "bronze-avatar", "towa-avatar", "sage-avatar", "nike-avatar"]) {
    const assetDirectory = path.join(projectRoot, "assets", directory);
    for (const name of fs.readdirSync(assetDirectory).filter((entry) => entry.endsWith(".png"))) {
      const png = PNG.sync.read(fs.readFileSync(path.join(assetDirectory, name)));
      for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1]]) {
        assert.equal(png.data[((y * png.width) + x) * 4 + 3], 0, `${directory}/${name}@${x},${y}`);
      }
    }
  }
});
