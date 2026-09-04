# Conversation reliability audit

## Scope

The September 2026 audit covers normal Chat/Work routing, Codex and OpenAI
request lifetimes, desktop/control microphone input, and ESP32 USB/Wi-Fi
capture ownership. It does not change character artwork or introduce on-device
TTS. ESP32 speech continues to be recognized and synthesized on the PC side.

## Reproduced failures and corrections

- **Idle Chat rejected as busy:** a reset Work client and the active-client
  lookup both returned `null`; equality incorrectly classified the app as
  Work-owned. Ownership now requires a real client.
- **Microphone unavailable after failure:** startup, PCM append, and
  transcription failures could leave capture state behind. Pending recognition
  remains cancellable after button release; stale completions cannot overwrite
  a newer recording.
- **Follow-up loses the device answer:** capture identity is separate from
  answer identity. A follow-up no longer invalidates its original answer's
  playback. Old transport callbacks cannot release a newer capture. Playback
  waits for recording/recognition to clear (bounded to 45 seconds); cancellation
  or timeout skips speech while retaining the text. A follow-up that becomes a
  new actual turn supersedes the older answer.
- **Stop affects the wrong client:** interruption selects the active client,
  not the first previously created browser/computer client. Background MCP
  prewarming does not replace an active conversation client.
- **Client lifecycle hangs:** reset, process exit, early server notifications,
  collector timeout, and Realtime startup/closure now settle their callers and
  preserve thread ownership. Recovery requires evidence of server completion;
  absence of a local collector alone is not evidence that remote work stopped.
- **OpenAI concurrency and truncated answers:** concurrent sends are rejected;
  reset/interruption prevents stale deltas/history updates; incomplete streams
  fail rather than becoming successful conversation history.
- **Renderer microphone races:** stopped VAD cannot later auto-send a decoded
  utterance. Cleanup closes the recording's own media stream. STT completion
  does not release an unrelated conversation's busy state.
- **Cross-window follow-ups:** pending submissions are drained once after
  interruption settles, including when the original response started in the
  other window. New drafts and unsent input are retained.
- **Transport handoff:** duplicate capture starts preserve startup readiness;
  stale old-port events cannot enter a replacement decoder; authenticated
  Wi-Fi handoff preserves complete and partial trailing frames.

RLCD activity distinguishes listening, recognizing, waiting for a reply,
playback, recognition failure, send failure, and playback failure. A playback
failure retains the recognized answer text.

## Automated verification

Run `npm test`. The following tests are especially relevant:

- `desktop/tests/conversation-main.test.cjs`: executes actual main-process
  routing/capture functions in an isolated VM, including `null` client references,
  cancellation races, failure/retry loops, and follow-up answer ownership.
- `desktop/tests/codex-client-reliability.test.cjs`: protocol ordering,
  cancellation, startup/reset/exit, timeout, and Realtime regressions.
- `desktop/tests/openai-client.test.cjs`: controlled fetch/SSE streams; no paid
  model calls are needed.
- `desktop/tests/frontend-voice-lifecycle.test.cjs`: controlled media and IPC
  races; does not require opening a physical microphone.
- Hub and serial/Wi-Fi tests: overlapping callback ownership and reconnect paths.

Use `./scripts/windows-dev.sh --smoke-test` for Windows Electron UI/runtime
verification with the separate development profile. Do not combine it with
`--shared-profile`: the smoke suite intentionally changes test settings.

Final audit verification: 715 desktop tests and 58 Python tests passed;
Windows Electron returned `desktop-smoke: ok (CharaDock)`. These checks use
mocked conversation services, not live paid model requests or physical speech.

## Physical acceptance checks still required

Automated timing tests do not substitute for a long hardware session. With the
updated PC app and existing device firmware:

1. Hold PTT, speak, release; confirm recognizing → waiting → reply/playback.
2. Try silence, then a valid utterance. The second press must work without restart.
3. Repeat after several minutes idle, with USB and Wi-Fi separately.
4. Interrupt during recognition and response; then record again. No late old
   answer or old error should overwrite the new input.
5. Add a spoken follow-up while an answer is running; confirm one final answer.
6. Disconnect/reconnect during capture, then confirm retry works.
7. Check Chat, Work, and Live independently. Verify the existing five-minute
   idle Live closure and that the next explicit input can reconnect.

Record provider, transport, stage and timing when a failure occurs. Do not
publish credentials, full transcripts, audio recordings, or private device logs
in the repository.
