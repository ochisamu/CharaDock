// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NOGUCHI Shoji
// Irodori-TTS v4 Small browser runtime.
//
// V4 keeps the V3 latent/duration/CFG contract, but shares one ModernBERT
// backbone between text and caption and patches reference latents by four
// frames before the speaker encoder.

import {
  IrodoriVoiceDesignTTS,
  VOICEDESIGN_CONFIG,
  lufsNormalize,
  noSpeakerCondition,
} from "./voicedesign-pipeline.mjs";

export { noSpeakerCondition };

export const IRODORI_V4_CONFIG = Object.freeze({
  ...VOICEDESIGN_CONFIG,
  format: "irodori-tts-v4-webgpu-v1",
  backboneDim: 768,
  speakerPatchSize: 4,
  speakerPatchedLatentDim: 128,
  maxReferenceSeconds: 120,
});

export class IrodoriV4TTS extends IrodoriVoiceDesignTTS {
  constructor({ ort, sessions, tokenizer }) {
    super({
      ort,
      sessions: {
        text: sessions.text,
        caption: sessions.caption,
        duration: sessions.duration,
        dit: sessions.dit,
        dac: sessions.dac,
        speaker: sessions.speaker,
        enc: sessions.enc,
      },
      tokenizer,
      captionTokenizer: tokenizer,
    });
    if (!sessions.backbone) throw new Error("missing required ONNX session: backbone");
    this.s.backbone = sessions.backbone;
    this.captionCache = new Map();
    this.captionCacheHits = 0;
  }

  async _encodeV4(value, projector, outputName, dim, stagePrefix, onStage) {
    const ids = await this._stage(`${stagePrefix}_tokenizer`, onStage,
      () => this._tokenize(value, this.tokenizer, true));
    const tokens = ids.length;
    const inputIds = BigInt64Array.from(ids, (id) => BigInt(id));
    const mask = new Uint8Array(tokens).fill(1);
    const backboneOutput = await this._stage(`${stagePrefix}_backbone`, onStage,
      () => this.s.backbone.run({
        input_ids: this._tensor(inputIds, [1, tokens], "int64"),
        mask: this._tensor(mask, [1, tokens], "bool"),
      }));
    const projected = await this._stage(`${stagePrefix}_projector`, onStage,
      () => projector.run({
        backbone_state: backboneOutput.backbone_state,
        mask: this._tensor(mask, [1, tokens], "bool"),
      }));
    const tensor = projected[outputName];
    return { state: tensor.data, mask, tokens, dim: tensor.dims?.[2] ?? dim };
  }

  encodeText(text, onStage = null) {
    return this._encodeV4(text, this.s.text, "text_state", IRODORI_V4_CONFIG.textDim, "text", onStage);
  }

  async predictDuration(text, caption, speaker, options = {}) {
    const conditioned = await super.predictDuration(text, caption, speaker, options);
    if (options.guardReferenceDuration === false || !Array.from(speaker.mask).some(Boolean)) return conditioned;
    // Some reference embeddings add several seconds to short utterances. The
    // flow model fills that allocation with unrelated speech, even at 40 steps.
    // Compare the same text with both voice/style conditions disabled ONLY for
    // timing. Caption + reference can jointly inflate a short utterance. Keep
    // both for the actual synthesis. Leave ordinary tempo changes alone:
    // correction requires both a >1.5x ratio and >1 second surplus.
    const textOnly = await super.predictDuration(text, {
      state: new Float32Array(caption.dim), mask: new Uint8Array(1), tokens: 1, dim: caption.dim,
    }, noSpeakerCondition(), options);
    const surplusSeconds = (conditioned - textOnly) * IRODORI_V4_CONFIG.hopLength / IRODORI_V4_CONFIG.sampleRate;
    return conditioned > textOnly * 1.5 && surplusSeconds > 1 ? textOnly : conditioned;
  }

  async encodeCaption(caption, onStage = null) {
    const key = String(caption || "").trim();
    if (this.captionCache.has(key)) {
      const cached = this.captionCache.get(key);
      this.captionCache.delete(key);
      this.captionCache.set(key, cached);
      this.captionCacheHits += 1;
      return cached;
    }
    const encoded = await this._encodeV4(key, this.s.caption, "caption_state", IRODORI_V4_CONFIG.captionDim, "caption", onStage);
    this.captionCache.set(key, encoded);
    while (this.captionCache.size > 12) this.captionCache.delete(this.captionCache.keys().next().value);
    return encoded;
  }

  async wavToRefLatent(waveform, sampleRate, {
    normalizeDb = -16,
    ensureMax = true,
    maxRefSeconds = IRODORI_V4_CONFIG.maxReferenceSeconds,
  } = {}) {
    if (!this.s.enc) throw new Error("reference audio requires the dacvae_encoder session");
    if (sampleRate !== IRODORI_V4_CONFIG.sampleRate) {
      throw new Error(`reference audio must be ${IRODORI_V4_CONFIG.sampleRate} Hz`);
    }
    const maxSamples = maxRefSeconds > 0
      ? Math.floor(maxRefSeconds * sampleRate)
      : waveform.length;
    let normalized = Float32Array.from(waveform.subarray(0, maxSamples));
    if (normalizeDb !== null && normalizeDb !== undefined) {
      normalized = lufsNormalize(normalized, sampleRate, normalizeDb);
    } else if (ensureMax) {
      let peak = 0;
      for (const sample of normalized) peak = Math.max(peak, Math.abs(sample));
      if (peak > 1) for (let i = 0; i < normalized.length; i++) normalized[i] /= peak;
    }
    const paddedLength = Math.max(
      IRODORI_V4_CONFIG.hopLength * IRODORI_V4_CONFIG.speakerPatchSize,
      Math.ceil(normalized.length / IRODORI_V4_CONFIG.hopLength) * IRODORI_V4_CONFIG.hopLength,
    );
    const padded = new Float32Array(paddedLength);
    padded.set(normalized.subarray(0, paddedLength));
    const output = await this.s.enc.run({ wav: this._tensor(padded, [1, 1, paddedLength]) });
    return { latent: output.latent.data, tokens: output.latent.dims[1] };
  }

  async encodeReferenceLatent(refLatent, tokens, refMask = null) {
    if (!this.s.speaker) throw new Error("reference audio requires the speaker_encoder session");
    const patchSize = IRODORI_V4_CONFIG.speakerPatchSize;
    const patchedTokens = Math.floor(tokens / patchSize);
    if (patchedTokens < 1) throw new Error(`reference latent needs at least ${patchSize} frames`);
    const usedFrames = patchedTokens * patchSize;
    const patched = Float32Array.from(refLatent.subarray(
      0,
      usedFrames * IRODORI_V4_CONFIG.latentDim,
    ));
    const sourceMask = refMask ?? new Uint8Array(tokens).fill(1);
    const mask = new Uint8Array(patchedTokens);
    for (let token = 0; token < patchedTokens; token++) {
      let enabled = 1;
      for (let offset = 0; offset < patchSize; offset++) {
        enabled &= sourceMask[token * patchSize + offset] ? 1 : 0;
      }
      mask[token] = enabled;
    }
    const output = await this.s.speaker.run({
      ref_latent: this._tensor(
        patched,
        [1, patchedTokens, IRODORI_V4_CONFIG.speakerPatchedLatentDim],
      ),
      ref_mask: this._tensor(mask, [1, patchedTokens], "bool"),
    });
    return {
      state: output.speaker_state.data,
      mask: output.speaker_mask.data,
      tokens: output.speaker_state.dims[1],
      dim: output.speaker_state.dims[2],
    };
  }
}
