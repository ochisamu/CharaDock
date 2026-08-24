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

## Keep one runtime behind every surface

- Treat the desktop mascot, settings chat, remote UI, typed input, local STT, Realtime, and character taps as adapters around one conversation runtime. Do not implement a second answer path inside a surface.
- Give each user turn one stable identity from input through acknowledgement, delegation, final text, audio, history, artifacts, and structured UI. Ignore late events from an older or cancelled turn.
- Keep mode, active thread, selected project, work directory, selected Skills/MCP servers, busy state, and audio route in authoritative main-process state. Renderer state may mirror it but must not decide a conflicting route.
- On mode changes and reconnects, restore the authoritative session and workspace before accepting input. A connected UI is not ready until its required tools and context are ready.
- Every success, error, cancellation, timeout, disconnect, and window close must settle transient state. Never leave controls disabled, `考え中`, an artifact action, or a pending audio flag behind.
- If two input surfaces can be open together, verify that input on one updates the correct history and never causes the other surface to submit or answer again.

## Present structured results as supporting content

- Treat files, previews, MCP Apps, cards, and other structured results as supporting surfaces beside the character conversation—not as text to squeeze into the speech bubble.
- Open a newly produced result automatically when inspection is the obvious next step, but do not steal text focus, replay it as character speech, or require a redundant “show” button.
- Keep the composer and mode controls available while a supporting surface is open. Prefer a non-modal sheet on remote/mobile and a restrained inactive companion window on desktop.
- Deduplicate result events by their stable call/result identity so reconnects or replayed backend events do not reopen the same content.
- Keep untrusted result UI sandboxed, apply declared network/resource policy, and route tool calls, links, messages, and close/fullscreen requests through a narrow host bridge.
- Cover both PC entry surfaces—the desktop mascot input and settings chat—plus remote whenever a result can originate from Chat, Work, or Live.

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

1. Read [the interaction quality matrix](references/interaction-quality-matrix.md), then mark every affected row and column before editing.
2. Map every affected surface and route: Chat/Work, TTS/Live, typed/voice, desktop mascot/settings chat/remote.
3. Classify each visible string as character dialogue, UI status, control label, result, warning, or error. Do not let one string serve incompatible roles.
4. Trace the full event timeline: input, acknowledgement, handoff, progress, final result, interruption, failure, reconnect, and next turn.
5. Identify the single source of truth for displayed text, audio, busy state, artifacts, structured results, and history at every stage.
6. Implement behavior in the shared coordinator or backend first; keep surface-specific code to rendering and input adaptation.
7. Add a regression test at the shared source of truth and route-level coverage for every affected entry surface. A source-text assertion may guard wiring, but cannot replace behavioral coverage.
8. Test rapid responses, long operations, follow-ups, route switches, reconnects, startup races, duplicate events, and failures—not only the happy path.
9. Review the actual rendered and spoken experience with the real development profile. Static assertions alone are insufficient for timing, duplication, stale state, focus loss, and role reversal.

## Retain quality knowledge

After fixing a user-visible regression:

1. Reduce the incident to a reusable invariant rather than preserving logs or one-off wording.
2. Add that invariant to this Skill or its matrix if it applies to more than one feature.
3. Add an executable regression test at the state owner that failed.
4. Add or update a real-profile verification script when timing, voice, focus, remote layout, or third-party content cannot be proven in unit tests.
5. Record the verified surfaces and routes in the commit message or handoff. Do not claim parity from testing only one renderer.

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
- Do desktop mascot input, settings chat, and remote reach the same authoritative runtime?
- Can a startup, reconnect, route switch, duplicate event, or late completion revive stale UI or audio?
- Does structured result UI appear once, remain secondary, and leave the conversation usable?
- Does the avatar remain visually and conversationally primary?
- Can the user understand what is happening and remain in control without reading the implementation?
