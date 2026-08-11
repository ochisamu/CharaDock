// SPDX-License-Identifier: Apache-2.0
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ipcRenderer } = require("electron");
const {
  parseWorkSlmOutput,
  workSlmModel,
  workSlmMessages,
} = require("./lib/work-slm.cjs");

let enginePromise = null;
let engine = null;

function transformersWebUrl(runtimePath) {
  const resolved = path.resolve(String(runtimePath || ""));
  if (!resolved.endsWith("transformers.web.mjs")) throw new Error("Work SLM runtime path is invalid.");
  return pathToFileURL(resolved).href;
}

async function webGpuAvailable() {
  if (!globalThis.navigator?.gpu) return false;
  return Boolean(await globalThis.navigator.gpu.requestAdapter().catch(() => null));
}

async function disposeEngine() {
  const current = engine;
  engine = null;
  enginePromise = null;
  if (current?.kind === "pipeline") await current.generator?.dispose?.();
  else await current?.model?.dispose?.();
}

async function loadEngine({ cacheDirectory, runtimePath, modelId, allowDownload = false } = {}) {
  const selected = workSlmModel(modelId);
  if (engine?.modelId === selected.id) return engine;
  if (engine) await disposeEngine();
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    if (!await webGpuAvailable()) throw new Error("WebGPU is unavailable.");
    const runtime = await import(transformersWebUrl(runtimePath));
    const { env } = runtime;
    env.cacheKey = "charadock-work-slm-v1";
    env.cacheDir = String(cacheDirectory || "");
    env.allowRemoteModels = Boolean(allowDownload);
    env.allowLocalModels = true;
    const progress_callback = (progress) => ipcRenderer.send("workSlm:progress", { ...progress, modelId: selected.id });
    if (selected.family === "qwen3.5") {
      if (typeof runtime.AutoProcessor?.from_pretrained !== "function"
        || typeof runtime.Qwen3_5ForConditionalGeneration?.from_pretrained !== "function") {
        throw new Error("The installed Work SLM runtime does not support Qwen 3.5.");
      }
      const processor = await runtime.AutoProcessor.from_pretrained(selected.id, { progress_callback });
      const model = await runtime.Qwen3_5ForConditionalGeneration.from_pretrained(selected.id, {
        device: "webgpu",
        dtype: {
          embed_tokens: "q4",
          vision_encoder: "q4",
          decoder_model_merged: "q4",
        },
        progress_callback,
      });
      engine = { kind: "qwen3.5", modelId: selected.id, processor, model };
      return engine;
    }
    const generator = await runtime.pipeline("text-generation", selected.id, {
      device: "webgpu",
      dtype: selected.dtype || "q4",
      progress_callback,
    });
    engine = { kind: "pipeline", family: selected.family, modelId: selected.id, generator };
    return engine;
  })().catch((error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

async function generateAnnouncement(loaded, messages) {
  if (loaded.kind === "pipeline") {
    const lfm = loaded.family === "lfm2.5-jp";
    return loaded.generator(messages, {
      max_new_tokens: 96,
      do_sample: true,
      temperature: lfm ? 0.1 : 0.55,
      ...(lfm ? { top_k: 50 } : { top_p: 0.85 }),
      repetition_penalty: lfm ? 1.05 : 1.08,
      return_full_text: false,
    });
  }
  const prompt = loaded.processor.apply_chat_template(messages, {
    add_generation_prompt: true,
    tokenize: false,
    enable_thinking: false,
  });
  const inputs = await loaded.processor(prompt);
  const outputs = await loaded.model.generate({
    ...inputs,
    max_new_tokens: 96,
    do_sample: true,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    repetition_penalty: 1,
  });
  const promptLength = inputs.input_ids.dims.at(-1);
  const generated = outputs.slice(null, [promptLength, null]);
  return loaded.processor.batch_decode(generated, { skip_special_tokens: true })[0];
}

ipcRenderer.on("workSlm:request", async (_event, payload = {}) => {
  const requestId = String(payload.requestId || "");
  try {
    if (payload.action === "clear") {
      await disposeEngine();
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
        qwen35Supported: typeof runtime.AutoProcessor?.from_pretrained === "function"
          && typeof runtime.Qwen3_5ForConditionalGeneration?.from_pretrained === "function",
        lfm25Supported: typeof runtime.Lfm2ForCausalLM?.from_pretrained === "function",
        webgpuAvailable: await webGpuAvailable(),
      });
      return;
    }
    const loaded = await loadEngine(payload);
    if (payload.action === "prepare") {
      ipcRenderer.send("workSlm:result", { requestId, prepared: true, modelId: loaded.modelId, device: "webgpu" });
      return;
    }
    const messages = workSlmMessages(payload);
    const output = await generateAnnouncement(loaded, messages);
    ipcRenderer.send("workSlm:result", {
      requestId,
      ...parseWorkSlmOutput(output, payload),
      modelId: loaded.modelId,
      device: "webgpu",
    });
  } catch (error) {
    ipcRenderer.send("workSlm:result", { requestId, error: String(error?.message || error) });
  }
});

ipcRenderer.send("workSlm:ready", { webgpuAvailable: Boolean(globalThis.navigator?.gpu) });
