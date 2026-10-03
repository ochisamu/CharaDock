// SPDX-License-Identifier: Apache-2.0
// Kohaku v9: authored drawings, independent hair, registered LIVE eye/mouth patches.
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
  const VARIANTS = ['open-closed', 'open-half', 'open-open', 'closed-closed', 'closed-half', 'closed-open'];
  const STATES = ['neutral', 'curious_tilt', 'attentive_listening', 'delighted_agreement', 'doubtful_side_eye', 'sleepy_yawn'];
  function stateForInput(input = {}) {
    if (input.emotion === 'exasperated') return 'doubtful_side_eye';
    if (['happy', 'joy'].includes(input.emotion) || ['celebrate', 'nod'].includes(input.nikePerformance)) return 'delighted_agreement';
    if (input.reaction === 'listening' || input.emotion === 'soft' || input.nikePerformance === 'reassure') return 'attentive_listening';
    if (input.emotion === 'thinking' || ['ponder', 'explain', 'recoil'].includes(input.nikePerformance)) return 'curious_tilt';
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
    function reset() { last = null; tilt = tiltTarget = tiltVelocity = 0; sequence = null; presentedCels = carriedCels = []; deadline = 0; releaseStarted = null; speechUntil = 0; mouthValue = blinkAmount = blinkVelocity = speechMix = speechMixVelocity = 0; hair.fill(0); velocities.fill(0); for (const k of Object.keys(life)) life[k] = lifeVelocity[k] = 0; lastActivity = now; nextYawn = now + 90000; }
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
      mouthValue += (mouth - mouthValue) * (1 - Math.exp(-dt * 25));
      [blinkAmount,blinkVelocity] = spring(blinkAmount,blinkVelocity,blink?1:0,dt,blink?36:24);
      if (mouth || input.audioLevel > .015 || input.speaking) { speechUntil = now + 500; lastActivity = now; }
      [speechMix, speechMixVelocity] = spring(speechMix, speechMixVelocity, now < speechUntil ? 1 : 0, dt, 14);
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
      for (let i = 0; i < 3; i++) {
        if (reduced || input.freeze) { hair[i] = velocities[i] = 0; continue; }
        const omega = 6 + i, target = Math.sin(now / 1000 * 1.45 - i * .7) * (4.5 + i * 1.2) - tiltVelocity * (2 + i) - lifeVelocity.head * 45;
        const off = hair[i] - target, c = velocities[i] + omega * off, decay = Math.exp(-omega * dt);
        hair[i] = target + (off + c * dt) * decay; velocities[i] = (velocities[i] - omega * c * dt) * decay;
      }
      let cels = sequence ? celWeights(reduced ? .45 : celPhase).map(f => ({ ...f, name: sequence.name })) : [];
      if (carriedCels.length) {
        const mix = reduced ? 1 : smooth((now - fadeStarted) / 260);
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
        x: idle * (Math.sin(seconds * .83 + .2) * 3.8 + Math.sin(seconds * .37) * 1.6) * breath,
        y: idle * Math.sin(seconds * 1.13) * 3.5 * breath - voice * 12 - beat * 6,
        rotation: idle * (Math.sin(seconds * .91) * .013 + Math.sin(seconds * .43 + 1) * .004) * roll,
        scale: idle * Math.sin(seconds * 1.13) * .005 * breath + voice * .002,
        head: idle * (Math.sin(seconds * 1.37) * .009 + Math.sin(seconds * .69 + .3) * .005) * roll + beat * .012,
        chest: idle * Math.sin(seconds * 1.13 - .5) * breath,
        accent: voice,
      };
      for(const k of Object.keys(life)) {
        if(reduced || input.freeze) { life[k] = lifeVelocity[k] = 0; }
        else [life[k], lifeVelocity[k]] = spring(life[k], lifeVelocity[k], targets[k], dt, k === 'head' ? 8 : k === 'accent' ? 12 : 6);
      }
      return { pose: tilt > .001 ? 'curious_tilt' : sequence?.name || 'neutral', tilt,
        transitionFrame: tilt > .001 && tilt < .999 ? Math.round(tilt * ((manifest.transitions?.[0]?.frames.length || 1) - 1)) : null,
        cels, mouthState: mouth, blinkClosed: blink, mouthValue, blinkAmount, speechMix,
        speaking: now < speechUntil, reducedMotion: reduced, hair: [...hair], life: { ...life }, tiltVelocity, ...budget };
    }
    function hairPoint(x, y, externalWarp) {
      if (reduced) return { x, y };
      const nx = x / manifest.width, ny = y / manifest.height, weight = smooth((ny - .24) / .49);
      const center = [(.73 + tilt * .012) * manifest.width, (.235 - tilt * .023) * manifest.height];
      const accessory = 1 - smooth((Math.hypot((x - center[0]) / (.18 * manifest.width), (y - center[1]) / (.17 * manifest.height)) - .8) / .35);
      const f = clamp(nx * 2, 0, 2), a = Math.floor(f), b = Math.min(2, a + 1);
      let dx = hair[a] * (1 - (f - a)) + hair[b] * (f - a), dy = Math.sin(now / 1000 * 1.25 + nx * 3) * .6;
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
    let hairRenderer = null, bodyRenderer = null, expressionRenderer = null, disposed = false, output = null;
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
    const dispose = () => { if (disposed) return; disposed = true; hairRenderer?.dispose(); bodyRenderer?.dispose(); expressionRenderer?.dispose(); hairRenderer = bodyRenderer = expressionRenderer = null; for (const im of loaded.values()) im.close(); loaded.clear(); };
    try {
      for (const pose of Object.values(manifest.poses)) { await load(pose.hair); for (const file of Object.values(pose.variants)) await load(file); }
      for (const clip of manifest.transitions || []) for (const f of clip.frames) { await load(f.base, clip.width, clip.height); await load(f.hair, clip.width, clip.height); }
      await load(manifest.cels.mask);
      for (const seq of Object.values(manifest.cels.sequences)) for (const file of seq.frames) await load(file);
      const size = manifest.decodeSize, makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
      const faceCanvas = makeCanvas(), faceCtx = faceCanvas.getContext('2d'), celCanvas = makeCanvas(), celCtx = celCanvas.getContext('2d');
      const hairCanvas = makeCanvas(), hairCtx = hairCanvas.getContext('2d'), patchCanvas = makeCanvas(), patchCtx = patchCanvas.getContext('2d');
      const registeredMask = makeCanvas(), registeredMaskCtx = registeredMask.getContext('2d');
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
      maskCtx.putImageData(mask, 0, 0);
      const patches = new Map(), regions = { mouth: [668, 730, 88, 64], eyes: [[548, 630, 100, 82], [758, 584, 110, 84]] };
      function patch(key, region) {
        const id = `${key}:${region}`; if (patches.has(id)) return patches.get(id);
        const c = makeCanvas(), p = c.getContext('2d'); p.scale(size / manifest.width, size / manifest.height);
        for (const [x, y, rx, ry] of (region === 'mouth' ? [regions.mouth] : regions.eyes)) {
          p.save(); p.translate(x, y); p.scale(rx, ry);
          const g = p.createRadialGradient(0, 0, .75, 0, 0, 1); g.addColorStop(0, 'white'); g.addColorStop(1, 'transparent');
          p.fillStyle = g; p.fillRect(-1, -1, 2, 2); p.restore();
        }
        p.globalCompositeOperation = 'source-in'; p.drawImage(loaded.get(manifest.poses.neutral.variants[key]), 0, 0, manifest.width, manifest.height);
        patches.set(id, c); return c;
      }
      try { hairRenderer = canvasOnly ? createCanvasHairRenderer(size, size) : createHairRenderer(size, size); }
      catch { hairRenderer = createCanvasHairRenderer(size, size); }
      try { bodyRenderer = canvasOnly ? createCanvasHairRenderer(size, size) : createHairRenderer(size, size); }
      catch { bodyRenderer = createCanvasHairRenderer(size, size); }
      try { expressionRenderer = canvasOnly ? createCanvasHairRenderer(size, size) : createHairRenderer(size, size, true); }
      catch { expressionRenderer = createCanvasHairRenderer(size, size); }
      const features = new Map(), featureCanvas=makeCanvas(), featureCtx=featureCanvas.getContext('2d',{willReadFrequently:true});
      function featureBounds(file) {
        if(features.has(file))return features.get(file);
        featureCtx.clearRect(0,0,size,size);featureCtx.drawImage(loaded.get(file),0,0,size,size);
        const data=featureCtx.getImageData(0,0,size,size).data, scale=size/manifest.width;
        const boxes=[[480,574,145,108],[702,508,130,122],[610,688,116,70],[480,510,145,62],[675,445,142,62]];
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
          let best=null;
          for(let i=0;i<dark.length;i++)if(dark[i]&&!seen[i]) {
            let head=0,tail=1,x0=W,y0=H,x1=0,y1=0;queue[0]=i;seen[i]=1;
            while(head<tail){const p=queue[head++],xx=p%W,yy=Math.floor(p/W);x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);
              for(const [nx,ny] of [[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]])if(nx>=0&&nx<W&&ny>=0&&ny<H){const q=ny*W+nx;if(dark[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}}
            }
            if(!best||tail>best.area)best={area:tail,x0,y0,x1,y1};
          }
          if(!best||best.area<5)return transformFeature({x:FEATURE_REGIONS[n][0],y:FEATURE_REGIONS[n][1],w:70,h:25},searchTransform);
          return{x:(left+(best.x0+best.x1)/2)/scale,y:(top+(best.y0+best.y1)/2)/scale,w:Math.max(12,(best.x1-best.x0+1)/scale),h:Math.max(8,(best.y1-best.y0+1)/scale)};
        });features.set(file,result);return result;
      }
      for(const file of [manifest.poses.neutral.variants['open-closed'],...Object.values(manifest.cels.sequences).flatMap(s=>s.frames)])featureBounds(file);
      function registeredDraw(ctx, image) {
        ctx.save(); ctx.scale(size / manifest.width, size / manifest.height);
        ctx.transform(...landmarkTransform(output.tilt)); ctx.drawImage(image, 0, 0, manifest.width, manifest.height); ctx.restore();
      }
      function warpFeatures(image, from, to, dynamic=false) {
        return output.reducedMotion ? image : expressionRenderer?.draw(image,(x,y)=>{
          const p=featureWarp(x/size*manifest.width,y/size*manifest.height,from,to);
          return{x:p.x/manifest.width*size,y:p.y/manifest.height*size};
        },dynamic) || image;
      }
      function morphCurrentFace(from,to) {
        if(output.reducedMotion)return;
        const warped=warpFeatures(faceCanvas,from,to,true);
        if(warped===faceCanvas)return;
        faceCtx.clearRect(0,0,size,size);faceCtx.drawImage(warped,0,0);
      }
      const interpolateFeatures=(from,to,mix)=>from.map((f,i)=>Object.fromEntries(['x','y','w','h'].map(k=>[k,f[k]+(to[i][k]-f[k])*mix])));
      function bodyPoint(x, y) {
        if(output.reducedMotion) return { x, y };
        const nx=x/size, ny=y/size, w=1-smooth((ny-.63)/.18), a=output.life.head*w;
        const dx=x-.55*size, dy=y-.67*size, chest=smooth((ny-.65)/.18);
        return { x:.55*size+dx*Math.cos(a)-dy*Math.sin(a)+(nx-.53)*output.life.chest*size*.003*chest,
          y:.67*size+dx*Math.sin(a)+dy*Math.cos(a)-output.life.chest*size*.0017*chest };
      }
      return { manifest, trigger: controller.trigger, reset: controller.reset,
        update(now, input) { output = controller.update(now, input); return { ...output, hairRenderer: hairRenderer?.kind || 'rigid-fallback' }; },
        render(ctx, { width = manifest.width, height = manifest.height, hairWarpPoint } = {}) {
          if (disposed || !output) return false;
          faceCtx.clearRect(0, 0, size, size); hairCtx.clearRect(0, 0, size, size);
          faceCtx.globalCompositeOperation = hairCtx.globalCompositeOperation = 'lighter';
          const frames = manifest.transitions[0].frames;
          const samples=poseSamples(output.tilt, frames.length), posedFeatures=FEATURE_REGIONS.map(()=>({x:0,y:0,w:0,h:0}));
          for(const sample of samples) {
            const pose = sample.index < 0 ? manifest.poses.neutral : sample.index >= frames.length ? manifest.poses.curious_tilt : null;
            const pair = pose ? {base:pose.variants['open-closed'],hair:pose.hair} : frames[sample.index];
            faceCtx.globalAlpha = hairCtx.globalAlpha = sample.weight;
            faceCtx.drawImage(loaded.get(pair.base), 0, 0, size, size); hairCtx.drawImage(loaded.get(pair.hair), 0, 0, size, size);
            featureBounds(pair.base).forEach((b,i)=>{for(const k of ['x','y','w','h'])posedFeatures[i][k]+=b[k]*sample.weight;});
          }
          faceCtx.globalAlpha = hairCtx.globalAlpha = 1;
          faceCtx.globalCompositeOperation = hairCtx.globalCompositeOperation = 'source-over';
          let currentFeatures=posedFeatures;
          const registration=landmarkTransform(output.tilt), inverse=inverseAffine(registration);
          if (output.cels.length) {
            celCtx.clearRect(0, 0, size, size); celCtx.globalCompositeOperation = 'lighter';
            registeredMaskCtx.clearRect(0,0,size,size); registeredDraw(registeredMaskCtx,maskCanvas);
            const sourceCels=output.cels.map(f=>({...f,file:f.index===-1?manifest.poses.neutral.variants['open-closed']:manifest.cels.sequences[f.name || output.pose].frames[f.index]}));
            const target=FEATURE_REGIONS.map((_,i)=>sourceCels.reduce((sum,f)=>{
              const b=f.index===-1?posedFeatures[i]:transformFeature(featureBounds(f.file)[i],registration);
              for(const k of ['x','y','w','h'])sum[k]+=b[k]*f.weight;return sum;
            },{x:0,y:0,w:0,h:0}));
            for (const { file, weight, index } of sourceCels) {
              celCtx.globalAlpha = weight;
              // Both outgoing and incoming features must meet at the same
              // PRESENTED coordinates. Aligning only the incoming drawing
              // leaves two eyes/mouths when the current head is still tilted.
              const image=index===-1?faceCanvas:loaded.get(file);
              const from=index===-1?posedFeatures:featureBounds(file);
              const to=index===-1?target:target.map(f=>transformFeature(f,inverse));
              const warped=warpFeatures(image,from,to,index===-1);
              if(index===-1)celCtx.drawImage(warped || image,0,0);
              else registeredDraw(celCtx,warped || image);
            }
            celCtx.globalAlpha = 1; celCtx.globalCompositeOperation = 'destination-in'; celCtx.drawImage(registeredMask, 0, 0);
            celCtx.globalCompositeOperation = 'source-over';
            // Replace the face plate: do not leave the old neutral eyes under
            // semi-transparent artwork or move a neutral face against tilt hair.
            faceCtx.globalCompositeOperation = 'destination-out';faceCtx.drawImage(registeredMask,0,0);
            faceCtx.globalCompositeOperation = 'lighter';faceCtx.drawImage(celCanvas,0,0);
            faceCtx.globalCompositeOperation = 'source-over';
            currentFeatures=target;
          }
          // Blend only registered eye/mouth pixels; full pose, hair, clothing and
          // the authored transition frame keep running during speech/blinks.
          if (output.speechMix > .0001) {
            patchCtx.clearRect(0,0,size,size);patchCtx.globalCompositeOperation='lighter';
            const value=clamp(output.mouthValue,0,2), a=Math.floor(value), b=Math.min(2,a+1), mix=value-a;
            const speechSources=[[a,1-mix],[b,mix]].map(([n,w])=>({key:`open-${['closed','half','open'][n]}`,weight:w}));
            const speechTarget=FEATURE_REGIONS.map((_,i)=>speechSources.reduce((sum,f)=>{
              const b=featureBounds(manifest.poses.neutral.variants[f.key])[i];for(const k of ['x','y','w','h'])sum[k]+=b[k]*f.weight;return sum;
            },{x:0,y:0,w:0,h:0}));
            const mouthTarget=interpolateFeatures(currentFeatures,currentFeatures.map((f,i)=>i===2?transformFeature(speechTarget[i],registration):f),output.speechMix);
            morphCurrentFace(currentFeatures,mouthTarget);currentFeatures=mouthTarget;
            const patchTarget=mouthTarget.map(f=>transformFeature(f,inverse));
            for(const f of speechSources) {
              if(f.weight<.0001)continue;
              const source=featureBounds(manifest.poses.neutral.variants[f.key]), image=patch(f.key,'mouth');
              const warped=warpFeatures(image,source,patchTarget);
              patchCtx.globalAlpha=f.weight;patchCtx.drawImage(warped || image,0,0);
            }
            patchCtx.globalAlpha=1;patchCtx.globalCompositeOperation='source-over';
            faceCtx.globalAlpha=output.speechMix;registeredDraw(faceCtx,patchCanvas);faceCtx.globalAlpha=1;
          }
          if(output.blinkAmount > .0001) {
            const closedFeatures=featureBounds(manifest.poses.neutral.variants['closed-closed']);
            const eyeTarget=interpolateFeatures(currentFeatures,currentFeatures.map((f,i)=>i<2?transformFeature(closedFeatures[i],registration):f),output.blinkAmount);
            morphCurrentFace(currentFeatures,eyeTarget);
            const eyes=warpFeatures(patch('closed-closed','eyes'),closedFeatures,eyeTarget.map(f=>transformFeature(f,inverse)));
            faceCtx.globalAlpha=output.blinkAmount;registeredDraw(faceCtx,eyes);faceCtx.globalAlpha=1;
          }
          ctx.save();
          const life=output.life, sx=width/manifest.width, sy=height/manifest.height;
          ctx.translate(width*.55+life.x*sx,height*.84+life.y*sy);ctx.rotate(life.rotation);
          ctx.scale(1+life.scale,1+life.scale);ctx.translate(-width*.55,-height*.84);
          const body = output.reducedMotion ? null : bodyRenderer?.draw(faceCanvas,bodyPoint,true);
          ctx.drawImage(body || faceCanvas,0,0,width,height);
          const renderedHair = output.reducedMotion ? null : hairRenderer?.draw(hairCanvas, (x, y) => {
            const p = controller.hairPoint(x * manifest.width / size, y * manifest.height / size, hairWarpPoint);
            return bodyPoint(p.x * size / manifest.width, p.y * size / manifest.height);
          },true);
          ctx.drawImage(renderedHair || hairCanvas, 0, 0, width, height); ctx.restore(); return true;
        }, dispose, get status() { return output; } };
    } catch (error) { dispose(); throw error; }
  }
  return { VARIANTS, STATES, stateForInput, validateManifest, celWeights, landmarkTransform, poseSamples, featureWarp, transformFeature, inverseAffine, createController, createPlayer };
});
