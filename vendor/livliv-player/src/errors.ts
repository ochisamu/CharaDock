// What a load rejects with, in a file of its own: a PNGTuber or a VRM page has it without the renderer.

/** what went wrong, to tell apart in code (the message is for people, and can change):
 *  - no-webgl: this browser or canvas gives no WebGL2 (new Player(), a VRM)
 *  - canvas-in-use: the canvas already draws in a way this character cannot (a PNGTuber on a WebGL canvas)
 *  - unreachable: the file did not come: no connection, the connection dropped, or another origin without a CORS header
 *  - http: the server said no (`status`)
 *  - not-a-model: this is not a model at all, or not one for this player (a VRM handed to a Player)
 *  - invalid: a model, but something in it is wrong or damaged
 *  - too-large: over this player's limits, or the GPU's memory
 *  - newer-format: written for a newer player
 *  - missing-feature: needs something this page or player does not have (a full-body character, until a later version)
 *  - missing-file: a file it names is not among the files
 *  - context-lost: the canvas's WebGL context is gone (see `onContextLost`)
 *  - released: the canvas's context was given up by `dispose({ release: true })`: use a new canvas */
export type LivLivErrorCode = 'no-webgl' | 'canvas-in-use' | 'unreachable' | 'http' | 'not-a-model' | 'invalid' | 'too-large'
  | 'newer-format' | 'missing-feature' | 'missing-file' | 'context-lost' | 'released'

export class LivLivError extends Error {
  readonly code: LivLivErrorCode
  /** with code 'http': the HTTP status */
  readonly status?: number
  constructor(code: LivLivErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'LivLivError'
    this.code = code
    if (options.status !== undefined) this.status = options.status
  }
}
