// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  let appState = null;
  let csrfToken = "";
  let eventSource = null;
  let currentMode = "chat";
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
  let avatarAssets = new Map();
  let petRequestInFlight = false;
  let mobileSpeechToken = 0;
  let mobileSpeechPending = false;
  let activeMobileTtsStreamId = "";
  let settingsSaving = false;
  let settingsStatusTimer = 0;
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
  let liveStarting = false;
  let liveAudioContext = null;
  let liveAudioFrame = 0;
  let liveAudioSource = null;
  let liveAudioGain = null;
  let speechRecognition = null;

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
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (csrfToken && options.method === "POST") headers["X-CharaDock-CSRF"] = csrfToken;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
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
    $("#composerHint").textContent = currentMode === "work"
      ? text(`${appState.workDirectoryName || "選択中のフォルダー"}内で作業`, `Work inside ${appState.workDirectoryName || "the selected folder"}`)
      : microphoneAvailable()
        ? text("マイク利用可 · 安全なHTTPS接続", "Microphone ready · Secure HTTPS connection")
        : text("文字入力 · マイクにはHTTPS接続が必要", "Text input · Microphone requires HTTPS");
  }

  function setBusy(value) {
    const wasBusy = busy;
    busy = Boolean(value);
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
    try { liveAudioGain?.disconnect(); } catch {}
    liveAudioSource = null;
    liveAudioGain = null;
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
    try { liveAudioSource?.disconnect(); } catch {}
    try { liveAudioGain?.disconnect(); } catch {}
    audioContext ||= new AudioContext({ latencyHint: "interactive" });
    const context = audioContext;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const gain = context.createGain();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    gain.gain.value = audioEnabled ? 1 : 0;
    liveAudioContext = context;
    liveAudioSource = source;
    liveAudioGain = gain;
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
    button.disabled = busy || liveStarting || pcOwnsLive || (!liveMode && !microphoneAvailable() && !microphoneHandoffAvailable());
    button.classList.toggle("is-live", Boolean(livePeer && remoteOwnsLive));
    button.classList.toggle("is-listening", Boolean(speechRecognition));
    button.title = liveMode
      ? remoteOwnsLive ? text("Liveを停止", "Stop Live") : pcOwnsLive ? text("PC側のLiveが使用中", "Live is active on the PC") : text("この端末でLiveを開始", "Start Live on this phone")
      : microphoneAvailable()
        ? text("音声で入力", "Dictate")
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
    primeAudioOutput().catch(() => {});
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
        audio.muted = true;
        followLiveAudio(stream).catch(() => setResponseText(text("音声を再生できませんでした。画面を一度タップして、もう一度Liveを開始してください。", "Audio could not start. Tap the screen and start Live again.")));
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
      await waitForIceGatheringComplete(peer);
      const localSdp = peer.localDescription?.sdp || offer.sdp;
      await request("/api/live/start", { method: "POST", body: JSON.stringify({ sdp: localSdp, mode: currentMode }) });
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
    const changedCharacter = appState?.character?.id !== nextState.character?.id || appState?.character?.assetVersion !== nextState.character?.assetVersion;
    observeStateTransitions(nextState);
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
    renderApproval();
    renderWorkProgress();
    syncAudioButton();
    syncRemoteSettings();
    syncPwaSettings();
    syncWakeLock();
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

  async function queueRemoteFollowUp(message) {
    pendingRemoteFollowUp = String(message || "").trim();
    if (!pendingRemoteFollowUp) return;
    stopMobileSpeech();
    $("#composerHint").textContent = text("差し込みを受け付けました。現在の応答を止めています…", "Follow-up queued. Stopping the current response…");
    try {
      await request("/api/interrupt", { method: "POST", body: "{}" });
    } catch (error) {
      pendingRemoteFollowUp = "";
      $("#composerHint").textContent = error.message;
      throw error;
    }
  }

  async function sendRemoteText(message) {
    const normalized = String(message || "").trim();
    if (!normalized) return;
    primeAudioOutput().catch(() => {});
    if (busy) {
      await queueRemoteFollowUp(normalized);
      return;
    }
    setResponseText(normalized);
    renderArtifacts([], "");
    setBusy(true);
    try {
      if (appState?.voice?.responseMode === "live" && !appState.voice.liveConnected) {
        await startRemoteLive({ microphone: false });
      }
      await request("/api/message", { method: "POST", body: JSON.stringify({ message: normalized, mode: currentMode }) });
    } catch (error) {
      setBusy(false);
      setResponseText(error.message);
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
    primeAudioOutput().catch(() => {});
    try {
      if (!microphoneAvailable() && microphoneHandoffAvailable()) {
        await handoffToSecureMicrophone();
        return;
      }
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
    audioEnabled = Boolean(enabled);
    if (enabled) {
      await primeAudioOutput();
    }
    localStorage.setItem("charadock.remote.audio", audioEnabled ? "1" : "0");
    if (!audioEnabled) stopMobileSpeech();
    if (liveAudioGain && liveAudioContext) {
      liveAudioGain.gain.setValueAtTime(audioEnabled ? 1 : 0, liveAudioContext.currentTime);
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
    primeAudioOutput().catch(() => {});
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
  $("#closePreviewButton").addEventListener("click", () => $("#previewDialog").close());
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
  $("#characterSelect").addEventListener("change", (event) => saveRemoteClientSettings({ characterId: event.target.value }));
  $("#responseModeSelect").addEventListener("change", (event) => saveRemoteClientSettings({ responseMode: event.target.value }));
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
  document.addEventListener("visibilitychange", () => syncWakeLock());
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
