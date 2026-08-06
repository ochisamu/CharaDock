---
name: capture-windows-evidence
description: Capture and validate polished screenshots or smooth recordings of CharaDock's packaged Windows build from WSL. Use when Codex needs Windows release evidence, UI screenshots, feature demo footage, transparent mascot footage, Realtime/TTS demo captures, or promotional video source clips without UNC launch failures, black transparency, paper-cut animation, private paths, or incomplete responses.
---

# Capture Windows Evidence

Capture the real packaged Windows app and preserve evidence that reflects actual behavior. Keep source code unchanged unless the user separately requests a product fix.

## Choose the capture path

- Use `scripts/capture-window.ps1` for a normal Windows-composited screenshot or MP4 of one visible app window. This preserves real desktop compositing and is the default for control-window evidence.
- Use `scripts/capture-renderer.cjs` through Chromium DevTools Protocol for the transparent mascot window or frame-perfect 30 fps source footage. This avoids black transparency and intermittent desktop-capture flicker.
- Use both for promotional footage: capture the control window normally and the mascot as transparent PNG frames, then composite the real frames over a clean desktop/background.
- Use the Computer Use skill only to arrange windows and drive visible interactions. Capture with the scripts so evidence is repeatable and saved at a known path.

## Prepare the packaged app

1. Build with `$build-windows-binaries` when the current Windows package is not already fresh.
2. Copy `dist/win-unpacked` into a unique directory under Windows `%TEMP%`. Do not run the unpacked EXE from the WSL filesystem.
3. Use a separate `--user-data-dir`. For an authentic configured demo, copy the existing profile into the temporary profile rather than mutating the live profile. Never include secrets, usernames, API keys, or absolute home paths in visible UI.
4. Launch from a Windows-backed working directory. Add `--remote-debugging-port=9222` when transparent renderer capture is needed.
5. Wait for the app to settle. Bring the intended window forward and keep unrelated windows outside the capture rectangle.

An empty temporary profile cannot see models stored below the normal CharaDock
profile. Do not point the capture app at the live profile: it contains encrypted
credentials, histories, memories, private paths, caches, and Chromium session
state, and two app instances can contend for its files. Create an allowlisted
capture profile instead:

```bash
profile_script_win=$(wslpath -w "$PWD/.agents/skills/capture-windows-evidence/scripts/prepare-capture-profile.ps1")
source_profile='C:\Users\<user>\AppData\Roaming\charadock'
capture_profile=$(wslpath -w "$capture_root/user-data")
(cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$profile_script_win" \
  -SourceProfile "$source_profile" -DestinationProfile "$capture_profile" \
  -CharacterId amber-avatar -LinkModelData)
```

This retains safe appearance/voice choices, clears secrets and histories, and
links only model-weight directories so Irodori and STT do not need downloading
again. Use a dedicated demo workspace through `-WorkDirectory` when previewing
artifacts. Custom characters and custom voice files require an explicit,
rights-checked copy; they are excluded by default.

Example launch from WSL using PowerShell argument separation:

```bash
app_win=$(wslpath -w "$capture_root/app/CharaDock.exe")
profile_win=$(wslpath -w "$capture_root/user-data")
(cd /mnt/c && powershell.exe -NoProfile -Command \
  '& { param($exe,$profile); Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=$profile","--remote-debugging-port=9222") }' \
  "$app_win" "$profile_win")
```

Do not pass backslash-escaped quotes through `cmd.exe /c`; they can arrive as literal characters and produce “command not recognized.”

## Capture a normal window

Convert paths with `wslpath -w`, then run:

```bash
script_win=$(wslpath -w "$PWD/.agents/skills/capture-windows-evidence/scripts/capture-window.ps1")
output_win=$(wslpath -w "$PWD/work/evidence/control.png")
(cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$script_win" \
  -Mode Screenshot -ProcessName CharaDock -OutputPath "$output_win")
```

For video, use `-Mode Record -DurationSeconds 12 -FrameRate 30` and an `.mp4`
output. Pass `-AudioDevice "<DirectShow loopback device>"` when Stereo Mix or a
virtual loopback device exists. Without a loopback device, capture app audio
inside the renderer as described below. Use `-CaptureArea Desktop` for a single
combined view containing every CharaDock window. Window capture restores and
activates the selected app window before FFmpeg reads its desktop rectangle; use
`-DoNotActivate` only when the foreground layout was deliberately arranged.

## Capture the transparent mascot

With the packaged app running on debugging port 9222, run the script with
Windows Node so it shares the same localhost boundary:

```bash
script_win=$(wslpath -w "$PWD/.agents/skills/capture-windows-evidence/scripts/capture-renderer.cjs")
output_win=$(wslpath -w "/absolute/path/to/frames")
(cd /mnt/c && node.exe "$script_win" --port=9222 --url=mode=obs \
  --output="$output_win" --duration=12 --fps=30 \
  --audio-output="C:\capture\avatar-audio.webm")
```

The packaged renderer can have an empty title while loading, so select it by
URL: `mode=obs` for the mascot and `desktop/control.html` for settings. For one
screenshot, omit duration and provide a `.png` output. The recording form
produces lossless `frame-00000.png` files and `capture.json`; use its measured
fps when encoding. Do not interpolate a few stills into fake movement.

`--audio-output` records the actual media played by the chosen renderer,
including TTS or Realtime audio. Start this script before triggering speech.
Chunked TTS can produce numbered WebM segments and a JSON manifest; concatenate
them in manifest order, then mux with the visual track. If no audio is captured,
do not substitute unrelated narration—verify that the sanitized profile sees
its model junction and that playback began during the capture interval.

For a combined desktop/window MP4 with Windows loopback audio, enumerate
DirectShow devices first:

```bash
(cd /mnt/c && cmd.exe /d /c ffmpeg -hide_banner -list_devices true -f dshow -i dummy)
```

Pass an explicitly listed Stereo Mix or virtual loopback name to
`-AudioDevice`. Do not guess a microphone name: microphone capture records the
room and can leak unrelated speech, while renderer capture records only audio
the app actually plays.

## Select the surface

- **Avatar:** use renderer URL `mode=obs`; capture transparent PNG frames and renderer audio.
- **Settings:** arrange the control window, then use `capture-window.ps1 -CaptureArea Window -ProcessName CharaDock -WindowTitle CharaDock -ExactWindowTitle`; process and exact-title matching prevent a browser tab, the in-app browser, or the mascot from being selected.
- **Preview:** open the artifact preview first, wait for its document/image/iframe to finish, then capture the control window.
- **All together:** use `capture-window.ps1 -CaptureArea Desktop`, or composite the transparent avatar frames over the settings/preview recording for a clean promotional layout.

## Capture real interactions

1. Start capture before the action, leaving 0.5–1 second of handles for editing.
2. Perform the actual conversation, work, TTS, or Realtime request. Do not replace Realtime with prerecorded speech when demonstrating Realtime.
3. Poll visible completion state. Keep recording until thinking/working indicators disappear, the final answer is visible, speech finishes, and the avatar returns to a natural idle blink.
4. When a long wait harms pacing, cut only the idle middle and join on visually stable frames. Never cut away while “考え中” or progress is the only visible outcome.
5. For transparent mascot footage, retain real mouth, blink, hair, and idle frames. Avoid synthetic pose jumps or a fixed expression.

## Quality and privacy checks

- Inspect the first, middle, and last frame at original resolution.
- Require smooth 30 fps motion for public video; use measured capture fps from `capture.json`.
- Reject black backgrounds around transparent characters, bald/missing layers, stale icons, cropped bubbles, unfinished answers, cursor accidents, and visible user-folder paths.
- Confirm the audio belongs to the shown interaction and is not clipped, doubled, noisy, or drifting.
- Prefer a neutral desktop/background that contrasts with hair and clothing. Restore any changed desktop state afterward.
- Save final evidence under `work/evidence/` and public-ready media under the user-requested output directory.

## Cleanup

Close the capture app by the exact PID and its Electron child-process tree
(`taskkill.exe /pid <pid> /t /f`), then wait for file locks to clear. Remove only
the exact temporary capture directory, and preserve unrelated build output and
user files. Report capture paths, resolution, fps/duration, and any audio source
used.
