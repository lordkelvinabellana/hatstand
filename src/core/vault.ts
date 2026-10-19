import * as fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Wires a profile's Claude Code to its own second-brain vault: seeds the vault, adds the capture
 * hooks to `code/settings.json` and a managed block to `code/CLAUDE.md`. Turning it off removes
 * only what Hatstand added; notes are never deleted.
 */
export const BLOCK_START = '<!-- hatstand:second-brain:start -->';
export const BLOCK_END = '<!-- hatstand:second-brain:end -->';
const OURS = 'capture.cjs';
/** A capture script the user wired up themselves (the original Python second brain). */
const EXTERNAL = 'capture.py';

const templates: Record<string, string> = {
  Client: `---
type: client
status: active
updated: {{date}}
aliases: []
---
# {{title}}

What they are and what the work for them is, in one or two sentences.

## Key facts
-

## People
-

## Projects
-

## Where things live
-

## Log
- {{date}}
`,
  Project: `---
type: project
status: active
client:
updated: {{date}}
aliases: []
---
# {{title}}

What it is, who it's for, and what done looks like.

## Current state
-

## Decisions
-

## Where things live
-

## Open threads
-

## Log
- {{date}}
`,
  Person: `---
type: person
org:
updated: {{date}}
aliases: []
---
# {{title}}

Role, and how the work with them goes.

## Working notes
-

## Log
- {{date}}
`,
  Tool: `---
type: tool
updated: {{date}}
aliases: []
---
# {{title}}

What it is and what it's used for.

## Used in
-

## Gotchas
-

## Log
- {{date}}
`,
};

const todo = (today: string) => `---
type: todo
updated: ${today}
---
# To-Do

Grouped by client. Format: \`- [ ] Task · due YYYY-MM-DD · waiting on Name · note · [[Linked note]]\`.
Leave out "waiting on" when it's on us. Finished items become \`- [x] … · done YYYY-MM-DD\` and move to **Done**.

## Done
`;

async function writeIfMissing(file: string, text: string) {
  await fs.writeFile(file, text, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

/** Creates the vault's folders, templates and to-do list; never overwrites an existing file. */
export async function seedVault(vault: string, today: string) {
  for (const folder of ['Clients', 'Projects', 'People', 'Tools', 'Sessions', 'Daily', '_templates'])
    await fs.mkdir(path.join(vault, folder), { recursive: true });
  for (const [name, text] of Object.entries(templates))
    await writeIfMissing(path.join(vault, '_templates', `${name}.md`), text);
  await writeIfMissing(path.join(vault, 'To-Do.md'), todo(today));
}

/** POSIX single-quoting; Claude Code runs hook commands through a POSIX shell (Git Bash on Windows). */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Runs the bundled capture script with Hatstand's own executable acting as Node. */
export function captureCommand(executable: string, script: string, vault: string, profile: string) {
  return `ELECTRON_RUN_AS_NODE=1 ${[executable, script].map(shellQuote).join(' ')} --vault ${shellQuote(vault)} --profile ${shellQuote(profile)}`;
}

const mentions = (group: unknown, text: string) =>
  JSON.stringify((group as { hooks?: unknown })?.hooks ?? '').includes(text);

/** The profile already runs its own capture.py hooks; Hatstand leaves those profiles alone. */
export function hasExternalCapture(settings: Record<string, unknown>) {
  return Object.values((settings.hooks ?? {}) as Record<string, unknown>).some(
    (groups) => Array.isArray(groups) && groups.some((g) => mentions(g, EXTERNAL)),
  );
}

/** Returns `settings` with Hatstand's capture hooks replaced by `command`'s, or removed when it is null. */
export function withBrainHooks(
  settings: Record<string, unknown>,
  command: string | null,
): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries((settings.hooks ?? {}) as Record<string, unknown>)) {
    const kept = Array.isArray(groups) ? groups.filter((g) => !mentions(g, OURS)) : groups;
    // Drop events that only held our hooks, so turning off leaves the file as it was.
    if (!Array.isArray(kept) || kept.length || !(groups as unknown[]).length) hooks[event] = kept;
  }
  if (command) {
    const add = (event: string, hook: Record<string, unknown>) => {
      hooks[event] = [...((hooks[event] as unknown[]) ?? []), { hooks: [{ type: 'command', ...hook }] }];
    };
    add('SessionStart', { command: `${command} --context`, timeout: 10 });
    add('Stop', { command, timeout: 30, async: true });
    add('SessionEnd', { command, timeout: 15 });
  }
  const next = { ...settings, hooks };
  if (!Object.keys(hooks).length && !('hooks' in settings)) delete (next as { hooks?: unknown }).hooks;
  return next;
}

export function brainBlock(vault: string, command: string) {
  return `${BLOCK_START}
# Second brain

This profile's notes vault is \`${vault}\`. It belongs to this Hatstand profile only; other profiles have their own. Hooks already log each Claude Code session to \`Sessions/\` (prompts, files written, skills and apps used), list the day's sessions in \`Daily/\`, and tell you at session start which topic notes exist. Your job is the part a script can't capture: what it means.

## Keep it current when something new comes up
| New thing | Where it goes |
|---|---|
| A client or company the user works for or with | \`Clients/<Name>.md\` |
| A build, campaign, deliverable stream or side project | \`Projects/<Name>.md\` (frontmatter \`client: "[[Client]]"\`) |
| A person the user works with | \`People/<Name>.md\` (\`org: "[[Client]]"\`) |
| A tool, app or service the user starts using, or a gotcha with one | \`Tools/<Name>.md\` |
| A status change, decision, deliverable sent, deadline, blocker or lesson | a dated bullet in the related note's \`## Log\` (newest first); update \`status:\` and \`## Current state\` if they changed |
| A task, follow-up, promise with a date, or something waiting on someone | a line in \`To-Do.md\` under that client |

- Before creating a note, check whether it exists. Create new ones from \`_templates/\` (Client, Project, Person, Tool), replacing \`{{title}}\` and \`{{date}}\`. Bump \`updated:\` when you change a note.
- Link with \`[[wikilinks]]\` by the note's exact name.
- Facts only, short bullets. Write when the thing happens or at the end of that piece of work, not for every message. Skip quick questions and chit-chat.

## Session summary
For sessions that produced something, run \`${command} --path\` to get this session's note and rewrite its \`## Summary\` as 2–5 bullets (outcome, decisions, open threads) linking the topic notes involved. Keep it current; don't stack duplicates. Never edit between \`<!-- auto:start -->\` and \`<!-- auto:end -->\`.

## Recall
When the user asks what they did, where something was left, who someone is or why something was decided, search the vault first (grep, then read the note) before answering from memory, and say which note each fact came from.

## Privacy
Never write passwords, keys, tokens or URLs containing them into the vault.
${BLOCK_END}`;
}

/** Replaces Hatstand's managed block in CLAUDE.md (or removes it when `block` is null); other text is kept. */
export function withBrainBlock(text: string, block: string | null): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END, start);
  if (start >= 0 && end >= 0) {
    const before = text.slice(0, start).replace(/\n+$/, '');
    const after = text.slice(end + BLOCK_END.length).replace(/^\n+/, '');
    const parts = [before, block, after].filter(Boolean);
    return parts.length ? `${parts.join('\n\n').replace(/\n+$/, '')}\n` : '';
  }
  if (!block) return text;
  return text.trim() ? `${text.replace(/\n+$/, '')}\n\n${block}\n` : `${block}\n`;
}
