// SPDX-License-Identifier: Apache-2.0
(() => {
  const api = window.atomEchoLive;
  const { LiveOutputGate } = window.CharaDockAtomEchoLiveAudio;
  let peer = null;
  let dataChannel = null;
  let inputContext = null;
  let inputDestination = null;
  let inputSilence = null;
  let nextInputTime = 0;
  let realtimeStarted = false;
  let peerConnected = false;
  let sessionStarting = false;
  let inputFrames = [];
  let inputBytes = 0;
  let remoteAudio = null;
  let remoteTrack = null;
  let captureReader = null;
  let captureTask = null;
  let beatriceEnabled = false;
  let beatriceFrames = [];
  let beatriceSamples = 0;
  let beatriceOffset = 0;

  const exactArrayBuffer = (value) => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return null;
  };

  const report = (state, error = "") => api.reportStatus({ state, error: String(error || "").slice(0, 500), beatrice: beatriceEnabled });

  const outputGate = new LiveOutputGate({
    onStart: () => api.outputStart(),
    onChunk: (samples, sampleRate) => api.outputChunk(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength), sampleRate),
    onEnd: () => api.outputEnd(),
  });
  // Realtime output is authorized only after the server has observed the
  // physical user's turn. This also prevents the tail of an interrupted
  // answer from reopening the half-duplex speaker before the next transcript.
  outputGate.setSuppressed(true);

  function monoAudioData(audio) {
    const frames = audio.numberOfFrames;
    const channels = audio.numberOfChannels;
    const mono = new Float32Array(frames);
    for (let channel = 0; channel < channels; channel += 1) {
      const plane = new Float32Array(frames);
      audio.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
      for (let index = 0; index < frames; index += 1) mono[index] += plane[index] / channels;
    }
    return mono;
  }

  function resample(samples, sourceRate, targetRate) {
    if (sourceRate === targetRate) return samples;
    const length = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
    const output = new Float32Array(length);
    const scale = sourceRate / targetRate;
    for (let index = 0; index < length; index += 1) {
      const position = index * scale;
      const left = Math.min(samples.length - 1, Math.floor(position));
      const right = Math.min(samples.length - 1, left + 1);
      const mix = position - left;
      output[index] = samples[left] * (1 - mix) + samples[right] * mix;
    }
    return output;
  }

  function pushBeatrice(samples, sampleRate) {
    const normalized = resample(samples, sampleRate, 48_000);
    beatriceFrames.push(normalized);
    beatriceSamples += normalized.length;
    while (beatriceSamples >= 480) {
      const frame = new Float32Array(480);
      let written = 0;
      while (written < frame.length) {
        const source = beatriceFrames[0];
        const count = Math.min(frame.length - written, source.length - beatriceOffset);
        frame.set(source.subarray(beatriceOffset, beatriceOffset + count), written);
        written += count;
        beatriceOffset += count;
        beatriceSamples -= count;
        if (beatriceOffset === source.length) {
          beatriceFrames.shift();
          beatriceOffset = 0;
        }
      }
      api.pushBeatriceAudio(frame.buffer);
    }
  }

  async function stopCapture() {
    const reader = captureReader;
    captureReader = null;
    try { await reader?.cancel(); } catch {}
    captureTask = null;
    beatriceFrames = [];
    beatriceSamples = 0;
    beatriceOffset = 0;
  }

  function startCapture(track, converter) {
    if (typeof MediaStreamTrackProcessor !== "function") throw new Error("このElectronではATOM EchoのLive回答音声を取得できません。");
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    captureReader = reader;
    captureTask = (async () => {
      try {
        while (captureReader === reader) {
          const { value: audio, done } = await reader.read();
          if (done) break;
          try {
            const mono = monoAudioData(audio);
            if (converter) pushBeatrice(mono, audio.sampleRate);
            else outputGate.push(mono, audio.sampleRate);
          } finally {
            audio.close();
          }
        }
      } catch (error) {
        if (captureReader === reader) report("error", error?.message || error);
      }
    })();
  }

  async function startRemoteOutput(stream, useBeatrice) {
    await stopCapture();
    remoteAudio?.pause();
    remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.muted = true;
    remoteAudio.srcObject = stream;
    await remoteAudio.play();
    remoteTrack = stream.getAudioTracks()[0] || null;
    if (!remoteTrack) throw new Error("Realtimeの回答音声トラックがありません。");
    beatriceEnabled = false;
    if (useBeatrice) {
      try {
        await api.startBeatrice();
        beatriceEnabled = true;
        startCapture(remoteTrack, true);
        report("live");
        return;
      } catch (error) {
        await api.stopBeatrice().catch(() => {});
        report("fallback", error?.message || error);
      }
    }
    startCapture(remoteTrack, false);
  }

  async function closeSession({ stopServer = false } = {}) {
    outputGate.reset(true);
    await stopCapture();
    if (beatriceEnabled) await api.stopBeatrice().catch(() => {});
    beatriceEnabled = false;
    remoteTrack = null;
    remoteAudio?.pause();
    if (remoteAudio) remoteAudio.srcObject = null;
    remoteAudio = null;
    try { dataChannel?.close(); } catch {}
    try { peer?.close(); } catch {}
    dataChannel = null;
    peer = null;
    for (const track of inputDestination?.stream?.getTracks?.() || []) track.stop();
    try { inputSilence?.stop(); } catch {}
    try { inputSilence?.disconnect(); } catch {}
    inputSilence = null;
    inputDestination = null;
    nextInputTime = 0;
    try { await inputContext?.close(); } catch {}
    inputContext = null;
    realtimeStarted = false;
    peerConnected = false;
    sessionStarting = false;
    inputFrames = [];
    inputBytes = 0;
    if (stopServer) await api.stopRealtime().catch(() => {});
  }

  function queueInput(value) {
    const buffer = exactArrayBuffer(value);
    if (!buffer || !buffer.byteLength || buffer.byteLength % 2) return;
    if (inputBytes + buffer.byteLength > 16_000 * 2 * 30) return;
    inputFrames.push(buffer);
    inputBytes += buffer.byteLength;
    if (realtimeStarted && peerConnected) flushInput();
  }

  function scheduleInput(buffer) {
    if (!inputContext || !inputDestination) return;
    const pcm = new DataView(buffer);
    const audioBuffer = inputContext.createBuffer(1, pcm.byteLength / 2, 16_000);
    const channel = audioBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) channel[index] = pcm.getInt16(index * 2, true) / 32768;
    const source = inputContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(inputDestination);
    nextInputTime = Math.max(nextInputTime, inputContext.currentTime + .03);
    source.start(nextInputTime);
    nextInputTime += channel.length / 16_000;
  }

  function flushInput() {
    if (!realtimeStarted || !peerConnected || !inputContext) return;
    const frames = inputFrames;
    inputFrames = [];
    inputBytes = 0;
    for (const frame of frames) scheduleInput(frame);
  }

  async function startSession(settings = {}) {
    if (peer || sessionStarting) return;
    sessionStarting = true;
    report("connecting");
    try {
      inputContext = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
      inputDestination = inputContext.createMediaStreamDestination();
      inputSilence = inputContext.createConstantSource();
      inputSilence.offset.value = 0;
      inputSilence.connect(inputDestination);
      inputSilence.start();
      await inputContext.resume();
      peer = new RTCPeerConnection();
      for (const track of inputDestination.stream.getAudioTracks()) peer.addTrack(track, inputDestination.stream);
      peer.addEventListener("track", (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        startRemoteOutput(stream, settings.beatrice === true).catch((error) => report("error", error?.message || error));
      });
      peer.addEventListener("connectionstatechange", () => {
        peerConnected = peer?.connectionState === "connected";
        if (peerConnected) flushInput();
        if (["failed", "disconnected"].includes(peer?.connectionState)) {
          report("error", "Codex Realtime音声接続が切れました。");
          closeSession({ stopServer: true }).catch(() => {});
        }
      });
      dataChannel = peer.createDataChannel("oai-events");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await api.startRealtime({
        sdp: peer.localDescription?.sdp || offer.sdp,
        selectedSkillIds: Array.isArray(settings.selectedSkillIds) ? settings.selectedSkillIds : [],
        selectedMcpServerIds: Array.isArray(settings.selectedMcpServerIds) ? settings.selectedMcpServerIds : [],
      });
    } catch (error) {
      await closeSession();
      report("error", error?.message || error);
    }
  }

  api.onCommand((command = {}) => {
    if (command.type === "start") startSession(command);
    if (command.type === "input-start") {
      outputGate.setSuppressed(true);
      nextInputTime = 0;
    }
    if (command.type === "input") queueInput(command.audio);
    if (command.type === "interrupt") {
      inputFrames = [];
      inputBytes = 0;
      outputGate.setSuppressed(true);
    }
    if (command.type === "stop") closeSession({ stopServer: command.stopServer === true }).then(() => report("idle"));
  });

  api.onRealtime(async (message = {}) => {
    const method = String(message.method || "");
    const params = message.params || {};
    if (method === "thread/realtime/sdp" && peer && params.sdp) {
      await peer.setRemoteDescription({ type: "answer", sdp: String(params.sdp) });
      return;
    }
    if (method === "thread/realtime/started") {
      realtimeStarted = true;
      sessionStarting = false;
      flushInput();
      report("live");
      return;
    }
    if (method.startsWith("thread/realtime/transcript/") && params.role === "assistant") {
      outputGate.setSuppressed(params.suppressed === true);
    }
    if (method.startsWith("thread/realtime/transcript/") && params.role === "user") outputGate.setSuppressed(false);
    if (["thread/realtime/error", "thread/realtime/closed"].includes(method)) {
      const detail = method.endsWith("error") ? String(params.message || "Realtimeを開始できませんでした。") : "";
      await closeSession();
      report(detail ? "error" : "idle", detail);
    }
  });

  api.onBeatriceAudio((value) => {
    if (!beatriceEnabled) return;
    const buffer = exactArrayBuffer(value);
    if (buffer && buffer.byteLength % 4 === 0) outputGate.push(new Float32Array(buffer), 48_000);
  });

  api.onBeatriceError((message) => {
    if (!beatriceEnabled || !remoteTrack) return;
    beatriceEnabled = false;
    stopCapture().then(() => api.stopBeatrice()).catch(() => {}).finally(() => {
      try { startCapture(remoteTrack, false); } catch (error) { report("error", error?.message || error); }
      report("fallback", String(message || "Beatrice 2の変換を継続できません。"));
    });
  });

  api.ready();
})();
