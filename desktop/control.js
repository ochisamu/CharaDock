// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";

  const api = window.mascotDesktop;
  const i18n = window.CharaDockI18n;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const localized = (japanese, english) => state?.language === "en" ? english : japanese;
  let state = null;
  let audioStream = null;
  let audioContext = null;
  let analyser = null;
  let meterFrame = 0;
  let lipSyncActive = false;
  let lastVoiceSentAt = 0;
  let speechRecognition = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingProvider = "openai";
  let realtimePeerConnection = null;
  let realtimeDataChannel = null;
  let realtimeRemoteAudio = null;
  let realtimeBeatriceConverter = null;
  let realtimeMeterContext = null;
  let realtimeMeterSource = null;
  let realtimeMeterAnalyser = null;
  let realtimeMeterSilence = null;
  let realtimeMeterFrame = 0;
  let realtimeMeterSamples = null;
  let realtimeMeterLastSentAt = 0;
  const realtimeSpeechEnvelope = window.CharaDockAudioEnvelope.createAdaptiveSpeechEnvelope();
  let realtimeStarting = false;
  let realtimeStartGeneration = 0;
  let realtimeUserTranscript = "";
  let realtimeAssistantMessage = null;
  let realtimeAssistantText = "";
  let realtimeAssistantActive = false;
  let realtimePendingTypedText = "";
  let realtimeUnavailable = false;
  let speechPulseTimer = null;
  let speechAudio = null;
  let speechAudioContext = null;
  let speechAudioAnalyser = null;
  let speechAudioSource = null;
  let speechAudioFrame = 0;
  let speechAudioSamples = null;
  let speechAudioGraphConnected = false;
  const speechEnvelope = window.CharaDockAudioEnvelope.createAdaptiveSpeechEnvelope();
  let speechTtsStreamId = "";
  let speechPlaybackToken = 0;
  let streamingMessage = null;
  let renderedConversationCharacterId = "";
  let chatBusy = false;
  let pendingChatFollowUp = null;
  let chatAttachments = [];
  let chatHistoryView = "conversation";
  let workHistoryState = { activeWorkRunId: null, runs: [] };
  let activeArtifactPreview = null;
  let activeArtifactPreviewData = null;
  let generatorFile = null;
  let generatorBusy = false;
  let codexAccount = null;
  let codexModels = [];
  let realtimeVoices = { voices: [], defaultVoice: "cove", loaded: false };
  const realtimeVoiceProfiles = Object.freeze({
    arbor: { impression: "中性的", description: "気さくで万能" },
    breeze: { impression: "女性寄り", description: "活発で誠実" },
    cove: { impression: "男性寄り", description: "落ち着いて率直" },
    ember: { impression: "男性寄り", description: "自信があり前向き" },
    juniper: { impression: "女性寄り", description: "開放的で明るい" },
    maple: { impression: "女性寄り", description: "陽気で率直" },
    sol: { impression: "女性寄り", description: "聡明でリラックス" },
    spruce: { impression: "男性寄り", description: "穏やかで肯定的" },
    vale: { impression: "女性寄り", description: "明るく好奇心旺盛" },
  });
  let onboardingStep = 0;
  let onboardingWasOpen = false;
  let onboardingFocusReturn = null;
  let lastDiagnostics = null;
  let dismissedUpdateVersion = "";
  let motionPreviewTimer = 0;
  const motionFields = [
    "avatarSize", "rangeLeft", "rangeRight", "rangeUp", "rangeDown",
    "followSpeed", "breathStrength", "rollStrength", "pyokoStrength", "hairSpring", "hairWarp",
  ];
  const settingsSearchItems = Object.freeze([
    { page: "chat", target: "#chatLog", ja: "Chat履歴", en: "Chat history", detailJa: "過去のChatとWorkを見る", detailEn: "Review past chats and work", keywords: "chat conversation history work 作業" , popular: true },
    { page: "chat", target: "#chatWorkProjectSelect", ja: "作業先プロジェクト", en: "Work project", detailJa: "キャラクターホームや担当プロジェクトを切り替える", detailEn: "Switch between Character Home and attached projects", keywords: "directory folder project home output 成果物 担当 ホーム" },
    { page: "remote", target: "#remoteAccessCard", ja: "リモートアクセス", en: "Remote access", detailJa: "同じWi-FiからChatとWorkを操作", detailEn: "Use Chat and Work from the same Wi-Fi", keywords: "remote mobile lan qr smartphone スマホ リモート", popular: true },
    { page: "character", target: "#characterLibraryTitle", ja: "キャラクター一覧", en: "Character library", detailJa: "使うキャラクターを切り替える", detailEn: "Switch the active character", keywords: "avatar select library キャラ", popular: true },
    { page: "character", target: "#characterProfileCard", ja: "名前・性格・メモリ", en: "Name, personality, and memory", detailJa: "選択中のキャラクターを編集", detailEn: "Edit the selected character", keywords: "profile persona memory bubble 名前 性格 記憶 吹き出し" },
    { page: "character", target: "#motionEditorTitle", ja: "キャラクターの動き", en: "Character motion", detailJa: "サイズ、追従、呼吸、髪揺れ", detailEn: "Size, tracking, breathing, and hair motion", keywords: "motion animation lip sync hair blink マウス リップシンク", popular: true },
    { page: "character", target: "#characterAddTitle", ja: "キャラクターを追加", en: "Add a character", detailJa: ".purupuruまたは画像から作成", detailEn: "Import .purupuru or create from an image", keywords: "import image generator purupuru 画像 追加" },
    { page: "voice", target: "#voiceInputCard", ja: "音声入力", en: "Voice input", detailJa: "認識方式、VAD、自動送信", detailEn: "Recognition, VAD, and auto-send", keywords: "microphone stt sherpa vad realtime マイク 音声認識", popular: true },
    { page: "voice", target: "#characterVoiceCard", ja: "キャラクターの声", en: "Character voice", detailJa: "Liveまたは通常TTSの声を選ぶ", detailEn: "Choose a Live or standard TTS voice", keywords: "tts live realtime speaker voice 読み上げ", popular: true },
    { page: "voice", target: "#realtimeVoiceSettings", ja: "Realtimeの声", en: "Realtime voice", detailJa: "GPT-Liveの声と声変換", detailEn: "GPT-Live voice and conversion", keywords: "codex live openai beatrice" },
    { page: "voice", target: "#beatriceLibraryCard", ja: "Beatrice 2", en: "Beatrice 2", detailJa: "公式本体と変換モデルを参照", detailEn: "Link the official runtime and models", keywords: "vst voice conversion 声変換 model" },
    { page: "voice", target: "#standardTtsSettings", ja: "通常TTSと音声モデル", en: "Standard TTS and voice models", detailJa: "Irodori、SBV2、Kokoroなど", detailEn: "Irodori, SBV2, Kokoro, and more", keywords: "irodori sbv2 kokoro piper supertonic style bert model" },
    { page: "connection", target: ".backend-grid", ja: "AI接続方式", en: "AI connection method", detailJa: "CodexまたはOpenAI APIを選択", detailEn: "Choose Codex or OpenAI API", keywords: "backend provider login api", popular: true },
    { page: "connection", target: "#codexSettings", ja: "Codexのモデルと推論", en: "Codex model and reasoning", detailJa: "会話・作業ごとに設定", detailEn: "Configure chat and work separately", keywords: "app server model effort thinking 推論" },
    { page: "connection", target: "#openaiSettings", ja: "OpenAI API", en: "OpenAI API", detailJa: "APIキーと応答モデル", detailEn: "API key and response model", keywords: "key responses transcription" },
    { page: "desktop", target: "#languageSettingsCard", ja: "表示言語", en: "Display language", detailJa: "日本語とEnglishを切り替える", detailEn: "Switch between Japanese and English", keywords: "language english japanese 日本語 英語" },
    { page: "desktop", target: "#windowSettingsCard", ja: "キャラクターの操作", en: "Character interaction", detailJa: "自動退避、クリック透過、最前面", detailEn: "Auto-hide, click-through, and always-on-top", keywords: "auto hide pointer click through lock window 透過 固定", popular: true },
    { page: "desktop", target: "#mascotWindowCard", ja: "ウィンドウの位置とサイズ", en: "Window position and size", detailJa: "モニター、表示、位置を調整", detailEn: "Adjust display, visibility, and position", keywords: "monitor display size position モニター" },
    { page: "desktop", target: ".shortcut-card", ja: "キーボードショートカット", en: "Keyboard shortcuts", detailJa: "すばやく表示と操作を切り替える", detailEn: "Quickly toggle display and interaction", keywords: "keyboard hotkey ctrl key" },
    { page: "support", target: "#reopenOnboardingButton", ja: "初回セットアップ", en: "Initial setup", detailJa: "セットアップをもう一度行う", detailEn: "Run guided setup again", keywords: "onboarding wizard reset setup", popular: true },
    { page: "support", target: ".support-update-card", ja: "アプリのアップデート", en: "App updates", detailJa: "最新版とプレリリースを確認", detailEn: "Check stable and prerelease versions", keywords: "update release version beta 最新 バージョン", popular: true },
    { page: "support", target: ".support-diagnostics-card", ja: "診断とログ", en: "Diagnostics and logs", detailJa: "不具合調査用の情報をまとめる", detailEn: "Collect troubleshooting information", keywords: "support log zip gpu error サポート" },
  ]);
  let settingsSearchMatches = [];
  let settingsSearchActiveIndex = -1;

  function setStatus(element, message, error = false) {
    element.textContent = String(message || "");
    element.classList.toggle("is-error", Boolean(error));
  }

  function bindFileDropZone(element, onFiles) {
    let dragDepth = 0;
    const containsFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
    element.addEventListener("dragenter", (event) => {
      if (!containsFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      element.classList.add("is-drag-over");
    });
    element.addEventListener("dragover", (event) => {
      if (!containsFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", (event) => {
      if (!containsFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) element.classList.remove("is-drag-over");
    });
    element.addEventListener("drop", (event) => {
      if (!containsFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      element.classList.remove("is-drag-over");
      onFiles([...(event.dataTransfer?.files || [])]);
    });
  }

  function renderChatAttachments() {
    const list = $("#chatAttachmentList");
    list.replaceChildren();
    list.hidden = !chatAttachments.length;
    chatAttachments.forEach((attachment, index) => {
      const chip = document.createElement("span");
      chip.className = "chat-attachment-chip";
      const icon = document.createElement("span");
      icon.className = "ui-symbol ui-symbol-document";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = attachment.name;
      name.title = attachment.path;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", localized(`${attachment.name}を外す`, `Remove ${attachment.name}`));
      remove.innerHTML = '<span class="ui-symbol ui-symbol-close" aria-hidden="true"></span>';
      remove.addEventListener("click", () => {
        chatAttachments.splice(index, 1);
        renderChatAttachments();
      });
      chip.append(icon, name, remove);
      list.appendChild(chip);
    });
  }

  function addChatAttachments(files) {
    const additions = [];
    for (const file of files) {
      let filePath = "";
      try { filePath = api.getPathForFile(file); } catch {}
      if (!filePath) continue;
      additions.push({ path: filePath, name: file.name || filePath.split(/[\\/]/).pop() || "file" });
    }
    const unique = new Map(chatAttachments.map((item) => [item.path.toLowerCase(), item]));
    additions.forEach((item) => unique.set(item.path.toLowerCase(), item));
    chatAttachments = [...unique.values()].slice(0, 8);
    renderChatAttachments();
    if (!additions.length) setStatus($("#chatStatus"), localized("ファイルの場所を取得できませんでした。", "Could not access the selected file path."), true);
    else if (unique.size > 8) setStatus($("#chatStatus"), localized("添付は8ファイルまでです。", "You can attach up to 8 files."), true);
    else setStatus($("#chatStatus"), localized(`${chatAttachments.length}件のファイルを添付しました。`, `${chatAttachments.length} file(s) attached.`));
  }

  async function importPuruPuruFile(file) {
    if (!file) return;
    if (!/\.purupuru$/i.test(file.name)) {
      setStatus($("#purupuruImportStatus"), ".purupuruファイルを選択してください。", true);
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setStatus($("#purupuruImportStatus"), ".purupuruは80MB以下にしてください。", true);
      return;
    }
    const button = $("#purupuruImportButton");
    button.disabled = true;
    setStatus($("#purupuruImportStatus"), `${file.name} を確認しています…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      state = await api.importPuruPuruCharacter({ bytes, fileName: file.name });
      syncUi();
      setStatus($("#purupuruImportStatus"), `${currentCharacter().name}を追加しました。`);
    } catch (error) {
      setStatus($("#purupuruImportStatus"), error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function selectGeneratorFile(file) {
    generatorFile = null;
    $("#avatarImageDrop").classList.remove("has-image");
    if (!file) {
      updateGeneratorProgress({ phase: "idle", message: "画像を選択してください。" });
      syncGeneratorUi();
      return;
    }
    if (!/^image\/(?:png|jpeg|webp)$/i.test(file.type) && !/\.(?:png|jpe?g|webp)$/i.test(file.name)) {
      updateGeneratorProgress({ phase: "error", message: "PNG・JPEG・WebP画像を選択してください。" });
      syncGeneratorUi();
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      updateGeneratorProgress({ phase: "error", message: "画像は15MB以下にしてください。" });
      syncGeneratorUi();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      $("#avatarImagePreview").src = String(reader.result || "");
      $("#avatarImageDrop").classList.add("has-image");
    };
    reader.readAsDataURL(file);
    generatorFile = file;
    updateGeneratorProgress({ phase: "ready", message: `${file.name} を使用します。` });
    syncGeneratorUi();
  }

  function syncSherpaModelUi(model = {}) {
    const status = $("#sherpaModelStatus");
    const progress = $("#sherpaModelProgress");
    const download = $("#sherpaModelDownloadButton");
    const remove = $("#sherpaModelRemoveButton");
    const select = $("#sherpaModelSelect");
    const hint = $("#sherpaModelHint");
    if (!status || !progress || !download || !remove || !select || !hint) return;
    const models = Array.isArray(model.models) ? model.models : [];
    if (models.length) {
      select.replaceChildren(...models.map((item) => new Option(
        `${item.label}${item.recommended ? "（推奨）" : ""}${item.installed ? " · 導入済み" : ""}`,
        item.modelId,
      )));
      select.value = model.modelId || models[0].modelId;
    }
    const transfer = model.progress || {};
    const total = Number(transfer.totalBytes || model.downloadBytes) || 116_204_861;
    const received = Number(transfer.receivedBytes) || 0;
    if (model.downloading || transfer.phase === "downloading" || transfer.phase === "extracting") {
      progress.hidden = false;
      if (transfer.phase === "extracting") {
        progress.removeAttribute("value");
        status.textContent = "モデルを展開しています…";
      } else {
        const percent = Math.min(100, Math.round(received / total * 100));
        progress.value = percent;
        status.textContent = `モデルをダウンロードしています… ${percent}%`;
      }
    } else {
      progress.hidden = true;
      progress.value = 0;
      status.textContent = model.installed
        ? `${model.label || "日本語音声モデル"} · 利用できます`
        : "日本語音声モデルはまだダウンロードされていません。";
    }
    download.hidden = Boolean(model.installed);
    download.disabled = Boolean(model.downloading);
    remove.hidden = !model.installed;
    remove.disabled = Boolean(model.downloading);
    select.disabled = Boolean(model.downloading);
    const downloadMb = Math.max(1, Math.round(Number(model.downloadBytes || 0) / 1024 / 1024));
    download.textContent = `ダウンロード（約${downloadMb}MB）`;
    hint.textContent = `${model.description || "日本語音声認識モデル"}。初回ダウンロード約${downloadMb}MB。認識処理と音声データは端末内で完結します。`;
  }

  function downloadSizeLabel(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
    return `${Math.max(1, Math.round(value / 1024 / 1024))}MB`;
  }

  function syncTtsSampleModelUi(prefix, model = {}) {
    const status = $(`#${prefix}ModelDownloadStatus`);
    const progress = $(`#${prefix}ModelDownloadProgress`);
    const download = $(`#${prefix}ModelDownloadButton`);
    const remove = $(`#${prefix}ModelRemoveButton`);
    const hint = $(`#${prefix}ModelDownloadHint`);
    if (!status || !progress || !download || !remove || !hint) return;
    const transfer = model.progress || {};
    const total = Number(transfer.totalBytes || model.downloadBytes) || 1;
    const received = Number(transfer.receivedBytes) || 0;
    const size = downloadSizeLabel(model.downloadBytes);
    if (model.downloading || ["downloading", "extracting"].includes(transfer.phase)) {
      progress.hidden = false;
      if (transfer.phase === "extracting") {
        progress.removeAttribute("value");
        setStatus(status, "モデルを展開しています…");
      } else {
        const percent = Math.min(100, Math.round(received / total * 100));
        progress.value = percent;
        const current = transfer.currentFile ? ` · ${transfer.currentFile}` : "";
        setStatus(status, `モデルをダウンロードしています… ${percent}%${current}`);
      }
    } else {
      progress.hidden = true;
      progress.value = 0;
      if (model.supported === false) setStatus(status, "このサンプルの自動導入はWindows版で利用できます。");
      else if (model.installed) setStatus(status, `${model.label || "サンプルモデル"} · 導入済み`);
      else setStatus(status, "サンプルモデルはまだダウンロードされていません。");
    }
    download.hidden = Boolean(model.installed);
    download.disabled = Boolean(model.downloading) || model.supported === false;
    remove.hidden = !model.installed;
    remove.disabled = Boolean(model.downloading);
    download.textContent = `ダウンロード（約${size}）`;
    hint.textContent = `${model.description || "ローカル音声合成モデル"} 初回ダウンロード約${size}。音声生成は端末内で完結します。`;
  }

  function setCodexModelOptions(select, selectedValue) {
    const value = String(selectedValue || "");
    select.replaceChildren(new Option("Codex既定", ""));
    for (const model of codexModels) {
      const option = new Option(`${model.displayName || model.model}${model.isDefault ? "（既定）" : ""}`, model.model);
      option.title = model.description || "";
      select.appendChild(option);
    }
    if (value && ![...select.options].some((option) => option.value === value)) {
      select.appendChild(new Option(`${value}（保存済み）`, value));
    }
    select.value = value;
  }

  async function refreshCodexModels() {
    try {
      const models = await api.getCodexModels();
      codexModels = Array.isArray(models) ? models.filter((model) => model?.model && !model.hidden) : [];
      setCodexModelOptions($("#codexChatModelInput"), state.codexChatModel || state.codexModel || "");
      setCodexModelOptions($("#codexWorkModelInput"), state.codexWorkModel || state.codexModel || "");
    } catch (error) {
      setCodexModelOptions($("#codexChatModelInput"), state.codexChatModel || state.codexModel || "");
      setCodexModelOptions($("#codexWorkModelInput"), state.codexWorkModel || state.codexModel || "");
      setStatus($("#connectionStatus"), `モデル一覧を取得できません: ${error.message}`, true);
    }
  }

  function syncRealtimeVoiceUi() {
    const select = $("#realtimeVoiceSelect");
    const status = $("#realtimeVoiceStatus");
    if (!select || !status || !state) return;
    const selected = state.realtimeVoice || state.characterTts?.realtimeVoice || realtimeVoices.defaultVoice || "cove";
    select.replaceChildren();
    const addGroup = (impression, voices) => {
      if (!voices.length) return;
      const group = document.createElement("optgroup");
      group.label = `${impression}（声の印象）`;
      for (const voice of voices) {
        const profile = realtimeVoiceProfiles[voice];
        const display = `${voice.charAt(0).toUpperCase()}${voice.slice(1)} — ${profile?.description || "Realtime音声"}${voice === realtimeVoices.defaultVoice ? "（標準）" : ""}`;
        group.appendChild(new Option(display, voice));
      }
      select.appendChild(group);
    };
    for (const impression of ["男性寄り", "女性寄り", "中性的"]) {
      addGroup(impression, realtimeVoices.voices.filter((voice) => realtimeVoiceProfiles[voice]?.impression === impression));
    }
    if (![...select.options].some((option) => option.value === selected)) {
      select.appendChild(new Option(`${selected.charAt(0).toUpperCase()}${selected.slice(1)}（保存済み）`, selected));
    }
    select.value = selected;
    select.disabled = state.backend !== "codex" || state.speechInputProvider !== "realtime";
    if (state.backend !== "codex") setStatus(status, "Realtime音声はCodex app-server接続時に使用します。");
    else if (realtimeVoices.loaded) setStatus(status, `${realtimeVoices.voices.length}種類のRealtime音声を利用できます。`);
    else setStatus(status, "保存済みの声を表示しています。接続時に音声一覧を更新します。");
  }

  function updateRangeProgress(input) {
    const value = Number(input.value) || 0;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    input.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100))}%`);
  }

  function syncBeatriceReadouts() {
    const values = [
      ["beatricePitchShift", (value) => `${value > 0 ? "+" : ""}${value.toFixed(2).replace(/\.00$/, "")} st`],
      ["beatriceFormantShift", (value) => `${value > 0 ? "+" : ""}${value.toFixed(2).replace(/\.00$/, "")} st`],
      ["beatriceOutputGain", (value) => `${value > 0 ? "+" : ""}${Math.round(value)} dB`],
      ["beatriceInputGain", (value) => `${value > 0 ? "+" : ""}${Math.round(value)} dB`],
      ["beatriceIntonation", (value) => value.toFixed(1)],
      ["beatricePitchCorrection", (value) => `${Math.round(value * 100)}%`],
    ];
    for (const [key, format] of values) {
      const input = $(`#${key}Input`);
      if (!input) continue;
      updateRangeProgress(input);
      $(`#${key}Output`).textContent = format(Number(input.value) || 0);
    }
  }

  function populateBeatriceVoices(modelId, preferredVoiceId) {
    const voiceSelect = $("#beatriceVoiceSelect");
    const model = (state.beatrice?.models || []).find((item) => item.id === modelId);
    voiceSelect.replaceChildren();
    for (const voice of model?.voices || []) voiceSelect.appendChild(new Option(`${voice.id} · ${voice.name}`, String(voice.id)));
    if (!voiceSelect.options.length) voiceSelect.appendChild(new Option(localized("声がありません", "No voices"), "0"));
    const selected = String(preferredVoiceId ?? 0);
    voiceSelect.value = [...voiceSelect.options].some((option) => option.value === selected)
      ? selected : voiceSelect.options[0].value;
    return model;
  }

  function appendBeatriceDescription(container, value) {
    const description = String(value || "").trim();
    container.replaceChildren();
    if (!description) {
      container.textContent = localized("TOMLにdescriptionの記載はありません。", "No description is provided in the TOML.");
      container.classList.add("is-empty");
      return;
    }
    container.classList.remove("is-empty");
    const urlPattern = /https?:\/\/[^\s<>"']+/g;
    let cursor = 0;
    for (const match of description.matchAll(urlPattern)) {
      if (match.index > cursor) container.append(document.createTextNode(description.slice(cursor, match.index)));
      let url = match[0];
      let trailing = "";
      while (/[.,;:!?、。）」』】》]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      let safeUrl = null;
      try {
        const parsed = new URL(url);
        if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) safeUrl = parsed.toString();
      } catch {}
      if (safeUrl) {
        const link = document.createElement("a");
        link.href = safeUrl;
        link.textContent = url;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          api.openExternalUrl(safeUrl).catch((error) => setStatus($("#beatriceStatus"), error.message, true));
        });
        container.append(link);
      } else container.append(document.createTextNode(url));
      if (trailing) container.append(document.createTextNode(trailing));
      cursor = match.index + match[0].length;
    }
    if (cursor < description.length) container.append(document.createTextNode(description.slice(cursor)));
  }

  function syncBeatriceDescriptionUi(model) {
    const card = $("#beatriceDescriptionCard");
    if (!model) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const voiceId = Number($("#beatriceVoiceSelect").value) || 0;
    const voice = (model.voices || []).find((item) => item.id === voiceId) || model.voices?.[0] || null;
    $("#beatriceModelDescriptionTitle").textContent = [model.name || "Beatrice model", model.version].filter(Boolean).join(" · ");
    $("#beatriceVoiceDescriptionTitle").textContent = voice ? `${voice.id} · ${voice.name}` : localized("声がありません", "No voices");
    appendBeatriceDescription($("#beatriceModelDescription"), model.description);
    appendBeatriceDescription($("#beatriceVoiceDescription"), voice?.description);
  }

  function renderBeatriceModelLibrary(selectedModelId) {
    const list = $("#beatriceModelLibraryList");
    const models = state.beatrice?.models || [];
    list.replaceChildren();
    if (!models.length) {
      const empty = document.createElement("p");
      empty.className = "beatrice-model-empty";
      empty.textContent = localized("まだモデルがありません。Beatriceのモデルフォルダーを追加してください。", "No models yet. Add a Beatrice model folder.");
      list.appendChild(empty);
      return;
    }
    for (const model of models) {
      const row = document.createElement("div");
      row.className = "beatrice-model-row";
      row.classList.toggle("is-selected", model.id === selectedModelId);
      const copy = document.createElement("div");
      copy.className = "beatrice-model-copy";
      const title = document.createElement("strong");
      title.textContent = model.name || "Beatrice model";
      const detail = document.createElement("small");
      detail.textContent = [model.version, `${model.voices?.length || 0} voices`, model.ready ? "" : localized("参照切れ", "Missing")].filter(Boolean).join(" · ");
      copy.append(title, detail);
      const remove = document.createElement("button");
      remove.className = "beatrice-model-remove";
      remove.type = "button";
      const removeIcon = document.createElement("span");
      removeIcon.className = "ui-symbol ui-symbol-close";
      removeIcon.setAttribute("aria-hidden", "true");
      remove.appendChild(removeIcon);
      remove.title = localized("一覧から外す（元ファイルは削除しません）", "Remove reference (does not delete files)");
      remove.setAttribute("aria-label", `${title.textContent}${localized("を一覧から外す", ": remove reference")}`);
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
          state = await api.removeBeatriceModel(model.id);
          syncUi();
          setStatus($("#beatriceLibraryStatus"), localized("モデルの参照を一覧から外しました。元ファイルは残っています。", "The model reference was removed. Its files remain untouched."));
        } catch (error) {
          remove.disabled = false;
          setStatus($("#beatriceLibraryStatus"), error.message, true);
        }
      });
      row.append(copy, remove);
      list.appendChild(row);
    }
  }

  function syncBeatriceUi() {
    const beatrice = state.beatrice || {};
    const models = beatrice.models || [];
    const conversion = state.realtimeVoiceConversion || state.characterTts?.realtimeVoiceConversion || "none";
    const live = state.backend === "codex" && state.speechInputProvider === "realtime";
    const selectedModelId = models.some((model) => model.id === state.beatriceModelId)
      ? state.beatriceModelId : beatrice.selectedModelId || models[0]?.id || "";
    const conversionSelect = $("#realtimeVoiceConversionSelect");
    const modelSelect = $("#beatriceModelSelect");
    const badge = $("#beatriceLibraryBadge");
    conversionSelect.value = conversion;
    conversionSelect.disabled = !live;
    $("#beatriceCharacterSettings").hidden = conversion !== "beatrice-v2";

    badge.classList.remove("is-ready", "is-warning");
    if (beatrice.ready) {
      badge.textContent = localized("利用可能", "Ready");
      badge.classList.add("is-ready");
    } else if (beatrice.installed || models.length) {
      badge.textContent = localized("要確認", "Needs attention");
      badge.classList.add("is-warning");
    } else badge.textContent = localized("未設定", "Not set");
    $("#beatriceInstallName").textContent = beatrice.installName || localized("フォルダー未選択", "No folder selected");
    if (!beatrice.installed) setStatus($("#beatriceLibraryStatus"), localized("公式サイトから取得したBeatrice 2の展開フォルダーを選択してください。", "Select the extracted Beatrice 2 folder downloaded from the official site."));
    else if (!beatrice.vstReady) setStatus($("#beatriceLibraryStatus"), localized("VST3が見つかりません。展開フォルダーを選び直してください。", "The VST3 is missing. Choose the extracted folder again."), true);
    else if (!models.length) setStatus($("#beatriceLibraryStatus"), localized("本体を確認しました。次にモデルを追加してください。", "Beatrice is ready. Add a model next."));
    else setStatus($("#beatriceLibraryStatus"), localized(`${models.length}件のモデルを参照しています。`, `${models.length} model${models.length === 1 ? "" : "s"} referenced.`));

    renderBeatriceModelLibrary(selectedModelId);
    modelSelect.replaceChildren();
    for (const model of models) modelSelect.appendChild(new Option(`${model.name}${model.version ? ` · ${model.version}` : ""}`, model.id));
    if (!modelSelect.options.length) modelSelect.appendChild(new Option(localized("モデル未追加", "No models added"), ""));
    modelSelect.value = selectedModelId;
    const selectedModel = populateBeatriceVoices(selectedModelId, state.beatriceVoiceId ?? state.characterTts?.beatriceVoiceId ?? 0);
    syncBeatriceDescriptionUi(selectedModel);

    const tuning = {
      beatricePitchShift: 0,
      beatriceFormantShift: 0,
      beatriceInputGain: 0,
      beatriceOutputGain: 0,
      beatriceIntonation: 1,
      beatricePitchCorrection: 0,
    };
    for (const [key, fallback] of Object.entries(tuning)) {
      $(`#${key}Input`).value = Number.isFinite(Number(state[key])) ? Number(state[key]) : fallback;
    }
    $("#beatricePitchCorrectionTypeSelect").value = Number(state.beatricePitchCorrectionType) === 1 ? "1" : "0";
    syncBeatriceReadouts();

    const controlsEnabled = live && conversion === "beatrice-v2" && Boolean(selectedModel?.ready) && beatrice.vstReady;
    modelSelect.disabled = !live || conversion !== "beatrice-v2" || !models.length;
    $("#beatriceVoiceSelect").disabled = !controlsEnabled || !(selectedModel?.voices?.length);
    $$("#beatriceCharacterSettings input, #beatriceCharacterSettings select, #beatriceCharacterSettings button")
      .filter((element) => element !== modelSelect && element !== $("#beatriceVoiceSelect"))
      .forEach((element) => { element.disabled = !controlsEnabled; });
    if (beatrice.ready && selectedModel) setStatus($("#beatriceStatus"), localized(`${selectedModel.name} · ${selectedModel.voices?.length || 0} voices`, `${selectedModel.name} · ${selectedModel.voices?.length || 0} voices`));
    else if (conversion === "beatrice-v2" && !beatrice.vstReady) setStatus($("#beatriceStatus"), localized("上のBeatrice本体を設定してください。", "Set up Beatrice above first."), true);
    else if (conversion === "beatrice-v2" && !models.length) setStatus($("#beatriceStatus"), localized("上の一覧へモデルを追加してください。", "Add a model to the library above."), true);
    else if (conversion === "beatrice-v2") setStatus($("#beatriceStatus"), localized("選択したモデルを確認できません。", "The selected model is unavailable."), true);
    else setStatus($("#beatriceStatus"), localized("必要な場合だけBeatrice 2でRealtime音声を変換できます。", "Use Beatrice 2 only when you want to convert Realtime audio."));
  }

  function syncVoiceRoutingUi() {
    const live = state.backend === "codex" && state.speechInputProvider === "realtime";
    const realtimePanel = $("#realtimeVoiceSettings");
    const standardPanel = $("#standardTtsSettings");
    const providerNames = {
      system: "Windows標準",
      "style-bert-vits2": "Style-Bert-VITS2",
      "piper-plus": "piper-plus",
      "supertonic-3": "Supertonic 3",
      kokoro: "Kokoro",
      "irodori-webgpu": "Irodori TTS",
      "sbv2-jp-extra": "Style-Bert-VITS2 JP-Extra",
    };
    $("#voiceRoutingBadge").textContent = live ? "LIVE" : "通常TTS";
    $("#voiceRoutingTitle").textContent = live
      ? `GPT-Live · ${(state.realtimeVoice || "cove").replace(/^./, (value) => value.toUpperCase())}${state.realtimeVoiceConversion === "beatrice-v2" ? " → Beatrice 2" : ""}`
      : `${providerNames[state.ttsProvider] || "通常TTS"}${state.ttsEnabled ? " · 読み上げON" : " · 読み上げOFF"}`;
    $("#voiceRoutingDescription").textContent = live
      ? "録音ボタンでLive接続中は、音声入力も文字入力もこの声で返します。通常TTSは使いません。"
      : "通常会話の返答を選択中の音声合成で読み上げます。GPT-Liveの声は使いません。";
    realtimePanel.classList.toggle("is-active", live);
    realtimePanel.classList.toggle("is-inactive", !live);
    standardPanel.classList.toggle("is-active", !live);
    standardPanel.classList.toggle("is-inactive", live);
    standardPanel.disabled = live;
    $("#realtimeVoiceSelect").disabled = !live;
  }

  async function refreshRealtimeVoices() {
    try {
      const result = await api.getRealtimeVoices();
      realtimeVoices = {
        voices: Array.isArray(result?.voices) ? result.voices : [],
        defaultVoice: result?.defaultVoice || "cove",
        loaded: true,
      };
      syncRealtimeVoiceUi();
    } catch (error) {
      syncRealtimeVoiceUi();
      setStatus($("#realtimeVoiceStatus"), `音声一覧を取得できません: ${error.message}`, true);
    }
  }

  function settingsPageLabel(page) {
    const labels = {
      chat: ["Chat", "Chat"],
      remote: ["リモート", "Remote"],
      character: ["キャラクター", "Character"],
      voice: ["音声", "Voice"],
      connection: ["AI接続", "AI Connection"],
      desktop: ["デスクトップ", "Desktop"],
      support: ["サポート", "Support"],
    };
    const label = labels[page] || [page, page];
    return localized(label[0], label[1]);
  }

  function closeSettingsSearch({ clear = false } = {}) {
    const input = $("#settingsSearchInput");
    const results = $("#settingsSearchResults");
    if (clear) input.value = "";
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    settingsSearchMatches = [];
    settingsSearchActiveIndex = -1;
  }

  function setSettingsSearchActive(index) {
    const buttons = $$("#settingsSearchResults .settings-search-result");
    if (!buttons.length) return;
    settingsSearchActiveIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === settingsSearchActiveIndex;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      if (active) button.scrollIntoView({ block: "nearest" });
    });
  }

  function jumpToSettingsTarget(selector, { highlight = true } = {}) {
    const source = document.querySelector(selector);
    if (!source) return;
    const target = source.matches(".card, section, .backend-grid, .character-section-heading")
      ? source
      : source.closest(".card, section, .backend-grid, .character-section-heading") || source;
    target.setAttribute("data-settings-search-target", "");
    target.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    if (!highlight) return;
    target.classList.remove("settings-focus-flash");
    requestAnimationFrame(() => {
      target.classList.add("settings-focus-flash");
      setTimeout(() => target.classList.remove("settings-focus-flash"), 1100);
    });
  }

  function navigateToSetting(item) {
    showPage(item.page);
    closeSettingsSearch({ clear: true });
    $("#settingsSearchInput").blur();
    requestAnimationFrame(() => jumpToSettingsTarget(item.target));
  }

  function renderSettingsSearch(query = "") {
    const results = $("#settingsSearchResults");
    const input = $("#settingsSearchInput");
    const normalized = String(query).trim().toLocaleLowerCase(state?.language === "en" ? "en-US" : "ja-JP");
    settingsSearchMatches = settingsSearchItems.filter((item) => {
      if (!normalized) return item.popular;
      const haystack = [item.ja, item.en, item.detailJa, item.detailEn, item.keywords, settingsPageLabel(item.page)].join(" ").toLocaleLowerCase();
      return haystack.includes(normalized);
    }).slice(0, 8);
    settingsSearchActiveIndex = -1;
    results.replaceChildren();
    if (!settingsSearchMatches.length) {
      const empty = document.createElement("p");
      empty.className = "settings-search-empty";
      empty.textContent = localized("一致する設定がありません", "No matching settings");
      results.appendChild(empty);
    } else {
      settingsSearchMatches.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "settings-search-result";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        const title = document.createElement("strong");
        title.textContent = localized(item.ja, item.en);
        const detail = document.createElement("small");
        detail.textContent = localized(item.detailJa, item.detailEn);
        const page = document.createElement("em");
        page.textContent = settingsPageLabel(item.page);
        button.append(title, detail, page);
        button.addEventListener("pointerenter", () => setSettingsSearchActive(index));
        button.addEventListener("click", () => navigateToSetting(item));
        results.appendChild(button);
      });
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function organizeSettingsLayout() {
    const characterPage = $('[data-page-panel="character"]');
    const addGroup = characterPage?.querySelector(".character-add-group");
    if (characterPage && addGroup) characterPage.appendChild(addGroup);
    const voiceStack = $(".voice-settings-stack");
    const beatriceLibrary = $("#beatriceLibraryCard");
    if (voiceStack && beatriceLibrary) voiceStack.appendChild(beatriceLibrary);
    for (const item of settingsSearchItems) document.querySelector(item.target)?.setAttribute("data-settings-search-target", "");
  }

  function showPage(name) {
    const scroller = $(".main-panel");
    const activePanel = $('[data-page-panel].is-active');
    const previousName = activePanel?.dataset.pagePanel;
    if (previousName && previousName !== name) sessionStorage.setItem(`charadock.pageScroll.${previousName}`, String(scroller.scrollTop));
    sessionStorage.setItem("charadock.activePage", name);
    $$(".nav-tab").forEach((button) => {
      const active = button.dataset.page === name;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $$("[data-page-panel]").forEach((panel) => {
      const active = panel.dataset.pagePanel === name;
      panel.classList.toggle("is-active", active);
      panel.setAttribute("aria-hidden", String(!active));
    });
    if (previousName !== name) requestAnimationFrame(() => {
      scroller.scrollTop = Number(sessionStorage.getItem(`charadock.pageScroll.${name}`)) || 0;
    });
  }

  function appendMessage(role, text, thinking = false) {
    const article = document.createElement("article");
    article.className = `message is-${role}${thinking ? " is-thinking" : ""}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    const character = currentCharacter();
    avatar.textContent = role === "user" ? "YOU" : [...(character?.name || "AI")][0];
    const content = document.createElement("div");
    const label = document.createElement("small");
    label.textContent = role === "user" ? "あなた" : character?.name || "キャラクター";
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    content.append(label, paragraph);
    article.append(avatar, content);
    $("#chatLog").appendChild(article);
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
    return article;
  }

  function renderConversationHistory(entries = []) {
    const log = $("#chatLog");
    log.replaceChildren();
    const history = Array.isArray(entries) ? entries : [];
    if (!history.length) {
      appendMessage("assistant", "こんにちは。今日は何をしようか？");
      return;
    }
    for (const entry of history) {
      if (!["user", "assistant"].includes(entry?.role) || !String(entry?.text || "").trim()) continue;
      appendMessage(entry.role, String(entry.text));
    }
    log.scrollTop = log.scrollHeight;
  }

  function workStatusLabel(status) {
    const labels = state?.language === "en"
      ? { running: "Running", stopping: "Stopping", completed: "Completed", interrupted: "Stopped", failed: "Error" }
      : { running: "作業中", stopping: "中断中", completed: "完了", interrupted: "中断", failed: "エラー" };
    return labels[status] || status;
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(state?.language === "en" ? "en-US" : "ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function closeArtifactPreview() {
    const panel = $("#artifactPreview");
    panel.hidden = true;
    $("#artifactPreviewBody").replaceChildren();
    activeArtifactPreview = null;
    activeArtifactPreviewData = null;
  }

  function webFrameworkLabel(value) {
    return ({ nextjs: "Next.js", vite: "Vite", nuxt: "Nuxt", astro: "Astro", sveltekit: "SvelteKit", "node-web": "Web app" })[value] || "Web app";
  }

  function webPreviewLogs(server = {}) {
    const details = document.createElement("details");
    details.className = "web-preview-logs";
    const summary = document.createElement("summary");
    summary.textContent = localized("起動ログ", "Server logs");
    const pre = document.createElement("pre");
    pre.textContent = (server.logs || []).join("\n") || localized("ログはまだありません。", "No logs yet.");
    details.append(summary, pre);
    return details;
  }

  function renderDynamicWebPreview(preview, body) {
    const project = preview.project || {};
    const server = preview.server || { status: "idle", logs: [] };
    const running = server.status === "running";
    const busy = ["starting", "stopping"].includes(server.status);
    if (running) {
      const live = document.createElement("div");
      live.className = "web-live-preview";
      const frame = document.createElement("iframe");
      frame.title = `${project.name || preview.name} · Live preview`;
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.src = server.url;
      const footer = document.createElement("footer");
      const status = document.createElement("span");
      status.className = "web-preview-running";
      status.textContent = `${webFrameworkLabel(project.framework)} · ${localized("ライブ更新中", "Live updating")}`;
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "button button-quiet";
      stop.textContent = localized("停止", "Stop");
      stop.addEventListener("click", async () => { stop.disabled = true; await api.stopWebPreview().catch((error) => setStatus($("#chatStatus"), error.message, true)); });
      footer.append(status, stop);
      live.append(frame, footer, webPreviewLogs(server));
      body.appendChild(live);
      return;
    }

    const card = document.createElement("section");
    card.className = "web-preview-launch";
    const mark = document.createElement("span");
    mark.className = "web-preview-framework";
    mark.textContent = webFrameworkLabel(project.framework).slice(0, 2);
    const intro = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = webFrameworkLabel(project.framework);
    const title = document.createElement("h3");
    title.textContent = project.name || preview.name || localized("動的Webアプリ", "Dynamic web app");
    const description = document.createElement("p");
    description.textContent = localized(
      "開発サーバーをローカルで起動し、変更をFast Refreshでこの画面へ反映します。",
      "Start the local development server and show Fast Refresh changes here.",
    );
    intro.append(eyebrow, title, description);
    const controls = document.createElement("div");
    controls.className = "web-preview-launch-controls";
    const scriptLabel = document.createElement("label");
    scriptLabel.append(document.createTextNode(localized("起動スクリプト", "Start script")));
    const scriptSelect = document.createElement("select");
    for (const script of project.scripts || []) {
      const option = document.createElement("option");
      option.value = script;
      option.textContent = `${project.packageManager || "npm"} run ${script}`;
      scriptSelect.appendChild(option);
    }
    scriptSelect.value = project.preferredScript || project.scripts?.[0] || "dev";
    scriptLabel.appendChild(scriptSelect);
    const runtimeLabel = document.createElement("label");
    runtimeLabel.append(document.createTextNode(localized("実行環境", "Runtime")));
    const runtimeSelect = document.createElement("select");
    const runtimeLabels = { auto: localized("自動", "Auto"), windows: "Windows Node.js", wsl: "WSL Node.js" };
    for (const runtime of project.runtimeOptions || ["auto"]) {
      const option = document.createElement("option");
      option.value = runtime;
      option.textContent = runtimeLabels[runtime] || runtime;
      runtimeSelect.appendChild(option);
    }
    runtimeSelect.value = project.runtime || "auto";
    runtimeLabel.appendChild(runtimeSelect);
    controls.append(scriptLabel, runtimeLabel);
    const command = document.createElement("code");
    const refreshCommand = () => {
      const hostFlag = project.framework === "nextjs" ? "--hostname" : "--host";
      command.textContent = `${runtimeSelect.value === "wsl" ? "WSL · " : ""}${project.packageManager || "npm"} run ${scriptSelect.value} -- ${hostFlag} 127.0.0.1 --port <auto>`;
    };
    scriptSelect.addEventListener("change", refreshCommand);
    runtimeSelect.addEventListener("change", refreshCommand);
    refreshCommand();
    const note = document.createElement("p");
    note.className = `web-preview-readiness${project.dependenciesReady ? " is-ready" : " is-warning"}`;
    note.textContent = project.dependenciesReady
      ? localized("依存パッケージを確認しました。外部通信はプロジェクトの実装に従います。", "Dependencies are present. External requests follow the project's implementation.")
      : localized("依存パッケージが見つかりません。インストールは自動実行せず、起動に失敗した場合はログへ表示します。", "Dependencies were not found. CharaDock will not install them automatically; startup errors appear in the log.");
    const start = document.createElement("button");
    start.type = "button";
    start.className = "button button-primary";
    start.textContent = busy ? localized("起動しています…", "Starting…") : localized("ライブプレビューを起動", "Start live preview");
    start.disabled = busy;
    start.addEventListener("click", async () => {
      const confirmed = window.confirm(localized(
        `選択中のプロジェクトで次のコマンドを実行します。\n\n${command.textContent}\n\n依存関係のインストールは行いません。起動しますか？`,
        `Run this command in the selected project?\n\n${command.textContent}\n\nDependencies will not be installed automatically.`,
      ));
      if (!confirmed || !activeArtifactPreview) return;
      start.disabled = true;
      try {
        const next = await api.startWebPreview({ ...activeArtifactPreview, projectId: project.id, script: scriptSelect.value, runtime: runtimeSelect.value });
        if (activeArtifactPreviewData?.project?.id === project.id) {
          activeArtifactPreviewData.server = next;
          renderArtifactPreview(activeArtifactPreviewData);
        }
      } catch (error) {
        setStatus($("#chatStatus"), error.message, true);
        const current = await api.getWebPreview().catch(() => ({ status: "error", error: error.message, logs: [] }));
        if (activeArtifactPreviewData?.project?.id === project.id) {
          activeArtifactPreviewData.server = current;
          renderArtifactPreview(activeArtifactPreviewData);
        }
      }
    });
    card.append(mark, intro, controls, command, note, start);
    if (server.error) {
      const error = document.createElement("p");
      error.className = "web-preview-error";
      error.textContent = server.error;
      card.appendChild(error);
    }
    if (busy || server.error || server.logs?.length) card.appendChild(webPreviewLogs(server));
    body.appendChild(card);
  }

  const artifactLanguageAliases = Object.freeze({
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", html: "xml", htm: "xml", svg: "xml",
    yml: "yaml", md: "markdown", markdown: "markdown", sh: "bash", ps1: "powershell",
    bat: "dos", py: "python", rb: "ruby", rs: "rust", kt: "kotlin",
    h: "c", cpp: "cpp", hpp: "cpp", scss: "scss", jsonc: "json",
  });

  function renderHighlightedArtifact(preview) {
    const source = String(preview.text || "");
    const requested = artifactLanguageAliases[preview.language] || String(preview.language || "plaintext").toLowerCase();
    const language = window.hljs?.getLanguage?.(requested) ? requested : "plaintext";
    const wrapper = document.createElement("section");
    wrapper.className = "artifact-code-preview";
    const toolbar = document.createElement("header");
    const label = document.createElement("span");
    label.textContent = language === "plaintext" ? localized("テキスト", "Plain text") : language;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = localized("コピー", "Copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = localized("コピーしました", "Copied");
        setTimeout(() => { copy.textContent = localized("コピー", "Copy"); }, 1400);
      } catch (error) { setStatus($("#chatStatus"), error.message, true); }
    });
    toolbar.append(label, copy);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = `hljs language-${language}`;
    try {
      code.innerHTML = language === "plaintext" || !window.hljs
        ? window.hljs?.highlight(source, { language: "plaintext", ignoreIllegals: true }).value || ""
        : window.hljs.highlight(source, { language, ignoreIllegals: true }).value;
      if (!window.hljs) code.textContent = source;
    } catch { code.textContent = source; }
    pre.appendChild(code);
    wrapper.append(toolbar, pre);
    return wrapper;
  }

  function sameRunArtifactUrl(value, preview) {
    if (!value || !preview.url) return null;
    try {
      const base = new URL(preview.url);
      const resolved = new URL(value, base);
      return resolved.protocol === "charadock-artifact:" && resolved.hostname === base.hostname ? resolved : null;
    } catch { return null; }
  }

  function renderMarkdownArtifact(preview) {
    if (typeof window.markdownit !== "function" || !window.DOMPurify) return renderHighlightedArtifact(preview);
    const markdown = window.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      highlight(source, requested) {
        const language = artifactLanguageAliases[requested] || String(requested || "plaintext").toLowerCase();
        if (window.hljs?.getLanguage?.(language)) {
          try { return `<pre><code class="hljs language-${language}">${window.hljs.highlight(source, { language, ignoreIllegals: true }).value}</code></pre>`; }
          catch {}
        }
        return `<pre><code class="hljs language-plaintext">${markdown.utils.escapeHtml(source)}</code></pre>`;
      },
    });
    const rendered = markdown.render(String(preview.text || ""));
    const fragment = window.DOMPurify.sanitize(rendered, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ["a", "article", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
      ALLOWED_ATTR: ["alt", "class", "colspan", "href", "rowspan", "src", "start", "title"],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["form", "iframe", "input", "object", "script", "style", "template"],
      FORBID_ATTR: ["style"],
    });
    for (const image of fragment.querySelectorAll("img[src]")) {
      const resolved = sameRunArtifactUrl(image.getAttribute("src"), preview);
      if (resolved) {
        image.src = resolved.toString();
        image.loading = "lazy";
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "artifact-markdown-image-placeholder";
        placeholder.textContent = localized(`外部画像: ${image.alt || "画像"}`, `External image: ${image.alt || "image"}`);
        image.replaceWith(placeholder);
      }
    }
    for (const link of fragment.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href");
      const internal = sameRunArtifactUrl(href, preview);
      let external = null;
      try {
        const parsed = new URL(href);
        if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) external = parsed;
      } catch {}
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          if (internal && activeArtifactPreview) {
            const relativePath = decodeURIComponent(internal.pathname).replace(/^\/+/, "");
            await showArtifactPreview(activeArtifactPreview.runId, { path: relativePath, name: relativePath.split("/").pop() });
          } else if (external) await api.openExternalUrl(external.toString());
        } catch (error) { setStatus($("#chatStatus"), error.message, true); }
      });
      if (!internal && !external) {
        link.removeAttribute("href");
        link.classList.add("is-disabled");
      }
    }
    const wrapper = document.createElement("section");
    wrapper.className = "artifact-markdown-preview";
    const article = document.createElement("article");
    article.appendChild(fragment);
    wrapper.appendChild(article);
    return wrapper;
  }

  function renderArtifactPreview(preview) {
    activeArtifactPreviewData = preview;
    const panel = $("#artifactPreview");
    const body = $("#artifactPreviewBody");
    body.replaceChildren();
    $("#artifactPreviewTitle").textContent = preview.name || localized("成果物", "Output");
    $("#artifactPreviewPath").textContent = preview.path || "";
    $("#openPreviewArtifactButton").textContent = preview.type === "web-project" && preview.server?.status === "running"
      ? localized("ブラウザーで開く", "Open in browser") : localized("外部で開く", "Open externally");
    if (preview.type === "web-project") {
      renderDynamicWebPreview(preview, body);
    } else if (["web", "pdf"].includes(preview.type)) {
      const frame = document.createElement("iframe");
      frame.title = preview.name || localized("成果物プレビュー", "Output preview");
      if (preview.type === "web") frame.setAttribute("sandbox", "allow-scripts");
      frame.src = preview.url;
      body.appendChild(frame);
    } else if (preview.type === "image") {
      const image = document.createElement("img");
      image.src = preview.url;
      image.alt = preview.name || localized("成果物", "Output");
      body.appendChild(image);
    } else if (["audio", "video"].includes(preview.type)) {
      const media = document.createElement(preview.type);
      media.src = preview.url;
      media.controls = true;
      media.preload = "metadata";
      body.appendChild(media);
    } else if (preview.type === "text") {
      body.appendChild(["md", "markdown"].includes(String(preview.language || "").toLowerCase())
        ? renderMarkdownArtifact(preview)
        : renderHighlightedArtifact(preview));
    } else if (preview.type === "directory") {
      const list = document.createElement("div");
      list.className = "artifact-directory-list";
      for (const item of preview.items || []) {
        const row = document.createElement("span");
        const icon = document.createElement("i");
        icon.className = `ui-symbol ${item.kind === "directory" ? "ui-symbol-folder" : "ui-symbol-document"}`;
        row.append(icon, document.createTextNode(item.name));
        list.appendChild(row);
      }
      if (!list.childElementCount) list.textContent = localized("フォルダーは空です。", "This folder is empty.");
      body.appendChild(list);
    } else {
      const empty = document.createElement("div");
      empty.className = "artifact-preview-empty";
      empty.textContent = localized("この形式はアプリ内表示に対応していません。「外部で開く」を使ってください。", "This format cannot be shown in the app. Use Open externally.");
      body.appendChild(empty);
    }
    panel.hidden = false;
    panel.focus?.();
  }

  async function showArtifactPreview(runId, artifact) {
    activeArtifactPreview = { runId, path: artifact.path };
    $("#artifactPreviewTitle").textContent = localized("読み込み中…", "Loading…");
    $("#artifactPreviewPath").textContent = artifact.path || "";
    $("#artifactPreviewBody").replaceChildren();
    $("#artifactPreview").hidden = false;
    try {
      const preview = await api.previewWorkArtifact(activeArtifactPreview);
      if (!activeArtifactPreview || activeArtifactPreview.runId !== runId || activeArtifactPreview.path !== artifact.path) return;
      renderArtifactPreview(preview);
    } catch (error) {
      closeArtifactPreview();
      setStatus($("#chatStatus"), error.message, true);
    }
  }

  function appendWorkArtifactActions(container, artifacts, runId) {
    const entries = Array.isArray(artifacts) ? artifacts : [];
    if (!entries.length || !runId) return;
    const actions = document.createElement("div");
    actions.className = "work-artifact-actions";
    const label = document.createElement("span");
    label.className = "work-artifact-label";
    label.textContent = localized("成果物", "Outputs");
    actions.appendChild(label);
    for (const artifact of entries) {
      const group = document.createElement("span");
      group.className = "work-artifact-group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "work-artifact-button";
      const icon = document.createElement("span");
      icon.className = `ui-symbol ${artifact.kind === "directory" ? "ui-symbol-folder" : "ui-symbol-document"}`;
      icon.setAttribute("aria-hidden", "true");
      button.append(icon, document.createTextNode(artifact.name || artifact.path));
      button.title = artifact.path;
      button.addEventListener("click", () => showArtifactPreview(runId, artifact));
      const open = document.createElement("button");
      open.type = "button";
      open.className = "work-artifact-open";
      open.title = localized("外部で開く", "Open externally");
      open.setAttribute("aria-label", `${artifact.name || artifact.path} · ${localized("外部で開く", "Open externally")}`);
      const openIcon = document.createElement("span");
      openIcon.className = "ui-symbol ui-symbol-external";
      openIcon.setAttribute("aria-hidden", "true");
      open.appendChild(openIcon);
      open.addEventListener("click", async () => {
        open.disabled = true;
        try { await api.openWorkArtifact({ runId, path: artifact.path }); }
        catch (error) { setStatus($("#chatStatus"), error.message, true); }
        finally { open.disabled = false; }
      });
      group.append(button, open);
      actions.appendChild(group);
    }
    container.appendChild(actions);
  }

  function renderWorkHistory(payload = workHistoryState) {
    workHistoryState = payload && Array.isArray(payload.runs) ? payload : { activeWorkRunId: null, runs: [] };
    const log = $("#chatLog");
    log.replaceChildren();
    if (!workHistoryState.runs.length) {
      const empty = document.createElement("article");
      empty.className = "work-history-entry";
      const title = document.createElement("h3");
      title.textContent = localized("まだ作業履歴はありません", "No work history yet");
      const text = document.createElement("p");
      text.textContent = localized("Workで実行した依頼と結果がここに残ります。", "Work requests and results will appear here.");
      empty.append(title, text);
      log.appendChild(empty);
      return;
    }
    for (const run of workHistoryState.runs) {
      const item = document.createElement("article");
      item.className = `work-history-entry is-${run.status || "failed"}`;
      const head = document.createElement("header");
      head.className = "work-history-head";
      const metaGroup = document.createElement("div");
      const status = document.createElement("span");
      status.className = "work-history-status";
      status.textContent = workStatusLabel(run.status);
      const meta = document.createElement("span");
      meta.className = "work-history-meta";
      meta.textContent = [formatHistoryTime(run.startedAt), run.workDirectoryName, run.characterName].filter(Boolean).join(" · ");
      metaGroup.append(status, meta);
      head.appendChild(metaGroup);
      if (["running", "stopping"].includes(run.status) && run.id === workHistoryState.activeWorkRunId) {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "button button-danger";
        stop.textContent = run.status === "stopping" ? localized("中断中…", "Stopping…") : localized("中断", "Stop");
        stop.disabled = run.status === "stopping";
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          try { await api.interruptChat(); } catch (error) { setStatus($("#chatStatus"), error.message, true); stop.disabled = false; }
        });
        head.appendChild(stop);
      }
      const title = document.createElement("h3");
      title.textContent = String(run.request || "");
      item.append(head, title);
      const result = String(run.result || "").trim();
      if (result) {
        const text = document.createElement("p");
        text.textContent = result;
        item.appendChild(text);
      }
      appendWorkArtifactActions(item, run.artifacts, run.id);
      if (Array.isArray(run.activities) && run.activities.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = localized("進捗を表示", "Show progress");
        const list = document.createElement("ul");
        for (const activity of run.activities) {
          const row = document.createElement("li");
          row.textContent = String(activity || "");
          list.appendChild(row);
        }
        details.append(summary, list);
        item.appendChild(details);
      }
      log.appendChild(item);
    }
    log.scrollTop = 0;
  }

  function setChatHistoryView(view) {
    chatHistoryView = view === "work" ? "work" : "conversation";
    $("#conversationHistoryTab").setAttribute("aria-selected", String(chatHistoryView === "conversation"));
    $("#workHistoryTab").setAttribute("aria-selected", String(chatHistoryView === "work"));
    if (chatHistoryView === "work") renderWorkHistory(workHistoryState);
    else renderConversationHistory(state?.conversationHistory || []);
  }

  function showOptimisticCharacterSelection(characterId, selector) {
    $$(selector).forEach((item) => {
      const selected = item.dataset.characterId === characterId;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
  }

  function syncCharacterSwitchAvailability() {
    const workRunning = Boolean(workHistoryState.activeWorkRunId);
    for (const button of $$("#characterGrid .character-card")) {
      button.disabled = workRunning;
      button.title = workRunning
        ? localized("Workの完了後、または中断後に切り替えられます", "Available after Work finishes or is stopped")
        : "";
    }
  }

  function renderCharacters() {
    const grid = $("#characterGrid");
    grid.replaceChildren();
    for (const character of state.characters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `character-card${character.id === state.characterId ? " is-active" : ""}`;
      button.dataset.characterId = character.id;
      button.setAttribute("aria-pressed", String(character.id === state.characterId));
      const image = document.createElement("img");
      image.src = character.thumbnailUrl;
      image.alt = `${character.name}のプレビュー`;
      const copy = document.createElement("span");
      copy.className = "character-card-copy";
      const name = document.createElement("strong");
      name.textContent = character.name;
      const summary = document.createElement("small");
      summary.textContent = String(character.personality || "会話スタイルを設定できます").split(/[。！!]/)[0];
      const selected = document.createElement("span");
      selected.className = "selected";
      selected.textContent = "✓";
      copy.append(name, summary);
      button.append(image, copy, selected);
      if (character.generated) {
        const badge = document.createElement("span");
        badge.className = "generated-badge";
        badge.textContent = character.imported ? "読込" : "作成済み";
        button.appendChild(badge);
      }
      button.addEventListener("click", async () => {
        showOptimisticCharacterSelection(character.id, "#characterGrid .character-card");
        try {
          if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
          state = await api.setCharacter(character.id);
          syncUi();
          setStatus($("#chatStatus"), `${state.characters.find((item) => item.id === character.id)?.name || character.name}に切り替えました。`);
        } catch (error) {
          renderCharacters();
          setStatus($("#chatStatus"), error.message, true);
        }
      });
      grid.appendChild(button);
    }
    syncCharacterSwitchAvailability();
  }

  function renderOnboardingCharacters() {
    const grid = $("#onboardingCharacterGrid");
    grid.replaceChildren();
    for (const character of state.characters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `onboarding-character${character.id === state.characterId ? " is-active" : ""}`;
      button.dataset.characterId = character.id;
      button.setAttribute("aria-pressed", String(character.id === state.characterId));
      const image = document.createElement("img");
      image.src = character.thumbnailUrl;
      image.alt = `${character.name}のプレビュー`;
      const name = document.createElement("strong");
      name.textContent = character.name;
      button.append(image, name);
      button.addEventListener("click", async () => {
        showOptimisticCharacterSelection(character.id, "#onboardingCharacterGrid .onboarding-character");
        try {
          state = await api.setCharacter(character.id);
          renderCharacters();
          renderOnboardingCharacters();
          syncCharacterEditor();
          const legal = $(".onboarding-legal");
          legal.classList.remove("is-error");
          legal.textContent = "画像を追加する場合、その画像をアップロード・加工・利用する権利が必要です。生成処理では画像がCodexへ送信されます。";
        } catch (error) {
          renderOnboardingCharacters();
          const legal = $(".onboarding-legal");
          legal.textContent = `切り替えられませんでした: ${error.message}`;
          legal.classList.add("is-error");
        }
      });
      grid.appendChild(button);
    }
  }

  function currentCharacter() {
    return state.characters.find((character) => character.id === state.characterId) || state.characters[0];
  }

  function renderCharacterMemories() {
    const list = $("#characterMemoryList");
    const memories = Array.isArray(state.memories) ? state.memories : [];
    const labels = {
      identity: "呼び名",
      preference: "好み",
      relationship: "関係性",
      goal: "目標",
      background: "背景",
      other: "その他",
    };
    list.replaceChildren();
    $("#clearCharacterMemoriesButton").hidden = !memories.length;
    if (!memories.length) {
      const empty = document.createElement("p");
      empty.className = "character-memory-empty";
      empty.textContent = state.backend === "codex"
        ? "まだメモリはありません。普段どおり会話すると、今後も役立つ好みや呼び名をこのキャラだけが自動で覚えます。"
        : "まだメモリはありません。会話から自動で覚える機能はCodex app-server接続で利用できます。";
      list.appendChild(empty);
      return;
    }
    for (const memory of memories) {
      const item = document.createElement("article");
      item.className = "character-memory-item";
      const category = document.createElement("span");
      category.className = "character-memory-category";
      category.textContent = labels[memory.category] || labels.other;
      const content = document.createElement("p");
      content.textContent = String(memory.content || "");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "character-memory-remove";
      remove.dataset.memoryId = memory.id;
      remove.setAttribute("aria-label", `メモリ「${content.textContent}」を削除`);
      const icon = document.createElement("span");
      icon.className = "ui-symbol ui-symbol-close";
      icon.setAttribute("aria-hidden", "true");
      remove.appendChild(icon);
      item.append(category, content, remove);
      list.appendChild(item);
    }
  }

  function syncCharacterEditor() {
    const character = currentCharacter();
    if (!character) return;
    $("#characterNameInput").value = character.name || "";
    $("#characterPersonalityInput").value = character.personality || "";
    $("#bubbleLeftInput").value = character.ui?.bubbleLeft ?? 18;
    $("#bubbleTopInput").value = character.ui?.bubbleTop ?? 24;
    $("#bubbleWidthInput").value = character.ui?.bubbleWidth ?? 68;
    for (const key of motionFields) {
      $(`#${key}Input`).value = character.motion?.[key] ?? (key === "avatarSize" ? 100 : 30);
    }
    const credits = Array.isArray(character.credits) ? character.credits : [];
    const creditCard = $("#characterCredit");
    creditCard.hidden = !credits.length;
    $("#characterCreditText").textContent = String(character.creditText || "");
    const creditLinks = $("#characterCreditLinks");
    creditLinks.replaceChildren();
    for (const credit of credits) {
      if (!/^https:\/\//.test(String(credit?.url || ""))) continue;
      const link = document.createElement("a");
      link.href = credit.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = credit.label;
      creditLinks.appendChild(link);
    }
    $("#removeCharacterButton").hidden = !character.generated;
    $("#removeCharacterButton").disabled = false;
    renderCharacterMemories();
    syncMotionReadouts();
    setStatus($("#characterProfileStatus"), `${character.name}の設定`);
  }

  function syncMotionReadouts() {
    for (const key of motionFields) {
      const input = $(`#${key}Input`);
      const value = Number(input.value) || 0;
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 100;
      input.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, ((value - min) / Math.max(1, max - min)) * 100))}%`);
      $(`#${key}Output`).textContent = `${Math.round(value)}%`;
    }
  }

  function currentMotionValues() {
    return Object.fromEntries(motionFields.map((key) => [key, Number($(`#${key}Input`).value)]));
  }

  function previewCharacterMotion() {
    cancelAnimationFrame(motionPreviewTimer);
    motionPreviewTimer = requestAnimationFrame(() => {
      const character = currentCharacter();
      if (!character) return;
      api.previewCharacterMotion({ id: character.id, motion: currentMotionValues() }).catch((error) => {
        setStatus($("#characterProfileStatus"), error.message, true);
      });
    });
  }

  function setOnboardingStep(step) {
    const nextStep = Math.max(0, Math.min(4, Number(step) || 0));
    const modal = $(".onboarding-window");
    modal.dataset.stepDirection = nextStep < onboardingStep ? "back" : "forward";
    onboardingStep = nextStep;
    $$("[data-onboarding-step]").forEach((panel) => panel.classList.toggle("is-active", Number(panel.dataset.onboardingStep) === onboardingStep));
    $$(".onboarding-progress i").forEach((item, index) => {
      item.classList.toggle("is-active", index <= onboardingStep);
      if (index === onboardingStep) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    $("#onboardingBackButton").disabled = onboardingStep === 0;
    $("#onboardingStepLabel").textContent = `${onboardingStep + 1} / 5`;
    $("#onboardingNextButton").textContent = onboardingStep === 4 ? localized("会話を始める", "Start chatting") : localized("次へ", "Next");
    requestAnimationFrame(() => {
      const heading = $(`[data-onboarding-step="${onboardingStep}"] h2`);
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    });
  }

  function syncOnboardingReadiness() {
    if (!state) return;
    const codexSelected = state.backend === "codex";
    $("#onboardingBackendSelect").value = codexSelected ? "codex" : "openai";
    $("#onboardingLoginButton").hidden = !codexSelected;
    $("#onboardingAccountState").textContent = codexSelected
      ? codexAccount?.signedIn
        ? localized(`ChatGPTログイン済み（${codexAccount.planType || "プラン不明"}）`, `Signed in to ChatGPT (${codexAccount.planType || "unknown plan"})`)
        : localized("ChatGPTログインを確認してください。", "Check your ChatGPT sign-in.")
      : state.hasApiKey
        ? localized("OpenAI APIキーは設定済みです。", "An OpenAI API key is configured.")
        : localized("AI接続画面でOpenAI APIキーを設定してください。", "Configure an OpenAI API key on the AI Connection page.");
    const inputNames = {
      realtime: "GPT-Live / Codex Voice",
      "sherpa-onnx": "sherpa-onnx",
      browser: localized("端末音声認識", "System speech recognition"),
      openai: localized("OpenAI文字起こし", "OpenAI transcription"),
    };
    const ttsNames = {
      system: localized("Windows標準", "Windows system voice"),
      "style-bert-vits2": "Style-Bert-VITS2",
      "piper-plus": "piper-plus",
      "supertonic-3": "Supertonic 3",
      kokoro: "Kokoro",
      "irodori-webgpu": "Irodori TTS",
      "sbv2-jp-extra": "Style-Bert-VITS2 JP-Extra",
    };
    const inputProvider = state.speechInputProvider || "browser";
    const ttsProvider = state.ttsProvider || "system";
    const inputStatus = $("#onboardingSpeechInputStatus");
    const ttsStatus = $("#onboardingTtsStatus");
    let inputReady = true;
    let inputMessage = localized("端末の音声認識を使用します。マイク権限を確認してください。", "Uses system speech recognition. Check microphone access.");
    if (inputProvider === "realtime") {
      inputReady = state.backend === "codex" && Boolean(codexAccount?.signedIn);
      inputMessage = inputReady
        ? localized("ChatGPT接続済み。録音ボタンを押している間だけLiveセッションを開始します。", "ChatGPT is connected. A Live session starts only while using the microphone button.")
        : localized("CodexとChatGPTへの接続が必要です。", "Requires Codex and a ChatGPT sign-in.");
    } else if (inputProvider === "sherpa-onnx") {
      inputReady = Boolean(state.sherpaModel?.installed);
      inputMessage = inputReady
        ? localized("ローカル日本語モデルを利用できます。音声は端末内で処理されます。", "The local speech model is ready and audio stays on this device.")
        : localized("音声ページから日本語モデルをダウンロードしてください。", "Download a Japanese model from the Voice page.");
    } else if (inputProvider === "openai") {
      inputReady = Boolean(state.hasApiKey);
      inputMessage = inputReady
        ? localized("OpenAI APIキーを利用して文字起こしします。", "Transcribes with your OpenAI API key.")
        : localized("OpenAI APIキーの設定が必要です。", "An OpenAI API key is required.");
    }
    inputStatus.textContent = inputMessage;
    inputStatus.classList.toggle("is-ready", inputReady);
    inputStatus.classList.toggle("is-warning", !inputReady);

    let ttsReady = true;
    if (ttsProvider === "piper-plus") ttsReady = Boolean(state.piperPlus?.ready);
    else if (ttsProvider === "supertonic-3") ttsReady = Boolean(state.supertonic?.ready);
    else if (ttsProvider === "kokoro") ttsReady = Boolean(state.kokoro?.ready);
    else if (ttsProvider === "irodori-webgpu") ttsReady = Boolean(state.irodori?.ready);
    else if (ttsProvider === "sbv2-jp-extra") ttsReady = Boolean(state.sbv2?.ready);
    const remoteCheck = ttsProvider === "style-bert-vits2";
    ttsStatus.textContent = !state.ttsEnabled
      ? localized("読み上げはOFFです。文字だけで会話できます。", "Read-aloud is off. Text chat remains available.")
      : remoteCheck
        ? localized("ローカルAPIへの接続は「音声をテスト」で確認できます。", "Use Test voice to check the local API connection.")
        : ttsReady
          ? localized(`${ttsNames[ttsProvider]}を利用できます。`, `${ttsNames[ttsProvider]} is ready.`)
          : localized("この音声のモデルが未導入です。音声ページからダウンロードするか、Windows標準へ変更してください。", "This voice model is not installed. Download it from Voice, or switch to the system voice.");
    ttsStatus.classList.toggle("is-ready", !state.ttsEnabled || ttsReady);
    ttsStatus.classList.toggle("is-warning", state.ttsEnabled && !ttsReady && !remoteCheck);

    $("#onboardingSummaryConnection").textContent = state.backend === "codex"
      ? codexAccount?.signedIn ? localized("ChatGPT接続済み", "ChatGPT connected") : localized("Codex · 要ログイン確認", "Codex · sign-in needed")
      : state.hasApiKey ? localized("OpenAI API設定済み", "OpenAI API configured") : localized("OpenAI API · キー未設定", "OpenAI API · key missing");
    $("#onboardingSummaryCharacter").textContent = currentCharacter()?.name || localized("未選択", "Not selected");
    $("#onboardingSummaryInput").textContent = inputNames[inputProvider] || inputProvider;
    $("#onboardingSummaryOutput").textContent = state.ttsEnabled ? (ttsNames[ttsProvider] || ttsProvider) : localized("読み上げOFF", "Read-aloud off");
  }

  function syncSupportSummary() {
    if (!state) return;
    const inputNames = {
      realtime: "GPT-Live / Codex Voice",
      "sherpa-onnx": "sherpa-onnx",
      browser: localized("端末音声認識", "System speech recognition"),
      openai: localized("OpenAI文字起こし", "OpenAI transcription"),
    };
    const ttsNames = {
      system: localized("Windows標準", "Windows system voice"),
      "style-bert-vits2": "Style-Bert-VITS2",
      "piper-plus": "piper-plus",
      "supertonic-3": "Supertonic 3",
      kokoro: "Kokoro",
      "irodori-webgpu": "Irodori TTS",
      "sbv2-jp-extra": "Style-Bert-VITS2 JP-Extra",
    };
    $("#supportBackendSummary").textContent = state.backend === "codex"
      ? codexAccount?.signedIn ? localized("Codex · ChatGPT接続済み", "Codex · ChatGPT connected") : localized("Codex app-server", "Codex app-server")
      : state.hasApiKey ? localized("OpenAI API設定済み", "OpenAI API configured") : localized("OpenAI API · キー未設定", "OpenAI API · key missing");
    $("#supportInputSummary").textContent = inputNames[state.speechInputProvider] || state.speechInputProvider || localized("未選択", "Not selected");
    $("#supportTtsSummary").textContent = state.ttsEnabled ? (ttsNames[state.ttsProvider] || state.ttsProvider) : localized("読み上げOFF", "Read-aloud off");
  }

  function readableReleaseNotes(value) {
    return String(value || "")
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^[-*]\s+/gm, "• ")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 700);
  }

  function syncUpdateUi() {
    if (!state) return;
    const update = state.appUpdate || { status: "idle", currentVersion: "", channel: state.updateChannel || "stable" };
    const statusLabels = {
      idle: localized("未確認", "Not checked"),
      checking: localized("確認中", "Checking"),
      current: localized("最新版", "Up to date"),
      available: localized("更新あり", "Update available"),
      error: localized("確認失敗", "Check failed"),
    };
    const badge = $("#updateStatusBadge");
    badge.textContent = statusLabels[update.status] || statusLabels.idle;
    badge.classList.toggle("is-current", update.status === "current");
    badge.classList.toggle("is-available", update.status === "available");
    badge.classList.toggle("is-error", update.status === "error");
    $("#updateCurrentVersion").textContent = update.currentVersion ? `v${update.currentVersion}` : "—";
    $("#updateLatestVersion").textContent = update.latestVersion ? `v${update.latestVersion}` : "—";
    $("#updateChecksToggle").checked = state.updateChecksEnabled !== false;
    $("#updateChannelSelect").value = state.updateChannel === "beta" ? "beta" : "stable";
    const checkButton = $("#checkUpdatesButton");
    checkButton.disabled = update.status === "checking";
    checkButton.textContent = update.status === "checking" ? localized("確認しています…", "Checking…") : localized("今すぐ確認", "Check now");
    const openButton = $("#openUpdateReleaseButton");
    openButton.hidden = update.status !== "available";
    const notes = readableReleaseNotes(update.releaseNotes);
    $("#updateReleaseNotes").textContent = update.status === "available"
      ? notes || localized(`${update.releaseName || `v${update.latestVersion}`}が公開されています。`, `${update.releaseName || `v${update.latestVersion}`} is available.`)
      : update.status === "current"
        ? localized("現在のCharaDockは最新版です。", "This CharaDock installation is up to date.")
        : update.status === "error"
          ? update.error || localized("最新版を確認できませんでした。", "Could not check for updates.")
          : localized("「今すぐ確認」でGitHub Releasesを確認できます。", "Choose Check now to query GitHub Releases.");
    $("#updatePackageHint").textContent = update.packageKind === "portable"
      ? localized("ポータブル版では、新しいEXEをダウンロードして置き換えてください。設定とモデルはそのまま引き継がれます。", "For the portable edition, download the new EXE and replace the old one. Settings and models remain available.")
      : update.packageKind === "installer"
        ? localized("インストーラー版では、リリース画面から新しいSetupを実行すると現在の設定を保ったまま更新できます。", "For the installed edition, run the new Setup from the release page to update while keeping current settings.")
        : localized("開発版では更新の有無だけを確認します。", "Development builds only check whether a release is available.");
    const banner = $("#updateBanner");
    const showBanner = update.status === "available" && update.latestVersion !== dismissedUpdateVersion;
    banner.hidden = !showBanner;
    if (showBanner) {
      $("#updateBannerTitle").textContent = localized("新しいバージョンがあります", "A new version is available");
      $("#updateBannerDetail").textContent = `CharaDock v${update.latestVersion}`;
    }
  }

  async function refreshSupportDiagnostics() {
    const button = $("#refreshDiagnosticsButton");
    button.disabled = true;
    setStatus($("#supportStatus"), localized("端末情報を確認しています…", "Checking device information…"));
    try {
      lastDiagnostics = await api.getDiagnostics();
      $("#supportAppVersion").textContent = `${lastDiagnostics.app?.name || "CharaDock"} ${lastDiagnostics.app?.version || ""}`.trim();
      $("#supportPlatform").textContent = `${lastDiagnostics.runtime?.platform || ""} ${lastDiagnostics.runtime?.architecture || ""} · Electron ${lastDiagnostics.runtime?.electron || ""}`.trim();
      const gpu = lastDiagnostics.hardware?.gpuDevices?.find((item) => item.active) || lastDiagnostics.hardware?.gpuDevices?.[0];
      $("#supportGpu").textContent = gpu
        ? `${gpu.driverVendor || "GPU"} · ${gpu.driverVersion || `${gpu.vendorId || "?"}:${gpu.deviceId || "?"}`}`
        : localized("取得できませんでした", "Unavailable");
      $("#supportGeneratedAt").textContent = lastDiagnostics.generatedAt
        ? new Date(lastDiagnostics.generatedAt).toLocaleString(state.language === "en" ? "en-US" : "ja-JP")
        : localized("未取得", "Not collected");
      setStatus($("#supportStatus"), localized("診断情報を更新しました。共有前にZIPの内容を確認できます。", "Diagnostics updated. You can review the ZIP before sharing."));
    } catch (error) {
      setStatus($("#supportStatus"), error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function syncOnboarding() {
    const open = !state.onboardingComplete;
    const opening = open && !onboardingWasOpen;
    const onboarding = $("#onboarding");
    if (opening) onboardingFocusReturn = document.activeElement;
    onboarding.hidden = !open;
    $(".app-shell").inert = open;
    if (!open && onboardingWasOpen && onboardingFocusReturn?.focus) onboardingFocusReturn.focus({ preventScroll: true });
    onboardingWasOpen = open;
    $("#onboardingTtsToggle").checked = Boolean(state.ttsEnabled);
    $("#onboardingBackendSelect").value = state.backend || "codex";
    $("#onboardingSpeechInputProviderSelect").value = state.speechInputProvider || "browser";
    $("#onboardingTtsProviderSelect").value = state.ttsProvider || "system";
    renderOnboardingCharacters();
    syncOnboardingReadiness();
    syncSupportSummary();
    if (opening) setOnboardingStep(onboardingStep);
  }

  async function finishOnboarding() {
    state = await api.completeOnboarding(true);
    syncUi();
    showPage("chat");
    requestAnimationFrame(() => $("#chatInput")?.focus({ preventScroll: true }));
  }

  function syncGeneratorUi() {
    const available = state?.backend === "codex";
    $("#avatarGeneratorCard").classList.toggle("is-unavailable", !available);
    $("#generateCharacterButton").disabled = !available || !generatorFile || !$("#avatarRightsConfirm").checked || generatorBusy;
  }

  function syncPiperPlusUi(info = state?.piperPlus || {}) {
    $("#piperPlusExecutableName").textContent = info.runtimeName || "未選択";
    $("#piperPlusModelName").textContent = info.modelName || "未選択";
    const status = $("#piperPlusStatus");
    if (!info.runtimeReady) setStatus(status, "piper-plusの実行ファイルを選択してください。");
    else if (!info.modelReady) setStatus(status, "音声モデルは未導入です。後から選択できます。");
    else if (!info.configReady) setStatus(status, "モデルの設定JSONが同じフォルダーに見つかりません。", true);
    else setStatus(status, "ローカル音声合成の準備ができています。");
    syncTtsSampleModelUi("piperPlus", info.sampleModel);
  }

  function syncSupertonicUi(info = state?.supertonic || {}) {
    $("#supertonicModelName").textContent = info.directoryName || "未選択";
    const status = $("#supertonicStatus");
    if (info.ready) setStatus(status, "Supertonic 3のローカル音声合成を利用できます。");
    else if (info.directoryName) setStatus(status, `モデルファイルが不足しています（${(info.missingFiles || []).length}件）。`, true);
    else setStatus(status, "モデルは未導入です。後からフォルダーを選択できます。");
    syncTtsSampleModelUi("supertonic", info.sampleModel);
  }

  function syncKokoroUi(info = state?.kokoro || {}) {
    const status = $("#kokoroStatus");
    if (!info.ready) setStatus(status, "Kokoroの日本語モデルは未導入です。");
    else if ($("#kokoroDeviceSelect").value === "webgpu" && info.webgpuAvailable === false) {
      setStatus(status, "このPCではWebGPUを利用できません。自動またはCPUを選んでください。", true);
    } else if (info.webgpuAvailable === true && $("#kokoroDeviceSelect").value !== "wasm") {
      setStatus(status, "KokoroをWebGPUで利用できます。初回生成時にモデルをGPUへ読み込みます。");
    } else if ($("#kokoroDeviceSelect").value === "auto") {
      setStatus(status, "Kokoroを利用できます。WebGPUが使えない場合はCPUへ自動で切り替わります。");
    } else setStatus(status, "KokoroをCPUで利用できます。");
    syncTtsSampleModelUi("kokoro", info.sampleModel);
  }

  function syncIrodoriUi(info = state?.irodori || {}) {
    const version = $("#irodoriVersionSelect").value === "500m-v3" ? "500m-v3" : "v4-small";
    const legacy = version === "500m-v3";
    const precision = $("#irodoriPrecisionSelect").value === "int4" ? "int4" : "fp16";
    const quantized = !legacy && precision === "int4";
    $("#irodoriV4Panel").hidden = legacy;
    $("#irodoriV3Panel").hidden = !legacy;
    $("#irodoriManualModelLabel").textContent = legacy ? "500M-v3 FP16モデル" : `V4 Small ${quantized ? "INT4" : "FP16"}モデル`;
    $("#irodoriManualModelHint").textContent = legacy
      ? "irodori-tts-webgpuのルート、onnx_fp16フォルダー、または同じ配置の変換済み500M-v3モデルを選択できます。"
      : "irodori-tts-webgpuのルート、v4-small-unifiedフォルダー、または同じ配置の変換済みV4モデルを選択できます。";
    $("#irodoriReferenceHint").textContent = legacy
      ? "音声ファイルを48kHz WAVへ変換してアプリ内へコピーします。500M-v3では最大60秒まで利用できます。"
      : "音声ファイルを48kHz WAVへ変換してアプリ内へコピーします。v4では最大120秒まで利用できます。";
    $("#irodoriModelName").textContent = info.directoryName || "未選択";
    const select = $("#irodoriVoiceSelect");
    const voices = Array.isArray(info.voices) ? info.voices : [];
    select.replaceChildren();
    if (!voices.length) select.append(new Option("未追加", ""));
    for (const voice of voices) select.append(new Option(`${voice.name}${voice.ready ? "" : "（ファイルなし）"}`, voice.id));
    select.value = info.voiceId || "";
    select.disabled = !voices.length;
    const selectedVoice = voices.find((voice) => voice.id === info.voiceId);
    $("#irodoriVoiceRenameButton").disabled = !selectedVoice || selectedVoice.builtIn;
    $("#irodoriVoiceRemoveButton").disabled = !selectedVoice || selectedVoice.builtIn;
    const status = $("#irodoriStatus");
    if (info.webgpuAvailable === false) setStatus(status, "WebGPUを利用できません。GPUドライバーを確認してください。", true);
    else if (!info.modelReady) setStatus(status, `${legacy ? "Irodori TTS 500M-v3 FP16" : `Irodori TTS v4 Small ${quantized ? "INT4" : "FP16"}`}モデルを導入または選択してください。`);
    else if (info.referenceRequired && !info.referenceReady) setStatus(status, "本人の許可がある参照音声を追加してください。");
    else if (info.webgpuAvailable === true) setStatus(status, `${legacy ? "Irodori TTS 500M-v3" : "Irodori TTS v4 Small"}のWebGPU音声合成を利用できます。`);
    else setStatus(status, `${legacy ? "500M-v3" : "V4"}モデルと音声設定を確認しました。初回生成時にWebGPUを確認します。`);
    $("#irodoriReferenceSettings").hidden = !legacy && $("#irodoriModeSelect").value === "design";
    $("#irodoriEmotionStrengthSettings").classList.toggle("is-disabled", !$("#irodoriAutoEmotionToggle").checked);
    $("#irodoriEmotionStrengthSelect").disabled = !$("#irodoriAutoEmotionToggle").checked;
    const selectedV4Model = quantized ? info.int4SampleModel : info.fp16SampleModel;
    syncTtsSampleModelUi("irodori", selectedV4Model || info.sampleModel);
    $("#irodoriModelDownloadHint").textContent = quantized
      ? "約853MBのWebGPU向けW4A16モデルを初回だけ取得し、SHA-256を検証して端末へ保存します。"
      : "約1.7GBのFP16モデルを初回だけ取得し、SHA-256を検証して端末へ保存します。";
    syncTtsSampleModelUi("irodoriV3", info.v3SampleModel);
  }

  function syncSbv2Ui(info = state?.sbv2 || {}) {
    const models = Array.isArray(info.models) ? info.models : [];
    const modelSelect = $("#sbv2ModelSelect");
    modelSelect.replaceChildren();
    if (!models.length) modelSelect.append(new Option(localized("未追加", "Not added"), ""));
    for (const model of models) modelSelect.append(new Option(`${model.name}${model.ready ? "" : localized("（ファイルなし）", " (file missing)")}`, model.id));
    modelSelect.value = info.modelId || "";
    modelSelect.disabled = !models.length;
    const model = models.find((item) => item.id === modelSelect.value);
    $("#sbv2ModelRenameButton").disabled = !model;
    $("#sbv2ModelRemoveButton").disabled = !model;
    const styleSelect = $("#sbv2StyleSelect");
    styleSelect.replaceChildren();
    for (const speaker of model?.speakers || []) {
      for (const style of speaker.styles || []) styleSelect.append(new Option(`${speaker.name} · ${style.name}`, `${speaker.localId}:${style.localId}`));
    }
    if (!styleSelect.options.length) styleSelect.append(new Option(localized("未選択", "Not selected"), "0:0"));
    const selected = `${Number(info.speakerId) || 0}:${Number(info.styleId) || 0}`;
    styleSelect.value = [...styleSelect.options].some((option) => option.value === selected) ? selected : styleSelect.options[0].value;
    styleSelect.disabled = !model;
    const progress = info.runtimeProgress;
    const progressElement = $("#sbv2Progress");
    if (progress && ["dictionary", "deberta"].includes(progress.phase) && Number(progress.total) > 0) {
      progressElement.hidden = false;
      progressElement.value = Math.min(100, Math.round((Number(progress.loaded) / Number(progress.total)) * 100));
    } else progressElement.hidden = true;
    const status = $("#sbv2Status");
    if (!model) setStatus(status, localized("JP-ExtraのAIVMXモデルを追加してください。", "Add a JP-Extra AIVMX model."));
    else if (!model.ready) setStatus(status, localized("保存したモデルファイルが見つかりません。再度追加してください。", "The saved model file is missing. Add it again."), true);
    else if (progress?.phase === "dictionary") setStatus(status, localized("日本語辞書を初回ダウンロードしています…", "Downloading the Japanese dictionary for first use…"));
    else if (progress?.phase === "deberta") setStatus(status, localized("日本語DeBERTaを初回ダウンロードしています…", "Downloading Japanese DeBERTa for first use…"));
    else if (progress?.phase === "loading") setStatus(status, `${progress.device === "webgpu" ? "WebGPU" : "CPU"}${localized("へモデルを読み込んでいます…", " is loading the model…")}`);
    else if (progress?.phase === "ready") setStatus(status, `${progress.device === "webgpu" ? "WebGPU" : "CPU"}${localized("でJP-Extraを利用できます。", " is ready for JP-Extra.")}`);
    else setStatus(status, localized("JP-Extraモデルを利用できます。初回の音声生成では共通モデルを取得します。", "The JP-Extra model is ready. Shared assets will be downloaded on first synthesis."));
  }

  function updateGeneratorProgress(payload = {}) {
    const progress = $("#generatorProgress");
    progress.classList.toggle("is-active", !["done", "error"].includes(payload.phase) && generatorBusy);
    progress.classList.toggle("is-done", payload.phase === "done");
    progress.classList.toggle("is-error", payload.phase === "error");
    if (payload.message) $("#generatorStatus").textContent = payload.message;
  }

  function renderCharacterWorkspace() {
    const workspace = state.characterWorkspace || { activeProjectId: "home", projects: [] };
    const projects = Array.isArray(workspace.projects) ? workspace.projects : [];
    const select = $("#chatWorkProjectSelect");
    select.replaceChildren();
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.home ? "⌂ " : ""}${project.name}${project.available === false ? localized("（見つかりません）", " (missing)") : ""}`;
      option.disabled = project.available === false;
      select.appendChild(option);
    }
    select.value = workspace.activeProjectId || "home";
    select.disabled = state.backend !== "codex" || projects.length === 0;
    $("#addCharacterProjectButton").disabled = state.backend !== "codex";

    const list = $("#characterProjectList");
    list.replaceChildren();
    for (const project of projects) {
      const row = document.createElement("article");
      row.className = `character-project-row${project.id === workspace.activeProjectId ? " is-active" : ""}${project.available === false ? " is-missing" : ""}`;
      const info = document.createElement("div");
      const icon = document.createElement("span");
      icon.className = `ui-symbol ${project.home ? "ui-symbol-character" : "ui-symbol-folder"}`;
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = project.name;
      const detail = document.createElement("small");
      detail.textContent = project.home
        ? localized("キャラ専用 · 記憶、メモ、生成物", "Character-owned · context, notes, outputs")
        : project.available === false
          ? localized("元のフォルダーが見つかりません", "Original folder is missing")
          : project.id === workspace.activeProjectId
            ? localized("現在の作業先", "Current workspace")
            : localized("既存フォルダーへの参照", "Attached existing folder");
      text.append(name, detail);
      info.append(icon, text);
      const actions = document.createElement("div");
      if (project.available !== false) {
        const use = document.createElement("button");
        use.type = "button";
        use.className = "button button-quiet";
        use.textContent = project.id === workspace.activeProjectId ? localized("開く", "Open") : localized("切り替え", "Switch");
        use.addEventListener("click", async () => {
          use.disabled = true;
          try {
            if (project.id !== workspace.activeProjectId) state = await api.activateWorkProject(project.id);
            else await api.openWorkDirectory();
            syncUi();
          } catch (error) { setStatus($("#characterProfileStatus"), error.message, true); }
          finally { use.disabled = false; }
        });
        actions.appendChild(use);
      }
      if (!project.home) {
        const detach = document.createElement("button");
        detach.type = "button";
        detach.className = "button button-quiet character-project-detach";
        detach.textContent = localized("解除", "Remove");
        detach.addEventListener("click", async () => {
          if (!window.confirm(localized(`「${project.name}」をこのキャラの担当から外しますか？\n元のフォルダーやファイルは削除されません。`, `Remove “${project.name}” from this character?\nThe original folder and files will not be deleted.`))) return;
          try { state = await api.detachWorkProject(project.id); syncUi(); }
          catch (error) { setStatus($("#characterProfileStatus"), error.message, true); }
        });
        actions.appendChild(detach);
      }
      row.append(info, actions);
      list.appendChild(row);
    }
  }

  function renderRemoteDevices(remote) {
    const list = $("#remoteDeviceList");
    const devices = Array.isArray(remote.devices) ? remote.devices : [];
    list.replaceChildren();
    $("#remoteDeviceCount").textContent = localized(`${devices.length}台`, `${devices.length} device${devices.length === 1 ? "" : "s"}`);
    if (!devices.length) {
      const empty = document.createElement("p");
      empty.className = "remote-device-empty";
      empty.textContent = localized("まだペアリングした端末はありません。", "No paired devices yet.");
      list.appendChild(empty);
      return;
    }
    const date = (value) => {
      const parsed = new Date(value);
      return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(state?.language === "en" ? "en" : "ja", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed) : "—";
    };
    for (const device of devices) {
      const row = document.createElement("article");
      row.className = "remote-device-row";
      const copy = document.createElement("div");
      copy.className = "remote-device-copy";
      const title = document.createElement("div");
      title.className = "remote-device-title";
      const dot = document.createElement("i");
      dot.classList.toggle("is-connected", Boolean(device.connected));
      const name = document.createElement("strong");
      name.textContent = device.name || localized("名前のない端末", "Unnamed device");
      title.append(dot, name);
      const detail = document.createElement("small");
      detail.textContent = device.connected
        ? localized(`表示中 · ${device.address}`, `Open now · ${device.address}`)
        : localized(`最終接続 ${date(device.lastSeenAt)} · 信頼期限 ${date(device.expiresAt)}`, `Last seen ${date(device.lastSeenAt)} · Trusted until ${date(device.expiresAt)}`);
      copy.append(title, detail);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remote-device-remove";
      remove.textContent = localized("解除", "Disconnect");
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try { state = await api.revokeRemoteSession(device.id); syncUi(); }
        catch (error) { setStatus($("#remoteConnectionSummary"), error.message, true); }
        finally { remove.disabled = false; }
      });
      row.append(copy, remove);
      list.appendChild(row);
    }
  }

  function syncRemoteUi() {
    const remote = state?.remote || {};
    const enabled = Boolean(remote.enabled);
    const active = Boolean(remote.active);
    $("#remoteAccessToggle").checked = enabled;
    $("#remoteEnabledSettings").hidden = !enabled;
    $("#remoteWorkToggle").checked = Boolean(remote.workEnabled);
    $("#remoteTtsToggle").checked = remote.ttsEnabled !== false;
    $("#remotePcAudioToggle").checked = remote.pcAudioEnabled !== false;
    $("#remoteResponseModeSelect").value = remote.responseMode === "live" ? "live" : "tts";
    const remoteLiveOption = [...$("#remoteResponseModeSelect").options].find((option) => option.value === "live");
    if (remoteLiveOption) remoteLiveOption.disabled = state.backend !== "codex";
    $("#remoteTtsToggle").disabled = remote.responseMode === "live";
    $("#remoteSessionSelect").value = String(remote.sessionMinutes || state.remoteSessionMinutes || 60);
    $("#remotePortInput").value = String(remote.port || state.remotePort || 41317);
    const addressSelect = $("#remoteAddressSelect");
    const selectedAddress = remote.bindAddress || remote.address || "";
    addressSelect.replaceChildren();
    for (const item of remote.availableAddresses || []) {
      const option = document.createElement("option");
      option.value = item.address;
      option.textContent = `${item.interfaceName} · ${item.address}`;
      addressSelect.appendChild(option);
    }
    if (!addressSelect.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = localized("プライベートLANが見つかりません", "No private LAN found");
      addressSelect.appendChild(option);
    }
    addressSelect.value = [...addressSelect.options].some((option) => option.value === selectedAddress) ? selectedAddress : addressSelect.options[0].value;
    addressSelect.disabled = !enabled || !remote.availableAddresses?.length;
    const tailscale = remote.tailscale || {};
    const tailscaleManaged = Boolean(tailscale.managed);
    $("#remotePortInput").disabled = !enabled || tailscaleManaged;
    $("#remoteTailscaleHttpsPortInput").value = String(tailscale.httpsPort || state.remoteTailscaleHttpsPort || 443);
    $("#remoteTailscaleHttpsPortInput").disabled = !enabled || tailscaleManaged;
    $("#remoteTailscaleCommand").textContent = tailscale.command || `tailscale serve --bg --https=443 ${remote.port || 41317}`;
    const tailscaleBadge = $("#remoteTailscaleBadge");
    tailscaleBadge.textContent = tailscale.active ? localized("接続中", "Active") : tailscale.installed === false ? localized("未導入", "Not installed") : tailscale.installed === true ? localized("停止中", "Off") : localized("未確認", "Not checked");
    tailscaleBadge.classList.toggle("is-ready", Boolean(tailscale.active));
    const tailscaleUrl = $("#remoteTailscaleUrl");
    tailscaleUrl.hidden = !tailscale.url;
    tailscaleUrl.dataset.url = tailscale.pairingUrl || tailscale.url || "";
    tailscaleUrl.textContent = tailscale.url || localized("HTTPS URLを開く", "Open HTTPS URL");
    $("#refreshRemoteTailscaleButton").disabled = !enabled;
    $("#startRemoteTailscaleButton").disabled = !active || Boolean(tailscale.active);
    $("#stopRemoteTailscaleButton").hidden = !tailscaleManaged;
    $("#stopRemoteTailscaleButton").disabled = !tailscaleManaged;
    setStatus($("#remoteTailscaleStatus"), tailscale.error || (tailscale.active
      ? tailscaleManaged ? localized("CharaDockが管理しているHTTPS接続です。", "This HTTPS route is managed by CharaDock.") : localized("既存のTailscale Serve設定を検出しました。上書きしません。", "An existing Tailscale Serve route was detected and will not be overwritten.")
      : localized("Tailscaleは任意です。通常LANの文字操作だけなら不要です。", "Tailscale is optional and is not needed for text control on the LAN.")), Boolean(tailscale.error));
    const badge = $("#remoteStatusBadge");
    badge.classList.toggle("is-active", active);
    badge.textContent = active ? localized("接続受付中", "Available") : enabled ? localized("開始できません", "Unavailable") : localized("停止中", "Off");
    const qr = $("#remoteQrImage");
    qr.src = active ? remote.qrDataUrl || "" : "";
    const securePairing = Boolean(active && remote.securePairing && remote.pairingTransport === "tailscale");
    qr.alt = securePairing ? localized("Tailscale HTTPS接続用QRコード", "QR code for Tailscale HTTPS") : localized("スマートフォンLAN接続用QRコード", "QR code for phone LAN access");
    $("#remoteQrPlaceholder").textContent = remote.error || (active ? localized("QRコードを準備中…", "Preparing QR code…") : localized("接続を有効にしてください", "Enable phone access"));
    $("#remoteAccessUrl").textContent = remote.url || localized("接続先を準備中", "Preparing address");
    $("#remotePairingTitle").textContent = securePairing ? localized("Tailscale HTTPSで接続", "Connect with Tailscale HTTPS") : localized("QRコードを読み取る", "Scan the QR code");
    const pairingTransport = $("#remotePairingTransport");
    pairingTransport.textContent = securePairing ? "TAILSCALE · HTTPS" : "LOCAL · LAN";
    pairingTransport.classList.toggle("is-secure", securePairing);
    const pairingRouteHint = $("#remotePairingRouteHint");
    pairingRouteHint.textContent = securePairing
      ? localized("このQRコードとコピーURLは、安全なTailscale HTTPSへ直接接続します。", "This QR code and copied URL connect directly over secure Tailscale HTTPS.")
      : localized("Tailscale HTTPSを開始すると、QRコードとコピーURLも安全な接続先へ切り替わります。", "Start Tailscale HTTPS to switch the QR code and copied URL to the secure route.");
    pairingRouteHint.classList.toggle("is-secure", securePairing);
    $("#remotePairingCode").textContent = remote.pairingCode || "--------";
    $("#copyRemoteUrlButton").disabled = !remote.pairingUrl;
    $("#regenerateRemotePairingButton").disabled = !active;
    $("#revokeRemoteSessionsButton").disabled = !active;
    const clients = Number(remote.clients) || 0;
    const connected = Number(remote.connectedClients) || 0;
    setStatus($("#remoteConnectionSummary"), remote.error
      ? remote.error
      : active
        ? localized(`${clients}台をペアリング済み · ${connected}台が表示中`, `${clients} paired · ${connected} currently open`)
        : localized("ローカルLAN接続は停止しています。", "Local LAN access is off."), Boolean(remote.error));
    renderRemoteDevices(remote);
  }

  async function saveRemoteSettings() {
    const toggle = $("#remoteAccessToggle");
    toggle.disabled = true;
    try {
      state = await api.setRemoteConfig({
        enabled: toggle.checked,
        bindAddress: $("#remoteAddressSelect").value,
        workEnabled: $("#remoteWorkToggle").checked,
        ttsEnabled: $("#remoteTtsToggle").checked,
        pcAudioEnabled: $("#remotePcAudioToggle").checked,
        responseMode: $("#remoteResponseModeSelect").value,
        port: Number($("#remotePortInput").value),
        tailscaleHttpsPort: Number($("#remoteTailscaleHttpsPortInput").value),
        sessionMinutes: Number($("#remoteSessionSelect").value),
      });
      syncUi();
    } catch (error) {
      state = await api.getState().catch(() => state);
      if (state?.remote) state.remote.error = error.message;
      syncRemoteUi();
    } finally {
      toggle.disabled = false;
    }
  }

  function syncUi() {
    i18n?.setLanguage(state.language || "ja");
    document.documentElement.dataset.character = state.characterId || "amber-avatar";
    const sidebarCharacter = currentCharacter();
    if (sidebarCharacter) {
      $("#sidebarCharacterPreview").src = sidebarCharacter.thumbnailUrl;
      const initialAssistantLabel = $("#initialAssistantLabel");
      if (initialAssistantLabel) initialAssistantLabel.textContent = sidebarCharacter.name;
      const initialAvatar = $("#chatLog .message.is-assistant .message-avatar");
      if (initialAvatar) initialAvatar.textContent = [...sidebarCharacter.name][0];
    }
    if (renderedConversationCharacterId !== state.characterId && chatHistoryView === "conversation") {
      renderedConversationCharacterId = state.characterId;
      renderConversationHistory(state.conversationHistory);
    }
    workHistoryState = state.workHistory && Array.isArray(state.workHistory.runs) ? state.workHistory : workHistoryState;
    $("#interactionModeBadge").textContent = state.interactionMode === "work" ? "Work" : "Chat";
    renderCharacterWorkspace();
    syncRemoteUi();
    $("#openChatWorkDirectoryButton").disabled = !state.hasWorkDirectory;
    $("#chatComposerHint").textContent = state.interactionMode === "work"
      ? localized("Work · 選択フォルダー内へ書き込みできます", "Work · Can write inside the selected folder")
      : localized("設定画面では文字入力のみ", "Text input only in Settings");
    if (chatHistoryView === "work") renderWorkHistory(workHistoryState);
    renderCharacters();
    syncCharacterEditor();
    syncGeneratorUi();
    const backend = $(`input[name="backend"][value="${state.backend}"]`);
    if (backend) backend.checked = true;
    $("#openaiModelInput").value = state.openaiModel || "";
    $("#transcriptionModelInput").value = state.transcriptionModel || "";
    setCodexModelOptions($("#codexChatModelInput"), state.codexChatModel || state.codexModel || "");
    $("#codexChatReasoningEffortSelect").value = state.codexChatReasoningEffort || "";
    setCodexModelOptions($("#codexWorkModelInput"), state.codexWorkModel || state.codexModel || "");
    $("#codexWorkReasoningEffortSelect").value = state.codexWorkReasoningEffort || "";
    $("#languageSelect").value = state.language || "ja";
    $("#alwaysOnTopToggle").checked = Boolean(state.alwaysOnTop);
    const pointerMode = state.mascotPointerMode || (state.clickThrough ? "click-through" : "interactive");
    const pointerModeInput = $(`input[name="mascotPointerMode"][value="${pointerMode}"]`);
    if (pointerModeInput) pointerModeInput.checked = true;
    $("#mouseFollowToggle").checked = Boolean(state.mouseFollow);
    $("#launchAtLoginToggle").checked = Boolean(state.launchAtLogin);
    $("#ttsToggle").checked = Boolean(state.ttsEnabled);
    $("#characterTtsLabel").textContent = state.characterTts?.characterName || "このキャラクター";
    syncRealtimeVoiceUi();
    syncBeatriceUi();
    $("#ttsProviderSelect").value = state.ttsProvider || "system";
    $("#styleBertVits2UrlInput").value = state.styleBertVits2Url || "http://localhost:5000";
    $("#styleBertVits2ModelIdInput").value = Number(state.styleBertVits2ModelId) || 0;
    $("#styleBertVits2SpeedInput").value = Number(state.styleBertVits2Speed) || 1;
    $("#styleBertVits2Settings").hidden = $("#ttsProviderSelect").value !== "style-bert-vits2";
    $("#sbv2StyleWeightInput").value = Number.isFinite(Number(state.sbv2StyleWeight)) ? Number(state.sbv2StyleWeight) : 1;
    $("#sbv2SpeedInput").value = Number(state.sbv2Speed) || 1;
    $("#sbv2DeviceSelect").value = state.sbv2Device || "auto";
    $("#sbv2Settings").hidden = $("#ttsProviderSelect").value !== "sbv2-jp-extra";
    syncSbv2Ui();
    $("#piperPlusSpeedInput").value = Number(state.piperPlusSpeed) || 1;
    $("#piperPlusSettings").hidden = $("#ttsProviderSelect").value !== "piper-plus";
    syncPiperPlusUi();
    $("#supertonicVoiceSelect").value = state.supertonicVoice || "F1";
    $("#supertonicSpeedInput").value = Number(state.supertonicSpeed) || 1;
    $("#supertonicStepsInput").value = Number(state.supertonicSteps) || 8;
    $("#supertonicSettings").hidden = $("#ttsProviderSelect").value !== "supertonic-3";
    syncSupertonicUi();
    $("#kokoroVoiceSelect").value = state.kokoroVoice || "jf_alpha";
    $("#kokoroSpeedInput").value = Number(state.kokoroSpeed) || 1;
    $("#kokoroDeviceSelect").value = state.kokoroDevice || "auto";
    $("#kokoroSettings").hidden = $("#ttsProviderSelect").value !== "kokoro";
    syncKokoroUi();
    $("#irodoriSpeedInput").value = Number(state.irodoriSpeed) || 1;
    $("#irodoriVersionSelect").value = state.irodoriVersion === "500m-v3" ? "500m-v3" : "v4-small";
    $("#irodoriPrecisionSelect").value = state.irodoriPrecision === "int4" ? "int4" : "fp16";
    $("#irodoriModeSelect").value = state.irodoriMode || "reference";
    $("#irodoriCaptionInput").value = state.irodoriCaption || "自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。";
    $("#irodoriAutoEmotionToggle").checked = state.irodoriAutoEmotion !== false;
    $("#irodoriEmotionStrengthSelect").value = ["subtle", "natural", "expressive"].includes(state.irodoriEmotionStrength) ? state.irodoriEmotionStrength : "natural";
    $("#irodoriCfgExecutionSelect").value = state.irodoriCfgExecution || "sequential";
    $("#irodoriSamplingModeSelect").value = state.irodoriSamplingMode || "sway";
    $("#irodoriStepsInput").value = Number(state.irodoriSteps) || 8;
    $("#irodoriSeedInput").value = Number(state.irodoriSeed) || 0;
    $("#irodoriSettings").hidden = $("#ttsProviderSelect").value !== "irodori-webgpu";
    syncIrodoriUi();
    $("#englishPronunciationToggle").checked = state.englishPronunciationEnabled !== false;
    $("#englishPronunciationDictionaryInput").value = state.englishPronunciationDictionary || "";
    $("#speechInputProviderSelect").value = state.speechInputProvider || "browser";
    $("#sherpaOnnxSettings").hidden = $("#speechInputProviderSelect").value !== "sherpa-onnx";
    const recordedSpeechSelected = ["sherpa-onnx", "openai"].includes($("#speechInputProviderSelect").value);
    $("#voiceActivationSettings").hidden = !recordedSpeechSelected;
    $("#voiceActivationModeSelect").value = state.voiceActivationMode || "vad";
    $("#vadSensitivitySelect").value = state.vadSensitivity || "normal";
    $("#voiceAutoSendToggle").checked = state.voiceAutoSend !== false;
    $("#voiceAutoSendCountdownToggle").checked = state.voiceAutoSendCountdown !== false;
    const autoSendDelay = [1000, 1500, 2000, 3000, 5000].includes(Number(state.voiceAutoSendDelayMs)) ? Number(state.voiceAutoSendDelayMs) : 1500;
    $("#voiceAutoSendDelaySelect").value = String(autoSendDelay);
    const countdownSettings = $("#voiceAutoSendCountdownSettings");
    countdownSettings.classList.toggle("is-disabled", !$("#voiceAutoSendToggle").checked);
    $("#voiceAutoSendCountdownToggle").disabled = !$("#voiceAutoSendToggle").checked;
    $("#voiceAutoSendDelaySelect").disabled = !$("#voiceAutoSendToggle").checked || !$("#voiceAutoSendCountdownToggle").checked;
    syncSherpaModelUi(state.sherpaModel);
    syncVoiceRoutingUi();
    $("#positionLockedToggle").checked = Boolean(state.positionLocked);
    $("#edgeSnapToggle").checked = Boolean(state.edgeSnap);
    const displaySelect = $("#displaySelect");
    displaySelect.replaceChildren(new Option("自動（メインモニター）", ""));
    for (const display of state.displays || []) displaySelect.appendChild(new Option(display.label, display.id));
    displaySelect.value = state.preferredDisplayId || "";
    $("#apiKeyState").textContent = state.hasApiKey
      ? `APIキー設定済み（${state.apiKeyPersistence === "encrypted" ? "暗号化保存" : "今回のみ"}）`
      : "APIキー未設定";
    $("#connectionLabel").textContent = state.backend === "codex" && codexAccount?.signedIn ? "Codex · ChatGPT" : state.backend === "codex" ? "Codex app-server" : "OpenAI API";
    $("#connectionDetail").textContent = state.backend === "codex" && codexAccount?.signedIn
      ? `ログイン済み${codexAccount.planType ? ` · ${codexAccount.planType}` : ""}`
      : state.backend === "codex" ? "アカウント確認中" : state.hasApiKey ? "APIキー設定済み" : "APIキー未設定";
    $("#connectionPill").classList.toggle("is-error", state.backend === "openai" && !state.hasApiKey);
    setStatus($("#chatStatus"), state.backend === "codex" ? "Codex app-serverを使用します。" : "OpenAI Responses APIを使用します。");
    syncUpdateUi();
    syncOnboarding();
  }

  async function refreshCodexAccount() {
    const label = $("#codexAccountState");
    const button = $("#codexLoginButton");
    const onboardingLabel = $("#onboardingAccountState");
    const onboardingButton = $("#onboardingLoginButton");
    button.disabled = true;
    onboardingButton.disabled = true;
    try {
      const account = await api.getCodexAccount();
      codexAccount = account;
      button.dataset.action = account.signedIn ? "logout" : "login";
      button.textContent = account.signedIn ? "ChatGPTからログアウト" : "ChatGPTでログイン";
      button.classList.toggle("button-secondary", !account.signedIn);
      button.classList.toggle("button-quiet", account.signedIn);
      if (account.type === "chatgpt") {
        label.textContent = `ChatGPTログイン済み（${account.planType || "プラン不明"}）`;
        onboardingLabel.textContent = `ChatGPTログイン済み（${account.planType || "プラン不明"}）`;
        onboardingButton.textContent = "接続済み";
        if (state.backend === "codex") {
          $("#connectionLabel").textContent = "Codex · ChatGPT";
          $("#connectionDetail").textContent = `ログイン済み${account.planType ? ` · ${account.planType}` : ""}`;
        }
        return true;
      }
      if (account.signedIn) {
        label.textContent = `${account.type || "Codex"} でログイン済み`;
        onboardingLabel.textContent = `${account.type || "Codex"} でログイン済み`;
        onboardingButton.textContent = "接続済み";
        if (state.backend === "codex") {
          $("#connectionLabel").textContent = "Codex app-server";
          $("#connectionDetail").textContent = "ログイン済み";
        }
        return true;
      }
      label.textContent = "ChatGPTにログインしていません。";
      onboardingLabel.textContent = "ChatGPTにログインしていません。";
      onboardingButton.textContent = "ChatGPTでログイン";
      if (state.backend === "codex") $("#connectionDetail").textContent = "ChatGPT未ログイン";
      return false;
    } catch (error) {
      codexAccount = null;
      button.dataset.action = "login";
      button.textContent = "ChatGPTでログイン";
      label.textContent = `Codex CLIを確認できません: ${error.message}`;
      onboardingLabel.textContent = `Codex CLIを確認できません: ${error.message}`;
      onboardingButton.textContent = "再確認";
      if (state.backend === "codex") $("#connectionDetail").textContent = "接続を確認できません";
      return false;
    } finally {
      button.disabled = false;
      onboardingButton.disabled = Boolean(codexAccount?.signedIn);
      syncOnboardingReadiness();
    }
  }

  async function waitForCodexLogin() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (await refreshCodexAccount()) {
        await refreshCodexModels();
        await refreshRealtimeVoices();
        setStatus($("#connectionStatus"), "ChatGPTログインを確認しました。");
        return;
      }
    }
    setStatus($("#connectionStatus"), "ログイン確認が時間切れになりました。接続テストでも再確認できます。", true);
  }

  async function saveSettings() {
    state = await api.saveSettings({
      language: $("#languageSelect").value,
      backend: $("input[name='backend']:checked")?.value || "codex",
      openaiModel: $("#openaiModelInput").value.trim(),
      transcriptionModel: $("#transcriptionModelInput").value.trim(),
      codexChatModel: $("#codexChatModelInput").value.trim(),
      codexChatReasoningEffort: $("#codexChatReasoningEffortSelect").value,
      codexWorkModel: $("#codexWorkModelInput").value.trim(),
      codexWorkReasoningEffort: $("#codexWorkReasoningEffortSelect").value,
      alwaysOnTop: $("#alwaysOnTopToggle").checked,
      mascotPointerMode: $('input[name="mascotPointerMode"]:checked')?.value || "interactive",
      mouseFollow: $("#mouseFollowToggle").checked,
      launchAtLogin: $("#launchAtLoginToggle").checked,
      ttsEnabled: $("#ttsToggle").checked,
      ttsProvider: $("#ttsProviderSelect").value,
      realtimeVoice: $("#realtimeVoiceSelect").value,
      realtimeVoiceConversion: $("#realtimeVoiceConversionSelect").value,
      beatriceModelId: $("#beatriceModelSelect").value,
      beatriceVoiceId: Number($("#beatriceVoiceSelect").value) || 0,
      beatricePitchShift: Number($("#beatricePitchShiftInput").value),
      beatriceFormantShift: Number($("#beatriceFormantShiftInput").value),
      beatriceInputGain: Number($("#beatriceInputGainInput").value),
      beatriceOutputGain: Number($("#beatriceOutputGainInput").value),
      beatriceIntonation: Number($("#beatriceIntonationInput").value),
      beatricePitchCorrection: Number($("#beatricePitchCorrectionInput").value),
      beatricePitchCorrectionType: Number($("#beatricePitchCorrectionTypeSelect").value),
      styleBertVits2Url: $("#styleBertVits2UrlInput").value.trim(),
      styleBertVits2ModelId: Number($("#styleBertVits2ModelIdInput").value),
      styleBertVits2Speed: Number($("#styleBertVits2SpeedInput").value),
      piperPlusSpeed: Number($("#piperPlusSpeedInput").value),
      supertonicVoice: $("#supertonicVoiceSelect").value,
      supertonicSpeed: Number($("#supertonicSpeedInput").value),
      supertonicSteps: Number($("#supertonicStepsInput").value),
      kokoroVoice: $("#kokoroVoiceSelect").value,
      kokoroSpeed: Number($("#kokoroSpeedInput").value),
      kokoroDevice: $("#kokoroDeviceSelect").value,
      irodoriVoiceId: $("#irodoriVoiceSelect").value,
      irodoriVersion: $("#irodoriVersionSelect").value,
      irodoriPrecision: $("#irodoriPrecisionSelect").value,
      irodoriMode: $("#irodoriModeSelect").value,
      irodoriCaption: $("#irodoriCaptionInput").value,
      irodoriAutoEmotion: $("#irodoriAutoEmotionToggle").checked,
      irodoriEmotionStrength: $("#irodoriEmotionStrengthSelect").value,
      irodoriCfgExecution: $("#irodoriCfgExecutionSelect").value,
      irodoriSpeed: Number($("#irodoriSpeedInput").value),
      irodoriSamplingMode: $("#irodoriSamplingModeSelect").value,
      irodoriSteps: Number($("#irodoriStepsInput").value),
      irodoriSeed: Number($("#irodoriSeedInput").value),
      sbv2ModelId: $("#sbv2ModelSelect").value,
      sbv2SpeakerId: Number($("#sbv2StyleSelect").value.split(":")[0]) || 0,
      sbv2StyleId: Number($("#sbv2StyleSelect").value.split(":")[1]) || 0,
      sbv2StyleWeight: Number($("#sbv2StyleWeightInput").value),
      sbv2Speed: Number($("#sbv2SpeedInput").value),
      sbv2Device: $("#sbv2DeviceSelect").value,
      englishPronunciationEnabled: $("#englishPronunciationToggle").checked,
      englishPronunciationDictionary: $("#englishPronunciationDictionaryInput").value,
      speechInputProvider: $("#speechInputProviderSelect").value,
      sherpaModelId: $("#sherpaModelSelect").value || state?.sherpaModelId,
      speechLanguage: state?.speechLanguage || "ja-JP",
      voiceActivationMode: $("#voiceActivationModeSelect").value,
      vadSensitivity: $("#vadSensitivitySelect").value,
      voiceAutoSend: $("#voiceAutoSendToggle").checked,
      voiceAutoSendCountdown: $("#voiceAutoSendCountdownToggle").checked,
      voiceAutoSendDelayMs: Number($("#voiceAutoSendDelaySelect").value),
      updateChecksEnabled: $("#updateChecksToggle").checked,
      updateChannel: $("#updateChannelSelect").value,
      positionLocked: $("#positionLockedToggle").checked,
      edgeSnap: $("#edgeSnapToggle").checked,
      preferredDisplayId: $("#displaySelect").value,
    });
    syncUi();
  }

  async function ensureAudioStream() {
    if (audioStream?.active) return audioStream;
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    return audioStream;
  }

  async function startLipSync() {
    await ensureAudioStream();
    audioContext ||= new AudioContext();
    analyser ||= audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.45;
    const source = audioContext.createMediaStreamSource(audioStream);
    source.connect(analyser);
    lipSyncActive = true;
    $("#micLipSyncButton")?.setAttribute("aria-pressed", "true");
    const samples = new Uint8Array(analyser.fftSize);
    const update = (now) => {
      if (!lipSyncActive) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const sample = (value - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      const level = Math.min(2, rms * 9);
      const meter = $("#micMeter i");
      if (meter) meter.style.width = `${Math.min(100, level * 85)}%`;
      if (now - lastVoiceSentAt > 48) {
        lastVoiceSentAt = now;
        api.sendVoiceLevel(level).catch(() => {});
      }
      meterFrame = requestAnimationFrame(update);
    };
    meterFrame = requestAnimationFrame(update);
  }

  function stopLipSync() {
    lipSyncActive = false;
    cancelAnimationFrame(meterFrame);
    $("#micLipSyncButton")?.setAttribute("aria-pressed", "false");
    const meter = $("#micMeter i");
    if (meter) meter.style.width = "0%";
    api.sendVoiceLevel(0).catch(() => {});
  }

  async function toggleLipSync() {
    try {
      if (lipSyncActive) stopLipSync();
      else await startLipSync();
    } catch (error) {
      setStatus($("#chatStatus"), `マイクを開始できません: ${error.message}`, true);
    }
  }

  function startBrowserSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return false;
    if (speechRecognition) {
      speechRecognition.stop();
      return true;
    }
    speechRecognition = new Recognition();
    speechRecognition.lang = state.speechLanguage || "ja-JP";
    speechRecognition.interimResults = true;
    speechRecognition.continuous = false;
    let finalText = "";
    speechRecognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const value = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += value;
        else interim += value;
      }
      $("#chatInput").value = finalText + interim;
    };
    speechRecognition.onerror = (event) => setStatus($("#chatStatus"), `音声入力: ${event.error}`, true);
    speechRecognition.onend = () => {
      speechRecognition = null;
      $("#speechInputButton")?.setAttribute("aria-pressed", "false");
      setStatus($("#chatStatus"), finalText ? "音声を入力欄へ追加しました。" : "音声入力を終了しました。");
    };
    speechRecognition.start();
    $("#speechInputButton")?.setAttribute("aria-pressed", "true");
    setStatus($("#chatStatus"), "話してください…");
    return true;
  }

  async function startFallbackSpeechInput(message = "端末音声認識へ切り替えました。") {
    setStatus($("#chatStatus"), message, true);
    try {
      if (speechRecognition || mediaRecorder?.state === "recording") return true;
      if (startBrowserSpeechRecognition()) return true;
      await toggleRecordedSpeechInput();
      return true;
    } catch (error) {
      setStatus($("#chatStatus"), `音声入力を開始できません: ${error.message}`, true);
      return false;
    }
  }

  async function decodeRecordedAudio(blob) {
    audioContext ||= new AudioContext();
    await audioContext.resume();
    const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const values = decoded.getChannelData(channel);
      for (let index = 0; index < values.length; index += 1) samples[index] += values[index] / decoded.numberOfChannels;
    }
    return { samples, sampleRate: Math.round(decoded.sampleRate) };
  }

  async function transcribeWithSherpaOnnx(blob) {
    const { samples, sampleRate } = await decodeRecordedAudio(blob);
    if (!samples.length) throw new Error("録音された音声が空です。");
    if (samples.byteLength > 60 * 1024 * 1024) throw new Error("録音が長すぎます。短く区切ってください。");
    return api.transcribeSherpa({ samples, sampleRate });
  }

  function closeRealtimeAudio() {
    realtimeStartGeneration += 1;
    try { realtimeDataChannel?.close(); } catch {}
    try { realtimePeerConnection?.close(); } catch {}
    realtimeRemoteAudio?.pause();
    if (realtimeRemoteAudio) realtimeRemoteAudio.srcObject = null;
    realtimeDataChannel = null;
    realtimePeerConnection = null;
    realtimeRemoteAudio = null;
    stopRealtimeOutputMeter();
    realtimeBeatriceConverter?.stop().catch(() => {});
    realtimeBeatriceConverter = null;
    realtimeStarting = false;
    realtimeUserTranscript = "";
    realtimeAssistantText = "";
    realtimeAssistantActive = false;
    $("#speechInputButton")?.setAttribute("aria-pressed", "false");
  }

  function reportRealtimeOutputRms(rawRms, now = performance.now()) {
    if (!(Number(rawRms) > 0)) {
      realtimeSpeechEnvelope.reset();
      api.sendVoiceLevel(0).catch(() => {});
      return;
    }
    const level = realtimeSpeechEnvelope.sample(rawRms, now);
    if (now - realtimeMeterLastSentAt < 32) return;
    realtimeMeterLastSentAt = now;
    api.sendVoiceLevel(level).catch(() => {});
  }

  function stopRealtimeOutputMeter() {
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
    reportRealtimeOutputRms(0);
  }

  async function startRealtimeOutputMeter(stream) {
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
      reportRealtimeOutputRms(Math.sqrt(sum / realtimeMeterSamples.length), now);
      realtimeMeterFrame = requestAnimationFrame(update);
    };
    realtimeMeterFrame = requestAnimationFrame(update);
  }

  async function stopCodexRealtimeVoice({ quiet = false } = {}) {
    if (!realtimePeerConnection && !realtimeStarting) return false;
    try {
      await api.stopCodexRealtime();
    } catch (error) {
      if (!quiet) setStatus($("#chatStatus"), `音声会話の終了: ${error.message}`, true);
    } finally {
      closeRealtimeAudio();
    }
    if (!quiet) setStatus($("#chatStatus"), "Codex Realtime音声入力を終了しました。");
    return true;
  }

  function playRealtimeRemoteStream(stream) {
    realtimeRemoteAudio?.pause();
    realtimeRemoteAudio = new Audio();
    realtimeRemoteAudio.autoplay = true;
    realtimeRemoteAudio.muted = false;
    realtimeRemoteAudio.srcObject = stream;
    realtimeRemoteAudio.play().catch(() => {});
    startRealtimeOutputMeter(stream).catch(() => reportRealtimeOutputRms(0));
  }

  async function startCodexRealtimeVoice() {
    const startGeneration = ++realtimeStartGeneration;
    realtimeStarting = true;
    stopSpeechPlayback();
    try {
      const stream = await ensureAudioStream();
      if (startGeneration !== realtimeStartGeneration) throw new Error("Live connection was cancelled.");
      const peer = new RTCPeerConnection();
      realtimePeerConnection = peer;
      realtimeUserTranscript = "";
      realtimeAssistantMessage = null;
      realtimeAssistantText = "";
      realtimeAssistantActive = false;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.addEventListener("track", async (event) => {
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        if (state.realtimeVoiceConversion === "beatrice-v2") {
          try {
            const converter = new window.RealtimeBeatriceConverter(api, (error) => {
              if (realtimeBeatriceConverter !== converter || !realtimePeerConnection) return;
              setStatus($("#chatStatus"), `Beatrice 2の変換を継続できないため元の声へ戻しました: ${error.message}`, true);
              realtimeBeatriceConverter = null;
              converter.stop().finally(() => { if (realtimePeerConnection) playRealtimeRemoteStream(remoteStream); });
            }, reportRealtimeOutputRms);
            realtimeBeatriceConverter = converter;
            converter.setMuted(false);
            await converter.start(remoteStream);
            setStatus($("#chatStatus"), "Beatrice 2でRealtime音声を変換中です。");
            return;
          } catch (error) {
            realtimeBeatriceConverter?.stop().catch(() => {});
            realtimeBeatriceConverter = null;
            setStatus($("#chatStatus"), `Beatrice 2を開始できないため元の声で再生します: ${error.message}`, true);
          }
        }
        playRealtimeRemoteStream(remoteStream);
      });
      realtimeDataChannel = peer.createDataChannel("oai-events");
      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          setStatus($("#chatStatus"), "Codex Realtime音声接続が切れました。", true);
          api.stopCodexRealtime().catch(() => {});
          closeRealtimeAudio();
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (startGeneration !== realtimeStartGeneration) throw new Error("Live connection was cancelled.");
      await api.startCodexRealtime({ sdp: peer.localDescription?.sdp || offer.sdp });
      if (startGeneration !== realtimeStartGeneration) {
        await api.stopCodexRealtime().catch(() => {});
        throw new Error("Live connection was cancelled.");
      }
      realtimeStarting = false;
      $("#speechInputButton")?.setAttribute("aria-pressed", "true");
      setStatus($("#chatStatus"), "Codex Realtimeへ接続中…そのまま話してください。");
    } catch (error) {
      if (startGeneration === realtimeStartGeneration) realtimeStarting = false;
      throw error;
    }
  }

  async function handleCodexRealtimeEvent(message = {}) {
    const method = String(message.method || "");
    const params = message.params || {};
    if (method === "thread/realtime/sdp") {
      if (realtimePeerConnection && params.sdp) {
        await realtimePeerConnection.setRemoteDescription({ type: "answer", sdp: String(params.sdp) });
      }
      return;
    }
    if (method === "thread/realtime/started") {
      setStatus($("#chatStatus"), "Codex Realtime音声入力中。もう一度押すと終了します。");
      return;
    }
    if (method === "thread/realtime/transcript/delta") {
      const delta = String(params.delta || "");
      if (params.role === "user") {
        realtimeUserTranscript += delta;
        $("#chatInput").value = realtimeUserTranscript;
        setStatus($("#chatStatus"), "聞き取っています…");
      }
      if (params.role === "assistant") {
        if (!realtimeAssistantActive) {
          realtimeAssistantActive = true;
          realtimeAssistantMessage = state?.interactionMode === "work" && streamingMessage
            ? streamingMessage
            : null;
          realtimeAssistantText = "";
        }
        realtimeAssistantText += delta;
        if (!realtimeAssistantMessage) realtimeAssistantMessage = appendMessage("assistant", "");
        realtimeAssistantMessage.querySelector("p").textContent = realtimeAssistantText;
        $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
      }
      return;
    }
    if (method === "thread/realtime/transcript/done") {
      const text = String(params.text || "").trim();
      if (params.role === "user" && text) {
        if (text !== realtimePendingTypedText) appendMessage("user", text);
        realtimePendingTypedText = "";
        realtimeUserTranscript = "";
        $("#chatInput").value = "";
        if (state?.interactionMode === "work" && !streamingMessage) {
          streamingMessage = appendMessage("assistant", localized("考え中", "Thinking"), true);
          streamingMessage.dataset.realtimeWork = "true";
          setChatBusy(true);
        }
        if (!realtimeAssistantActive) {
          realtimeAssistantMessage = state?.interactionMode === "work" ? streamingMessage : null;
          realtimeAssistantText = "";
        }
        setStatus($("#chatStatus"), "Codexが考えています…");
      }
      if (params.role === "assistant") {
        if (text) {
          if (!realtimeAssistantMessage) realtimeAssistantMessage = appendMessage("assistant", text);
          else realtimeAssistantMessage.querySelector("p").textContent = text;
          realtimeAssistantText = text;
          setStatus($("#chatStatus"), "Codex Realtimeから応答しました。");
        }
        realtimeAssistantActive = false;
      }
      return;
    }
    if (method === "thread/realtime/error") {
      realtimeUnavailable ||= Boolean(params.unavailable);
      closeRealtimeAudio();
      setStatus($("#chatStatus"), params.message || "Codex Realtime音声接続を開始できませんでした。", true);
      return;
    }
    if (method === "thread/realtime/closed") {
      closeRealtimeAudio();
      setStatus($("#chatStatus"), "Codex Realtime音声入力を終了しました。");
    }
  }

  async function toggleRecordedSpeechInput(provider = "openai") {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    const stream = await ensureAudioStream();
    recordedChunks = [];
    recordingProvider = provider;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.push(event.data); };
    mediaRecorder.onstop = async () => {
      $("#speechInputButton")?.setAttribute("aria-pressed", "false");
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        if (recordingProvider === "sherpa-onnx") {
          setStatus($("#chatStatus"), "sherpa-onnxで音声を文字にしています…");
          $("#chatInput").value = await transcribeWithSherpaOnnx(blob);
        } else {
          setStatus($("#chatStatus"), "OpenAIで音声を文字にしています…");
          const bytes = new Uint8Array(await blob.arrayBuffer());
          $("#chatInput").value = await api.transcribe({ bytes, mimeType: blob.type });
        }
        setStatus($("#chatStatus"), "音声を入力欄へ追加しました。");
      } catch (error) {
        setStatus($("#chatStatus"), error.message, true);
      } finally {
        setChatBusy(false);
        streamingMessage = null;
      }
    };
    mediaRecorder.start();
    $("#speechInputButton")?.setAttribute("aria-pressed", "true");
    setStatus($("#chatStatus"), `${provider === "sherpa-onnx" ? "sherpa-onnx用に" : ""}録音中…もう一度押すと文字に変換します。`);
  }

  async function toggleSpeechInput() {
    if (speechRecognition) {
      speechRecognition.stop();
      return;
    }
    if (mediaRecorder?.state === "recording") {
      await toggleRecordedSpeechInput();
      return;
    }
    if (realtimePeerConnection || realtimeStarting) {
      await stopCodexRealtimeVoice();
      return;
    }
    const provider = state.speechInputProvider || "browser";
    if (provider === "browser") {
      if (!startBrowserSpeechRecognition()) setStatus($("#chatStatus"), "この端末では音声認識を利用できません。", true);
      return;
    }
    if (provider === "sherpa-onnx") {
      await toggleRecordedSpeechInput("sherpa-onnx");
      return;
    }
    if (provider === "openai") {
      await toggleRecordedSpeechInput("openai");
      return;
    }
    if (provider === "realtime" && state.backend !== "codex") {
      setStatus($("#chatStatus"), "Codex RealtimeはCodex app-server接続時のみ利用できます。", true);
      return;
    }
    if (provider === "realtime" && state.backend === "codex" && !realtimeUnavailable) {
      try {
        await startCodexRealtimeVoice();
        return;
      } catch (error) {
        api.stopCodexRealtime().catch(() => {});
        closeRealtimeAudio();
        realtimeUnavailable ||= /まだ提供されていません/.test(error.message);
        setStatus($("#chatStatus"), `Codex Realtimeを利用できません: ${error.message}`, true);
        return;
      }
    }
    if (provider === "realtime") {
      setStatus($("#chatStatus"), "Codex Realtimeは現在利用できません。設定から別の認識方式を選んでください。", true);
      return;
    }
    await startFallbackSpeechInput("端末音声認識を使います。");
  }

  function stopSpeechPulse() {
    clearInterval(speechPulseTimer);
    speechPulseTimer = null;
    cancelAnimationFrame(speechAudioFrame);
    speechAudioFrame = 0;
    try { speechAudioSource?.disconnect(); } catch {}
    speechAudioSource = null;
    speechEnvelope.reset();
    api.sendVoiceLevel(0).catch(() => {});
  }

  async function startMeasuredSpeechPulse(audio) {
    stopSpeechPulse();
    speechAudioContext ||= new AudioContext();
    if (speechAudioContext.state === "suspended") await speechAudioContext.resume();
    speechAudioAnalyser ||= speechAudioContext.createAnalyser();
    speechAudioAnalyser.fftSize = 1024;
    speechAudioAnalyser.smoothingTimeConstant = 0.1;
    speechAudioSamples ||= new Float32Array(speechAudioAnalyser.fftSize);
    speechAudioSource = speechAudioContext.createMediaElementSource(audio);
    speechAudioSource.connect(speechAudioAnalyser);
    if (!speechAudioGraphConnected) {
      speechAudioAnalyser.connect(speechAudioContext.destination);
      speechAudioGraphConnected = true;
    }
    let lastSentAt = 0;
    const update = (now) => {
      if (audio !== speechAudio || audio.paused || audio.ended) return;
      speechAudioAnalyser.getFloatTimeDomainData(speechAudioSamples);
      let sum = 0;
      for (const sample of speechAudioSamples) sum += sample * sample;
      const level = speechEnvelope.sample(Math.sqrt(sum / speechAudioSamples.length), now);
      if (now - lastSentAt >= 32) {
        lastSentAt = now;
        api.sendVoiceLevel(level).catch(() => {});
      }
      speechAudioFrame = requestAnimationFrame(update);
    };
    speechAudioFrame = requestAnimationFrame(update);
  }

  function stopSpeechPlayback() {
    speechPlaybackToken += 1;
    if (speechTtsStreamId) api.cancelTtsStream(speechTtsStreamId).catch(() => {});
    speechTtsStreamId = "";
    window.speechSynthesis?.cancel();
    if (speechAudio) {
      speechAudio.pause();
      speechAudio.src = "";
      speechAudio = null;
    }
    stopSpeechPulse();
  }

  function playGeneratedAudio(source, token, playbackRate = 1) {
    return new Promise((resolve, reject) => {
      if (token !== speechPlaybackToken) return resolve();
      speechAudio = new Audio(source);
      speechAudio.preload = "auto";
      speechAudio.muted = false;
      speechAudio.volume = 1;
      speechAudio.playbackRate = Math.min(2, Math.max(.5, Number(playbackRate) || 1));
      speechAudio.preservesPitch = true;
      speechAudio.onplay = () => startMeasuredSpeechPulse(speechAudio).catch(() => {});
      speechAudio.onended = () => {
        stopSpeechPulse();
        resolve();
      };
      speechAudio.onerror = () => {
        const detail = ({ 1: "再生が中断されました", 2: "音声データを読み込めません", 3: "音声形式をデコードできません", 4: "音声形式に対応していません" })[speechAudio.error?.code];
        reject(new Error(`生成した音声を再生できません${detail ? `（${detail}）` : ""}。`));
      };
      speechAudio.play().catch(reject);
    });
  }

  async function playGeneratedResult(result, token) {
    let sources = Array.isArray(result?.audioDataUrls) ? result.audioDataUrls : [];
    let streamId = String(result?.streamId || "");
    speechTtsStreamId = streamId;
    try {
      while (sources.length) {
        const nextPromise = streamId ? api.nextTtsChunk(streamId) : null;
        for (const source of sources) {
          if (token !== speechPlaybackToken) return;
          await playGeneratedAudio(source, token, result?.playbackRate);
        }
        if (!nextPromise || token !== speechPlaybackToken) break;
        const next = await nextPromise;
        sources = next?.audioDataUrl ? [next.audioDataUrl] : [];
        if (next?.done) streamId = "";
        speechTtsStreamId = streamId;
      }
    } finally {
      if (streamId) api.cancelTtsStream(streamId).catch(() => {});
      speechTtsStreamId = "";
    }
  }

  async function speakResponse(text) {
    if (!state.ttsEnabled) return;
    stopSpeechPlayback();
    const token = speechPlaybackToken;
    if (["style-bert-vits2", "piper-plus", "supertonic-3", "irodori-webgpu", "kokoro", "sbv2-jp-extra"].includes(state.ttsProvider)) {
      try {
        const providerName = { "piper-plus": "piper-plus", "supertonic-3": "Supertonic 3", "irodori-webgpu": "Irodori TTS", kokoro: "Kokoro", "style-bert-vits2": "Style-Bert-VITS2", "sbv2-jp-extra": "Style-Bert-VITS2 JP-Extra" }[state.ttsProvider];
        setStatus($("#ttsStatus"), `${providerName}で生成しています…`);
        const result = await api.synthesizeTts(text);
        const sources = result?.audioDataUrls || [];
        if (!sources.length) throw new Error(`${providerName}から音声データが返されませんでした。音声出力がONか確認してください。`);
        await playGeneratedResult(result, token);
        if (token === speechPlaybackToken) setStatus($("#ttsStatus"), "接続と再生を確認しました。");
      } catch (error) {
        if (token === speechPlaybackToken) setStatus($("#ttsStatus"), error.message, true);
      } finally {
        if (token === speechPlaybackToken) {
          speechAudio = null;
          stopSpeechPulse();
        }
      }
      return;
    }
    if (!window.speechSynthesis) return;
    const spokenText = await api.normalizeTtsText(text).catch(() => text);
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = state.speechLanguage || "ja-JP";
    utterance.rate = 1.03;
    utterance.pitch = 1.05;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) || null;
    utterance.onstart = () => {
      let phase = 0;
      speechPulseTimer = setInterval(() => {
        phase += 0.8;
        api.sendVoiceLevel(0.12 + Math.abs(Math.sin(phase)) * 0.28).catch(() => {});
      }, 80);
    };
    utterance.onend = stopSpeechPulse;
    utterance.onerror = stopSpeechPulse;
    speechSynthesis.speak(utterance);
  }

  function setChatBusy(busy) {
    chatBusy = Boolean(busy);
    $("#sendButton").disabled = false;
    $("#sendButton").hidden = false;
    $("#sendButton").firstChild.textContent = chatBusy ? localized("差し込む ", "Follow up ") : localized("送信 ", "Send ");
    $("#stopButton").hidden = !chatBusy;
    $("#stopButton").disabled = false;
  }

  async function sendChat() {
    const input = $("#chatInput");
    const attachments = chatAttachments.map((item) => ({ ...item }));
    const message = input.value.trim() || (attachments.length ? localized("添付したファイルを確認してください。", "Please review the attached files.") : "");
    if (!message) return;
    if (realtimeStarting) {
      setStatus($("#chatStatus"), localized("Liveへの接続が完了してから送信してください。", "Wait for Live to finish connecting before sending."), true);
      return;
    }
    if (attachments.length && realtimePeerConnection) {
      setStatus($("#chatStatus"), localized("Live音声を停止してからファイルを送信してください。", "Stop Live voice before sending files."), true);
      return;
    }
    input.value = "";
    chatAttachments = [];
    renderChatAttachments();
    if (chatBusy) {
      pendingChatFollowUp = { message, attachments };
      setStatus($("#chatStatus"), localized("差し込みを受け付けました。現在の応答を止めています…", "Follow-up queued. Stopping the current response…"));
      $("#stopButton").disabled = true;
      try { await api.interruptChat(); } catch (error) { setStatus($("#chatStatus"), error.message, true); $("#stopButton").disabled = false; }
      return;
    }
    setChatHistoryView("conversation");
    if (realtimePeerConnection) {
      appendMessage("user", message);
      const liveWork = state?.interactionMode === "work";
      if (liveWork) {
        streamingMessage = appendMessage("assistant", localized("考え中", "Thinking"), true);
        streamingMessage.dataset.realtimeWork = "true";
        setChatBusy(true);
      }
      realtimePendingTypedText = message;
      setStatus($("#chatStatus"), "Live音声で応答を生成しています…");
      try {
        const appended = await api.appendCodexRealtimeText(message);
        if (!appended) throw new Error("Liveセッションへ文字を送信できませんでした。");
      } catch (error) {
        realtimePendingTypedText = "";
        if (liveWork && streamingMessage) {
          streamingMessage.classList.remove("is-thinking");
          streamingMessage.querySelector("p").textContent = "エラー: " + error.message;
          streamingMessage = null;
          setChatBusy(false);
        }
        setStatus($("#chatStatus"), error.message, true);
      }
      input.focus();
      return;
    }
    const attachmentLabel = attachments.length ? `\n${attachments.map((item) => `📎 ${item.name}`).join("\n")}` : "";
    appendMessage("user", `${message}${attachmentLabel}`);
    const thinking = appendMessage("assistant", "考え中", true);
    streamingMessage = thinking;
    setChatBusy(true);
    setStatus($("#chatStatus"), "応答を待っています…");
    try {
      const result = await api.sendChat({ message, attachmentPaths: attachments.map((item) => item.path) });
      const paragraph = thinking.querySelector("p");
      thinking.classList.remove("is-thinking");
      paragraph.textContent = result.displayText || result.text;
      appendWorkArtifactActions(thinking, result.artifacts, result.workRunId);
      setStatus($("#chatStatus"), result.provider === "codex" ? "Codexから応答しました。" : "OpenAI APIから応答しました。");
    } catch (error) {
      thinking.classList.remove("is-thinking");
      const interrupted = /interrupt|cancel|abort|中断/i.test(String(error.message || ""));
      thinking.querySelector("p").textContent = interrupted ? "応答を中断しました。続けて修正できます。" : `エラー: ${error.message}`;
      setStatus($("#chatStatus"), interrupted ? "応答を中断しました。" : error.message, !interrupted);
    } finally {
      setChatBusy(false);
      streamingMessage = null;
      input.focus();
      const followUp = pendingChatFollowUp;
      pendingChatFollowUp = null;
      if (followUp) {
        input.value = followUp.message;
        chatAttachments = followUp.attachments;
        renderChatAttachments();
        queueMicrotask(() => sendChat());
      }
    }
  }

  function finishDetachedRealtimeWork(workRunId = "") {
    if (!streamingMessage?.dataset.realtimeWork) return;
    const expectedRunId = String(workRunId || "");
    if (expectedRunId && (!streamingMessage.dataset.workRunId || streamingMessage.dataset.workRunId !== expectedRunId)) return;
    setChatBusy(false);
    streamingMessage = null;
    $("#chatInput").focus();
    const followUp = pendingChatFollowUp;
    pendingChatFollowUp = null;
    if (followUp) {
      $("#chatInput").value = followUp.message;
      chatAttachments = followUp.attachments;
      renderChatAttachments();
      queueMicrotask(() => sendChat());
    }
  }

  function bindEvents() {
    api.onStateChanged?.((nextState) => {
      state = nextState;
      syncUi();
    });
    api.onUpdateStatus?.((update) => {
      state.appUpdate = update;
      syncUpdateUi();
    });
    api.onBeatriceSettingsChanged?.((payload) => {
      closeRealtimeAudio();
      const message = payload?.message || "Beatrice 2の設定変更を反映するためLive接続を終了しました。";
      setStatus($("#chatStatus"), message);
      setStatus($("#beatriceStatus"), message);
    });
    api.onChatStream?.((payload) => {
      if (!streamingMessage && payload?.phase === "start" && payload?.realtimeOutput && payload?.mode === "work") {
        streamingMessage = appendMessage("assistant", localized("考え中", "Thinking"), true);
        streamingMessage.dataset.realtimeWork = "true";
        setChatBusy(true);
      }
      if (!streamingMessage) return;
      if (payload?.phase === "start" && payload?.realtimeOutput && payload?.mode === "work") {
        streamingMessage.dataset.workRunId = String(payload?.workRunId || "");
        realtimePendingTypedText = "";
      }
      const paragraph = streamingMessage.querySelector("p");
      if (payload?.phase === "start") paragraph.textContent = "考え中";
      if (["delta", "announcement", "realtime-caption"].includes(payload?.phase)) {
        streamingMessage.classList.remove("is-thinking");
        paragraph.textContent = String(payload.displayText || payload.text || "");
        $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
      }
      if (payload?.phase === "done") {
        streamingMessage.classList.remove("is-thinking");
        paragraph.textContent = String(payload.displayText || payload.text || "");
        appendWorkArtifactActions(streamingMessage, payload.artifacts, payload.workRunId);
        if (payload?.realtimeOutput && !payload?.realtimeSpeechPending) finishDetachedRealtimeWork(payload?.workRunId);
      }
      if (payload?.phase === "realtime-work-complete") finishDetachedRealtimeWork(payload?.workRunId);
      if (payload?.phase === "error" && payload?.realtimeOutput) {
        streamingMessage.classList.remove("is-thinking");
        paragraph.textContent = "エラー: " + (payload.message || "作業を完了できませんでした。");
        finishDetachedRealtimeWork(payload?.workRunId);
      }
    });
    api.onChatHistory?.((entries) => {
      state.conversationHistory = Array.isArray(entries) ? entries : [];
      if (streamingMessage || realtimeAssistantActive || chatHistoryView !== "conversation") return;
      renderedConversationCharacterId = state.characterId;
      renderConversationHistory(state.conversationHistory);
    });
    api.onWorkHistory?.((payload) => {
      workHistoryState = payload && Array.isArray(payload.runs) ? payload : { activeWorkRunId: null, runs: [] };
      if (state) state.workHistory = workHistoryState;
      syncCharacterSwitchAvailability();
      if (chatHistoryView === "work") renderWorkHistory(workHistoryState);
    });
    api.onWebPreview?.((previewState) => {
      if (state) state.webPreview = previewState;
      const projectId = activeArtifactPreviewData?.project?.id;
      if (!projectId || previewState?.projectId !== projectId) return;
      const previousStatus = activeArtifactPreviewData.server?.status;
      activeArtifactPreviewData.server = previewState;
      if (previousStatus === previewState.status) {
        const log = $("#artifactPreviewBody .web-preview-logs pre");
        if (log) log.textContent = (previewState.logs || []).join("\n") || localized("ログはまだありません。", "No logs yet.");
        return;
      }
      renderArtifactPreview(activeArtifactPreviewData);
    });
    api.onCodexRealtime?.((message) => {
      handleCodexRealtimeEvent(message).catch((error) => {
        setStatus($("#chatStatus"), `音声イベント: ${error.message}`, true);
        closeRealtimeAudio();
      });
    });
    api.onRemotePcAudio?.((payload) => {
      // This preference applies to phone-originated responses. A Live session
      // created in this renderer is PC-owned and must remain audible here.
      void payload;
    });
    api.onStopNormalSpeech?.(() => stopSpeechPlayback());
    api.onCharacterGeneration?.((payload) => updateGeneratorProgress(payload));
    $("#remoteAccessToggle").addEventListener("change", saveRemoteSettings);
    ["#remoteAddressSelect", "#remotePortInput", "#remoteSessionSelect", "#remoteResponseModeSelect", "#remoteWorkToggle", "#remoteTtsToggle", "#remotePcAudioToggle", "#remoteTailscaleHttpsPortInput"].forEach((selector) => {
      $(selector).addEventListener("change", saveRemoteSettings);
    });
    $("#refreshRemoteTailscaleButton").addEventListener("click", async () => {
      const button = $("#refreshRemoteTailscaleButton");
      button.disabled = true;
      setStatus($("#remoteTailscaleStatus"), localized("Tailscaleの状態を確認しています…", "Checking Tailscale…"));
      try { state = await api.refreshRemoteTailscale(); syncUi(); }
      catch (error) { setStatus($("#remoteTailscaleStatus"), error.message, true); }
      finally { button.disabled = false; }
    });
    $("#startRemoteTailscaleButton").addEventListener("click", async () => {
      const button = $("#startRemoteTailscaleButton");
      button.disabled = true;
      setStatus($("#remoteTailscaleStatus"), localized("HTTPS接続を準備しています…", "Preparing HTTPS access…"));
      try { state = await api.startRemoteTailscale(); syncUi(); }
      catch (error) { setStatus($("#remoteTailscaleStatus"), error.message, true); }
      finally { button.disabled = false; }
    });
    $("#stopRemoteTailscaleButton").addEventListener("click", async () => {
      const button = $("#stopRemoteTailscaleButton");
      button.disabled = true;
      try { state = await api.stopRemoteTailscale(); syncUi(); }
      catch (error) { setStatus($("#remoteTailscaleStatus"), error.message, true); }
      finally { button.disabled = false; }
    });
    $("#remoteTailscaleUrl").addEventListener("click", (event) => {
      event.preventDefault();
      const url = event.currentTarget.dataset.url;
      if (url) api.openExternalUrl(url).catch((error) => setStatus($("#remoteTailscaleStatus"), error.message, true));
    });
    $("#copyRemoteUrlButton").addEventListener("click", async () => {
      const pairingUrl = state?.remote?.pairingUrl || "";
      if (!pairingUrl) return;
      try {
        await navigator.clipboard.writeText(pairingUrl);
        const button = $("#copyRemoteUrlButton");
        button.textContent = localized("コピーしました", "Copied");
        setTimeout(() => { button.textContent = localized("URLをコピー", "Copy URL"); }, 1400);
      } catch (error) { setStatus($("#remoteConnectionSummary"), error.message, true); }
    });
    $("#regenerateRemotePairingButton").addEventListener("click", async () => {
      const button = $("#regenerateRemotePairingButton");
      button.disabled = true;
      try { state = await api.regenerateRemotePairing(); syncUi(); }
      catch (error) { setStatus($("#remoteConnectionSummary"), error.message, true); }
      finally { button.disabled = false; }
    });
    $("#revokeRemoteSessionsButton").addEventListener("click", async () => {
      if (!window.confirm(localized("接続中を含むすべてのスマートフォンを解除しますか？", "Disconnect every paired phone, including active connections?"))) return;
      const button = $("#revokeRemoteSessionsButton");
      button.disabled = true;
      try { state = await api.revokeRemoteSessions(); syncUi(); }
      catch (error) { setStatus($("#remoteConnectionSummary"), error.message, true); }
      finally { button.disabled = false; }
    });
    $("#purupuruImportButton").addEventListener("click", () => $("#purupuruImportInput").click());
    $("#purupuruImportInput").addEventListener("change", async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0] || null;
      input.value = "";
      await importPuruPuruFile(file);
    });
    bindFileDropZone($("#purupuruImportDrop"), (files) => importPuruPuruFile(files[0]));
    $("#avatarImageInput").addEventListener("change", (event) => selectGeneratorFile(event.target.files?.[0] || null));
    bindFileDropZone($("#avatarImageDrop"), (files) => selectGeneratorFile(files[0]));
    $("#avatarRightsConfirm").addEventListener("change", syncGeneratorUi);
    $("#generateCharacterButton").addEventListener("click", async () => {
      if (!generatorFile || generatorBusy) return;
      generatorBusy = true;
      syncGeneratorUi();
      updateGeneratorProgress({ phase: "start", message: "画像を読み込んでいます…" });
      try {
        const bytes = new Uint8Array(await generatorFile.arrayBuffer());
        state = await api.generateCharacter({
          bytes,
          fileName: generatorFile.name,
          mimeType: generatorFile.type,
          name: $("#generatedCharacterNameInput").value.trim(),
          personality: $("#generatedCharacterPersonalityInput").value.trim(),
        });
        generatorFile = null;
        $("#avatarImageInput").value = "";
        $("#generatedCharacterNameInput").value = "";
        $("#generatedCharacterPersonalityInput").value = "";
        $("#avatarRightsConfirm").checked = false;
        $("#avatarImageDrop").classList.remove("has-image");
        syncUi();
      } catch (error) {
        updateGeneratorProgress({ phase: "error", message: error.message });
      } finally {
        generatorBusy = false;
        syncGeneratorUi();
      }
    });
    $$(".nav-tab").forEach((button) => {
      button.addEventListener("click", () => {
        showPage(button.dataset.page);
        if (button.dataset.page === "support" && !lastDiagnostics) refreshSupportDiagnostics();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = $$(".nav-tab");
        const current = tabs.indexOf(button);
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[index].focus();
        tabs[index].click();
      });
    });
    $$('[data-settings-jump]').forEach((button) => button.addEventListener("click", () => jumpToSettingsTarget(button.dataset.settingsJump)));
    const settingsSearchInput = $("#settingsSearchInput");
    settingsSearchInput.addEventListener("focus", () => renderSettingsSearch(settingsSearchInput.value));
    settingsSearchInput.addEventListener("input", () => renderSettingsSearch(settingsSearchInput.value));
    settingsSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSettingsSearch({ clear: true });
        settingsSearchInput.blur();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter") {
        const item = settingsSearchMatches[settingsSearchActiveIndex >= 0 ? settingsSearchActiveIndex : 0];
        if (item) navigateToSetting(item);
        return;
      }
      setSettingsSearchActive(settingsSearchActiveIndex + (event.key === "ArrowDown" ? 1 : -1));
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        settingsSearchInput.focus();
        settingsSearchInput.select();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".settings-search")) closeSettingsSearch();
    });
    $("#chatForm").addEventListener("submit", (event) => { event.preventDefault(); sendChat(); });
    $("#chatAttachmentButton").addEventListener("click", () => $("#chatAttachmentInput").click());
    $("#chatAttachmentInput").addEventListener("change", (event) => {
      addChatAttachments([...(event.currentTarget.files || [])]);
      event.currentTarget.value = "";
    });
    bindFileDropZone($("#chatForm"), addChatAttachments);
    $("#conversationHistoryTab").addEventListener("click", () => setChatHistoryView("conversation"));
    $("#workHistoryTab").addEventListener("click", async () => {
      workHistoryState = await api.getWorkHistory().catch(() => workHistoryState);
      setChatHistoryView("work");
    });
    $("#openChatWorkDirectoryButton").addEventListener("click", async () => {
      try { await api.openWorkDirectory(); } catch (error) { setStatus($("#chatStatus"), error.message, true); }
    });
    $("#chatWorkProjectSelect").addEventListener("change", async (event) => {
      const previous = state.characterWorkspace?.activeProjectId || "home";
      try { state = await api.activateWorkProject(event.currentTarget.value); closeArtifactPreview(); syncUi(); }
      catch (error) { event.currentTarget.value = previous; setStatus($("#chatStatus"), error.message, true); }
    });
    $("#chooseChatWorkDirectoryButton").addEventListener("click", async () => {
      try { state = await api.chooseWorkDirectory(); syncUi(); } catch (error) { setStatus($("#chatStatus"), error.message, true); }
    });
    $("#addCharacterProjectButton").addEventListener("click", async () => {
      try { state = await api.chooseWorkDirectory(); syncUi(); setStatus($("#characterProfileStatus"), localized("担当プロジェクトを追加しました。", "Project attached.")); }
      catch (error) { setStatus($("#characterProfileStatus"), error.message, true); }
    });
    $("#closeArtifactPreviewButton").addEventListener("click", closeArtifactPreview);
    $("#openPreviewArtifactButton").addEventListener("click", async () => {
      if (!activeArtifactPreview) return;
      try {
        if (activeArtifactPreviewData?.type === "web-project" && activeArtifactPreviewData.server?.status === "running") await api.openWebPreview();
        else await api.openWorkArtifact(activeArtifactPreview);
      }
      catch (error) { setStatus($("#chatStatus"), error.message, true); }
    });
    $("#stopButton").addEventListener("click", async () => {
      const button = $("#stopButton");
      pendingChatFollowUp = null;
      button.disabled = true;
      setStatus($("#chatStatus"), "中断しています…");
      try {
        await api.interruptChat();
      } catch (error) {
        button.disabled = false;
        setStatus($("#chatStatus"), error.message, true);
      }
    });
    $("#chatInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); sendChat(); }
    });
    $("#micLipSyncButton")?.addEventListener("click", toggleLipSync);
    $("#speechInputButton")?.addEventListener("click", toggleSpeechInput);
    $$("[data-expression]").forEach((button) => button.addEventListener("click", () => {
      const expressions = {
        neutral: { forceMouth: 0, forceEyesClosed: false, durationMs: 1000 },
        happy: { forceMouth: 1, forceEyesClosed: false, emotion: "happy", durationMs: 1800 },
        surprised: { forceMouth: 2, forceEyesClosed: false, emotion: "surprised", durationMs: 1500 },
        soft: { forceMouth: 0, forceEyesClosed: false, emotion: "soft", durationMs: 2000 },
        sleepy: { forceMouth: 0, forceEyesClosed: true, durationMs: 2200 },
      };
      api.setExpression(expressions[button.dataset.expression]);
      $$("[data-expression]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      setTimeout(() => button.setAttribute("aria-pressed", "false"), expressions[button.dataset.expression].durationMs);
    }));
    $("#resetChatButton").addEventListener("click", async () => {
      await api.resetChat();
      setChatHistoryView("conversation");
      $("#chatLog").replaceChildren();
      appendMessage("assistant", "新しい会話を始めよう。何を話す？");
    });
    $("#saveCharacterProfileButton").addEventListener("click", async () => {
      const character = currentCharacter();
      try {
        state = await api.configureCharacter({
          id: character.id,
          name: $("#characterNameInput").value,
          personality: $("#characterPersonalityInput").value,
          ui: {
            bubbleLeft: Number($("#bubbleLeftInput").value),
            bubbleTop: Number($("#bubbleTopInput").value),
            bubbleWidth: Number($("#bubbleWidthInput").value),
          },
          motion: currentMotionValues(),
        });
        syncUi();
        setStatus($("#characterProfileStatus"), "保存して会話へ反映しました。");
      } catch (error) {
        setStatus($("#characterProfileStatus"), error.message, true);
      }
    });
    $("#resetCharacterProfileButton").addEventListener("click", async () => {
      try {
        state = await api.configureCharacter({ id: currentCharacter().id, reset: true });
        syncUi();
        setStatus($("#characterProfileStatus"), "初期設定へ戻しました。");
      } catch (error) {
        setStatus($("#characterProfileStatus"), error.message, true);
      }
    });
    $("#characterMemoryList").addEventListener("click", async (event) => {
      const button = event.target.closest(".character-memory-remove");
      if (!button?.dataset.memoryId) return;
      button.disabled = true;
      try {
        state = await api.removeMemory(button.dataset.memoryId);
        syncUi();
        setStatus($("#characterProfileStatus"), "このキャラのメモリから削除しました。");
      } catch (error) {
        button.disabled = false;
        setStatus($("#characterProfileStatus"), error.message, true);
      }
    });
    $("#clearCharacterMemoriesButton").addEventListener("click", async () => {
      const character = currentCharacter();
      if (!state.memories?.length || !window.confirm(localized(
        `${character.name}が覚えている利用者メモリをすべて削除しますか？`,
        `Forget everything ${character.name} remembers about you?`,
      ))) return;
      try {
        state = await api.clearMemories();
        syncUi();
        setStatus($("#characterProfileStatus"), `${character.name}のメモリをすべて削除しました。`);
      } catch (error) {
        setStatus($("#characterProfileStatus"), error.message, true);
      }
    });
    $("#removeCharacterButton").addEventListener("click", async () => {
      const character = currentCharacter();
      if (!character?.generated) return;
      const confirmed = window.confirm(localized(
        `追加したキャラ「${character.name}」を削除しますか？\n\n画像と、このキャラ専用の設定・音声設定・メモリも端末から削除されます。この操作は元に戻せません。`,
        `Delete the custom character “${character.name}”?\n\nIts images, character-specific settings, voice settings, and memories will be removed from this device. This cannot be undone.`,
      ));
      if (!confirmed) return;
      const button = $("#removeCharacterButton");
      button.disabled = true;
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        state = await api.removeCharacter(character.id);
        syncUi();
        setStatus($("#characterProfileStatus"), `${character.name}を削除しました。`);
      } catch (error) {
        button.disabled = false;
        setStatus($("#characterProfileStatus"), error.message, true);
      }
    });
    $$('input[name="backend"]').forEach((input) => input.addEventListener("change", async () => {
      if (input.checked && input.value !== "codex") await stopCodexRealtimeVoice({ quiet: true });
      await saveSettings();
    }));
    ["#languageSelect", "#alwaysOnTopToggle", "#launchAtLoginToggle", "#ttsToggle", "#englishPronunciationToggle", "#positionLockedToggle", "#edgeSnapToggle"]
      .forEach((selector) => $(selector).addEventListener("change", saveSettings));
    ["#updateChecksToggle", "#updateChannelSelect"].forEach((selector) => $(selector).addEventListener("change", () => {
      saveSettings().catch((error) => {
        state.appUpdate = { ...(state.appUpdate || {}), status: "error", error: error.message };
        syncUpdateUi();
      });
    }));
    $("#checkUpdatesButton").addEventListener("click", async () => {
      try {
        state.appUpdate = { ...(state.appUpdate || {}), status: "checking" };
        syncUpdateUi();
        state.appUpdate = await api.checkForUpdates();
      } catch (error) {
        state.appUpdate = { ...(state.appUpdate || {}), status: "error", error: error.message };
      }
      syncUpdateUi();
    });
    const openUpdateRelease = () => api.openUpdateRelease().catch((error) => {
      state.appUpdate = { ...(state.appUpdate || {}), status: "error", error: error.message };
      syncUpdateUi();
    });
    $("#openUpdateReleaseButton").addEventListener("click", openUpdateRelease);
    $("#updateBannerOpenButton").addEventListener("click", openUpdateRelease);
    $("#updateBannerDismissButton").addEventListener("click", () => {
      dismissedUpdateVersion = state.appUpdate?.latestVersion || "";
      syncUpdateUi();
    });
    $$('input[name="mascotPointerMode"]').forEach((input) => input.addEventListener("change", saveSettings));
    $("#ttsProviderSelect").addEventListener("change", () => {
      $("#styleBertVits2Settings").hidden = $("#ttsProviderSelect").value !== "style-bert-vits2";
      $("#sbv2Settings").hidden = $("#ttsProviderSelect").value !== "sbv2-jp-extra";
      $("#piperPlusSettings").hidden = $("#ttsProviderSelect").value !== "piper-plus";
      $("#supertonicSettings").hidden = $("#ttsProviderSelect").value !== "supertonic-3";
      $("#kokoroSettings").hidden = $("#ttsProviderSelect").value !== "kokoro";
      $("#irodoriSettings").hidden = $("#ttsProviderSelect").value !== "irodori-webgpu";
      if ($("#ttsProviderSelect").value !== "system") {
        setTimeout(() => {
          const scroller = $(".main-panel");
          const container = $("#ttsProviderSelect").closest(".tts-settings");
          const overflow = container.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 24;
          if (overflow > 0) scroller.scrollBy({
            top: overflow,
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          });
        }, 30);
      }
      saveSettings().catch((error) => setStatus($("#ttsStatus"), error.message, true));
    });
    $("#realtimeVoiceSelect").addEventListener("change", async () => {
      try {
        const stopped = realtimePeerConnection || realtimeStarting
          ? await stopCodexRealtimeVoice({ quiet: true })
          : await api.stopCodexRealtime().catch(() => false);
        await saveSettings();
        setStatus($("#realtimeVoiceStatus"), stopped
          ? "接続中のRealtimeを終了し、この音声へ切り替えました。"
          : "このキャラクターのRealtime音声を保存しました。");
      } catch (error) {
        setStatus($("#realtimeVoiceStatus"), error.message, true);
      }
    });
    $("#realtimeVoiceConversionSelect").addEventListener("change", async () => {
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        await saveSettings();
        syncBeatriceUi();
        setStatus($("#realtimeVoiceStatus"), "このキャラクターのRealtime声変換を保存しました。");
      } catch (error) {
        setStatus($("#beatriceStatus"), error.message, true);
      }
    });
    $("#beatriceVoiceSelect").addEventListener("change", async () => {
      try {
        syncBeatriceDescriptionUi((state.beatrice?.models || []).find((model) => model.id === $("#beatriceModelSelect").value));
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        await saveSettings();
        syncBeatriceUi();
        setStatus($("#beatriceStatus"), localized("このキャラクターのBeatrice音声を保存しました。", "Saved the Beatrice voice for this character."));
      } catch (error) {
        setStatus($("#beatriceStatus"), error.message, true);
      }
    });
    $("#beatriceModelSelect").addEventListener("change", async () => {
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        const selectedModel = populateBeatriceVoices($("#beatriceModelSelect").value, 0);
        syncBeatriceDescriptionUi(selectedModel);
        await saveSettings();
        syncBeatriceUi();
        setStatus($("#beatriceStatus"), localized("このキャラクターのBeatriceモデルを保存しました。", "Saved the Beatrice model for this character."));
      } catch (error) {
        setStatus($("#beatriceStatus"), error.message, true);
      }
    });
    [
      "#beatricePitchShiftInput", "#beatriceFormantShiftInput", "#beatriceInputGainInput",
      "#beatriceOutputGainInput", "#beatriceIntonationInput", "#beatricePitchCorrectionInput",
    ].forEach((selector) => {
      $(selector).addEventListener("input", syncBeatriceReadouts);
      $(selector).addEventListener("change", async () => {
        try {
          if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
          await saveSettings();
          syncBeatriceReadouts();
          setStatus($("#beatriceStatus"), localized("声質調整を保存しました。次の接続から反映します。", "Voice tuning saved. It will apply to the next session."));
        } catch (error) {
          setStatus($("#beatriceStatus"), error.message, true);
        }
      });
    });
    $("#beatricePitchCorrectionTypeSelect").addEventListener("change", async () => {
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        await saveSettings();
        setStatus($("#beatriceStatus"), localized("ピッチ補正方法を保存しました。", "Pitch correction type saved."));
      } catch (error) {
        setStatus($("#beatriceStatus"), error.message, true);
      }
    });
    $("#beatriceResetButton").addEventListener("click", async () => {
      const defaults = {
        beatricePitchShift: 0,
        beatriceFormantShift: 0,
        beatriceInputGain: 0,
        beatriceOutputGain: 0,
        beatriceIntonation: 1,
        beatricePitchCorrection: 0,
      };
      for (const [key, value] of Object.entries(defaults)) $(`#${key}Input`).value = value;
      $("#beatricePitchCorrectionTypeSelect").value = "0";
      syncBeatriceReadouts();
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        await saveSettings();
        setStatus($("#beatriceStatus"), localized("Beatriceの声質を標準値へ戻しました。", "Reset Beatrice voice tuning to defaults."));
      } catch (error) {
        setStatus($("#beatriceStatus"), error.message, true);
      }
    });
    $("#beatriceChooseButton").addEventListener("click", async () => {
      try {
        if (realtimePeerConnection || realtimeStarting) await stopCodexRealtimeVoice({ quiet: true });
        const result = await api.chooseBeatriceInstallation();
        if (result.canceled) return;
        state = await api.getState();
        syncUi();
        setStatus($("#beatriceLibraryStatus"), localized("Beatrice 2のVST3を設定しました。", "Beatrice 2 VST3 configured."));
      } catch (error) {
        setStatus($("#beatriceLibraryStatus"), error.message, true);
      }
    });
    $("#beatriceOfficialSiteButton").addEventListener("click", async () => {
      const button = $("#beatriceOfficialSiteButton");
      button.disabled = true;
      try {
        await api.openBeatriceOfficialSite();
        setStatus($("#beatriceLibraryStatus"), localized("Beatrice 2公式サイトをブラウザで開きました。", "Opened the official Beatrice 2 website in your browser."));
      } catch (error) {
        setStatus($("#beatriceLibraryStatus"), error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    $("#beatriceModelAddButton").addEventListener("click", async () => {
      try {
        const result = await api.addBeatriceModels();
        if (result.canceled) return;
        state = await api.getState();
        syncUi();
        setStatus($("#beatriceLibraryStatus"), localized(`${result.added || 0}件のモデルを追加しました。`, `Added ${result.added || 0} model${result.added === 1 ? "" : "s"}.`));
      } catch (error) {
        setStatus($("#beatriceLibraryStatus"), error.message, true);
      }
    });
    $("#piperPlusExecutableButton").addEventListener("click", async () => {
      try {
        state = await api.choosePiperPlusExecutable();
        syncUi();
      } catch (error) {
        setStatus($("#piperPlusStatus"), error.message, true);
      }
    });
    $("#piperPlusModelButton").addEventListener("click", async () => {
      try {
        state = await api.choosePiperPlusModel();
        syncUi();
      } catch (error) {
        setStatus($("#piperPlusStatus"), error.message, true);
      }
    });
    $("#supertonicModelButton").addEventListener("click", async () => {
      try {
        state = await api.chooseSupertonicModel();
        syncUi();
      } catch (error) {
        setStatus($("#supertonicStatus"), error.message, true);
      }
    });
    $("#irodoriModelButton").addEventListener("click", async () => {
      try {
        state = await api.chooseIrodoriModel();
        syncUi();
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriReferenceButton").addEventListener("click", async () => {
      try {
        state = await api.chooseIrodoriReference();
        syncUi();
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriVoiceSelect").addEventListener("change", async () => {
      try {
        state = await api.selectIrodoriVoice($("#irodoriVoiceSelect").value);
        syncUi();
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriModeSelect").addEventListener("change", () => {
      $("#irodoriReferenceSettings").hidden = $("#irodoriVersionSelect").value !== "500m-v3" && $("#irodoriModeSelect").value === "design";
      saveSettings().catch((error) => setStatus($("#irodoriStatus"), error.message, true));
    });
    $("#irodoriVersionSelect").addEventListener("change", async () => {
      try {
        await saveSettings();
        syncIrodoriUi(state.irodori);
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriPrecisionSelect").addEventListener("change", async () => {
      try {
        await saveSettings();
        syncIrodoriUi(state.irodori);
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriCfgExecutionSelect").addEventListener("change", () => {
      saveSettings().catch((error) => setStatus($("#irodoriStatus"), error.message, true));
    });
    $("#irodoriVoiceRenameButton").addEventListener("click", async () => {
      const voice = state.irodori?.voices?.find((item) => item.id === state.irodori.voiceId);
      if (!voice) return;
      const name = window.prompt(localized("参照音声の名前", "Reference voice name"), voice.name);
      if (name == null || !name.trim()) return;
      try {
        state = await api.renameIrodoriVoice({ id: voice.id, name });
        syncUi();
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#irodoriVoiceRemoveButton").addEventListener("click", async () => {
      const voice = state.irodori?.voices?.find((item) => item.id === state.irodori.voiceId);
      if (!voice || !window.confirm(localized(
        `参照音声「${voice.name}」をアプリ内から削除しますか？`,
        `Delete the reference voice “${voice.name}” from the app?`,
      ))) return;
      try {
        state = await api.removeIrodoriVoice(voice.id);
        syncUi();
      } catch (error) {
        setStatus($("#irodoriStatus"), error.message, true);
      }
    });
    $("#sbv2ModelAddButton").addEventListener("click", async () => {
      try {
        setStatus($("#sbv2Status"), localized("AIVMXモデルを確認してアプリ内へコピーしています…", "Checking and copying the AIVMX model into the app…"));
        state = await api.chooseSbv2Model();
        syncUi();
      } catch (error) {
        setStatus($("#sbv2Status"), error.message, true);
      }
    });
    $("#sbv2ModelRenameButton").addEventListener("click", async () => {
      const model = state.sbv2?.models?.find((item) => item.id === state.sbv2.modelId);
      if (!model) return;
      const name = window.prompt(localized("JP-Extraモデルの名前", "JP-Extra model name"), model.name);
      if (name == null || !name.trim()) return;
      try {
        state = await api.renameSbv2Model({ id: model.id, name });
        syncUi();
      } catch (error) {
        setStatus($("#sbv2Status"), error.message, true);
      }
    });
    $("#sbv2ModelRemoveButton").addEventListener("click", async () => {
      const model = state.sbv2?.models?.find((item) => item.id === state.sbv2.modelId);
      if (!model || !window.confirm(localized(
        `JP-Extraモデル「${model.name}」をアプリ内から削除しますか？`,
        `Delete the JP-Extra model “${model.name}” from the app?`,
      ))) return;
      try {
        state = await api.removeSbv2Model(model.id);
        syncUi();
      } catch (error) {
        setStatus($("#sbv2Status"), error.message, true);
      }
    });
    for (const { prefix, provider } of [
      { prefix: "piperPlus", provider: "piper-plus" },
      { prefix: "supertonic", provider: "supertonic-3" },
      { prefix: "kokoro", provider: "kokoro" },
      { prefix: "irodori", provider: "irodori-webgpu" },
      { prefix: "irodoriV3", provider: "irodori-500m-v3" },
    ]) {
      $(`#${prefix}ModelDownloadButton`).addEventListener("click", async () => {
        const selectedProvider = prefix === "irodori" && $("#irodoriPrecisionSelect").value === "int4"
          ? "irodori-webgpu-int4" : provider;
        try {
          if (selectedProvider === "piper-plus" && !window.confirm(localized(
            "つくよみちゃんコーパスのクレジットと利用条件を確認し、同意してダウンロードしますか？",
            "Have you reviewed and accepted the Tsukuyomi-chan Corpus credits and terms, and do you want to download it?",
          ))) return;
          if (["irodori-webgpu", "irodori-webgpu-int4", "irodori-500m-v3"].includes(selectedProvider) && !window.confirm(localized(
            "Irodori TTSの利用条件を守り、本人の明示的な同意がある音声だけを参照に使いますか？",
            "Will you follow the Irodori TTS terms and only use reference voices with the speaker's explicit consent?",
          ))) return;
          const stateKey = { "piper-plus": "piperPlus", "supertonic-3": "supertonic", "irodori-webgpu": "irodori", "irodori-webgpu-int4": "irodori", "irodori-500m-v3": "irodori", kokoro: "kokoro" }[selectedProvider];
          const sampleKey = selectedProvider === "irodori-500m-v3" ? "v3SampleModel"
            : selectedProvider === "irodori-webgpu-int4" ? "int4SampleModel"
              : selectedProvider === "irodori-webgpu" ? "fp16SampleModel" : "sampleModel";
          syncTtsSampleModelUi(prefix, {
            ...(state[stateKey]?.[sampleKey] || {}),
            downloading: true,
            progress: { phase: "downloading", receivedBytes: 0, totalBytes: state[stateKey]?.[sampleKey]?.downloadBytes || 1 },
          });
          state = await api.downloadTtsModel(selectedProvider);
          syncUi();
        } catch (error) {
          syncUi();
          setStatus($(`#${prefix}ModelDownloadStatus`), error.message, true);
        }
      });
      $(`#${prefix}ModelRemoveButton`).addEventListener("click", async () => {
        const selectedProvider = prefix === "irodori" && $("#irodoriPrecisionSelect").value === "int4"
          ? "irodori-webgpu-int4" : provider;
        const stateKey = { "piper-plus": "piperPlus", "supertonic-3": "supertonic", "irodori-webgpu": "irodori", "irodori-webgpu-int4": "irodori", "irodori-500m-v3": "irodori", kokoro: "kokoro" }[selectedProvider];
        const sampleKey = selectedProvider === "irodori-500m-v3" ? "v3SampleModel"
          : selectedProvider === "irodori-webgpu-int4" ? "int4SampleModel"
            : selectedProvider === "irodori-webgpu" ? "fp16SampleModel" : "sampleModel";
        const label = state[stateKey]?.[sampleKey]?.label || "ダウンロード済みモデル";
        if (!window.confirm(localized(`${label}を端末から削除しますか？`, `Delete ${label} from this device?`))) return;
        try {
          state = await api.removeTtsModel(selectedProvider);
          syncUi();
        } catch (error) {
          setStatus($(`#${prefix}ModelDownloadStatus`), error.message, true);
        }
      });
    }
    $("#speechInputProviderSelect").addEventListener("change", () => {
      $("#sherpaOnnxSettings").hidden = $("#speechInputProviderSelect").value !== "sherpa-onnx";
      $("#voiceActivationSettings").hidden = !["sherpa-onnx", "openai"].includes($("#speechInputProviderSelect").value);
      saveSettings().catch((error) => setStatus($("#connectionStatus"), error.message, true));
    });
    $("#sherpaModelSelect").addEventListener("change", () => {
      saveSettings().catch((error) => setStatus($("#ttsStatus"), error.message, true));
    });
    ["#voiceActivationModeSelect", "#vadSensitivitySelect", "#voiceAutoSendToggle", "#voiceAutoSendCountdownToggle", "#voiceAutoSendDelaySelect"].forEach((selector) => $(selector).addEventListener("change", () => {
      saveSettings().catch((error) => setStatus($("#connectionStatus"), error.message, true));
    }));
    $("#sherpaModelDownloadButton").addEventListener("click", async () => {
      try {
        syncSherpaModelUi({ ...(state.sherpaModel || {}), downloading: true, progress: { phase: "downloading", receivedBytes: 0, totalBytes: state.sherpaModel?.downloadBytes || 116204861 } });
        state.sherpaModel = await api.downloadSherpaModel($("#sherpaModelSelect").value);
        syncSherpaModelUi(state.sherpaModel);
      } catch (error) {
        syncSherpaModelUi(state.sherpaModel);
        setStatus($("#ttsStatus"), error.message, true);
      }
    });
    $("#sherpaModelRemoveButton").addEventListener("click", async () => {
      const label = state.sherpaModel?.label || localized("ダウンロード済みのsherpa-onnx音声モデル", "the downloaded sherpa-onnx speech model");
      if (!window.confirm(localized(`${label}を削除しますか？`, `Delete ${label}?`))) return;
      state.sherpaModel = await api.removeSherpaModel($("#sherpaModelSelect").value);
      syncSherpaModelUi(state.sherpaModel);
    });
    ["#styleBertVits2UrlInput", "#styleBertVits2ModelIdInput", "#styleBertVits2SpeedInput", "#sbv2ModelSelect", "#sbv2StyleSelect", "#sbv2StyleWeightInput", "#sbv2SpeedInput", "#sbv2DeviceSelect", "#piperPlusSpeedInput", "#supertonicVoiceSelect", "#supertonicSpeedInput", "#supertonicStepsInput", "#kokoroVoiceSelect", "#kokoroSpeedInput", "#kokoroDeviceSelect", "#irodoriSpeedInput", "#irodoriSamplingModeSelect", "#irodoriStepsInput", "#irodoriSeedInput", "#irodoriCaptionInput", "#irodoriAutoEmotionToggle", "#irodoriEmotionStrengthSelect", "#englishPronunciationDictionaryInput"]
      .forEach((selector) => $(selector).addEventListener("change", () => {
        if (selector === "#irodoriAutoEmotionToggle") syncIrodoriUi();
        saveSettings().catch((error) => setStatus($("#ttsStatus"), error.message, true));
      }));
    $("#ttsTestButton").addEventListener("click", async () => {
      try {
        await saveSettings();
        await speakResponse("音声テストです。これからよろしくね。");
      } catch (error) {
        setStatus($("#ttsStatus"), error.message, true);
      }
    });
    $("#mouseFollowToggle").addEventListener("change", () => {
      sessionStorage.setItem("charadock.activePage", "character");
      saveSettings().catch((error) => setStatus($("#characterProfileStatus"), error.message, true));
    });
    ["#openaiModelInput", "#transcriptionModelInput", "#codexChatModelInput", "#codexChatReasoningEffortSelect", "#codexWorkModelInput", "#codexWorkReasoningEffortSelect"]
      .forEach((selector) => $(selector).addEventListener("change", saveSettings));
    $("#displaySelect").addEventListener("change", saveSettings);
    motionFields.forEach((key) => $(`#${key}Input`).addEventListener("input", () => {
      syncMotionReadouts();
      previewCharacterMotion();
      setStatus($("#characterProfileStatus"), "プレビュー中。保存すると次回起動後も反映されます。");
    }));
    $("#saveApiKeyButton").addEventListener("click", async () => {
      try {
        state = await api.setApiKey($("#apiKeyInput").value);
        $("#apiKeyInput").value = "";
        syncUi();
        setStatus($("#connectionStatus"), "APIキーを保存しました。");
      } catch (error) {
        setStatus($("#connectionStatus"), error.message, true);
      }
    });
    $("#testBackendButton").addEventListener("click", async () => {
      const backend = $("input[name='backend']:checked")?.value || state.backend;
      try {
        await saveSettings();
        setStatus($("#connectionStatus"), "接続を確認しています…");
        const result = await api.testBackend(backend);
        setStatus($("#connectionStatus"), result.message);
        if (backend === "codex") {
          refreshCodexAccount();
          refreshCodexModels();
          refreshRealtimeVoices();
        }
      } catch (error) {
        setStatus($("#connectionStatus"), error.message, true);
      }
    });
    $("#codexLoginButton").addEventListener("click", async () => {
      try {
        if ($("#codexLoginButton").dataset.action === "logout") {
          if (!window.confirm(localized(
            "ChatGPTからログアウトします。Codex CLI全体のログインも解除されます。続けますか？",
            "Sign out of ChatGPT? This also signs the entire Codex CLI out. Continue?",
          ))) return;
          $("#codexLoginButton").disabled = true;
          setStatus($("#connectionStatus"), "ChatGPTからログアウトしています…");
          await api.logoutCodex();
          await refreshCodexAccount();
          setStatus($("#connectionStatus"), "ChatGPTからログアウトしました。");
          return;
        }
        setStatus($("#connectionStatus"), "ChatGPTログインをブラウザで開いています…");
        await api.startCodexLogin();
        setStatus($("#connectionStatus"), "ブラウザでログインを完了してください。この画面で自動確認します。");
        waitForCodexLogin();
      } catch (error) {
        $("#codexLoginButton").disabled = false;
        setStatus($("#connectionStatus"), error.message, true);
      }
    });
    $("#onboardingLoginButton").addEventListener("click", async () => {
      try {
        if (codexAccount?.signedIn) return;
        $("#onboardingLoginButton").disabled = true;
        $("#onboardingAccountState").textContent = "ブラウザでログインを開始しています…";
        await api.startCodexLogin();
        $("#onboardingAccountState").textContent = "ブラウザでログインを完了してください。自動で確認します。";
        waitForCodexLogin();
      } catch (error) {
        $("#onboardingLoginButton").disabled = false;
        $("#onboardingAccountState").textContent = error.message;
      }
    });
    $("#onboardingBackendSelect").addEventListener("change", async () => {
      const backend = $("#onboardingBackendSelect").value;
      const radio = $(`input[name="backend"][value="${backend}"]`);
      if (radio) radio.checked = true;
      await saveSettings();
      syncOnboardingReadiness();
    });
    $("#onboardingOpenConnectionButton").addEventListener("click", async () => {
      state = await api.completeOnboarding(true);
      syncOnboarding();
      showPage("connection");
    });
    $("#onboardingBackButton").addEventListener("click", () => setOnboardingStep(onboardingStep - 1));
    $("#onboardingNextButton").addEventListener("click", async () => {
      if (onboardingStep < 4) setOnboardingStep(onboardingStep + 1);
      else await finishOnboarding();
    });
    $("#onboardingSkipButton").addEventListener("click", finishOnboarding);
    $("#onboardingOpenGeneratorButton").addEventListener("click", async () => {
      state = await api.completeOnboarding(true);
      syncOnboarding();
      showPage("character");
      setTimeout(() => $("#avatarGeneratorCard").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 30);
    });
    $("#onboardingTtsToggle").addEventListener("change", async () => {
      $("#ttsToggle").checked = $("#onboardingTtsToggle").checked;
      await saveSettings();
    });
    $("#onboardingSpeechInputProviderSelect").addEventListener("change", async () => {
      $("#speechInputProviderSelect").value = $("#onboardingSpeechInputProviderSelect").value;
      await saveSettings();
      syncOnboardingReadiness();
    });
    $("#onboardingTtsProviderSelect").addEventListener("change", async () => {
      $("#ttsProviderSelect").value = $("#onboardingTtsProviderSelect").value;
      await saveSettings();
      syncOnboardingReadiness();
    });
    $("#onboardingMicrophoneTestButton").addEventListener("click", async () => {
      const button = $("#onboardingMicrophoneTestButton");
      button.disabled = true;
      $("#onboardingSpeechInputStatus").textContent = localized("マイクの使用許可を確認しています…", "Checking microphone access…");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const label = stream.getAudioTracks()[0]?.label || localized("既定のマイク", "Default microphone");
        stream.getTracks().forEach((track) => track.stop());
        $("#onboardingSpeechInputStatus").textContent = localized(`マイクを利用できます · ${label}`, `Microphone is available · ${label}`);
        $("#onboardingSpeechInputStatus").classList.add("is-ready");
        $("#onboardingSpeechInputStatus").classList.remove("is-warning");
      } catch (error) {
        $("#onboardingSpeechInputStatus").textContent = localized(`マイクを利用できません: ${error.message}`, `Microphone is unavailable: ${error.message}`);
        $("#onboardingSpeechInputStatus").classList.remove("is-ready");
        $("#onboardingSpeechInputStatus").classList.add("is-warning");
      } finally {
        button.disabled = false;
      }
    });
    $$(".onboarding-open-voice-settings").forEach((button) => button.addEventListener("click", async () => {
      state = await api.completeOnboarding(true);
      syncOnboarding();
      showPage("voice");
    }));
    $("#onboardingAudioTestButton").addEventListener("click", () => {
      if (!state.ttsEnabled) {
        $("#onboardingTtsToggle").checked = true;
        $("#ttsToggle").checked = true;
        saveSettings().then(() => speakResponse("音声テストです。これからよろしくね。"));
        return;
      }
      speakResponse("音声テストです。これからよろしくね。");
    });
    $("#reopenOnboardingButton").addEventListener("click", async () => {
      state = await api.completeOnboarding(false);
      onboardingStep = 0;
      syncOnboarding();
    });
    $("#refreshDiagnosticsButton").addEventListener("click", refreshSupportDiagnostics);
    $("#copyDiagnosticsButton").addEventListener("click", async () => {
      const button = $("#copyDiagnosticsButton");
      button.disabled = true;
      try {
        await api.copyDiagnostics();
        setStatus($("#supportStatus"), localized("診断情報をクリップボードへコピーしました。", "Diagnostics copied to the clipboard."));
      } catch (error) {
        setStatus($("#supportStatus"), error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    $("#exportSupportBundleButton").addEventListener("click", async () => {
      const button = $("#exportSupportBundleButton");
      button.disabled = true;
      setStatus($("#supportStatus"), localized("診断ZIPを準備しています…", "Preparing diagnostics ZIP…"));
      try {
        const result = await api.exportSupportBundle();
        setStatus($("#supportStatus"), result.canceled
          ? localized("保存をキャンセルしました。", "Save canceled.")
          : localized(`${result.fileName} を保存しました。`, `Saved ${result.fileName}.`));
      } catch (error) {
        setStatus($("#supportStatus"), error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    $("#openLogsButton").addEventListener("click", async () => {
      try {
        await api.openLogs();
        setStatus($("#supportStatus"), localized("ログフォルダーを開きました。", "Opened the log folder."));
      } catch (error) {
        setStatus($("#supportStatus"), error.message, true);
      }
    });
    $("#showMascotButton").addEventListener("click", () => api.controlMascotWindow("show"));
    $("#hideMascotButton").addEventListener("click", () => api.controlMascotWindow("hide"));
    $("#sizeDownButton").addEventListener("click", () => api.controlMascotWindow("sizeDown"));
    $("#sizeUpButton").addEventListener("click", () => api.controlMascotWindow("sizeUp"));
    $("#resetPositionButton").addEventListener("click", () => api.controlMascotWindow("resetPosition"));
    $("#onboarding").addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishOnboarding();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = $$("#onboarding button:not(:disabled), #onboarding input:not(:disabled), #onboarding [tabindex='0']").filter((item) => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden) {
        state = await api.getState();
        syncUi();
      }
    });
  }

  async function init() {
    if (!api) throw new Error("Electron bridge is unavailable");
    const characterVoiceCard = $("#characterVoiceCard");
    $("#characterVoiceMount").appendChild(characterVoiceCard);
    $("#speechInputMount").appendChild($(".speech-input-settings"));
    organizeSettingsLayout();
    state = await api.getState();
    api.onSherpaModelProgress((model) => {
      state.sherpaModel = model;
      syncSherpaModelUi(model);
    });
    api.onTtsModelProgress((model) => {
      const mapping = {
        "piper-plus": ["piperPlus", "piperPlus"],
        "supertonic-3": ["supertonic", "supertonic"],
        kokoro: ["kokoro", "kokoro"],
        "irodori-webgpu": ["irodori", "irodori"],
        "irodori-webgpu-int4": ["irodori", "irodori"],
        "irodori-500m-v3": ["irodori", "irodoriV3"],
      }[model?.provider];
      if (!mapping) return;
      state[mapping[0]] ||= {};
      const sampleKey = model?.provider === "irodori-500m-v3" ? "v3SampleModel"
        : model?.provider === "irodori-webgpu-int4" ? "int4SampleModel"
          : model?.provider === "irodori-webgpu" ? "fp16SampleModel" : "sampleModel";
      state[mapping[0]][sampleKey] = model;
      if (model?.provider === (state.irodoriPrecision === "int4" ? "irodori-webgpu-int4" : "irodori-webgpu")) {
        state[mapping[0]].sampleModel = model;
      }
      syncTtsSampleModelUi(mapping[1], model);
    });
    api.onSbv2Progress((progress) => {
      state.sbv2 ||= {};
      state.sbv2.runtimeProgress = progress;
      syncSbv2Ui(state.sbv2);
    });
    bindEvents();
    syncUi();
    const page = sessionStorage.getItem("charadock.activePage") || "chat";
    showPage(["chat", "remote", "character", "voice", "connection", "desktop", "support"].includes(page) ? page : "chat");
    if (page === "support") refreshSupportDiagnostics();
    refreshCodexAccount();
    refreshCodexModels();
    refreshRealtimeVoices();
  }

  init().catch((error) => {
    setStatus($("#chatStatus"), `起動エラー: ${error.message}`, true);
    $("#connectionPill").classList.add("is-error");
    $("#connectionLabel").textContent = "起動エラー";
  });
})();
