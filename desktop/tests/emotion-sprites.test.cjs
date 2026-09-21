// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { PNG } = require("pngjs");
const { OPTIONAL_AVATAR_IMAGE_FILES, validateEmotionSprites, emotionRig } = require("../lib/emotion-sprites.cjs");
const { composeEmotions } = require("../../.agents/skills/build-purupuru-avatar/scripts/compose-emotions.cjs");
const ROOT = path.resolve(__dirname, "../..");

test("copied skill composes and validates required emotions without desktop files", (t) => {
  const f = fixture(t);
  const skill = path.join(f.directory, ".agents/skills/build-purupuru-avatar");
  fs.cpSync(path.join(ROOT, ".agents/skills/build-purupuru-avatar"), skill, { recursive: true });
  fs.mkdirSync(path.join(f.directory, "node_modules"));
  fs.cpSync(path.dirname(require.resolve("pngjs/package.json")), path.join(f.directory, "node_modules/pngjs"), { recursive: true });
  fs.writeFileSync(path.join(f.directory, "character.json"), JSON.stringify(f.metadata));
  const result = spawnSync(process.execPath, [path.join(skill, "scripts/compose-emotions.cjs"),
    "--output", f.directory, "--happy", f.editPath, "--thinking", f.editPath, "--surprised", f.editPath],
  { cwd: f.directory, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).files.length, 9);
  const script = `
    const fs = require('fs');
    const { OPTIONAL_AVATAR_IMAGE_FILES, validateEmotionSprites } = require('./.agents/skills/build-purupuru-avatar/scripts/emotion-sprites.cjs');
    const { validateAvatarOutput } = require('./.agents/skills/build-purupuru-avatar/scripts/validate-output.cjs');
    const avatar = {};
    for (const mouth of ['Closed', 'Half', 'Open']) avatar['eyesOpenMouth' + mouth] = fs.readFileSync('eyes-open-mouth-' + mouth.toLowerCase() + '.png');
    for (const [key, filename] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) if (fs.existsSync(filename)) avatar[key] = fs.readFileSync(filename);
    validateEmotionSprites(avatar, { strict: true, required: true });
    const preview = require('./.agents/skills/build-purupuru-avatar/scripts/preview-emotions.cjs').previewEmotions(process.cwd());
    const sheet = require('pngjs').PNG.sync.read(fs.readFileSync(preview));
    require('assert').equal(sheet.width, 1260);
    require('assert').equal(sheet.height, 1260);
    delete avatar.emotionThinkingMouthOpen;
    require('assert').throws(() => validateEmotionSprites(avatar, { required: true }), /Incomplete/);
    require('assert').equal(typeof validateAvatarOutput, 'function');
  `;
  const validation = spawnSync(process.execPath, ["-e", script], { cwd: f.directory, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(fs.existsSync(path.join(f.directory, "desktop")), false);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "emotion-sprites-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const avatar = {};
  for (const [m, mouth] of ["closed", "half", "open"].entries()) {
    const frame = new PNG({ width: 128, height: 128 });
    frame.data.fill(255);
    frame.data[(100 * 128 + 64) * 4] = m * 50;
    const bytes = PNG.sync.write(frame);
    avatar[`eyesOpenMouth${mouth[0].toUpperCase() + mouth.slice(1)}`] = bytes;
    fs.writeFileSync(path.join(directory, `eyes-open-mouth-${mouth}.png`), bytes);
  }
  const edit = PNG.sync.read(avatar.eyesOpenMouthClosed);
  for (let y = 48; y < 55; y++) for (let x = 38; x < 45; x++) edit.data[(y * 128 + x) * 4] = 70;
  // An imagegen master can accidentally change the mouth: it must be excluded.
  edit.data[(100 * 128 + 64) * 4] = 190;
  const editPath = path.join(directory, "master.png");
  fs.writeFileSync(editPath, PNG.sync.write(edit));
  return { directory, avatar, editPath, metadata: { rig: { eyeCenters: [[40, 50], [85, 50]] } } };
}

test("composer preserves audio mouth pixels and alpha, supports settings metadata", (t) => {
  const f = fixture(t);
  const names = composeEmotions({ ...f, metadata: { faceDepthSetup: { anchors: { leftEye: { x: 40, y: 50 }, rightEye: { x: 85, y: 50 } } } }, edits: { happy: f.editPath, thinking: f.editPath, surprised: f.editPath } });
  assert.equal(names.length, 9);
  for (const [key, name] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) {
    if (fs.existsSync(path.join(f.directory, name))) f.avatar[key] = fs.readFileSync(path.join(f.directory, name));
  }
  assert.equal(validateEmotionSprites(f.avatar, { strict: true, required: true }), true);
  assert.equal(PNG.sync.read(f.avatar.emotionThinkingMouthOpen).data[(100 * 128 + 64) * 4], 100);
  assert.equal(fs.readFileSync(path.join(f.directory, "eyes-open-mouth-closed.png")).equals(f.avatar.eyesOpenMouthClosed), true);
});

test("missing assets remain optional; partial and duplicate triplets fail", (t) => {
  const f = fixture(t);
  assert.equal(validateEmotionSprites(f.avatar), true);
  assert.throws(() => validateEmotionSprites(f.avatar, { required: true }), /Incomplete/);
  f.avatar.emotionHappyMouthClosed = f.avatar.eyesOpenMouthClosed;
  assert.throws(() => validateEmotionSprites(f.avatar), /Incomplete/);
  f.avatar.emotionHappyMouthHalf = f.avatar.eyesOpenMouthClosed;
  f.avatar.emotionHappyMouthOpen = f.avatar.eyesOpenMouthClosed;
  assert.throws(() => validateEmotionSprites(f.avatar), /distinct/);
});

test("legacy mouth frames with eye drift still receive emotions without changing mouths", (t) => {
  const f = fixture(t);
  f.metadata.rig.mouthCenter = [64, 100];
  const half = PNG.sync.read(f.avatar.eyesOpenMouthHalf);
  half.data[(50 * 128 + 40) * 4] = 80;
  half.data[(50 * 128 + 40) * 4 + 3] = 254;
  f.avatar.eyesOpenMouthHalf = PNG.sync.write(half);
  fs.writeFileSync(path.join(f.directory, "eyes-open-mouth-half.png"), f.avatar.eyesOpenMouthHalf);
  composeEmotions({ ...f, edits: { happy: f.editPath } });
  for (const [key, name] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) {
    if (fs.existsSync(path.join(f.directory, name))) f.avatar[key] = fs.readFileSync(path.join(f.directory, name));
  }
  assert.equal(validateEmotionSprites(f.avatar, { strict: true, rig: f.metadata.rig }), true);
  assert.equal(PNG.sync.read(f.avatar.emotionHappyMouthHalf).data[(50 * 128 + 40) * 4], 70);
  assert.equal(PNG.sync.read(f.avatar.emotionHappyMouthHalf).data[(50 * 128 + 40) * 4 + 3], 254);
  assert.equal(PNG.sync.read(f.avatar.emotionHappyMouthHalf).data[(100 * 128 + 64) * 4], 50);
});

test("strict validation rejects mouth freezes, alpha changes and wrong canvas", (t) => {
  const f = fixture(t);
  composeEmotions({ ...f, edits: { happy: f.editPath } });
  for (const [key, name] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) {
    if (fs.existsSync(path.join(f.directory, name))) f.avatar[key] = fs.readFileSync(path.join(f.directory, name));
  }
  const original = f.avatar.emotionHappyMouthOpen;
  const frame = PNG.sync.read(original);
  frame.data[(100 * 128 + 64) * 4] = 190;
  f.avatar.emotionHappyMouthOpen = PNG.sync.write(frame);
  assert.throws(() => validateEmotionSprites(f.avatar, { strict: true }), /drift/);
  frame.data[(100 * 128 + 64) * 4] = 100;
  frame.data[3] = 0;
  f.avatar.emotionHappyMouthOpen = PNG.sync.write(frame);
  assert.throws(() => validateEmotionSprites(f.avatar, { strict: true }), /alpha/);
  f.avatar.emotionHappyMouthOpen = PNG.sync.write(new PNG({ width: 64, height: 64 }));
  assert.throws(() => validateEmotionSprites(f.avatar), /canvas/);
});

test("authored mouth opt-in remains bounded and preserves alpha", (t) => {
  const f = fixture(t);
  composeEmotions({ ...f, edits: { proud: f.editPath } });
  for (const mouth of ['Closed', 'Half', 'Open']) f.avatar['emotionProudMouth'+mouth] = fs.readFileSync(path.join(f.directory, 'emotion-proud-mouth-'+mouth.toLowerCase()+'.png'));
  const frame = PNG.sync.read(f.avatar.emotionProudMouthOpen);
  frame.data[(100*128+64)*4] = 180;
  f.avatar.emotionProudMouthOpen = PNG.sync.write(frame);
  const rig = { eyeCenters: [[40,50],[85,50]], mouthCenter: [64,100], articulatedMouthEmotions: ['proud'] };
  assert.throws(() => validateEmotionSprites(f.avatar, {strict:true}), /drift/);
  assert.equal(validateEmotionSprites(f.avatar, {strict:true,rig}), true);
  frame.data[0] = 120;
  f.avatar.emotionProudMouthOpen = PNG.sync.write(frame);
  assert.throws(() => validateEmotionSprites(f.avatar, {strict:true,rig}), /drift/);
  frame.data[0] = 255;
  frame.data[(100*128+64)*4+3] = 200;
  f.avatar.emotionProudMouthOpen = PNG.sync.write(frame);
  assert.throws(() => validateEmotionSprites(f.avatar, {strict:true,rig}), /alpha/);
});

test("renderer keeps audio mouth selection, blink priority and missing-sprite fallback", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const body = source.match(/  function expressionKeyForMouth\([\s\S]*?\n  }/)[0];
  const context = { blinkClosed: false, obsExternalInput: { emotion: "thinking" }, images: { emotionThinkingMouthOpen: {} } };
  vm.createContext(context);
  vm.runInContext(body, context);
  assert.equal(context.expressionKeyForMouth(2), "emotionThinkingMouthOpen");
  assert.equal(context.expressionKeyForMouth(1), "eyesOpenMouthHalf");
  assert.equal(context.expressionKeyForMouth(2, true), "eyesClosedMouthOpen");
  context.obsExternalInput.emotion = null;
  assert.equal(context.expressionKeyForMouth(2), "eyesOpenMouthOpen");
});

test("all five shipped default settings supply canonical eye centers", () => {
  for (const name of ["amber", "bronze", "towa", "sage", "nike"]) {
    const directory = path.join(ROOT, "assets", `${name}-avatar`);
    const settings = JSON.parse(fs.readFileSync(path.join(directory, "default-settings.json")));
    const bytes = fs.readFileSync(path.join(directory, "eyes-open-mouth-closed.png"));
    for (const key of ["leftEye", "rightEye"]) {
      const { x, y } = settings.faceDepthSetup.anchors[key];
      assert.ok(x > 0 && x < bytes.readUInt32BE(16));
      assert.ok(y > 0 && y < bytes.readUInt32BE(20));
    }
  }
});

test("all five shipped defaults contain complete registered happy/thinking/surprised speech sets", () => {
  for (const name of ["amber", "bronze", "towa", "sage", "nike"]) {
    const directory = path.join(ROOT, "assets", `${name}-avatar`);
    const avatar = {};
    for (const mouth of ["Closed", "Half", "Open"]) {
      avatar[`eyesOpenMouth${mouth}`] = fs.readFileSync(path.join(directory, `eyes-open-mouth-${mouth.toLowerCase()}.png`));
    }
    // Legacy soft artwork is outside the new generated emotion contract.
    for (const [key, filename] of Object.entries(OPTIONAL_AVATAR_IMAGE_FILES)) {
      if (/^emotion(Happy|Thinking|Surprised)/.test(key)) avatar[key] = fs.readFileSync(path.join(directory, filename));
    }
    const settings = JSON.parse(fs.readFileSync(path.join(directory, "default-settings.json")));
    assert.equal(validateEmotionSprites(avatar, { strict: true, required: true, rig: emotionRig(settings) }), true, name);
  }
});

test("switching characters clears the previous optional emotion sprites", () => {
  const source = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const body = source.match(/  function applyLoadedAvatarImages\([\s\S]*?\n  }/)[0];
  const context = {
    images: { emotionThinkingMouthOpen: { old: true } },
    OPTIONAL_AVATAR_EXPRESSION_ASSETS: OPTIONAL_AVATAR_IMAGE_FILES,
    validateAvatarImageSetDimensions: () => ({ w: 128, h: 128 }),
    setAvatarImageSize() {}, clearHairTintCache() {}, resetMeshRendererAfterAvatarImageChange() {}, setStatus() {},
    avatarPackageImageVersion: 0, imagesReady: false, loadError: "",
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  context.applyLoadedAvatarImages({ eyesOpenMouthClosed: {} });
  assert.equal(context.images.emotionThinkingMouthOpen, undefined);
  context.applyLoadedAvatarImages({ emotionThinkingMouthOpen: { current: true } });
  assert.equal(context.images.emotionThinkingMouthOpen.current, true);
});
