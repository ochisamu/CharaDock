// A real-browser check for the disposable demo. Node 22+, installed Chrome/Edge.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function main() {
 const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome'];
 const exe=candidates.find(x=>x&&fs.existsSync(x));
 if(!exe) throw new Error('An installed Chrome or Edge is required for visual verification.');
 const profile=path.join(__dirname,'.browser-profile');fs.mkdirSync(profile,{recursive:true});
 const browser=spawn(exe,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
 let stderr='';browser.stderr.on('data',x=>stderr+=x);browser.on('error',e=>stderr+=e.message);
 let socket;let pending=new Map();let id=0;
 try {
  for(let i=0;i<100&&!stderr.includes('DevTools listening on ws://');i++)await delay(100);
  const endpoint=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
  if(!endpoint)throw new Error('Browser did not start. '+stderr.slice(-300));
  const base='http://'+new URL(endpoint).host;
  const pages=await fetch(base+'/json/list').then(r=>r.json());
  socket=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl);
  socket.addEventListener('message',e=>{const p=JSON.parse(String(e.data));const q=pending.get(p.id);if(q){pending.delete(p.id);p.error?q.reject(new Error(p.error.message)):q.resolve(p.result)}});
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(new Error(method+' timed out'))},15000);pending.set(key,{resolve:x=>{clearTimeout(timer);resolve(x)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id:key,method,params}))});
  const report=[];
  for(const width of [980,390]) {
   await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
   await call('Page.navigate',{url:pathToFileURL(path.join(__dirname,'index.html')).href});await delay(700);
   const r=await call('Runtime.evaluate',{expression:`(()=>{const grid=document.querySelector('.session-grid');const box=grid.getBoundingClientRect();const cards=[...document.querySelectorAll('.session')];const clipped=cards.some(c=>{const r=c.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.right>box.right+1});const buttons=[...document.querySelectorAll('[data-session]')];const choices=buttons.map(b=>{b.click();return document.querySelector('#selection').textContent.includes(b.dataset.session)});return {width:innerWidth,cards:cards.length,clipped,overflow:document.documentElement.scrollWidth>innerWidth,choicesWork:choices.length===3&&choices.every(Boolean)}})()`,returnByValue:true});
   report.push(r.result.value);
  }
  console.log(JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(__dirname,'layout-check.json'),JSON.stringify(report,null,2));
  await call('Browser.close').catch(()=>{});
  if(report.some(r=>r.cards!==3||r.clipped||r.overflow||!r.choicesWork))process.exitCode=1;
 }finally {socket?.close();browser.kill();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
