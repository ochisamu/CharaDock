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
  assert.equal(translateText("キャラクター設定", "ja"), "キャラクター設定");
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
