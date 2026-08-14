---
name: design-character-dialogue
description: Apply CharaDock-specific character-first product and interaction rules on top of Apple design principles. Use whenever designing, implementing, or reviewing CharaDock UI/UX, character dialogue, Chat or Work behavior, TTS or Live responses, handoffs, progress and error messages, speech bubbles and captions, avatar feedback, settings, or PC/remote parity.
---

# Design the CharaDock Experience

Make the product feel like one continuous relationship with a character, not a collection of AI routes and system features.

## Foundation

Use the `apple-design` Skill alongside this Skill when it is available. Treat its purpose, agency, familiarity, simplicity, craft, immediate feedback, spatial consistency, accessibility, and restraint as the general design foundation. Apply the CharaDock-specific rules below when those principles reach the character experience.

Prioritize in this order:

1. The character and the user's current intent.
2. The character's grounded response or ongoing work.
3. Results and next actions.
4. Transport, model, connection, and implementation details.

Keep level 4 out of character dialogue unless the user must act on it.

## Preserve the roles

- Keep the user's words and the character's words unambiguously separate.
- Never repeat, quote, or paraphrase the user's request as though the character said it. In particular, do not let the character echo requests ending in phrases such as `教えて`, `やって`, or `作って`.
- Respond from the character's own perspective: `確認してみるね` is valid; repeating `ニュースを教えて` is not.
- Ask a question only when clarification is genuinely required.
- Keep the selected character's language, role, personality, and relationship consistent across Chat, Work, TTS, Live, PC, and remote.
- Never invent progress, completion, decisions, emotions, or access that the system has not verified.

## Hide the machinery

- Treat Codex delegation, handoff, web search, model selection, TTS routing, WebRTC, and IPC as backstage implementation.
- Do not turn connection state such as `Liveへ接続中`, `送信したよ`, or `処理中` into character speech.
- Present operational state as restrained UI status when it helps understanding; present it as dialogue only when the character has something meaningful and truthful to say.
- Do not read URLs, artifact paths, citations, control labels, or action buttons aloud.
- Translate technical failures into a short actionable message without making the character sound like a log console.

## Keep one conversational turn coherent

- Produce one authoritative assistant response and one intended audio route for one user turn.
- Let a short acknowledgement communicate intent, never completion. Prefer one natural sentence and avoid repeating it in progress or final output.
- During a meaningful wait, add sparse, context-specific progress only when it reduces uncertainty. Do not fill silence with fixed phrases.
- Replace transient acknowledgement/progress with the current meaningful response. Never concatenate the user's request, acknowledgement, delegated result, and stale status into one apparent character utterance.
- Make the delegated, grounded result authoritative after a handoff.
- Keep the last meaningful answer visible after completion. Remove stale `考え中`, progress, and artifact actions when they no longer belong to the current turn.
- Make interruption immediate. Stop speech and work cleanly, then show a truthful interrupted state.

## Respect capability boundaries without breaking character

- Chat may converse, search the web, verify current information, and perform other read-only inspection.
- Work may additionally create or modify files, run state-changing commands, and produce artifacts.
- Live is the interaction and voice layer, not a second competing answer source. Preserve the same Chat/Work boundary behind it.
- When a request exceeds the current mode, explain the available next action briefly; do not claim the work started.
- Preserve context across voice and typed input within the active experience where the backend supports it. Be explicit about a real boundary rather than faking continuity.

## Keep the avatar primary

- Treat the avatar as the main surface. Do not let bubbles, modals, progress, notices, or artifact controls unnecessarily cover the face or suppress motion.
- Show the portion currently being spoken for long responses; keep full text and history available without turning the main bubble into a transcript wall.
- Synchronize captions, speech, lip motion, expression, and completion state to the same underlying event.
- Keep idle motion quiet and alive. Reserve strong motion, sound, and emphasis for meaningful reactions.
- Adapt layouts and input affordances to desktop and mobile while preserving the same mental model and terminology.

## Design and implementation workflow

1. Map every affected surface and route: Chat/Work, TTS/Live, typed/voice, PC/remote.
2. Classify each visible string as character dialogue, UI status, control label, result, warning, or error. Do not let one string serve incompatible roles.
3. Trace the full event timeline: input, acknowledgement, handoff, progress, final result, interruption, failure, reconnect, and next turn.
4. Identify the single source of truth for displayed text, audio, busy state, artifacts, and history at every stage.
5. Implement the smallest consistent behavior across all affected surfaces.
6. Test rapid responses, long operations, follow-ups, route switches, reconnects, and failures—not only the happy path.
7. Review the actual rendered and spoken experience. Static string assertions alone are insufficient for timing, duplication, stale state, and role reversal.

## Acceptance check

Before finishing, verify:

- Does this feel like talking or working with one character?
- Could any user request be mistaken for the character's own words?
- Does any internal transport or handoff leak into dialogue?
- Can two answer or audio paths run for one turn?
- Are acknowledgement, progress, completion, and interruption semantically distinct?
- Is every completion claim grounded in a verified result?
- Does the latest meaningful response replace temporary state?
- Are Chat and Work capabilities consistent on PC and remote?
- Does the avatar remain visually and conversationally primary?
- Can the user understand what is happening and remain in control without reading the implementation?
