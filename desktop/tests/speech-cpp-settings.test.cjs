// SPDX-License-Identifier: Apache-2.0
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {Preferences}=require("../lib/preferences.cjs");
const {speechCppConfiguration,normalizeSpeechCppSettings}=require("../lib/speech-cpp-settings.cjs");
const {EmbeddedTtsModels,TTS_MODELS,requiredPaths}=require("../lib/tts-model-download.cjs");
test("native model and per-model steps persist without changing WebGPU or character voice",t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"native-settings-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file=path.join(directory,"preferences.json"),prefs=new Preferences(file),before=prefs.publicState();
  assert.equal(before.speechCppModelVariant,"mf");assert.equal(before.speechCppMfSteps,6);assert.equal(before.speechCppSmallSteps,16);
  prefs.patch({speechCppMfSteps:8,speechCppSmallSteps:24,speechCppModelVariant:"small",speechCppSmallModelPath:"private-model.gguf"});
  const state=new Preferences(file).publicState();assert.equal(state.speechCppMfSteps,8);assert.equal(state.speechCppSmallSteps,24);assert.equal(state.speechCppModelVariant,"small");
  assert.equal(state.irodoriVersion,before.irodoriVersion);assert.equal(state.irodoriSteps,before.irodoriSteps);assert.deepEqual(state.characterTtsProfiles,before.characterTtsProfiles);
  assert.equal(state.speechCppSmallModelPath,undefined);
  prefs.patch({speechCppModelVariant:"mf",speechCppMfSteps:-1,speechCppSmallSteps:1000});
  const bounded=new Preferences(file).publicState();assert.equal(bounded.speechCppMfSteps,1);assert.equal(bounded.speechCppSmallSteps,64);
  assert.deepEqual(normalizeSpeechCppSettings({speechCppMfSteps:"invalid",speechCppSmallSteps:17.8,speechCppModelVariant:"invalid"}),{speechCppMfSteps:6,speechCppSmallSteps:18,speechCppModelVariant:"mf"});
});
test("native selection resolves only its own model, steps and installed executable",()=>{
  const data={speechCppExecutablePath:"mf/speech.exe",speechCppModelPath:"mf/model.gguf",speechCppSmallModelPath:"small/model.gguf",speechCppMfSteps:8,speechCppSmallSteps:24};
  assert.deepEqual(speechCppConfiguration(data,{executablePath:"managed/mf.exe",modelPath:"managed/mf.gguf"}),{variant:"mf",steps:8,executablePath:"mf/speech.exe",modelPath:"mf/model.gguf"});
  assert.deepEqual(speechCppConfiguration({...data,speechCppModelVariant:"small"},{executablePath:"small/speech.exe"}),{variant:"small",steps:24,executablePath:"small/speech.exe",modelPath:"small/model.gguf"});
  assert.equal(speechCppConfiguration({...data,speechCppModelVariant:"small",speechCppSmallModelPath:""}).modelPath,"");
});
test("native model installation and removal are independent for Small and MF",t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"native-models-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const library=new EmbeddedTtsModels(directory,{platform:"win32"});
  for(const id of ["speech-cpp","speech-cpp-small"]){
    for(const file of requiredPaths(TTS_MODELS[id],path.join(directory,TTS_MODELS[id].directoryName))){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"fixture");}
    assert.equal(library.status(id).installed,true);assert.ok(library.installedPaths(id).modelPath.endsWith(path.normalize(TTS_MODELS[id].files[0].relativePath)));
  }
  const small=library.installedPaths("speech-cpp-small");library.remove("speech-cpp");
  assert.equal(library.status("speech-cpp").installed,false);assert.equal(library.status("speech-cpp-small").installed,true);assert.deepEqual(library.installedPaths("speech-cpp-small"),small);
});
