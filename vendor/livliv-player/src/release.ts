// A canvas whose WebGL context a player gave up (dispose({ release: true })): the browser's room for contexts back, and the
// canvas spent: a lost context does not come back by itself, and a new renderer on it fails in ways that say nothing.
import { LivLivError } from './errors'

const spent = new WeakSet<HTMLCanvasElement>()
const going = new WeakMap<HTMLCanvasElement, () => void>()

/** gives up the canvas's context, one task from now: losing and restoring within one task does nothing in Chromium and
 *  WebKit, and that is just what a framework's unmount and mount of the same canvas is (React's StrictMode). A player made
 *  on the canvas before then keeps it (see claimCanvas). A canvas without a WebGL context has nothing to give up */
export function releaseCanvas(canvas: HTMLCanvasElement, gl: WebGLRenderingContext | WebGL2RenderingContext | null) {
  if (!gl || spent.has(canvas) || going.has(canvas)) return
  const timer = setTimeout(() => {
    going.delete(canvas)
    spent.add(canvas)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  })
  going.set(canvas, () => clearTimeout(timer))
}

/** a new player on this canvas: a release still to come is off; one that has happened cannot be undone */
export function claimCanvas(canvas: HTMLCanvasElement) {
  going.get(canvas)?.()
  going.delete(canvas)
  if (spent.has(canvas)) throw new LivLivError('released', 'LivLiv: this canvas gave up its WebGL context with dispose({ release: true }): use a new canvas')
}
