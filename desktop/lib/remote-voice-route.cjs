// SPDX-License-Identifier: Apache-2.0

const REMOTE_TTS_PROVIDERS = new Set([
  "style-bert-vits2",
  "piper-plus",
  "supertonic-3",
  "irodori-webgpu",
  "kokoro",
  "sbv2-jp-extra",
]);

function remoteTtsProviderSupported(provider) {
  return REMOTE_TTS_PROVIDERS.has(String(provider || ""));
}

function mobileTtsAvailable({ remoteTtsEnabled = true, provider = "" } = {}) {
  return remoteTtsEnabled !== false && remoteTtsProviderSupported(provider);
}

function remoteTurnTtsEnabled({
  remoteTtsOutput = false,
  realtimeOutput = false,
  remoteTtsEnabled = true,
  provider = "",
} = {}) {
  return Boolean(
    remoteTtsOutput
    && !realtimeOutput
    && mobileTtsAvailable({ remoteTtsEnabled, provider })
  );
}

module.exports = {
  REMOTE_TTS_PROVIDERS,
  mobileTtsAvailable,
  remoteTtsProviderSupported,
  remoteTurnTtsEnabled,
};
