// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CharacterHomeManager,
  HOME_PROJECT_ID,
  activateCharacterProject,
  addCharacterProject,
  normalizeCharacterWorkspaces,
  removeCharacterProject,
  workspaceForCharacter,
} = require("../lib/character-home.cjs");

test("character workspaces keep home and multiple existing projects independently", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-home-data-"));
  const first = path.join(base, "first");
  const second = path.join(base, "second");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  try {
    let value = addCharacterProject({}, "amber-avatar", first, new Date("2026-01-01T00:00:00Z")).workspaces;
    value = addCharacterProject(value, "amber-avatar", second, new Date("2026-01-02T00:00:00Z")).workspaces;
    const workspace = workspaceForCharacter(value, "amber-avatar");
    assert.equal(workspace.projects.length, 2);
    assert.equal(workspace.projects[0].path, path.resolve(second));
    assert.equal(workspace.activeProjectId, workspace.projects[0].id);

    value = activateCharacterProject(value, "amber-avatar", HOME_PROJECT_ID);
    assert.equal(workspaceForCharacter(value, "amber-avatar").activeProjectId, HOME_PROJECT_ID);
    value = removeCharacterProject(value, "amber-avatar", workspace.projects[1].id);
    assert.equal(workspaceForCharacter(value, "amber-avatar").projects.length, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("character home creates stable managed structure and skill copy", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-home-manager-"));
  const skill = path.join(base, "skill");
  const root = path.join(base, "homes");
  fs.mkdirSync(path.join(skill, "agents"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "skill body\n");
  fs.writeFileSync(path.join(skill, "agents", "openai.yaml"), "interface: {}\n");
  try {
    const manager = new CharacterHomeManager(root, skill);
    const character = { id: "amber-avatar", name: "コハク", personality: "明るい" };
    const home = manager.ensure(character);
    assert.match(fs.readFileSync(path.join(home, "HOME.md"), "utf8"), /コハク Home/);
    assert.equal(fs.readFileSync(path.join(home, ".agents", "skills", "manage-character-home", "SKILL.md"), "utf8"), "skill body\n");
    const homeRecord = manager.ensureProjectRecord(character, { id: HOME_PROJECT_ID, name: "Home" });
    assert.equal(homeRecord, path.join(home, "projects", "home.md"));
    assert.match(fs.readFileSync(homeRecord, "utf8"), /## Goal/);
    const project = addCharacterProject({}, character.id, path.join(base, "project")).record;
    const record = manager.ensureProjectRecord(character, project);
    assert.match(fs.readFileSync(record, "utf8"), /## Current state/);
    manager.remove(character.id);
    assert.equal(fs.existsSync(home), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("workspace normalization rejects unsafe shapes and preserves only bounded records", () => {
  const normalized = normalizeCharacterWorkspaces({
    "../bad": { activeProjectId: "missing", projects: [{ path: "" }] },
    "sage-avatar": { activeProjectId: "missing", projects: [{ path: process.cwd(), name: "Repo" }] },
  });
  assert.equal(normalized["sage-avatar"].activeProjectId, HOME_PROJECT_ID);
  assert.equal(normalized["sage-avatar"].projects.length, 1);
});
