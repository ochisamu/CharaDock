// SPDX-License-Identifier: Apache-2.0
// Keep input ingestion ordered without waiting for an entire assistant reply.
function resetCaptureQueue(gateway) {
  gateway.captureEpoch = (gateway.captureEpoch || 0) + 1;
  gateway.captureSession = null;
  gateway.captureQueue = Promise.resolve();
}

function handleCaptureFrame(gateway, frame, types) {
  const { type } = frame;
  if (![types.PTT_START, types.PCM_CHUNK, types.PTT_END].includes(type)) return false;
  let session = gateway.captureSession;
  if (type === types.PTT_START) {
    if (session?.valid && !session.endReceived) return true;
    session = { epoch: gateway.captureEpoch || 0, valid: true, endReceived: false };
    gateway.captureSession = session;
  } else if (!session || session.endReceived) return true;
  if (type === types.PTT_END) session.endReceived = true;
  const current = () => session.valid && session.epoch === (gateway.captureEpoch || 0);
  const report = (error) => {
    if (!current()) return;
    session.valid = false;
    gateway.reportCallbackError(error);
  };
  const payload = type === types.PCM_CHUNK ? Buffer.from(frame.payload) : null;
  const manual = type === types.PTT_START && frame.payload?.length === 1 && frame.payload[0] === 1;
  gateway.captureQueue = gateway.captureQueue.then(async () => {
    if (!current()) return;
    if (type === types.PTT_START) {
      // A host-declined capture may be stopped without a device PTT_END.
      if (await gateway.callbacks.onPttStart({ manual }) === false) session.valid = false;
    }
    else if (type === types.PCM_CHUNK) await gateway.callbacks.onPcmChunk(payload);
    else {
      // End claims the capture synchronously; its returned promise also owns
      // recognition/response/playback, which must not block a later follow-up.
      Promise.resolve(gateway.callbacks.onPttEnd()).catch(report);
    }
  }).catch(report);
  return true;
}

module.exports = { handleCaptureFrame, resetCaptureQueue };
