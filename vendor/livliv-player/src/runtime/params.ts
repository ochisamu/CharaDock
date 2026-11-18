// The pose and face a character takes, on their own: what the drivers, the idle motion and the bodies that are not a
// puppet (a PNGTuber, a VRM) work with, so that none of them has to load the renderer for these. puppet.ts exports them too.

export type Params = {
  angleX: number; angleY: number; angleZ: number
  eyeLOpen: number; eyeROpen: number; eyeBallX: number; eyeBallY: number
  browLY: number; browRY: number
  mouthOpen: number; smile: number
  /** the voice's vowel (vowel.ts): -1 round (o, u) .. +1 wide (i, e), 0 neither */
  vowel: number
  bodyX: number; bodyZ: number; breath: number
}
export const defaultParams = (): Params => ({
  angleX: 0, angleY: 0, angleZ: 0, eyeLOpen: 1, eyeROpen: 1, eyeBallX: 0, eyeBallY: 0,
  browLY: 0, browRY: 0, mouthOpen: 0, smile: 0, vowel: 0, bodyX: 0, bodyZ: 0, breath: 0,
})
export const PARAM_RANGES: Record<keyof Params, [number, number]> = {
  angleX: [-30, 30], angleY: [-30, 30], angleZ: [-30, 30], eyeLOpen: [0, 1], eyeROpen: [0, 1],
  eyeBallX: [-1, 1], eyeBallY: [-1, 1], browLY: [-1, 1], browRY: [-1, 1],
  mouthOpen: [0, 1], smile: [0, 1], vowel: [-1, 1], bodyX: [-10, 10], bodyZ: [-10, 10], breath: [0, 1],
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
