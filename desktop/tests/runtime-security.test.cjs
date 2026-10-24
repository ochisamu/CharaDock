// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict');
const { assertPatchedRuntime, runtimeIsPatched } = require('../../scripts/check-runtime-security.cjs');

test('builds reject affected Node releases, including the previously installed WSL and Windows versions', () => {
  for (const node of ['20.20.0', '22.16.0', '22.23.3', '24.22.0', '26.4.0', '26.12.0', '25.9.0', '22.23.4-rc.1', 'unknown']) {
    assert.equal(runtimeIsPatched({ node }), false, node);
    assert.throws(() => assertPatchedRuntime({ node }), /CVE-2026-111497/);
  }
});
test('patched supported Node release lines pass the build gate', () => {
  for (const node of ['22.23.4', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0']) assert.equal(runtimeIsPatched({ node }), true, node);
});
test('the audited Electron build is accepted despite its shared Brotli version string', () => {
  assert.equal(runtimeIsPatched({ node: '24.22.0', electron: '43.8.3', brotli: '1.2.0' }), true);
  assert.equal(runtimeIsPatched({ node: '24.22.0', electron: '43.1.1', brotli: '1.2.0' }), false);
  assert.equal(runtimeIsPatched({ node: '24.22.1', electron: '45.0.0', brotli: '1.2.0' }), false);
});
