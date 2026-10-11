// SPDX-License-Identifier: Apache-2.0

const crypto = require("node:crypto");

const MEMORY_CATEGORIES = new Set(["identity", "preference", "relationship", "goal", "background", "other", "recent"]);
const MAX_MEMORIES_PER_CHARACTER = 24;
const MAX_RECENT_MEMORIES = 8;
const RECENT_MEMORY_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function boundMemories(entries) {
  const durable = entries.filter(entry => entry.category !== 'recent').slice(-MAX_MEMORIES_PER_CHARACTER);
  const recent = entries.filter(entry => entry.category === 'recent').slice(-MAX_RECENT_MEMORIES);
  const ids = new Set([...durable, ...recent].map(entry => entry.id));
  return entries.filter(entry => ids.has(entry.id));
}

function normalizeCharacterMemories(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([characterId, entries]) => {
    const id = String(characterId || "").slice(0, 120);
    if (!id || !Array.isArray(entries)) return [];
    const seen = new Set();
    const memories = entries.slice(-200).flatMap((entry) => {
      const memoryId = String(entry?.id || "").slice(0, 100);
      const content = String(entry?.content || "").replace(/\s+/g, " ").trim().slice(0, 300);
      const duplicateKey = content.toLocaleLowerCase("ja-JP");
      if (!memoryId || !content || seen.has(duplicateKey)) return [];
      seen.add(duplicateKey);
      return [{
        id: memoryId,
        category: MEMORY_CATEGORIES.has(entry?.category) ? entry.category : "other",
        content,
        createdAt: String(entry?.createdAt || "").slice(0, 40),
        updatedAt: String(entry?.updatedAt || entry?.createdAt || "").slice(0, 40),
      }];
    });
    return memories.length ? [[id, boundMemories(memories)]] : [];
  }));
}

function assertSafeMemoryContent(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (text.length < 2) throw new Error("覚える内容が短すぎます。");
  const sensitive = /(?:sk-[A-Za-z0-9_-]{12,}|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|passwd|パスワード|暗証番号|秘密鍵|クレジットカード|マイナンバー|電話番号|住所|病歴|診断|宗教|政治的信条)/i;
  if (sensitive.test(text) || /(?:\d[ -]?){13,19}/.test(text)) {
    throw new Error("秘密情報やセンシティブな個人情報はメモリへ保存できません。");
  }
  return text;
}

function saveCharacterMemory(value, characterId, input = {}, now = new Date()) {
  const memoriesByCharacter = normalizeCharacterMemories(value);
  const id = String(characterId || "").slice(0, 120);
  if (!id) throw new Error("キャラクターを特定できません。");
  const content = assertSafeMemoryContent(input.content);
  const category = MEMORY_CATEGORIES.has(input.category) ? input.category : "other";
  const entries = [...(memoriesByCharacter[id] || [])];
  const duplicateIndex = entries.findIndex((entry) => entry.content.toLocaleLowerCase("ja-JP") === content.toLocaleLowerCase("ja-JP"));
  const timestamp = now.toISOString();
  let record;
  if (duplicateIndex >= 0) {
    record = { ...entries[duplicateIndex], category, content, updatedAt: timestamp };
    entries.splice(duplicateIndex, 1);
  } else {
    record = {
      id: `memory-${crypto.randomUUID()}`,
      category,
      content,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  entries.push(record);
  memoriesByCharacter[id] = boundMemories(entries);
  return { memoriesByCharacter, record };
}

function updateCharacterMemory(value, characterId, memoryId, input = {}, now = new Date()) {
  const memoriesByCharacter = normalizeCharacterMemories(value);
  const id = String(characterId || "").slice(0, 120);
  const target = String(memoryId || "").slice(0, 100);
  if (!id) throw new Error("キャラクターを特定できません。");
  const entries = [...(memoriesByCharacter[id] || [])];
  const index = entries.findIndex((entry) => entry.id === target);
  if (index < 0) throw new Error("指定されたメモリが見つかりません。");
  const content = assertSafeMemoryContent(input.content);
  const category = MEMORY_CATEGORIES.has(input.category) ? input.category : entries[index].category;
  const record = { ...entries[index], category, content, updatedAt: now.toISOString() };
  entries.splice(index, 1);
  const duplicateIndex = entries.findIndex((entry) => entry.content.toLocaleLowerCase("ja-JP") === content.toLocaleLowerCase("ja-JP"));
  if (duplicateIndex >= 0) entries.splice(duplicateIndex, 1);
  entries.push(record);
  memoriesByCharacter[id] = boundMemories(entries);
  return { memoriesByCharacter, record };
}

function removeCharacterMemory(value, characterId, memoryId) {
  const memoriesByCharacter = normalizeCharacterMemories(value);
  const id = String(characterId || "");
  const target = String(memoryId || "");
  const before = memoriesByCharacter[id] || [];
  const entries = before.filter((entry) => entry.id !== target);
  if (entries.length === before.length) throw new Error("指定されたメモリが見つかりません。");
  if (entries.length) memoriesByCharacter[id] = entries;
  else delete memoriesByCharacter[id];
  return memoriesByCharacter;
}

function clearCharacterMemories(value, characterId) {
  const memoriesByCharacter = normalizeCharacterMemories(value);
  delete memoriesByCharacter[String(characterId || "")];
  return memoriesByCharacter;
}

module.exports = {
  activeCharacterMemories(value, characterId, now = Date.now()) {
    return (normalizeCharacterMemories(value)[characterId] || []).filter(entry => entry.category !== 'recent'
      || (Number.isFinite(Date.parse(entry.updatedAt)) && Date.parse(entry.updatedAt) <= now
        && now - Date.parse(entry.updatedAt) < RECENT_MEMORY_AGE_MS));
  },
  RECENT_MEMORY_AGE_MS,
  MAX_MEMORIES_PER_CHARACTER,
  normalizeCharacterMemories,
  saveCharacterMemory,
  updateCharacterMemory,
  removeCharacterMemory,
  clearCharacterMemories,
};
