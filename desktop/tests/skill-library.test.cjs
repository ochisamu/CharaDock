// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CHARADOCK_CREATED_LICENSE,
  CHARADOCK_CREATED_SOURCE_KIND,
  assignedSkillIds,
  charadockCreatedSkillId,
  createOrUpdateLocalSkill,
  installResolvedSkill,
  listTrustedSkillCatalog,
  normalizeManagedSkills,
  normalizeSkillAssignments,
  parseGitHubSkillUrl,
  parseSkillFrontmatter,
  resolveSkillSource,
  validateCreatedSkillInput,
} = require("../lib/skill-library.cjs");

const COMMIT = "a".repeat(40);
const ANTHROPIC_COMMIT = "b".repeat(40);
const SKILL_TEXT = `---
name: demo-skill
description: Safely demonstrates a test workflow.
---

# Demo
`;
const ANTHROPIC_DESIGN_SKILL = `---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality.
---

# Frontend design
`;
const ANTHROPIC_DOCX_SKILL = `---
name: docx
description: Create, edit, and inspect Word documents.
---

# Documents
`;

function response(body, { status = 200, json = false } = {}) {
  const buffer = Buffer.from(json ? JSON.stringify(body) : String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(buffer.toString("utf8")),
    text: async () => buffer.toString("utf8"),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

function mockFetch(url) {
  const value = String(url);
  if (value.includes("/commits/main")) return Promise.resolve(response({ sha: COMMIT }, { json: true }));
  if (value.includes("/git/trees/")) return Promise.resolve(response({
    truncated: false,
    tree: [
      { path: "LICENSE", type: "blob", mode: "100644", size: 11 },
      { path: "skills/.curated/demo/SKILL.md", type: "blob", mode: "100644", size: Buffer.byteLength(SKILL_TEXT) },
      { path: "skills/.curated/demo/references/note.txt", type: "blob", mode: "100644", size: 5 },
    ],
  }, { json: true }));
  if (value.endsWith("/SKILL.md")) return Promise.resolve(response(SKILL_TEXT));
  if (value.endsWith("/references/note.txt")) return Promise.resolve(response("hello"));
  return Promise.resolve(response("missing", { status: 404 }));
}

function trustedCatalogFetch(url) {
  const value = String(url);
  if (value.includes("/repos/openai/skills/commits/main")) return Promise.resolve(response({ sha: COMMIT }, { json: true }));
  if (value.includes("/repos/anthropics/skills/commits/main")) return Promise.resolve(response({ sha: ANTHROPIC_COMMIT }, { json: true }));
  if (value.includes(`/git/trees/${COMMIT}`)) return Promise.resolve(response({
    truncated: false,
    tree: [
      { path: "LICENSE", type: "blob", mode: "100644", size: 11 },
      { path: "skills/.curated/demo/SKILL.md", type: "blob", mode: "100644", size: Buffer.byteLength(SKILL_TEXT) },
    ],
  }, { json: true }));
  if (value.includes(`/git/trees/${ANTHROPIC_COMMIT}`)) return Promise.resolve(response({
    truncated: false,
    tree: [
      { path: "LICENSE", type: "blob", mode: "100644", size: 11 },
      { path: "skills/frontend-design/SKILL.md", type: "blob", mode: "100644", size: Buffer.byteLength(ANTHROPIC_DESIGN_SKILL) },
      { path: "skills/docx/SKILL.md", type: "blob", mode: "100644", size: Buffer.byteLength(ANTHROPIC_DOCX_SKILL) },
      { path: "skills/docx/LICENSE.txt", type: "blob", mode: "100644", size: 13 },
    ],
  }, { json: true }));
  if (value.includes("skills/.curated/demo/SKILL.md")) return Promise.resolve(response(SKILL_TEXT));
  if (value.includes("skills/frontend-design/SKILL.md")) return Promise.resolve(response(ANTHROPIC_DESIGN_SKILL));
  if (value.includes("skills/docx/SKILL.md")) return Promise.resolve(response(ANTHROPIC_DOCX_SKILL));
  return Promise.resolve(response("missing", { status: 404 }));
}

test("parses GitHub tree and SKILL.md URLs", () => {
  assert.deepEqual(parseGitHubSkillUrl("https://github.com/openai/skills/tree/main/skills/.curated/demo"), {
    owner: "openai", repo: "skills", ref: "main", skillPath: "skills/.curated/demo",
  });
  assert.deepEqual(parseGitHubSkillUrl("https://github.com/openai/skills/blob/main/skills/.curated/demo/SKILL.md"), {
    owner: "openai", repo: "skills", ref: "main", skillPath: "skills/.curated/demo",
  });
  assert.throws(() => parseGitHubSkillUrl("https://example.com/SKILL.md"), /GitHub/);
});

test("inspects and pins an OpenAI curated skill", async () => {
  const resolved = await resolveSkillSource("https://github.com/openai/skills/tree/main/skills/.curated/demo", mockFetch);
  assert.equal(resolved.name, "demo-skill");
  assert.equal(resolved.description, "Safely demonstrates a test workflow.");
  assert.equal(resolved.commitSha, COMMIT);
  assert.match(resolved.contentSha, /^[a-f0-9]{64}$/);
  assert.equal(resolved.trusted, true);
  assert.equal(resolved.sourceKind, "openai-curated");
  assert.equal(resolved.sourceName, "OpenAI");
  assert.equal(resolved.license, "Apache-2.0");
  assert.equal(resolved.files.length, 2);
});

test("lists OpenAI and Anthropic official skills with source and license metadata", async () => {
  const skills = await listTrustedSkillCatalog(trustedCatalogFetch);
  assert.equal(skills.length, 3);
  const anthropicDesign = skills.find((skill) => skill.name === "frontend-design");
  const anthropicDocx = skills.find((skill) => skill.name === "docx");
  assert.equal(anthropicDesign.sourceKind, "anthropic-official");
  assert.equal(anthropicDesign.sourceName, "Anthropic");
  assert.equal(anthropicDesign.license, "Apache-2.0");
  assert.equal(anthropicDocx.license, "Anthropic Terms");
  assert.match(anthropicDocx.sourceUrl, new RegExp(ANTHROPIC_COMMIT));
  assert.equal(skills.find((skill) => skill.name === "demo-skill").sourceName, "OpenAI");
});

test("keeps a working official catalog when the other source is unavailable", async () => {
  const skills = await listTrustedSkillCatalog((url) => {
    if (String(url).includes("anthropics/skills")) return Promise.resolve(response("unavailable", { status: 500 }));
    return trustedCatalogFetch(url);
  });
  assert.deepEqual(skills.map((skill) => skill.name), ["demo-skill"]);
});

test("skill settings expose a searchable one-click official catalog", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "control.html"), "utf8");
  const control = fs.readFileSync(path.resolve(__dirname, "..", "control.js"), "utf8");
  assert.match(html, /id="skillCatalogSearchInput"/);
  assert.match(html, /data-skill-source="openai"/);
  assert.match(html, /data-skill-source="anthropic"/);
  assert.match(html, /id="trustedSkillCatalog"/);
  assert.doesNotMatch(html, /id="trustedSkillSelect"/);
  assert.match(control, /async function installCatalogSkill/);
  assert.match(control, /if \(page === "skills"\) queueMicrotask\(\(\) => loadTrustedSkills\(\)\)/);
});

test("installs once and assigns globally or per character", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "charadock-skills-"));
  try {
    const resolved = await resolveSkillSource("https://github.com/openai/skills/tree/main/skills/.curated/demo", mockFetch);
    const record = await installResolvedSkill(resolved, root, mockFetch);
    const skills = normalizeManagedSkills([record]);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].contentSha, resolved.contentSha);
    assert.equal(fs.existsSync(path.join(root, record.directoryName, "SKILL.md")), true);
    assert.equal(fs.readFileSync(path.join(root, record.directoryName, "references", "note.txt"), "utf8"), "hello");
    const assignments = normalizeSkillAssignments({
      all: [record.id],
      characters: { kohaku: [record.id], towa: ["missing"] },
    }, [record.id]);
    assert.deepEqual(assignedSkillIds(assignments, "kohaku"), [record.id]);
    assert.deepEqual(assignments.characters.towa, undefined);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("creates and atomically updates a CharaDock text-only skill with a stable identity", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "charadock-created-skills-"));
  try {
    const first = await createOrUpdateLocalSkill({
      name: "summarize-work-log",
      description: "Turn a completed work session into concise durable notes.",
      instructions: "# Workflow\n\n1. Read the completed work.\n2. Keep only durable decisions.",
    }, root);
    const skillPath = path.join(root, first.directoryName, "SKILL.md");
    assert.equal(first.id, charadockCreatedSkillId("summarize-work-log"));
    assert.equal(first.sourceKind, CHARADOCK_CREATED_SOURCE_KIND);
    assert.equal(first.sourceName, "CharaDock");
    assert.equal(first.trusted, true);
    assert.equal(first.license, CHARADOCK_CREATED_LICENSE);
    assert.deepEqual(parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8")), {
      name: "summarize-work-log",
      description: "Turn a completed work session into concise durable notes.",
    });

    const second = await createOrUpdateLocalSkill({
      name: "summarize-work-log",
      description: "Turn a completed work session into concise, reusable project notes.",
      instructions: "# Workflow\n\n1. Inspect verified work.\n2. Record decisions and next steps only.",
    }, root);
    const updatedText = fs.readFileSync(skillPath, "utf8");
    assert.equal(second.id, first.id);
    assert.equal(second.directoryName, first.directoryName);
    assert.match(updatedText, /Inspect verified work/);
    assert.doesNotMatch(updatedText, /Read the completed work/);
    assert.deepEqual(fs.readdirSync(path.dirname(skillPath)), ["SKILL.md"]);

    const normalized = normalizeManagedSkills([{ ...second, trusted: false, sourceName: "spoofed", license: "spoofed" }]);
    assert.equal(normalized[0].sourceKind, CHARADOCK_CREATED_SOURCE_KIND);
    assert.equal(normalized[0].sourceName, "CharaDock");
    assert.equal(normalized[0].trusted, true);
    assert.equal(normalized[0].license, CHARADOCK_CREATED_LICENSE);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test("validates CharaDock-created skill fields", () => {
  assert.deepEqual(validateCreatedSkillInput({
    name: "capture-evidence",
    description: "Capture release evidence for the current feature.",
    instructions: "Capture the requested evidence and verify the result.",
  }), {
    name: "capture-evidence",
    description: "Capture release evidence for the current feature.",
    instructions: "Capture the requested evidence and verify the result.",
  });
  assert.throws(() => validateCreatedSkillInput({ name: "Not Kebab", description: "Valid", instructions: "Valid" }), /kebab-case/);
  assert.throws(() => validateCreatedSkillInput({ name: "valid-name", description: "", instructions: "Valid" }), /説明/);
  assert.throws(() => validateCreatedSkillInput({ name: "valid-name", description: "Valid", instructions: "" }), /手順/);
  assert.throws(() => validateCreatedSkillInput({ name: "valid-name", description: "Valid", instructions: "api_key=sk-exampleabcdefghijkl" }), /秘密情報/);
  assert.throws(() => validateCreatedSkillInput({ name: "valid-name", description: "Valid", instructions: "Read C:\\Users\\sam\\private\\notes.md first." }), /利用者固有/);
  assert.throws(() => validateCreatedSkillInput({
    name: "valid-name",
    description: "Valid",
    instructions: "x".repeat(20_001),
  }), /20,000/);
});

test("keeps up to 100 skill assignments per scope", () => {
  const installedIds = Array.from({ length: 120 }, (_, index) => `skill-${index}`);
  const assignments = normalizeSkillAssignments({
    all: installedIds,
    characters: { kohaku: installedIds },
  }, installedIds);
  assert.equal(assignments.all.length, 100);
  assert.equal(assignments.characters.kohaku.length, 100);
  assert.equal(assignments.all.at(-1), "skill-99");
});
