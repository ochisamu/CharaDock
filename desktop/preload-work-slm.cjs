// SPDX-License-Identifier: Apache-2.0
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { ipcRenderer } = require("electron");
const { WorkSlmFileCache } = require("./lib/work-slm-file-cache.cjs");
const {
  generatedTextFromPipeline,
  parseWorkSlmOutput,
  prefilledWorkSlmJson,
  workSlmModel,
  workSlmMessages,
} = require("./lib/work-slm.cjs");

let enginePromise = null;
let engine = null;
let lastGeneratedOutput = "";

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

function configureOnnxRuntime(runtime) {
  let ortDist = path.dirname(require.resolve("onnxruntime-web/webgpu"));
  ortDist = ortDist.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const wasmModule = path.join(ortDist, "ort-wasm-simd-threaded.asyncify.mjs");
  const wasmBinary = path.join(ortDist, "ort-wasm-simd-threaded.asyncify.wasm");
  runtime.env.useWasmCache = false;
  runtime.env.backends.onnx.wasm.numThreads = 1;
  runtime.env.backends.onnx.wasm.wasmPaths = {
    mjs: pathToFileURL(wasmModule).href,
    wasm: pathToFileURL(wasmBinary).href,
  };
  runtime.env.backends.onnx.wasm.wasmBinary = new Uint8Array(fs.readFileSync(wasmBinary));
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
    configureOnnxRuntime(runtime);
    env.cacheKey = "charadock-work-slm-v1";
    env.cacheDir = String(cacheDirectory || "");
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = new WorkSlmFileCache(cacheDirectory);
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
          vision_encoder: "fp16",
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
    const qwen25 = loaded.family === "qwen2.5";
    const tokenizer = loaded.generator.tokenizer;
    const prompt = tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    }) + '{"text":"';
    const inputs = tokenizer(prompt, { add_special_tokens: false });
    const outputs = await loaded.generator.model.generate({
      ...inputs,
      max_new_tokens: 72,
      do_sample: !qwen25,
      ...(!qwen25 ? { temperature: lfm ? 0.1 : 0.55 } : {}),
      ...(lfm ? { top_k: 50 } : qwen25 ? {} : { top_p: 0.85 }),
      repetition_penalty: lfm ? 1.05 : 1.08,
    });
    const promptLength = inputs.input_ids.dims.at(-1);
    const generated = outputs.slice(null, [promptLength, null]);
    const continuation = tokenizer.batch_decode(generated, { skip_special_tokens: true })[0];
    return prefilledWorkSlmJson(continuation);
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
    do_sample: false,
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
      fs.rmSync(path.join(path.resolve(String(payload.cacheDirectory || "")), "files"), { recursive: true, force: true });
      ipcRenderer.send("workSlm:result", { requestId, cleared: true });
      return;
    }
    if (payload.action === "probe") {
      const runtime = await import(transformersWebUrl(payload.runtimePath));
      const cacheDirectory = path.resolve(String(payload.cacheDirectory || ""));
      fs.mkdirSync(cacheDirectory, { recursive: true });
      ipcRenderer.send("workSlm:result", {
        requestId,
        probed: typeof runtime.pipeline === "function" && fs.statSync(cacheDirectory).isDirectory(),
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
    lastGeneratedOutput = generatedTextFromPipeline(output).slice(0, 2_000);
    let parsed;
    try {
      parsed = parseWorkSlmOutput(output, payload);
    } catch (error) {
      ipcRenderer.send("workSlm:result", {
        requestId,
        error: String(error?.message || error),
        errorKind: "output-validation",
        errorStack: String(error?.stack || "").slice(0, 12_000),
        diagnosticOutput: lastGeneratedOutput,
      });
      return;
    }
    ipcRenderer.send("workSlm:result", {
      requestId,
      ...parsed,
      modelId: loaded.modelId,
      device: "webgpu",
    });
  } catch (error) {
    ipcRenderer.send("workSlm:result", {
      requestId,
      error: String(error?.message || error),
      errorStack: String(error?.stack || "").slice(0, 12_000),
      diagnosticOutput: lastGeneratedOutput,
    });
  }
});

ipcRenderer.send("workSlm:ready", { webgpuAvailable: Boolean(globalThis.navigator?.gpu) });
