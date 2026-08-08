// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function normalizePort(value, fallback = 41317, { privileged = false } = {}) {
  const minimum = privileged ? 1 : 1024;
  const parsed = Math.round(Number(value) || fallback);
  return Math.max(minimum, Math.min(65535, parsed));
}

function cleanOutput(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 6000);
}

function tailscaleUrl(value) {
  return cleanOutput(value).match(/https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net(?::\d+)?/i)?.[0] || "";
}

class TailscaleServeManager {
  constructor({ platform = process.platform, env = process.env, exists = fs.existsSync, run } = {}) {
    this.platform = platform;
    this.env = env;
    this.exists = exists;
    this.run = run || (async (executable, args) => execFileAsync(executable, args, {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  }

  executable() {
    const candidates = this.platform === "win32"
      ? [
        this.env.ProgramFiles && path.join(this.env.ProgramFiles, "Tailscale", "tailscale.exe"),
        this.env.LOCALAPPDATA && path.join(this.env.LOCALAPPDATA, "Tailscale", "tailscale.exe"),
        "tailscale.exe",
        "tailscale",
      ]
      : this.platform === "darwin"
        ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "tailscale"]
        : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "tailscale"];
    return candidates.filter(Boolean).find((candidate) => !path.isAbsolute(candidate) || this.exists(candidate)) || candidates.at(-1);
  }

  async command(args) {
    try {
      const result = await this.run(this.executable(), args);
      return cleanOutput(`${result?.stdout || ""}\n${result?.stderr || ""}`);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("Tailscaleが見つかりません。先にTailscaleをインストールしてください。");
      throw new Error(cleanOutput(error?.stderr || error?.stdout || error?.message) || "Tailscaleコマンドを実行できませんでした。");
    }
  }

  async status() {
    try {
      const output = await this.command(["serve", "status"]);
      const inactive = !output || /(?:no serve config|not configured|is not running)/i.test(output);
      return { installed: true, active: !inactive, url: tailscaleUrl(output), output };
    } catch (error) {
      if (/(?:no serve config|not configured|is not running)/i.test(error.message)) {
        return { installed: true, active: false, url: "", output: "" };
      }
      return { installed: !/見つかりません/.test(error.message), active: false, url: "", output: "", error: error.message };
    }
  }

  async start({ localPort = 41317, httpsPort = 443 } = {}) {
    const targetPort = normalizePort(localPort);
    const publicPort = normalizePort(httpsPort, 443, { privileged: true });
    const before = await this.status();
    if (!before.installed) throw new Error(before.error || "Tailscaleが見つかりません。");
    const expectedTarget = new RegExp(`(?:127\\.0\\.0\\.1|localhost):${targetPort}\\b`);
    if (before.active && !expectedTarget.test(before.output)) {
      throw new Error("別のTailscale Serve設定が有効です。既存設定を保護するため、CharaDockからは上書きしません。");
    }
    if (before.active) return { ...before, managed: false, alreadyActive: true, localPort: targetPort, httpsPort: publicPort };
    const output = await this.command(["serve", "--bg", `--https=${publicPort}`, String(targetPort)]);
    return { installed: true, active: true, managed: true, localPort: targetPort, httpsPort: publicPort, url: tailscaleUrl(output), output };
  }

  async stop({ httpsPort = 443 } = {}) {
    const publicPort = normalizePort(httpsPort, 443, { privileged: true });
    const output = await this.command(["serve", `--https=${publicPort}`, "off"]);
    return { installed: true, active: false, managed: false, httpsPort: publicPort, url: "", output };
  }
}

module.exports = { TailscaleServeManager, cleanOutput, normalizePort, tailscaleUrl };
