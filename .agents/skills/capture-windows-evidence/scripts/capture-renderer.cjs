// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

function options(argv) {
  const result = { port: 9222, title: "", url: "mode=obs", output: "", audioOutput: "", audioTestTone: false, captureMode: "screenshots", duration: 0, fps: 30, delayMs: 600, timeoutMs: 20_000, waitSelector: "", stopSelector: "", overwrite: false };
  for (const argument of argv) {
    if (argument === "--overwrite") result.overwrite = true;
    else if (argument === "--audio-test-tone") result.audioTestTone = true;
    else if (argument.startsWith("--")) {
      const separator = argument.indexOf("=");
      if (separator < 0) throw new Error(`Expected --name=value: ${argument}`);
      const key = argument.slice(2, separator).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!(key in result)) throw new Error(`Unknown option: ${argument.slice(0, separator)}`);
      result[key] = argument.slice(separator + 1);
    }
  }
  for (const key of ["port", "duration", "fps", "delayMs", "timeoutMs"]) result[key] = Number(result[key]);
  if (!path.isAbsolute(result.output)) throw new Error("--output must be an absolute path.");
  if (result.audioOutput && !path.isAbsolute(result.audioOutput)) throw new Error("--audio-output must be an absolute path.");
  if (!(result.port > 0 && result.port < 65536)) throw new Error("--port is invalid.");
  if (!(result.fps > 0 && result.fps <= 60)) throw new Error("--fps must be between 1 and 60.");
  if (!(result.duration >= 0 && result.duration <= 3600)) throw new Error("--duration must be between 0 and 3600 seconds.");
  if (!["screenshots", "screencast"].includes(result.captureMode)) throw new Error("--capture-mode must be screenshots or screencast.");
  return result;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.events = []; this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (!payload.id) {
        this.events.push(payload);
        for (const listener of this.listeners.get(payload.method) || []) listener(payload.params || {});
        return;
      }
      if (!this.pending.has(payload.id)) return;
      const pending = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) pending.reject(new Error(payload.error.message));
      else pending.resolve(payload.result || {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }
  close() { this.socket?.close(); }
}

async function targetFor(config) {
  const deadline = Date.now() + config.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${config.port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const titlePart = String(config.title || "").toLowerCase();
      const urlPart = String(config.url || "").toLowerCase();
      const matching = targets.filter((target) => target.type === "page"
        && (!titlePart || String(target.title || "").toLowerCase().includes(titlePart))
        && (!urlPart || String(target.url || "").toLowerCase().includes(urlPart)));
      if (matching[0]) return matching[0];
    } catch {}
    await delay(200);
  }
  throw new Error(`No renderer matching title="${config.title}" url="${config.url}" appeared on port ${config.port}.`);
}

async function selectorMatches(client, selector) {
  if (!selector) return true;
  const result = await client.send("Runtime.evaluate", { expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`, returnByValue: true });
  return Boolean(result.result?.value);
}

async function evaluate(client, expression, contextId) {
  const result = await client.send("Runtime.evaluate", { expression, contextId, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.value;
}

const installAudioCaptureExpression = `(() => {
  if (globalThis.__charadockEvidenceAudio) return true;
  const state = { entries: [], segments: [], contexts: new WeakMap(), sessionStartedAt: performance.now() };
  const createRecorder = (stream) => {
    if (!stream?.getAudioTracks?.().length || typeof MediaRecorder !== 'function') return null;
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const chunks = [];
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const entry = { recorder, done, startedOffsetMs: Math.max(0, performance.now() - state.sessionStartedAt) };
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
    recorder.addEventListener('stop', () => {
      if (!chunks.length) { resolveDone(); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        state.segments.push({ mimeType: blob.type, dataUrl: String(reader.result || ''), startedOffsetMs: entry.startedOffsetMs });
        resolveDone();
      }, { once: true });
      reader.readAsDataURL(blob);
    }, { once: true });
    recorder.start(100);
    state.entries.push(entry);
    return entry;
  };
  const attach = (element) => {
    if (!element || element.__charadockEvidenceAttached || element.muted || element.volume <= 0) return;
    element.__charadockEvidenceAttached = true;
    let stream;
    try { stream = element.captureStream?.(); } catch { return; }
    const entry = createRecorder(stream);
    if (!entry) return;
    const stop = () => { if (entry.recorder.state !== 'inactive') entry.recorder.stop(); };
    element.addEventListener('ended', stop, { once: true });
  };
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const result = nativePlay.apply(this, args);
    Promise.resolve(result).then(() => attach(this)).catch(() => {});
    return result;
  };
  const nativeConnect = AudioNode.prototype.connect;
  const captureForContext = (context) => {
    if (state.contexts.has(context)) return state.contexts.get(context);
    const destination = context.createMediaStreamDestination();
    const entry = createRecorder(destination.stream);
    const capture = entry ? { destination, entry } : null;
    state.contexts.set(context, capture);
    return capture;
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    try {
      const context = this.context;
      if (context && destination === context.destination && !this.__charadockEvidenceOutputAttached) {
        const capture = captureForContext(context);
        if (capture) {
          this.__charadockEvidenceOutputAttached = true;
          nativeConnect.call(this, capture.destination);
        }
      }
    } catch {}
    return result;
  };
  state.finish = async () => {
    for (const entry of state.entries) if (entry.recorder.state !== 'inactive') entry.recorder.stop();
    await Promise.all(state.entries.map((entry) => entry.done));
    return state.segments;
  };
  globalThis.__charadockEvidenceAudio = state;
  return true;
})()`;

async function installAudioCapture(client) {
  await delay(150);
  const contexts = client.events.filter((event) => event.method === "Runtime.executionContextCreated").map((event) => event.params?.context).filter(Boolean);
  const preferred = contexts.filter((context) => context.name === "Electron Isolated Context");
  const candidates = [...preferred, ...contexts.filter((context) => !preferred.some((item) => item.id === context.id))];
  const installed = [];
  for (const context of candidates) {
    try { if (await evaluate(client, installAudioCaptureExpression, context.id)) installed.push(context.id); } catch {}
  }
  // Runtime.evaluate without a context id targets the page's default world.
  // Keep it explicitly so Web Audio created by the app is collected even when
  // an already-running Electron page does not replay every default context.
  try { if (await evaluate(client, installAudioCaptureExpression)) installed.push(undefined); } catch {}
  if (!installed.length) throw new Error("Could not install renderer audio capture in an Electron execution context.");
  return [...new Set(installed)];
}

async function saveAudioCapture(client, contextIds, destination) {
  const segments = [];
  for (const contextId of contextIds) {
    try {
      const captured = await evaluate(client, `(async () => globalThis.__charadockEvidenceAudio?.finish ? globalThis.__charadockEvidenceAudio.finish() : [])()`, contextId);
      if (Array.isArray(captured)) segments.push(...captured.filter((segment) => segment?.dataUrl));
    } catch {}
  }
  if (!segments.length) throw new Error("No app audio was captured. Start capture before playback and verify the selected profile can speak.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const parsed = path.parse(destination);
  const outputs = [];
  const outputSegments = [];
  for (let index = 0; index < segments.length; index += 1) {
    const output = segments.length === 1 ? destination : path.join(parsed.dir, `${parsed.name}-${String(index + 1).padStart(3, "0")}${parsed.ext || ".webm"}`);
    fs.writeFileSync(output, Buffer.from(String(segments[index].dataUrl).split(",", 2)[1] || "", "base64"));
    if (fs.statSync(output).size > 0) {
      outputs.push(output);
      outputSegments.push({ output, startedOffsetMs: Number(segments[index].startedOffsetMs) || 0 });
    }
  }
  fs.writeFileSync(path.join(parsed.dir, `${parsed.name}.json`), `${JSON.stringify({ outputs, segments: outputSegments, segmentCount: outputs.length }, null, 2)}\n`);
  return outputs;
}

function diagnosticToneDataUrl() {
  const sampleRate = 16_000;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 1800), 44 + index * 2);
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

async function playDiagnosticTone(client, contextIds) {
  const dataUrl = diagnosticToneDataUrl();
  for (const contextId of contextIds) {
    try {
      const started = await evaluate(client, `(async () => { const audio = new Audio(${JSON.stringify(dataUrl)}); globalThis.__charadockEvidenceTestTone = audio; await audio.play(); return true; })()`, contextId);
      if (started) return;
    } catch {}
  }
  throw new Error("Could not play the renderer audio diagnostic tone.");
}

function prepareOutput(config) {
  if (config.duration <= 0) {
    if (path.extname(config.output).toLowerCase() !== ".png") throw new Error("A one-shot output must end in .png.");
    if (fs.existsSync(config.output) && !config.overwrite) throw new Error("Output exists; pass --overwrite to replace it.");
    fs.mkdirSync(path.dirname(config.output), { recursive: true });
    return;
  }
  if (fs.existsSync(config.output)) {
    if (!config.overwrite) throw new Error("Output directory exists; pass --overwrite to replace it.");
    fs.rmSync(config.output, { recursive: true, force: true });
  }
  fs.mkdirSync(config.output, { recursive: true });
}

async function screenshot(client) {
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data || "", "base64");
  if (bytes.length < 100) throw new Error("Captured screenshot was empty.");
  return bytes;
}

async function screencastFrames(client, config) {
  const sourceFrames = [];
  let startedAt = 0;
  const removeListener = client.on("Page.screencastFrame", (params) => {
    const timestamp = Number(params.metadata?.timestamp) || performance.now() / 1000;
    if (!startedAt) startedAt = timestamp;
    sourceFrames.push({ timestamp: Math.max(0, timestamp - startedAt), bytes: Buffer.from(params.data || "", "base64") });
    client.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });
  await client.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  const started = performance.now();
  while ((performance.now() - started) / 1000 < config.duration) {
    if (config.stopSelector && await selectorMatches(client, config.stopSelector)) break;
    await delay(40);
  }
  await client.send("Page.stopScreencast").catch(() => {});
  removeListener();
  if (!sourceFrames.length) throw new Error("The renderer did not emit any screencast frames.");
  const elapsedSeconds = (performance.now() - started) / 1000;
  const outputFrames = Math.max(1, Math.ceil(elapsedSeconds * config.fps));
  let sourceIndex = 0;
  for (let index = 0; index < outputFrames; index += 1) {
    const targetTime = index / config.fps;
    while (sourceIndex + 1 < sourceFrames.length && sourceFrames[sourceIndex + 1].timestamp <= targetTime) sourceIndex += 1;
    fs.writeFileSync(path.join(config.output, `frame-${String(index).padStart(5, "0")}.png`), sourceFrames[sourceIndex].bytes);
  }
  return {
    frameCount: outputFrames,
    elapsedSeconds,
    measuredFps: outputFrames / elapsedSeconds,
    sourceFrameCount: sourceFrames.length,
    sourceFps: sourceFrames.length / elapsedSeconds,
  };
}

async function main() {
  const config = options(process.argv.slice(2));
  prepareOutput(config);
  const target = await targetFor(config);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    const audioContexts = config.audioOutput ? await installAudioCapture(client) : [];
    if (config.audioTestTone) {
      if (!config.audioOutput || config.duration <= 0) throw new Error("--audio-test-tone requires --audio-output and a positive --duration.");
      await playDiagnosticTone(client, audioContexts);
    }
    await delay(config.delayMs);
    const waitDeadline = Date.now() + config.timeoutMs;
    while (!(await selectorMatches(client, config.waitSelector))) {
      if (Date.now() >= waitDeadline) throw new Error(`Timed out waiting for selector: ${config.waitSelector}`);
      await delay(100);
    }
    if (config.duration <= 0) {
      fs.writeFileSync(config.output, await screenshot(client));
      console.log(JSON.stringify({ mode: "screenshot", title: target.title, output: config.output }));
      return;
    }
    let frameCount;
    let elapsedSeconds;
    let measuredFps;
    let sourceFrameCount = null;
    let sourceFps = null;
    if (config.captureMode === "screencast") {
      const capture = await screencastFrames(client, config);
      ({ frameCount, elapsedSeconds, measuredFps, sourceFrameCount, sourceFps } = capture);
    } else {
      const startedAt = performance.now();
      const requestedFrames = Math.ceil(config.duration * config.fps);
      frameCount = 0;
      for (; frameCount < requestedFrames; frameCount += 1) {
        fs.writeFileSync(path.join(config.output, `frame-${String(frameCount).padStart(5, "0")}.png`), await screenshot(client));
        if (frameCount > 1 && config.stopSelector && await selectorMatches(client, config.stopSelector)) { frameCount += 1; break; }
        const nextFrameAt = startedAt + (frameCount + 1) * (1000 / config.fps);
        await delay(Math.max(0, nextFrameAt - performance.now()));
      }
      elapsedSeconds = (performance.now() - startedAt) / 1000;
      measuredFps = frameCount / elapsedSeconds;
    }
    const audioOutputs = config.audioOutput ? await saveAudioCapture(client, audioContexts, config.audioOutput) : [];
    const metadata = { mode: "frames", captureMode: config.captureMode, title: target.title, output: config.output, frameCount, duration: elapsedSeconds, fps: measuredFps, requestedFps: config.fps, sourceFrameCount, sourceFps, audioOutputs };
    fs.writeFileSync(path.join(config.output, "capture.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(JSON.stringify(metadata));
  } finally { client.close(); }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
