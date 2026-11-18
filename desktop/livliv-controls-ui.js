// SPDX-License-Identifier: Apache-2.0
(function(root){'use strict';
 const schema=root.CharaDockLivlivControls;
 function create({container,onPatch,onCommand,onSnapshot,onRemove}){
  let descriptor=null,characterId='',language='ja',identity='',current=schema.normalize(),epoch=0,pending=null,sending=false;
  const fields={},commands=[];let status,expression,weight,credit;
  const t=(ja,en)=>language==='en'?en:ja;
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const scope=()=>({characterId,modelId:descriptor.id,version:descriptor.version});
  function tell(message,error=false){status.textContent=message;status.classList.toggle('is-error',error);}
  async function drain(){if(sending||!pending)return;const patch=pending,input={...scope(),patch},mine=epoch;pending=null;sending=true;
   try{await onPatch(input);if(mine===epoch)tell(t('保存しました','Saved'));}catch(error){if(mine===epoch)tell(error.message,true);}finally{sending=false;if(pending)void drain();}}
  function patch(value){current=schema.merge(current,value);pending=value.reset?value:{...pending,...value,params:{...pending?.params,...value.params},view:{...pending?.view,...value.view}};refresh();void drain();}
  function button(parent,label,click,command=false){const b=el('button',label);b.type='button';b.addEventListener('click',async()=>{try{await click();}catch(error){tell(error.message,true);}});parent.append(b);if(command)commands.push(b);return b;}
  function toggle(parent,key,ja,en){const label=el('label',undefined,'livliv-toggle'),input=el('input');input.type='checkbox';input.dataset.livlivControl=key;label.append(input,el('span',t(ja,en)));parent.append(label);input.addEventListener('change',()=>patch({[key]:input.checked}));fields[key]=input;}
  function slider(parent,key,label,min,max,step,read,write){const row=el('label',undefined,'livliv-range'),head=el('span',label),output=el('output'),input=el('input');input.type='range';Object.assign(input,{min,max,step});input.dataset.livlivControl=key;head.append(output);row.append(head,input);parent.append(row);input.addEventListener('input',()=>{output.value=Number(input.value).toFixed(step<1?2:0);write(Number(input.value));});fields[key]={input,output,read};return row;}
  function build(){container.replaceChildren();commands.length=0;for(const key of Object.keys(fields))delete fields[key];container.classList.add('livliv-controls');
   const title=el('h4',descriptor.kind==='vrm'?t('VRMの動き','VRM controls'):t('LivLivの動き','LivLiv controls'));container.append(title);
   const row=el('div',undefined,'livliv-actions');container.append(row);
   const names={nod:['うなずく','Nod'],shake:['首を振る','Shake'],tilt:['首をかしげる','Tilt'],hop:['弾む','Hop'],shy:['照れる','Shy'],blink:['まばたき','Blink']};
   for(const [action,namesPair] of Object.entries(names))button(row,t(...namesPair),()=>onCommand({...scope(),action}),true);
   const modes=el('div',undefined,'livliv-toggles');container.append(modes);toggle(modes,'away','居眠り','Doze');toggle(modes,'idle','自然な動き','Idle motion');toggle(modes,'paused','動きを停止','Pause');
   slider(container,'motionStrength',t('動きの大きさ','Movement size'),.5,1.5,.05,()=>current.motionStrength,v=>patch({motionStrength:v}));
   const label=el('label',t('表情','Expression'));expression=el('select');expression.dataset.livlivControl='expression';expression.append(new Option(t('会話に合わせる','Follow conversation'),''));for(const e of descriptor.expressions||[])expression.append(new Option(typeof e.label==='string'?e.label:e.label?.[language]||e.id,e.id));label.append(expression);container.append(label);expression.addEventListener('change',()=>patch({expression:expression.value||null}));
   slider(container,'weight',t('表情の強さ','Expression strength'),0,1,.01,()=>current.weight,v=>patch({weight:v}));
   const gaze=el('fieldset'),legend=el('legend',t('視線','Gaze')),pad=el('div',undefined,'livliv-gaze');gaze.append(legend,pad);container.append(gaze);
   for(const [x,y,label] of [[-1,1,'↖'],[0,1,'↑'],[1,1,'↗'],[-1,0,'←'],[0,0,'●'],[1,0,'→'],[-1,-1,'↙'],[0,-1,'↓'],[1,-1,'↘']]){const b=button(pad,label,()=>patch({gaze:{x,y}}));b.setAttribute('aria-label',t('視線','Gaze')+' '+x+', '+y);}
   button(gaze,t('視線を自動に戻す','Automatic gaze'),()=>patch({gaze:null}));
   const display=el('details');
   const isVrm=descriptor.kind==='vrm';
   display.append(el('summary',isVrm?t('カメラと構図','Camera and framing'):t('表示と姿勢の調整','Placement and pose')));
   if(isVrm){
    const lens=schema.vrmFocalLength;
    slider(display,'view_focalLengthMm',t('焦点距離（mm）','Focal length (mm)'),lens.min,lens.max,1,
     ()=>current.view.focalLengthMm,v=>patch({view:{focalLengthMm:v}}));
    const presets=el('div',undefined,'livliv-actions');
    button(presets,t('約68 mm・従来の見え方','68 mm · Original view'),()=>patch({view:{focalLengthMm:lens.default}}));
    button(presets,t('150 mm・ポートレート','150 mm · Portrait'),()=>patch({view:{focalLengthMm:lens.portrait}}));
    display.append(presets,el('p',t(
     '35mm判換算。長くするほど遠近感が弱まり、拡大率で顔の大きさを調整できます。',
     'Full-frame equivalent. A longer lens softens perspective. Use zoom to adjust the size in the frame.'
    ),'livliv-hint'));
   }
   if(isVrm)title.after(display);else container.append(display);
   const head=el('label',undefined,'livliv-toggle'),headInput=el('input');headInput.type='checkbox';headInput.dataset.livlivControl='head';head.append(headInput,el('span',t('顔を中心に表示','Frame the head')));display.append(head);fields.head=headInput;headInput.addEventListener('change',()=>patch({view:{head:headInput.checked}}));
   for(const [key,ja,en,min,max,step] of [['zoom','拡大率','Zoom',.25,4,.01],['x','左右の位置','Horizontal position',-1,1,.01],['y','上下の位置','Vertical position',-1,1,.01]])slider(display,'view_'+key,t(ja,en),min,max,step,()=>current.view[key],v=>patch({view:{[key]:v}}));
   const advanced=el('details'),advSummary=el('summary',t('パラメーターを指定','Set parameters'));advanced.append(advSummary,el('p',t('チェックを外すと自動に戻ります。発話中の口は音声に合わせます。モデルの作りによって動く範囲が異なります。','Uncheck to return to automatic. Speech controls the mouth while speaking. Supported movement depends on the model.'),'livliv-hint'));container.append(advanced);
   const labels={angleX:['顔の左右','Head yaw'],angleY:['顔の上下','Head pitch'],angleZ:['顔の傾き','Head tilt'],eyeLOpen:['左目の開き','Left eye'],eyeROpen:['右目の開き','Right eye'],eyeBallX:['瞳の左右','Gaze X'],eyeBallY:['瞳の上下','Gaze Y'],browLY:['左眉','Left brow'],browRY:['右眉','Right brow'],mouthOpen:['口の開き','Mouth open'],vowel:['口の形','Vowel'],smile:['笑顔','Smile'],bodyX:['体の向き','Body turn'],bodyZ:['体の傾き','Body lean'],breath:['呼吸','Breath']};
   for(const [key,[min,max]] of Object.entries(schema.ranges)){
    const box=el('div',undefined,'livliv-param'),check=el('input');check.type='checkbox';check.setAttribute('aria-label',t(...labels[key])+t('を指定',' override'));check.dataset.livlivOverride=key;box.append(check);advanced.append(box);
    slider(box,'param_'+key,t(...labels[key]),min,max,max>1?1:.01,()=>current.params[key]??(['eyeLOpen','eyeROpen'].includes(key)?1:0),v=>patch({params:{[key]:v}}));fields['override_'+key]=check;
    check.addEventListener('change',()=>patch({params:{[key]:check.checked?Number(fields['param_'+key].input.value):null}}));
   }
   const footer=el('div',undefined,'livliv-actions');container.append(footer);button(footer,t('PNGで保存','Save PNG'),()=>onSnapshot(scope()));button(footer,t('調整をリセット','Reset adjustments'),()=>patch({reset:true}));
   if (descriptor.kind === 'vrm' && onRemove) {
    const remove = button(footer, t('読み込んだVRMを削除', 'Remove imported VRM'), async () => {
     const input = scope();
     const name = descriptor.name;
     if (!window.confirm(t(
      `「${name}」をCharaDockから削除しますか？ 元のVRMファイルは残ります。`,
      `Remove “${name}” from CharaDock? The original VRM file will be kept.`
     ))) return;
     remove.disabled = true;
     try { await onRemove(input); }
     finally { remove.disabled = false; }
    });
    remove.dataset.livlivControl = 'remove';
   }
   credit=el('p',undefined,'livliv-hint');container.append(credit);status=el('p',undefined,'livliv-status');status.setAttribute('role','status');container.append(status);
  }
  function refresh(){if(!descriptor)return;
   for(const [key,node] of Object.entries(fields)){
    if(node.read){if(document.activeElement!==node.input)node.input.value=node.read();node.output.value=Number(node.input.value).toFixed(Number(node.input.step)<1?2:0);}
    else if(key.startsWith('override_'))node.checked=Object.hasOwn(current.params,key.slice(9));
    else node.checked=key==='head'?current.view.head:current[key];
   }
   for(const key of Object.keys(schema.ranges))fields['param_'+key].input.disabled=!Object.hasOwn(current.params,key);
   expression.value=current.expression||'';fields.weight.input.disabled=!current.expression;
   for(const button of commands)button.disabled=current.paused;
   const meta=descriptor.meta;credit.textContent=[meta?.author?.name,meta?.license?.id||meta?.license?.url,descriptor.kind==='vrm'?t('バストアップ表示。口パク・まばたき・表情はモデルの登録内容に応じて動きます。','Bust-up framing. Lip sync, blinking and expressions use the model’s available shapes.'):null,descriptor.id==='kohaku'?t('コハクの瞳は元絵を保持し、眉と口は表情差分で変わります。','Kohaku retains the original pupils; expression artwork changes the brows and mouth.'):null].filter(Boolean).join(' · ');
  }
  function sync(next,id,lang='ja'){
   const nextIdentity=next?`${id}:${next.id}:${next.version}:${lang}`:'';
   if(nextIdentity!==identity){identity=nextIdentity;epoch++;pending=null;descriptor=next;characterId=id;language=lang;if(next)build();else container.replaceChildren();}
   container.hidden=!next;if(!next)return;descriptor=next;current=schema.normalize(next.controls);if(pending)current=schema.merge(current,pending);refresh();
  }
  return {sync};
 }
 root.CharaDockLivlivControlsUI={create};
})(globalThis);
