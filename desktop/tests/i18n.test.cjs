// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { translateText } = require("../i18n.js");

const desktopRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(desktopRoot, "..");

test("interface translator supports exact and dynamic English labels", () => {
  assert.equal(translateText("キャラクター設定", "en"), "Character settings");
  assert.equal(translateText("コハクのプレビュー", "en"), "コハク preview");
  assert.equal(translateText("12件を保持", "en"), "12 saved");
  assert.equal(translateText("会話と作業の履歴", "en"), "Chat and work history");
  assert.equal(translateText("フォローアップを差し込む", "en"), "Insert a follow-up");
  assert.equal(translateText("能力を選ぶ", "en"), "Choose capabilities");
  assert.equal(translateText("名前や用途で検索", "en"), "Search by name or purpose");
  assert.equal(translateText("追加して有効化", "en"), "Add and enable");
  assert.equal(translateText("キャラクター設定", "ja"), "キャラクター設定");
  assert.equal(translateText("外部ネットワーク接続", "en"), "External network access");
  assert.equal(
    translateText("WorkからAPI・パッケージ取得・名前解決を利用できます", "en"),
    "Allow Work to access APIs, download packages, and resolve host names",
  );
});

test("first-run setup has complete English labels for Codex and Live", () => {
  const labels = new Map([
    ["キャラクターと始める", "Start with a character"],
    ["仕事を任せる準備", "Prepare Codex for work"],
    ["公式アプリを入手", "Get the official app"],
    ["一緒に最初の成果物を作る", "Create your first output together"],
    ["キャラクターとの進め方", "How to work with your character"],
    ["GPT-Liveで話しながら", "Talk through GPT-Live"],
    ["文字だけで静かに", "Continue silently in text"],
    ["ローカル音声モデルは不要", "No local voice model required"],
    ["今回は作らずに始める", "Start without creating it"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);

  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  assert.equal((control.match(/data-onboarding-step="\d"/g) || []).length, 3);
  assert.match(control, /name="onboardingDelivery" value="live" checked/);
  assert.match(control, /name="onboardingDelivery" value="text"/);
});

test("Skills management UI has complete English labels", () => {
  const labels = new Map([
    ["有効 0", "0 active"],
    ["必要な能力を見つけて追加すると、選択したキャラクターのWorkですぐ使えます。", "Find a capability and add it for immediate use by the selected character in Work."],
    ["Skillの割り当て先", "Skill assignment target"],
    ["Skillsを設定する相手", "Skills target"],
    ["割り当て先", "Assignment target"],
    ["使用中", "Active"],
    ["端末に保存", "Stored on device"],
    ["要確認", "Needs attention"],
    ["使う能力を管理", "Manage capabilities"],
    ["使用状態を確認しながら、追加・停止・削除までこの画面で完了できます。", "Review availability, then add, disable, or remove skills from one place."],
    ["Skillの表示範囲", "Skill view"],
    ["探す", "Find"],
    ["名前や用途で検索", "Search by name or purpose"],
    ["配布元で絞り込み", "Filter by source"],
    ["すべて", "All"],
    ["公式カタログを準備しています…", "Preparing the official catalog…"],
    ["再読み込み", "Reload"],
    ["カタログにないSkillをGitHub URLから追加", "Add a skill outside the catalog from a GitHub URL"],
    ["任意URLは追加前に内容と配布元を確認します。", "Custom URLs are inspected for content and source before installation."],
    ["追加して有効化", "Add and enable"],
    ["Skillはアプリの機能拡張です。", "Skills extend the app's capabilities."],
    ["端末から削除", "Remove from device"],
    ["Skillの保存ファイルを削除します。必要になった場合は公式カタログまたはGitHub URLから再追加できます。", "Removes this skill's stored files. You can add it again later from the official catalog or a GitHub URL."],
    ["キャンセル", "Cancel"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);
});

test("Skills catalog exposes CharaDock as a source filter", () => {
  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  assert.match(control, /data-skill-source="charadock"[^>]*>CharaDock<\/button>/);
});

test("MCP connection UI explains scope, authentication, and secret handling in English", () => {
  const labels = new Map([
    ["拡張", "Extensions"],
    ["MCP連携", "MCP Connections"],
    ["MCPサーバー", "MCP servers"],
    ["キャラクターが会話や作業で使う外部ツールを、全員共通またはキャラクターごとに接続します。", "Connect external tools for conversation and work, either for every character or for one character."],
    ["割り当てた接続はChat・Work・Liveで使えます。入力欄の＋や /・@ から今回だけ明示することもできます。", "Assigned connections work in Chat, Work, and Live. You can also select one just for this turn from +, /, or @ in the composer."],
    ["接続を追加", "Add connection"],
    ["認証なし・APIキーに対応", "No authentication or API key"],
    ["追加先を信頼できる場合だけ有効にしてください", "Enable only servers you trust"],
    ["MCPサーバーを追加", "Add MCP server"],
    ["認証", "Authentication"],
    ["APIキーヘッダーの詳細", "API key header details"],
    ["保存して接続確認", "Save and test"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);
  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  assert.match(control, /data-page="skills"[\s\S]{0,300}data-page="mcp"/);
  assert.match(control, /data-page-panel="mcp"[\s\S]*id="mcpServersCard"/);
  const connectionPage = control.match(/data-page-panel="connection"[\s\S]*?(?=<section class="page" data-page-panel="desktop")/)?.[0] || "";
  assert.doesNotMatch(connectionPage, /id="mcpServersCard"/);
  assert.match(control, /id="mcpServersCard"/);
  assert.match(control, /id="mcpServerDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(control, /id="mcpServerAuthSelect"[\s\S]*value="none"[\s\S]*value="api-key"/);
});

test("Irodori V4 presents its fixed generation profile without hiding V3 tuning", () => {
  const labels = new Map([
    ["安定性優先の生成設定", "Stability-focused generation"],
    ["FP16とINT4は、末尾の余分な発話を抑えるため検証済みの設定で生成します。", "FP16 and INT4 use a validated profile to reduce unrelated trailing speech."],
    ["Linear・16ステップ以上・逐次処理", "Linear · 16+ steps · Sequential"],
    ["500M-v3の生成品質", "500M-v3 generation quality"],
    ["500M-v3ではSwayによる高速生成を選べます。音質が合わない場合はステップ数を増やすかLinearへ戻してください。", "500M-v3 can use accelerated Sway generation. Increase the steps or switch to Linear if quality is unstable."],
    ["再生速度とシード", "Playback speed and seed"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);

  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  const v4Start = control.indexOf('id="irodoriV4Panel"');
  const v3Start = control.indexOf('id="irodoriV3Panel"');
  assert.ok(v4Start >= 0 && v3Start > v4Start, "Irodori generation panels should be ordered V4 then V3");
  const v4Panel = control.slice(v4Start, v3Start);
  assert.match(v4Panel, /class="irodori-generation-profile"[\s\S]*Linear・16ステップ以上・逐次処理/);
  assert.match(v4Panel, /id="irodoriCfgExecutionSelect" type="hidden" value="sequential"/);
  assert.doesNotMatch(v4Panel, /id="irodoriSamplingModeSelect"|id="irodoriStepsInput"|>CFG実行</);
  assert.match(control, /id="irodoriV3GenerationSettings"[\s\S]*id="irodoriSamplingModeSelect"[\s\S]*id="irodoriStepsInput"[\s\S]*id="irodoriGenerationHint"/);
  assert.equal((control.match(/id="irodoriSamplingModeSelect"/g) || []).length, 1);
  assert.equal((control.match(/id="irodoriStepsInput"/g) || []).length, 1);
});

test("Live automatic-start controls explain microphone behavior in English", () => {
  const labels = new Map([
    ["PCでのLive自動開始", "Automatic Live start on this PC"],
    ["テキスト送信で開始", "Start when sending text"],
    ["送信時にマイクを有効にし、Liveの声で返します", "Enables the microphone when you send and replies with the Live voice"],
    ["キャラクターのタップで開始", "Start when tapping the character"],
    ["タップ時にマイクを有効にし、Liveの声で反応します", "Enables the microphone on tap and reacts with the Live voice"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);
});

test("control and mascot pages load the shared language runtime", () => {
  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  const mascot = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  assert.match(control, /id="languageSelect"/);
  assert.match(control, /src="\.\/i18n\.js"/);
  assert.match(mascot, /src="\.\/desktop\/i18n\.js"/);
});

test("built-in characters provide localized English identities", () => {
  const main = fs.readFileSync(path.join(desktopRoot, "main.cjs"), "utf8");
  for (const name of ["Kohaku", "Sepia", "Towa", "Sage", "AI Nike-chan"]) assert.match(main, new RegExp(`name: "${name}"`));
  assert.match(main, /https:\/\/x\.com\/tegnike/);
  assert.match(main, /https:\/\/nikechan\.com\//);
  assert.match(main, /buildCharacterPersona\(character, language\)/);
  const director = fs.readFileSync(path.join(desktopRoot, "runtime", "character-director.ts"), "utf8");
  assert.match(director, /Speak as \$\{name\}/);
  assert.match(director, /Answer the user's actual question directly/);
  assert.match(main, /Before using tools, send one brief commentary acknowledgement that names the request-specific subject and action/);
});

test("character identity editor uses progressive disclosure and complete English labels", () => {
  const labels = new Map([
    ["キャラクター性", "Character identity"],
    ["標準プロフィール", "Default profile"],
    ["詳しく編集", "Edit details"],
    ["人物像の核", "Core identity"],
    ["役割", "Role"],
    ["利用者との関係", "Relationship with the user"],
    ["大切にする価値観", "Core values"],
    ["話し方", "Speaking style"],
    ["言葉と反応を詳しく調整", "Fine-tune wording and reactions"],
    ["考え中のひとこと", "Thinking phrases"],
    ["キャラクター性を保存", "Save character identity"],
  ]);
  for (const [japanese, english] of labels) assert.equal(translateText(japanese, "en"), english, japanese);

  const control = fs.readFileSync(path.join(desktopRoot, "control.html"), "utf8");
  assert.match(control, /id="characterDirectorDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(control, /id="characterDirectorAdvanced" class="character-director-advanced"/);
  assert.match(control, /id="characterDirectorRoleInput"/);
  assert.match(control, /id="characterDirectorThinkingInput"/);
  assert.match(control, /id="characterDirectorTouchHeadInput"/);
  assert.match(control, /id="characterDirectorTouchBodyInput"/);
  assert.equal(
    translateText("名前・性格が空欄なら元絵から提案し、役割・価値観・話し方・反応まで自動で整えます。生成後はキャラクター設定から直せます。", "en"),
    "If name or personality is blank, CharaDock proposes it from the artwork and also prepares the role, values, speaking style, and reactions. You can edit everything afterward in Character settings.",
  );
});
