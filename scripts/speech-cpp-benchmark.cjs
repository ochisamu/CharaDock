// SPDX-License-Identifier: Apache-2.0
// Opt-in Windows / Electron benchmark. Uses production WebGPU preload and native client;
// never changes the supplied profile preferences. Models must already be installed.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const [source, profile, output, backend = "all"] = process.argv.slice(2);
if (!source || !profile || !output) throw Error("Supply SOURCE PROFILE OUTPUT [all|native|webgpu|webgpu-int4]");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "electron-profile"));
const { SpeechCppClient, waveDataUrl } = require(path.join(source, "desktop/lib/speech-cpp-client.cjs"));
// RF has 40 steps by default. Match CharaDock's 16-step independent-CFG recipe explicitly.
class RfBenchmarkClient extends SpeechCppClient {
  write(message) {
    if (message.type === "synthesize") message = { ...message, steps: 16,
      cfg_scale_text: 3, cfg_scale_speaker: 5, cfg_scale_instructions: 3,
      cfg_guidance_mode: "independent", cfg_min_t: .5, cfg_max_t: 1,
      speaker_uncond_mode: "mask", sway_coeff: 0 };
    super.write(message);
  }
}
const settings = {
  text: "新しい音声エンジンでも、いつもの声で話せるよ。",
  caption: "自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。",
  referenceAudioPath: path.join(profile, "irodori-voices/builtin-hiro.wav"),
  seed: 42, speed: 1, steps: 16, schedule: "linear",
  guidance: { text: 3, speaker: 5, instructions: 3, mode: "independent", minT: .5, maxT: 1 },
};
const rows = [], clients = [], windows = [];
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
function save() {
  fs.writeFileSync(path.join(output, `benchmark-${backend}.json`), JSON.stringify({
    hardware: "NVIDIA GeForce RTX 5060 Ti 16 GB", model: "Irodori v4.1 Small (RF)",
    settings, note: "First audio data, before playback; cold means first request in a fresh process, not empty disk caches. Numeric seeds do not yield identical waveforms across ports.",
    rows, warmMedians: Object.fromEntries([...new Set(rows.map(r=>r.provider))].map(provider=> {
      const warm = rows.filter(r=>r.provider===provider&&!r.cold);
      return [provider, { firstAudioMs: median(warm.map(r=>r.firstAudioMs)), generationMs: median(warm.map(r=>r.generationMs)), durationSeconds: median(warm.map(r=>r.durationSeconds)) }];
    })),
  }, null, 2));
}
function record(provider, run, started, firstAudioMs, pcm, chunks, metrics) {
  const generationMs = Math.round(performance.now()-started);
  assert.ok(pcm.length > 48000, "Expected more than half a second of audio");
  fs.writeFileSync(path.join(output, `${provider}-${run}.wav`), Buffer.from(waveDataUrl(pcm.toString("base64"), 48000).split(",")[1], "base64"));
  rows.push({ provider, run, cold:run===0, firstAudioMs, generationMs, durationSeconds:pcm.length/96000, chunks, metrics });
  save(); console.log("BENCHMARK", JSON.stringify(rows.at(-1)));
}
async function native() {
  const client = new RfBenchmarkClient(); clients.push(client);
  const options = { executablePath:path.join(profile,"tts-models/speech-cpp-irodori-mf-v0.8.3/runtime/speech.exe"),
    modelPath:path.join(profile,"tts-models/speech-cpp-irodori-v4.1-small/Irodori-TTS-859M-v4.1-F16.gguf"),
    referenceAudioPath:settings.referenceAudioPath, mode:"reference", seed:settings.seed, playbackRate:settings.speed, guardReferenceDuration:false, trimTrailingUtterance:false };
  for (let run=0; run<4; run++) {
    const started=performance.now();
    const first=await client.start({...options,ownerId:1,chunks:[{text:settings.text,instructions:settings.caption}]});
    const firstAudioMs=Math.round(performance.now()-started), pcm=[Buffer.from(first.pcmChunk,"base64")]; let chunks=1, next;
    do { next=await client.next(first.streamId,1); if(next.pcmChunk){pcm.push(Buffer.from(next.pcmChunk,"base64"));chunks++;} } while(!next.done);
    record("speech-cpp-fp16",run,started,firstAudioMs,Buffer.concat(pcm),chunks);
  }
  client.stop();
}
async function webgpu(precision) {
  const ready=new Promise(resolve=>ipcMain.once("irodori:ready", (_event,state)=>resolve(state)));
  const window=new BrowserWindow({show:false,width:320,height:240,webPreferences:{
    preload:path.join(source,"desktop/preload-irodori.cjs"), nodeIntegration:false, contextIsolation:true, sandbox:false, backgroundThrottling:false }});
  windows.push(window);await window.loadFile(path.join(source,"desktop/irodori.html"));
  assert.equal((await ready).webgpuAvailable,true);
  const directory=precision==="fp16"?"irodori-tts-v4.1-small-webgpu-fp16-r1":"irodori-tts-v4.1-small-quantized-webgpu-int4-r1";
  for(let run=0;run<4;run++) {
    const requestId=randomUUID();const result=new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>{ipcMain.removeListener("irodori:result",receive);reject(Error("WebGPU request timeout"));},600000);
      function receive(event,value){if(event.sender!==window.webContents||value.requestId!==requestId)return;clearTimeout(timer);ipcMain.removeListener("irodori:result",receive);value.error?reject(Error(value.error)):resolve(value);}
      ipcMain.on("irodori:result",receive);
    });
    const started=performance.now();window.webContents.send("irodori:synthesize",{
      requestId,text:settings.text,caption:settings.caption,referenceAudioPath:settings.referenceAudioPath,
      modelDirectory:path.join(profile,"tts-models",directory),version:"v4-small",precision,mode:"reference",
      numSteps:settings.steps,tScheduleMode:"linear",cfgExecution:"sequential",seed:settings.seed,
    });
    const value=await result,firstAudioMs=Math.round(performance.now()-started);
    assert.equal(value.metrics.generationSteps,16);assert.equal(value.metrics.generationSchedule,"linear");
    const wav=Buffer.from(value.audioDataUrl.split(",")[1],"base64");assert.equal(wav.readUInt32LE(24),48000);
    record(`irodori-webgpu-${precision}`,run,started,firstAudioMs,wav.subarray(44),1,value.metrics);
  }
  window.destroy();
}
(async()=> {
  await app.whenReady();
  if(backend==="all"||backend==="native") await native();
  if(backend==="all"||backend==="webgpu") await webgpu("fp16");
  if(backend==="all"||backend==="webgpu-int4") await webgpu("int4");
  console.log("PASS",path.join(output,`benchmark-${backend}.json`));
})().catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(output,`benchmark-${backend}-error.txt`),error.stack);process.exitCode=1;})
.finally(()=>{for(const c of clients)c.stop();for(const w of windows)if(!w.isDestroyed())w.destroy();app.exit(process.exitCode||0);});
