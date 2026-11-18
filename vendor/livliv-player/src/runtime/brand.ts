// The LivLiv mark, shared by <Logo> and the watermark burned into recordings. Paths in the viewBox
// 27 44 430 133: rounded letters, a blinking eye over the first i, a wink over the second, blush either side.
export const BRAND_MARK = 'LivLiv'   // the free plan's corner mark; any other mark is the owner's own text
export const CORAL = '#ff4d5e'
export const LOGO_BOX = [27, 44, 430, 133] as const
export const LETTERS = 'M101.5 62.5V141.5Q101.5 158.5 115.5 158.5M145 107.5V158.5M176.3 107.5L200.5 158.5L224.7 107.5M257.5 62.5V141.5Q257.5 158.5 271.5 158.5M303 107.5V158.5M335.3 107.5L359.5 158.5L383.7 107.5'
export const BLUSH = 'M40.5 122L49.5 142.1M60.5 122L69.5 142.1M421.5 122L412.5 142.1M441.5 122L432.5 142.1'
export const EYE = { cx: 145, cy: 67, r: 13.5 }
export const WINK = 'M293.5 69H312.5A8 8 0 0 1 312.5 85H293.5A8 8 0 0 1 293.5 69Z'

/** Free-plan watermark, sized by the frame's shorter side so a portrait and a landscape frame carry the same mark: a
 *  light logo over the character (`center` of the shorter side wide, its middle at `centerY` of the height, above where
 *  subtitles reach; all white: its coral dots would read as marks on a face in a close-up; white at `centerAlpha` inside a
 *  thin dark line, `centerEdge` wide in the logo's own units at `centerRim`, so it shows on light clothes and dark alike) plus the solid coloured one in a corner (`corner` wide, at least
 *  `cornerMin` CSS px, `margin` from both edges, at least 12 CSS px). The owner's own text mark takes the same corner,
 *  `text` of the shorter side tall (at least 12 CSS px). <Watermark> on livliv.ai and drawWatermark() in recordings and
 *  the SDK draw it from these numbers. Before the thin line: center 0.38, alpha 0.18, a soft shadow: gone on light
 *  clothes. Until 2026-10-21: center 0.62 at 0.6, alpha 0.38, coral dots. Until 2026-10-31:
 *  center 0.45 at 0.7, alpha 0.2; the corner logo 5 % of the frame's height (29 % of a portrait video's width, 9 % of a
 *  landscape one's), 0.45 of its own height from the edges; the text 2.2 % of the height in videos, 13 px elsewhere. */
export const WATERMARK = {
  center: 0.3, centerY: 0.62, centerAlpha: 0.3, centerRim: 0.2, centerEdge: 3.2,
  corner: 0.13, cornerMin: 64, margin: 0.035, text: 0.026,
  top: 0.12,  // a portrait video's corner mark starts this far down (cornerSpot)
}

/** How open the eye is at time `ms` (1 = open), on the same 5.5 s cycle as the CSS blink in <Logo>. */
export function eyeOpen(ms: number) {
  const f = (ms % 5500) / 5500
  if (f < 0.93) return 1
  return f < 0.955 ? 1 - (f - 0.93) / 0.025 * 0.88 : 0.12 + (f - 0.955) / 0.045 * 0.88
}

/** Draws the mark with its bottom-right corner at (right, bottom), `height` px tall; `accent`: its eyes and blush;
 *  `edge`: an outline that wide (in the logo's own units, its letters are 25) in `edgeColor` around all of it. */
export function drawLogo(g: CanvasRenderingContext2D, right: number, bottom: number, height: number, color: string, ms = 0, accent = CORAL,
  edge = 0, edgeColor = '#222') {
  const [x0, y0, w, h] = LOGO_BOX
  const k = height / h
  g.save()
  g.translate(right - w * k, bottom - height)
  g.scale(k, k)
  g.translate(-x0, -y0)
  g.lineCap = 'round'; g.lineJoin = 'round'
  if (edge) {
    g.strokeStyle = edgeColor
    g.lineWidth = 25 + edge * 2; g.stroke(new Path2D(LETTERS))
    g.lineWidth = 12.5 + edge * 2; g.stroke(new Path2D(BLUSH))
    g.lineWidth = edge * 2
    g.beginPath(); g.ellipse(EYE.cx, EYE.cy, EYE.r, EYE.r * eyeOpen(ms), 0, 0, Math.PI * 2); g.stroke()
    g.stroke(new Path2D(WINK))
  }
  g.strokeStyle = color; g.lineWidth = 25; g.stroke(new Path2D(LETTERS))
  g.strokeStyle = accent; g.lineWidth = 12.5; g.stroke(new Path2D(BLUSH))
  g.fillStyle = accent
  g.beginPath(); g.ellipse(EYE.cx, EYE.cy, EYE.r, EYE.r * eyeOpen(ms), 0, 0, Math.PI * 2); g.fill()
  g.fill(new Path2D(WINK))
  g.restore()
}

/** Where the corner mark goes in a w × h frame (see WATERMARK): its right edge, and its bottom edge, or with `top` its top
 *  edge: a portrait video's mark sits top right, `WATERMARK.top` of the height down, since Douyin and TikTok cover the
 *  bottom quarter (caption, name), the right edge from about the middle down (their buttons) and the top tenth (their
 *  tabs); elsewhere (a captioned sticker) `top` is the margin from the top edge. `px`: frame pixels per CSS pixel (the
 *  smallest sizes; the SDK draws on a high-DPI canvas). `logo`: the corner logo's height; `text`: the text's size. */
export function cornerSpot(w: number, h: number, top = false, px = 1) {
  const { corner, cornerMin, margin, text } = WATERMARK
  const s = Math.min(w, h), m = Math.max(12 * px, s * margin)
  return { right: w - m, y: top ? (h > w ? h * WATERMARK.top : m) : h - m, top,
    logo: Math.max(cornerMin * px, s * corner) * LOGO_BOX[3] / LOGO_BOX[2], text: Math.max(12 * px, s * text) }
}

/** The solid logo in the corner alone: the free plan's screenshots and stickers, and part of drawWatermark. `outline`:
 *  a dark edge instead of the soft shadow, for pictures with one-bit alpha (GIF stickers) */
export function drawCornerLogo(g: CanvasRenderingContext2D, w: number, h: number, ms = 0, px = 1, top = false, outline = false) {
  const c = cornerSpot(w, h, top, px)
  g.save()
  if (!outline) { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = c.logo * 0.12 }
  drawLogo(g, c.right, c.top ? c.y + c.logo : c.y, c.logo, outline ? '#fff' : 'rgba(255,255,255,.95)', ms, CORAL, outline ? 9 : 0)
  g.restore()
}

/** The owner's own text mark (a paid plan's) in the corner mark's place. */
export function drawMarkText(g: CanvasRenderingContext2D, w: number, h: number, text: string, px = 1, top = false) {
  const c = cornerSpot(w, h, top, px)
  g.save()
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = c.text * 0.25
  g.font = `600 ${c.text}px system-ui, sans-serif`; g.textAlign = 'right'; g.textBaseline = c.top ? 'top' : 'bottom'
  g.fillStyle = 'rgba(255,255,255,.85)'
  g.fillText(text, c.right, c.y)
  g.restore()
}

const SPRITE_PAD = 4  // room for the dark line around the logo
const sprites = new Map<string, OffscreenCanvas | HTMLCanvasElement>()

function sprite(w: number, h: number) {
  return typeof OffscreenCanvas === 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : new OffscreenCanvas(w, h)
}

/** The logo over the character, cw × ch px, on a transparent picture: white at centerAlpha inside a thin dark line (the
 *  line drawn apart so that it shows only outside the letters). Kept per size and eye: recordings draw it every frame. */
function centerLogo(cw: number, ch: number, ms: number) {
  const eye = Math.round(eyeOpen(ms) * 10), key = `${ch.toFixed(2)}:${eye}`
  let out = sprites.get(key)
  if (out) return out
  const { centerAlpha, centerRim, centerEdge } = WATERMARK
  const w = Math.ceil(cw) + SPRITE_PAD * 2, h = Math.ceil(ch) + SPRITE_PAD * 2, right = cw + SPRITE_PAD, bottom = ch + SPRITE_PAD
  const ring = sprite(w, h), r = ring.getContext('2d') as CanvasRenderingContext2D
  drawLogo(r, right, bottom, ch, '#000', ms, '#000', centerEdge, '#000')
  r.globalCompositeOperation = 'destination-out'
  drawLogo(r, right, bottom, ch, '#000', ms, '#000')
  out = sprite(w, h)
  const g = out.getContext('2d') as CanvasRenderingContext2D
  g.globalAlpha = centerRim
  g.drawImage(ring, 0, 0)
  g.globalAlpha = centerAlpha
  drawLogo(g, right, bottom, ch, '#fff', ms, '#fff')
  if (sprites.size > 64) sprites.clear()
  sprites.set(key, out)
  return out
}

/** Draws the free-plan watermark (see WATERMARK) onto a w × h frame; the canvas twin of <Watermark>. `px` and `top`:
 *  as cornerSpot */
export function drawWatermark(g: CanvasRenderingContext2D, w: number, h: number, ms = 0, px = 1, top = false) {
  const { center, centerY } = WATERMARK
  const cw = Math.min(w, h) * center, ch = cw * LOGO_BOX[3] / LOGO_BOX[2]
  g.drawImage(centerLogo(cw, ch, ms), (w - cw) / 2 - SPRITE_PAD, h * centerY - ch / 2 - SPRITE_PAD)
  drawCornerLogo(g, w, h, ms, px, top)
}
