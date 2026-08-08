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
  let reactionTimer = 0;
  let currentMouth = "closed";
  let currentEmotion = "";
  let currentFaceKey = "eyesOpenMouthClosed";
  let avatarAssets = new Map();
  let petRequestInFlight = false;
  let mobileSpeechToken = 0;
  let mobileSpeechPending = false;
  let activeMobileTtsStreamId = "";
  let settingsSaving = false;
  let livePeer = null;
  let liveInputStream = null;
  let liveStarting = false;
  let liveAudioContext = null;
  let liveAudioFrame = 0;
  let liveAudioSource = null;
  let speechRecognition = null;

  const text = (ja, en) => appState?.language === "en" ? en : ja;
  const artifactUrl = (runId, artifactPath) => `/api/artifact?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(artifactPath)}`;
  const microphoneAvailable = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

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
    const emotionPrefix = { happy: "emotionHappyMouth", surprised: "emotionSurprisedMouth", soft: "emotionSoftMouth" }[currentEmotion];
    const emotionKey = emotionPrefix ? `${emotionPrefix}${suffix}` : "";
    if (openEyes && emotionKey && appState?.character?.assetKeys?.includes(emotionKey)) return emotionKey;
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

  function showTouchSpark(event) {
    const stage = $(".avatar-stage");
    const bounds = stage.getBoundingClientRect();
    const spark = document.createElement("span");
    spark.className = `remote-touch-spark spark-${Math.floor(Math.random() * 3)}`;
    spark.textContent = ["✦", "♡", "·"][Math.floor(Math.random() * 3)];
    spark.style.left = `${event.clientX - bounds.left}px`;
    spark.style.top = `${event.clientY - bounds.top}px`;
    stage.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove(), { once: true });
  }

  function applyPetReaction(payload = {}) {
    clearTimeout(reactionTimer);
    const emotion = ["happy", "soft", "surprised"].includes(payload.emotion) ? payload.emotion : "happy";
    const shell = $("#avatarReactionShell");
    for (const name of ["happy", "soft", "surprised"]) shell.classList.remove(`is-reacting-${name}`);
    void shell.offsetWidth;
    shell.classList.add(`is-reacting-${emotion}`);
    currentEmotion = emotion;
    showFace(faceKey(true));
    reactionTimer = setTimeout(() => {
      shell.classList.remove(`is-reacting-${emotion}`);
      currentEmotion = "";
      showFace(faceKey(true));
    }, Math.max(700, Math.min(2600, Number(payload.durationMs) || 1500)));
  }

  async function syncAvatar() {
    const character = appState?.character;
    if (!character) return;
    clearTimeout(reactionTimer);
    currentEmotion = "";
    for (const name of ["happy", "soft", "surprised"]) $("#avatarReactionShell").classList.remove(`is-reacting-${name}`);
    for (const value of avatarAssets.values()) URL.revokeObjectURL(value);
    avatarAssets = new Map();
    await Promise.all(character.assetKeys.map(async (key) => {
      const response = await fetch(`/api/avatar/${encodeURIComponent(key)}?v=${encodeURIComponent(character.assetVersion || "1")}`, { cache: "force-cache" });
      if (response.ok) avatarAssets.set(key, URL.createObjectURL(await response.blob()));
    }));
    $("#responseSpeaker").textContent = character.name;
    $("#avatarFace").alt = character.name;
    $("#avatarTapTarget").setAttribute("aria-label", text(`${character.name}に触れる`, `Tap ${character.name}`));
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
      : microphoneAvailable()
        ? text("マイク利用可 · 安全なHTTPS接続", "Microphone ready · Secure HTTPS connection")
        : text("文字入力 · マイクにはHTTPS接続が必要", "Text input · Microphone requires HTTPS");
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

  function closeRemoteLivePeer() {
    try { livePeer?.close(); } catch {}
    for (const track of liveInputStream?.getTracks?.() || []) track.stop();
    const audio = $("#remoteLiveAudio");
    audio.pause();
    audio.srcObject = null;
    cancelAnimationFrame(liveAudioFrame);
    liveAudioFrame = 0;
    try { liveAudioSource?.disconnect(); } catch {}
    liveAudioSource = null;
    liveAudioContext?.close().catch(() => {});
    liveAudioContext = null;
    currentMouth = "closed";
    showFace(faceKey(true));
    $("#avatarMotion").classList.remove("is-speaking");
    livePeer = null;
    liveInputStream = null;
    liveStarting = false;
    $("#microphoneButton").classList.remove("is-live");
    syncMicrophoneButton();
  }

  async function followLiveAudio(stream) {
    cancelAnimationFrame(liveAudioFrame);
    liveAudioContext?.close().catch(() => {});
    const context = new AudioContext({ latencyHint: "interactive" });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    liveAudioContext = context;
    liveAudioSource = source;
    await context.resume();
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const animate = () => {
      if (liveAudioContext !== context) return;
      analyser.getByteFrequencyData(samples);
      const level = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length) / 255;
      currentMouth = level > .16 ? "open" : level > .055 ? "half" : "closed";
      showFace(faceKey(true));
      $("#avatarMotion").classList.toggle("is-speaking", level > .025);
      liveAudioFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  function syncMicrophoneButton() {
    if (!appState) return;
    const voice = appState.voice || {};
    const liveMode = voice.responseMode === "live";
    const remoteOwnsLive = voice.liveConnected && voice.liveOwner === "remote";
    const pcOwnsLive = voice.liveConnected && voice.liveOwner !== "remote";
    const button = $("#microphoneButton");
    button.disabled = busy || liveStarting || pcOwnsLive || (!liveMode && !microphoneAvailable());
    button.classList.toggle("is-live", Boolean(livePeer && remoteOwnsLive));
    button.classList.toggle("is-listening", Boolean(speechRecognition));
    button.title = liveMode
      ? remoteOwnsLive ? text("Liveを停止", "Stop Live") : pcOwnsLive ? text("PC側のLiveが使用中", "Live is active on the PC") : text("この端末でLiveを開始", "Start Live on this phone")
      : microphoneAvailable() ? text("音声で入力", "Dictate") : text("音声入力にはHTTPS接続が必要", "Voice input requires HTTPS");
    button.setAttribute("aria-label", button.title);
  }

  async function startRemoteLive({ microphone = true } = {}) {
    if (livePeer || liveStarting) return true;
    liveStarting = true;
    syncMicrophoneButton();
    setResponseText(text("Liveへ接続中…", "Connecting to Live…"));
    const peer = new RTCPeerConnection();
    livePeer = peer;
    try {
      if (microphone) {
        if (!microphoneAvailable()) throw new Error(text("マイクにはHTTPS接続が必要です。Tailscale Serveなどの安全なURLから開いてください。", "The microphone requires HTTPS. Open CharaDock through a secure URL such as Tailscale Serve."));
        liveInputStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        for (const track of liveInputStream.getAudioTracks()) peer.addTrack(track, liveInputStream);
      } else {
        peer.addTransceiver("audio", { direction: "recvonly" });
      }
      peer.createDataChannel("oai-events");
      peer.addEventListener("track", (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        const audio = $("#remoteLiveAudio");
        audio.srcObject = stream;
        audio.play().catch(() => setResponseText(text("音声を再生するには画面を一度タップしてください。", "Tap the screen once to enable audio.")));
        followLiveAudio(stream).catch(() => {});
        event.track.addEventListener("ended", () => {
          $("#avatarMotion").classList.remove("is-speaking");
          currentMouth = "closed";
          showFace(faceKey(true));
        });
      });
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState) && livePeer === peer) {
          closeRemoteLivePeer();
          setConnection(false, text("Live再接続待ち", "Live disconnected"));
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await request("/api/live/start", { method: "POST", body: JSON.stringify({ sdp: peer.localDescription?.sdp || offer.sdp, mode: currentMode }) });
      return true;
    } catch (error) {
      if (livePeer === peer) closeRemoteLivePeer();
      throw error;
    } finally {
      liveStarting = false;
      syncMicrophoneButton();
    }
  }

  async function stopRemoteLive() {
    try { await request("/api/live/stop", { method: "POST", body: "{}" }); }
    finally { closeRemoteLivePeer(); }
  }

  async function handleLiveEvent(message = {}) {
    const method = String(message.method || "");
    const params = message.params || {};
    if (method === "thread/realtime/sdp" && livePeer && params.sdp) {
      await livePeer.setRemoteDescription({ type: "answer", sdp: String(params.sdp) });
      return;
    }
    if (method === "thread/realtime/started") {
      setConnection(true, "Live");
      $("#microphoneButton").classList.add("is-live");
      setResponseText(text("つながったよ。そのまま話してね。", "Connected. Go ahead and speak."));
      return;
    }
    if (method === "thread/realtime/error") {
      setResponseText(params.message || text("Liveへ接続できませんでした。", "Could not connect to Live."));
      closeRemoteLivePeer();
      return;
    }
    if (method === "thread/realtime/closed") closeRemoteLivePeer();
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

  function syncTtsModelSettings(responseMode) {
    const container = $("#ttsModelSettings");
    const fieldsContainer = $("#ttsModelFields");
    const modelSettings = appState?.voice?.ttsModelSettings || {};
    const fields = Array.isArray(modelSettings.fields) ? modelSettings.fields : [];
    const visible = responseMode !== "live" && fields.length > 0;
    container.hidden = !visible;
    fieldsContainer.replaceChildren();
    $("#ttsProviderLabel").textContent = text("TTS方式", "TTS method");
    $("#ttsModelSettingsTitle").textContent = text("音声モデル", "Voice model");
    $("#ttsModelSettingsTitle").nextElementSibling.textContent = text("選択中のキャラクターに保存", "Saved for this character");
    $("#ttsModelHint").textContent = modelSettings.hint || "";
    if (!visible) return;
    for (const field of fields) {
      const label = document.createElement("label");
      label.className = "settings-field";
      const caption = document.createElement("span");
      caption.textContent = field.label || text("モデル", "Model");
      label.appendChild(caption);
      if (field.type === "display") {
        const display = document.createElement("div");
        display.className = "remote-model-display";
        display.textContent = String(field.value || text("未選択", "Not selected"));
        label.appendChild(display);
      } else if (field.type === "number") {
        const input = document.createElement("input");
        input.type = "number";
        input.inputMode = "numeric";
        input.min = String(field.min ?? 0);
        input.max = String(field.max ?? 9999);
        input.step = String(field.step ?? 1);
        input.value = String(field.value ?? 0);
        input.disabled = busy || settingsSaving;
        input.addEventListener("change", () => saveRemoteClientSettings({ ttsModel: { key: field.key, value: input.value } }));
        label.appendChild(input);
      } else {
        const select = document.createElement("select");
        for (const item of Array.isArray(field.options) ? field.options : []) {
          const itemOption = new Option(item.label || item.value, String(item.value ?? ""));
          itemOption.disabled = item.available === false;
          select.appendChild(itemOption);
        }
        const selected = String(field.value ?? "");
        if (selected && ![...select.options].some((item) => item.value === selected)) select.appendChild(new Option(`${selected} · ${text("保存済み", "Saved")}`, selected));
        select.value = selected;
        select.disabled = busy || settingsSaving || !select.options.length;
        select.addEventListener("change", () => saveRemoteClientSettings({ ttsModel: { key: field.key, value: select.value } }));
        label.appendChild(select);
      }
      fieldsContainer.appendChild(label);
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
    syncTtsModelSettings(responseMode);

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
        ? voice.liveOwner === "remote"
          ? text(`この端末でGPT-Liveへ接続中。音声と字幕をここで受け取ります。${voice.realtimeConversion === "beatrice-v2" ? "スマートフォン直結中はBeatrice 2を通さず、選択したGPT-Live音声を再生します。" : ""}`, `GPT-Live is connected on this phone, with audio and captions here.${voice.realtimeConversion === "beatrice-v2" ? " Direct phone sessions use the selected GPT-Live voice without Beatrice 2." : ""}`)
          : text("PC側のGPT-Liveが使用中です。スマートフォンへ切り替えるにはPCで一度停止してください。", "GPT-Live is active on the PC. Stop it there before switching to this phone.")
        : text("マイクボタンでこの端末からGPT-Liveを開始できます。未接続時のキャラタップは、設定済みの通常TTSで反応します。", "Use the microphone button to start GPT-Live on this phone. Character taps fall back to the configured standard TTS while disconnected.")
      : appState.mobileTtsAllowed
        ? text("通常TTSはPCとこの端末を個別にON / OFFできます。", "Standard TTS can be enabled independently on the PC and this device.")
        : text("選択中の通常TTSはこの端末へ転送できません。PC側の音声モデルを変更してください。", "The selected standard TTS cannot be sent to this device. Choose another voice model on the PC.");
    $("#microphoneSecurityHint").textContent = microphoneAvailable()
      ? text("安全なHTTPS接続です。音声入力を利用できます。", "This is a secure HTTPS connection. Voice input is available.")
      : text("音声入力だけはHTTPSが必要です。通常のLAN接続は文字操作用としてそのまま使えます。Tailscale Serveは任意のHTTPS経路として利用できます。", "Voice input requires HTTPS. The regular LAN connection remains available for text control; Tailscale Serve is an optional secure route.");
    syncMicrophoneButton();
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
    eventSource.addEventListener("live", (event) => handleLiveEvent(JSON.parse(event.data)).catch((error) => {
      setResponseText(error.message);
      closeRemoteLivePeer();
    }));
    eventSource.onerror = () => {
      setConnection(false, text("再接続中", "Reconnecting"));
      refreshState().catch(() => showPairing(text("接続の有効期限が切れました。もう一度QRコードを読み取ってください。", "The connection expired. Scan the QR code again.")));
    };
  }

  async function pairWithToken(token) {
    try {
      const payload = await request("/api/pair", { method: "POST", body: JSON.stringify({ token, deviceName: deviceName() }) });
      csrfToken = payload.csrfToken;
      history.replaceState(null, "", "/");
      applyState(payload.state);
      connectEvents();
    } catch (error) {
      history.replaceState(null, "", "/");
      showPairing(error.message);
      throw error;
    }
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
    await pairWithToken(token).catch(() => {});
  }

  function showPairing(message = "") {
    eventSource?.close();
    closeRemoteLivePeer();
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
      if (appState?.voice?.responseMode === "live" && !appState.voice.liveConnected) {
        await startRemoteLive({ microphone: false });
      }
      await request("/api/message", { method: "POST", body: JSON.stringify({ message, mode: currentMode }) });
    } catch (error) {
      setBusy(false);
      setResponseText(error.message);
    }
  }

  function stopDictation() {
    const recognition = speechRecognition;
    speechRecognition = null;
    try { recognition?.stop(); } catch {}
    syncMicrophoneButton();
  }

  function startDictation() {
    if (!microphoneAvailable()) throw new Error(text("音声入力にはHTTPS接続が必要です。Tailscale Serveなどの安全なURLを利用してください。", "Voice input requires HTTPS. Use a secure URL such as Tailscale Serve."));
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) throw new Error(text("このブラウザは音声文字起こしに対応していません。GPT-Liveを選ぶとマイク音声を直接送れます。", "This browser does not support speech dictation. Choose GPT-Live to send microphone audio directly."));
    if (speechRecognition) {
      stopDictation();
      return;
    }
    const recognition = new Recognition();
    speechRecognition = recognition;
    recognition.lang = appState?.language === "en" ? "en-US" : "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = String(event.results[index][0]?.transcript || "");
        if (event.results[index].isFinal) finalText += transcript;
        else interim += transcript;
      }
      $("#messageInput").value = `${finalText}${interim}`.trim();
      $("#composerHint").textContent = text("聞き取っています…", "Listening…");
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech") setResponseText(text(`音声入力を開始できませんでした: ${event.error}`, `Could not start dictation: ${event.error}`));
    };
    recognition.onend = () => {
      if (speechRecognition === recognition) speechRecognition = null;
      syncMicrophoneButton();
      setMode(currentMode);
      if (finalText.trim() && !busy) $("#messageForm").requestSubmit();
    };
    recognition.start();
    syncMicrophoneButton();
  }

  async function toggleMicrophone() {
    const voice = appState?.voice || {};
    try {
      if (voice.responseMode === "live") {
        if (voice.liveConnected || livePeer) await stopRemoteLive();
        else await startRemoteLive({ microphone: true });
      } else {
        startDictation();
      }
    } catch (error) {
      setResponseText(error.message);
      $("#settingsSheet").showModal();
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

  function stopMobileSpeech() {
    mobileSpeechToken += 1;
    mobileSpeechPending = false;
    if (activeMobileTtsStreamId) {
      request("/api/tts/cancel", { method: "POST", body: JSON.stringify({ streamId: activeMobileTtsStreamId }) }).catch(() => {});
      activeMobileTtsStreamId = "";
    }
    try { activeAudioSource?.stop(); } catch {}
    activeAudioSource = null;
    cancelAnimationFrame(mouthTimer);
    currentMouth = "closed";
    showFace(faceKey(true));
    $("#avatarMotion").classList.remove("is-speaking");
  }

  async function speak(value) {
    if (!audioEnabled || !appState?.mobileTtsAllowed || !String(value || "").trim()) return;
    const token = ++mobileSpeechToken;
    mobileSpeechPending = true;
    try {
      audioContext ||= new AudioContext();
      await audioContext.resume();
      const result = await request("/api/tts", { method: "POST", body: JSON.stringify({ text: String(value).slice(0, 4000) }) });
      if (token !== mobileSpeechToken) return;
      activeMobileTtsStreamId = result?.streamId || "";
      for (const audioUrl of result?.audioDataUrls || []) {
        if (token !== mobileSpeechToken) return;
        await playAudioUrl(audioUrl, result.playbackRate);
      }
      let streamId = result?.streamId;
      while (streamId && token === mobileSpeechToken) {
        const next = await request("/api/tts/next", { method: "POST", body: JSON.stringify({ streamId }) });
        if (token !== mobileSpeechToken) return;
        for (const audioUrl of next?.audioDataUrls || []) {
          if (token !== mobileSpeechToken) return;
          await playAudioUrl(audioUrl, next.playbackRate || result.playbackRate);
        }
        if (next?.done) streamId = "";
        activeMobileTtsStreamId = streamId;
      }
    } catch {
      currentMouth = "closed";
      showFace(faceKey(true));
      $("#avatarMotion").classList.remove("is-speaking");
    } finally {
      if (token === mobileSpeechToken) {
        mobileSpeechPending = false;
        activeMobileTtsStreamId = "";
      }
    }
  }

  async function tapCharacter(event) {
    if (petRequestInFlight) return;
    const speaking = Boolean(mobileSpeechPending || activeAudioSource || $("#avatarMotion").classList.contains("is-speaking"));
    if (speaking) {
      if (appState?.voice?.responseMode === "live" && appState.voice.liveConnected) await interrupt().catch(() => {});
      else stopMobileSpeech();
      $("#composerHint").textContent = text("読み上げを停止しました", "Stopped speaking");
      setTimeout(() => setMode(currentMode), 1800);
      return;
    }
    if (busy) {
      navigator.vibrate?.(6);
      return;
    }
    const bounds = $("#avatarTapTarget").getBoundingClientRect();
    const zone = event.clientY < bounds.top + bounds.height * .52 ? "head" : "body";
    petRequestInFlight = true;
    $("#avatarTapTarget").setAttribute("aria-busy", "true");
    try {
      const result = await request("/api/pet", { method: "POST", body: JSON.stringify({ zone }) });
      if (result?.busy) return;
      applyPetReaction(result);
      setResponseText(result?.text);
      if (result?.realtimeSpeechError) {
        $("#composerHint").textContent = text(`Live音声: ${result.realtimeSpeechError}`, `Live voice: ${result.realtimeSpeechError}`);
      } else if (result?.realtimeSpeechBusy) {
        $("#composerHint").textContent = text("回答中はクリック発話を重ねません", "Tap speech waits until the response finishes");
      } else if (result?.ttsEnabled && !result?.realtimeSpeech) {
        speak(result.spokenText || result.text).catch(() => {});
      }
    } catch (error) {
      $("#composerHint").textContent = error.message;
      setTimeout(() => setMode(currentMode), 2400);
    } finally {
      petRequestInFlight = false;
      $("#avatarTapTarget").removeAttribute("aria-busy");
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
  $("#avatarTapTarget").addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    $("#avatarTapTarget").classList.add("is-pressed");
    showTouchSpark(event);
    navigator.vibrate?.(8);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    $("#avatarTapTarget").addEventListener(type, () => $("#avatarTapTarget").classList.remove("is-pressed"));
  }
  $("#avatarTapTarget").addEventListener("click", tapCharacter);
  $("#pairingCodeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#pairingCodeInput");
    const token = input.value.trim();
    if (!token) return;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try { await pairWithToken(token); }
    catch { input.select(); }
    finally { button.disabled = false; }
  });
  $("#interruptButton").addEventListener("click", interrupt);
  $("#chatModeButton").addEventListener("click", () => setMode("chat"));
  $("#workModeButton").addEventListener("click", () => setMode("work"));
  $("#microphoneButton").addEventListener("click", toggleMicrophone);
  $("#audioButton").addEventListener("click", unlockAudio);
  $("#historyButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#settingsButton").addEventListener("click", () => { syncRemoteSettings(); $("#settingsSheet").showModal(); });
  $("#bubbleExpandButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#closeHistoryButton").addEventListener("click", () => $("#historySheet").close());
  $("#closeSettingsButton").addEventListener("click", () => $("#settingsSheet").close());
  $("#closePreviewButton").addEventListener("click", () => $("#previewDialog").close());
  $("#retryPairButton").addEventListener("click", () => location.reload());
  $("#disconnectButton").addEventListener("click", async () => {
    if (appState?.voice?.liveOwner === "remote") await stopRemoteLive().catch(() => {});
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
  window.addEventListener("pagehide", () => {
    if (appState?.voice?.liveOwner !== "remote" || !csrfToken) return;
    fetch("/api/live/stop", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-CharaDock-CSRF": csrfToken },
      body: "{}",
    }).catch(() => {});
  });
  pairFromFragment();
})();
