# The previous format: `livemaker-puppet`, version 3

Packages exported from livliv.ai before format 4 (November 2026) are this format. Players read it forever, as it is.
This page says how it differs from [format 4](FORMAT.md), for anyone holding such a package; the meaning of the rig,
anchors and layer fields is the same.

A v3 package is a ZIP made of the character's folder, files at its root, with more in it than a player needs:

```
model.json
textures/*.png and textures/*.webp   every layer image twice; players load the WebP
keyforms.json                        refined characters only
avatar.webp, thumb.jpg, poster.jpg, preview.webp, variants/*.jpg   previews, not read by players
```

`model.json`, as it differs from format 4:

| v3 | format 4 |
|---|---|
| `format: "livemaker-puppet"`, `version: 3` (the earliest builds wrote neither; read as 3) | `format: "livliv-model"`, `version: 4` |
| `watermark`: `"LivLiv"` (the logo), any other string (the owner's corner text), or `null`; only in exports | `meta.watermark.kind` / `text` |
| `keyforms: "keyforms.json"` | `files.keyforms` |
| no `meta`, `files` or `requires` | |
| `profile: {id, label, class: {…}}`; players read `class.input.facing` and `class.input.glasses` | `profile: {id, facing, glasses}` |
| `tuning.hairFront`, `tuning.hairBack` | `tuning.hair_front`, `tuning.hair_back` |
| `expressions[]: {id, label, key, …}`: `label` one string; ids such as `x_expr_03637e` (a hash of the label) | `{id, label: {lang: name}, hotkey}`, standard ids |
| a layer's `texture`, `frames`, `mask`, `talk`, `brow_tex` end in `.png`; `webp: true` means "load the `.webp` beside it" | the real path |
| a layer's `name` (Japanese and English, as in a Live2D PSD) | optional `label` |
| a layer's `param`: the expression it belongs to (`smile` for the build's smile) | `expression` |
| a mouth layer without `visemes`: its frames are closed, half, open | `visemes` required |

Fields a v3 file carries that players do not read: `params` (a Cubism-style parameter list), `tex`, `rig_preset`,
`rig_template`, `hair_motion`, `rig.front_depth`, `rig.back_depth`, `rig.bust` (the chest spring players use is
`rig.body.bust`), `anchors.chin_y`, `expressions[].instruction` and `preview`, `profile.class` beyond `input.facing` and
`input.glasses`, and on some hand-rigged layers `pin`, `field`, `root`, `band`.
