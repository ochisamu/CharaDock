// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const APP_NAME = "CharaDock";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const PROVIDER_ARGS = ["model_provider=\"openai_chatgpt_plan\"",
  "model_providers.openai_chatgpt_plan.name=\"ChatGPT plan\"",
  `model_providers.openai_chatgpt_plan.base_url=\"${RESOURCE}\"`,
  "model_providers.openai_chatgpt_plan.env_key=\"CHARADOCK_CHATGPT_ACCESS_TOKEN\"",
  "model_providers.openai_chatgpt_plan.wire_api=\"responses\"",
  "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
  "model_providers.openai_chatgpt_plan.supports_websockets=false"];

function protectedWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

class ChatGPTSignIn {
  constructor({ directory, safeStorage, openExternal, onChange = () => {}, fetchImpl = fetch,
    verifyIdentity = null, now = Date.now, loginTimeoutMs = 10 * 60_000 } = {}) {
    this.directory = directory;
    this.file = path.join(directory, "connection.json");
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.onChange = onChange;
    this.fetch = fetchImpl;
    this.verifyIdentity = verifyIdentity;
    this.now = now;
    this.loginTimeoutMs = loginTimeoutMs;
    this.epoch = 0;
    this.registration = { hostId: `urn:uuid:${crypto.randomUUID()}` };
    this.credentials = null;
    this.unavailableEncrypted = null;
    this.pending = null;
    this.refreshing = null;
    this.error = "";
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (/^urn:uuid:[a-f0-9-]{36}$/i.test(saved.hostId)) this.registration.hostId = saved.hostId;
      if (typeof saved.clientId === "string" && saved.clientId !== "dynamic_agent_client") this.registration.clientId = saved.clientId;
      if (typeof saved.subjectHash === "string") this.registration.subjectHash = saved.subjectHash;
      if (typeof saved.encrypted === "string") this.unavailableEncrypted = saved.encrypted;
      if (saved.encrypted && this.canEncrypt()) {
        this.credentials = JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encrypted, "base64")));
      }
    } catch (error) { if (error.code !== "ENOENT") this.error = "saved_connection_unavailable"; }
  }

  canEncrypt() {
    try { return Boolean(this.safeStorage?.isEncryptionAvailable?.()) && this.safeStorage?.getSelectedStorageBackend?.() !== "basic_text"; }
    catch { return false; }
  }

  save() {
    const saved = { ...this.registration };
    if (this.credentials && this.canEncrypt()) saved.encrypted = this.safeStorage.encryptString(JSON.stringify(this.credentials)).toString("base64");
    else if (this.error === "saved_connection_unavailable" && this.unavailableEncrypted) saved.encrypted = this.unavailableEncrypted;
    protectedWrite(this.file, saved);
  }

  state() {
    const permitted = this.credentials?.scopes?.includes(PLAN_SCOPE);
    return { signedIn: Boolean(this.credentials?.accessToken && permitted), pending: Boolean(this.pending),
      type: this.credentials ? "chatgpt" : null, planType: "", authMode: "chatgpt",
      persistence: this.canEncrypt() ? "encrypted" : "session", error: this.error };
  }

  changed() { try { this.onChange(this.state()); } catch {} }

  async discovery() {
    if (!this.metadata) {
      const response = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("ChatGPT sign-in discovery failed");
      const value = await response.json();
      if (value.issuer !== ISSUER) throw new Error("Invalid ChatGPT issuer");
      for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
        if (new URL(value[key]).origin !== ISSUER) throw new Error("Invalid ChatGPT authorization endpoint");
      }
      this.metadata = value;
    }
    return this.metadata;
  }

  async tokenRequest(parameters) {
    const metadata = await this.discovery();
    const response = await this.fetch(metadata.token_endpoint, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...parameters, resource: RESOURCE }), signal: AbortSignal.timeout(30_000) });
    const value = await response.json();
    if (!response.ok) {
      // Never copy remote error bodies, codes, credentials or callback URLs into logs/UI.
      const error = new Error(response.status === 400 || response.status === 401 ? "ChatGPTへの再ログインが必要です。 / Sign in to ChatGPT again." : "ChatGPT接続を更新できませんでした。もう一度お試しください。 / Could not renew the ChatGPT connection. Try again.");
      error.reauthorize = ["invalid_grant", "invalid_client", "access_denied"].includes(value.error);
      throw error;
    }
    if (typeof value.access_token !== "string" || !value.access_token || !(Number(value.expires_in) > 0)) throw new Error("Invalid ChatGPT token response");
    return value;
  }

  async identity(idToken, clientId, nonce) {
    const metadata = await this.discovery();
    let payload;
    if (this.verifyIdentity) payload = await this.verifyIdentity(idToken, clientId, nonce);
    else {
    const jose = await import("jose");
    this.jwks ||= jose.createRemoteJWKSet(new URL(metadata.jwks_uri), { [jose.customFetch]: this.fetch });
    ({ payload } = await jose.jwtVerify(idToken, this.jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"], clockTolerance: 5 }));
    }
    if (!Number.isFinite(payload.exp) || typeof payload.sub !== "string" || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error("Invalid ChatGPT identity");
    return payload;
  }

  async beginSignIn() {
    if (!this.beginning) this.beginning = this.startSignIn().finally(() => { this.beginning = null; });
    return this.beginning;
  }

  async startSignIn() {
    if (this.pending) return { opened: true, pending: true };
    const epoch = ++this.epoch;
    const metadata = await this.discovery();
    if (this.epoch !== epoch) throw new Error("ChatGPT sign-in cancelled");
    const state = crypto.randomBytes(32).toString("base64url"), nonce = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const attempt = { epoch, state, nonce, verifier, clientId: this.registration.clientId, consumed: false };
    const server = http.createServer(async (request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== "/auth/callback") { response.writeHead(404); response.end(); return; }
      if (url.searchParams.get("state") !== state || this.pending !== attempt || attempt.consumed) { response.writeHead(400); response.end("This sign-in attempt is no longer valid."); return; }
      attempt.consumed = true;
      try {
        if (url.searchParams.has("error")) throw new Error("authorization_denied");
        const clientId = url.searchParams.get("client_id") || attempt.clientId;
        if (!clientId || clientId === "dynamic_agent_client" || (attempt.clientId && attempt.clientId !== clientId)) throw new Error("invalid_registration");
        this.registration.clientId = clientId; this.save();
        const code = url.searchParams.get("code");
        if (!code) throw new Error("invalid_callback");
        const token = await this.tokenRequest({ grant_type: "authorization_code", client_id: clientId, code,
          code_verifier: verifier, redirect_uri: attempt.redirectUri });
        const identity = await this.identity(token.id_token, clientId, nonce);
        const subjectHash = crypto.createHash("sha256").update(identity.sub).digest("hex");
        if (this.registration.subjectHash && this.registration.subjectHash !== subjectHash) throw new Error("account_mismatch");
        const scopes = String(token.scope || "").split(/\s+/);
        if (!scopes.includes(PLAN_SCOPE)) throw new Error("plan_permission_missing");
        if (this.epoch !== epoch || this.pending !== attempt) throw new Error("sign_in_cancelled");
        const credentials = { accessToken: token.access_token, refreshToken: token.refresh_token,
          idToken: token.id_token, scopes, expiresAt: this.now() + Number(token.expires_in) * 1000 };
        this.registration.subjectHash = subjectHash;
        this.credentials = credentials; this.error = ""; this.save();
        response.end("<!doctype html><title>CharaDock</title><h1>ChatGPTに接続しました</h1><p>CharaDockへ戻ってください。このタブは閉じられます。</p>");
      } catch { if (epoch === this.epoch) this.error = "sign_in_failed"; response.writeHead(400); response.end("<!doctype html><title>CharaDock</title><h1>接続できませんでした</h1><p>CharaDockから、もう一度ログインしてください。</p>"); }
      finally { this.finishAttempt(attempt); this.changed(); }
    });
    attempt.server = server;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    this.pending = attempt;
    attempt.timer = setTimeout(() => { if (this.pending === attempt) { this.error = "sign_in_timed_out"; this.finishAttempt(attempt); this.changed(); } }, this.loginTimeoutMs);
    attempt.timer.unref?.();
    const authorize = new URL(metadata.authorization_endpoint);
    const parameters = { client_id: attempt.clientId || "dynamic_agent_client", ext_agent_host_id: this.registration.hostId,
      response_type: "code", redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state, nonce,
      code_challenge_method: "S256", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
    if (!attempt.clientId) parameters.agent_name_hint = APP_NAME;
    else if (this.credentials?.idToken) parameters.id_token_hint = this.credentials.idToken;
    for (const [key, value] of Object.entries(parameters)) authorize.searchParams.set(key, value);
    this.save(); this.changed();
    try { await this.openExternal(authorize.href); }
    catch { this.finishAttempt(attempt); this.error = "browser_unavailable"; this.changed(); throw new Error("ログイン画面を開けませんでした。 / Could not open sign-in."); }
    return { opened: true };
  }

  finishAttempt(attempt = this.pending) {
    if (!attempt) return;
    clearTimeout(attempt.timer); attempt.server?.close();
    if (this.pending === attempt) this.pending = null;
  }

  async getAccessToken() {
    if (!this.state().signedIn) throw new Error("ChatGPTでサインインしてください。 / Continue with ChatGPT to connect.");
    if (this.credentials.expiresAt > this.now() + 120_000) return this.credentials.accessToken;
    if (!this.refreshing) {
      const epoch = this.epoch, previous = this.credentials;
      this.refreshing = (async () => {
        if (!previous.refreshToken) throw new Error("ChatGPTへの再ログインが必要です。 / Sign in to ChatGPT again.");
        try {
          const token = await this.tokenRequest({ grant_type: "refresh_token", client_id: this.registration.clientId, refresh_token: previous.refreshToken });
          if (token.id_token) {
            const identity = await this.identity(token.id_token, this.registration.clientId);
            if (crypto.createHash("sha256").update(identity.sub).digest("hex") !== this.registration.subjectHash) {
              const error = new Error("ChatGPT identity changed"); error.reauthorize = true; throw error;
            }
          }
          if (this.epoch !== epoch || this.credentials !== previous) throw new Error("ChatGPT connection changed");
          const scopes = token.scope === undefined ? previous.scopes : String(token.scope).split(/\s+/);
          if (!scopes.includes(PLAN_SCOPE)) { const error = new Error("ChatGPTプランの利用許可が必要です。 / Authorize ChatGPT plan usage."); error.reauthorize = true; throw error; }
          this.credentials = { ...previous, accessToken: token.access_token, refreshToken: token.refresh_token || previous.refreshToken,
            idToken: token.id_token || previous.idToken, scopes, expiresAt: this.now() + Number(token.expires_in) * 1000 };
          this.save(); this.error = ""; this.changed(); return this.credentials.accessToken;
        } catch (error) {
          if (epoch === this.epoch && error.reauthorize) { this.credentials = null; this.error = "reauthorize"; this.save(); this.changed(); }
          throw error;
        }
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async models() {
    const token = await this.getAccessToken();
    const response = await this.fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`ChatGPTモデル一覧を取得できません。 / Could not load ChatGPT models (${response.status}).`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.models)) throw new Error("Invalid ChatGPT model catalog");
    return catalog.models.filter(model => model.visibility === "list" && typeof model.slug === "string")
      .map(model => ({ model: model.slug, displayName: model.display_name || model.slug, hidden: false }));
  }

  logout() {
    ++this.epoch; this.finishAttempt(); this.credentials = null; this.refreshing = null;
    this.registration = { hostId: this.registration.hostId }; this.error = ""; this.save(); this.changed();
  }
  dispose() { ++this.epoch; this.finishAttempt(); }
}

module.exports = { APP_NAME, ChatGPTSignIn, PLAN_SCOPE, PROVIDER_ARGS, RESOURCE };
