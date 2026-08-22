// SPDX-License-Identifier: Apache-2.0

import type { AudioRoute, InteractionMode, TurnSnapshot, TurnStatus, TurnStreamPayload } from "./types";

const terminalStatuses = new Set<TurnStatus>(["complete", "interrupted", "error"]);

function normalizeMode(value: unknown): InteractionMode {
  return value === "work" ? "work" : "chat";
}

function phaseStatus(phase: string, mode: InteractionMode, current: TurnStatus): TurnStatus {
  if (phase === "start") return mode === "work" ? "working" : "thinking";
  if (phase === "activity" || phase === "announcement") return mode === "work" ? "working" : "thinking";
  if (phase === "delta" || phase === "realtime-caption") return "speaking";
  if (phase === "done" || phase === "realtime-work-complete") return "complete";
  if (phase === "interrupted") return "interrupted";
  if (phase === "error") return "error";
  return current;
}

function requestedAudioRoute(payload: TurnStreamPayload): AudioRoute {
  if (payload.audioRoute === "live" || payload.realtimeOutput) return "live";
  if (payload.audioRoute === "tts") return "tts";
  if (payload.audioRoute === "none") return "none";
  if (payload.ttsEnabled && ["announcement", "delta", "done"].includes(String(payload.phase || ""))) return "tts";
  return "none";
}

function authoritativeText(payload: TurnStreamPayload, fallback: string): string {
  for (const value of [payload.displayText, payload.text, payload.message]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export class TurnCoordinator {
  private sequence = 0;
  private snapshotValue: TurnSnapshot;

  constructor(private readonly now: () => number = Date.now) {
    const timestamp = this.now();
    this.snapshotValue = {
      id: "",
      sequence: 0,
      mode: "chat",
      status: "idle",
      audioRoute: "none",
      authoritativeText: "",
      workRunId: "",
      artifacts: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  apply(payload: TurnStreamPayload = {}): TurnStreamPayload & { turnId: string; turnStatus: TurnStatus; audioRoute: AudioRoute; mode: InteractionMode } {
    const phase = String(payload.phase || "");
    // Every user-visible turn is opened explicitly with `start`.  Keeping
    // terminal follow-up events on the existing turn is important: Live can
    // deliver a final caption and a completion event for the same response,
    // and treating the second event as a new turn makes the UI appear to
    // answer twice.
    const shouldBegin = phase === "start" || !this.snapshotValue.id;
    const timestamp = this.now();
    if (shouldBegin) {
      this.sequence += 1;
      this.snapshotValue = {
        id: `turn-${timestamp.toString(36)}-${this.sequence.toString(36)}`,
        sequence: this.sequence,
        mode: normalizeMode(payload.mode),
        status: "idle",
        audioRoute: "none",
        authoritativeText: "",
        workRunId: typeof payload.workRunId === "string" ? payload.workRunId : "",
        artifacts: [],
        startedAt: timestamp,
        updatedAt: timestamp,
      };
    }
    const mode = payload.mode === undefined ? this.snapshotValue.mode : normalizeMode(payload.mode);
    const route = requestedAudioRoute(payload);
    const status = phaseStatus(phase, mode, this.snapshotValue.status);
    const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.slice(0, 8) : this.snapshotValue.artifacts;
    this.snapshotValue = {
      ...this.snapshotValue,
      mode,
      status,
      audioRoute: route === "none" && this.snapshotValue.audioRoute === "live" && !terminalStatuses.has(status) ? "live" : route,
      authoritativeText: authoritativeText(payload, this.snapshotValue.authoritativeText),
      workRunId: typeof payload.workRunId === "string" && payload.workRunId ? payload.workRunId : this.snapshotValue.workRunId,
      artifacts,
      updatedAt: timestamp,
    };
    return {
      ...payload,
      turnId: this.snapshotValue.id,
      turnStatus: this.snapshotValue.status,
      audioRoute: this.snapshotValue.audioRoute,
      // Downstream renderers must never infer a missing mode from whichever
      // history tab happens to be open. Most delta/done events omit `mode`,
      // so always forward the coordinator's authoritative value.
      mode: this.snapshotValue.mode,
    };
  }

  snapshot(): TurnSnapshot {
    return { ...this.snapshotValue, artifacts: this.snapshotValue.artifacts.map((artifact) => ({ ...artifact })) };
  }

  reset(): TurnSnapshot {
    const timestamp = this.now();
    this.snapshotValue = {
      id: "",
      sequence: this.sequence,
      mode: "chat",
      status: "idle",
      audioRoute: "none",
      authoritativeText: "",
      workRunId: "",
      artifacts: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    return this.snapshot();
  }
}
