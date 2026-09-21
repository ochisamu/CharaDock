# Astra showcase — real interaction retake

Status: preproduction. This is not a completed or verified demo.

## Editorial decision

Replace the editorial-board hero with a real desktop-led story. Keep the
existing film as supplemental evidence, not the primary submission.
Target 60–75 seconds, 1920×1080, 30 fps minimum, English actual conversation.
Keep original captures and dialogue tracks. Never replace actual answers with
scripted completion speech. Do not create a recording-specific Codex CLI.

The premise: one character, one useful deliverable, one follow-up away from
the desk. The PC remains the execution host; the phone and ESP32 are interfaces.

## Real task

Use a local copy of CharaDock's public introduction page, not the deliberately
broken FocusRoom fixture. Ask for a focused mobile-friendly introduction with
a clear feature hierarchy. Do not publish or modify the live site during filming.
Capture the genuine initial state. Do not introduce a fake defect for drama.
After inspecting the actual first result, ask for one concrete improvement
from the remote interface. Adapt the follow-up to the actual output.

Before recording, verify that the same selected project and work context can
be continued from PC to remote and back. If not, stop and report that limitation;
do not edit separate jobs into apparently seamless continuity.

## Shot plan

| Time | Actual image/action | Audience takeaway |
| --- | --- | --- |
| 0–7s | Physical ESP32 beside PC. A person presses the actual device control and asks the task. Keep device and responding desktop in one shot. | This character is usable beyond a chat window. |
| 7–18s | Desktop screen recording: Kohaku acknowledges beside the actual source page and composer. Hold through the causal response without cutting. | Speak to a companion about a real task. |
| 18–35s | Real Work activity and the resulting preview. Shorten only idle time; mark the cut “Waiting time shortened.” | Codex does useful work, and the result is inspectable. |
| 35–53s | A real phone showing CharaDock remote, not a website responsive preview. Inspect the result and make one follow-up in the same work scope. | Continue the same job away from the desk. |
| 53–66s | Actual revised result and grounded response. Give viewers time to see the change. | The conversation changes the deliverable. |
| 66–70s | Brief CharaDock wordmark over a stable real final frame. | A companion you can keep working with. |

If the full sequence needs more time, allow up to 75 seconds. Never speed up
speech or rush readable text to meet the budget. If one device cannot be
verified, prepare a clearly narrower cut rather than inventing its operation.

## User-recorded material needed

Please record landscape, preferably 1920×1080 or 4K at 30 fps. Use a stable
phone/camera and avoid digital zoom, notifications, private windows and glare.
Record each take continuously, with five seconds before and after the action.
No music, filters or edits in source files.

1. ESP32 and PC in the same frame: the device, button press, human request,
   and the actual character response must all be understandable. Do not record
   unrelated room conversation. A connected USB serial device alone does not
   prove that ESP32 voice interaction works.
2. Phone: record the real CharaDock remote UI, its result, and a follow-up.
   Prefer a phone screen recording plus a short external shot establishing
   that it is a physical phone. Keep pairing URLs and credentials out of frame.
3. Keep original human audio. Synthetic test input may be used for checks, but
   must not be presented as a person spontaneously speaking in the final film.

Example initial request (adjust to what is actually on screen):

> Kohaku, help me improve this CharaDock introduction page. Make the main
> features easy to understand, and make it comfortable to read on a phone.

Example follow-up, only if the first result has the relevant heading:

> Keep the changes, but make the main heading shorter and more conversational.

Do not script the character response. Do not force this wording if it makes
the genuine conversation less natural. An English film requires actual English
interaction, not translated captions over Japanese dialogue.

## Capture and quality gates

- Use the logged-in dev:profile app and normal installed Codex CLI.
- Preserve current profile configuration and history; restore changed choices.
- Real desktop content should occupy most of the film. Keep windows spatially
  consistent; do not detach the avatar into a separate explainer card.
- Retain at least one 8–12 second uninterrupted action/response segment.
- Include two real user turns and their actual outcomes, not one command only.
- Verify selected model, work scope and output files; do not imply capabilities
  or cross-device continuity based solely on narration or a setting.
- Match visible action, caption, speech and lip movement. No unrelated audio.
- Noto Sans JP captions, approximately 48–56px at 1080p, maximum two lines.
  Keep captions out of the character face, controls and result being discussed.
- No repeated zooming, synthetic shake, added UI chimes or flashy transitions.
  Use quiet licensed music only if speech stays fully intelligible.
- Review the full movie with audio, not only selected frames. Verify the final
  file and deliver original sources, edit decisions, captions and attribution.

## Readiness observed on 2026-09-13

- The normal profile Electron app is running.
- One USB serial device (COM4) is enumerated. Its identity and voice readiness
  have not been verified; do not assume it is the intended ESP32.
- No Windows Camera-class device was returned by the read-only device query.
- Windows Computer Use cannot initialize in this WSL thread: sandboxCwd local
  file URI error, repeated after kernel reset. No Windows UI actions were taken.
- Physical device footage and human speech have been requested from the user.
- No retake has been recorded yet. No app code or public site was changed.
