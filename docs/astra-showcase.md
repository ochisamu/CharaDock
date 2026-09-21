# CharaDock × Astra showcase

## Status and checkpoints

- CharaDock pre-showcase checkpoint: `e42438f` (Irodori Anime and ESP32 integration).
- CharaDock-ESP32 was already clean at `e10ea28`; no empty commit was created.
- Working branch: `feat/astra-desktop-showcase`.
- Windows and WSL regular CLI installations were updated to 0.154.0. After
  normal WSL reauthentication, actual Astra Chat and Work inference succeeded.
  The successful Work run `work-1789257140778-1` edited CSS, strengthened the
  browser verifier, and produced desktop/phone preview images in 108 seconds.
- Browser checks passed at 320, 390, 600, 768, 980 and 1440 px, including all
  three button actions with pointer, Enter and Space. The browser was started
  before the task and exposed locally for verification; it was not simulated.
- Earlier failed/timeout takes are excluded from the public edit. The final
  edit shortens idle waits and uses the successful run's actual English speech.
  It demonstrates screenshot attachment + Work/TTS, not Realtime or a continuous
  live screen feed. No model substitution or fabricated result was used.
- The abandoned capture-only CLI was removed. Normal WSL CLI discovery now
  takes priority over the desktop-managed cached runtime (20 related tests pass).
- Full tests after changes: 781 Node tests and 58 Python tests passed.
- Successful source capture: 180 seconds, 8,770 real renderer frames (~48.7 fps),
  normalized to 30 fps. Audio is the renderer's actual Supertonic 3 output.
- No X post, Product Hunt submission, public deployment, or release was made.

## Product story

**An AI companion you can work with, not just talk to.**

Keep the character, user intent, and visible outcome central. Astra is the
reasoning engine behind the work; it is not a second character or a replacement
for the selected voice. The opening should show a meaningful result, not a
settings tour or a model picker.

The referenced conversation proposed a screen-to-working-app demonstration.
The first production scenario is narrower and verifiable: fix a clipped session
grid in a fictional local landing page. The fixture is under
`examples/astra-layout-demo/`. Copy it into a disposable workspace before use.
It intentionally contains the initial bug; do not overwrite the fixture with
the corrected result.

## Hero cut: 40–50 seconds, 1920×1080

| Beat | Time budget | What viewers see and hear |
| --- | --- | --- |
| Result-first hook | 0–4s | Kohaku beside the corrected page. “An AI companion you can work with.” |
| The real problem | 4–11s | The actual clipped cards; a readable user request, not a rapid typing montage. |
| Shared context | 11–17s | An actual screenshot attachment or explicit screen permission, whichever the recorded run uses. Do not imply a live screen feed from one screenshot. |
| Real work | 17–30s | Actual Astra commentary, changes, and test evidence in CharaDock. Remove only idle waits and label a compressed run. |
| The payoff | 30–41s | Corrected desktop and phone layouts; exercise a session button. The spoken conclusion must describe these same changes. |
| Clean close | 41–48s | Kohaku, CharaDock name, “A face. A voice. A helping hand.” Store/GitHub availability only if still verified. |

Suggested request:

> Kohaku, these session cards are getting cut off. Fix the layout and check it
> at phone size too. Keep the visual style and all three sessions.

Use the real model response, never a scripted success substituted into the
speech bubble. If the response takes a different useful route, edit the video
around the actual result instead of forcing a fictional sequence.

## Visual and audio treatment

- Keep the real character large enough to read facial reactions, with the page
  occupying most of the remaining frame. No empty central gutter.
- Use one quiet cream/charcoal palette, restrained sage accents matching the
  Focus Room fixture, and Noto Sans JP for Japanese typography.
- Display text must remain readable on a phone: large captions, at most two
  short lines, enough hold time for a human to finish reading.
- Prefer stable framing. No artificial character shake, repeated zooms, or
  motion interpolated from stills. Use short, calm transitions at scene changes.
- English: actual English model responses with the installed Supertonic voice.
  Japanese: a separate real run using the configured Japanese voice. Do not
  translate captions over a Japanese demo and call it an English voice demo.
- Preserve source footage, real audio, edits, subtitles, before/after files,
  and the validation report. Do not add UI sounds or unrelated narration.

## Verification gates

1. Confirm Codex can actually complete a request; cached “signed in” state is
   insufficient. Confirm the requested Astra model is used, with no silent
   substitution. Never copy authentication tokens between accounts or profiles.
2. The user explicitly authorized the logged-in dev:profile environment. Use
   a disposable project and existing model weights, preserve original settings,
   never clear history, and keep private history/settings outside the recording.
   Use normal CLI installations, not a dedicated capture runtime.
3. Record an actual task through the normal composer. Preserve the grounded
   work result and verify the modified files. Don't stage a hand-written result
   as if the application produced it.
4. Check desktop and 390px phone layouts for clipped cards and horizontal
   overflow. Exercise each button and verify the selection text.
5. Check actual speech against visible text, full response completion, lip
   synchronization, safe stop, and repeat input after an error.
6. Review first/middle/final frames and the complete encoded video with sound.
   Keep all private paths, histories, keys, identifiers, and unrelated windows
   outside the frame.

## Implementation coverage in this branch

- English screen/browser/computer intent and scoped consent handling, shared
  by the desktop mascot and remote conversation route. File attachments remain
  on their normal direct path; settings text-only chat does not acquire screen
  access implicitly.
- English permission labels and status in the desktop mascot.
- Neutral English Work timeout fallback. Grounded model commentary still has
  priority; a fallback no longer repeats a user instruction as character speech.
- Targeted request/consent/denial/continuation tests and existing Japanese
  regressions; full suite required after final modifications.
- Windows real-renderer check confirmed that an English screen request opens
  the permission controls and declining hides them without screen access.

No additional unrestricted computer-operation route was added for this demo.
Existing Work and approved-screen boundaries remain in place.

## Reference

[OpenAI computer-use documentation](https://developers.openai.com/api/docs/guides/tools-computer-use)
recommends code execution for Astra and also supports existing custom UI tools.
CharaDock already has Codex Work plus explicit screen/browser/computer routes;
the showcase should exercise these rather than add a competing voice/agent loop.

Event dates and eligibility in the referenced chat were not used as a deadline
or copied into promotional claims. Recheck the actual event page separately
before submitting to a contest.
