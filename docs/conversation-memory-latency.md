# Conversation memory and response latency

## Scope

Chat and Work keep their existing routing and permission boundaries. This change adds recent personal topics, memory-backed startup speech, optional decision-assisted fillers, and per-turn reasoning overrides for standalone greetings. It does not automatically promote Chat to Work.

## Memory and startup speech

The existing memory tools accept `recent` alongside durable categories. Durable memories retain their 24-entry capacity; recent topics have an independent eight-entry capacity and are eligible for retrieval for 14 days after their last update. They remain visible and forgettable through the existing memory controls while active. User statements are the source; quoted material, assistant inventions, project state and sensitive information are excluded by the tool instructions and existing storage guard.

Startup selection prefers an eligible recent personal topic, then the current scoped continuation, then a durable preference or goal. The same topic has a seven-day cooldown and all startup greetings for the character share a six-hour cooldown across launches. Selection is character-scoped; project continuation remains scoped to the active project. Generated wording is validated against a recorded evidence key. Personal topics never use the task-resumption fallback. A missing valid topic or failed memory greeting yields silence.

Before display, the runtime checks current character, scope, history, active interaction and whether the selected memory still exists unchanged. The startup speech toggle controls speech only, not storage. Desktop and Link reuse the generated greeting. Deleting a memory also prevents its cached greeting from being offered to Link.

## Waiting utterances

Decision assist and its “Brief waiting replies” setting must both be enabled. `contextual-filler.cjs` builds a shared candidate vocabulary from up to ten character-authored thinking phrases plus 21 Japanese or 14 English contextual phrases (maximum 32 total). These include acknowledgement, interest, empathy, shared joy, reflection and considering alternatives, with casual and polite variants. Characters need no ID-specific branch or migration: the effective profile already includes built-in localization, imported phrases and user overrides.

One parallel decision request judges need and chooses the exact wording, including an explicit `none` option. It receives the current utterance, previous reply, effective personality, speech style, relationship, language and the last three spoken fillers for that character. Character-authored examples are style evidence, not evidence of actual progress. Explicit speech register and language constrain selection. Repetition is contextual evidence, not a hard removal of options. There is no keyword-based semantic filter or greeting gate in filler selection; greetings and ordinary thanks normally receive silence from the model. Mechanical checks only bound length/count and reject malformed text, links and markup. The model rejects unobserved action/completion claims, unsuitable tone and candidate instructions.

Speech requires at least 0.7 in the model's need score and a valid non-`none` choice. The answer starts independently. The pending filler waits two seconds; first answer text, completion, failure or cancellation closes it. Decisions are bounded to 900 ms, failures yield silence, and spoken fillers have a 30-second cooldown. The selected wording is never randomly replaced. A changed turn, character or language also cancels delivery.

The existing shared announcement/speech queue delivers the phrase to desktop and Link; it is never saved as a conversation turn. Work keeps its existing grounded progress commentary. Live retains its own speech ownership and receives no extra filler. This is contextual selection from a vocabulary, not free-form text generation; unusual imported voices can supply their own thinking phrases, while unmatched wording can be declined.

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

### Contextual selection follow-up

Verified the actual configured JEV provider with all five built-in characters and an imported-character-style fixture. Each Japanese profile retained 24–25 candidates. For the same three utterances, Kohaku selected “一緒に考えよう。”, “それはうれしいね。” and “それは悩むね。”; Nike selected polite variants, and the custom elderly scholar selected its authored dialect. All six greetings, unsafe-only choices and a candidate containing an instruction injection remained silent. English selection was exercised and may abstain at the need threshold. Real-provider timings for the Japanese scenarios were 164–230 ms in the final run, not a latency guarantee.

The real Windows profile passed Chat greeting, memory/startup speech, cancellation and paired Link greeting checks. For a controlled 3.5-second backend-start delay (QA instrumentation only), the real model selected “一緒に考えよう。” and the runtime emitted it exactly once at 2.182 seconds and sent it through actual TTS synthesis. This tests the waiting branch, not an assertion that ordinary replies always take that long. Settings and history were restored and the normal app restarted. All 1,147 desktop tests and 58 Python checks passed. Reports: `work/evidence/contextual-filler-20261012/`.
