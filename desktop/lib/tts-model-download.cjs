// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPER_MODEL_COMMIT = "36b59c825c36bd386b8960cf3f604382f52f2a87";
const KOKORO_COMMIT = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const IRODORI_500M_V3_COMMIT = "b75a9bbf2c10e12682d37e91e0efaf6d4e54bd29";
const IRODORI_V4_RELEASE = "v4-small-e4aaac4-webgpu-fp16-r2";
const IRODORI_V4_RELEASE_BASE = `https://github.com/ochisamu/irodori-tts-v4-webgpu-models/releases/download/${IRODORI_V4_RELEASE}`;
const IRODORI_V4_INT4_RELEASE = "v4-small-quantized-4a5a4d6-webgpu-int4-r1";
const IRODORI_V4_INT4_RELEASE_BASE = `https://github.com/ochisamu/irodori-tts-v4-webgpu-models/releases/download/${IRODORI_V4_INT4_RELEASE}`;

const TTS_MODELS = Object.freeze({
  "piper-plus": Object.freeze({
    id: "piper-plus",
    label: "piper-plus · つくよみちゃん FP16",
    description: "日本語向けの軽量サンプル音声。公式Windowsランタイムも一緒に導入します。",
    directoryName: "piper-plus-tsukuyomi-v1.13.0",
    downloadBytes: 72_120_860,
    platforms: Object.freeze(["win32"]),
    sourceUrl: "https://github.com/ayutaz/piper-plus",
    licenseUrl: "https://tyc.rei-yumesaki.net/material/corpus/#terms3",
    runtime: Object.freeze({
      archiveName: "piper-windows-x64.zip",
      url: "https://github.com/ayutaz/piper-plus/releases/download/v1.13.0/piper-windows-x64.zip",
      bytes: 32_461_242,
      sha256: "d8b6237a546d996a65009bd88f2eb845fad876505952cce98eb3fedaf99fa3d7",
    }),
    files: Object.freeze([
      Object.freeze({
        name: "tsukuyomi-chan-6lang-fp16.onnx",
        relativePath: "models/tsukuyomi-chan-6lang-fp16.onnx",
        url: `https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan/resolve/${PIPER_MODEL_COMMIT}/tsukuyomi-chan-6lang-fp16.onnx`,
        bytes: 39_652_717,
        sha256: "5289e9b6eaf21080803b7fe1c4dc85b5491d4c216121207a41df18dd5f68e5d7",
      }),
      Object.freeze({
        name: "config.json",
        relativePath: "models/tsukuyomi-chan-6lang-fp16.onnx.json",
        url: `https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan/resolve/${PIPER_MODEL_COMMIT}/config.json`,
        bytes: 6_901,
        sha256: "516058f405ec914140f34832a9d8bb5d8272ba62af9bc7ffb29349715a539780",
      }),
    ]),
  }),
  "supertonic-3": Object.freeze({
    id: "supertonic-3",
    label: "Supertonic 3 · int8",
    description: "10種類の声を選べる公式sherpa-onnx向け軽量モデル。CPUで処理します。",
    directoryName: "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
    downloadBytes: 128_774_318,
    sourceUrl: "https://github.com/k2-fsa/sherpa-onnx",
    licenseUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    archive: Object.freeze({
      archiveName: "sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2",
      bytes: 128_774_318,
      sha256: "82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427",
    }),
  }),
  kokoro: Object.freeze({
    id: "kokoro",
    label: "Kokoro 82M · 日本語 WebGPU / CPU",
    description: "WebGPU推奨FP32とCPU用q8、日本語5音声を含むKokoro ONNXモデルです。",
    directoryName: "kokoro-82m-v1.0-onnx-ja-fp32-q8",
    downloadBytes: 420_504_548,
    sourceUrl: "https://github.com/hexgrad/kokoro",
    licenseUrl: "https://huggingface.co/hexgrad/Kokoro-82M/blob/main/LICENSE",
    files: Object.freeze([
      ["onnx/model.onnx", 325_532_232, "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb"],
      ["onnx/model_quantized.onnx", 92_361_116, "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478"],
      ["voices/jf_alpha.bin", 522_240, "56b479360aad9f367aeb8cef908f9201cf48b4555e488c5f4590c9dfcd978bb6"],
      ["voices/jf_gongitsune.bin", 522_240, "0f1181f3772d27b7c12aaf4bcd71e31b186c4146e330d074a3dc64ee392af396"],
      ["voices/jf_nezumi.bin", 522_240, "13cb71eebb0b48739d444558322aa35a8c9a489b80e1e631f14d2e6aea93026b"],
      ["voices/jf_tebukuro.bin", 522_240, "29c6c0561b4288d59639677bebe7533c919743d5ea68d0d2ae992644beea6696"],
      ["voices/jm_kumo.bin", 522_240, "09e959d239724c734d65661f06f14cdabcddfd476bfaaad905a937099ae9e64f"],
    ].map(([relativePath, bytes, sha256]) => Object.freeze({
      name: path.basename(relativePath),
      relativePath,
      url: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${KOKORO_COMMIT}/${relativePath}`,
      bytes,
      sha256,
    }))),
  }),
  "irodori-webgpu": Object.freeze({
    id: "irodori-webgpu",
    label: "Irodori TTS v4 Small · FP16 WebGPU",
    description: "Voice Designと許諾済み参照音声によるVoice Cloneに対応する日本語WebGPUモデルです。",
    directoryName: "irodori-tts-v4-small-webgpu-fp16-r2",
    obsoleteDirectoryNames: Object.freeze([
      "irodori-tts-v4-small-webgpu-fp16",
      "irodori-tts-v4-small-webgpu-fp16-r1",
    ]),
    downloadBytes: 1_771_099_224,
    sourceUrl: "https://github.com/ochisamu/irodori-tts-v4-webgpu-models",
    licenseUrl: "https://github.com/ochisamu/irodori-tts-v4-webgpu-models/blob/main/LICENSES/Irodori-TTS-v4-Small-LICENSE",
    files: Object.freeze([
      ["models/caption_projector.onnx", 28_864, "afdaade137950c49c6d8cc7949e9f0426a931837a3d8cc2a87b3f1603ae6d19c"],
      ["models/caption_projector.onnx.data", 3_473_408, "6158fa8fb816858ad030f77e3d0efc8b781da037c6c72403e4a6d1a2b3341387"],
      ["models/dacvae_decoder.onnx", 854_956, "28ab7aabdb11f07816c34cb93cd1a7c293427bcc831a832969fccf0ee8f7aab0"],
      ["models/dacvae_decoder.onnx.data", 166_184_768, "eb3ecfc543eb957e06e9165796014d5c17951bd933d30d76fd00a6eda3b21930"],
      ["models/dacvae_encoder.onnx", 924_571, "2461ab41da0acf2af30faf3ebfddb80034b8235bf78ca72ca3fea15d7a30be43"],
      ["models/dacvae_encoder.onnx.data", 54_697_984, "a963ab4f4be69451b04243e0b8ef9b53e3be5d615e09595e5eb83be5b9094489"],
      ["models/dit_v4.onnx", 2_947_623, "2e631ba1cd63c8ea6d270a94bba70d26f1f4fa5ec4f81796e7bbde9688517918"],
      ["models/dit_v4.onnx.data", 732_364_800, "2b62b71756aef1efb6d54788c2ad2da21f8f6748d3ae246532914369c865e81d"],
      ["models/duration.onnx", 272_385, "94f086fae6d17afc2966b16f8c20846a33184af588b47fa7107c94fbdf2c228e"],
      ["models/duration.onnx.data", 43_581_440, "7b9c9be211665540243cc6960dad6e4eff7cfc0f08a35e04997e01ca2339509e"],
      ["models/speaker_encoder.onnx", 1_432_778, "69f07c07b1f6447e5e7f89d1c9a4fb179cf1dd9332f16ad8525cbb36e7deb924"],
      ["models/speaker_encoder.onnx.data", 121_423_872, "8d7fa32a4cdc66ec0463fc4767bd5fd9762efcd8c9ec543558538dbc47745d1e"],
      ["models/text_backbone.onnx", 3_409_326, "cd50ebf5cc03d24c74b14e0639e8bb7d49b5035a7281b31640fb7b5431d188dd"],
      ["models/text_backbone.onnx.data", 629_276_672, "ef1d79eee37389e5cba365e3183f5d09150de056da93c30c83a484fc94559f08"],
      ["models/text_projector.onnx", 28_837, "6e7ec0e2dab4928164d0fc41c9c98abc69ad980009c29e84bcb654fd4d325552"],
      ["models/text_projector.onnx.data", 3_473_408, "83d7365c6f8d18a31c2cca91501bd93cde032d4171e2b35986d07f65f932b4ed"],
      ["tokenizer/irodori_v4/tokenizer.json", 6_718_495, "6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d"],
      ["tokenizer/irodori_v4/tokenizer_config.json", 668, "d229a271c64de1a7939d20d3665498e873fa91d5ee2edf135d73ec752cb9c9d3"],
      ["models/model-config.json", 4_369, "11876f5c11248a261a77b80f2504a4ced51f49691f50942f3a14305ef1cdf97a"],
    ].map(([relativePath, bytes, sha256]) => Object.freeze({
      name: path.basename(relativePath),
      relativePath,
      url: `${IRODORI_V4_RELEASE_BASE}/${path.basename(relativePath)}`,
      bytes,
      sha256,
    }))),
  }),
  "irodori-webgpu-int4": Object.freeze({
    id: "irodori-webgpu-int4",
    label: "Irodori TTS v4 Small · INT4 WebGPU",
    description: "公式INT4版を起点にした約853MBの軽量W4A16 WebGPUモデルです。",
    directoryName: "irodori-tts-v4-small-quantized-webgpu-int4-r1",
    obsoleteDirectoryNames: Object.freeze([]),
    downloadBytes: 853_295_612,
    sourceUrl: "https://github.com/ochisamu/irodori-tts-v4-webgpu-models",
    licenseUrl: "https://github.com/ochisamu/irodori-tts-v4-webgpu-models/blob/main/LICENSES/Irodori-TTS-v4-Small-LICENSE",
    files: Object.freeze([
      ["models/caption_projector.onnx", 28_968, "b58c6ce5231245d79ecfc4e6c23cc0fb916d90212d64864db4370fa7b7e828a8"],
      ["models/caption_projector.onnx.data", 3_473_408, "8a4b49dbac8b802bcacaac074b098f886a43afd317a37e4e65648a069b189313"],
      ["models/dacvae_decoder.onnx", 854_956, "28ab7aabdb11f07816c34cb93cd1a7c293427bcc831a832969fccf0ee8f7aab0"],
      ["models/dacvae_decoder.onnx.data", 166_184_768, "eb3ecfc543eb957e06e9165796014d5c17951bd933d30d76fd00a6eda3b21930"],
      ["models/dacvae_encoder.onnx", 924_571, "2461ab41da0acf2af30faf3ebfddb80034b8235bf78ca72ca3fea15d7a30be43"],
      ["models/dacvae_encoder.onnx.data", 54_697_984, "a963ab4f4be69451b04243e0b8ef9b53e3be5d615e09595e5eb83be5b9094489"],
      ["models/dit_v4.onnx", 2_802_048, "6a7b3aa7de9723149b81962359bef0c62677acefecea14811297207ba9d837e5"],
      ["models/dit_v4.onnx.data", 253_895_424, "031c05c334cbc56ddb37ab3609f02ed7eae151404ceb4018d4a62b1c892bd3ec"],
      ["models/duration.onnx", 273_517, "299558f4c86d47f57ada1f977a440e580435a7143ad0bbb88b47fb6f25c0c410"],
      ["models/duration.onnx.data", 43_581_440, "97c9274ceab389c96612f689f957b39713375e2d6c45a32c6848904897392c0c"],
      ["models/speaker_encoder.onnx", 1_357_019, "18c393534655758b81f01727fc5be2987fa0e8d19682c577eb886ad5ab0e0e7e"],
      ["models/speaker_encoder.onnx.data", 31_836_480, "47de6f39d786108ee268bfb5135e3f418d1a3632fc56947f66531a2e6bcb73b0"],
      ["models/text_backbone.onnx", 3_221_288, "f073230f7dfdc34a4927393dab7feb03db38ec9850a92e86b68cc9ff2710814a"],
      ["models/text_backbone.onnx.data", 279_937_536, "84b30f31fe7ac5aa57e0873715330e6b324cdc2f53b291a63fbe14aef02effc0"],
      ["models/text_projector.onnx", 28_941, "79ef20f27218ff3e700766d1612c4143091ad7ca98eeefafbb387b7f2a768737"],
      ["models/text_projector.onnx.data", 3_473_408, "56755c911c4aecfbdba869e2ee4faa6651eef6628e76d9bd0aa3bbe211f50173"],
      ["tokenizer/irodori_v4/tokenizer.json", 6_718_495, "6a0734cf21c802169defaffe719bc2ef12bb9d0be37e54b61ed27aa89394723d"],
      ["tokenizer/irodori_v4/tokenizer_config.json", 668, "d229a271c64de1a7939d20d3665498e873fa91d5ee2edf135d73ec752cb9c9d3"],
      ["models/model-config.json", 4_693, "d97f1f4c0c740132ef7586f01c5197674a4ea194cd2411de9d1fa2e5ac230466"],
    ].map(([relativePath, bytes, sha256]) => Object.freeze({
      name: path.basename(relativePath),
      relativePath,
      url: `${IRODORI_V4_INT4_RELEASE_BASE}/${path.basename(relativePath)}`,
      bytes,
      sha256,
    }))),
  }),
  "irodori-500m-v3": Object.freeze({
    id: "irodori-500m-v3",
    label: "Irodori TTS 500M-v3 · FP16 WebGPU",
    description: "従来の日本語ゼロショット音声合成モデル。参照音声を使うWebGPU版です。",
    directoryName: "irodori-tts-onnx-fp16",
    downloadBytes: 1_261_860_326,
    sourceUrl: "https://github.com/ngc-shj/irodori-tts-webgpu",
    licenseUrl: "https://huggingface.co/noguchis/irodori-tts-onnx/blob/main/LICENSE",
    files: Object.freeze([
      ["onnx_fp16/dacvae_decoder.onnx", 892_789, "b3ab98722feafbfec13847da4d234109c2b9b8347d3673158fbd2a7bdda66157"],
      ["onnx_fp16/dacvae_decoder.onnx.data", 166_184_768, "eb3ecfc543eb957e06e9165796014d5c17951bd933d30d76fd00a6eda3b21930"],
      ["onnx_fp16/dacvae_encoder.onnx", 962_319, "cbe594dd6a65c419ff1fa874b0504574293cbeab1b90822d1a0206559cc8b7e1"],
      ["onnx_fp16/dacvae_encoder.onnx.data", 54_697_984, "a963ab4f4be69451b04243e0b8ef9b53e3be5d615e09595e5eb83be5b9094489"],
      ["onnx_fp16/dit.onnx", 3_090_595, "5371d8acda0ac8572c759d67c2e2999c26e6394d4e70521628215f3cd0aa804e"],
      ["onnx_fp16/dit.onnx.data", 700_841_984, "d7d33eb22e9c3eed2b73be7173eabda651c4d15cf33a976e12050f06fc7f61f4"],
      ["onnx_fp16/duration.onnx", 237_373, "f946d1ad1aa430a5544566aaad26a9694ddb278662e663d951b2dd051543740f"],
      ["onnx_fp16/duration.onnx.data", 34_144_256, "edbbbf614879e777ca32735d8d8dae757b5ce6ce7d468999e1cf597510bc1097"],
      ["onnx_fp16/speaker_encoder.onnx", 1_635_127, "cd04bee8baf8e3025201f21874646fad3dba47cd5362d10251fbb1571837ad66"],
      ["onnx_fp16/speaker_encoder.onnx.data", 121_292_800, "ce0f22b345e475d8dc259c447412da0afcbca691d5dc559e2534374fa72f67c5"],
      ["onnx_fp16/text_encoder.onnx", 1_871_518, "b48771a1a41b73fd4eda6be285312cf4126940d52f9181dddb8a6a08d0412db5"],
      ["onnx_fp16/text_encoder.onnx.data", 169_596_928, "53958b363fecc91d0357d2a3208abce7411860b93f9207f6cdccc4398411502f"],
      ["tokenizer/llmjp_tok/tokenizer.json", 6_409_995, "d0fcf4e1e7a08e855273824678363335b0cd707937332ec1cc48eee259065219"],
      ["tokenizer/llmjp_tok/tokenizer_config.json", 1_890, "dab1702ffb28ea713a5302c9b9bf3bdeb5907be931e8f72384de535f1fb26272"],
    ].map(([relativePath, bytes, sha256]) => Object.freeze({
      name: path.basename(relativePath),
      relativePath,
      url: `https://huggingface.co/noguchis/irodori-tts-onnx/resolve/${IRODORI_500M_V3_COMMIT}/${relativePath}`,
      bytes,
      sha256,
    }))),
  }),
});

function modelForId(provider) {
  return TTS_MODELS[String(provider || "")] || null;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`モデルの展開に失敗しました (${code}): ${stderr.trim()}`));
    });
  });
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function requiredPaths(model, directory) {
  if (model.id === "piper-plus") return [
    path.join(directory, "piper", "bin", "piper.exe"),
    path.join(directory, "models", "tsukuyomi-chan-6lang-fp16.onnx"),
    path.join(directory, "models", "tsukuyomi-chan-6lang-fp16.onnx.json"),
  ];
  if (model.id === "supertonic-3") return [
    "duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx",
    "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin",
  ].map((name) => path.join(directory, name));
  return model.files.map((file) => path.join(directory, file.relativePath));
}

function assertEnoughDiskSpace(directory, requiredBytes) {
  if (typeof fs.statfsSync !== "function") return;
  const stats = fs.statfsSync(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  const required = Math.ceil(requiredBytes * 1.15) + 64 * 1024 * 1024;
  if (Number.isFinite(available) && available < required) {
    const requiredGb = (required / 1024 / 1024 / 1024).toFixed(1);
    throw new Error(`モデルの保存容量が不足しています（空き容量を約${requiredGb}GB以上確保してください）。`);
  }
}

async function downloadVerifiedFile({ fetchImpl, file, destination, onChunk }) {
  const response = await fetchImpl(file.url, { redirect: "follow" });
  if (!response?.ok || !response.body) throw new Error(`モデルをダウンロードできませんでした (HTTP ${response?.status || "unknown"})`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.download`;
  const output = fs.openSync(temporaryPath, "w", 0o600);
  const hash = crypto.createHash("sha256");
  let received = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      fs.writeSync(output, chunk);
      hash.update(chunk);
      received += chunk.length;
      onChunk?.(chunk.length);
    }
  } finally {
    fs.closeSync(output);
  }
  if (received !== file.bytes) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(`${file.name}のダウンロードサイズが一致しません。`);
  }
  if (hash.digest("hex") !== file.sha256) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(`${file.name}のSHA-256が一致しません。`);
  }
  fs.renameSync(temporaryPath, destination);
}

class EmbeddedTtsModels {
  constructor(baseDirectory, { fetchImpl = globalThis.fetch, platform = process.platform } = {}) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.fetchImpl = fetchImpl;
    this.platform = platform;
    this.downloadPromise = null;
    this.downloadingProvider = null;
    this.progress = null;
    this.cleanupStaleDownloads();
  }

  cleanupStaleDownloads() {
    try {
      for (const entry of fs.readdirSync(this.baseDirectory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\.download-(piper-plus|supertonic-3|irodori-webgpu|irodori-500m-v3|kokoro)-\d+$/.test(entry.name)) {
          fs.rmSync(path.join(this.baseDirectory, entry.name), { recursive: true, force: true });
        }
      }
    } catch {}
  }

  directoryFor(model) {
    return path.join(this.baseDirectory, model.directoryName);
  }

  isSupported(model) {
    return !model.platforms || model.platforms.includes(this.platform);
  }

  isInstalled(provider) {
    const model = modelForId(provider);
    return Boolean(model) && requiredPaths(model, this.directoryFor(model)).every(isFile);
  }

  installedPaths(provider) {
    const model = modelForId(provider);
    if (!model || !this.isInstalled(provider)) return {};
    const directory = this.directoryFor(model);
    if (provider === "piper-plus") return {
      executablePath: path.join(directory, "piper", "bin", "piper.exe"),
      modelPath: path.join(directory, "models", "tsukuyomi-chan-6lang-fp16.onnx"),
    };
    return { modelDirectory: directory };
  }

  cleanupObsoleteVersions(model) {
    const removed = [];
    for (const directoryName of model?.obsoleteDirectoryNames || []) {
      if (!directoryName || directoryName === model.directoryName || path.basename(directoryName) !== directoryName) continue;
      const target = path.resolve(this.baseDirectory, directoryName);
      if (path.dirname(target) !== this.baseDirectory || !fs.existsSync(target)) continue;
      try {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(directoryName);
      } catch (error) {
        console.warn(`旧音声合成モデルを削除できませんでした (${directoryName}): ${error?.message || error}`);
      }
    }
    return removed;
  }

  status(provider) {
    const model = modelForId(provider);
    if (!model) throw new Error("対応していない音声合成モデルです。");
    return {
      provider: model.id,
      label: model.label,
      description: model.description,
      downloadBytes: model.downloadBytes,
      supported: this.isSupported(model),
      installed: this.isInstalled(model.id),
      downloading: this.downloadingProvider === model.id,
      progress: this.downloadingProvider === model.id ? this.progress : null,
      sourceUrl: model.sourceUrl,
      licenseUrl: model.licenseUrl,
      ...this.installedPaths(model.id),
    };
  }

  emitProgress(onProgress, model, phase, receivedBytes, currentFile = "") {
    this.progress = { phase, receivedBytes, totalBytes: model.downloadBytes, currentFile };
    onProgress?.(this.status(model.id));
  }

  async download(provider, onProgress) {
    const model = modelForId(provider);
    if (!model) throw new Error("対応していない音声合成モデルです。");
    if (!this.isSupported(model)) throw new Error(`${model.label}のサンプルはWindows版アプリでダウンロードできます。`);
    if (this.isInstalled(model.id)) {
      this.cleanupObsoleteVersions(model);
      return this.status(model.id);
    }
    if (this.downloadPromise) {
      if (this.downloadingProvider !== model.id) throw new Error("別の音声合成モデルをダウンロード中です。");
      return this.downloadPromise;
    }
    this.downloadingProvider = model.id;
    this.downloadPromise = this.downloadModel(model, onProgress).finally(() => {
      this.downloadPromise = null;
      this.downloadingProvider = null;
      this.progress = null;
    });
    return this.downloadPromise;
  }

  async downloadModel(model, onProgress) {
    fs.mkdirSync(this.baseDirectory, { recursive: true });
    assertEnoughDiskSpace(this.baseDirectory, model.downloadBytes);
    const temporaryDirectory = path.join(this.baseDirectory, `.download-${model.id}-${Date.now()}`);
    let receivedBytes = 0;
    const downloadFile = async (file, destination) => {
      this.emitProgress(onProgress, model, "downloading", receivedBytes, file.name);
      await downloadVerifiedFile({
        fetchImpl: this.fetchImpl,
        file,
        destination,
        onChunk: (bytes) => {
          receivedBytes += bytes;
          this.emitProgress(onProgress, model, "downloading", receivedBytes, file.name);
        },
      });
    };
    try {
      fs.mkdirSync(temporaryDirectory, { recursive: true });
      if (model.id === "piper-plus") {
        const archivePath = path.join(temporaryDirectory, model.runtime.archiveName);
        await downloadFile({ ...model.runtime, name: model.runtime.archiveName }, archivePath);
        const extracted = path.join(temporaryDirectory, "runtime");
        fs.mkdirSync(extracted, { recursive: true });
        this.emitProgress(onProgress, model, "extracting", receivedBytes, model.runtime.archiveName);
        await runProcess(this.platform === "win32" ? "tar.exe" : "unzip", this.platform === "win32"
          ? ["-xf", archivePath, "-C", extracted]
          : ["-q", archivePath, "-d", extracted]);
        fs.rmSync(archivePath, { force: true });
        for (const file of model.files) await downloadFile(file, path.join(temporaryDirectory, "ready", file.relativePath));
        fs.renameSync(path.join(extracted, "piper"), path.join(temporaryDirectory, "ready", "piper"));
      } else if (model.archive) {
        const archivePath = path.join(temporaryDirectory, model.archive.archiveName);
        await downloadFile({ ...model.archive, name: model.archive.archiveName }, archivePath);
        const extracted = path.join(temporaryDirectory, "extracted");
        fs.mkdirSync(extracted, { recursive: true });
        this.emitProgress(onProgress, model, "extracting", receivedBytes, model.archive.archiveName);
        await runProcess(this.platform === "win32" ? "tar.exe" : "tar", ["-xjf", archivePath, "-C", extracted]);
        fs.rmSync(archivePath, { force: true });
        fs.renameSync(path.join(extracted, model.directoryName), path.join(temporaryDirectory, "ready"));
      } else {
        for (const file of model.files) await downloadFile(file, path.join(temporaryDirectory, "ready", file.relativePath));
      }
      const ready = path.join(temporaryDirectory, "ready");
      if (!requiredPaths(model, ready).every(isFile)) throw new Error("ダウンロードした音声合成モデルに必要なファイルがありません。");
      const destination = this.directoryFor(model);
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(ready, destination);
      this.cleanupObsoleteVersions(model);
      this.emitProgress(onProgress, model, "done", model.downloadBytes);
      return this.status(model.id);
    } finally {
      try { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); } catch {}
    }
  }

  remove(provider) {
    const model = modelForId(provider);
    if (!model) throw new Error("対応していない音声合成モデルです。");
    if (this.downloadingProvider === model.id) throw new Error("モデルのダウンロード中は削除できません。");
    fs.rmSync(this.directoryFor(model), { recursive: true, force: true });
    return this.status(model.id);
  }
}

module.exports = {
  EmbeddedTtsModels,
  TTS_MODELS,
  assertEnoughDiskSpace,
  downloadVerifiedFile,
  modelForId,
  requiredPaths,
};
