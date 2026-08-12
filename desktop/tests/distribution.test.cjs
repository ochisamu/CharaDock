// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
    "assets/fonts/**/*",
    "assets/nike-avatar/**/*",
    "assets/reference-voices/**/*",
    "assets/sage-avatar/**/*",
    "assets/towa-avatar/**/*",
    "assets/ui/**/*",
  ]);
  assert.equal(files.some((entry) => entry.includes("demo-avatar")), false);
  assert.equal(files.includes("favicon.ico"), false);
  const nikeNotice = fs.readFileSync(path.join(projectRoot, "assets", "nike-avatar", "ASSET_NOTICE.md"), "utf8");
  assert.match(nikeNotice, /https:\/\/x\.com\/tegnike/);
  assert.match(nikeNotice, /https:\/\/nikechan\.com\//);
  assert.match(fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8"), /### AIニケちゃん \/ AI Nike-chan/);
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

test("Noto Sans JP is pinned, licensed, packaged, and shared by every UI surface", () => {
  const fontPath = path.join(projectRoot, "assets", "fonts", "NotoSansJP-VF.ttf");
  assert.equal(fs.statSync(fontPath).size, 9_590_732);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(fontPath)).digest("hex"), "f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369");
  assert.match(fs.readFileSync(path.join(projectRoot, "assets", "fonts", "LICENSE-NotoSansJP.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8"), /### Noto Sans JP/);
  for (const cssFile of ["styles.css", "desktop/control.css", "desktop/mascot-overlay.css", "desktop/artifact-preview.css"]) {
    const css = fs.readFileSync(path.join(projectRoot, cssFile), "utf8");
    assert.match(css, /font-family: "CharaDock Noto Sans JP"/);
    assert.match(css, /NotoSansJP-VF\.ttf/);
  }
});

test("artifact syntax highlighting uses a licensed local highlight.js build", () => {
  const vendor = path.join(projectRoot, "vendor", "highlightjs", "11.11.1");
  assert.ok(fs.statSync(path.join(vendor, "highlight.min.js")).size > 100_000);
  assert.ok(fs.statSync(path.join(vendor, "styles", "github-dark-dimmed.min.css")).size > 1_000);
  assert.match(fs.readFileSync(path.join(vendor, "LICENSE"), "utf8"), /BSD 3-Clause License/);
  assert.equal(packageJson.devDependencies["@highlightjs/cdn-assets"], "11.11.1");
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  assert.match(html, /vendor\/highlightjs\/11\.11\.1\/highlight\.min\.js/);
  assert.match(html, /github-dark-dimmed\.min\.css/);
  assert.match(control, /window\.hljs\.highlight\(source/);
  assert.match(fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8"), /### highlight\.js/);
});

test("Markdown artifacts use pinned local rendering and sanitizing libraries", () => {
  const markdownVendor = path.join(projectRoot, "vendor", "markdown-it", "14.3.0");
  const purifierVendor = path.join(projectRoot, "vendor", "dompurify", "3.4.13");
  assert.ok(fs.statSync(path.join(markdownVendor, "markdown-it.min.js")).size > 100_000);
  assert.ok(fs.statSync(path.join(purifierVendor, "purify.min.js")).size > 20_000);
  assert.match(fs.readFileSync(path.join(markdownVendor, "LICENSE"), "utf8"), /Permission is hereby granted/);
  assert.match(fs.readFileSync(path.join(purifierVendor, "LICENSE"), "utf8"), /Apache License/);
  assert.equal(packageJson.devDependencies["markdown-it"], "14.3.0");
  assert.equal(packageJson.devDependencies.dompurify, "3.4.13");
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  assert.match(html, /vendor\/markdown-it\/14\.3\.0\/markdown-it\.min\.js/);
  assert.match(html, /vendor\/dompurify\/3\.4\.13\/purify\.min\.js/);
  assert.match(control, /html: false/);
  assert.match(control, /DOMPurify\.sanitize/);
  assert.match(control, /FORBID_TAGS/);
  const notices = fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(notices, /### markdown-it/);
  assert.match(notices, /### DOMPurify/);
});

test("desktop distribution includes its license and modification records", () => {
  const files = packageJson.build.files;
  for (const required of ["LICENSE", "NOTICE", "MODIFICATIONS.md", "DISTRIBUTION_ASSET_LICENSE.md", "THIRD_PARTY_NOTICES.md"]) {
    assert.equal(files.includes(required), true, `${required} must be packaged`);
  }
});

test("tagged Windows packaging never triggers electron-builder implicit publishing", () => {
  const workflow = fs.readFileSync(path.join(projectRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /npm run dist:win:installer -- --publish never/);
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
    "beatriceDescriptionCard", "beatriceModelDescription", "beatriceVoiceDescription",
  ]) assert.match(html, new RegExp(`id="${id}"`));
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  assert.match(control, /appendBeatriceDescription\(\$\("#beatriceModelDescription"\), model\.description\)/);
  assert.match(control, /appendBeatriceDescription\(\$\("#beatriceVoiceDescription"\), voice\?\.description\)/);
  assert.doesNotMatch(control.match(/function appendBeatriceDescription[\s\S]*?\n  }/)?.[0] || "", /innerHTML/);
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
  const mascotBeatriceCapture = mascot.match(/const startRealtimeBeatriceCapture[\s\S]*?const startRealtimeBeatrice =/)?.[0] || "";
  assert.doesNotMatch(mascotBeatriceCapture, /createMediaStreamSource\(stream\)|createMediaElementSource\(remoteAudio\)/);
  assert.match(mascot, /startRealtimeOutputMeter\(stream\)/, "raw Live audio should be metered for lip sync through a silent sidechain");
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
  assert.doesNotMatch(main.match(/async function supportDiagnostics\(\)[\s\S]*?\n}\n/)?.[0] || "", /conversationHistory|characterMemories|continuationSummaries|workHistory/);
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
  assert.match(mascot, /pendingFollowUp = \{ message, attachments \}/);
  assert.match(mascot, /webUtils\.getPathForFile\(file\)/);
  assert.match(mascot, /id="desktopMascotAttachmentList"/);
  assert.match(mascot, /fileDrop\.id = "desktopMascotFileDrop"/);
  assert.match(mascot, /attachmentPaths: attachments\.map/);
  assert.match(main, /mascotInline:chat[\s\S]{0,500}normalizeLocalAttachments/);
  assert.match(mascot, /mascotInline:previewWorkArtifact/);
  assert.match(mascot, /responseSpeaking[\s\S]*stopTtsPlayback\(\)/);
  assert.match(main, /mascotInline:openWorkDirectory/);
  assert.match(main, /work:openDirectory/);
  assert.match(main, /async function setCharacter\(characterId\) \{[\s\S]*if \(activeWorkRunId\)[\s\S]*Characters cannot be switched while Work is running/);
  assert.match(control, /syncCharacterSwitchAvailability[\s\S]*button\.disabled = workRunning/);
});

test("avatar output buttons open a sandboxed companion preview without covering the mascot", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const previewPreload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-artifact-preview.cjs"), "utf8");
  const previewHtml = fs.readFileSync(path.join(projectRoot, "desktop", "artifact-preview.html"), "utf8");
  const previewRenderer = fs.readFileSync(path.join(projectRoot, "desktop", "artifact-preview.js"), "utf8");
  assert.match(mascot, /ipcRenderer\.invoke\("mascotInline:previewWorkArtifact"/);
  assert.match(main, /function artifactPreviewBoundsNearMascot\(\)/);
  assert.match(main, /preload-artifact-preview\.cjs/);
  assert.match(main, /nodeIntegration: false,[\s\S]*contextIsolation: true,[\s\S]*sandbox: true/);
  assert.match(main, /assertTrustedSender\(event, "preview"\)/);
  assert.match(previewPreload, /artifactPreview:getCurrent/);
  assert.match(previewPreload, /artifactPreview:openArtifact/);
  assert.match(previewPreload, /artifactPreview:revise/);
  assert.match(previewHtml, /id="revisionForm"/);
  assert.match(previewHtml, /Workの音声入力/);
  assert.match(previewRenderer, /api\.revise\(instruction\)/);
  assert.match(main, /function artifactWorkContext\(target, explicit = false\)/);
  assert.match(main, /ipcMain\.handle\("artifactPreview:revise"/);
  assert.match(previewHtml, /Content-Security-Policy/);
  assert.match(previewHtml, /vendor\/markdown-it\/14\.3\.0\/markdown-it\.min\.js/);
  assert.match(previewHtml, /vendor\/dompurify\/3\.4\.13\/purify\.min\.js/);
  assert.match(previewRenderer, /html: false/);
  assert.match(previewRenderer, /DOMPurify\.sanitize/);
  assert.match(previewRenderer, /FORBID_TAGS/);
});

test("sandboxed HTML artifact previews support CSS, scripts, and HTTPS resources without unsafe capabilities", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const csp = main.match(/"Content-Security-Policy":\s*"([^"]+)"/)?.[1] || "";
  assert.match(csp, /style-src 'self' charadock-artifact: 'unsafe-inline' data: https:/);
  assert.match(csp, /script-src 'self' charadock-artifact: 'unsafe-inline' https:/);
  assert.match(csp, /connect-src https: wss:/);
  assert.match(csp, /img-src 'self' charadock-artifact: data: blob: https:/);
  assert.match(csp, /worker-src 'self' charadock-artifact: blob: https:/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.doesNotMatch(csp, /(?:^|\s)http:/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'none'/);
});

test("the latest answer stays visible while active work and Realtime expose elapsed progress", () => {
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const styles = fs.readFileSync(path.join(projectRoot, "desktop", "mascot-overlay.css"), "utf8");
  assert.match(mascot, /bubblePersistent = true;[\s\S]*phase === "done"/);
  assert.match(mascot, /elapsedActivityLabel/);
  assert.match(mascot, /thread\/realtime\/transcript\/done[\s\S]*setWorkActivity/);
  assert.match(styles, /is-processing #desktopMascotWorkActivity::before/);
});

test("Work voice reports contextual milestones and keeps artifact buttons out of speech", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  assert.match(main, /new WorkVoiceReporter\([\s\S]*onAnnouncement: announceWork/);
  assert.match(main, /String\(item\?\.phase \|\| ""\) !== "commentary"/);
  assert.match(main, /phase: "announcement"[\s\S]*speechSegments: streamTtsEnabled/);
  assert.match(main, /workCompletionDisplayText\(result\.text\)/);
  assert.match(main, /workCompletionSpeechText\(displayText, interfaceLanguage\(\)\)/);
  assert.match(main, /deferDisplayToRealtime: deliverViaRealtime/);
  assert.match(main, /appendRealtimeOutputSpeech\(configuredSpeechText\(displayText\), "completion"\)/);
  assert.match(mascot, /payload\?\.phase === "announcement"/);
  assert.match(mascot, /payload\?\.phase === "realtime-caption"/);
  assert.match(mascot, /!payload\?\.deferDisplayToRealtime/);
  assert.match(mascot, /if \(payload\?\.realtimeOutput\) \{\s*if \(!payload\?\.realtimeSpeechPending\) finishDetachedRealtimeWork/);
  assert.match(mascot, /renderArtifactActions\(artifactActions, payload\?\.artifacts, payload\?\.workRunId\)/);
  assert.doesNotMatch(mascot, /renderArtifactActions[\s\S]{0,300}queueStreamSpeech\(payload\?\.artifacts/);
});

test("mascot Japanese text uses a stable Windows font stack and notices clear the composer", () => {
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const styles = fs.readFileSync(path.join(projectRoot, "desktop", "mascot-overlay.css"), "utf8");
  assert.match(mascot, /normalizeDisplayText[\s\S]*normalize\("NFC"\)/);
  assert.match(mascot, /E0100[\s\S]*E01EF/);
  assert.match(mascot, /--mascot-composer-height/);
  assert.match(mascot, /hint\.setAttribute\("role", errorTone \? "alert" : "status"\)/);
  assert.match(styles, /--pet-font-ui: "CharaDock Noto Sans JP", "Noto Sans JP", "Yu Gothic UI"/);
  assert.match(styles, /is-open #desktopMascotHint[\s\S]*calc\(var\(--mascot-composer-height\) \+ 8px\)/);
  assert.match(styles, /data-status-tone="error"/);
});

test("user-facing interaction modes are consistently named Chat and Work", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  assert.match(html, /data-page="chat"[^>]*>[\s\S]*?Chat<\/button>/);
  assert.match(html, /id="interactionModeBadge">Chat<\/span>/);
  assert.match(html, /id="conversationHistoryTab"[^>]*>Chat履歴<\/button>/);
  assert.match(html, /id="workHistoryTab"[^>]*>Work履歴<\/button>/);
  assert.match(control, /interactionModeBadge"\)\.textContent = state\.interactionMode === "work" \? "Work" : "Chat"/);
  assert.match(mascot, /desktopMascotModeButton[\s\S]*?>Chat<\/button>/);
  assert.match(mascot, /modeButton\.textContent = workMode \? "Work" : "Chat"/);
});

test("remote access exposes compact avatar dialogue, device controls, and Live routing", () => {
  const controlHtml = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const controlJs = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const remoteHtml = fs.readFileSync(path.join(projectRoot, "desktop", "remote", "index.html"), "utf8");
  const remoteCss = fs.readFileSync(path.join(projectRoot, "desktop", "remote", "remote.css"), "utf8");
  const remoteJs = fs.readFileSync(path.join(projectRoot, "desktop", "remote", "remote.js"), "utf8");
  assert.match(controlHtml, /data-page="remote"[\s\S]*ui-symbol-settings[\s\S]*リモート/);
  for (const id of ["remoteDeviceList", "remotePcAudioToggle", "remoteResponseModeSelect", "remotePairingCode", "remotePairingTransport", "remotePairingRouteHint", "remotePortInput", "remoteTailscaleHttpsPortInput", "startRemoteTailscaleButton", "stopRemoteTailscaleButton"]) assert.match(controlHtml, new RegExp(`id="${id}"`));
  assert.match(controlJs, /revokeRemoteSession\(device\.id\)/);
  assert.match(controlJs, /startRemoteTailscale\(\)/);
  for (const id of ["bubbleExpandButton", "historySheet", "settingsSheet", "microphoneButton", "remoteLiveAudio", "characterSelect", "ttsProviderSelect", "realtimeVoiceSelect", "pcAudioToggle"]) assert.match(remoteHtml, new RegExp(`id="${id}"`));
  assert.match(remoteCss, /-webkit-line-clamp:\s*4/);
  assert.match(remoteCss, /@keyframes avatar-idle/);
  assert.doesNotMatch(remoteHtml, /id="avatarFaceBlend"/);
  assert.doesNotMatch(remoteCss, /\.avatar-motion\.is-speaking\s*\{[^}]*animation-duration/);
  assert.match(remoteCss, /\.history-sheet[^}]*height:\s*100dvh/);
  assert.match(remoteJs, /character\?\.motion/);
  assert.match(remoteJs, /\["delta", "realtime-caption"\]/);
  assert.match(remoteJs, /\/api\/live\/start/);
  assert.match(remoteJs, /getUserMedia/);
  assert.match(remoteJs, /waitForIceGatheringComplete\(peer\)/);
  assert.match(remoteJs, /charadock\.remote\.audio"\) !== "0"/);
  assert.match(remoteJs, /gain\.gain\.value = audioEnabled && !liveBeatriceActive \? 1 : 0/);
  assert.match(remoteJs, /\/api\/live\/beatrice\/audio/);
  assert.match(remoteJs, /\/api\/live\/beatrice\/stop/);
  assert.match(remoteJs, /createThreeStageMouthTracker/);
  assert.match(remoteJs, /getFloatTimeDomainData/);
  assert.match(remoteJs, /dictationArmed/);
  assert.match(remoteJs, /scheduleDictationResume/);
  assert.match(remoteHtml, /PCでも音を出す<\/strong><small>初期状態はOFF/);
  assert.match(remoteHtml, /この端末で回答音声を再生<\/strong><small>初期状態はON/);
});

test("WSL can launch Windows Electron from a persistent isolated development mirror", () => {
  const shell = fs.readFileSync(path.join(projectRoot, "scripts", "windows-dev.sh"), "utf8");
  const batch = fs.readFileSync(path.join(projectRoot, "scripts", "windows-dev.cmd"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.equal(packageJson.scripts["desktop:win:dev"], "bash scripts/windows-dev.sh");
  assert.equal(packageJson.scripts["desktop:win:dev:profile"], "bash scripts/windows-dev.sh --shared-profile");
  assert.match(shell, /LOCALAPPDATA/);
  assert.match(shell, /CharaDockDev\\\\source/);
  assert.match(shell, /rsync -a --delete/);
  assert.match(shell, /--exclude '\/node_modules\/'/);
  assert.match(shell, /dependency_hash/);
  assert.match(batch, /CharaDockDev\\profile/);
  assert.match(batch, /--shared-profile/);
  assert.match(batch, /node_modules\\electron\\cli\.js/);
  assert.match(main, /--charadock-user-data/);
  assert.match(main, /app\.setPath\("userData", developmentUserDataPath\)/);
});

test("Codex memory tools proactively create and update character memories", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.match(main, /name: "memory_save"/);
  assert.match(main, /name: "memory_update"/);
  assert.match(main, /Evaluate every user message, including ordinary conversation and Work requests/);
});

test("Character memory and continuation are grouped, scoped, editable, private, and greet by default", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["chatContinuationToggle", "continuationModeToggle", "continuationScopeLabel", "continuationUpdatedAt", "continuationGoalPreview", "continuationNextStepPreview", "continuationDetailCount", "continuationGoalInput", "continuationDecisionsInput", "continuationCompletedInput", "continuationPendingInput", "continuationNextStepInput", "saveContinuationButton", "clearContinuationButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="continuationEditor"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /class="continuation-advanced"/);
  assert.match(html, /このキャラが覚えていること/);
  assert.match(html, /あなたについて/);
  assert.match(html, /作業の続き/);
  assert.match(control, /setContinuationStartupSpeech\(requested\)/);
  assert.match(control, /saveContinuationSummary/);
  assert.match(control, /clearContinuationSummary/);
  assert.match(preload, /continuation:setStartupSpeech/);
  assert.match(preload, /continuation:save/);
  assert.match(preload, /continuation:clear/);
  assert.match(main, /function maybeOfferStartupContinuation/);
  assert.match(main, /preferences\.data\.continuationStartupSpeechEnabled === false/);
  assert.match(main, /dynamicTools: \[\.\.\.MEMORY_DYNAMIC_TOOLS, \.\.\.CONTINUATION_DYNAMIC_TOOLS\]/);
  assert.match(main, /developerInstructions: `\$\{workModeInstructions\(\)\}[\s\S]*MEMORY_TOOL_INSTRUCTIONS/);
  assert.match(main, /since: appSessionStartedAt/);
  assert.match(main, /startupContinuationAttempts\.has\(attemptKey\)/);
  assert.match(main, /project\.id === HOME_PROJECT_ID && preferences\.data\.interactionMode === "work"[\s\S]*HOME_SCOPE_KEY/);
  assert.match(main, /if \(scopeKey === COMMON_SCOPE_KEY\)[\s\S]{0,500}continuationRecordedAt/);
  assert.match(main, /\^\(\?:common\|home\|project-/);
});
