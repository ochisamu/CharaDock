// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");

const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 120 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_IMAGE_PIXELS = 16_777_216;
const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIG = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIG = 0x06054b50;
const AVATAR_FILES = Object.freeze({
  backHair: "back-hair.png",
  frontHair: "front-hair.png",
  eyesOpenMouthClosed: "eyes-open-mouth-closed.png",
  eyesOpenMouthHalf: "eyes-open-mouth-half.png",
  eyesOpenMouthOpen: "eyes-open-mouth-open.png",
  eyesClosedMouthClosed: "eyes-closed-mouth-closed.png",
  eyesClosedMouthHalf: "eyes-closed-mouth-half.png",
  eyesClosedMouthOpen: "eyes-closed-mouth-open.png",
});
const RLCD42_FILES = Object.freeze({
  neutral: "rlcd42-portrait.png",
  blink: "rlcd42-portrait-blink.png",
  mouthHalf: "rlcd42-portrait-mouth-half.png",
  mouthOpen: "rlcd42-portrait-mouth-open.png",
});

let crc32Table;

function crc32(bytes) {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crc32Table[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function assertSafePackagePath(value) {
  const candidate = String(value || "");
  if (!candidate || candidate.startsWith("/") || candidate.includes("\\") || candidate.includes(":") || candidate.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`.purupuru内のパスが不正です: ${candidate}`);
  }
  return candidate;
}

function findZipEnd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIG) return offset;
  }
  return -1;
}

function readStoredZip(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (bytes.length < 22 || bytes.length > MAX_PACKAGE_BYTES) throw new Error(".purupuruは80MB以下にしてください。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findZipEnd(bytes);
  if (endOffset < 0) throw new Error(".purupuruのZIP終端情報がありません。");
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error(".purupuru内のファイル数が多すぎます。");
  if (centralOffset + centralSize > bytes.length || centralOffset >= endOffset) throw new Error(".purupuruのZIP目次が壊れています。");
  const entries = new Map();
  let totalBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_SIG) throw new Error(".purupuruのZIP目次が壊れています。");
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > bytes.length) throw new Error(".purupuru内のファイル名が壊れています。");
    const entryPath = assertSafePackagePath(bytes.subarray(cursor + 46, nameEnd).toString("utf8"));
    if (entries.has(entryPath)) throw new Error(`.purupuru内のパスが重複しています: ${entryPath}`);
    if (method !== 0 || compressedSize !== uncompressedSize) throw new Error("圧縮ZIPには未対応です。PuruPuruから書き出したファイルを選んでください。");
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIG) throw new Error(".purupuruのZIPデータ位置が壊れています。");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error(".purupuru内のデータが途中で切れています。");
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_UNZIPPED_BYTES) throw new Error(".purupuruの展開後サイズが大きすぎます。");
    const data = Buffer.from(bytes.subarray(dataStart, dataEnd));
    if (crc32(data) !== expectedCrc) throw new Error(`.purupuru内のCRCが一致しません: ${entryPath}`);
    entries.set(entryPath, data);
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function parseJsonEntry(entries, entryPath, maximumBytes) {
  const bytes = entries.get(entryPath);
  if (!bytes) throw new Error(`${entryPath}がありません。`);
  if (bytes.length > maximumBytes) throw new Error(`${entryPath}が大きすぎます。`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${entryPath}のJSONが壊れています。`);
  }
}

function validatePng(bytes, label, expectedSize = null) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`${label}はPNGではありません。`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) throw new Error(`${label}の画像サイズが大きすぎます。`);
  if (expectedSize && (width !== expectedSize.width || height !== expectedSize.height)) throw new Error(`${label}の画像サイズが他の表情と一致しません。`);
  try {
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    if (decoded.width !== width || decoded.height !== height) throw new Error("size mismatch");
  } catch {
    throw new Error(`${label}のPNGデータが壊れています。`);
  }
  return { width, height };
}

function validateRlcd42PortraitSet(images, { required = false } = {}) {
  const present = Object.entries(RLCD42_FILES).filter(([key]) => Buffer.isBuffer(images?.[key]));
  if (!present.length && !required) return null;
  const missing = Object.entries(RLCD42_FILES).filter(([key]) => !Buffer.isBuffer(images?.[key])).map(([, name]) => name);
  if (missing.length) throw new Error(`RLCD 4.2表情画像が不足しています: ${missing.join(", ")}`);
  let imageSize = null;
  const hashes = new Set();
  for (const [key, outputName] of Object.entries(RLCD42_FILES)) {
    const bytes = images[key];
    imageSize = validatePng(bytes, outputName, imageSize);
    const aspect = imageSize.width / imageSize.height;
    if (imageSize.width < 400 || imageSize.height < 300 || Math.abs(aspect - (4 / 3)) > 0.01) {
      throw new Error(`${outputName}は400x300以上の4:3画像にしてください。`);
    }
    const png = PNG.sync.read(bytes, { checkCRC: true });
    let dark = 0;
    let light = 0;
    let opaque = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      const luminance = png.data[index] * .2126 + png.data[index + 1] * .7152 + png.data[index + 2] * .0722;
      if (luminance < 96) dark += 1;
      if (luminance > 224) light += 1;
      if (png.data[index + 3] > 240) opaque += 1;
    }
    const pixels = png.width * png.height;
    if (dark / pixels < .005 || dark / pixels > .4 || light / pixels < .65 || opaque / pixels < .9) {
      throw new Error(`${outputName}は不透明な白地に、読みやすい黒輪郭と選択的な漫画インクで描いてください。`);
    }
    hashes.add(crypto.createHash("sha256").update(bytes).digest("hex"));
  }
  if (hashes.size !== Object.keys(RLCD42_FILES).length) {
    throw new Error("RLCD 4.2の通常・瞬き・口差分は、それぞれ異なる画像にしてください。");
  }
  return { imageSize };
}

function rlcd42PackageImages(entries, manifest) {
  const configured = manifest.rlcd42 && typeof manifest.rlcd42 === "object" ? manifest.rlcd42 : null;
  if (configured) {
    const result = {};
    for (const [key, outputName] of Object.entries(RLCD42_FILES)) {
      const configuredPath = configured?.[key];
      if (configuredPath) result[key] = entries.get(assertSafePackagePath(configuredPath));
    }
    validateRlcd42PortraitSet(result, { required: true });
    return result;
  }
  for (const prefix of ["rlcd42/", ""]) {
    const result = {};
    let found = 0;
    for (const [key, outputName] of Object.entries(RLCD42_FILES)) {
      const bytes = entries.get(`${prefix}${outputName}`);
      if (!bytes) continue;
      result[key] = bytes;
      found += 1;
    }
    if (!found) continue;
    validateRlcd42PortraitSet(result, { required: true });
    return result;
  }
  return null;
}

function parsePuruPuruPackage(input) {
  const entries = readStoredZip(input);
  const manifest = parseJsonEntry(entries, "manifest.json", 128 * 1024);
  if (manifest?.format !== "purupuru-avatar-package" || Number(manifest.formatVersion) !== 1) throw new Error("対応している.purupuru形式ではありません。");
  const settingsPath = assertSafePackagePath(manifest.settings || "settings.json");
  const settings = parseJsonEntry(entries, settingsPath, 2 * 1024 * 1024);
  if (settings?.type !== "purupuru-pngtuber-settings") throw new Error("PuruPuru設定ファイルではありません。");
  const avatar = {};
  let imageSize = null;
  for (const [key, outputName] of Object.entries(AVATAR_FILES)) {
    const entryPath = assertSafePackagePath(manifest.avatar?.[key] || `avatar/${outputName}`);
    const bytes = entries.get(entryPath);
    if (!bytes) throw new Error(`キャラ画像が不足しています: ${entryPath}`);
    imageSize = validatePng(bytes, entryPath, imageSize);
    avatar[key] = bytes;
  }
  let thumbnail = avatar.eyesOpenMouthClosed;
  if (manifest.thumbnail) {
    const candidate = entries.get(assertSafePackagePath(manifest.thumbnail));
    if (candidate) {
      validatePng(candidate, "thumbnail.png");
      thumbnail = candidate;
    }
  }
  const rlcd42 = rlcd42PackageImages(entries, manifest);
  const hydratedSettings = structuredClone(settings);
  hydratedSettings.avatarImageSize = imageSize;
  if (Array.isArray(hydratedSettings.itemLayers)) {
    hydratedSettings.itemLayers = hydratedSettings.itemLayers.slice(0, 32).map((layer) => {
      if (!layer?.file) return layer;
      const itemPath = assertSafePackagePath(layer.file);
      const item = entries.get(itemPath);
      if (!item) return { ...layer, src: null, visible: false };
      validatePng(item, itemPath);
      return { ...layer, src: `data:image/png;base64,${item.toString("base64")}` };
    });
  }
  return { manifest, settings: hydratedSettings, avatar, thumbnail, imageSize, rlcd42 };
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function installPuruPuruCharacter({ bytes, fileName, userDataDirectory }) {
  const parsed = parsePuruPuruPackage(bytes);
  const id = `user-avatar-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const root = generatedCharactersRoot(userDataDirectory);
  const staging = path.join(root, `.import-${id}`);
  const destination = path.join(root, id);
  const packageName = String(parsed.manifest.characterName || fileName || "読み込みキャラ").replace(/\.purupuru$/i, "").trim().slice(0, 40) || "読み込みキャラ";
  const state = parsed.settings.state && typeof parsed.settings.state === "object" ? parsed.settings.state : {};
  const personality = "親しみやすく自然な口調で、ユーザーの意図をくみ取りながら簡潔に会話する。";
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const [key, outputName] of Object.entries(AVATAR_FILES)) fs.writeFileSync(path.join(staging, outputName), parsed.avatar[key]);
    if (parsed.rlcd42) {
      for (const [key, outputName] of Object.entries(RLCD42_FILES)) fs.writeFileSync(path.join(staging, outputName), parsed.rlcd42[key]);
    }
    fs.writeFileSync(path.join(staging, "thumbnail.png"), parsed.thumbnail);
    fs.writeFileSync(path.join(staging, "default-settings.json"), `${JSON.stringify(parsed.settings, null, 2)}\n`);
    fs.writeFileSync(path.join(staging, "character.json"), `${JSON.stringify({ schemaVersion: 1, name: packageName, personality, source: "purupuru-import" }, null, 2)}\n`);
    fs.renameSync(staging, destination);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    id,
    name: packageName,
    assetDir: destination,
    generated: true,
    imported: true,
    personality,
    petPhrases: ["なあに？", "ここにいるよ。", "一緒にやってみよう。"],
    ui: { bubbleLeft: 18, bubbleTop: 24, bubbleWidth: 68, petLeft: 0, petTop: 25, petWidth: 58, petHeight: 48 },
    motion: {
      avatarSize: clampNumber(state.avatarSize, 100, 30, 300),
      rangeLeft: clampNumber(state.rangeLeft, 60, 0, 300),
      rangeRight: clampNumber(state.rangeRight, 60, 0, 300),
      rangeUp: clampNumber(state.rangeUp, 30, 0, 300),
      rangeDown: clampNumber(state.rangeDown, 30, 0, 300),
      followSpeed: clampNumber(state.followSpeed, 25, 4, 100),
      breathStrength: clampNumber(state.breathStrength, 40, 0, 100),
      rollStrength: clampNumber(state.rollStrength, 8, 0, 100),
      pyokoStrength: clampNumber(state.pyokoStrength, 12, 0, 100),
      hairSpring: clampNumber(state.hairSpring, 40, 0, 200),
      hairWarp: clampNumber(state.hairWarp, 38, 0, 100),
    },
  };
}

function generatedCharactersRoot(userDataDirectory) {
  return path.resolve(String(userDataDirectory || ""), "generated-characters");
}

function resolveGeneratedCharacterDirectory(userDataDirectory, assetDirectory) {
  const root = generatedCharactersRoot(userDataDirectory);
  const resolved = path.resolve(String(assetDirectory || ""));
  if (resolved === root || path.dirname(resolved) !== root) {
    throw new Error("生成キャラクターの保存先が不正です。");
  }
  return resolved;
}

function omitKey(record, key) {
  const next = { ...(record || {}) };
  delete next[key];
  return next;
}

function createGeneratedCharacterRemovalPlan({
  characterId,
  activeCharacterId,
  customCharacters,
  characterProfiles,
  characterTtsProfiles,
  fallbackCharacterId,
  userDataDirectory,
}) {
  const id = String(characterId || "");
  const characters = Array.isArray(customCharacters) ? customCharacters : [];
  const character = characters.find((item) => item?.id === id);
  if (!character?.generated) throw new Error("追加したキャラクターだけ削除できます。");
  const directory = resolveGeneratedCharacterDirectory(userDataDirectory, character.assetDir);
  return {
    character,
    directory,
    wasActive: id === activeCharacterId,
    patch: {
      customCharacters: characters.filter((item) => item?.id !== id),
      characterProfiles: omitKey(characterProfiles, id),
      characterTtsProfiles: omitKey(characterTtsProfiles, id),
      characterId: id === activeCharacterId ? fallbackCharacterId : activeCharacterId,
    },
  };
}

function removeGeneratedCharacterDirectory(userDataDirectory, directory) {
  const safeDirectory = resolveGeneratedCharacterDirectory(userDataDirectory, directory);
  fs.rmSync(safeDirectory, { recursive: true, force: true });
  if (fs.existsSync(safeDirectory)) throw new Error("キャラクターの保存ファイルを削除できませんでした。");
}

module.exports = {
  RLCD42_FILES,
  createGeneratedCharacterRemovalPlan,
  generatedCharactersRoot,
  installPuruPuruCharacter,
  parsePuruPuruPackage,
  removeGeneratedCharacterDirectory,
  resolveGeneratedCharacterDirectory,
  validateRlcd42PortraitSet,
};
