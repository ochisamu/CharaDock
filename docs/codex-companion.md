# Codex Companion — read-only prototype

CharaDock's **Codex Companion** page is a separate role from Chat / Work.
Codex Desktop does the work; CharaDock displays the selected conversation's
progress and result with the existing character and connected RLCD.

## Try it

1. Open **Codex Companion** in the PC app's left menu.
2. Choose **会話一覧を更新**. The default directory is `$CODEX_HOME/sessions`,
   or the current OS user's `.codex/sessions`.
3. Select a conversation by project-folder name, short conversation ID and
   last-update time. Desktop-originated logs are labelled **Codex Desktop**;
   CLI-originated logs are labelled separately. These are not official chat titles.
4. Press **Companionを開始**. The character shows status / final text, and
   an already-connected RLCD shows CODEX and the current activity.
5. **停止して会話モードへ** returns to the unchanged Chat / Work settings.

If the list is empty, select the actual Codex **sessions** folder. A Windows
desktop installation normally uses the Windows user's folder, not the WSL
user's folder. WSL rollouts can be selected through a local UNC folder path.
The adapter doesn't infer a Windows username or scan other users' homes.
Monitoring is OFF on every application restart, intentionally.

## Scope and safeguards

- This version reads persisted **local rollout JSONL**, not a supported live
  desktop integration API. It neither launches a second agent nor resumes a
  thread. It performs no Codex, OpenAI or Jev inference calls.
- No Codex files, configuration, authentication or SQLite databases are edited.
  Listing reads session metadata only; selected conversation progress/results
  are held in memory, not copied to CharaDock histories or diagnostic logs.
- Reasoning, raw tool arguments/output, user input and credentials are excluded
  from the presentation. Text is untrusted and is displayed as text, never HTML
  or commands. Source text may still contain sensitive information, so choose
  a suitable conversation before displaying it on a shared physical screen.
- CharaDock's Chat / Work / Live submission paths and ESP32 capture are blocked
  while watching; existing Live sessions are stopped on activation. Active work,
  capture or answer playback must finish before activation.
- Approval/input responses remain in Codex. The prototype detects only explicit
  input-request tool records, **not all approval waits**. No automatic approvals.
- No automatic speech or Jev expression classification yet. Simple status-based
  expressions use actual observed events. It is safe to experiment without new
  AI consumption or unexpected spoken notifications.
- Polling is 1.2 seconds and may lag behind actual desktop activity. An active
  state with no relevant event for 2 minutes is marked uncertain, not completed.
  Unsupported records, inaccessible logs and truncated history never imply
  success. A crashed process may leave a persisted active marker.
- Only recent 50 session files are listed, traversal is bounded, and initial
  selected replay is limited to the latest 2 MiB. Results are bounded to 12,000
  characters in this prototype. Old/unflushed messages may not be available.

## Integration direction

The official [app-server](https://learn.chatgpt.com/docs/app-server) documents
`thread/read` / `thread/list`, status notifications and turn/item events. But
starting a separate app-server does not prove attachment to the existing
desktop's active process. This prototype deliberately does not claim such an
attachment. Replace the local rollout adapter if a supported passive desktop
connection becomes available; keep the UI and device presentation unchanged.

The official [notify configuration](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
offers completion notifications. This experiment does not modify that setting.

Run `node --test desktop/tests/codex-companion.test.cjs`, then the full
`npm run test:desktop` before deployment. No ESP32 firmware change is required.
