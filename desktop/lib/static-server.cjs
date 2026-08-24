// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

const ROOT_FILES = new Set(["index.html", "app.js", "motion-runtime.js", "styles.css", "app-icon.ico"]);
const ROOT_DIRS = new Set(["assets", "vendor", "desktop"]);

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

class MascotStaticServer {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.server = null;
    this.port = 0;
    this.eventId = 0;
    this.sseClients = new Set();
    this.snapshot = null;
    this.input = { targetX: 0, targetY: 0, angleX: 0, angleY: 0, voiceRaw: 0 };
    this.config = { preset: "standard" };
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((request, response) => this.handle(request, response));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    for (const response of this.sseClients) response.end();
    this.sseClients.clear();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  setSnapshot(snapshot, publish = true) {
    this.snapshot = snapshot;
    if (publish) this.publish("snapshot", { updatedAt: Date.now() });
  }

  pushInput(values = {}) {
    const expressionKeys = ["forceMouth", "forceEyesClosed", "emotion", "reaction", "durationMs", "intensity"];
    const persistent = { ...values };
    for (const key of expressionKeys) delete persistent[key];
    this.input = { ...this.input, ...persistent, timestamp: Date.now() };
    const outgoing = { ...this.input };
    for (const key of expressionKeys) {
      if (Object.prototype.hasOwnProperty.call(values, key)) outgoing[key] = values[key];
    }
    this.publish("input", outgoing);
  }

  publish(type, payload) {
    const id = ++this.eventId;
    const message = `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of [...this.sseClients]) {
      try {
        response.write(message);
      } catch {
        this.sseClients.delete(response);
      }
    }
  }

  async readJson(request, limit = 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) throw new Error("request too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  async handle(request, response) {
    try {
      const url = new URL(request.url || "/", this.origin());
      if (url.pathname === "/api/obs/events" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write(": connected\n\n");
        this.sseClients.add(response);
        request.on("close", () => this.sseClients.delete(response));
        return;
      }
      if (url.pathname === "/api/obs/snapshot") {
        if (request.method === "GET") return jsonResponse(response, this.snapshot ? 200 : 404, this.snapshot || {});
        if (request.method === "POST") {
          this.setSnapshot(await this.readJson(request, 48 * 1024 * 1024));
          return jsonResponse(response, 200, { ok: true });
        }
      }
      if (url.pathname === "/api/obs/input") {
        if (request.method === "GET") return jsonResponse(response, 200, this.input);
        if (request.method === "POST") {
          this.pushInput(await this.readJson(request));
          return jsonResponse(response, 200, { ok: true });
        }
      }
      if (url.pathname === "/api/obs/config") {
        if (request.method === "GET") return jsonResponse(response, 200, this.config);
        if (request.method === "POST") {
          this.config = { ...this.config, ...(await this.readJson(request)) };
          this.publish("config", this.config);
          return jsonResponse(response, 200, { ok: true });
        }
      }
      if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse(response, 405, { error: "method not allowed" });
      return this.serveStatic(url.pathname, request, response);
    } catch (error) {
      console.error("Desktop local server error:", error);
      if (!response.headersSent) jsonResponse(response, 500, { error: "internal server error" });
      else response.end();
    }
  }

  serveStatic(urlPath, request, response) {
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return jsonResponse(response, 400, { error: "bad path" });
    }
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const parts = relative.split("/").filter(Boolean);
    if (!parts.length || (!ROOT_FILES.has(relative) && !ROOT_DIRS.has(parts[0]))) {
      return jsonResponse(response, 404, { error: "not found" });
    }
    const filePath = path.resolve(this.rootDir, relative);
    if (!filePath.startsWith(`${this.rootDir}${path.sep}`) && filePath !== this.rootDir) {
      return jsonResponse(response, 403, { error: "forbidden" });
    }
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return jsonResponse(response, 404, { error: "not found" });
    }
    if (!stats.isFile()) return jsonResponse(response, 404, { error: "not found" });
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") return response.end();
    fs.createReadStream(filePath).pipe(response);
  }
}

module.exports = { MascotStaticServer };
