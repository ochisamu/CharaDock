// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NOGUCHI Shoji
// Irodori-TTS 600M v3 VoiceDesign inference core for browsers and Node.
//
// ONNX contains only the neural-network forward graphs. Tokenization, duration
// clamping, multi-condition CFG, Euler/sway schedules and DACVAE tensor layout
// stay here so every phase can select only the sessions it actually needs.

export const VOICEDESIGN_CONFIG = Object.freeze({
  sampleRate: 48000,
  hopLength: 1920,
  latentDim: 32,
  textDim: 512,
  captionDim: 512,
  speakerDim: 768,
  durationAuxDim: 14,
  addTextBos: true,
  addCaptionBos: true,
  bosTokenId: 1,
});

const SIMPLE_REPLACEMENTS = [
  ["\t", ""], ["[n]", ""], ["\\[n\\]", ""], ["　", ""], ["？", "?"], ["！", "!"],
  ["♥", "♡"], ["●", "○"], ["◯", "○"], ["〇", "○"],
];

function stripOuterBrackets(text) {
  const pairs = { "「": "」", "『": "』", "（": "）", "【": "】", "(": ")" };
  while (text.length >= 2) {
    const start = text[0];
    const end = text[text.length - 1];
    if (pairs[start] !== end) break;
    let depth = 0;
    let surroundsWholeString = true;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === start) depth++;
      else if (text[i] === end) depth--;
      if (depth === 0 && i < text.length - 1) {
        surroundsWholeString = false;
        break;
      }
    }
    if (!surroundsWholeString || depth !== 0) break;
    text = text.slice(1, -1);
  }
  return text;
}

export function normalizeText(value) {
  let text = String(value ?? "");
  for (const [from, to] of SIMPLE_REPLACEMENTS) text = text.split(from).join(to);
  text = text.replace(/[;▼♀♂《》≪≫①②③④⑤⑥]/g, "");
  text = text.replace(/[˗‐-―⁃−⎯⏤─━⸺⸻]/g, "");
  text = text.replace(/[～〜]/g, "ー");
  text = text.replace(/…{3,}/g, "……");
  text = stripOuterBrackets(text).normalize("NFKC");
  return text.split("...").join("…").split("..").join("…");
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianNoise(length, seed = 0) {
  const random = mulberry32(Number(seed));
  const result = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const u1 = Math.max(random(), 1e-12);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    result[i] = radius * Math.cos(2 * Math.PI * u2);
    if (i + 1 < length) result[i + 1] = radius * Math.sin(2 * Math.PI * u2);
  }
  return result;
}

// Matches inference_runtime.find_flattening_point. Generated DAC latents often
// become near-zero before the duration predictor's allocated tail ends; the
// official runtime trims at the first such window instead of decoding it.
export function findFlatteningPoint(latent, sequenceLength, {
  windowSize = 20,
  stdThreshold = 0.05,
  meanThreshold = 0.1,
  targetValue = 0,
} = {}) {
  if (!(latent instanceof Float32Array) || latent.length !== sequenceLength * VOICEDESIGN_CONFIG.latentDim) {
    throw new Error(`latent length must be sequenceLength * ${VOICEDESIGN_CONFIG.latentDim}`);
  }
  if (!Number.isInteger(windowSize) || windowSize < 1 || sequenceLength < 1) return sequenceLength;
  const dim = VOICEDESIGN_CONFIG.latentDim;
  const count = windowSize * dim;
  for (let start = 0; start < sequenceLength; start++) {
    let sum = 0;
    let sumSquares = 0;
    const realEnd = Math.min(sequenceLength, start + windowSize);
    for (let token = start; token < realEnd; token++) {
      const offset = token * dim;
      for (let channel = 0; channel < dim; channel++) {
        const value = latent[offset + channel];
        sum += value;
        sumSquares += value * value;
      }
    }
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    if (Math.sqrt(variance) < stdThreshold && Math.abs(mean - targetValue) < meanThreshold) {
      return start;
    }
  }
  return sequenceLength;
}

// Some short V4 generations contain a second, unrelated utterance after a
// clearly silent gap. The latent flattening heuristic cannot remove it because
// the latent becomes active again. Detect only silence followed by sustained
// resumed speech; ordinary trailing silence is left to the latent trim.
export function findTrailingUtteranceCutoff(audio, sampleRate, {
  windowMs = 40,
  minInitialSpeechMs = 200,
  minSilenceMs = 480,
  resumeLookaheadMs = 800,
  minResumedSpeechMs = 160,
  tailPaddingMs = 80,
} = {}) {
  if (!(audio instanceof Float32Array) || !(sampleRate > 0) || audio.length < 1) return audio?.length ?? 0;
  const windowSamples = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const windows = Math.ceil(audio.length / windowSamples);
  const levels = new Float32Array(windows);
  let peakDb = -120;
  for (let window = 0; window < windows; window++) {
    const start = window * windowSamples;
    const end = Math.min(audio.length, start + windowSamples);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += audio[i] * audio[i];
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    const db = 20 * Math.log10(Math.max(1e-8, rms));
    levels[window] = db;
    peakDb = Math.max(peakDb, db);
  }
  if (peakDb < -45) return audio.length;

  const speechThreshold = Math.max(-38, peakDb - 28);
  const silenceThreshold = Math.max(-55, peakDb - 38);
  const initialSpeechWindows = Math.max(1, Math.ceil(minInitialSpeechMs / windowMs));
  const silenceWindows = Math.max(1, Math.ceil(minSilenceMs / windowMs));
  const lookaheadWindows = Math.max(1, Math.ceil(resumeLookaheadMs / windowMs));
  const resumedSpeechWindows = Math.max(1, Math.ceil(minResumedSpeechMs / windowMs));
  let speechSeen = 0;

  for (let window = 0; window < windows; window++) {
    if (levels[window] >= speechThreshold) speechSeen += 1;
    if (speechSeen < initialSpeechWindows || levels[window] > silenceThreshold) continue;

    let silenceEnd = window;
    while (silenceEnd < windows && levels[silenceEnd] <= silenceThreshold) silenceEnd += 1;
    if (silenceEnd - window < silenceWindows) {
      window = silenceEnd;
      continue;
    }

    const lookaheadEnd = Math.min(windows, silenceEnd + lookaheadWindows);
    let resumedSpeech = 0;
    let longestResumedSpeech = 0;
    for (let next = silenceEnd; next < lookaheadEnd; next++) {
      if (levels[next] >= speechThreshold) {
        resumedSpeech += 1;
        longestResumedSpeech = Math.max(longestResumedSpeech, resumedSpeech);
      } else {
        resumedSpeech = 0;
      }
    }
    if (longestResumedSpeech >= resumedSpeechWindows) {
      const cutoff = window * windowSamples + Math.round(sampleRate * tailPaddingMs / 1000);
      return Math.max(1, Math.min(audio.length, cutoff));
    }
    window = silenceEnd;
  }
  return audio.length;
}

export function shouldTrimTrailingUtterance(textValue) {
  const normalized = normalizeText(textValue).trim();
  if (!normalized || /[；;：:…（）()［］\[\]「」『』]/u.test(normalized)) return false;
  const spokenCharacters = [...normalized.replace(/[\s。．.!！?？"'“”‘’]/gu, "")].length;
  return spokenCharacters > 0;
}

function fadeAudioTail(audio, sampleRate, fadeMs = 30) {
  const result = Float32Array.from(audio);
  const fadeSamples = Math.min(result.length, Math.max(1, Math.round(sampleRate * fadeMs / 1000)));
  const start = result.length - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) result[start + i] *= 1 - i / fadeSamples;
  return result;
}

const KW_48K = [
  { b: [1.5351828863637502, -2.691804030199196, 1.198426263333146], a: [1, -1.6906995865986896, 0.7325047060963897] },
  { b: [0.9950442970178917, -1.9900885940357833, 0.9950442970178917], a: [1, -1.990076284018423, 0.9901009040531438] },
];

function lfilter(input, b, a) {
  const output = new Float64Array(input.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    output[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return output;
}

export function integratedLoudness(waveform, sampleRate = 48000) {
  let filtered = waveform;
  for (const filter of KW_48K) filtered = lfilter(filtered, filter.b, filter.a);
  const block = Math.round(0.4 * sampleRate);
  const stride = Math.round(0.1 * sampleRate);
  if (filtered.length < block) return null;
  const frameCount = Math.ceil((filtered.length - block) / stride) + 1;
  const powers = new Float64Array(frameCount);
  const loudness = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    const offset = frame * stride;
    for (let i = 0; i < block; i++) {
      const index = offset + i;
      if (index < filtered.length) sum += filtered[index] * filtered[index];
    }
    powers[frame] = sum / block;
    loudness[frame] = -0.691 + 10 * Math.log10(powers[frame]);
  }
  const absolute = [...powers.keys()].filter((index) => loudness[index] > -70);
  if (!absolute.length) return null;
  const absoluteMean = absolute.reduce((sum, index) => sum + powers[index], 0) / absolute.length;
  const relativeGate = -0.691 + 10 * Math.log10(absoluteMean) - 10;
  const relative = absolute.filter((index) => loudness[index] > relativeGate);
  if (!relative.length) return null;
  const mean = relative.reduce((sum, index) => sum + powers[index], 0) / relative.length;
  return -0.691 + 10 * Math.log10(mean);
}

export function lufsNormalize(waveform, sampleRate = 48000, targetDb = -16) {
  const output = Float32Array.from(waveform);
  const measured = integratedLoudness(output, sampleRate);
  if (measured !== null && Number.isFinite(measured)) {
    const gain = 10 ** ((targetDb - measured) / 20);
    for (let i = 0; i < output.length; i++) output[i] *= gain;
  }
  let peak = 0;
  for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  if (peak > 1) for (let i = 0; i < output.length; i++) output[i] /= peak;
  return output;
}

function concatFloat(parts, partSize) {
  const output = new Float32Array(parts.length * partSize);
  parts.forEach((part, index) => output.set(part, index * partSize));
  return output;
}

function concatBool(parts, partSize) {
  const output = new Uint8Array(parts.length * partSize);
  parts.forEach((part, index) => output.set(part, index * partSize));
  return output;
}

function cloneCondition(condition) {
  return { state: condition.state, mask: condition.mask, tokens: condition.tokens, dim: condition.dim };
}

function dropCondition(condition) {
  return {
    state: new Float32Array(condition.tokens * condition.dim),
    mask: new Uint8Array(condition.tokens),
    tokens: condition.tokens,
    dim: condition.dim,
  };
}

function noiseCondition(condition, seed) {
  let mean = 0;
  for (const value of condition.state) mean += value;
  mean /= Math.max(1, condition.state.length);
  let variance = 0;
  for (const value of condition.state) variance += (value - mean) ** 2;
  const scale = Math.max(1e-6, Math.sqrt(variance / Math.max(1, condition.state.length - 1)));
  const state = gaussianNoise(condition.tokens * condition.dim, seed);
  for (let i = 0; i < state.length; i++) state[i] *= scale;
  return {
    state,
    mask: new Uint8Array(condition.tokens).fill(1),
    tokens: condition.tokens,
    dim: condition.dim,
  };
}

function conditionEnabled(condition) {
  return condition.mask.some((value) => value !== 0);
}

export function noSpeakerCondition() {
  return {
    state: new Float32Array(VOICEDESIGN_CONFIG.speakerDim),
    mask: new Uint8Array(1),
    tokens: 1,
    dim: VOICEDESIGN_CONFIG.speakerDim,
  };
}

export function speakerConditionFromBinary(buffer, metadata) {
  const spec = metadata?.speakerEmbedding ?? metadata;
  if (!spec || spec.dtype !== "float32" || !Array.isArray(spec.shape) || spec.shape.length !== 2) {
    throw new Error("speaker embedding metadata must describe float32 shape [tokens, dim]");
  }
  const [tokens, dim] = spec.shape.map(Number);
  if (dim !== VOICEDESIGN_CONFIG.speakerDim || tokens < 1) {
    throw new Error(`speaker embedding shape must be [N, ${VOICEDESIGN_CONFIG.speakerDim}]`);
  }
  const bytes = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (bytes.byteLength !== tokens * dim * 4) {
    throw new Error(`speaker embedding byte length mismatch: expected ${tokens * dim * 4}, got ${bytes.byteLength}`);
  }
  return { state: new Float32Array(bytes), mask: new Uint8Array(tokens).fill(1), tokens, dim };
}

export function referenceLatentFromBinary(buffer, metadata) {
  const spec = metadata?.referenceLatent ?? metadata;
  if (!spec || spec.dtype !== "float32" || !Array.isArray(spec.shape) || spec.shape.length !== 2) {
    throw new Error("reference latent metadata must describe float32 shape [tokens, dim]");
  }
  const [tokens, dim] = spec.shape.map(Number);
  if (dim !== VOICEDESIGN_CONFIG.latentDim || tokens < 1) {
    throw new Error(`reference latent shape must be [N, ${VOICEDESIGN_CONFIG.latentDim}]`);
  }
  const bytes = buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  if (bytes.byteLength !== tokens * dim * 4) {
    throw new Error(`reference latent byte length mismatch: expected ${tokens * dim * 4}, got ${bytes.byteLength}`);
  }
  return {
    latent: new Float32Array(bytes),
    mask: new Uint8Array(tokens).fill(1),
    tokens,
    dim,
  };
}

export class IrodoriVoiceDesignTTS {
  constructor({ ort, sessions, tokenizer, captionTokenizer = tokenizer }) {
    if (!ort?.Tensor) throw new Error("ort.Tensor is required");
    for (const key of ["text", "caption", "duration", "dit", "dac"]) {
      if (!sessions?.[key]) throw new Error(`missing required ONNX session: ${key}`);
    }
    this.ort = ort;
    this.s = sessions;
    this.tokenizer = tokenizer;
    this.captionTokenizer = captionTokenizer;
  }

  _tensor(data, shape, type = "float32") {
    return new this.ort.Tensor(type, data, shape);
  }

  _tokenize(value, tokenizer, addBos) {
    const normalized = normalizeText(value).trim();
    if (!normalized) throw new Error("conditioning text became empty after normalization");
    const encoded = tokenizer.encode(normalized, { add_special_tokens: false });
    const ids = [...(addBos ? [VOICEDESIGN_CONFIG.bosTokenId] : []), ...encoded].map(Number);
    return Int32Array.from(ids);
  }

  _emitStage(onStage, stage, status, error = null) {
    if (!onStage) return;
    try {
      onStage({ stage, status, error });
    } catch {
      // Progress reporting must never interrupt synthesis.
    }
  }

  async _stage(stage, onStage, operation) {
    this._emitStage(onStage, stage, "start");
    try {
      const result = await operation();
      this._emitStage(onStage, stage, "complete");
      return result;
    } catch (error) {
      this._emitStage(onStage, stage, "error", error);
      const wrapped = new Error(`${stage}: ${error?.message ?? error}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async _encode(value, tokenizer, session, outputName, dim, addBos, stagePrefix, onStage) {
    const ids = await this._stage(`${stagePrefix}_tokenizer`, onStage,
      () => this._tokenize(value, tokenizer, addBos));
    const tokens = ids.length;
    const inputIds = BigInt64Array.from(ids, (id) => BigInt(id));
    const mask = new Uint8Array(tokens).fill(1);
    const output = await this._stage(`${stagePrefix}_encoder`, onStage, () => session.run({
        input_ids: this._tensor(inputIds, [1, tokens], "int64"),
        mask: this._tensor(mask, [1, tokens], "bool"),
      }));
    const tensor = output[outputName];
    return { state: tensor.data, mask, tokens, dim: tensor.dims?.[2] ?? dim };
  }

  encodeText(text, onStage = null) {
    return this._encode(text, this.tokenizer, this.s.text, "text_state", VOICEDESIGN_CONFIG.textDim, true, "text", onStage);
  }

  encodeCaption(caption, onStage = null) {
    return this._encode(caption, this.captionTokenizer, this.s.caption, "caption_state", VOICEDESIGN_CONFIG.captionDim, true, "caption", onStage);
  }

  async wavToRefLatent(waveform, sampleRate, {
    normalizeDb = -16,
    ensureMax = true,
    maxRefSeconds = 15,
  } = {}) {
    if (!this.s.enc) throw new Error("Phase 3 requires the dacvae_encoder session");
    if (sampleRate !== VOICEDESIGN_CONFIG.sampleRate) {
      throw new Error(`reference audio must be ${VOICEDESIGN_CONFIG.sampleRate} Hz`);
    }
    const maxSamples = maxRefSeconds > 0 ? Math.floor(maxRefSeconds * sampleRate) : waveform.length;
    let normalized = waveform.length > maxSamples ? waveform.subarray(0, maxSamples) : waveform;
    if (normalizeDb !== null && normalizeDb !== undefined) normalized = lufsNormalize(waveform, sampleRate, normalizeDb);
    else if (ensureMax) {
      normalized = Float32Array.from(waveform);
      let peak = 0;
      for (const sample of normalized) peak = Math.max(peak, Math.abs(sample));
      if (peak > 1) for (let i = 0; i < normalized.length; i++) normalized[i] /= peak;
    }
    const paddedLength = Math.max(VOICEDESIGN_CONFIG.hopLength,
      Math.ceil(normalized.length / VOICEDESIGN_CONFIG.hopLength) * VOICEDESIGN_CONFIG.hopLength);
    const padded = new Float32Array(paddedLength);
    padded.set(normalized.subarray(0, paddedLength));
    const output = await this.s.enc.run({ wav: this._tensor(padded, [1, 1, paddedLength]) });
    return { latent: output.latent.data, tokens: output.latent.dims[1] };
  }

  async encodeReferenceLatent(refLatent, tokens, refMask = null) {
    if (!this.s.speaker) throw new Error("Phase 3 requires the speaker_encoder session");
    const mask = refMask ?? new Uint8Array(tokens).fill(1);
    const output = await this.s.speaker.run({
      ref_latent: this._tensor(refLatent, [1, tokens, VOICEDESIGN_CONFIG.latentDim]),
      ref_mask: this._tensor(mask, [1, tokens], "bool"),
    });
    return {
      state: output.speaker_state.data,
      mask: output.speaker_mask.data,
      tokens: output.speaker_state.dims[1],
      dim: output.speaker_state.dims[2],
    };
  }

  async encodeReferenceAudio(waveform, sampleRate, options = {}) {
    const latent = await this.wavToRefLatent(waveform, sampleRate, options);
    return this.encodeReferenceLatent(latent.latent, latent.tokens);
  }

  async predictDuration(text, caption, speaker, {
    durationScale = 1,
    minSeconds = 0.5,
    maxSeconds = 30,
  } = {}) {
    if (!(durationScale > 0)) throw new Error("durationScale must be > 0");
    const hasSpeaker = conditionEnabled(speaker);
    const hasCaption = conditionEnabled(caption);
    const output = await this.s.duration.run({
      text_state: this._tensor(text.state, [1, text.tokens, text.dim]),
      text_mask: this._tensor(text.mask, [1, text.tokens], "bool"),
      aux: this._tensor(new Float32Array(VOICEDESIGN_CONFIG.durationAuxDim), [1, VOICEDESIGN_CONFIG.durationAuxDim]),
      speaker_state: this._tensor(speaker.state, [1, speaker.tokens, speaker.dim]),
      speaker_mask: this._tensor(speaker.mask, [1, speaker.tokens], "bool"),
      has_speaker: this._tensor(new Uint8Array([hasSpeaker ? 1 : 0]), [1], "bool"),
      caption_state: this._tensor(caption.state, [1, caption.tokens, caption.dim]),
      caption_mask: this._tensor(caption.mask, [1, caption.tokens], "bool"),
      has_caption: this._tensor(new Uint8Array([hasCaption ? 1 : 0]), [1], "bool"),
    });
    const predicted = Math.expm1(output.log_frames.data[0]) * durationScale;
    const minFrames = Math.ceil(minSeconds * VOICEDESIGN_CONFIG.sampleRate / VOICEDESIGN_CONFIG.hopLength);
    const maxFrames = Math.floor(maxSeconds * VOICEDESIGN_CONFIG.sampleRate / VOICEDESIGN_CONFIG.hopLength);
    return Math.max(minFrames, Math.min(maxFrames, Math.round(predicted)));
  }

  _schedule(numSteps, mode, swayCoeff, initScale) {
    if (!Number.isInteger(numSteps) || numSteps < 1) throw new Error("numSteps must be a positive integer");
    const schedule = new Float32Array(numSteps + 1);
    for (let i = 0; i <= numSteps; i++) {
      let u = i / numSteps;
      if (mode === "sway") u += swayCoeff * (Math.cos(0.5 * Math.PI * u) + u - 1);
      else if (mode !== "linear") throw new Error(`unsupported schedule: ${mode}`);
      schedule[i] = (1 - Math.max(0, Math.min(1, u))) * initScale;
      if (i > 0 && schedule[i - 1] <= schedule[i]) throw new Error("time schedule must be strictly decreasing");
    }
    return schedule;
  }

  _ditFeed(latent, t, sequenceLength, bundle) {
    const batch = bundle.batch;
    return {
      x_t: this._tensor(latent, [batch, sequenceLength, VOICEDESIGN_CONFIG.latentDim]),
      t: this._tensor(new Float32Array(batch).fill(t), [batch]),
      text_state: this._tensor(bundle.text.state, [batch, bundle.text.tokens, bundle.text.dim]),
      text_mask: this._tensor(bundle.text.mask, [batch, bundle.text.tokens], "bool"),
      speaker_state: this._tensor(bundle.speaker.state, [batch, bundle.speaker.tokens, bundle.speaker.dim]),
      speaker_mask: this._tensor(bundle.speaker.mask, [batch, bundle.speaker.tokens], "bool"),
      caption_state: this._tensor(bundle.caption.state, [batch, bundle.caption.tokens, bundle.caption.dim]),
      caption_mask: this._tensor(bundle.caption.mask, [batch, bundle.caption.tokens], "bool"),
    };
  }

  async _runDit(latent, t, sequenceLength, bundle) {
    return (await this.s.dit.run(this._ditFeed(latent, t, sequenceLength, bundle))).v.data;
  }

  _singleBundle(text, speaker, caption) {
    return { batch: 1, text, speaker, caption };
  }

  _batchedBundle(bundles) {
    const first = bundles[0];
    return {
      batch: bundles.length,
      text: {
        state: concatFloat(bundles.map((item) => item.text.state), first.text.tokens * first.text.dim),
        mask: concatBool(bundles.map((item) => item.text.mask), first.text.tokens),
        tokens: first.text.tokens, dim: first.text.dim,
      },
      speaker: {
        state: concatFloat(bundles.map((item) => item.speaker.state), first.speaker.tokens * first.speaker.dim),
        mask: concatBool(bundles.map((item) => item.speaker.mask), first.speaker.tokens),
        tokens: first.speaker.tokens, dim: first.speaker.dim,
      },
      caption: {
        state: concatFloat(bundles.map((item) => item.caption.state), first.caption.tokens * first.caption.dim),
        mask: concatBool(bundles.map((item) => item.caption.mask), first.caption.tokens),
        tokens: first.caption.tokens, dim: first.caption.dim,
      },
    };
  }

  async rfLoop(text, caption, speaker, sequenceLength, {
    numSteps = 16,
    cfgText = 3,
    cfgCaption = 3,
    cfgSpeaker = 5,
    cfgMode = "independent",
    cfgExecution = "batched",
    cfgMinT = 0.5,
    cfgMaxT = 1,
    speakerUncondMode = "mask",
    schedule = "linear",
    swayCoeff = -1,
    initScale = 0.999,
    seed = 0,
    x0 = null,
    onStep = null,
  } = {}) {
    const size = sequenceLength * VOICEDESIGN_CONFIG.latentDim;
    let latent = x0 ? Float32Array.from(x0) : gaussianNoise(size, seed);
    if (latent.length !== size) throw new Error(`x0 length must be ${size}`);
    if (!["mask", "noise"].includes(speakerUncondMode)) {
      throw new Error(`unsupported speaker unconditional mode: ${speakerUncondMode}`);
    }
    const times = this._schedule(numSteps, schedule, swayCoeff, initScale);
    const conditional = this._singleBundle(text, speaker, caption);
    const droppedSpeaker = speakerUncondMode === "noise" && conditionEnabled(speaker)
      ? noiseCondition(speaker, Number(seed) ^ 0x51eade7)
      : dropCondition(speaker);
    const dropped = {
      text: this._singleBundle(dropCondition(text), cloneCondition(speaker), cloneCondition(caption)),
      speaker: this._singleBundle(cloneCondition(text), droppedSpeaker, cloneCondition(caption)),
      caption: this._singleBundle(cloneCondition(text), cloneCondition(speaker), dropCondition(caption)),
      joint: this._singleBundle(dropCondition(text), droppedSpeaker, dropCondition(caption)),
    };
    const enabled = [];
    if (cfgText > 0) enabled.push(["text", cfgText]);
    if (cfgSpeaker > 0 && conditionEnabled(speaker)) enabled.push(["speaker", cfgSpeaker]);
    if (cfgCaption > 0 && conditionEnabled(caption)) enabled.push(["caption", cfgCaption]);
    if (!["independent", "joint", "alternating"].includes(cfgMode)) throw new Error(`unsupported CFG mode: ${cfgMode}`);
    if (!["batched", "sequential"].includes(cfgExecution)) throw new Error(`unsupported CFG execution: ${cfgExecution}`);
    if (cfgMode === "joint" && enabled.length > 1) {
      const scales = enabled.map(([, scale]) => scale);
      if (Math.max(...scales) - Math.min(...scales) > 1e-6) throw new Error("joint CFG requires equal enabled scales");
    }

    for (let step = 0; step < numSteps; step++) {
      const time = times[step];
      const delta = times[step + 1] - time;
      const useCfg = enabled.length > 0 && time >= cfgMinT && time <= cfgMaxT;
      let velocity;
      if (!useCfg) {
        velocity = await this._runDit(latent, time, sequenceLength, conditional);
      } else if (cfgMode === "joint") {
        const condVelocity = await this._runDit(latent, time, sequenceLength, conditional);
        const uncondVelocity = await this._runDit(latent, time, sequenceLength, dropped.joint);
        const scale = enabled[0][1];
        velocity = new Float32Array(size);
        for (let i = 0; i < size; i++) velocity[i] = condVelocity[i] + scale * (condVelocity[i] - uncondVelocity[i]);
      } else if (cfgMode === "alternating") {
        const [name, scale] = enabled[step % enabled.length];
        const condVelocity = await this._runDit(latent, time, sequenceLength, conditional);
        const uncondVelocity = await this._runDit(latent, time, sequenceLength, dropped[name]);
        velocity = new Float32Array(size);
        for (let i = 0; i < size; i++) velocity[i] = condVelocity[i] + scale * (condVelocity[i] - uncondVelocity[i]);
      } else if (cfgExecution === "batched") {
        const bundles = [conditional, ...enabled.map(([name]) => dropped[name])];
        const repeated = new Float32Array(size * bundles.length);
        bundles.forEach((_, index) => repeated.set(latent, index * size));
        const all = await this._runDit(repeated, time, sequenceLength, this._batchedBundle(bundles));
        velocity = Float32Array.from(all.subarray(0, size));
        for (let branch = 0; branch < enabled.length; branch++) {
          const scale = enabled[branch][1];
          const offset = (branch + 1) * size;
          for (let i = 0; i < size; i++) velocity[i] += scale * (all[i] - all[offset + i]);
        }
      } else {
        const condVelocity = await this._runDit(latent, time, sequenceLength, conditional);
        velocity = Float32Array.from(condVelocity);
        for (const [name, scale] of enabled) {
          const uncondVelocity = await this._runDit(latent, time, sequenceLength, dropped[name]);
          for (let i = 0; i < size; i++) velocity[i] += scale * (condVelocity[i] - uncondVelocity[i]);
        }
      }
      const next = new Float32Array(size);
      for (let i = 0; i < size; i++) next[i] = latent[i] + velocity[i] * delta;
      latent = next;
      if (onStep) await onStep({ step: step + 1, numSteps, time });
    }
    return latent;
  }

  async decode(latent, sequenceLength) {
    const channelFirst = new Float32Array(VOICEDESIGN_CONFIG.latentDim * sequenceLength);
    for (let token = 0; token < sequenceLength; token++) {
      for (let channel = 0; channel < VOICEDESIGN_CONFIG.latentDim; channel++) {
        channelFirst[channel * sequenceLength + token] = latent[token * VOICEDESIGN_CONFIG.latentDim + channel];
      }
    }
    const output = await this.s.dac.run({
      z: this._tensor(channelFirst, [1, VOICEDESIGN_CONFIG.latentDim, sequenceLength]),
    });
    return output.audio.data;
  }

  async synthesize(textValue, captionValue, {
    speaker = noSpeakerCondition(), seconds = null, onStage = null, ...options
  } = {}) {
    // Keep the two tokenizers sequential. Some browser WASM runtimes share a
    // scratch buffer and can trap when both tokenizer calls start together.
    const text = await this.encodeText(textValue, onStage);
    const caption = await this.encodeCaption(captionValue, onStage);
    const sequenceLength = seconds === null || seconds === undefined
      ? await this._stage("duration", onStage,
          () => this.predictDuration(text, caption, speaker, options))
      : Math.max(1, Math.round(Number(seconds) * VOICEDESIGN_CONFIG.sampleRate / VOICEDESIGN_CONFIG.hopLength));
    const latent = await this._stage("dit", onStage,
      () => this.rfLoop(text, caption, speaker, sequenceLength, options));
    const decoded = await this._stage("decoder", onStage,
      () => this.decode(latent, sequenceLength));
    let trimmedSequenceLength = sequenceLength;
    if (options.trimTail !== false) {
      const flatteningPoint = findFlatteningPoint(latent, sequenceLength, {
        windowSize: options.tailWindowSize ?? 20,
        stdThreshold: options.tailStdThreshold ?? 0.05,
        meanThreshold: options.tailMeanThreshold ?? 0.1,
      });
      // The official runtime ignores a zero flattening point so a degenerate
      // candidate never becomes an empty audio buffer.
      if (flatteningPoint > 0) trimmedSequenceLength = Math.min(sequenceLength, flatteningPoint);
    }
    const maxSamples = trimmedSequenceLength * VOICEDESIGN_CONFIG.hopLength;
    let audio = decoded.length > maxSamples ? decoded.slice(0, maxSamples) : decoded;
    let trailingUtteranceTrimmed = false;
    if (options.trimTrailingUtterance === true && shouldTrimTrailingUtterance(textValue)) {
      const cutoff = findTrailingUtteranceCutoff(audio, VOICEDESIGN_CONFIG.sampleRate, {
        windowMs: options.utteranceWindowMs ?? 40,
        minSilenceMs: options.utteranceSilenceMs ?? 480,
        minResumedSpeechMs: options.utteranceResumeMs ?? 160,
      });
      if (cutoff < audio.length) {
        audio = fadeAudioTail(audio.slice(0, cutoff), VOICEDESIGN_CONFIG.sampleRate);
        trailingUtteranceTrimmed = true;
      }
    }
    return {
      audio,
      sampleRate: VOICEDESIGN_CONFIG.sampleRate,
      sequenceLength,
      trimmedSequenceLength,
      trailingUtteranceTrimmed,
    };
  }

  async synthesizeFromReference(text, caption, waveform, sampleRate, options = {}) {
    const speaker = await this._stage("reference_encoder", options.onStage,
      () => this.encodeReferenceAudio(waveform, sampleRate, options));
    return this.synthesize(text, caption, { ...options, speaker });
  }
}
