// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HOME_PROJECT_ID = "home";
const MAX_PROJECTS_PER_CHARACTER = 24;

function safeCharacterId(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  if (!normalized) throw new Error("キャラクターを特定できません。");
  return normalized;
}

function normalizedProjectPath(value) {
  const source = String(value || "").trim();
  if (!source || source.includes("\0")) return "";
  return path.resolve(source).slice(0, 1200);
}

function projectIdForPath(value) {
  const resolved = normalizedProjectPath(value);
  const comparable = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return resolved ? `project-${crypto.createHash("sha256").update(comparable).digest("hex").slice(0, 16)}` : "";
}

function normalizeCharacterWorkspaces(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 60).flatMap(([characterId, workspace]) => {
    let id;
    try { id = safeCharacterId(characterId); } catch { return []; }
    if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) return [];
    const seen = new Set();
    const projects = (Array.isArray(workspace.projects) ? workspace.projects : []).slice(0, MAX_PROJECTS_PER_CHARACTER).flatMap((project) => {
      const projectPath = normalizedProjectPath(project?.path);
      const projectId = projectIdForPath(projectPath);
      if (!projectPath || !projectId || seen.has(projectId)) return [];
      seen.add(projectId);
      return [{
        id: projectId,
        name: String(project?.name || path.basename(projectPath) || "Project").trim().slice(0, 100),
        path: projectPath,
        addedAt: String(project?.addedAt || "").slice(0, 40),
        lastUsedAt: String(project?.lastUsedAt || project?.addedAt || "").slice(0, 40),
      }];
    });
    const requestedActiveId = String(workspace.activeProjectId || HOME_PROJECT_ID);
    const activeProjectId = requestedActiveId === HOME_PROJECT_ID || projects.some((project) => project.id === requestedActiveId)
      ? requestedActiveId : HOME_PROJECT_ID;
    return [[id, { activeProjectId, projects }]];
  }));
}

function workspaceForCharacter(value, characterId) {
  const workspaces = normalizeCharacterWorkspaces(value);
  const id = safeCharacterId(characterId);
  return workspaces[id] || { activeProjectId: HOME_PROJECT_ID, projects: [] };
}

function addCharacterProject(value, characterId, projectPath, now = new Date()) {
  const workspaces = normalizeCharacterWorkspaces(value);
  const id = safeCharacterId(characterId);
  const workspace = workspaces[id] || { activeProjectId: HOME_PROJECT_ID, projects: [] };
  const resolved = normalizedProjectPath(projectPath);
  const projectId = projectIdForPath(resolved);
  if (!resolved || !projectId) throw new Error("作業フォルダーが正しくありません。");
  const timestamp = now.toISOString();
  const existing = workspace.projects.find((project) => project.id === projectId);
  const record = existing
    ? { ...existing, name: path.basename(resolved) || existing.name, lastUsedAt: timestamp }
    : { id: projectId, name: path.basename(resolved) || "Project", path: resolved, addedAt: timestamp, lastUsedAt: timestamp };
  const projects = [record, ...workspace.projects.filter((project) => project.id !== projectId)].slice(0, MAX_PROJECTS_PER_CHARACTER);
  workspaces[id] = { activeProjectId: projectId, projects };
  return { workspaces, record };
}

function activateCharacterProject(value, characterId, projectId, now = new Date()) {
  const workspaces = normalizeCharacterWorkspaces(value);
  const id = safeCharacterId(characterId);
  const workspace = workspaces[id] || { activeProjectId: HOME_PROJECT_ID, projects: [] };
  const target = String(projectId || HOME_PROJECT_ID);
  if (target !== HOME_PROJECT_ID && !workspace.projects.some((project) => project.id === target)) {
    throw new Error("担当プロジェクトが見つかりません。");
  }
  const timestamp = now.toISOString();
  workspaces[id] = {
    activeProjectId: target,
    projects: workspace.projects.map((project) => project.id === target ? { ...project, lastUsedAt: timestamp } : project),
  };
  return workspaces;
}

function removeCharacterProject(value, characterId, projectId) {
  const target = String(projectId || "");
  if (!target || target === HOME_PROJECT_ID) throw new Error("キャラクターホームは解除できません。");
  const workspaces = normalizeCharacterWorkspaces(value);
  const id = safeCharacterId(characterId);
  const workspace = workspaces[id] || { activeProjectId: HOME_PROJECT_ID, projects: [] };
  const projects = workspace.projects.filter((project) => project.id !== target);
  if (projects.length === workspace.projects.length) throw new Error("担当プロジェクトが見つかりません。");
  workspaces[id] = { activeProjectId: workspace.activeProjectId === target ? HOME_PROJECT_ID : workspace.activeProjectId, projects };
  return workspaces;
}

function writeManagedFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = `${String(content || "").trim()}\n`;
  try {
    if (fs.readFileSync(filePath, "utf8") === normalized) return;
  } catch {}
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, normalized, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

class CharacterHomeManager {
  constructor(rootDirectory, skillDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.skillDirectory = path.resolve(skillDirectory);
  }

  homeDirectory(characterId) {
    return path.join(this.rootDirectory, safeCharacterId(characterId));
  }

  ensure(character) {
    const home = this.homeDirectory(character?.id);
    const skillTarget = path.join(home, ".agents", "skills", "manage-character-home");
    fs.mkdirSync(path.join(home, "notes"), { recursive: true });
    fs.mkdirSync(path.join(home, "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(home, "projects"), { recursive: true });
    fs.mkdirSync(skillTarget, { recursive: true });
    for (const relative of ["SKILL.md", path.join("agents", "openai.yaml")]) {
      const source = path.join(this.skillDirectory, relative);
      if (fs.existsSync(source)) {
        fs.mkdirSync(path.dirname(path.join(skillTarget, relative)), { recursive: true });
        fs.copyFileSync(source, path.join(skillTarget, relative));
      }
    }
    writeManagedFile(path.join(home, "HOME.md"), [
      `# ${String(character?.name || "Character").slice(0, 80)} Home`,
      "",
      "This is CharaDock-managed durable working context for this character.",
      "",
      `- Character ID: ${safeCharacterId(character?.id)}`,
      `- Personality: ${String(character?.personality || "").replace(/\s+/g, " ").slice(0, 1000) || "Not specified"}`,
      "- `notes/`: deliberately retained cross-project notes",
      "- `artifacts/`: outputs created while this home is the active project",
      "- `projects/`: compact continuity records for attached projects",
      "",
      "Follow `.agents/skills/manage-character-home/SKILL.md` when reading or updating this home.",
    ].join("\n"));
    return home;
  }

  projectRecordPath(characterId, projectId) {
    if (!/^project-[a-f0-9]{16}$/.test(String(projectId || ""))) return "";
    return path.join(this.homeDirectory(characterId), "projects", `${projectId}.md`);
  }

  ensureProjectRecord(character, project) {
    const home = this.ensure(character);
    const recordPath = !project?.id || project.id === HOME_PROJECT_ID
      ? path.join(home, "projects", "home.md")
      : this.projectRecordPath(character.id, project.id);
    if (!fs.existsSync(recordPath)) writeManagedFile(recordPath, [
      `# ${String(project.name || "Project").slice(0, 100)}`,
      "",
      "## Goal",
      "",
      "Not recorded yet.",
      "",
      "## Current state",
      "",
      "Not recorded yet.",
      "",
      "## Decisions and constraints",
      "",
      "- None recorded.",
      "",
      "## Next step",
      "",
      "Not recorded yet.",
    ].join("\n"));
    return recordPath;
  }

  remove(characterId) {
    const home = this.homeDirectory(characterId);
    const relative = path.relative(this.rootDirectory, home);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("キャラクターホームを安全に削除できません。");
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = {
  CharacterHomeManager,
  HOME_PROJECT_ID,
  MAX_PROJECTS_PER_CHARACTER,
  activateCharacterProject,
  addCharacterProject,
  normalizeCharacterWorkspaces,
  projectIdForPath,
  removeCharacterProject,
  workspaceForCharacter,
};
