// SPDX-License-Identifier: Apache-2.0
const { spawn } = require("node:child_process");
const { EmbeddedTtsModels } = require("./tts-model-download.cjs");
const manifest = require("./haru-model-manifest.json");

class HaruServer {
  constructor(directory, { spawnImpl = spawn, startupTimeoutMs = 120_000 } = {}) {
    this.models = new EmbeddedTtsModels(directory, { models: { [manifest.id]: manifest } });
    this.spawn = spawnImpl;
    this.startupTimeoutMs = startupTimeoutMs;
  }

  status() {
    const { supported, installed, downloading, progress, downloadBytes } = this.models.status(manifest.id);
    return { supported, installed, downloading, progress, downloadBytes };
  }

  download(onProgress) {
    let lastUpdate = 0;
    return this.models.download(manifest.id, (model) => {
      const now = Date.now();
      if (model.progress?.phase !== "done" && now - lastUpdate < 200) return;
      lastUpdate = now;
      onProgress?.(this.status());
    });
  }

  remove() {
    this.stop();
    this.models.remove(manifest.id);
    return this.status();
  }

  start({ language, name, persona } = {}) {
    if (this.ready) return this.ready;
    if (!this.status().installed) throw new Error("Download Haru 4B first.");
    const { executablePath, modelPath } = this.models.installedPaths(manifest.id);
    const args = ["serve", modelPath, "--host", "127.0.0.1", "--port", "0", "--max-seconds", "600",
      "--language", language === "en" ? "en" : "ja"];
    if (name) args.push("--name=" + name);
    if (persona) args.push("--persona=" + persona);
    const child = this.spawn(executablePath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.ready = new Promise((resolve, reject) => {
      const finish = (error) => {
        if (this.child !== child) return;
        this.child = null;
        this.ready = null;
        this.cancelStartup = null;
        clearTimeout(timer);
        reject(error);
        if (!child.killed) child.kill();
      };
      this.cancelStartup = finish;
      const timer = setTimeout(() => finish(new Error("Haru 4B startup timed out.")), this.startupTimeoutMs);
      let buffer = "";
      const read = (chunk) => {
        if (this.child !== child) return;
        buffer = (buffer + chunk).slice(-8192);
        const match = /Ready at http:\/\/127\.0\.0\.1:(\d{1,5})\//.exec(buffer);
        if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) return;
        clearTimeout(timer);
        child.stderr.off("data", read);
        child.stdout.off("data", read);
        resolve("http://127.0.0.1:" + Number(match[1]));
      };
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", read);
        stream.resume();
      }
      child.on("error", () => finish(new Error("Could not start speech.cpp.")));
      child.on("exit", () => finish(new Error("Haru 4B stopped. Check available GPU memory.")));
    });
    return this.ready;
  }

  stop() {
    this.cancelStartup?.(new Error("Haru 4B was stopped."));
  }
}

module.exports = { HaruServer };
