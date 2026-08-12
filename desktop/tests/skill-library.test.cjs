// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assignedSkillIds,
  installResolvedSkill,
  normalizeManagedSkills,
  normalizeSkillAssignments,
  parseGitHubSkillUrl,
  resolveSkillSource,
} = require("../lib/skill-library.cjs");

const COMMIT = "a".repeat(40);
const SKILL_TEXT = `---
name: demo-skill
description: Safely demonstrates a test workflow.
---

# Demo
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
  assert.equal(resolved.trusted, true);
  assert.equal(resolved.sourceKind, "openai-curated");
  assert.equal(resolved.license, "LICENSE");
  assert.equal(resolved.files.length, 2);
});

test("installs once and assigns globally or per character", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "charadock-skills-"));
  try {
    const resolved = await resolveSkillSource("https://github.com/openai/skills/tree/main/skills/.curated/demo", mockFetch);
    const record = await installResolvedSkill(resolved, root, mockFetch);
    const skills = normalizeManagedSkills([record]);
    assert.equal(skills.length, 1);
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
