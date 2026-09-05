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

function validatePiperPlusModel(value) {
  const modelPath = path.resolve(String(value || ""));
  if (path.extname(modelPath).toLowerCase() !== ".onnx" || !isRegularFile(modelPath)) {
    throw new Error("piper-plus専用の.onnx音声モデルを選んでください。");
  }
  const configCandidates = [`${modelPath}.json`, modelPath.replace(/\.onnx$/i, ".json")];
  if (!configCandidates.some(isRegularFile)) {
    throw new Error("モデルに対応する.onnx.json設定ファイルが同じフォルダーに見つかりません。");
  }
  return modelPath;
}

function piperPlusWorkingDirectory(executablePath) {
  const directory = path.dirname(executablePath);
  return path.basename(directory).toLowerCase() === "bin" ? path.dirname(directory) : directory;
}

function piperPlusArguments({ modelPath, text, outputPath, speed = 1 } = {}) {
  const normalizedSpeed = numberInRange(speed, 1, .5, 2);
  return [
    "--model", String(modelPath || ""),
    "--text", String(text || ""),
    "--output_file", String(outputPath || ""),
    "--length-scale", String(Number((1 / normalizedSpeed).toFixed(3))),
    "--sentence_silence", "0.35",
    "--quiet",
  ];
}

function piperPlusStatus({ executablePath = "", modelPath = "" } = {}) {
  const runtimeReady = Boolean(executablePath) && isRegularFile(executablePath)
    && (process.platform !== "win32" || path.extname(executablePath).toLowerCase() === ".exe");
  const modelReady = Boolean(modelPath) && path.extname(modelPath).toLowerCase() === ".onnx" && isRegularFile(modelPath);
  const configCandidates = modelPath
    ? [`${modelPath}.json`, modelPath.replace(/\.onnx$/i, ".json")]
    : [];
  return {
    ready: runtimeReady && modelReady && configCandidates.some(isRegularFile),
    runtimeReady,
    modelReady,
    configReady: modelReady && configCandidates.some(isRegularFile),
    runtimeName: executablePath ? path.basename(executablePath) : "",
    modelName: modelPath ? path.basename(modelPath) : "",
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
  temporaryRoot = os.tmpdir(),
  execFileImpl = execFile,
} = {}) {
  const executable = validatePiperPlusExecutable(executablePath);
  const model = validatePiperPlusModel(modelPath);
  const chunks = splitTtsText(text);
  if (!chunks.length) return { audioDataUrls: [] };
  const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, "charadock-piper-"));
  const audioDataUrls = [];
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const outputPath = path.join(temporaryDirectory, `speech-${index}.wav`);
      await runPiperProcess(
        executable,
        piperPlusArguments({ modelPath: model, text: chunks[index], outputPath, speed }),
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
  piperPlusArguments,
  piperPlusStatus,
  piperPlusWorkingDirectory,
  synthesizePiperPlus,
  validatePiperPlusExecutable,
  validatePiperPlusModel,
};
