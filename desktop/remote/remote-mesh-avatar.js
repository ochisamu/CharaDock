// SPDX-License-Identifier: Apache-2.0
(function(root,factory) {
  const api=factory(); if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.CharaDockRemoteMeshAvatar=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  function create({canvas,shell,runtime,engine,raf=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id),
    visible=()=>!document.hidden,reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches,onError=()=>{}}) {
    const ctx=canvas.getContext('2d'); let frame=null,settings={},mouth=0,level=0,blink=false;
    const expose=active=>{canvas.hidden=!active;shell.classList.toggle('is-mesh',active);};
    const controller=runtime.create({engine,onError:error=>{stop();expose(false);onError(error);}});
    function stop(){if(frame!==null)cancel(frame);frame=null;}
    function draw(){
      frame=null; if(!visible())return;
      const surface=controller.draw({mouth,level,blink,motion:settings,reduced:reduced()});
      if(!surface || !ctx){expose(false);return;}
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const scale=Math.min(canvas.width/surface.width,canvas.height/surface.height);
      ctx.drawImage(surface,(canvas.width-surface.width*scale)/2,canvas.height-surface.height*scale,surface.width*scale,surface.height*scale);
      expose(true);frame=raf(draw);
    }
    function resume(){if(visible() && controller.status().ready && frame===null)frame=raf(draw);else if(!visible())stop();}
    async function sync(character){
      settings=character?.motion || {};
      const before=controller.status().identity;
      const loading=controller.sync(character?.meshAvatar,character?.id || '');
      if(before!==controller.status().identity){stop();expose(false);mouth=level=0;blink=false;}
      await loading;resume();
    }
    return {sync,expression:controller.expression,visibility:resume,
      audio(stage,rms){mouth=({closed:0,half:.5,open:1})[stage]??0;level=Math.max(0,Math.min(1,Number(rms)||0));},
      blink(value){blink=Boolean(value);},dispose(){stop();controller.dispose();expose(false);},status:controller.status};
  }
  return {create};
});
