// SPDX-License-Identifier: Apache-2.0

function normalizeExternalHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function secureWindowNavigation(webContents, { allowedPrefix, openExternal, onError = () => {} }) {
  const openSafeExternal = (value) => {
    const url = normalizeExternalHttpUrl(value);
    if (!url) return false;
    try {
      Promise.resolve(openExternal(url)).catch(onError);
    } catch (error) {
      onError(error);
    }
    return true;
  };

  webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (String(url || "").startsWith(allowedPrefix)) return;
    event.preventDefault();
    openSafeExternal(url);
  });
}

module.exports = { normalizeExternalHttpUrl, secureWindowNavigation };
