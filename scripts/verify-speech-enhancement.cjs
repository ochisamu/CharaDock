// SPDX-License-Identifier: Apache-2.0
// Opt-in: node verify-speech-enhancement.cjs SOURCE PROFILE OUTPUT.
// Reads installed models; writes only OUTPUT and does not change preferences.
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const [source, profile, output] = process.argv.slice(2);
if (!source || !profile || !output) throw new Error('Supply SOURCE PROFILE OUTPUT');
fs.mkdirSync(output, { recursive: true });
const { SpeechCppClient, waveDataUrl } = require(path.join(source, 'desktop/lib/speech-cpp-client.cjs'));
const { EmbeddedTtsModels } = require(path.join(source, 'desktop/lib/tts-model-download.cjs'));
const { SpeechEnhancement } = require(path.join(source, 'desktop/lib/speech-enhancement.cjs'));
const { EmbeddedSherpaOnnx } = require(path.join(source, 'desktop/lib/sherpa-embedded.cjs'));
const { resampleLinear, padReazonSpeechWaveform } = require(path.join(source, 'desktop/lib/streaming-speech-recognition.cjs'));
const prefs = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
const text = '音声テストです。これからよろしくね。';
const result = { text, hardware: 'RTX 5060 Ti 16 GB', tts: [], enhancement: [], recognition: {} };
const write = () => fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
const save = (name, pcm, rate) => fs.writeFileSync(path.join(output, name), Buffer.from(waveDataUrl(pcm.toString('base64'), rate).split(',')[1], 'base64'));
const toPcm = samples => { const pcm = Buffer.alloc(samples.length * 2); for (let i=0;i<samples.length;i++) pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),i*2); return pcm; };
const models = new EmbeddedTtsModels(path.join(profile, 'tts-models'));
const enhancer = new SpeechEnhancement(path.join(profile, 'speech-enhancement-models'), { getEnabled: () => true });
const clients = [];
(async () => {
  const selected = prefs.characterTtsProfiles?.[prefs.characterId] || {};
  const voiceId = selected.irodoriVoiceId || prefs.irodoriVoiceId || 'builtin-kohaku';
  const ref = path.join(profile, 'irodori-voices', voiceId + '.wav');
  let clean;
  for (const variant of ['mf','small']) {
    const paths = models.installedPaths(variant === 'mf' ? 'speech-cpp' : 'speech-cpp-small');
    const client = new SpeechCppClient(); clients.push(client);
    const started = performance.now();
    const first = await client.start({ ...paths, variant, steps: prefs[variant === 'mf' ? 'speechCppMfSteps' : 'speechCppSmallSteps'] || (variant === 'mf' ? 6 : 16), referenceAudioPath: ref, mode: 'reference', playbackRate: 1, seed: 42, ownerId: variant, chunks: [{ text }] });
    const firstAudioMs = Math.round(performance.now() - started), chunks = [Buffer.from(first.pcmChunk, 'base64')];
    let next;
    do { next = await client.next(first.streamId, variant); if (next.pcmChunk) chunks.push(Buffer.from(next.pcmChunk, 'base64')); } while (!next.done);
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) throw new Error('Native TTS produced no audio');
    save('tts-' + variant + '.wav', pcm, 48000);
    result.tts.push({ variant, version: execFileSync(paths.executablePath,['--version']).toString().trim(), firstAudioMs, generationMs: Math.round(performance.now()-started), audioSeconds: pcm.length / 96000 });
    if (variant === 'mf') { const f = new Float32Array(pcm.length / 2); for(let i=0;i<f.length;i++) f[i]=pcm.readInt16LE(i*2)/32768; clean=resampleLinear(f,48000); }
    client.stop(); write();
  }
  let energy = 0; for (const value of clean) energy += value * value;
  const rms = Math.sqrt(energy / clean.length), noiseScale = rms / Math.pow(10,5/20) * Math.sqrt(3);
  let seed = 123456; const noisy = clean.map(value => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return Math.max(-1,Math.min(1,value+((seed/4294967296)*2-1)*noiseScale)); });
  save('input-clean.wav',toPcm(clean),16000); save('input-noisy.wav',toPcm(noisy),16000);
  let enhanced;
  for(let run=0;run<2;run++) {
    const start=performance.now(); enhanced=await enhancer.enhance({ samples:noisy,sampleRate:16000 });
    result.enhancement.push({ run,cold:run===0,inputSeconds:noisy.length/16000,elapsedMs:Math.round(performance.now()-start),inferenceMs:enhanced.latencyMs,outputSamples:enhanced.samples.length }); write();
  }
  save('input-enhanced.wav',toPcm(enhanced.samples),16000); enhancer.stop();
  const sherpa = new EmbeddedSherpaOnnx(path.join(profile,'sherpa-onnx-models'), { modelId:'reazonspeech-ja-int8' });
  for (const [name,samples] of [['clean',clean],['noisy',noisy],['enhanced',enhanced.samples]]) {
    const start=performance.now(); result.recognition[name]={text:await sherpa.transcribe({samples:padReazonSpeechWaveform(samples),sampleRate:16000}),elapsedMs:Math.round(performance.now()-start)}; write();
  }
  result.passed = result.tts.length===2 && result.enhancement.every(row=>row.outputSamples===noisy.length) && Object.values(result.recognition).every(row=>row.text);
  result.note = 'One synthetic Japanese utterance with deterministic white noise at 5 dB SNR. This does not establish quality or latency for real microphone, car noise or all speakers.'; write();
  console.log(JSON.stringify(result));
})().catch(error=>{result.error=error.message;result.passed=false;write();console.error(error.stack);process.exitCode=1;}).finally(()=>{for(const c of clients)c.stop();enhancer.stop();});