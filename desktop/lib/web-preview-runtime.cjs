// SPDX-License-Identifier: Apache-2.0
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const WEB_SCRIPT_NAMES = Object.freeze(["dev", "preview", "start"]);
const MAX_LOG_LINES = 160;

function insideDirectory(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function readPackageJson(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("package.json is too large or invalid.");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("package.json is invalid.");
  return parsed;
}

function packageManagerForDirectory(directory, packageJson = {}) {
  const declared = String(packageJson.packageManager || "").split("@")[0].toLowerCase();
  if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  if (["pnpm-lock.yaml"].some((name) => fs.existsSync(path.join(directory, name)))) return "pnpm";
  if (["yarn.lock", ".pnp.cjs"].some((name) => fs.existsSync(path.join(directory, name)))) return "yarn";
  if (["bun.lock", "bun.lockb"].some((name) => fs.existsSync(path.join(directory, name)))) return "bun";
  return "npm";
}

function frameworkForPackage(packageJson = {}) {
  const dependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  if (dependencies.next) return "nextjs";
  if (dependencies.nuxt) return "nuxt";
  if (dependencies.astro) return "astro";
  if (dependencies["@sveltejs/kit"]) return "sveltekit";
  if (dependencies.vite) return "vite";
  return "node-web";
}

function findWebProject(workspaceDirectory, artifactTarget) {
  const workspace = path.resolve(workspaceDirectory);
  let current = path.resolve(artifactTarget);
  try { if (fs.statSync(current).isFile()) current = path.dirname(current); } catch { return null; }
  while (insideDirectory(workspace, current)) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      let packageJson;
      try { packageJson = readPackageJson(packagePath); } catch { return null; }
      const scripts = packageJson.scripts && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
        ? packageJson.scripts : {};
      const availableScripts = WEB_SCRIPT_NAMES.filter((name) => typeof scripts[name] === "string" && scripts[name].trim()).map((name) => ({
        name,
        value: String(scripts[name]).trim().slice(0, 500),
      }));
      if (availableScripts.length) {
        const manager = packageManagerForDirectory(current, packageJson);
        const preferred = availableScripts.find((script) => script.name === "dev") || availableScripts[0];
        return {
          directory: current,
          relativeDirectory: path.relative(workspace, current).replace(/\\/g, "/") || ".",
          name: String(packageJson.name || path.basename(current) || "Web app").slice(0, 100),
          framework: frameworkForPackage(packageJson),
          packageManager: manager,
          scripts: availableScripts,
          preferredScript: preferred.name,
          dependenciesReady: fs.existsSync(path.join(current, "node_modules")) || fs.existsSync(path.join(current, ".pnp.cjs")),
        };
      }
    }
    if (current === workspace) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function commandForWebProject(project, scriptName, port, platform = process.platform) {
  const allowed = new Set((project?.scripts || []).map((script) => script.name));
  const script = String(scriptName || project?.preferredScript || "");
  if (!allowed.has(script)) throw new Error("The selected package script is not available.");
  const manager = ["npm", "pnpm", "yarn", "bun"].includes(project?.packageManager) ? project.packageManager : "npm";
  const separator = manager === "yarn" ? [] : ["--"];
  const frameworkArgs = project.framework === "nextjs"
    ? ["--hostname", "127.0.0.1", "--port", String(port)]
    : ["--host", "127.0.0.1", "--port", String(port)];
  const managerArgs = ["run", script, ...separator, ...frameworkArgs];
  const label = [manager, ...managerArgs].join(" ");
  const useCommandInterpreter = platform === "win32" && manager !== "bun";
  return {
    executable: useCommandInterpreter ? "cmd.exe" : manager,
    args: useCommandInterpreter ? ["/d", "/s", "/c", label] : managerArgs,
    label,
  };
}

function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\x1B\\))/g, "");
}

class WebPreviewRuntime {
  constructor({ onState = null, spawnProcess = spawn, fetchImpl = globalThis.fetch } = {}) {
    this.onState = typeof onState === "function" ? onState : null;
    this.spawnProcess = spawnProcess;
    this.fetchImpl = fetchImpl;
    this.child = null;
    this.stopRequested = false;
    this.state = { status: "idle", logs: [] };
  }

  publicState() {
    return {
      status: this.state.status,
      url: String(this.state.url || ""),
      projectId: String(this.state.projectId || ""),
      projectName: String(this.state.projectName || ""),
      framework: String(this.state.framework || ""),
      runtime: String(this.state.runtime || ""),
      script: String(this.state.script || ""),
      command: String(this.state.command || ""),
      error: String(this.state.error || "").slice(0, 500),
      logs: (Array.isArray(this.state.logs) ? this.state.logs : []).slice(-MAX_LOG_LINES),
    };
  }

  publish(patch = {}) {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.publicState());
    return this.publicState();
  }

  appendLog(chunk) {
    const lines = stripAnsi(chunk).replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).filter(Boolean);
    if (!lines.length) return;
    const logs = [...(this.state.logs || []), ...lines.map((line) => line.slice(0, 2000))].slice(-MAX_LOG_LINES);
    this.publish({ logs });
  }

  async waitUntilReady(url, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.child && !this.stopRequested) {
      try {
        const response = await this.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(900) });
        if (response && response.status < 600) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return false;
  }

  async start({ project, projectId, script, port = 0, commandOverride = null, runtime = "native" }) {
    await this.stop();
    const selectedPort = Number(port) || await freeLocalPort();
    const command = typeof commandOverride === "function"
      ? commandOverride(selectedPort)
      : commandOverride || commandForWebProject(project, script, selectedPort);
    const url = `http://127.0.0.1:${selectedPort}/`;
    this.stopRequested = false;
    this.publish({
      status: "starting", url, projectId, projectName: project.name, framework: project.framework,
      script, command: command.label, runtime, error: "", logs: [],
    });
    let child;
    try {
      child = this.spawnProcess(command.executable, command.args, {
        cwd: command.cwd || project.directory,
        env: { ...process.env, BROWSER: "none", NO_OPEN: "1", PORT: String(selectedPort), HOST: "127.0.0.1", HOSTNAME: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
        shell: false,
      });
      this.child = child;
    } catch (error) {
      this.publish({ status: "error", error: error.message });
      throw error;
    }
    child.stdout?.on("data", (chunk) => this.appendLog(chunk));
    child.stderr?.on("data", (chunk) => this.appendLog(chunk));
    child.once("error", (error) => {
      if (this.child === child) this.child = null;
      if (!this.stopRequested) this.publish({ status: "error", error: error.message });
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopRequested) this.publish({ status: "idle", url: "", error: "" });
      else this.publish({ status: "error", error: `Preview process exited (${code ?? signal ?? "unknown"}).` });
    });
    const ready = await this.waitUntilReady(url);
    if (!ready) {
      const startupError = String(this.state.error || "");
      if (this.child) await this.stop();
      const error = startupError || "The development server did not become ready in time.";
      this.publish({ status: "error", error });
      throw new Error(error);
    }
    return this.publish({ status: "running" });
  }

  async stop() {
    const child = this.child;
    if (!child) {
      if (this.state.status !== "idle") return this.publish({ status: "idle", url: "", error: "" });
      return this.publicState();
    }
    this.stopRequested = true;
    this.publish({ status: "stopping" });
    const pid = Number(child.pid);
    if (Number.isInteger(pid) && pid > 1) {
      try {
        if (process.platform === "win32") {
          const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
          await new Promise((resolve) => { killer.once("exit", resolve); killer.once("error", resolve); });
        } else process.kill(-pid, "SIGTERM");
      } catch { try { child.kill("SIGTERM"); } catch {} }
    } else try { child.kill("SIGTERM"); } catch {}
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1800)),
    ]);
    if (this.child === child) {
      try { child.kill("SIGKILL"); } catch {}
      this.child = null;
    }
    return this.publish({ status: "idle", url: "", error: "" });
  }
}

module.exports = {
  WebPreviewRuntime,
  commandForWebProject,
  findWebProject,
  frameworkForPackage,
  insideDirectory,
  packageManagerForDirectory,
};
