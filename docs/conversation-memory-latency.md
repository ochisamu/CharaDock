# Conversation memory and response latency

## Scope

Chat and Work keep their existing routing and permission boundaries. This change adds recent personal topics, memory-backed startup speech, optional decision-assisted fillers, and per-turn reasoning overrides for standalone greetings. It does not automatically promote Chat to Work.

## Memory and startup speech

The existing memory tools accept `recent` alongside durable categories. Durable memories retain their 24-entry capacity; recent topics have an independent eight-entry capacity and are eligible for retrieval for 14 days after their last update. They remain visible and forgettable through the existing memory controls while active. User statements are the source; quoted material, assistant inventions, project state and sensitive information are excluded by the tool instructions and existing storage guard.

Startup selection prefers an eligible recent personal topic, then the current scoped continuation, then a durable preference or goal. The same topic has a seven-day cooldown and all startup greetings for the character share a six-hour cooldown across launches. Selection is character-scoped; project continuation remains scoped to the active project. Generated wording is validated against a recorded evidence key. Personal topics never use the task-resumption fallback. A missing valid topic or failed memory greeting yields silence.

Before display, the runtime checks current character, scope, history, active interaction and whether the selected memory still exists unchanged. The startup speech toggle controls speech only, not storage. Desktop and Link reuse the generated greeting. Deleting a memory also prevents its cached greeting from being offered to Link.

## Waiting utterances

Decision assist and its “Brief waiting replies” setting must both be enabled. The selected decision provider judges whether a waiting reply is useful and separately chooses a neutral phrase from the character's filtered candidates. Speech requires at least 0.7 confidence in the need for a filler; a failed or invalid choice yields silence. The answer starts independently. The pending filler waits 2 seconds; first answer text, completion, failure or cancellation closes it. Decisions are bounded to 900 ms, failures yield silence, and spoken fillers have a 30-second cooldown. The same phrase is not selected consecutively.

The existing shared announcement/speech queue delivers the phrase to desktop and Link; it is never saved as a conversation turn. Work keeps its existing grounded progress commentary. Live retains its own speech ownership and receives no extra filler.

## Greeting effort

Standalone greetings and thanks without attachments, explicit tool selection or a pending question may use `none` (when supported) or `low`. Context-dependent confirmations retain their configured effort. Model catalog capabilities take precedence; known model fallbacks are conservative and unknown models keep their setting. The override is passed to `turn/start` without calling `setReasoningEffort`, so it does not invalidate the thread or affect the next turn. Typed Live requests that go through Codex also use this mechanism. Native Realtime voice generation does not expose this per-turn Codex effort control.

## Verification

- `npm test`: runtime checks, desktop tests, and Python static checks.
- `scripts/verify-conversation-profile.cjs SOURCE PROFILE OUTPUT`, launched with Windows Electron after closing the existing profile owner: real Chat, actual memory tools, persisted recent topic, grounded startup speech, real configured decision provider, greeting effort, normal TTS and interruption. The script restores test history/preferences in `finally` and leaves the app open. Never run two processes against the same profile.
- Behavioral tests cover capacity, expiration, forgetting, character isolation, cooldown, classifier abstention, late decisions, cancellation and preservation of configured effort across two turns.
- `scripts/verify-filler-decisions.cjs SOURCE PROFILE OUTPUT`, launched with Windows Electron: read-only use of the existing profile's configured decision provider, with an isolated temporary Electron profile, to verify positive and negative filler decisions. Keep its temporary crypto state private.

### Verified on 2026-10-12

All 1,142 desktop tests and 58 Python checks passed. The running Windows profile verified greeting effort `none`, audible greeting and memory-backed startup speech, persisted recent memory, repeated startup suppression, interruption, and paired Link conversation. The live comparison turn correctly produced no filler. Separate calls to the same configured decision provider rejected greetings and thanks and accepted a reflective question; positive filler delivery and late-event cancellation are covered by behavioral tests. Test preferences and conversation history were restored, and the normal app was restarted with the updated source. Sanitized reports and screenshots are under `work/evidence/conversation-memory-20261012/` (local, ignored by Git).

### Filler tuning follow-up

Lowered the need threshold from 0.8 to 0.7 and the wait from 2.6 to 2 seconds, retaining the 30-second cooldown and answer/cancellation suppression. All 1,200 tests passed again. In the real profile, the comparison decision now accepted a filler; the conversational test emitted none, so this run does not establish audible positive filler delivery. Greeting suppression, interruption, memory/startup speech and Link conversation passed. Original settings and history were restored before restarting the normal app. Report: `work/evidence/filler-tuning-20261012/verification.json`.
