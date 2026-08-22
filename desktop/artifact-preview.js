// SPDX-License-Identifier: Apache-2.0
(() => {
  "use strict";
  const api = window.charadockArtifactPreview;
  const kindLabel = document.querySelector("#previewKind");
  const title = document.querySelector("#previewTitle");
  const pathLabel = document.querySelector("#previewPath");
  const body = document.querySelector("#previewBody");
  const status = document.querySelector("#previewStatus");
  const openButton = document.querySelector("#openButton");
  const openButtonLabel = document.querySelector("#openButtonLabel");
  const closeButton = document.querySelector("#closeButton");
  const revisionForm = document.querySelector("#revisionForm");
  const revisionInput = document.querySelector("#revisionInput");
  const revisionSendButton = document.querySelector("#revisionSendButton");
  const revisionTitle = document.querySelector("#revisionTitle");
  const revisionHint = document.querySelector("#revisionHint");
  const revisionState = document.querySelector("#revisionState");
  const revisionPanel = document.querySelector(".revision-panel");
  let current = null;
  let mcpAppHost = null;
  let statusTimer = null;

  const english = () => current?.language === "en";
  const t = (ja, en) => english() ? en : ja;
  const showError = (error) => {
    clearTimeout(statusTimer);
    status.textContent = String(error?.message || error || t("プレビューを表示できませんでした。", "Could not show the preview."));
    status.hidden = false;
    statusTimer = setTimeout(() => { status.hidden = true; }, 6000);
  };
  const aliases = Object.freeze({
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript", html: "xml", htm: "xml", svg: "xml",
    yml: "yaml", md: "markdown", markdown: "markdown", sh: "bash", ps1: "powershell",
    bat: "dos", py: "python", rb: "ruby", rs: "rust", kt: "kotlin", h: "c", cpp: "cpp", hpp: "cpp", jsonc: "json",
  });

  function highlighted(preview) {
    const source = String(preview.text || "");
    const requested = aliases[preview.language] || String(preview.language || "plaintext").toLowerCase();
    const language = window.hljs?.getLanguage?.(requested) ? requested : "plaintext";
    const wrapper = document.createElement("section");
    wrapper.className = "code-preview";
    const toolbar = document.createElement("header");
    const label = document.createElement("span");
    label.textContent = language === "plaintext" ? t("テキスト", "Plain text") : language;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = t("コピー", "Copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = t("コピーしました", "Copied");
        setTimeout(() => { copy.textContent = t("コピー", "Copy"); }, 1400);
      } catch (error) { showError(error); }
    });
    toolbar.append(label, copy);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = `hljs language-${language}`;
    try {
      if (window.hljs) code.innerHTML = window.hljs.highlight(source, { language, ignoreIllegals: true }).value;
      else code.textContent = source;
    } catch { code.textContent = source; }
    pre.appendChild(code);
    wrapper.append(toolbar, pre);
    return wrapper;
  }

  const sameRunUrl = (value, preview) => {
    if (!value || !preview.url) return null;
    try {
      const base = new URL(preview.url);
      const resolved = new URL(value, base);
      return resolved.protocol === "charadock-artifact:" && resolved.hostname === base.hostname ? resolved : null;
    } catch { return null; }
  };

  function markdown(preview) {
    if (typeof window.markdownit !== "function" || !window.DOMPurify) return highlighted(preview);
    const renderer = window.markdownit({
      html: false, linkify: true, typographer: true,
      highlight(source, requested) {
        const language = aliases[requested] || String(requested || "plaintext").toLowerCase();
        if (window.hljs?.getLanguage?.(language)) {
          try { return `<pre><code class="hljs language-${language}">${window.hljs.highlight(source, { language, ignoreIllegals: true }).value}</code></pre>`; } catch {}
        }
        return `<pre><code class="hljs language-plaintext">${renderer.utils.escapeHtml(source)}</code></pre>`;
      },
    });
    const fragment = window.DOMPurify.sanitize(renderer.render(String(preview.text || "")), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ["a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"],
      ALLOWED_ATTR: ["alt", "class", "colspan", "href", "rowspan", "src", "start", "title"],
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ["form", "iframe", "input", "object", "script", "style", "template"],
      FORBID_ATTR: ["style"],
    });
    for (const image of fragment.querySelectorAll("img[src]")) {
      const resolved = sameRunUrl(image.getAttribute("src"), preview);
      if (resolved) image.src = resolved.toString();
      else {
        const placeholder = document.createElement("span");
        placeholder.className = "image-placeholder";
        placeholder.textContent = t("外部画像は安全のため読み込みません。", "External images are not loaded for safety.");
        image.replaceWith(placeholder);
      }
    }
    for (const link of fragment.querySelectorAll("a[href]")) {
      const raw = link.getAttribute("href");
      let external = null;
      try {
        const value = new URL(raw);
        if (["https:", "http:"].includes(value.protocol)) external = value;
      } catch {}
      if (!external) {
        link.removeAttribute("href");
        continue;
      }
      link.addEventListener("click", (event) => {
        event.preventDefault();
        api.openExternalUrl(external.toString()).catch(showError);
      });
    }
    const wrapper = document.createElement("section");
    wrapper.className = "markdown-preview";
    const article = document.createElement("article");
    article.appendChild(fragment);
    wrapper.appendChild(article);
    return wrapper;
  }

  function webProject(preview) {
    const project = preview.project || {};
    const server = preview.server || { status: "idle", logs: [] };
    if (server.status === "running" && server.url) {
      const wrapper = document.createElement("section");
      wrapper.className = "web-running";
      const toolbar = document.createElement("header");
      const badge = document.createElement("span");
      badge.textContent = `● ${t("ライブプレビュー", "Live preview")}`;
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "secondary-button";
      stop.textContent = t("停止", "Stop");
      stop.addEventListener("click", async () => {
        stop.disabled = true;
        try { await api.stopWebPreview(); } catch (error) { showError(error); stop.disabled = false; }
      });
      toolbar.append(badge, stop);
      const frame = document.createElement("iframe");
      frame.title = preview.name || t("ライブプレビュー", "Live preview");
      frame.src = server.url;
      wrapper.append(toolbar, frame);
      return wrapper;
    }
    const card = document.createElement("section");
    card.className = "web-launch";
    const heading = document.createElement("h2");
    heading.textContent = project.name || preview.name;
    const explanation = document.createElement("p");
    explanation.textContent = t("開発サーバーをローカルで起動して、このウィンドウ内に表示します。依存関係は自動インストールしません。", "Start the local development server and show it in this window. Dependencies are not installed automatically.");
    const controls = document.createElement("div");
    controls.className = "web-controls";
    const scriptLabel = document.createElement("label");
    scriptLabel.textContent = t("スクリプト", "Script");
    const script = document.createElement("select");
    for (const value of project.scripts || [project.preferredScript || "dev"]) {
      const option = document.createElement("option"); option.value = value; option.textContent = value; script.appendChild(option);
    }
    script.value = project.preferredScript || script.options[0]?.value || "dev";
    scriptLabel.appendChild(script);
    const runtimeLabel = document.createElement("label");
    runtimeLabel.textContent = t("実行環境", "Runtime");
    const runtime = document.createElement("select");
    for (const value of project.runtimeOptions || ["auto"]) {
      const option = document.createElement("option"); option.value = value; option.textContent = value === "auto" ? t("自動", "Auto") : value === "windows" ? "Windows Node.js" : "WSL Node.js"; runtime.appendChild(option);
    }
    runtime.value = project.runtime || "auto";
    runtimeLabel.appendChild(runtime);
    controls.append(scriptLabel, runtimeLabel);
    const command = document.createElement("code");
    command.className = "web-command";
    const updateCommand = () => { command.textContent = `${project.packageManager || "npm"} run ${script.value} -- ${project.framework === "nextjs" ? "--hostname" : "--host"} 127.0.0.1 --port <auto>`; };
    script.addEventListener("change", updateCommand); updateCommand();
    const start = document.createElement("button");
    start.type = "button"; start.className = "primary-button";
    start.textContent = ["starting", "stopping"].includes(server.status) ? t("準備しています…", "Preparing…") : t("ライブプレビューを起動", "Start live preview");
    start.disabled = ["starting", "stopping"].includes(server.status);
    start.addEventListener("click", async () => {
      start.disabled = true;
      try { await api.startWebPreview({ projectId: project.id, script: script.value, runtime: runtime.value }); }
      catch (error) { showError(error); start.disabled = false; }
    });
    card.append(heading, explanation, controls, command, start);
    if (server.error) { const error = document.createElement("p"); error.textContent = server.error; card.appendChild(error); }
    if (server.logs?.length) { const logs = document.createElement("pre"); logs.className = "web-log"; logs.textContent = server.logs.join("\n"); card.appendChild(logs); }
    return card;
  }

  function render(payload) {
    if (!payload?.preview) return;
    current = payload;
    document.documentElement.lang = english() ? "en" : "ja";
    const preview = payload.preview;
    const isMcpApp = preview.type === "mcp-app";
    document.body.classList.toggle("is-mcp-app", isMcpApp);
    kindLabel.textContent = isMcpApp ? "MCP APP" : "PREVIEW";
    title.textContent = preview.name || t("成果物", "Output");
    pathLabel.textContent = preview.path || "";
    openButton.hidden = isMcpApp;
    revisionPanel.hidden = isMcpApp;
    openButtonLabel.textContent = preview.type === "web-project" && preview.server?.status === "running" ? t("ブラウザーで開く", "Open in browser") : t("外部で開く", "Open externally");
    closeButton.setAttribute("aria-label", t("閉じる", "Close"));
    revisionTitle.textContent = t("この成果物を続けて修正", "Keep refining this output");
    revisionHint.textContent = t("ここに入力するか、Workの音声入力で話しかけてください。", "Type here, or speak through Work voice input.");
    revisionInput.placeholder = t("例: タイトルを大きくして、配色をもう少し落ち着かせて", "For example: Make the title larger and use calmer colors");
    revisionSendButton.textContent = t("修正する", "Revise");
    body.replaceChildren();
    mcpAppHost?.destroy?.();
    mcpAppHost = null;
    let node;
    if (isMcpApp) {
      node = document.createElement("iframe");
      node.title = preview.name || t("MCPカード", "MCP card");
      node.src = preview.url;
      node.setAttribute("sandbox", "allow-scripts");
      mcpAppHost = window.CharaDockMcpAppHost?.mount(node, preview.mcpApp, {
        request: (request) => api.mcpAppBridge(request),
        onClose: () => api.close(),
        onDisplayMode: (mode) => document.body.classList.toggle("is-mcp-fullscreen", mode === "fullscreen"),
      });
    } else if (preview.type === "web-project") node = webProject(preview);
    else if (["web", "pdf"].includes(preview.type)) {
      node = document.createElement("iframe"); node.title = preview.name || t("成果物プレビュー", "Output preview"); node.src = preview.url;
      if (preview.type === "web") node.setAttribute("sandbox", "allow-scripts");
    } else if (preview.type === "image") {
      node = document.createElement("img"); node.src = preview.url; node.alt = preview.name || t("成果物", "Output");
    } else if (["audio", "video"].includes(preview.type)) {
      node = document.createElement(preview.type); node.src = preview.url; node.controls = true; node.preload = "metadata";
    } else if (preview.type === "text") node = ["md", "markdown"].includes(String(preview.language || "").toLowerCase()) ? markdown(preview) : highlighted(preview);
    else if (preview.type === "directory") {
      node = document.createElement("div"); node.className = "directory-list";
      for (const item of preview.items || []) {
        const row = document.createElement("span"); const icon = document.createElement("i"); icon.className = `symbol ${item.kind === "directory" ? "symbol-folder" : "symbol-document"}`; row.append(icon, document.createTextNode(item.name)); node.appendChild(row);
      }
      if (!node.childElementCount) node.textContent = t("フォルダーは空です。", "This folder is empty.");
    } else {
      node = document.createElement("div"); node.className = "empty-preview"; node.textContent = t("この形式はアプリ内表示に対応していません。右上の「外部で開く」を使ってください。", "This format cannot be shown in the app. Use Open externally.");
    }
    body.appendChild(node);
  }

  openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    try {
      if (current?.preview?.type === "web-project" && current.preview.server?.status === "running") await api.openWebPreview();
      else await api.openArtifact();
    } catch (error) { showError(error); }
    finally { openButton.disabled = false; }
  });
  closeButton.addEventListener("click", () => api.close());
  revisionInput.addEventListener("input", () => {
    revisionInput.style.height = "auto";
    revisionInput.style.height = `${Math.min(94, Math.max(38, revisionInput.scrollHeight))}px`;
  });
  revisionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      revisionForm.requestSubmit();
    }
  });
  revisionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instruction = revisionInput.value.trim();
    if (!instruction) return;
    revisionInput.disabled = true;
    revisionSendButton.disabled = true;
    revisionState.dataset.status = "running";
    revisionState.textContent = t("キャラクターへ修正を依頼しています…", "Sending the revision to your character…");
    try {
      const result = await api.revise(instruction);
      revisionInput.value = "";
      revisionInput.style.height = "38px";
      if (result?.queued && revisionState.dataset.status !== "running") {
        revisionState.dataset.status = "queued";
        revisionState.textContent = t("Liveへ送りました。作業の完了後にプレビューを更新します。", "Sent through Live. The preview will refresh when work finishes.");
      }
    } catch (error) {
      showError(error);
      revisionState.dataset.status = "error";
      revisionState.textContent = String(error?.message || error);
    } finally {
      if (revisionState.dataset.status !== "running") {
        revisionInput.disabled = false;
        revisionSendButton.disabled = false;
        revisionInput.focus();
      }
    }
  });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.activeElement !== revisionInput) api.close(); });
  api.onShow(render);
  api.onWebPreview(async (state) => {
    if (!current?.preview?.project || state.projectId !== current.preview.project.id) return;
    current.preview.server = state;
    render(current);
  });
  api.onRevisionState((state) => {
    const value = String(state?.status || "");
    revisionState.dataset.status = value;
    revisionState.textContent = String(state?.message || "");
    const running = value === "running";
    revisionInput.disabled = running;
    revisionSendButton.disabled = running;
    if (value === "completed") revisionInput.focus();
  });
  api.getCurrent().then((payload) => { if (payload) render(payload); }).catch(showError);
})();
