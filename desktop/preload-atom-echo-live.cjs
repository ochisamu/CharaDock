// SPDX-License-Identifier: Apache-2.0
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("atomEchoLive", {
  startRealtime: (payload) => ipcRenderer.invoke("atomEcho:liveStart", payload),
  stopRealtime: () => ipcRenderer.invoke("atomEcho:liveStop"),
  startBeatrice: () => ipcRenderer.invoke("beatrice:start"),
  stopBeatrice: () => ipcRenderer.invoke("beatrice:stop"),
  pushBeatriceAudio: (audio) => ipcRenderer.send("beatrice:audio", audio),
  outputStart: () => ipcRenderer.send("atomEcho:liveOutputStart"),
  outputChunk: (audio, sampleRate) => ipcRenderer.send("atomEcho:liveOutputChunk", { audio, sampleRate }),
  outputEnd: () => ipcRenderer.send("atomEcho:liveOutputEnd"),
  reportStatus: (status) => ipcRenderer.send("atomEcho:liveStatus", status),
  ready: () => ipcRenderer.send("atomEcho:liveReady"),
  onCommand: (callback) => subscribe("atomEcho:liveCommand", callback),
  onRealtime: (callback) => subscribe("atomEcho:realtimeEvent", callback),
  onBeatriceAudio: (callback) => subscribe("beatrice:audioOut", callback),
  onBeatriceError: (callback) => subscribe("beatrice:error", callback),
});
