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
  assert.match(main, /Respond naturally in English/);
  assert.match(main, /Before using tools, send one brief commentary acknowledgement that names the request-specific subject and action/);
});
