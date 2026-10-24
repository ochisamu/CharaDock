# HTTP2Shell / CVE-2026-111497 assessment

Reviewed on 2026-10-25 for CharaDock v0.7.1 and the v0.8.0 release.

## Scope and result

The vulnerability is in Google's native Brotli decoder, not specifically in HTTP/2. A process must decompress attacker-controlled Brotli data to reach it. It can affect HTTP client responses as well as servers that explicitly decompress request bodies. An npm audit alone does not establish whether an embedded runtime is patched.

| Component | Finding | Action |
| --- | --- | --- |
| Distributed CharaDock v0.7.1, Electron 43.1.1 | Electron builds Node against Chromium's Brotli. Chromium 150.0.7871.114 already includes the upstream invalid-block-switch fix. This CVE is not applicable to that official Electron build, despite `process.versions.brotli` reporting 1.2.0 and Node reporting 24.18.0. | Preserve this distinction in release notes; do not label v0.7.1 as confirmed vulnerable. |
| CharaDock v0.8.0, Electron 43.8.3 | Same shared-library build arrangement, with Chromium 150.0.7871.250 containing the fix. Node reports 24.22.0 and Brotli reports 1.2.0; these strings alone are not an exposure test. | Pin Electron 43.8.3 and verify the actual packaged runtime. |
| Development/build Node | The inspected WSL Node 22.16.0 and Windows Node 26.4.0 are below the upstream fixed releases. Their `fetch()` and tooling may decompress remote responses. | Build with checksum-verified Node 22.23.4. Add `.node-version`, `.nvmrc`, package engines, CI pinning, and a build-time runtime check. Do not use the old system binaries for a release. |
| CharaDock Link / local HTTP servers | Request bodies are read as bytes and JSON; there is no automatic Brotli decompression of incoming request bodies. External downloads and API responses use the embedded runtime. | Retain authentication and existing body limits. No HTTP/2 toggle or decompression monkey patch is required. |
| Repository Python project | `pyproject.toml` declares no runtime dependencies and no Brotli package. | No Python Brotli dependency update is required for this repository. Separately installed tools and user-created Work projects are outside this assessment. |

## Build checks

`npm run runtime:security` rejects affected stock Node release lines before the typed runtime is built. Supported baselines are Node 22.23.4, 24.22.1 and 26.12.1. Unknown and end-of-life lines fail closed. The check accepts only the explicitly audited Electron 43.8.3 build when run inside Electron; update that audit when changing Electron.

All GitHub Actions Node setup steps read `.node-version`. The Windows packaging script checks its actual Node executable, and accepts a `CHARADOCK_NODE` override for a verified local toolchain. This repository does not silently replace the machine-wide Node installation used by unrelated projects.

For future Electron upgrades, inspect `DEPS` for the Chromium version, `patches/node/build_add_gn_build_files.patch` for linkage to `//third_party/brotli:dec`, and the Chromium decoder for the upstream `BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH` status handling. Test the packaged executable, not only the development installation. Normal Brotli round-trip tests confirm functionality but do not by themselves prove the vulnerability is fixed.

## Primary sources

- [Node.js security advisory and fixed releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases#nodejs-brotli-decoder-out-of-bounds-write-permits-remote-code-execution-cve-2026-111497---high)
- [Upstream Brotli fix 0ed4268](https://github.com/google/brotli/commit/0ed4268a4401abcb4472096340477cf4af7d1a2b) (landed in upstream in February; later backported to the affected release lines)
- [Electron 43.1.1 build linkage](https://github.com/electron/electron/blob/v43.1.1/patches/node/build_add_gn_build_files.patch) and [DEPS](https://github.com/electron/electron/blob/v43.1.1/DEPS)
- [Chromium 150.0.7871.114 decoder](https://github.com/chromium/chromium/blob/150.0.7871.114/third_party/brotli/dec/decode.c)
- [Electron 43.8.3 build linkage](https://github.com/electron/electron/blob/v43.8.3/patches/node/build_add_gn_build_files.patch) and [DEPS](https://github.com/electron/electron/blob/v43.8.3/DEPS)
- [Chromium 150.0.7871.250 decoder](https://github.com/chromium/chromium/blob/150.0.7871.250/third_party/brotli/dec/decode.c)
