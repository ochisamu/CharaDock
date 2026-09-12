// SPDX-License-Identifier: Apache-2.0
const { Rlcd42SerialGateway } = require("./rlcd42-serial.cjs");
const { FRAME_TYPES, crc32 } = require("./device-protocol-v2.cjs");
const STACKCHAN_BOARD = "m5stack-stackchan-k151";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared framing/authentication/capture queues; hardware-specific display and
// bounded streaming audio. Never send RLCD 1-bit assets to this board.
class StackchanSerialGateway extends Rlcd42SerialGateway {
  constructor(options = {}) { super({ ...options, expectedBoard: STACKCHAN_BOARD }); }

  async setMotionEnabled(enabled) {
    await this.writeWithAck(FRAME_TYPES.MOTION, Buffer.from([enabled === true ? 1 : 0]));
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

  async beginPcm16Playback(sampleRate = 16000, totalSamples = 0xffffffff) {
    this.requirePlayback();
    if (sampleRate !== 16000 || !Number.isInteger(totalSamples) || totalSamples <= 0 || totalSamples > 0xffffffff) throw new Error("StackChan requires mono PCM16/16000 Hz.");
    const generation = ++this.playbackGeneration;
    const begin = Buffer.alloc(11);
    begin[0] = 1; begin.writeUInt32LE(16000, 1);
    begin[5] = 1; begin[6] = 16; begin[7] = 72;
    begin.writeUInt16LE(200, 8); begin[10] = 3;
    await this.setDeviceState("speaking");
    await this.writeWithAck(FRAME_TYPES.AUDIO_BEGIN, begin);
    this.activePlayback = { generation, sampleRate, totalSamples };
    return generation;
  }

  async writePcm16PlaybackChunk(pcm, generation) {
    const bytes = Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2 || bytes.length > 4096) throw new Error("Invalid StackChan PCM chunk.");
    const deadline = Date.now() + 6000;
    while (generation === this.playbackGeneration) {
      try {
        await this.writeWithAck(FRAME_TYPES.AUDIO_CHUNK, bytes);
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

  async endPcm16Playback(generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.writeWithAck(FRAME_TYPES.AUDIO_END, Buffer.alloc(0));
    // At most 1024ms remains in the firmware ring plus 60ms in I2S.
    // Do not wait the full utterance a second time after streaming it.
    await delay(1200);
    if (generation !== this.playbackGeneration) return { interrupted: true };
    this.activePlayback = null;
    await this.setDeviceState("idle");
    return { interrupted: false };
  }
}
module.exports = { STACKCHAN_BOARD, StackchanSerialGateway };
