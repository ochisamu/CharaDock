// SPDX-License-Identifier: Apache-2.0
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { splitTtsText } = require("./style-bert-vits2.cjs");

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function isRegularFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function validatePiperPlusExecutable(value, platform = process.platform) {
  const executablePath = path.resolve(String(value || ""));
  if (!isRegularFile(executablePath)) throw new Error("piper-plusの実行ファイルが見つかりません。");
  if (platform === "win32" && path.extname(executablePath).toLowerCase() !== ".exe") {
    throw new Error("Windows版piper-plusの.exeファイルを選んでください。");
  }
  return executablePath;
}

function piperPlusConfigPath(modelPath) {
  return [`${modelPath}.json`, modelPath.replace(/\.onnx$/i, ".json"), path.join(path.dirname(modelPath), "config.json")].find(isRegularFile) || "";
}

function validatePiperPlusModel(value) {
  const modelPath = path.resolve(String(value || ""));
  if (path.extname(modelPath).toLowerCase() !== ".onnx" || !isRegularFile(modelPath)) {
    throw new Error("piper-plus専用の.onnx音声モデルを選んでください。");
  }
  if (!piperPlusConfigPath(modelPath)) {
    throw new Error("モデルに対応する.onnx.json設定ファイルが同じフォルダーに見つかりません。");
  }
  return modelPath;
}

function piperPlusWorkingDirectory(executablePath) {
  const directory = path.dirname(executablePath);
  return path.basename(directory).toLowerCase() === "bin" ? path.dirname(directory) : directory;
}

function isRustRuntime(executablePath) {
  return /^piper-plus-cli(?:\.exe)?$/i.test(path.basename(executablePath || ""));
}

function piperPlusArguments({ executablePath, modelPath, configPath, text, outputPath, speed = 1, referenceAudioPath = "", speakerEncoderPath = "" } = {}) {
  const normalizedSpeed = numberInRange(speed, 1, .5, 2);
  const rust = isRustRuntime(executablePath);
  return [
    "--model", String(modelPath || ""),
    ...(configPath ? ["--config", configPath] : []),
    "--text", String(text || ""),
    rust ? "--output-file" : "--output_file", String(outputPath || ""),
    "--length-scale", String(Number((1 / normalizedSpeed).toFixed(3))),
    rust ? "--sentence-silence" : "--sentence_silence", "0.35",
    ...(referenceAudioPath ? ["--reference-audio", referenceAudioPath, "--speaker-encoder-model", speakerEncoderPath] : []),
    "--quiet",
  ];
}

// Read ONNX input names without initializing an inference session or loading weights.
const modelInputsCache = new Map();
function onnxInputNames(filePath) {
  let descriptor;
  try {
    const stats = fs.statSync(filePath);
    const signature = `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
    const cached = modelInputsCache.get(filePath);
    if (cached?.signature === signature) return cached.names;
    descriptor = fs.openSync(filePath, "r");
    const scratch = Buffer.alloc(10);
    const varint = (offset, end) => {
      const count = fs.readSync(descriptor, scratch, 0, Math.min(10, end - offset), offset);
      let value = 0;
      let factor = 1;
      for (let i = 0; i < count; i += 1) {
        value += (scratch[i] & 127) * factor;
        if (!Number.isSafeInteger(value)) throw new Error("Invalid ONNX size");
        if (!(scratch[i] & 128)) return { value, next: offset + i + 1 };
        factor *= 128;
      }
      throw new Error("Invalid ONNX varint");
    };
    let fields = 0;
    const visit = (start, end, callback) => {
      let offset = start;
      while (offset < end) {
        if (++fields > 100_000) throw new Error("ONNX field limit");
        const tag = varint(offset, end);
        offset = tag.next;
        const wire = tag.value % 8;
        if (wire === 2) {
          const length = varint(offset, end);
          const next = length.next + length.value;
          if (next > end) throw new Error("Invalid ONNX length");
          callback(Math.floor(tag.value / 8), length.next, next);
          offset = next;
        } else if (wire === 0) offset = varint(offset, end).next;
        else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
        else throw new Error("Invalid ONNX wire type");
        if (offset > end) throw new Error("Truncated ONNX");
      }
    };
    const names = [];
    visit(0, stats.size, (field, start, end) => {
      if (field !== 7) return; // ModelProto.graph
      visit(start, end, (graphField, inputStart, inputEnd) => {
        if (graphField !== 11) return; // GraphProto.input
        visit(inputStart, inputEnd, (inputField, nameStart, nameEnd) => {
          if (inputField !== 1 || nameEnd - nameStart > 1024) return;
          const bytes = Buffer.alloc(nameEnd - nameStart);
          fs.readSync(descriptor, bytes, 0, bytes.length, nameStart);
          names.push(bytes.toString("utf8"));
        });
      });
    });
    if (modelInputsCache.size >= 64) modelInputsCache.clear();
    modelInputsCache.set(filePath, { signature, names });
    return names;
  } catch { return []; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

const referenceValidationCache = new Map();
function validatePiperPlusReference(value) {
  const referencePath = path.resolve(String(value || ""));
  if (path.extname(referencePath).toLowerCase() !== ".wav" || !isRegularFile(referencePath)) {
    throw new Error("参照音声のWAVファイルを選んでください。");
  }
  const stats = fs.statSync(referencePath);
  const size = stats.size;
  const signature = `${size}:${stats.mtimeMs}:${stats.ctimeMs}`;
  if (referenceValidationCache.get(referencePath) === signature) return referencePath;
  if (size < 44 || size > 16 * 1024 * 1024) throw new Error("参照音声は16MB以下のWAVファイルを選んでください。");
  const bytes = fs.readFileSync(referencePath);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("参照音声が正しいWAV形式ではありません。");
  }
  let format;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error("参照音声のWAVデータが途中で切れています。");
    const id = bytes.toString("ascii", offset, offset + 4);
    if (id === "fmt " && length >= 16) format = {
      type: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
      bytesPerSecond: bytes.readUInt32LE(start + 8), bits: bytes.readUInt16LE(start + 14),
    };
    if (id === "data") dataBytes += length;
    offset = start + length + (length % 2);
  }
  if (!format || ![1, 3].includes(format.type) || ![1, 2].includes(format.channels)
      || ![16, 24, 32].includes(format.bits) || !format.bytesPerSecond || !dataBytes) {
    throw new Error("参照音声はPCMまたはFloat形式のモノラル・ステレオWAVを選んでください。");
  }
  const seconds = dataBytes / format.bytesPerSecond;
  if (seconds < 1 || seconds > 30) throw new Error("参照音声は1〜30秒の、声がはっきり聞こえるWAVを選んでください。");
  if (referenceValidationCache.size >= 64) referenceValidationCache.clear();
  referenceValidationCache.set(referencePath, signature);
  return referencePath;
}

function piperPlusStatus({ executablePath = "", modelPath = "", referenceEnabled = false, referenceAudioPath = "", speakerEncoderPath = "" } = {}) {
  const runtimeReady = Boolean(executablePath) && isRegularFile(executablePath)
    && (process.platform !== "win32" || path.extname(executablePath).toLowerCase() === ".exe");
  const modelReady = Boolean(modelPath) && path.extname(modelPath).toLowerCase() === ".onnx" && isRegularFile(modelPath);
  const configReady = modelReady && Boolean(piperPlusConfigPath(modelPath));
  let referenceReady = false;
  if (referenceAudioPath) { try { validatePiperPlusReference(referenceAudioPath); referenceReady = true; } catch {} }
  const referenceRuntimeReady = runtimeReady && isRustRuntime(executablePath);
  const referenceModelReady = referenceEnabled && modelReady && onnxInputNames(modelPath).includes("speaker_embedding");
  const encoderReady = Boolean(speakerEncoderPath) && path.extname(speakerEncoderPath).toLowerCase() === ".onnx" && isRegularFile(speakerEncoderPath);
  let referenceIssue = "";
  if (referenceEnabled) {
    if (!referenceRuntimeReady) referenceIssue = "音声リファレンスにはv2.0.0のRust版（piper-plus-cli.exe）が必要です。";
    else if (!referenceModelReady) referenceIssue = "参照音声に対応した音声モデル（speaker_embedding入力付きONNX）を選んでください。";
    else if (!encoderReady) referenceIssue = "モデルに対応する話者エンコーダー（ONNX）を選んでください。";
    else if (!referenceReady) referenceIssue = "1〜30秒の参照音声（WAV）を選んでください。";
  }
  return {
    ready: runtimeReady && modelReady && configReady && !referenceIssue,
    runtimeReady, modelReady, configReady,
    referenceEnabled, referenceReady, referenceRuntimeReady, referenceModelReady, encoderReady, referenceIssue,
    runtimeName: executablePath ? path.basename(executablePath) : "",
    modelName: modelPath ? path.basename(modelPath) : "",
    referenceName: referenceAudioPath ? path.basename(referenceAudioPath) : "",
    encoderName: speakerEncoderPath ? path.basename(speakerEncoderPath) : "",
  };
}

function runPiperProcess(command, args, options, execFileImpl) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (!error) return resolve();
      const detail = String(stderr || stdout || error.message || "").trim().slice(0, 360);
      reject(new Error(`piper-plusが音声を生成できませんでした${detail ? `: ${detail}` : "。"}`));
    });
  });
}

async function synthesizePiperPlus({
  text,
  executablePath,
  modelPath,
  speed = 1,
  referenceEnabled = false,
  referenceAudioPath = "",
  speakerEncoderPath = "",
  temporaryRoot = os.tmpdir(),
  execFileImpl = execFile,
} = {}) {
  const executable = validatePiperPlusExecutable(executablePath);
  const model = validatePiperPlusModel(modelPath);
  const status = piperPlusStatus({ executablePath: executable, modelPath: model, referenceEnabled, referenceAudioPath, speakerEncoderPath });
  if (status.referenceIssue) throw new Error(status.referenceIssue);
  const chunks = splitTtsText(text);
  if (!chunks.length) return { audioDataUrls: [] };
  const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, "charadock-piper-"));
  const audioDataUrls = [];
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const outputPath = path.join(temporaryDirectory, `speech-${index}.wav`);
      await runPiperProcess(
        executable,
        piperPlusArguments({ executablePath: executable, modelPath: model, configPath: piperPlusConfigPath(model), text: chunks[index], outputPath, speed,
          referenceAudioPath: referenceEnabled ? validatePiperPlusReference(referenceAudioPath) : "", speakerEncoderPath }),
        {
          cwd: piperPlusWorkingDirectory(executable),
          windowsHide: true,
          timeout: 45_000,
          maxBuffer: 512 * 1024,
        },
        execFileImpl,
      );
      const bytes = fs.readFileSync(outputPath);
      const validWave = bytes.length >= 12
        && bytes.subarray(0, 4).toString("ascii") === "RIFF"
        && bytes.subarray(8, 12).toString("ascii") === "WAVE";
      if (!validWave || bytes.length > 20 * 1024 * 1024) throw new Error("piper-plusの音声データが正しくありません。");
      audioDataUrls.push(`data:audio/wav;base64,${bytes.toString("base64")}`);
    }
    return { audioDataUrls, audioTexts: chunks };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  onnxInputNames,
  piperPlusArguments,
  piperPlusConfigPath,
  piperPlusStatus,
  piperPlusWorkingDirectory,
  synthesizePiperPlus,
  validatePiperPlusExecutable,
  validatePiperPlusModel,
  validatePiperPlusReference,
};
