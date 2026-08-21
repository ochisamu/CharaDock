// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  macCodexCandidates,
  cacheWslCodexRuntime,
  npmCodexBinaryCandidates,
  parseWslUncPath,
  resolveCodexCommand,
  resolveWslCodexCommand,
  wslCommandArgsForPath,
  wslPathTarget,
  windowsPathToWsl,
  workspacePathIdentity,
} = require("../lib/codex-command.cjs");

test("macOS packaged apps discover Codex Desktop outside the Finder PATH", async () => {
  const desktop = "/Applications/Codex.app/Contents/Resources/codex";
  const command = await resolveCodexCommand({
    platform: "darwin",
    env: { HOME: "/Users/test", PATH: "/usr/bin:/bin" },
    exists: (candidate) => candidate === desktop,
    runCommand: async () => "",
  });
  assert.equal(command, desktop);
  assert.equal(macCodexCandidates({ HOME: "/Users/test" }).includes("/opt/homebrew/bin/codex"), true);
});

test("macOS packaged apps discover an npm or Homebrew Codex CLI", async () => {
  const homebrew = "/opt/homebrew/bin/codex";
  const command = await resolveCodexCommand({
    platform: "darwin",
    env: { HOME: "/Users/test" },
    exists: (candidate) => candidate === homebrew,
    runCommand: async () => "",
  });
  assert.equal(command, homebrew);
});

test("macOS reports an unavailable Codex installation instead of spawning a missing bare command", async () => {
  const command = await resolveCodexCommand({
    platform: "darwin",
    env: { HOME: "/Users/test" },
    exists: () => false,
    runCommand: async () => "",
  });
  assert.equal(command, "");
});

test("Windows work folders and the bundled WSL Codex binary map to Linux paths", () => {
  assert.equal(windowsPathToWsl("C:\\Users\\test\\Downloads\\project"), "/mnt/c/Users/test/Downloads/project");
  const root = "C:\\Users\\test\\.codex\\bin\\wsl";
  const command = resolveWslCodexCommand({
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\test" },
    readDirectory: (directory) => {
      assert.equal(directory, root);
      return [{ name: "build-1", isDirectory: () => true }];
    },
    exists: (candidate) => candidate === `${root}\\build-1\\codex`,
    stat: () => ({ mtimeMs: 1 }),
  });
  assert.equal(command, "/mnt/c/Users/test/.codex/bin/wsl/build-1/codex");
});

test("WSL Codex runtime is pinned into app-owned storage with its helper binaries", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-wsl-runtime-"));
  const source = path.join(root, "external", "build-1");
  const cache = path.join(root, "owned");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "codex"), "codex-binary");
  fs.writeFileSync(path.join(source, "codex-code-mode-host"), "helper-binary");
  const command = cacheWslCodexRuntime(path.join(source, "codex"), cache, {
    pathApi: path.posix,
    toRuntimePath: (value) => value,
  });
  assert.equal(command, path.join(cache, "wsl", "build-1", "codex"));
  assert.equal(fs.readFileSync(path.join(cache, "wsl", "build-1", "codex-code-mode-host"), "utf8"), "helper-binary");
  fs.rmSync(source, { recursive: true, force: true });
  assert.equal(fs.readFileSync(command, "utf8"), "codex-binary");
});

test("WSL command resolution uses an app-owned runtime cache when requested", () => {
  let cachedSource = "";
  const command = resolveWslCodexCommand({
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\test" },
    cacheDirectory: "C:\\AppData\\CharaDock\\codex-bin",
    readDirectory: () => [{ name: "build-1", isDirectory: () => true }],
    exists: (candidate) => candidate.endsWith("\\build-1\\codex"),
    stat: () => ({ mtimeMs: 1 }),
    cacheRuntime: (source, destination) => {
      cachedSource = source;
      assert.equal(destination, "C:\\AppData\\CharaDock\\codex-bin");
      return "/mnt/c/AppData/CharaDock/codex-bin/wsl/build-1/codex";
    },
  });
  assert.match(cachedSource, /build-1\\codex$/);
  assert.equal(command, "/mnt/c/AppData/CharaDock/codex-bin/wsl/build-1/codex");
});

test("WSL UNC work folders preserve their distribution and map to Linux paths", () => {
  const localhostPath = "\\\\wsl.localhost\\Ubuntu\\home\\test\\workspace\\project";
  assert.deepEqual(parseWslUncPath(localhostPath), {
    distribution: "Ubuntu",
    path: "/home/test/workspace/project",
  });
  assert.deepEqual(wslPathTarget("\\\\wsl$\\Debian\\srv\\project"), {
    distribution: "Debian",
    path: "/srv/project",
  });
  assert.equal(windowsPathToWsl(localhostPath), "/home/test/workspace/project");
  assert.deepEqual(wslCommandArgsForPath(localhostPath, ["env", "codex"]), [
    "--distribution", "Ubuntu", "--cd", "/home/test/workspace/project", "env", "codex",
  ]);
});

test("WSL path arguments remain generic for ordinary Windows folders", () => {
  assert.deepEqual(wslCommandArgsForPath("D:\\work\\project", ["node", "server.js"]), [
    "--cd", "/mnt/d/work/project", "node", "server.js",
  ]);
});

test("equivalent WSL UNC aliases share one workspace identity", () => {
  const localhost = "\\\\wsl.localhost\\Ubuntu\\home\\test\\project";
  const legacy = "\\\\wsl$\\ubuntu\\home\\test\\project";
  assert.equal(workspacePathIdentity(localhost, "win32"), workspacePathIdentity(legacy, "win32"));
  assert.notEqual(
    workspacePathIdentity(localhost, "win32"),
    workspacePathIdentity("\\\\wsl.localhost\\Debian\\home\\test\\project", "win32"),
  );
});

test("Codex command honors an explicit path", async () => {
  const command = await resolveCodexCommand({
    platform: "win32",
    env: { CODEX_CLI_PATH: "D:\\codex.exe" },
    exists: (candidate) => candidate === "D:\\codex.exe",
  });
  assert.equal(command, "D:\\codex.exe");
});

test("Codex command ignores a stale explicit path and continues Desktop discovery", async () => {
  const appxPath = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\resources\\codex.exe";
  const command = await resolveCodexCommand({
    platform: "win32",
    env: { CODEX_CLI_PATH: "D:\\missing\\codex.exe" },
    exists: (candidate) => candidate === appxPath,
    runCommand: async (name) => name === "powershell.exe" ? appxPath : "",
  });
  assert.equal(command, appxPath);
});

test("Codex command resolves an explicit npm shim to its native Windows binary", async () => {
  const shim = "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd";
  const native = npmCodexBinaryCandidates(shim, "x64")[0];
  const command = await resolveCodexCommand({
    platform: "win32",
    arch: "x64",
    env: { CODEX_CLI_PATH: shim },
    exists: (candidate) => candidate === shim || candidate === native,
  });
  assert.equal(command, native);
});

test("Codex command resolves a PATH npm shim to its native Windows binary", async () => {
  const shim = "C:\\Users\\test\\AppData\\Roaming\\npm\\codex";
  const commandShim = `${shim}.cmd`;
  const native = npmCodexBinaryCandidates(shim, "x64")[0];
  const existing = new Set([shim, commandShim, native]);
  const command = await resolveCodexCommand({
    platform: "win32",
    arch: "x64",
    env: {},
    exists: (candidate) => existing.has(candidate),
    runCommand: async (name) => name === "where.exe" ? `${shim}\r\n${commandShim}` : "",
  });
  assert.equal(command, native);
});

test("Codex command uses a native PATH executable for a CLI-only installation", async () => {
  const native = "D:\\Tools\\Codex\\codex.exe";
  const command = await resolveCodexCommand({
    platform: "win32",
    env: {},
    exists: (candidate) => candidate === native,
    runCommand: async (name) => name === "where.exe" ? native : "",
  });
  assert.equal(command, native);
});

test("Codex command supports the npm ARM64 package layout", async () => {
  const shim = "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd";
  const native = npmCodexBinaryCandidates(shim, "arm64")[0];
  const command = await resolveCodexCommand({
    platform: "win32",
    arch: "arm64",
    env: {},
    exists: (candidate) => candidate === shim || candidate === native,
    runCommand: async (name) => name === "where.exe" ? shim : "",
  });
  assert.equal(command, native);
});

test("Codex command discovers the Windows Store Codex app binary", async () => {
  const appxPath = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\resources\\codex.exe";
  const calls = [];
  const command = await resolveCodexCommand({
    platform: "win32",
    env: {},
    exists: (candidate) => candidate === appxPath,
    runCommand: async (name) => {
      calls.push(name);
      return name === "powershell.exe" ? appxPath : "";
    },
  });
  assert.equal(command, appxPath);
  assert.deepEqual(calls, ["where.exe", "powershell.exe"]);
});

test("Codex command caches the protected Windows Store binary", async () => {
  const appxPath = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\resources\\codex.exe";
  let copied = null;
  const command = await resolveCodexCommand({
    platform: "win32",
    env: {},
    exists: (candidate) => candidate === appxPath,
    runCommand: async (name) => name === "powershell.exe" ? appxPath : "",
    cacheDirectory: "C:\\Users\\test\\CharaDock\\bin",
    cacheBinary: (source, directory) => {
      copied = { source, directory };
      return `${directory}\\codex.exe`;
    },
  });
  assert.equal(command, "C:\\Users\\test\\CharaDock\\bin\\codex.exe");
  assert.deepEqual(copied, { source: appxPath, directory: "C:\\Users\\test\\CharaDock\\bin" });
});

test("Codex command reports an unavailable Windows installation", async () => {
  const command = await resolveCodexCommand({
    platform: "win32",
    env: {},
    exists: () => false,
    runCommand: async () => "",
  });
  assert.equal(command, "");
});
