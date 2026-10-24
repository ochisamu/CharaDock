// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { RemoteCompanionServer } = require('../lib/remote-server.cjs');
const { kohakuPackage } = require('../lib/remote-kohaku.cjs');
test('authored assets require pairing, cannot traverse or fetch retired/private files, and never enter PWA cache', async t => {
  const root = path.resolve(__dirname, '../..'), pack = kohakuPackage(root);
  const server = new RemoteCompanionServer({ rootDir:path.join(root,'desktop/remote'), address:'127.0.0.1',port:0,
    allowLoopbackForTests:true,callbacks:{getState:()=>({}),getAuthoredAsset:file=>pack.read(file)} });
  await server.start();t.after(()=>server.stop());const origin=server.origin();
  assert.equal((await fetch(origin+'/api/authored/manifest.json')).status,401);
  const paired=await fetch(origin+'/api/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({token:new URL(server.pairingUrl()).hash.slice(7)})});
  assert.equal(paired.status,200);const cookie=paired.headers.get('set-cookie').split(';')[0];
  const get=file=>fetch(origin+'/api/authored/'+file,{headers:{Cookie:cookie}});
  assert.equal((await get('manifest.json')).status,200);
  const png=await get('neutral/front-hair.png');assert.equal(png.status,200);
  assert.equal(png.headers.get('cache-control'),'no-store');assert.equal(png.headers.get('content-type'),'image/png');
  for(const file of ['..%2fpreferences.json','neutral%2f..%2f..%2fdesktop%2fmain.cjs','cels/unknown.png','manifest.json%00.png',
    'tilt/eyes-open-mouth-closed.png'])assert.equal((await get(file)).status,404,file);
  for(const file of ['drawn-pose-runtime.js','remote-authored-avatar.js','remote-speech-caption.js'])assert.equal((await fetch(origin+'/'+file)).status,200);
  const shell=await fetch(origin+'/').then(r=>r.text());assert.match(shell,/id="avatarAuthored"/);
  assert.match(shell,/drawn-pose-runtime\.js[\s\S]*remote-authored-avatar\.js[\s\S]*remote\.js/);
  const sw=await fetch(origin+'/service-worker.js').then(r=>r.text());assert.match(sw,/charadock-link-network-audio-v12/);assert.match(sw,/live-capture-worklet\.js/);
  const capture=await fetch(origin+'/live-capture-worklet.js');assert.equal(capture.status,200);assert.match(await capture.text(),/registerProcessor/);
  assert.match(sw,/url\.pathname\.startsWith\("\/api\/"\)/);
});
