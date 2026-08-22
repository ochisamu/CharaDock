---
name: review-mcp-app-host
description: Implement or audit CharaDock's MCP Apps host, embedded MCP UI cards, bridge methods, sandbox policy, automatic PC/remote presentation, or MCP App regressions. Use for any change involving ui:// resources, _meta.ui.resourceUri, openai/outputTemplate, tools/call from a card, or the MCP App preview.
---

# Review the CharaDock MCP Apps host

Keep MCP Apps portable, safe, and secondary to the character conversation.

## Establish the current contract

1. Fetch the current official MCP Apps and OpenAI UI references before changing protocol behavior. Do not rely on remembered method names or metadata shapes.
2. Prefer the open MCP Apps bridge and `_meta.ui.resourceUri`; support `openai/outputTemplate` and `window.openai` only as compatibility aliases.
3. Inventory standard and compatibility features separately. Never advertise a host capability that is not implemented end to end.

## Preserve the trust boundary

- Treat resource HTML, tool input/results, card messages, URLs, and JSON-RPC parameters as untrusted.
- Render each card in a script-only sandbox with a restrictive CSP derived from declared `connectDomains`, `resourceDomains`, and `frameDomains`.
- Keep tool arguments, results, resource HTML, credentials, and hidden `_meta` out of remote public state. Retrieve them through authenticated, CSRF-protected endpoints.
- Allow card tool calls only for the originating MCP server and app-visible tools. Require an existing approval path for mutating, destructive, or open-world actions; otherwise fail closed.
- Validate external links against HTTP(S) and declared redirect policy. Never let card content navigate an app window or invoke native APIs directly.
- Bound HTML, messages, widget state, resource lists, and retained card instances.

## Preserve one conversation

- Observe completed MCP tool results from the shared Chat, Work, and Realtime backends. Do not add an independent model response path for cards.
- Cover both PC inputs: desktop mascot and settings chat. Cover remote using the same main-process card instance.
- Deduplicate backend result replay by stable tool-call identity.
- Store the originating mode, thread, server assignment, and turn identity with the card. Route `ui/message` back to that context when it is still valid.
- Display a new card automatically once. Do not speak transport text, steal composer focus, cover the character unnecessarily, or require a redundant open button.
- Keep desktop cards in an inactive companion preview and remote cards in a non-modal sheet with the composer available.

## Bridge checklist

Verify the implemented subset explicitly:

- `ui/initialize` and `ui/notifications/initialized`;
- `ui/notifications/host-context-changed`;
- `ui/notifications/tool-input` and `ui/notifications/tool-result` with the full result envelope and hidden `_meta` preserved for the card;
- `tools/call`, `resources/read`, `ui/message`, `ui/open-link`, `ui/request-close`, and supported display modes;
- compatibility argument shapes for `window.openai.callTool`, `sendFollowUpMessage`, `openExternal`, `requestDisplayMode`, and `requestClose`;
- ephemeral widget state only when implemented, bounded, and scoped to one card instance;
- unsupported optional capabilities are absent or fail with a clear protocol error.

Send initialization-dependent notifications after the component initializes. A legacy compatibility card may receive mirrored globals, but that must not reorder the standards-based handshake.

## Verification workflow

1. Add unit tests for metadata normalization, CSP, bridge argument shapes, deduplication, bounds, visibility, approval failure, and data redaction.
2. Add route-level tests proving desktop mascot, settings chat, Chat, Work, and Realtime reach the one observer.
3. Run `scripts/verify-mcp-app-ui.cjs` against a real configured profile MCP that returns a card. The test must execute the real tool and load its real `ui://` resource.
4. Inspect and capture the PC preview and remote/mobile sheet. Confirm no focus theft, stale controls, duplicate opening, hidden data leak, or blocked composer.
5. Exercise at least one card link and one safe card-originated follow-up/tool call when the test MCP provides them.
6. Run targeted MCP/remote tests, runtime typecheck, then the full repository suite.

## Completion report

Report the supported bridge subset, unsupported optional extensions, safety decisions, verified entry surfaces, real MCP used, evidence paths, tests, and any follow-up needed. Do not call the host “fully MCP Apps compatible” unless the full current conformance surface was tested.
