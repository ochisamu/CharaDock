// SPDX-License-Identifier: Apache-2.0

function createRealtimeUnsolicitedGuard({
  terminate,
  schedule = queueMicrotask,
  onError = () => {},
} = {}) {
  if (typeof terminate !== "function") throw new TypeError("terminate must be a function");
  if (typeof schedule !== "function") throw new TypeError("schedule must be a function");
  if (typeof onError !== "function") throw new TypeError("onError must be a function");

  let terminating = false;
  return {
    observe({ authorized = true, ...detail } = {}) {
      if (authorized || terminating) return false;
      terminating = true;
      schedule(() => {
        Promise.resolve()
          .then(() => terminate(detail))
          .catch(onError);
      });
      return true;
    },
    get terminating() {
      return terminating;
    },
  };
}

module.exports = { createRealtimeUnsolicitedGuard };
