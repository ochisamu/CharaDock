// SPDX-License-Identifier: Apache-2.0
const SPEECH_CPP_VARIANTS = Object.freeze({
  mf: Object.freeze({ provider: "speech-cpp", label: "v4.1 Small MF", stepsKey: "speechCppMfSteps", pathKey: "speechCppModelPath", defaultSteps: 6 }),
  small: Object.freeze({ provider: "speech-cpp-small", label: "v4.1 Small", stepsKey: "speechCppSmallSteps", pathKey: "speechCppSmallModelPath", defaultSteps: 16 }),
});
function speechCppVariant(value) { return value === "small" ? "small" : "mf"; }
function speechCppSteps(value, fallback = 6) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number) ? fallback : Math.min(64, Math.max(1, Math.round(number)));
}
function normalizeSpeechCppSettings(data = {}) {
  return { speechCppModelVariant: speechCppVariant(data.speechCppModelVariant),
    speechCppMfSteps: speechCppSteps(data.speechCppMfSteps, 6), speechCppSmallSteps: speechCppSteps(data.speechCppSmallSteps, 16) };
}
function speechCppConfiguration(data = {}, managedPaths = {}) {
  const variant = speechCppVariant(data.speechCppModelVariant), model = SPEECH_CPP_VARIANTS[variant];
  return { variant, steps: speechCppSteps(data[model.stepsKey], model.defaultSteps),
    executablePath: (variant === "small" ? managedPaths.executablePath : data.speechCppExecutablePath) || data.speechCppExecutablePath || managedPaths.executablePath || "",
    modelPath: data[model.pathKey] || managedPaths.modelPath || "" };
}
module.exports = { SPEECH_CPP_VARIANTS, speechCppVariant, speechCppSteps, normalizeSpeechCppSettings, speechCppConfiguration };
