# RLCD transport ownership

Auto prefers a ready USB protocol connection, then authenticated Wi-Fi. A power
cable alone is not sufficient: the USB handshake must complete. Explicit USB or
Wi-Fi selections remain supported. Initial unpaired Wi-Fi setup still uses USB.

Use matching firmware with USB-first arbitration. On a link change the board
stops capture/playback rather than moving a partial utterance to another link.
The standby link can authenticate and report diagnostics but cannot configure
the active microphone. Heartbeats must not restart microphone calibration or
overwrite a conversation scene. USB transmit waits are bounded even if the host
stops reading. Charging circuitry is unchanged.

Both gateways retain their separate connection/error diagnostics. Standby
capture telemetry is logged as `rlcd42-standby-capture-status`, not sent to the
active microphone UI. This is not permission for two simultaneous input owners.

Hardware regression checks: USB + Wi-Fi connected, USB removal during idle and
recording/playback, USB reinsertion, and explicit Wi-Fi. Check both transport
logs, subtitle acknowledgements, microphone throughput and actual speaker audio.
