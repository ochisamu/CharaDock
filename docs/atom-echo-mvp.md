# ATOM Voice (formerly ATOM Echo) Wireless Voice Satellite MVP

CharaDock can use an M5Stack ATOM Voice, formerly sold as ATOM Echo, as a small wireless voice body. The Windows app remains the single conversation runtime; the device captures microphone audio, shows state with its LED, and plays the selected character's voice over the local network.

Product code `M5STACK-C008-C` was renamed from **ATOM Echo** to **ATOM Voice** in April 2026 and remains the same original ESP32-PICO-D4 hardware. See the [Switch Science ATOM Voice product page](https://www.switch-science.com/products/6347) for purchasing and specifications. CharaDock v0.5.1 keeps the “ATOM Echo” label in its settings and firmware names for compatibility.

## What the MVP supports

- Wi-Fi audio between ATOM Echo and the Windows CharaDock app
- USB-only initial setup with no Wi-Fi password stored by CharaDock
- LAN discovery without entering the PC address
- Device-specific HMAC authentication using a 256-bit pairing secret
- USB audio fallback for setup and diagnostics
- Selectable push-to-talk or hands-free microphone input at 16 kHz, mono, 16-bit PCM
- Adaptive hands-free start detection with an 80–800 RMS threshold control and live level diagnostics
- PC-setting parity: the current Chat/Work mode, workspace, character, voice, and GPT-Live selection are inherited from the PC
- GPT-Live Chat/Work input through the same authoritative Realtime session used by the PC app
- Standard speech-recognition Chat/Work input through the same authoritative normal conversation route used by the PC app
- Raw Live voice, Beatrice 2-converted Live voice, and non-system PCM-WAV character voices on one selected output
- Voice-optimized playback through the ATOM Echo built-in speaker
- A shared 50–150% output-gain control for standard TTS, GPT-Live, and Beatrice 2
- LED feedback and button interruption

Internet relay, wake-word activation, encrypted LAN audio, Bluetooth output, and full-duplex audio are outside this MVP. Work observes the PC workspace, Skill/MCP assignments, progress UI, artifact tracking, and approval boundary. Use it only on a trusted home or office LAN.

## Install the firmware

The firmware, reproducible PlatformIO build, merged release image, and complete setup guide are maintained in [ochisamu/CharaDock-ESP32](https://github.com/ochisamu/CharaDock-ESP32).

With the ATOM Echo connected, open PowerShell in the cloned firmware repository and run:

```powershell
pio run --project-dir firmware/atom-echo --target upload --upload-port COM3
```

Replace `COM3` with the assigned port. The USB setup protocol uses 500000 baud. The stable firmware identifies itself as `0.5.1`. OTA firmware updates are outside this release.

## Pair it with CharaDock

1. Start the Windows CharaDock app.
2. Open **Settings → ESP32 devices → ATOM Echo**.
3. Enable **Use ATOM Echo**.
4. Keep the ATOM Echo connected to the PC over USB for this setup only.
5. Enter the Wi-Fi name and password, then choose **Connect to Wi-Fi**.
6. If Windows asks for network access, allow the app on private networks.
7. Wait for **Wi-Fi connected**, then use **Test character voice**.

CharaDock applies the same built-in-speaker profile to standard character TTS, GPT-Live, and Beatrice 2 output. It removes inaudible low-frequency energy, holds peaks below the small speaker's clipping range, and adds one fade around the complete utterance rather than around each synthesized chunk.

Use **Overall volume** in the ATOM Echo section to set the final device gain from 50% to 150%. The limiter remains active at every setting.

The password is sent over the physically connected USB cable and stored in the ESP32's non-volatile storage. CharaDock keeps only the network name, device ID, and a Windows-encrypted pairing secret.

After pairing, disconnect the ATOM Echo from the PC and power it from any suitable USB power supply on the same LAN. It discovers and reconnects to the paired CharaDock automatically.

## Use it

ATOM Echo follows the current PC voice settings instead of maintaining a second hardware-specific voice profile:

- With **Work** selected on the PC, both standard voice input and GPT-Live use the PC's current workspace and shared Work runtime. Progress, artifacts, interruption, and approval requests remain visible on the PC.
- While a standard Work turn is running, another push-to-talk utterance is steered into that same turn as a follow-up instead of starting a second Work run.
- With **Desktop → Speech input → GPT-Live / Codex Voice**, microphone PCM is bridged into the existing Codex Realtime path. The original Realtime voice is returned to the device.
- With **Character → Live voice conversion → Beatrice 2**, that Realtime output is converted by the configured Beatrice model before it is returned to the device.
- With a non-Live speech-input choice, ATOM Echo uses the normal Chat/Work path and the selected standard character TTS provider.

Choose **Push to talk** to press and hold the ATOM Echo button while speaking, then release it. Choose **Hands-free** to keep the microphone waiting while the blue LED is lit; the firmware calibrates briefly against ambient sound, keeps a short pre-roll, detects speech, and submits the turn after roughly 800 ms of silence. The LED changes to cyan as soon as speech starts. Use **Start threshold** if normal-distance speech is still missed: smaller values are more sensitive, while the adaptive noise floor remains active to limit false starts. The microphone pauses while an answer is playing and resumes automatically afterward. Only one Live owner and one audio destination are active: starting from ATOM Echo does not also play the same answer through the PC speaker.

Press the button once while the device is thinking or speaking to interrupt the active response. In hands-free mode, holding and releasing the button remains available as a manual fallback.

## Network details

- UDP 41721: device discovery
- TCP 41722: authenticated framed audio
- UDP 41723: device-side discovery socket

The PC and device must be able to reach each other on the local network. Guest Wi-Fi client isolation can prevent discovery even when both devices have internet access.

## Troubleshooting

- If USB setup is unavailable, close any serial monitor that has `COM3` open and refresh the USB list.
- If Wi-Fi setup fails, confirm the SSID/password and that the network supports 2.4 GHz clients.
- If the device joins Wi-Fi but remains undiscovered, allow CharaDock through Windows Firewall on private networks and disable guest/client isolation.
- If listening fails, install the streaming speech-recognition model in CharaDock.
- If the reply appears but the speaker stays silent, select a non-system TTS provider and run the speaker test.
- If GPT-Live does not start, select the Codex app-server backend and stop an existing PC or phone Live session first.
- If Beatrice falls back to the original Live voice, verify that the selected character has a ready Beatrice 2 VST3, model, and voice in the PC settings.
- The original ATOM Echo speaker is intended for speech rather than high-fidelity music or strong bass. The voice profile favors clean dialogue over maximum loudness.
- Keep the ATOM Echo near the access point if audio breaks up. CharaDock pipelines a bounded six-chunk playback window, while firmware v0.5.2 keeps the Wi-Fi radio responsive and prebuffers about 200 ms before I2S playback to absorb timing variations.
- The microphone and speaker share the ATOM Echo audio interface, so recording and playback are half-duplex by design.
