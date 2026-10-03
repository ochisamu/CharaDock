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
    const budget = validateManifest(manifest), duration = manifest.transitions?.[0]?.durationMs || 1250;
    let last = null, now = 0, tilt = 0, tiltTarget = 0, tiltOrigin = 0, tiltStarted = 0;
    let sequence = null, queued = null, deadline = 0, mouth = 0, blink = false, reduced = false;
    let presentedCels = [], carriedCels = [], fadeStarted = 0;
    let speechUntil = 0, lastActivity = 0, nextYawn = 90000;
    const hair = [0, 0, 0], velocities = [0, 0, 0];
    function reset() { last = null; tilt = tiltTarget = tiltOrigin = 0; sequence = queued = null; presentedCels = carriedCels = []; deadline = 0; speechUntil = 0; hair.fill(0); velocities.fill(0); lastActivity = now; nextYawn = now + 90000; }
    function retarget(target) {
      if (target === tiltTarget) return;
      tiltOrigin = tilt; tiltTarget = target; tiltStarted = now;
    }
    function trigger(name, ms = now, holdMs = 4500) {
      if (!STATES.includes(name)) return false;
      now = Number.isFinite(ms) ? ms : now; lastActivity = now; nextYawn = now + 90000;
      if (sequence?.name !== name && presentedCels.length) { carriedCels = presentedCels.map(f => ({ ...f })); fadeStarted = now; }
      deadline = now + clamp(holdMs, 500, 10000);
      if (name === 'curious_tilt') { sequence = queued = null; retarget(1); }
      else if (tilt > .001) { queued = name; retarget(0); }
      else {
        retarget(0); queued = null;
        // Repeated identical decisions do not restart the onset animation.
        if (name === 'neutral') sequence = null;
        else if (sequence?.name !== name) sequence = { name, started: now };
      }
      return true;
    }
    function update(ms, input = {}) {
      now = Number.isFinite(ms) ? ms : now;
      const elapsed = last === null ? 0 : Math.max(0, (now - last) / 1000), dt = Math.min(.05, elapsed); last = now;
      reduced = Boolean(input.reducedMotion);
      mouth = Math.round(clamp(input.mouthState ?? (input.audioLevel > .28 ? 2 : input.audioLevel > .055 ? 1 : 0), 0, 2));
      blink = Boolean(input.blinkClosed);
      if (mouth || input.audioLevel > .015 || input.speaking) { speechUntil = now + 500; lastActivity = now; }
      if (input.interacting) lastActivity = now;
      if (elapsed > .3) { hair.fill(0); velocities.fill(0); }
      if (deadline && now > deadline) { retarget(0); queued = null; deadline = 0; }
      // Audio and blink never cancel an authored transition or reset its pose.
      const travel = duration * Math.abs(tiltTarget - tiltOrigin);
      tilt = reduced ? tiltTarget : travel ? tiltOrigin + (tiltTarget - tiltOrigin) * smooth((now - tiltStarted) / travel) : tiltTarget;
      if (Math.abs(tilt - tiltTarget) < .0001) {
        tilt = tiltTarget;
        if (tilt === 0 && queued) { sequence = queued === 'neutral' ? null : { name: queued, started: now }; queued = null; }
      }
      if (!sequence && tilt === 0 && now - lastActivity > 60000 && now > nextYawn && !input.interacting && now > speechUntil && !reduced) {
        sequence = { name: 'sleepy_yawn', started: now }; nextYawn = now + 90000;
      }
      let celPhase = 0;
      if (sequence) {
        celPhase = (now - sequence.started) / manifest.cels.sequences[sequence.name].durationMs;
        if (celPhase >= 1) { sequence = null; celPhase = 0; }
      }
      for (let i = 0; i < 3; i++) {
        if (reduced || input.freeze) { hair[i] = velocities[i] = 0; continue; }
        const omega = 6 + i, target = Math.sin(now / 1000 * 1.45 - i * .7) * (2.4 + i * .8);
        const off = hair[i] - target, c = velocities[i] + omega * off, decay = Math.exp(-omega * dt);
        hair[i] = target + (off + c * dt) * decay; velocities[i] = (velocities[i] - omega * c * dt) * decay;
      }
      let cels = sequence ? celWeights(reduced ? .45 : celPhase).map(f => ({ ...f, name: sequence.name })) : [];
      if (carriedCels.length) {
        const mix = reduced ? 1 : smooth((now - fadeStarted) / 220);
        cels = [...carriedCels.map(f => ({ ...f, weight: f.weight * (1 - mix) })),
          ...(cels.length ? cels : [{ index: -1, weight: 1 }]).map(f => ({ ...f, weight: f.weight * mix }))].filter(f => f.weight > .0001);
        if (mix === 1) carriedCels = [];
      }
      presentedCels = cels;
      return { pose: tilt > .001 ? 'curious_tilt' : sequence?.name || 'neutral', tilt,
        transitionFrame: tilt > .001 && tilt < .999 ? Math.round(tilt * ((manifest.transitions?.[0]?.frames.length || 1) - 1)) : null,
        cels, mouthState: mouth, blinkClosed: blink,
        speaking: now < speechUntil, reducedMotion: reduced, hair: [...hair], ...budget };
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
  function createHairRenderer(width, height) {
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
    const cols = 28, rows = 24, coords = [], indices = [];
    for (let y=0;y<=rows;y++) for(let x=0;x<=cols;x++) coords.push(x/cols,y/rows);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;indices.push(a,c,b,b,c,d);}
    const uv = new Float32Array(coords), positions = new Float32Array(coords.length);
    function attribute(name, data) {const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);return b;}
    const uvBuffer=attribute('uv',uv); const positionBuffer=attribute('p',positions);
    const indexBuffer=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
    const textures=new Map();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.disable(gl.BLEND);
    return { kind:'webgl', draw(image, warp) {
      if(lost) return null;
      let texture=textures.get(image); if(!texture){texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);textures.set(image,texture);if(textures.size>8){const oldest=textures.keys().next().value;gl.deleteTexture(textures.get(oldest));textures.delete(oldest);}} else gl.bindTexture(gl.TEXTURE_2D,texture);
      for(let i=0;i<coords.length;i+=2){const p=warp(coords[i]*width,coords[i+1]*height);positions[i]=p.x;positions[i+1]=p.y;}
      gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,positions);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);return canvas;
    }, dispose(){for(const t of textures.values())gl.deleteTexture(t);textures.clear();gl.deleteBuffer(uvBuffer);gl.deleteBuffer(positionBuffer);gl.deleteBuffer(indexBuffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.width=canvas.height=1;} };
  }

  async function createPlayer({ manifestUrl, signal, canvasOnly = false }) {
    const response = await fetch(manifestUrl, { signal }); if (!response.ok) throw new Error(`Pose manifest ${response.status}`);
    const manifest = await response.json(), controller = createController(manifest), loaded = new Map(), base = new URL(manifestUrl, document.baseURI);
    let hairRenderer = null, disposed = false, output = null;
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
    const dispose = () => { if (disposed) return; disposed = true; hairRenderer?.dispose(); hairRenderer = null; for (const im of loaded.values()) im.close(); loaded.clear(); };
    try {
      for (const pose of Object.values(manifest.poses)) { await load(pose.hair); for (const file of Object.values(pose.variants)) await load(file); }
      for (const clip of manifest.transitions || []) for (const f of clip.frames) { await load(f.base, clip.width, clip.height); await load(f.hair, clip.width, clip.height); }
      await load(manifest.cels.mask);
      for (const seq of Object.values(manifest.cels.sequences)) for (const file of seq.frames) await load(file);
      const size = manifest.decodeSize, makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
      const faceCanvas = makeCanvas(), faceCtx = faceCanvas.getContext('2d'), celCanvas = makeCanvas(), celCtx = celCanvas.getContext('2d');
      const maskCanvas = makeCanvas(), maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      maskCtx.drawImage(loaded.get(manifest.cels.mask), 0, 0, size, size);
      const mask = maskCtx.getImageData(0, 0, size, size);
      for (let i = 0; i < mask.data.length; i += 4) mask.data[i + 3] = mask.data[i];
      maskCtx.putImageData(mask, 0, 0);
      const patches = new Map(), regions = { mouth: [668, 730, 76, 50], eyes: [[548, 610, 110, 112], [758, 559, 112, 120]] };
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
      return { manifest, trigger: controller.trigger, reset: controller.reset,
        update(now, input) { output = controller.update(now, input); return { ...output, hairRenderer: hairRenderer?.kind || 'rigid-fallback' }; },
        render(ctx, { width = manifest.width, height = manifest.height, hairWarpPoint } = {}) {
          if (disposed || !output) return false;
          const key = `${output.blinkClosed ? 'closed' : 'open'}-${['closed', 'half', 'open'][output.mouthState]}`;
          let body, hair;
          if (output.transitionFrame !== null) {
            const f = manifest.transitions[0].frames[output.transitionFrame]; body = loaded.get(f.base); hair = loaded.get(f.hair);
          } else if (output.tilt > .999) { const pose = manifest.poses.curious_tilt; body = loaded.get(pose.variants['open-closed']); hair = loaded.get(pose.hair); }
          else { body = loaded.get(manifest.poses.neutral.variants[key]); hair = loaded.get(manifest.poses.neutral.hair); }
          faceCtx.clearRect(0, 0, size, size); faceCtx.drawImage(body, 0, 0, size, size);
          if (output.cels.length) {
            celCtx.clearRect(0, 0, size, size); celCtx.globalCompositeOperation = 'lighter';
            for (const { index, weight, name } of output.cels) {
              celCtx.globalAlpha = weight;
              const file = index === -1 ? manifest.poses.neutral.variants['open-closed'] : manifest.cels.sequences[name || output.pose].frames[index];
              celCtx.drawImage(loaded.get(file), 0, 0, size, size);
            }
            celCtx.globalAlpha = 1; celCtx.globalCompositeOperation = 'destination-in'; celCtx.drawImage(maskCanvas, 0, 0);
            celCtx.globalCompositeOperation = 'source-over'; faceCtx.drawImage(celCanvas, 0, 0);
          }
          // Blend only registered eye/mouth pixels; full pose, hair, clothing and
          // the authored transition frame keep running during speech/blinks.
          if (output.tilt > .001 || output.cels.length) {
            faceCtx.save(); faceCtx.scale(size / manifest.width, size / manifest.height);
            faceCtx.transform(...landmarkTransform(output.tilt));
            if (output.speaking) faceCtx.drawImage(patch(key, 'mouth'), 0, 0, manifest.width, manifest.height);
            if (output.blinkClosed) faceCtx.drawImage(patch(key, 'eyes'), 0, 0, manifest.width, manifest.height);
            faceCtx.restore();
          }
          ctx.save(); ctx.drawImage(faceCanvas, 0, 0, width, height);
          const renderedHair = output.reducedMotion ? null : hairRenderer?.draw(hair, (x, y) => {
            const p = controller.hairPoint(x * manifest.width / size, y * manifest.height / size, hairWarpPoint);
            return { x: p.x * size / manifest.width, y: p.y * size / manifest.height };
          });
          ctx.drawImage(renderedHair || hair, 0, 0, width, height); ctx.restore(); return true;
        }, dispose, get status() { return output; } };
    } catch (error) { dispose(); throw error; }
  }
  return { VARIANTS, STATES, stateForInput, validateManifest, celWeights, landmarkTransform, createController, createPlayer };
});
