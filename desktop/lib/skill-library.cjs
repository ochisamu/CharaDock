// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const OPENAI_SKILLS_REPOSITORY = "openai/skills";
const OPENAI_CURATED_PATH = "skills/.curated";
const ANTHROPIC_SKILLS_REPOSITORY = "anthropics/skills";
const ANTHROPIC_SKILLS_PATH = "skills";
const TRUSTED_SKILL_SOURCES = Object.freeze([
  Object.freeze({ id: "openai", name: "OpenAI", repository: OPENAI_SKILLS_REPOSITORY, path: OPENAI_CURATED_PATH, sourceKind: "openai-curated" }),
  Object.freeze({ id: "anthropic", name: "Anthropic", repository: ANTHROPIC_SKILLS_REPOSITORY, path: ANTHROPIC_SKILLS_PATH, sourceKind: "anthropic-official" }),
]);
const MAX_SKILL_FILES = 160;
const MAX_TRUSTED_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 12 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 4 * 1024 * 1024;
const CHARADOCK_CREATED_SOURCE_KIND = "charadock-created";
const CHARADOCK_CREATED_SOURCE_NAME = "CharaDock";
const CHARADOCK_CREATED_LICENSE = "User-created";
const MAX_CREATED_SKILL_NAME_LENGTH = 64;
const MAX_CREATED_SKILL_DESCRIPTION_LENGTH = 600;
const MAX_CREATED_SKILL_INSTRUCTIONS_LENGTH = 20_000;

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

function skillIdentity(repository, skillPath) {
  return crypto.createHash("sha256").update(`${repository.toLowerCase()}:${skillPath.toLowerCase()}`).digest("hex").slice(0, 24);
}

function skillContentSha(files) {
  const signature = (Array.isArray(files) ? files : [])
    .map((file) => `${String(file.path || file.sourcePath || "")}:${String(file.sha || "")}:${Number(file.size) || 0}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(signature).digest("hex");
}

function validateCreatedSkillName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > MAX_CREATED_SKILL_NAME_LENGTH
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error("Skill名は64文字以内の小文字・数字・ハイフンによるkebab-caseで入力してください。");
  }
  return name;
}

function validateCreatedSkillInput(input) {
  const name = validateCreatedSkillName(input?.name);
  const description = String(input?.description || "").trim().replace(/\s+/g, " ");
  const instructions = String(input?.instructions || "").trim();
  if (!description || description.length > MAX_CREATED_SKILL_DESCRIPTION_LENGTH || description.includes("\0")) {
    throw new Error("Skillの説明は1〜600文字で入力してください。");
  }
  if (!instructions || instructions.length > MAX_CREATED_SKILL_INSTRUCTIONS_LENGTH || instructions.includes("\0")) {
    throw new Error("Skillの手順は1〜20,000文字で入力してください。");
  }
  const persisted = `${description}\n${instructions}`;
  const sensitive = /(?:sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|bearer\s+[A-Za-z0-9._~+/=-]{12,}|BEGIN [A-Z ]*PRIVATE KEY|(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|session[ _-]?(?:cookie|token)|password|passwd)\s*(?:is\s+|[:=])\s*\S+|(?:パスワード|暗証番号|秘密鍵|クレジットカード|マイナンバー|電話番号|住所)\s*[：:=]\s*\S+)/i;
  const personalPath = /(?:[A-Za-z]:[\\/]Users[\\/][^\\/\s]+|\/(?:home|Users)\/[^/\s]+)/i;
  if (sensitive.test(persisted) || personalPath.test(persisted) || /(?:\d[ -]?){13,19}/.test(persisted)) {
    throw new Error("秘密情報や利用者固有のパスはSkillへ保存できません。");
  }
  return { name, description, instructions };
}

function charadockCreatedSkillId(name) {
  return skillIdentity(CHARADOCK_CREATED_SOURCE_KIND, validateCreatedSkillName(name));
}

function createdSkillMarkdown(input) {
  const skill = validateCreatedSkillInput(input);
  const frontmatter = yaml.dump({ name: skill.name, description: skill.description }, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${skill.instructions}\n`;
}

function trustedSourceFor(repository, skillPath) {
  const normalizedRepository = String(repository || "").toLowerCase();
  return TRUSTED_SKILL_SOURCES.find((source) => normalizedRepository === source.repository
    && (skillPath === source.path || skillPath.startsWith(`${source.path}/`))) || null;
}

function skillLicenseLabel(repository, skillPath, licenseFile = null) {
  const normalizedRepository = String(repository || "").toLowerCase();
  const skillName = String(skillPath || "").split("/").at(-1);
  if (normalizedRepository === OPENAI_SKILLS_REPOSITORY) return "Apache-2.0";
  if (normalizedRepository === ANTHROPIC_SKILLS_REPOSITORY) {
    if (["docx", "pdf", "pptx", "xlsx"].includes(skillName)) return "Anthropic Terms";
    return licenseFile ? "Apache-2.0" : "未確認";
  }
  return licenseFile ? path.basename(licenseFile.path) : "未確認";
}

function skillCategory(name, description) {
  const text = `${name} ${description}`.toLowerCase();
  if (/(?:docx|pdf|pptx|xlsx|document|spreadsheet|presentation)/.test(text)) return "documents";
  if (/(?:design|art|brand|theme|frontend|visual|canvas|gif)/.test(text)) return "design";
  if (/(?:develop|code|test|api|mcp|webapp|security|database|cloud)/.test(text)) return "development";
  if (/(?:communication|comms|slack|writing|coauthor)/.test(text)) return "communication";
  return "productivity";
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
  const repository = `${owner}/${repo}`;
  const trustedSource = trustedSourceFor(repository, skillPath);
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
    sha: String(entry.sha || ""),
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const maxFiles = trustedSource ? MAX_TRUSTED_SKILL_FILES : MAX_SKILL_FILES;
  if (!files.length || files.length > maxFiles || totalBytes > MAX_SKILL_BYTES || files.some((file) => file.size > MAX_SINGLE_FILE_BYTES)) {
    throw new Error("Skillsのファイル数またはサイズが安全上の上限を超えています。");
  }
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}`;
  const skillResponse = await fetchImpl(`${rawBase}/${skillPath.split("/").map(encodeURIComponent).join("/")}/SKILL.md`, { redirect: "error" });
  if (!skillResponse.ok) throw new Error("SKILL.mdを取得できませんでした。");
  const skillText = await skillResponse.text();
  const metadata = parseSkillFrontmatter(skillText);
  const trusted = Boolean(trustedSource);
  const canonicalUrl = `https://github.com/${owner}/${repo}/tree/${commitSha}/${skillPath}`;
  const licenseFile = (Array.isArray(tree?.tree) ? tree.tree : []).find((entry) => entry.type === "blob"
    && new RegExp(`^(?:${skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/)?(?:LICENSE|LICENSE\\.md|LICENSE\\.txt)$`, "i").test(String(entry.path || "")));
  const id = skillIdentity(repository, skillPath);
  return {
    id,
    name: metadata.name,
    description: metadata.description,
    repository,
    ref,
    commitSha,
    contentSha: skillContentSha(files),
    skillPath,
    sourceUrl: canonicalUrl,
    trusted,
    sourceKind: trustedSource?.sourceKind || "github",
    sourceName: trustedSource?.name || repository,
    category: skillCategory(metadata.name, metadata.description),
    license: skillLicenseLabel(repository, skillPath, licenseFile),
    files,
    totalBytes,
    skillText,
    rawBase,
  };
}

async function listOpenAiCuratedSkills(fetchImpl = globalThis.fetch) {
  return (await listTrustedSkillCatalog(fetchImpl)).filter((skill) => skill.sourceId === "openai");
}

async function trustedSourceCatalog(source, fetchImpl) {
  const [owner, repo] = source.repository.split("/");
  const commit = await githubJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/commits/main`);
  const commitSha = String(commit?.sha || "");
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error(`${source.name} Skillsの固定コミットを確認できませんでした。`);
  const tree = await githubJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`);
  if (tree?.truncated) throw new Error(`${source.name} Skillsの一覧が大きすぎるため安全に確認できませんでした。`);
  const allEntries = Array.isArray(tree?.tree) ? tree.tree : [];
  const skillPattern = new RegExp(`^${source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/]+)/SKILL\\.md$`);
  const candidates = allEntries.flatMap((entry) => {
    const match = entry?.type === "blob" ? String(entry.path || "").match(skillPattern) : null;
    return match ? [{ directoryName: match[1], skillPath: entry.path.slice(0, -"/SKILL.md".length) }] : [];
  });
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}`;
  const cards = await Promise.all(candidates.map(async (candidate) => {
    const response = await fetchImpl(`${rawBase}/${candidate.skillPath.split("/").map(encodeURIComponent).join("/")}/SKILL.md`, { redirect: "error" });
    if (!response.ok) return null;
    let metadata;
    try { metadata = parseSkillFrontmatter(await response.text()); } catch { return null; }
    const prefix = `${candidate.skillPath}/`;
    const files = allEntries.filter((entry) => entry.type === "blob" && String(entry.path || "").startsWith(prefix));
    const licenseFile = files.find((entry) => /\/(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/i.test(String(entry.path || "")))
      || allEntries.find((entry) => entry.type === "blob" && /^(?:LICENSE|LICENSE\.md|LICENSE\.txt)$/i.test(String(entry.path || "")));
    return {
      id: skillIdentity(source.repository, candidate.skillPath),
      name: metadata.name,
      description: metadata.description,
      category: skillCategory(metadata.name, metadata.description),
      repository: source.repository,
      sourceId: source.id,
      sourceName: source.name,
      sourceKind: source.sourceKind,
      sourceUrl: `https://github.com/${source.repository}/tree/${commitSha}/${candidate.skillPath}`,
      commitSha,
      contentSha: skillContentSha(files),
      trusted: true,
      license: skillLicenseLabel(source.repository, candidate.skillPath, licenseFile),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
    };
  }));
  return cards.filter(Boolean);
}

async function listTrustedSkillCatalog(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("この環境ではSkillsカタログを取得できません。");
  const results = await Promise.allSettled(TRUSTED_SKILL_SOURCES.map((source) => trustedSourceCatalog(source, fetchImpl)));
  const catalogs = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!catalogs.length) throw results.find((result) => result.status === "rejected")?.reason || new Error("公式Skillsカタログを取得できませんでした。");
  return catalogs.sort((left, right) => left.sourceName.localeCompare(right.sourceName) || left.name.localeCompare(right.name));
}

function installedDirectory(rootDirectory, record) {
  return path.join(rootDirectory, `${cleanId(record.name, 80) || "skill"}-${record.id.slice(0, 8)}`);
}

async function createOrUpdateLocalSkill(input, rootDirectory) {
  const skill = validateCreatedSkillInput(input);
  if (!String(rootDirectory || "").trim()) throw new Error("Skillsの保存先が不正です。");
  const root = path.resolve(String(rootDirectory));
  if (root === path.parse(root).root) throw new Error("Skillsの保存先が不正です。");
  const record = {
    id: charadockCreatedSkillId(skill.name),
    name: skill.name,
    description: skill.description,
    repository: "",
    sourceUrl: "",
    commitSha: "",
    skillPath: "",
    sourceKind: CHARADOCK_CREATED_SOURCE_KIND,
    sourceName: CHARADOCK_CREATED_SOURCE_NAME,
    category: skillCategory(skill.name, skill.description),
    trusted: true,
    license: CHARADOCK_CREATED_LICENSE,
  };
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const destination = installedDirectory(root, record);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error("Skillsの保存先が不正です。");
  const destinationStat = await fs.promises.lstat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (destinationStat?.isSymbolicLink() || (destinationStat && !destinationStat.isDirectory())) {
    throw new Error("Skillsの保存先が安全なフォルダーではありません。");
  }
  await fs.promises.mkdir(destination, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(destination, 0o700).catch(() => {});
  const temporaryPath = path.join(destination, `.SKILL-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
  const targetPath = path.join(destination, "SKILL.md");
  let handle = null;
  try {
    handle = await fs.promises.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(createdSkillMarkdown(skill), "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(temporaryPath, targetPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return {
    ...record,
    directoryName: path.basename(destination),
    installedAt: new Date().toISOString(),
  };
}

async function installResolvedSkill(resolved, rootDirectory, fetchImpl = globalThis.fetch) {
  const root = path.resolve(rootDirectory);
  await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
  const destination = installedDirectory(root, resolved);
  const temporary = await fs.promises.mkdtemp(path.join(root, ".install-"));
  const backup = `${destination}.backup-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let movedPrevious = false;
  let installedNew = false;
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
    try {
      await fs.promises.rename(destination, backup);
      movedPrevious = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fs.promises.rename(temporary, destination);
    installedNew = true;
    if (movedPrevious) await fs.promises.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {});
    if (installedNew) await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
    if (movedPrevious) await fs.promises.rename(backup, destination).catch(() => {});
    throw error;
  }
  return {
    id: resolved.id,
    name: resolved.name,
    description: resolved.description,
    repository: resolved.repository,
    sourceUrl: resolved.sourceUrl,
    commitSha: resolved.commitSha,
    contentSha: resolved.contentSha,
    skillPath: resolved.skillPath,
    sourceKind: resolved.sourceKind,
    sourceName: resolved.sourceName,
    category: resolved.category,
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
    const sourceKind = ["openai-curated", "anthropic-official", CHARADOCK_CREATED_SOURCE_KIND].includes(item?.sourceKind)
      ? item.sourceKind
      : "github";
    const isCreated = sourceKind === CHARADOCK_CREATED_SOURCE_KIND;
    return [{
      id,
      name: String(item?.name || "Skill").trim().slice(0, 100),
      description: String(item?.description || "").trim().slice(0, 600),
      repository: isCreated ? "" : String(item?.repository || "").trim().slice(0, 220),
      sourceUrl: !isCreated && /^https:\/\//.test(String(item?.sourceUrl || "")) ? String(item.sourceUrl).slice(0, 1200) : "",
      commitSha: !isCreated && /^[a-f0-9]{40}$/i.test(String(item?.commitSha || "")) ? String(item.commitSha) : "",
      contentSha: !isCreated && /^[a-f0-9]{64}$/i.test(String(item?.contentSha || "")) ? String(item.contentSha) : "",
      skillPath: isCreated ? "" : String(item?.skillPath || "").slice(0, 500),
      sourceKind,
      sourceName: isCreated
        ? CHARADOCK_CREATED_SOURCE_NAME
        : String(item?.sourceName || (sourceKind === "openai-curated" ? "OpenAI" : sourceKind === "anthropic-official" ? "Anthropic" : item?.repository || "GitHub")).slice(0, 100),
      category: ["documents", "design", "development", "communication", "productivity"].includes(item?.category) ? item.category : skillCategory(item?.name, item?.description),
      trusted: isCreated ? true : Boolean(item?.trusted),
      license: isCreated ? CHARADOCK_CREATED_LICENSE : String(item?.license || "未確認").slice(0, 100),
      directoryName,
      installedAt: String(item?.installedAt || "").slice(0, 40),
    }];
  });
}

function normalizeSkillAssignments(value, installedIds = []) {
  const allowed = new Set(installedIds.map(String));
  const ids = (items) => [...new Set((Array.isArray(items) ? items : []).map((item) => cleanId(item, 80)).filter((id) => id && allowed.has(id)))].slice(0, 100);
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
  CHARADOCK_CREATED_LICENSE,
  CHARADOCK_CREATED_SOURCE_KIND,
  CHARADOCK_CREATED_SOURCE_NAME,
  OPENAI_CURATED_PATH,
  ANTHROPIC_SKILLS_PATH,
  TRUSTED_SKILL_SOURCES,
  assignedSkillIds,
  charadockCreatedSkillId,
  createOrUpdateLocalSkill,
  createdSkillMarkdown,
  installResolvedSkill,
  installedDirectory,
  listOpenAiCuratedSkills,
  listTrustedSkillCatalog,
  normalizeManagedSkills,
  normalizeSkillAssignments,
  parseGitHubSkillUrl,
  parseSkillFrontmatter,
  resolveSkillSource,
  validateCreatedSkillInput,
};
