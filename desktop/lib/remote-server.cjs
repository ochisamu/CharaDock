// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const SESSION_COOKIE = "charadock_remote";
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_PORT = 41317;
const TRUSTED_DEVICE_DAYS = 180;

function normalizeAddress(value) {
  return String(value || "").replace(/^::ffff:/, "");
}

function isLoopbackAddress(value) {
  const normalized = normalizeAddress(value);
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isPrivateIpv4(value, { allowLoopback = false } = {}) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (allowLoopback && parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function sameOrigin(request, origin) {
  return String(request.headers.origin || "") === origin;
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(header) {
  return Object.fromEntries(String(header || "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

function jsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), display-capture=(), screen-wake-lock=(self)",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function safeErrorMessage(error) {
  if (error?.code && !error?.statusCode) return "The request could not be completed.";
  return String(error?.message || "Unexpected error.")
    .replace(/\b[A-Za-z]:[\\/][^\s"']+/g, "[local path]")
    .replace(/\/(?:home|Users|mnt)\/[^\s"']+/g, "[local path]")
    .slice(0, 300);
}

function sanitizedDeviceName(value, userAgent = "") {
  const explicit = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (explicit) return explicit;
  const ua = String(userAgent || "");
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "Web browser";
}

class RemoteCompanionServer {
  constructor({
    rootDir,
    address,
    port = DEFAULT_PORT,
    sessionMinutes = 60,
    callbacks = {},
    trustedDevices = [],
    allowLoopbackForTests = false,
    now = () => Date.now(),
  } = {}) {
    this.rootDir = path.resolve(rootDir || path.join(__dirname, "..", "remote"));
    this.address = normalizeAddress(address);
    const parsedPort = Number(port);
    this.port = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT;
    this.sessionMinutes = Math.max(15, Math.min(480, Number(sessionMinutes) || 60));
    this.callbacks = callbacks;
    this.allowLoopbackForTests = Boolean(allowLoopbackForTests);
    this.now = now;
    this.server = null;
    this.sessions = new Map();
    this.trustedDevices = new Map((Array.isArray(trustedDevices) ? trustedDevices : []).flatMap((device) => {
      const tokenHash = /^[a-f0-9]{64}$/.test(String(device?.tokenHash || "")) ? String(device.tokenHash) : "";
      const csrf = /^[A-Za-z0-9_-]{24,128}$/.test(String(device?.csrf || "")) ? String(device.csrf) : "";
      const id = /^[A-Za-z0-9_-]{12,64}$/.test(String(device?.id || "")) ? String(device.id) : "";
      if (!tokenHash || !csrf || !id || Number(device?.expiresAt) <= this.now()) return [];
      return [[tokenHash, {
        id,
        tokenHash,
        csrf,
        name: sanitizedDeviceName(device.name),
        address: normalizeAddress(device.address),
        pairedAt: Number(device.pairedAt) || this.now(),
        lastSeenAt: Number(device.lastSeenAt) || Number(device.pairedAt) || this.now(),
        expiresAt: Number(device.expiresAt),
      }]];
    }));
    this.eventClients = new Set();
    this.rateLimits = new Map();
    this.pairingToken = "";
    this.pairingCode = "";
    this.pairingExpiresAt = 0;
    this.cleanupTimer = null;
    this.lastTrustedPersistAt = 0;
    this.rotatePairingToken();
  }

  origin() {
    return this.server ? `http://${this.address}:${this.server.address().port}` : "";
  }

  pairingUrl() {
    return this.origin() && this.pairingToken ? `${this.origin()}/#token=${encodeURIComponent(this.pairingToken)}` : "";
  }

  status() {
    const connectedTokenHashes = new Set([...this.eventClients].map((client) => client.tokenHash));
    const devices = [...this.trustedDevices.entries()].map(([tokenHash, device]) => ({
      id: device.id,
      name: device.name,
      address: device.address,
      pairedAt: new Date(device.pairedAt).toISOString(),
      lastSeenAt: new Date(device.lastSeenAt).toISOString(),
      expiresAt: new Date(device.expiresAt).toISOString(),
      connected: connectedTokenHashes.has(tokenHash),
    })).sort((left, right) => Number(right.connected) - Number(left.connected) || right.lastSeenAt.localeCompare(left.lastSeenAt));
    return {
      active: Boolean(this.server),
      address: this.server ? this.address : "",
      port: this.server ? this.server.address().port : this.port,
      url: this.origin(),
      pairingUrl: this.pairingUrl(),
      pairingExpiresAt: this.pairingExpiresAt ? new Date(this.pairingExpiresAt).toISOString() : "",
      pairingCode: this.pairingCode,
      clients: this.trustedDevices.size,
      connectedClients: this.eventClients.size,
      devices,
      sessionMinutes: this.sessionMinutes,
    };
  }

  rotatePairingToken() {
    this.pairingToken = crypto.randomBytes(32).toString("base64url");
    this.pairingCode = crypto.randomBytes(5).toString("hex").slice(0, 8).toUpperCase();
    this.pairingExpiresAt = this.now() + 10 * 60_000;
    this.callbacks.onStatus?.(this.status());
    return this.status();
  }

  revokeAll() {
    this.sessions.clear();
    this.trustedDevices.clear();
    for (const client of this.eventClients) client.response.end();
    this.eventClients.clear();
    this.rotatePairingToken();
    this.persistTrustedDevices(true);
    this.callbacks.onStatus?.(this.status());
    return this.status();
  }

  revokeSession(sessionId) {
    const id = String(sessionId || "");
    const match = [...this.trustedDevices.entries()].find(([, device]) => device.id === id);
    if (!match) return false;
    const [tokenHash] = match;
    this.sessions.delete(tokenHash);
    this.trustedDevices.delete(tokenHash);
    for (const client of [...this.eventClients]) {
      if (client.tokenHash !== tokenHash) continue;
      client.response.end();
      this.eventClients.delete(client);
    }
    this.persistTrustedDevices(true);
    this.callbacks.onStatus?.(this.status());
    return true;
  }

  async start() {
    if (this.server) return this.status();
    if (!isPrivateIpv4(this.address, { allowLoopback: this.allowLoopbackForTests })) {
      throw new Error("A private LAN IPv4 address must be selected.");
    }
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => this.sendError(response, error));
    });
    this.server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      // Listen on loopback too so an optional Tailscale Serve HTTPS proxy can
      // reach the same authenticated service without replacing LAN access.
      this.server.listen(this.port, "0.0.0.0", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
    this.cleanupTimer.unref?.();
    this.callbacks.onStatus?.(this.status());
    return this.status();
  }

  async stop() {
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    for (const client of this.eventClients) client.response.end();
    this.eventClients.clear();
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise((resolve) => server.close(resolve));
    this.callbacks.onStatus?.(this.status());
  }

  cleanup() {
    const now = this.now();
    let changed = false;
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(tokenHash);
        changed = true;
      }
    }
    for (const [tokenHash, device] of this.trustedDevices) {
      if (device.expiresAt <= now) {
        this.trustedDevices.delete(tokenHash);
        this.sessions.delete(tokenHash);
        changed = true;
      }
    }
    for (const client of this.eventClients) {
      if (!this.sessions.has(client.tokenHash)) {
        client.response.end();
        this.eventClients.delete(client);
        changed = true;
      } else {
        client.response.write(": keepalive\n\n");
      }
    }
    if (changed) {
      this.persistTrustedDevices(true);
      this.callbacks.onStatus?.(this.status());
    }
  }

  persistTrustedDevices(force = false) {
    const now = this.now();
    if (!force && now - this.lastTrustedPersistAt < 30_000) return;
    this.lastTrustedPersistAt = now;
    this.callbacks.onTrustedDevices?.([...this.trustedDevices.values()].map((device) => ({ ...device })));
  }

  publish(type, payload) {
    const data = JSON.stringify(payload ?? null).replace(/[\u2028\u2029]/g, "");
    for (const client of this.eventClients) {
      this.writeEvent(client, `event: ${String(type || "message").replace(/[^a-z0-9:_-]/gi, "")}\ndata: ${data}\n\n`);
    }
  }

  publishTo(tokenHash, type, payload) {
    const target = String(tokenHash || "");
    if (!target) return false;
    const data = JSON.stringify(payload ?? null).replace(/[\u2028\u2029]/g, "");
    let delivered = false;
    for (const client of this.eventClients) {
      if (client.tokenHash !== target) continue;
      delivered = this.writeEvent(client, `event: ${String(type || "message").replace(/[^a-z0-9:_-]/gi, "")}\ndata: ${data}\n\n`) || delivered;
    }
    return delivered;
  }

  writeEvent(client, frame) {
    if (!client || !this.eventClients.has(client)) return false;
    const bytes = Buffer.byteLength(frame);
    if (client.waitingForDrain) {
      client.pendingFrames ||= [];
      client.pendingBytes ||= 0;
      // A stalled phone must not grow the desktop process without bound.
      // Two MiB is several seconds of converted Live audio and leaves ample
      // room for a short network hiccup.
      if (client.pendingBytes + bytes > 2 * 1024 * 1024) {
        client.response.end();
        this.eventClients.delete(client);
        return false;
      }
      client.pendingFrames.push(frame);
      client.pendingBytes += bytes;
      return true;
    }
    try {
      if (client.response.write(frame)) return true;
      // response.write(false) means the frame was accepted but Node's output
      // buffer is full. Wait for drain instead of treating it as disconnect.
      client.waitingForDrain = true;
      this.armEventDrain(client);
      return true;
    } catch {
      client.response.end();
      this.eventClients.delete(client);
      return false;
    }
  }

  armEventDrain(client) {
    if (client.drainArmed || !client.response?.once) return;
    client.drainArmed = true;
    client.response.once("drain", () => {
      client.drainArmed = false;
      client.waitingForDrain = false;
      while (this.eventClients.has(client) && client.pendingFrames?.length && !client.waitingForDrain) {
        const frame = client.pendingFrames.shift();
        client.pendingBytes = Math.max(0, (client.pendingBytes || 0) - Buffer.byteLength(frame));
        this.writeEvent(client, frame);
      }
    });
  }

  clientAddress(request) {
    return normalizeAddress(request.socket.remoteAddress);
  }

  enforceRateLimit(request, bucket, limit) {
    const key = `${bucket}:${this.clientAddress(request)}`;
    const now = this.now();
    const current = this.rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    current.count += 1;
    if (current.count > limit) throw Object.assign(new Error("Too many requests."), { statusCode: 429 });
  }

  requestOrigin(request) {
    if (!this.isTrustedTailscaleRequest(request)) return this.origin();
    const suppliedOrigin = String(request.headers.origin || "");
    if (/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net(?::\d+)?$/i.test(suppliedOrigin)) return suppliedOrigin;
    const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
    return `https://${forwardedHost}`;
  }

  isTrustedTailscaleRequest(request) {
    const host = String(request.headers.host || "");
    const forwardedHost = String(request.headers["x-forwarded-host"] || "");
    const expectedHost = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net(?::\d+)?$/i;
    return isLoopbackAddress(this.clientAddress(request))
      && Boolean(String(request.headers["tailscale-user-login"] || "").trim())
      && (expectedHost.test(host) || expectedHost.test(forwardedHost) || /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host));
  }

  validateHost(request) {
    if (String(request.headers.host || "") !== new URL(this.origin()).host && !this.isTrustedTailscaleRequest(request)) {
      throw Object.assign(new Error("Invalid host."), { statusCode: 400 });
    }
  }

  authenticate(request, { csrf = false } = {}) {
    const rawToken = parseCookies(request.headers.cookie)[SESSION_COOKIE] || "";
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    let session = this.sessions.get(tokenHash);
    const trusted = this.trustedDevices.get(tokenHash);
    const now = this.now();
    if (!trusted || trusted.expiresAt <= now) {
      if (trusted) {
        this.trustedDevices.delete(tokenHash);
        this.persistTrustedDevices(true);
      }
      this.sessions.delete(tokenHash);
      throw Object.assign(new Error("Pair this device again."), { statusCode: 401 });
    }
    if (!session || session.expiresAt <= now || session.address !== this.clientAddress(request)) {
      session = {
        ...trusted,
        address: this.clientAddress(request),
        expiresAt: now + this.sessionMinutes * 60_000,
      };
      this.sessions.set(tokenHash, session);
    }
    if (csrf && (!sameOrigin(request, this.requestOrigin(request)) || !constantTimeEqual(request.headers["x-charadock-csrf"], session.csrf))) {
      throw Object.assign(new Error("Invalid request token."), { statusCode: 403 });
    }
    session.lastSeenAt = now;
    trusted.lastSeenAt = now;
    trusted.address = session.address;
    this.persistTrustedDevices();
    return { session, tokenHash };
  }

  sendJson(response, statusCode, value, extraHeaders = {}) {
    response.writeHead(statusCode, { ...securityHeaders(), ...extraHeaders });
    response.end(JSON.stringify(value));
  }

  sendError(response, error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    this.sendJson(response, Number(error?.statusCode) || 500, { error: safeErrorMessage(error) });
  }

  sendStatic(response, filename, contentType) {
    const target = path.join(this.rootDir, filename);
    const body = fs.readFileSync(target);
    response.writeHead(200, {
      ...securityHeaders(contentType),
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' data: blob:; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    });
    response.end(body);
  }

  async handlePair(request, response) {
    this.enforceRateLimit(request, "pair", 8);
    if (!sameOrigin(request, this.requestOrigin(request))) throw Object.assign(new Error("Invalid origin."), { statusCode: 403 });
    const body = await jsonBody(request);
    const submittedToken = String(body.token || "").trim();
    const validToken = constantTimeEqual(submittedToken, this.pairingToken)
      || constantTimeEqual(submittedToken.toUpperCase().replace(/[^A-Z0-9]/g, ""), this.pairingCode);
    if (this.pairingExpiresAt <= this.now() || !validToken) {
      throw Object.assign(new Error("The pairing code has expired."), { statusCode: 401 });
    }
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const trustedDevice = {
      id: crypto.randomBytes(12).toString("base64url"),
      tokenHash,
      name: sanitizedDeviceName(body.deviceName, request.headers["user-agent"]),
      address: this.clientAddress(request),
      csrf: crypto.randomBytes(24).toString("base64url"),
      pairedAt: this.now(),
      lastSeenAt: this.now(),
      expiresAt: this.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60_000,
    };
    while (this.trustedDevices.size >= 8) {
      const oldest = this.trustedDevices.keys().next().value;
      this.trustedDevices.delete(oldest);
      this.sessions.delete(oldest);
    }
    const session = { ...trustedDevice, expiresAt: this.now() + this.sessionMinutes * 60_000 };
    this.trustedDevices.set(tokenHash, trustedDevice);
    this.sessions.set(tokenHash, session);
    this.persistTrustedDevices(true);
    this.rotatePairingToken();
    this.callbacks.onStatus?.(this.status());
    this.sendJson(response, 200, { csrfToken: session.csrf, state: await this.callbacks.getState?.() }, {
      "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TRUSTED_DEVICE_DAYS * 24 * 60 * 60}${this.isTrustedTailscaleRequest(request) ? "; Secure" : ""}`,
    });
  }

  async handleRequest(request, response) {
    this.validateHost(request);
    const url = new URL(request.url, this.origin());
    const liveAudioRequest = request.method === "POST" && url.pathname === "/api/live/beatrice/audio";
    this.enforceRateLimit(request, liveAudioRequest ? "live-audio" : "all", liveAudioRequest ? 1200 : 180);
    if (request.method === "GET" && url.pathname === "/") return this.sendStatic(response, "index.html", "text/html; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/remote.css") return this.sendStatic(response, "remote.css", "text/css; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/remote.js") return this.sendStatic(response, "remote.js", "text/javascript; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/audio-envelope.js") {
      const body = fs.readFileSync(path.resolve(this.rootDir, "..", "audio-envelope.js"));
      response.writeHead(200, {
        ...securityHeaders("text/javascript; charset=utf-8"),
        "Content-Security-Policy": "default-src 'none'",
      });
      response.end(body);
      return;
    }
    if (request.method === "GET" && url.pathname === "/manifest.webmanifest") return this.sendStatic(response, "manifest.webmanifest", "application/manifest+json; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/service-worker.js") {
      const body = fs.readFileSync(path.join(this.rootDir, "service-worker.js"));
      response.writeHead(200, {
        ...securityHeaders("text/javascript; charset=utf-8"),
        "Service-Worker-Allowed": "/",
        "Content-Security-Policy": "default-src 'none'",
      });
      response.end(body);
      return;
    }
    if (request.method === "GET" && url.pathname === "/app-icon.png") {
      const body = fs.readFileSync(path.resolve(this.rootDir, "..", "..", "app-icon.png"));
      response.writeHead(200, { ...securityHeaders("image/png"), "Content-Security-Policy": "default-src 'none'" });
      response.end(body);
      return;
    }
    if (request.method === "GET" && /^\/icons\/(?:voice|history|send|stop|settings|microphone)\.svg$/.test(url.pathname)) {
      const body = fs.readFileSync(path.resolve(this.rootDir, "..", "..", "assets", "ui", url.pathname.slice(1)));
      response.writeHead(200, { ...securityHeaders("image/svg+xml"), "Content-Security-Policy": "default-src 'none'" });
      response.end(body);
      return;
    }
    if (request.method === "GET" && url.pathname === "/noto-sans-jp.ttf") {
      const body = fs.readFileSync(path.resolve(this.rootDir, "..", "..", "assets", "fonts", "NotoSansJP-VF.ttf"));
      response.writeHead(200, { ...securityHeaders("font/ttf"), "Content-Security-Policy": "default-src 'none'" });
      response.end(body);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pair") return this.handlePair(request, response);

    if (request.method === "GET" && url.pathname === "/api/events") {
      const auth = this.authenticate(request);
      response.writeHead(200, {
        ...securityHeaders("text/event-stream; charset=utf-8"),
        Connection: "keep-alive",
        "Content-Security-Policy": "default-src 'none'",
      });
      response.write(`event: state\ndata: ${JSON.stringify(await this.callbacks.getState?.())}\n\n`);
      const client = { response, tokenHash: auth.tokenHash };
      this.eventClients.add(client);
      request.on("close", () => {
        this.eventClients.delete(client);
        this.callbacks.onStatus?.(this.status());
      });
      this.callbacks.onStatus?.(this.status());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      const { session } = this.authenticate(request);
      return this.sendJson(response, 200, { csrfToken: session.csrf, state: await this.callbacks.getState?.() });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/avatar/")) {
      this.authenticate(request);
      const key = decodeURIComponent(url.pathname.slice("/api/avatar/".length));
      const asset = await this.callbacks.getAvatarAsset?.(key);
      if (!asset?.body) throw Object.assign(new Error("Avatar asset not found."), { statusCode: 404 });
      response.writeHead(200, { ...securityHeaders(asset.contentType || "image/png"), "Content-Security-Policy": "default-src 'none'" });
      response.end(asset.body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/artifact") {
      this.authenticate(request);
      const asset = await this.callbacks.getArtifact?.(url.searchParams.get("runId"), url.searchParams.get("path"));
      if (!asset?.body) throw Object.assign(new Error("Artifact not found."), { statusCode: 404 });
      response.writeHead(200, {
        ...securityHeaders(asset.contentType || "application/octet-stream"),
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Disposition": `${asset.inline === false ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.fileName || "artifact")}`,
        "Content-Security-Policy": asset.contentSecurityPolicy || "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      });
      response.end(asset.body);
      return;
    }

    if (request.method === "POST" && ["/api/message", "/api/pet", "/api/interrupt", "/api/settings", "/api/approval", "/api/secure-handoff", "/api/live/start", "/api/live/stop", "/api/live/beatrice/audio", "/api/live/beatrice/stop", "/api/tts", "/api/tts/next", "/api/tts/cancel", "/api/disconnect"].includes(url.pathname)) {
      const { tokenHash } = this.authenticate(request, { csrf: true });
      const body = await jsonBody(request);
      if (url.pathname === "/api/message") {
        const result = await this.callbacks.sendMessage?.({
          message: body.message,
          mode: body.mode,
          secureActionsAllowed: this.isTrustedTailscaleRequest(request),
        });
        return this.sendJson(response, 200, { ok: true, result });
      }
      if (url.pathname === "/api/pet") {
        this.enforceRateLimit(request, "pet", 30);
        return this.sendJson(response, 200, await this.callbacks.pet?.({ zone: body.zone === "head" ? "head" : "body" }));
      }
      if (url.pathname === "/api/interrupt") return this.sendJson(response, 200, await this.callbacks.interrupt?.());
      if (url.pathname === "/api/settings") return this.sendJson(response, 200, { state: await this.callbacks.setSettings?.(body) });
      if (url.pathname === "/api/approval") {
        if (!this.isTrustedTailscaleRequest(request)) {
          throw Object.assign(new Error("Approval responses require a verified Tailscale HTTPS connection."), { statusCode: 403 });
        }
        return this.sendJson(response, 200, await this.callbacks.resolveApproval?.({ id: body.id, action: body.action }));
      }
      if (url.pathname === "/api/secure-handoff") {
        const handoff = await this.callbacks.secureHandoff?.();
        if (!handoff?.url) throw Object.assign(new Error("Secure microphone access is not available."), { statusCode: 409 });
        return this.sendJson(response, 200, handoff);
      }
      if (url.pathname === "/api/live/start") return this.sendJson(response, 200, await this.callbacks.startLive?.({ ...body, remoteTokenHash: tokenHash }));
      if (url.pathname === "/api/live/stop") return this.sendJson(response, 200, await this.callbacks.stopLive?.({ liveSessionId: body.liveSessionId, remoteTokenHash: tokenHash }));
      if (url.pathname === "/api/live/beatrice/audio") {
        return this.sendJson(response, 200, await this.callbacks.processLiveBeatriceAudio?.({ audio: body.audio, sessionId: body.sessionId, remoteTokenHash: tokenHash }));
      }
      if (url.pathname === "/api/live/beatrice/stop") {
        return this.sendJson(response, 200, await this.callbacks.stopLiveBeatrice?.({ sessionId: body.sessionId, remoteTokenHash: tokenHash }));
      }
      if (url.pathname === "/api/tts") return this.sendJson(response, 200, await this.callbacks.synthesizeTts?.(body.text));
      if (url.pathname === "/api/tts/next") return this.sendJson(response, 200, await this.callbacks.nextTtsChunk?.(body.streamId));
      if (url.pathname === "/api/tts/cancel") return this.sendJson(response, 200, await this.callbacks.cancelTts?.(body.streamId));
      this.sessions.delete(tokenHash);
      this.trustedDevices.delete(tokenHash);
      this.persistTrustedDevices(true);
      this.callbacks.onStatus?.(this.status());
      return this.sendJson(response, 200, { ok: true }, { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    throw Object.assign(new Error("Not found."), { statusCode: 404 });
  }
}

module.exports = { DEFAULT_PORT, RemoteCompanionServer, isPrivateIpv4, normalizeAddress, safeErrorMessage, sanitizedDeviceName };
