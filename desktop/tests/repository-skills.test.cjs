// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");

test("character experience Skill retains the cross-surface quality matrix", () => {
  const skill = fs.readFileSync(path.join(root, ".agents", "skills", "design-character-dialogue", "SKILL.md"), "utf8");
  const matrixPath = path.join(root, ".agents", "skills", "design-character-dialogue", "references", "interaction-quality-matrix.md");
  const matrix = fs.readFileSync(matrixPath, "utf8");
  assert.match(skill, /Keep one runtime behind every surface/);
  assert.match(skill, /Retain quality knowledge/);
  for (const phrase of ["Desktop mascot", "Settings chat", "Remote", "Live Work", "duplicate/late event", "full repository test suite"]) {
    assert.match(matrix, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("MCP Apps review Skill and real-profile verifier ship with the application", () => {
  const skill = fs.readFileSync(path.join(root, ".agents", "skills", "review-mcp-app-host", "SKILL.md"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(skill, /desktop mascot, settings chat/);
  assert.match(skill, /fail closed/);
  assert.match(skill, /scripts\/verify-mcp-app-ui\.cjs/);
  assert.ok(fs.existsSync(path.join(root, "scripts", "verify-mcp-app-ui.cjs")));
  assert.ok(packageJson.build.files.includes(".agents/skills/**/*"));
});
