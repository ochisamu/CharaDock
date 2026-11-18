// SPDX-License-Identifier: Apache-2.0
const { PLAYBACK_CHUNK_BYTES, Rlcd42SerialGateway } = require("./rlcd42-serial.cjs");
const { FRAME_TYPES, crc32 } = require("./device-protocol-v2.cjs");
const { STACKCHAN_GESTURES } = require("./stackchan-gestures.cjs");
const { handleCaptureFrame } = require("./device-capture-queue.cjs");
const STACKCHAN_BOARD = "m5stack-stackchan-k151";
const PLAYBACK_CHUNK_WINDOW = 6;
const COMPLETE_PLAYBACK_WINDOW = 3;
const COMPLETE_PLAYBACK_MAX_ADPCM_PCM_BYTES = 12_288;
const COMPLETE_PLAYBACK_ACK_TIMEOUT_MS = 2200;
const STACKCHAN_LIVE_PLAYBACK_OPTIONS = Object.freeze({
  filterRealtimeOutput: true,
  preserveVoiceMotionOnReset: true,
  chunkBytes: 2048,
  chunkWindow: PLAYBACK_CHUNK_WINDOW,
  maxPendingBytes: 16_000 * 2 * 12,
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// IMA Recommended Practices, sections 6.1 and 6.2.
const IMA_STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598,
  658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500,
  20350, 22385, 24623, 27086, 29794, 32767,
];
const IMA_INDEX_CHANGES = [-1, -1, -1, -1, 2, 4, 6, 8];

function encodeImaAdpcm(pcm, state) {
  const samples = pcm.length / 2;
  const packet = Buffer.alloc(5 + Math.floor(samples / 2));
  let predictor = pcm.readInt16LE(0);
  let index = state.index;
  packet.writeUInt16LE(samples, 0);
  packet.writeInt16LE(predictor, 2);
  packet[4] = index;
  for (let i = 1; i < samples; i += 1) {
    const step = IMA_STEPS[index];
    const difference = pcm.readInt16LE(i * 2) - predictor;
    let magnitude = Math.abs(difference);
    let code = difference < 0 ? 8 : 0;
    let delta = step >> 3;
    for (let bit = 4, weight = step; bit > 0; bit >>= 1, weight >>= 1) {
      if (magnitude >= weight && weight > 0) {
        code |= bit;
        delta += weight;
        magnitude -= weight;
      }
    }
    predictor = Math.max(-32768, Math.min(32767, predictor + (code & 8 ? -delta : delta)));
    index = Math.max(0, Math.min(88, index + IMA_INDEX_CHANGES[code & 7]));
    const offset = i - 1;
    packet[5 + (offset >> 1)] |= code << ((offset & 1) * 4);
  }
  state.index = index;
  return packet;
}


// Shared framing/authentication/capture queues; hardware-specific display and
// bounded streaming audio. Never send RLCD 1-bit assets to this board.
class StackchanSerialGateway extends Rlcd42SerialGateway {
  constructor(options = {}) { super({ ...options, expectedBoard: STACKCHAN_BOARD }); }

  async releaseUsbToWifi() {
    if (this.transport !== "usb" || this.capabilities?.capabilities?.transport?.usbRelease !== true) return;
    this.stopHeartbeat();
    await this.writeWithAck(0x6A, Buffer.alloc(0), { timeoutMs: 700 });
  }

  completeAudioRetry(generation) {
    if (!(this.capabilities?.capabilities?.audio?.stagedPlaybackSamples > 0)) return undefined;
    return {
      retryTimeouts: this.transport === "usb" ? [220, 480, 1_100, 1_800]
        : [650, 1_200, COMPLETE_PLAYBACK_ACK_TIMEOUT_MS],
      shouldRetry: () => generation === this.playbackGeneration,
    };
  }

  handleFrame(frame) {
    if (frame.type !== FRAME_TYPES.AUDIO_PLAYBACK_STARTED) return super.handleFrame(frame);
    const playback = this.activePlayback;
    if (!playback || playback.sequence !== frame.sequence || playback.firstSoundAt) return;
    playback.firstSoundAt = Date.now();
    playback.confirmSpeakerStart?.();
    this.log("info", "stackchan-audio-first-sample", {
      mode: playback.totalSamples === 0xffffffff ? "live" : "tts",
      staged: Boolean(playback.staged),
      beginToSpeakerMs: playback.firstSoundAt - playback.startedAt,
      ...(playback.transferMs !== undefined ? { transferMs: playback.transferMs } : {}),
    });
  }

  async setMotionEnabled(enabled) {
    await this.writeWithAck(FRAME_TYPES.MOTION, Buffer.from([enabled === true ? 1 : 0]));
    const motion = this.capabilities?.capabilities?.motion;
    if (motion) motion.enabled = enabled === true;
  }

  supportsVoiceMotion(id) {
    const motion = this.capabilities?.capabilities?.motion;
    if (motion?.voiceCommands !== true || !Number.isInteger(id) || id < 8 || id > 255) return false;
    return id <= 12 || (Number.isInteger(motion.voiceMotionMaxCommand) && id <= motion.voiceMotionMaxCommand);
  }

  async sendVoiceMotion(id) {
    if (!this.supportsVoiceMotion(id) || this.capabilities.capabilities.motion.enabled !== true) return false;
    await this.writeWithAck(0x66, Buffer.from([id]), { timeoutMs: 800 });
    return true;
  }

  async sendConversationGesture(gesture) {
    if (this.capabilities?.capabilities?.motion?.conversationGestures !== true)
      return false;
    if (!Object.values(STACKCHAN_GESTURES).includes(gesture)) return false;
    if (gesture === STACKCHAN_GESTURES.waitingLook && this.capabilities.capabilities.motion.waitingLook !== true) return false;
    await this.writeWithAck(FRAME_TYPES.GESTURE, Buffer.from([gesture]), { timeoutMs: 800 });
    return true;
  }

  async useNativeFace() {
    await this.writeWithAck(FRAME_TYPES.DISPLAY_MODE, Buffer.from([2]));
  }

  async startCameraPreview() {
    if (this.capabilities?.capabilities?.camera?.localPreview !== true)
      throw new Error("StackChan camera preview requires the updated firmware.");
    await this.writeWithAck(0x61, Buffer.alloc(0));
  }

  async setCameraControls(enabled, trackFaces) {
    if (this.capabilities?.capabilities?.camera?.controls !== true) return;
    await this.writeWithAck(0x64, Buffer.from([enabled ? (trackFaces ? 3 : 1) : 0]));
  }

  async setHomePitch(degrees) {
    if (this.capabilities?.capabilities?.motion?.homePitch !== true) return;
    await this.writeWithAck(0x63, Buffer.from([degrees]));
  }

  async finishCurrentCapture() {
    const audio = this.capabilities?.capabilities?.audio;
    if (audio?.captureFinalize !== true) return;
    const session = this.captureSession;
    const controlFrame = audio.captureControlFrame === 0x69 ? 0x69 : 0x34;
    await this.writeWithAck(controlFrame, Buffer.from([1]), controlFrame === 0x69 ? {
      retryTimeouts: [500, 1_200],
      shouldRetry: () => this.captureSession === session && !session?.endReceived,
    } : { timeoutMs: 1_500 }).catch(error => {
      if (!session?.endReceived || error.code !== "DEVICE_RESPONSE_TIMEOUT") throw error;
    });
    // A successful ACK also certifies that the microphone stopped. Close the
    // same input queue if its PTT_END event was lost on the way back.
    if (session && session === this.captureSession && !session.endReceived)
      handleCaptureFrame(this, { type: FRAME_TYPES.PTT_END }, FRAME_TYPES);
  }

  async abortCurrentCapture() {
    const audio = this.capabilities?.capabilities?.audio;
    if (audio?.captureAbort !== true) return;
    await this.writeWithAck(audio.captureControlFrame === 0x69 ? 0x69 : 0x34, Buffer.alloc(0), { timeoutMs: 1_500 });
  }

  async sendConversationExpression(expression, { atPause = false } = {}) {
    const motion = this.capabilities?.capabilities?.motion;
    if (motion?.expressionCues !== true || (atPause && motion.phraseCues !== true)) return;
    await this.writeWithAck(0x62, Buffer.from(atPause ? [expression, 1] : [expression]), { timeoutMs: 800 });
  }

  async sendPortrait(portrait) {
    return this.enqueue(async () => {
      const pixels = Buffer.from(portrait?.pixels || []);
      const revision = Buffer.from(String(portrait?.revision || ""), "ascii");
      if (portrait?.width !== 320 || portrait?.height !== 240 || pixels.length !== 153600
        || !/^[a-f0-9]{64}$/.test(String(portrait.revision || ""))) throw new Error("Invalid StackChan RGB565 asset.");
      const changed = await this.writeWithAck(FRAME_TYPES.CHARACTER_CHANGED, revision);
      if (changed?.applyResult === 2) return { cached: true };
      const name = Buffer.from("portrait");
      const header = Buffer.alloc(15);
      header.writeUInt16LE(320,1); header.writeUInt16LE(240,3);
      header.writeUInt32LE(pixels.length,5); header.writeUInt32LE(crc32(pixels),9);
      header[13] = revision.length; header[14] = name.length;
      await this.writeWithAck(FRAME_TYPES.ASSET_META, Buffer.concat([header,revision,name]));
      for (let offset=0;offset<pixels.length;offset+=4092) {
        const address = Buffer.alloc(4); address.writeUInt32LE(offset);
        await this.writeWithAck(FRAME_TYPES.ASSET_CHUNK, Buffer.concat([address,pixels.subarray(offset,offset+4092)]));
      }
      await this.writeWithAck(FRAME_TYPES.ASSET_END, Buffer.alloc(0));
      await this.writeWithAck(FRAME_TYPES.DISPLAY_MODE, Buffer.from([0]));
      return { cached: false };
    });
  }
  async sendPortraitFrame(portrait) { return this.sendPortrait(portrait); }

  async sendScene(snapshot = {}) {
    return this.enqueue(async () => {
      const state = { working: "thinking", completed: "idle", approval: "thinking", offline: "idle" }[snapshot.state] || snapshot.state;
      await this.setDeviceState(state);
      await this.writeWithAck(0x60, Buffer.from(JSON.stringify({
        caption: String(snapshot.caption || snapshot.activity || "").slice(0, 180),
        name: String(snapshot.characterName || "CharaDock").slice(0, 32),
      }), "utf8"));
      return { nativeFace: true };
    });
  }

  async beginPcm16Playback(sampleRate = 16000, totalSamples = 0xffffffff, { onPlaybackReady, onPlaybackCommitted } = {}) {
    this.requirePlayback();
    if (sampleRate !== 16000 || !Number.isInteger(totalSamples) || totalSamples <= 0 || totalSamples > 0xffffffff) throw new Error("StackChan requires mono PCM16/16000 Hz.");
    const generation = ++this.playbackGeneration;
    const audio = this.capabilities?.capabilities?.audio;
    const modernPlayback = audio?.playbackStatus === true;
    const streaming = totalSamples === 0xffffffff;
    const ringSamples = Number.isInteger(audio?.completePlaybackSamples)
      ? Math.min(Math.max(0, audio.completePlaybackSamples), 262_144)
      : 0;
    const completeBuffer = modernPlayback && !streaming && totalSamples <= ringSamples;
    const begin = Buffer.alloc(completeBuffer ? 15 : 11);
    begin[0] = 1; begin.writeUInt32LE(16000, 1);
    begin[5] = 1; begin[6] = 16;
    begin[7] = modernPlayback ? 112 : 72;
    const largerBuffer = audio?.maxPrebufferMs >= 760;
    const streamingPrebufferMs = this.transport === "usb"
      ? (largerBuffer ? 760 : 500) : (largerBuffer ? 600 : 480);
    const prebufferMs = modernPlayback ? (streaming ? streamingPrebufferMs : 500) : 200;
    begin.writeUInt16LE(prebufferMs, 8);
    const imaAdpcm = this.transport === "wifi" && audio?.imaAdpcm === true &&
      (!completeBuffer || audio.preferPcm16ForBufferedSpeech !== true);
    begin[10] = imaAdpcm ? 7 : 3;
    if (completeBuffer) begin.writeUInt32LE(totalSamples, 11);
    const startedAt = Date.now();
    const display = this.setDeviceState("speaking");
    if (modernPlayback) {
      // The device renders actual speaker activity independently. Losing a
      // display-state ACK must not prevent the audio stream from opening.
      display.catch(error => this.log("warn", "stackchan-playback-display-state-failed", { error: error.message }));
    } else await display;
    if (generation !== this.playbackGeneration) return generation;
    const retry = modernPlayback ? {
      retryTimeouts: [450, 1_100, 2_500],
      shouldRetry: () => generation === this.playbackGeneration,
    } : undefined;
    const ack = await this.writeWithAck(FRAME_TYPES.AUDIO_BEGIN, begin,
      (completeBuffer && this.completeAudioRetry(generation)) || retry);
    if (generation === this.playbackGeneration) {
      this.activePlayback = {
        generation, sampleRate, totalSamples, completeBuffer, onPlaybackReady, onPlaybackCommitted,
        startedAt, sequence: ack?.sequence,
        beginPayload: begin,
        drainSamples: completeBuffer ? totalSamples : ringSamples,
        adpcmState: imaAdpcm ? { index: 0 } : null,
        batchBudgetBytes: 2 * (completeBuffer ? totalSamples : ringSamples),
      };
      if (!completeBuffer) onPlaybackReady?.();
    }
    return generation;
  }

  async writePcm16PlaybackChunk(pcm, generation) {
    const bytes = Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2 || bytes.length > 4096) throw new Error("Invalid StackChan PCM chunk.");
    if (generation !== this.playbackGeneration) return { interrupted: true };
    const playback = this.activePlayback;
    const state = playback?.adpcmState;
    const packet = state ? encodeImaAdpcm(bytes, state) : bytes;
    // In an ordered USB stream the firmware remembers accepted chunk IDs.
    // Retrying the same ID is safe even if only the acknowledgement was lost.
    const retry = this.transport === "usb" && this.capabilities?.capabilities?.audio?.playbackStatus === true
      ? { retryTimeouts: [180, 420, 900, 2000],
        shouldRetry: () => generation === this.playbackGeneration }
      : undefined;
    const deadline = Date.now() + 6000;
    while (generation === this.playbackGeneration) {
      try {
        await this.writeWithAck(FRAME_TYPES.AUDIO_CHUNK, packet, retry);
        return { interrupted: generation !== this.playbackGeneration };
      } catch (error) {
        // StackChan BufferFull is 5 (RLCD uses 4). Only retry an explicit
        // rejection: a lost ACK might already have consumed the PCM.
        if (error.deviceResponse?.audioResult !== 5 || Date.now() >= deadline) throw error;
        await delay(20);
      }
    }
    return { interrupted: true };
  }

  async writePcm16PlaybackBatch(chunks, generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    const playback = this.activePlayback;
    const byteCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
    // Only batch while all chunks are guaranteed to fit. A ring-full retry
    // could put an earlier chunk behind a later chunk that succeeded.
    if (this.transport !== "wifi" || !(byteCount <= playback?.batchBudgetBytes)) {
      if (playback) playback.batchBudgetBytes = 0;
      for (const chunk of chunks) {
        const result = await this.writePcm16PlaybackChunk(chunk, generation);
        if (result.interrupted) return result;
      }
      return { interrupted: false };
    }
    playback.batchBudgetBytes -= byteCount;
    const results = await Promise.allSettled(
      chunks.map(chunk => this.writeWithAck(FRAME_TYPES.AUDIO_CHUNK,
        playback.adpcmState ? encodeImaAdpcm(chunk, playback.adpcmState) : chunk)),
    );
    if (generation !== this.playbackGeneration) return { interrupted: true };
    const rejected = results.find(result => result.status === "rejected");
    if (rejected) throw rejected.reason;
    return { interrupted: false };
  }

  async transferPcm16Playback(bytes, generation) {
    const playback = this.activePlayback;
    if (!playback?.completeBuffer || (this.transport !== "wifi" && !this.completeAudioRetry(generation)))
      return super.transferPcm16Playback(bytes, generation);

    try {
      return await this.writeCompleteAudio(bytes, generation, FRAME_TYPES.AUDIO_CHUNK, playback.adpcmState);
    } catch (error) {
      if (generation !== this.playbackGeneration) return { interrupted: true };
      if (error.code !== "DEVICE_RESPONSE_TIMEOUT" || this.connectionState !== "ready") throw error;

      // The device still awaits End, so none of this sentence has played.
      // A new Begin discards all staged samples, including any accepted
      // after the missing ACK. Retry in order without replaying an earlier sentence.
      this.log("info", "stackchan-tts-transfer-retry", { totalSamples: playback.totalSamples });
      const ack = await this.writeWithAck(FRAME_TYPES.AUDIO_BEGIN, playback.beginPayload);
      if (generation !== this.playbackGeneration) return { interrupted: true };
      playback.sequence = ack?.sequence;
      if (playback.adpcmState) playback.adpcmState.index = 0;
      return super.transferPcm16Playback(bytes, generation);
    }
  }

  async writeCompleteAudio(bytes, generation, type, state) {
    const retry = this.completeAudioRetry(generation);
    if (retry) {
      // Keep one ordered packet outstanding. Retrying its sequence is safe
      // on staging-capable devices and cannot reorder the buffered PCM.
      for (let offset = 0; offset < bytes.length; offset += PLAYBACK_CHUNK_BYTES) {
        if (generation !== this.playbackGeneration) return { interrupted: true };
        const pcm = bytes.subarray(offset, offset + PLAYBACK_CHUNK_BYTES);
        await this.writeWithAck(type, state ? encodeImaAdpcm(pcm, state) : pcm, retry);
      }
      return { interrupted: generation !== this.playbackGeneration };
    }
    const advertisedSize = this.capabilities?.capabilities?.audio?.maxAdpcmPcmBytes;
    const chunkBytes = state && Number.isInteger(advertisedSize) &&
        advertisedSize >= PLAYBACK_CHUNK_BYTES && advertisedSize % 2 === 0
      ? Math.min(advertisedSize, COMPLETE_PLAYBACK_MAX_ADPCM_PCM_BYTES)
      : PLAYBACK_CHUNK_BYTES;
    // Bound each write while retaining an ACK per independently decodable frame.
    const chunksPerWindow = this.transport === "wifi"
      ? Math.floor(COMPLETE_PLAYBACK_WINDOW * PLAYBACK_CHUNK_BYTES / chunkBytes) : 1;
    const windowBytes = chunksPerWindow * chunkBytes;
    for (let start = 0; start < bytes.length; start += windowBytes) {
      if (generation !== this.playbackGeneration) return { interrupted: true };
      const stop = Math.min(start + windowBytes, bytes.length);
      const frames = [];
      for (let offset = start; offset < stop; offset += chunkBytes) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkBytes, stop));
        frames.push({ type, payload: state ? encodeImaAdpcm(chunk, state) : chunk });
      }
      await this.writeFramesWithAck(frames, { timeoutMs: COMPLETE_PLAYBACK_ACK_TIMEOUT_MS });
    }
    return { interrupted: generation !== this.playbackGeneration };
  }

  async stagePcm16(bytes, playback) {
    const capacity = this.capabilities?.capabilities?.audio?.stagedPlaybackSamples;
    if (!playback?.completeBuffer || playback !== this.activePlayback || !bytes.length ||
        bytes.length % 2 || !(bytes.length / 2 <= capacity)) return null;
    const { generation, sampleRate } = playback;
    const totalSamples = bytes.length / 2;
    const beginPayload = Buffer.from(playback.beginPayload);
    beginPayload.writeUInt32LE(totalSamples, 11);
    const adpcmState = playback.adpcmState ? { index: 0 } : null;
    const startedAt = Date.now();
    const retry = this.completeAudioRetry(generation);
    const ack = await this.writeWithAck(FRAME_TYPES.AUDIO_STAGE_BEGIN, beginPayload, retry);
    const transfer = await this.writeCompleteAudio(bytes, generation, FRAME_TYPES.AUDIO_STAGE_CHUNK, adpcmState);
    if (transfer.interrupted) return null;
    await this.writeWithAck(FRAME_TYPES.AUDIO_STAGE_END, Buffer.alloc(0), retry);
    if (generation !== this.playbackGeneration) return null;
    return { generation, sampleRate, totalSamples, beginPayload, completeBuffer: true,
      sequence: ack?.sequence, transferMs: Date.now() - startedAt, adpcmState };
  }

  async playStagedPcm16(staged, { onPlaybackReady, onPlaybackCommitted } = {}) {
    if (staged.generation !== this.playbackGeneration) return { interrupted: true };
    const generation = ++this.playbackGeneration;
    const playback = { ...staged, generation, staged: true, drainSamples: staged.totalSamples, startedAt: Date.now() };
    this.activePlayback = playback;
    try {
      onPlaybackReady?.();
      await this.commitPlayback(FRAME_TYPES.AUDIO_STAGE_PLAY, playback);
      if (generation !== this.playbackGeneration) return { interrupted: true };
      onPlaybackCommitted?.(playback);
      return await this.waitForSpeakerDrain(generation, playback);
    } catch (error) {
      if (generation !== this.playbackGeneration) return { interrupted: true };
      await this.stopPlayback().catch(() => {});
      // An explicit rejection guarantees this prepared phrase did not play.
      // An ACK timeout has no such guarantee and must never replay a phrase.
      if (error.deviceResponse?.requestType === FRAME_TYPES.AUDIO_STAGE_PLAY &&
          error.deviceResponse.accepted === false && !playback.firstSoundAt)
        return { stagedRejected: true };
      throw error;
    }
  }

  async endPcm16Playback(generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    const playback = this.activePlayback;
    if (playback?.completeBuffer) playback.onPlaybackReady?.();
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.commitPlayback(FRAME_TYPES.AUDIO_END, playback);
    if (generation !== this.playbackGeneration) return { interrupted: true };
    if (playback?.completeBuffer) {
      playback.transferMs = Date.now() - playback.startedAt;
      playback.onPlaybackCommitted?.(playback);
    }
    return this.waitForSpeakerDrain(generation, playback);
  }

  async commitPlayback(type, playback) {
    if (!playback?.completeBuffer || !Number.isInteger(playback.sequence)) {
      await this.writeWithAck(type, Buffer.alloc(0));
      return;
    }
    // The firmware can start the speaker even when the commit ACK goes
    // missing. Its notification carries the exact phrase's begin sequence.
    const started = new Promise(resolve => { playback.confirmSpeakerStart = () => resolve("speaker"); });
    try {
      const acknowledged = this.writeWithAck(type, Buffer.alloc(0)).then(() => "ack");
      if (await Promise.race([acknowledged, started]) === "speaker") {
        this.log("info", "stackchan-audio-commit-confirmed-by-speaker", { type });
      }
    } finally {
      playback.confirmSpeakerStart = null;
    }
  }

  async waitForSpeakerDrain(generation, playback) {
    if (this.capabilities?.capabilities?.audio?.playbackStatus === true) {
      const bufferedDurationMs = playback
        ? Math.ceil(playback.drainSamples * 1000 / playback.sampleRate)
        : 0;
      const confirmedAt = Date.now();
      const stagedWifi = playback?.completeBuffer && this.transport === "wifi" &&
        this.capabilities?.capabilities?.audio?.stagedPlaybackSamples > 0;
      const deadline = confirmedAt + bufferedDurationMs + (stagedWifi ? 6_000 : 2_500);
      while (generation === this.playbackGeneration) {
        // A verified finite phrase has a known minimum playback time. During
        // most of it, give the link to the staged upload, while checking for
        // cancellation. Still require a device drain response to advance.
        if (stagedWifi) {
          const earliestDrainAt = (playback.firstSoundAt || confirmedAt) + bufferedDurationMs - 120;
          const beforeDrainMs = earliestDrainAt - Date.now();
          if (beforeDrainMs > 0) {
            await delay(Math.min(beforeDrainMs, 100));
            continue;
          }
        }
        let payload;
        try {
          ({ payload } = await this.requestFrame(
            FRAME_TYPES.AUDIO_STATUS, Buffer.alloc(0), FRAME_TYPES.AUDIO_STATUS, stagedWifi ? 1_250 : 850,
          ));
        } catch (error) {
          if (generation !== this.playbackGeneration) return { interrupted: true };
          if (error.code !== "DEVICE_RESPONSE_TIMEOUT" || this.connectionState !== "ready" || Date.now() >= deadline)
            throw error;
          continue;
        }
        if (generation !== this.playbackGeneration) return { interrupted: true };
        if (payload.length === 1 && payload[0] === 0) break;
        if (payload.length !== 1 || payload[0] !== 1 || Date.now() >= deadline)
          throw new Error("StackChanの音声再生完了を確認できませんでした。");
        await delay(playback?.completeBuffer ? 85 : 40);
      }
    } else {
      // Legacy firmware does not report when its speaker has finished.
      await delay(1200);
    }
    if (generation !== this.playbackGeneration) return { interrupted: true };
    this.activePlayback = null;
    // The speaker has already drained. An unavailable display ACK must not
    // invalidate completed audio or cause the host to replay it.
    await this.setDeviceState("idle").catch(error => {
      this.log("warn", "stackchan-playback-idle-state-failed", { error: error.message });
    });
    return { interrupted: false };
  }
}
module.exports = { STACKCHAN_BOARD, STACKCHAN_LIVE_PLAYBACK_OPTIONS, StackchanSerialGateway };
