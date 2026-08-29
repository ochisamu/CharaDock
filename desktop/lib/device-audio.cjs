// SPDX-License-Identifier: Apache-2.0

function decodeAudioDataUrl(value) {
  const match = /^data:audio\/[^;,]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!match) throw new Error("ATOM Echoへ送れるPCM WAV音声ではありません。");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("ATOM Echoへ送れるPCM WAV音声ではありません。");
  }
  return bytes;
}

function waveChunks(bytes) {
  const chunks = new Map();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (!chunks.has(id)) chunks.set(id, bytes.subarray(start, end));
    offset = end + (length & 1);
  }
  return chunks;
}

function decodePcmWaveDataUrl(value) {
  const bytes = decodeAudioDataUrl(value);
  const chunks = waveChunks(bytes);
  const format = chunks.get("fmt ");
  const data = chunks.get("data");
  if (!format || format.length < 16 || !data) throw new Error("WAV音声のヘッダーが正しくありません。");
  const encoding = format.readUInt16LE(0);
  const channels = format.readUInt16LE(2);
  const sampleRate = format.readUInt32LE(4);
  const bitsPerSample = format.readUInt16LE(14);
  if (encoding !== 1 || bitsPerSample !== 16 || ![1, 2].includes(channels) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error("ATOM Echo MVPは16-bit mono/stereo PCM WAVに対応しています。");
  }
  const frameBytes = channels * 2;
  const frameCount = Math.floor(data.length / frameBytes);
  if (!frameCount) throw new Error("WAV音声にサンプルがありません。");
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += data.readInt16LE(frame * frameBytes + channel * 2) / 32768;
    }
    mono[frame] = sum / channels;
  }
  return { samples: mono, sampleRate };
}

function resamplePcm16(samples, sourceRate, targetRate = 16_000) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const inputRate = Math.max(1, Math.round(Number(sourceRate) || 0));
  const outputRate = Math.max(1, Math.round(Number(targetRate) || 0));
  if (!input.length || !inputRate || !outputRate) return Buffer.alloc(0);
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const output = Buffer.allocUnsafe(outputLength * 2);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < outputLength; index += 1) {
    let sample;
    if (ratio > 1) {
      // Area averaging supplies a small anti-alias filter when reducing the
      // 48 kHz Realtime track to the ATOM Echo's 16 kHz speaker. Point/linear
      // sampling at an exact 3:1 ratio otherwise aliases all content above
      // 8 kHz into audible voice-band harshness.
      const start = index * ratio;
      const end = Math.min(input.length, (index + 1) * ratio);
      let cursor = start;
      let weighted = 0;
      let weight = 0;
      while (cursor < end) {
        const sourceIndex = Math.min(input.length - 1, Math.floor(cursor));
        const next = Math.min(end, Math.floor(cursor) + 1);
        const span = next - cursor;
        weighted += input[sourceIndex] * span;
        weight += span;
        cursor = next;
      }
      sample = weight ? weighted / weight : input[Math.min(input.length - 1, Math.floor(start))];
    } else {
      const position = Math.min(input.length - 1, index * ratio);
      const lower = Math.floor(position);
      const upper = Math.min(input.length - 1, lower + 1);
      const fraction = position - lower;
      sample = input[lower] + (input[upper] - input[lower]) * fraction;
    }
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), index * 2);
  }
  return output;
}

const DEFAULT_ATOM_ECHO_OUTPUT_PROFILE = Object.freeze({
  gain: .5,
  highPassHz: 240,
  bodyEqHz: 550,
  bodyEqDb: -3,
  bodyEqQ: 1,
  presenceEqHz: 2600,
  presenceEqDb: 3,
  presenceEqQ: .9,
  compressorThresholdDb: -22,
  compressorRatio: 2.5,
  compressorAttackMs: 15,
  compressorReleaseMs: 120,
  compressorKneeDb: 6,
  compressorMakeupDb: 12,
  outputGain: 1,
  limiterThreshold: .58,
  limiterCeiling: .7,
  fadeMs: 8,
});

function dbToLinear(value) {
  return 10 ** (Number(value) / 20);
}

function biquadCoefficients(type, sampleRate, frequency, q = Math.SQRT1_2, gainDb = 0) {
  const boundedFrequency = Math.max(0, Math.min(sampleRate * .45, Number(frequency) || 0));
  if (!boundedFrequency) return null;
  const boundedQ = Math.max(.1, Math.min(12, Number(q) || Math.SQRT1_2));
  const omega = 2 * Math.PI * boundedFrequency / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * boundedQ);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  if (type === "highpass") {
    b0 = (1 + cosine) / 2;
    b1 = -(1 + cosine);
    b2 = (1 + cosine) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosine;
    a2 = 1 - alpha;
  } else if (type === "peaking") {
    const amplitude = 10 ** (Number(gainDb || 0) / 40);
    b0 = 1 + alpha * amplitude;
    b1 = -2 * cosine;
    b2 = 1 - alpha * amplitude;
    a0 = 1 + alpha / amplitude;
    a1 = -2 * cosine;
    a2 = 1 - alpha / amplitude;
  } else {
    throw new Error(`Unsupported ATOM Echo biquad type: ${type}`);
  }
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

class StatefulBiquad {
  constructor(coefficients) {
    this.coefficients = coefficients;
    this.z1 = 0;
    this.z2 = 0;
  }

  process(sample) {
    const { b0, b1, b2, a1, a2 } = this.coefficients;
    const output = b0 * sample + this.z1;
    this.z1 = b1 * sample - a1 * output + this.z2;
    this.z2 = b2 * sample - a2 * output;
    return output;
  }
}

function pcm16ToFloat32(value) {
  const pcm = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (pcm.length % 2) throw new Error("ATOM Echoへ送るPCM音声が正しくありません。");
  const samples = new Float32Array(pcm.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2) / 32768;
  return samples;
}

function float32ToPcm16(samples) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const pcm = Buffer.allocUnsafe(input.length * 2);
  for (let index = 0; index < input.length; index += 1) {
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(input[index] * 32767))), index * 2);
  }
  return pcm;
}

class AtomEchoPcmProcessor {
  constructor({ sampleRate = 16_000, ...profile } = {}) {
    this.sampleRate = Math.max(8_000, Math.round(Number(sampleRate) || 16_000));
    this.profile = { ...DEFAULT_ATOM_ECHO_OUTPUT_PROFILE, ...profile };
    this.fadeSamples = Math.max(0, Math.round(this.sampleRate * Math.max(0, Number(this.profile.fadeMs) || 0) / 1000));
    this.samplesSeen = 0;
    this.tail = Buffer.alloc(0);
    this.finished = false;
    const highPassHz = Number(this.profile.highPassHz) || 0;
    this.filters = [
      // The two Butterworth sections form a fourth-order (24 dB/oct) HPF.
      biquadCoefficients("highpass", this.sampleRate, highPassHz, .5411961),
      biquadCoefficients("highpass", this.sampleRate, highPassHz, 1.306563),
      biquadCoefficients(
        "peaking",
        this.sampleRate,
        this.profile.bodyEqHz,
        this.profile.bodyEqQ,
        this.profile.bodyEqDb,
      ),
      biquadCoefficients(
        "peaking",
        this.sampleRate,
        this.profile.presenceEqHz,
        this.profile.presenceEqQ,
        this.profile.presenceEqDb,
      ),
    ].filter(Boolean).map((coefficients) => new StatefulBiquad(coefficients));
    this.compressorEnvelope = 0;
    this.compressorAttackCoefficient = this.envelopeCoefficient(this.profile.compressorAttackMs);
    this.compressorReleaseCoefficient = this.envelopeCoefficient(this.profile.compressorReleaseMs);
  }

  envelopeCoefficient(milliseconds) {
    const seconds = Math.max(.001, Math.min(10, Number(milliseconds) / 1000 || .001));
    return Math.exp(-1 / (seconds * this.sampleRate));
  }

  compress(sample) {
    const level = Math.abs(sample);
    const coefficient = level > this.compressorEnvelope
      ? this.compressorAttackCoefficient
      : this.compressorReleaseCoefficient;
    this.compressorEnvelope = coefficient * this.compressorEnvelope + (1 - coefficient) * level;
    const threshold = Math.max(-60, Math.min(0, Number(this.profile.compressorThresholdDb) || -22));
    const ratio = Math.max(1, Math.min(20, Number(this.profile.compressorRatio) || 1));
    const knee = Math.max(0, Math.min(24, Number(this.profile.compressorKneeDb) || 0));
    const levelDb = 20 * Math.log10(Math.max(1e-8, this.compressorEnvelope));
    let compressedDb = levelDb;
    if (ratio > 1 && knee && levelDb > threshold - knee / 2 && levelDb < threshold + knee / 2) {
      const position = levelDb - threshold + knee / 2;
      compressedDb = levelDb + (1 / ratio - 1) * position * position / (2 * knee);
    } else if (ratio > 1 && levelDb >= threshold + knee / 2) {
      compressedDb = threshold + (levelDb - threshold) / ratio;
    }
    const makeupDb = Math.max(-24, Math.min(24, Number(this.profile.compressorMakeupDb) || 0));
    return sample * dbToLinear(compressedDb - levelDb + makeupDb);
  }

  limit(sample) {
    const threshold = Math.max(0, Math.min(.99, Number(this.profile.limiterThreshold) || 0));
    const ceiling = Math.max(threshold, Math.min(1, Number(this.profile.limiterCeiling) || 1));
    const magnitude = Math.abs(sample);
    if (!threshold || magnitude <= threshold) return Math.max(-ceiling, Math.min(ceiling, sample));
    const position = Math.min(1, (magnitude - threshold) / (1 - threshold));
    const curved = (1 - Math.exp(-4 * position)) / (1 - Math.exp(-4));
    return Math.sign(sample) * Math.min(ceiling, threshold + (ceiling - threshold) * curved);
  }

  shape(samples) {
    const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    const output = new Float32Array(input.length);
    const gain = Math.max(0, Math.min(2, Number(this.profile.gain) || 0));
    const outputGain = Math.max(.5, Math.min(1.5, Number(this.profile.outputGain) || 1));
    for (let index = 0; index < input.length; index += 1) {
      let sample = Math.max(-1, Math.min(1, input[index])) * gain;
      for (const filter of this.filters) sample = filter.process(sample);
      sample = this.limit(this.compress(sample) * outputGain);
      if (this.fadeSamples && this.samplesSeen < this.fadeSamples) {
        sample *= (this.samplesSeen + 1) / this.fadeSamples;
      }
      output[index] = sample;
      this.samplesSeen += 1;
    }
    return float32ToPcm16(output);
  }

  push(pcm) {
    if (this.finished) throw new Error("ATOM Echoの音声処理はすでに終了しています。");
    const shaped = this.shape(pcm16ToFloat32(pcm));
    if (!this.fadeSamples) return shaped;
    const combined = this.tail.length ? Buffer.concat([this.tail, shaped]) : shaped;
    const tailBytes = this.fadeSamples * 2;
    if (combined.length <= tailBytes) {
      this.tail = Buffer.from(combined);
      return Buffer.alloc(0);
    }
    const emitBytes = combined.length - tailBytes;
    this.tail = Buffer.from(combined.subarray(emitBytes));
    return Buffer.from(combined.subarray(0, emitBytes));
  }

  finish() {
    if (this.finished) return Buffer.alloc(0);
    this.finished = true;
    const tail = Buffer.from(this.tail);
    this.tail = Buffer.alloc(0);
    const samples = tail.length / 2;
    for (let index = 0; index < samples; index += 1) {
      const sample = tail.readInt16LE(index * 2);
      const fade = samples > 1 ? (samples - index - 1) / (samples - 1) : 0;
      tail.writeInt16LE(Math.round(sample * fade), index * 2);
    }
    return tail;
  }
}

function processAtomEchoPcm16(pcm, options = {}) {
  const processor = new AtomEchoPcmProcessor(options);
  return Buffer.concat([processor.push(pcm), processor.finish()]);
}

function waveDataUrlToPcm16(value, targetRate = 16_000, { processForAtomEcho = false } = {}) {
  const decoded = decodePcmWaveDataUrl(value);
  let pcm = resamplePcm16(decoded.samples, decoded.sampleRate, targetRate);
  if (processForAtomEcho) pcm = processAtomEchoPcm16(pcm, { sampleRate: targetRate });
  return { pcm, sampleRate: targetRate };
}

module.exports = {
  AtomEchoPcmProcessor,
  DEFAULT_ATOM_ECHO_OUTPUT_PROFILE,
  decodePcmWaveDataUrl,
  float32ToPcm16,
  pcm16ToFloat32,
  processAtomEchoPcm16,
  resamplePcm16,
  waveDataUrlToPcm16,
};
