// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");

const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
const MAX_MCP_APP_HTML_BYTES = 2 * 1024 * 1024;
const MAX_MCP_APP_WIDGET_STATE_BYTES = 64 * 1024;
const MAX_MCP_APP_TOOL_ARGUMENT_BYTES = 64 * 1024;

function safeString(value, maxLength = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function uniqueHttpOrigins(values) {
  return [...new Set((Array.isArray(values) ? values : []).flatMap((value) => {
    try {
      const url = new URL(String(value || ""));
      return ["https:", "http:"].includes(url.protocol) ? [url.origin] : [];
    } catch {
      return [];
    }
  }))];
}

function normalizeMcpAppCsp(meta = {}) {
  const standard = meta?.ui?.csp || meta?.["ui/csp"] || {};
  const legacy = meta?.["openai/widgetCSP"] || {};
  return {
    connectDomains: uniqueHttpOrigins(standard.connectDomains || legacy.connect_domains),
    resourceDomains: uniqueHttpOrigins(standard.resourceDomains || legacy.resource_domains),
    frameDomains: uniqueHttpOrigins(standard.frameDomains || legacy.frame_domains),
    redirectDomains: uniqueHttpOrigins(legacy.redirect_domains),
  };
}

function mcpAppContentSecurityPolicy(meta = {}) {
  const csp = normalizeMcpAppCsp(meta);
  const resources = csp.resourceDomains.join(" ");
  const connect = csp.connectDomains.join(" ");
  const frames = csp.frameDomains.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${resources ? ` ${resources}` : ""}`,
    `style-src 'unsafe-inline'${resources ? ` ${resources}` : ""}`,
    `img-src data: blob:${resources ? ` ${resources}` : ""}`,
    `font-src data:${resources ? ` ${resources}` : ""}`,
    `media-src data: blob:${resources ? ` ${resources}` : ""}`,
    `connect-src${connect ? ` ${connect}` : " 'none'"}`,
    `frame-src${frames ? ` ${frames}` : " 'none'"}`,
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

function mcpAppToolVisibleToApp(tool = {}) {
  const visibility = tool?._meta?.ui?.visibility || tool?._meta?.["ui/visibility"];
  return !Array.isArray(visibility) || visibility.includes("app");
}

function mcpAppToolAllowsDirectCall(tool = {}) {
  if (!mcpAppToolVisibleToApp(tool)) return false;
  const annotations = tool?.annotations && typeof tool.annotations === "object" ? tool.annotations : {};
  return annotations.readOnlyHint === true
    && annotations.destructiveHint === false
    && annotations.openWorldHint === false;
}

function mcpAppExternalLinkAllowed(meta = {}, value = "") {
  let origin = "";
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return false;
    origin = url.origin;
  } catch {
    return false;
  }
  return normalizeMcpAppCsp(meta).redirectDomains.includes(origin);
}

function boundedJsonValue(value, maxBytes, label) {
  if (value === undefined || value === null) return null;
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON serializable.`);
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(`${label} is too large.`);
  }
  return JSON.parse(serialized);
}

function boundedMcpAppWidgetState(value) {
  return boundedJsonValue(value, MAX_MCP_APP_WIDGET_STATE_BYTES, "MCP App widget state");
}

function boundedMcpAppToolArguments(value) {
  const result = boundedJsonValue(value ?? {}, MAX_MCP_APP_TOOL_ARGUMENT_BYTES, "MCP App tool arguments");
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("MCP App tool arguments must be a JSON object.");
  }
  return result;
}

function mcpAppResourceUri(item = {}) {
  const candidates = [
    item?.appContext?.resourceUri,
    item?.mcpAppResourceUri,
    item?._meta?.ui?.resourceUri,
    item?._meta?.["ui/resourceUri"],
    item?._meta?.["openai/outputTemplate"],
  ];
  return safeString(candidates.find((value) => String(value || "").startsWith("ui://")), 2000);
}

function isCompletedMcpAppToolItem(item = {}) {
  return String(item?.type || "") === "mcpToolCall"
    && String(item?.status || "completed") === "completed"
    && Boolean(mcpAppResourceUri(item));
}

function mcpAppResourceContent(readResult = {}, requestedUri = "") {
  const contents = Array.isArray(readResult?.contents)
    ? readResult.contents
    : Array.isArray(readResult?.content) ? readResult.content : [];
  const requested = String(requestedUri || "");
  const content = contents.find((entry) => String(entry?.uri || "") === requested)
    || contents.find((entry) => String(entry?.mimeType || "").toLowerCase().startsWith("text/html"))
    || contents[0];
  const text = typeof content?.text === "string" ? content.text : "";
  const mimeType = safeString(content?.mimeType || MCP_APP_MIME_TYPE, 200).toLowerCase();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_MCP_APP_HTML_BYTES) return null;
  if (!mimeType.startsWith("text/html")) return null;
  return { uri: safeString(content?.uri || requested, 2000), mimeType, text, _meta: content?._meta || {} };
}

function statusResource(statuses = [], serverName = "", resourceUri = "") {
  const server = (Array.isArray(statuses) ? statuses : []).find((entry) => String(entry?.name || "") === String(serverName || ""));
  if (!server) return { server: null, resource: null, tool: null };
  const resource = (Array.isArray(server.resources) ? server.resources : []).find((entry) => String(entry?.uri || "") === String(resourceUri || "")) || null;
  return { server, resource, tool: null };
}

function statusTool(statuses = [], serverName = "", toolName = "") {
  const server = (Array.isArray(statuses) ? statuses : []).find((entry) => String(entry?.name || "") === String(serverName || ""));
  if (!server) return null;
  if (Array.isArray(server.tools)) return server.tools.find((entry) => String(entry?.name || "") === String(toolName || "")) || null;
  return server.tools?.[toolName] || null;
}

function mergeMcpAppMeta(...values) {
  return values.reduce((merged, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return merged;
    return { ...merged, ...value, ui: { ...(merged.ui || {}), ...(value.ui || {}) } };
  }, {});
}

function createMcpAppId(item = {}, resourceUri = "") {
  const seed = [item?.id, item?.server, item?.tool, resourceUri, Date.now(), crypto.randomBytes(8).toString("hex")].join(":");
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

function publicMcpApp(instance) {
  if (!instance) return null;
  return {
    id: safeString(instance.id, 80),
    itemId: safeString(instance.itemId, 160),
    title: safeString(instance.title || instance.toolTitle || instance.toolName || instance.serverTitle, 160),
    subtitle: safeString(instance.serverTitle || instance.serverName, 160),
    toolName: safeString(instance.toolName, 200),
    createdAt: Number(instance.createdAt || 0),
    updatedAt: Number(instance.updatedAt || instance.createdAt || 0),
  };
}

function guestBridgeScript() {
  // This compatibility layer gives lightweight cards the convenient
  // window.openai globals while standards-based MCP Apps can still use the
  // JSON-RPC channel directly.
  return `<script>(function(){"use strict";
var state={toolInput:null,toolOutput:null,toolResponseMetadata:null,widgetState:null,theme:"light",displayMode:"inline",locale:navigator.language||"en"};
var pending=new Map(),nextId=1;
function rpc(method,params){return new Promise(function(resolve,reject){var id=nextId++;pending.set(id,{resolve:resolve,reject:reject});parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params||{}},"*");});}
function notify(method,params){parent.postMessage({jsonrpc:"2.0",method:method,params:params||{}},"*");}
function setGlobals(values){if(!values||typeof values!=="object")return;var next=Object.assign({},values);if(next.safeAreaInsets&&!next.safeArea)next.safeArea=next.safeAreaInsets;if(next.containerDimensions&&next.maxHeight===undefined)next.maxHeight=next.containerDimensions.maxHeight;Object.assign(state,next);try{window.dispatchEvent(new CustomEvent("openai:set_globals",{detail:{globals:next}}));}catch(_){}}
var api={callTool:function(name,args){return rpc("tools/call",{name:String(name||""),arguments:args&&typeof args==="object"?args:{}});},sendFollowUpMessage:function(value){var prompt=value&&typeof value==="object"?value.prompt:value;return rpc("ui/message",{role:"user",content:[{type:"text",text:String(prompt||"")}],scrollToBottom:!(value&&typeof value==="object"&&value.scrollToBottom===false)});},openExternal:function(value){var href=value&&typeof value==="object"?value.href:value;return rpc("ui/open-link",{url:String(href||""),redirectUrl:value&&typeof value==="object"?value.redirectUrl:undefined});},requestClose:function(){return rpc("ui/request-close",{});},requestDisplayMode:function(value){var mode=value&&typeof value==="object"?value.mode:value;return rpc("ui/request-display-mode",{mode:String(mode||"inline")});},setWidgetState:function(value){state.widgetState=value===undefined?null:value;notify("ui/set-widget-state",{state:state.widgetState});}};
["toolInput","toolOutput","toolResponseMetadata","widgetState","theme","displayMode","locale","maxHeight","safeArea","userAgent"].forEach(function(key){Object.defineProperty(api,key,{enumerable:true,get:function(){return state[key];}});});
if(!window.openai)window.openai=api;if(!window.mcp)window.mcp=api;
window.addEventListener("message",function(event){if(event.source!==parent)return;var message=event.data||{};
if(message.jsonrpc==="2.0"&&Object.prototype.hasOwnProperty.call(message,"id")&&!message.method){var waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);if(message.error)waiter.reject(new Error(message.error.message||"MCP App request failed"));else waiter.resolve(message.result);return;}
if(message.method==="ui/notifications/tool-input")setGlobals({toolInput:message.params||{}});
if(message.method==="ui/notifications/tool-result"){var result=message.params||{};setGlobals({toolOutput:result.structuredContent!==undefined?result.structuredContent:result,toolResponseMetadata:Object.assign({status:"completed",call_tool_result:result,mcp_tool_result:result},result._meta||{})});}
if(message.method==="ui/notifications/host-context-changed")setGlobals(message.params||{});
if(message.structuredContent!==undefined)setGlobals({toolOutput:message.structuredContent,toolResponseMetadata:Object.assign({status:"completed",call_tool_result:message,mcp_tool_result:message},message._meta||{})});
});
document.addEventListener("click",function(event){var anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;try{var url=new URL(anchor.href);if(url.protocol!=="https:"&&url.protocol!=="http:")return;event.preventDefault();api.openExternal(url.href).catch(function(){});}catch(_){}});
rpc("ui/initialize",{protocolVersion:"2025-11-21",clientInfo:{name:"CharaDock compatibility bridge",version:"1"},capabilities:{}}).then(function(result){setGlobals(result&&result.hostContext||{});notify("ui/notifications/initialized",{});}).catch(function(){});
})();</script>`;
}

function injectMcpAppGuestBridge(html) {
  const source = String(html || "");
  const bridge = guestBridgeScript();
  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${bridge}`);
  if (/<html(?:\s[^>]*)?>/i.test(source)) return source.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${bridge}</head>`);
  return `<!doctype html><html><head>${bridge}</head><body>${source}</body></html>`;
}

module.exports = {
  MAX_MCP_APP_HTML_BYTES,
  MAX_MCP_APP_TOOL_ARGUMENT_BYTES,
  MAX_MCP_APP_WIDGET_STATE_BYTES,
  MCP_APP_MIME_TYPE,
  boundedMcpAppToolArguments,
  boundedMcpAppWidgetState,
  createMcpAppId,
  injectMcpAppGuestBridge,
  isCompletedMcpAppToolItem,
  mcpAppContentSecurityPolicy,
  mcpAppExternalLinkAllowed,
  mcpAppResourceContent,
  mcpAppResourceUri,
  mcpAppToolAllowsDirectCall,
  mcpAppToolVisibleToApp,
  mergeMcpAppMeta,
  normalizeMcpAppCsp,
  publicMcpApp,
  statusResource,
  statusTool,
};
