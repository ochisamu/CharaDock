// SPDX-License-Identifier: Apache-2.0
// CVE-2026-111497: check the runtime, not npm's dependency audit alone.
const NODE_FLOORS = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);

function runtimeIsPatched(versions = process.versions) {
  if (versions.electron) {
    // Electron links Node against Chromium's Brotli. This exact release was
    // audited against the upstream block-switch fix; its Brotli still reports
    // 1.2.0. Do not infer vulnerability from that version string alone.
    return versions.electron === '43.8.3';
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(versions.node || '');
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  const floor = NODE_FLOORS.get(major);
  return Boolean(floor && (minor > floor[0] || (minor === floor[0] && patch >= floor[1])));
}

function assertPatchedRuntime(versions = process.versions) {
  if (!runtimeIsPatched(versions)) {
    throw new Error(`CVE-2026-111497: unsupported build runtime (Node ${versions.node || 'unknown'}, Electron ${versions.electron || 'none'}). Use Node 22.23.4+, 24.22.1+, or 26.12.1+ on those release lines; see .node-version and docs/security/http2shell.md.`);
  }
}

if (require.main === module) {
  try {
    assertPatchedRuntime();
    console.log(`Runtime security check passed: ${process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.versions.node}`}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assertPatchedRuntime, runtimeIsPatched };
