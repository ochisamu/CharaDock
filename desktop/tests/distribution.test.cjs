// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

test("desktop distribution contains only approved character, voice, and interface assets", () => {
  const files = packageJson.build.files;
  const assetEntries = files.filter((entry) => entry.startsWith("assets/"));
  assert.deepEqual(assetEntries.sort(), [
    "assets/amber-avatar/**/*",
    "assets/bronze-avatar/**/*",
    "assets/reference-voices/**/*",
    "assets/sage-avatar/**/*",
    "assets/towa-avatar/**/*",
    "assets/ui/**/*",
  ]);
  assert.equal(files.some((entry) => entry.includes("demo-avatar")), false);
  assert.equal(files.includes("favicon.ico"), false);
});

test("interface symbols use individually licensed SVG assets", () => {
  const iconDirectory = path.join(projectRoot, "assets", "ui", "icons");
  const icons = fs.readdirSync(iconDirectory).filter((file) => file.endsWith(".svg"));
  assert.ok(icons.length >= 18);
  for (const icon of icons) {
    const svg = fs.readFileSync(path.join(iconDirectory, icon), "utf8");
    assert.match(svg, /@license Lucide/);
    assert.match(svg, /viewBox="0 0 24 24"/);
  }
  for (const cssFile of ["control.css", "mascot-overlay.css"]) {
    const css = fs.readFileSync(path.join(projectRoot, "desktop", cssFile), "utf8");
    assert.doesNotMatch(css, /charadock-symbols\.png/);
  }
});

test("desktop distribution includes its license and modification records", () => {
  const files = packageJson.build.files;
  for (const required of ["LICENSE", "NOTICE", "MODIFICATIONS.md", "DISTRIBUTION_ASSET_LICENSE.md", "THIRD_PARTY_NOTICES.md"]) {
    assert.equal(files.includes(required), true, `${required} must be packaged`);
  }
});

test("Windows package metadata identifies ochisamu as the publisher", () => {
  assert.equal(packageJson.author, "ochisamu");
  assert.match(packageJson.build.copyright, /ochisamu/);
});

test("Beatrice integration packages only CharaDock's host helper", () => {
  assert.equal(packageJson.build.extraResources, undefined);
  assert.deepEqual(packageJson.build.win.extraResources, [{
    from: "native/bin/charadock-beatrice-host.exe",
    to: "bin/charadock-beatrice-host.exe",
  }]);
  assert.deepEqual(packageJson.build.mac.extraResources, [{
    from: "native/bin/charadock-beatrice-host",
    to: "bin/charadock-beatrice-host",
  }]);
  assert.deepEqual(packageJson.build.mac.target, ["dmg", "zip"]);
  assert.equal(packageJson.build.mac.icon, "app-icon.png");
  assert.match(packageJson.scripts["dist:mac:arm64"], /--mac dmg zip --arm64 --publish never/);
  assert.ok(packageJson.build.win.files.some((entry) => entry.includes("/darwin/")));
  assert.ok(packageJson.build.mac.files.some((entry) => entry.includes("/win32/")));
  for (const required of packageJson.build.files) {
    assert.equal(packageJson.build.win.files.includes(required), true, `Windows files must retain ${required}`);
    assert.equal(packageJson.build.mac.files.includes(required), true, `macOS files must retain ${required}`);
  }
  assert.equal(packageJson.build.files.some((entry) => /onnxruntime-node\/bin\/napi-v6\/(?:darwin|linux|win32)/.test(entry)), false);
  assert.equal(packageJson.build.files.some((entry) => /beatrice.*(?:vst3|toml|bin)/i.test(entry)), false);
  assert.match(fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8"), /Steinberg VST 3 SDK/);
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  for (const id of [
    "beatriceLibraryCard", "beatriceModelLibraryList", "beatriceModelAddButton", "beatriceModelSelect",
    "beatricePitchShiftInput", "beatriceFormantShiftInput", "beatriceOutputGainInput", "beatriceAdvancedSettings",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  const host = fs.readFileSync(path.join(projectRoot, "native", "beatrice-host", "src", "main.cpp"), "utf8");
  for (const parameterId of [3, 4, 7, 8, 9, 10, 11]) assert.match(host, new RegExp(`inner, ${parameterId},`));
  assert.match(host, /_setmode\(_fileno\(stdin\), _O_BINARY\)/);
  assert.match(host, /_setmode\(_fileno\(stdout\), _O_BINARY\)/);
  assert.match(host, /int main\(int argc, char\*\* argv\)/);
  const hostCmake = fs.readFileSync(path.join(projectRoot, "native", "beatrice-host", "CMakeLists.txt"), "utf8");
  assert.match(hostCmake, /module_win32\.cpp/);
  assert.match(hostCmake, /module_mac\.mm/);
  assert.match(hostCmake, /CMAKE_OSX_ARCHITECTURES "arm64"/);
  const worklet = fs.readFileSync(path.join(projectRoot, "desktop", "realtime-beatrice-worklet.js"), "utf8");
  const realtime = fs.readFileSync(path.join(projectRoot, "desktop", "realtime-beatrice.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  assert.match(worklet, /registerProcessor\("charadock-beatrice"/);
  assert.match(realtime, /new MediaStreamTrackProcessor\(\{ track \}\)/);
  assert.match(mascot, /new MediaStreamTrackProcessor\(\{ track \}\)/);
  assert.doesNotMatch(realtime, /createMediaStreamSource|createMediaElementSource/);
  assert.doesNotMatch(mascot, /createMediaStreamSource\(stream\)|createMediaElementSource\(remoteAudio\)/);
  assert.doesNotMatch(realtime, /createObjectURL\(new Blob/);
  assert.doesNotMatch(mascot, /BEATRICE_WORKLET_SOURCE|createObjectURL\(new Blob/);
  const beatriceIpc = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8")
    .match(/function registerIpc\(\) \{[\s\S]*?ipcMain\.on\("kokoro:ready"/)?.[0] || "";
  const handlerFor = (channel) => {
    const start = beatriceIpc.indexOf(`("${channel}"`);
    const end = start < 0 ? -1 : beatriceIpc.indexOf("\n  });", start);
    return start < 0 || end < 0 ? "" : beatriceIpc.slice(start, end + 6);
  };
  for (const channel of ["beatrice:audio", "beatrice:status", "beatrice:start", "beatrice:stop"]) {
    assert.match(handlerFor(channel), /assertTrustedAppSender\(event\)/, `${channel} must accept both the control and mascot app pages`);
  }
  for (const channel of ["beatrice:chooseInstall", "beatrice:addModels", "beatrice:removeModel"]) {
    assert.match(handlerFor(channel), /assertTrustedSender\(event\)/, `${channel} must remain restricted to the control page`);
  }
});

test("macOS computer control delegates to the bundled Codex Computer Use skill", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const macStart = main.indexOf('} else if (process.platform === "darwin") {');
  const macEnd = main.indexOf("} else if (browserSession) {", macStart);
  assert.ok(macStart >= 0 && macEnd > macStart);
  const macComputerUse = main.slice(macStart, macEnd);
  assert.match(macComputerUse, /skills\.find\(isOfficialComputerUseSkill\)/);
  assert.match(macComputerUse, /setTurnStartSkillItems\(\[computerUseSkill\]\)/);
  assert.match(macComputerUse, /approvalPolicy: "on-request"/);
  assert.match(macComputerUse, /rejectInteractiveRequests: true/);
  assert.doesNotMatch(macComputerUse, /dynamicTools: COMPUTER_DYNAMIC_TOOLS/);
});

test("voice input UI requires one explicit supported provider", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const select = html.match(/<select id="speechInputProviderSelect">([\s\S]*?)<\/select>/)?.[1] || "";
  for (const provider of ["realtime", "sherpa-onnx", "browser", "openai"]) {
    assert.match(select, new RegExp(`<option value="${provider}">`));
  }
  assert.doesNotMatch(select, /<option value="(?:auto|codex-audio)">/);
  assert.doesNotMatch(main, /audio:sendCodex|mascotInline:chatAudio/);
});

test("desktop exposes three pointer modes and cancellable voice auto-send", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  for (const mode of ["interactive", "auto-hide", "click-through"]) {
    assert.match(html, new RegExp(`name="mascotPointerMode" value="${mode}"`));
  }
  assert.match(html, /id="voiceAutoSendCountdownToggle"/);
  assert.match(html, /id="voiceAutoSendDelaySelect"/);
  assert.match(mascot, /data-countdown-action="send"/);
  assert.match(mascot, /data-countdown-action="cancel"/);
  assert.match(mascot, /mascotInline:interactionHold/);
});

test("setup can be rerun and support diagnostics stay separate from private content", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.equal((html.match(/data-onboarding-step="\d"/g) || []).length, 5);
  for (const id of ["reopenOnboardingButton", "onboardingBackendSelect", "onboardingSpeechInputProviderSelect", "onboardingTtsProviderSelect", "exportSupportBundleButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(control, /completeOnboarding\(false\)/);
  assert.match(preload, /support:getDiagnostics/);
  assert.match(preload, /support:exportBundle/);
  assert.match(main, /privacy:[\s\S]*excluded:[\s\S]*"API keys"/);
  assert.doesNotMatch(main.match(/async function supportDiagnostics\(\)[\s\S]*?\n}\n/)?.[0] || "", /conversationHistory|characterMemories|workHistory/);
});

test("app updates use the trusted GitHub release flow without automatic execution", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["updateBanner", "updateChecksToggle", "updateChannelSelect", "checkUpdatesButton", "openUpdateReleaseButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(preload, /updates:check/);
  assert.match(preload, /updates:openRelease/);
  assert.match(main, /checkForAppUpdate/);
  assert.match(main, /shell\.openExternal\(url/);
  assert.doesNotMatch(main, /autoUpdater|quitAndInstall/);
});

test("settings conversation stays text-only and character voice routing is explicit", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  assert.doesNotMatch(html, /id="(?:micLipSyncButton|speechInputButton|speechInputMode|micMeter)"/);
  for (const id of ["characterVoiceMount", "voiceRoutingSummary", "realtimeVoiceSettings", "standardTtsSettings"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("conversation and work surfaces expose history, folder access, interruption, and follow-up UX", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const controlPreload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["conversationHistoryTab", "workHistoryTab", "openChatWorkDirectoryButton", "chooseChatWorkDirectoryButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(controlPreload, /work:getHistory/);
  assert.match(controlPreload, /work:openDirectory/);
  assert.match(controlPreload, /work:openArtifact/);
  assert.match(control, /pendingChatFollowUp = \{ message, attachments \}/);
  assert.match(control, /bindFileDropZone\(\$\("#chatForm"\)/);
  assert.match(control, /appendWorkArtifactActions/);
  assert.match(mascot, /pendingFollowUpMessage = message/);
  assert.match(mascot, /mascotInline:openWorkArtifact/);
  assert.match(mascot, /responseSpeaking[\s\S]*stopTtsPlayback\(\)/);
  assert.match(main, /mascotInline:openWorkDirectory/);
  assert.match(main, /work:openDirectory/);
});

test("Codex memory tools proactively create and update character memories", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.match(main, /name: "memory_save"/);
  assert.match(main, /name: "memory_update"/);
  assert.match(main, /Evaluate every user message for durable personalization/);
});
