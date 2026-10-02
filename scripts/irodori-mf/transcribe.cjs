// Diagnostic transcription, not a substitute for listening/quality evaluation.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sherpa = require('sherpa-onnx-node');
const [directory, modelRoot] = process.argv.slice(2);
if (!modelRoot) throw new Error('transcribe.cjs WAV_DIRECTORY REAZONSPEECH_MODEL_ROOT');
const recognizer = new sherpa.OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    numThreads: 4, provider: 'cpu', tokens: path.join(modelRoot, 'tokens.txt'),
    transducer: {
      encoder: path.join(modelRoot, 'encoder-epoch-99-avg-1.int8.onnx'),
      decoder: path.join(modelRoot, 'decoder-epoch-99-avg-1.onnx'),
      joiner: path.join(modelRoot, 'joiner-epoch-99-avg-1.int8.onnx'),
    },
  },
});
// Last repetition only: repeats use the same seed and are timing samples.
for (const name of fs.readdirSync(directory).filter(n => n.endsWith('-2.wav')).sort()) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(directory, name),
    '-f', 'f32le', '-ar', '16000', '-ac', '1', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr.toString());
  const count = result.stdout.length / 4;
  const samples = new Float32Array(count + 16000);
  for (let i = 0; i < count; i++) samples[i + 8000] = result.stdout.readFloatLE(i * 4);
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  recognizer.decode(stream);
  console.log(JSON.stringify({ name, text: recognizer.getResult(stream).text }));
}
