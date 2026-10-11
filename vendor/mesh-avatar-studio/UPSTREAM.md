# Mesh Avatar Studio runtime

Source: https://github.com/shinshin86/mesh-avatar-studio
Revision: `3e8f4e972aa9c1824773a5aca090651db0c8870a`
License: MIT, Copyright (c) 2026 Yuki Shindo. See LICENSE.

Includes the engine, rig validation and lighting sources. No sample avatar or project images are distributed here.

CharaDock modification: engine/renderer.js falls back to canvas width/height when rendering on a detached canvas. This enables compositing into the PC and Link canvases. engine/createMeshAvatar.js adds an optional preserveMouthOpen switch so CharaDock’s audio envelope and forced mouth frames own lip opening, while the engine animates the rest of the face; engine/index.ts declares that option. Destroying an instance also evicts its asset-base image/JSON cache to release decoded images after appearance changes.

The checked-in browser and CommonJS bundles are built with esbuild from entry.js and rig/validate.ts. Run `node scripts/build-mesh-avatar-runtime.cjs` with esbuild installed in the development environment. The bundles are shipped so esbuild is not required at runtime.
