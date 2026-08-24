# Character Runtime v2

Character Runtime v2 is the first staged TypeScript boundary in CharaDock. It
does not rewrite the Electron main process. Instead, it moves the parts where a
small state mistake is visible as a broken character experience into typed,
testable modules.

## Goals

- Keep one authoritative turn across Chat, Work, TTS, and Live.
- Make the four bundled characters differ in judgment and behavior, not only
  sentence endings.
- Preserve user-edited personalities and imported characters.
- Keep technical facts, tool results, safety decisions, and file operations
  independent from role-play.
- Add TypeScript incrementally without blocking the existing CommonJS app.

## Runtime boundary

Source files live in `desktop/runtime/` and compile to
`desktop/generated/runtime/`. Generated files are not committed; all desktop,
test, distribution, and Windows development entry points build them first.

`TurnCoordinator` owns the current turn ID, mode, status, audio route, latest
visible text, Work run ID, and artifact references. UI streams are enriched
with `turnId`, `turnStatus`, and `audioRoute`. This prevents Live audio and
normal TTS from independently claiming the same response.

`CharacterDirector` owns the structured Character Profile v2 schema, prompt
construction, deterministic repetition guidance, touch/thinking phrases, and
reaction tuning. The Electron main process still owns permissions, tools,
storage, audio playback, and window lifecycle.

## Bundled character direction

| Character | Working relationship | Distinctive behavior |
| --- | --- | --- |
| Kohaku | Curious co-creator | Finds a small first step and celebrates concrete progress |
| Sepia | Dependable senior partner | Prefers practical, reversible plans and calm recovery |
| Towa | Tool-loving builder | Suggests experiments, measurements, and reproducible checks |
| Sage | Analytical advisor | Separates facts from inference and clarifies decision criteria |

Profiles contain role, relationship, values, voice, humor boundaries,
preferred and avoided wording, success/failure/uncertainty behavior, example
dialogue, touch phrases, thinking phrases, and motion tuning. They are grounding
instructions, not permission to invent completed work or emotions.

## Migration policy

This stage intentionally keeps the Electron entry point and IPC handlers in
CommonJS. New stateful domain logic should prefer TypeScript when it can be
called through a narrow compiled module. Large renderer and main-process files
should be split by responsibility before conversion; a file-extension-only
rewrite is not a goal.

## Verification

- `npm run runtime:typecheck`
- `npm run test:desktop`
- `npm test`

Character tests verify distinct built-in profiles, custom-character fallback,
reaction differences, repetition guidance, and turn/audio-route transitions.
