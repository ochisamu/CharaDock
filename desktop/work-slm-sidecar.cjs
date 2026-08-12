// SPDX-License-Identifier: Apache-2.0
const path = require("node:path");
const { SIDECAR_CHANNEL } = require("./lib/work-slm-sidecar-client.cjs");

function send(event, payload = {}) {
  process.send?.({ channel: SIDECAR_CHANNEL, event, payload });
}

async function runWorkSlmSidecar({ app, BrowserWindow, ipcMain }) {
  if (!app.isPackaged) process.stderr.write(`[Work SLM sidecar] boot ${JSON.stringify(process.argv)}\n`);
  let window = null;
  ipcMain.on("workSlm:ready", (event, payload = {}) => {
    if (event.sender !== window?.webContents) return;
    send("ready", payload);
  });
  ipcMain.on("workSlm:progress", (event, payload = {}) => {
    if (event.sender !== window?.webContents) return;
    send("progress", payload);
  });
  ipcMain.on("workSlm:result", (event, payload = {}) => {
    if (event.sender !== window?.webContents) return;
    send("result", payload);
  });

  window = new BrowserWindow({
    title: "CharaDock Work SLM Sidecar",
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload: path.join(__dirname, "preload-work-slm.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  if (!app.isPackaged) process.stderr.write("[Work SLM sidecar] window-created\n");
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) => {
    send("fatal", { error: `Work SLM renderer stopped: ${details.reason}` });
    app.exit(1);
  });
  await window.loadFile(path.join(__dirname, "work-slm.html"));
  if (!app.isPackaged) process.stderr.write("[Work SLM sidecar] renderer-loaded\n");

  process.on("message", (message) => {
    if (message?.channel !== SIDECAR_CHANNEL) return;
    if (message.event === "shutdown") {
      app.quit();
      return;
    }
    if (message.event === "request" && !window.isDestroyed()) {
      window.webContents.send("workSlm:request", message.payload || {});
    }
  });
  process.on("disconnect", () => app.quit());
  app.on("window-all-closed", () => app.quit());
}

module.exports = { runWorkSlmSidecar };
