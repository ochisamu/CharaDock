// SPDX-License-Identifier: Apache-2.0
// Kohaku v9: one canonical head, single eye/lip layers, independent soft hair.
// Source: user-supplied Kohaku v9 handoff. No runtime model or network inference.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PuruPuruDrawnPoseRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function spring(value, velocity, target, dt, omega) {
    const offset = value - target, c = velocity + omega * offset, decay = Math.exp(-omega * dt);
    return [target + (offset + c * dt) * decay, (velocity - omega * c * dt) * decay];
  }
  function softSpring(value, velocity, target, dt, omega, damping) {
    // Exact damped solution: frame-rate independent, with a small, decaying
    // return after head movement. No fixed-duration/reset animation.
    if(damping>=.999)return spring(value,velocity,target,dt,omega);
    const offset=value-target,alpha=damping*omega,wd=omega*Math.sqrt(1-damping*damping);
    const s=Math.sin(wd*dt),c=Math.cos(wd*dt),decay=Math.exp(-alpha*dt);
    return [target+decay*(offset*c+(velocity+alpha*offset)/wd*s),
      decay*(velocity*c-(alpha*velocity+omega*omega*offset)/wd*s)];
  }
  function poseSamples(tilt, count) {
    // Include the full-resolution endpoints in the same continuous sequence.
    const f = clamp(tilt, 0, 1) * (count + 1), a = Math.floor(f), mix = f - a;
    return [{ index: a - 1, weight: 1 - mix }, { index: Math.min(count, a), weight: mix }].filter(s => s.weight > .000001);
  }
  const FEATURE_REGIONS = [[548,630,105,82],[764,579,95,80],[668,730,82,62],[549,542,76,32],[742,477,78,32]];
  function featureWarp(x, y, source, target) {
    let dx=0,dy=0;
    for(let i=0;i<Math.min(source.length,target.length,FEATURE_REGIONS.length);i++) {
      const [, ,rx,ry]=FEATURE_REGIONS[i], a=source[i],b=target[i];
      const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
      const radius=Math.hypot((x-cx)/rx,(y-cy)/ry), w=1-smooth((radius-.58)/.42);
      if(!w)continue;
      dx+=w*(b.x-a.x+(x-a.x)*(clamp(b.w/a.w,.4,1.8)-1));
      dy+=w*(b.y-a.y+(y-a.y)*(clamp(b.h/a.h,.35,1.8)-1));
    }
    return {x:x+clamp(dx,-24,24),y:y+clamp(dy,-32,32)};
  }
  function transformFeature(f, m) {
    const [a,b,c,d,e,g]=m;
    return {x:a*f.x+c*f.y+e,y:b*f.x+d*f.y+g,w:f.w*Math.hypot(a,b),h:f.h*Math.hypot(c,d)};
  }
  function inverseAffine(m) {
    const [a,b,c,d,e,f]=m,det=a*d-b*c;
    return [d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];
  }
  function mouthGeometry(value, closed, half, open) {
    // The closed smile is NEVER stretched into an open cavity. Open drawings
    // articulate below one fixed lip anchor instead of moving with their bbox.
    const v=clamp(value,0,2), aperture=v/2;
    const openWeight=smooth(v/.4), roundWeight=smooth(v-1);
    return {x:closed.x,top:closed.y+(open.y-open.h/2-closed.y)*aperture,
      width:half.w+(open.w-half.w)*aperture,height:Math.max(3,open.h*aperture),
      closedWeight:1-openWeight,halfWeight:openWeight*(1-roundWeight),openWeight:openWeight*roundWeight};
  }
  function headPoint(x, y, width, height, angle) {
    // One rigid face above the neck. Only the neck/shoulder band bends;
    // eyes, lip, nose and hair roots share EXACTLY the same rotation.
    const weight=1-smooth((y/height-.64)/.28),a=angle*weight;
    const cx=width*.54,cy=height*.69,dx=x-cx,dy=y-cy;
    return {x:cx+dx*Math.cos(a)-dy*Math.sin(a),y:cy+dx*Math.sin(a)+dy*Math.cos(a)};
  }
  function createFaceSwitcher(initial) {
    let file=initial,pending=initial,started=null,closedAt=null,committedAt=null;
    return {reset(){file=pending=initial;started=closedAt=committedAt=null;},
      update(now,wanted,blink=0,reduced=false) {
        pending=wanted;blink=clamp(blink,0,1);let changed=false,phase='idle';
        if(reduced){changed=file!==pending;file=pending;started=closedAt=committedAt=null;}
        else {
          if(started===null&&file!==pending){
            if(blink>=.995){file=pending;changed=true;}
            else started=now;
          }
          if(started!==null){
            if(closedAt===null){
              const age=Math.max(0,now-started);phase='closing';
              blink=Math.max(blink,smooth(age/150));
              if(age>=150){closedAt=now;blink=1;phase='closed';}
            } else if(committedAt===null){
              blink=1;phase='closed';
              // Present a fully closed frame before swapping. Do not combine
              // the last eyelid movement, eyebrow change and face colour jump
              // on one frame. New requests during reopening stay queued.
              if(now-closedAt>=70){changed=file!==pending;file=pending;committedAt=now;}
            } else {
              const age=Math.max(0,now-committedAt);phase=age<40?'closed':'opening';
              blink=Math.max(blink,1-smooth((age-40)/140));
              if(age>=180){started=closedAt=committedAt=null;phase='idle';}
            }
          }
        }
        return{file,pending,blink,changed,phase};
      }};
  }
  function eyeMask(data,width,height,center,allowed) {
    // Segment connected eye ink/white/iris, NOT the rectangular skin crop.
    // Border-connected hair/ears must never shrink with the eyelid.
    const candidate=new Uint8Array(width*height),seen=new Uint8Array(candidate.length),queue=new Int32Array(candidate.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      candidate[y*width+x]=Number((!allowed||allowed[y*width+x])&&data[i+3]>220&&(
        (r<115&&g<95&&b<95)||(r>140&&g>r*.90&&b>r*.80)||
        (r<238&&g>r*.28&&g<r*.73&&b<r*.43)||
        (r<250&&g<r*.70&&b<r*.65)));
    }
    let best=null;
    for(let p=0;p<candidate.length;p++)if(candidate[p]&&!seen[p]){
      let head=0,tail=1,x0=width,y0=height,x1=0,y1=0;queue[0]=p;seen[p]=1;
      while(head<tail){const q=queue[head++],x=q%width,y=Math.floor(q/width);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
          const k=ny*width+nx;if(candidate[k]&&!seen[k]){seen[k]=1;queue[tail++]=k;}
        }
      }
      if(tail<3||(!allowed&&(x0===0||y0===0||x1===width-1||y1===height-1)))continue;
      const distance=Math.hypot(((x0+x1)/2-center.x)/width,((y0+y1)/2-center.y)/height);
      const score=tail/(1+distance*10);
      if(!best||score>best.score)best={score,points:Array.from(queue.subarray(0,tail)),x0,y0,x1,y1};
    }
    const mask=new Uint8Array(candidate.length);
    if(best){
      for(const p of best.points)mask[p]=1;
      // Restore tiny gaps in antialiased lashes and enclose the eye's fill.
      for(let y=best.y0;y<=best.y1;y++){
        let left=width,right=-1;for(let x=best.x0;x<=best.x1;x++)if(mask[y*width+x]){left=Math.min(left,x);right=x;}
        for(let x=left;x<=right;x++)mask[y*width+x]=1;
      }
    }
    return mask;
  }
  function blinkPixels(source,closed,amount,result=new Uint8ClampedArray(source.pixels.length)) {
    // Warp eye ink toward the artist's curved closed lid, not a flat slit.
    // Bilinear premultiplied sampling avoids strip seams and transparent RGB
    // fringes. Cheek/skin pixels do not exist in this raster at all.
    const t=clamp(amount,0,1),lerp=(a,b)=>a+(b-a)*t;
    const left=lerp(source.x0,closed.x0),right=lerp(source.x1,closed.x1);
    result.fill(0);
    const profile=(s,x)=>{
      const a=Math.max(0,Math.min(s.width-1,Math.floor(x))),b=Math.min(s.width-1,a+1),f=x-a;
      return [s.columns[a][0]*(1-f)+s.columns[b][0]*f,s.columns[a][1]*(1-f)+s.columns[b][1]*f];
    };
    for(let x=Math.max(0,Math.floor(left)-1);x<=Math.min(source.width-1,Math.ceil(right)+1);x++){
      const u=(x-left)/Math.max(1,right-left),sx=source.x0+u*(source.x1-source.x0),cx=closed.x0+u*(closed.x1-closed.x0);
      if(sx<0||sx>=source.width-1)continue;
      const [s0,s1]=profile(source,sx),[c0,c1]=profile(closed,cx),top=lerp(s0,c0),bottom=lerp(s1,c1);
      const stretch=Math.max(1,bottom-top)/Math.max(1,s1-s0);
      for(let y=Math.max(0,Math.floor(top)-2);y<=Math.min(source.height-1,Math.ceil(bottom)+2);y++){
        const sy=s0+(y-top)/stretch;if(sy<0||sy>=source.height-1)continue;
        const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
        let alpha=0;const rgb=[0,0,0];
        for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){
          const i=((y0+dy)*source.width+x0+dx)*4,w=(dx?fx:1-fx)*(dy?fy:1-fy),a=source.pixels[i+3]*w;
          alpha+=a;for(let k=0;k<3;k++)rgb[k]+=source.pixels[i+k]*a;
        }
        const i=(y*source.width+x)*4;result[i+3]=alpha;
        if(alpha>0)for(let k=0;k<3;k++)result[i+k]=rgb[k]/alpha;
      }
    }
    return result;
  }
  const VARIANTS = ['open-closed', 'open-half', 'open-open', 'closed-closed', 'closed-half', 'closed-open'];
  const STATES = ['neutral', 'curious_tilt', 'attentive_listening', 'delighted_agreement', 'doubtful_side_eye', 'sleepy_yawn'];
  function stateForInput(input = {}) {
    // Every Jev Kohaku emotion has an authored destination. There is no
    // surprised drawing in this pack: use a curious tilt, not a manufactured
    // facial warp or an accidental neutral reset. Explicit faces win gestures.
    const faces={happy:'delighted_agreement',joy:'delighted_agreement',
      thinking:'curious_tilt',surprised:'curious_tilt',soft:'attentive_listening',
      worried:'attentive_listening',exasperated:'doubtful_side_eye'};
    const gestures={celebrate:'delighted_agreement',nod:'delighted_agreement',
      ponder:'curious_tilt',explain:'curious_tilt',recoil:'curious_tilt',reassure:'attentive_listening'};
    const reactions={happy:'delighted_agreement',thinking:'curious_tilt',surprised:'curious_tilt',
      listening:'attentive_listening',soft:'attentive_listening',sad:'attentive_listening'};
    if(Object.hasOwn(faces,input.emotion))return faces[input.emotion];
    if(Object.hasOwn(gestures,input.nikePerformance))return gestures[input.nikePerformance];
    if(Object.hasOwn(reactions,input.reaction))return reactions[input.reaction];
    return 'neutral';
  }
  function validateManifest(m) {
    if (!m || m.schema !== 'charadock-drawn-pose-v1') throw new Error('Unsupported drawn pose schema');
    if (![m.width, m.height].every(n => Number.isInteger(n) && n >= 128 && n <= 4096)) throw new Error('Invalid canvas dimensions');
    if (!Number.isInteger(m.decodeSize) || m.decodeSize < 128 || m.decodeSize > 768) throw new Error('Invalid decode size');
    const paths = new Set(); let decodedBytes = 0;
    const add = (file, w = m.width, h = m.height) => {
      if (typeof file !== 'string' || !/^[a-zA-Z0-9_./-]+\.png$/.test(file) || file.includes('..') || file.startsWith('/')) throw new Error('Asset paths must be package-local PNGs');
      if (paths.has(file)) return;
      paths.add(file); const scale = Math.min(1, m.decodeSize / Math.max(w, h));
      decodedBytes += Math.round(w * scale) * Math.round(h * scale) * 4;
    };
    if (!m.poses?.neutral || !VARIANTS.every(k => m.poses.neutral.variants?.[k])) throw new Error('Neutral requires six variants');
    for (const [name, pose] of Object.entries(m.poses)) {
      if (!STATES.includes(name) || !pose.variants?.['open-closed']) throw new Error('Invalid pose');
      add(pose.hair);
      for (const [key, value] of Object.entries(pose.variants)) { if (!VARIANTS.includes(key)) throw new Error('Invalid variant'); add(value); }
    }
    for (const clip of m.transitions || []) {
      if (!m.poses[clip.from] || !m.poses[clip.to] || clip.from === clip.to || !Array.isArray(clip.frames) || clip.frames.length < 2 || clip.frames.length > 64) throw new Error('Invalid transition');
      if (![clip.width, clip.height].every(n => Number.isInteger(n) && n >= 128 && n <= 768) || !Number.isFinite(clip.durationMs) || clip.durationMs < 400 || clip.durationMs > 5000) throw new Error('Invalid transition timing/size');
      for (const f of clip.frames) { add(f.base, clip.width, clip.height); add(f.hair, clip.width, clip.height); }
    }
    if (m.cels) {
      add(m.cels.mask);
      for (const [name, seq] of Object.entries(m.cels.sequences)) {
        if (!STATES.includes(name) || seq.frames.length !== 3 || !Number.isFinite(seq.durationMs) || seq.durationMs < 1000 || seq.durationMs > 5000) throw new Error('Invalid cel sequence');
        seq.frames.forEach(f => add(f));
      }
    }
    if (paths.size > 140 || decodedBytes > 160 * 1024 * 1024) throw new Error('Decoded pose budget exceeds limit');
    return { decodedBytes, imageCount: paths.size };
  }
  // Each authored sequence interpolates drawings, not a manufactured face yaw.
  function celWeights(phase) {
    const keys = [[0, -1], [.09, -1], [.24, 0], [.39, 1], [.53, 1], [.71, 2], [.90, -1], [1, -1]];
    phase = clamp(phase, 0, 1);
    const end = keys.findIndex(k => k[0] >= phase);
    if (end <= 0) return [{ index: -1, weight: 1 }];
    const a = keys[end - 1], b = keys[end], t = smooth((phase - a[0]) / (b[0] - a[0]));
    return a[1] === b[1] ? [{ index: a[1], weight: 1 }] : [{ index: a[1], weight: 1 - t }, { index: b[1], weight: t }];
  }
  function createController(manifest) {
    const budget = validateManifest(manifest);
    let last = null, now = 0, tilt = 0, tiltTarget = 0, tiltVelocity = 0;
    let sequence = null, deadline = 0, mouth = 0, blink = false, reduced = false;
    let presentedCels = [], carriedCels = [], fadeStarted = 0, releaseStarted = null;
    let mouthValue = 0, blinkAmount = 0, blinkVelocity = 0, speechMix = 0, speechMixVelocity = 0;
    const life = { x: 0, y: 0, rotation: 0, scale: 0, head: 0, chest: 0, accent: 0 };
    const lifeVelocity = Object.fromEntries(Object.keys(life).map(k => [k, 0]));
    let speechUntil = 0, lastActivity = 0, nextYawn = 90000;
    const hair = [0, 0, 0], velocities = [0, 0, 0];
    const hairMiddle=[0,0,0],middleVelocities=[0,0,0],hairY=[0,0,0],yVelocities=[0,0,0];
    let hairAmount=1,frozenHair=false;
    function reset() { last = null; tilt = tiltTarget = tiltVelocity = 0; sequence = null; presentedCels = carriedCels = []; deadline = 0; releaseStarted = null; speechUntil = 0; mouthValue = blinkAmount = blinkVelocity = speechMix = speechMixVelocity = 0; for(const a of [hair,velocities,hairMiddle,middleVelocities,hairY,yVelocities])a.fill(0);hairAmount=1;frozenHair=false; for (const k of Object.keys(life)) life[k] = lifeVelocity[k] = 0; lastActivity = now; nextYawn = now + 90000; }
    function retarget(target) {
      if (target === tiltTarget) return;
      tiltTarget = target; // Keep current position AND velocity on interruption.
    }
    function trigger(name, ms = now, holdMs = 4500) {
      if (!STATES.includes(name)) return false;
      now = Number.isFinite(ms) ? ms : now; lastActivity = now; nextYawn = now + 90000;
      if (last === null) last = now;
      const changing=sequence?.name !== name;
      const fromExpression=presentedCels.some(f=>f.index>=0)||tilt>.02;
      if (changing && (presentedCels.length || fromExpression)) {
        carriedCels = presentedCels.length ? presentedCels.map(f => ({ ...f })) : [{index:-1,weight:1}];
        fadeStarted = now;
      }
      deadline = now + clamp(holdMs, 500, 10000);
      releaseStarted = null;
      if (name === 'curious_tilt') { sequence = null; retarget(1); }
      else {
        retarget(0);
        // Repeated identical decisions do not restart the onset animation.
        if (name === 'neutral') sequence = null;
        else if (changing) sequence = { name, started: now, startPhase: fromExpression ? .24 : 0 };
      }
      return true;
    }
    function update(ms, input = {}) {
      now = Number.isFinite(ms) ? ms : now;
      const elapsed = last === null ? 0 : Math.max(0, (now - last) / 1000), dt = Math.min(.5, elapsed); last = now;
      reduced = Boolean(input.reducedMotion);
      mouth = Math.round(clamp(input.mouthState ?? (input.audioLevel > .28 ? 2 : input.audioLevel > .055 ? 1 : 0), 0, 2));
      blink = Boolean(input.blinkClosed);
      const mouthTarget=clamp(input.mouthOpenness ?? mouth,0,2);
      mouthValue += (mouthTarget - mouthValue) * (1 - Math.exp(-dt * (mouthTarget>mouthValue?24:18)));
      [blinkAmount,blinkVelocity] = spring(blinkAmount,blinkVelocity,blink?1:0,dt,blink?36:24);
      if (mouthTarget>.015 || input.audioLevel > .015 || input.speaking) { speechUntil = now + 180; lastActivity = now; }
      [speechMix, speechMixVelocity] = spring(speechMix, speechMixVelocity, now < speechUntil ? 1 : 0, dt, 28);
      if (input.interacting) lastActivity = now;
      if (deadline && now > deadline) { retarget(0); deadline = 0; releaseStarted = now; }
      // Audio and blink never cancel an authored transition or reset its pose.
      if (reduced) { tilt = tiltTarget; tiltVelocity = 0; }
      else [tilt, tiltVelocity] = spring(tilt, tiltVelocity, tiltTarget, elapsed, 3.4);
      tilt = clamp(tilt, 0, 1);
      if (Math.abs(tilt - tiltTarget) < .0001) {
        tilt = tiltTarget; tiltVelocity = 0;
      }
      if (!sequence && tilt === 0 && now - lastActivity > 60000 && now > nextYawn && !input.interacting && now > speechUntil && !reduced) {
        sequence = { name: 'sleepy_yawn', started: now }; deadline = now + 2300; releaseStarted = null; nextYawn = now + 90000;
      }
      let celPhase = 0;
      if (sequence) {
        // Onset -> peak -> hold. Do not silently revert to neutral mid-sentence.
        // A change of emotion goes directly to the incoming onset drawing,
        // not old emotion -> neutral -> new emotion (a visible facial flash).
        celPhase = releaseStarted === null ? Math.min(.45, (sequence.startPhase || 0) + (now - sequence.started) / 1200) : .55 + (now - releaseStarted) / 1200;
        if (celPhase >= 1) { sequence = null; celPhase = 0; }
      }
      let cels = sequence ? celWeights(reduced ? .45 : celPhase).map(f => ({ ...f, name: sequence.name })) : [];
      if (carriedCels.length) {
        const mix = reduced ? 1 : smooth((now - fadeStarted) / 360);
        cels = [...carriedCels.map(f => ({ ...f, weight: f.weight * (1 - mix) })),
          ...(cels.length ? cels : [{ index: -1, weight: 1 }]).map(f => ({ ...f, weight: f.weight * mix }))].filter(f => f.weight > .0001);
        if (mix === 1) carriedCels = [];
      }
      // Bound repeated interruptions to one weight per original drawing.
      const merged = new Map();
      for(const f of cels) { const id = `${f.name || ''}:${f.index}`; const old = merged.get(id); merged.set(id, { ...f, weight: f.weight + (old?.weight || 0) }); }
      cels = [...merged.values()]; presentedCels = cels;
      const seconds = now / 1000, idle = input.idleEnabled === false ? 0 : 1;
      const breath = clamp(input.breathStrength ?? .59, 0, 1), roll = clamp(input.rollStrength ?? .42, 0, 1);
      const voice = clamp(input.audioLevel, 0, 1) * clamp(input.voiceMotion ?? .42, 0, 2);
      const joy = sequence?.name === 'delighted_agreement' ? 1 : 0;
      const beat = joy ? Math.sin(Math.PI * clamp((now - sequence.started) / 650, 0, 1)) ** 2 : 0;
      const targets = {
        // The 1254px painting is scaled down for the desktop mascot: tiny
        // source-space offsets disappeared at that size. Use visible, slow
        // XY drift and breathing, keeping the entire face on one rigid head.
        x: idle * (Math.sin(seconds * .68 + .2) * 20 + Math.sin(seconds * .31) * 7.2) * breath,
        y: idle * Math.sin(seconds * .94) * 14.8 * breath - voice * 12 - beat * 6,
        rotation: idle * (Math.sin(seconds * .73) * .034 + Math.sin(seconds * .37 + 1) * .009) * roll,
        scale: idle * Math.sin(seconds * 1.13) * .015 * breath + voice * .002,
        head: idle * (Math.sin(seconds * 1.37) * .012 + Math.sin(seconds * .69 + .3) * .007) * roll + beat * .012,
        chest: idle * Math.sin(seconds * 1.13 - .5) * breath,
        accent: voice,
      };
      for(const k of Object.keys(life)) {
        if(reduced || input.freeze) { life[k] = lifeVelocity[k] = 0; }
        else [life[k], lifeVelocity[k]] = spring(life[k], lifeVelocity[k], targets[k], dt, k === 'head' ? 8 : k === 'accent' ? 12 : 6);
      }
      hairAmount=clamp(input.hairStrength ?? 1,0,2);frozenHair=Boolean(input.freeze);
      const softness=clamp(input.hairSpring ?? 1,0,2);
      for(let i=0;i<3;i++) {
        if(reduced||frozenHair||hairAmount===0){for(const a of [hair,velocities,hairMiddle,middleVelocities,hairY,yVelocities])a[i]=0;continue;}
        const wind=idle*(Math.sin(seconds*.86-i*.56)*(43+i*3.5)+Math.sin(seconds*1.43+i*1.7)*6.5);
        const inertia=-tiltVelocity*(6.5+i*1.3)-lifeVelocity.head*(185+i*35)-lifeVelocity.rotation*100-lifeVelocity.x*.35;
        const target=(wind+inertia)*hairAmount,omega=(5.4-i*.45)/(1+softness*.46);
        [hairMiddle[i],middleVelocities[i]]=spring(hairMiddle[i],middleVelocities[i],target*.7,dt,omega*1.6);
        [hair[i],velocities[i]]=softSpring(hair[i],velocities[i],target,dt,omega,1-Math.min(.24,softness*.22));
        const lift=(idle*Math.sin(seconds*.97-i*.8)*(12.5+i*1.5)-lifeVelocity.y*.28)*hairAmount;
        [hairY[i],yVelocities[i]]=softSpring(hairY[i],yVelocities[i],lift,dt,omega*.9,.84);
      }
      return { pose: tilt > .001 ? 'curious_tilt' : sequence?.name || 'neutral', tilt, now,
        transitionFrame: null, tiltRenderer:'shared-rigid-head',
        cels, mouthState: mouth, blinkClosed: blink, mouthValue, blinkAmount, speechMix,
        speaking: now < speechUntil, reducedMotion: reduced, hair: [...hair], hairMiddle:[...hairMiddle],hairY:[...hairY],life: { ...life }, tiltVelocity, ...budget };
    }
    function hairPoint(x, y, externalWarp) {
      if (reduced||frozenHair||hairAmount===0) return { x, y };
      const nx = x / manifest.width, ny = y / manifest.height,u=clamp((ny-.24)/.49,0,1),weight=smooth(u);
      const center = [(.73 + tilt * .012) * manifest.width, (.235 - tilt * .023) * manifest.height];
      const accessory = 1 - smooth((Math.hypot((x - center[0]) / (.18 * manifest.width), (y - center[1]) / (.17 * manifest.height)) - .8) / .35);
      const f = clamp(nx * 2, 0, 2), a = Math.floor(f), b = Math.min(2, a + 1);
      const sample=values=>values[a]*(1-(f-a))+values[b]*(f-a),tip=sample(hair),middle=sample(hairMiddle);
      // Upper lengths follow sooner, tips continue floating. The depth blend
      // produces a bend rather than translating the entire hair as one sheet.
      let dx=middle*(1-u*u)+tip*u*u+(tip-middle)*Math.sin(u*Math.PI)*.35;
      let dy=sample(hairY)*u-Math.abs(dx)*.09*Math.sin(u*Math.PI);
      dx=48*Math.tanh(dx/48);dy=20*Math.tanh(dy/20);
      if (externalWarp) { const p = externalWarp(x, y); if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) { dx = clamp(p.x - x, -7, 7); dy = clamp(p.y - y, -3, 3); } }
      return { x: x + dx * weight * (1 - accessory), y: y + dy * weight * (1 - accessory) };
    }
    return { reset, trigger, update, hairPoint };
  }

  // Local patches are registered with three landmarks. Never affine-warp the
  // entire authored face/body, nor combine a neutral face with tilted hair.
  function landmarkTransform(tilt) {
    const source = [[548, 640], [758, 590], [668, 730]], destination = [[562, 675], [759, 554], [706, 718]];
    const [a, b, c] = source, target = source.map((p, i) => p.map((v, j) => v + (destination[i][j] - v) * clamp(tilt, 0, 1)));
    const [p, q, r] = target, den = (b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    const A = ((q[0]-p[0])*(c[1]-a[1])-(r[0]-p[0])*(b[1]-a[1]))/den;
    const B = ((q[1]-p[1])*(c[1]-a[1])-(r[1]-p[1])*(b[1]-a[1]))/den;
    const C = ((r[0]-p[0])*(b[0]-a[0])-(q[0]-p[0])*(c[0]-a[0]))/den;
    const D = ((r[1]-p[1])*(b[0]-a[0])-(q[1]-p[1])*(c[0]-a[0]))/den;
    return [A, B, C, D, p[0]-A*a[0]-C*a[1], p[1]-B*a[0]-D*a[1]];
  }

  function createCanvasHairRenderer(width, height) {
    const canvas = document.createElement('canvas');
    const scale=Math.min(1,640/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d'); if(!ctx)return null;ctx.setTransform(scale,0,0,scale,0,0);
    const cols=12, rows=14;
    const triangle=(image,s,d)=>{
      const [a,b,c]=s,[p,q,r]=d;
      const den=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
      if(Math.abs(den)<.0001)return;
      const A=((q.x-p.x)*(c.y-a.y)-(r.x-p.x)*(b.y-a.y))/den;
      const B=((q.y-p.y)*(c.y-a.y)-(r.y-p.y)*(b.y-a.y))/den;
      const C=((r.x-p.x)*(b.x-a.x)-(q.x-p.x)*(c.x-a.x))/den;
      const D=((r.y-p.y)*(b.x-a.x)-(q.y-p.y)*(c.x-a.x))/den;
      // Slight clip overlap removes Canvas2D antialias cracks between triangles.
      const center={x:(p.x+q.x+r.x)/3,y:(p.y+q.y+r.y)/3};
      const expand=v=>{const dx=v.x-center.x,dy=v.y-center.y,n=Math.hypot(dx,dy)||1;return{x:v.x+dx/n*(.85/scale),y:v.y+dy/n*(.85/scale)};};
      const ep=expand(p),eq=expand(q),er=expand(r);
      ctx.save();ctx.beginPath();ctx.moveTo(ep.x,ep.y);ctx.lineTo(eq.x,eq.y);ctx.lineTo(er.x,er.y);ctx.closePath();ctx.clip();
      ctx.transform(A,B,C,D,p.x-A*a.x-C*a.y,p.y-B*a.x-D*a.y);ctx.drawImage(image,0,0,width,height);ctx.restore();
    };
    return {kind:'canvas2d-fallback',draw(image,warp){ctx.clearRect(0,0,width,height);
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const a={x:x*width/cols,y:y*height/rows},b={x:(x+1)*width/cols,y:a.y},c={x:a.x,y:(y+1)*height/rows},d={x:b.x,y:c.y};
        const da=warp(a.x,a.y),db=warp(b.x,b.y),dc=warp(c.x,c.y),dd=warp(d.x,d.y);
        triangle(image,[a,c,b],[da,dc,db]);triangle(image,[b,c,d],[db,dc,dd]);
      }return canvas;},dispose(){canvas.width=1;canvas.height=1;}};
  }
  function createHairRenderer(width, height, detail = false) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true});
    if (!gl) return createCanvasHairRenderer(width,height);
    let lost = false;
    canvas.addEventListener('webglcontextlost', e => {e.preventDefault(); lost = true;});
    canvas.addEventListener('webglcontextrestored', () => {lost = true;});
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 uv;uniform vec2 size;varying vec2 v;void main(){gl_Position=vec4(p/size*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);v=uv;}');
    const fragment = shader(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,v);}');
    gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Hair shader linking failed');
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.useProgram(program); gl.uniform2f(gl.getUniformLocation(program,'size'), width,height);
    const cols = detail ? 64 : 28, rows = detail ? 64 : 24, coords = [], indices = [];
    for (let y=0;y<=rows;y++) for(let x=0;x<=cols;x++) coords.push(x/cols,y/rows);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;indices.push(a,c,b,b,c,d);}
    const uv = new Float32Array(coords), positions = new Float32Array(coords.length);
    function attribute(name, data) {const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);return b;}
    const uvBuffer=attribute('uv',uv); const positionBuffer=attribute('p',positions);
    const indexBuffer=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    const textures=new Map();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.disable(gl.BLEND);
    return { kind:'webgl', draw(image, warp, dynamic = false) {
      if(lost) return null;
      let texture=textures.get(image); if(!texture){texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);textures.set(image,texture);if(textures.size>8){const oldest=textures.keys().next().value;gl.deleteTexture(textures.get(oldest));textures.delete(oldest);}} else gl.bindTexture(gl.TEXTURE_2D,texture);
      if(dynamic)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,image);
      for(let i=0;i<coords.length;i+=2){const p=warp(coords[i]*width,coords[i+1]*height);positions[i]=p.x;positions[i+1]=p.y;}
      gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,positions);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);return canvas;
    }, dispose(){for(const t of textures.values())gl.deleteTexture(t);textures.clear();gl.deleteBuffer(uvBuffer);gl.deleteBuffer(positionBuffer);gl.deleteBuffer(indexBuffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;} };
  }

  async function createPlayer({ manifestUrl, signal, canvasOnly = false }) {
    const response = await fetch(manifestUrl, { signal }); if (!response.ok) throw new Error(`Pose manifest ${response.status}`);
    const manifest = await response.json(), controller = createController(manifest), loaded = new Map(), base = new URL(manifestUrl, document.baseURI);
    let hairRenderer = null, bodyRenderer = null, disposed = false, output = null, releaseMouth = null;
    const load = async (file, width = manifest.width, height = manifest.height) => {
      if (loaded.has(file)) return loaded.get(file);
      const r = await fetch(new URL(file, base), { signal }); if (!r.ok) throw new Error(`Missing pose asset: ${file}`);
      const blob = await r.blob(), raw = await createImageBitmap(blob);
      if (raw.width !== width || raw.height !== height) { raw.close(); throw new Error(`Registration mismatch: ${file}`); }
      const scale = Math.min(1, manifest.decodeSize / Math.max(width, height));
      let image = raw;
      if (scale < 1) { try { image = await createImageBitmap(raw, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale), resizeQuality: 'high' }); } finally { raw.close(); } }
      if (signal?.aborted) { image.close(); throw new Error('Pose loading aborted'); }
      loaded.set(file, image); return image;
    };
    const dispose = () => { if (disposed) return; disposed = true; hairRenderer?.dispose(); bodyRenderer?.dispose(); hairRenderer = bodyRenderer = null; releaseMouth?.(); releaseMouth=null; for (const im of loaded.values()) im.close(); loaded.clear(); };
    try {
      // The supplied optical-flow tilt is a two-key pilot, NOT a six-variant
      // face rig. Never combine its changing face with neutral feature patches.
      const neutral=manifest.poses.neutral;
      await load(neutral.hair);for(const file of Object.values(neutral.variants))await load(file);
      await load(manifest.cels.mask);
      for (const seq of Object.values(manifest.cels.sequences)) for (const file of seq.frames) await load(file);
      const size = manifest.decodeSize, makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
      const faceCanvas = makeCanvas(), faceCtx = faceCanvas.getContext('2d'), celCanvas = makeCanvas(), celCtx = celCanvas.getContext('2d');
      const hairCanvas = makeCanvas(), hairCtx = hairCanvas.getContext('2d'), patchCanvas = makeCanvas(), patchCtx = patchCanvas.getContext('2d');
      const maskCanvas = makeCanvas(), maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      maskCtx.drawImage(loaded.get(manifest.cels.mask), 0, 0, size, size);
      const mask = maskCtx.getImageData(0, 0, size, size);
      // Keep the authored jaw/cheek/hair silhouette. Facial artwork must never
      // replace a moving head outline with a differently registered neutral jaw.
      const radius=Math.max(1,Math.round(size/manifest.width*20)), horizontal=new Uint8Array(size*size);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
        let min=255;for(let d=-radius;d<=radius;d++)min=Math.min(min,x+d>=0&&x+d<size?mask.data[(y*size+x+d)*4]:0);
        horizontal[y*size+x]=min;
      }
      for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
        let min=255;for(let d=-radius;d<=radius;d++)min=Math.min(min,y+d>=0&&y+d<size?horizontal[(y+d)*size+x]:0);
        mask.data[(y*size+x)*4+3]=min;
      }
      // The supplied mask stops between some high and low eyebrow drawings.
      // Own BOTH registered brow regions, otherwise an old brow survives
      // outside the face plate and becomes a second eyebrow after a swap.
      faceCtx.drawImage(loaded.get(neutral.variants['open-closed']),0,0,size,size);
      const neutralPixels=faceCtx.getImageData(0,0,size,size);faceCtx.clearRect(0,0,size,size);
      for(const [x,y,w,h]of [[442,490,190,83],[642,418,190,105]]){
        const scale=size/manifest.width,left=Math.floor(x*scale),top=Math.floor(y*scale),right=Math.ceil((x+w)*scale),bottom=Math.ceil((y+h)*scale);
        for(let yy=top;yy<bottom;yy++)for(let xx=left;xx<right;xx++){
          const i=(yy*size+xx)*4,edge=Math.min(xx-left,yy-top,right-1-xx,bottom-1-yy);
          mask.data[i+3]=Math.max(mask.data[i+3],neutralPixels.data[i+3]*smooth(edge/Math.max(1,8*scale)));
        }
      }
      maskCtx.putImageData(mask, 0, 0);
      try { hairRenderer = canvasOnly ? createCanvasHairRenderer(size, size) : createHairRenderer(size, size); }
      catch { hairRenderer = createCanvasHairRenderer(size, size); }
      try { bodyRenderer = canvasOnly ? createCanvasHairRenderer(size, size) : createHairRenderer(size, size); }
      catch { bodyRenderer = createCanvasHairRenderer(size, size); }
      const features = new Map(), mouthMasks=new Map(), featureCanvas=makeCanvas(), featureCtx=featureCanvas.getContext('2d',{willReadFrequently:true});
      function featureBounds(file) {
        if(features.has(file))return features.get(file);
        featureCtx.clearRect(0,0,size,size);featureCtx.drawImage(loaded.get(file),0,0,size,size);
        const data=featureCtx.getImageData(0,0,size,size).data, scale=size/manifest.width;
        const boxes=[[480,574,145,108],[702,508,130,122],[610,650,116,136],[480,510,145,62],[675,445,142,62]];
        const frameIndex=manifest.transitions[0].frames.findIndex(f=>f.base===file);
        const poseAmount=file===manifest.poses.curious_tilt.variants['open-closed']?1:frameIndex<0?0:(frameIndex+1)/(manifest.transitions[0].frames.length+1);
        const searchTransform=landmarkTransform(poseAmount),[A,B,C,D,E,F]=searchTransform;
        const result=boxes.map((box,n)=>{
          // Follow the posed head when searching. A fixed eyebrow/mouth ROI
          // can miss the drawing entirely at tilt and invent a neutral anchor.
          const [bx,by,bw,bh]=box;
          const corners=[[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]].map(([x,y])=>[A*x+C*y+E,B*x+D*y+F]);
          const x=Math.min(...corners.map(p=>p[0])),y=Math.min(...corners.map(p=>p[1]));
          const w=Math.max(...corners.map(p=>p[0]))-x,h=Math.max(...corners.map(p=>p[1]))-y;
          const left=Math.floor(x*scale),top=Math.floor(y*scale),W=Math.ceil(w*scale),H=Math.ceil(h*scale);
          const dark=new Uint8Array(W*H),seen=new Uint8Array(W*H), queue=new Int32Array(W*H);
          for(let yy=0;yy<H;yy++)for(let xx=0;xx<W;xx++) {
            const i=((top+yy)*size+left+xx)*4;
            // A mouth includes the warm inner fill, not just its darkest
            // corner: treating that tiny corner as the whole lip made morphs
            // pull the open mouth away from the outgoing smile.
            const ink=n===2?data[i+1]<data[i]*.63&&data[i+2]<data[i]*.56:
              n>=3?data[i]<210&&data[i+1]<data[i]*.64&&data[i+2]<data[i]*.56:
              data[i]<115&&data[i+1]<85&&data[i+2]<85;
            dark[yy*W+xx]=Number(data[i+3]>220&&ink);
          }
          let best=null;const components=[];
          for(let i=0;i<dark.length;i++)if(dark[i]&&!seen[i]) {
            let head=0,tail=1,x0=W,y0=H,x1=0,y1=0;queue[0]=i;seen[i]=1;
            while(head<tail){const p=queue[head++],xx=p%W,yy=Math.floor(p/W);x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);
              for(const [nx,ny] of [[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]])if(nx>=0&&nx<W&&ny>=0&&ny<H){const q=ny*W+nx;if(dark[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}}
            }
            // Thin closed lips have fewer pixels than the jaw shadow after
            // downsampling. A component cut by the mouth ROI is not a lip.
            if(n===2&&(x0===0||x1===W-1||y0===0||y1===H-1))continue;
            components.push({area:tail,x0,y0,x1,y1,points:n===2?Array.from(queue.subarray(0,tail)):null});
            if(!best||tail>best.area)best={area:tail,x0,y0,x1,y1};
          }
          if(n===2&&best) {
            // The fine smile becomes several disconnected strokes at 640px.
            // Join nearby lip strokes, rather than erasing only its largest
            // fragment and leaving the other corner behind the speech mouth.
            const gap=14*scale;
            for(let pass=0;pass<components.length;pass++)for(const c of components) {
              if(c.x0>best.x1+gap||c.x1<best.x0-gap||c.y0>best.y1+gap||c.y1<best.y0-gap)continue;
              best={...best,x0:Math.min(best.x0,c.x0),x1:Math.max(best.x1,c.x1),y0:Math.min(best.y0,c.y0),y1:Math.max(best.y1,c.y1)};
            }
            const pixels=[];
            for(const c of components)if(c.x0>=best.x0&&c.x1<=best.x1&&c.y0>=best.y0&&c.y1<=best.y1)
              for(const p of c.points)pixels.push([left+p%W,top+Math.floor(p/W)]);
            mouthMasks.set(file,pixels);
          }
          if(n<2&&components.length) {
            // Include lash fragments as well as the iris in the eye crop.
            const eye=components.filter(c=>c.area>=3);
            if(eye.length)best={area:eye.reduce((s,c)=>s+c.area,0),x0:Math.min(...eye.map(c=>c.x0)),x1:Math.max(...eye.map(c=>c.x1)),y0:Math.min(...eye.map(c=>c.y0)),y1:Math.max(...eye.map(c=>c.y1))};
          }
          if(!best||best.area<5)return transformFeature({x:FEATURE_REGIONS[n][0],y:FEATURE_REGIONS[n][1],w:70,h:25},searchTransform);
          return{x:(left+(best.x0+best.x1)/2)/scale,y:(top+(best.y0+best.y1)/2)/scale,w:Math.max(12,(best.x1-best.x0+1)/scale),h:Math.max(8,(best.y1-best.y0+1)/scale)};
        });features.set(file,result);return result;
      }
      for(const file of [manifest.poses.neutral.variants['open-closed'],...Object.values(manifest.cels.sequences).flatMap(s=>s.frames)])featureBounds(file);
      // Extract lip pixels once, and remove them from each source BEFORE any
      // pose/expression blending. A final overlay cannot erase differently
      // located mouths already blended into the presented face.
      const mouthShapes=['open-closed','open-half','open-open'].map(key=>featureBounds(manifest.poses.neutral.variants[key])[2]);
      const spriteCache=new Map();
      releaseMouth=()=>{for(const p of spriteCache.values()){p.image.width=p.image.height=p.skin.width=p.skin.height=1;}spriteCache.clear();mouthMasks.clear();features.clear();};
      function mouthSprite(file) {
        if(spriteCache.has(file))return spriteCache.get(file);
        const b=featureBounds(file)[2],scale=size/manifest.width,pad=8;
        const left=Math.floor((b.x-b.w/2-pad)*scale),top=Math.floor((b.y-b.h/2-pad)*scale);
        const W=Math.ceil((b.w+pad*2)*scale),H=Math.ceil((b.h+pad*2)*scale);
        featureCtx.clearRect(0,0,size,size);featureCtx.drawImage(loaded.get(file),0,0,size,size);
        const original=featureCtx.getImageData(left,top,W,H),ink=new Uint8Array(W*H);
        for(const [x,y] of mouthMasks.get(file)||[]){const px=x-left,py=y-top;if(px>=0&&px<W&&py>=0&&py<H)ink[py*W+px]=1;}
        // Fill cavities enclosed by the lip (including white teeth), not nose
        // or jaw pixels that merely share the rectangular search region.
        const outside=new Uint8Array(W*H),queue=[];
        const visit=p=>{if(!ink[p]&&!outside[p]){outside[p]=1;queue.push(p);}};
        for(let x=0;x<W;x++){visit(x);visit((H-1)*W+x);}for(let y=0;y<H;y++){visit(y*W);visit(y*W+W-1);}
        for(let i=0;i<queue.length;i++){const p=queue[i],x=p%W,y=Math.floor(p/W);if(x>0)visit(p-1);if(x<W-1)visit(p+1);if(y>0)visit(p-W);if(y<H-1)visit(p+W);}
        for(let p=0;p<ink.length;p++)if(!outside[p])ink[p]=1;
        const spriteData=featureCtx.createImageData(W,H),skinData=featureCtx.createImageData(W,H);
        for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
          let distance=4;
          for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H&&ink[(y+dy)*W+x+dx])distance=Math.min(distance,Math.hypot(dx,dy));
          const i=(y*W+x)*4;
          for(let k=0;k<3;k++) {
            spriteData.data[i+k]=original.data[i+k];
            const a=original.data[x*4+k],bottom=original.data[((H-1)*W+x)*4+k];
            const usableBottom=original.data[((H-1)*W+x)*4+3]>220&&original.data[((H-1)*W+x)*4]>150;
            skinData.data[i+k]=a+(usableBottom?bottom-a:0)*y/(H-1);
          }
          spriteData.data[i+3]=original.data[i+3]*clamp(2-distance,0,1);
          skinData.data[i+3]=255*clamp(4-distance,0,1);
        }
        const c=document.createElement('canvas'),skin=document.createElement('canvas');c.width=skin.width=W;c.height=skin.height=H;
        c.getContext('2d').putImageData(spriteData,0,0);skin.getContext('2d').putImageData(skinData,0,0);
        const sprite={image:c,skin,left,top,pad,bounds:b,inkPixels:(mouthMasks.get(file)||[]).length};spriteCache.set(file,sprite);return sprite;
      }
      const mouthSprites=['open-closed','open-half','open-open'].map(key=>mouthSprite(manifest.poses.neutral.variants[key]));
      for(const seq of Object.values(manifest.cels.sequences))for(const file of seq.frames)mouthSprite(file);
      const scale=size/manifest.width,blankCanvas=makeCanvas(),blankCtx=blankCanvas.getContext('2d');
      const eyeCache=new Map(),eyeRegions=[],blinkCanvases=[],releaseLips=releaseMouth;
      releaseMouth=()=>{releaseLips();for(const p of eyeCache.values())p.image.width=p.image.height=p.skin.width=p.skin.height=1;eyeCache.clear();eyeRegions.length=0;for(const c of blinkCanvases)c.image.width=c.image.height=1;blinkCanvases.length=0;};
      function eyeSprite(file,index) {
        const key=file+':'+index;if(eyeCache.has(key))return eyeCache.get(key);
        const [x,y,w,h]=index===0?[445,558,174,140]:[680,498,178,151];
        const pad=8,left=Math.floor((x-pad)*scale),top=Math.floor((y-pad)*scale);
        const W=Math.ceil((w+pad*2)*scale),H=Math.ceil((h+pad*2)*scale);
        featureCtx.clearRect(0,0,size,size);featureCtx.drawImage(loaded.get(file),0,0,size,size);
        const original=featureCtx.getImageData(left,top,W,H),data=featureCtx.createImageData(W,H),skinData=featureCtx.createImageData(W,H);
        if(!eyeRegions[index]){
          // Registered open/closed art differs at the eye but not at the ear
          // or hair. Its difference is a spatial guard against a lash joined
          // to dark side hair being mistaken for the entire eye component.
          const refs=['open-closed','closed-closed'].map(key=>{
            featureCtx.clearRect(0,0,size,size);featureCtx.drawImage(loaded.get(manifest.poses.neutral.variants[key]),0,0,size,size);
            return featureCtx.getImageData(left,top,W,H).data;
          });
          const region=new Uint8Array(W*H),r=5;
          for(let yy=0;yy<H;yy++)for(let xx=0;xx<W;xx++){
            const i=(yy*W+xx)*4;
            if(refs[0][i+3]<220||refs[1][i+3]<220||Math.max(...[0,1,2].map(k=>Math.abs(refs[0][i+k]-refs[1][i+k])))<15)continue;
            for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
              const nx=xx+dx,ny=yy+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H)region[ny*W+nx]=1;
            }
          }
          eyeRegions[index]=region;
        }
        const feature=featureBounds(file)[index],mask=eyeMask(original.data,W,H,{x:feature.x*scale-left,y:feature.y*scale-top},eyeRegions[index]);
        let x0=W,y0=H,x1=-1,y1=-1,inkPixels=0,scleraPixels=0;
        const distance=new Float32Array(mask.length);distance.fill(4);
        for(let yy=0;yy<H;yy++)for(let xx=0;xx<W;xx++)if(mask[yy*W+xx]){
          x0=Math.min(x0,xx);y0=Math.min(y0,yy);x1=Math.max(x1,xx);y1=Math.max(y1,yy);inkPixels++;
          const i=(yy*W+xx)*4;if(original.data[i]>140&&original.data[i+1]>original.data[i]*.90&&original.data[i+2]>original.data[i]*.80)scleraPixels++;
          for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
            const nx=xx+dx,ny=yy+dy;if(nx>=0&&nx<W&&ny>=0&&ny<H){const p=ny*W+nx;distance[p]=Math.min(distance[p],Math.hypot(dx,dy));}
          }
        }
        if(!inkPixels)throw new Error('Authored eye could not be isolated: '+key);
        const valid=p=>distance[p]>=3&&original.data[p*4+3]>220&&original.data[p*4]>180&&original.data[p*4+1]>original.data[p*4]*.55;
        for(let yy=0;yy<H;yy++)for(let xx=0;xx<W;xx++) {
          const p=yy*W+xx,i=p*4,d=distance[p];
          if(d>=3)continue;
          let above=-1,below=-1;
          for(let dy=1;dy<H;dy++){
            if(above<0&&yy-dy>=0&&valid((yy-dy)*W+xx))above=(yy-dy)*W+xx;
            if(below<0&&yy+dy<H&&valid((yy+dy)*W+xx))below=(yy+dy)*W+xx;
            if(above>=0&&below>=0)break;
          }
          const t=above>=0&&below>=0?(p-above)/(below-above):0;
          for(let k=0;k<3;k++){
            data.data[i+k]=original.data[i+k];
            skinData.data[i+k]=above>=0&&below>=0?original.data[above*4+k]*(1-t)+original.data[below*4+k]*t:
              above>=0?original.data[above*4+k]:below>=0?original.data[below*4+k]:[255,190,146][k];
          }
          // Only a 1px antialias fringe travels with the eye. Blush, eyelid
          // skin, ears and hair stay in their original, unscaled face plate.
          data.data[i+3]=original.data[i+3]*clamp(2-d,0,1);
          skinData.data[i+3]=original.data[i+3]*clamp(3-d,0,1);
        }
        // Harmonic inpainting diffuses neighbouring skin in TWO dimensions.
        // Column-only interpolation pulled the crease down into vertical
        // streaks. Keep all unmasked pixels, including cheek/blush, unchanged.
        const closedFile=manifest.poses.neutral.variants['closed-closed'];
        let clean=new Float32Array(original.data),next=new Float32Array(clean);
        for(let p=0;p<mask.length;p++)if(distance[p]<3)for(let k=0;k<3;k++)clean[p*4+k]=skinData.data[p*4+k];
        if(file===closedFile)for(let pass=0;pass<100;pass++){
          next.set(clean);
          for(let yy=1;yy<H-1;yy++)for(let xx=1;xx<W-1;xx++){
            const p=yy*W+xx;if(distance[p]>=3)continue;
            for(let k=0;k<3;k++)next[p*4+k]=(clean[(p-1)*4+k]+clean[(p+1)*4+k]+clean[(p-W)*4+k]+clean[(p+W)*4+k])/4;
          }
          [clean,next]=[next,clean];
        }
        if(file!==closedFile){
          // The registered closed-eye painting already contains real skin in
          // place of the large iris. Repair only its thin lashes, rather than
          // diffusing ear/hair colour across a much larger open-eye cavity.
          const closed=eyeSprite(closedFile,index),offset=[0,0,0];let count=0;
          for(let p=0;p<mask.length;p++)if(distance[p]>=3&&distance[p]<4&&valid(p)&&closed.original[p*4]>180){
            for(let k=0;k<3;k++)offset[k]+=original.data[p*4+k]-closed.original[p*4+k];count++;
          }
          for(let p=0;p<mask.length;p++)if(distance[p]<3)for(let k=0;k<3;k++)
            clean[p*4+k]=clamp(closed.clean[p*4+k]+clamp(count?offset[k]/count:0,-18,18),0,255);
        }
        for(let p=0;p<mask.length;p++)if(distance[p]<3)for(let k=0;k<3;k++)skinData.data[p*4+k]=clean[p*4+k];
        const b={x:(left+(x0+x1)/2)/scale,y:(top+(y0+y1)/2)/scale,w:(x1-x0+1)/scale,h:(y1-y0+1)/scale};
        const image=document.createElement('canvas'),skin=document.createElement('canvas');image.width=skin.width=W;image.height=skin.height=H;
        image.getContext('2d').putImageData(data,0,0);skin.getContext('2d').putImageData(skinData,0,0);
        const columns=Array.from({length:W},(_,xx)=>{
          let min=H,max=-1;for(let yy=0;yy<H;yy++)if(data.data[(yy*W+xx)*4+3]>5){min=Math.min(min,yy);max=yy;}
          return max>=min?[min,max]:null;
        });
        for(let xx=0;xx<W;xx++)if(!columns[xx]){
          for(let d=1;d<W;d++){const found=columns[xx-d]||columns[xx+d];if(found){columns[xx]=[...found];break;}}
        }
        const p={image,skin,left,top,bounds:b,inkPixels,scleraPixels,
          clean:file===closedFile?clean:null,original:file===closedFile?original.data:null,
          pixels:data.data,columns,width:W,height:H,x0,x1};eyeCache.set(key,p);return p;
      }
      // Cache every expression before presentation, so its first blink cannot
      // stall the render loop while preparing a new skin/eye extraction.
      for(const file of [manifest.poses.neutral.variants['open-closed'],manifest.poses.neutral.variants['closed-closed'],
        ...Object.values(manifest.cels.sequences).flatMap(s=>s.frames)])for(let i=0;i<2;i++)eyeSprite(file,i);
      function withoutFeatures(file) {
        const p=mouthSprite(file);blankCtx.clearRect(0,0,size,size);
        blankCtx.drawImage(loaded.get(file),0,0,size,size);blankCtx.drawImage(p.skin,p.left,p.top);
        for(let i=0;i<2;i++){const eye=eyeSprite(file,i);blankCtx.drawImage(eye.skin,eye.left,eye.top);}return blankCanvas;
      }
      function bodyPoint(x, y) {
        if(output.reducedMotion) return { x, y };
        const nx=x/size,ny=y/size,chest=smooth((ny-.65)/.18);
        const p=headPoint(x,y,size,size,-output.tilt*.18+output.life.head);
        return{x:p.x+(nx-.53)*output.life.chest*size*.003*chest,y:p.y-output.life.chest*size*.0017*chest};
      }
      const faceSwitcher=createFaceSwitcher(manifest.poses.neutral.variants['open-closed']);let presentation=null;
      return { manifest, trigger: controller.trigger, reset() {controller.reset();faceSwitcher.reset();presentation=null;},
        update(now, input) { output = controller.update(now, input); return { ...output, hairRenderer: hairRenderer?.kind || 'rigid-fallback' }; },
        render(ctx, { width = manifest.width, height = manifest.height, hairWarpPoint } = {}) {
          if (disposed || !output) return false;
          faceCtx.clearRect(0, 0, size, size); hairCtx.clearRect(0, 0, size, size);
          const neutralFile=manifest.poses.neutral.variants['open-closed'];
          faceCtx.drawImage(withoutFeatures(neutralFile),0,0,size,size);
          hairCtx.drawImage(loaded.get(manifest.poses.neutral.hair),0,0,size,size);
          const sourceCels=output.cels.map(f=>({...f,file:f.index===-1?neutralFile:manifest.cels.sequences[f.name || output.pose].frames[f.index]}));
          const ranked=[...sourceCels].sort((a,b)=>b.weight-a.weight);
          presentation=faceSwitcher.update(output.now,ranked[0]?.file || neutralFile,output.blinkAmount,output.reducedMotion);
          const eyeFile=presentation.file,blink=presentation.blink;
          if(eyeFile!==neutralFile){
            // A single authored face plate also owns eyebrows and cheek marks.
            // Swapping it during the brief blink is preferable to dissolving
            // mismatched brows/eyes into a translucent second face.
            celCtx.clearRect(0,0,size,size);celCtx.drawImage(withoutFeatures(eyeFile),0,0,size,size);
            celCtx.globalCompositeOperation='destination-in';celCtx.drawImage(maskCanvas,0,0);celCtx.globalCompositeOperation='source-over';
            faceCtx.globalCompositeOperation='destination-out';faceCtx.drawImage(maskCanvas,0,0);
            faceCtx.globalCompositeOperation='lighter';faceCtx.drawImage(celCanvas,0,0);faceCtx.globalCompositeOperation='source-over';
          }
          // One eye drawing per side. Only its isolated ink follows the curved
          // closed lid; skin is stationary and no second eye is crossfaded.
          for(let i=0;i<2;i++) {
            const source=eyeSprite(eyeFile,i),closed=eyeSprite(manifest.poses.neutral.variants['closed-closed'],i);
            const naturallyClosed=source.scleraPixels<eyeSprite(neutralFile,i).scleraPixels*.07;
            const closing=!naturallyClosed&&blink>=.98;
            if(closing)faceCtx.drawImage(closed.image,closed.left,closed.top);
            else if(naturallyClosed||blink<.001)faceCtx.drawImage(source.image,source.left,source.top);
            else {
              if(!blinkCanvases[i]){const image=document.createElement('canvas');image.width=source.width;image.height=source.height;const ctx=image.getContext('2d');blinkCanvases[i]={image,ctx,data:ctx.createImageData(source.width,source.height)};}
              const raster=blinkCanvases[i];blinkPixels(source,closed,blink,raster.data.data);raster.ctx.putImageData(raster.data,0,0);
              faceCtx.drawImage(raster.image,source.left,source.top);
            }
          }
          {
            patchCtx.clearRect(0,0,size,size);patchCtx.globalCompositeOperation='source-over';
            const apertureFor=f=>clamp((featureBounds(f.file)[2].h-mouthShapes[0].h)/(mouthShapes[2].h-mouthShapes[0].h),0,1);
            const expressionAperture=ranked.reduce((sum,f)=>sum+apertureFor(f)*f.weight,0);
            // One mouth layer owns BOTH emotion and speech, including onset
            // and release. Never dissolve a talk mouth over an intact old lip.
            const value=expressionAperture*2*(1-output.speechMix)+output.mouthValue*output.speechMix;
            const g=mouthGeometry(value,...mouthShapes);
            const closedCel=ranked.find(f=>apertureFor(f)<.2),openCel=ranked.find(f=>apertureFor(f)>=.2);
            const expressive=output.speechMix<.5;
            const sprites=[expressive&&closedCel?mouthSprite(closedCel.file):mouthSprites[0],
              expressive&&openCel?mouthSprite(openCel.file):mouthSprites[1],
              expressive&&openCel?mouthSprite(openCel.file):mouthSprites[2]];
            // At most ONE lip silhouette. Dissolving the smile into an open
            // cavity made two lip edges even after clearing the source face.
            const i=value<.16?0:value<1?1:2;
            {
              const {image,pad,bounds:b}=sprites[i];
              const w=i===0?b.w:g.width,h=i===0?b.h:g.height;
              const x=g.x,y=i===0?mouthShapes[0].y-b.h/2:g.top;
              const px=pad*w/b.w,py=pad*h/b.h;
              patchCtx.drawImage(image,(x-w/2-px)*scale,(y-py)*scale,(w+px*2)*scale,(h+py*2)*scale);
            }
            patchCtx.globalAlpha=1;patchCtx.globalCompositeOperation='source-over';
            faceCtx.drawImage(patchCanvas,0,0);
          }
          ctx.save();
          const life=output.life, sx=width/manifest.width, sy=height/manifest.height;
          ctx.translate(width*.55+life.x*sx,height*.84+life.y*sy);ctx.rotate(life.rotation);
          ctx.scale(1+life.scale,1+life.scale);ctx.translate(-width*.55,-height*.84);
          let body = output.reducedMotion ? null : bodyRenderer?.draw(faceCanvas,bodyPoint,true);
          if(!body&&!output.reducedMotion){bodyRenderer?.dispose();bodyRenderer=createCanvasHairRenderer(size,size);body=bodyRenderer?.draw(faceCanvas,bodyPoint,true);}
          ctx.drawImage(body || faceCanvas,0,0,width,height);
          const hairPoint=(x,y)=>{
            const p = controller.hairPoint(x * manifest.width / size, y * manifest.height / size, hairWarpPoint);
            return bodyPoint(p.x * size / manifest.width, p.y * size / manifest.height);
          };
          let renderedHair = output.reducedMotion ? null : hairRenderer?.draw(hairCanvas,hairPoint,true);
          if(!renderedHair&&!output.reducedMotion){hairRenderer?.dispose();hairRenderer=createCanvasHairRenderer(size,size);renderedHair=hairRenderer?.draw(hairCanvas,hairPoint,true);}
          ctx.drawImage(renderedHair || hairCanvas, 0, 0, width, height); ctx.restore(); return true;
        }, dispose, get status() { return output; },
        get mouthSources() { return [...spriteCache].map(([file,p])=>({file,inkPixels:p.inkPixels})); },
        get eyeSources() { return [...eyeCache].map(([key,p])=>({key,inkPixels:p.inkPixels,scleraPixels:p.scleraPixels,bounds:p.bounds})); },
        get facePresentation() { return presentation&&{...presentation}; },
        get renderDiagnostics() { return {poseMode:'shared-rigid-head',eyeLayers:2,mouthLayers:1,decodedImages:loaded.size}; } };
    } catch (error) { dispose(); throw error; }
  }
  return { VARIANTS, STATES, stateForInput, validateManifest, celWeights, landmarkTransform, poseSamples, featureWarp, transformFeature, inverseAffine, mouthGeometry, headPoint, createFaceSwitcher, eyeMask, blinkPixels, createController, createPlayer };
});
