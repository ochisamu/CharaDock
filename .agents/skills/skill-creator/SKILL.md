---
name: skill-creator
description: Turn a useful conversation or repeated workflow into a reusable CharaDock Skill. Use when the user asks to save the current approach, procedure, preferences, or working pattern as a Skill, or when they explicitly ask to create or update a Skill.
---

# Create a CharaDock Skill

Convert the useful, reusable part of the conversation into a focused Skill. Do not copy the transcript.

## Workflow

1. Identify the repeatable outcome, trigger, constraints, and ordered procedure from the conversation.
2. Exclude secrets, credentials, personal paths, temporary logs, one-off details, and unsupported assumptions.
3. Propose a compact draft containing:
   - a lowercase kebab-case name;
   - one clear description that says what the Skill does and when to use it;
   - concise imperative instructions;
   - whether it should apply to the current character or every character.
4. Ask for one explicit confirmation before saving. Do not call `skill_create` merely because a Skill seems useful.
5. After confirmation, call `skill_create` with the approved draft. Report that it will be available from the next request.

## Writing rules

- Keep the Skill narrow enough to trigger predictably.
- Prefer a short procedure and decision rules over background explanation.
- Include validation or safety checks when the workflow can modify files or external state.
- Never claim that scripts, templates, or assets exist unless they are actually included.
- The first version is text-only. If files or executable helpers are needed, explain that limitation before saving.
- Update an existing same-named CharaDock Skill only when the user explicitly approves replacing it.
