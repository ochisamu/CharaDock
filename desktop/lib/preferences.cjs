// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_REALTIME_VOICE, normalizeRealtimeVoice } = require("./realtime-voice.cjs");
const { normalizeCharacterMemories } = require("./character-memory.cjs");
const { BUNDLED_IRODORI_VOICES } = require("./irodori-voices.cjs");
const { normalizeIrodoriEmotionStrength } = require("./irodori-caption.cjs");
const { describeBeatriceModel } = require("./beatrice-v2.cjs");
const { normalizeCharacterWorkspaces } = require("./character-home.cjs");
const { normalizeContinuationSummaries } = require("./continuation-summary.cjs");
const { normalizeManagedSkills, normalizeSkillAssignments } = require("./skill-library.cjs");

const DEFAULT_IRODORI_VOICES = Object.freeze(BUNDLED_IRODORI_VOICES.map(({ sourceFileName: _sourceFileName, ...voice }) => Object.freeze({ ...voice })));
const DEFAULT_CHARACTER_TTS_PROFILES = Object.freeze({
  "amber-avatar": Object.freeze({ provider: "irodori-webgpu", realtimeVoice: "maple", realtimeVoiceConversion: "none", beatriceModelId: "", beatriceVoiceId: 0, beatricePitchShift: 0, beatriceFormantShift: 0, beatriceInputGain: 0, beatriceOutputGain: 0, beatriceIntonation: 1, beatricePitchCorrection: 0, beatricePitchCorrectionType: 0, irodoriVoiceId: "builtin-kohaku", irodoriVersion: "500m-v3", irodoriPrecision: "fp16", supertonicVoice: "F5", kokoroVoice: "jf_alpha", sbv2ModelId: "", sbv2SpeakerId: 0, sbv2StyleId: 0, sbv2StyleWeight: 1 }),
  "bronze-avatar": Object.freeze({ provider: "supertonic-3", realtimeVoice: "juniper", realtimeVoiceConversion: "none", beatriceModelId: "", beatriceVoiceId: 0, beatricePitchShift: 0, beatriceFormantShift: 0, beatriceInputGain: 0, beatriceOutputGain: 0, beatriceIntonation: 1, beatricePitchCorrection: 0, beatricePitchCorrectionType: 0, irodoriVoiceId: "builtin-kohaku", irodoriVersion: "500m-v3", irodoriPrecision: "fp16", supertonicVoice: "F2", kokoroVoice: "jf_alpha", sbv2ModelId: "", sbv2SpeakerId: 0, sbv2StyleId: 0, sbv2StyleWeight: 1 }),
  "towa-avatar": Object.freeze({ provider: "irodori-webgpu", realtimeVoice: "spruce", realtimeVoiceConversion: "none", beatriceModelId: "", beatriceVoiceId: 0, beatricePitchShift: 0, beatriceFormantShift: 0, beatriceInputGain: 0, beatriceOutputGain: 0, beatriceIntonation: 1, beatricePitchCorrection: 0, beatricePitchCorrectionType: 0, irodoriVoiceId: "builtin-hiro", irodoriVersion: "500m-v3", irodoriPrecision: "fp16", supertonicVoice: "M4", kokoroVoice: "jf_alpha", sbv2ModelId: "", sbv2SpeakerId: 0, sbv2StyleId: 0, sbv2StyleWeight: 1 }),
  "sage-avatar": Object.freeze({ provider: "supertonic-3", realtimeVoice: "ember", realtimeVoiceConversion: "none", beatriceModelId: "", beatriceVoiceId: 0, beatricePitchShift: 0, beatriceFormantShift: 0, beatriceInputGain: 0, beatriceOutputGain: 0, beatriceIntonation: 1, beatricePitchCorrection: 0, beatricePitchCorrectionType: 0, irodoriVoiceId: "builtin-hiro", irodoriVersion: "500m-v3", irodoriPrecision: "fp16", supertonicVoice: "M2", kokoroVoice: "jf_gongitsune", sbv2ModelId: "", sbv2SpeakerId: 0, sbv2StyleId: 0, sbv2StyleWeight: 1 }),
  "nike-avatar": Object.freeze({ provider: "system", realtimeVoice: "maple", realtimeVoiceConversion: "none", beatriceModelId: "", beatriceVoiceId: 0, beatricePitchShift: 0, beatriceFormantShift: 0, beatriceInputGain: 0, beatriceOutputGain: 0, beatriceIntonation: 1, beatricePitchCorrection: 0, beatricePitchCorrectionType: 0, irodoriVoiceId: "builtin-kohaku", irodoriVersion: "v4-small", irodoriPrecision: "int4", supertonicVoice: "F5", kokoroVoice: "jf_alpha", sbv2ModelId: "", sbv2SpeakerId: 0, sbv2StyleId: 0, sbv2StyleWeight: 1 }),
});

const DEFAULTS = Object.freeze({
  language: "ja",
  backend: "codex",
  characterId: "amber-avatar",
  openaiModel: "gpt-5.6-luna",
  transcriptionModel: "gpt-4o-mini-transcribe",
  codexModel: "",
  codexChatModel: "",
  codexChatReasoningEffort: "",
  codexWorkModel: "",
  codexWorkReasoningEffort: "",
  alwaysOnTop: true,
  clickThrough: false,
  mascotPointerMode: "interactive",
  mouseFollow: true,
  launchAtLogin: false,
  ttsEnabled: true,
  ttsProvider: "system",
  styleBertVits2Url: "http://localhost:5000",
  styleBertVits2ModelId: 0,
  styleBertVits2Speed: 1,
  piperPlusExecutablePath: "",
  piperPlusModelPath: "",
  piperPlusSpeed: .8,
  supertonicModelDirectory: "",
  supertonicVoice: "F1",
  supertonicSpeed: 1,
  supertonicSteps: 8,
  irodoriModelDirectory: "",
  irodoriV4ModelDirectory: "",
  irodoriV4Int4ModelDirectory: "",
  irodoriReferenceAudioPath: "",
  irodoriVoices: DEFAULT_IRODORI_VOICES,
  irodoriVoiceId: "builtin-kohaku",
  irodoriSpeed: 1.1,
  irodoriSteps: 12,
  irodoriSamplingMode: "sway",
  irodoriSeed: 0,
  irodoriVersion: "v4-small",
  irodoriPrecision: "fp16",
  irodoriMode: "reference",
  irodoriCaption: "自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。",
  irodoriAutoEmotion: true,
  irodoriEmotionStrength: "natural",
  irodoriCfgExecution: "sequential",
  kokoroModelDirectory: "",
  kokoroVoice: "jf_alpha",
  kokoroSpeed: 1,
  kokoroDevice: "auto",
  sbv2Models: [],
  sbv2ModelId: "",
  sbv2SpeakerId: 0,
  sbv2StyleId: 0,
  sbv2StyleWeight: 1,
  sbv2Speed: 1,
  sbv2Device: "auto",
  characterTtsProfiles: DEFAULT_CHARACTER_TTS_PROFILES,
  realtimeVoice: DEFAULT_REALTIME_VOICE,
  beatriceVstPath: "",
  beatriceModelPath: "",
  beatriceModels: [],
  englishPronunciationEnabled: true,
  englishPronunciationDictionary: "",
  speechInputProvider: "browser",
  sherpaModelId: "reazonspeech-ja-int8",
  speechLanguage: "ja-JP",
  voiceActivationMode: "vad",
  vadSensitivity: "normal",
  voiceAutoSend: true,
  voiceAutoSendCountdown: true,
  voiceAutoSendDelayMs: 1500,
  updateChecksEnabled: true,
  updateChannel: "stable",
  updateLastCheckedAt: "",
  remoteAccessEnabled: false,
  remoteBindAddress: "",
  remoteWorkEnabled: true,
  remoteTtsEnabled: true,
  remotePcAudioEnabled: false,
  remoteResponseMode: "tts",
  remotePort: 41317,
  remoteSessionMinutes: 60,
  remoteTailscaleHttpsPort: 443,
  remoteTailscaleManaged: false,
  remoteStartupGreetingEnabled: true,
  remoteTrustedDevices: [],
  onboardingComplete: false,
  positionLocked: false,
  edgeSnap: true,
  preferredDisplayId: "",
  interactionMode: "chat",
  continuationStartupSpeechEnabled: true,
  continuationSummaries: {},
  managedSkills: [],
  skillAssignments: { all: [], characters: {} },
  workDirectory: "",
  characterProfiles: {},
  customCharacters: [],
  conversationHistories: {},
  characterMemories: {},
  characterWorkspaces: {},
  webPreviewRuntimes: {},
  workHistory: [],
  mascotBounds: null,
  controlBounds: null,
});

const PUBLIC_KEYS = new Set(Object.keys(DEFAULTS));
const LEGACY_TOWA_CHARACTER_ID = "user-avatar-ms5afs58";
const BUILT_IN_TOWA_CHARACTER_ID = "towa-avatar";
const BUILT_IN_KOHAKU_CHARACTER_ID = "amber-avatar";
const LEGACY_NIKE_CHARACTER_ID = "user-avatar-ai-nike-smooth-v2";
const BUILT_IN_NIKE_CHARACTER_ID = "nike-avatar";
const LEGACY_KOHAKU_DISPLAY_NAME = "琥珀";
const BUILT_IN_KOHAKU_DISPLAY_NAME = "コハク";

function normalizeConversationHistories(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([characterId, entries]) => {
    const id = String(characterId || "").slice(0, 120);
    if (!id || !Array.isArray(entries)) return [];
    const history = entries.slice(-40).flatMap((entry) => {
      const role = entry?.role === "assistant" ? "assistant" : entry?.role === "user" ? "user" : "";
      const text = String(entry?.text || "").trim().slice(0, 12_000);
      const createdAt = String(entry?.createdAt || "").slice(0, 40);
      return role && text ? [{ role, text, createdAt }] : [];
    });
    return history.length ? [[id, history]] : [];
  }));
}

function normalizeWorkHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 24).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const id = String(entry.id || "").slice(0, 120);
    const request = String(entry.request || "").trim().slice(0, 12_000);
    if (!id || !request) return [];
    const wasActive = ["running", "stopping"].includes(entry.status);
    const status = wasActive ? "interrupted" : ["completed", "interrupted", "failed"].includes(entry.status) ? entry.status : "failed";
    return [{
      id,
      startedAt: String(entry.startedAt || "").slice(0, 40),
      finishedAt: String(entry.finishedAt || (wasActive ? new Date().toISOString() : "")).slice(0, 40),
      status,
      request,
      activities: (Array.isArray(entry.activities) ? entry.activities : []).slice(-12).map((item) => String(item || "").slice(0, 160)).filter(Boolean),
      result: String(entry.result || (wasActive ? "アプリの終了により作業を中断しました。" : "")).slice(0, 24_000),
      characterId: String(entry.characterId || "").slice(0, 120),
      characterName: String(entry.characterName || "").slice(0, 80),
      workDirectoryName: String(entry.workDirectoryName || "").slice(0, 260),
      workspaceKey: /^[a-f0-9]{24}$/.test(String(entry.workspaceKey || "")) ? String(entry.workspaceKey) : "",
      continuationScopeKey: /^(?:common|home|project-[a-f0-9]{16})$/.test(String(entry.continuationScopeKey || "")) ? String(entry.continuationScopeKey) : "",
      continuationProjectName: String(entry.continuationProjectName || "").slice(0, 100),
      continuationRecordedAt: String(entry.continuationRecordedAt || "").slice(0, 40),
      artifacts: (Array.isArray(entry.artifacts) ? entry.artifacts : []).slice(0, 12).flatMap((artifact) => {
        const artifactPath = String(artifact?.path || "").replace(/\\/g, "/").slice(0, 1000);
        if (!artifactPath || artifactPath === ".." || artifactPath.startsWith("../") || artifactPath.startsWith("/") || /^[A-Za-z]:/.test(artifactPath)) return [];
        return [{
          path: artifactPath,
          name: String(artifact?.name || "").slice(0, 260),
          kind: artifact?.kind === "directory" ? "directory" : "file",
        }];
      }),
    }];
  });
}

function migrateBundledTowaPreferenceData(data) {
  let changed = false;
  if (data.characterId === LEGACY_TOWA_CHARACTER_ID) {
    data.characterId = BUILT_IN_TOWA_CHARACTER_ID;
    changed = true;
  }
  if (Array.isArray(data.customCharacters)) {
    const remaining = data.customCharacters.filter((character) => character?.id !== LEGACY_TOWA_CHARACTER_ID);
    if (remaining.length !== data.customCharacters.length) {
      data.customCharacters = remaining;
      changed = true;
    }
  }
  for (const profileKey of ["characterProfiles", "characterTtsProfiles", "conversationHistories", "characterMemories", "characterWorkspaces", "continuationSummaries"]) {
    const profiles = data[profileKey];
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles) || !profiles[LEGACY_TOWA_CHARACTER_ID]) continue;
    if (!profiles[BUILT_IN_TOWA_CHARACTER_ID]) profiles[BUILT_IN_TOWA_CHARACTER_ID] = profiles[LEGACY_TOWA_CHARACTER_ID];
    delete profiles[LEGACY_TOWA_CHARACTER_ID];
    changed = true;
  }
  if (Array.isArray(data.workHistory)) {
    for (const run of data.workHistory) {
      if (run?.characterId === LEGACY_TOWA_CHARACTER_ID) {
        run.characterId = BUILT_IN_TOWA_CHARACTER_ID;
        changed = true;
      }
    }
  }
  return changed;
}

function migrateBundledKohakuDisplayName(data) {
  let changed = false;
  const profile = data.characterProfiles?.[BUILT_IN_KOHAKU_CHARACTER_ID];
  if (profile?.name === LEGACY_KOHAKU_DISPLAY_NAME) {
    profile.name = BUILT_IN_KOHAKU_DISPLAY_NAME;
    changed = true;
  }
  if (Array.isArray(data.workHistory)) {
    for (const run of data.workHistory) {
      if (run?.characterId === BUILT_IN_KOHAKU_CHARACTER_ID && run.characterName === LEGACY_KOHAKU_DISPLAY_NAME) {
        run.characterName = BUILT_IN_KOHAKU_DISPLAY_NAME;
        changed = true;
      }
    }
  }
  return changed;
}

function migrateBundledNikePreferenceData(data) {
  let changed = false;
  if (data.characterId === LEGACY_NIKE_CHARACTER_ID) {
    data.characterId = BUILT_IN_NIKE_CHARACTER_ID;
    changed = true;
  }
  if (Array.isArray(data.customCharacters)) {
    const remaining = data.customCharacters.filter((character) => character?.id !== LEGACY_NIKE_CHARACTER_ID);
    if (remaining.length !== data.customCharacters.length) {
      data.customCharacters = remaining;
      changed = true;
    }
  }
  for (const profileKey of ["characterProfiles", "characterTtsProfiles", "conversationHistories", "characterMemories", "characterWorkspaces", "continuationSummaries"]) {
    const profiles = data[profileKey];
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles) || !profiles[LEGACY_NIKE_CHARACTER_ID]) continue;
    if (!profiles[BUILT_IN_NIKE_CHARACTER_ID]) profiles[BUILT_IN_NIKE_CHARACTER_ID] = profiles[LEGACY_NIKE_CHARACTER_ID];
    delete profiles[LEGACY_NIKE_CHARACTER_ID];
    changed = true;
  }
  if (Array.isArray(data.workHistory)) {
    for (const run of data.workHistory) {
      if (run?.characterId === LEGACY_NIKE_CHARACTER_ID) {
        run.characterId = BUILT_IN_NIKE_CHARACTER_ID;
        changed = true;
      }
    }
  }
  data.characterTtsProfiles ||= {};
  if (!data.characterTtsProfiles[BUILT_IN_NIKE_CHARACTER_ID]) {
    data.characterTtsProfiles[BUILT_IN_NIKE_CHARACTER_ID] = { ...DEFAULT_CHARACTER_TTS_PROFILES[BUILT_IN_NIKE_CHARACTER_ID] };
    changed = true;
  }
  return changed;
}

class Preferences {
  constructor(filePath, safeStorage = null) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.data = {
      ...DEFAULTS,
      characterTtsProfiles: Object.fromEntries(Object.entries(DEFAULT_CHARACTER_TTS_PROFILES).map(([id, profile]) => [id, {
        ...profile,
        styleBertVits2ModelId: Number(profile.styleBertVits2ModelId) || 0,
      }])),
    };
    this.sessionApiKey = "";
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      for (const key of PUBLIC_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) this.data[key] = parsed[key];
      }
      // Migrate the former single Codex model setting without discarding it.
      if (typeof parsed.codexModel === "string") {
        if (!Object.prototype.hasOwnProperty.call(parsed, "codexChatModel")) this.data.codexChatModel = parsed.codexModel;
        if (!Object.prototype.hasOwnProperty.call(parsed, "codexWorkModel")) this.data.codexWorkModel = parsed.codexModel;
      }
      if (!Object.prototype.hasOwnProperty.call(parsed, "continuationStartupSpeechEnabled")
        && typeof parsed.continuationEnabled === "boolean") {
        this.data.continuationStartupSpeechEnabled = parsed.continuationEnabled;
      }
      if (!["ja", "en"].includes(this.data.language)) this.data.language = "ja";
      if (!["manual", "vad"].includes(this.data.voiceActivationMode)) this.data.voiceActivationMode = "vad";
      if (!["low", "normal", "high"].includes(this.data.vadSensitivity)) this.data.vadSensitivity = "normal";
      if (!Object.prototype.hasOwnProperty.call(parsed, "mascotPointerMode")) {
        this.data.mascotPointerMode = parsed.clickThrough === true ? "click-through" : "interactive";
      } else if (!["interactive", "auto-hide", "click-through"].includes(this.data.mascotPointerMode)) {
        this.data.mascotPointerMode = "interactive";
      }
      this.data.clickThrough = this.data.mascotPointerMode === "click-through";
      if (typeof this.data.voiceAutoSendCountdown !== "boolean") this.data.voiceAutoSendCountdown = true;
      this.data.voiceAutoSendDelayMs = Math.min(5000, Math.max(600, Math.round(Number(this.data.voiceAutoSendDelayMs) || 1500)));
      if (typeof this.data.updateChecksEnabled !== "boolean") this.data.updateChecksEnabled = true;
      if (!["stable", "beta"].includes(this.data.updateChannel)) this.data.updateChannel = "stable";
      this.data.updateLastCheckedAt = typeof this.data.updateLastCheckedAt === "string" ? this.data.updateLastCheckedAt.slice(0, 40) : "";
      if (typeof this.data.remoteAccessEnabled !== "boolean") this.data.remoteAccessEnabled = false;
      this.data.remoteBindAddress = typeof this.data.remoteBindAddress === "string" ? this.data.remoteBindAddress.slice(0, 45) : "";
      if (typeof this.data.remoteWorkEnabled !== "boolean") this.data.remoteWorkEnabled = true;
      if (typeof this.data.remoteTtsEnabled !== "boolean") this.data.remoteTtsEnabled = true;
      if (typeof this.data.remotePcAudioEnabled !== "boolean") this.data.remotePcAudioEnabled = false;
      if (!["tts", "live"].includes(this.data.remoteResponseMode)) this.data.remoteResponseMode = "tts";
      this.data.remotePort = Math.max(1024, Math.min(65535, Math.round(Number(this.data.remotePort) || 41317)));
      this.data.remoteSessionMinutes = Math.max(15, Math.min(480, Math.round(Number(this.data.remoteSessionMinutes) || 60)));
      this.data.remoteTailscaleHttpsPort = Math.max(1, Math.min(65535, Math.round(Number(this.data.remoteTailscaleHttpsPort) || 443)));
      if (typeof this.data.remoteTailscaleManaged !== "boolean") this.data.remoteTailscaleManaged = false;
      this.data.remoteTrustedDevices = (Array.isArray(this.data.remoteTrustedDevices) ? this.data.remoteTrustedDevices : []).slice(0, 8).flatMap((device) => {
        const tokenHash = /^[a-f0-9]{64}$/.test(String(device?.tokenHash || "")) ? String(device.tokenHash) : "";
        const csrf = /^[A-Za-z0-9_-]{24,128}$/.test(String(device?.csrf || "")) ? String(device.csrf) : "";
        const id = /^[A-Za-z0-9_-]{12,64}$/.test(String(device?.id || "")) ? String(device.id) : "";
        const expiresAt = Number(device?.expiresAt) || 0;
        if (!tokenHash || !csrf || !id || expiresAt <= Date.now()) return [];
        return [{
          id, tokenHash, csrf,
          name: String(device?.name || "Web browser").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80),
          address: String(device?.address || "").slice(0, 64),
          pairedAt: Number(device?.pairedAt) || Date.now(),
          lastSeenAt: Number(device?.lastSeenAt) || Number(device?.pairedAt) || Date.now(),
          expiresAt,
        }];
      });
      if (typeof this.data.englishPronunciationEnabled !== "boolean") this.data.englishPronunciationEnabled = true;
      if (typeof this.data.englishPronunciationDictionary !== "string") this.data.englishPronunciationDictionary = "";
      this.data.englishPronunciationDictionary = this.data.englishPronunciationDictionary.slice(0, 12_000);
      if (typeof this.data.piperPlusExecutablePath !== "string") this.data.piperPlusExecutablePath = "";
      if (typeof this.data.piperPlusModelPath !== "string") this.data.piperPlusModelPath = "";
      this.data.piperPlusExecutablePath = this.data.piperPlusExecutablePath.slice(0, 1000);
      this.data.piperPlusModelPath = this.data.piperPlusModelPath.slice(0, 1000);
      this.data.piperPlusSpeed = Math.min(2, Math.max(.5, Number(this.data.piperPlusSpeed) || 1));
      if (typeof this.data.supertonicModelDirectory !== "string") this.data.supertonicModelDirectory = "";
      this.data.supertonicModelDirectory = this.data.supertonicModelDirectory.slice(0, 1000);
      if (!/^[FM][1-5]$/.test(this.data.supertonicVoice)) this.data.supertonicVoice = "F1";
      this.data.supertonicSpeed = Math.min(2, Math.max(.5, Number(this.data.supertonicSpeed) || 1));
      this.data.supertonicSteps = Math.min(20, Math.max(2, Math.round(Number(this.data.supertonicSteps) || 8)));
      if (typeof this.data.irodoriModelDirectory !== "string") this.data.irodoriModelDirectory = "";
      if (typeof this.data.irodoriV4ModelDirectory !== "string") this.data.irodoriV4ModelDirectory = "";
      if (typeof this.data.irodoriV4Int4ModelDirectory !== "string") this.data.irodoriV4Int4ModelDirectory = "";
      if (typeof this.data.irodoriReferenceAudioPath !== "string") this.data.irodoriReferenceAudioPath = "";
      this.data.irodoriModelDirectory = this.data.irodoriModelDirectory.slice(0, 1000);
      this.data.irodoriV4ModelDirectory = this.data.irodoriV4ModelDirectory.slice(0, 1000);
      this.data.irodoriV4Int4ModelDirectory = this.data.irodoriV4Int4ModelDirectory.slice(0, 1000);
      this.data.irodoriReferenceAudioPath = this.data.irodoriReferenceAudioPath.slice(0, 1000);
      if (!Array.isArray(this.data.irodoriVoices)) this.data.irodoriVoices = [];
      this.data.irodoriVoices = this.data.irodoriVoices.slice(0, 100).flatMap((voice) => {
        const id = String(voice?.id || "");
        const fileName = String(voice?.fileName || "");
        if (!/^[a-z0-9-]{8,80}$/.test(id) || fileName !== `${id}.wav`) return [];
        return [{
          id,
          fileName,
          name: String(voice?.name || "Voice").trim().slice(0, 80) || "Voice",
          createdAt: String(voice?.createdAt || "").slice(0, 40),
          builtIn: Boolean(voice?.builtIn),
          attributionUrl: String(voice?.attributionUrl || "").slice(0, 500),
        }];
      });
      this.data.irodoriVoiceId = String(this.data.irodoriVoiceId || "").slice(0, 80);
      this.data.irodoriSpeed = Math.min(2, Math.max(.5, Number(this.data.irodoriSpeed) || 1));
      const firstSwayMigration = !Object.prototype.hasOwnProperty.call(parsed, "irodoriSamplingMode");
      if (!["linear", "sway"].includes(this.data.irodoriSamplingMode)) this.data.irodoriSamplingMode = "sway";
      if (firstSwayMigration && Number(this.data.irodoriSteps) === 16) this.data.irodoriSteps = 8;
      this.data.irodoriSteps = Math.min(40, Math.max(4, Math.round(Number(this.data.irodoriSteps) || 8)));
      this.data.irodoriSeed = Math.min(2147483647, Math.max(0, Math.round(Number(this.data.irodoriSeed) || 0)));
      if (!Object.prototype.hasOwnProperty.call(parsed, "irodoriVersion") && this.data.irodoriModelDirectory && !this.data.irodoriV4ModelDirectory) {
        this.data.irodoriVersion = "500m-v3";
      } else if (!["500m-v3", "v4-small"].includes(this.data.irodoriVersion)) {
        this.data.irodoriVersion = "v4-small";
      }
      if (!["fp16", "int4"].includes(this.data.irodoriPrecision)) this.data.irodoriPrecision = "fp16";
      if (!["reference", "design"].includes(this.data.irodoriMode)) this.data.irodoriMode = "reference";
      this.data.irodoriCaption = String(this.data.irodoriCaption || "自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。").trim().slice(0, 1000);
      if (typeof this.data.irodoriAutoEmotion !== "boolean") this.data.irodoriAutoEmotion = true;
      this.data.irodoriEmotionStrength = normalizeIrodoriEmotionStrength(this.data.irodoriEmotionStrength);
      if (!["sequential", "batched"].includes(this.data.irodoriCfgExecution)) this.data.irodoriCfgExecution = "sequential";
      if (typeof this.data.kokoroModelDirectory !== "string") this.data.kokoroModelDirectory = "";
      this.data.kokoroModelDirectory = this.data.kokoroModelDirectory.slice(0, 1000);
      if (!["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"].includes(this.data.kokoroVoice)) this.data.kokoroVoice = "jf_alpha";
      this.data.kokoroSpeed = Math.min(2, Math.max(.5, Number(this.data.kokoroSpeed) || 1));
      if (!["auto", "webgpu", "wasm"].includes(this.data.kokoroDevice)) this.data.kokoroDevice = "auto";
      if (!Array.isArray(this.data.sbv2Models)) this.data.sbv2Models = [];
      this.data.sbv2Models = this.data.sbv2Models.slice(0, 100).flatMap((model) => {
        const id = String(model?.id || "");
        if (!/^sbv2-[a-z0-9-]{8,80}$/.test(id) || model?.fileName !== "model.aivmx") return [];
        const speakers = (Array.isArray(model.speakers) ? model.speakers : []).slice(0, 64).flatMap((speaker) => {
          const localId = Number(speaker?.localId);
          if (!Number.isInteger(localId) || localId < 0 || localId > 255) return [];
          const styles = (Array.isArray(speaker.styles) ? speaker.styles : []).slice(0, 64).flatMap((style) => {
            const styleId = Number(style?.localId);
            return Number.isInteger(styleId) && styleId >= 0 && styleId <= 255
              ? [{ name: String(style?.name || `Style ${styleId}`).slice(0, 80), localId: styleId }]
              : [];
          });
          return styles.length ? [{
            name: String(speaker?.name || `Speaker ${localId}`).slice(0, 80),
            localId,
            supportedLanguages: (Array.isArray(speaker.supportedLanguages) ? speaker.supportedLanguages : []).map((value) => String(value).slice(0, 20)).slice(0, 12),
            styles,
          }] : [];
        });
        if (!speakers.length) return [];
        return [{
          id,
          fileName: "model.aivmx",
          sourceFileName: String(model.sourceFileName || "model.aivmx").slice(0, 120),
          name: String(model.name || "JP-Extra Voice").slice(0, 80),
          createdAt: String(model.createdAt || "").slice(0, 40),
          sizeBytes: Math.max(0, Number(model.sizeBytes) || 0),
          description: String(model.description || "").slice(0, 1000),
          architecture: "Style-Bert-VITS2 (JP-Extra)",
          version: String(model.version || "").slice(0, 80),
          creators: (Array.isArray(model.creators) ? model.creators : []).map((value) => String(value).slice(0, 80)).slice(0, 20),
          license: String(model.license || "").slice(0, 20_000),
          speakers,
        }];
      });
      this.data.sbv2ModelId = String(this.data.sbv2ModelId || "").slice(0, 100);
      this.data.sbv2SpeakerId = Math.max(0, Math.min(255, Math.round(Number(this.data.sbv2SpeakerId) || 0)));
      this.data.sbv2StyleId = Math.max(0, Math.min(255, Math.round(Number(this.data.sbv2StyleId) || 0)));
      this.data.sbv2StyleWeight = Number.isFinite(Number(this.data.sbv2StyleWeight))
        ? Math.max(0, Math.min(2, Number(this.data.sbv2StyleWeight))) : 1;
      this.data.sbv2Speed = Math.min(2, Math.max(.5, Number(this.data.sbv2Speed) || 1));
      if (!["auto", "webgpu", "cpu"].includes(this.data.sbv2Device)) this.data.sbv2Device = "auto";
      if (!this.data.characterTtsProfiles || typeof this.data.characterTtsProfiles !== "object" || Array.isArray(this.data.characterTtsProfiles)) {
        this.data.characterTtsProfiles = {};
      }
      this.data.beatriceVstPath = String(this.data.beatriceVstPath || "").slice(0, 1000);
      this.data.beatriceModelPath = String(this.data.beatriceModelPath || "").slice(0, 1000);
      this.data.beatriceModels = (Array.isArray(this.data.beatriceModels) ? this.data.beatriceModels : []).slice(0, 40).flatMap((model) => {
        if (!model || typeof model !== "object") return [];
        const id = String(model.id || "").slice(0, 100);
        const modelPath = String(model.modelPath || "").slice(0, 1000);
        if (!id || !modelPath) return [];
        return [{ id, name: String(model.name || "Beatrice model").slice(0, 100), version: String(model.version || "").slice(0, 40), modelPath }];
      });
      if (!this.data.beatriceModels.length && this.data.beatriceModelPath) {
        try {
          const legacy = describeBeatriceModel(this.data.beatriceModelPath);
          if (legacy) this.data.beatriceModels = [{ id: legacy.id, name: legacy.name, version: legacy.version, modelPath: legacy.modelPath }];
        } catch {}
      }
      this.data.characterTtsProfiles = Object.fromEntries(Object.entries(this.data.characterTtsProfiles).slice(0, 100).flatMap(([characterId, profile]) => {
        const id = String(characterId || "").slice(0, 120);
        if (!id || !profile || typeof profile !== "object" || Array.isArray(profile)) return [];
        const defaultProfile = DEFAULT_CHARACTER_TTS_PROFILES[id] || {};
        const provider = ["system", "style-bert-vits2", "piper-plus", "supertonic-3", "irodori-webgpu", "kokoro", "sbv2-jp-extra"].includes(profile.provider)
          ? profile.provider : "system";
        return [[id, {
          provider,
          styleBertVits2ModelId: Math.min(9999, Math.max(0, Math.round(Number(profile.styleBertVits2ModelId ?? this.data.styleBertVits2ModelId) || 0))),
          realtimeVoice: normalizeRealtimeVoice(profile.realtimeVoice, normalizeRealtimeVoice(this.data.realtimeVoice)),
          realtimeVoiceConversion: profile.realtimeVoiceConversion === "beatrice-v2" ? "beatrice-v2" : "none",
          beatriceModelId: String(profile.beatriceModelId || "").slice(0, 100),
          beatriceVoiceId: Math.max(0, Math.min(999, Math.round(Number(profile.beatriceVoiceId) || 0))),
          beatricePitchShift: Math.max(-24, Math.min(24, Number(profile.beatricePitchShift) || 0)),
          beatriceFormantShift: Math.max(-2, Math.min(2, Number(profile.beatriceFormantShift) || 0)),
          beatriceInputGain: Math.max(-60, Math.min(20, Number(profile.beatriceInputGain) || 0)),
          beatriceOutputGain: Math.max(-60, Math.min(20, Number(profile.beatriceOutputGain) || 0)),
          beatriceIntonation: Math.max(-1, Math.min(3, Number.isFinite(Number(profile.beatriceIntonation)) ? Number(profile.beatriceIntonation) : 1)),
          beatricePitchCorrection: Math.max(0, Math.min(1, Number(profile.beatricePitchCorrection) || 0)),
          beatricePitchCorrectionType: Number(profile.beatricePitchCorrectionType) === 1 ? 1 : 0,
          irodoriVoiceId: String(profile.irodoriVoiceId || "").slice(0, 80),
          irodoriVersion: ["500m-v3", "v4-small"].includes(profile.irodoriVersion)
            ? profile.irodoriVersion
            : ["500m-v3", "v4-small"].includes(defaultProfile.irodoriVersion)
              ? defaultProfile.irodoriVersion : this.data.irodoriVersion,
          irodoriPrecision: ["fp16", "int4"].includes(profile.irodoriPrecision)
            ? profile.irodoriPrecision : this.data.irodoriPrecision,
          irodoriMode: ["reference", "design"].includes(profile.irodoriMode) ? profile.irodoriMode : "reference",
          irodoriCaption: String(profile.irodoriCaption || "").trim().slice(0, 1000),
          irodoriAutoEmotion: typeof profile.irodoriAutoEmotion === "boolean" ? profile.irodoriAutoEmotion : true,
          irodoriEmotionStrength: normalizeIrodoriEmotionStrength(profile.irodoriEmotionStrength),
          supertonicVoice: /^[FM][1-5]$/.test(String(profile.supertonicVoice || "")) ? String(profile.supertonicVoice) : "F1",
          kokoroVoice: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"].includes(profile.kokoroVoice)
            ? profile.kokoroVoice : "jf_alpha",
          sbv2ModelId: String(profile.sbv2ModelId || "").slice(0, 100),
          sbv2SpeakerId: Math.max(0, Math.min(255, Math.round(Number(profile.sbv2SpeakerId) || 0))),
          sbv2StyleId: Math.max(0, Math.min(255, Math.round(Number(profile.sbv2StyleId) || 0))),
          sbv2StyleWeight: Number.isFinite(Number(profile.sbv2StyleWeight))
            ? Math.max(0, Math.min(2, Number(profile.sbv2StyleWeight))) : 1,
        }]];
      }));
      this.data.realtimeVoice = normalizeRealtimeVoice(this.data.realtimeVoice);
      if (!["realtime", "sherpa-onnx", "browser", "openai"].includes(this.data.speechInputProvider)) {
        this.data.speechInputProvider = "browser";
      }
      this.data.conversationHistories = normalizeConversationHistories(this.data.conversationHistories);
      this.data.characterMemories = normalizeCharacterMemories(this.data.characterMemories);
      this.data.characterWorkspaces = normalizeCharacterWorkspaces(this.data.characterWorkspaces);
      if (typeof this.data.continuationStartupSpeechEnabled !== "boolean") this.data.continuationStartupSpeechEnabled = true;
      this.data.continuationSummaries = normalizeContinuationSummaries(this.data.continuationSummaries);
      this.data.managedSkills = normalizeManagedSkills(this.data.managedSkills);
      this.data.skillAssignments = normalizeSkillAssignments(this.data.skillAssignments, this.data.managedSkills.map((skill) => skill.id));
      this.data.webPreviewRuntimes = this.data.webPreviewRuntimes && typeof this.data.webPreviewRuntimes === "object" && !Array.isArray(this.data.webPreviewRuntimes)
        ? Object.fromEntries(Object.entries(this.data.webPreviewRuntimes).slice(0, 100).flatMap(([projectId, runtime]) =>
          /^web-[a-f0-9]{18}$/.test(String(projectId)) && ["auto", "windows", "wsl"].includes(runtime) ? [[projectId, runtime]] : []))
        : {};
      this.data.workHistory = normalizeWorkHistory(this.data.workHistory);
      if (typeof parsed.encryptedApiKey === "string") this.data.encryptedApiKey = parsed.encryptedApiKey;
      const migratedTowa = migrateBundledTowaPreferenceData(this.data);
      const migratedKohaku = migrateBundledKohakuDisplayName(this.data);
      const migratedNike = migrateBundledNikePreferenceData(this.data);
      if (migratedTowa || migratedKohaku || migratedNike) this.save();
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("Preferences load failed:", error);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  publicState() {
    const state = {};
    for (const key of PUBLIC_KEYS) {
      if (!["customCharacters", "workDirectory", "piperPlusExecutablePath", "piperPlusModelPath", "supertonicModelDirectory", "irodoriModelDirectory", "irodoriV4ModelDirectory", "irodoriV4Int4ModelDirectory", "irodoriReferenceAudioPath", "irodoriVoices", "kokoroModelDirectory", "sbv2Models", "beatriceVstPath", "beatriceModelPath", "beatriceModels", "characterTtsProfiles", "conversationHistories", "characterMemories", "characterWorkspaces", "continuationSummaries", "managedSkills", "skillAssignments", "webPreviewRuntimes", "workHistory", "remoteTrustedDevices"].includes(key)) state[key] = this.data[key];
    }
    state.hasWorkDirectory = Boolean(this.data.workDirectory);
    state.workDirectoryName = this.data.workDirectory ? path.basename(this.data.workDirectory) : "";
    state.hasApiKey = Boolean(this.getApiKey());
    state.apiKeyPersistence = this.canEncrypt() ? "encrypted" : "session";
    return state;
  }

  patch(values = {}) {
    for (const key of PUBLIC_KEYS) {
      if (Object.prototype.hasOwnProperty.call(values, key)) this.data[key] = values[key];
    }
    this.save();
    return this.publicState();
  }

  canEncrypt() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  setApiKey(apiKey) {
    const normalized = String(apiKey || "").trim();
    this.sessionApiKey = normalized;
    delete this.data.encryptedApiKey;
    if (normalized && this.canEncrypt()) {
      this.data.encryptedApiKey = this.safeStorage.encryptString(normalized).toString("base64");
      this.sessionApiKey = "";
    }
    this.save();
    return this.publicState();
  }

  getApiKey() {
    if (this.sessionApiKey) return this.sessionApiKey;
    if (!this.data.encryptedApiKey || !this.canEncrypt()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(this.data.encryptedApiKey, "base64"));
    } catch (error) {
      console.warn("API key decrypt failed:", error);
      return "";
    }
  }
}

module.exports = { DEFAULTS, Preferences, migrateBundledTowaPreferenceData, migrateBundledNikePreferenceData, normalizeConversationHistories, normalizeWorkHistory };
