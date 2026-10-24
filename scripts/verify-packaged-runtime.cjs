// SPDX-License-Identifier: Apache-2.0
// Run with ELECTRON_RUN_AS_NODE=1 using the staged Windows CharaDock.exe:
// SCRIPT SOURCE_ROOT STAGED_APP_DIR OUTPUT_JSON
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { extractFile } = require('@electron/asar');
const { assertPatchedRuntime } = require('./check-runtime-security.cjs');
const [source, application, output] = process.argv.slice(2);
if (!source || !application || !output) throw Error('Supply SOURCE_ROOT STAGED_APP_DIR OUTPUT_JSON');
assertPatchedRuntime();
assert.equal(process.versions.electron, '43.8.3');
const archive = path.join(application, 'resources', 'app.asar');
const wanted = [
  'desktop/main.cjs', 'desktop/control.html', 'desktop/preload-mascot.cjs', 'desktop/pcm-speech-player.js',
  'desktop/lib/remote-server.cjs', 'desktop/lib/live-input-decisions.cjs',
  'desktop/remote/remote.js', 'desktop/remote/live-capture-worklet.js', 'desktop/remote/service-worker.js',
  'desktop/tests/chatgpt-sign-in.test.cjs',
  'desktop/tests/speech-cpp-settings.test.cjs',
  '.agents/skills/build-windows-binaries/scripts/build-windows.cmd',
];
for (const file of wanted) assert.deepEqual(extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(source, file)), file);
const metadata = JSON.parse(extractFile(archive, 'package.json'));
assert.equal(metadata.version, JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).version);
assert.ok(fs.statSync(path.join(application, 'resources/app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node')).size > 0);
assert.ok(fs.statSync(path.join(application, 'resources/bin/charadock-beatrice-host.exe')).size > 0);
const plain = Buffer.from('CharaDock valid Brotli transport check');
assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(plain)), plain);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ passed: true, version: metadata.version,
  runtime: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, brotli: process.versions.brotli },
  packagedSourceMatches: wanted, windowsNativeRuntimes: true, validBrotliRoundtrip: true,
  scope: 'Actual packaged runtime, source integrity, native libraries and valid Brotli roundtrip. CVE patch status is established by the separate upstream source audit, not by this roundtrip.' }, null, 2));
console.log('PASS packaged runtime, source integrity and native libraries');
