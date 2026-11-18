// SPDX-License-Identifier: Apache-2.0
const http = require("node:http");
const { WebSocket, WebSocketServer } = require("ws");
const { BEATRICE_BLOCK_SAMPLES } = require("./beatrice-v2.cjs");
const { resamplePcm16 } = require("./device-audio.cjs");

const HARU_RATE = 24_000;
const HARU_FRAME_BYTES = 6400;
const MAX_QUEUE_BYTES = HARU_RATE * 2 * 2;

function connectHaruVoice(browser, speechOrigin, createConverter, errorMessage) {
  const speech = new WebSocket(speechOrigin.replace("http:", "ws:") + "/v1/dialogue", {
    origin: speechOrigin, maxPayload: 64 * 1024,
  });
  let pendingInput = new Float32Array(BEATRICE_BLOCK_SAMPLES);
  let inputSize = 0, outstanding = 0, pendingBytes = 0, ended = false, closed = false;
  let previousSample;
  let audio = Buffer.alloc(0), queued = [], microphone = [], microphoneBytes = 0;
  let ready = false, timeout;

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    converter.stop();
    if (speech.readyState !== WebSocket.CLOSED) speech.terminate();
  }

  function fail() {
    if (closed) return;
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(JSON.stringify({ type: "error", error: { message: errorMessage } }));
      browser.close(1011);
    }
    close();
  }

  function flush() {
    while (queued.length && browser.readyState === WebSocket.OPEN && !closed) {
      const next = queued[0];
      if (next.binary && audio.length < next.length) break;
      queued.shift();
      if (next.binary) {
        browser.send(audio.subarray(0, next.length), { binary: true });
        audio = audio.subarray(next.length);
        pendingBytes -= next.length;
      } else {
        browser.send(next.message, { binary: false });
        if (next.terminal) {
          browser.close(1000);
          close();
          break;
        }
      }
    }
  }

  const converter = createConverter({
    onAudio(frame) {
      if (closed) return;
      if (--outstanding < 0) return fail();
      audio = Buffer.concat([audio, resamplePcm16(new Float32Array(frame), 48_000, HARU_RATE)]);
      flush();
      if (!outstanding) clearTimeout(timeout);
    },
    onError: fail,
  });

  function pushBlock() {
    outstanding++;
    if (!converter.push(pendingInput.buffer)) return fail();
    if (outstanding === 1) {
      clearTimeout(timeout);
      timeout = setTimeout(fail, 2500);
    }
    pendingInput = new Float32Array(BEATRICE_BLOCK_SAMPLES);
    inputSize = 0;
  }

  function flushMicrophone() {
    if (closed || !ready || speech.readyState !== WebSocket.OPEN) return;
    for (const { message, binary } of microphone) speech.send(message, { binary });
    microphone = [];
    microphoneBytes = 0;
  }

  speech.on("open", flushMicrophone);
  speech.on("error", fail);
  speech.on("close", () => { if (!ended) fail(); });
  browser.on("close", close);
  browser.on("error", close);
  browser.on("message", (message, binary) => {
    if (closed) return;
    if (ready && speech.readyState === WebSocket.OPEN) {
      if (speech.bufferedAmount > MAX_QUEUE_BYTES) return fail();
      speech.send(message, { binary });
      return;
    }
    microphoneBytes += message.length;
    if (microphoneBytes > MAX_QUEUE_BYTES || microphone.length >= 64) return fail();
    microphone.push({ message, binary });
  });

  speech.on("message", (message, binary) => {
    if (closed) return;
    if (!binary) {
      let data;
      try { data = JSON.parse(message.toString("utf8")); } catch { return fail(); }
      if (data.type === "started" && (data.sample_rate !== HARU_RATE || data.frame_samples * 2 !== HARU_FRAME_BYTES)) return fail();
      ended = data.type === "end" || data.type === "error";
      if (queued.length >= 64) return fail();
      queued.push({ message, terminal: ended });
      if (ended && inputSize) pushBlock();
      flush();
      return;
    }
    pendingBytes += message.length;
    if (message.length !== HARU_FRAME_BYTES || pendingBytes > MAX_QUEUE_BYTES
      || browser.bufferedAmount > MAX_QUEUE_BYTES) return fail();
    queued.push({ binary: true, length: message.length });
    for (let offset = 0; offset < message.length && !closed; offset += 2) {
      const sample = message.readInt16LE(offset) / 32768;
      pendingInput[inputSize++] = (sample + (previousSample ?? sample)) / 2;
      pendingInput[inputSize++] = sample;
      previousSample = sample;
      if (inputSize === BEATRICE_BLOCK_SAMPLES) pushBlock();
    }
  });

  Promise.resolve().then(() => { if (!closed) return converter.start(); }).then(() => {
    ready = true;
    flushMicrophone();
  }).catch(fail);
}

async function startHaruVoiceProxy(speechOrigin, createConverter, errorMessage) {
  const target = new URL(speechOrigin);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let origin;
  const accepts = (request) => request.headers.host === new URL(origin).host
    && (!request.headers.origin || request.headers.origin === origin)
    && request.url?.startsWith("/") && !request.url.startsWith("//");
  const server = http.createServer((request, response) => {
    if (!accepts(request)) return response.writeHead(403).end();
    const headers = { ...request.headers, host: target.host };
    if (headers.origin) headers.origin = target.origin;
    const upstream = http.request(target, { path: request.url, method: request.method, headers }, (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else response.writeHead(502).end();
    });
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on("upgrade", (request, socket, head) => {
    if (!accepts(request) || request.headers.origin !== origin || request.url !== "/v1/dialogue"
      || sockets.clients.size) return socket.destroy();
    sockets.handleUpgrade(request, socket, head, (browser) => {
      connectHaruVoice(browser, speechOrigin, createConverter, errorMessage);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    origin,
    stop() {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.close();
      server.closeAllConnections();
    },
  };
}

module.exports = { startHaruVoiceProxy };
