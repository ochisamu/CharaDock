// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  let appState = null;
  let csrfToken = "";
  let eventSource = null;
  let currentMode = "chat";
  let busy = false;
  let audioEnabled = localStorage.getItem("charadock.remote.audio") === "1";
  let audioContext = null;
  let activeAudioSource = null;
  let mouthTimer = 0;
  let blinkTimer = 0;
  let currentMouth = "closed";
  let currentFaceKey = "eyesOpenMouthClosed";
  let avatarAssets = new Map();
  let settingsSaving = false;

  const text = (ja, en) => appState?.language === "en" ? en : ja;
  const artifactUrl = (runId, artifactPath) => `/api/artifact?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(artifactPath)}`;

  async function request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (csrfToken && options.method === "POST") headers["X-CharaDock-CSRF"] = csrfToken;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function setConnection(connected, label) {
    const chip = $("#connectionChip");
    chip.classList.toggle("is-offline", !connected);
    chip.querySelector("b").textContent = label || (connected ? text("接続中", "Connected") : text("未接続", "Offline"));
  }

  function setResponseText(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    $("#responseText").textContent = normalized;
    $("#historyCurrentText").textContent = normalized;
    const lines = normalized.split(/\r?\n/).length;
    $("#bubbleExpandButton").hidden = normalized.length < 74 && lines < 4;
  }

  function syncAvatarMotion() {
    const motion = appState?.character?.motion || {};
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
    const breath = .008 + clamp(motion.breathStrength, 0, 100) * .00027;
    const sway = 4 + clamp((Number(motion.rangeLeft) + Number(motion.rangeRight)) / 2, 0, 300) * .065;
    const lift = 3 + clamp(motion.pyokoStrength, 0, 100) * .065;
    const roll = .25 + clamp(motion.rollStrength, 0, 100) * .036;
    const hair = .4 + clamp(motion.hairWarp, 0, 100) * .026 + clamp(motion.hairSpring, 0, 200) * .003;
    const target = $("#avatarMotion");
    target.style.setProperty("--breath-full", String(1 + breath));
    target.style.setProperty("--breath-half", String(1 + breath * .5));
    target.style.setProperty("--sway-x", `${sway.toFixed(1)}px`);
    target.style.setProperty("--sway-y", `${lift.toFixed(1)}px`);
    target.style.setProperty("--body-roll", `${roll.toFixed(2)}deg`);
    target.style.setProperty("--body-roll-negative", `${(-roll).toFixed(2)}deg`);
    target.style.setProperty("--hair-roll", `${hair.toFixed(2)}deg`);
    target.style.setProperty("--hair-roll-negative", `${(-hair).toFixed(2)}deg`);
  }

  function deviceName() {
    const ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
    return navigator.userAgentData?.platform || navigator.platform || "Web browser";
  }

  function faceKey(openEyes = true, mouth = currentMouth) {
    const suffix = mouth === "open" ? "Open" : mouth === "half" ? "Half" : "Closed";
    return `${openEyes ? "eyesOpen" : "eyesClosed"}Mouth${suffix}`;
  }

  function showFace(key) {
    if (!appState?.character?.assetKeys?.includes(key)) key = "eyesOpenMouthClosed";
    currentFaceKey = key;
    const source = avatarAssets.get(key);
    if (source && $("#avatarFace").src !== source) $("#avatarFace").src = source;
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      showFace(faceKey(false));
      setTimeout(() => showFace(faceKey(true)), 115);
      scheduleBlink();
    }, 2800 + Math.random() * 2800);
  }

  async function syncAvatar() {
    const character = appState?.character;
    if (!character) return;
    for (const value of avatarAssets.values()) URL.revokeObjectURL(value);
    avatarAssets = new Map();
    await Promise.all(character.assetKeys.map(async (key) => {
      const response = await fetch(`/api/avatar/${encodeURIComponent(key)}?v=${encodeURIComponent(character.assetVersion || "1")}`, { cache: "force-cache" });
      if (response.ok) avatarAssets.set(key, URL.createObjectURL(await response.blob()));
    }));
    $("#responseSpeaker").textContent = character.name;
    $("#avatarFace").alt = character.name;
    for (const [selector, key] of [["#avatarBackHair", "backHair"], ["#avatarFrontHair", "frontHair"]]) {
      const image = $(selector);
      image.hidden = !character.assetKeys.includes(key);
      if (!image.hidden) image.src = avatarAssets.get(key) || "";
    }
    showFace(faceKey(true));
    syncAvatarMotion();
    scheduleBlink();
  }

  function safeHistory() {
    const chat = Array.isArray(appState?.conversationHistory) ? appState.conversationHistory : [];
    const work = Array.isArray(appState?.workHistory?.runs) ? appState.workHistory.runs : [];
    return [
      ...chat.map((item) => ({ label: item.role === "user" ? text("あなた · Chat", "You · Chat") : `${appState.character.name} · Chat`, body: item.text })),
      ...work.map((item) => ({ label: `${item.status === "completed" ? "✓" : "•"} Work · ${item.workDirectoryName || "Project"}`, body: item.result || item.request })),
    ].slice(-16).reverse();
  }

  function renderHistory() {
    const list = $("#historyList");
    $("#historyCurrentText").textContent = $("#responseText").textContent;
    list.replaceChildren();
    for (const item of safeHistory()) {
      const row = document.createElement("article");
      row.className = "history-item";
      const label = document.createElement("small");
      label.textContent = item.label;
      const body = document.createElement("p");
      body.textContent = String(item.body || "").slice(0, 1200);
      row.append(label, body);
      list.appendChild(row);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.textContent = text("まだ履歴はありません。", "No history yet.");
      list.appendChild(empty);
    }
  }

  function setMode(mode) {
    const requested = mode === "work" ? "work" : "chat";
    if (requested === "work" && !appState?.workAllowed) return;
    currentMode = requested;
    for (const [button, value] of [[$("#chatModeButton"), "chat"], [$("#workModeButton"), "work"]]) {
      const selected = value === currentMode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-checked", String(selected));
    }
    $("#composerHint").textContent = currentMode === "work"
      ? text(`${appState.workDirectoryName || "選択中のフォルダー"}内で作業`, `Work inside ${appState.workDirectoryName || "the selected folder"}`)
      : text("マイクなし · ローカルLAN内だけで接続", "No microphone · Local LAN only");
  }

  function setBusy(value) {
    busy = Boolean(value);
    $("#sendButton").hidden = busy;
    $("#interruptButton").hidden = !busy;
    $("#messageInput").disabled = busy;
    $("#activityIndicator").hidden = !busy;
    $("#responseBubble").classList.toggle("is-busy", busy);
    syncRemoteSettings();
  }

  function renderArtifacts(artifacts, runId) {
    const list = $("#artifactList");
    list.replaceChildren();
    for (const artifact of (Array.isArray(artifacts) ? artifacts : []).slice(0, 8)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "artifact-button";
      button.textContent = artifact.name || artifact.path;
      button.addEventListener("click", () => openArtifact(runId, artifact).catch((error) => { $("#responseText").textContent = error.message; }));
      list.appendChild(button);
    }
  }

  function syncRemoteSettings() {
    if (!appState) return;
    const voice = appState.voice || {};
    const characterSelect = $("#characterSelect");
    characterSelect.replaceChildren();
    for (const character of appState.characters || []) characterSelect.appendChild(new Option(character.name, character.id));
    characterSelect.value = appState.character?.id || "";
    characterSelect.disabled = busy || Boolean(voice.liveConnected);

    const responseMode = voice.responseMode === "live" ? "live" : "tts";
    $("#responseModeSelect").value = responseMode;
    $("#responseModeSelect").disabled = busy;
    const liveOption = [...$("#responseModeSelect").options].find((option) => option.value === "live");
    if (liveOption) liveOption.disabled = !voice.liveSupported;
    const providerSelect = $("#ttsProviderSelect");
    providerSelect.replaceChildren();
    for (const provider of voice.ttsProviderOptions || []) {
      const option = new Option(`${provider.name}${provider.phone ? "" : text(" · PCのみ", " · PC only")}`, provider.id);
      option.disabled = !provider.available;
      providerSelect.appendChild(option);
    }
    providerSelect.value = voice.ttsProvider || "system";
    providerSelect.disabled = busy || responseMode === "live";
    $("#ttsProviderField").hidden = responseMode === "live";

    const realtimeVoiceSelect = $("#realtimeVoiceSelect");
    realtimeVoiceSelect.replaceChildren();
    for (const name of voice.realtimeVoices || []) realtimeVoiceSelect.appendChild(new Option(name.replace(/^./, (value) => value.toUpperCase()), name));
    realtimeVoiceSelect.value = voice.realtimeVoice || "cove";
    realtimeVoiceSelect.disabled = busy || Boolean(voice.liveConnected);
    $("#realtimeVoiceField").hidden = responseMode !== "live";
    $("#pcAudioToggle").checked = voice.pcAudioEnabled !== false;
    $("#pcAudioToggle").disabled = busy;
    $("#phoneAudioToggle").checked = audioEnabled;
    $("#phoneAudioToggle").disabled = !appState.mobileTtsAllowed;
    $("#voiceRouteHint").textContent = responseMode === "live"
      ? voice.liveConnected
        ? text(`PCのGPT-Liveへ接続中。${voice.realtimeConversion === "beatrice-v2" ? "Beatrice 2で変換した" : "GPT-Liveの"}音声はPCから再生し、この端末には字幕を表示します。`, `Connected to GPT-Live on the PC. ${voice.realtimeConversion === "beatrice-v2" ? "Beatrice 2 converted" : "GPT-Live"} audio plays on the PC and captions appear here.`)
        : text("PCで録音ボタンを押してLiveへ接続すると、この端末の文字入力もGPT-Liveへ送れます。", "Start Live from the PC, then text from this device can be sent to GPT-Live.")
      : appState.mobileTtsAllowed
        ? text("通常TTSはPCとこの端末を個別にON / OFFできます。", "Standard TTS can be enabled independently on the PC and this device.")
        : text("選択中の通常TTSはこの端末へ転送できません。PC側の音声モデルを変更してください。", "The selected standard TTS cannot be sent to this device. Choose another voice model on the PC.");
  }

  async function saveRemoteClientSettings(patch) {
    if (settingsSaving) return;
    settingsSaving = true;
    $("#settingsSheet").classList.add("is-saving");
    try {
      const payload = await request("/api/settings", { method: "POST", body: JSON.stringify(patch) });
      applyState(payload.state);
    } catch (error) {
      setResponseText(error.message);
      syncRemoteSettings();
    } finally {
      settingsSaving = false;
      $("#settingsSheet").classList.remove("is-saving");
    }
  }

  function applyState(nextState) {
    if (!nextState) return;
    const changedCharacter = appState?.character?.id !== nextState.character?.id || appState?.character?.assetVersion !== nextState.character?.assetVersion;
    appState = nextState;
    document.documentElement.lang = appState.language === "en" ? "en" : "ja";
    $("#pairingView").hidden = true;
    $("#companionView").hidden = false;
    $("#workModeButton").disabled = !appState.workAllowed;
    if (!appState.workAllowed && currentMode === "work") currentMode = "chat";
    setMode(currentMode);
    if (changedCharacter) syncAvatar().catch(() => {});
    else syncAvatarMotion();
    if (appState.lastDisplayText) setResponseText(appState.lastDisplayText);
    const activeRun = appState.workHistory?.activeWorkRunId;
    setBusy(Boolean(activeRun || appState.busy));
    setConnection(true);
    renderHistory();
    syncAudioButton();
    syncRemoteSettings();
  }

  async function refreshState() {
    const payload = await request("/api/state");
    csrfToken = payload.csrfToken || csrfToken;
    applyState(payload.state);
  }

  function connectEvents() {
    eventSource?.close();
    eventSource = new EventSource("/api/events");
    eventSource.addEventListener("state", (event) => applyState(JSON.parse(event.data)));
    eventSource.addEventListener("stream", (event) => handleStream(JSON.parse(event.data)));
    eventSource.addEventListener("history", (event) => {
      if (appState) appState.workHistory = JSON.parse(event.data);
      renderHistory();
    });
    eventSource.onerror = () => {
      setConnection(false, text("再接続中", "Reconnecting"));
      refreshState().catch(() => showPairing(text("接続の有効期限が切れました。もう一度QRコードを読み取ってください。", "The connection expired. Scan the QR code again.")));
    };
  }

  async function pairFromFragment() {
    const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token") || "";
    if (!token) {
      try {
        await refreshState();
        connectEvents();
      } catch {
        showPairing();
      }
      return;
    }
    try {
      const payload = await request("/api/pair", { method: "POST", body: JSON.stringify({ token, deviceName: deviceName() }) });
      csrfToken = payload.csrfToken;
      history.replaceState(null, "", "/");
      applyState(payload.state);
      connectEvents();
    } catch (error) {
      history.replaceState(null, "", "/");
      showPairing(error.message);
    }
  }

  function showPairing(message = "") {
    eventSource?.close();
    $("#companionView").hidden = true;
    $("#pairingView").hidden = false;
    $("#pairingMessage").textContent = message || "CharaDockの設定画面にあるQRコードを読み取ってください。";
    $("#retryPairButton").hidden = !message;
    setConnection(false);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const input = $("#messageInput");
    const message = input.value.trim();
    if (!message || busy) return;
    input.value = "";
    input.style.height = "auto";
    setResponseText(message);
    renderArtifacts([], "");
    setBusy(true);
    try {
      await request("/api/message", { method: "POST", body: JSON.stringify({ message, mode: currentMode }) });
    } catch (error) {
      setBusy(false);
      setResponseText(error.message);
    }
  }

  async function interrupt() {
    $("#interruptButton").disabled = true;
    try { await request("/api/interrupt", { method: "POST", body: "{}" }); }
    catch (error) { setResponseText(error.message); }
    finally { $("#interruptButton").disabled = false; }
  }

  function handleStream(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.phase === "start") {
      setBusy(true);
      setResponseText(text("考え中…", "Thinking…"));
      renderArtifacts([], "");
      return;
    }
    if (["activity", "announcement"].includes(payload.phase)) {
      const value = payload.displayText || payload.text;
      if (value) setResponseText(value);
      if (payload.phase === "announcement") speak(value);
      return;
    }
    if (["delta", "realtime-caption"].includes(payload.phase)) {
      const value = payload.displayText || payload.text;
      if (value) setResponseText(value);
      if (payload.phase === "realtime-caption") setBusy(true);
      return;
    }
    if (payload.phase === "done") {
      const value = payload.displayText || payload.text || text("完了したよ。", "Done.");
      setResponseText(value);
      renderArtifacts(payload.artifacts, payload.workRunId);
      setBusy(false);
      if (!payload.realtimeOutput) speak(value);
      setTimeout(refreshState, 80);
      return;
    }
    if (payload.phase === "error") {
      setResponseText(payload.message || text("エラーが発生しました。", "Something went wrong."));
      setBusy(false);
      setTimeout(refreshState, 80);
    }
  }

  async function unlockAudio() {
    await setPhoneAudio(!audioEnabled);
  }

  async function setPhoneAudio(enabled) {
    if (enabled) {
      audioContext ||= new AudioContext();
      await audioContext.resume();
    }
    audioEnabled = Boolean(enabled);
    localStorage.setItem("charadock.remote.audio", audioEnabled ? "1" : "0");
    if (!audioEnabled && activeAudioSource) activeAudioSource.stop();
    syncAudioButton();
    syncRemoteSettings();
  }

  function syncAudioButton() {
    const allowed = Boolean(appState?.mobileTtsAllowed);
    const button = $("#audioButton");
    button.disabled = !allowed;
    button.classList.toggle("is-active", allowed && audioEnabled);
    button.title = allowed ? text("スマートフォン音声", "Phone audio") : text("設定でスマートフォン音声が無効です", "Phone audio is disabled in Settings");
    $("#phoneAudioToggle").checked = allowed && audioEnabled;
    $("#phoneAudioToggle").disabled = !allowed;
  }

  async function decodeDataUrl(dataUrl) {
    const comma = String(dataUrl || "").indexOf(",");
    const bytes = Uint8Array.from(atob(String(dataUrl).slice(comma + 1)), (value) => value.charCodeAt(0));
    return audioContext.decodeAudioData(bytes.buffer);
  }

  async function playAudioUrl(dataUrl, playbackRate = 1) {
    const buffer = await decodeDataUrl(dataUrl);
    return new Promise((resolve) => {
      const source = audioContext.createBufferSource();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.buffer = buffer;
      source.playbackRate.value = Number(playbackRate) || 1;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      activeAudioSource = source;
      $("#avatarMotion").classList.add("is-speaking");
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const animate = () => {
        analyser.getByteFrequencyData(samples);
        const level = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length) / 255;
        currentMouth = level > .18 ? "open" : level > .07 ? "half" : "closed";
        showFace(faceKey(true));
        mouthTimer = requestAnimationFrame(animate);
      };
      animate();
      source.onended = () => {
        cancelAnimationFrame(mouthTimer);
        currentMouth = "closed";
        showFace(faceKey(true));
        if (activeAudioSource === source) activeAudioSource = null;
        $("#avatarMotion").classList.remove("is-speaking");
        resolve();
      };
      source.start();
    });
  }

  async function speak(value) {
    if (!audioEnabled || !appState?.mobileTtsAllowed || !String(value || "").trim()) return;
    try {
      audioContext ||= new AudioContext();
      await audioContext.resume();
      const result = await request("/api/tts", { method: "POST", body: JSON.stringify({ text: String(value).slice(0, 4000) }) });
      for (const audioUrl of result?.audioDataUrls || []) await playAudioUrl(audioUrl, result.playbackRate);
      let streamId = result?.streamId;
      while (streamId) {
        const next = await request("/api/tts/next", { method: "POST", body: JSON.stringify({ streamId }) });
        for (const audioUrl of next?.audioDataUrls || []) await playAudioUrl(audioUrl, next.playbackRate || result.playbackRate);
        if (next?.done) streamId = "";
      }
    } catch {
      currentMouth = "closed";
      showFace(faceKey(true));
      $("#avatarMotion").classList.remove("is-speaking");
    }
  }

  async function openArtifact(runId, artifact) {
    const dialog = $("#previewDialog");
    const body = $("#previewBody");
    body.replaceChildren();
    $("#previewTitle").textContent = artifact.name || artifact.path;
    const url = artifactUrl(runId, artifact.path);
    const extension = String(artifact.path || "").split(".").pop().toLowerCase();
    if (["md", "markdown", "txt", "json", "jsonc", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "yaml", "yml", "toml", "ini", "csv", "py", "rb", "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "sh", "ps1", "bat"].includes(extension)) {
      const pre = document.createElement("pre");
      pre.textContent = await fetch(url, { cache: "no-store" }).then((response) => response.ok ? response.text() : Promise.reject(new Error("Preview unavailable"))).catch((error) => error.message);
      body.appendChild(pre);
    } else if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"].includes(extension)) {
      const image = document.createElement("img"); image.src = url; image.alt = artifact.name || ""; body.appendChild(image);
    } else if (["mp4", "webm", "mov", "m4v", "mp3", "wav", "ogg", "m4a"].includes(extension)) {
      const media = document.createElement(["mp4", "webm", "mov", "m4v"].includes(extension) ? "video" : "audio"); media.src = url; media.controls = true; body.appendChild(media);
    } else {
      const frame = document.createElement("iframe"); frame.src = url; frame.title = artifact.name || "成果物"; frame.setAttribute("sandbox", "allow-scripts"); body.appendChild(frame);
    }
    dialog.showModal();
  }

  $("#messageForm").addEventListener("submit", sendMessage);
  $("#interruptButton").addEventListener("click", interrupt);
  $("#chatModeButton").addEventListener("click", () => setMode("chat"));
  $("#workModeButton").addEventListener("click", () => setMode("work"));
  $("#audioButton").addEventListener("click", unlockAudio);
  $("#historyButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#settingsButton").addEventListener("click", () => { syncRemoteSettings(); $("#settingsSheet").showModal(); });
  $("#bubbleExpandButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#closeHistoryButton").addEventListener("click", () => $("#historySheet").close());
  $("#closeSettingsButton").addEventListener("click", () => $("#settingsSheet").close());
  $("#closePreviewButton").addEventListener("click", () => $("#previewDialog").close());
  $("#retryPairButton").addEventListener("click", () => location.reload());
  $("#disconnectButton").addEventListener("click", async () => {
    await request("/api/disconnect", { method: "POST", body: "{}" }).catch(() => {});
    csrfToken = "";
    $("#historySheet").close();
    showPairing();
  });
  $("#messageInput").addEventListener("input", (event) => {
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(112, event.target.scrollHeight)}px`;
  });
  $("#characterSelect").addEventListener("change", (event) => saveRemoteClientSettings({ characterId: event.target.value }));
  $("#responseModeSelect").addEventListener("change", (event) => saveRemoteClientSettings({ responseMode: event.target.value }));
  $("#ttsProviderSelect").addEventListener("change", (event) => saveRemoteClientSettings({ ttsProvider: event.target.value }));
  $("#realtimeVoiceSelect").addEventListener("change", (event) => saveRemoteClientSettings({ realtimeVoice: event.target.value }));
  $("#pcAudioToggle").addEventListener("change", (event) => saveRemoteClientSettings({ pcAudioEnabled: event.target.checked }));
  $("#phoneAudioToggle").addEventListener("change", (event) => setPhoneAudio(event.target.checked).catch(() => { event.target.checked = false; }));
  pairFromFragment();
})();
