// @livliv-dev/player/voice: lip sync. The mouth follows a voice (loudness, and the vowel's shape where the model has round /
// wide mouths), and without face tracking the voice also moves the head, brows and eyes a little, the way people move
// while they talk. Two ways in:
//  - startLipSync: live audio (the microphone, a call's MediaStream, or an <audio> / <video> element the page plays)
//  - createSpeech: speech clips (TTS) the player plays itself, back to back; the mouth follows each one exactly, from
//    its loudness worked out when it is decoded and read at the moment the sound leaves the speakers
import { VoiceMeter } from './runtime/voice'
import { SpeechPlayer, type ClipHooks } from './runtime/speech'
import { TalkMotion } from './runtime/talk'
import type { Driver, Host } from './base'

export type { ClipHooks }

export interface LipSyncOptions {
  /** how much the voice also moves the head, brows and eyes: 0 (off) .. 2, default 1. Not while a face is tracked */
  motion?: number
  /** hop a little on syllables, like a PNGTuber (default false) */
  bounce?: boolean
}

export interface LipSync {
  /** the mouth openness the voice gives now, 0..1 */
  readonly level: number
  /** mouth sensitivity (default 1) */
  gain: number
  /** stops listening (a stream or element you passed in stays yours, and keeps playing) */
  stop(): void
}

export interface Speech {
  /** queues a clip (a URL, audio bytes, or a fetch Response, which starts playing before it has all come); it plays
   *  right after the ones before it. hooks: told when it starts being heard, then once when it ends or fails */
  say(clip: string | Blob | ArrayBuffer | Response, hooks?: ClipHooks): void
  /** playback volume, 0..1 (default 1); 0 still plays on time, so lip sync and hooks go on */
  volume: number
  /** the mouth openness the voice gives now, 0..1 (a level meter) */
  readonly level: number
  /** the vowel's shape now: -1 round (o, u) .. 1 wide (i, e), 0 neither */
  readonly vowel: number
  /** the voice as it plays, after the volume, for a call or a recording: null before unlock(), then the same stream
   *  until dispose(), which ends its tracks. Only this speech's voice */
  readonly stream: MediaStream | null
  /** silence now: what plays stops, what is still loading is dropped */
  stop(): void
  /** call inside a user gesture (a click, a key press) before the first say(), or browsers keep the sound blocked */
  unlock(): void
  /** something is playing or still loading */
  readonly busy: boolean
  /** called when the last clip has played */
  onIdle?: () => void
  /** stops, and removes the lip sync from the player */
  dispose(): void
}

function mouth(read: () => number, vowel: () => number, o: LipSyncOptions): Driver {
  const talk = new TalkMotion()
  return {
    order: 10,
    update(f, player) {
      const level = read(), P = f.params
      P.mouthOpen = Math.max(P.mouthOpen, level)
      P.vowel = vowel()
      const amount = o.motion ?? 1
      if (!f.tracked && amount > 0) {
        talk.amount = amount; talk.bounce = !!o.bounce; talk.grounded = f.grounded
        f.add(talk.update(level, f.dt, P))
        if (talk.pauseBlink) player.blink()
        f.talk += talk.hop
      } else if (talk.act || talk.hop) talk.reset()
    },
  }
}

/** Lip sync to live audio: the microphone (no source; asks for permission), a MediaStream, or an <audio> / <video>
 *  element. An element is routed through Web Audio for good once passed here (browsers allow it once per element): it
 *  keeps playing through the speakers after stop() */
export async function startLipSync(player: Host, source?: MediaStream | HTMLMediaElement, options: LipSyncOptions = {}): Promise<LipSync> {
  const m = new VoiceMeter()
  await m.start(source)
  const remove = player.use({ ...mouth(() => m.read(), () => m.vowel, options), dispose: () => m.stop() })
  return {
    get level() { return m.level },
    get gain() { return m.gain },
    set gain(g: number) { m.gain = g },
    stop: remove,
  }
}

/** Speech clips with lip sync (TTS replies): say() queues each one */
export function createSpeech(player: Host, options: LipSyncOptions = {}): Speech {
  const s = new SpeechPlayer()
  let volume = 1
  const remove = player.use({ ...mouth(() => s.read(), () => s.vowel(), options), dispose: () => s.dispose() })
  const speech: Speech = {
    say(clip, hooks) {
      if (clip instanceof Response) { s.enqueue(clip, hooks); return }
      if (typeof clip === 'string') { s.enqueue(new URL(clip, document.baseURI).href, hooks); return }
      const u = URL.createObjectURL(clip instanceof Blob ? clip : new Blob([clip]))
      const revoke = () => URL.revokeObjectURL(u)
      s.enqueue(u, { onStart: hooks?.onStart, onEnd: () => { revoke(); hooks?.onEnd?.() }, onFail: () => { revoke(); hooks?.onFail?.() } })
    },
    get volume() { return volume },
    set volume(v: number) { if (Number.isFinite(v)) { volume = Math.max(0, Math.min(1, v)); s.setVolume(volume) } },
    get level() { return s.read() },
    get vowel() { return s.vowel() },
    get stream() { return s.stream },
    stop: () => s.stop(),
    unlock: () => s.unlock(),
    get busy() { return s.busy },
    dispose: remove,
  }
  s.onIdle = () => speech.onIdle?.()
  return speech
}
