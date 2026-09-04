// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { PNG } = require("pngjs");

const projectRoot = path.resolve(__dirname, "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

test("main-process libraries are production dependencies included in packaged apps", () => {
  assert.equal(packageJson.dependencies["js-yaml"], "4.3.1");
  assert.equal(packageJson.devDependencies["js-yaml"], undefined);
  assert.equal(typeof packageJson.dependencies.serialport, "string");
  assert.equal(packageJson.build.npmRebuild, false);
});

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
  for (const characterId of ["amber-avatar", "bronze-avatar", "nike-avatar", "sage-avatar", "towa-avatar"]) {
    for (const fileName of ["rlcd42-portrait.png", "rlcd42-portrait-blink.png", "rlcd42-portrait-mouth-half.png", "rlcd42-portrait-mouth-open.png"]) {
      assert.equal(fs.existsSync(path.join(projectRoot, "assets", characterId, fileName)), true, `${characterId}/${fileName} must be packaged`);
    }
  }
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

test("Microsoft Store package uses the reserved Partner Center identity", () => {
  assert.equal(packageJson.build.appId, "jp.ochisamu.charadock.desktop");
  assert.deepEqual(packageJson.build.appx, {
    identityName: "ochisamu.CharaDock",
    publisher: "CN=69C091B3-AED2-456C-BF7B-A39616771379",
    publisherDisplayName: "ochisamu",
    applicationId: "CharaDock",
    displayName: "CharaDock",
    languages: ["ja-JP", "en-US"],
    capabilities: ["internetClient", "privateNetworkClientServer", "microphone", "webcam", "runFullTrust"],
    artifactName: "CharaDock-${version}-store-${arch}-unsigned.msix",
  });
  assert.match(packageJson.scripts["dist:win:store"], /build-windows\.cmd store/);
  const windowsBuildScript = fs.readFileSync(path.join(projectRoot, ".agents", "skills", "build-windows-binaries", "scripts", "build-windows.cmd"), "utf8");
  assert.match(windowsBuildScript, /@microsoft\/winappcli@0\.6\.0 package/);
  const storeManifest = fs.readFileSync(path.join(projectRoot, "packaging", "windows-store", "AppxManifest.xml"), "utf8");
  assert.match(storeManifest, /Name="ochisamu\.CharaDock"/);
  assert.match(storeManifest, /Publisher="CN=69C091B3-AED2-456C-BF7B-A39616771379"/);
  assert.equal(packageJson.storePackageVersion, `${packageJson.version}.0`);
  const storeVersionParts = packageJson.storePackageVersion.split(".").map(Number);
  assert.equal(storeVersionParts.length, 4);
  assert.equal(storeVersionParts[3], 0, "Microsoft Store reserves the revision component and requires zero");
  assert.match(storeManifest, new RegExp(`Version="${packageJson.storePackageVersion.replaceAll(".", "\\.")}"`));
});

test("Microsoft Store tiles use distinctive CharaDock artwork in every declared size", () => {
  const assetDirectory = path.join(projectRoot, "packaging", "windows-store", "Assets");
  const expectedDimensions = {
    "StoreLogo.png": [50, 50],
    "StoreLogo.scale-200.png": [100, 100],
    "AppList.png": [44, 44],
    "AppList.scale-200.png": [88, 88],
    "SmallTile.png": [71, 71],
    "SmallTile.scale-200.png": [142, 142],
    "MedTile.png": [150, 150],
    "MedTile.scale-200.png": [300, 300],
    "LargeTile.png": [310, 310],
    "LargeTile.scale-200.png": [620, 620],
    "WideTile.png": [310, 150],
    "WideTile.scale-200.png": [620, 300],
  };
  for (const [fileName, [width, height]] of Object.entries(expectedDimensions)) {
    const image = PNG.sync.read(fs.readFileSync(path.join(assetDirectory, fileName)));
    assert.deepEqual([image.width, image.height], [width, height], `${fileName} dimensions`);
    let opaquePixels = 0;
    let chromaticPixels = 0;
    const quantizedColors = new Set();
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const alpha = image.data[offset + 3];
      if (alpha <= 8) continue;
      opaquePixels += 1;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 20) chromaticPixels += 1;
      quantizedColors.add(`${red >> 4},${green >> 4},${blue >> 4},${alpha >> 4}`);
    }
    assert.ok(opaquePixels >= image.width * image.height * 0.25, `${fileName} must be visible`);
    assert.ok(chromaticPixels >= image.width * image.height * 0.03, `${fileName} must not be a neutral placeholder`);
    assert.ok(quantizedColors.size >= 24, `${fileName} must contain distinctive artwork`);
  }

  const manifest = fs.readFileSync(path.join(projectRoot, "packaging", "windows-store", "AppxManifest.xml"), "utf8");
  for (const [attribute, fileName] of [
    ["Square44x44Logo", "AppList.png"],
    ["Square71x71Logo", "SmallTile.png"],
    ["Square150x150Logo", "MedTile.png"],
    ["Wide310x150Logo", "WideTile.png"],
    ["Square310x310Logo", "LargeTile.png"],
  ]) assert.match(manifest, new RegExp(`${attribute}="Assets\\\\${fileName.replace(".", "\\.")}"`));

  const windowsBuildScript = fs.readFileSync(path.join(projectRoot, ".agents", "skills", "build-windows-binaries", "scripts", "build-windows.cmd"), "utf8");
  assert.match(windowsBuildScript, /scripts\\build_windows_store_assets\.cjs/);
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
  for (const provider of ["realtime", "streaming-local", "sherpa-onnx", "browser", "openai"]) {
    assert.match(select, new RegExp(`<option value="${provider}">`));
  }
  assert.doesNotMatch(select, /<option value="(?:auto|codex-audio)">/);
  assert.doesNotMatch(main, /audio:sendCodex|mascotInline:chatAudio/);
});

test("desktop exposes three pointer modes and cancellable voice auto-send", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  for (const mode of ["interactive", "auto-hide", "click-through"]) {
    assert.match(html, new RegExp(`name="mascotPointerMode" value="${mode}"`));
  }
  assert.match(html, /id="voiceAutoSendCountdownToggle"/);
  assert.match(html, /id="voiceAutoSendDelaySelect"/);
  assert.match(mascot, /data-countdown-action="send"/);
  assert.match(mascot, /data-countdown-action="cancel"/);
  assert.match(mascot, /mascotInline:interactionHold/);
  for (const id of ["realtimeAutoStartSettings", "realtimeAutoStartOnTextToggle", "realtimeAutoStartOnPetToggle"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(control, /shouldAutoStartLive[\s\S]*state\?\.realtimeAutoStartOnText !== false[\s\S]*await startCodexRealtimeVoice\(\)/);
  assert.match(mascot, /shouldAutoStartLive[\s\S]*appState\?\.realtimeAutoStartOnText !== false[\s\S]*await startRealtime\(\)/);
  assert.match(mascot, /appState\?\.realtimeAutoStartOnPet === true[\s\S]*await startRealtime\(\)[\s\S]*mascotInline:pet/);
  assert.match(mascot, /if \(!result\?\.deferDisplayToRealtime\) showSpeech\(result\)/);
});

test("setup can be rerun and support diagnostics stay separate from private content", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.equal((html.match(/data-onboarding-step="\d"/g) || []).length, 3);
  for (const id of ["reopenOnboardingButton", "onboardingCodexStatus", "onboardingCharacterGrid", "onboardingFirstWorkGoal", "exportSupportBundleButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(control, /completeOnboarding\(false\)/);
  assert.match(control, /startOnboardingFirstWork\(\{ goal, theme, delivery \}\)/);
  assert.match(preload, /codex:detect/);
  assert.match(preload, /onboarding:startFirstWork/);
  assert.match(mascot, /suppressPcAudio: !hasRealtimeTransport()/);
  assert.match(main, /nextPreferences\.speechInputProvider = "realtime"/);
  assert.match(preload, /support:getDiagnostics/);
  assert.match(preload, /support:exportBundle/);
  assert.match(main, /privacy:[\s\S]*excluded:[\s\S]*"API keys"/);
  assert.doesNotMatch(main.match(/async function supportDiagnostics\(\)[\s\S]*?\n}\n/)?.[0] || "", /conversationHistory|characterMemories|continuationSummaries|workHistory/);
});

test("app updates follow the trusted Store or GitHub distribution flow without automatic execution", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["updateBanner", "updateChecksToggle", "updateChannelSelect", "checkUpdatesButton", "openUpdateReleaseButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(preload, /updates:check/);
  assert.match(preload, /updates:openRelease/);
  assert.match(main, /checkForAppUpdate/);
  assert.match(main, /process\.windowsStore/);
  assert.match(main, /updateDestination\(update\.packageKind, update\.releaseUrl\)/);
  assert.match(main, /shell\.openExternal\(destination\.url/);
  assert.match(control, /update\.packageKind === "store"/);
  assert.doesNotMatch(main, /autoUpdater|quitAndInstall/);
});

test("settings conversation stays text-only and character voice routing is explicit", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  assert.doesNotMatch(html, /id="(?:micLipSyncButton|speechInputButton|speechInputMode|micMeter)"/);
  for (const id of ["characterVoiceMount", "voiceRoutingSummary", "realtimeVoiceSettings", "standardTtsSettings"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("detailed character identity is exposed only through the trusted settings bridge", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["characterDirectorDialog", "characterDirectorRoleInput", "characterDirectorThinkingInput", "saveCharacterDirectorButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(control, /api\.configureCharacterDirector\(/);
  assert.match(preload, /configureCharacterDirector: \(profile\) => ipcRenderer\.invoke\("character:configureDirector", profile\)/);
  const handler = main.match(/ipcMain\.handle\("character:configureDirector"[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(handler, /assertTrustedSender\(event\)/);
  assert.match(handler, /characterDirectorDifference/);
  const profileHandler = main.match(/ipcMain\.handle\("character:configure"[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.match(profileHandler, /previous\.locales\?\.\[language\]/, "saving the basic profile must preserve the detailed localized identity");
});

test("desktop and remote avatar taps distinguish head and body across the rendered character", () => {
  const readSource = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");
  const appSource = readSource("app.js");
  const mascotCss = readSource("desktop/mascot-overlay.css");
  const mascotPreload = readSource("desktop/preload-mascot.cjs");
  const remote = readSource("desktop/remote/remote.js");
  const main = readSource("desktop/main.cjs");
  assert.match(appSource, /function syncDesktopMascotTouchBounds\(transform\)/);
  assert.match(appSource, /--mascot-character-touch-height/);
  assert.match(mascotCss, /var\(--mascot-character-touch-height/);
  assert.match(mascotPreload, /\(event\.clientY - petBounds\.top\) \/ petBounds\.height/);
  assert.match(remote, /\(event\.clientY - bounds\.top\) \/ bounds\.height/);
  assert.match(main, /resolvePetTouchZone\(payload, character\.touchHeadRatio\)/);
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
  assert.match(html, /id="codexWorkNetworkAccessToggle"/);
  assert.match(control, /workNetworkAccess: \$\("#codexWorkNetworkAccessToggle"\)\.checked/);
  assert.match(main, /networkAccess: preferences\.data\.workNetworkAccess === true/);
  assert.match(controlPreload, /work:getHistory/);
  assert.match(controlPreload, /work:openDirectory/);
  assert.match(controlPreload, /work:openArtifact/);
  assert.match(controlPreload, /followUpChat:[\s\S]*chat:followUp/);
  assert.match(control, /api\.followUpChat\([\s\S]*route\?\.accepted/);
  assert.match(main, /async function steerActiveInteraction\([\s\S]*client\.steerActiveTurn/);
  assert.match(main, /phase === "start"\) remoteBusy = true/);
  assert.match(main, /normalConversationSubmitRouteForCapturedInput\(\{[\s\S]*turnStatus: turnCoordinator\.snapshot\(\)\.status[\s\S]*capturedSubmitRoute/);
  assert.match(main, /submitRoute === "follow-up"[\s\S]*steerActiveInteraction\(requestText/);
  assert.match(main, /A second response cannot start at the same time/);
  assert.match(main, /ipcMain\.handle\("chat:followUp"/);
  assert.match(main, /ipcMain\.handle\("mascotInline:followUp"/);
  assert.match(mascot, /mascotInline:followUp[\s\S]*route\?\.accepted/);
  assert.match(control, /followUp = \{ message, attachments, selectedSkillIds, selectedMcpServerIds, interrupting: true \};\s*pendingChatFollowUp = followUp/);
  assert.match(control, /realtimeTypedChatTurnActive = false;\s*restoreChatFollowUp\(\{ message, attachments, selectedSkillIds, selectedMcpServerIds \}\)/);
  assert.ok(control.indexOf("const liveWorkFollowUp = chatBusy") < control.indexOf("pendingChatFollowUp = followUp"));
  assert.match(control, /bindFileDropZone\(\$\("#chatForm"\)/);
  assert.match(control, /appendWorkArtifactActions/);
  assert.match(mascot, /followUp = \{ message, attachments, selectedSkillIds, selectedMcpServerIds, interrupting: true \};\s*pendingFollowUp = followUp/);
  assert.ok(mascot.indexOf("const liveWorkFollowUp = sending") < mascot.indexOf("pendingFollowUp = followUp"));
  assert.match(mascot, /webUtils\.getPathForFile\(file\)/);
  assert.match(mascot, /id="desktopMascotAttachmentList"/);
  assert.match(mascot, /fileDrop\.id = "desktopMascotFileDrop"/);
  assert.match(mascot, /attachmentPaths: attachments\.map/);
  assert.match(control, /if \(!interrupted\) \{\s*restoreChatFollowUp\(\{ message, attachments, selectedSkillIds, selectedMcpServerIds \}\)/);
  assert.match(mascot, /if \(!interrupted\) \{\s*restoreMascotFollowUp\(\{ message, attachments, selectedSkillIds, selectedMcpServerIds \}\)/);
  assert.match(fs.readFileSync(path.join(projectRoot, "desktop", "remote", "remote.js"), "utf8"), /responseMode !== "live"\) stopMobileSpeech[\s\S]*input\.dispatchEvent\(new Event\("input"/);
  assert.match(main, /mascotInline:chat[\s\S]{0,500}normalizeLocalAttachments/);
  assert.match(mascot, /mascotInline:previewWorkArtifact/);
  assert.match(mascot, /responseSpeaking[\s\S]*stopTtsPlayback\(\)/);
  assert.match(main, /mascotInline:openWorkDirectory/);
  assert.match(main, /work:openDirectory/);
  assert.match(main, /async function setCharacter\(characterId\) \{[\s\S]*if \(activeWorkRunId\)[\s\S]*Characters cannot be switched while Work is running/);
  assert.match(control, /syncCharacterSwitchAvailability[\s\S]*interactionBusy[\s\S]*button\.disabled = interactionBusy/);
  assert.match(main, /publicWorkHistory\(\)[\s\S]*scopedWorkHistory\(workHistory[\s\S]*characterId: activeCharacter\(\)\.id[\s\S]*workspaceKey: workDirectoryKey\(\)/);
});

test("temporary activity state never impersonates the user or replaces character dialogue", () => {
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const remote = fs.readFileSync(path.join(projectRoot, "desktop", "remote", "remote.js"), "utf8");
  const remoteTextHandler = remote.match(/async function sendRemoteText\(message\) \{[\s\S]*?\n  \}\n\n  async function flushPendingRemoteFollowUp/)?.[0] || "";
  const remoteStreamHandler = remote.match(/function handleStream\(payload\) \{[\s\S]*?\n  \}\n\n  async function unlockAudio/)?.[0] || "";
  assert.doesNotMatch(remoteTextHandler, /setResponseText\(normalized\)/);
  assert.doesNotMatch(remoteTextHandler, /setResponseText\(error\.message\)/);
  assert.doesNotMatch(main, /remoteLastDisplayText = message/);
  assert.doesNotMatch(remoteStreamHandler, /phase === "start"[\s\S]{0,180}setResponseText/);
  assert.match(remoteStreamHandler, /phase === "activity"[\s\S]*setComposerHint/);
  assert.match(remoteStreamHandler, /phase === "error"[\s\S]{0,220}showRemoteSystemError/);
  assert.doesNotMatch(remoteStreamHandler, /phase === "error"[\s\S]{0,220}setResponseText/);
  assert.doesNotMatch(mascot, /bubbleText\.textContent = appState\?\.language === "en" \? "Thinking/);
  assert.doesNotMatch(mascot, /showSpeech\(\{ text: (?:interrupted|`エラー)/);
  assert.match(mascot, /friendlyInteractionErrorMessage\(error\)/);
  assert.doesNotMatch(control, /setStatus\(\$\("#chatStatus"\), state\.backend === "codex"/);
  assert.match(control, /phase === "error"[\s\S]{0,500}friendlyConversationErrorMessage/);
  assert.doesNotMatch(control, /paragraph\.textContent = "エラー:/);
});

test("chat composers select per-turn Skills and MCP from plus, slash, and at shortcuts", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  for (const id of ["chatAddButton", "chatAddPopover", "chatSkillPickerSearch", "chatSkillPickerList", "chatSelectedSkillList"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(control, /match\(\/(?:[\s\S])*\(\[\/@\]\)/);
  assert.match(control, /selectedSkillIds,[\s\S]{0,100}selectedMcpServerIds/);
  assert.match(mascot, /id="desktopMascotAddPopover"/);
  assert.match(mascot, /id="desktopMascotSkillPicker"/);
  assert.match(mascot, /id="desktopMascotMcpList"/);
  assert.match(mascot, /mascotExtensionRecords/);
  assert.match(mascot, /selectedSkillIds, selectedMcpServerIds/);
  assert.match(main, /function explicitTurnSkillItems\(value\)/);
  assert.match(main, /skillItems: turnSkillItems/);
  assert.match(main, /function setActiveRealtimeTurnSkills\(value\)/);
  assert.match(main, /function realtimeWorkSkillContext\(client, selectedSkillIds/);
  assert.match(main, /function realtimeWorkFrontendContext\(client, selectedSkillIds/);
  assert.match(main, /initialItems: \[\{[\s\S]*realtimeWorkFrontendContext[\s\S]*realtimeChatFrontendContext/);
  assert.match(main, /activeRealtimeTurnSkillIds = \[\]/);
  assert.match(control, /appendCodexRealtimeText\(message, selectedSkillIds, selectedMcpServerIds\)/);
  assert.match(mascot, /mascotInline:realtimeTurnSkills/);
  assert.match(mascot, /mascotInline:realtimeTurnMcp/);
  assert.match(mascot, /Live Work only/);
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
  assert.match(mascot, /if \(payload\?\.realtimeOutput\) \{\s*if \(streamWorkMode\)[\s\S]*finishDetachedRealtimeWork/);
  assert.match(mascot, /else \{\s*setSendingControls\(false\);\s*\}/);
  assert.match(mascot, /renderArtifactActions\(artifactActions, payload\?\.artifacts, payload\?\.workRunId\)/);
  assert.match(mascot, /setTimeout\(clearBubbleArtifactActions, 20_000\)/);
  assert.match(mascot, /phase === "realtime-work-complete"[\s\S]*setWorkActivity\(""\)/);
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

test("generated TTS failures stay concise and cannot retry-spam the character surface", () => {
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  for (const source of [control, mascot]) {
    assert.match(source, /friendlyTtsErrorMessage/);
    assert.match(source, /Error invoking remote method/);
    assert.match(source, /テキストの回答|音声設定/);
  }
  assert.match(mascot, /generatedTtsRetryAfter = now \+ 15_000/);
  assert.match(mascot, /if \(generatedTtsInCooldown\(provider\)\) return null/);
  assert.match(mascot, /if \(result\?\.error\)[\s\S]{0,120}reportGeneratedTtsFailure/);
  assert.match(mascot, /reportGeneratedTtsFailure\(provider, error\)/);
  assert.match(mascot, /streamTtsQueue = \[\];[\s\S]{0,220}reportGeneratedTtsFailure/);
  assert.match(control, /setStatus\(\$\("#ttsStatus"\), friendlyTtsErrorMessage\(error\), true\)/);
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.match(main, /synthesizeConfiguredTtsForRenderer/);
  assert.match(main, /audioDataUrls: \[\],[\s\S]{0,100}error:/);
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
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
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
  assert.match(remoteJs, /createMediaStreamDestination/);
  assert.match(remoteJs, /liveSyntheticInputOscillator/);
  assert.match(remoteJs, /waitForIceGatheringComplete\(peer\)/);
  assert.match(remoteJs, /timeoutMs:\s*70_000/);
  assert.doesNotMatch(remoteJs, /type:\s*"response\.create"/);
  assert.doesNotMatch(controlJs, /type:\s*"response\.create"/);
  assert.match(remoteJs, /liveStarting \? text\("Live接続を中止"/);
  assert.doesNotMatch(remoteJs, /button\.disabled = liveStarting \|\| pcOwnsLive/);
  assert.match(remoteJs, /PC側のLiveからこの端末へ切り替え/);
  assert.match(remoteJs, /takeover:\s*appState\?\.voice\?\.liveConnected/);
  const remoteTapHandler = remoteJs.match(/async function tapCharacter\(event\) \{[\s\S]*?\n  \}\n\n  async function openArtifact/)?.[0] || "";
  assert.match(remoteTapHandler, /voice\.responseMode === "live" && !hasRemoteLiveTransport\(\)/);
  assert.match(remoteTapHandler, /!microphoneAvailable\(\)[\s\S]*タップからLiveを始めるにはHTTPS/);
  assert.match(remoteTapHandler, /voice\.liveOwner !== "remote"[\s\S]*PC側のLiveが使用中/);
  assert.match(remoteTapHandler, /await startRemoteLive\(\{ microphone: true \}\)[\s\S]*request\("\/api\/pet"/);
  assert.doesNotMatch(remoteTapHandler, /startRemoteLive\(\{ microphone: false \}\)/);
  const remoteTextHandler = remoteJs.match(/async function sendRemoteText\(message\) \{[\s\S]*?\n  \}\n\n  async function flushPendingRemoteFollowUp/)?.[0] || "";
  assert.match(remoteTextHandler, /if \(busy\)[\s\S]*followUp: true[\s\S]*payload\.result\?\.accepted[\s\S]*queueRemoteFollowUp/);
  assert.doesNotMatch(remoteTextHandler, /setResponseText\(normalized\)/);
  assert.match(remoteTextHandler, /responseMode === "live"[\s\S]*await startRemoteLive\(\{ microphone: true \}\)[\s\S]*request\("\/api\/message"/);
  assert.doesNotMatch(remoteTextHandler, /startRemoteLive\(\{ microphone: false \}\)/);
  assert.match(remoteJs, /!modeInitialized \|\| appState\?\.voice\?\.liveConnected/);
  assert.match(remoteJs, /liveSessionId: stoppedSessionId \|\| undefined/);
  assert.match(remoteJs, /charadock\.remote\.audio"\) !== "0"/);
  assert.match(remoteJs, /gain\.gain\.value = audioEnabled && !liveBeatriceActive && !liveOutputSuppressed \? 1 : 0/);
  assert.match(remoteJs, /setRemoteLiveOutputSuppressed\(Boolean\(params\.suppressed\) && method !== "thread\/realtime\/transcript\/done"\)/);
  assert.match(remoteJs, /\/api\/live\/beatrice\/audio/);
  assert.match(remoteJs, /\/api\/live\/beatrice\/stop/);
  assert.match(remoteJs, /createThreeStageMouthTracker/);
  assert.match(remoteJs, /getFloatTimeDomainData/);
  assert.match(main, /remoteTtsOutput: true/);
  assert.match(main, /remoteTtsEnabled && \["announcement", "delta", "done"\]/);
  assert.match(main, /speechSegments: \(Array\.isArray\(coordinated\.speechSegments\)/);
  assert.match(remoteJs, /beginMobileStreamSpeech\(payload\.turnId\)/);
  assert.match(remoteJs, /queueMobileStreamSpeech\(payload, \{ finished: true \}\)/);
  assert.match(remoteJs, /playMobileTtsValue\(segment\.spokenText, token, \(\) => setResponseText\(segment\.caption\)\)/);
  assert.match(remoteJs, /playAudioUrl\(audioUrl, result\.playbackRate, activate, \(\) => token === mobileSpeechToken\)/);
  assert.doesNotMatch(remoteJs, /if \(audioRoute === "mobile-tts"\) speak\(value\)/);
  assert.match(remoteJs, /dictationArmed/);
  assert.match(remoteJs, /scheduleDictationResume/);
  assert.match(main, /let remoteRealtimeOwnerHash = ""/);
  assert.match(main, /remoteRealtimeOwnerHash !== remoteTokenHash/);
  assert.match(main, /requestedTakeover[\s\S]*remote-live-takeover-requested/);
  assert.match(main, /realtime:\s*true,\s*delegated:\s*appended\?\.delegated === true/);
  assert.match(main, /Realtime V3 appendText is context-only[\s\S]*client\.sendMessage\(normalized, \{ skillItems, requireMcpReady \}\)/);
  assert.match(main, /prompt: undefined,[\s\S]*clientManagedHandoffs:\s*false/);
  assert.match(main, /Chat is conversational and strictly read-only/);
  assert.match(main, /const answer = cleanAssistantText\(result\?\.text \|\| ""\)\.trim\(\)/);
  assert.match(main, /realtime-work-conversation-handoff-started/);
  assert.match(main, /async dispatchConversation\(request\)/);
  assert.match(main, /remoteRealtimeSessionId === liveSessionId && activeRealtimeTarget === "remote"[\s\S]*remoteBusy = false/);
  assert.doesNotMatch(main, /remoteLastDisplayText = mainText\("Liveへ送信したよ。"/);
  assert.doesNotMatch(main, /remoteLastDisplayText = mainText\("Liveへ接続中…"/);
  assert.doesNotMatch(remoteJs, /setResponseText\(text\("Liveへ接続中…"/);
  assert.match(remoteJs, /setConnection\(false, text\("Live接続中…", "Connecting to Live…"\)\)/);
  assert.doesNotMatch(remoteJs, /setResponseText\(text\("つながったよ。そのまま話してね。"/);
  assert.doesNotMatch(main, /startupGreeting\?\.text \|\| mainText\("つながったよ。そのまま話してね。"/);
  assert.match(main, /if \(startupGreeting\?\.text\) remoteLastDisplayText = startupGreeting\.text/);
  assert.match(main, /deferDisplayToRealtime: Boolean\(realtimeSpeech\.spoken\)/);
  assert.match(main, /if \(!result\.deferDisplayToRealtime\) remoteLastDisplayText = result\.text/);
  assert.match(remoteJs, /if \(!result\?\.deferDisplayToRealtime\) setResponseText\(result\?\.text\)/);
  assert.match(remoteHtml, /PCでも音を出す<\/strong><small>初期状態はOFF/);
  assert.match(remoteHtml, /この端末で回答音声を再生<\/strong><small>初期状態はON/);
});

test("ESP32 devices have a scalable settings page independent of CharaDock Link", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const liveBridge = fs.readFileSync(path.join(projectRoot, "desktop", "atom-echo-live.js"), "utf8");
  const remoteSettings = html.match(/data-page-panel="remote"[\s\S]*?(?=<section class="page" data-page-panel="esp32")/)?.[0] || "";
  const atomSettings = html.match(/data-page-panel="esp32"[\s\S]*?(?=<section class="page" data-page-panel="character")/)?.[0] || "";
  assert.match(html, /data-page="remote"[\s\S]*CharaDock Link/);
  assert.match(html, /data-page="esp32"[\s\S]*ESP32デバイス/);
  assert.doesNotMatch(remoteSettings, /id="atomEchoAudioOutputTitle"/);
  assert.match(atomSettings, /id="atomEchoEnabledSettings"[\s\S]*id="atomEchoAudioOutputTitle"/);
  assert.match(atomSettings, /id="atomEchoAudioOutputTitle"[\s\S]*内蔵スピーカー[\s\S]*id="testAtomEchoSpeakerButton"/);
  assert.match(atomSettings, /id="atomEchoCaptureModeSelect"[\s\S]*ハンズフリーで話す/);
  assert.match(atomSettings, /id="atomEchoVadThresholdInput"[\s\S]*min="80"[\s\S]*max="800"/);
  assert.match(atomSettings, /id="atomEchoOutputGainInput"[\s\S]*min="50"[\s\S]*max="150"/);
  assert.match(atomSettings, /5分使わなければLiveを終了[\s\S]*初期状態はON[\s\S]*id="atomEchoLiveIdleTimeoutToggle"/);
  assert.match(atomSettings, /id="rlcd42Card"[\s\S]*RLCD 4\.2/);
  assert.match(atomSettings, /id="rlcd42TransportSelect"[\s\S]*id="rlcd42WifiSsidInput"[\s\S]*id="rlcd42PortSelect"[\s\S]*id="provisionRlcd42WifiButton"/);
  assert.match(atomSettings, /id="rlcd42ArtStyleSelect"[\s\S]*漫画インク（推奨）[\s\S]*id="rlcd42CaptionModeSelect"/);
  assert.match(atomSettings, /id="rlcd42AudioTitle"[\s\S]*id="rlcd42SpeakerToggle"[\s\S]*id="testRlcd42SpeakerButton"/);
  assert.match(atomSettings, /id="rlcd42MicrophoneToggle"[\s\S]*id="rlcd42CaptureModeSelect"[\s\S]*ハンズフリー[\s\S]*id="rlcd42VadThresholdInput"[\s\S]*id="rlcd42LiveIdleTimeoutToggle"/);
  assert.match(atomSettings, /id="rlcd42SensorStrip"[\s\S]*id="syncRlcd42DisplayButton"/);
  assert.doesNotMatch(atomSettings, /StackChan|検討中/);
  assert.doesNotMatch(atomSettings, /Bluetooth|atomEchoAudioOutputSelect/);
  assert.match(main, /deviceProfiles[\s\S]*RLCD42_PROFILE_ID/);
  assert.match(main, /syncRlcd42Presentation/);
  assert.match(main, /playRlcd42Speech[\s\S]*resamplePcm16[\s\S]*playPcm16/);
  assert.match(main, /onPttStart: async \(\) => esp32PttStart\("rlcd42"\)[\s\S]*onPcmChunk: async \(chunk\) => esp32PcmChunk\(chunk\)/);
  assert.match(main, /rlcd42LiveAudioRoute = new AtomEchoLiveAudioRoute\(\{[\s\S]*processorOptions: rlcd42OutputProfile/);
  assert.match(main, /rlcd42:testSpeaker/);
  assert.match(main, /ipcMain\.handle\("rlcd42:stopSpeaker"[\s\S]*?assertTrustedAppSender\(event\)/);
  assert.match(main, /onReady:[\s\S]*scheduleRlcd42PresentationSync\(\)/);
  assert.match(main, /event\.event === 1[\s\S]*force: true/);
  assert.match(main, /resetAtomEchoLiveBridgeForProviderChange\(previousSpeechInputProvider, allowed\.speechInputProvider\)/);
  assert.match(main, /atom-echo-audio-mode-reset/);
  assert.match(liveBridge, /peerConnected = peer\?\.connectionState === "connected";[\s\S]*if \(peerConnected\) flushInput\(\)/);
});

test("WSL can launch Windows Electron from a persistent isolated development mirror", () => {
  const shell = fs.readFileSync(path.join(projectRoot, "scripts", "windows-dev.sh"), "utf8");
  const batch = fs.readFileSync(path.join(projectRoot, "scripts", "windows-dev.cmd"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  assert.equal(packageJson.scripts["desktop:win:dev"], "bash scripts/windows-dev.sh");
  assert.equal(packageJson.scripts["desktop:win:dev:profile"], "bash scripts/windows-dev.sh --shared-profile");
  assert.equal(packageJson.scripts["desktop:win:verify-rlcd42-audio"], "bash scripts/windows-dev.sh --shared-profile --verify-rlcd42-audio");
  assert.match(shell, /LOCALAPPDATA/);
  assert.match(shell, /CharaDockDev\\\\source/);
  assert.match(shell, /rsync -a --delete/);
  assert.match(shell, /--exclude '\/node_modules\/'/);
  assert.match(shell, /dependency_hash/);
  assert.match(batch, /CharaDockDev\\profile/);
  assert.match(batch, /--shared-profile/);
  assert.match(shell, /--verify-rlcd42-audio/);
  assert.match(batch, /--verify-rlcd42-audio --hidden/);
  assert.match(batch, /node_modules\\electron\\cli\.js/);
  assert.match(main, /--charadock-user-data/);
  assert.match(main, /app\.setPath\("userData", developmentUserDataPath\)/);
  assert.match(main, /CHARADOCK_RLCD42_AUDIO_VERIFICATION_OK/);
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
  assert.match(main, /dynamicTools: \[\.\.\.MEMORY_DYNAMIC_TOOLS, \.\.\.CONTINUATION_DYNAMIC_TOOLS, \.\.\.HISTORY_DYNAMIC_TOOLS, \.\.\.SKILL_CREATOR_DYNAMIC_TOOLS\]/);
  assert.match(main, /developerInstructions: `\$\{workModeInstructions\(\)\}[\s\S]*MEMORY_TOOL_INSTRUCTIONS/);
  assert.match(main, /function codexRuntimeMatches\(client, runtime, mcpSignature = ""\)/);
  assert.match(main, /client\.commandArgs[\s\S]{0,300}runtime\.workspaceRoots/);
  assert.match(main, /wslPathTarget\(directory\)\.distribution \? "wsl" : "auto"/);
  assert.doesNotMatch(main, /sharedContinuityContext\(\{[\s\S]{0,300}since: appSessionStartedAt/);
  assert.match(main, /name: "history_search"/);
  assert.match(main, /startupContinuationAttempts\.has\(attemptKey\)/);
  assert.match(main, /STARTUP_CONTINUATION_TIMEOUT_MS = 25_000/);
  assert.match(main, /reasoningEffort: "low"/);
  assert.match(main, /startupContinuationMessages\.set\([\s\S]{0,180}rememberAssistantAnnouncement\(message\)/);
  assert.doesNotMatch(main.match(/function remoteStartupGreeting\([\s\S]*?\n}/)?.[0] || "", /continuationFallbackMessage/);
  assert.match(main, /project\.id === HOME_PROJECT_ID && preferences\.data\.interactionMode === "work"[\s\S]*HOME_SCOPE_KEY/);
  assert.match(main, /if \(scopeKey === COMMON_SCOPE_KEY\)[\s\S]{0,500}continuationRecordedAt/);
  assert.match(main, /\^\(\?:common\|home\|project-/);
});

test("Streamable HTTP MCP settings support scoped Chat, Work, and Live use without exposing API keys", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "desktop", "preload-control.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const preferences = fs.readFileSync(path.join(projectRoot, "desktop", "lib", "preferences.cjs"), "utf8");
  assert.match(html, /<p class="nav-section-label">拡張<\/p>[\s\S]{0,500}data-page="skills"[\s\S]{0,500}data-page="mcp"/);
  assert.match(html, /data-page-panel="mcp"[\s\S]*id="mcpServersCard"/);
  const connectionPage = html.match(/data-page-panel="connection"[\s\S]*?(?=<section class="page" data-page-panel="desktop")/)?.[0] || "";
  assert.doesNotMatch(connectionPage, /id="mcpServersCard"/);
  assert.match(html, /id="mcpServersCard"/);
  assert.match(html, /id="mcpAssignmentTargetSelect"/);
  assert.match(html, /id="chatSelectedMcpList"/);
  assert.match(html, /id="mcpServerAuthSelect"[\s\S]*value="none"[\s\S]*value="api-key"/);
  assert.match(control, /saveMcpServer\(payload\)/);
  assert.match(preload, /ipcRenderer\.invoke\("mcp:test", serverId\)/);
  assert.match(preload, /ipcRenderer\.invoke\("mcp:setAssignment", payload\)/);
  assert.match(preload, /ipcRenderer\.invoke\("audio:realtimeTurnMcp", selectedMcpServerIds\)/);
  assert.match(main, /function ensureWorkClient\(selectedMcpServerIds = \[\]\)[\s\S]*preferences\.mcpRuntime\(effectiveMcpServerIds\(selectedMcpServerIds\)\)/);
  assert.match(main.match(/function createConversationCodexClient\([\s\S]*?\n}/)?.[0] || "", /mcpRuntime|mcpServers/);
  assert.match(main, /ipcMain\.handle\("mcp:setAssignment"/);
  assert.match(control, /selectedMcpServerIds: chatSelectedMcpServerIds/);
  assert.match(preferences, /state\.mcpServers = publicMcpServers/);
  assert.doesNotMatch(preferences.match(/publicMcpServers\(records[\s\S]*?\n}/)?.[0] || "", /apiKey:/);
});
