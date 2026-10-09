// SPDX-License-Identifier: Apache-2.0
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateManifest } = require('../../drawn-pose-runtime.js');

function kohakuPackage(projectRoot) {
  const directory = path.join(projectRoot, 'assets/amber-avatar/authored-motion');
  const manifestBody = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBody);
  validateManifest(manifest);
  // Only the current renderer's 20 drawings, not the retired optical-flow pack.
  const files = new Set([manifest.poses.neutral.hair, ...Object.values(manifest.poses.neutral.variants),
    manifest.cels.mask, ...Object.values(manifest.cels.sequences).flatMap(seq => seq.frames)]);
  const root = fs.realpathSync(directory);
  const resolve = file => {
    if (!files.has(file)) return null;
    const target = fs.realpathSync(path.join(directory, file));
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid authored asset');
    return target;
  };
  const hash = createHash('sha256').update(manifestBody);
  for (const file of files) hash.update(`${file}:${fs.statSync(resolve(file)).mtimeMs}`);
  return { version: hash.digest('hex').slice(0, 16), files, read(file) {
    if (file === 'manifest.json') return { body: manifestBody, contentType: 'application/json; charset=utf-8' };
    const target = resolve(file);
    return target ? { body: fs.readFileSync(target), contentType: 'image/png' } : null;
  } };
}

function remoteExpression(input, characterId) {
  // Jev's null is abstention, not a request to reset to neutral.
  if (input.emotion === null && !['nod','ponder','celebrate','recoil','reassure','explain'].includes(input.nikePerformance)) return null;
  const enums = {
    emotion: ['neutral','happy','joy','thinking','surprised','soft','worried','exasperated','proud'],
    reaction: ['neutral','happy','thinking','surprised','listening','soft','sad','angry'],
    nikePerformance: ['none','neutral','celebrate','nod','ponder','explain','recoil','reassure'],
  };
  const expression = {};
  for (const [key, allowed] of Object.entries(enums)) if (allowed.includes(input[key])) expression[key] = input[key];
  if (!Object.keys(expression).length) return null;
  return { characterId, ...expression, durationMs: Math.max(100, Math.min(10000, Number(input.durationMs) || 4500)) };
}
async function remoteTtsWithExpression(text, { characterId, synthesize, classify, isCurrent }) {
  // Classify concurrently with synthesis; a failed optional classifier must
  // never fail audio playback. The phone activates this cue at audio start.
  const [audio, decision] = await Promise.all([
    synthesize(text),
    classify ? Promise.resolve().then(() => classify(text)).catch(() => null) : null,
  ]);
  const expression = decision && isCurrent() ? remoteExpression(decision, characterId) : null;
  return expression ? { ...audio, expression } : audio;
}
module.exports = { kohakuPackage, remoteExpression, remoteTtsWithExpression };
