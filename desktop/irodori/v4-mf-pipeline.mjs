// SPDX-License-Identifier: Apache-2.0
// Opt-in experimental MeanFlow path.
// Sampler contract: Aratako/Irodori-TTS sample_euler_meanflow (MIT).
import { IrodoriV4TTS } from './v4-pipeline.mjs';
export { noSpeakerCondition } from './v4-pipeline.mjs';
import { gaussianNoise, VOICEDESIGN_CONFIG } from './voicedesign-pipeline.mjs';

export class IrodoriV4MeanFlowTTS extends IrodoriV4TTS {
  constructor({ modelConfig, ...options }) {
    if (modelConfig?.model?.flow_parameterization !== 'meanflow') {
      throw new Error('MeanFlow requires an explicitly identified MF checkpoint');
    }
    super(options);
    if (!this.s.dit.inputNames?.includes('delta_t')) {
      throw new Error('MeanFlow DiT must expose delta_t; RF graphs are incompatible');
    }
  }

  async rfLoop(text, caption, speaker, sequenceLength, options = {}) {
    const { numSteps = 4, seed = 0, x0 = null, onStep = null } = options;
    if (!Number.isInteger(numSteps) || numSteps < 1 || numSteps > 40) throw new Error('MF numSteps must be 1..40');
    if (!Number.isInteger(sequenceLength) || sequenceLength < 1) throw new Error('Invalid latent sequence length');
    // Reject RF controls instead of silently claiming they affect distilled guidance.
    for (const key of ['cfgText', 'cfgCaption', 'cfgSpeaker', 'cfgMode', 'cfgExecution', 'cfgMinT', 'cfgMaxT', 'swayCoeff', 'initScale', 'speakerUncondMode']) {
      if (options[key] !== undefined) throw new Error(`${key} is not a MeanFlow inference control`);
    }
    if (options.schedule !== undefined && options.schedule !== 'linear') throw new Error('MeanFlow uses a linear schedule');
    const size = sequenceLength * VOICEDESIGN_CONFIG.latentDim;
    const latent = x0 ? Float32Array.from(x0) : gaussianNoise(size, seed);
    if (latent.length !== size || !latent.every(Number.isFinite)) throw new Error('Invalid initial MF latent');
    const bundle = this._singleBundle(text, speaker, caption);
    for (let step = 0; step < numSteps; step++) {
      const time = Math.fround(1 - step / numSteps);
      const next = Math.fround(1 - (step + 1) / numSteps);
      const delta = Math.fround(time - next);
      const feeds = this._ditFeed(latent, time, sequenceLength, bundle);
      feeds.delta_t = this._tensor(new Float32Array([delta]), [1]);
      let result;
      try {
        result = await this.s.dit.run(feeds);
        const velocity = result.v?.data;
        if (velocity?.length !== size || !velocity.every(Number.isFinite)) throw new Error('Invalid MF velocity');
        for (let i = 0; i < size; i++) latent[i] -= delta * velocity[i];
        if (!latent.every(Number.isFinite)) throw new Error('Non-finite MF latent');
      } finally {
        for (const tensor of Object.values(feeds)) tensor.dispose?.();
        for (const tensor of Object.values(result || {})) tensor.dispose?.();
      }
      if (onStep) await onStep({ step: step + 1, numSteps, time });
    }
    return latent;
  }
}
