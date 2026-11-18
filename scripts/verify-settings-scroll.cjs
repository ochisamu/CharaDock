// SPDX-License-Identifier: Apache-2.0
// Run with Electron: electron scripts/verify-settings-scroll.cjs <output-directory>
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { MascotStaticServer } = require("../desktop/lib/static-server.cjs");

const output = process.argv[2] && path.resolve(process.argv[2]);
if (!output) throw new Error("Supply an output directory");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));

const root = path.resolve(__dirname, "..");
const server = new MascotStaticServer(root);
const handle = server.handle.bind(server);
const markup = fs.readFileSync(path.join(root, "desktop", "control.html"), "utf8")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
server.handle = (request, response) => {
  if (request.url !== "/desktop/settings-scroll-fixture.html") return handle(request, response);
  // Exercise the shipped markup and CSS without connecting any real devices.
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(markup);
};

async function verify() {
  await app.whenReady();
  await server.start();
  const window = new BrowserWindow({
    width: 1055, height: 862, useContentSize: true, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await window.loadURL(server.origin() + "/desktop/settings-scroll-fixture.html");
  const js = code => window.webContents.executeJavaScript(code);
  const capture = async name => {
    await js("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
    fs.writeFileSync(path.join(output, name), (await window.capturePage()).toPNG());
  };
  const layout = () => js(`(() => {
    const scroller = document.querySelector(".main-panel");
    const root = document.scrollingElement;
    const toggle = document.querySelector("#stackchanTrackFaceToggle");
    return {
      rootOffset: root.scrollTop,
      rootHeight: root.scrollHeight,
      viewportHeight: innerHeight,
      sidebarTop: document.querySelector(".sidebar").getBoundingClientRect().top,
      mainOffset: scroller.scrollTop,
      switchTop: toggle.getBoundingClientRect().top,
      focus: document.activeElement.id,
    };
  })()`);
  const assertShell = state => {
    assert.equal(state.rootOffset, 0, "the whole window must stay at the top");
    assert.equal(state.rootHeight, state.viewportHeight, "only the settings panel can overflow");
    assert.equal(state.sidebarTop, 0, "sidebar stays visible");
  };
  async function assertQuickSwitchesAligned() {
    const { master, heading, switches, privacy, model } = await js(`(() => {
      const left = selector => document.querySelector(selector).getBoundingClientRect().left;
      const row = id => {
        const label = document.getElementById(id).closest("label");
        return {
          left: label.querySelector("span").getBoundingClientRect().left,
          right: label.querySelector("i").getBoundingClientRect().right,
        };
      };
      return {
        master: row("rlcd42EnabledToggle"),
        heading: left("#rlcd42QuickTitle"),
        privacy: left("#stackchanPrivacyStatus"),
        model: left("#characterDeviceBoardSelect"),
        switches: ["rlcd42MicrophoneToggle", "rlcd42SpeakerToggle", "stackchanCameraToggle"].map(row),
      };
    })()`);
    assert.deepEqual(switches, [master, master, master], "quick switches align with the device switch");
    assert.equal(heading, master.left);
    assert.equal(privacy, master.left);
    assert.equal(model, master.left);
  }
  const deviceCards = () => js(`(() => {
    const rect = node => node.getBoundingClientRect().toJSON();
    const card = id => document.getElementById(id).closest("section");
    const mic = card("rlcd42CaptureTitle");
    const speaker = card("rlcd42AudioTitle");
    const camera = card("stackchanCameraTitle");
    const status = document.querySelector("#rlcd42Status");
    return {
      mic: rect(mic), speaker: rect(speaker), camera: rect(camera), status: rect(status),
      gridCards: [mic, speaker, camera].every(card => getComputedStyle(card).display === "grid"),
      panelOverflow: document.querySelector(".main-panel").scrollWidth > document.querySelector(".main-panel").clientWidth,
      pitchHidden: document.querySelector("#stackchanPitchSettings").getClientRects().length === 0,
    };
  })()`);
  await js(`{
    const panel = document.querySelector('[data-page-panel="esp32"]');
    panel.closest("[data-settings-group]").hidden = false;
    document.querySelector("[data-page-panel].is-active").classList.remove("is-active");
    document.querySelector(".nav-tab.is-active").classList.remove("is-active");
    document.querySelector('.nav-tab[data-page="remote"]').classList.add("is-active");
    document.querySelector('.settings-subnav [data-page="esp32"]').classList.add("is-active");
    panel.classList.add("is-active");
    for (const id of ["rlcd42EnabledSettings", "rlcd42QuickControls", "stackchanQuickCamera", "stackchanCameraControls"]) {
      document.getElementById(id).hidden = false;
    }
    document.querySelector("#rlcd42AppearanceTitle").closest("section").hidden = true;
    document.querySelector("#rlcd42SensorDetails").hidden = true;
    document.querySelector("#rlcd42Title").textContent = "StackChan";
    document.querySelector("#stackchanPrivacyStatus").hidden = false;
    document.querySelector("#stackchanPrivacyStatus").textContent = "本体の画面右上の鍵を長押しすると、3つをまとめてオフにできます。";
    document.querySelector("#characterDeviceBoardSelect").value = "m5stack-stackchan-k151";
    for (const id of ["rlcd42EnabledToggle", "rlcd42MicrophoneToggle", "rlcd42SpeakerToggle", "stackchanCameraToggle"]) {
      document.getElementById(id).checked = true;
    }
    document.querySelector("#stackchanCameraStatus").textContent = "待機中にもう一度お試しください。";
    document.querySelector("#rlcd42Status").textContent = "USBで接続中です。";
    document.querySelector("#stackchanTrackFaceToggle").disabled = false;
  }`);
  const initial = await layout();
  assert.equal(initial.mainOffset, 0);
  assert.ok(initial.switchTop > initial.viewportHeight, "camera switch starts below the fold");
  await assertQuickSwitchesAligned();
  await js('document.querySelector("#rlcd42EnabledToggle").focus()');
  await capture("settings-quick-switches.png");
  await js('document.querySelector("#stackchanTrackFaceToggle").focus()');
  const focused = await layout();
  assertShell(focused);
  assert.equal(focused.focus, "stackchanTrackFaceToggle");
  assert.ok(focused.mainOffset > 0 && focused.switchTop >= 0 && focused.switchTop < focused.viewportHeight);
  const wideCards = await deviceCards();
  assert.equal(wideCards.gridCards, true);
  assert.equal(wideCards.pitchHidden, true);
  assert.equal(wideCards.panelOverflow, false);
  assert.equal(wideCards.mic.top, wideCards.speaker.top);
  assert.ok(wideCards.mic.right < wideCards.speaker.left);
  assert.equal(wideCards.camera.left, wideCards.mic.left);
  assert.equal(wideCards.camera.right, wideCards.speaker.right);
  assert.ok(wideCards.status.top > wideCards.camera.bottom);
  assert.equal(wideCards.status.width, wideCards.camera.width);
  await js('document.querySelector(".main-panel").scrollTop = document.querySelector(".main-panel").scrollHeight');
  await capture("settings-wide.png");

  const compactResize = new Promise(resolve => window.once("resize", resolve));
  window.setContentSize(820, 620);
  await compactResize;
  await assertQuickSwitchesAligned();
  await js(`{
    const toggle = document.querySelector("#stackchanTrackFaceToggle");
    toggle.blur();
    document.querySelector(".main-panel").scrollTop = 0;
    toggle.focus();
    document.querySelector("#settingsSearchInput").focus();
  }`);
  const compact = await layout();
  assertShell(compact);
  assert.equal(compact.focus, "settingsSearchInput");
  assert.ok(compact.mainOffset > 0);
  const compactCards = await deviceCards();
  assert.equal(compactCards.panelOverflow, false);
  assert.equal(compactCards.mic.width, compactCards.speaker.width);
  assert.equal(compactCards.speaker.width, compactCards.camera.width);
  assert.ok(compactCards.mic.bottom < compactCards.speaker.top);
  assert.ok(compactCards.speaker.bottom < compactCards.camera.top);
  assert.ok(compactCards.camera.bottom < compactCards.status.top);
  await capture("settings-compact.png");

  const hiddenCards = await js(`["#rlcd42QuickControls", "#stackchanCameraControls"].map(selector => {
    const card = document.querySelector(selector);
    card.hidden = true;
    return card.getClientRects().length;
  })`);
  assert.deepEqual(hiddenCards, [0, 0]);
}

verify().then(async () => {
  await server.stop();
  console.log("Settings scroll and StackChan layout verified");
  app.quit();
}).catch(async error => {
  console.error(error);
  await server.stop().catch(() => {});
  app.exit(1);
});
