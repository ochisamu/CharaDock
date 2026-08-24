// SPDX-License-Identifier: Apache-2.0
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("mascotDesktop", {
  getState: () => ipcRenderer.invoke("app:getState"),
  openExternalUrl: (url) => ipcRenderer.invoke("app:openExternalUrl", url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getRemoteStatus: () => ipcRenderer.invoke("remote:getStatus"),
  setRemoteConfig: (settings) => ipcRenderer.invoke("remote:setConfig", settings),
  regenerateRemotePairing: () => ipcRenderer.invoke("remote:regeneratePairing"),
  revokeRemoteSessions: () => ipcRenderer.invoke("remote:revokeAll"),
  revokeRemoteSession: (sessionId) => ipcRenderer.invoke("remote:revokeSession", sessionId),
  refreshRemoteTailscale: () => ipcRenderer.invoke("remote:tailscaleStatus"),
  startRemoteTailscale: () => ipcRenderer.invoke("remote:tailscaleStart"),
  stopRemoteTailscale: () => ipcRenderer.invoke("remote:tailscaleStop"),
  setApiKey: (key) => ipcRenderer.invoke("settings:setApiKey", key),
  saveMcpServer: (server) => ipcRenderer.invoke("mcp:save", server),
  setMcpServerEnabled: (serverId, enabled) => ipcRenderer.invoke("mcp:setEnabled", serverId, enabled),
  setMcpAssignment: (payload) => ipcRenderer.invoke("mcp:setAssignment", payload),
  removeMcpServer: (serverId) => ipcRenderer.invoke("mcp:remove", serverId),
  testMcpServer: (serverId) => ipcRenderer.invoke("mcp:test", serverId),
  setCharacter: (id) => ipcRenderer.invoke("character:set", id),
  removeCharacter: (id) => ipcRenderer.invoke("character:remove", id),
  removeMemory: (id) => ipcRenderer.invoke("memory:remove", id),
  clearMemories: () => ipcRenderer.invoke("memory:clear"),
  setContinuationStartupSpeech: (enabled) => ipcRenderer.invoke("continuation:setStartupSpeech", enabled),
  saveContinuationSummary: (summary) => ipcRenderer.invoke("continuation:save", summary),
  clearContinuationSummary: () => ipcRenderer.invoke("continuation:clear"),
  listTrustedSkills: () => ipcRenderer.invoke("skills:listTrusted"),
  inspectSkill: (sourceUrl) => ipcRenderer.invoke("skills:inspect", sourceUrl),
  installSkill: (payload) => ipcRenderer.invoke("skills:install", payload),
  setSkillAssignment: (payload) => ipcRenderer.invoke("skills:setAssignment", payload),
  removeSkill: (skillId) => ipcRenderer.invoke("skills:remove", skillId),
  configureCharacter: (profile) => ipcRenderer.invoke("character:configure", profile),
  configureCharacterDirector: (profile) => ipcRenderer.invoke("character:configureDirector", profile),
  previewCharacterMotion: (payload) => ipcRenderer.invoke("character:previewMotion", payload),
  generateCharacter: (payload) => ipcRenderer.invoke("character:generate", payload),
  importPuruPuruCharacter: (payload) => ipcRenderer.invoke("character:importPuruPuru", payload),
  sendVoiceLevel: (level) => ipcRenderer.invoke("mascot:voice", level),
  setExpression: (expression) => ipcRenderer.invoke("mascot:expression", expression),
  controlMascotWindow: (action, value) => ipcRenderer.invoke("mascot:window", action, value),
  sendChat: (message) => ipcRenderer.invoke("chat:send", message),
  followUpChat: (message) => ipcRenderer.invoke("chat:followUp", message),
  interruptChat: () => ipcRenderer.invoke("chat:interrupt"),
  resetChat: () => ipcRenderer.invoke("chat:reset"),
  getWorkHistory: () => ipcRenderer.invoke("work:getHistory"),
  chooseWorkDirectory: () => ipcRenderer.invoke("work:chooseDirectory"),
  activateWorkProject: (projectId) => ipcRenderer.invoke("work:activateProject", projectId),
  detachWorkProject: (projectId) => ipcRenderer.invoke("work:detachProject", projectId),
  openWorkDirectory: () => ipcRenderer.invoke("work:openDirectory"),
  openWorkArtifact: (payload) => ipcRenderer.invoke("work:openArtifact", payload),
  previewWorkArtifact: (payload) => ipcRenderer.invoke("work:previewArtifact", payload),
  startWebPreview: (payload) => ipcRenderer.invoke("work:webPreviewStart", payload),
  stopWebPreview: () => ipcRenderer.invoke("work:webPreviewStop"),
  getWebPreview: () => ipcRenderer.invoke("work:webPreviewState"),
  openWebPreview: () => ipcRenderer.invoke("work:webPreviewOpen"),
  testBackend: (backend) => ipcRenderer.invoke("backend:test", backend),
  getCodexAccount: () => ipcRenderer.invoke("codex:account"),
  detectCodex: () => ipcRenderer.invoke("codex:detect"),
  getCodexModels: () => ipcRenderer.invoke("codex:models"),
  getRealtimeVoices: () => ipcRenderer.invoke("codex:realtimeVoices"),
  startCodexLogin: () => ipcRenderer.invoke("codex:login"),
  logoutCodex: () => ipcRenderer.invoke("codex:logout"),
  completeOnboarding: (complete) => ipcRenderer.invoke("onboarding:complete", complete),
  startOnboardingFirstWork: (payload) => ipcRenderer.invoke("onboarding:startFirstWork", payload),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  openUpdateRelease: () => ipcRenderer.invoke("updates:openRelease"),
  getDiagnostics: () => ipcRenderer.invoke("support:getDiagnostics"),
  copyDiagnostics: () => ipcRenderer.invoke("support:copyDiagnostics"),
  exportSupportBundle: () => ipcRenderer.invoke("support:exportBundle"),
  openLogs: () => ipcRenderer.invoke("support:openLogs"),
  transcribe: (payload) => ipcRenderer.invoke("audio:transcribe", payload),
  transcribeSherpa: (payload) => ipcRenderer.invoke("audio:transcribeSherpa", payload),
  startStreamingSpeech: (payload) => ipcRenderer.invoke("audio:streamingSpeechStart", payload),
  appendStreamingSpeech: (payload) => ipcRenderer.invoke("audio:streamingSpeechAppend", payload),
  finishStreamingSpeech: (payload) => ipcRenderer.invoke("audio:streamingSpeechFinish", payload),
  cancelStreamingSpeech: (payload) => ipcRenderer.invoke("audio:streamingSpeechCancel", payload),
  transcribeStreamingSpeech: (payload) => ipcRenderer.invoke("audio:transcribeStreamingSpeech", payload),
  downloadSherpaModel: (modelId) => ipcRenderer.invoke("sherpa:modelDownload", modelId),
  removeSherpaModel: (modelId) => ipcRenderer.invoke("sherpa:modelRemove", modelId),
  downloadStreamingSpeechModel: (modelId) => ipcRenderer.invoke("streamingSpeech:modelDownload", modelId),
  removeStreamingSpeechModel: (modelId) => ipcRenderer.invoke("streamingSpeech:modelRemove", modelId),
  synthesizeTts: (text) => ipcRenderer.invoke("tts:synthesize", text),
  nextTtsChunk: (streamId) => ipcRenderer.invoke("tts:nextChunk", streamId),
  cancelTtsStream: (streamId) => ipcRenderer.invoke("tts:cancelStream", streamId),
  downloadTtsModel: (provider) => ipcRenderer.invoke("tts:modelDownload", provider),
  removeTtsModel: (provider) => ipcRenderer.invoke("tts:modelRemove", provider),
  choosePiperPlusExecutable: () => ipcRenderer.invoke("tts:piperChooseExecutable"),
  choosePiperPlusModel: () => ipcRenderer.invoke("tts:piperChooseModel"),
  chooseSupertonicModel: () => ipcRenderer.invoke("tts:supertonicChooseModel"),
  chooseIrodoriModel: () => ipcRenderer.invoke("tts:irodoriChooseModel"),
  chooseIrodoriReference: () => ipcRenderer.invoke("tts:irodoriChooseReference"),
  selectIrodoriVoice: (id) => ipcRenderer.invoke("tts:irodoriSelectVoice", id),
  renameIrodoriVoice: (payload) => ipcRenderer.invoke("tts:irodoriRenameVoice", payload),
  removeIrodoriVoice: (id) => ipcRenderer.invoke("tts:irodoriRemoveVoice", id),
  chooseSbv2Model: () => ipcRenderer.invoke("tts:sbv2ChooseModel"),
  renameSbv2Model: (payload) => ipcRenderer.invoke("tts:sbv2RenameModel", payload),
  removeSbv2Model: (id) => ipcRenderer.invoke("tts:sbv2RemoveModel", id),
  normalizeTtsText: (text) => ipcRenderer.invoke("tts:normalizeText", text),
  startCodexRealtime: (payload) => ipcRenderer.invoke("audio:realtimeStart", payload),
  appendCodexRealtimeText: (text, selectedSkillIds = [], selectedMcpServerIds = []) => ipcRenderer.invoke("audio:realtimeAppendText", { text, selectedSkillIds, selectedMcpServerIds }),
  setCodexRealtimeTurnSkills: (selectedSkillIds = []) => ipcRenderer.invoke("audio:realtimeTurnSkills", selectedSkillIds),
  setCodexRealtimeTurnMcp: (selectedMcpServerIds = []) => ipcRenderer.invoke("audio:realtimeTurnMcp", selectedMcpServerIds),
  appendCodexRealtimeSpeech: (text) => ipcRenderer.invoke("audio:realtimeAppendSpeech", text),
  stopCodexRealtime: () => ipcRenderer.invoke("audio:realtimeStop"),
  getBeatriceStatus: () => ipcRenderer.invoke("beatrice:status"),
  openBeatriceOfficialSite: () => ipcRenderer.invoke("beatrice:openOfficialSite"),
  chooseBeatriceInstallation: () => ipcRenderer.invoke("beatrice:chooseInstall"),
  addBeatriceModels: () => ipcRenderer.invoke("beatrice:addModels"),
  removeBeatriceModel: (modelId) => ipcRenderer.invoke("beatrice:removeModel", modelId),
  startBeatrice: () => ipcRenderer.invoke("beatrice:start"),
  pushBeatriceAudio: (audio) => ipcRenderer.send("beatrice:audio", audio),
  stopBeatrice: () => ipcRenderer.invoke("beatrice:stop"),
  onChatStream: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:stream", listener);
    return () => ipcRenderer.removeListener("chat:stream", listener);
  },
  onChatHistory: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chat:history", listener);
    return () => ipcRenderer.removeListener("chat:history", listener);
  },
  onWorkHistory: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("work:history", listener);
    return () => ipcRenderer.removeListener("work:history", listener);
  },
  onWebPreview: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("work:webPreviewState", listener);
    return () => ipcRenderer.removeListener("work:webPreviewState", listener);
  },
  onCharacterGeneration: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("character:generation", listener);
    return () => ipcRenderer.removeListener("character:generation", listener);
  },
  onStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:stateChanged", listener);
    return () => ipcRenderer.removeListener("app:stateChanged", listener);
  },
  onNavigateSettings: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("settings:navigate", listener);
    return () => ipcRenderer.removeListener("settings:navigate", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
  onCodexRealtime: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("audio:realtimeEvent", listener);
    return () => ipcRenderer.removeListener("audio:realtimeEvent", listener);
  },
  onCodexRealtimeTurnSkills: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("audio:realtimeTurnSkills", listener);
    return () => ipcRenderer.removeListener("audio:realtimeTurnSkills", listener);
  },
  onRemotePcAudio: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("remote:pcAudio", listener);
    return () => ipcRenderer.removeListener("remote:pcAudio", listener);
  },
  onStopNormalSpeech: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("audio:stopNormalSpeech", listener);
    return () => ipcRenderer.removeListener("audio:stopNormalSpeech", listener);
  },
  onBeatriceAudio: (callback) => {
    const listener = (_event, audio) => callback(audio);
    ipcRenderer.on("beatrice:audioOut", listener);
    return () => ipcRenderer.removeListener("beatrice:audioOut", listener);
  },
  onBeatriceError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("beatrice:error", listener);
    return () => ipcRenderer.removeListener("beatrice:error", listener);
  },
  onBeatriceSettingsChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("beatrice:settingsChanged", listener);
    return () => ipcRenderer.removeListener("beatrice:settingsChanged", listener);
  },
  onSherpaModelProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sherpa:modelProgress", listener);
    return () => ipcRenderer.removeListener("sherpa:modelProgress", listener);
  },
  onStreamingSpeechModelProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("streamingSpeech:modelProgress", listener);
    return () => ipcRenderer.removeListener("streamingSpeech:modelProgress", listener);
  },
  onTtsModelProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tts:modelProgress", listener);
    return () => ipcRenderer.removeListener("tts:modelProgress", listener);
  },
  onSbv2Progress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tts:sbv2Progress", listener);
    return () => ipcRenderer.removeListener("tts:sbv2Progress", listener);
  },
});
