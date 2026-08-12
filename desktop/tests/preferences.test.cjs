// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { Preferences } = require("../lib/preferences.cjs");

test("preferences encrypts the API key and never exposes it publicly", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
  };
  const preferences = new Preferences(file, safeStorage);
  preferences.setApiKey("sk-test-secret");
  const disk = fs.readFileSync(file, "utf8");
  assert.equal(disk.includes("sk-test-secret"), false);
  assert.equal(preferences.getApiKey(), "sk-test-secret");
  assert.equal(preferences.publicState().hasApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.publicState(), "encryptedApiKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.publicState(), "customCharacters"), false);
});

test("preferences keeps API key in memory when encryption is unavailable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const preferences = new Preferences(path.join(directory, "preferences.json"), {
    isEncryptionAvailable: () => false,
  });
  preferences.setApiKey("sk-session-only");
  assert.equal(preferences.getApiKey(), "sk-session-only");
  assert.equal(preferences.publicState().apiKeyPersistence, "session");
  assert.equal(fs.readFileSync(preferences.filePath, "utf8").includes("sk-session-only"), false);
});

test("new installs enable onboarding and desktop positioning defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const preferences = new Preferences(path.join(directory, "preferences.json"));
  const state = preferences.publicState();
  assert.equal(state.language, "ja");
  assert.equal(state.onboardingComplete, false);
  assert.equal(state.positionLocked, false);
  assert.equal(state.mascotPointerMode, "interactive");
  assert.equal(state.edgeSnap, true);
  assert.equal(state.preferredDisplayId, "");
  assert.equal(state.interactionMode, "chat");
  assert.equal(state.continuationStartupSpeechEnabled, true);
  assert.equal(state.continuationSummaries, undefined);
  assert.equal(state.ttsProvider, "system");
  assert.equal(state.realtimeVoice, "cove");
  assert.equal(state.styleBertVits2Url, "http://localhost:5000");
  assert.equal(state.styleBertVits2ModelId, 0);
  assert.equal(state.styleBertVits2Speed, 1);
  assert.equal(state.piperPlusSpeed, .8);
  assert.equal(state.piperPlusExecutablePath, undefined);
  assert.equal(state.piperPlusModelPath, undefined);
  assert.equal(state.englishPronunciationEnabled, true);
  assert.equal(state.englishPronunciationDictionary, "");
  assert.equal(state.speechInputProvider, "browser");
  assert.equal(state.sherpaModelId, "reazonspeech-ja-int8");
  assert.equal(state.supertonicVoice, "F1");
  assert.equal(state.supertonicSpeed, 1);
  assert.equal(state.supertonicSteps, 8);
  assert.equal(state.supertonicModelDirectory, undefined);
  assert.equal(state.irodoriSteps, 12);
  assert.equal(state.irodoriSamplingMode, "sway");
  assert.equal(state.irodoriSpeed, 1.1);
  assert.equal(state.irodoriVoiceId, "builtin-kohaku");
  assert.equal(state.irodoriSeed, 0);
  assert.equal(state.irodoriVersion, "v4-small");
  assert.equal(state.irodoriPrecision, "fp16");
  assert.equal(state.irodoriMode, "reference");
  assert.match(state.irodoriCaption, /日本語/);
  assert.equal(state.irodoriAutoEmotion, true);
  assert.equal(state.irodoriEmotionStrength, "natural");
  assert.equal(state.irodoriCfgExecution, "sequential");
  assert.equal(state.irodoriModelDirectory, undefined);
  assert.equal(state.irodoriV4Int4ModelDirectory, undefined);
  assert.equal(state.irodoriReferenceAudioPath, undefined);
  assert.equal(state.kokoroVoice, "jf_alpha");
  assert.equal(state.kokoroSpeed, 1);
  assert.equal(state.kokoroDevice, "auto");
  assert.equal(state.kokoroModelDirectory, undefined);
  assert.equal(state.voiceActivationMode, "vad");
  assert.equal(state.vadSensitivity, "normal");
  assert.equal(state.voiceAutoSend, true);
  assert.equal(state.voiceAutoSendCountdown, true);
  assert.equal(state.voiceAutoSendDelayMs, 1500);
  assert.equal(state.remoteAccessEnabled, false);
  assert.equal(state.remoteBindAddress, "");
  assert.equal(state.remoteWorkEnabled, true);
  assert.equal(state.remoteTtsEnabled, true);
  assert.equal(state.remotePcAudioEnabled, false);
  assert.equal(state.remoteResponseMode, "tts");
  assert.equal(state.remotePort, 41317);
  assert.equal(state.remoteSessionMinutes, 60);
  assert.equal(state.remoteTailscaleHttpsPort, 443);
  assert.equal(state.remoteTailscaleManaged, false);
  assert.equal(state.remoteTrustedDevices, undefined);
  assert.equal(state.codexChatModel, "");
  assert.equal(state.codexChatReasoningEffort, "");
  assert.equal(state.codexWorkModel, "");
  assert.equal(state.codexWorkReasoningEffort, "");
  assert.equal(state.hasWorkDirectory, false);
  assert.equal(state.workDirectoryName, "");
  assert.deepEqual(preferences.data.irodoriVoices.map((voice) => voice.id), ["builtin-hiro", "builtin-kohaku"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(preferences.data.characterTtsProfiles).map(([id, profile]) => [id, profile.provider])),
    {
      "amber-avatar": "irodori-webgpu",
      "bronze-avatar": "supertonic-3",
      "towa-avatar": "irodori-webgpu",
      "sage-avatar": "supertonic-3",
      "nike-avatar": "system",
    },
  );
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].irodoriVoiceId, "builtin-kohaku");
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].styleBertVits2ModelId, 0);
  assert.equal(preferences.data.characterTtsProfiles["towa-avatar"].irodoriVoiceId, "builtin-hiro");
  for (const [id, profile] of Object.entries(preferences.data.characterTtsProfiles)) {
    if (id === "nike-avatar") {
      assert.equal(profile.irodoriVersion, "v4-small");
      assert.equal(profile.irodoriPrecision, "int4");
      continue;
    }
    assert.equal(profile.irodoriVersion, "500m-v3");
    assert.equal(profile.irodoriPrecision, "fp16");
  }
});

test("preferences retain private character and project continuation summaries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-continuation-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    continuationStartupSpeechEnabled: false,
    continuationSummaries: {
      "amber-avatar": {
        common: {
          goal: "公開準備を進める",
          nextStep: "READMEを確認する",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
        "project-1111111111111111": {
          projectName: "CharaDock",
          pending: ["Windows版を検証する"],
          nextStep: "Windows版を検証する",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
        home: {
          projectName: "キャラクターホーム",
          pending: ["デモページを完成させる"],
          nextStep: "表示を確認する",
          createdAt: "2026-08-12T00:00:00.000Z",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
      },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.continuationStartupSpeechEnabled, false);
  assert.equal(preferences.data.continuationSummaries["amber-avatar"].common.nextStep, "READMEを確認する");
  assert.equal(preferences.data.continuationSummaries["amber-avatar"]["project-1111111111111111"].projectName, "CharaDock");
  assert.equal(preferences.data.continuationSummaries["amber-avatar"].home.nextStep, "表示を確認する");
  assert.equal(preferences.publicState().continuationSummaries, undefined);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("preferences migrate the former continuation toggle to startup speech", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-continuation-toggle-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ continuationEnabled: false }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.continuationStartupSpeechEnabled, false);
  assert.equal(preferences.publicState().continuationStartupSpeechEnabled, false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("Irodori INT4 selection is normalized globally and per character", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-preferences-irodori-int4-"));
  const file = path.join(root, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    irodoriPrecision: "int4",
    irodoriV4Int4ModelDirectory: "C:/models/irodori-int4",
    characterTtsProfiles: {
      "custom-avatar": { provider: "irodori-webgpu", irodoriVersion: "v4-small", irodoriPrecision: "int4" },
      "sage-avatar": { provider: "irodori-webgpu", irodoriVersion: "v4-small", irodoriPrecision: "invalid" },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.irodoriPrecision, "int4");
  assert.equal(preferences.data.characterTtsProfiles["custom-avatar"].irodoriPrecision, "int4");
  assert.equal(preferences.data.characterTtsProfiles["sage-avatar"].irodoriPrecision, "int4");
  assert.equal(preferences.publicState().irodoriV4Int4ModelDirectory, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("built-in Kohaku and Hiro profiles keep the legacy Irodori model unless explicitly changed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-preferences-irodori-builtins-"));
  const file = path.join(root, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    irodoriVersion: "v4-small",
    characterTtsProfiles: {
      "amber-avatar": { provider: "irodori-webgpu", irodoriVoiceId: "builtin-kohaku" },
      "towa-avatar": { provider: "irodori-webgpu", irodoriVoiceId: "builtin-hiro" },
      "custom-avatar": { provider: "irodori-webgpu", irodoriVoiceId: "custom-voice" },
      "sage-avatar": { provider: "irodori-webgpu", irodoriVoiceId: "builtin-hiro", irodoriVersion: "v4-small" },
    },
  }));

  const profiles = new Preferences(file).data.characterTtsProfiles;

  assert.equal(profiles["amber-avatar"].irodoriVersion, "500m-v3");
  assert.equal(profiles["towa-avatar"].irodoriVersion, "500m-v3");
  assert.equal(profiles["custom-avatar"].irodoriVersion, "v4-small");
  assert.equal(profiles["sage-avatar"].irodoriVersion, "v4-small");
  fs.rmSync(root, { recursive: true, force: true });
});

test("preferences migrate legacy click-through and clamp voice countdown delay", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ clickThrough: true, voiceAutoSendDelayMs: 99_000 }));
  const state = new Preferences(file).publicState();
  assert.equal(state.mascotPointerMode, "click-through");
  assert.equal(state.clickThrough, true);
  assert.equal(state.voiceAutoSendDelayMs, 5000);
});

test("preferences persist only supported interface languages", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  const preferences = new Preferences(file);
  preferences.patch({ language: "en" });
  assert.equal(new Preferences(file).publicState().language, "en");
  fs.writeFileSync(file, JSON.stringify({ language: "fr" }));
  assert.equal(new Preferences(file).publicState().language, "ja");
});

test("remote ports and trusted-device records are bounded without exposing credentials", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-remote-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    remotePort: 80,
    remoteTailscaleHttpsPort: 70000,
    remoteTrustedDevices: [{
      id: "device_1234567890",
      tokenHash: "a".repeat(64),
      csrf: "csrf_123456789012345678901234",
      name: "My phone",
      address: "192.168.1.4",
      pairedAt: Date.now() - 1000,
      lastSeenAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }],
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.remotePort, 1024);
  assert.equal(preferences.data.remoteTailscaleHttpsPort, 65535);
  assert.equal(preferences.data.remoteTrustedDevices.length, 1);
  assert.equal(preferences.publicState().remoteTrustedDevices, undefined);
});

test("preferences store a separate realtime voice for each character", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    realtimeVoice: "sol",
    characterTtsProfiles: {
      "amber-avatar": { provider: "system", realtimeVoice: "ember" },
      "sage-avatar": { provider: "kokoro", realtimeVoice: "not-a-voice" },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].realtimeVoice, "ember");
  assert.equal(preferences.data.characterTtsProfiles["sage-avatar"].realtimeVoice, "sol");
});

test("preferences keep Beatrice 2 conversion and voice per character", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  const modelPath = path.join(directory, "voice.toml");
  fs.writeFileSync(modelPath, '[model]\nname = "Test voice"\nversion = "2.0"\n[voice.0]\nname = "Alice"\n');
  fs.writeFileSync(file, JSON.stringify({
    beatriceVstPath: "C:\\Beatrice\\beatrice.vst3",
    beatriceModelPath: modelPath,
    characterTtsProfiles: {
      "amber-avatar": {
        provider: "system", realtimeVoiceConversion: "beatrice-v2", beatriceVoiceId: 42,
        beatricePitchShift: 99, beatriceFormantShift: -9, beatriceInputGain: -80,
        beatriceOutputGain: 30, beatriceIntonation: 9, beatricePitchCorrection: 4,
        beatricePitchCorrectionType: 1,
      },
      "sage-avatar": { provider: "system", realtimeVoiceConversion: "invalid", beatriceVoiceId: 9000 },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].realtimeVoiceConversion, "beatrice-v2");
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatriceVoiceId, 42);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatricePitchShift, 24);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatriceFormantShift, -2);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatriceInputGain, -60);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatriceOutputGain, 20);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatriceIntonation, 3);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatricePitchCorrection, 1);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].beatricePitchCorrectionType, 1);
  assert.equal(preferences.data.characterTtsProfiles["sage-avatar"].realtimeVoiceConversion, "none");
  assert.equal(preferences.data.characterTtsProfiles["sage-avatar"].beatriceVoiceId, 999);
  assert.equal(preferences.data.beatriceModels[0].name, "Test voice");
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.publicState(), "beatriceVstPath"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.publicState(), "beatriceModels"), false);
});

test("preferences retain a character-scoped JP-Extra model and style without exposing the raw model catalog", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    sbv2Models: [{
      id: "sbv2-example-12345678",
      fileName: "model.aivmx",
      name: "Example",
      modelArchitecture: "ignored",
      speakers: [{ name: "Speaker", localId: 1, styles: [{ name: "Happy", localId: 4 }] }],
    }],
    characterTtsProfiles: {
      "amber-avatar": { provider: "sbv2-jp-extra", sbv2ModelId: "sbv2-example-12345678", sbv2SpeakerId: 1, sbv2StyleId: 4, sbv2StyleWeight: 1.25 },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].provider, "sbv2-jp-extra");
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].sbv2StyleId, 4);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].sbv2StyleWeight, 1.25);
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.publicState(), "sbv2Models"), false);
});

test("preferences promote the former generated Towa to the bundled character", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    characterId: "user-avatar-ms5afs58",
    customCharacters: [
      { id: "user-avatar-ms5afs58", name: "トワ", assetDir: "C:/generated/towa" },
      { id: "user-avatar-other", name: "別キャラ", assetDir: "C:/generated/other" },
    ],
    characterProfiles: { "user-avatar-ms5afs58": { name: "トワ改" } },
    characterTtsProfiles: { "user-avatar-ms5afs58": { provider: "kokoro", realtimeVoice: "ember" } },
    characterMemories: { "user-avatar-ms5afs58": [{ id: "memory-towa", category: "preference", content: "工具が好き" }] },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.characterId, "towa-avatar");
  assert.deepEqual(preferences.data.customCharacters.map((character) => character.id), ["user-avatar-other"]);
  assert.equal(preferences.data.characterProfiles["towa-avatar"].name, "トワ改");
  assert.equal(preferences.data.characterTtsProfiles["towa-avatar"].provider, "kokoro");
  assert.equal(preferences.data.characterMemories["towa-avatar"][0].content, "工具が好き");
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.data.characterProfiles, "user-avatar-ms5afs58"), false);
});

test("preferences promote the profile AI Nike character to the bundled character", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  const legacyId = "user-avatar-ai-nike-smooth-v2";
  fs.writeFileSync(file, JSON.stringify({
    characterId: legacyId,
    customCharacters: [
      { id: legacyId, name: "AIニケちゃん Smooth", assetDir: "C:/generated/nike" },
      { id: "user-avatar-other", name: "別キャラ", assetDir: "C:/generated/other" },
    ],
    characterProfiles: { [legacyId]: { name: "AIニケちゃん", personality: "実践を大切にする" } },
    characterTtsProfiles: { [legacyId]: { provider: "sbv2-jp-extra", sbv2ModelId: "sbv2-nike", realtimeVoice: "maple", realtimeVoiceConversion: "beatrice-v2" } },
    conversationHistories: { [legacyId]: [{ role: "user", text: "こんにちは" }] },
    characterMemories: { [legacyId]: [{ id: "memory-nike", category: "preference", content: "実例を重視" }] },
    characterWorkspaces: { [legacyId]: { activeProjectId: "home", projects: [] } },
    workHistory: [{ id: "work-nike", request: "調査して", status: "completed", characterId: legacyId, characterName: "AIニケちゃん" }],
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.characterId, "nike-avatar");
  assert.deepEqual(preferences.data.customCharacters.map((character) => character.id), ["user-avatar-other"]);
  assert.equal(preferences.data.characterProfiles["nike-avatar"].name, "AIニケちゃん");
  assert.equal(preferences.data.characterTtsProfiles["nike-avatar"].provider, "sbv2-jp-extra");
  assert.equal(preferences.data.characterTtsProfiles["nike-avatar"].sbv2ModelId, "sbv2-nike");
  assert.equal(preferences.data.conversationHistories["nike-avatar"][0].text, "こんにちは");
  assert.equal(preferences.data.characterMemories["nike-avatar"][0].content, "実例を重視");
  assert.equal(preferences.data.workHistory[0].characterId, "nike-avatar");
  assert.equal(Object.prototype.hasOwnProperty.call(preferences.data.characterProfiles, legacyId), false);
});

test("preferences persist and sanitize English pronunciation settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  const preferences = new Preferences(file);
  preferences.patch({ englishPronunciationEnabled: false, englishPronunciationDictionary: "Foo=フー" });
  const restored = new Preferences(file).publicState();
  assert.equal(restored.englishPronunciationEnabled, false);
  assert.equal(restored.englishPronunciationDictionary, "Foo=フー");

  fs.writeFileSync(file, JSON.stringify({ englishPronunciationEnabled: "yes", englishPronunciationDictionary: 42 }));
  const sanitized = new Preferences(file).publicState();
  assert.equal(sanitized.englishPronunciationEnabled, true);
  assert.equal(sanitized.englishPronunciationDictionary, "");
});

test("preferences keep safe app update settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ updateChecksEnabled: false, updateChannel: "beta", updateLastCheckedAt: "2026-08-06T01:02:03.000Z" }));
  const preferences = new Preferences(file).publicState();
  assert.equal(preferences.updateChecksEnabled, false);
  assert.equal(preferences.updateChannel, "beta");
  assert.equal(preferences.updateLastCheckedAt, "2026-08-06T01:02:03.000Z");

  fs.writeFileSync(file, JSON.stringify({ updateChecksEnabled: "yes", updateChannel: "nightly", updateLastCheckedAt: { unsafe: true } }));
  const sanitized = new Preferences(file).publicState();
  assert.equal(sanitized.updateChecksEnabled, true);
  assert.equal(sanitized.updateChannel, "stable");
  assert.equal(sanitized.updateLastCheckedAt, "");
});

test("preferences migrate the former Codex model to chat and work", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ codexModel: "legacy-model" }));
  const state = new Preferences(file).publicState();
  assert.equal(state.codexChatModel, "legacy-model");
  assert.equal(state.codexWorkModel, "legacy-model");
});

test("preferences migrate removed wake-word activation to VAD", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ voiceActivationMode: "wake-word", voiceWakeWord: "ぷるぺっと" }));
  const state = new Preferences(file).publicState();
  assert.equal(state.voiceActivationMode, "vad");
  assert.equal(state.vadSensitivity, "normal");
  assert.equal(Object.prototype.hasOwnProperty.call(state, "voiceWakeWord"), false);
});

test("preferences migrate removed automatic and Codex audio input choices", () => {
  for (const removedProvider of ["auto", "codex-audio"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
    const file = path.join(directory, "preferences.json");
    fs.writeFileSync(file, JSON.stringify({ speechInputProvider: removedProvider }));
    assert.equal(new Preferences(file).data.speechInputProvider, "browser");
  }
});

test("preferences restore bounded per-character conversations and work history", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-prefs-"));
  const file = path.join(directory, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    characterProfiles: {
      "amber-avatar": { name: "琥珀", personality: "元の設定" },
    },
    conversationHistories: {
      "amber-avatar": Array.from({ length: 45 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        text: `message-${index}`,
        createdAt: "2026-07-29T00:00:00.000Z",
      })),
      invalid: [{ role: "system", text: "hidden" }],
    },
    characterMemories: {
      "amber-avatar": [{ id: "memory-1", category: "preference", content: "短い説明が好き", createdAt: "2026-07-29T00:00:00.000Z" }],
    },
    workHistory: [{
      id: "work-1",
      status: "running",
      request: "作業を続けて",
      activities: ["処理中"],
      characterId: "amber-avatar",
      characterName: "琥珀",
      workDirectoryName: "project",
      workspaceKey: "abcdef0123456789abcdef01",
      artifacts: [{ path: "dist/report.html", name: "report.html", kind: "file" }],
    }],
  }));
  const restored = new Preferences(file);
  assert.equal(restored.data.conversationHistories["amber-avatar"].length, 40);
  assert.equal(restored.data.conversationHistories["amber-avatar"][0].text, "message-5");
  assert.equal(Object.prototype.hasOwnProperty.call(restored.data.conversationHistories, "invalid"), false);
  assert.equal(restored.data.characterMemories["amber-avatar"][0].content, "短い説明が好き");
  assert.equal(restored.data.characterProfiles["amber-avatar"].name, "コハク");
  assert.equal(restored.data.characterProfiles["amber-avatar"].personality, "元の設定");
  assert.equal(restored.data.workHistory[0].status, "interrupted");
  assert.equal(restored.data.workHistory[0].characterName, "コハク");
  assert.match(restored.data.workHistory[0].result, /アプリの終了/);
  assert.equal(restored.data.workHistory[0].workspaceKey, "abcdef0123456789abcdef01");
  assert.deepEqual(restored.data.workHistory[0].artifacts, [{ path: "dist/report.html", name: "report.html", kind: "file" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(restored.publicState(), "conversationHistories"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(restored.publicState(), "characterMemories"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(restored.publicState(), "workHistory"), false);
});

test("preferences migrate the former Irodori default to Sway 8", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-preferences-"));
  const file = path.join(root, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    irodoriSteps: 16,
    irodoriAutoEmotion: false,
    irodoriEmotionStrength: "expressive",
    characterTtsProfiles: {
      "amber-avatar": { provider: "irodori-webgpu", irodoriAutoEmotion: false, irodoriEmotionStrength: "subtle" },
    },
  }));
  const preferences = new Preferences(file);
  const state = preferences.publicState();
  assert.equal(state.irodoriSamplingMode, "sway");
  assert.equal(state.irodoriSteps, 8);
  assert.equal(state.irodoriAutoEmotion, false);
  assert.equal(state.irodoriEmotionStrength, "expressive");
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].irodoriAutoEmotion, false);
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].irodoriEmotionStrength, "subtle");
  fs.rmSync(root, { recursive: true, force: true });
});

test("preferences retain Irodori 500M-v3 globally and per character", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-preferences-irodori-v3-"));
  const file = path.join(root, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({
    irodoriVersion: "500m-v3",
    irodoriModelDirectory: "C:/models/irodori-v3",
    characterTtsProfiles: {
      "amber-avatar": { provider: "irodori-webgpu", irodoriVersion: "500m-v3" },
    },
  }));
  const preferences = new Preferences(file);
  assert.equal(preferences.data.irodoriVersion, "500m-v3");
  assert.equal(preferences.data.characterTtsProfiles["amber-avatar"].irodoriVersion, "500m-v3");
  fs.rmSync(root, { recursive: true, force: true });
});

test("preferences migrate a pre-version Irodori model folder to 500M-v3", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-preferences-irodori-legacy-"));
  const file = path.join(root, "preferences.json");
  fs.writeFileSync(file, JSON.stringify({ irodoriModelDirectory: "C:/models/irodori-v3" }));
  assert.equal(new Preferences(file).data.irodoriVersion, "500m-v3");
  fs.rmSync(root, { recursive: true, force: true });
});

test("preferences expose only the work folder name to renderer windows", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-work-"));
  const preferences = new Preferences(path.join(directory, "preferences.json"));
  preferences.patch({ interactionMode: "work", workDirectory: path.join(directory, "private-project") });
  const state = preferences.publicState();
  assert.equal(state.interactionMode, "work");
  assert.equal(state.workDirectoryName, "private-project");
  assert.equal(Object.prototype.hasOwnProperty.call(state, "workDirectory"), false);
});
