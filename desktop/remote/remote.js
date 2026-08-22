// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  let appState = null;
  let csrfToken = "";
  let eventSource = null;
  let currentMode = "chat";
  let modeInitialized = false;
  let busy = false;
  let audioEnabled = localStorage.getItem("charadock.remote.audio") !== "0";
  let audioContext = null;
  let activeAudioSource = null;
  let mouthTimer = 0;
  let blinkTimer = 0;
  let reactionTimer = 0;
  let currentMouth = "closed";
  let currentEmotion = "";
  let currentFaceKey = "eyesOpenMouthClosed";
  let avatarSpeakingReleaseTimer = 0;
  const remoteMouthTracker = window.CharaDockAudioEnvelope.createThreeStageMouthTracker({ minimumHoldMs: 64 });
  let avatarAssets = new Map();
  let petRequestInFlight = false;
  let mobileSpeechToken = 0;
  let mobileSpeechPending = false;
  let activeMobileTtsStreamId = "";
  let mobileStreamSpeechQueue = [];
  let mobileStreamSpeechTurnId = "";
  let mobileStreamSpeechFinished = false;
  let mobileStreamSpeechFullText = "";
  let mobileStreamSpeechDraining = false;
  let mobileStreamSpeechSignal = null;
  let settingsSaving = false;
  let settingsStatusTimer = 0;
  let composerHintErrorTimer = 0;
  let pendingRemoteFollowUp = "";
  let approvalCountdownTimer = 0;
  let workElapsedTimer = 0;
  let selectedWorkRunId = "";
  let stateTransitionsInitialized = false;
  let observedApprovalId = "";
  const observedWorkStatuses = new Map();
  let deferredInstallPrompt = null;
  let serviceWorkerRegistration = null;
  let notificationEnabled = localStorage.getItem("charadock.remote.notifications") === "1";
  let wakeLockEnabled = localStorage.getItem("charadock.remote.wake-lock") !== "0";
  let wakeLockSentinel = null;
  let livePeer = null;
  let liveInputStream = null;
  let liveSyntheticInputContext = null;
  let liveSyntheticInputOscillator = null;
  let liveStarting = false;
  let liveSessionId = "";
  let liveAudioContext = null;
  let liveAudioFrame = 0;
  let liveAudioSource = null;
  let liveAudioGain = null;
  let liveOutputSuppressed = false;
  let liveBeatriceActive = false;
  let liveBeatriceSessionId = "";
  let liveBeatriceGeneration = 0;
  let liveBeatriceProcessor = null;
  let liveBeatriceSilence = null;
  let liveBeatricePlaybackGain = null;
  let liveBeatriceCaptureFrames = [];
  let liveBeatriceCaptureSamples = 0;
  let liveBeatriceCaptureOffset = 0;
  let liveBeatriceUploadQueue = [];
  let liveBeatriceUploading = false;
  let liveBeatriceNextPlaybackTime = 0;
  let liveBeatriceCaptionReady = false;
  let pendingLiveBeatriceCaption = "";
  const liveBeatricePlaybackSources = new Set();
  const liveBeatriceLevelTimers = new Set();
  let liveBeatriceMouthCloseTimer = 0;
  let speechRecognition = null;
  const cancelledRecognitions = new WeakSet();
  let dictationArmed = false;
  let dictationRestartTimer = 0;
  let seenStartupGreetingId = "";
  let pendingStartupGreeting = null;
  let seenMcpAppId = "";
  let seenMcpAppUpdatedAt = 0;
  let dismissedMcpAppId = "";
  let mcpAppHost = null;

  const text = (ja, en) => appState?.language === "en" ? en : ja;
  const artifactUrl = (runId, artifactPath) => `/api/artifact?runId=${encodeURIComponent(runId)}&path=${encodeURIComponent(artifactPath)}`;
  const microphoneAvailable = () => Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  const microphoneHandoffAvailable = () => Boolean(!microphoneAvailable() && appState?.secureMicrophoneHandoff);
  const secureApprovalAvailable = () => Boolean(window.isSecureContext && /(?:^|\.)ts\.net$/i.test(location.hostname));
  const standaloneMode = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  function phoneAudioAvailable() {
    const voice = appState?.voice || {};
    return voice.responseMode === "live" ? Boolean(voice.liveSupported) : Boolean(appState?.mobileTtsAllowed);
  }

  async function primeAudioOutput() {
    if (!audioEnabled) return;
    audioContext ||= new AudioContext({ latencyHint: "interactive" });
    await audioContext.resume();
  }

  function waitForIceGatheringComplete(peer, timeoutMs = 5000) {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      peer.addEventListener("icegatheringstatechange", onStateChange);
      timer = setTimeout(finish, timeoutMs);
    });
  }

  async function request(path, options = {}) {
    const { timeoutMs = 0, ...fetchOptions } = options;
    const headers = { "Content-Type": "application/json", ...(fetchOptions.headers || {}) };
    if (csrfToken && fetchOptions.method === "POST") headers["X-CharaDock-CSRF"] = csrfToken;
    const controller = timeoutMs > 0 ? new AbortController() : null;
    let timeout = 0;
    if (controller) timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...fetchOptions,
        headers,
        signal: controller?.signal || fetchOptions.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error(text("接続がタイムアウトしました。もう一度試してください。", "The connection timed out. Please try again."));
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function registerPwa() {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
      serviceWorkerRegistration.update().catch(() => {});
    } catch {
      serviceWorkerRegistration = null;
    }
  }

  function syncPwaSettings() {
    const installButton = $("#installAppButton");
    const hint = $("#installAppHint");
    const secure = window.isSecureContext;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    installButton.hidden = standaloneMode() || !secure;
    installButton.textContent = deferredInstallPrompt
      ? text("ホーム画面に追加", "Install CharaDock Link")
      : ios ? text("追加方法を表示", "Show install steps") : text("ホーム画面に追加", "Install CharaDock Link");
    hint.textContent = standaloneMode()
      ? text("ホーム画面アプリとして起動しています。", "Running as a Home Screen app.")
      : !secure
        ? text("ホーム画面への追加と通知にはTailscale HTTPS接続が必要です。", "Installing and notifications require Tailscale HTTPS.")
        : ios
          ? text("共有メニューから「ホーム画面に追加」を選ぶと、CharaDock専用アプリのように開けます。", "Choose Add to Home Screen from the Share menu to open CharaDock like a dedicated app.")
          : text("対応ブラウザではホーム画面へ追加できます。", "Supported browsers can install CharaDock to the Home Screen.");
    const notificationToggle = $("#notificationToggle");
    const notificationSupported = secure && "Notification" in window && "serviceWorker" in navigator;
    notificationToggle.checked = notificationSupported && notificationEnabled && Notification.permission === "granted";
    notificationToggle.disabled = !notificationSupported || Notification.permission === "denied";
    $("#wakeLockToggle").checked = wakeLockEnabled;
    $("#wakeLockToggle").disabled = !secure || !("wakeLock" in navigator);
  }

  async function installRemoteApp() {
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      syncPwaSettings();
      return;
    }
    $("#installAppHint").textContent = /iPhone|iPad|iPod/i.test(navigator.userAgent || "")
      ? text("Safariの共有ボタンを開き、「ホーム画面に追加」を選んでください。", "Open Safari's Share menu and choose Add to Home Screen.")
      : text("ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。", "Choose Install app or Add to Home Screen from the browser menu.");
  }

  async function setNotificationSetting(enabled) {
    if (!enabled) {
      notificationEnabled = false;
      localStorage.setItem("charadock.remote.notifications", "0");
      syncPwaSettings();
      return;
    }
    if (!window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
      throw new Error(text("通知にはTailscale HTTPS接続が必要です。", "Notifications require Tailscale HTTPS."));
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error(text("通知が許可されませんでした。ブラウザの設定を確認してください。", "Notifications were not allowed. Check the browser settings."));
    notificationEnabled = true;
    localStorage.setItem("charadock.remote.notifications", "1");
    serviceWorkerRegistration ||= await navigator.serviceWorker.ready;
    syncPwaSettings();
  }

  async function showRemoteNotification(title, body, tag) {
    if (!notificationEnabled || !("Notification" in window) || document.visibilityState === "visible" || Notification.permission !== "granted") return;
    try {
      serviceWorkerRegistration ||= await navigator.serviceWorker.ready;
      await serviceWorkerRegistration.showNotification(title, {
        body: String(body || "").slice(0, 240),
        tag,
        renotify: true,
        icon: "/app-icon.png",
        badge: "/app-icon.png",
        data: { path: "/" },
      });
    } catch {}
  }

  async function syncWakeLock() {
    const shouldHold = wakeLockEnabled && window.isSecureContext && document.visibilityState === "visible"
      && Boolean(busy || appState?.voice?.liveConnected);
    if (!shouldHold) {
      const current = wakeLockSentinel;
      wakeLockSentinel = null;
      await current?.release?.().catch(() => {});
      return;
    }
    if (wakeLockSentinel || !("wakeLock" in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
      wakeLockSentinel.addEventListener("release", () => { wakeLockSentinel = null; }, { once: true });
    } catch {
      wakeLockSentinel = null;
    }
  }

  function observeStateTransitions(nextState) {
    const approval = nextState?.approval || null;
    if (stateTransitionsInitialized && approval?.id && approval.id !== observedApprovalId) {
      navigator.vibrate?.([18, 45, 18]);
      showRemoteNotification(
        text("CharaDockが確認を待っています", "CharaDock needs your approval"),
        approval.title || approval.question,
        `approval-${approval.id}`,
      );
    }
    observedApprovalId = approval?.id || "";
    const runs = Array.isArray(nextState?.workHistory?.runs) ? nextState.workHistory.runs : [];
    for (const run of runs) {
      const previous = observedWorkStatuses.get(run.id);
      if (stateTransitionsInitialized && ["running", "stopping"].includes(previous) && !["running", "stopping"].includes(run.status)) {
        const failed = ["failed", "interrupted"].includes(run.status);
        showRemoteNotification(
          failed ? text("Workを確認してください", "Work needs attention") : text("Workが完了しました", "Work complete"),
          failed ? run.result || run.activities?.at(-1) : run.result || run.request,
          `work-${run.id}`,
        );
      }
      observedWorkStatuses.set(run.id, run.status);
    }
    const visibleRunIds = new Set(runs.map((run) => run.id));
    for (const runId of observedWorkStatuses.keys()) if (!visibleRunIds.has(runId)) observedWorkStatuses.delete(runId);
    stateTransitionsInitialized = true;
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

  function cleanRemoteErrorMessage(error) {
    return String(error?.message || error || "")
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
      .replace(/^Error:\s*/i, "")
      .split(/\r?\n/, 1)[0]
      .trim();
  }

  function friendlyRemoteErrorMessage(error) {
    const detail = cleanRemoteErrorMessage(error);
    if (/ENOENT|No such file or directory|chdir|cwd=|作業先.*(?:ありません|見つかりません)|フォルダー.*(?:ありません|見つかりません)/i.test(detail)) {
      return text("作業先フォルダーを開けません。PCで作業先を選び直してください。", "The Work folder is unavailable. Choose it again on the PC.");
    }
    if (/\bMCP\b/i.test(detail)) {
      return text("選択したMCPへ接続できません。PCのMCP設定で接続を確認してください。", "The selected MCP connection is unavailable. Test it in the PC MCP settings.");
    }
    if (/Realtime|\bLive\b/i.test(detail)) {
      return text("Liveの処理を続けられませんでした。接続し直すか、通常のChatを利用してください。", "Live could not continue. Reconnect or use standard Chat.");
    }
    if (/fetch failed|接続できません|connection|ECONN|network|timed?\s*out|timeout|app-server/i.test(detail)) {
      return text("PC側のAIへ接続できません。接続を確認して、もう一度試してください。", "Could not reach the AI on the PC. Check the connection and try again.");
    }
    const technical = /Error invoking|remote method|(?:^|\s)at\s+\S|[A-Z]:\\|\/home\/|AppData|\.cjs:\d|\.js:\d|CreateProcess|stack/i.test(detail);
    if (detail && !technical && detail.length <= 180) return detail;
    return text("処理を完了できませんでした。もう一度試してください。", "The request could not be completed. Please try again.");
  }

  function setComposerHint(message, { error = false } = {}) {
    clearTimeout(composerHintErrorTimer);
    const hint = $("#composerHint");
    hint.textContent = String(message || "");
    hint.classList.toggle("is-error", Boolean(error));
    if (error) {
      composerHintErrorTimer = setTimeout(() => {
        hint.classList.remove("is-error");
        composerHintErrorTimer = 0;
      }, 9000);
    }
  }

  function showRemoteSystemError(error) {
    setComposerHint(friendlyRemoteErrorMessage(error), { error: true });
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
    const source = avatarAssets.get(key);
    const face = $("#avatarFace");
    if (!source || (currentFaceKey === key && face.src === source)) return;
    face.src = source;
    currentFaceKey = key;
  }

  function setAvatarSpeaking(active, releaseMs = 220) {
    if (active) {
      clearTimeout(avatarSpeakingReleaseTimer);
      avatarSpeakingReleaseTimer = 0;
      $("#avatarMotion").classList.add("is-speaking");
      return;
    }
    if (!releaseMs) {
      clearTimeout(avatarSpeakingReleaseTimer);
      avatarSpeakingReleaseTimer = 0;
      $("#avatarMotion").classList.remove("is-speaking");
      return;
    }
    if (avatarSpeakingReleaseTimer || !$("#avatarMotion").classList.contains("is-speaking")) return;
    avatarSpeakingReleaseTimer = setTimeout(() => {
      avatarSpeakingReleaseTimer = 0;
      $("#avatarMotion").classList.remove("is-speaking");
    }, releaseMs);
  }

  function updateRemoteMouth(rawRms, now = performance.now()) {
    const next = remoteMouthTracker.sample(rawRms, now);
    if (next.changed || currentMouth !== next.mouth) {
      currentMouth = next.mouth;
      showFace(faceKey(true));
    }
    setAvatarSpeaking(next.speaking);
    return next;
  }

  function resetRemoteMouth({ keepSpeaking = false } = {}) {
    remoteMouthTracker.reset();
    currentMouth = "closed";
    showFace(faceKey(true));
    if (!keepSpeaking) setAvatarSpeaking(false, 0);
  }

  function analyserRms(analyser, samples) {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / Math.max(1, samples.length));
  }

  async function decodeAvatarAssets() {
    await Promise.all([...avatarAssets.values()].map(async (source) => {
      const image = new Image();
      image.src = source;
      try {
        await image.decode();
      } catch {
        // The visible image remains the fallback if a browser cannot predecode.
      }
    }));
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
    await decodeAvatarAssets();
    $("#responseSpeaker").textContent = character.name;
    $("#avatarFace").alt = character.name;
    $("#avatarTapTarget").setAttribute("aria-label", text(`${character.name}に触れる`, `Tap ${character.name}`));
    for (const [selector, key] of [["#avatarBackHair", "backHair"], ["#avatarFrontHair", "frontHair"]]) {
      const image = $(selector);
      image.hidden = !character.assetKeys.includes(key);
      if (!image.hidden) image.src = avatarAssets.get(key) || "";
    }
    currentFaceKey = "";
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

  function activeWorkRun() {
    const history = appState?.workHistory || {};
    return (history.runs || []).find((run) => run.id === history.activeWorkRunId) || null;
  }

  function formatElapsed(startedAt) {
    const start = new Date(startedAt).getTime();
    const seconds = Math.max(0, Math.floor((Date.now() - (Number.isFinite(start) ? start : Date.now())) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateWorkElapsed() {
    const run = activeWorkRun();
    $("#workProgressElapsed").textContent = run ? formatElapsed(run.startedAt) : "";
  }

  function workStatusLabel(run) {
    if (!run) return text("Work", "Work");
    return {
      running: text("Work実行中", "Work in progress"),
      stopping: text("中断中", "Stopping"),
      completed: text("Work完了", "Work complete"),
      interrupted: text("中断済み", "Interrupted"),
      failed: text("確認が必要", "Needs attention"),
    }[run.status] || text("Work", "Work");
  }

  function renderWorkProgress() {
    clearInterval(workElapsedTimer);
    workElapsedTimer = 0;
    const runs = Array.isArray(appState?.workHistory?.runs) ? appState.workHistory.runs : [];
    const active = activeWorkRun();
    const card = $("#workProgressCard");
    card.hidden = !active;
    if (active) {
      $("#workProgressLabel").textContent = workStatusLabel(active);
      $("#workProgressActivity").textContent = active.activities?.at(-1) || text("依頼を確認しています…", "Reviewing the request…");
      updateWorkElapsed();
      workElapsedTimer = setInterval(updateWorkElapsed, 1000);
    }
    let selected = runs.find((run) => run.id === selectedWorkRunId);
    if (!selected) selected = active || runs[0] || null;
    selectedWorkRunId = selected?.id || "";
    $("#workProgressTitle").textContent = selected ? workStatusLabel(selected) : text("Workの進捗", "Work progress");
    $("#workProgressRequest").textContent = selected?.request || text("まだWorkはありません。", "No Work yet.");
    const timeline = $("#workProgressTimeline");
    timeline.replaceChildren();
    const activities = selected?.activities?.length ? selected.activities : selected ? [text("依頼を受け付けました", "Request received")] : [];
    for (const [index, activity] of activities.entries()) {
      const item = document.createElement("li");
      item.textContent = activity;
      item.classList.toggle("is-current", Boolean(selected && ["running", "stopping"].includes(selected.status) && index === activities.length - 1));
      timeline.appendChild(item);
    }
    const resultCard = $("#workProgressResultCard");
    resultCard.hidden = !selected?.result;
    $("#workProgressResult").textContent = selected?.result || "";
    $("#progressFollowUpForm").hidden = !active;
  }

  function renderApproval() {
    clearInterval(approvalCountdownTimer);
    approvalCountdownTimer = 0;
    const approval = appState?.approval || null;
    const card = $("#approvalCard");
    card.hidden = !approval;
    $("#companionView").classList.toggle("has-approval", Boolean(approval));
    if (!approval) return;
    $("#approvalTitle").textContent = approval.title || text("操作の確認", "Approval required");
    $("#approvalQuestion").textContent = approval.question || "";
    $("#approvalDetail").textContent = approval.detail || "";
    $("#approvalScope").textContent = approval.scope || text("今回だけ", "This request only");
    $("#approvalTypeIcon").textContent = approval.type === "screen" ? "◫" : approval.type === "browser" ? "↗" : "⌁";
    const secure = secureApprovalAvailable();
    const securityHint = $("#approvalSecurityHint");
    securityHint.textContent = secure
      ? text("Tailscaleで確認済みのHTTPS接続です。回答をPCへ安全に送信します。", "Verified Tailscale HTTPS connection. Your response will be sent securely to the PC.")
      : text("この操作への回答はTailscale HTTPS接続時だけ利用できます。PC側で回答することもできます。", "Approval responses are available only over Tailscale HTTPS. You can also respond on the PC.");
    securityHint.classList.toggle("is-blocked", !secure);
    const approveButton = $("#approveApprovalButton");
    const denyButton = $("#denyApprovalButton");
    approveButton.textContent = approval.type === "screen"
      ? text("撮影を許可", "Allow capture")
      : approval.type === "browser" ? text("ブラウザを許可", "Allow browser") : text("操作を許可", "Allow control");
    approveButton.disabled = !secure;
    denyButton.disabled = !secure;
    const updateCountdown = () => {
      const seconds = Math.max(0, Math.ceil((new Date(approval.expiresAt).getTime() - Date.now()) / 1000));
      $("#approvalCountdown").textContent = `${seconds}${text("秒", "s")}`;
      if (!seconds) {
        approveButton.disabled = true;
        denyButton.disabled = true;
        securityHint.textContent = text("この確認は期限切れです。もう一度依頼してください。", "This approval has expired. Request it again.");
        securityHint.classList.add("is-blocked");
        clearInterval(approvalCountdownTimer);
      }
    };
    updateCountdown();
    approvalCountdownTimer = setInterval(updateCountdown, 1000);
  }

  async function answerApproval(action) {
    const approval = appState?.approval;
    if (!approval || !secureApprovalAvailable()) return;
    primeAudioOutput().catch(() => {});
    const buttons = [$("#approveApprovalButton"), $("#denyApprovalButton")];
    for (const button of buttons) button.disabled = true;
    $("#approvalSecurityHint").textContent = action === "approve"
      ? text("許可を送信しています…", "Sending approval…")
      : text("拒否を送信しています…", "Sending denial…");
    try {
      const payload = await request("/api/approval", { method: "POST", body: JSON.stringify({ id: approval.id, action }) });
      if (payload.state) applyState(payload.state);
      if (payload.result?.text) {
        setResponseText(payload.result.text);
        if (action === "deny") speak(payload.result.text).catch(() => {});
      }
    } catch (error) {
      $("#approvalSecurityHint").textContent = error.message;
      $("#approvalSecurityHint").classList.add("is-blocked");
      renderApproval();
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
    setComposerHint(currentMode === "work"
      ? text(`${appState.workDirectoryName || "選択中のフォルダー"}内で作業`, `Work inside ${appState.workDirectoryName || "the selected folder"}`)
      : microphoneAvailable()
        ? text("マイク利用可 · 安全なHTTPS接続", "Microphone ready · Secure HTTPS connection")
        : text("文字入力 · マイクにはHTTPS接続が必要", "Text input · Microphone requires HTTPS"));
  }

  function setBusy(value) {
    const wasBusy = busy;
    busy = Boolean(value);
    if (busy && speechRecognition) stopDictation({ keepArmed: true });
    $("#sendButton").hidden = false;
    $("#sendButton").classList.toggle("is-follow-up", busy);
    $("#sendButton").setAttribute("aria-label", busy ? text("フォローアップを差し込む", "Queue follow-up") : text("送信", "Send"));
    $("#interruptButton").hidden = !busy;
    $("#messageInput").disabled = false;
    $("#messageInput").placeholder = busy ? text("追加の指示を差し込む", "Add a follow-up") : text("メッセージを入力", "Type a message");
    $("#activityIndicator").hidden = !busy;
    $("#responseBubble").classList.toggle("is-busy", busy);
    syncRemoteSettings();
    syncWakeLock();
    if (wasBusy && !busy && pendingRemoteFollowUp) setTimeout(flushPendingRemoteFollowUp, 80);
    if (wasBusy && !busy) scheduleDictationResume();
  }

  function closeRemoteLivePeer() {
    try { livePeer?.close(); } catch {}
    for (const track of liveInputStream?.getTracks?.() || []) track.stop();
    try { liveSyntheticInputOscillator?.stop(); } catch {}
    liveSyntheticInputOscillator = null;
    liveSyntheticInputContext?.close().catch(() => {});
    liveSyntheticInputContext = null;
    const audio = $("#remoteLiveAudio");
    audio.pause();
    audio.srcObject = null;
    cancelAnimationFrame(liveAudioFrame);
    liveAudioFrame = 0;
    try { liveAudioSource?.disconnect(); } catch {}
    try { liveAudioGain?.disconnect(); } catch {}
    stopLiveBeatricePipeline();
    liveAudioSource = null;
    liveAudioGain = null;
    liveAudioContext = null;
    resetRemoteMouth();
    livePeer = null;
    liveInputStream = null;
    liveStarting = false;
    liveSessionId = "";
    liveOutputSuppressed = false;
    $("#microphoneButton").classList.remove("is-live");
    syncMicrophoneButton();
  }

  function setRemoteLiveOutputSuppressed(suppressed) {
    liveOutputSuppressed = Boolean(suppressed);
    if (liveAudioGain && liveAudioContext) {
      liveAudioGain.gain.setTargetAtTime(audioEnabled && !liveBeatriceActive && !liveOutputSuppressed ? 1 : 0, liveAudioContext.currentTime, .012);
    }
    if (liveBeatricePlaybackGain && liveAudioContext) {
      liveBeatricePlaybackGain.gain.setTargetAtTime(audioEnabled && !liveOutputSuppressed ? 1 : 0, liveAudioContext.currentTime, .012);
    }
    if (liveOutputSuppressed) resetRemoteMouth();
  }

  function floatSamplesBase64(samples) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x4000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
    }
    return btoa(binary);
  }

  function base64FloatSamples(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (!bytes.length || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT) throw new Error("Invalid converted audio data.");
    return new Float32Array(bytes.buffer);
  }

  function releaseLiveBeatriceCaption() {
    if (!pendingLiveBeatriceCaption) return;
    const caption = pendingLiveBeatriceCaption;
    pendingLiveBeatriceCaption = "";
    setResponseText(caption);
  }

  function stopLiveBeatricePipeline({ restoreRaw = false } = {}) {
    liveBeatriceGeneration += 1;
    liveBeatriceActive = false;
    liveBeatriceSessionId = "";
    if (liveBeatriceProcessor) liveBeatriceProcessor.onaudioprocess = null;
    try { liveBeatriceProcessor?.disconnect(); } catch {}
    try { liveBeatriceSilence?.disconnect(); } catch {}
    try { liveBeatricePlaybackGain?.disconnect(); } catch {}
    liveBeatriceProcessor = null;
    liveBeatriceSilence = null;
    liveBeatricePlaybackGain = null;
    liveBeatriceCaptureFrames = [];
    liveBeatriceCaptureSamples = 0;
    liveBeatriceCaptureOffset = 0;
    liveBeatriceUploadQueue = [];
    liveBeatriceUploading = false;
    liveBeatriceNextPlaybackTime = 0;
    liveBeatriceCaptionReady = false;
    if (pendingLiveBeatriceCaption) setResponseText(pendingLiveBeatriceCaption);
    pendingLiveBeatriceCaption = "";
    clearTimeout(liveBeatriceMouthCloseTimer);
    liveBeatriceMouthCloseTimer = 0;
    for (const timer of liveBeatriceLevelTimers) clearTimeout(timer);
    liveBeatriceLevelTimers.clear();
    for (const source of liveBeatricePlaybackSources) {
      try { source.stop(); } catch {}
      try { source.disconnect(); } catch {}
    }
    liveBeatricePlaybackSources.clear();
    if (restoreRaw && liveAudioGain && liveAudioContext) {
      liveAudioGain.gain.setTargetAtTime(audioEnabled && !liveOutputSuppressed ? 1 : 0, liveAudioContext.currentTime, .015);
    }
  }

  function failLiveBeatrice(message, failedSessionId = liveBeatriceSessionId) {
    if (!liveBeatriceActive) return;
    stopLiveBeatricePipeline({ restoreRaw: true });
    if (failedSessionId) {
      request("/api/live/beatrice/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId: failedSessionId }),
      }).catch(() => {});
    }
    setComposerHint(message || text("Beatrice 2を継続できないため元のLive音声へ戻しました", "Beatrice 2 stopped; using the original Live voice"), { error: true });
  }

  async function pumpLiveBeatriceUploads() {
    if (liveBeatriceUploading || !liveBeatriceActive || !liveBeatriceSessionId) return;
    const generation = liveBeatriceGeneration;
    const sessionId = liveBeatriceSessionId;
    liveBeatriceUploading = true;
    try {
      while (liveBeatriceActive
        && generation === liveBeatriceGeneration
        && sessionId === liveBeatriceSessionId
        && liveBeatriceUploadQueue.length) {
        const samples = liveBeatriceUploadQueue.shift();
        await request("/api/live/beatrice/audio", {
          method: "POST",
          body: JSON.stringify({ audio: floatSamplesBase64(samples), sessionId }),
        });
      }
    } catch (error) {
      if (generation === liveBeatriceGeneration) {
        failLiveBeatrice(text(`Beatrice 2の変換を継続できません: ${error.message}`, `Beatrice 2 conversion stopped: ${error.message}`));
      }
    } finally {
      if (generation === liveBeatriceGeneration) liveBeatriceUploading = false;
    }
  }

  function pushLiveBeatriceSamples(samples) {
    if (!liveBeatriceActive || !samples.length) return;
    liveBeatriceCaptureFrames.push(samples);
    liveBeatriceCaptureSamples += samples.length;
    const batchSamples = 480 * 8;
    while (liveBeatriceCaptureSamples >= batchSamples) {
      const batch = new Float32Array(batchSamples);
      let written = 0;
      while (written < batchSamples) {
        const source = liveBeatriceCaptureFrames[0];
        const count = Math.min(batchSamples - written, source.length - liveBeatriceCaptureOffset);
        batch.set(source.subarray(liveBeatriceCaptureOffset, liveBeatriceCaptureOffset + count), written);
        written += count;
        liveBeatriceCaptureOffset += count;
        liveBeatriceCaptureSamples -= count;
        if (liveBeatriceCaptureOffset === source.length) {
          liveBeatriceCaptureFrames.shift();
          liveBeatriceCaptureOffset = 0;
        }
      }
      liveBeatriceUploadQueue.push(batch);
      if (liveBeatriceUploadQueue.length > 10) liveBeatriceUploadQueue.shift();
    }
    pumpLiveBeatriceUploads();
  }

  function captureLiveBeatrice(inputBuffer, contextSampleRate) {
    const frames = inputBuffer.length;
    const mono = new Float32Array(frames);
    for (let channel = 0; channel < inputBuffer.numberOfChannels; channel += 1) {
      const values = inputBuffer.getChannelData(channel);
      for (let index = 0; index < frames; index += 1) mono[index] += values[index] / inputBuffer.numberOfChannels;
    }
    if (contextSampleRate === 48000) {
      pushLiveBeatriceSamples(mono);
      return;
    }
    const outputLength = Math.max(1, Math.round(mono.length * 48000 / contextSampleRate));
    const resampled = new Float32Array(outputLength);
    const scale = contextSampleRate / 48000;
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * scale;
      const left = Math.min(mono.length - 1, Math.floor(position));
      const right = Math.min(mono.length - 1, left + 1);
      const mix = position - left;
      resampled[index] = mono[left] * (1 - mix) + mono[right] * mix;
    }
    pushLiveBeatriceSamples(resampled);
  }

  function startLiveBeatriceCapture(source, context) {
    const processor = context.createScriptProcessor(1024, 1, 1);
    const silence = context.createGain();
    silence.gain.value = 0;
    processor.onaudioprocess = (event) => captureLiveBeatrice(event.inputBuffer, context.sampleRate);
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);
    liveBeatriceProcessor = processor;
    liveBeatriceSilence = silence;
    liveBeatricePlaybackGain = context.createGain();
    liveBeatricePlaybackGain.gain.value = audioEnabled && !liveOutputSuppressed ? 1 : 0;
    liveBeatricePlaybackGain.connect(context.destination);
  }

  function queueLiveBeatricePlayback(payload = {}) {
    if (!liveBeatriceActive
      || !liveAudioContext
      || !liveBeatricePlaybackGain
      || !liveBeatriceSessionId
      || payload.sessionId !== liveBeatriceSessionId) return;
    try {
      const generation = liveBeatriceGeneration;
      const samples = base64FloatSamples(payload.audio);
      const context = liveAudioContext;
      const buffer = context.createBuffer(1, samples.length, Number(payload.sampleRate) || 48000);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(liveBeatricePlaybackGain);
      if (!liveBeatriceNextPlaybackTime || liveBeatriceNextPlaybackTime < context.currentTime + .025) {
        liveBeatriceNextPlaybackTime = context.currentTime + .085;
      }
      const playbackTime = liveBeatriceNextPlaybackTime;
      source.start(playbackTime);
      liveBeatriceNextPlaybackTime += buffer.duration;
      liveBeatricePlaybackSources.add(source);
      source.onended = () => {
        liveBeatricePlaybackSources.delete(source);
        if (!liveBeatricePlaybackSources.size) {
          liveBeatriceCaptionReady = false;
          releaseLiveBeatriceCaption();
        }
      };
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / Math.max(1, samples.length));
      const levelTimer = setTimeout(() => {
        liveBeatriceLevelTimers.delete(levelTimer);
        if (!liveBeatriceActive || generation !== liveBeatriceGeneration) return;
        liveBeatriceCaptionReady = true;
        releaseLiveBeatriceCaption();
        updateRemoteMouth(rms);
        clearTimeout(liveBeatriceMouthCloseTimer);
        liveBeatriceMouthCloseTimer = setTimeout(() => {
          if (!liveBeatriceActive || generation !== liveBeatriceGeneration) return;
          resetRemoteMouth();
        }, buffer.duration * 1000 + 55);
      }, Math.max(0, (playbackTime - context.currentTime) * 1000));
      liveBeatriceLevelTimers.add(levelTimer);
    } catch (error) {
      failLiveBeatrice(text(`Beatrice 2の音声を再生できません: ${error.message}`, `Could not play Beatrice 2 audio: ${error.message}`));
    }
  }

  async function followLiveAudio(stream) {
    cancelAnimationFrame(liveAudioFrame);
    try { liveAudioSource?.disconnect(); } catch {}
    try { liveAudioGain?.disconnect(); } catch {}
    audioContext ||= new AudioContext({ latencyHint: "interactive" });
    const context = audioContext;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const gain = context.createGain();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = .1;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    gain.gain.value = audioEnabled && !liveBeatriceActive && !liveOutputSuppressed ? 1 : 0;
    liveAudioContext = context;
    liveAudioSource = source;
    liveAudioGain = gain;
    if (liveBeatriceActive) startLiveBeatriceCapture(source, context);
    await context.resume();
    const samples = new Float32Array(analyser.fftSize);
    const animate = (now) => {
      if (liveAudioContext !== context) return;
      if (liveBeatriceActive) {
        liveAudioFrame = requestAnimationFrame(animate);
        return;
      }
      updateRemoteMouth(analyserRms(analyser, samples), now);
      liveAudioFrame = requestAnimationFrame(animate);
    };
    liveAudioFrame = requestAnimationFrame(animate);
  }

  function syncMicrophoneButton() {
    if (!appState) return;
    const voice = appState.voice || {};
    const liveMode = voice.responseMode === "live";
    const remoteOwnsLive = voice.liveConnected && voice.liveOwner === "remote";
    const pcOwnsLive = voice.liveConnected && voice.liveOwner !== "remote";
    const button = $("#microphoneButton");
    button.disabled = (!liveMode && !dictationArmed && busy)
      || (!liveMode && !microphoneAvailable() && !microphoneHandoffAvailable());
    button.classList.toggle("is-live", Boolean(livePeer && (remoteOwnsLive || liveStarting)));
    button.classList.toggle("is-listening", Boolean(dictationArmed));
    button.title = liveMode
      ? liveStarting ? text("Live接続を中止", "Cancel Live connection") : remoteOwnsLive ? text("Liveを停止", "Stop Live") : pcOwnsLive ? text("PC側のLiveからこの端末へ切り替え", "Move Live from the PC to this phone") : text("この端末でLiveを開始", "Start Live on this phone")
      : dictationArmed
        ? text("連続音声入力を停止", "Stop continuous dictation")
        : microphoneAvailable()
          ? text("連続音声入力を開始", "Start continuous dictation")
          : microphoneHandoffAvailable()
            ? text("HTTPSへ切り替えて音声入力", "Switch to HTTPS for voice input")
            : text("音声入力にはHTTPS接続が必要", "Voice input requires HTTPS");
    button.setAttribute("aria-label", button.title);
  }

  async function handoffToSecureMicrophone() {
    setResponseText(text("安全なHTTPS接続へ切り替えています…", "Switching to a secure HTTPS connection…"));
    const result = await request("/api/secure-handoff", { method: "POST", body: "{}" });
    const destination = new URL(String(result?.url || ""));
    if (destination.protocol !== "https:" || !/(?:^|\.)ts\.net$/i.test(destination.hostname)) {
      throw new Error(text("安全な音声入力URLを確認できませんでした。", "The secure microphone URL could not be verified."));
    }
    location.assign(destination.toString());
  }

  async function startRemoteLive({ microphone = true } = {}) {
    if (livePeer || liveStarting) return true;
    stopDictation();
    stopMobileSpeech({ resumeDictation: false });
    stopLiveBeatricePipeline();
    setRemoteLiveOutputSuppressed(false);
    liveBeatriceActive = appState?.voice?.realtimeConversion === "beatrice-v2";
    primeAudioOutput().catch(() => {});
    liveStarting = true;
    syncMicrophoneButton();
    // Connection progress is app chrome, not something the character said.
    // Keep the previous conversation in the bubble while the status chip
    // explains the temporary transport state.
    setConnection(false, text("Live接続中…", "Connecting to Live…"));
    const peer = new RTCPeerConnection();
    livePeer = peer;
    try {
      if (microphone) {
        if (!microphoneAvailable()) throw new Error(text("マイクにはHTTPS接続が必要です。Tailscale Serveなどの安全なURLから開いてください。", "The microphone requires HTTPS. Open CharaDock through a secure URL such as Tailscale Serve."));
        liveInputStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        for (const track of liveInputStream.getAudioTracks()) peer.addTrack(track, liveInputStream);
      } else {
        // Frameless Live expects an input-audio media section even when the
        // turn begins from typed text. A local zero-gain WebAudio track keeps
        // that route active without requesting microphone permission; the
        // actual Codex answer can then be appended and spoken normally.
        try {
          liveSyntheticInputContext = new AudioContext({ latencyHint: "interactive" });
          const oscillator = liveSyntheticInputContext.createOscillator();
          const silence = liveSyntheticInputContext.createGain();
          const destination = liveSyntheticInputContext.createMediaStreamDestination();
          silence.gain.value = 0;
          oscillator.connect(silence).connect(destination);
          oscillator.start();
          await liveSyntheticInputContext.resume();
          liveSyntheticInputOscillator = oscillator;
          liveInputStream = destination.stream;
          for (const track of liveInputStream.getAudioTracks()) peer.addTrack(track, liveInputStream);
        } catch {
          liveSyntheticInputContext?.close().catch(() => {});
          liveSyntheticInputContext = null;
          liveSyntheticInputOscillator = null;
          peer.addTransceiver("audio", { direction: "recvonly" });
        }
      }
      peer.createDataChannel("oai-events");
      peer.addEventListener("track", (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        const audio = $("#remoteLiveAudio");
        audio.srcObject = stream;
        audio.muted = true;
        followLiveAudio(stream).catch(() => setResponseText(text("音声を再生できませんでした。画面を一度タップして、もう一度Liveを開始してください。", "Audio could not start. Tap the screen and start Live again.")));
        event.track.addEventListener("ended", () => {
          resetRemoteMouth();
        });
      });
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState) && livePeer === peer) {
          const stoppedSessionId = liveSessionId;
          if (stoppedSessionId) request("/api/live/stop", { method: "POST", body: JSON.stringify({ liveSessionId: stoppedSessionId }) }).catch(() => {});
          closeRemoteLivePeer();
          setConnection(false, text("Live再接続待ち", "Live disconnected"));
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGatheringComplete(peer);
      const localSdp = peer.localDescription?.sdp || offer.sdp;
      const started = await request("/api/live/start", {
        method: "POST",
        body: JSON.stringify({
          sdp: localSdp,
          mode: currentMode,
          takeover: appState?.voice?.liveConnected && appState.voice.liveOwner !== "remote",
        }),
        timeoutMs: 70_000,
      });
      if (livePeer !== peer) {
        if (started?.liveSessionId) request("/api/live/stop", { method: "POST", body: JSON.stringify({ liveSessionId: started.liveSessionId }) }).catch(() => {});
        throw new Error(text("Live接続が中断されました。", "Live connection was interrupted."));
      }
      liveSessionId = String(started?.liveSessionId || "");
      if (liveBeatriceActive && !started?.beatriceActive) {
        failLiveBeatrice(started?.beatriceError || text("Beatrice 2を開始できないため元のLive音声を使います", "Beatrice 2 could not start; using the original Live voice"));
      } else if (liveBeatriceActive) {
        liveBeatriceSessionId = String(started?.beatriceSessionId || "");
        if (!liveBeatriceSessionId) failLiveBeatrice(text("Beatrice 2の音声セッションを確認できないため元のLive音声を使います", "Beatrice 2 audio session is unavailable; using the original Live voice"));
        else pumpLiveBeatriceUploads();
      }
      return true;
    } catch (error) {
      if (livePeer === peer) {
        closeRemoteLivePeer();
        request("/api/live/stop", { method: "POST", body: "{}", timeoutMs: 5_000 }).catch(() => {});
      }
      throw error;
    } finally {
      liveStarting = false;
      if (!livePeer) setConnection(true);
      syncMicrophoneButton();
    }
  }

  async function stopRemoteLive() {
    const stoppedSessionId = liveSessionId;
    const shouldStopServer = Boolean(stoppedSessionId || liveStarting || appState?.voice?.liveOwner === "remote");
    closeRemoteLivePeer();
    try {
      if (shouldStopServer) {
        await request("/api/live/stop", {
          method: "POST",
          body: JSON.stringify({ liveSessionId: stoppedSessionId || undefined }),
          timeoutMs: 10_000,
        });
      }
    }
    finally { syncMicrophoneButton(); }
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
      return;
    }
    if (method.startsWith("thread/realtime/transcript/") && params.role === "assistant") {
      setRemoteLiveOutputSuppressed(Boolean(params.suppressed));
      if (params.suppressed) return;
    }
    if (method.startsWith("thread/realtime/transcript/") && params.role === "user") {
      setRemoteLiveOutputSuppressed(false);
    }
    if (method === "thread/realtime/error") {
      setResponseText(params.message || text("Liveへ接続できませんでした。", "Could not connect to Live."));
      closeRemoteLivePeer();
      setBusy(Boolean(appState?.workHistory?.activeWorkRunId));
      return;
    }
    if (method === "thread/realtime/closed") {
      closeRemoteLivePeer();
      setBusy(Boolean(appState?.workHistory?.activeWorkRunId));
    }
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

  function setSettingsStatus(message = "", state = "") {
    const status = $("#settingsStatus");
    clearTimeout(settingsStatusTimer);
    settingsStatusTimer = 0;
    status.textContent = String(message || "");
    status.dataset.state = state;
    status.hidden = !message;
    if (message && state === "success") {
      settingsStatusTimer = setTimeout(() => {
        status.hidden = true;
        status.textContent = "";
        status.dataset.state = "";
      }, 1800);
    }
  }

  function setSettingsControlsBusy(value) {
    for (const control of $("#settingsSheet").querySelectorAll("select, input")) control.disabled = Boolean(value);
  }

  function syncRemoteSettings() {
    if (!appState) return;
    const voice = appState.voice || {};
    const characterSelect = $("#characterSelect");
    characterSelect.replaceChildren();
    for (const character of appState.characters || []) characterSelect.appendChild(new Option(character.name, character.id));
    characterSelect.value = appState.character?.id || "";
    characterSelect.disabled = busy || settingsSaving || Boolean(voice.liveConnected);

    const responseMode = voice.responseMode === "live" ? "live" : "tts";
    $("#responseModeSelect").value = responseMode;
    $("#responseModeSelect").disabled = busy || settingsSaving;
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
    providerSelect.disabled = busy || settingsSaving || responseMode === "live";
    $("#ttsProviderField").hidden = responseMode === "live";
    syncTtsModelSettings(responseMode);

    const realtimeVoiceSelect = $("#realtimeVoiceSelect");
    realtimeVoiceSelect.replaceChildren();
    for (const name of voice.realtimeVoices || []) realtimeVoiceSelect.appendChild(new Option(name.replace(/^./, (value) => value.toUpperCase()), name));
    realtimeVoiceSelect.value = voice.realtimeVoice || "cove";
    realtimeVoiceSelect.disabled = busy || settingsSaving || Boolean(voice.liveConnected);
    $("#realtimeVoiceField").hidden = responseMode !== "live";
    $("#pcAudioToggle").checked = voice.pcAudioEnabled === true;
    $("#pcAudioToggle").disabled = busy || settingsSaving;
    $("#phoneAudioToggle").checked = audioEnabled;
    $("#phoneAudioToggle").disabled = settingsSaving || !phoneAudioAvailable();
    $("#voiceRouteHint").textContent = responseMode === "live"
      ? voice.liveConnected
        ? voice.liveOwner === "remote"
          ? text(`この端末でGPT-Liveへ接続中。音声と字幕をここで受け取ります。${voice.realtimeConversion === "beatrice-v2" ? (voice.beatriceActive ? "回答音声はPCのBeatrice 2で変換して、この端末へ戻します。" : "Beatrice 2を利用できないため元のLive音声で再生します。") : ""}`, `GPT-Live is connected on this phone, with audio and captions here.${voice.realtimeConversion === "beatrice-v2" ? (voice.beatriceActive ? " Response audio is converted by Beatrice 2 on the PC and streamed back to this device." : " Beatrice 2 is unavailable, so the original Live voice is used.") : ""}`)
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
    setSettingsStatus(text("保存中…", "Saving…"), "saving");
    setSettingsControlsBusy(true);
    try {
      const payload = await request("/api/settings", { method: "POST", body: JSON.stringify(patch) });
      applyState(payload.state);
      setSettingsStatus(text("保存しました", "Saved"), "success");
    } catch (error) {
      setSettingsStatus(text(`保存できませんでした: ${error.message}`, `Could not save: ${error.message}`), "error");
    } finally {
      settingsSaving = false;
      $("#settingsSheet").classList.remove("is-saving");
      syncRemoteSettings();
    }
  }

  function applyState(nextState) {
    if (!nextState) return;
    if (dictationArmed && nextState?.voice?.responseMode === "live") stopDictation();
    const changedCharacter = appState?.character?.id !== nextState.character?.id || appState?.character?.assetVersion !== nextState.character?.assetVersion;
    observeStateTransitions(nextState);
    appState = nextState;
    if (!modeInitialized || appState?.voice?.liveConnected) {
      currentMode = appState.interactionMode === "work" && appState.workAllowed ? "work" : "chat";
      modeInitialized = true;
    }
    document.documentElement.lang = appState.language === "en" ? "en" : "ja";
    $("#pairingView").hidden = true;
    $("#companionView").hidden = false;
    $("#workModeButton").disabled = !appState.workAllowed;
    if (!appState.workAllowed && currentMode === "work") currentMode = "chat";
    setMode(currentMode);
    if (changedCharacter) syncAvatar().catch(() => {});
    else syncAvatarMotion();
    if (appState.lastDisplayText) setResponseText(appState.lastDisplayText);
    const startupGreeting = appState.startupGreeting;
    if (startupGreeting?.id && startupGreeting.id !== seenStartupGreetingId) {
      seenStartupGreetingId = startupGreeting.id;
      setResponseText(startupGreeting.text);
      if (startupGreeting.route === "mobile-tts") {
        pendingStartupGreeting = { id: startupGreeting.id, text: startupGreeting.text };
        setTimeout(() => attemptStartupGreeting(), 120);
      } else if (startupGreeting.route === "live") {
        setComposerHint(text("Liveを開始すると、この声で話しかけます", "Start Live to hear this greeting in the selected voice"));
      }
    }
    const activeRun = appState.workHistory?.activeWorkRunId;
    setBusy(Boolean(activeRun || appState.busy));
    setConnection(true);
    renderHistory();
    renderApproval();
    renderWorkProgress();
    syncAudioButton();
    syncRemoteSettings();
    syncPwaSettings();
    syncWakeLock();
    const nextMcpApp = appState.mcpApp;
    if (nextMcpApp?.id && nextMcpApp.id !== seenMcpAppId) {
      seenMcpAppId = nextMcpApp.id;
      seenMcpAppUpdatedAt = Number(nextMcpApp.updatedAt || 0);
      if (nextMcpApp.id !== dismissedMcpAppId) setTimeout(() => openMcpApp(nextMcpApp), 80);
    } else if (nextMcpApp?.id && Number(nextMcpApp.updatedAt || 0) > seenMcpAppUpdatedAt) {
      seenMcpAppUpdatedAt = Number(nextMcpApp.updatedAt || 0);
      if ($("#previewDialog")?.classList.contains("is-mcp-app") && $("#previewDialog")?.open) mcpAppHost?.refresh?.().catch(() => {});
    }
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
      if (!appState) return;
      const nextWorkHistory = JSON.parse(event.data);
      observeStateTransitions({ ...appState, workHistory: nextWorkHistory });
      appState.workHistory = nextWorkHistory;
      renderHistory();
      renderWorkProgress();
      setBusy(Boolean(nextWorkHistory.activeWorkRunId || appState.busy));
    });
    eventSource.addEventListener("live", (event) => handleLiveEvent(JSON.parse(event.data)).catch((error) => {
      showRemoteSystemError(error);
      closeRemoteLivePeer();
    }));
    eventSource.addEventListener("beatrice-audio", (event) => queueLiveBeatricePlayback(JSON.parse(event.data)));
    eventSource.addEventListener("beatrice-error", (event) => {
      const payload = JSON.parse(event.data);
      failLiveBeatrice(String(payload?.message || ""), String(payload?.sessionId || liveBeatriceSessionId));
    });
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

  async function queueRemoteFollowUp(message) {
    pendingRemoteFollowUp = String(message || "").trim();
    if (!pendingRemoteFollowUp) return;
    stopMobileSpeech();
    setComposerHint(text("差し込みを受け付けました。現在の応答を止めています…", "Follow-up queued. Stopping the current response…"));
    try {
      await request("/api/interrupt", { method: "POST", body: "{}" });
    } catch (error) {
      pendingRemoteFollowUp = "";
      showRemoteSystemError(error);
      throw error;
    }
  }

  async function sendRemoteText(message) {
    const normalized = String(message || "").trim();
    if (!normalized) return;
    if (appState?.voice?.responseMode !== "live") stopMobileSpeech({ resumeDictation: false });
    setRemoteLiveOutputSuppressed(false);
    primeAudioOutput().catch(() => {});
    if (busy) {
      setComposerHint(currentMode === "work"
        ? text("追加の指示を同じ作業へ反映しています…", "Applying the follow-up to the current Work…")
        : text("追加の指示を同じ会話へ反映しています…", "Applying the follow-up to the current conversation…"));
      try {
        const payload = await request("/api/message", {
          method: "POST",
          body: JSON.stringify({ message: normalized, mode: currentMode, followUp: true }),
        });
        if (payload.result?.accepted) return;
        if (payload.result?.retryAsNewTurn) {
          await queueRemoteFollowUp(normalized);
          return;
        }
        throw new Error(text("追加入力を反映できませんでした。", "The follow-up could not be applied."));
      } catch (error) {
        showRemoteSystemError(error);
        const input = $("#messageInput");
        input.value = normalized;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    renderArtifacts([], "");
    setBusy(true);
    try {
      if (appState?.voice?.responseMode === "live"
        && (!livePeer || !appState.voice.liveConnected || appState.voice.liveOwner !== "remote")) {
        if (appState.voice.liveConnected && appState.voice.liveOwner === "remote") await stopRemoteLive();
        // Auto-started Live uses the same real microphone route as the mic
        // button. Never show an active microphone state for a silent synthetic
        // input track; startRemoteLive will fail closed on an insecure origin
        // or denied permission instead of silently changing the voice route.
        await startRemoteLive({ microphone: true });
      }
      await request("/api/message", { method: "POST", body: JSON.stringify({ message: normalized, mode: currentMode }) });
    } catch (error) {
      setBusy(false);
      showRemoteSystemError(error);
      const input = $("#messageInput");
      input.value = normalized;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function flushPendingRemoteFollowUp() {
    const message = pendingRemoteFollowUp;
    if (!message || busy) return;
    pendingRemoteFollowUp = "";
    setMode(currentMode);
    await sendRemoteText(message);
  }

  async function sendMessage(event) {
    event.preventDefault();
    const input = $("#messageInput");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    input.style.height = "auto";
    await sendRemoteText(message);
  }

  function stopDictation({ keepArmed = false } = {}) {
    clearTimeout(dictationRestartTimer);
    dictationRestartTimer = 0;
    if (!keepArmed) dictationArmed = false;
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) cancelledRecognitions.add(recognition);
    try { recognition?.abort(); } catch {}
    syncMicrophoneButton();
  }

  function scheduleDictationResume(delay = 420) {
    clearTimeout(dictationRestartTimer);
    dictationRestartTimer = 0;
    if (!dictationArmed || appState?.voice?.responseMode === "live" || document.visibilityState !== "visible") return;
    dictationRestartTimer = setTimeout(() => {
      dictationRestartTimer = 0;
      if (!dictationArmed) return;
      if (busy || mobileSpeechPending || activeAudioSource || speechRecognition) {
        scheduleDictationResume(280);
        return;
      }
      startDictation({ resumed: true });
    }, Math.max(250, Number(delay) || 420));
  }

  function startDictation({ resumed = false } = {}) {
    if (!microphoneAvailable()) throw new Error(text("音声入力にはHTTPS接続が必要です。Tailscale Serveなどの安全なURLを利用してください。", "Voice input requires HTTPS. Use a secure URL such as Tailscale Serve."));
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) throw new Error(text("このブラウザは音声文字起こしに対応していません。GPT-Liveを選ぶとマイク音声を直接送れます。", "This browser does not support speech dictation. Choose GPT-Live to send microphone audio directly."));
    if (speechRecognition || busy || mobileSpeechPending || activeAudioSource) {
      if (resumed) scheduleDictationResume();
      return;
    }
    dictationArmed = true;
    const recognition = new Recognition();
    speechRecognition = recognition;
    recognition.lang = appState?.language === "en" ? "en-US" : "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = "";
    let recognitionError = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = String(event.results[index][0]?.transcript || "");
        if (event.results[index].isFinal) finalText += transcript;
        else interim += transcript;
      }
      $("#messageInput").value = `${finalText}${interim}`.trim();
      setComposerHint(text("聞き取っています…", "Listening…"));
    };
    recognition.onerror = (event) => {
      recognitionError = String(event.error || "");
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(recognitionError)) {
        dictationArmed = false;
        showRemoteSystemError(text(`音声入力を継続できませんでした: ${recognitionError}`, `Continuous dictation could not continue: ${recognitionError}`));
      } else if (!["no-speech", "aborted"].includes(recognitionError)) {
        showRemoteSystemError(text(`音声入力を開始できませんでした: ${recognitionError}`, `Could not start dictation: ${recognitionError}`));
      }
    };
    recognition.onend = () => {
      if (speechRecognition === recognition) speechRecognition = null;
      syncMicrophoneButton();
      setMode(currentMode);
      if (cancelledRecognitions.has(recognition)) {
        scheduleDictationResume();
        return;
      }
      if (finalText.trim() && !busy) $("#messageForm").requestSubmit();
      else scheduleDictationResume(recognitionError === "no-speech" ? 650 : 420);
    };
    try {
      recognition.start();
    } catch (error) {
      if (speechRecognition === recognition) speechRecognition = null;
      if (resumed) {
        if (/not.?allowed|permission|gesture|security/i.test(`${error?.name || ""} ${error?.message || ""}`)) {
          dictationArmed = false;
          showRemoteSystemError(text("ブラウザが音声入力の自動再開を許可しませんでした。もう一度マイクを押してください。", "The browser blocked automatic dictation restart. Tap the microphone again."));
          syncMicrophoneButton();
          return;
        }
        scheduleDictationResume(700);
        return;
      }
      dictationArmed = false;
      throw error;
    }
    syncMicrophoneButton();
    setComposerHint(text("聞き取り中 · 回答後も自動で再開", "Listening · Restarts after each reply"));
  }

  async function toggleMicrophone() {
    const voice = appState?.voice || {};
    primeAudioOutput().catch(() => {});
    try {
      if (!microphoneAvailable() && microphoneHandoffAvailable()) {
        await handoffToSecureMicrophone();
        return;
      }
      if (voice.responseMode === "live") {
        if (livePeer || (voice.liveConnected && voice.liveOwner === "remote")) await stopRemoteLive();
        else await startRemoteLive({ microphone: true });
      } else {
        if (dictationArmed) stopDictation();
        else startDictation();
      }
    } catch (error) {
      showRemoteSystemError(error);
      $("#settingsSheet").showModal();
    }
  }

  async function interrupt() {
    $("#interruptButton").disabled = true;
    try { await request("/api/interrupt", { method: "POST", body: "{}" }); }
    catch (error) { showRemoteSystemError(error); }
    finally { $("#interruptButton").disabled = false; }
  }

  function handleStream(payload) {
    if (!payload || typeof payload !== "object") return;
    const audioRoute = payload.audioRoute === "live"
      ? "live"
      : payload.audioRoute === "mobile-tts" ? "mobile-tts" : "none";
    if (audioRoute === "live") stopMobileSpeech();
    if (payload.phase === "follow-up") {
      setComposerHint(payload.statusText || text("追加の指示を同じ作業へ反映しています…", "Applying the follow-up to the current Work…"));
      return;
    }
    if (payload.phase === "start") {
      if (payload.remoteTtsEnabled) beginMobileStreamSpeech(payload.turnId);
      else if (mobileStreamSpeechTurnId) stopMobileSpeech({ resumeDictation: false });
      setBusy(true);
      setComposerHint(payload.mode === "work"
        ? text("作業を進めています…", "Working…")
        : text("考えています…", "Thinking…"));
      renderArtifacts([], "");
      return;
    }
    if (payload.phase === "activity") {
      const value = payload.displayText || payload.text;
      if (value) setComposerHint(value);
      return;
    }
    if (payload.phase === "announcement") {
      const value = payload.displayText || payload.text;
      const queued = audioRoute === "mobile-tts" && queueMobileStreamSpeech(payload);
      if (value && !queued && !mobileStreamSpeechTurnId) setResponseText(value);
      return;
    }
    if (["delta", "realtime-caption"].includes(payload.phase)) {
      const value = payload.displayText || payload.text;
      const queued = payload.phase === "delta" && audioRoute === "mobile-tts" && queueMobileStreamSpeech(payload);
      if (value && payload.phase === "realtime-caption" && liveBeatriceActive && !liveBeatriceCaptionReady) {
        pendingLiveBeatriceCaption = String(value);
      } else if (value && (!mobileStreamSpeechTurnId || (!queued && payload.phase === "realtime-caption"))) {
        setResponseText(value);
      }
      if (payload.phase === "realtime-caption") setBusy(true);
      return;
    }
    if (payload.phase === "done") {
      const value = payload.displayText || payload.text || text("完了したよ。", "Done.");
      const queued = audioRoute === "mobile-tts" && queueMobileStreamSpeech(payload, { finished: true });
      if (!payload.deferDisplayToRealtime && !mobileStreamSpeechTurnId && !queued) setResponseText(value);
      renderArtifacts(payload.artifacts, payload.workRunId);
      if (!payload.realtimeSpeechPending) setBusy(false);
      setTimeout(refreshState, 80);
      return;
    }
    if (payload.phase === "realtime-work-complete") {
      setBusy(false);
      setTimeout(refreshState, 80);
      return;
    }
    if (payload.phase === "error") {
      if (mobileStreamSpeechTurnId) stopMobileSpeech({ resumeDictation: false });
      showRemoteSystemError(payload.message || text("処理を完了できませんでした。", "The request could not be completed."));
      setBusy(false);
      setTimeout(refreshState, 80);
    }
  }

  async function unlockAudio() {
    await setPhoneAudio(!audioEnabled);
  }

  async function setPhoneAudio(enabled) {
    audioEnabled = Boolean(enabled);
    if (enabled) {
      await primeAudioOutput();
    }
    localStorage.setItem("charadock.remote.audio", audioEnabled ? "1" : "0");
    if (!audioEnabled) stopMobileSpeech();
    if (liveAudioGain && liveAudioContext) {
      liveAudioGain.gain.setValueAtTime(audioEnabled && !liveBeatriceActive && !liveOutputSuppressed ? 1 : 0, liveAudioContext.currentTime);
    }
    if (liveBeatricePlaybackGain && liveAudioContext) {
      liveBeatricePlaybackGain.gain.setValueAtTime(audioEnabled && !liveOutputSuppressed ? 1 : 0, liveAudioContext.currentTime);
    }
    syncAudioButton();
    syncRemoteSettings();
  }

  function syncAudioButton() {
    const allowed = phoneAudioAvailable();
    const button = $("#audioButton");
    button.disabled = !allowed;
    button.classList.toggle("is-active", allowed && audioEnabled);
    button.title = allowed
      ? audioEnabled ? text("この端末の音声をミュート", "Mute audio on this device") : text("この端末の音声を再開", "Resume audio on this device")
      : text("選択中の音声はこの端末で再生できません", "The selected voice cannot play on this device");
    $("#phoneAudioToggle").checked = audioEnabled;
    $("#phoneAudioToggle").disabled = !allowed;
  }

  async function decodeDataUrl(dataUrl) {
    const comma = String(dataUrl || "").indexOf(",");
    const bytes = Uint8Array.from(atob(String(dataUrl).slice(comma + 1)), (value) => value.charCodeAt(0));
    return audioContext.decodeAudioData(bytes.buffer);
  }

  async function playAudioUrl(dataUrl, playbackRate = 1, onStart = null, shouldStart = null) {
    const buffer = await decodeDataUrl(dataUrl);
    // Decoding can finish after the user has stopped speech or begun another
    // turn. Recheck ownership immediately before creating an audible source;
    // otherwise an already-cancelled caption can start speaking late.
    if (shouldStart && !shouldStart()) return false;
    return new Promise((resolve) => {
      const source = audioContext.createBufferSource();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = .1;
      source.buffer = buffer;
      source.playbackRate.value = Number(playbackRate) || 1;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      activeAudioSource = source;
      setAvatarSpeaking(true);
      const samples = new Float32Array(analyser.fftSize);
      const animate = (now) => {
        updateRemoteMouth(analyserRms(analyser, samples), now);
        mouthTimer = requestAnimationFrame(animate);
      };
      mouthTimer = requestAnimationFrame(animate);
      source.onended = () => {
        cancelAnimationFrame(mouthTimer);
        resetRemoteMouth({ keepSpeaking: mobileSpeechPending });
        if (activeAudioSource === source) activeAudioSource = null;
        resolve();
      };
      onStart?.();
      source.start();
    });
  }

  function stopMobileSpeech({ resumeDictation = true } = {}) {
    mobileSpeechToken += 1;
    mobileSpeechPending = false;
    mobileStreamSpeechQueue = [];
    mobileStreamSpeechTurnId = "";
    mobileStreamSpeechFinished = false;
    mobileStreamSpeechFullText = "";
    mobileStreamSpeechSignal?.();
    mobileStreamSpeechSignal = null;
    if (activeMobileTtsStreamId) {
      request("/api/tts/cancel", { method: "POST", body: JSON.stringify({ streamId: activeMobileTtsStreamId }) }).catch(() => {});
      activeMobileTtsStreamId = "";
    }
    try { activeAudioSource?.stop(); } catch {}
    activeAudioSource = null;
    cancelAnimationFrame(mouthTimer);
    resetRemoteMouth();
    if (resumeDictation) scheduleDictationResume();
  }

  async function playMobileTtsValue(value, token, onStart = null) {
    const normalized = String(value || "").trim().slice(0, 4000);
    if (!normalized || token !== mobileSpeechToken) return false;
    const result = await request("/api/tts", { method: "POST", body: JSON.stringify({ text: normalized }) });
    if (token !== mobileSpeechToken) return false;
    let activated = false;
    let played = false;
    const activate = () => {
      if (activated) return;
      activated = true;
      onStart?.();
    };
    activeMobileTtsStreamId = result?.streamId || "";
    for (const audioUrl of result?.audioDataUrls || []) {
      if (token !== mobileSpeechToken) return false;
      await playAudioUrl(audioUrl, result.playbackRate, activate, () => token === mobileSpeechToken);
      if (token !== mobileSpeechToken) return false;
      played = true;
    }
    let streamId = result?.streamId;
    while (streamId && token === mobileSpeechToken) {
      const next = await request("/api/tts/next", { method: "POST", body: JSON.stringify({ streamId }) });
      if (token !== mobileSpeechToken) return false;
      for (const audioUrl of next?.audioDataUrls || []) {
        if (token !== mobileSpeechToken) return false;
        await playAudioUrl(audioUrl, next.playbackRate || result.playbackRate, activate, () => token === mobileSpeechToken);
        if (token !== mobileSpeechToken) return false;
        played = true;
      }
      if (next?.done) streamId = "";
      activeMobileTtsStreamId = streamId;
    }
    activeMobileTtsStreamId = "";
    return played;
  }

  function beginMobileStreamSpeech(turnId = "") {
    if (!audioEnabled || !appState?.mobileTtsAllowed) return false;
    stopMobileSpeech({ resumeDictation: false });
    mobileStreamSpeechTurnId = String(turnId || "");
    mobileStreamSpeechFinished = false;
    mobileStreamSpeechFullText = "";
    mobileSpeechPending = true;
    if (speechRecognition) stopDictation({ keepArmed: true });
    drainMobileStreamSpeech();
    return true;
  }

  function queueMobileStreamSpeech(payload, { finished = false } = {}) {
    if (!mobileStreamSpeechTurnId || (payload?.turnId && payload.turnId !== mobileStreamSpeechTurnId)) return false;
    const segments = (Array.isArray(payload?.speechSegments) ? payload.speechSegments : []).flatMap((segment) => {
      const caption = String(segment?.text || segment || "").trim();
      const spokenText = String(segment?.spokenText || caption).trim();
      return caption && spokenText ? [{ caption, spokenText }] : [];
    });
    mobileStreamSpeechQueue.push(...segments);
    if (payload?.displayText || payload?.text) mobileStreamSpeechFullText = String(payload.displayText || payload.text);
    if (finished) mobileStreamSpeechFinished = true;
    mobileStreamSpeechSignal?.();
    mobileStreamSpeechSignal = null;
    drainMobileStreamSpeech();
    return Boolean(segments.length);
  }

  async function drainMobileStreamSpeech() {
    if (mobileStreamSpeechDraining || !mobileStreamSpeechTurnId) return;
    const token = mobileSpeechToken;
    mobileStreamSpeechDraining = true;
    try {
      audioContext ||= new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("Audio output is waiting for a user gesture.");
      while (token === mobileSpeechToken && mobileStreamSpeechTurnId) {
        const segment = mobileStreamSpeechQueue.shift();
        if (segment) {
          await playMobileTtsValue(segment.spokenText, token, () => setResponseText(segment.caption));
          continue;
        }
        if (mobileStreamSpeechFinished) break;
        await new Promise((resolve) => { mobileStreamSpeechSignal = resolve; });
      }
    } catch {
      resetRemoteMouth();
    } finally {
      mobileStreamSpeechDraining = false;
      if (token === mobileSpeechToken) {
        if (mobileStreamSpeechFinished && !mobileStreamSpeechQueue.length) {
          if (mobileStreamSpeechFullText) setResponseText(mobileStreamSpeechFullText);
          mobileStreamSpeechTurnId = "";
          mobileStreamSpeechFinished = false;
          mobileStreamSpeechFullText = "";
          mobileSpeechPending = false;
          activeMobileTtsStreamId = "";
          resetRemoteMouth();
          scheduleDictationResume();
        }
      } else if (mobileStreamSpeechTurnId) {
        queueMicrotask(() => drainMobileStreamSpeech());
      }
    }
  }

  async function speak(value) {
    if (!audioEnabled || !appState?.mobileTtsAllowed || !String(value || "").trim()) return false;
    if (speechRecognition) stopDictation({ keepArmed: true });
    stopMobileSpeech({ resumeDictation: false });
    const token = mobileSpeechToken;
    mobileSpeechPending = true;
    let completed = false;
    try {
      audioContext ||= new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("Audio output is waiting for a user gesture.");
      completed = await playMobileTtsValue(value, token);
    } catch {
      resetRemoteMouth();
    } finally {
      if (token === mobileSpeechToken) {
        mobileSpeechPending = false;
        activeMobileTtsStreamId = "";
        resetRemoteMouth();
        scheduleDictationResume();
      }
    }
    return completed;
  }

  async function attemptStartupGreeting() {
    const greeting = pendingStartupGreeting;
    if (!greeting || !audioEnabled || appState?.voice?.responseMode === "live") return false;
    const played = await speak(greeting.text);
    if (played && pendingStartupGreeting?.id === greeting.id) pendingStartupGreeting = null;
    return played;
  }

  async function tapCharacter(event) {
    if (petRequestInFlight) return;
    primeAudioOutput().catch(() => {});
    const speaking = Boolean(mobileSpeechPending || activeAudioSource || $("#avatarMotion").classList.contains("is-speaking"));
    if (speaking) {
      if (appState?.voice?.responseMode === "live" && appState.voice.liveConnected) await interrupt().catch(() => {});
      else stopMobileSpeech();
      setComposerHint(text("読み上げを停止しました", "Stopped speaking"));
      setTimeout(() => setMode(currentMode), 1800);
      return;
    }
    if (busy) {
      navigator.vibrate?.(6);
      return;
    }
    const bounds = $("#avatarTapTarget").getBoundingClientRect();
    const yRatio = bounds.height > 0
      ? Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
      : .5;
    petRequestInFlight = true;
    $("#avatarTapTarget").setAttribute("aria-busy", "true");
    try {
      const voice = appState?.voice || {};
      if (voice.responseMode === "live" && !livePeer) {
        if (liveStarting) {
          setComposerHint(text("Liveへ接続しています…", "Connecting to Live…"));
          return;
        }
        if (voice.liveConnected && voice.liveOwner !== "remote") {
          setComposerHint(text(
            "PC側のLiveが使用中です。マイクボタンでこの端末へ切り替えられます",
            "Live is active on the PC. Use the microphone button to move it to this device",
          ));
          syncMicrophoneButton();
          return;
        }
        if (!microphoneAvailable()) {
          setComposerHint(microphoneHandoffAvailable()
            ? text(
              "タップからLiveを始めるにはHTTPSが必要です。マイクボタンで安全な接続へ切り替えてください",
              "Starting Live by tapping requires HTTPS. Use the microphone button to switch to a secure connection",
            )
            : text(
              "タップからLiveを始めるにはHTTPS接続とマイク権限が必要です",
              "Starting Live by tapping requires an HTTPS connection and microphone permission",
            ));
          syncMicrophoneButton();
          return;
        }
        // A stale server-owned session can survive a browser-side disconnect.
        // Reconnect it with a real microphone track before asking for the pet
        // reaction so Live remains the only voice and transcript source.
        if (voice.liveConnected && voice.liveOwner === "remote") await stopRemoteLive();
        await startRemoteLive({ microphone: true });
      }
      const result = await request("/api/pet", { method: "POST", body: JSON.stringify({ yRatio }) });
      if (result?.busy) return;
      applyPetReaction(result);
      // Live may phrase the requested reaction naturally. Its transcript is
      // the single source of truth for both the bubble and the spoken reply.
      if (!result?.deferDisplayToRealtime) setResponseText(result?.text);
      if (result?.realtimeSpeechError) {
        setComposerHint(text("Live音声を再生できませんでした。回答は画面で確認できます", "Live audio could not play. The response remains visible"), { error: true });
      } else if (result?.realtimeSpeechBusy) {
        setComposerHint(text("回答中はクリック発話を重ねません", "Tap speech waits until the response finishes"));
      } else if (result?.ttsEnabled && !result?.realtimeSpeech) {
        speak(result.spokenText || result.text).catch(() => {});
      }
    } catch (error) {
      showRemoteSystemError(error);
      setTimeout(() => setMode(currentMode), 2400);
    } finally {
      petRequestInFlight = false;
      $("#avatarTapTarget").removeAttribute("aria-busy");
    }
  }

  async function openArtifact(runId, artifact) {
    const dialog = $("#previewDialog");
    const body = $("#previewBody");
    mcpAppHost?.destroy?.();
    mcpAppHost = null;
    if (dialog.open) dialog.close();
    dialog.classList.remove("is-mcp-app", "is-mcp-fullscreen");
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

  function closePreview() {
    const dialog = $("#previewDialog");
    if (dialog.classList.contains("is-mcp-app") && appState?.mcpApp?.id) dismissedMcpAppId = appState.mcpApp.id;
    mcpAppHost?.destroy?.();
    mcpAppHost = null;
    dialog.classList.remove("is-mcp-app", "is-mcp-fullscreen");
    if (dialog.open) dialog.close();
  }

  function openMcpApp(mcpApp) {
    if (!mcpApp?.id) return;
    const dialog = $("#previewDialog");
    const body = $("#previewBody");
    mcpAppHost?.destroy?.();
    mcpAppHost = null;
    if (dialog.open) dialog.close();
    dialog.classList.add("is-mcp-app");
    dialog.classList.remove("is-mcp-fullscreen");
    body.replaceChildren();
    $("#previewTitle").textContent = mcpApp.title || text("MCPカード", "MCP card");
    const frame = document.createElement("iframe");
    frame.src = `/api/mcp-app?id=${encodeURIComponent(mcpApp.id)}`;
    frame.title = mcpApp.title || text("MCPカード", "MCP card");
    frame.setAttribute("sandbox", "allow-scripts");
    mcpAppHost = window.CharaDockMcpAppHost?.mount(frame, mcpApp, {
      request: (payload) => request("/api/mcp-app/bridge", { method: "POST", body: JSON.stringify(payload), timeoutMs: 90_000 }),
      openExternal: async (value) => {
        const result = await request("/api/mcp-app/bridge", {
          method: "POST",
          body: JSON.stringify({ appId: mcpApp.id, method: "ui/open-link", params: { url: String(value || "") } }),
        });
        const url = new URL(String(result?.url || ""));
        if (!["https:", "http:"].includes(url.protocol)) throw new Error(text("安全なリンクではありません。", "This link is not safe to open."));
        if (result?.requiresConfirmation && !window.confirm(text(
          `${url.hostname} をブラウザーで開きますか？`,
          `Open ${url.hostname} in your browser?`,
        ))) return;
        window.open(url.href, "_blank", "noopener,noreferrer");
      },
      onClose: closePreview,
      onDisplayMode: (mode) => dialog.classList.toggle("is-mcp-fullscreen", mode === "fullscreen"),
    });
    body.appendChild(frame);
    dialog.show();
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
  $("#interruptButton").addEventListener("click", () => { pendingRemoteFollowUp = ""; interrupt(); });
  $("#chatModeButton").addEventListener("click", () => setMode("chat"));
  $("#workModeButton").addEventListener("click", () => setMode("work"));
  $("#microphoneButton").addEventListener("click", toggleMicrophone);
  $("#audioButton").addEventListener("click", unlockAudio);
  $("#historyButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#settingsButton").addEventListener("click", () => { syncRemoteSettings(); syncPwaSettings(); $("#settingsSheet").showModal(); });
  $("#bubbleExpandButton").addEventListener("click", () => { renderHistory(); $("#historySheet").showModal(); });
  $("#closeHistoryButton").addEventListener("click", () => $("#historySheet").close());
  $("#closeSettingsButton").addEventListener("click", () => $("#settingsSheet").close());
  $("#closePreviewButton").addEventListener("click", closePreview);
  $("#workProgressCard").addEventListener("click", () => {
    selectedWorkRunId = appState?.workHistory?.activeWorkRunId || selectedWorkRunId;
    renderWorkProgress();
    $("#workProgressSheet").showModal();
  });
  $("#closeWorkProgressButton").addEventListener("click", () => $("#workProgressSheet").close());
  $("#progressFollowUpForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#progressFollowUpInput");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    await sendRemoteText(message);
  });
  $("#approveApprovalButton").addEventListener("click", () => answerApproval("approve"));
  $("#denyApprovalButton").addEventListener("click", () => answerApproval("deny"));
  $("#installAppButton").addEventListener("click", () => installRemoteApp().catch((error) => { $("#installAppHint").textContent = error.message; }));
  $("#notificationToggle").addEventListener("change", async (event) => {
    try {
      await setNotificationSetting(event.target.checked);
      setSettingsStatus(event.target.checked ? text("通知を有効にしました", "Notifications enabled") : text("通知を無効にしました", "Notifications disabled"), "success");
    } catch (error) {
      notificationEnabled = false;
      localStorage.setItem("charadock.remote.notifications", "0");
      syncPwaSettings();
      setSettingsStatus(error.message, "error");
    }
  });
  $("#wakeLockToggle").addEventListener("change", async (event) => {
    wakeLockEnabled = event.target.checked;
    localStorage.setItem("charadock.remote.wake-lock", wakeLockEnabled ? "1" : "0");
    await syncWakeLock();
    setSettingsStatus(wakeLockEnabled ? text("画面点灯を有効にしました", "Keep awake enabled") : text("画面点灯を無効にしました", "Keep awake disabled"), "success");
  });
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
  $("#characterSelect").addEventListener("change", (event) => {
    stopMobileSpeech({ resumeDictation: false });
    saveRemoteClientSettings({ characterId: event.target.value });
  });
  $("#responseModeSelect").addEventListener("change", (event) => {
    if (event.target.value === "live") stopDictation();
    saveRemoteClientSettings({ responseMode: event.target.value });
  });
  $("#ttsProviderSelect").addEventListener("change", (event) => saveRemoteClientSettings({ ttsProvider: event.target.value }));
  $("#realtimeVoiceSelect").addEventListener("change", (event) => saveRemoteClientSettings({ realtimeVoice: event.target.value }));
  $("#pcAudioToggle").addEventListener("change", (event) => saveRemoteClientSettings({ pcAudioEnabled: event.target.checked }));
  $("#phoneAudioToggle").addEventListener("change", (event) => setPhoneAudio(event.target.checked).catch(() => { event.target.checked = false; }));
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncPwaSettings();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    syncPwaSettings();
    setSettingsStatus(text("ホーム画面へ追加しました", "Installed on the Home Screen"), "success");
  });
  document.addEventListener("visibilitychange", () => {
    syncWakeLock();
    if (document.visibilityState !== "visible") stopDictation();
  });
  document.addEventListener("pointerdown", () => {
    if (pendingStartupGreeting) primeAudioOutput().catch(() => {});
  }, { capture: true });
  document.addEventListener("click", () => {
    if (pendingStartupGreeting) attemptStartupGreeting().catch(() => {});
  });
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type !== "notification-open") return;
    if (String(event.data.tag || "").startsWith("work-")) {
      renderWorkProgress();
      if (!$("#workProgressSheet").open) $("#workProgressSheet").showModal();
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(approvalCountdownTimer);
    clearInterval(workElapsedTimer);
    const currentWakeLock = wakeLockSentinel;
    wakeLockSentinel = null;
    currentWakeLock?.release?.().catch(() => {});
    if (appState?.voice?.liveOwner !== "remote" || !csrfToken) return;
    fetch("/api/live/stop", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-CharaDock-CSRF": csrfToken },
      body: "{}",
    }).catch(() => {});
  });
  registerPwa().finally(syncPwaSettings);
  pairFromFragment();
})();
