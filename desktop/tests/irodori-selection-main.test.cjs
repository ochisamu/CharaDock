const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
function productionFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const rest = main.slice(start + 1);
  const end = rest.search(/^\s*(?:async )?function /m);
  return main.slice(start, start + 1 + end);
}
function harness() {
  const data = { characterId: 'kohaku', irodoriV41AnimeModelDirectory: '/models/anime', irodoriV4Int4ModelDirectory: '/models/small', characterTtsProfiles: { kohaku: { provider: 'irodori-webgpu', irodoriVersion: 'v4-small', irodoriPrecision: 'int4', irodoriMode: 'design' }, hiro: { provider: 'system' } } };
  const calls = [];
  const context = vm.createContext({
    preferences: { data, patch: p => Object.assign(data,p) },
    characterTtsSettings: (id=data.characterId) => data.characterTtsProfiles[id],
    updatedCharacterTtsProfiles: (id,p) => ({...data.characterTtsProfiles, [id]:{...data.characterTtsProfiles[id],...p}}),
    activeIrodoriVoice: () => null,
    irodoriVoiceLibrary: { publicVoices: () => [] },
    irodoriWebGpuAvailable: true,
    irodoriModelStatus: (directory,ref,gpu,options) => { calls.push({directory,options}); return {modelReady:directory==='/models/anime'||directory==='/models/small'}; },
    mainText: ja=>ja, scheduleIrodoriPrewarm:()=>{}, mascotWindow:null,
  });
  vm.runInContext(productionFunction('remoteTtsModelSettings')+'\n'+productionFunction('applyRemoteTtsModelSetting'),context);
  return {context,data,calls};
}
test('remote Anime selection uses its own model directory and only changes the active character',()=>{
  const {context,data,calls}=harness();
  const field=context.remoteTtsModelSettings().fields[0];
  assert.equal(field.options.find(o=>o.value==='v4-anime:int4').available,true);
  assert.ok(!JSON.stringify(field).includes('/models/'));
  context.applyRemoteTtsModelSetting({key:'irodoriModelVariant',value:'v4-anime:int4'});
  assert.equal(calls.at(-1).directory,'/models/anime');
  assert.equal(calls.at(-1).options.version,'v4-anime');
  assert.equal(data.characterTtsProfiles.kohaku.irodoriVersion,'v4-anime');
  assert.equal(data.characterTtsProfiles.hiro.provider,'system');
  assert.equal(context.remoteTtsModelSettings().fields[0].value,'v4-anime:int4');
  context.applyRemoteTtsModelSetting({key:'irodoriModelVariant',value:'v4-small:int4'});
  assert.equal(calls.at(-1).directory,'/models/small');
});
test('remote cannot choose an uninstalled Anime model or a nonexistent FP16 variant',()=>{
  const {context,data}=harness();
  assert.throws(()=>context.applyRemoteTtsModelSetting({key:'irodoriModelVariant',value:'v4-anime:fp16'}));
  data.irodoriV41AnimeModelDirectory='';
  assert.throws(()=>context.applyRemoteTtsModelSetting({key:'irodoriModelVariant',value:'v4-anime:int4'}));
  assert.equal(data.characterTtsProfiles.kohaku.irodoriVersion,'v4-small');
});
