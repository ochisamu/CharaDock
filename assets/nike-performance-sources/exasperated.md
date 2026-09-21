# Exasperated / やれやれ

Reuses the previously generated `proud-v2-jitome.png`, now assigned to an
affectionately unimpressed expression rather than self-confidence.
`node scripts/build-nike-extra-emotions.cjs` registers its eyes/brows to the
canonical rig and preserves the original mouth and alpha in all three states.
No new generated master and no hardcoded dialogue-to-face substitutions.

The optional Nike Jev performance classifier supplies `exasperated` separately
from `proud`. Other characters retain their existing classifier vocabulary.
Proud/exasperated cannot select the exuberant double-fist celebration pose.
Proud blink composition preserves its authored smile while closing the eyes.

Live's first transcript token no longer cancels the current listener request.
The first meaningful assistant cue still supersedes it, and cancellation,
character switching and latest-request checks retain stale-result protection.
Expressive openings such as `え？`, `わぁ！` and `やれやれ、` trigger semantic
classification early, without adding a request for each token or delaying audio.

Validation: 98 focused tests passed. Actual Live + Beatrice retake selected
surprised at the user stage (634 ms) and assistant stage (240 ms), exasperated
at both stages (513/209 ms), and proud without a celebration pose (319 ms).
These are this capture's timings, not performance guarantees.

Local demo: `work/nike-flagship/nike-live-showcase-v5.mp4`, built with
`encode-showcase-inputs.cjs`. Subtitles contain the full actual submitted inputs,
including staging instructions where used. Existing reply UI remains intact.
