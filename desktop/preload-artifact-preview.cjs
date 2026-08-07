// SPDX-License-Identifier: Apache-2.0
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("charadockArtifactPreview", {
  getCurrent: () => ipcRenderer.invoke("artifactPreview:getCurrent"),
  close: () => ipcRenderer.invoke("artifactPreview:close"),
  openArtifact: () => ipcRenderer.invoke("artifactPreview:openArtifact"),
  openExternalUrl: (url) => ipcRenderer.invoke("app:openExternalUrl", url),
  startWebPreview: (payload) => ipcRenderer.invoke("artifactPreview:webPreviewStart", payload),
  stopWebPreview: () => ipcRenderer.invoke("artifactPreview:webPreviewStop"),
  openWebPreview: () => ipcRenderer.invoke("artifactPreview:webPreviewOpen"),
  onShow: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("artifactPreview:show", listener);
    return () => ipcRenderer.removeListener("artifactPreview:show", listener);
  },
  onWebPreview: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("artifactPreview:webPreviewState", listener);
    return () => ipcRenderer.removeListener("artifactPreview:webPreviewState", listener);
  },
});
