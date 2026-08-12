// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

class WorkSlmFileCache {
  constructor(directory) {
    this.directory = path.join(path.resolve(String(directory || "")), "files");
    fs.mkdirSync(this.directory, { recursive: true });
  }

  paths(key) {
    const value = typeof key === "string" ? key : key?.url || String(key || "");
    const hash = createHash("sha256").update(value).digest("hex");
    return {
      data: path.join(this.directory, `${hash}.bin`),
      meta: path.join(this.directory, `${hash}.json`),
      value,
    };
  }

  async match(key) {
    const target = this.paths(key);
    if (!fs.existsSync(target.data) || !fs.existsSync(target.meta)) return undefined;
    let metadata;
    try { metadata = JSON.parse(fs.readFileSync(target.meta, "utf8")); } catch { return undefined; }
    const contentLengthHeader = new Headers(Array.isArray(metadata.headers) ? metadata.headers : []).get("content-length");
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (contentLength !== null && Number.isFinite(contentLength) && contentLength >= 0 && fs.statSync(target.data).size !== contentLength) {
      fs.rmSync(target.data, { force: true });
      fs.rmSync(target.meta, { force: true });
      return undefined;
    }
    const handle = fs.openSync(target.data, "r");
    const chunkSize = 1024 * 1024;
    let position = 0;
    const stream = new ReadableStream({
      pull(controller) {
        const buffer = Buffer.allocUnsafe(chunkSize);
        const length = fs.readSync(handle, buffer, 0, buffer.length, position);
        if (length <= 0) {
          fs.closeSync(handle);
          controller.close();
          return;
        }
        position += length;
        controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, length));
      },
      cancel() { try { fs.closeSync(handle); } catch {} },
    });
    return new Response(stream, {
      status: Number(metadata.status) || 200,
      headers: Array.isArray(metadata.headers) ? metadata.headers : [],
    });
  }

  async put(key, response, onProgress) {
    const target = this.paths(key);
    const temporary = `${target.data}.${process.pid}.${Date.now()}.tmp`;
    const handle = fs.openSync(temporary, "w", 0o600);
    try {
      // Cache.put consumes the response it is given. Callers that still need the
      // original response pass a clone, matching the browser Cache API contract.
      // Cloning again here can leave a tee branch unread and produce empty files.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Work SLM cache response did not contain a body.");
      const total = Math.max(0, Number(response.headers.get("content-length")) || 0);
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          let written = 0;
          while (written < value.byteLength) {
            written += fs.writeSync(handle, value, written, value.byteLength - written);
          }
          loaded += value.byteLength;
          onProgress?.({
            progress: total > 0 ? Math.min(100, loaded / total * 100) : 0,
            loaded,
            total,
          });
        }
      }
      fs.closeSync(handle);
      fs.renameSync(temporary, target.data);
    } catch (error) {
      try { fs.closeSync(handle); } catch {}
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    fs.writeFileSync(target.meta, `${JSON.stringify({
      url: target.value,
      status: response.status,
      headers: [...response.headers.entries()],
    })}\n`, { mode: 0o600 });
  }
}

module.exports = { WorkSlmFileCache };
