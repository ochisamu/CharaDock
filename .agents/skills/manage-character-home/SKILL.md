---
name: manage-character-home
description: Maintain a CharaDock character's durable home and project continuity. Use when working from a character home or an attached existing project, when resuming prior work, recording durable project decisions or next steps, creating cross-project notes, or preparing artifact paths for CharaDock preview cards.
---

# Manage Character Home

Treat the character home as durable context, not as a dumping ground. Keep the active project as the source of truth for its code and files.

## Start a work turn

1. Read `HOME.md` in the character home.
2. Read the active project continuity record path supplied by CharaDock when it exists.
3. Inspect actual project files before trusting an old note. Current user instructions and files override saved context.
4. Do not scan unrelated attached projects or copy their contents into the home.

## Record durable context

Update the supplied active project continuity record only when the turn creates information likely to matter later:

- goal and current state;
- important commands and entry points;
- decisions and constraints;
- unfinished work or a concrete next step.

Keep it concise. Replace stale statements instead of appending a transcript. Never store prompts, chat logs, generated prose, temporary progress, build output, dependencies, binaries, or recoverable source content.

Use `notes/` for deliberately requested cross-project notes. Use `artifacts/` only when the character home itself is the active project.

## Protect the user

- Never store API keys, tokens, credentials, personal identifiers, private message contents, or environment-variable values in the home.
- Never modify another attached project unless it is explicitly selected as the active project.
- Keep generated artifacts inside the active workspace.
- Mention useful workspace-relative artifact paths in the final report so CharaDock can expose preview and open actions.
- Do not include raw URLs or filesystem paths in spoken prose when a short human-readable label is enough.

## Finish a work turn

Report what changed and verification performed. If useful artifacts were created, name their workspace-relative paths. Update the active project continuity record before the final report when durable continuity changed.
