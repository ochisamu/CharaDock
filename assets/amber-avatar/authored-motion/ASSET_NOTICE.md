# Kohaku authored-motion v9

User-supplied artwork from the four `Kohaku_v9_*` handoff archives.
These are CharaDock-original Kohaku derivatives, covered by
[DISTRIBUTION_ASSET_LICENSE.md](../../../DISTRIBUTION_ASSET_LICENSE.md),
not general-purpose Apache-2.0 artwork. The handoff includes the same
CharaDock distribution terms. No upstream demo-character assets are used here.

The PNG originals are preserved without image regeneration. Neutral has six
registered face/body drawings and one hair layer. The curious-tilt pilot has
48 shared-flow RGBA frame pairs and a layered endpoint. Four conversation
expressions have three authored, alpha-locked facial cels each.

The runtime performs bounded decode resizing and canvas compositing. Registered
local speech/blink patches are an integration addition, not separately authored
six-state pose drawings. The four cel motions use short drawing blends, not the
RGB preview MP4s or newly computed optical flow. RIFE is not a runtime dependency.

`import-sha256.json` records source archive hashes and imported PNG hashes.
The 4 archives were verified against their bundled SHA256SUMS (210 entries).
Personal paths, prompts treated as executable instructions, private logs,
unnecessary processing runtimes, and model weights were not imported.
