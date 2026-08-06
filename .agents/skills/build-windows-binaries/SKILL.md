---
name: build-windows-binaries
description: Build and verify this repository's Electron Windows NSIS installer and portable executable from WSL without Wine. Use when Codex needs to create, rebuild, overwrite, smoke-test, hash, or deliver CharaDock Windows binaries, especially after electron-builder fails with `wine ENOENT` or Windows Node sees a UNC project path.
---

# Build Windows Binaries

Build through Windows Node, not WSL electron-builder. The WSL path fails at NSIS signing with `wine ENOENT`; invoking Windows Node directly on a UNC project also pollutes `npm list` output. The bundled batch file uses `pushd` to map the UNC repository to a temporary Windows drive before running electron-builder.

## Workflow

1. Run `npm test` in WSL and stop on failures.
2. Resolve this skill's batch file with `wslpath -w` and invoke it from a Windows-backed working directory:

   ```bash
   skill_script_win=$(wslpath -w "$PWD/.agents/skills/build-windows-binaries/scripts/build-windows.cmd")
   (cd /mnt/c && cmd.exe /d /c "$skill_script_win")
   ```

   The batch file also fetches the matching `sherpa-onnx-win-x64` tarball with `npm pack` when WSL's shared `node_modules` contains only the Linux native addon, then extracts only that package. Do not use `npm install` from Windows against the mapped WSL repository: it can prune Linux dependencies and unrelated workspace files.

3. Require both fresh artifacts:
   - `dist/CharaDock Setup 0.1.0.exe`
   - `dist/CharaDock 0.1.0.exe`

   Reject either file if it is missing or smaller than 100 MB. A failed WSL NSIS run can leave a small, invalid installer stub.
4. Verify the packaged files needed by the change are present in `dist/win-unpacked/resources/app.asar`. For TTS changes, explicitly verify the relevant worker/client files.
   Also require `dist/win-unpacked/resources/app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node`; a Windows package containing only `sherpa-onnx-linux-*` will fail during startup.
5. Smoke-test from an explicit temporary directory under Windows `%TEMP%` and pass a separate `--user-data-dir`. Do not execute `dist/win-unpacked/*.exe` directly from the WSL filesystem; Windows interop may return `Permission denied`. Copy `dist/win-unpacked` into the temporary Windows directory first.
6. Compute SHA-256 hashes. If the user supplied an output folder, overwrite only the two intended executables there and re-hash the delivered copies.
7. Remove only the exact temporary smoke directory after validation. Preserve unrelated build output and user files.

## Failure handling

- On `wine ENOENT`, do not install Wine and do not retry the WSL build. Use the batch file.
- On `No JSON content found in output`, the build ran against an unmapped UNC path. Use the batch file so `pushd` assigns a drive letter.
- If only the installer is tiny, rebuild both targets; do not deliver the stub alongside an older portable executable.
- If Windows Node is missing, report that `node.exe` is required instead of silently falling back to Wine.
