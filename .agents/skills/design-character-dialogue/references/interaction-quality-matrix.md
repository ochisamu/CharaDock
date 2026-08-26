# CharaDock interaction quality matrix

Use this matrix to select required implementation and verification coverage. Do not test only the route where the bug was first reported.

## Entry surfaces

- Desktop mascot: typed submit, local voice submit, character tap, follow-up, interrupt.
- Settings chat: typed submit, local voice submit, follow-up, interrupt, history selection.
- Remote: typed submit, local voice submit, Live start/stop, character tap, follow-up, interrupt, reconnect.

## Modes and execution routes

- Chat with normal text/TTS.
- Work with normal text/TTS.
- Live Chat with Realtime as the conversational surface and one grounded backend result.
- Live Work with Realtime acknowledgement, Codex delegation, progress, follow-up, and final result.
- Optional capability routes: attachment, Skill, MCP, browser/computer permission, artifact preview, MCP App.

## Timeline states

For each affected entry and route, cover:

1. startup before optional engines and MCP servers are ready;
2. idle input and acknowledgement;
3. streaming speech/text and lip synchronization;
4. active work plus a short and a substantial follow-up;
5. final answer and structured result;
6. interrupt during startup and during execution;
7. route or mode switch;
8. PC-to-remote and remote-to-PC continuation;
9. disconnect/reconnect and app restart;
10. timeout, backend error, denied permission, and duplicate/late event.

## Invariants

- One user action creates at most one assistant answer and one audio route.
- Desktop read-aloud and phone audio are independent destinations. Turning one off must not disable synthesis, captions, or lip sync on the other.
- Only the active turn may change visible text, speech, busy state, history, or results.
- Temporary acknowledgement and progress never masquerade as completion or outlive the turn.
- A follow-up steers the active turn when supported; it does not silently interrupt and start an unrelated turn.
- Mode, project, work directory, character, thread, Skill, and MCP scope do not drift between surfaces.
- Reconnect restores the prior valid scope before accepting work; an invalid workspace fails visibly and recoverably.
- System/transport status stays out of character speech and durable conversation history.
- Switching from Live to local voice/TTS must release the Live owner before settings save returns. Settle a non-delegated Live turn, but preserve an active delegated Codex turn and route the next submit into it as a follow-up instead of rejecting it or starting a competing answer.
- Errors always restore usable controls and preserve the last meaningful grounded response.
- A latency filler may express only neutral waiting or thinking. It must not invent a request-specific method such as comparing, searching, verifying, organizing, or editing before the runtime has observed that work.
- A native Live handoff owns every segmented assistant utterance until its grounded result has had time to start. Do not consume authorization on an early acknowledgement and then mute the final answer; suppression must also release its audio mute and transient thinking state when that suppressed utterance ends.
- Supporting results open once without stealing focus, hiding the composer, or covering the character more than necessary.
- Streaming speech may expose tentative text immediately, but only a separate, conservative utterance gate may commit or auto-send it; a partial result must never submit a turn.
- For Japanese local streaming STT, treat Silero's completed segment as the authoritative final input, copy it before `pop()`, request a non-external Node buffer for Windows Electron, and preserve ReazonSpeech's required 0.9 seconds of boundary context on both sides. Never reuse the last partial as the final result.
- Live transport compatibility must fail closed: never rewrite Codex authentication/provider settings, extract login tokens, retry an obsolete Realtime protocol, or silently switch to ordinary STT/TTS. A server-approved compatibility model belongs only in the top-level `thread/realtime/start` parameters and needs a real WebRTC regression test. Preserve upstream errors for diagnostics, restore all controls, and show a concise system-level compatibility notice outside character dialogue.
- Codex Frameless Live owns its server-side endpointing and may reject Realtime `session.update` turn-detection fields. When a natural Japanese clause pause needs more grace, apply one shared, bounded microphone hangover to the outgoing Live track on settings chat, desktop mascot, and remote; do not send unsupported session fields or inject unrelated synthetic noise. Test a multi-clause utterance whose internal pause is shorter than the effective grace and confirm it becomes one turn.

## Evidence standard

- Unit-test the coordinator, buffer, gate, readiness, and deduplication logic with interleaved and late events.
- Integration-test every affected IPC/HTTP entry point and ensure it reaches the shared runtime exactly once.
- Make Live smoke tests assert an actual WebRTC transport and a successful turn. Device STT/TTS fallback, a connected-looking microphone button, or a swallowed startup error must fail the test.
- For optional local speech models, test the installed Windows Electron runtime with real audio through start, ordered pre-roll, partial display, finalization, and one commit; model-only transcription is insufficient evidence.
- Use a real development profile for TTS/Live timing, MCP/Skill readiness, Windows/WSL workspaces, and third-party MCP Apps.
- Capture at least one rendered PC surface and one remote/mobile surface for layout or embedded-content changes.
- Run the full repository test suite after targeted tests pass.
