// SPDX-License-Identifier: Apache-2.0
// Windows Electron: production downloader, renderer, IPC and native WAV generation.
const { app, BrowserWindow, dialog } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const [source, output, existingModel] = process.argv.slice(2);
if (!source || !output || !existingModel || fs.existsSync(path.join(output, "profile"))) throw Error("Supply SOURCE, fresh OUTPUT, and existing Tsukuyomi ONNX");
const profile = path.join(output, "profile"), old = path.join(profile, "tts-models", "piper-plus-tsukuyomi-v1.13.0");
fs.mkdirSync(path.join(old, "piper", "bin"), { recursive: true });
fs.mkdirSync(path.join(old, "models"), { recursive: true });
const oldModel = path.join(old, "models", path.basename(existingModel)), oldExe = path.join(old, "piper", "bin", "piper.exe");
fs.copyFileSync(existingModel, oldModel); fs.copyFileSync(`${existingModel}.json`, `${oldModel}.json`);
fs.writeFileSync(oldExe, "placeholder; never executed");
fs.writeFileSync(path.join(profile, "preferences.json"), JSON.stringify({ onboardingComplete: true, characterId: "amber-avatar",
  piperPlusExecutablePath: oldExe, piperPlusModelPath: oldModel, piperPlusSpeed: .8,
  characterTtsProfiles: { "amber-avatar": { provider: "piper-plus" } }, ttsEnabled: true,
  continuationStartupSpeechEnabled: false, launchAtLogin: false, remoteAccessEnabled: false, updateChecksEnabled: false,
  jevEnabled: false, atomEchoEnabled: false, characterDeviceProfiles: { "rlcd42-default": { enabled: false } } }));
process.env.CODEX_HOME = path.join(output, "codex-fixture"); fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
app.setPath("userData", profile); app.setName("CharaDock Piper QA"); app.getAppPath = () => source; app.setLoginItemSettings = () => {};
const errors = [], urls = [], originalFetch = globalThis.fetch;
globalThis.fetch = async (url, ...args) => { urls.push(String(url)); return originalFetch(url, ...args); };
app.on("web-contents-created", (_event, contents) => contents.on("console-message", (_event, details) => {
  const message = typeof details === "object" ? details.message : "";
  if (/Uncaught|ReferenceError|TypeError/.test(message || "")) errors.push(message);
}));
require(path.join(source, "desktop/main.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const guard = setTimeout(() => { console.error("Piper UI QA timeout"); app.exit(1); }, 180000);
(async () => {
  await app.whenReady(); let win;
  for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("/control.html") && !w.webContents.isLoading()); if (win) break; await sleep(150); }
  assert.ok(win); win.showInactive(); const js = code => win.webContents.executeJavaScript(code);
  await sleep(800);
  await js(`document.querySelector('[data-page="voice"]').click(); document.querySelector('#piperPlusSettings').scrollIntoView({block:'center'})`);
  assert.equal((await js(`window.mascotDesktop.getState()`)).piperPlus.sampleModel.upgradeAvailable, true);
  assert.match(await js(`document.querySelector('#piperPlusModelDownloadButton').textContent`), /v2.0.0/);
  fs.writeFileSync(path.join(output, "before-upgrade.png"), (await win.capturePage()).toPNG());
  const updated = await js(`window.mascotDesktop.downloadTtsModel('piper-plus')`);
  assert.equal(updated.piperPlus.sampleModel.installed, true); assert.equal(updated.piperPlus.runtimeName, "piper-plus-cli.exe");
  assert.equal(urls.filter(url => /tsukuyomi.*resolve/.test(url)).length, 0, "Existing model and config must be reused");
  assert.equal(fs.existsSync(old), false);
  const spokenText = "こんにちは、最新版の音声で話しているよ、これからもよろしくね。";
  const result = await js(`window.mascotDesktop.synthesizeTts(${JSON.stringify(spokenText)})`);
  assert.equal(result.audioDataUrls.length, 1); assert.deepEqual(result.audioTexts, [spokenText]);
  const wave = Buffer.from(result.audioDataUrls[0].split(",")[1], "base64"); assert.ok(wave.length > 10000);
  fs.writeFileSync(path.join(output, "speech.wav"), wave);
  const playback = await js(`(async()=>{ const audio=new Audio(${JSON.stringify(result.audioDataUrls[0])}); return await new Promise((resolve,reject)=>{audio.onended=()=>resolve({duration:audio.duration,ended:audio.ended});audio.onerror=reject;audio.play().catch(reject);});})()`);
  assert.ok(playback.ended && playback.duration > 1 && playback.duration < 30);
  await sleep(300); await js(`document.querySelector('#piperPlusSettings').scrollIntoView({block:'center'})`);
  fs.writeFileSync(path.join(output, "piper-v2.png"), (await win.capturePage()).toPNG());
  await js(`{const input=document.querySelector('#piperPlusReferenceEnabledInput');input.checked=true;input.dispatchEvent(new Event('change'));}`);
  for (let i=0;i<40;i++) { await sleep(100); try { if ((await js(`window.mascotDesktop.getState()`)).piperPlus.referenceEnabled) break; } catch {} }
  assert.match((await js(`window.mascotDesktop.getState()`)).piperPlus.referenceIssue, /エンコーダー/);
  const rejected = await js(`window.mascotDesktop.synthesizeTts('この声は使えません。')`); assert.deepEqual(rejected.audioDataUrls, []); assert.match(rejected.error, /エンコーダー/);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(output, "speech.wav")] });
  const selected = await js(`window.mascotDesktop.choosePiperPlusReference()`);
  assert.equal(selected.piperPlus.referenceName, "speech.wav");
  assert.ok(!JSON.stringify(selected).includes(path.join(output, "speech.wav")), "Reference paths must stay private");
  await sleep(250); await js(`document.querySelector('#piperPlusReferenceEnabledInput').scrollIntoView({block:'center'})`);
  await sleep(200);
  assert.equal(await js(`document.querySelector('[data-page-panel="voice"]').classList.contains('is-active')`), true);
  assert.equal(await js(`document.querySelector('#piperPlusReferenceEnabledInput').checked && !document.querySelector('#piperPlusReferenceSettings').hidden`), true);
  fs.writeFileSync(path.join(output, "reference-settings.png"), (await win.capturePage()).toPNG());
  const changed = await js(`window.mascotDesktop.setCharacter('sage-avatar')`); assert.equal(changed.piperPlus.referenceEnabled, false); assert.equal(changed.piperPlus.referenceName, "");
  const restored = await js(`window.mascotDesktop.setCharacter('amber-avatar')`); assert.equal(restored.piperPlus.referenceName, "speech.wav"); assert.equal(restored.piperPlus.referenceEnabled, true);
  await js(`window.mascotDesktop.clearPiperPlusReference()`); assert.equal((await js(`window.mascotDesktop.getState()`)).piperPlus.ready, true);
  // Verify the independently versioned npm WASM still handles Japanese for Kokoro.
  const wasm = await import(pathToFileURL(path.join(source, "node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm.js")));
  await wasm.default({ module_or_path: fs.readFileSync(path.join(source, "node_modules/piper-plus/dist/rust-wasm/piper_plus_wasm_bg.wasm")) });
  const config = JSON.parse(fs.readFileSync(`${oldModel.replace('v1.13.0','v2.0.0')}.json`, "utf8"));
  const phonemizer = new wasm.WasmPhonemizer(JSON.stringify(config)); const phonemes = phonemizer.phonemize("こんにちは。", "ja");
  assert.ok(phonemes.phonemeIds.length > 5); phonemes.free(); phonemizer.free();
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ passed: true, runtime: "v2.0.0 / Rust CLI 0.5.2", npm: "0.8.0", scenarios: ["incremental-upgrade", "real-japanese-WAV", "audio-playback-ended", "reference-setup-guidance", "reject-incomplete-settings", "reference-picker-IPC", "per-character-reference", "clear-reference", "Japanese-WASM-G2P"], playback, downloads: urls.filter(url=>/piper-plus/.test(url)), errors, limitation: "Voice cloning acoustic quality depends on the voice model and its compatible speaker encoder; not tested with real encoder weights." }, null, 2));
  console.log("PASS Piper v2 installer, native speech, reference settings and Japanese WASM"); clearTimeout(guard); app.quit();
})().catch(error => { fs.writeFileSync(path.join(output, "error.txt"), error.stack); console.error(error.stack); app.exit(1); });
