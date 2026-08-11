// SPDX-License-Identifier: Apache-2.0
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ipcRenderer } = require("electron");
const {
  WORK_SLM_MODEL_ID,
  parseWorkSlmOutput,
  workSlmMessages,
} = require("./lib/work-slm.cjs");

let generatorPromise = null;
let generator = null;

function transformersWebUrl(runtimePath) {
  const resolved = path.resolve(String(runtimePath || ""));
  if (!resolved.endsWith("transformers.web.mjs")) throw new Error("Work SLM runtime path is invalid.");
  return pathToFileURL(resolved).href;
}

async function webGpuAvailable() {
  if (!globalThis.navigator?.gpu) return false;
  return Boolean(await globalThis.navigator.gpu.requestAdapter().catch(() => null));
}

async function loadGenerator({ cacheDirectory, runtimePath, allowDownload = false } = {}) {
  if (generator) return generator;
  if (generatorPromise) return generatorPromise;
  generatorPromise = (async () => {
    if (!await webGpuAvailable()) throw new Error("WebGPU is unavailable.");
    const { pipeline, env } = await import(transformersWebUrl(runtimePath));
    env.cacheKey = "charadock-work-slm-v1";
    env.cacheDir = String(cacheDirectory || "");
    env.allowRemoteModels = Boolean(allowDownload);
    env.allowLocalModels = true;
    const loaded = await pipeline("text-generation", WORK_SLM_MODEL_ID, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (progress) => ipcRenderer.send("workSlm:progress", progress),
    });
    generator = loaded;
    return loaded;
  })().catch((error) => {
    generatorPromise = null;
    throw error;
  });
  return generatorPromise;
}

ipcRenderer.on("workSlm:request", async (_event, payload = {}) => {
  const requestId = String(payload.requestId || "");
  try {
    if (payload.action === "clear") {
      generator?.dispose?.();
      generator = null;
      generatorPromise = null;
      await globalThis.caches?.delete?.("charadock-work-slm-v1");
      ipcRenderer.send("workSlm:result", { requestId, cleared: true });
      return;
    }
    if (payload.action === "probe") {
      const runtime = await import(transformersWebUrl(payload.runtimePath));
      const cache = await globalThis.caches?.open?.("charadock-work-slm-v1");
      ipcRenderer.send("workSlm:result", {
        requestId,
        probed: typeof runtime.pipeline === "function" && Boolean(cache),
        webgpuAvailable: await webGpuAvailable(),
      });
      return;
    }
    const model = await loadGenerator(payload);
    if (payload.action === "prepare") {
      ipcRenderer.send("workSlm:result", { requestId, prepared: true, device: "webgpu" });
      return;
    }
    const messages = workSlmMessages(payload);
    const output = await model(messages, {
      max_new_tokens: 96,
      do_sample: true,
      temperature: 0.55,
      top_p: 0.85,
      repetition_penalty: 1.08,
      return_full_text: false,
    });
    ipcRenderer.send("workSlm:result", {
      requestId,
      ...parseWorkSlmOutput(output, payload),
      device: "webgpu",
    });
  } catch (error) {
    ipcRenderer.send("workSlm:result", { requestId, error: String(error?.message || error) });
  }
});

ipcRenderer.send("workSlm:ready", { webgpuAvailable: Boolean(globalThis.navigator?.gpu) });
