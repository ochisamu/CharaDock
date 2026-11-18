# LivLiv Player

Source: https://github.com/livliv-dev/player
Commit: 98c1ae724a0f871c5e77c24b4a2b570b14a42d00
Version: 0.5.1 (tag v0.5.1). Apache-2.0. LICENSE and NOTICE retained.

Only the player source is vendored. No featured character, online generation service, face tracking, microphone capture or separate audio playback is used. CharaDock owns playback and sends its existing mouth envelope and decision cues into the local player.

Build: `CHARADOCK_ESBUILD_PATH=/path/to/esbuild node scripts/build-livliv-runtime.cjs`. `livliv.js` is the self-contained browser bundle and `validator.cjs` is the upstream model reader. The shared PlayerBase exposes `advance(dt)` for CharaDock's frame loop and uses the host's drawing-buffer dimensions for detached canvases and gaze. CharaDock snapshots the last composited frame directly. `package-reader.cjs` bundles the upstream bounded ZIP reader for imports.

## VRM host integration

`vrm.js` is a separate, self-contained, lazy browser bundle built from `vrm-entry.ts`, the vendored BodyPlayer/VrmBody, Three.js 0.180.0 and @pixiv/three-vrm 3.5.5. Dependencies are pinned in the root lockfile; full MIT notices are in `vrm-licenses/`. `vrm-reader.cjs` exposes the upstream bounded GLB check and author metadata reader for imports. `vrm-policy.cjs` exposes the local face policy for tests. Rebuild all bundles with the command above.

BodyPlayer exposes the last frame's parameters and applies the host movement scale to live head and torso poses. VrmBody adds skeleton-based bust/head framing, a full-frame-equivalent focal length with camera distance compensation, zoom around the portrait center, a reduced-motion spring reset, and inspectable native morph weights. The host owns the frame loop and audio envelope.

`charadock-vrm-expression-policy.ts` resolves mouth/blink overrides in memory. Models with authored `brow_<feeling>`, `<feeling>_eye` and `<feeling>_mouth` components retain brows/eyes during speech, with native visemes and blinks owning those parts. An unsplit face that blocks the mouth yields while speaking. No imported model bytes, metadata or licenses are changed or re-exported. VRM 0.x still uses the upstream orientation and expression normalization. No camera, microphone, second audio route, hosted model, external decoder or CDN is introduced.
