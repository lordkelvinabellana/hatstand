import * as fs from 'node:fs/promises';
import { writeFileAtomic } from './files.ts';
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

export const TEMPLATE_NAMES = ['Client', 'Project', 'Person', 'Tool', 'To-Do format'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Built-in `_templates/` files; the user can edit them in Hatstand and restore these. */
export const defaultTemplates: Record<TemplateName, string> = {
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
  'To-Do format': `# To-Do format

How \`To-Do.md\` is kept. One \`##\` section per client, then **Done** at the bottom.

Each task is one line:
\`- [ ] Task · due YYYY-MM-DD · waiting on Name · note · [[Linked note]]\`

- Leave out "waiting on" when it's on us, and "due" when there's no date.
- Finished items become \`- [x] … · done YYYY-MM-DD\` and move to **Done**.
`,
};

export const todo = (today: string) => `---
type: todo
updated: ${today}
---
# To-Do

Format: \`_templates/To-Do format.md\`.

## Done
`;

const SEEDED_FOLDERS = ['Clients', 'Projects', 'People', 'Tools', 'Sessions', 'Daily', '_templates'];
const seededFiles = () => [
  ...TEMPLATE_NAMES.map((name) => path.join('_templates', `${name}.md`)),
  'To-Do.md',
];

async function writeIfMissing(file: string, text: string) {
  await fs.writeFile(file, text, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
}

/** Creates the vault's folders, templates and to-do list; never overwrites an existing file. */
export async function seedVault(vault: string, today: string) {
  for (const folder of SEEDED_FOLDERS) await fs.mkdir(path.join(vault, folder), { recursive: true });
  for (const [name, text] of Object.entries(defaultTemplates))
    await writeIfMissing(path.join(vault, '_templates', `${name}.md`), text);
  await writeIfMissing(path.join(vault, 'To-Do.md'), todo(today));
}

export interface VaultInfo {
  /** Markdown notes already in the folder (hidden folders skipped). */
  notes: number;
  /** Has an `.obsidian/` settings folder. */
  obsidian: boolean;
  /** Has any entry besides OS clutter. */
  used: boolean;
  /** What turning the second brain on would add (folders and files, relative); nothing existing is changed. */
  adds: string[];
}

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

/** Looks at a folder before it becomes a vault. A missing folder is an empty one. */
export async function inspectVault(folder: string): Promise<VaultInfo> {
  const entries = await fs.readdir(folder, { recursive: true }).catch((error) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw new Error(`Hatstand can’t read everything in that folder (${error.code ?? error.message}).`);
  });
  const visible = entries.filter((entry) => !entry.split(path.sep).some((part) => part.startsWith('.')));
  const adds: string[] = [];
  for (const entry of [...SEEDED_FOLDERS.map((f) => `${f}/`), ...seededFiles()])
    if (!(await exists(path.join(folder, entry)))) adds.push(entry.split(path.sep).join('/'));
  return {
    notes: visible.filter((entry) => entry.endsWith('.md')).length,
    obsidian: entries.includes('.obsidian'),
    used: entries.some((entry) => !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(entry)),
    adds,
  };
}

const comparable = (folder: string) =>
  // Default file systems on macOS and Windows ignore case; a false match only refuses a folder.
  path
    .resolve(folder)
    .toLowerCase()
    .replace(/[\\/]+$/, '') + path.sep;

/** True when one folder is, contains, or sits inside the other. */
export const vaultsOverlap = (a: string, b: string) =>
  comparable(a).startsWith(comparable(b)) || comparable(b).startsWith(comparable(a));

/** Copies notes into another vault, skipping any file that already exists there. The source is left as it was. */
export async function copyVault(from: string, to: string) {
  await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false });
}

const templateFile = (vault: string, name: TemplateName) => path.join(vault, '_templates', `${name}.md`);

export function assertTemplateName(name: unknown): asserts name is TemplateName {
  if (!TEMPLATE_NAMES.includes(name as TemplateName)) throw new Error('Unknown template.');
}

/** The template's text (the built-in default when the vault has none yet) and whether it was edited. */
export async function readTemplate(vault: string, name: TemplateName) {
  const text = await fs.readFile(templateFile(vault, name), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return defaultTemplates[name];
    throw error;
  });
  return { text, edited: text !== defaultTemplates[name] };
}

/** Writes a template; `null` restores the built-in default. */
export async function saveTemplate(vault: string, name: TemplateName, text: string | null) {
  const file = templateFile(vault, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, text ?? defaultTemplates[name]);
}

/** POSIX single-quoting; Claude Code runs hook commands through a POSIX shell (Git Bash on Windows). */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Runs the bundled capture script with Hatstand's own executable acting as Node. */
export function captureCommand(
  executable: string,
  script: string,
  vault: string,
  profile: string,
  /** Where the vault is copied after each capture (the backup folder); omitted when there's none. */
  backup = '',
) {
  const base = `ELECTRON_RUN_AS_NODE=1 ${[executable, script].map(shellQuote).join(' ')} --vault ${shellQuote(vault)} --profile ${shellQuote(profile)}`;
  return backup ? `${base} --backup ${shellQuote(backup)}` : base;
}

/** The `hatstand-notes` MCP server entry for a profile's Claude Code and Claude Desktop configs. */
export function recallEntry(executable: string, script: string, vault: string) {
  return { command: executable, args: [script, '--vault', vault], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** Returns `config` with Hatstand's MCP server set to `entry`, or removed when it is null; other servers are kept. */
export function withRecallServer(
  config: Record<string, unknown>,
  name: string,
  entry: Record<string, unknown> | null,
): Record<string, unknown> {
  const servers = { ...((config.mcpServers ?? {}) as Record<string, unknown>) };
  if (entry) servers[name] = entry;
  else delete servers[name];
  const next = { ...config, mcpServers: servers };
  // Turning off leaves no empty `mcpServers` behind.
  if (!entry && !Object.keys(servers).length) delete (next as { mcpServers?: unknown }).mcpServers;
  return next;
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
| A task, follow-up, promise with a date, or something waiting on someone | a line in \`To-Do.md\` under that client, in the format in \`_templates/To-Do format.md\` |

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
