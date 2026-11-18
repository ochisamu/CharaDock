// The mark a model package carries (v4: meta.watermark; before it model.json `watermark`), drawn into the player's own
// canvas after each frame: kind "livliv" is the free plan's watermark (livliv.ai's <Watermark>: a light logo over the
// character plus one in the corner), "text" the owner's own corner mark (livliv.ai's live window), "none" nothing. In the canvas rather than an element
// over it, so a snapshot or a recording of the canvas carries it too, and the page around it needs no changes.
import { BRAND_MARK, drawCornerLogo, drawMarkText, drawWatermark, eyeOpen } from './runtime/brand'

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv=vec2(aPos.x*.5+.5,.5-aPos.y*.5); gl_Position=vec4(aPos,0.,1.); }`
const FS = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){ o=texture(uTex,vUv); }`

export class Mark {
  /** the logo (the free plan's watermark), or `text` in the corner (the owner's own), or nothing */
  private logo = false
  private text: string | null = null
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private tex: WebGLTexture
  private c = document.createElement('canvas')
  /** what the texture holds now: size, text and (the logo's first i is an eye that blinks) how open the eye is */
  private drawn = ''

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
      return s
    }
    const p = this.prog = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /** what to draw: a package's meta.watermark kind ("livliv": the logo; "text": `text`; "none"). center: the logo also
   *  light over the character (the free plan's); false, in the corner only (meta.watermark.center: the featured
   *  characters) */
  set(kind: 'livliv' | 'text' | 'none', text: string | null, center = true) {
    this.logo = kind === 'livliv'
    this.text = kind === 'text' ? text : null
    this.center = center
  }
  private center = true

  /** over the frame just rendered; `dpr`: drawing-buffer pixels per CSS pixel, so the mark is as big as on livliv.ai */
  draw(now: number, dpr: number) {
    const text = this.logo ? BRAND_MARK : this.text, gl = this.gl
    if (!text) return
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    // the texture is redrawn on a resize and while the logo's eye blinks (~0.4 s of every 5.5)
    const key = `${w}x${h}:${dpr}:${this.logo ? Math.round(eyeOpen(now) * 10) : ''}:${this.logo}:${this.center}:${text}`
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    if (key !== this.drawn) {
      this.drawn = key
      const c = this.c
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      const g = c.getContext('2d')!
      g.clearRect(0, 0, w, h)
      g.save()
      if (this.logo && this.center) drawWatermark(g, w, h, now, dpr)
      else if (this.logo) drawCornerLogo(g, w, h, now, dpr)
      else drawMarkText(g, w, h, text, dpr)  // the owner's own mark, sized and placed as in the live window
      g.restore()
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    }
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.prog)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  dispose() {
    const gl = this.gl
    gl.deleteTexture(this.tex); gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog)
  }
}
