// SPDX-License-Identifier: Apache-2.0
// Read encrypted profile keys in Windows Electron; never write the source profile.
// Usage: electron verify-decisions-profile.cjs SOURCE PROFILE FRESH_OUTPUT
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const [source, profile, output] = process.argv.slice(2);
if (!source || !profile || !output) throw Error('Supply SOURCE PROFILE FRESH_OUTPUT');
fs.mkdirSync(output,{recursive:true});
const isolatedProfile=path.join(output,'electron-profile');fs.mkdirSync(isolatedProfile,{recursive:true});
fs.copyFileSync(path.join(profile,'Local State'),path.join(isolatedProfile,'Local State'));
app.setPath('userData',isolatedProfile);
const { DecisionClient } = require(path.join(source,'desktop/lib/decision-client.cjs'));
const guard=setTimeout(()=>{console.error('Profile API verification timed out');app.exit(1);},60000);
(async()=>{
  await app.whenReady();
  const prefs=JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'),'utf8'));
  const { Preferences }=require(path.join(source,'desktop/lib/preferences.cjs'));
  const isolatedPrefs=path.join(output,'preferences-copy.json');
  fs.copyFileSync(path.join(profile,'preferences.json'),isolatedPrefs);
  const settings=new Preferences(isolatedPrefs,safeStorage);
  console.log(JSON.stringify({profileOpenAIKeyConfigured:Boolean(settings.getApiKey()),profileJevKeyConfigured:Boolean(settings.getJevApiKey()),keyFormatValid:settings.getApiKey().startsWith('sk-')}));
  const decrypt=field=>field==='encryptedApiKey' ? settings.getApiKey() : settings.getJevApiKey();
  let provider='decisions';
  const { createJevDebug }=require(path.join(source,'desktop/lib/jev-debug.cjs'));
  const observe=createJevDebug({isPackaged:()=>false,getProvider:()=>provider});
  const client=new DecisionClient({observe,getProvider:()=>provider,getOpenAIApiKey:()=>decrypt('encryptedApiKey'),getJevApiKey:()=>decrypt('encryptedJevApiKey'),fetchImpl:async(url,options)=>{
    let response;
    try { response=await fetch(url,options); }
    catch(error) { console.log(JSON.stringify({transportError:error.name,code:error.cause?.code}));throw error; }
    console.log(JSON.stringify({httpStatus:response.status}));
    if(!response.ok) {
      const error=await response.clone().json().catch(()=>null);
      const code=['invalid_api_key','insufficient_quota','model_not_found','permission_denied'].includes(error?.error?.code)?error.error.code:'other';
      console.log(JSON.stringify({providerErrorCode:code}));
    }
    return {ok:response.ok,status:response.status,text:()=>response.text()};
  }});
  const results=[];
  async function check(name, operation, expected) {
    const started=Date.now(),result=await operation();
    const passed=typeof expected==='function' ? expected(result) : result===expected;
    results.push({name,passed,latencyMs:Date.now()-started,result});
    console.log(JSON.stringify(results.at(-1)));assert.ok(passed,name);
  }
  await check('connectivity',()=>client.test(),r=>r.ok===true);
  for(const [name,text,expected] of [
    ['media-next','次の曲にして','next'],['media-pause','音楽を一時停止して','pause'],
    ['media-negated','音楽は止めないで',null],['media-quoted','昨日「次の曲にして」と彼女が言った',null],
  ]) await check(name,()=>client.media(text),expected);
  await check('expression-warm',()=>client.expression('大丈夫、私は味方だよ。一緒にゆっくり進めようね。',{nikePerformance:true}),r=>r.emotion==='soft'&&r.forceMouth===null&&r.forceEyesClosed===null);
  await check('kohaku-listener',()=>client.expression('仕事で失敗して落ち込んでいます。',{nikePerformance:true,source:'user',allowedEmotions:['neutral','happy','thinking','surprised','soft','exasperated']}),r=>r.emotion==='soft');
  const { JevAddressGate }=require(path.join(source,'desktop/lib/jev-address-gate.cjs'));
  const gate=new JevAddressGate({classify:(...args)=>client.address(...args),enabled:()=>true,mode:()=> 'living',context:()=> 'コハク'});
  for(const [name,text,accepted] of [
    ['address-greeting','こんにちは',true],['address-request','今日のニュースを教えて',true],
    ['address-other-recipient','お母さん、お皿を取って',false],['address-noise','フッ',false],
  ]) await check(name,()=>gate.check(text,{handsfree:true,source:'profile-verification'}),r=>r.accepted===accepted);
  if(prefs.encryptedJevApiKey) {
    provider='jev';client.invalidate();await check('switch-back-jev',()=>client.test(),r=>r.ok===true);
    provider='decisions';client.invalidate();await check('switch-back-decisions',()=>client.test(),r=>r.ok===true);
  }
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,model:'gpt-6-luna',results,scope:'Real Decisions and JEV API calls using read-only encrypted profile keys; synthetic Japanese input; no playback or microphone'},null,2));
  clearTimeout(guard);app.quit();
})().catch(error=>{console.error(/^(Jev|Decisions|Decision) /.test(error.message)?error.message:'Profile API verification failed');app.exit(1);});
