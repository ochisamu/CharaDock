// SPDX-License-Identifier: Apache-2.0
// Kept inside the portable skill; desktop imports this same implementation.
const { PNG } = require("pngjs");
const EMOTIONS = Object.freeze(["happy", "thinking", "surprised", "soft", "joy", "worried", "proud", "exasperated"]);
const MOUTHS = Object.freeze(["closed", "half", "open"]);
const capitalize = (value) => value[0].toUpperCase() + value.slice(1);
const OPTIONAL_AVATAR_IMAGE_FILES = Object.freeze(Object.fromEntries(EMOTIONS.flatMap((emotion) =>
  MOUTHS.map((mouth) => [`emotion${capitalize(emotion)}Mouth${capitalize(mouth)}`, `emotion-${emotion}-mouth-${mouth}.png`]))));

// Legacy packages may omit emotions. Each supplied emotion is a complete mouth
// triplet. Generation additionally checks exact registration and mouth ownership.
function validateEmotionSprites(avatar, { strict = false, required = false, rig = null } = {}) {
  const decoded = new Map();
  const read = (key) => {
    if (!decoded.has(key)) {
      const bytes = avatar[key];
      if (!Buffer.isBuffer(bytes) || bytes.length < 24) throw new Error(`Missing emotion sprite: ${key}`);
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 4096 || height > 4096) throw new Error(`Invalid emotion sprite size: ${key}`);
      decoded.set(key, PNG.sync.read(bytes, { checkCRC: true }));
    }
    return decoded.get(key);
  };
  for (const emotion of EMOTIONS) {
    const keys = MOUTHS.map((mouth) => `emotion${capitalize(emotion)}Mouth${capitalize(mouth)}`);
    if (!keys.some((key) => avatar[key]) && !(required && ["happy", "thinking", "surprised"].includes(emotion))) continue;
    if (!keys.every((key) => avatar[key])) throw new Error(`Incomplete ${emotion} emotion mouth triplet`);
    const frames = keys.map(read);
    const bases = MOUTHS.map((mouth) => read(`eyesOpenMouth${capitalize(mouth)}`));
    const base = bases[0];
    for (const frame of [...frames, ...bases]) {
      if (frame.width !== base.width || frame.height !== base.height) throw new Error(`${emotion} sprite canvas mismatch`);
    }
    if (frames.some((frame, i) => frames.slice(i + 1).some((other) => frame.data.equals(other.data)))) {
      throw new Error(`${emotion} mouth sprites must be distinct`);
    }
    if (!strict) continue;
    let changed = 0;
    for (let i = 0; i < base.data.length; i += 4) {
      const pixel = i / 4;
      const canReplaceEyeDifference = isEmotionEyePixel(rig, pixel % base.width, Math.floor(pixel / base.width));
      const emotionChanged = frames[0].data.subarray(i, i + 4).some((v, c) => v !== base.data[i + c]);
      const articulatedMouth = Array.isArray(rig?.articulatedMouthEmotions)
        && rig.articulatedMouthEmotions.includes(emotion)
        && isArticulatedMouthPixel(rig, pixel % base.width, Math.floor(pixel / base.width));
      if (emotionChanged) changed += 1;
      for (let m = 0; m < 3; m += 1) {
        if (frames[m].data[i + 3] !== bases[m].data[i + 3]) throw new Error(`${emotion} changes silhouette/alpha`);
        // Explicitly authored speech triplets may own this small mouth region,
        // but never the silhouette, eyes, nose or the rest of the face.
        if (articulatedMouth) continue;
        for (let c = 0; c < 4; c += 1) {
          // An emotion edit must never overwrite any audio mouth difference.
          if (emotionChanged && !canReplaceEyeDifference && bases[m].data[i + c] !== base.data[i + c]) throw new Error(`${emotion} overlaps audio-owned mouth pixels`);
          const expected = emotionChanged && c !== 3 ? frames[0].data[i + c] : bases[m].data[i + c];
          if (frames[m].data[i + c] !== expected) throw new Error(`${emotion} mouth/registration drift`);
        }
      }
    }
    if (changed < 4 || changed / (base.width * base.height) > .12) throw new Error(`${emotion} must visibly change a localized expression`);
  }
  return true;
}

function emotionRig(metadata) {
  if (metadata?.rig) return metadata.rig;
  const a = metadata?.faceDepthSetup?.anchors;
  return a ? { eyeCenters: [a.leftEye, a.rightEye].map((p) => [p?.x, p?.y]), mouthCenter: [a.mouth?.x, a.mouth?.y] } : null;
}

function isArticulatedMouthPixel(rig, x, y) {
  if (!rig?.mouthCenter?.every(Number.isFinite) || rig.mouthCenter.length !== 2 ||
      !rig.eyeCenters?.every(p => p?.length === 2 && p.every(Number.isFinite)) || rig.eyeCenters.length !== 2) return false;
  const d = Math.hypot(rig.eyeCenters[1][0]-rig.eyeCenters[0][0],rig.eyeCenters[1][1]-rig.eyeCenters[0][1]);
  return d >= 20 && ((x-rig.mouthCenter[0])/(d*.42))**2 + ((y-rig.mouthCenter[1])/(d*.28))**2 < 1;
}

function isEmotionEyePixel(rig, x, y) {
  if (!rig?.eyeCenters?.every((p) => p?.length === 2 && p.every(Number.isFinite)) || rig.eyeCenters.length !== 2 ||
      !rig.mouthCenter?.every(Number.isFinite) || rig.mouthCenter.length !== 2) return false;
  const d = Math.hypot(rig.eyeCenters[1][0] - rig.eyeCenters[0][0], rig.eyeCenters[1][1] - rig.eyeCenters[0][1]);
  if (d < 20) return false;
  // Mouth exclusion uses the same region as the canonical speech composer.
  if (((x - rig.mouthCenter[0]) / (d * .62)) ** 2 + ((y - rig.mouthCenter[1]) / (d * .42)) ** 2 < 1) return false;
  return rig.eyeCenters.some(([ex, ey]) => ((x - ex) / (d * .52)) ** 2 + ((y - ey + d * .1) / (d * .48)) ** 2 < 1);
}

module.exports = { EMOTIONS, MOUTHS, OPTIONAL_AVATAR_IMAGE_FILES, validateEmotionSprites, emotionRig, isEmotionEyePixel };
