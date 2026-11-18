# The LivLiv model package, format 4

A LivLiv model is a 2D character cut into layers, with the anchors and rig settings a player needs to move it: head
turns, blinks, gaze, brows, lip sync, breathing, hair that swings, and expressions. This document describes the package
that [livliv.ai](https://livliv.ai) exports and that LivLiv Player (`@livliv-dev/player`) and LivLiv Stage read.

- JSON Schema: [`schema/livliv-model-v4.json`](schema/livliv-model-v4.json) (`model.json`) and
  [`schema/livliv-keyforms-v1.json`](schema/livliv-keyforms-v1.json) (`keyforms.json`)
- The format before this one: [FORMAT-v3.md](FORMAT-v3.md). Players read it forever.
- Status: 4.0, November 2026.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. The package

A package is a folder:

```
model.json        required: the manifest and the rig
textures/*.webp   the layer images (PNG is allowed too), named by the layers
keyforms.json     optional, declared in files.keyforms
avatar.webp       optional, files.avatar
cover.webp        optional, files.cover
preview.webp      optional, files.preview
```

or the folder's contents in one ZIP file with the extension **`.livliv`** (media type
`application/vnd.livliv.model+zip`). Both forms are the same package. Readers recognise a ZIP by its content, not its
name: a `.zip` works too.

ZIP rules:

- Plain PKWARE ZIP: no encryption, no ZIP64 (packages are far below 4 GB). Entry names are UTF-8, use `/`, do not start
  with `/`, contain no `..` or `.` segment, and appear once.
- Writers SHOULD put the files at the root and `model.json` first, store images and `model.json` uncompressed
  (method 0) and MAY deflate `keyforms.json` (method 8; it shrinks about five times).
- Readers MUST read stored entries and SHOULD inflate deflated ones (browsers: `DecompressionStream('deflate-raw')`).
  A reader that cannot inflate MAY play without a deflated `keyforms.json` and MUST refuse other deflated entries.
- Readers SHOULD accept a package whose files sit inside one folder (what a system's "compress folder" makes) and
  ignore `__MACOSX/`, `._*`, `.DS_Store` and `Thumbs.db`.

## 2. `model.json`

All coordinates are pixels of the drawing (`canvas`): origin top left, y down.

| field | type | required | |
|---|---|---|---|
| `format` | `"livliv-model"` | yes | |
| `version` | `4` | yes | the major version (§9) |
| `name` | string | yes | the character's name, at most 64 characters |
| `meta` | object | yes | §3 |
| `requires` | string[] | | features a reader must have to draw the model right (§9): `full_body` for a full-body character (§5), else `[]` |
| `files` | object | | the optional files (§4) |
| `canvas` | `[width, height]` | yes | integers, 16–8192 |
| `profile` | object | | §5 |
| `rig` | object | | rig settings (Appendix C); a missing one takes the player's default |
| `tuning` | object | | the owner's feel settings, 1 = default (§5) |
| `anchors` | object | yes | where the head, face, neck, eyes … are (§5) |
| `expressions` | array | | §6; `[]` when missing |
| `layers` | array | yes | §7, in drawing order (bottom first) |
| `x-*` | any | | extensions; readers ignore them |

No other top-level field is allowed (the schema says `additionalProperties: false` except for `x-*`), so that a
misspelt field is caught instead of silently doing nothing. The same holds inside `meta`, `files`, `profile`, `tuning`,
`anchors`, `rig`, an expression and a layer.

## 3. `meta`

```json
"meta": {
  "generator": { "name": "livliv.ai", "build": "a2926bb" },
  "created": "2026-11-04T08:00:00Z",
  "author": { "name": "Mira" },
  "license": { "id": "LicenseRef-LivLiv-Terms", "url": "https://livliv.ai/terms" },
  "watermark": { "kind": "livliv" }
}
```

| field | |
|---|---|
| `generator` | required. `name`: the tool that wrote the package. `build`: its build (for troubleshooting only; readers MUST NOT change behaviour on it) |
| `created` | when the package was written, UTC, ISO 8601 |
| `author` | `name` (and `url`): the credit the character's owner chose to show. Never an account id or an email address |
| `license` | `id`: an SPDX identifier or expression, or `LicenseRef-…`; `url`: the full terms; `text`: a summary for offline readers. Without it nothing is granted |
| `watermark` | the mark the package asks the player to draw, below |

LivLiv writes two licences today: `LicenseRef-LivLiv-Terms` (a character exported by its owner, used as far as the
owner's plan allows; [livliv.ai/terms](https://livliv.ai/terms)) and `LicenseRef-LivLiv-Samples` (the featured
characters shipped with LivLiv Stage and LivLiv Player: free for non-commercial use with credit; the full text is
`LICENSE.md` beside them).

### The watermark

| `kind` | the player draws |
|---|---|
| `livliv` | the LivLiv logo, light over the character and solid in the bottom-right corner (free-plan exports); with `"center": false`, only the one in the corner (the featured characters) |
| `text` | `text` (at most 24 characters), small, in the bottom-right corner: the owner's own mark |
| `none`, or no `watermark` | nothing |

`center` (optional, `livliv` only, default `true`): `false` leaves out the light logo over the character. A player that
does not know the field draws both, so a package never shows less of the mark than it asks for.

The mark is a request to the player and a condition of the licence, **not copy protection**: the player is open
source, and anyone can change the file or the player. A conforming player draws the mark a package asks for, into its
own output (so screenshots and recordings carry it), and never adds the LivLiv mark to a package that does not ask for
it. Removing the mark is a matter of the licence, and of exporting with `none` (LivLiv's paid plans).

## 4. `files` and other files

`files` names the optional files by what they are for. Each listed file MUST be in the package; readers do not look
for files that are not listed, and writers SHOULD NOT add them. Layer images are not listed here: the layers name them.

| key | |
|---|---|
| `keyforms` | head-turn key poses (`keyforms.json`, its own schema). Without it the character plays on the rig alone |
| `avatar` | a small square picture for round buttons, about 96 px |
| `cover` | the character at rest on a transparent background: file browsers, lists, link previews |
| `preview` | a few seconds of animation (animated WebP) |

Paths are relative to `model.json`, use `/`, and contain no `..`, scheme or drive letter.

## 5. `profile`, `tuning`, `anchors`

`profile`: `{ "id": "anime_half", "facing": "front", "glasses": false }`.

- `id`: the drawing's kind: `anime_half` (anime, half body), `chibi`, `mascot`, `painterly`. A reader treats an id it
  does not know as a generic character.
- `facing` (`front`, `three_quarter`, `side`, `back`) and `glasses`: how the face was drawn. The reference player
  only curves the closing eyelid along the drawn lash line on front-facing faces without glasses. Missing: unknown.

`tuning`: `turn nod hair hair_front hair_back blink expr mouth breath`, each a factor (1 = default, 0–10).

`anchors` (all in canvas pixels):

| field | |
|---|---|
| `head` | `{cx, cy, rx, ry}`: the head ellipse. Required |
| `face` | `[x0, y0, x1, y1]`: the face. Required |
| `neck_y` | where the head meets the neck. Required |
| `top_y`, `bottom_y` | the drawing's first and last row; `bottom_y` at the canvas's bottom edge means the picture is cut there. Required |
| `hair_root_y` | the hairline. Required |
| `collar_y` | the top of a collar or choker |
| `eyes` | the eyes' boxes, image-left first |
| `brows` | the brows' boxes (`null`: not found) |
| `brow_lines` | per brow, sampled at `x`: its lower edge (`bottom`), the lid line (`lid`) and, under opaque bangs, how far it may move (`cap`) |
| `jaw` | `top`, `chin`, and how far the jaw drops at each mouth frame (`half`, `open`, `round`, `wide`) |
| `chest` | `{cx, cy, rx, ry}`: where breathing and the chest spring act |
| `frame`, `body`, `hair_bottom_y` | a full-body character's (below) |

### Full-body characters (4.1)

A full-body character is drawn whole, head to feet, on a tall canvas (LivLiv's are 1536 × 3072), and stands on the
ground: a player keeps its feet there while the upper body moves as a half-body character's does. It has three more
anchors, lists `full_body` in `requires`, and usually pins its mesh lattice (`rig.lattice`, Appendix C):

| field | |
|---|---|
| `frame` | `[x0, y0, x1, y1]`: the head-and-chest window a player shows by default, as a half-body character fills its canvas: at least 16 px wide and tall. It may reach past the canvas's edges (room above the head), by at most the canvas's size |
| `body` | the body's points, each `[x, y, confidence]`: `hip_l`, `hip_r`, `ankle_l`, `ankle_r` (required) and `knee_*`, `shoulder_*`, `elbow_*`, `wrist_*`, `neck`, where `_r` is the character's right, on the viewer's left; `ground_y`, the line the soles stand on (required); `hem_y` and `hem_x` (`[left, right]`), where a skirt or a coat ends (missing: nothing hangs); `conf`, how sure the pose estimate is overall |
| `hair_bottom_y` | the lowest row of the hair: long hair swings with its full weight there, not at the feet |

How the reference player moves one (informative): the upper body turns as one piece above a band at the waist; the
whole figure sways from the ankles, so a sideways move of the face in the camera sways it instead of sliding it; the
hips follow the upper body through a spring and shift their weight a little by themselves; a hem hangs behind them; a
move down crouches the figure (the legs shorten as straight lines, the feet stay) and a talking bob dips the upper body
only; only a hop's flight lifts the whole figure. `bottom_y` here is where the feet end, never a cut edge. A player
shows the `frame` by default, and may offer the whole figure or the figure down to the knees.

A model with `body` has `frame`, its hips lie below `neck_y` and above its ankles, and its face has a width.

## 6. `expressions`

```json
"expressions": [
  { "id": "smile", "label": { "zh": "笑", "zh-Hant": "笑", "en": "Smile", "ja": "笑顔" }, "hotkey": "1" },
  { "id": "shy", "label": { "zh": "害羞", "zh-Hant": "害羞", "en": "Shy", "ja": "照れ" }, "hotkey": "2" },
  { "id": "x_5f2a91", "label": { "zh": "猫猫眼" } }
]
```

- `id` matches `^[a-z][a-z0-9_]{0,31}$`. **An id from the standard list (Appendix A) means the same on every model**,
  so an app can map emotions, hotkeys or a chat's `[shy]` to it. Writers MUST start any other id with `x_`: it is the
  model's own, and an app can show it but not understand it. Readers MUST NOT refuse an id they do not know (the list
  grows, §9).
- `smile` is also the player's `smile` parameter (a camera or a voice can drive it).
- `label` is the name by language: keys are BCP 47 tags (`zh`, `zh-Hant`, `en`, `ja` …), `und` for an unknown
  language. A reader picks the UI language's tag, then its script (`zh-TW` → `zh-Hant`), its language, then `en`, `zh`,
  any, and finally the id. LivLiv writes the four languages for standard ids and only the owner's own words for the
  rest.
- `hotkey`: `1`–`9`, a suggestion; apps may assign their own.
- An expression's layers point to it with `expression`; `blush`, `show`, `hide` and a chain's `bias` are keyed by
  expression ids. LivLiv names them `expr_<id>` and `expr_<id>_brows`, the smile's `expr_smile`.

## 7. `layers`

The array order is the drawing order. Each layer:

| field | |
|---|---|
| `id` | required, `^[A-Za-z][A-Za-z0-9_]{0,63}$`, unique. The reference player compares only three ids literally: `brows`, `glasses`, `face`; everything else goes by `role` |
| `label` | optional names by language, as for expressions (for editors) |
| `texture` | required: `textures/<name>.webp` or `.png`. **The extension is the file's real type** |
| `frames`, `visemes` | the mouth's frames and which mouth shape each one is (`closed half open round wide shut`); `visemes` is required with `frames` |
| `mask` | a mask (the eye whites); MUST be lossless |
| `talk` | an expression as drawn while the character talks (without its own mouth) |
| `brow_tex` | the brows an expression drew, drawn over the bangs |
| `x`, `y`, `w`, `h` | required: the layer's box on the canvas (integers). **Every image of a layer is `w` × `h` pixels**, straight (not premultiplied) alpha. The box lies inside the canvas |
| `group` | required: what it moves with: `head`, `body`, `hair_back`, `hair_side`, `hair_front`, `hair_inner`. A reader refuses a group it does not know |
| `depth` | parallax on a head turn (default 0): front hair positive, back hair negative |
| `role` | what the player does with it (Appendix B). A role a reader does not know is drawn as a plain layer |
| `expression` | required for roles `expr` and `expr_brows`: the expression the layer belongs to |
| `pivot`, `clip`, `range` | a pivot point; the layer that clips this one (an iris by its eye's whites); how far an iris moves (px, horizontal and vertical) |
| `brows` | `"redrawn"`: this expression drew its own brows, so the neutral `brows` layer fades out with it |
| `bones`, `rigid` | the `rig.chains` that bend this layer; the point the whole layer hangs from |
| `blush`, `show`, `hide` | opacity weighted by expressions |
| `fall`, `fall_end` | where front / side hair's parallax starts and stops fading (shares of the head ellipse) |

`L` and `R` in ids and roles are the **image's** left and right, not the character's.

## 8. Validity beyond the schema

Writers MUST produce, and readers MAY refuse anything else:

1. Layer ids and expression ids are unique, and so are hotkeys.
2. `clip` names a layer; each of `bones` names a chain in `rig.chains`.
3. Every `expression`, and every key of `blush`, `show`, `hide` and a chain's `bias`, is an id in `expressions`.
4. `frames` and `visemes` have the same length; a `mouth` has at least three frames (closed, half, open).
5. Every image and every file in `files` is in the package; every image is the size of its layer's box.
6. Every layer's box lies inside the canvas.
7. Every entry of `requires` is a feature the reader has.
8. Writers start ids outside the standard list with `x_`.
9. A model with `anchors.body` lists `full_body` in `requires` and has `anchors.frame` (§5).

What readers do:

1. Read `format: "livliv-model"` up to the newest `version` they know; refuse a newer one, saying so ("update the
   player"). `format: "livemaker-puppet"` (or no `format`) is the previous format, [read as it is](FORMAT-v3.md).
2. Refuse a model whose `requires` names a feature they do not have, naming it. Ignore fields they do not know.
3. Use defaults for missing optional fields; draw an unknown `role` as a plain layer; refuse an unknown `group`.
4. Refuse a model whose layer image is missing; warn and play on when an optional file is missing.
5. Hold packages to limits before decoding. The reference player's: `model.json` 4 MB; canvas 8192 px a side; 512
   layers; 2048 ZIP entries and 256 MB uncompressed; `keyforms.json` 32 MB; no entry with `..`, an absolute path or
   encryption; and what the meshes would cost, from the boxes alone: 2 097 152 vertices on a lattice of `rig.lattice`
   px, or `max(6, round(max(width, height) / 128))` without it, 1 048 576 of them times the chains bending them, a chain
   named once per layer.
6. Treat everything in the package as data: there is nothing to run and no URL to fetch, and every string (names,
   labels, credits) is shown as plain text.
7. Draw the watermark the package asks for (§3).

## 9. Versions and additions

- `version` is the major version. It goes up only when a field's meaning changes, a field is removed or the structure
  changes; a reader MAY refuse a major version it does not know.
- An optional field, an optional file, a new `role` that an older reader may draw as a plain layer, or a new standard
  expression id: no version change. The schema is updated (one schema per major version, always its newest 4.x) and
  the change is listed below.
- Something an older reader would draw wrong without noticing: a feature name goes into `requires`
  (`^[a-z][a-z0-9_.-]{0,47}$`, registered in this document). A reader that has it plays the model; one that does not
  refuses it and says which feature it lacks. The version stays. Writers list a feature only when the model uses it.
- Third parties put their own data in `x-*` fields, never in `requires`.
- Validating a newer file against an older schema may report fields it does not know: that is not an error.

Changes:

- **4.0** (November 2026): first version of this format (from v3: renamed, `meta`, `files`, `requires`, standard
  expression ids with names by language, real image paths, build-internal data and Cubism-style `params` left out).
- **4.1** (November 2026): full-body characters: `anchors.frame`, `anchors.body`, `anchors.hair_bottom_y`, the feature
  `full_body` (§5); `rig.lattice` (Appendix C). LivLiv Player reads them from 0.5; 0.4 and earlier refuse a model that
  lists the feature.

## Appendix A: standard expression ids (4.0)

| id | en | zh | zh-Hant | ja |
|---|---|---|---|---|
| `smile` | Smile | 笑 | 笑 | 笑顔 |
| `shy` | Shy | 害羞 | 害羞 | 照れ |
| `angry` | Angry | 生气 | 生氣 | 怒り |
| `sad` | Sad | 难过 | 難過 | 悲しい |
| `surprised` | Surprised | 惊讶 | 驚訝 | 驚き |
| `puffed` | Puffed cheeks | 鼓脸 | 鼓臉 | ふくれっ面 |
| `tongue_out` | Tongue out | 吐舌 | 吐舌 | 舌を出す |
| `laugh` | Laughing | 大笑 | 大笑 | 大笑い |
| `smirk` | Smirk | 坏笑 | 壞笑 | にやり |
| `starry_eyes` | Starry eyes | 星星眼 | 星星眼 | きらきら目 |
| `raised_brow` | Raised brow | 挑眉 | 挑眉 | 眉上げ |

## Appendix B: layer roles

| role | the layer | uses |
|---|---|---|
| `eye_L`, `eye_R` | an open eye with blank whites; it squashes onto the lid line as the eye closes | `mask` (the whites), `pivot` |
| `lid_L`, `lid_R` | the closed eye (the lash line), under the open one | |
| `iris_L`, `iris_R` | an iris, moving inside the whites | `clip` (its `eye_*`), `range`, `pivot` |
| `shine_L`, `shine_R` | a highlight over the iris | `range` |
| `mouth` | the mouth | `frames` + `visemes` (closed, half, open at least), `pivot` |
| `expr` | an expression patch | `expression`; `talk`, `brow_tex`, `brows` |
| `expr_brows` | an expression's brow zone, drawn over the bangs | `expression` |
| `blush` | a blush | `blush` |
| `neck_shadow` | the jaw's shadow on the neck, over the body | |
| `hole`, `edge`, `edge_wide` | masks a player asks for (never drawn by themselves) | |
| none | a plain layer moving with its `group` | |

## Appendix C: `rig`

| field | |
|---|---|
| `yaw`, `pitch`, `roll` | how far the head turns, nods and tilts |
| `bulge`, `bulge_shape`, `bulge_extent` | the head's rounded volume: how much, its profile, how far it reaches (whether the hair round the skull turns with the face) |
| `drift` | how far the whole head drifts toward a turn / a nod, in head radii |
| `hair.front`, `hair.back`, `hair.side` | the bangs', long hair's and side hair's spring chains `[k1, c1, gain, k2, c2]` |
| `hair_limit`, `hair_drive` | how far hair may swing; how much the head's own acceleration throws each chain |
| `wind`, `breath`, `sway`, `brow` | idle wind, breathing, sway and brow motion |
| `pitch_ease` | how much a nod eases off toward its ends |
| `body` | `yaw`, `roll`: how much the torso follows the head; `breath`; `bust`: the chest spring, which LivLiv writes as 0 and players read as 0 whatever it says (LivLiv Player from 0.4) |
| `neck` | `twist`, `reach`: the neck twisting with the head |
| `jaw` | the jaw drop for a model whose frames measured none |
| `lattice` | the mesh lattice's cell in px, a whole number from 6 to 256 (4.1). Missing: `max(6, round(max(width, height) / 128))`. A full-body character keeps its head-and-chest density on its tall canvas with it: LivLiv writes 12 for 1536 × 3072, where the formula gives 24 |
| `chains` | pieces that swing on their own: a rope of `points` (root first) with `k`, `damp`, `drive`, `hang`, `wind`, `freq`, `limit`, `sigma`, `reach`, `bias` |

The schema gives the reference player's default for each.

## Appendix D: the player's parameters

The parameters are the player's API, not part of the package. For people coming from Cubism, the rough counterparts
(informative only: this format is not Cubism's and reads no Cubism file):

| player | range | Cubism-style |
|---|---|---|
| `angleX`, `angleY`, `angleZ` | −30..30 | ParamAngleX/Y/Z |
| `eyeLOpen`, `eyeROpen` | 0..1 | ParamEyeLOpen / ParamEyeROpen (here L is the image's left) |
| `eyeBallX`, `eyeBallY` | −1..1 | ParamEyeBallX/Y |
| `browLY`, `browRY` | −1..1 | ParamBrowLY / ParamBrowRY |
| `mouthOpen` | 0..1 | ParamMouthOpenY |
| `vowel` | −1..1 | (round o/u at −1, wide i/e at +1) |
| `smile` | 0..1 | ParamSmile |
| `bodyX`, `bodyZ` | −10..10 | ParamBodyAngleX / ParamBodyAngleZ |
| `breath` | 0..1 | ParamBreath |

"Live2D" is a trademark of Live2D Inc.; LivLiv is not affiliated with it.
