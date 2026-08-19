// SPDX-License-Identifier: Apache-2.0

import { builtInCharacterProfile } from "./character-profiles";
import type {
  CharacterDirectorFields,
  CharacterLike,
  CharacterProfileV2,
  CharacterReaction,
  InterfaceLanguage,
  LocalizedText,
} from "./types";

const SUPPORTED_REACTIONS = new Set<CharacterReaction>(["neutral", "listening", "thinking", "soft", "sad", "happy", "surprised", "angry"]);

function localized(value: LocalizedText, language: InterfaceLanguage): string {
  return language === "en" ? value.en : value.ja;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function characterId(character: CharacterLike | string): string {
  return typeof character === "string" ? character : stringValue(character.id);
}

function fallbackProfile(id: string): CharacterProfileV2 {
  return {
    schemaVersion: 2,
    id,
    role: { ja: "利用者と対等に考え、必要な作業を誠実に支えるデスクトップキャラクター", en: "A desktop character who thinks alongside the user and supports their work honestly" },
    relationship: { ja: "利用者の意図を尊重する、親しみやすい共同作業者。", en: "A friendly collaborator who respects the user's intent." },
    values: [{ ja: "事実に基づいて簡潔に役立つ", en: "Be concise, useful, and grounded" }],
    speech: {
      description: { ja: "自然で親しみやすく、簡潔に話す。", en: "Speak naturally, warmly, and concisely." },
      sentenceLength: "balanced",
      energy: "warm",
      humor: { ja: "無理に冗談を言わない。", en: "Never force a joke." },
      preferred: [],
      avoid: [{ ja: "同じ挨拶や締め方の繰り返し", en: "Repeated openings and closings" }],
    },
    behavior: {
      acknowledge: { ja: "依頼を言い換えず、次に行うことを短く示す。", en: "Do not echo the request; briefly state the next action." },
      disagree: { ja: "理由と代案を率直に伝える。", en: "Give the reason and an alternative candidly." },
      success: { ja: "確認できた結果だけを具体的に伝える。", en: "State only the result that was actually verified." },
      failure: { ja: "失敗を隠さず、次にできることを示す。", en: "Do not hide failure; state what can happen next." },
      uncertainty: { ja: "推測を事実として扱わない。", en: "Never present inference as fact." },
      interruption: { ja: "すぐ止まり、確実な状態だけを残す。", en: "Stop immediately and leave only a grounded state." },
    },
    phrases: { thinking: [], touchHead: [], touchBody: [] },
    reaction: { durationScale: 1, intensity: {}, neutralBias: "neutral" },
    examples: [],
  };
}

function localOverride(value: string): LocalizedText {
  return { ja: value, en: value };
}

function overrideText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || null;
}

function overrideList(value: unknown, maxItems = 12, maxLength = 160): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((item) => overrideText(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
  return normalized;
}

function applyDirectorOverride(profile: CharacterProfileV2, value: unknown): CharacterProfileV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return profile;
  const source = value as Record<string, unknown>;
  const role = overrideText(source.role, 500);
  const relationship = overrideText(source.relationship, 700);
  const speechStyle = overrideText(source.speechStyle, 700);
  const values = overrideList(source.values, 10, 240);
  const preferred = overrideList(source.preferredPhrases, 12, 160);
  const avoid = overrideList(source.avoidPhrases, 12, 200);
  const thinking = overrideList(source.thinkingPhrases, 12, 240);
  const touchHead = overrideList(source.touchHeadPhrases, 12, 180);
  const touchBody = overrideList(source.touchBodyPhrases, 12, 180);
  return {
    ...profile,
    role: role ? localOverride(role) : profile.role,
    relationship: relationship ? localOverride(relationship) : profile.relationship,
    values: values?.length ? values.map(localOverride) : profile.values,
    speech: {
      ...profile.speech,
      description: speechStyle ? localOverride(speechStyle) : profile.speech.description,
      preferred: preferred ? preferred.map(localOverride) : profile.speech.preferred,
      avoid: avoid ? avoid.map(localOverride) : profile.speech.avoid,
    },
    phrases: {
      thinking: thinking ? thinking.map(localOverride) : profile.phrases.thinking,
      touchHead: touchHead ? touchHead.map(localOverride) : profile.phrases.touchHead,
      touchBody: touchBody ? touchBody.map(localOverride) : profile.phrases.touchBody,
    },
  };
}

function baseCharacterProfile(character: CharacterLike | string): CharacterProfileV2 {
  const id = characterId(character);
  const builtIn = builtInCharacterProfile(id);
  if (builtIn) return builtIn;
  const fallback = fallbackProfile(id || "custom-character");
  return typeof character === "string" ? fallback : applyDirectorOverride(fallback, character.director);
}

export function resolveCharacterProfile(character: CharacterLike | string): CharacterProfileV2 {
  const profile = baseCharacterProfile(character);
  return typeof character === "string" ? profile : applyDirectorOverride(profile, character.director);
}

function list(values: LocalizedText[], language: InterfaceLanguage): string {
  return values.map((value) => localized(value, language)).filter(Boolean).join(language === "en" ? "; " : "、");
}

function profileDirectorFields(profile: CharacterProfileV2, language: InterfaceLanguage): CharacterDirectorFields {
  return {
    role: localized(profile.role, language),
    relationship: localized(profile.relationship, language),
    values: profile.values.map((value) => localized(value, language)).filter(Boolean),
    speechStyle: localized(profile.speech.description, language),
    preferredPhrases: profile.speech.preferred.map((value) => localized(value, language)).filter(Boolean),
    avoidPhrases: profile.speech.avoid.map((value) => localized(value, language)).filter(Boolean),
    thinkingPhrases: profile.phrases.thinking.map((value) => localized(value, language)).filter(Boolean),
    touchHeadPhrases: profile.phrases.touchHead.map((value) => localized(value, language)).filter(Boolean),
    touchBodyPhrases: profile.phrases.touchBody.map((value) => localized(value, language)).filter(Boolean),
  };
}

export function defaultCharacterDirectorFields(character: CharacterLike | string, language: InterfaceLanguage = "ja"): CharacterDirectorFields {
  return profileDirectorFields(baseCharacterProfile(character), language);
}

export function characterDirectorFields(character: CharacterLike | string, language: InterfaceLanguage = "ja"): CharacterDirectorFields {
  return profileDirectorFields(resolveCharacterProfile(character), language);
}

export function buildCharacterPersona(character: CharacterLike, language: InterfaceLanguage = "ja"): string {
  const profile = resolveCharacterProfile(character);
  const name = stringValue(character.name, language === "en" ? "the selected character" : "選択中のキャラクター");
  const editableDescription = stringValue(character.personality);
  const labels = language === "en"
    ? { role: "Role", relationship: "Relationship", values: "Values", voice: "Voice", humor: "Humor", prefer: "Natural wording", avoid: "Avoid", behavior: "Behavior", examples: "Examples", custom: "User-editable character note" }
    : { role: "役割", relationship: "利用者との関係", values: "価値観", voice: "話し方", humor: "ユーモア", prefer: "自然に使える表現", avoid: "避けること", behavior: "振る舞い", examples: "会話例", custom: "利用者が編集できるキャラクター設定" };
  const behavior = profile.behavior;
  const behaviorLines = [behavior.acknowledge, behavior.disagree, behavior.success, behavior.failure, behavior.uncertainty, behavior.interruption]
    .map((value) => localized(value, language));
  const examples = profile.examples.slice(0, 3).map((example) => `- ${localized(example.situation, language)}: ${localized(example.reply, language)}`);
  return [
    language === "en" ? `Speak as ${name}. Keep the character consistent without role-playing unverified work or a fabricated relationship.` : `あなたは「${name}」として話します。未確認の作業や架空の関係を演じず、一貫したキャラクターとして応答してください。`,
    `${labels.role}: ${localized(profile.role, language)}`,
    `${labels.relationship}: ${localized(profile.relationship, language)}`,
    `${labels.values}: ${list(profile.values, language)}`,
    `${labels.voice}: ${localized(profile.speech.description, language)}`,
    `${labels.humor}: ${localized(profile.speech.humor, language)}`,
    profile.speech.preferred.length ? `${labels.prefer}: ${list(profile.speech.preferred, language)}. ${language === "en" ? "Use sparingly, never as a catchphrase." : "口癖にはせず、文脈に合う時だけ使います。"}` : "",
    `${labels.avoid}: ${list(profile.speech.avoid, language)}`,
    `${labels.behavior}: ${behaviorLines.join(language === "en" ? " " : "。")}`,
    editableDescription ? `${labels.custom}: ${editableDescription}` : "",
    examples.length ? `${labels.examples}:\n${examples.join("\n")}` : "",
    language === "en"
      ? "Treat this profile as the single source of truth for the character. Keep the same voice, relationship, and values while listening, thinking, succeeding, or failing; vary emotion with restraint instead of becoming theatrical. Treat every item under Avoid as an explicit negative constraint. Answer the user's actual question directly. Keep immediate follow-ups on topic. Ask one concise clarification only when ambiguity materially changes the result. Use speech-friendly prose and keep URLs, citation tokens, Markdown syntax, file paths, and control labels out of spoken sentences. Vary openings and closings; do not repeat a stock acknowledgement from recent turns."
      : "このプロフィールを人物像の原本として扱います。通常・傾聴・考え中・成功・失敗でも口調、関係性、価値観を変えず、感情差は控えめにして大げさな演技をしません。「避けること」は明示的な禁止事項として守ります。質問には最初に直接答え、短いフォローアップでは直前の話題を維持します。結果が大きく変わる曖昧さがある場合だけ、一度に一つ簡潔に確認します。音声で自然な文章を優先し、URL、引用制御記号、Markdown記法、ファイルパス、操作ラベルを読み上げ文へ混ぜません。直近と同じ書き出しや締め方、定型の相槌を繰り返しません。",
  ].filter(Boolean).join("\n");
}

function normalizedForComparison(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 160);
}

function ngrams(value: string, size = 2): Set<string> {
  const normalized = normalizedForComparison(value);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) result.add(normalized.slice(index, index + size));
  return result;
}

function similarity(left: string, right: string): number {
  const a = ngrams(left);
  const b = ngrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

export function draftRepetitionGuidance(recentAssistantTexts: unknown[], draftOrSeed = "", language: InterfaceLanguage = "ja"): string {
  const recent = recentAssistantTexts.map((value) => stringValue(value)).filter(Boolean).slice(-6);
  if (!recent.length) return "";
  const seed = stringValue(draftOrSeed);
  const repeated = seed ? recent.some((value) => similarity(value, seed) >= 0.72) : false;
  const openings = recent.map((value) => normalizedForComparison(value).slice(0, 18)).filter(Boolean);
  const duplicateOpening = new Set(openings).size < openings.length || recent.some((value, index) => (
    recent.slice(index + 1).some((other) => similarity(value.slice(0, 28), other.slice(0, 28)) >= 0.72)
  ));
  if (!repeated && !duplicateOpening) return "";
  return language === "en"
    ? "Recent character replies used a similar opening or phrasing. Preserve the facts and character, but begin from the most specific point in this turn and use a different natural sentence shape. Do not force a topic change."
    : "直近のキャラクター発話で似た書き出しや言い回しが続いています。事実とキャラクター性は保ちつつ、今回は最も具体的な要点から別の自然な文型で始めてください。無理に話題を変えないでください。";
}

export function characterPhrases(character: CharacterLike | string, kind: "thinking" | "touchHead" | "touchBody", language: InterfaceLanguage = "ja"): string[] {
  return resolveCharacterProfile(character).phrases[kind].map((value) => localized(value, language)).filter(Boolean);
}

export function characterReactionTuning(character: CharacterLike | string, reaction: unknown): { durationScale: number; intensity: number; reaction: CharacterReaction } {
  const profile = resolveCharacterProfile(character);
  const normalized = typeof reaction === "string" && SUPPORTED_REACTIONS.has(reaction as CharacterReaction)
    ? reaction as CharacterReaction
    : profile.reaction.neutralBias;
  return {
    reaction: normalized,
    durationScale: Math.max(0.7, Math.min(1.35, profile.reaction.durationScale)),
    intensity: Math.max(0.55, Math.min(1.2, profile.reaction.intensity[normalized] ?? 1)),
  };
}
