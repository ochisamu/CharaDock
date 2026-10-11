// SPDX-License-Identifier: Apache-2.0
(function(root, factory) {
  const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CharaDockMeshAvatar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const emotion = {happy:'happy',joy:'happy',proud:'happy',soft:'relaxed',thinking:'relaxed',worried:'sad',sad:'sad',angry:'angry',exasperated:'angry',surprised:'surprised',neutral:'neutral'};
  function create({engine, makeCanvas = () => document.createElement('canvas'), fetchImpl = (...args) => fetch(...args), now = () => performance.now(), onError = () => {}}) {
    let identity = '', characterId = '', player = null, canvas = null, request = null, error = '', pending = null, forced = null;
    let last = now(), expressionUntil = 0;
    function reset() { request?.abort(); request = null; player?.destroy(); player = canvas = pending = forced = null; expressionUntil = 0; }
    function expression(input = {}) {
      if (!identity || input.characterId && input.characterId !== characterId) return;
      if (!['emotion','reaction','nikePerformance','forceMouth','forceEyesClosed'].some(k => Object.hasOwn(input,k))) return;
      const duration = Math.max(100,Math.min(10000,Number(input.durationMs)||4500));
      pending = { ...input, until: now() + duration };
      if (!player) return;
      const tag = emotion[input.emotion] || emotion[input.reaction];
      if (tag) player.setEmotion(tag,{playMotion:false});
      const motion = {nod:'nod',ponder:'think',celebrate:'nod',recoil:'surprise',reassure:'sway',explain:'nod'}[input.nikePerformance];
      if (motion && player.motions.some(x => x.id === motion)) player.play(motion);
      forced = pending; expressionUntil = pending.until; pending = null;
    }
    async function sync(descriptor, id = '') {
      const valid = descriptor && /^[a-f0-9-]{36}$/.test(descriptor.id)
        && descriptor.rigUrl === `/api/mesh/${descriptor.id}/rig.json`
        && descriptor.assetsBase === `/api/mesh/${descriptor.id}/built/`;
      const next = valid ? `${id}:${descriptor.id}:${descriptor.version}` : '';
      if (next === identity) return;
      reset(); identity = next; characterId = id; error = '';
      if (!next || !engine) return;
      const loading = new AbortController(); request = loading;
      try {
        const response = await fetchImpl(descriptor.rigUrl,{signal:loading.signal});
        if (!response.ok) throw new Error('Mesh rig unavailable');
        const rig = await response.json();
        if (loading.signal.aborted || request !== loading) return;
        const surface = makeCanvas(); surface.width = descriptor.width; surface.height = descriptor.height;
        const loaded = await engine.create(surface,{rig,assetsBase:descriptor.assetsBase,manual:true,fit:'contain',preserveMouthOpen:true});
        if (loading.signal.aborted || request !== loading) { loaded.destroy(); return; }
        player = loaded; canvas = surface; last = now();
        if (pending && pending.until > now()) expression({...pending,durationMs:pending.until-now()});
        pending = null;
        player.advance(0); request = null;
      } catch (failure) {
        if (loading.signal.aborted || request !== loading) return;
        reset(); error = String(failure.message || failure); onError(failure);
      }
    }
    function draw({mouth = 0, level = 0, blink = false, gazeX = 0, gazeY = 0, motion = {}, reduced = false} = {}) {
      if (!player) return null;
      try {
        const current = now(), dt = Math.max(0,Math.min(.05,(current-last)/1000)); last = current;
        if (expressionUntil && current >= expressionUntil) { player.setEmotion('neutral',{playMotion:false}); expressionUntil = 0; forced = null; }
        const frozen = reduced || motion.idleMotionEnabled === false;
        player.setAutoIdle(!frozen); player.setAutoMotion(!frozen);
        player.setSwayGain(reduced ? 0 : Number(motion.hairWarp ?? 38)/38);
        player.setTalkGain(reduced ? 0 : Number(motion.pyokoStrength ?? 40)/40);
        player.setVoiceLevel(Math.max(0,Math.min(1,Number(level)||0)));
        player.setSpeaking(mouth > 0 || level > .005);
        const parameters = {mouthOpen:Math.max(0,Math.min(1,Number(mouth)||0)),gazeX:Math.max(-1,Math.min(1,gazeX)),gazeY:Math.max(-1,Math.min(1,gazeY))};
        if (blink || forced?.forceEyesClosed === true) parameters.eyeLOpen = parameters.eyeROpen = 0;
        if (Number.isInteger(forced?.forceMouth)) parameters.mouthOpen = Math.max(0,Math.min(2,forced.forceMouth))/2;
        if (reduced) Object.assign(parameters,{angleX:0,angleY:0,angleZ:0,bodyAngleX:0,bodyAngleZ:0,breath:0});
        player.setParameters(parameters); player.advance(dt,dt ? 1/dt : 60); return canvas;
      } catch (failure) { reset(); error = String(failure.message || failure); onError(failure); return null; }
    }
    return {sync,expression,draw,dispose(){reset();identity='';characterId='';},status:()=>({ready:Boolean(player),loading:Boolean(request),identity,error,parameters:player?.getParameters() || null})};
  }
  return {create};
});
