// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const OPENAI_SKILLS_REPOSITORY = "openai/skills";
const OPENAI_CURATED_PATH = "skills/.curated";
const MAX_SKILL_FILES = 160;
const MAX_SKILL_BYTES = 12 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 4 * 1024 * 1024;

function cleanId(value, max = 160) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, max);
}

function parseSkillFrontmatter(text) {
  const source = String(text || "");
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.mdにYAMLフロントマターがありません。");
  let metadata;
  try {
    metadata = yaml.load(match[1]);
  } catch {
    throw new Error("SKILL.mdのYAMLフロントマターを読み取れません。");
  }
  const name = String(metadata?.name || "").trim().slice(0, 100);
  const description = String(metadata?.description || "").trim().replace(/\s+/g, " ").slice(0, 600);
  if (!name || !description) throw new Error("SKILL.mdにはnameとdescriptionが必要です。");
  return { name, description };
}

function parseGitHubSkillUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("有効なHTTPS URLを入力してください。"); }
  if (url.protocol !== "https:") throw new Error("Skillsの取得先はHTTPS URLに限ります。");
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let owner = "";
  let repo = "";
  let ref = "main";
  let skillPath = "";
  if (url.hostname === "github.com") {
    [owner, repo] = segments;
    repo = String(repo || "").replace(/\.git$/i, "");
    if (segments[2] === "tree" || segments[2] === "blob") {
      ref = segments[3] || "main";
      skillPath = segments.slice(4).join("/");
      if (segments[2] === "blob" && /(^|\/)SKILL\.md$/i.test(skillPath)) skillPath = skillPath.replace(/(^|\/)SKILL\.md$/i, "");
    } else {
      skillPath = String(url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
      ref = String(url.searchParams.get("ref") || "main");
    }
  } else if (url.hostname === "raw.githubusercontent.com") {
    [owner, repo, ref] = segments;
    skillPath = segments.slice(3).join("/").replace(/(^|\/)SKILL\.md$/i, "");
  } else {
    throw new Error("任意Skillsは現在、公開GitHubリポジトリのURLに対応しています。");
  }
  if (![owner, repo, ref, skillPath].every(Boolean)) {
    throw new Error("Skillsフォルダー、またはSKILL.mdを指すGitHub URLを入力してください。");
  }
  if (![owner, repo].every((part) => /^[a-zA-Z0-9_.-]{1,100}$/.test(part))
    || !/^[a-zA-Z0-9._/-]{1,240}$/.test(ref)
    || !/^[a-zA-Z0-9._/-]{1,500}$/.test(skillPath)
    || skillPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("GitHub URLに利用できない文字が含まれています。");
  }
  return { owner, repo, ref, skillPath: skillPath.replace(/^\/+|\/+$/g, "") };
}

function githubHeaders() {
  return { Accept: "application/vnd.github+json", "User-Agent": "CharaDock-Skill-Library", "X-GitHub-Api-Version": "2022-11-28" };
}

async function githubJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: githubHeaders(), redirect: "error" });
  if (!response.ok) {
    if (response.status === 403) throw new Error("GitHubの取得回数制限に達しました。少し待ってから再試行してください。");
    if (response.status === 404) throw new Error("公開されたSkillsを見つけられませんでした。URLを確認してください。");
    throw new Error(`GitHubからSkillsを取得できませんでした（HTTP ${response.status}）。`);
  }
  return response.json();
}

async function resolveSkillSource(input, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("この環境ではSkillsをダウンロードできません。");
  const source = typeof input === "string" ? parseGitHubSkillUrl(input) : { ...input };
  const owner = String(source.owner || "");
  const repo = String(source.repo || "");
  const ref = String(source.ref || "main");
  const skillPath = String(source.skillPath || "").replace(/^\/+|\/+$/g, "");
  const commit = await githubJson(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`);
  const commitSha = String(commit?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error("Skillsの固定コミットを確認できませんでした。");
  const tree = await githubJson(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commitSha}?recursive=1`);
  if (tree?.truncated) throw new Error("リポジトリが大きすぎるためSkillsを安全に確認できませんでした。");
  const prefix = `${skillPath}/`;
  const entries = (Array.isArray(tree?.tree) ? tree.tree : []).filter((entry) => String(entry?.path || "").startsWith(prefix));
  const skillFile = entries.find((entry) => entry.path === `${skillPath}/SKILL.md` && entry.type === "blob");
  if (!skillFile) throw new Error("指定フォルダーにSKILL.mdがありません。");
  if (entries.some((entry) => entry.type === "commit" || entry.mode === "120000" || entry.mode === "160000")) {
    throw new Error("シンボリックリンクまたはサブモジュールを含むSkillsは追加できません。");
  }
  const files = entries.filter((entry) => entry.type === "blob").map((entry) => ({
    path: entry.path.slice(prefix.length),
    sourcePath: entry.path,
    size: Number(entry.size) || 0,
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (!files.length || files.length > MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES || files.some((file) => file.size > MAX_SINGLE_FILE_BYTES)) {
    throw new Error("Skillsのファイル数またはサイズが安全上の上限を超えています。");
  }
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}`;
  const skillResponse = await fetchImpl(`${rawBase}/${skillPath.split("/").map(encodeURIComponent).join("/")}/SKILL.md`, { redirect: "error" });
  if (!skillResponse.ok) throw new Error("SKILL.mdを取得できませんでした。");
  const skillText = await skillResponse.text();
  const metadata = parseSkillFrontmatter(skillText);
  const repository = `${owner}/${repo}`;
  const trusted = repository.toLowerCase() === OPENAI_SKILLS_REPOSITORY;
  const canonicalUrl = `https://github.com/${owner}/${repo}/tree/${commitSha}/${skillPath}`;
  const licenseFile = (Array.isArray(tree?.tree) ? tree.tree : []).find((entry) => entry.type === "blob" && /^(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/i.test(String(entry.path || "")));
  const id = crypto.createHash("sha256").update(`${repository.toLowerCase()}:${skillPath.toLowerCase()}`).digest("hex").slice(0, 24);
  return {
    id,
    name: metadata.name,
    description: metadata.description,
    repository,
    ref,
    commitSha,
    skillPath,
    sourceUrl: canonicalUrl,
    trusted,
    sourceKind: trusted && skillPath.startsWith(`${OPENAI_CURATED_PATH}/`) ? "openai-curated" : "github",
    license: licenseFile ? path.basename(licenseFile.path) : "未確認",
    files,
    totalBytes,
    skillText,
    rawBase,
  };
}

async function listOpenAiCuratedSkills(fetchImpl = globalThis.fetch) {
  const entries = await githubJson(fetchImpl, `https://api.github.com/repos/${OPENAI_SKILLS_REPOSITORY}/contents/${OPENAI_CURATED_PATH}?ref=main`);
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry?.type === "dir" && entry?.name).map((entry) => ({
    id: `openai:${String(entry.name)}`,
    name: String(entry.name),
    sourceUrl: `https://github.com/${OPENAI_SKILLS_REPOSITORY}/tree/main/${OPENAI_CURATED_PATH}/${encodeURIComponent(String(entry.name))}`,
    trusted: true,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function installedDirectory(rootDirectory, record) {
  return path.join(rootDirectory, `${cleanId(record.name, 80) || "skill"}-${record.id.slice(0, 8)}`);
}

async function installResolvedSkill(resolved, rootDirectory, fetchImpl = globalThis.fetch) {
  const root = path.resolve(rootDirectory);
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const destination = installedDirectory(root, resolved);
  const temporary = await fs.promises.mkdtemp(path.join(root, ".install-"));
  let downloadedBytes = 0;
  try {
    for (const file of resolved.files) {
      const target = path.resolve(temporary, file.path);
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error("Skills内に不正なパスがあります。");
      await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const url = `${resolved.rawBase}/${resolved.skillPath.split("/").map(encodeURIComponent).join("/")}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      const response = await fetchImpl(url, { redirect: "error" });
      if (!response.ok) throw new Error(`Skillsファイルを取得できませんでした: ${file.path}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      downloadedBytes += buffer.length;
      if (buffer.length > MAX_SINGLE_FILE_BYTES || downloadedBytes > MAX_SKILL_BYTES) throw new Error("Skillsファイルが安全上の上限を超えています。");
      await fs.promises.writeFile(target, buffer, { mode: 0o600 });
    }
    await fs.promises.rm(destination, { recursive: true, force: true });
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    id: resolved.id,
    name: resolved.name,
    description: resolved.description,
    repository: resolved.repository,
    sourceUrl: resolved.sourceUrl,
    commitSha: resolved.commitSha,
    skillPath: resolved.skillPath,
    sourceKind: resolved.sourceKind,
    trusted: Boolean(resolved.trusted),
    license: resolved.license,
    directoryName: path.basename(destination),
    installedAt: new Date().toISOString(),
  };
}

function normalizeManagedSkills(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 100).flatMap((item) => {
    const id = cleanId(item?.id, 80);
    const directoryName = cleanId(item?.directoryName, 120);
    if (!id || !directoryName || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: String(item?.name || "Skill").trim().slice(0, 100),
      description: String(item?.description || "").trim().slice(0, 600),
      repository: String(item?.repository || "").trim().slice(0, 220),
      sourceUrl: /^https:\/\//.test(String(item?.sourceUrl || "")) ? String(item.sourceUrl).slice(0, 1200) : "",
      commitSha: /^[a-f0-9]{40}$/i.test(String(item?.commitSha || "")) ? String(item.commitSha) : "",
      skillPath: String(item?.skillPath || "").slice(0, 500),
      sourceKind: item?.sourceKind === "openai-curated" ? "openai-curated" : "github",
      trusted: Boolean(item?.trusted),
      license: String(item?.license || "未確認").slice(0, 100),
      directoryName,
      installedAt: String(item?.installedAt || "").slice(0, 40),
    }];
  });
}

function normalizeSkillAssignments(value, installedIds = []) {
  const allowed = new Set(installedIds.map(String));
  const ids = (items) => [...new Set((Array.isArray(items) ? items : []).map((item) => cleanId(item, 80)).filter((id) => id && allowed.has(id)))].slice(0, 40);
  const characters = value?.characters && typeof value.characters === "object" && !Array.isArray(value.characters)
    ? Object.fromEntries(Object.entries(value.characters).slice(0, 100).flatMap(([characterId, skillIds]) => {
      const id = cleanId(characterId, 120);
      const assigned = ids(skillIds);
      return id && assigned.length ? [[id, assigned]] : [];
    })) : {};
  return { all: ids(value?.all), characters };
}

function assignedSkillIds(assignments, characterId) {
  return [...new Set([...(assignments?.all || []), ...(assignments?.characters?.[String(characterId)] || [])])];
}

module.exports = {
  OPENAI_CURATED_PATH,
  assignedSkillIds,
  installResolvedSkill,
  installedDirectory,
  listOpenAiCuratedSkills,
  normalizeManagedSkills,
  normalizeSkillAssignments,
  parseGitHubSkillUrl,
  parseSkillFrontmatter,
  resolveSkillSource,
};
