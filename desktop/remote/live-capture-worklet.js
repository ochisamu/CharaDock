// SPDX-License-Identifier: Apache-2.0
// Capture on the audio rendering thread so avatar/UI work cannot drop frames.
class LiveCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Float32Array(Math.round(sampleRate * .08)); this.offset = 0;
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const channels = inputs[0]; if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0; for (const channel of channels) value += channel[i] / channels.length;
      this.frame[this.offset++] = value;
      if (this.offset === this.frame.length) {
        const frame = this.frame; this.frame = new Float32Array(frame.length); this.offset = 0;
        this.port.postMessage(frame.buffer, [frame.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('charadock-live-capture', LiveCapture);
