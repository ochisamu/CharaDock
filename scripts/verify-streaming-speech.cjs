#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

const { EmbeddedSherpaVad } = require("../desktop/lib/sherpa-vad.cjs");
const { StreamingSpeechRecognition, resampleLinear } = require("../desktop/lib/streaming-speech-recognition.cjs");

function decodePcm16Wave(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("The verification audio must be a RIFF/WAVE file.");
  }
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pcm = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      if (bytes.readUInt16LE(offset + 8) !== 1) throw new Error("Only PCM WAVE audio is supported.");
      channels = bytes.readUInt16LE(offset + 10);
      sampleRate = bytes.readUInt32LE(offset + 12);
      bitsPerSample = bytes.readUInt16LE(offset + 22);
    } else if (id === "data") {
      pcm = bytes.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (!pcm || channels !== 1 || bitsPerSample !== 16) {
    throw new Error("The verification audio must be mono 16-bit PCM.");
  }
  const samples = new Float32Array(pcm.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = pcm.readInt16LE(index * 2) / 32768;
  }
  return { samples, sampleRate };
}

async function main() {
  const args = process.argv.slice(2);
  const downloadMissing = args[0] === "--download-missing";
  if (downloadMissing) args.shift();
  const vadIndex = args.indexOf("--vad");
  const useVad = vadIndex >= 0;
  if (useVad) args.splice(vadIndex, 1);
  const expectedIndex = args.findIndex((value) => value.startsWith("--expected="));
  const expected = expectedIndex >= 0 ? args.splice(expectedIndex, 1)[0].slice("--expected=".length) : "";
  const contextIndex = args.findIndex((value) => value.startsWith("--context="));
  const contextSeconds = contextIndex >= 0 ? Number(args.splice(contextIndex, 1)[0].slice("--context=".length)) : 0;
  const [baseDirectory, sherpaBaseDirectory, wavePath, ...modelIds] = args;
  if (!baseDirectory || !sherpaBaseDirectory || !wavePath || !modelIds.length) {
    throw new Error("Usage: verify-streaming-speech [--download-missing] [--vad] [--expected=text] [--context=seconds] <model-dir> <sherpa-dir> <wave> <model-id...>");
  }
  const audio = decodePcm16Wave(path.resolve(wavePath));
  const engine = new StreamingSpeechRecognition(path.resolve(baseDirectory), {
    sherpaBaseDirectory: path.resolve(sherpaBaseDirectory),
  });
  let vadSegments = null;
  if (useVad) {
    const detector = new EmbeddedSherpaVad(path.resolve(sherpaBaseDirectory));
    await detector.start("normal");
    const samples = resampleLinear(audio.samples, audio.sampleRate, 16_000);
    vadSegments = [];
    for (let offset = 0; offset < samples.length; offset += 512) {
      const result = detector.accept(samples.subarray(offset, offset + 512));
      if (result.segmentSamples?.length) vadSegments.push(result.segmentSamples);
    }
    detector.stop();
    if (!vadSegments.length) throw new Error("Silero VAD did not produce a speech segment.");
  }
  const chunkSamples = Math.max(1, Math.round(audio.sampleRate * .1));
  let failed = false;
  for (const modelId of modelIds) {
    const sessionId = `verify-${modelId}`;
    const startedAt = Date.now();
    const partials = [];
    try {
      if (downloadMissing && !engine.isModelInstalled(modelId)) {
        let previousProgress = -1;
        await engine.download((status) => {
          const progress = status?.progress;
          if (!progress?.totalBytes) return;
          const percent = Math.floor(progress.receivedBytes * 10 / progress.totalBytes) * 10;
          if (percent === previousProgress) return;
          previousProgress = percent;
          console.error(`[download] ${modelId} ${progress.phase} ${Math.max(0, Math.min(100, percent))}%`);
        }, modelId);
      }
      await engine.prepare(modelId);
      let result;
      if (vadSegments) {
        const texts = [];
        for (const samples of vadSegments) {
          const contextSamples = Math.max(0, Math.round(16_000 * contextSeconds));
          const waveform = contextSamples
            ? (() => {
              const padded = new Float32Array(samples.length + contextSamples * 2);
              padded.set(samples, contextSamples);
              return padded;
            })()
            : samples;
          const text = await engine.transcribe({ samples: waveform, sampleRate: 16_000 }, modelId);
          if (text) texts.push(text);
        }
        result = { text: texts.join("") };
      } else {
        await engine.start(sessionId, modelId);
        for (let offset = 0; offset < audio.samples.length; offset += chunkSamples) {
          const appended = await engine.append(sessionId, {
            samples: audio.samples.subarray(offset, offset + chunkSamples),
            sampleRate: audio.sampleRate,
          });
          if (appended.changed && appended.text) partials.push(appended.text);
        }
        result = await engine.finish(sessionId);
      }
      const ok = expected ? result.text === expected : Boolean(result.text);
      console.log(JSON.stringify({
        modelId,
        ok,
        vadSegments: vadSegments?.length || 0,
        elapsedMs: Date.now() - startedAt,
        partials,
        final: result.text,
      }));
      if (!ok) failed = true;
    } catch (error) {
      engine.cancel(sessionId);
      failed = true;
      console.log(JSON.stringify({ modelId, ok: false, elapsedMs: Date.now() - startedAt, error: error.message, stack: error.stack }));
    }
  }
  if (failed) process.exitCode = 1;
  // Electron keeps its browser process alive after the Node-style verifier
  // finishes. Exit explicitly so Windows CI and local smoke runs cannot hang.
  if (process.versions.electron) process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  if (process.versions.electron) process.exit(1);
  process.exitCode = 1;
});
