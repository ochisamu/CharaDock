// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..", "..");

test("bundles Skill Creator and exposes a confirmed text-only creation tool", () => {
  const skillPath = path.join(projectRoot, ".agents", "skills", "skill-creator", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  assert.match(skill, /^---\nname: skill-creator\n/);
  assert.match(skill, /Ask for one explicit confirmation before saving/);
  assert.match(skill, /Do not copy the transcript/);
  assert.ok(packageJson.build.files.includes(".agents/skills/**/*"));
  assert.match(main, /const BUILTIN_SKILL_CREATOR_ID = "charadock-skill-creator"/);
  assert.match(main, /function ensureBuiltInSkillCreator\(\)/);
  assert.match(main, /path\.join\(app\.getPath\("userData"\), "built-in-skills", "skill-creator"\)/);
  assert.match(main, /name: "skill_create"/);
  assert.match(main, /required: \["name", "description", "instructions", "scope", "confirmed"\]/);
  assert.match(main, /args\.confirmed !== true/);
  assert.match(main, /sourceKind === "charadock-created"/);
});

test("Skills UI distinguishes built-in, active, stored, and removable states", () => {
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");

  assert.match(html, /data-skill-view="active"/);
  assert.match(html, /data-skill-view="installed"/);
  assert.match(html, /data-skill-source="charadock"/);
  assert.match(html, /id="skillRemoveDialog"/);
  assert.match(html, /id="chatAddButton"/);
  assert.match(html, /id="chatSelectedSkillList"/);
  assert.match(html, /id="chatSkillPickerList"/);
  assert.match(control, /localized\("標準搭載", "Built in"\)/);
  assert.match(control, /localized\("端末に保存・停止中", "Stored on device · Off"\)/);
  assert.match(control, /if \(installed && !skill\.builtIn\)/);
});
