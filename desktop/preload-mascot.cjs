// SPDX-License-Identifier: Apache-2.0
const { ipcRenderer, webUtils } = require("electron");
// Sandboxed Electron preload scripts can only require Electron and a small set
// of built-ins, so keep this renderer-safe projection aligned with vad-profile.cjs.
const VAD_PROFILES = Object.freeze({
  low: { startMin: .035, startFactor: 4.8, onsetMs: 240, stopMin: .009, stopFactor: 1.5, silenceMs: 1200 },
  normal: { startMin: .024, startFactor: 3.8, onsetMs: 160, stopMin: .0075, stopFactor: 1.35, silenceMs: 1050 },
  high: { startMin: .014, startFactor: 2.8, onsetMs: 80, stopMin: .006, stopFactor: 1.25, silenceMs: 850 },
});
const vadProfile = (sensitivity) => VAD_PROFILES[sensitivity] || VAD_PROFILES.normal;

window.addEventListener("DOMContentLoaded", () => {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "/desktop/mascot-overlay.css";
  document.head.appendChild(stylesheet);
  const bubble = document.createElement("div");
  bubble.id = "desktopMascotBubble";
  bubble.setAttribute("role", "status");
  const bubbleHeader = document.createElement("div");
  bubbleHeader.id = "desktopMascotBubbleHeader";
  const bubbleCharacterName = document.createElement("strong");
  bubbleCharacterName.id = "desktopMascotBubbleCharacterName";
  bubbleCharacterName.textContent = "キャラクター";
  const bubbleVoiceMode = document.createElement("span");
  bubbleVoiceMode.id = "desktopMascotBubbleVoiceMode";
  bubbleVoiceMode.textContent = "TTS";
  bubbleHeader.append(bubbleCharacterName, bubbleVoiceMode);
  const bubbleText = document.createElement("span");
  bubbleText.id = "desktopMascotBubbleText";
  const workActivity = document.createElement("span");
  workActivity.id = "desktopMascotWorkActivity";
  const permissionActions = document.createElement("div");
  permissionActions.id = "desktopMascotPermissionActions";
  permissionActions.hidden = true;
  permissionActions.innerHTML = `
    <button type="button" data-permission-action="approve">依頼を許可</button>
    <button type="button" data-permission-action="deny">やめる</button>`;
  const artifactActions = document.createElement("div");
  artifactActions.id = "desktopMascotArtifactActions";
  artifactActions.hidden = true;
  const bubbleMore = document.createElement("button");
  bubbleMore.id = "desktopMascotBubbleMore";
  bubbleMore.type = "button";
  bubbleMore.hidden = true;
  bubbleMore.textContent = "全文";
  bubbleMore.setAttribute("aria-expanded", "false");
  bubble.append(bubbleHeader, bubbleText, workActivity, permissionActions, artifactActions, bubbleMore);
  document.body.appendChild(bubble);

  const dock = document.createElement("div");
  dock.id = "desktopMascotDock";
  dock.innerHTML = `
    <span id="desktopMascotHint" role="status"></span>
    <span id="desktopMascotVoiceBadge" role="status" aria-live="polite">会話 · TTS</span>
    <div id="desktopMascotAutoSendCountdown" role="status" hidden>
      <span id="desktopMascotAutoSendCountdownLabel"></span>
      <button type="button" data-countdown-action="send">今すぐ送信</button>
      <button type="button" data-countdown-action="cancel">取消</button>
    </div>
    <form id="desktopMascotComposer">
      <div id="desktopMascotContextList" hidden>
        <div id="desktopMascotAttachmentList" aria-label="添付ファイル"></div>
        <div id="desktopMascotSkillList" aria-label="この送信で使うSkills"></div>
        <div id="desktopMascotMcpList" aria-label="この送信で使うMCP接続"></div>
      </div>
      <section id="desktopMascotAddPopover" role="dialog" aria-label="ファイルまたは拡張を追加" hidden>
        <button id="desktopMascotAddFile" type="button"><span class="ui-symbol ui-symbol-attach" aria-hidden="true"></span><span><strong>ファイルを添付</strong><small>ドラッグ＆ドロップにも対応</small></span></button>
        <header><span><strong>この送信で使う拡張</strong><small>Skills · MCP ／ または @ で検索</small></span><span class="desktop-mascot-extension-manage"><button id="desktopMascotManageSkills" type="button">Skills</button><button id="desktopMascotManageMcp" type="button">MCP</button></span></header>
        <label><span class="ui-symbol ui-symbol-search" aria-hidden="true"></span><input id="desktopMascotSkillSearch" type="search" autocomplete="off" aria-label="SkillまたはMCPを検索" placeholder="Skill・MCPを検索"></label>
        <div id="desktopMascotSkillPicker" role="listbox" aria-label="利用できるSkillsとMCP接続"></div>
      </section>
      <button id="desktopMascotModeButton" type="button" aria-label="ChatとWorkを切り替える">Chat</button>
      <button id="desktopMascotWorkTarget" type="button" aria-label="作業先フォルダーを変更する"></button>
      <button id="desktopMascotWorkOpenButton" type="button" aria-label="作業先フォルダーを開く" title="作業先フォルダーを開く"><span class="ui-symbol ui-symbol-folder-open" aria-hidden="true"></span></button>
      <button id="desktopMascotWorkHistoryButton" type="button" aria-label="履歴を開く" aria-expanded="false" title="履歴を開く"><span class="ui-symbol ui-symbol-history" aria-hidden="true"></span></button>
      <button id="desktopMascotAttachButton" type="button" aria-label="ファイルまたは拡張を追加" aria-expanded="false" aria-controls="desktopMascotAddPopover" title="ファイルまたは拡張を追加"><span class="ui-symbol ui-symbol-plus" aria-hidden="true"></span></button>
      <input id="desktopMascotFileInput" type="file" multiple hidden>
      <button id="desktopMascotMicButton" type="button" aria-label="音声入力" aria-pressed="false" title="音声入力"><span class="ui-symbol ui-symbol-microphone" aria-hidden="true"></span></button>
      <textarea id="desktopMascotInput" rows="1" maxlength="6000" aria-label="メッセージ" placeholder="短く話しかける…"></textarea>
      <button id="desktopMascotSendButton" type="submit" aria-label="送信" title="送信"><span class="ui-symbol ui-symbol-send" aria-hidden="true"></span></button>
      <button id="desktopMascotStopButton" type="button" aria-label="応答を中断" title="応答を中断" hidden><span class="ui-symbol ui-symbol-stop" aria-hidden="true"></span></button>
    </form>
    <button id="desktopMascotSettingsButton" type="button" aria-label="設定を開く" title="設定を開く"><span class="ui-symbol ui-symbol-settings" aria-hidden="true"></span></button>
    <button id="desktopMascotChatButton" type="button" aria-label="会話入力を開く" title="会話入力を開く"><span class="ui-symbol ui-symbol-chat" aria-hidden="true"></span></button>`;
  document.body.appendChild(dock);
  const workPanel = document.createElement("section");
  workPanel.id = "desktopMascotWorkPanel";
  workPanel.setAttribute("role", "dialog");
  workPanel.setAttribute("aria-label", "履歴");
  workPanel.setAttribute("aria-modal", "false");
  workPanel.setAttribute("aria-hidden", "true");
  workPanel.innerHTML = `
    <header>
      <div><strong id="desktopMascotHistoryTitle">履歴</strong><span id="desktopMascotWorkPanelSummary">ChatとWorkの記録</span></div>
      <button id="desktopMascotWorkPanelClose" type="button" aria-label="作業履歴を閉じる" title="履歴を閉じる"><span class="ui-symbol ui-symbol-close" aria-hidden="true"></span></button>
    </header>
    <div id="desktopMascotWorkHistoryList"></div>`;
  document.body.appendChild(workPanel);
  const petZone = document.createElement("div");
  petZone.id = "desktopMascotPetZone";
  petZone.setAttribute("aria-label", "キャラクターに触れる");
  petZone.title = "ドラッグで移動・クリックで触れる";
  document.body.appendChild(petZone);
  const fileDrop = document.createElement("div");
  fileDrop.id = "desktopMascotFileDrop";
  fileDrop.setAttribute("role", "status");
  fileDrop.setAttribute("aria-live", "polite");
  fileDrop.setAttribute("aria-hidden", "true");
  fileDrop.innerHTML = `<span class="ui-symbol ui-symbol-attach" aria-hidden="true"></span><strong>キャラに渡す</strong><small>Drop to character</small>`;
  document.body.appendChild(fileDrop);
  const form = dock.querySelector("#desktopMascotComposer");
  const input = dock.querySelector("#desktopMascotInput");
  const sendButton = dock.querySelector("#desktopMascotSendButton");
  const stopButton = dock.querySelector("#desktopMascotStopButton");
  const micButton = dock.querySelector("#desktopMascotMicButton");
  const attachButton = dock.querySelector("#desktopMascotAttachButton");
  const fileInput = dock.querySelector("#desktopMascotFileInput");
  const contextList = dock.querySelector("#desktopMascotContextList");
  const attachmentList = dock.querySelector("#desktopMascotAttachmentList");
  const selectedSkillList = dock.querySelector("#desktopMascotSkillList");
  const selectedMcpList = dock.querySelector("#desktopMascotMcpList");
  const addPopover = dock.querySelector("#desktopMascotAddPopover");
  const skillSearch = dock.querySelector("#desktopMascotSkillSearch");
  const skillPicker = dock.querySelector("#desktopMascotSkillPicker");
  const modeButton = dock.querySelector("#desktopMascotModeButton");
  const workTarget = dock.querySelector("#desktopMascotWorkTarget");
  const workOpenButton = dock.querySelector("#desktopMascotWorkOpenButton");
  const workHistoryButton = dock.querySelector("#desktopMascotWorkHistoryButton");
  const workHistoryList = workPanel.querySelector("#desktopMascotWorkHistoryList");
  const workPanelSummary = workPanel.querySelector("#desktopMascotWorkPanelSummary");
  const historyTitle = workPanel.querySelector("#desktopMascotHistoryTitle");
  const hint = dock.querySelector("#desktopMascotHint");
  const voiceBadge = dock.querySelector("#desktopMascotVoiceBadge");
  const autoSendCountdown = dock.querySelector("#desktopMascotAutoSendCountdown");
  const autoSendCountdownLabel = dock.querySelector("#desktopMascotAutoSendCountdownLabel");
  let statusTimer;
  let autoSendCountdownTimer;
  let autoSendCountdownCommand = "";
  let autoSendCountdownEndsAt = 0;
  let autoCloseTimer;
  let temporaryInteractionHold = false;
  let sending = false;
  let pendingFollowUp = null;
  let mascotAttachments = [];
  let mascotSelectedSkillIds = [];
  let mascotSelectedMcpServerIds = [];
  let mascotSkillPickerIndex = 0;
  let mascotSkillTrigger = null;
  let fileDragDepth = 0;
  let speechRecognition;
  let appState;
  let realtimePeer = null;
  let realtimeDataChannel = null;
  let realtimeSessionState = "idle";
  let realtimeRemoteAudio = null;
  let realtimeOutputSuppressed = false;
  let realtimeMeterContext = null;
  let realtimeMeterSource = null;
  let realtimeMeterAnalyser = null;
  let realtimeMeterSilence = null;
  let realtimeMeterFrame = 0;
  let realtimeMeterSamples = null;
  let realtimeMeterLastSentAt = 0;
  let realtimeBeatriceContext = null;
  let realtimeBeatriceOutput = null;
  let realtimeBeatriceDecodeAudio = null;
  let realtimeBeatriceAudioListener = null;
  let realtimeBeatriceErrorListener = null;
  let realtimeBeatriceCaptureReader = null;
  let realtimeBeatriceCaptureTask = null;
  let realtimeBeatriceCaptureFrames = [];
  let realtimeBeatriceCaptureSamples = 0;
  let realtimeBeatriceCaptureOffset = 0;
  let realtimeBeatricePlaybackFrames = [];
  let realtimeBeatricePlaybackSamples = 0;
  let realtimeBeatriceNextPlaybackTime = 0;
  let realtimeBeatriceCaptionReady = false;
  let realtimeBeatricePendingCaption = "";
  const realtimeBeatricePlaybackSources = new Set();
  const realtimeBeatriceLevelTimers = new Set();
  let realtimeBeatricePlaybackFlushTimer = 0;
  let realtimeStream;
  let recordedSpeechStream;
  let recordedSpeechRecorder;
  let recordedSpeechChunks = [];
  let recordedSpeechProvider = "openai";
  let vadActive = false;
  let vadStream = null;
  let vadContext = null;
  let vadAnalyser = null;
  let vadSource = null;
  let vadProcessor = null;
  let vadEngine = "energy";
  let vadSileroDetected = false;
  let vadSileroSegmentComplete = false;
  let vadSileroQueue = Promise.resolve();
  let vadFrame = 0;
  let vadRecorder = null;
  let vadHeaderChunk = null;
  let vadChunks = [];
  let vadPreRoll = [];
  let vadProvider = "sherpa-onnx";
  let vadSpeaking = false;
  let vadProcessing = false;
  let vadResumeAt = 0;
  let vadNoiseFloor = .006;
  let vadLoudSince = 0;
  let vadSilentSince = 0;
  let vadSpeechStartedAt = 0;
  let realtimeUnavailable = false;
  let voiceInputTransitioning = false;
  let lastStreamPulseAt = 0;
  let workActivityTimer;
  let workActivityElapsedTimer;
  let artifactActionTimer;
  let workActivityStartedAt = 0;
  let workActivityMessage = "";
  let streamWorkMode = false;
  let streamHasActivity = false;
  let hideTimer;
  let bubbleHideDuration = 9000;
  let bubblePersistent = false;
  let workHistoryState = { activeWorkRunId: null, runs: [] };
  let chatHistoryState = [];
  let workPanelCloseTimer;
  let permissionTimer;
  let ttsAudio = null;
  let ttsPlaybackToken = 0;
  let ttsPulse = null;
  let ttsAudioContext = null;
  let ttsAudioAnalyser = null;
  let ttsAudioSource = null;
  let ttsAudioFrame = null;
  let ttsAudioSamples = null;
  let ttsAudioGraphConnected = false;
  let ttsEnvelope = 0;
  let ttsDynamicPeak = .022;
  let ttsNoiseFloor = .0015;
  let ttsEnvelopeSampleAt = 0;
  let ttsBusy = false;
  let generatedTtsFailedProvider = "";
  let generatedTtsRetryAfter = 0;
  let generatedTtsFailureMessage = "";
  let generatedTtsFailureShownAt = 0;
  const activeTtsStreamIds = new Set();
  let streamTtsQueue = [];
  let streamTtsQueueSignal = null;
  let streamTtsDraining = false;
  let streamTtsFinished = false;
  let streamTtsConfig = { enabled: false, provider: "system", language: "ja-JP" };
  let streamFullText = "";
  let streamCurrentSpeechText = "";
  let thinkingFillerActive = false;
  let detachedRealtimeWorkBusy = false;
  let detachedRealtimeWorkRunId = "";

  const normalizeDisplayText = (value) => String(value ?? "")
    .normalize("NFC")
    // Realtime transcripts can occasionally include an unsupported CJK
    // ideographic variation selector after an otherwise normal kanji. The
    // bundled Noto Sans JP contains the base glyph (for example 隠), while the
    // orphan selector is rendered as a tofu box on Windows.
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "");

  const renderRealtimeCaption = (value, { force = false } = {}) => {
    const caption = normalizeDisplayText(value);
    if (!caption) return;
    streamFullText = caption;
    if (realtimeBeatriceContext && !realtimeBeatriceCaptionReady && !force) {
      // Beatrice adds a conversion buffer after the Realtime transcript.
      // Hold the compact caption until converted playback actually starts so
      // the character does not appear to finish the sentence before speaking.
      realtimeBeatricePendingCaption = caption;
      bubblePersistent = true;
      bubble.classList.add("is-visible");
      return;
    }
    realtimeBeatricePendingCaption = "";
    streamCurrentSpeechText = caption;
    bubbleText.textContent = caption;
    bubblePersistent = true;
    bubble.classList.add("is-visible");
    syncBubbleOverflow();
  };

  const releaseRealtimeBeatriceCaption = () => {
    if (!realtimeBeatricePendingCaption) return;
    renderRealtimeCaption(realtimeBeatricePendingCaption, { force: true });
  };

  const applyInterfaceLanguage = (language) => {
    document.documentElement.dataset.uiLanguage = language === "en" ? "en" : "ja";
    window.CharaDockI18n?.setLanguage(language);
  };

  const formatWorkTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  };
  const workStatusLabel = (status) => ({
    running: "作業中", stopping: "中断中", completed: "完了", interrupted: "中断", failed: "エラー",
  }[status] || status);
  const setWorkPanelOpen = (open) => {
    clearTimeout(workPanelCloseTimer);
    workPanel.classList.toggle("is-open", Boolean(open));
    document.body.classList.toggle("is-work-panel-open", Boolean(open));
    workPanel.setAttribute("aria-hidden", String(!open));
    workHistoryButton.setAttribute("aria-expanded", String(Boolean(open)));
    if (open) workPanelCloseTimer = setTimeout(() => setWorkPanelOpen(false), 18_000);
  };
  const scheduleWorkPanelClose = (duration = 900) => {
    clearTimeout(workPanelCloseTimer);
    workPanelCloseTimer = setTimeout(() => setWorkPanelOpen(false), duration);
  };
  const renderArtifactActions = (container, artifacts, runId) => {
    container.replaceChildren();
    const entries = Array.isArray(artifacts) ? artifacts : [];
    container.hidden = !entries.length || !runId;
    if (container.hidden) return;
    for (const artifact of entries) {
      const button = document.createElement("button");
      button.type = "button";
      const icon = document.createElement("span");
      icon.className = `ui-symbol ${artifact.kind === "directory" ? "ui-symbol-folder" : "ui-symbol-document"}`;
      icon.setAttribute("aria-hidden", "true");
      button.append(icon, document.createTextNode(artifact.name || artifact.path));
      button.title = artifact.path;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await ipcRenderer.invoke("mascotInline:previewWorkArtifact", { runId, path: artifact.path }); }
        catch (error) { setStatus(error.message, 5000); }
        finally { button.disabled = false; }
      });
      container.appendChild(button);
    }
  };
  const clearBubbleArtifactActions = () => {
    clearTimeout(artifactActionTimer);
    artifactActionTimer = null;
    renderArtifactActions(artifactActions, [], "");
  };
  const scheduleBubbleArtifactActionsClear = () => {
    clearTimeout(artifactActionTimer);
    artifactActionTimer = artifactActions.hidden
      ? null
      : setTimeout(clearBubbleArtifactActions, 20_000);
  };
  const renderWorkHistory = (payload = workHistoryState) => {
    historyTitle.textContent = "Work履歴";
    workHistoryState = payload && Array.isArray(payload.runs) ? payload : { activeWorkRunId: null, runs: [] };
    workHistoryList.replaceChildren();
    workPanelSummary.textContent = workHistoryState.activeWorkRunId ? "作業を実行しています" : `${workHistoryState.runs.length}件を保持`;
    workHistoryButton.classList.toggle("has-active-work", Boolean(workHistoryState.activeWorkRunId));
    if (!workHistoryState.runs.length) {
      const empty = document.createElement("p");
      empty.className = "desktop-mascot-work-empty";
      empty.textContent = "まだ作業履歴はありません";
      workHistoryList.appendChild(empty);
      return;
    }
    for (const run of workHistoryState.runs) {
      const item = document.createElement("article");
      item.className = `desktop-mascot-work-run is-${run.status}`;
      const head = document.createElement("div");
      head.className = "desktop-mascot-work-run-head";
      const status = document.createElement("span");
      status.className = "desktop-mascot-work-status";
      status.textContent = workStatusLabel(run.status);
      const meta = document.createElement("span");
      meta.className = "desktop-mascot-work-meta";
      meta.textContent = [formatWorkTime(run.startedAt), run.workDirectoryName, run.characterName].filter(Boolean).join(" · ");
      head.append(status, meta);
      const request = document.createElement("p");
      request.className = "desktop-mascot-work-request";
      request.textContent = run.request || "作業内容なし";
      item.append(head, request);
      if (Array.isArray(run.activities) && run.activities.length) {
        const latest = document.createElement("p");
        latest.className = "desktop-mascot-work-latest";
        latest.textContent = run.activities.at(-1);
        item.appendChild(latest);
        if (run.activities.length > 1) {
          const details = document.createElement("details");
          details.className = "desktop-mascot-work-history-details";
          const summary = document.createElement("summary");
          summary.textContent = `進捗履歴（${run.activities.length}件）`;
          const activities = document.createElement("ul");
          activities.className = "desktop-mascot-work-activities";
          for (const activity of run.activities) {
            const row = document.createElement("li");
            row.textContent = activity;
            activities.appendChild(row);
          }
          details.append(summary, activities);
          item.appendChild(details);
        }
      }
      if (run.result) {
        const result = document.createElement("p");
        result.className = "desktop-mascot-work-result";
        result.textContent = run.result;
        item.appendChild(result);
      }
      if (Array.isArray(run.artifacts) && run.artifacts.length) {
        const actions = document.createElement("div");
        actions.className = "desktop-mascot-work-artifacts";
        renderArtifactActions(actions, run.artifacts, run.id);
        item.appendChild(actions);
      }
      if (["running", "stopping"].includes(run.status) && run.id === workHistoryState.activeWorkRunId) {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "desktop-mascot-work-stop";
        stop.disabled = run.status === "stopping";
        stop.textContent = run.status === "stopping" ? "中断しています…" : "中断";
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          stop.textContent = "中断しています…";
          try {
            renderWorkHistory(await ipcRenderer.invoke("mascotInline:interruptWork"));
          } catch (error) {
            setStatus(error.message, 5000);
            stop.disabled = false;
            stop.textContent = "中断";
          }
        });
        item.appendChild(stop);
      }
      workHistoryList.appendChild(item);
    }
  };

  const renderConversationHistory = (payload = chatHistoryState) => {
    chatHistoryState = Array.isArray(payload) ? payload : [];
    historyTitle.textContent = "Chat履歴";
    workPanelSummary.textContent = `${Math.floor(chatHistoryState.length / 2)}往復を保持`;
    workHistoryList.replaceChildren();
    if (!chatHistoryState.length) {
      const empty = document.createElement("p");
      empty.className = "desktop-mascot-work-empty";
      empty.textContent = "このキャラクターとの会話はまだありません";
      workHistoryList.appendChild(empty);
      return;
    }
    for (const entry of chatHistoryState) {
      const item = document.createElement("article");
      item.className = `desktop-mascot-work-run is-chat-${entry.role}`;
      const head = document.createElement("div");
      head.className = "desktop-mascot-work-run-head";
      const role = document.createElement("span");
      role.className = "desktop-mascot-work-status";
      role.textContent = entry.role === "assistant" ? "キャラクター" : "あなた";
      const time = document.createElement("span");
      time.className = "desktop-mascot-work-meta";
      time.textContent = formatWorkTime(entry.createdAt);
      head.append(role, time);
      const text = document.createElement("p");
      text.className = "desktop-mascot-work-request";
      text.textContent = String(entry.text || "");
      item.append(head, text);
      workHistoryList.appendChild(item);
    }
  };

  const resizeInput = () => {
    const maxHeight = document.body.classList.contains("is-work-mode") ? 78 : 68;
    input.style.height = "0px";
    const height = Math.max(document.body.classList.contains("is-work-mode") ? 42 : 34, Math.min(maxHeight, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
    requestAnimationFrame(() => {
      const composerHeight = Math.ceil(form.getBoundingClientRect().height);
      if (composerHeight > 0) dock.style.setProperty("--mascot-composer-height", `${composerHeight}px`);
    });
  };

  const uiText = (japanese, english) => appState?.language === "en" ? english : japanese;
  const cleanIpcErrorMessage = (error) => String(error?.message || error || "")
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .split(/\r?\n/, 1)[0]
    .trim();
  const friendlyTtsErrorMessage = (error) => {
    const detail = cleanIpcErrorMessage(error);
    if (/WebGPU/i.test(detail)) {
      return uiText(
        "この音声ではWebGPUを利用できません。設定の「音声」で別の声を選んでください。",
        "WebGPU is unavailable for this voice. Choose another voice in Voice settings.",
      );
    }
    if (/(?:モデル|model).*(?:ありません|見つかりません|not found|no usable)|ダウンロード|download/i.test(detail)) {
      return uiText(
        "この音声モデルが見つかりません。設定の「音声」から追加するか、別の声を選んでください。",
        "This voice model is unavailable. Add it in Voice settings or choose another voice.",
      );
    }
    if (/fetch failed|接続できません|connection|ECONN|network|timed?\s*out|timeout/i.test(detail)) {
      return uiText(
        "音声合成へ接続できません。設定の「音声」で接続先を確認するか、別の声を選んでください。",
        "Could not connect to speech synthesis. Check the connection in Voice settings or choose another voice.",
      );
    }
    if (/再生|デコード|decode|playback|audio format|音声形式/i.test(detail)) {
      return uiText(
        "音声を再生できませんでした。テキストの回答はそのまま確認できます。",
        "Audio playback failed. The text response is still available.",
      );
    }
    return uiText(
      "音声を生成できませんでした。テキストの回答はそのまま確認できます。",
      "Speech generation failed. The text response is still available.",
    );
  };
  const friendlyInteractionErrorMessage = (error) => {
    const detail = cleanIpcErrorMessage(error);
    if (/ENOENT|No such file or directory|chdir|cwd=|作業先.*(?:ありません|見つかりません)|フォルダー.*(?:ありません|見つかりません)/i.test(detail)) {
      return uiText(
        "作業先フォルダーを開けません。作業先を選び直してください。",
        "The Work folder is unavailable. Choose the Work folder again.",
      );
    }
    if (/\bMCP\b/i.test(detail)) {
      return uiText(
        "選択したMCPへ接続できません。設定の「MCP」で接続を確認してください。",
        "The selected MCP connection is unavailable. Test it in MCP settings.",
      );
    }
    if (/Realtime|\bLive\b/i.test(detail)) {
      return uiText(
        "Liveの処理を続けられませんでした。接続し直すか、通常のChatを利用してください。",
        "Live could not continue. Reconnect or use standard Chat.",
      );
    }
    if (/fetch failed|接続できません|connection|ECONN|network|timed?\s*out|timeout|app-server/i.test(detail)) {
      return uiText(
        "AIへ接続できません。接続を確認して、もう一度試してください。",
        "Could not connect to the AI. Check the connection and try again.",
      );
    }
    const technical = /Error invoking|remote method|(?:^|\s)at\s+\S|[A-Z]:\\|\/home\/|AppData|\.cjs:\d|\.js:\d|CreateProcess|stack/i.test(detail);
    if (detail && !technical && detail.length <= 180) return detail;
    return uiText(
      "処理を完了できませんでした。もう一度試してください。",
      "The request could not be completed. Please try again.",
    );
  };
  const reportGeneratedTtsFailure = (provider, error) => {
    const now = Date.now();
    const message = friendlyTtsErrorMessage(error);
    const shouldShow = message !== generatedTtsFailureMessage || now - generatedTtsFailureShownAt > 4_000;
    generatedTtsFailedProvider = String(provider || "");
    generatedTtsRetryAfter = now + 15_000;
    generatedTtsFailureMessage = message;
    if (shouldShow) {
      generatedTtsFailureShownAt = now;
      setStatus(message, 9000);
    }
  };
  const generatedTtsInCooldown = (provider) => {
    const coolingDown = generatedTtsFailedProvider === String(provider || "") && Date.now() < generatedTtsRetryAfter;
    if (coolingDown && Date.now() - generatedTtsFailureShownAt > 4_000) {
      generatedTtsFailureShownAt = Date.now();
      setStatus(generatedTtsFailureMessage, 7000);
    }
    return coolingDown;
  };
  const clearGeneratedTtsFailure = (provider) => {
    if (generatedTtsFailedProvider !== String(provider || "")) return;
    generatedTtsFailedProvider = "";
    generatedTtsRetryAfter = 0;
    generatedTtsFailureMessage = "";
    generatedTtsFailureShownAt = 0;
  };
  const syncMascotContextVisibility = () => {
    const hasContext = mascotAttachments.length > 0 || mascotSelectedSkillIds.length > 0 || mascotSelectedMcpServerIds.length > 0;
    contextList.hidden = !hasContext;
    form.classList.toggle("has-attachments", hasContext);
    attachButton.classList.toggle("has-attachments", hasContext);
    const label = hasContext
      ? uiText(
        `${mascotAttachments.length}ファイル・${mascotSelectedSkillIds.length} Skills・${mascotSelectedMcpServerIds.length} MCP`,
        `${mascotAttachments.length} files · ${mascotSelectedSkillIds.length} Skills · ${mascotSelectedMcpServerIds.length} MCP`,
      )
      : uiText("ファイルまたは拡張を追加", "Add a file or extension");
    attachButton.setAttribute("aria-label", label);
    attachButton.title = label;
  };
  const renderMascotAttachments = () => {
    attachmentList.replaceChildren();
    for (const attachment of mascotAttachments) {
      const chip = document.createElement("span");
      chip.className = "desktop-mascot-attachment";
      chip.title = attachment.name;
      const icon = document.createElement("span");
      icon.className = "ui-symbol ui-symbol-document";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = attachment.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.attachmentPath = attachment.path;
      remove.setAttribute("aria-label", uiText(`${attachment.name}を外す`, `Remove ${attachment.name}`));
      remove.title = remove.getAttribute("aria-label");
      remove.innerHTML = `<span class="ui-symbol ui-symbol-close" aria-hidden="true"></span>`;
      chip.append(icon, name, remove);
      attachmentList.appendChild(chip);
    }
    syncMascotContextVisibility();
    resizeInput();
  };
  const mergeMascotAttachments = (attachments = []) => {
    const existing = new Set(mascotAttachments.map((item) => item.path.toLocaleLowerCase()));
    let skipped = 0;
    for (const attachment of attachments) {
      const path = String(attachment?.path || "");
      if (!path || existing.has(path.toLocaleLowerCase())) continue;
      if (mascotAttachments.length >= 8) { skipped += 1; continue; }
      mascotAttachments.push({
        path,
        name: String(attachment?.name || path.split(/[\\/]/u).at(-1) || uiText("ファイル", "File")).slice(0, 260),
        size: Math.max(0, Number(attachment?.size) || 0),
      });
      existing.add(path.toLocaleLowerCase());
    }
    renderMascotAttachments();
    if (skipped) setStatus(uiText("添付は最大8件です", "You can attach up to 8 files"), 5000);
  };
  const addMascotFiles = (files) => {
    const candidates = [];
    let rejectedForSize = 0;
    for (const file of Array.from(files || [])) {
      let path = "";
      try { path = webUtils.getPathForFile(file); } catch {}
      if (!path) continue;
      if (Number(file.size) > 100 * 1024 * 1024) { rejectedForSize += 1; continue; }
      candidates.push({ path, name: file.name, size: file.size });
    }
    mergeMascotAttachments(candidates);
    setOpen(true, { focus: true, temporaryInteraction: true });
    if (rejectedForSize) {
      setStatus(uiText("100MBを超えるファイルは添付できません", "Files larger than 100 MB cannot be attached"), 6000);
    } else if (candidates.length) {
      setStatus(uiText(`${candidates.length}件をキャラに渡しました。依頼を入力してください`, `${candidates.length} file(s) handed to the character. Add your request`), 5500);
    }
  };

  const mascotExtensionRecords = (query = "") => {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
    const skills = (appState?.skills?.installed || [])
      .filter((skill) => skill.health !== "missing")
      .filter((skill) => !normalizedQuery || [skill.name, skill.description, skill.sourceName]
        .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery)))
      .map((skill) => ({ ...skill, kind: "skill", pickerKey: `skill:${skill.id}` }));
    const assignments = appState?.mcpAssignments || { all: [], characters: {} };
    const assignedMcpIds = new Set([...(assignments.all || []), ...(assignments.characters?.[appState?.characterId] || [])]);
    const mcpServers = (appState?.mcpServers || [])
      .filter((server) => server.enabled !== false)
      .map((server) => ({
        ...server,
        kind: "mcp",
        pickerKey: `mcp:${server.id}`,
        active: assignedMcpIds.has(server.id),
        unavailable: server.authType === "api-key" && !server.hasApiKey,
        description: server.url,
      }))
      .filter((server) => !normalizedQuery || [server.name, server.url, "mcp", "model context protocol"]
        .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery)));
    return [...skills, ...mcpServers]
      .sort((left, right) => Number(Boolean(right.active)) - Number(Boolean(left.active))
        || String(left.kind).localeCompare(String(right.kind))
        || String(left.name).localeCompare(String(right.name)));
  };
  const renderMascotSelectedSkills = () => {
    const skillRecords = new Map((appState?.skills?.installed || []).map((skill) => [skill.id, skill]));
    const mcpRecords = new Map((appState?.mcpServers || []).map((server) => [server.id, server]));
    mascotSelectedSkillIds = mascotSelectedSkillIds.filter((id) => skillRecords.get(id)?.health !== "missing");
    mascotSelectedMcpServerIds = mascotSelectedMcpServerIds.filter((id) => {
      const server = mcpRecords.get(id);
      return server?.enabled !== false && !(server?.authType === "api-key" && !server?.hasApiKey);
    });
    selectedSkillList.replaceChildren();
    for (const id of mascotSelectedSkillIds) {
      const skill = skillRecords.get(id);
      if (!skill) continue;
      const chip = document.createElement("span");
      chip.className = "desktop-mascot-attachment is-skill";
      const icon = document.createElement("span");
      icon.className = "ui-symbol ui-symbol-sparkle";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = skill.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.skillId = id;
      remove.setAttribute("aria-label", uiText(`${skill.name}を今回の送信から外す`, `Remove ${skill.name} from this turn`));
      remove.innerHTML = '<span class="ui-symbol ui-symbol-close" aria-hidden="true"></span>';
      chip.append(icon, name, remove);
      selectedSkillList.appendChild(chip);
    }
    selectedMcpList.replaceChildren();
    for (const id of mascotSelectedMcpServerIds) {
      const server = mcpRecords.get(id);
      if (!server) continue;
      const chip = document.createElement("span");
      chip.className = "desktop-mascot-attachment is-mcp";
      const icon = document.createElement("span");
      icon.className = "ui-symbol ui-symbol-mcp";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = server.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.mcpServerId = id;
      remove.setAttribute("aria-label", uiText(`${server.name}を今回の送信から外す`, `Remove ${server.name} from this turn`));
      remove.innerHTML = '<span class="ui-symbol ui-symbol-close" aria-hidden="true"></span>';
      chip.append(icon, name, remove);
      selectedMcpList.appendChild(chip);
    }
    syncMascotContextVisibility();
    resizeInput();
  };
  const renderMascotSkillPicker = () => {
    const records = mascotExtensionRecords(skillSearch.value);
    mascotSkillPickerIndex = Math.max(0, Math.min(mascotSkillPickerIndex, Math.max(0, records.length - 1)));
    skillPicker.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.textContent = uiText("該当する拡張がありません", "No matching extensions");
      skillPicker.appendChild(empty);
      return;
    }
    records.forEach((record, index) => {
      const isMcp = record.kind === "mcp";
      const selected = isMcp ? mascotSelectedMcpServerIds.includes(record.id) : mascotSelectedSkillIds.includes(record.id);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.pickerKey = record.pickerKey;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("is-mcp", isMcp);
      button.classList.toggle("is-keyboard-active", index === mascotSkillPickerIndex);
      const icon = document.createElement("span");
      icon.className = `ui-symbol ${isMcp ? "ui-symbol-mcp" : "ui-symbol-sparkle"}`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = record.name;
      const description = document.createElement("small");
      description.textContent = record.description || record.sourceName || uiText("端末に追加済み", "Installed");
      copy.append(name, description);
      const status = document.createElement("em");
      status.textContent = record.unavailable
        ? uiText("要設定", "Setup")
        : !isMcp && realtimePeer && appState?.interactionMode !== "work"
          ? uiText("Live Workのみ", "Live Work only")
          : selected ? uiText("選択中", "Selected") : record.active ? uiText("使用中", "Active") : uiText("今回のみ", "This turn");
      button.disabled = Boolean(record.unavailable);
      button.append(icon, copy, status);
      button.addEventListener("pointermove", () => {
        if (mascotSkillPickerIndex === index) return;
        mascotSkillPickerIndex = index;
        skillPicker.querySelectorAll("button").forEach((candidate, candidateIndex) => candidate.classList.toggle("is-keyboard-active", candidateIndex === index));
      });
      skillPicker.appendChild(button);
    });
  };
  const closeMascotAddPopover = ({ returnFocus = false } = {}) => {
    if (addPopover.hidden) return;
    addPopover.hidden = true;
    attachButton.setAttribute("aria-expanded", "false");
    mascotSkillTrigger = null;
    if (returnFocus) input.focus({ preventScroll: true });
  };
  const openMascotAddPopover = ({ query = "", trigger = null, focusSearch = true } = {}) => {
    mascotSkillTrigger = trigger;
    mascotSkillPickerIndex = 0;
    addPopover.hidden = false;
    attachButton.setAttribute("aria-expanded", "true");
    skillSearch.value = query;
    renderMascotSkillPicker();
    if (focusSearch) requestAnimationFrame(() => skillSearch.focus({ preventScroll: true }));
  };
  const toggleMascotSkill = (skillId) => {
    const removing = mascotSelectedSkillIds.includes(skillId);
    if (!removing && realtimePeer && appState?.interactionMode !== "work") {
      setStatus(uiText("LiveでSkillを指定できるのはWorkモードだけです", "Skills can be selected in Live Work only"), 5000);
      return;
    }
    if (removing) mascotSelectedSkillIds = mascotSelectedSkillIds.filter((id) => id !== skillId);
    else if (mascotSelectedSkillIds.length >= 8) { setStatus(uiText("1回に指定できるSkillは8件までです", "You can select up to 8 Skills per turn"), 5000); return; }
    else mascotSelectedSkillIds.push(skillId);
    if (mascotSkillTrigger) {
      const before = input.value.slice(0, mascotSkillTrigger.start);
      input.value = `${before}${input.value.slice(mascotSkillTrigger.end)}`;
      input.setSelectionRange(before.length, before.length);
      closeMascotAddPopover({ returnFocus: true });
    }
    renderMascotSelectedSkills();
    renderMascotSkillPicker();
    if (realtimePeer && appState?.interactionMode === "work") {
      ipcRenderer.invoke("mascotInline:realtimeTurnSkills", mascotSelectedSkillIds).catch((error) => setStatus(error.message, 5000));
    }
  };
  const toggleMascotMcp = (serverId) => {
    const server = (appState?.mcpServers || []).find((record) => record.id === serverId && record.enabled !== false);
    if (!server) { setStatus(uiText("MCP接続を見つけられません", "MCP connection not found"), 5000); return; }
    if (server.authType === "api-key" && !server.hasApiKey) {
      setStatus(uiText(`「${server.name}」のAPIキーをMCP設定で入力してください`, `Set the API key for “${server.name}” in MCP settings`), 6000);
      return;
    }
    const removing = mascotSelectedMcpServerIds.includes(serverId);
    if (removing) mascotSelectedMcpServerIds = mascotSelectedMcpServerIds.filter((id) => id !== serverId);
    else if (mascotSelectedMcpServerIds.length >= 8) { setStatus(uiText("1回に指定できるMCPは8件までです", "You can select up to 8 MCP connections per turn"), 5000); return; }
    else mascotSelectedMcpServerIds.push(serverId);
    if (mascotSkillTrigger) {
      const before = input.value.slice(0, mascotSkillTrigger.start);
      input.value = `${before}${input.value.slice(mascotSkillTrigger.end)}`;
      input.setSelectionRange(before.length, before.length);
      closeMascotAddPopover({ returnFocus: true });
    }
    renderMascotSelectedSkills();
    renderMascotSkillPicker();
    if (realtimePeer) {
      ipcRenderer.invoke("mascotInline:realtimeTurnMcp", mascotSelectedMcpServerIds).catch((error) => setStatus(error.message, 6000));
    }
  };
  const toggleMascotExtension = (record) => {
    if (!record) return;
    if (record.kind === "mcp") toggleMascotMcp(record.id);
    else toggleMascotSkill(record.id);
  };
  const mascotSkillTriggerAtCursor = () => {
    const cursor = input.selectionStart;
    const before = input.value.slice(0, cursor);
    const match = before.match(/(?:^|[\s\n])([/@])([^\s/@]*)$/u);
    return match ? { start: cursor - match[1].length - match[2].length, end: cursor, query: match[2] } : null;
  };
  const setFileDragActive = (active) => {
    document.body.classList.toggle("is-file-dragging", Boolean(active));
    fileDrop.setAttribute("aria-hidden", String(!active));
  };

  const updateVoiceContext = () => {
    const english = appState?.language === "en";
    const workMode = appState?.interactionMode === "work";
    const liveConfigured = appState?.speechInputProvider === "realtime" && appState?.backend === "codex";
    const live = realtimeSessionState === "live";
    const connecting = realtimeSessionState === "connecting";
    const voiceMode = live ? "LIVE" : connecting ? (english ? "CONNECTING" : "LIVE接続中") : appState?.ttsEnabled ? "TTS" : "TEXT";
    const mode = workMode ? "Work" : "Chat";
    voiceBadge.textContent = `${mode} · ${voiceMode}`;
    voiceBadge.classList.toggle("is-live", live);
    voiceBadge.classList.toggle("is-connecting", connecting);
    voiceBadge.classList.toggle("is-muted", !live && !connecting && !appState?.ttsEnabled);
    voiceBadge.setAttribute("aria-label", english
      ? `${mode} mode, ${live ? "Realtime voice active" : connecting ? "connecting to Realtime voice" : appState?.ttsEnabled ? "standard text to speech active" : "text only"}`
      : `${mode}モード、${live ? "Realtime音声を使用中" : connecting ? "Realtime音声へ接続中" : appState?.ttsEnabled ? "通常TTSを使用中" : "文字のみ"}`);
    bubbleVoiceMode.textContent = voiceMode;
    bubbleVoiceMode.classList.toggle("is-live", live);
    bubbleVoiceMode.classList.toggle("is-connecting", connecting);
    micButton.dataset.liveState = live ? "active" : connecting ? "connecting" : liveConfigured ? "ready" : "off";
    const micLabel = live
      ? (english ? "Stop LIVE voice" : "LIVE音声を終了")
      : connecting
        ? (english ? "Connecting to LIVE voice" : "LIVE音声へ接続中")
        : liveConfigured
          ? (english ? "Start LIVE voice" : "LIVE音声を開始")
          : (english ? "Voice input" : "音声入力");
    micButton.setAttribute("aria-label", micLabel);
    micButton.title = micLabel;
  };

  const applyInteractionMode = (state = {}) => {
    const workMode = state.interactionMode === "work";
    document.body.classList.toggle("is-work-mode", workMode);
    modeButton.textContent = workMode ? "Work" : "Chat";
    modeButton.setAttribute("aria-pressed", String(workMode));
    modeButton.title = workMode ? "Chatへ戻す" : "Workへ切り替える";
    workTarget.textContent = `作業先 · ${state.workDirectoryName || "未選択"}`;
    workTarget.title = workTarget.textContent;
    workOpenButton.disabled = !state.hasWorkDirectory || sending;
    input.placeholder = workMode ? "このフォルダーでやること…" : "短く話しかける…";
    workHistoryButton.setAttribute("aria-label", workMode ? "Work履歴を開く" : "Chat履歴を開く");
    workHistoryButton.title = workMode ? "Work履歴を開く" : "Chat履歴を開く";
    workPanel.querySelector("#desktopMascotWorkPanelClose").setAttribute("aria-label", workMode ? "Work履歴を閉じる" : "Chat履歴を閉じる");
    if (workPanel.classList.contains("is-open")) {
      if (workMode) renderWorkHistory(workHistoryState);
      else renderConversationHistory(chatHistoryState);
    }
    updateVoiceContext();
    resizeInput();
  };

  const applyCharacter = (character) => {
    document.documentElement.dataset.character = character?.id || "amber-avatar";
    bubbleCharacterName.textContent = character?.name || "キャラクター";
    const ui = character?.ui || {};
    const root = document.documentElement.style;
    const percent = (name, value, fallback) => root.setProperty(name, `${Number(value) || fallback}%`);
    percent("--mascot-bubble-left", ui.bubbleLeft, 18);
    percent("--mascot-bubble-top", ui.bubbleTop, 24);
    percent("--mascot-bubble-width", ui.bubbleWidth, 68);
    percent("--mascot-pet-left", ui.petLeft, 0);
    percent("--mascot-pet-top", ui.petTop, 27);
    percent("--mascot-pet-width", ui.petWidth, 56);
    percent("--mascot-pet-height", ui.petHeight, 42);
  };
  const applyWindowSettings = (settings = {}) => {
    appState = {
      ...appState,
      positionLocked: settings.positionLocked ?? appState?.positionLocked,
      mascotPointerMode: settings.mascotPointerMode || appState?.mascotPointerMode || "interactive",
    };
    document.body.classList.toggle("is-position-locked", Boolean(appState.positionLocked) || appState.mascotPointerMode === "click-through");
    document.body.dataset.pointerMode = appState.mascotPointerMode;
  };
  const applyPointerState = (state = {}) => {
    appState = { ...appState, mascotPointerMode: state.mode || appState?.mascotPointerMode || "interactive" };
    document.body.dataset.pointerMode = appState.mascotPointerMode;
    document.body.classList.toggle("is-position-locked", Boolean(appState.positionLocked) || appState.mascotPointerMode === "click-through");
    document.body.classList.toggle("is-pointer-auto-hidden", Boolean(state.autoHidden));
  };

  const setStatus = (message, duration = 2600) => {
    clearTimeout(statusTimer);
    hint.textContent = normalizeDisplayText(message);
    const errorTone = /(?:error|failed|failure|unavailable|not found|cannot|could not|エラー|失敗|できません|見つかりません|ありません|開始できない|利用できない)/i.test(hint.textContent);
    dock.dataset.statusTone = errorTone ? "error" : "info";
    hint.setAttribute("role", errorTone ? "alert" : "status");
    hint.setAttribute("aria-live", errorTone ? "assertive" : "polite");
    dock.classList.toggle("is-status", Boolean(hint.textContent));
    statusTimer = setTimeout(() => dock.classList.remove("is-status"), duration);
  };
  const clearAutoSendCountdown = () => {
    clearTimeout(autoSendCountdownTimer);
    autoSendCountdownTimer = null;
    autoSendCountdownCommand = "";
    autoSendCountdownEndsAt = 0;
    autoSendCountdown.hidden = true;
    dock.classList.remove("has-send-countdown");
  };
  const submitRecognizedText = (command) => {
    if (sending || input.value.trim() !== command) return clearAutoSendCountdown();
    clearAutoSendCountdown();
    form.requestSubmit();
  };
  const beginAutoSendCountdown = (command) => {
    clearAutoSendCountdown();
    if (appState?.voiceAutoSend === false) return;
    if (appState?.voiceAutoSendCountdown === false) {
      autoSendCountdownCommand = command;
      autoSendCountdownTimer = setTimeout(() => submitRecognizedText(command), 420);
      return;
    }
    const delayMs = Math.min(5000, Math.max(600, Number(appState?.voiceAutoSendDelayMs) || 1500));
    autoSendCountdownCommand = command;
    autoSendCountdownEndsAt = performance.now() + delayMs;
    autoSendCountdown.hidden = false;
    dock.classList.add("has-send-countdown");
    const tick = () => {
      if (input.value.trim() !== command || sending) return clearAutoSendCountdown();
      const remaining = Math.max(0, autoSendCountdownEndsAt - performance.now());
      if (remaining <= 0) return submitRecognizedText(command);
      autoSendCountdownLabel.textContent = `${(remaining / 1000).toFixed(1)}秒後に送信`;
      autoSendCountdownTimer = setTimeout(tick, Math.min(100, remaining));
    };
    tick();
  };
  const setSendingControls = (busy) => {
    if (busy) clearAutoSendCountdown();
    sending = Boolean(busy);
    sendButton.disabled = false;
    sendButton.hidden = false;
    sendButton.setAttribute("aria-label", sending ? "フォローアップを差し込む" : "送信");
    sendButton.title = sending ? "フォローアップを差し込む" : "送信";
    sendButton.classList.toggle("is-follow-up", sending);
    stopButton.hidden = !sending;
    stopButton.disabled = false;
    modeButton.disabled = sending;
    workTarget.disabled = sending;
    workOpenButton.disabled = sending || !appState?.hasWorkDirectory;
  };
  const elapsedActivityLabel = () => {
    const seconds = Math.max(0, Math.floor((performance.now() - workActivityStartedAt) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const paintWorkActivity = () => {
    workActivity.textContent = workActivityMessage && workActivityStartedAt
      ? `${workActivityMessage} · ${elapsedActivityLabel()}`
      : workActivityMessage;
  };
  const setWorkActivity = (message, { finish = false, trackElapsed = false } = {}) => {
    clearTimeout(workActivityTimer);
    clearInterval(workActivityElapsedTimer);
    workActivityElapsedTimer = null;
    workActivityMessage = String(message || "");
    if (trackElapsed && !workActivityStartedAt) workActivityStartedAt = performance.now();
    if (!workActivityMessage || finish) workActivityStartedAt = 0;
    paintWorkActivity();
    bubble.classList.toggle("is-working", Boolean(workActivityMessage));
    bubble.classList.toggle("is-processing", Boolean(workActivityMessage) && !finish);
    if (workActivityMessage && workActivityStartedAt) {
      workActivityElapsedTimer = setInterval(paintWorkActivity, 1000);
    }
    if (finish) workActivityTimer = setTimeout(() => {
      bubble.classList.remove("is-working", "is-processing");
      workActivityMessage = "";
      workActivity.textContent = "";
    }, 2200);
  };
  const setOpen = (open, { focus = false, temporaryInteraction = false } = {}) => {
    clearTimeout(autoCloseTimer);
    dock.classList.toggle("is-open", Boolean(open));
    if (!open) {
      addPopover.hidden = true;
      attachButton.setAttribute("aria-expanded", "false");
      mascotSkillTrigger = null;
    }
    if (open && temporaryInteraction && !temporaryInteractionHold) {
      temporaryInteractionHold = true;
      ipcRenderer.invoke("mascotInline:interactionHold", true).catch(() => {});
    } else if (!open && temporaryInteractionHold) {
      temporaryInteractionHold = false;
      ipcRenderer.invoke("mascotInline:interactionHold", false).catch(() => {});
    }
    if (open) resizeInput();
    if (open && focus) input.focus({ preventScroll: true });
  };
  attachmentList.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-attachment-path]");
    if (!remove) return;
    mascotAttachments = mascotAttachments.filter((item) => item.path !== remove.dataset.attachmentPath);
    renderMascotAttachments();
    input.focus({ preventScroll: true });
  });
  selectedSkillList.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-skill-id]");
    if (!remove) return;
    toggleMascotSkill(remove.dataset.skillId);
    input.focus({ preventScroll: true });
  });
  selectedMcpList.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-mcp-server-id]");
    if (!remove) return;
    toggleMascotMcp(remove.dataset.mcpServerId);
    input.focus({ preventScroll: true });
  });
  attachButton.addEventListener("click", () => {
    if (addPopover.hidden) openMascotAddPopover();
    else closeMascotAddPopover({ returnFocus: true });
  });
  dock.querySelector("#desktopMascotAddFile").addEventListener("click", () => {
    closeMascotAddPopover();
    fileInput.click();
  });
  dock.querySelector("#desktopMascotManageSkills").addEventListener("click", () => {
    closeMascotAddPopover();
    ipcRenderer.invoke("mascotInline:openControl", { page: "skills" });
  });
  dock.querySelector("#desktopMascotManageMcp").addEventListener("click", () => {
    closeMascotAddPopover();
    ipcRenderer.invoke("mascotInline:openControl", { page: "mcp" });
  });
  skillPicker.addEventListener("click", (event) => {
    const option = event.target.closest("button[data-picker-key]");
    if (!option) return;
    toggleMascotExtension(mascotExtensionRecords(skillSearch.value).find((record) => record.pickerKey === option.dataset.pickerKey));
  });
  skillSearch.addEventListener("input", () => { mascotSkillPickerIndex = 0; renderMascotSkillPicker(); });
  skillSearch.addEventListener("keydown", (event) => {
    const records = mascotExtensionRecords(skillSearch.value);
    if (event.key === "Escape") { event.preventDefault(); closeMascotAddPopover({ returnFocus: true }); return; }
    if (["ArrowDown", "ArrowUp"].includes(event.key) && records.length) {
      event.preventDefault();
      mascotSkillPickerIndex = (mascotSkillPickerIndex + (event.key === "ArrowDown" ? 1 : -1) + records.length) % records.length;
      renderMascotSkillPicker();
      return;
    }
    if (event.key === "Enter" && records[mascotSkillPickerIndex]) { event.preventDefault(); toggleMascotExtension(records[mascotSkillPickerIndex]); }
  });
  fileInput.addEventListener("change", () => {
    addMascotFiles(fileInput.files);
    fileInput.value = "";
  });
  document.addEventListener("dragenter", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    fileDragDepth += 1;
    setFileDragActive(true);
  });
  document.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFileDragActive(true);
  });
  document.addEventListener("dragleave", (event) => {
    if (!fileDragDepth) return;
    event.preventDefault();
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) setFileDragActive(false);
  });
  document.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length && !fileDragDepth) return;
    event.preventDefault();
    fileDragDepth = 0;
    setFileDragActive(false);
    addMascotFiles(event.dataTransfer?.files);
  });
  const scheduleBubbleHide = (duration = bubbleHideDuration) => {
    clearTimeout(hideTimer);
    if (bubblePersistent) return;
    hideTimer = setTimeout(() => {
      bubble.classList.remove("is-visible", "is-expanded");
      bubbleMore.setAttribute("aria-expanded", "false");
      bubbleMore.textContent = "全文";
    }, Math.max(1500, Number(duration) || 9000));
  };
  const clearPermission = () => {
    clearTimeout(permissionTimer);
    permissionActions.hidden = true;
    permissionActions.dataset.requestId = "";
    permissionActions.dataset.permissionType = "";
    bubble.classList.remove("is-permission");
  };
  const isGeneratedTtsProvider = (provider) => ["style-bert-vits2", "piper-plus", "supertonic-3", "irodori-webgpu", "kokoro", "sbv2-jp-extra"].includes(provider);
  const showPermission = (result) => {
    clearTimeout(hideTimer);
    stopTtsPlayback();
    bubblePersistent = false;
    const permissionType = String(result?.permissionRequest?.type || "");
    const question = normalizeDisplayText(result?.text || "今回だけ許可してもいい？");
    streamFullText = question;
    streamCurrentSpeechText = "";
    bubbleText.textContent = question;
    permissionActions.dataset.requestId = String(result?.permissionRequest?.id || "");
    permissionActions.dataset.permissionType = permissionType;
    permissionActions.querySelector('[data-permission-action="approve"]').textContent = permissionType === "screen"
      ? "今回だけ見る"
      : permissionType === "computer" ? "操作を許可" : "ブラウザを許可";
    permissionActions.hidden = false;
    bubble.classList.remove("is-expanded", "has-overflow", "has-full-reply");
    bubble.classList.add("is-visible", "is-permission");
    bubbleMore.hidden = true;
    permissionTimer = setTimeout(() => {
      clearPermission();
      scheduleBubbleHide(1800);
    }, Math.max(10_000, Number(result?.permissionRequest?.expiresInMs) || 60_000));
    if (appState?.ttsEnabled && question) {
      if (isGeneratedTtsProvider(appState.ttsProvider)) playGeneratedSpeech(question, appState.ttsProvider);
      else speakSystemText(question, appState.speechLanguage || "ja-JP");
    }
  };
  const syncBubbleOverflow = () => {
    const measure = () => {
      let overflow = bubbleText.scrollHeight > bubbleText.clientHeight + 2;
      const conservativelyLong = bubbleText.textContent.length > 120 || bubbleText.textContent.split("\n").length > 4;
      if (!overflow && conservativelyLong) {
        const probe = bubbleText.cloneNode(true);
        Object.assign(probe.style, {
          position: "fixed",
          left: "-10000px",
          top: "0",
          display: "block",
          width: `${bubbleText.clientWidth}px`,
          maxHeight: "none",
          overflow: "visible",
          WebkitLineClamp: "unset",
          visibility: "hidden",
        });
        document.body.appendChild(probe);
        overflow = probe.scrollHeight > bubbleText.clientHeight + 2;
        probe.remove();
      }
      overflow ||= conservativelyLong;
      const hasFullReply = Boolean(streamCurrentSpeechText && streamFullText && streamCurrentSpeechText !== streamFullText);
      bubble.classList.toggle("has-overflow", overflow);
      bubble.classList.toggle("has-full-reply", hasFullReply);
      bubbleMore.hidden = !(overflow || hasFullReply);
    };
    measure();
    requestAnimationFrame(measure);
  };
  bubbleMore.addEventListener("click", () => {
    const expanded = !bubble.classList.contains("is-expanded");
    bubble.classList.toggle("is-expanded", expanded);
    bubbleMore.setAttribute("aria-expanded", String(expanded));
    bubbleMore.textContent = expanded ? "閉じる" : "全文";
    if (expanded) {
      if (streamFullText) bubbleText.textContent = normalizeDisplayText(streamFullText);
      clearTimeout(hideTimer);
    } else {
      bubbleText.textContent = normalizeDisplayText(streamCurrentSpeechText || streamFullText || bubbleText.textContent);
      scheduleBubbleHide(Math.max(9000, bubbleHideDuration));
    }
    syncBubbleOverflow();
  });
  const scheduleAutoClose = () => {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      if (!sending && document.activeElement !== input && !speechRecognition && !vadActive) setOpen(false);
    }, 720);
  };
  const stopTtsPlayback = () => {
    ttsPlaybackToken += 1;
    for (const streamId of activeTtsStreamIds) ipcRenderer.invoke("mascotInline:cancelTtsStream", streamId).catch(() => {});
    activeTtsStreamIds.clear();
    thinkingFillerActive = false;
    streamTtsQueue = [];
    streamTtsQueueSignal?.();
    streamTtsQueueSignal = null;
    streamTtsDraining = false;
    streamTtsFinished = false;
    ttsBusy = false;
    bubble.classList.remove("is-speaking");
    window.speechSynthesis?.cancel();
    if (ttsAudio) {
      ttsAudio.pause();
      ttsAudio.src = "";
      ttsAudio = null;
    }
    clearInterval(ttsPulse);
    ttsPulse = null;
    cancelAnimationFrame(ttsAudioFrame);
    ttsAudioFrame = null;
    try { ttsAudioSource?.disconnect(); } catch {}
    ttsAudioSource = null;
    ttsEnvelope = 0;
    ttsDynamicPeak = .022;
    ttsNoiseFloor = .0015;
    ttsEnvelopeSampleAt = 0;
    ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
  };
  const stopTtsPulse = () => {
    clearInterval(ttsPulse);
    ttsPulse = null;
    cancelAnimationFrame(ttsAudioFrame);
    ttsAudioFrame = null;
    ttsEnvelope = 0;
    ttsDynamicPeak = .022;
    ttsNoiseFloor = .0015;
    ttsEnvelopeSampleAt = 0;
    ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
  };
  const adaptiveTtsLevel = (rawRms, now) => {
    const rms = Math.max(0, Math.min(1, Number(rawRms) || 0));
    const elapsedMs = ttsEnvelopeSampleAt ? Math.max(8, Math.min(100, now - ttsEnvelopeSampleAt)) : 16;
    ttsEnvelopeSampleAt = now;
    const frameScale = elapsedMs / 16.667;
    ttsDynamicPeak = Math.max(rms, ttsDynamicPeak * Math.pow(.988, frameScale), .018);
    if (rms < Math.max(.008, ttsNoiseFloor * 2.2)) {
      ttsNoiseFloor += (rms - ttsNoiseFloor) * (1 - Math.pow(.985, frameScale));
    }
    ttsNoiseFloor = Math.max(.0004, Math.min(.006, ttsNoiseFloor));
    const gate = Math.max(.0024, ttsNoiseFloor * 1.75);
    const ceiling = Math.max(gate + .012, ttsDynamicPeak * .76);
    const normalized = Math.max(0, Math.min(1, (rms - gate) / (ceiling - gate)));
    const target = Math.pow(normalized, .72) * .5;
    const baseFollow = target > ttsEnvelope ? .58 : .24;
    const follow = 1 - Math.pow(1 - baseFollow, frameScale);
    ttsEnvelope += (target - ttsEnvelope) * follow;
    if (normalized === 0 && ttsEnvelope < .018) ttsEnvelope = 0;
    return Math.max(0, Math.min(.5, ttsEnvelope));
  };
  const textLipLevel = (text, index, tick) => {
    const value = String(text || "");
    if (!value) return 0;
    const character = value[Math.max(0, Math.min(value.length - 1, index))] || "";
    if (/[\s、。！？!?.,]/.test(character)) return 0;
    const vowelBias = /[あかさたなはまやらわがざだばぱアカサタナハマヤラワガザダバパ]/.test(character) ? .18
      : /[いきしちにひみりぎじぢびぴイキシチニヒミリギジヂビピ]/.test(character) ? -.08
        : .04;
    const rhythm = [.1, .3, .18, .44, .24, .36][tick % 6];
    return Math.max(.06, Math.min(.48, rhythm + vowelBias * .55));
  };
  const startTextTtsPulse = (text, indexProvider = () => 0) => {
    stopTtsPulse();
    let tick = 0;
    ttsPulse = setInterval(() => {
      const index = Number(indexProvider()) || 0;
      ipcRenderer.invoke("mascotInline:voice", textLipLevel(text, index, tick++)).catch(() => {});
    }, 82);
  };
  const startMeasuredTtsPulse = async (audio, fallbackText) => {
    stopTtsPulse();
    try {
      ttsAudioContext ||= new AudioContext();
      ttsAudioAnalyser ||= ttsAudioContext.createAnalyser();
      ttsAudioAnalyser.fftSize = 1024;
      ttsAudioAnalyser.smoothingTimeConstant = .1;
      ttsAudioSamples ||= new Float32Array(ttsAudioAnalyser.fftSize);
      try { ttsAudioSource?.disconnect(); } catch {}
      ttsAudioSource = ttsAudioContext.createMediaElementSource(audio);
      ttsAudioSource.connect(ttsAudioAnalyser);
      if (!ttsAudioGraphConnected) {
        ttsAudioAnalyser.connect(ttsAudioContext.destination);
        ttsAudioGraphConnected = true;
      }
      await ttsAudioContext.resume();
      let lastSentAt = 0;
      const update = (now) => {
        if (audio !== ttsAudio || audio.paused || audio.ended) return;
        ttsAudioAnalyser.getFloatTimeDomainData(ttsAudioSamples);
        let sum = 0;
        for (const sample of ttsAudioSamples) sum += sample * sample;
        const rms = Math.sqrt(sum / ttsAudioSamples.length);
        const level = adaptiveTtsLevel(rms, now);
        if (now - lastSentAt >= 32) {
          lastSentAt = now;
          ipcRenderer.invoke("mascotInline:voice", level).catch(() => {});
        }
        ttsAudioFrame = requestAnimationFrame(update);
      };
      ttsAudioFrame = requestAnimationFrame(update);
    } catch {
      const startedAt = performance.now();
      startTextTtsPulse(fallbackText, () => Math.floor((performance.now() - startedAt) / 140));
    }
  };
  const setTtsBusy = (busy) => {
    ttsBusy = Boolean(busy);
    bubble.classList.toggle("is-speaking", ttsBusy);
  };
  const playAudioSource = (source, text, token, onStart, playbackRate = 1) => new Promise((resolve, reject) => {
    if (token !== ttsPlaybackToken) return resolve();
    ttsAudio = new Audio(source);
    ttsAudio.preload = "auto";
    ttsAudio.muted = false;
    ttsAudio.volume = 1;
    ttsAudio.playbackRate = Math.min(2, Math.max(.5, Number(playbackRate) || 1));
    ttsAudio.preservesPitch = true;
    ttsAudio.onplay = () => {
      onStart?.();
      startMeasuredTtsPulse(ttsAudio, text);
    };
    ttsAudio.onended = () => {
      stopTtsPulse();
      try { ttsAudioSource?.disconnect(); } catch {}
      ttsAudioSource = null;
      ttsAudio = null;
      resolve();
    };
    ttsAudio.onerror = () => {
      stopTtsPulse();
      const detail = ({ 1: "再生が中断されました", 2: "音声データを読み込めません", 3: "音声形式をデコードできません", 4: "音声形式に対応していません" })[ttsAudio?.error?.code];
      reject(new Error(`生成した音声を再生できません${detail ? `（${detail}）` : ""}。`));
    };
    ttsAudio.play().catch(reject);
  });
  const speakSystemSegment = (text, language, token, onStart) => new Promise((resolve) => {
    if (!window.speechSynthesis || token !== ttsPlaybackToken) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = String(language || "ja-JP");
    utterance.rate = 1.03;
    let boundaryIndex = 0;
    let startedAt = 0;
    utterance.onstart = () => {
      onStart?.();
      startedAt = performance.now();
      startTextTtsPulse(text, () => Math.max(boundaryIndex, Math.floor((performance.now() - startedAt) / 140)));
    };
    utterance.onboundary = (event) => { boundaryIndex = Math.max(boundaryIndex, Number(event.charIndex) || 0); };
    utterance.onend = () => { stopTtsPulse(); resolve(); };
    utterance.onerror = () => { stopTtsPulse(); resolve(); };
    window.speechSynthesis.speak(utterance);
  });
  const prepareSpeechSegment = async (segment, provider, token) => {
    const text = String(segment?.text || segment || "").trim();
    const hasSpokenText = segment && typeof segment === "object"
      && Object.prototype.hasOwnProperty.call(segment, "spokenText");
    const spokenText = String(hasSpokenText ? segment.spokenText : text).trim();
    if (!text || !spokenText || token !== ttsPlaybackToken) return null;
    if (!isGeneratedTtsProvider(provider)) return { segment, text, spokenText, sources: null, playbackRate: 1 };
    if (generatedTtsInCooldown(provider)) return null;
    let result;
    try {
      result = await ipcRenderer.invoke("mascotInline:synthesizeTts", spokenText);
    } catch (error) {
      reportGeneratedTtsFailure(provider, error);
      return null;
    }
    if (result?.error) {
      reportGeneratedTtsFailure(provider, result.error);
      return null;
    }
    const sources = result?.audioDataUrls || [];
    if (!sources.length) {
      reportGeneratedTtsFailure(provider, new Error("音声合成から音声データが返されませんでした。"));
      return null;
    }
    clearGeneratedTtsFailure(provider);
    const streamId = String(result?.streamId || "");
    if (token !== ttsPlaybackToken) {
      if (streamId) ipcRenderer.invoke("mascotInline:cancelTtsStream", streamId).catch(() => {});
      return null;
    }
    if (streamId) activeTtsStreamIds.add(streamId);
    return { segment, text, spokenText, sources, playbackRate: result?.playbackRate, streamId };
  };
  const prepareQueuedSpeechSegment = (segment, provider, token) => prepareSpeechSegment(segment, provider, token)
    .then((prepared) => ({ prepared }), (error) => ({ error }));
  const playPreparedSpeechSegment = async (prepared, provider, language, token) => {
    if (!prepared || token !== ttsPlaybackToken) return;
    const { segment, text, spokenText, sources, playbackRate } = prepared;
    let streamId = String(prepared.streamId || "");
    let activated = false;
    const activate = () => {
      if (activated) return;
      activated = true;
      streamCurrentSpeechText = text;
      if (!bubble.classList.contains("is-expanded")) bubbleText.textContent = normalizeDisplayText(text);
      syncBubbleOverflow();
      if (segment?.expression) ipcRenderer.invoke("mascotInline:expression", segment.expression).catch(() => {});
    };
    if (isGeneratedTtsProvider(provider)) {
      let chunkSources = sources;
      try {
        while (chunkSources.length) {
          const nextPromise = streamId ? ipcRenderer.invoke("mascotInline:nextTtsChunk", streamId) : null;
          for (const source of chunkSources) {
            if (token !== ttsPlaybackToken) return;
            await playAudioSource(source, spokenText, token, activate, playbackRate);
          }
          if (!nextPromise || token !== ttsPlaybackToken) break;
          const next = await nextPromise;
          chunkSources = next?.audioDataUrl ? [next.audioDataUrl] : [];
          if (next?.done) {
            activeTtsStreamIds.delete(streamId);
            streamId = "";
          }
        }
      } finally {
        if (streamId) {
          activeTtsStreamIds.delete(streamId);
          ipcRenderer.invoke("mascotInline:cancelTtsStream", streamId).catch(() => {});
        }
      }
      return;
    }
    await speakSystemSegment(spokenText, language, token, activate);
  };
  const playSpeechSegment = async (segment, provider, language, token) => {
    const prepared = await prepareSpeechSegment(segment, provider, token);
    await playPreparedSpeechSegment(prepared, provider, language, token);
  };
  const finishTtsPlayback = () => {
    stopTtsPulse();
    ttsAudio = null;
    setTtsBusy(false);
    if (vadActive) vadResumeAt = performance.now() + 650;
    if (streamTtsFinished && !streamTtsQueue.length) {
      streamCurrentSpeechText = "";
      if (!bubble.classList.contains("is-expanded") && streamFullText) bubbleText.textContent = normalizeDisplayText(streamFullText);
      ipcRenderer.invoke("mascotInline:expression", { emotion: null, forceMouth: null, forceEyesClosed: null, durationMs: 100 }).catch(() => {});
      syncBubbleOverflow();
    }
  };
  const drainStreamTtsQueue = async () => {
    if (thinkingFillerActive || streamTtsDraining || !streamTtsConfig.enabled || !streamTtsQueue.length) return;
    const token = ttsPlaybackToken;
    streamTtsDraining = true;
    setTtsBusy(true);
    try {
      let preparedPromise = null;
      while (token === ttsPlaybackToken && (preparedPromise || streamTtsQueue.length)) {
        preparedPromise ||= prepareQueuedSpeechSegment(streamTtsQueue.shift(), streamTtsConfig.provider, token);
        const preparedResult = await preparedPromise;
        preparedPromise = null;
        if (preparedResult.error) throw preparedResult.error;
        const { prepared } = preparedResult;
        if (!prepared || token !== ttsPlaybackToken) continue;

        let playbackDone = false;
        const playback = playPreparedSpeechSegment(prepared, streamTtsConfig.provider, streamTtsConfig.language, token)
          .finally(() => {
            playbackDone = true;
            streamTtsQueueSignal?.();
            streamTtsQueueSignal = null;
          });

        // Keep at most one synthesis ahead. This overlaps GPU inference with
        // playback without launching concurrent Irodori sessions or retaining
        // a long answer's worth of WAV data in memory.
        while (token === ttsPlaybackToken && !playbackDone && !preparedPromise && !prepared.streamId) {
          if (streamTtsQueue.length) {
            preparedPromise = prepareQueuedSpeechSegment(streamTtsQueue.shift(), streamTtsConfig.provider, token);
            break;
          }
          await new Promise((resolve) => { streamTtsQueueSignal = resolve; });
        }
        await playback;
      }
    } catch (error) {
      if (token === ttsPlaybackToken) {
        streamTtsQueue = [];
        if (isGeneratedTtsProvider(streamTtsConfig.provider)) reportGeneratedTtsFailure(streamTtsConfig.provider, error);
        else setStatus(friendlyTtsErrorMessage(error), 7000);
      }
    } finally {
      if (token === ttsPlaybackToken) {
        streamTtsDraining = false;
        finishTtsPlayback();
        if (streamTtsQueue.length) drainStreamTtsQueue();
        else if (streamTtsFinished) scheduleBubbleHide(Math.max(9000, bubbleHideDuration));
      }
    }
  };
  const queueStreamSpeech = (segments) => {
    if (!streamTtsConfig.enabled) return;
    for (const segment of Array.isArray(segments) ? segments : []) {
      const text = String(segment?.text || segment || "").trim();
      if (text) {
        streamTtsQueue.push(typeof segment === "object" ? { ...segment, text } : { text });
      }
    }
    streamTtsQueueSignal?.();
    streamTtsQueueSignal = null;
    drainStreamTtsQueue();
  };
  const playStandaloneSpeech = async (text, provider, language, expression = null, spokenText = text) => {
    const token = ttsPlaybackToken;
    setTtsBusy(true);
    try {
      await playSpeechSegment({ text, spokenText, expression }, provider, language, token);
    } catch (error) {
      if (token === ttsPlaybackToken) {
        if (isGeneratedTtsProvider(provider)) reportGeneratedTtsFailure(provider, error);
        else setStatus(friendlyTtsErrorMessage(error), 7000);
      }
    } finally {
      if (token === ttsPlaybackToken) finishTtsPlayback();
    }
  };
  const playGeneratedSpeech = (text, provider, expression, spokenText) => playStandaloneSpeech(text, provider, "ja-JP", expression, spokenText);
  const speakSystemText = (text, language, expression, spokenText) => playStandaloneSpeech(text, "system", language, expression, spokenText);
  const showSpeech = (payload) => {
    clearPermission();
    clearBubbleArtifactActions();
    clearTimeout(hideTimer);
    streamFullText = "";
    streamCurrentSpeechText = "";
    bubbleText.textContent = normalizeDisplayText(payload?.text);
    bubble.classList.remove("is-expanded", "has-overflow", "has-full-reply");
    bubbleMore.hidden = true;
    bubbleMore.textContent = "全文";
    bubbleMore.setAttribute("aria-expanded", "false");
    bubble.classList.toggle("is-visible", Boolean(bubbleText.textContent));
    bubbleHideDuration = Math.max(1500, Number(payload?.durationMs) || 9000);
    bubblePersistent = Boolean(payload?.persistent);
    syncBubbleOverflow();
    scheduleBubbleHide(bubbleHideDuration);
    stopTtsPlayback();
    thinkingFillerActive = false;
    if (payload?.ttsEnabled && bubbleText.textContent && isGeneratedTtsProvider(payload?.ttsProvider)) {
      playGeneratedSpeech(bubbleText.textContent, payload.ttsProvider, payload?.expression, payload?.spokenText);
    } else if (payload?.ttsEnabled && bubbleText.textContent && window.speechSynthesis) {
      speakSystemText(bubbleText.textContent, payload.speechLanguage, payload?.expression, payload?.spokenText);
    }
  };

  const chatButton = dock.querySelector("#desktopMascotChatButton");
  chatButton.addEventListener("pointerenter", () => setOpen(true, { temporaryInteraction: appState?.mascotPointerMode === "auto-hide" }));
  chatButton.addEventListener("click", () => setOpen(true, { focus: true, temporaryInteraction: appState?.mascotPointerMode === "auto-hide" }));
  dock.addEventListener("pointerenter", () => clearTimeout(autoCloseTimer));
  dock.addEventListener("pointerleave", scheduleAutoClose);
  dock.querySelector("#desktopMascotSettingsButton").addEventListener("click", () => ipcRenderer.invoke("mascotInline:openControl"));
  workHistoryButton.addEventListener("click", async () => {
    const open = !workPanel.classList.contains("is-open");
    setWorkPanelOpen(open);
    if (open && appState?.interactionMode === "work") renderWorkHistory(await ipcRenderer.invoke("mascotInline:getWorkHistory").catch(() => workHistoryState));
    else if (open) renderConversationHistory(await ipcRenderer.invoke("mascotInline:getConversationHistory").catch(() => chatHistoryState));
  });
  workPanel.querySelector("#desktopMascotWorkPanelClose").addEventListener("click", () => setWorkPanelOpen(false));
  workPanel.addEventListener("pointerenter", () => clearTimeout(workPanelCloseTimer));
  workPanel.addEventListener("pointerleave", () => scheduleWorkPanelClose());
  document.addEventListener("pointerdown", (event) => {
    if (workPanel.classList.contains("is-open") && !workPanel.contains(event.target) && !workHistoryButton.contains(event.target)) {
      setWorkPanelOpen(false);
    }
    if (!addPopover.hidden && !addPopover.contains(event.target) && !attachButton.contains(event.target)) closeMascotAddPopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && workPanel.classList.contains("is-open")) setWorkPanelOpen(false);
  });
  permissionActions.addEventListener("click", async (event) => {
    const action = event.target.closest("button")?.dataset?.permissionAction;
    const requestId = permissionActions.dataset.requestId;
    const permissionType = permissionActions.dataset.permissionType;
    if (!action || !requestId || !["screen", "browser", "computer"].includes(permissionType) || sending) return;
    const isScreen = permissionType === "screen";
    const isComputer = permissionType === "computer";
    sending = true;
    sendButton.disabled = true;
    modeButton.disabled = true;
    workTarget.disabled = true;
    setStatus(action === "approve"
      ? isScreen ? "画面を1枚だけ取得しています…" : isComputer ? "コンピューター操作を準備しています…" : "専用ブラウザを準備しています…"
      : "許可を取り消しています…", 30_000);
    try {
      const channel = action === "approve"
        ? isScreen ? "mascotInline:approveScreenShare" : isComputer ? "mascotInline:approveComputerUse" : "mascotInline:approveBrowserUse"
        : isScreen ? "mascotInline:declineScreenShare" : isComputer ? "mascotInline:declineComputerUse" : "mascotInline:declineBrowserUse";
      const result = await ipcRenderer.invoke(
        channel,
        requestId,
      );
      clearPermission();
      if (!result.streamed) showSpeech({
        text: result.text,
        durationMs: 9000,
        ttsEnabled: Boolean(appState?.ttsEnabled),
        ttsProvider: appState?.ttsProvider || "system",
        speechLanguage: appState?.speechLanguage || "ja-JP",
      });
      setStatus(action === "approve"
        ? isScreen ? "画面を確認しました" : isComputer ? "コンピューター操作が完了しました" : "ブラウザ確認が完了しました"
        : isScreen ? "画面は共有されませんでした" : isComputer ? "コンピューターは操作されませんでした" : "ブラウザは開かれませんでした");
    } catch (error) {
      clearPermission();
      const actionLabel = isScreen ? "画面を共有できませんでした" : isComputer ? "コンピューターを操作できませんでした" : "ブラウザを利用できませんでした";
      setStatus(`${actionLabel} · ${friendlyInteractionErrorMessage(error)}`, 9000);
    } finally {
      sendButton.disabled = false;
      modeButton.disabled = false;
      workTarget.disabled = false;
      sending = false;
      input.focus();
    }
  });
  input.addEventListener("keydown", (event) => {
    if (mascotSkillTrigger && !addPopover.hidden) {
      const records = mascotExtensionRecords(mascotSkillTrigger.query);
      if (event.key === "Escape") { event.preventDefault(); closeMascotAddPopover(); return; }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && records.length) {
        event.preventDefault();
        mascotSkillPickerIndex = (mascotSkillPickerIndex + (event.key === "ArrowDown" ? 1 : -1) + records.length) % records.length;
        renderMascotSkillPicker();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && records[mascotSkillPickerIndex]) {
        event.preventDefault();
        toggleMascotExtension(records[mascotSkillPickerIndex]);
        return;
      }
    }
    if (event.key === "Escape") { event.preventDefault(); closeMascotAddPopover(); input.blur(); setOpen(false); }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener("input", () => {
    if (autoSendCountdownCommand && input.value.trim() !== autoSendCountdownCommand) clearAutoSendCountdown();
    const trigger = mascotSkillTriggerAtCursor();
    if (trigger) openMascotAddPopover({ query: trigger.query, trigger, focusSearch: false });
    else if (mascotSkillTrigger) closeMascotAddPopover();
    resizeInput();
  });
  autoSendCountdown.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset?.countdownAction;
    if (action === "send" && autoSendCountdownCommand) submitRecognizedText(autoSendCountdownCommand);
    if (action === "cancel") {
      clearAutoSendCountdown();
      input.focus({ preventScroll: true });
      input.select();
      setStatus("自動送信を取り消しました。内容を編集できます", 4200);
    }
  });
  const sendMascotMessage = async (message, attachments = [], selectedSkillIds = [], selectedMcpServerIds = [], deliveryOptions = {}) => {
    setSendingControls(true);
    const useActiveRealtime = Boolean(realtimePeer);
    let streamOwnsBusyState = false;
    setStatus(useActiveRealtime ? "Live音声で応答を生成…" : appState?.interactionMode === "work" ? "作業を開始…" : "考え中…", 30_000);
    try {
      if (useActiveRealtime) {
        setRealtimeOutputSuppressed(false);
        const route = await ipcRenderer.invoke("mascotInline:realtimeAppendText", { text: message, selectedSkillIds, selectedMcpServerIds });
        const accepted = typeof route === "object" ? Boolean(route?.accepted) : Boolean(route);
        if (!accepted) throw new Error("Liveセッションへ文字を送信できませんでした。");
        streamOwnsBusyState = appState?.interactionMode === "work" && Boolean(route?.delegated);
        detachedRealtimeWorkBusy = streamOwnsBusyState;
        setStatus(appState?.interactionMode === "work" ? "作業を進めています…" : "考えています…", 5000);
        return;
      }
      const result = await ipcRenderer.invoke("mascotInline:chat", {
        message,
        attachmentPaths: attachments.map((item) => item.path),
        selectedSkillIds,
        selectedMcpServerIds,
        suppressPcAudio: Boolean(deliveryOptions.suppressPcAudio),
        forceWork: Boolean(deliveryOptions.forceWork),
      });
      if (["screen", "browser", "computer"].includes(result.permissionRequest?.type)) {
        showPermission(result);
        setStatus("「いいよ」「やめて」と話しても選べます", 9000);
      } else if (!result.streamed) {
        showSpeech({
          text: result.text,
          durationMs: 9000,
          ttsEnabled: Boolean(appState?.ttsEnabled),
          ttsProvider: appState?.ttsProvider || "system",
          speechLanguage: appState?.speechLanguage || "ja-JP",
        });
      }
      if (!["screen", "browser", "computer"].includes(result.permissionRequest?.type)) {
        setStatus(result.permissionDeclined
          ? result.permissionType === "browser" ? "ブラウザは開かれませんでした" : result.permissionType === "computer" ? "コンピューターは操作されませんでした" : "画面は共有されませんでした"
          : result.mode === "work" ? `${result.workDirectoryName || "選択フォルダー"}で作業完了` : result.provider === "codex" ? "Codexから返答" : "OpenAIから返答");
      }
    } catch (error) {
      const interrupted = /interrupt|cancel|abort|中断/i.test(String(error.message || ""));
      if (!interrupted) {
        input.value = message;
        resizeInput();
      }
      if (attachments.length) mergeMascotAttachments(attachments);
      if (selectedSkillIds.length) {
        mascotSelectedSkillIds = [...new Set([...mascotSelectedSkillIds, ...selectedSkillIds])];
      }
      if (selectedMcpServerIds.length) mascotSelectedMcpServerIds = [...new Set([...mascotSelectedMcpServerIds, ...selectedMcpServerIds])];
      if (selectedSkillIds.length || selectedMcpServerIds.length) renderMascotSelectedSkills();
      setStatus(interrupted
        ? appState?.interactionMode === "work" ? "作業を中断しました。履歴から内容を確認できます" : "応答を中断しました。続けて修正を送れます"
        : friendlyInteractionErrorMessage(error), 9000);
    } finally {
      if (!streamOwnsBusyState) {
        setSendingControls(false);
        input.focus();
        const followUp = pendingFollowUp;
        pendingFollowUp = null;
        if (followUp) queueMicrotask(() => sendMascotMessage(followUp.message, followUp.attachments, followUp.selectedSkillIds, followUp.selectedMcpServerIds));
      }
    }
  };
  const finishDetachedRealtimeWork = (workRunId = "") => {
    if (!detachedRealtimeWorkBusy) return;
    const expectedRunId = String(workRunId || "");
    if (expectedRunId && (!detachedRealtimeWorkRunId || expectedRunId !== detachedRealtimeWorkRunId)) return;
    detachedRealtimeWorkBusy = false;
    detachedRealtimeWorkRunId = "";
    setSendingControls(false);
    input.focus();
    const followUp = pendingFollowUp;
    pendingFollowUp = null;
    if (followUp) queueMicrotask(() => sendMascotMessage(followUp.message, followUp.attachments, followUp.selectedSkillIds, followUp.selectedMcpServerIds));
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const attachments = mascotAttachments.slice();
    const selectedSkillIds = [...mascotSelectedSkillIds];
    const selectedMcpServerIds = [...mascotSelectedMcpServerIds];
    const message = input.value.trim() || (attachments.length
      ? uiText("添付したファイルを確認してください。", "Please review the attached files.")
      : "");
    if (!message) return;
    clearBubbleArtifactActions();
    if (realtimeSessionState === "connecting") {
      setStatus("Liveへの接続が完了してから送信してください", 5000);
      return;
    }
    const shouldAutoStartLive = !realtimePeer
      && appState?.backend === "codex"
      && appState?.speechInputProvider === "realtime"
      && appState?.realtimeAutoStartOnText !== false;
    if (shouldAutoStartLive) {
      if (attachments.length) {
        setStatus(uiText("ファイル添付を外すか、Liveの「テキスト送信で開始」をOFFにしてください", "Remove the attachment or turn off “Start when sending text” for Live"), 7000);
        return;
      }
      if (selectedSkillIds.length && appState?.interactionMode !== "work") {
        setStatus(uiText("Skillを指定したLive送信はWorkで利用してください", "Use Work to send selected Skills through Live"), 7000);
        return;
      }
      if (realtimeUnavailable) {
        setStatus(uiText("Liveを開始できません。設定を確認してください", "Live cannot start. Check the settings"), 6000);
        return;
      }
      setStatus(uiText("マイクを有効にしてLiveへ接続しています…", "Enabling the microphone and connecting to Live…"), 30_000);
      try {
        await startRealtime();
      } catch (error) {
        ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
        closeRealtime();
        realtimeUnavailable ||= /まだ提供されていません/.test(error.message);
        setStatus(uiText(`Liveを開始できません: ${error.message}`, `Could not start Live: ${error.message}`), 7000);
        return;
      }
    }
    if (realtimePeer && attachments.length) {
      setStatus(uiText("ファイル添付はLiveを停止してから送信してください", "Stop Live before sending file attachments"), 6000);
      return;
    }
    if (realtimePeer && selectedSkillIds.length && appState?.interactionMode !== "work") {
      setStatus(uiText("Skillを指定できるのはLive Workだけです", "Selected Skills are available in Live Work only"), 6000);
      return;
    }
    clearAutoSendCountdown();
    input.value = "";
    mascotAttachments = [];
    mascotSelectedSkillIds = [];
    mascotSelectedMcpServerIds = [];
    renderMascotAttachments();
    renderMascotSelectedSkills();
    closeMascotAddPopover();
    resizeInput();
    const liveWorkFollowUp = sending && Boolean(realtimePeer) && appState?.interactionMode === "work";
    if (liveWorkFollowUp) {
      setRealtimeOutputSuppressed(false);
      setStatus(uiText("追加の指示を同じ作業へ反映しています…", "Applying the follow-up to the current Work…"), 7000);
      try {
        const route = await ipcRenderer.invoke("mascotInline:realtimeAppendText", { text: message, selectedSkillIds, selectedMcpServerIds });
        const accepted = typeof route === "object" ? Boolean(route?.accepted) : Boolean(route);
        if (!accepted) throw new Error(uiText("実行中のWorkへ追加できませんでした。", "The follow-up could not be added to the current Work."));
      } catch (error) {
        input.value = message;
        mergeMascotAttachments(attachments);
        mascotSelectedSkillIds = [...new Set([...mascotSelectedSkillIds, ...selectedSkillIds])];
        mascotSelectedMcpServerIds = [...new Set([...mascotSelectedMcpServerIds, ...selectedMcpServerIds])];
        renderMascotSelectedSkills();
        resizeInput();
        setStatus(error.message, 5000);
      }
      input.focus();
      return;
    }
    if (sending) {
      try {
        const route = await ipcRenderer.invoke("mascotInline:followUp", {
          message,
          attachmentPaths: attachments.map((item) => item.path),
          selectedSkillIds,
          selectedMcpServerIds,
        });
        if (route?.accepted) {
          setStatus(route.mode === "work"
            ? uiText("追加の指示を同じ作業へ反映しています…", "Applying the follow-up to the current Work…")
            : uiText("追加の指示を同じ会話へ反映しています…", "Applying the follow-up to the current conversation…"), 7000);
          input.focus();
          return;
        }
        if (!route?.retryAsNewTurn) throw new Error(uiText("追加入力を反映できませんでした。", "The follow-up could not be applied."));
        pendingFollowUp = { message, attachments, selectedSkillIds, selectedMcpServerIds };
        stopTtsPlayback();
        stopButton.disabled = true;
        setStatus(uiText("この接続では差し込みに対応していないため、現在の応答を止めています…", "This connection cannot steer an active response, so the current response is being stopped…"), 30_000);
        await ipcRenderer.invoke("mascotInline:interruptActive");
      } catch (error) {
        pendingFollowUp = null;
        input.value = message;
        mergeMascotAttachments(attachments);
        mascotSelectedSkillIds = [...new Set([...mascotSelectedSkillIds, ...selectedSkillIds])];
        mascotSelectedMcpServerIds = [...new Set([...mascotSelectedMcpServerIds, ...selectedMcpServerIds])];
        renderMascotSelectedSkills();
        resizeInput();
        stopButton.disabled = false;
        setStatus(error.message, 5000);
      }
      return;
    }
    await sendMascotMessage(message, attachments, selectedSkillIds, selectedMcpServerIds);
  });

  stopButton.addEventListener("click", async () => {
    if (!sending || stopButton.disabled) return;
    pendingFollowUp = null;
    stopTtsPlayback();
    stopButton.disabled = true;
    setStatus("中断しています…", 30_000);
    try {
      await ipcRenderer.invoke("mascotInline:interruptActive");
    } catch (error) {
      stopButton.disabled = false;
      setStatus(error.message, 5000);
    }
  });

  modeButton.addEventListener("click", async () => {
    try {
      const next = appState?.interactionMode === "work" ? "chat" : "work";
      appState = await ipcRenderer.invoke("mascotInline:setMode", next);
      applyInteractionMode(appState);
      setStatus(appState.interactionMode === "work" ? `作業先: ${appState.workDirectoryName}` : "Chat");
      input.focus();
    } catch (error) {
      setStatus(error.message, 5000);
    }
  });
  workTarget.addEventListener("click", async () => {
    try {
      appState = await ipcRenderer.invoke("mascotInline:chooseWorkDirectory");
      applyInteractionMode(appState);
      setStatus(appState.workDirectoryName ? `作業先: ${appState.workDirectoryName}` : "作業先は変更されませんでした");
      input.focus();
    } catch (error) {
      setStatus(error.message, 5000);
    }
  });
  workOpenButton.addEventListener("click", async () => {
    try {
      await ipcRenderer.invoke("mascotInline:openWorkDirectory");
      setStatus(`作業先を開きました: ${appState?.workDirectoryName || ""}`);
      input.focus();
    } catch (error) {
      setStatus(error.message, 5000);
    }
  });

  const stage = document.querySelector("#stage");
  let hoverSentAt = 0;
  let hoverState = false;
  const reportHover = (hovered) => {
    const now = performance.now();
    if (hovered === hoverState && (!hovered || now - hoverSentAt < 180)) return;
    hoverState = hovered;
    hoverSentAt = now;
    ipcRenderer.invoke("mascotInline:hover", hovered).catch(() => {});
  };
  // Track the whole transparent app window. Listening only on the canvas made
  // hover turn off as soon as the pointer crossed into the pet/chat overlays.
  window.addEventListener("pointerenter", () => reportHover(true), true);
  window.addEventListener("pointermove", () => reportHover(true), true);
  window.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) reportHover(false);
  }, true);
  window.addEventListener("blur", () => reportHover(false));
  let petDrag = null;
  let suppressPetClickUntil = 0;
  const showTouchSpark = (event) => {
    const spark = document.createElement("span");
    spark.className = `desktop-mascot-touch-spark spark-${Math.floor(Math.random() * 3)}`;
    spark.textContent = ["✦", "♡", "·"][Math.floor(Math.random() * 3)];
    spark.style.left = `${event.clientX}px`;
    spark.style.top = `${event.clientY}px`;
    document.body.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove(), { once: true });
  };
  const finishPetDrag = (event) => {
    if (!petDrag || petDrag.pointerId !== event.pointerId) return;
    const dragged = petDrag.dragged;
    petDrag = null;
    document.body.classList.remove("is-mascot-window-dragging");
    petZone.releasePointerCapture?.(event.pointerId);
    ipcRenderer.invoke("mascotInline:drag", "end").catch(() => {});
    if (dragged) suppressPetClickUntil = performance.now() + 350;
  };
  petZone.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    setWorkPanelOpen(false);
    petDrag = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      dragged: false,
    };
    petZone.setPointerCapture?.(event.pointerId);
    ipcRenderer.invoke("mascotInline:drag", "start").catch(() => {});
  });
  petZone.addEventListener("pointermove", (event) => {
    if (!petDrag || petDrag.pointerId !== event.pointerId) return;
    if (!petDrag.dragged && Math.hypot(event.screenX - petDrag.screenX, event.screenY - petDrag.screenY) < 8) return;
    petDrag.dragged = true;
    document.body.classList.add("is-mascot-window-dragging");
    ipcRenderer.invoke("mascotInline:drag", "move").catch(() => {});
  });
  petZone.addEventListener("pointerup", finishPetDrag);
  petZone.addEventListener("pointercancel", finishPetDrag);
  petZone.addEventListener("pointerenter", () => setOpen(true));
  petZone.addEventListener("pointerleave", scheduleAutoClose);
  petZone.addEventListener("click", async (event) => {
    if (performance.now() < suppressPetClickUntil) return;
    showTouchSpark(event);
    const petBounds = petZone.getBoundingClientRect();
    const yRatio = petBounds.height > 0
      ? Math.max(0, Math.min(1, (event.clientY - petBounds.top) / petBounds.height))
      : .5;
    const responseSpeaking = ttsBusy || streamTtsDraining || thinkingFillerActive || Boolean(ttsAudio);
    if (sending || responseSpeaking) {
      // Touch remains physically responsive while a turn is running, but it
      // must not start a competing character reply. Focus the composer so the
      // user's next words can be steered into the active turn.
      ipcRenderer.invoke("mascotInline:pet", { yRatio, reactionOnly: true }).catch(() => {});
      if (responseSpeaking) {
        stopTtsPlayback();
        setStatus(uiText("読み上げを止めたよ。続けて話してね", "I stopped speaking. Go ahead"), 3200);
      } else if (sending) {
        setStatus(uiText("続けて話してね。今の返答に差し込めるよ", "Go ahead. Your follow-up will be added to this turn"), 4200);
      }
      setOpen(true);
      input.focus({ preventScroll: true });
      return;
    }
    try {
      const shouldAutoStartLive = !realtimePeer
        && appState?.backend === "codex"
        && appState?.speechInputProvider === "realtime"
        && appState?.realtimeAutoStartOnPet === true;
      if (realtimeSessionState === "connecting") {
        setStatus("Liveへの接続が完了してから、もう一度タップしてください", 5000);
        return;
      }
      if (shouldAutoStartLive) {
        if (realtimeUnavailable) {
          setStatus("Liveを開始できません。設定を確認してください", 6000);
          return;
        }
        setStatus("マイクを有効にしてLiveへ接続しています…", 30_000);
        try {
          await startRealtime();
        } catch (error) {
          ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
          closeRealtime();
          realtimeUnavailable ||= /まだ提供されていません/.test(error.message);
          setStatus(`Liveを開始できません: ${error.message}`, 7000);
          return;
        }
      }
      const result = await ipcRenderer.invoke("mascotInline:pet", { yRatio });
      if (!result?.deferDisplayToRealtime) showSpeech(result);
      if (result?.realtimeSpeechError) setStatus(`Realtime音声: ${result.realtimeSpeechError}`, 5000);
    } catch (error) {
      setStatus(`クリック反応: ${error.message}`, 5000);
    }
  });
  const startFallbackRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("音声入力は詳細画面で利用できます");
      ipcRenderer.invoke("mascotInline:openControl");
      return false;
    }
    if (speechRecognition) { speechRecognition.stop(); return true; }
    speechRecognition = new Recognition();
    speechRecognition.lang = "ja-JP";
    speechRecognition.interimResults = true;
    speechRecognition.onresult = (event) => {
      input.value = [...event.results].map((result) => result[0]?.transcript || "").join("");
      resizeInput();
    };
    speechRecognition.onend = () => { speechRecognition = null; micButton.setAttribute("aria-pressed", "false"); input.focus(); };
    speechRecognition.onerror = (event) => setStatus(`音声入力: ${event.error}`);
    speechRecognition.start();
    micButton.setAttribute("aria-pressed", "true");
    setStatus("話してください…", 30_000);
    return true;
  };
  const ensureFallbackRecognition = () => speechRecognition ? true : startFallbackRecognition();

  const decodeRecordedAudio = async (blob) => {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const samples = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const values = decoded.getChannelData(channel);
        for (let index = 0; index < values.length; index += 1) samples[index] += values[index] / decoded.numberOfChannels;
      }
      return { samples, sampleRate: Math.round(decoded.sampleRate) };
    } finally {
      await context.close().catch(() => {});
    }
  };

  const transcribeWithSherpaOnnx = async (blob) => {
    const { samples, sampleRate } = await decodeRecordedAudio(blob);
    if (!samples.length) throw new Error("録音された音声が空です");
    if (samples.byteLength > 60 * 1024 * 1024) throw new Error("録音が長すぎます。短く区切ってください");
    return ipcRenderer.invoke("mascotInline:transcribeSherpa", { samples, sampleRate });
  };

  const transcribeRecordedBlob = async (blob, provider) => {
    if (provider === "sherpa-onnx") return transcribeWithSherpaOnnx(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return ipcRenderer.invoke("mascotInline:transcribe", { bytes, mimeType: blob.type });
  };

  const setVadUi = (phase) => {
    const active = phase !== "off";
    micButton.setAttribute("aria-pressed", String(active));
    micButton.classList.toggle("is-vad-waiting", phase === "waiting");
    micButton.classList.toggle("is-vad-speaking", phase === "speaking");
    micButton.classList.toggle("is-vad-processing", phase === "processing");
    micButton.setAttribute("aria-label", active ? "音声待機を停止" : "音声入力");
    micButton.title = phase === "speaking" ? "音声を認識しています" : phase === "processing" ? "文字起こし中" : active ? "音声待機を停止" : "音声入力";
  };

  const cleanupVadMedia = () => {
    cancelAnimationFrame(vadFrame);
    vadFrame = 0;
    if (vadRecorder?.state === "recording") vadRecorder.stop();
    vadRecorder = null;
    vadHeaderChunk = null;
    vadChunks = [];
    vadPreRoll = [];
    try { vadProcessor?.disconnect?.(); } catch {}
    try { vadSource?.disconnect?.(); } catch {}
    vadProcessor = null;
    vadSource = null;
    if (vadEngine === "silero") ipcRenderer.invoke("mascotInline:vadStop").catch(() => {});
    vadEngine = "energy";
    vadSileroDetected = false;
    vadSileroSegmentComplete = false;
    for (const track of vadStream?.getTracks?.() || []) track.stop();
    vadStream = null;
    vadAnalyser = null;
    const context = vadContext;
    vadContext = null;
    context?.close?.().catch(() => {});
    vadSpeaking = false;
    vadLoudSince = 0;
    vadSilentSince = 0;
    vadResumeAt = 0;
    setVadUi("off");
  };

  const waitingVoiceStatus = () => "音声待機中…そのまま話してください";

  const processVadTranscript = async (blob, provider) => {
    vadProcessing = true;
    setVadUi("processing");
    try {
      setStatus(provider === "sherpa-onnx" ? "sherpa-onnxで認識中…" : "OpenAIで文字起こし中…", 30_000);
      const transcript = String(await transcribeRecordedBlob(blob, provider) || "").trim();
      if (!transcript) {
        setStatus(waitingVoiceStatus(), 30_000);
        return;
      }
      const command = transcript;
      input.value = command;
      resizeInput();
      setOpen(true, { focus: true });
      setStatus(`認識: ${command}`, 5000);
      beginAutoSendCountdown(command);
    } catch (error) {
      setStatus(error.message, 5000);
    } finally {
      vadProcessing = false;
      if (vadActive) {
        vadResumeAt = performance.now() + Math.max(700, autoSendCountdownEndsAt ? autoSendCountdownEndsAt - performance.now() + 250 : 0);
        vadPreRoll = [];
        vadLoudSince = 0;
        vadSilentSince = 0;
        setVadUi("waiting");
        if (!input.value.trim()) setStatus(waitingVoiceStatus(), 30_000);
      } else {
        cleanupVadMedia();
      }
    }
  };

  const finishVadUtterance = () => {
    if (!vadSpeaking) return;
    vadSpeaking = false;
    setVadUi("processing");
    const chunks = vadChunks;
    vadChunks = [];
    const blob = new Blob(chunks, { type: vadRecorder?.mimeType || "audio/webm" });
    if (blob.size > 512) processVadTranscript(blob, vadProvider);
    else if (vadActive) {
      setVadUi("waiting");
      setStatus(waitingVoiceStatus(), 30_000);
    } else if (!vadProcessing) cleanupVadMedia();
  };

  const beginVadUtterance = () => {
    if (!vadActive || vadProcessing || vadSpeaking || vadRecorder?.state !== "recording") return;
    vadChunks = vadPreRoll.splice(0);
    if (vadHeaderChunk && vadChunks[0] !== vadHeaderChunk) vadChunks.unshift(vadHeaderChunk);
    vadSpeaking = true;
    vadSpeechStartedAt = performance.now();
    vadSilentSince = 0;
    setVadUi("speaking");
    setStatus("聞いています…話し終えると自動で認識します", 30_000);
  };

  const runVadFrame = () => {
    if (!vadActive || !vadAnalyser) return;
    const samples = new Float32Array(vadAnalyser.fftSize);
    vadAnalyser.getFloatTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length);
    const now = performance.now();
    const paused = sending || ttsBusy || vadProcessing || now < vadResumeAt;
    const profile = vadProfile(appState?.vadSensitivity);
    if (vadEngine === "silero" && !paused) {
      if (!vadSpeaking && vadSileroDetected) beginVadUtterance();
      if (vadSpeaking && vadSileroSegmentComplete) {
        vadSileroSegmentComplete = false;
        finishVadUtterance();
      }
    } else if (vadEngine !== "silero" && !paused && !vadSpeaking) {
      vadNoiseFloor = Math.min(.04, Math.max(.0035, vadNoiseFloor * .96 + rms * .04));
      const startThreshold = Math.max(profile.startMin, vadNoiseFloor * profile.startFactor);
      if (rms > startThreshold) {
        vadLoudSince ||= now;
        if (now - vadLoudSince >= profile.onsetMs) beginVadUtterance();
      } else {
        vadLoudSince = 0;
      }
    } else if (!paused && vadSpeaking) {
      const stopThreshold = Math.max(profile.stopMin, vadNoiseFloor * profile.stopFactor);
      if (rms < stopThreshold) vadSilentSince ||= now;
      else vadSilentSince = 0;
      if ((vadSilentSince && now - vadSilentSince >= profile.silenceMs && now - vadSpeechStartedAt >= 550)
        || now - vadSpeechStartedAt >= 20_000) finishVadUtterance();
    } else {
      vadLoudSince = 0;
      vadSilentSince = 0;
    }
    vadFrame = requestAnimationFrame(runVadFrame);
  };

  const stopVadListening = () => {
    if (!vadActive && !vadStream) return;
    vadActive = false;
    cancelAnimationFrame(vadFrame);
    vadFrame = 0;
    vadSpeaking = false;
    vadChunks = [];
    vadPreRoll = [];
    if (!vadProcessing) cleanupVadMedia();
    setVadUi("off");
  };

  const startVadListening = async (provider) => {
    if (vadActive) return;
    if (!["sherpa-onnx", "openai"].includes(provider)) throw new Error("この音声入力方式ではVADを利用できません");
    if (provider === "sherpa-onnx" && !appState?.sherpaModel?.installed) {
      throw new Error("設定からsherpa-onnx日本語モデルをダウンロードしてください");
    }
    if (provider === "openai" && !appState?.hasApiKey) throw new Error("OpenAI APIキーを設定してください");
    vadProvider = provider;
    vadStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    vadContext = new AudioContext();
    await vadContext.resume().catch(() => {});
    vadAnalyser = vadContext.createAnalyser();
    vadAnalyser.fftSize = 1024;
    vadAnalyser.smoothingTimeConstant = .2;
    vadSource = vadContext.createMediaStreamSource(vadStream);
    vadSource.connect(vadAnalyser);
    setStatus("Silero VADを準備しています…", 30_000);
    try {
      await ipcRenderer.invoke("mascotInline:vadStart", appState?.vadSensitivity || "normal");
      vadEngine = "silero";
      vadSileroDetected = false;
      vadSileroSegmentComplete = false;
      vadProcessor = vadContext.createScriptProcessor(2048, 1, 1);
      vadProcessor.onaudioprocess = (event) => {
        if (!vadActive || sending || ttsBusy || vadProcessing) return;
        const source = event.inputBuffer.getChannelData(0);
        const ratio = vadContext.sampleRate / 16_000;
        const length = Math.max(1, Math.floor(source.length / ratio));
        const samples = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          const start = Math.floor(index * ratio);
          const end = Math.max(start + 1, Math.min(source.length, Math.floor((index + 1) * ratio)));
          let sum = 0;
          for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += source[sourceIndex];
          samples[index] = sum / (end - start);
        }
        vadSileroQueue = vadSileroQueue.then(async () => {
          if (!vadActive || vadEngine !== "silero") return;
          const result = await ipcRenderer.invoke("mascotInline:vadAccept", samples);
          vadSileroDetected = Boolean(result?.detected);
          if (result?.segmentComplete) vadSileroSegmentComplete = true;
        }).catch(() => {
          vadEngine = "energy";
          vadSileroDetected = false;
          vadSileroSegmentComplete = false;
        });
      };
      vadSource.connect(vadProcessor);
      vadProcessor.connect(vadContext.destination);
    } catch {
      vadEngine = "energy";
      setStatus("Silero VADを準備できないため音量検出を使用します", 5000);
    }
    vadChunks = [];
    vadPreRoll = [];
    vadHeaderChunk = null;
    vadRecorder = new MediaRecorder(vadStream);
    vadRecorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      vadHeaderChunk ||= event.data;
      if (vadSpeaking) {
        vadChunks.push(event.data);
      } else if (!vadProcessing) {
        vadPreRoll.push(event.data);
        if (vadPreRoll.length > 6) vadPreRoll.shift();
      }
    };
    vadRecorder.start(100);
    vadNoiseFloor = .008;
    vadActive = true;
    setVadUi("waiting");
    setStatus(waitingVoiceStatus(), 30_000);
    runVadFrame();
  };

  const toggleRecordedSpeech = async (provider) => {
    if (recordedSpeechRecorder?.state === "recording") {
      recordedSpeechRecorder.stop();
      return;
    }
    recordedSpeechProvider = provider;
    recordedSpeechChunks = [];
    recordedSpeechStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    recordedSpeechRecorder = new MediaRecorder(recordedSpeechStream);
    recordedSpeechRecorder.ondataavailable = (event) => { if (event.data.size) recordedSpeechChunks.push(event.data); };
    recordedSpeechRecorder.onstop = async () => {
      micButton.setAttribute("aria-pressed", "false");
      try {
        setStatus(provider === "sherpa-onnx" ? "sherpa-onnxで認識中…" : "OpenAIで文字起こし中…", 30_000);
        const blob = new Blob(recordedSpeechChunks, { type: recordedSpeechRecorder.mimeType || "audio/webm" });
        input.value = await transcribeRecordedBlob(blob, recordedSpeechProvider);
        resizeInput();
        input.focus();
        setStatus("音声を入力しました");
      } catch (error) {
        setStatus(error.message, 5000);
      } finally {
        for (const track of recordedSpeechStream?.getTracks?.() || []) track.stop();
        recordedSpeechStream = null;
      }
    };
    recordedSpeechRecorder.start();
    micButton.setAttribute("aria-pressed", "true");
    setStatus("録音中…もう一度押すと認識", 30_000);
  };

  const stopRealtimeBeatrice = async () => {
    if (realtimeBeatriceAudioListener) ipcRenderer.removeListener("beatrice:audioOut", realtimeBeatriceAudioListener);
    if (realtimeBeatriceErrorListener) ipcRenderer.removeListener("beatrice:error", realtimeBeatriceErrorListener);
    realtimeBeatriceAudioListener = null;
    realtimeBeatriceErrorListener = null;
    const captureReader = realtimeBeatriceCaptureReader;
    realtimeBeatriceCaptureReader = null;
    try { await captureReader?.cancel(); } catch {}
    realtimeBeatriceCaptureTask = null;
    realtimeBeatriceCaptureFrames = [];
    realtimeBeatriceCaptureSamples = 0;
    realtimeBeatriceCaptureOffset = 0;
    try { realtimeBeatriceOutput?.disconnect(); } catch {}
    try { realtimeBeatriceDecodeAudio?.pause(); } catch {}
    if (realtimeBeatriceDecodeAudio) realtimeBeatriceDecodeAudio.srcObject = null;
    for (const playback of realtimeBeatricePlaybackSources) {
      try { playback.stop(); } catch {}
      try { playback.disconnect(); } catch {}
    }
    realtimeBeatricePlaybackSources.clear();
    for (const timer of realtimeBeatriceLevelTimers) clearTimeout(timer);
    realtimeBeatriceLevelTimers.clear();
    clearTimeout(realtimeBeatricePlaybackFlushTimer);
    realtimeBeatricePlaybackFlushTimer = 0;
    realtimeBeatricePlaybackFrames = [];
    realtimeBeatricePlaybackSamples = 0;
    realtimeBeatriceNextPlaybackTime = 0;
    realtimeBeatriceCaptionReady = false;
    releaseRealtimeBeatriceCaption();
    try { await realtimeBeatriceContext?.close(); } catch {}
    realtimeBeatriceContext = null;
    realtimeBeatriceOutput = null;
    realtimeBeatriceDecodeAudio = null;
    ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
    await ipcRenderer.invoke("beatrice:stop").catch(() => {});
  };

  const reportRealtimeRms = (rawRms, now = performance.now()) => {
    if (realtimeOutputSuppressed) return;
    if (!(Number(rawRms) > 0)) {
      ttsEnvelope = 0;
      ttsDynamicPeak = .022;
      ttsNoiseFloor = .0015;
      ttsEnvelopeSampleAt = 0;
      ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
      return;
    }
    if (now - realtimeMeterLastSentAt < 32) return;
    realtimeMeterLastSentAt = now;
    ipcRenderer.invoke("mascotInline:voice", adaptiveTtsLevel(rawRms, now)).catch(() => {});
  };

  const stopRealtimeOutputMeter = () => {
    cancelAnimationFrame(realtimeMeterFrame);
    realtimeMeterFrame = 0;
    try { realtimeMeterSource?.disconnect(); } catch {}
    try { realtimeMeterAnalyser?.disconnect(); } catch {}
    try { realtimeMeterSilence?.disconnect(); } catch {}
    realtimeMeterSource = null;
    realtimeMeterAnalyser = null;
    realtimeMeterSilence = null;
    realtimeMeterSamples = null;
    realtimeMeterLastSentAt = 0;
    const context = realtimeMeterContext;
    realtimeMeterContext = null;
    context?.close().catch(() => {});
    reportRealtimeRms(0);
  };

  const startRealtimeOutputMeter = async (stream) => {
    stopRealtimeOutputMeter();
    const context = new AudioContext({ latencyHint: "interactive" });
    const source = context.createMediaStreamSource(stream);
    const analyserNode = context.createAnalyser();
    const silence = context.createGain();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = .1;
    silence.gain.value = 0;
    source.connect(analyserNode);
    analyserNode.connect(silence);
    silence.connect(context.destination);
    realtimeMeterContext = context;
    realtimeMeterSource = source;
    realtimeMeterAnalyser = analyserNode;
    realtimeMeterSilence = silence;
    realtimeMeterSamples = new Float32Array(analyserNode.fftSize);
    await context.resume();
    const update = (now) => {
      if (realtimeMeterContext !== context) return;
      analyserNode.getFloatTimeDomainData(realtimeMeterSamples);
      let sum = 0;
      for (const sample of realtimeMeterSamples) sum += sample * sample;
      reportRealtimeRms(Math.sqrt(sum / realtimeMeterSamples.length), now);
      realtimeMeterFrame = requestAnimationFrame(update);
    };
    realtimeMeterFrame = requestAnimationFrame(update);
  };

  const playRealtimeRemoteStream = (stream) => {
    realtimeRemoteAudio?.pause();
    realtimeRemoteAudio = new Audio();
    realtimeRemoteAudio.autoplay = true;
    realtimeRemoteAudio.muted = realtimeOutputSuppressed;
    realtimeRemoteAudio.srcObject = stream;
    realtimeRemoteAudio.play().catch(() => {});
    startRealtimeOutputMeter(stream).catch(() => reportRealtimeRms(0));
  };

  const exactArrayBuffer = (value) => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return null;
  };

  const flushRealtimeBeatricePlayback = (context) => {
    clearTimeout(realtimeBeatricePlaybackFlushTimer);
    realtimeBeatricePlaybackFlushTimer = 0;
    if (!realtimeBeatricePlaybackSamples || context.state === "closed") return;
    const combined = new Float32Array(realtimeBeatricePlaybackSamples);
    let offset = 0;
    for (const frame of realtimeBeatricePlaybackFrames) {
      combined.set(frame, offset);
      offset += frame.length;
    }
    realtimeBeatricePlaybackFrames = [];
    realtimeBeatricePlaybackSamples = 0;
    const audioBuffer = context.createBuffer(1, combined.length, 48000);
    audioBuffer.copyToChannel(combined, 0);
    const playback = context.createBufferSource();
    playback.buffer = audioBuffer;
    playback.connect(realtimeBeatriceOutput || context.destination);
    if (!realtimeBeatriceNextPlaybackTime || realtimeBeatriceNextPlaybackTime < context.currentTime + .02) {
      realtimeBeatriceNextPlaybackTime = context.currentTime + .08;
    }
    const playbackTime = realtimeBeatriceNextPlaybackTime;
    playback.start(playbackTime);
    realtimeBeatriceNextPlaybackTime += combined.length / 48000;
    let sum = 0;
    for (const sample of combined) sum += sample * sample;
    const rms = Math.sqrt(sum / combined.length);
    const levelTimer = setTimeout(() => {
      realtimeBeatriceLevelTimers.delete(levelTimer);
      realtimeBeatriceCaptionReady = true;
      releaseRealtimeBeatriceCaption();
      reportRealtimeRms(rms, performance.now());
    }, Math.max(0, (playbackTime - context.currentTime) * 1000));
    realtimeBeatriceLevelTimers.add(levelTimer);
    realtimeBeatricePlaybackSources.add(playback);
    playback.onended = () => {
      realtimeBeatricePlaybackSources.delete(playback);
      if (!realtimeBeatricePlaybackSources.size && !realtimeBeatricePlaybackSamples) {
        realtimeBeatriceCaptionReady = false;
        releaseRealtimeBeatriceCaption();
        reportRealtimeRms(0);
      }
    };
  };

  const queueRealtimeBeatricePlayback = (context, value) => {
    const buffer = exactArrayBuffer(value);
    if (!buffer || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT) {
      realtimeBeatriceErrorListener?.(null, "変換後の音声データ形式を処理できません。");
      return;
    }
    const samples = new Float32Array(buffer);
    if (!samples.length) return;
    realtimeBeatricePlaybackFrames.push(samples);
    realtimeBeatricePlaybackSamples += samples.length;
    clearTimeout(realtimeBeatricePlaybackFlushTimer);
    if (realtimeBeatricePlaybackSamples >= 1920) flushRealtimeBeatricePlayback(context);
    else realtimeBeatricePlaybackFlushTimer = setTimeout(() => flushRealtimeBeatricePlayback(context), 26);
  };

  const pushRealtimeBeatriceCapture = (samples) => {
    if (!samples.length) return;
    realtimeBeatriceCaptureFrames.push(samples);
    realtimeBeatriceCaptureSamples += samples.length;
    while (realtimeBeatriceCaptureSamples >= 480) {
      const frame = new Float32Array(480);
      let written = 0;
      while (written < frame.length) {
        const source = realtimeBeatriceCaptureFrames[0];
        const count = Math.min(frame.length - written, source.length - realtimeBeatriceCaptureOffset);
        frame.set(source.subarray(realtimeBeatriceCaptureOffset, realtimeBeatriceCaptureOffset + count), written);
        written += count;
        realtimeBeatriceCaptureOffset += count;
        realtimeBeatriceCaptureSamples -= count;
        if (realtimeBeatriceCaptureOffset === source.length) {
          realtimeBeatriceCaptureFrames.shift();
          realtimeBeatriceCaptureOffset = 0;
        }
      }
      ipcRenderer.send("beatrice:audio", frame.buffer);
    }
  };

  const startRealtimeBeatriceCapture = (track, context, stream) => {
    if (typeof MediaStreamTrackProcessor !== "function") throw new Error("このElectronではRealtime回答音声を変換できません。");
    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    realtimeBeatriceCaptureReader = reader;
    realtimeBeatriceCaptureTask = (async () => {
      try {
        while (realtimeBeatriceCaptureReader === reader) {
          const { value: audio, done } = await reader.read();
          if (done) break;
          try {
            const frames = audio.numberOfFrames;
            const channels = audio.numberOfChannels;
            const mono = new Float32Array(frames);
            for (let channel = 0; channel < channels; channel += 1) {
              const plane = new Float32Array(frames);
              audio.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
              for (let index = 0; index < frames; index += 1) mono[index] += plane[index] / channels;
            }
            if (audio.sampleRate === 48000) {
              pushRealtimeBeatriceCapture(mono);
            } else {
              const outputLength = Math.max(1, Math.round(mono.length * 48000 / audio.sampleRate));
              const resampled = new Float32Array(outputLength);
              const scale = audio.sampleRate / 48000;
              for (let index = 0; index < outputLength; index += 1) {
                const position = index * scale;
                const left = Math.min(mono.length - 1, Math.floor(position));
                const right = Math.min(mono.length - 1, left + 1);
                const mix = position - left;
                resampled[index] = mono[left] * (1 - mix) + mono[right] * mix;
              }
              pushRealtimeBeatriceCapture(resampled);
            }
          } finally {
            audio.close();
          }
        }
      } catch (error) {
        if (realtimeBeatriceCaptureReader === reader && realtimeBeatriceContext === context) {
          realtimeBeatriceErrorListener?.(null, error.message || error);
        }
      }
    })();
  };

  const startRealtimeBeatrice = async (stream) => {
    await ipcRenderer.invoke("beatrice:start");
    const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const output = context.createGain();
    output.gain.value = realtimeOutputSuppressed ? 0 : 1;
    output.connect(context.destination);
    const decodeAudio = new Audio();
    decodeAudio.autoplay = true;
    decodeAudio.muted = true;
    decodeAudio.srcObject = stream;
    realtimeBeatriceContext = context;
    realtimeBeatriceOutput = output;
    realtimeBeatriceDecodeAudio = decodeAudio;
    realtimeBeatriceAudioListener = (_event, audio) => queueRealtimeBeatricePlayback(context, audio);
    realtimeBeatriceErrorListener = (_event, message) => {
      if (realtimeBeatriceContext !== context || !realtimePeer) return;
      setStatus(`Beatrice 2の変換を継続できないため元の声へ戻しました: ${String(message)}`, 7000);
      stopRealtimeBeatrice().finally(() => { if (realtimePeer) playRealtimeRemoteStream(stream); });
    };
    ipcRenderer.on("beatrice:audioOut", realtimeBeatriceAudioListener);
    ipcRenderer.on("beatrice:error", realtimeBeatriceErrorListener);
    await context.resume();
    if (context.state !== "running") throw new Error("変換後の音声再生を開始できません。");
    await decodeAudio.play();
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Realtimeの回答音声トラックがありません。");
    startRealtimeBeatriceCapture(track, context, stream);
    setStatus("Beatrice 2でRealtime音声を変換中です", 5000);
  };

  const setRealtimeOutputSuppressed = (suppressed) => {
    realtimeOutputSuppressed = Boolean(suppressed);
    if (realtimeRemoteAudio) realtimeRemoteAudio.muted = realtimeOutputSuppressed;
    if (realtimeBeatriceOutput && realtimeBeatriceContext) {
      realtimeBeatriceOutput.gain.setTargetAtTime(realtimeOutputSuppressed ? 0 : 1, realtimeBeatriceContext.currentTime, .012);
    }
    if (realtimeOutputSuppressed) ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
  };

  const closeRealtime = () => {
    try { realtimeDataChannel?.close(); } catch {}
    try { realtimePeer?.close(); } catch {}
    realtimeRemoteAudio?.pause();
    if (realtimeRemoteAudio) realtimeRemoteAudio.srcObject = null;
    for (const track of realtimeStream?.getTracks?.() || []) track.stop();
    realtimePeer = null;
    realtimeDataChannel = null;
    realtimeRemoteAudio = null;
    stopRealtimeOutputMeter();
    stopRealtimeBeatrice().catch(() => {});
    realtimeStream = null;
    realtimeSessionState = "idle";
    realtimeOutputSuppressed = false;
    micButton.setAttribute("aria-pressed", "false");
    updateVoiceContext();
  };

  const startRealtime = async () => {
    stopTtsPlayback();
    setRealtimeOutputSuppressed(false);
    realtimeSessionState = "connecting";
    updateVoiceContext();
    realtimeStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    realtimePeer = new RTCPeerConnection();
    for (const track of realtimeStream.getAudioTracks()) realtimePeer.addTrack(track, realtimeStream);
    realtimePeer.addEventListener("track", async (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      if (appState?.realtimeVoiceConversion === "beatrice-v2") {
        try {
          await startRealtimeBeatrice(remoteStream);
          return;
        } catch (error) {
          await stopRealtimeBeatrice();
          setStatus(`Beatrice 2を開始できないため元の声で再生します: ${error.message}`, 7000);
        }
      }
      playRealtimeRemoteStream(remoteStream);
    });
    realtimeDataChannel = realtimePeer.createDataChannel("oai-events");
    realtimePeer.addEventListener("connectionstatechange", () => {
      if (["failed", "disconnected"].includes(realtimePeer?.connectionState)) {
        setStatus("Codex Realtime音声接続が切れました", 5000);
        ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
        closeRealtime();
      }
    });
    const offer = await realtimePeer.createOffer();
    await realtimePeer.setLocalDescription(offer);
    await ipcRenderer.invoke("mascotInline:realtimeStart", {
      sdp: realtimePeer.localDescription?.sdp || offer.sdp,
      selectedSkillIds: appState?.interactionMode === "work" ? mascotSelectedSkillIds : [],
      selectedMcpServerIds: mascotSelectedMcpServerIds,
    });
    micButton.setAttribute("aria-pressed", "true");
    setStatus("Codex Realtimeへ接続中…", 30_000);
  };

  const toggleVoiceInput = async () => {
    if (vadActive || vadStream) {
      stopVadListening();
      setStatus("音声待機を終了しました");
      return;
    }
    if (speechRecognition) {
      speechRecognition.stop();
      return;
    }
    if (realtimePeer) {
      await ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
      closeRealtime();
      setStatus("音声入力を終了しました");
      return;
    }
    if (recordedSpeechRecorder?.state === "recording") {
      recordedSpeechRecorder.stop();
      return;
    }
    appState = await ipcRenderer.invoke("mascotInline:getState").catch(() => appState);
    const provider = appState?.speechInputProvider || "browser";
    if (provider === "browser") {
      ensureFallbackRecognition();
      return;
    }
    if (provider === "sherpa-onnx" || provider === "openai") {
      if ((appState?.voiceActivationMode || "vad") !== "manual") {
        await startVadListening(provider).catch((error) => setStatus(`音声入力: ${error.message}`, 5000));
        return;
      }
      await toggleRecordedSpeech(provider).catch((error) => setStatus(`音声入力: ${error.message}`, 5000));
      return;
    }
    if (provider === "realtime" && appState?.backend !== "codex") {
      setStatus("Codex RealtimeはCodex接続時のみ利用できます", 5000);
      return;
    }
    if (provider === "realtime" && appState?.backend === "codex" && !realtimeUnavailable) {
      try {
        await startRealtime();
        return;
      } catch (error) {
        ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
        closeRealtime();
        realtimeUnavailable ||= /まだ提供されていません/.test(error.message);
        setStatus(`Codex Realtimeを開始できません: ${error.message}`, 5000);
        return;
      }
    }
    if (provider === "realtime") {
      setStatus("Codex Realtimeは現在利用できません", 5000);
      return;
    }
    ensureFallbackRecognition();
  };

  micButton.addEventListener("click", async () => {
    // Opening the microphone, loading VAD, and negotiating Realtime are all
    // asynchronous. Keep their lifecycle serialized so a second click cannot
    // create an orphaned recorder, AudioContext, or peer connection.
    if (voiceInputTransitioning) return;
    voiceInputTransitioning = true;
    micButton.disabled = true;
    micButton.classList.add("is-transitioning");
    try {
      await toggleVoiceInput();
    } catch (error) {
      setStatus(`音声入力: ${error.message}`, 5000);
    } finally {
      voiceInputTransitioning = false;
      micButton.disabled = false;
      micButton.classList.remove("is-transitioning");
    }
  });

  ipcRenderer.on("mascot:speech", (_event, payload) => {
    showSpeech(payload);
  });
  let onboardingFirstWorkRunning = false;
  ipcRenderer.on("mascot:onboardingFirstWork", async (_event, payload = {}) => {
    const message = String(payload.message || "").trim();
    if (!message || onboardingFirstWorkRunning) return;
    onboardingFirstWorkRunning = true;
    appState = await ipcRenderer.invoke("mascotInline:getState").catch(() => appState);
    setOpen(true, { focus: true, temporaryInteraction: true });
    input.value = message;
    resizeInput();
    try {
      if (payload.delivery === "live") {
        setStatus(uiText("マイクを有効にして最初のLiveへ接続しています…", "Enabling the microphone for your first Live session…"), 30_000);
        try {
          if (!realtimePeer) await startRealtime();
        } catch (error) {
          await ipcRenderer.invoke("mascotInline:realtimeStop").catch(() => {});
          closeRealtime();
          realtimeUnavailable ||= /まだ提供されていません/.test(String(error.message || ""));
          setStatus(uiText("Liveへ接続できなかったため、文字だけで仕事を始めます", "Live could not connect, so the task will continue silently in text"), 7000);
        }
      }
      input.value = "";
      resizeInput();
      await sendMascotMessage(message, [], [], [], {
        suppressPcAudio: !realtimePeer,
        forceWork: true,
      });
    } finally {
      onboardingFirstWorkRunning = false;
    }
  });
  ipcRenderer.on("audio:stopNormalSpeech", () => stopTtsPlayback());
  ipcRenderer.on("mascot:workHistory", (_event, payload) => {
    workHistoryState = payload && Array.isArray(payload.runs) ? payload : { activeWorkRunId: null, runs: [] };
    if (appState?.interactionMode === "work") renderWorkHistory(workHistoryState);
  });
  ipcRenderer.on("mascot:conversationHistory", (_event, payload) => {
    chatHistoryState = Array.isArray(payload) ? payload : [];
    if (workPanel.classList.contains("is-open") && appState?.interactionMode !== "work") renderConversationHistory(chatHistoryState);
  });
  ipcRenderer.on("mascot:stream", (_event, payload) => {
    if (payload?.phase === "follow-up") {
      const statusText = String(payload.statusText || uiText("追加の指示を同じ作業へ反映しています…", "Applying the follow-up to the current Work…"));
      setWorkActivity(statusText, { trackElapsed: true });
      setStatus(statusText, 7000);
      return;
    }
    if (payload?.phase === "start") {
      clearPermission();
      clearBubbleArtifactActions();
      stopTtsPlayback();
      bubblePersistent = true;
      streamFullText = "";
      streamCurrentSpeechText = "";
      streamTtsConfig = {
        enabled: Boolean(payload?.ttsEnabled),
        provider: payload?.ttsProvider || "system",
        language: payload?.speechLanguage || "ja-JP",
      };
      setSendingControls(true);
      streamWorkMode = payload?.mode === "work";
      if (payload?.realtimeOutput && streamWorkMode) {
        detachedRealtimeWorkBusy = true;
        detachedRealtimeWorkRunId = String(payload?.workRunId || "");
      }
      streamHasActivity = false;
      clearTimeout(hideTimer);
      const hasMeaningfulBubble = Boolean(bubbleText.textContent.trim());
      bubble.classList.remove("is-expanded", "has-overflow", "has-full-reply");
      bubbleMore.hidden = true;
      bubble.classList.toggle("is-visible", hasMeaningfulBubble);
      setWorkActivity(streamWorkMode
        ? (appState?.language === "en" ? "Starting work" : "作業を開始しています")
        : (appState?.language === "en" ? "Thinking" : "考えています"), { trackElapsed: true });
      return;
    }
    if (payload?.phase === "delta") {
      streamFullText = normalizeDisplayText(payload.displayText || payload.text);
      // Generated/system TTS owns the compact bubble while it is active. The
      // complete streaming answer remains available from the `全文` action.
      if (bubble.classList.contains("is-expanded") || !streamTtsConfig.enabled) {
        bubbleText.textContent = normalizeDisplayText(streamFullText);
      }
      bubble.classList.add("is-visible");
      syncBubbleOverflow();
      const now = performance.now();
      if (!streamTtsConfig.enabled && now - lastStreamPulseAt > 64) {
        lastStreamPulseAt = now;
        const deltaText = String(payload.delta || streamFullText);
        ipcRenderer.invoke("mascotInline:voice", textLipLevel(deltaText, Math.max(0, deltaText.length - 1), Math.floor(now / 64))).catch(() => {});
      }
      queueStreamSpeech(payload?.speechSegments);
      return;
    }
    if (payload?.phase === "announcement") {
      if (payload?.ttsEnabled !== undefined) {
        streamTtsConfig = {
          enabled: Boolean(payload.ttsEnabled),
          provider: payload?.ttsProvider || streamTtsConfig.provider || "system",
          language: payload?.speechLanguage || streamTtsConfig.language || "ja-JP",
        };
      }
      const announcement = normalizeDisplayText(payload.displayText || payload.text);
      if (announcement) {
        streamFullText = announcement;
        bubblePersistent = true;
        bubble.classList.add("is-visible");
        if (!streamTtsConfig.enabled) bubbleText.textContent = announcement;
        syncBubbleOverflow();
      }
      queueStreamSpeech(payload?.speechSegments);
      return;
    }
    if (payload?.phase === "realtime-caption") {
      renderRealtimeCaption(payload.displayText || payload.text);
      return;
    }
    if (payload?.phase === "activity") {
      streamHasActivity = true;
      setWorkActivity(String(payload.text || "作業中…"), { trackElapsed: true });
      return;
    }
    if (payload?.phase === "realtime-work-complete") {
      finishDetachedRealtimeWork(payload?.workRunId);
      if (streamFullText && !bubble.classList.contains("is-expanded")) {
        bubbleText.textContent = normalizeDisplayText(streamFullText);
        syncBubbleOverflow();
      }
      setWorkActivity("");
      setStatus(appState?.language === "en" ? "Work complete" : "作業が完了しました", 5000);
      return;
    }
    if (payload?.phase === "done") {
      if (payload?.ttsEnabled !== undefined) {
        streamTtsConfig = {
          enabled: Boolean(payload.ttsEnabled),
          provider: payload?.ttsProvider || streamTtsConfig.provider || "system",
          language: payload?.speechLanguage || streamTtsConfig.language || "ja-JP",
        };
      }
      if (payload?.text) streamFullText = normalizeDisplayText(payload.displayText || payload.text);
      streamTtsFinished = true;
      bubblePersistent = true;
      queueStreamSpeech(payload?.speechSegments);
      renderArtifactActions(artifactActions, payload?.artifacts, payload?.workRunId);
      scheduleBubbleArtifactActionsClear();
      if (!streamTtsConfig.enabled || (!streamTtsDraining && !streamTtsQueue.length)) {
        streamCurrentSpeechText = "";
        if (!payload?.deferDisplayToRealtime && !bubble.classList.contains("is-expanded") && streamFullText) bubbleText.textContent = normalizeDisplayText(streamFullText);
        if (streamTtsConfig.enabled) finishTtsPlayback();
      }
      syncBubbleOverflow();
      scheduleBubbleHide(Math.max(9000, bubbleHideDuration));
      if (payload?.realtimeOutput) {
        if (streamWorkMode) {
          if (!payload?.realtimeSpeechPending) finishDetachedRealtimeWork(payload?.workRunId);
        } else {
          setSendingControls(false);
        }
      } else setSendingControls(false);
      if (streamWorkMode) setWorkActivity(appState?.language === "en" ? "Work complete" : "作業完了", { finish: true });
      else setWorkActivity("");
      streamWorkMode = false;
      streamHasActivity = false;
    } else if (payload?.phase === "error") {
      stopTtsPlayback();
      streamCurrentSpeechText = "";
      if (!bubble.classList.contains("is-expanded") && streamFullText) bubbleText.textContent = normalizeDisplayText(streamFullText);
      if (payload?.realtimeOutput && streamWorkMode) finishDetachedRealtimeWork(payload?.workRunId);
      else setSendingControls(false);
      bubblePersistent = true;
      if (streamWorkMode) setWorkActivity(appState?.language === "en" ? "Work could not be completed" : "作業を完了できませんでした", { finish: true });
      else setWorkActivity("");
      streamWorkMode = false;
      streamHasActivity = false;
    }
    if (!ttsBusy) ipcRenderer.invoke("mascotInline:voice", 0).catch(() => {});
  });
  ipcRenderer.on("mascot:realtimeEvent", async (_event, message) => {
    const method = String(message?.method || "");
    const params = message?.params || {};
    if (method === "thread/realtime/sdp") {
      if (realtimePeer && params.sdp) {
        await realtimePeer.setRemoteDescription({ type: "answer", sdp: String(params.sdp) });
      }
      return;
    }
    if (method === "thread/realtime/started") {
      realtimeSessionState = "live";
      updateVoiceContext();
      setStatus("話してください…もう一度押すと終了", 30_000);
      return;
    }
    if (method.startsWith("thread/realtime/transcript/") && params.role === "assistant") {
      setRealtimeOutputSuppressed(Boolean(params.suppressed));
      if (params.suppressed) return;
    }
    if (method === "thread/realtime/transcript/delta" && params.role === "user") {
      setRealtimeOutputSuppressed(false);
      input.value += String(params.delta || "");
      resizeInput();
      return;
    }
    if (method === "thread/realtime/transcript/done" && params.role === "user") {
      setRealtimeOutputSuppressed(false);
      input.value = "";
      resizeInput();
      setStatus("Codexが考えています…", 30_000);
      bubblePersistent = true;
      setWorkActivity(appState?.language === "en" ? "Thinking" : "考えています", { trackElapsed: true });
      return;
    }
    if (method === "thread/realtime/transcript/done" && params.role === "assistant") {
      releaseRealtimeBeatriceCaption();
      if (!detachedRealtimeWorkBusy) {
        setWorkActivity("");
        setStatus(appState?.language === "en" ? "Listening…" : "話してください…", 30_000);
      }
      return;
    }
    if (method === "thread/realtime/error") {
      realtimeUnavailable ||= Boolean(params.unavailable);
      closeRealtime();
      detachedRealtimeWorkBusy = false;
      detachedRealtimeWorkRunId = "";
      setSendingControls(false);
      setWorkActivity("");
      setStatus(params.message || "Codex Realtime接続エラー", 5000);
      return;
    }
    if (method === "thread/realtime/closed") {
      closeRealtime();
      detachedRealtimeWorkBusy = false;
      detachedRealtimeWorkRunId = "";
      setSendingControls(false);
      setWorkActivity("");
    }
  });
  ipcRenderer.on("beatrice:settingsChanged", (_event, payload = {}) => {
    closeRealtime();
    setStatus(payload.message || "Beatrice 2の設定変更を反映するためLive接続を終了しました。", 8000);
  });
  ipcRenderer.on("mascot:toggleChat", (_event, payload) => setOpen(
    payload?.open ?? !dock.classList.contains("is-open"),
    { focus: Boolean(payload?.focus), temporaryInteraction: Boolean(payload?.temporaryInteraction) },
  ));
  ipcRenderer.on("mascot:character", (_event, character) => applyCharacter(character));
  ipcRenderer.on("mascot:windowSettings", (_event, settings) => applyWindowSettings(settings));
  ipcRenderer.on("mascot:pointerState", (_event, state) => applyPointerState(state));
  ipcRenderer.on("mascot:mode", (_event, state) => {
    appState = { ...appState, ...state };
    applyInterfaceLanguage(appState.language);
    applyInteractionMode(appState);
    renderMascotSelectedSkills();
    if (!addPopover.hidden) renderMascotSkillPicker();
  });
  ipcRenderer.on("audio:realtimeTurnSkills", (_event, payload = {}) => {
    mascotSelectedSkillIds = Array.isArray(payload.selectedSkillIds) ? payload.selectedSkillIds : [];
    mascotSelectedMcpServerIds = Array.isArray(payload.selectedMcpServerIds) ? payload.selectedMcpServerIds : [];
    renderMascotSelectedSkills();
    if (!addPopover.hidden) renderMascotSkillPicker();
  });
  ipcRenderer.on("mascot:tts", (_event, payload) => {
    appState = { ...appState, ttsEnabled: Boolean(payload?.enabled), ttsProvider: payload?.provider || "system" };
    updateVoiceContext();
    if (!payload?.enabled) {
      stopTtsPlayback();
    }
  });
  ipcRenderer.on("mascot:voiceInputSettings", (_event, payload) => {
    const previousProvider = appState?.speechInputProvider;
    const previousMode = appState?.voiceActivationMode;
    const previousSensitivity = appState?.vadSensitivity;
    appState = { ...appState, ...payload };
    if (previousProvider === "realtime" && appState.speechInputProvider !== "realtime") closeRealtime();
    updateVoiceContext();
    if (appState.voiceAutoSend === false) clearAutoSendCountdown();
    if (vadActive && (previousProvider !== appState.speechInputProvider
      || previousMode !== appState.voiceActivationMode
      || previousSensitivity !== appState.vadSensitivity)) {
      stopVadListening({ discard: true });
    }
  });
  ipcRenderer.on("mascot:thinkingFiller", (_event, payload) => {
    const text = String(payload?.text || "").trim();
    if (!text || !sending) return;
    stopTtsPlayback();
    thinkingFillerActive = true;
    const playback = isGeneratedTtsProvider(payload?.ttsProvider)
      ? playGeneratedSpeech(text, payload.ttsProvider)
      : speakSystemText(text, payload?.speechLanguage);
    Promise.resolve(playback).finally(() => {
      if (!thinkingFillerActive) return;
      thinkingFillerActive = false;
      streamCurrentSpeechText = "";
      const hasQueuedSpeech = streamTtsQueue.length > 0;
      drainStreamTtsQueue();
      if (!hasQueuedSpeech && streamTtsFinished && !bubble.classList.contains("is-expanded") && streamFullText) {
        bubbleText.textContent = normalizeDisplayText(streamFullText);
        syncBubbleOverflow();
      }
    });
  });
  ipcRenderer.invoke("mascotInline:getState").then((state) => {
    appState = state;
    applyInterfaceLanguage(state.language);
    applyInteractionMode(state);
    applyCharacter(state.characters?.find((character) => character.id === state.characterId));
    applyWindowSettings(state);
    applyPointerState({ mode: state.mascotPointerMode, autoHidden: false });
    renderMascotSelectedSkills();
    chatHistoryState = Array.isArray(state.conversationHistory) ? state.conversationHistory : [];
    ipcRenderer.invoke("mascotInline:getWorkHistory").then((payload) => {
      workHistoryState = payload;
      if (state.interactionMode === "work") renderWorkHistory(payload);
    }).catch(() => {});
  }).catch(() => {});
});
