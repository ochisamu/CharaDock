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
- Errors always restore usable controls and preserve the last meaningful grounded response.
- Supporting results open once without stealing focus, hiding the composer, or covering the character more than necessary.

## Evidence standard

- Unit-test the coordinator, buffer, gate, readiness, and deduplication logic with interleaved and late events.
- Integration-test every affected IPC/HTTP entry point and ensure it reaches the shared runtime exactly once.
- Use a real development profile for TTS/Live timing, MCP/Skill readiness, Windows/WSL workspaces, and third-party MCP Apps.
- Capture at least one rendered PC surface and one remote/mobile surface for layout or embedded-content changes.
- Run the full repository test suite after targeted tests pass.
