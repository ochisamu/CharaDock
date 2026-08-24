// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

const debugPortArgument = process.argv.find((value) => value.startsWith("--debug-port="));
const port = Number(debugPortArgument?.split("=")[1] || process.env.CHARADOCK_DEBUG_PORT || 9223);
const pcOnly = process.argv.includes("--pc-only");
const observeOnly = process.argv.includes("--observe-only") || pcOnly;
const inspectOnly = process.argv.includes("--inspect-only");
const remoteOnly = process.argv.includes("--remote-only");
const includeRemote = process.argv.includes("--include-remote");
const exerciseBridge = process.argv.includes("--exercise-bridge");
const surfaceArgument = process.argv.find((value) => value.startsWith("--surface="));
const surface = surfaceArgument?.split("=")[1] === "mascot" ? "mascot" : "settings";
const positionalArguments = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const outputDirectory = path.resolve(positionalArguments[0] || path.join(process.cwd(), "work", "mcp-app-evidence"));
const message = positionalArguments[1] || "AIニケちゃんMCPのsearch_nikechan_knowledgeを使って、AITuberKitについて検索し、カードに表示して。";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data || "{}"));
      const waiter = this.pending.get(payload.id);
      if (!waiter) return;
      this.pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(payload.error.message || "CDP request failed"));
      else waiter.resolve(payload.result || {});
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    return this;
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  close() { this.socket?.close(); }
}

async function json(pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}

async function evaluate(client, expression, options = {}) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    ...options,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer evaluation failed");
  return result.result?.value;
}

async function targetByUrl(fragment, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const targets = await json("/json/list");
    const target = targets.find((entry) => String(entry.url || "").includes(fragment));
    if (target) return target;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for target: ${fragment}`);
}

async function waitFor(client, expression, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await evaluate(client, expression)) return true;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for UI condition: ${expression}`);
}

async function capture(client, filename) {
  const result = await client.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(filename, Buffer.from(result.data, "base64"));
}

function report(payload) {
  const output = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(path.join(outputDirectory, "verification.json"), output);
  process.stdout.write(output);
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  if (remoteOnly) {
    const targets = await json("/json/list");
    const remoteTarget = targets.find((entry) => String(entry.title || "") === "CharaDock Link"
      || (/^https?:\/\//.test(String(entry.url || "")) && String(entry.url || "").includes(":41317/") && !String(entry.url || "").includes("/api/mcp-app")));
    if (!remoteTarget) throw new Error("Remote CharaDock Link target was not found");
    const remoteClient = await new CdpClient(remoteTarget.webSocketDebuggerUrl).connect();
    await remoteClient.call("Page.enable");
    await remoteClient.call("Runtime.enable");
    await remoteClient.call("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
    await waitFor(remoteClient, `(() => document.querySelector("#previewDialog")?.classList.contains("is-mcp-app") && document.querySelector("#previewDialog")?.open)()`, 30_000);
    await delay(1_000);
    const remote = await evaluate(remoteClient, `(() => ({
      title: document.querySelector("#previewTitle")?.textContent || "",
      open: document.querySelector("#previewDialog")?.open === true,
      nonModal: !document.querySelector("#previewDialog")?.matches(":modal"),
      mcpApp: document.querySelector("#previewDialog")?.classList.contains("is-mcp-app") === true,
      composerVisible: document.querySelector("#messageForm")?.getBoundingClientRect().height > 0,
      frameUrl: document.querySelector("#previewBody iframe")?.src || ""
    }))()`);
    const remoteScreenshot = path.join(outputDirectory, "mcp-app-remote.png");
    await capture(remoteClient, remoteScreenshot);
    remoteClient.close();
    report({ entrySurface: "remote", remote, remoteScreenshot });
    return;
  }
  const controlTarget = await targetByUrl("/desktop/control.html", 15_000);
  const control = await new CdpClient(controlTarget.webSocketDebuggerUrl).connect();
  await control.call("Page.enable");
  await control.call("Runtime.enable");
  if (inspectOnly) {
    const inspectedTarget = await targetByUrl("/desktop/artifact-preview.html", 15_000);
    const inspected = await new CdpClient(inspectedTarget.webSocketDebuggerUrl).connect();
    await inspected.call("Runtime.enable");
    const snapshot = await evaluate(inspected, `(() => ({
      readyState: document.readyState,
      classes: document.body?.className || "",
      title: document.querySelector("#previewTitle")?.textContent || "",
      bodyText: document.body?.innerText?.slice(0, 1000) || "",
      frames: [...document.querySelectorAll("iframe")].map((frame) => frame.src),
      status: document.querySelector("#previewStatus")?.textContent || ""
    }))()`);
    snapshot.remoteStatus = await evaluate(control, "window.mascotDesktop.getRemoteStatus()");
    inspected.close();
    control.close();
    report(snapshot);
    return;
  }
  if (!observeOnly && surface === "settings") await evaluate(control, `(() => {
      const input = document.querySelector("#chatInput");
      if (!input || !window.mascotDesktop?.sendChat) throw new Error("Settings chat composer unavailable");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      window.__mcpAppVerificationState = { status: "pending" };
      window.__mcpAppVerification = window.mascotDesktop.sendChat({
        message: ${JSON.stringify(message)},
        selectedMcpServerIds: ["mcp-67ecf7c218e115bf"]
      }).then((result) => {
        window.__mcpAppVerificationState = { status: "completed", text: String(result?.text || "").slice(0, 300) };
        return result;
      }).catch((error) => {
        window.__mcpAppVerificationState = { status: "failed", message: String(error?.message || error) };
        throw error;
      });
      return true;
    })()`);
  if (!observeOnly && surface === "mascot") {
    const mascotTarget = await targetByUrl("?mode=obs", 15_000);
    const mascot = await new CdpClient(mascotTarget.webSocketDebuggerUrl).connect();
    await mascot.call("Runtime.enable");
    await evaluate(mascot, `(() => {
      const input = document.querySelector("#desktopMascotInput");
      const form = document.querySelector("#desktopMascotComposer");
      if (!input || !form) throw new Error("Desktop mascot composer unavailable");
      input.value = ${JSON.stringify(message)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    })()`);
    mascot.close();
  }

  let previewTarget = null;
  const previewDeadline = Date.now() + 120_000;
  do {
    const targets = await json("/json/list");
    previewTarget = targets.find((entry) => String(entry.url || "").includes("/desktop/artifact-preview.html"));
    if (previewTarget) break;
    if (!observeOnly && surface === "settings") {
      const verification = await evaluate(control, "window.__mcpAppVerificationState");
      if (verification?.status === "failed") throw new Error(`Chat request failed: ${verification.message}`);
      if (verification?.status === "completed") throw new Error(`The MCP turn completed without opening a card: ${verification.text}`);
    }
    await delay(300);
  } while (Date.now() < previewDeadline);
  if (!previewTarget) throw new Error("Timed out waiting for the MCP card preview");
  const preview = await new CdpClient(previewTarget.webSocketDebuggerUrl).connect();
  await preview.call("Page.enable");
  await preview.call("Runtime.enable");
  await waitFor(preview, `(() => document.body.classList.contains("is-mcp-app") && Boolean(document.querySelector("#previewBody iframe")))()`, 60_000);
  await delay(2_000);
  const pc = await evaluate(preview, `(() => ({
    title: document.querySelector("#previewTitle")?.textContent || "",
    subtitle: document.querySelector("#previewPath")?.textContent || "",
    kind: document.querySelector("#previewKind")?.textContent || "",
    frameUrl: document.querySelector("#previewBody iframe")?.src || "",
    revisionHidden: document.querySelector(".revision-panel")?.hidden === true,
    openHidden: document.querySelector("#openButton")?.hidden === true
  }))()`);
  pc.entrySurface = surface;
  const currentPreview = await evaluate(preview, "window.charadockArtifactPreview.getCurrent()");
  const appId = currentPreview?.preview?.mcpApp?.id || "";
  if (!appId) throw new Error("The active MCP App id is unavailable");
  const bridgeContext = await evaluate(preview, `window.charadockArtifactPreview.mcpAppBridge(${JSON.stringify({ appId: "__APP_ID__", method: "host/context", params: {} }).replace("__APP_ID__", appId)})`);
  pc.redirectDomains = bridgeContext?.csp?.redirectDomains || [];
  if (exerciseBridge) {
    const stateValue = { selected: "verification", at: 1 };
    await evaluate(preview, `window.charadockArtifactPreview.mcpAppBridge(${JSON.stringify({ appId: "__APP_ID__", method: "ui/set-widget-state", params: { state: { selected: "verification", at: 1 } } }).replace("__APP_ID__", appId)})`);
    const afterState = await evaluate(preview, `window.charadockArtifactPreview.mcpAppBridge(${JSON.stringify({ appId: "__APP_ID__", method: "host/context", params: {} }).replace("__APP_ID__", appId)})`);
    pc.widgetStateRoundTrip = JSON.stringify(afterState?.widgetState) === JSON.stringify(stateValue);
    pc.cardToolCall = await evaluate(preview, `(async () => {
      try {
        const result = await window.charadockArtifactPreview.mcpAppBridge({
          appId: ${JSON.stringify(appId)},
          method: "tools/call",
          params: { name: "search_nikechan_knowledge", arguments: { query: "AITuberKit", limit: 1 } }
        });
        return { status: "completed", result: Boolean(result) };
      } catch (error) {
        return { status: "blocked", message: String(error?.message || error).slice(0, 300) };
      }
    })()`);
  }
  const pcScreenshot = path.join(outputDirectory, "mcp-app-pc.png");
  await capture(preview, pcScreenshot);
  if (pcOnly || !includeRemote) {
    preview.close();
    control.close();
    report({ entrySurface: surface, pc, pcScreenshot });
    return;
  }

  const remoteStatus = await evaluate(control, "window.mascotDesktop.getRemoteStatus()");
  const pairingUrl = String(remoteStatus?.pairingUrl || "");
  let remote = null;
  let remoteScreenshot = "";
  if (pairingUrl) {
    const browserInfo = await json("/json/version");
    const browser = await new CdpClient(browserInfo.webSocketDebuggerUrl).connect();
    const created = await browser.call("Target.createTarget", { url: pairingUrl, width: 430, height: 900, newWindow: true, background: false });
    const attached = await browser.call("Target.attachToTarget", { targetId: created.targetId, flatten: true });
    const remoteSessionId = attached.sessionId;
    await browser.call("Page.enable", {}, remoteSessionId);
    await browser.call("Runtime.enable", {}, remoteSessionId);
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: true }, remoteSessionId);
    const remoteEvaluate = async (expression) => {
      const result = await browser.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, remoteSessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Remote renderer evaluation failed");
      return result.result?.value;
    };
    const deadline = Date.now() + 60_000;
    do {
      if (await remoteEvaluate(`(() => document.querySelector("#previewDialog")?.classList.contains("is-mcp-app") && document.querySelector("#previewDialog")?.open)()`)) break;
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the remote MCP card");
      await delay(300);
    } while (true);
    await delay(1_500);
    remote = await remoteEvaluate(`(() => ({
      title: document.querySelector("#previewTitle")?.textContent || "",
      open: document.querySelector("#previewDialog")?.open === true,
      nonModal: !document.querySelector("#previewDialog")?.matches(":modal"),
      mcpApp: document.querySelector("#previewDialog")?.classList.contains("is-mcp-app") === true,
      composerVisible: document.querySelector("#messageForm")?.getBoundingClientRect().height > 0,
      frameUrl: document.querySelector("#previewBody iframe")?.src || ""
    }))()`);
    const screenshot = await browser.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true }, remoteSessionId);
    remoteScreenshot = path.join(outputDirectory, "mcp-app-remote.png");
    fs.writeFileSync(remoteScreenshot, Buffer.from(screenshot.data, "base64"));
    await browser.call("Target.closeTarget", { targetId: created.targetId });
    browser.close();
  }

  preview.close();
  control.close();
  report({ entrySurface: surface, pc, remote, pcScreenshot, remoteScreenshot });
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
