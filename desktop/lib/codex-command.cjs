// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 8_000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

function cacheAppxBinary(source, cacheDirectory) {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const destination = path.join(cacheDirectory, "codex.exe");
  const sourceStat = fs.statSync(source);
  let current = null;
  try { current = fs.statSync(destination); } catch {}
  if (!current || current.size !== sourceStat.size || current.mtimeMs < sourceStat.mtimeMs) {
    fs.copyFileSync(source, destination);
  }
  return destination;
}

function parseWslUncPath(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/i);
  if (!match) return null;
  const relativePath = String(match[2] || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return {
    distribution: match[1],
    path: relativePath ? `/${relativePath}` : "/",
  };
}

function windowsPathToWsl(value) {
  const normalized = String(value || "").trim();
  const wslUnc = parseWslUncPath(normalized);
  if (wslUnc) return wslUnc.path;
  const match = normalized.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return normalized.replace(/\\/g, "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function wslPathTarget(value) {
  const wslUnc = parseWslUncPath(value);
  return wslUnc || { distribution: "", path: windowsPathToWsl(value) };
}

function wslCommandArgsForPath(value, commandArgs = []) {
  const target = wslPathTarget(value);
  return [
    ...(target.distribution ? ["--distribution", target.distribution] : []),
    "--cd",
    target.path,
    ...(Array.isArray(commandArgs) ? commandArgs : []),
  ];
}

function workspacePathIdentity(value, platform = process.platform) {
  const normalized = String(value || "").trim();
  if (platform !== "win32") return normalized;
  const wslUnc = parseWslUncPath(normalized);
  if (wslUnc) return `wsl:${wslUnc.distribution.toLocaleLowerCase()}:${wslUnc.path}`;
  return normalized.toLocaleLowerCase();
}

function npmCodexBinaryCandidates(commandPath, arch = process.arch) {
  const directory = path.win32.dirname(String(commandPath || ""));
  const platformPackage = arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const target = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const relativeBinary = path.win32.join("vendor", target, "bin", "codex.exe");
  return [
    path.win32.join(directory, "node_modules", "@openai", "codex", "node_modules", "@openai", platformPackage, relativeBinary),
    path.win32.join(directory, "node_modules", "@openai", platformPackage, relativeBinary),
  ];
}

function resolveNpmCodexBinary(commandPath, { arch = process.arch, exists = fs.existsSync } = {}) {
  return npmCodexBinaryCandidates(commandPath, arch).find((candidate) => exists(candidate)) || "";
}

function isWindowsExecutable(candidate) {
  return path.win32.extname(String(candidate || "")).toLowerCase() === ".exe";
}

function macCodexCandidates(env = process.env) {
  const home = String(env.HOME || "");
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    home && path.posix.join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    home && path.posix.join(home, ".local", "bin", "codex"),
    home && path.posix.join(home, ".npm-global", "bin", "codex"),
    home && path.posix.join(home, "Library", "pnpm", "codex"),
  ].filter(Boolean);
}

function resolveWslCodexCommand({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
  readDirectory = fs.readdirSync,
  stat = fs.statSync,
  cacheDirectory = "",
  cacheRuntime = cacheWslCodexRuntime,
} = {}) {
  if (platform !== "win32") return "";
  if (env.CODEX_WSL_CLI_PATH && exists(env.CODEX_WSL_CLI_PATH)) {
    if (!cacheDirectory) return windowsPathToWsl(env.CODEX_WSL_CLI_PATH);
    try { return cacheRuntime(env.CODEX_WSL_CLI_PATH, cacheDirectory); }
    catch { return windowsPathToWsl(env.CODEX_WSL_CLI_PATH); }
  }
  const profile = env.USERPROFILE || "";
  if (!profile) return "";
  const root = path.win32.join(profile, ".codex", "bin", "wsl");
  let entries;
  try { entries = readDirectory(root, { withFileTypes: true }); } catch { return ""; }
  const sourceCommand = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.win32.join(root, entry.name, "codex"))
    .filter((candidate) => exists(candidate))
    .sort((left, right) => {
      try { return stat(right).mtimeMs - stat(left).mtimeMs; } catch { return 0; }
    })[0] || "";
  if (!sourceCommand) return "";
  if (!cacheDirectory) return windowsPathToWsl(sourceCommand);
  try {
    return cacheRuntime(sourceCommand, cacheDirectory);
  } catch {
    // Keep Work available when the app-owned cache cannot be prepared. The
    // external path still works until its owner rotates that runtime.
    return windowsPathToWsl(sourceCommand);
  }
}

function cacheWslCodexRuntime(sourceCommand, cacheDirectory, options = {}) {
  const pathApi = options.pathApi || path.win32;
  const exists = options.exists || fs.existsSync;
  const readDirectory = options.readDirectory || fs.readdirSync;
  const stat = options.stat || fs.statSync;
  const makeDirectory = options.makeDirectory || fs.mkdirSync;
  const linkFile = options.linkFile || fs.linkSync;
  const copyFile = options.copyFile || fs.copyFileSync;
  const rename = options.rename || fs.renameSync;
  const remove = options.remove || fs.rmSync;
  const toRuntimePath = options.toRuntimePath || windowsPathToWsl;
  const source = String(sourceCommand || "");
  const cacheRoot = String(cacheDirectory || "");
  if (!source || !cacheRoot || !exists(source)) return "";
  const sourceDirectory = pathApi.dirname(source);
  const sourceName = pathApi.basename(sourceDirectory).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "runtime";
  const files = readDirectory(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      source: pathApi.join(sourceDirectory, entry.name),
    }))
    .map((entry) => ({ ...entry, size: stat(entry.source).size }));
  if (!files.some((entry) => entry.name === pathApi.basename(source))) return "";
  const destinationDirectory = pathApi.join(cacheRoot, "wsl", sourceName);
  const destinationCommand = pathApi.join(destinationDirectory, pathApi.basename(source));
  const ready = files.length > 0 && files.every((entry) => {
    try { return stat(pathApi.join(destinationDirectory, entry.name)).size === entry.size; } catch { return false; }
  });
  if (ready) return toRuntimePath(destinationCommand);

  makeDirectory(pathApi.join(cacheRoot, "wsl"), { recursive: true });
  const temporaryDirectory = `${destinationDirectory}.install-${process.pid}-${Date.now()}`;
  makeDirectory(temporaryDirectory, { recursive: true });
  try {
    for (const entry of files) {
      const destination = pathApi.join(temporaryDirectory, entry.name);
      try { linkFile(entry.source, destination); }
      catch { copyFile(entry.source, destination); }
      if (stat(destination).size !== entry.size) throw new Error(`Incomplete WSL Codex runtime file: ${entry.name}`);
    }
    if (exists(destinationDirectory)) remove(destinationDirectory, { recursive: true, force: true });
    rename(temporaryDirectory, destinationDirectory);
  } catch (error) {
    try { remove(temporaryDirectory, { recursive: true, force: true }); } catch {}
    throw error;
  }
  return toRuntimePath(destinationCommand);
}

async function resolveCodexCommand({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  runCommand = run,
  exists = fs.existsSync,
  cacheDirectory = "",
  cacheBinary = cacheAppxBinary,
} = {}) {
  if (env.CODEX_CLI_PATH) {
    if (platform !== "win32" && exists(env.CODEX_CLI_PATH)) return env.CODEX_CLI_PATH;
    if (isWindowsExecutable(env.CODEX_CLI_PATH) && exists(env.CODEX_CLI_PATH)) return env.CODEX_CLI_PATH;
    const explicitNpmBinary = resolveNpmCodexBinary(env.CODEX_CLI_PATH, { arch, exists });
    if (explicitNpmBinary) return explicitNpmBinary;
  }
  if (platform === "darwin") {
    const pathCandidate = String(await runCommand("/usr/bin/which", ["codex"]) || "").split(/\r?\n/)[0].trim();
    if (pathCandidate && exists(pathCandidate)) return pathCandidate;
    return macCodexCandidates(env).find((candidate) => exists(candidate)) || "";
  }
  if (platform !== "win32") return "codex";

  const whereResult = await runCommand("where.exe", ["codex"]);
  const whereCandidates = whereResult.split(/\r?\n/).map((candidate) => candidate.trim()).filter(Boolean);
  for (const candidate of whereCandidates) {
    if (!exists(candidate)) continue;
    if (isWindowsExecutable(candidate)) return candidate;
    const npmBinary = resolveNpmCodexBinary(candidate, { arch, exists });
    if (npmBinary) return npmBinary;
  }

  const localCandidates = [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs", "Codex", "resources", "codex.exe"),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Codex", "resources", "codex.exe"),
  ].filter(Boolean);
  for (const candidate of localCandidates) {
    if (exists(candidate)) return candidate;
  }

  const script = [
    "$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1;",
    "if ($package) {",
    "$candidate = Join-Path $package.InstallLocation 'app\\resources\\codex.exe';",
    "if (Test-Path -LiteralPath $candidate) { [Console]::Out.Write($candidate) }",
    "}",
  ].join(" ");
  const appxCandidate = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (appxCandidate && exists(appxCandidate)) {
    return cacheDirectory ? cacheBinary(appxCandidate, cacheDirectory) : appxCandidate;
  }
  // Do not return the bare command on Windows. npm installs both a POSIX `codex`
  // shim and `codex.cmd`; spawning the former from Electron fails with ENOENT.
  // An empty result also lets the UI distinguish "not installed" from a launch
  // failure and show an actionable installation message.
  return "";
}

module.exports = {
  cacheAppxBinary,
  cacheWslCodexRuntime,
  macCodexCandidates,
  npmCodexBinaryCandidates,
  parseWslUncPath,
  resolveCodexCommand,
  resolveNpmCodexBinary,
  resolveWslCodexCommand,
  wslCommandArgsForPath,
  wslPathTarget,
  windowsPathToWsl,
  workspacePathIdentity,
};
