// SPDX-License-Identifier: Apache-2.0
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.CharaDockLivlivAvatar=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 const controlsApi=typeof module==='object'&&module.exports?require('./livliv-controls.js'):globalThis.CharaDockLivlivControls;
 const expressionIds={happy:['happy','smile'],joy:['joy','happy','smile'],proud:['proud','smile'],soft:['soft','relaxed','smile'],thinking:['thinking','think'],worried:['worried','sad'],sad:['sad','worried'],angry:['angry'],exasperated:['exasperated','thinking'],surprised:['surprised','surprise']};
 const faces={
  neutral:{eye:1,browL:0,browR:0,gazeX:0,gazeY:0,tilt:0,mouth:0},
  happy:{eye:.82,browL:.12,browR:.12,gazeX:0,gazeY:0,tilt:1.2,mouth:0},
  joy:{eye:.08,browL:.16,browR:.16,gazeX:0,gazeY:0,tilt:1.5,mouth:0},
  proud:{eye:.86,browL:.2,browR:.16,gazeX:0,gazeY:.06,tilt:-.8,mouth:0},
  soft:{eye:.82,browL:.06,browR:.06,gazeX:0,gazeY:0,tilt:1,mouth:0},
  thinking:{eye:.92,browL:-.06,browR:.14,gazeX:-.28,gazeY:.12,tilt:1.6,mouth:0},
  worried:{eye:.9,browL:.22,browR:.22,gazeX:.06,gazeY:-.08,tilt:-1,mouth:0},
  sad:{eye:.72,browL:.18,browR:.18,gazeX:0,gazeY:-.18,tilt:-1.2,mouth:0},
  angry:{eye:.88,browL:-.25,browR:-.25,gazeX:0,gazeY:0,tilt:0,mouth:0},
  exasperated:{eye:.55,browL:-.12,browR:-.06,gazeX:.18,gazeY:0,tilt:-2,mouth:0},
  surprised:{eye:1,browL:.42,browR:.42,gazeX:0,gazeY:0,tilt:-.7,mouth:.58},
 };
 let vrmEnginePromise=null;
 function loadVrmEngine(){
  if(globalThis.CharaDockVrmEngine)return Promise.resolve(globalThis.CharaDockVrmEngine);
  if(!vrmEnginePromise)vrmEnginePromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vrm.js';script.onload=()=>globalThis.CharaDockVrmEngine?resolve(globalThis.CharaDockVrmEngine):reject(Error('VRM renderer unavailable'));script.onerror=()=>{script.remove();vrmEnginePromise=null;reject(Error('VRM renderer could not load'));};document.head.append(script);});
  return vrmEnginePromise;
 }
 function create({engine,loadVrm=loadVrmEngine,makeCanvas=()=>document.createElement('canvas'),now=()=>performance.now(),onError=()=>{}}){
  let baseTuning=null,speechActivity=0,activeExpression=null,lastDrawInput={};
  let player=null,canvas=null,identity='',characterId='',loading=null,error='',cue=null,last=now(),frameInput={blink:false,frozen:false},face={...faces.neutral},controls=controlsApi.normalize(),activeDescriptor=null,away=false,manualBlinkUntil=0,seenCommands=new Set();
  function release(p,surface){try{p?.dispose();}finally{surface?.getContext?.('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();}}
  function reset(){const old=loading;loading=null;if(old){old.cancelled=true;release(old.player,old.canvas);}release(player,canvas);player=canvas=null;baseTuning=null;speechActivity=0;activeExpression=null;cue=null;face={...faces.neutral};away=false;manualBlinkUntil=0;lastDrawInput={};seenCommands.clear();}
  function expression(input={}){
   if(!identity||input.characterId&&input.characterId!==characterId)return;
   if(!['emotion','reaction','nikePerformance','forceMouth','forceEyesClosed'].some(k=>Object.hasOwn(input,k)))return;
   cue={...input,until:now()+Math.max(100,Math.min(10000,Number(input.durationMs)||4500))};
   if(!player)return;
   applyExpression();
   const action={nod:'nod',ponder:'tilt',celebrate:'hop',recoil:'shake',reassure:'tilt',explain:'nod'}[input.nikePerformance];
   if(action)player.act(action);
  }
  async function sync(descriptor,id=''){
   const valid=descriptor&&/^(?:kohaku|[a-f0-9-]{36})$/.test(descriptor.id)&&descriptor.modelUrl===`/api/livliv/${descriptor.id}/${descriptor.kind==='vrm'?'model.vrm':'model.json'}`&&/^[a-f0-9]{16}$/.test(descriptor.version);
   const next=valid?`${id}:${descriptor.id}:${descriptor.version}`:'';
   if(next===identity){if(valid)setControls(descriptor.controls);return;}
   reset();identity=next;characterId=id;error='';activeDescriptor=valid?descriptor:null;controls=controlsApi.normalize(descriptor?.controls);if(!next||descriptor.kind!=='vrm'&&!engine?.Player)return;
   const token={cancelled:false,player:null,canvas:null};loading=token;
   try{
    const vrm=descriptor.kind==='vrm'?await loadVrm():null;if(token.cancelled||loading!==token)return;
    const surface=makeCanvas();surface.width=descriptor.width;surface.height=descriptor.height;token.canvas=surface;
    const options={autoplay:false,idle:true,followPointer:false,maxPixelRatio:1};
    const p=vrm?new vrm.BodyPlayer(surface,new vrm.VrmBody({framing:'bust'}),options):new engine.Player(surface,options);token.player=p;
    await p.load(descriptor.modelUrl);
    if(token.cancelled||loading!==token){release(p,surface);return;}
    player=p;canvas=surface;loading=null;last=now();baseTuning=p.puppet?.tuning?{...p.puppet.tuning}:null;applyControls();
    p.use({order:100,update(f){
      const input=frameInput;
      f.params.eyeLOpen=f.params.eyeROpen=face.eye;
      f.params.browLY=face.browL;f.params.browRY=face.browR;
      f.params.eyeBallX=clamp(input.gazeX+face.gazeX,-1,1);f.params.eyeBallY=clamp(input.gazeY+face.gazeY,-1,1);
      f.params.angleX+=input.gazeX*5;f.params.angleY+=input.gazeY*3;f.params.angleZ+=face.tilt;
      // The same local audio envelope that owns the mouth adds a gentle phrase
      // nod; never acquire a second audio source or retrigger actions per chunk.
      if(!input.frozen&&controls.idle){
       const t=input.time;
       f.params.angleY-=speechActivity*(3+1.6*Math.sin(t*2.4));
       f.params.angleX+=speechActivity*1.8*Math.sin(t*1.7);
       f.params.angleZ+=speechActivity*.8*Math.sin(t*1.3);
      }
      if(input.frozen)Object.assign(f.params,{angleX:0,angleY:0,angleZ:0,bodyX:0,bodyZ:0,breath:0});
      else if(input.pose)for(const key of ['angleX','angleY','angleZ','bodyX','bodyZ'])if(Number.isFinite(input.pose[key]))f.params[key]=clamp(input.pose[key],-20,20);
      for(const [key,value] of Object.entries(controls.params))if(!input.speaking||!['mouthOpen','vowel'].includes(key))f.params[key]=value;
      if(input.blink)f.params.eyeLOpen=f.params.eyeROpen=0;
    }});
    if(cue&&cue.until>now()){const pending=cue;expression({...pending,durationMs:pending.until-now()});}
    draw({force:true});
   }catch(failure){if(token.cancelled||loading!==token&&player!==token.player)return;reset();error=String(failure.message||failure);onError(failure);}
  }
  function applyExpression(){
   if(!player)return;
   const requested=controls.expression?[controls.expression]:expressionIds[cue?.emotion||cue?.reaction]||[];
   const available=activeDescriptor?.expressions||player.expressions||[];
   const id=requested.find(id=>available.some(e=>e.id===id))||null;
   activeExpression=player.setExpression(id,controls.expression?controls.weight:1)===false?null:id;
  }
  function applyControls(){
   if(!player)return;
   const {focalLengthMm,...view}=controls.view;
   Object.assign(player.view||{},view);
   player.body?.setFraming?.(view.head?'head':'bust',focalLengthMm);
   applyExpression();
   if(away!==controls.away){player.setAway(controls.away);away=controls.away;}
   player.lookAt?.(controls.gaze?.x??null,controls.gaze?.y??0);
  }
  function setControls(input){
   const next=controlsApi.normalize(input);
   if(JSON.stringify(next)===JSON.stringify(controls))return;
   const viewChanged=JSON.stringify(next.view)!==JSON.stringify(controls.view);
   controls=next;
   applyControls();
   if(player&&controls.paused&&viewChanged)draw({...lastDrawInput,force:true});
  }
  function command(input){
   if(!player||controls.paused||input?.characterId!==characterId||input?.modelId!==activeDescriptor.id||input?.version!==activeDescriptor.version||typeof input.id!=='string'||seenCommands.has(input.id)||!Number.isFinite(input.expiresAt)||input.expiresAt<Date.now()||input.expiresAt>Date.now()+10000)return false;
   if(![...controlsApi.actions,'blink'].includes(input.action))return false;
   seenCommands.add(input.id);if(seenCommands.size>100)seenCommands.delete(seenCommands.values().next().value);
   if(input.action==='blink'){manualBlinkUntil=now()+180;player.blink?.();}else player.act(input.action);return true;
  }
  const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
  function draw({mouth=0,level=0,blink=false,gazeX=0,gazeY=0,motion={},reduced=false,pose=null,vowel=0,force=false}={}){
   if(!player)return null;
   if(controls.paused&&!force){last=now();return canvas;}
   lastDrawInput={mouth,level,blink,gazeX,gazeY,motion,reduced,pose,vowel};
   try{
    const current=now(),dt=controls.paused?0:clamp((current-last)/1000,0,.05);last=current;
    if(cue&&current>=cue.until){cue=null;applyExpression();}
    const frozen=reduced||motion.idleMotionEnabled===false;
    const speechTarget=level>.005?clamp(level*3):mouth>.02?.45:0;
    speechActivity=frozen||!controls.idle?0:speechActivity+(speechTarget-speechActivity)*(1-Math.exp(-dt*(speechTarget>speechActivity?10:4)));
    if(baseTuning&&player.puppet?.tuning){player.puppet.tuning.turn=baseTuning.turn*controls.motionStrength;player.puppet.tuning.breath=baseTuning.breath*controls.motionStrength;}
    player.idle=!frozen&&controls.idle;
    if(player.body){player.motionScale=controls.motionStrength;player.body.setMotionEnabled?.(!frozen);}
    if(player.puppet)player.puppet.physicsScale=frozen?0:clamp(Number(motion.hairWarp??38)/38,0,2);
    if(frozen)player.puppet?.resetPhysics?.();
    const p=player.params;
    const mood=controls.expression==='smile'?'joy':controls.expression||cue?.emotion||cue?.reaction;
    const target=faces[mood]||faces.neutral;
    const weight=controls.expression?controls.weight:1;
    const ease=1-Math.exp(-dt*9);for(const key of Object.keys(face))face[key]+=(faces.neutral[key]+(target[key]-faces.neutral[key])*weight-face[key])*ease;
    const speaking = level > .005 || mouth > .02;
    // VRM's fully weighted viseme opens the jaw wider than everyday speech.
    const speechMouth = clamp(mouth) * (activeDescriptor.kind === 'vrm' && speaking ? .55 : 1);
    p.mouthOpen = Number.isInteger(cue?.forceMouth) ? clamp(cue.forceMouth / 2) : Math.max(speechMouth, speaking ? 0 : face.mouth);
    p.vowel = clamp(speaking ? vowel : mood === 'surprised' ? -1 : vowel, -1, 1);
    p.eyeBallX=clamp(gazeX,-1,1);p.eyeBallY=clamp(gazeY,-1,1);
    // The host owns blinking; use a driver so upstream idle cannot reopen the eyes.
    frameInput={blink:blink||cue?.forceEyesClosed===true||now()<manualBlinkUntil,frozen,gazeX:clamp(controls.gaze?.x??gazeX,-1,1),gazeY:clamp(controls.gaze?.y??gazeY,-1,1),pose,speaking,time:current/1000};
    player.advance(dt);return canvas;
   }catch(failure){reset();error=String(failure.message||failure);onError(failure);return null;}
  }
  return {sync,expression,draw,command,setControls,snapshot(){return canvas?.toDataURL?.('image/png')||null;},dispose(){reset();identity='';characterId='';},status:()=>({ready:Boolean(player),loading:Boolean(loading),identity,error,activeExpression,controls:controlsApi.normalize(controls),model:player?.model||null,parameters:player?{...(player.frameParams||player.puppet?.params)}:null,vrm:player?.body?.status?.()||null,
      hairMotion:player?Math.max(0,...(player.puppet?.chainRuns||[]).flatMap(c=>Array.from(c.disp||[])).map(Math.abs)):0})};
 }
 return {create};
});
