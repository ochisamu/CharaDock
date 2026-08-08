// SPDX-License-Identifier: Apache-2.0

const { findNaturalSpeechBoundary } = require("./natural-speech-chunks.cjs");
const { sanitizeSpeechText } = require("./speech-stream.cjs");

function conciseWorkAnnouncement(value, maxLength = 96) {
  const text = sanitizeSpeechText(value);
  const limit = Math.max(32, Math.min(140, Number(maxLength) || 96));
  if (text.length <= limit) return text;
  const length = findNaturalSpeechBoundary(text, limit, { minimumRatio: .45 });
  return text.slice(0, Math.max(1, length)).trim();
}

function cleanWorkRequest(value, maxLength = 48) {
  let text = String(value || "")
    .normalize("NFKC")
    .replace(/(^|\s)([\w-]+)\.(?:html?|css|js|cjs|mjs|ts|tsx|jsx|json|ya?ml|toml|ini|png|jpe?g|webp|wav|mp3|md|pdf)\b/gi, "$1$2")
    .replace(/^[\s・*-]+/, "");
  text = sanitizeSpeechText(text)
    .replace(/\s+/g, " ")
    .replace(/^(?:ええと|えっと|あの|ごめん(?:なさい)?|お願い(?:します)?|please)\s*[、,]?\s*/iu, "")
    .replace(/^[をのにへでと]+\s*/u, "")
    .replace(/(?:[。.!?！？]\s*)?(?:お願い(?:します)?|よろしく(?:お願い(?:します)?)?)\s*[。.!?！？]*$/u, "")
    .replace(/[。.!?！？]+$/u, "")
    .trim();
  const limit = Math.max(28, Math.min(64, Number(maxLength) || 48));
  if (text.length <= limit) return text;
  const length = findNaturalSpeechBoundary(text, limit, { minimumRatio: .5 });
  return text.slice(0, Math.max(1, length)).trim().replace(/[、,;；。.!?！？]+$/u, "");
}

function japaneseCommitment(value) {
  let text = cleanWorkRequest(value);
  if (!text) return "";
  text = text
    .replace(/(?:もらえ|いただけ)(?:ます|る)(?:か|でしょうか)?$/u, "")
    .replace(/くれ(?:ます|る)(?:か|かな)?$/u, "")
    .replace(/(?:ください|ほしい(?:です)?)(?:ね|な)?$/u, "")
    .replace(/(?:見直|直)して(?:ね|よ)?$/u, (match) => match.startsWith("見") ? "見直す" : "直す")
    .replace(/作って(?:ね|よ)?$/u, "作る")
    .replace(/調べて(?:ね|よ)?$/u, "調べる")
    .replace(/試して(?:ね|よ)?$/u, "試す")
    .replace(/探して(?:ね|よ)?$/u, "探す")
    .replace(/消して(?:ね|よ)?$/u, "消す")
    .replace(/話して(?:ね|よ)?$/u, "話す")
    .replace(/出して(?:ね|よ)?$/u, "出す")
    .replace(/書いて(?:ね|よ)?$/u, "書く")
    .replace(/読んで(?:ね|よ)?$/u, "読む")
    .replace(/選んで(?:ね|よ)?$/u, "選ぶ")
    .replace(/使って(?:ね|よ)?$/u, "使う")
    .replace(/やって(?:みて)?(?:ね|よ)?$/u, "進める")
    .replace(/見て(?:ね|よ)?$/u, "見る")
    .replace(/入れて(?:ね|よ)?$/u, "入れる")
    .replace(/変えて(?:ね|よ)?$/u, "変える")
    .replace(/組み込んで(?:ね|よ)?$/u, "組み込む")
    .replace(/して(?:ね|よ)?$/u, "する")
    .trim();
  if (!text) return "";
  if (/(?:する|させる|進める|作る|直す|調べる|試す|探す|消す|話す|出す|書く|読む|選ぶ|使う|見る|入れる|変える|組み込む|確認する|更新する|対応する|生成する|変換する|ビルドする|テストする|プレビューする)$/u.test(text)) {
    return `${text}ね。`;
  }
  return `${text}から取りかかるね。`;
}

function englishCommitment(value) {
  const text = cleanWorkRequest(value)
    .replace(/^please\s+/iu, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  if (!text) return "";
  return `Got it. I'll start with: ${text}.`;
}

function workAcknowledgementFallback(request, language = "ja") {
  const english = language === "en";
  const requestSummary = cleanWorkRequest(request);
  const subjectless = /^(?:作成|修正|更新|確認|検証|テスト|生成|変換|実行|保存|追加|削除)(?:して|する|してください)/u.test(requestSummary);
  if (!english && subjectless && /HTML|\.html?\b/iu.test(String(request || ""))) {
    const heading = String(request || "").match(/(?:見出し|タイトル)(?:に|は)\s*([^、。\n]{2,32})/u)?.[1];
    const safeHeading = conciseWorkAnnouncement(heading, 32);
    return safeHeading ? `${safeHeading}のHTMLを作成するね。` : "HTMLの成果物を作成するね。";
  }
  if (!english && /(?:作って|作成して|作成する)/u.test(String(request || ""))) {
    const namedSubject = String(request || "").match(/という\s*([^、。\n]{2,32}?)(?:を|に|で)(?=、|,|\s)/u)?.[1];
    const safeSubject = conciseWorkAnnouncement(namedSubject, 32);
    if (safeSubject) return `${safeSubject}を作るね。`;
  }
  const tailored = english ? englishCommitment(request) : japaneseCommitment(request);
  if (tailored) return conciseWorkAnnouncement(tailored, 64);
  const text = String(request || "");
  const matches = (pattern) => pattern.test(text);
  if (matches(/html|web\s?page|website|landing|ページ|サイト/iu)) {
    return english ? "Got it. I'll start putting the page together." : "ページを作るんだね。さっそく始めるよ。";
  }
  if (matches(/readme|markdown|document|report|資料|文書|記事|レポート/iu)) {
    return english ? "Got it. I'll start organizing the document." : "文書を整えるんだね。内容を確認して始めるよ。";
  }
  if (matches(/image|illustration|icon|画像|イラスト|アイコン/iu)) {
    return english ? "Got it. I'll start preparing the image." : "画像を用意するんだね。内容を確認して始めるよ。";
  }
  if (matches(/build|package|binary|release|ビルド|バイナリ|リリース/iu)) {
    return english ? "Got it. I'll start the build and check the output." : "ビルドして成果物を確認するね。始めるよ。";
  }
  if (matches(/test|verify|check|テスト|検証|確認/iu)) {
    return english ? "Got it. I'll check it carefully and report back." : "しっかり確認するんだね。検証を始めるよ。";
  }
  if (matches(/fix|bug|error|code|implement|修正|バグ|エラー|実装|コード/iu)) {
    return english ? "Got it. I'll inspect the code and work on the fix." : "コードを確認して対応するね。作業を始めるよ。";
  }
  if (matches(/search|research|weather|調べ|検索|天気/iu)) {
    return english ? "Got it. I'll look into it and summarize what I find." : "必要な情報を調べてまとめるね。始めるよ。";
  }
  return english ? "Got it. I'll review the request and get started." : "依頼内容を確認したよ。作業を始めるね。";
}

function isIncompleteWorkAnnouncement(value) {
  const text = conciseWorkAnnouncement(value, 80).replace(/[、,\s]+$/u, "");
  return /(?:という|として|なので|だから|から|ながら|つつ|または|および|そして|まずは|を|に|へ|で|と|の|が|して|しながら)$/u.test(text);
}

function isGenericWorkUpdate(value) {
  const text = conciseWorkAnnouncement(value, 80)
    .replace(/[、。.!?！？…]/g, "")
    .trim();
  if (!text) return true;
  return /^(?:了解(?:した|です)?|わかった|承知(?:した|しました)?|オーケー|ok(?:ay)?|got it)(?:[、,\s]*(?:(?:作業を)?(?:始め|取りかか|進め)(?:る|ます)?))?(?:よ|ね)?$/iu.test(text)
    || /^(?:(?:依頼)?内容|作業|処理|ファイル|コード|情報|結果|状態|動作)?(?:を|の)?(?:確認|更新|反映|調整|検証|テスト|保存|準備|修正|作成|生成|実行|処理|調査|検索|チェック|進行|進め)(?:して|し|をして|て)?(?:いる|います|る|ます|中|始める|始めます)?(?:よ|ね)?$/u.test(text)
    || /(?:依頼内容|作業).{0,10}(?:始め|取りかか|進め)(?:る|ます|ている)?(?:よ|ね)?$/u.test(text)
    || /^(?:コマンドを実行|専用ブラウザで操作|(?:Windows)?画面を確認|画面の更新を待|選択中の欄へ文字を入力|キーボード操作を実行)(?:して|し|って)?(?:いる|います|る|ます|中)?(?:よ|ね)?$/u.test(text)
    || /^(?:checking|reviewing|updating|testing|verifying|working|processing|getting started)(?: the)?(?: request| content| files?| code| information| result)?$/iu.test(text);
}

function workTopic(request, language = "ja") {
  const text = cleanWorkRequest(request, 34);
  if (!text) return language === "en" ? "this request" : "この依頼";
  if (language === "en") return text;
  if (/HTML|\.html?\b/iu.test(String(request || ""))) {
    const heading = String(request || "").match(/(?:見出し|タイトル)(?:に|は)\s*([^、。\n]{2,32})/u)?.[1];
    const safeHeading = conciseWorkAnnouncement(heading, 28);
    if (safeHeading) return `${safeHeading}のHTML`;
    if (/^(?:作成|修正|更新|確認|生成)/u.test(text)) return "HTMLの成果物";
  }
  if (/画像.*(?:キャラ|アバター).*(?:作|生成|追加)/u.test(text)) return "キャラクター作成";
  const htmlSubject = text.match(/^(.{2,26}?)(?:を)?(?:HTML(?:ページ)?|Webページ|ウェブページ|ページ)(?:に|へ|で|を|として|化)/iu)?.[1];
  if (htmlSubject) return `${htmlSubject.replace(/[をの]$/u, "")}ページ`;
  const platform = text.match(/(?:Windows|Mac(?:OS)?|Linux)(?:版|向け)?/iu)?.[0];
  if (platform && /ビルド|バイナリ|パッケージ|インストーラ/iu.test(text)) return `${platform}のビルド`;
  const target = text
    .replace(/(?:を|の)?(?:修正|直して|直す|確認|検証|テスト|更新|追加|削除|作成|作って|作る|生成|ビルド|実装|対応|変換|英語化|翻訳|調査|検索|調べて|調べる|プレビュー|してください|してほしい|して|する|やって|進める).*$/u, "")
    .replace(/[をの、,]+$/u, "")
    .trim();
  return target.length >= 2 ? target : text;
}

function contextualizeWorkProgress(value, request, language = "ja") {
  const text = conciseWorkAnnouncement(value, 80);
  if (!text || !isGenericWorkUpdate(text)) return text;
  const topic = workTopic(request, language);
  if (language === "en") {
    if (/test|verif|check/iu.test(text)) return `I'm verifying ${topic}.`;
    if (/updat|writ|file/iu.test(text)) return `I'm applying the changes for ${topic}.`;
    return `I'm working through ${topic}.`;
  }
  if (/専用ブラウザ|情報|調査|検索/u.test(text)) return `${topic}に必要な情報を確認しているよ。`;
  if (/コマンド|実行/u.test(text)) return `${topic}に必要な処理を実行しているよ。`;
  if (/画面/u.test(text)) return `${topic}の画面を確認しているよ。`;
  if (/テスト|検証|動作|確認/u.test(text)) return `${topic}の状態を確かめているよ。`;
  if (/更新|反映|ファイル|コード|保存/u.test(text)) return `${topic}をファイルへ反映しているよ。`;
  return `${topic}の作業を進めているよ。`;
}

function isMeaningfulWorkProgress(value) {
  const text = conciseWorkAnnouncement(value, 80);
  if (!text || /(?:前の(?:やつ|作業)|文脈として|履歴として|現在の依頼だけ|recent work|prior work|context only)/iu.test(text)) return false;
  return true;
}

class WorkVoiceReporter {
  constructor({
    onAnnouncement,
    alreadyAcknowledged = false,
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
    progressDelayMs = 10_000,
    progressIntervalMs = 15_000,
    maxLength = 48,
    request = "",
    language = "ja",
  } = {}) {
    this.onAnnouncement = typeof onAnnouncement === "function" ? onAnnouncement : () => {};
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.progressDelayMs = Math.max(0, Number(progressDelayMs) || 0);
    this.progressIntervalMs = Math.max(0, Number(progressIntervalMs) || 0);
    this.maxLength = Math.max(32, Math.min(80, Number(maxLength) || 48));
    this.request = String(request || "");
    this.language = language === "en" ? "en" : "ja";
    this.startedAt = this.now();
    this.lastAnnouncementAt = alreadyAcknowledged ? this.startedAt : 0;
    this.lastText = "";
    this.pendingText = "";
    this.acknowledged = Boolean(alreadyAcknowledged);
    this.seenFirstCommentary = false;
    this.finished = false;
    this.fallbackTimer = null;
    this.progressTimer = null;
  }

  emit(kind, value) {
    const text = conciseWorkAnnouncement(value, this.maxLength);
    if (this.finished || !text || text === this.lastText) return false;
    this.lastText = text;
    this.lastAnnouncementAt = this.now();
    this.onAnnouncement({ kind, text });
    return true;
  }

  scheduleFallback(value, delayMs = 2400) {
    if (this.finished || this.acknowledged || this.fallbackTimer) return;
    const text = conciseWorkAnnouncement(value, this.maxLength);
    if (!text) return;
    this.fallbackTimer = this.schedule(() => {
      this.fallbackTimer = null;
      if (this.finished || this.acknowledged) return;
      this.acknowledged = true;
      this.emit("ack", text);
      this.schedulePendingProgress();
    }, Math.max(0, Number(delayMs) || 0));
  }

  schedulePendingProgress() {
    if (this.finished || !this.acknowledged || !this.pendingText || this.progressTimer) return;
    const earliest = Math.max(
      this.startedAt + this.progressDelayMs,
      this.lastAnnouncementAt + this.progressIntervalMs,
    );
    this.progressTimer = this.schedule(() => {
      this.progressTimer = null;
      const pending = this.pendingText;
      this.pendingText = "";
      this.emit("progress", pending);
    }, Math.max(0, earliest - this.now()));
  }

  queueProgress(value) {
    const text = conciseWorkAnnouncement(
      contextualizeWorkProgress(value, this.request, this.language),
      this.maxLength,
    );
    if (this.finished || !text || !isMeaningfulWorkProgress(text)) return;
    if (text === this.lastText || text === this.pendingText) return;
    this.pendingText = text;
    this.schedulePendingProgress();
  }

  activity(value) {
    this.queueProgress(value);
  }

  commentary(value) {
    const rawText = conciseWorkAnnouncement(value, this.maxLength);
    if (this.finished || !rawText) return;
    if (!this.seenFirstCommentary) {
      this.seenFirstCommentary = true;
      if (this.acknowledged) return;
      if (this.fallbackTimer) this.cancel(this.fallbackTimer);
      this.fallbackTimer = null;
      this.acknowledged = true;
      const text = isGenericWorkUpdate(rawText) || isIncompleteWorkAnnouncement(rawText)
        ? workAcknowledgementFallback(this.request, this.language)
        : rawText;
      this.emit("ack", text);
      this.schedulePendingProgress();
      return;
    }
    this.queueProgress(rawText);
  }

  complete() {
    this.finished = true;
    if (this.fallbackTimer) this.cancel(this.fallbackTimer);
    if (this.progressTimer) this.cancel(this.progressTimer);
    this.fallbackTimer = null;
    this.progressTimer = null;
    this.pendingText = "";
  }
}

module.exports = {
  WorkVoiceReporter,
  cleanWorkRequest,
  conciseWorkAnnouncement,
  contextualizeWorkProgress,
  isMeaningfulWorkProgress,
  isGenericWorkUpdate,
  isIncompleteWorkAnnouncement,
  workTopic,
  workAcknowledgementFallback,
};
