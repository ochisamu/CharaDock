// SPDX-License-Identifier: Apache-2.0

export type InterfaceLanguage = "ja" | "en";
export type InteractionMode = "chat" | "work";
export type TurnStatus = "idle" | "listening" | "thinking" | "working" | "speaking" | "complete" | "interrupted" | "error";
export type AudioRoute = "none" | "tts" | "live";
export type CharacterReaction = "neutral" | "listening" | "thinking" | "soft" | "sad" | "happy" | "surprised" | "angry";

export interface LocalizedText {
  ja: string;
  en: string;
}

export interface CharacterDialogueExample {
  situation: LocalizedText;
  reply: LocalizedText;
}

export interface CharacterProfileV2 {
  schemaVersion: 2;
  id: string;
  role: LocalizedText;
  relationship: LocalizedText;
  values: LocalizedText[];
  speech: {
    description: LocalizedText;
    sentenceLength: "short" | "balanced";
    energy: "quiet" | "warm" | "bright";
    humor: LocalizedText;
    preferred: LocalizedText[];
    avoid: LocalizedText[];
  };
  behavior: {
    acknowledge: LocalizedText;
    disagree: LocalizedText;
    success: LocalizedText;
    failure: LocalizedText;
    uncertainty: LocalizedText;
    interruption: LocalizedText;
  };
  phrases: {
    thinking: LocalizedText[];
    touchHead: LocalizedText[];
    touchBody: LocalizedText[];
  };
  reaction: {
    durationScale: number;
    intensity: Partial<Record<CharacterReaction, number>>;
    neutralBias: CharacterReaction;
  };
  examples: CharacterDialogueExample[];
}

export interface CharacterLike {
  id?: unknown;
  name?: unknown;
  personality?: unknown;
}

export interface ArtifactReference {
  path?: string;
  name?: string;
  kind?: "file" | "directory";
}

export interface TurnStreamPayload {
  phase?: string;
  mode?: string;
  text?: string;
  displayText?: string;
  message?: string;
  realtimeOutput?: boolean;
  realtimeSpeechPending?: boolean;
  ttsEnabled?: boolean;
  audioRoute?: AudioRoute;
  artifacts?: ArtifactReference[];
  workRunId?: string;
  [key: string]: unknown;
}

export interface TurnSnapshot {
  id: string;
  sequence: number;
  mode: InteractionMode;
  status: TurnStatus;
  audioRoute: AudioRoute;
  authoritativeText: string;
  workRunId: string;
  artifacts: ArtifactReference[];
  startedAt: number;
  updatedAt: number;
}
