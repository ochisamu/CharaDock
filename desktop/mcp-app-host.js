// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";

  const PROTOCOL_VERSION = "2025-11-21";

  function errorPayload(error) {
    return { code: -32603, message: String(error?.message || error || "MCP App request failed").slice(0, 500) };
  }

  function post(frame, message) {
    frame?.contentWindow?.postMessage(message, "*");
  }

  function hostContext(context = {}) {
    const mobile = matchMedia("(pointer: coarse)").matches;
    return {
      toolInfo: {
        id: context.app?.itemId || context.app?.id || "",
        tool: {
          name: context.app?.toolName || "mcp_app_tool",
          title: context.app?.title || "MCP App",
          inputSchema: { type: "object" },
        },
      },
      theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: {
        maxWidth: Math.max(0, Math.round(innerWidth)),
        maxHeight: Math.max(0, Math.round(innerHeight)),
      },
      locale: document.documentElement.lang || navigator.language || "en",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      userAgent: navigator.userAgent,
      platform: mobile ? "mobile" : "desktop",
      deviceCapabilities: {
        touch: navigator.maxTouchPoints > 0,
        hover: matchMedia("(hover: hover)").matches,
      },
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }

  function mount(frame, app, options = {}) {
    if (!frame || !app?.id || typeof options.request !== "function") return { destroy() {} };
    let destroyed = false;
    let context = null;

    const notifyContext = () => {
      if (!context || destroyed) return;
      const nextHostContext = hostContext(context);
      post(frame, { jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: nextHostContext });
      post(frame, { jsonrpc: "2.0", method: "ui/notifications/tool-input", params: context.toolInput || {} });
      post(frame, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: context.toolResult || {} });
      // Older OpenAI widget templates read this compact shape directly.
      post(frame, {
        structuredContent: context.toolResult?.structuredContent,
        toolOutput: context.toolResult?.structuredContent,
        _meta: context.toolResult?._meta || null,
      });
    };

    const loadContext = async () => {
      context = await options.request({ appId: app.id, method: "host/context", params: {} });
      notifyContext();
      return context;
    };

    const respond = (id, result, error) => {
      if (id === undefined || id === null) return;
      post(frame, error
        ? { jsonrpc: "2.0", id, error: errorPayload(error) }
        : { jsonrpc: "2.0", id, result: result === undefined ? {} : result });
    };

    const onMessage = async (event) => {
      if (destroyed || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
      const { id, method, params = {} } = message;
      try {
        if (method === "ui/initialize") {
          context ||= await loadContext();
          respond(id, {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "CharaDock", title: "CharaDock", version: "1" },
            hostCapabilities: {
              openLinks: {},
              serverTools: {},
              serverResources: {},
              sandbox: { permissions: {}, csp: context.csp || {} },
            },
            hostContext: hostContext(context),
          });
          return;
        }
        if (["ui/notifications/initialized", "ui/notifications/size-changed", "ui/notifications/log"].includes(method)) return;
        if (method === "ui/request-display-mode") {
          const requested = params.mode === "fullscreen" ? "fullscreen" : "inline";
          options.onDisplayMode?.(requested);
          respond(id, { mode: requested });
          return;
        }
        if (method === "ui/request-close") {
          options.onClose?.();
          respond(id, {});
          return;
        }
        if (method === "ping") {
          respond(id, {});
          return;
        }
        if (method === "ui/open-link") {
          const url = String(params.url || "");
          if (options.openExternal) await options.openExternal(url);
          else await options.request({ appId: app.id, method, params: { url } });
          respond(id, {});
          return;
        }
        const result = await options.request({ appId: app.id, method, params });
        respond(id, result);
        if (method === "tools/call" && result) {
          context ||= await loadContext();
          context.toolResult = result;
          notifyContext();
        }
      } catch (error) {
        respond(id, null, error);
      }
    };

    const onLoad = () => { loadContext().catch(() => {}); };
    addEventListener("message", onMessage);
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return {
      destroy() {
        destroyed = true;
        removeEventListener("message", onMessage);
        frame.removeEventListener("load", onLoad);
      },
      refresh() { return loadContext(); },
    };
  }

  window.CharaDockMcpAppHost = { mount };
})();
