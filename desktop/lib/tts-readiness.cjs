// SPDX-License-Identifier: Apache-2.0

const DOWNLOAD_LABELS = Object.freeze({
  "piper-plus": Object.freeze({ ja: "サンプルをダウンロード", en: "Download sample" }),
  "supertonic-3": Object.freeze({ ja: "サンプルをダウンロード", en: "Download sample" }),
  "speech-cpp": Object.freeze({ ja: "モデルをダウンロード", en: "Download model" }),
  "irodori-webgpu": Object.freeze({ ja: "モデルをダウンロード", en: "Download model" }),
  kokoro: Object.freeze({ ja: "日本語モデルをダウンロード", en: "Download Japanese model" }),
  "sbv2-jp-extra": Object.freeze({ ja: "AIVMXモデルを追加", en: "Add AIVMX model" }),
});

const PROVIDER_NAMES = Object.freeze({
  "piper-plus": "piper-plus",
  "supertonic-3": "Supertonic 3",
  "irodori-webgpu": "Irodori TTS",
  "speech-cpp": "Irodori TTS · speech.cpp",
  kokoro: "Kokoro",
  "sbv2-jp-extra": "Style-Bert-VITS2 JP-Extra",
});

function ttsSetupGuidance(provider, status = {}, language = "ja") {
  const selected = String(provider || "");
  const name = PROVIDER_NAMES[selected];
  if (!name) return "";
  const english = language === "en";

  if (selected === "piper-plus" && status.referenceEnabled && status.referenceIssue) {
    return english
      ? "Piper Plus reference audio requires the v2 Rust runtime, a compatible voice model, its speaker encoder, and a 1–30 second WAV. Complete these in Settings → Voice → Character voice, or turn off reference audio."
      : `${status.referenceIssue} 設定 → 音声 → キャラの声で設定するか、参照音声の使用をオフにしてください。`;
  }

  if (selected === "irodori-webgpu" && status.webgpuAvailable === false) {
    return english
      ? "Irodori TTS cannot use WebGPU on this PC. Update the GPU driver or choose another voice method in Settings → Desktop → Character voice."
      : "Irodori TTSでWebGPUを利用できません。GPUドライバーを更新するか、設定 → デスクトップ → キャラクターの声で音声方式を変更してください。";
  }
  if (["irodori-webgpu", "speech-cpp"].includes(selected) && status.modelReady && status.referenceRequired !== false && !status.referenceReady) {
    return english
      ? "Irodori TTS has no usable reference voice. Add or select one, or choose another voice method in Settings → Desktop → Character voice."
      : "Irodori TTSの参照音声がありません。設定 → デスクトップ → キャラクターの声で参照音声を追加・選択するか、音声方式を変更してください。";
  }
  if (selected === "irodori-webgpu" && status.version === "500m-v3" && !status.modelReady) {
    return english
      ? "Irodori TTS 500M-v3 has no usable model. Open Settings → Desktop → Character voice and download the 500M-v3 model, select its existing folder, or choose another voice method."
      : "Irodori TTS 500M-v3のモデルがありません。設定 → デスクトップ → キャラクターの声で500M-v3モデルをダウンロードするか、既存フォルダーを選択してください。";
  }

  const ready = selected === "irodori-webgpu" ? Boolean(status.ready) : Boolean(status.ready);
  if (ready) return "";
  const label = DOWNLOAD_LABELS[selected];
  return english
    ? `${name} has no usable model. Open Settings → Desktop → Character voice and choose “${label.en}”, or select another voice method.`
    : `${name}のモデルがありません。設定 → デスクトップ → キャラクターの声で「${label.ja}」を選ぶか、音声方式を変更してください。`;
}

module.exports = { ttsSetupGuidance };
