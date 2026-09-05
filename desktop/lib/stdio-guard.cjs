// SPDX-License-Identifier: Apache-2.0
// A desktop app can outlive the terminal that launched it. Only stdout/stderr
// EPIPE is disposable; do not hide exceptions from device pipes or app logic.
function guardDiagnosticStream(stream) {
  if (!stream || stream.__charadockPipeGuard) return;
  stream.__charadockPipeGuard = true;
  let broken = false;
  const write = stream.write;
  const completeDroppedWrite = (args) => {
    const callback = args.at(-1);
    if (typeof callback === "function") queueMicrotask(() => callback());
    return true; // Discard diagnostics without leaving a producer awaiting drain.
  };
  stream.on("error", (error) => {
    if (error?.code !== "EPIPE") throw error;
    broken = true;
  });
  stream.write = function (...args) {
    if (broken) return completeDroppedWrite(args);
    try { return write.apply(this, args); }
    catch (error) {
      if (error?.code !== "EPIPE") throw error;
      broken = true;
      return completeDroppedWrite(args);
    }
  };
}

function installStdioGuard(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) guardDiagnosticStream(stream);
}

module.exports = { installStdioGuard };
