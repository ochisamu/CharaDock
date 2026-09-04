// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PNG } = require("pngjs");

const {
  createGeneratedCharacterRemovalPlan,
  generatedCharactersRoot,
  installPuruPuruCharacter,
  parsePuruPuruPackage,
  removeGeneratedCharacterDirectory,
  resolveGeneratedCharacterDirectory,
} = require("../lib/generated-character-store.cjs");

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, input] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(input);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    localParts.push(local, data);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralParts.length, 8);
  end.writeUInt16LE(centralParts.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function testPuruPuruPackage({ rlcd42 = false, partialRlcd42 = false } = {}) {
  const image = new PNG({ width: 4, height: 6 });
  image.data.fill(255);
  const png = PNG.sync.write(image);
  const avatar = {
    backHair: "avatar/back-hair.png",
    frontHair: "avatar/front-hair.png",
    eyesOpenMouthClosed: "avatar/eyes-open-mouth-closed.png",
    eyesOpenMouthHalf: "avatar/eyes-open-mouth-half.png",
    eyesOpenMouthOpen: "avatar/eyes-open-mouth-open.png",
    eyesClosedMouthClosed: "avatar/eyes-closed-mouth-closed.png",
    eyesClosedMouthHalf: "avatar/eyes-closed-mouth-half.png",
    eyesClosedMouthOpen: "avatar/eyes-closed-mouth-open.png",
  };
  const files = Object.fromEntries(Object.values(avatar).map((name) => [name, png]));
  files["thumbnail.png"] = png;
  files["manifest.json"] = JSON.stringify({ format: "purupuru-avatar-package", formatVersion: 1, characterName: "テスト", settings: "settings.json", thumbnail: "thumbnail.png", avatar });
  files["settings.json"] = JSON.stringify({ type: "purupuru-pngtuber-settings", version: 2, state: { avatarSize: 125, hairSpring: 60 } });
  if (rlcd42 || partialRlcd42) {
    const rlcdNames = [
      "rlcd42-portrait.png",
      "rlcd42-portrait-blink.png",
      "rlcd42-portrait-mouth-half.png",
      "rlcd42-portrait-mouth-open.png",
    ];
    for (let imageIndex = 0; imageIndex < (partialRlcd42 ? 1 : rlcdNames.length); imageIndex += 1) {
      const portrait = new PNG({ width: 400, height: 300 });
      portrait.data.fill(255);
      for (let y = 40; y < 260; y += 1) {
        for (let x = 56 + imageIndex * 3; x < 64 + imageIndex * 3; x += 1) {
          const pixel = (y * 400 + x) * 4;
          portrait.data[pixel] = 0;
          portrait.data[pixel + 1] = 0;
          portrait.data[pixel + 2] = 0;
        }
      }
      files[`rlcd42/${rlcdNames[imageIndex]}`] = PNG.sync.write(portrait);
    }
  }
  return storedZip(files);
}

test("generated character removal clears its record and per-character settings", () => {
  const userData = path.join(os.tmpdir(), "charadock-generated-store-plan");
  const assetDir = path.join(generatedCharactersRoot(userData), "user-avatar-1");
  const plan = createGeneratedCharacterRemovalPlan({
    characterId: "user-avatar-1",
    activeCharacterId: "user-avatar-1",
    fallbackCharacterId: "amber-avatar",
    userDataDirectory: userData,
    customCharacters: [
      { id: "user-avatar-1", generated: true, assetDir },
      { id: "user-avatar-2", generated: true, assetDir: path.join(generatedCharactersRoot(userData), "user-avatar-2") },
    ],
    characterProfiles: { "user-avatar-1": { name: "削除" }, "user-avatar-2": { name: "保持" } },
    characterTtsProfiles: { "user-avatar-1": { provider: "kokoro" }, "user-avatar-2": { provider: "system" } },
  });
  assert.equal(plan.wasActive, true);
  assert.equal(plan.patch.characterId, "amber-avatar");
  assert.deepEqual(plan.patch.customCharacters.map((item) => item.id), ["user-avatar-2"]);
  assert.deepEqual(Object.keys(plan.patch.characterProfiles), ["user-avatar-2"]);
  assert.deepEqual(Object.keys(plan.patch.characterTtsProfiles), ["user-avatar-2"]);
});

test("generated character deletion is restricted to one direct child of app storage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-generated-store-"));
  try {
    const userData = path.join(root, "user-data");
    const directory = path.join(generatedCharactersRoot(userData), "user-avatar-safe");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "avatar.png"), "test");
    removeGeneratedCharacterDirectory(userData, directory);
    assert.equal(fs.existsSync(directory), false);
    assert.throws(() => resolveGeneratedCharacterDirectory(userData, generatedCharactersRoot(userData)), /保存先が不正/);
    assert.throws(() => resolveGeneratedCharacterDirectory(userData, path.join(root, "outside")), /保存先が不正/);
    assert.throws(() => resolveGeneratedCharacterDirectory(userData, path.join(directory, "nested")), /保存先が不正/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".purupuru import validates and installs app-owned avatar files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-import-"));
  try {
    const packageBytes = testPuruPuruPackage();
    const parsed = parsePuruPuruPackage(packageBytes);
    assert.deepEqual(parsed.imageSize, { width: 4, height: 6 });
    const character = installPuruPuruCharacter({ bytes: packageBytes, fileName: "sample.purupuru", userDataDirectory: root });
    assert.equal(character.name, "テスト");
    assert.equal(character.imported, true);
    assert.equal(character.motion.avatarSize, 125);
    assert.equal(character.motion.hairSpring, 60);
    assert.equal(fs.existsSync(path.join(character.assetDir, "eyes-open-mouth-half.png")), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(character.assetDir, "default-settings.json"), "utf8")).type, "purupuru-pngtuber-settings");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".purupuru import preserves a complete dedicated RLCD 4.2 animation set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-import-rlcd42-"));
  try {
    const packageBytes = testPuruPuruPackage({ rlcd42: true });
    const parsed = parsePuruPuruPackage(packageBytes);
    assert.deepEqual(Object.keys(parsed.rlcd42), ["neutral", "blink", "mouthHalf", "mouthOpen"]);
    const character = installPuruPuruCharacter({ bytes: packageBytes, fileName: "rlcd.purupuru", userDataDirectory: root });
    for (const name of ["rlcd42-portrait.png", "rlcd42-portrait-blink.png", "rlcd42-portrait-mouth-half.png", "rlcd42-portrait-mouth-open.png"]) {
      assert.equal(fs.existsSync(path.join(character.assetDir, name)), true, `${name} should be installed`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(".purupuru import rejects a partial RLCD 4.2 animation set", () => {
  assert.throws(() => parsePuruPuruPackage(testPuruPuruPackage({ partialRlcd42: true })), /表情画像が不足/);
});

test(".purupuru import rejects traversal paths before writing", () => {
  assert.throws(() => parsePuruPuruPackage(storedZip({ "../manifest.json": "{}" })), /パスが不正/);
});

test("bundled and unknown characters cannot be removed", () => {
  assert.throws(() => createGeneratedCharacterRemovalPlan({
    characterId: "amber-avatar",
    activeCharacterId: "amber-avatar",
    fallbackCharacterId: "amber-avatar",
    userDataDirectory: os.tmpdir(),
    customCharacters: [],
  }), /追加したキャラクターだけ/);
});
