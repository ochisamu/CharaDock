# RLCD4.2 normal TTS completion

Normal TTS still synthesizes PCM on the PC. Each known-length transfer is
limited to 512 KiB (16.384 seconds at 16 kHz mono PCM16); the firmware buffers
the complete part before playing it. Do not change this to an unpaced Live
stream: ACK confirms receipt, not free ring capacity or audible completion.

Firmware advertising `capabilities.audio.playbackStatus: true` supports
Protocol v2 `AUDIO_STATUS` (`0x25`). Send an empty request on the active link.
The response uses the same type and sequence with one byte:

| Value | Meaning |
| --- | --- |
| 0 | Completed, including DMA drain and codec shutdown |
| 1 | Buffering or playing; not completed yet |
| 2 | Playback failed |
| 3 | Stopped/interrupted |

After the AUDIO_END ACK, normal TTS polls every 100 ms until completion. The
deadline is the nominal part duration plus 10 seconds, and each query has a
3-second transport deadline. Failure must surface, not become a successful
reply. Cancellation generations prevent an old query from clearing a new
playback. USB and Wi-Fi share this logic. Old firmware retains the legacy
duration-based wait; **both the PC app and RLCD firmware need updating for
device-confirmed completion**. StackChan does not advertise this capability.

Hands-free echo suppression spans all WAVs, caption updates and streamed
synthesis gaps in one response. The lease is released in `finally`, including
failure/cancellation. Manual PTT retains its existing gate behavior.

Validation before claiming the audible issue resolved:

- Compare a >40-second reply over USB and Wi-Fi, including its final words.
- Include one WAV exceeding 512 KiB and a reply consisting of many small WAVs.
- Test physical interruption, meeting mute, disconnect and the next utterance.
- Check for playback failure/timeout diagnostics and speaker echo triggering
  another turn between sentences.

Host regression tests cover multi-part payload preservation, delayed device
completion, failure and stale completion after interruption. These tests and
a firmware build are not substitutes for listening on the physical device.
