import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Second brain: one Markdown note per Claude Code session, written into the profile's own vault
 * by Claude Code hooks (Stop / SessionEnd), plus a daily index and a home index of topic notes.
 *
 * The capture owns each note's header and the block between the auto markers. Everything under
 * "## Summary" (and anything after the auto block) belongs to Claude and the user, and is kept.
 */
export const AUTO_START = '<!-- auto:start -->';
export const AUTO_END = '<!-- auto:end -->';
const SUMMARY_HINT = '_Claude fills this in when the session produced something worth remembering._\n\n';
export const TOPIC_FOLDERS = ['Clients', 'Projects', 'People', 'Tools'] as const;

export interface BrainOptions {
  vault: string;
  /** The Hatstand profile name; notes link to `[[<profile> account]]`. */
  profile: string;
}

const SECRETS =
  /sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const NAMED_SECRETS = /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi;
const DROP_BLOCKS =
  /<(system-reminder|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr)>[\s\S]*?<\/\1>/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EDIT_TOOLS: Record<string, string> = {
  Edit: 'edited',
  MultiEdit: 'edited',
  Write: 'wrote',
  NotebookEdit: 'edited',
};

/** Redacts random-looking keys (a 20+ char chunk mixing letters and digits); keeps slugs and UUIDs. */
function maskToken(token: string) {
  return token.split(/[-_]/).some((part) => part.length >= 20 && /\d/.test(part) && /[A-Za-z]/.test(part))
    ? '[redacted]'
    : token;
}

/** A prompt as one short line, with tool output dropped and secrets and emails redacted. */
export function promptText(content: unknown): string {
  if (Array.isArray(content))
    content = content
      .filter((b) => b && typeof b === 'object' && b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
  if (typeof content !== 'string') return '';
  let text = content
    .replace(DROP_BLOCKS, '')
    .replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, '(ran) $1')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1 ')
    .replace(/<\/?(command-message|command-args|pasted_content[^>]*)>/g, '')
    .replace(SECRETS, '[redacted]')
    .replace(NAMED_SECRETS, '[redacted]')
    .replace(/[A-Za-z0-9_-]{20,}/g, maskToken)
    .replace(EMAIL, '[email]');
  text = text.split(/\s+/).filter(Boolean).join(' ');
  const chars = [...text];
  return chars.length > 240 ? `${chars.slice(0, 240).join('')}…` : text;
}

export function shortPath(p: string | undefined, home = os.homedir()): string {
  if (!p) return '';
  const scratch = p.match(/\/scratch-workspaces\/(?:[^/]+\/){2}[^/]+\/?(.*)$/);
  if (scratch) return scratch[1] ? `(no folder)/${scratch[1]}` : '(no folder)';
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

interface Parsed {
  title: string | null;
  prompts: [string | undefined, string][];
  files: Map<string, string>;
  skills: Set<string>;
  apps: Set<string>;
  tools: number;
  first: string | null;
  last: string | null;
  cwd: string | null;
}

export function parseTranscript(text: string): Parsed {
  const s: Parsed = {
    title: null,
    prompts: [],
    files: new Map(),
    skills: new Set(),
    apps: new Set(),
    tools: 0,
    first: null,
    last: null,
    cwd: null,
  };
  for (const line of text.split('\n')) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object' || d.isSidechain) continue;
    const kind = d.type;
    const ts = d.timestamp;
    if (ts && (kind === 'user' || kind === 'assistant')) {
      s.first ??= ts;
      s.last = ts;
    }
    if (kind === 'custom-title' && d.customTitle) s.title = String(d.customTitle);
    else if (kind === 'user' && d.origin?.kind === 'human') {
      s.cwd ??= typeof d.cwd === 'string' ? d.cwd : null;
      const prompt = promptText(d.message?.content);
      if (prompt) s.prompts.push([ts, prompt]);
    } else if (kind === 'attachment') {
      const a = d.attachment ?? {};
      if (a.type === 'queued_command' && a.origin?.kind === 'human') {
        const prompt = promptText(a.prompt);
        if (prompt) s.prompts.push([a.timestamp ?? ts, prompt]);
      }
    } else if (kind === 'assistant') {
      for (const b of Array.isArray(d.message?.content) ? d.message.content : []) {
        if (b?.type !== 'tool_use') continue;
        const name: string = b.name ?? '';
        const input = b.input ?? {};
        s.tools++;
        if (name in EDIT_TOOLS) {
          const file = input.file_path ?? input.notebook_path;
          if (file && !s.files.has(file)) s.files.set(file, EDIT_TOOLS[name]);
        } else if (name === 'Skill' && input.skill) s.skills.add(input.skill);
        else if (name.startsWith('mcp__')) {
          const server = name.split('__')[1];
          if (!server.startsWith('ccd_') && !/^[0-9a-f]{8}-/.test(server)) s.apps.add(server);
        }
      }
    }
  }
  return s;
}

export function cleanName(text: string | null | undefined, limit = 60) {
  const cleaned = (text ?? '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  return cleaned.slice(0, limit).replace(/[ .-]+$/, '') || 'Untitled';
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** YAML-safe double-quoted string. */
const quoted = (value: string) => JSON.stringify(value);

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Unique per call: two hooks writing the same note at once must not share one temporary file.
  const temporary = `${file}.${process.pid}.${Date.now()}.hatstand-tmp`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
}
const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const markdownIn = (folder: string) => {
  try {
    return fs
      .readdirSync(folder)
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
};

/** The parts of an existing note that the capture never rewrites: the summary, and anything after the auto block. */
export function splitNote(text: string): { summary: string; tail: string } {
  const match = text.match(/^## Summary\n([\s\S]*?)(?=^<!-- auto:start -->)/m);
  const tail = text.includes(AUTO_END)
    ? text.split(AUTO_END).slice(1).join(AUTO_END).replace(/^\n+/, '')
    : '';
  return { summary: match ? match[1] : SUMMARY_HINT, tail };
}

function findNote(vault: string, short: string): string | undefined {
  const sessions = path.join(vault, 'Sessions');
  let months: string[] = [];
  try {
    months = fs.readdirSync(sessions);
  } catch {}
  for (const month of months.sort())
    for (const name of markdownIn(path.join(sessions, month)))
      if (name.endsWith(`(${short}).md`)) return path.join(sessions, month, name);
}

/** Writes (or refreshes) the session's note and the indexes; returns its path, or null for an empty session. */
export function sessionNote(options: BrainOptions, sessionId: string, transcript: string): string | null {
  const { vault, profile } = options;
  const s = parseTranscript(fs.readFileSync(transcript, 'utf8'));
  if (!s.prompts.length || !s.first || !s.last) return null;
  const start = new Date(s.first);
  const end = new Date(s.last);
  const day = dayOf(start);
  const short = sessionId.slice(0, 8);
  const title = s.title ?? [...s.prompts[0][1]].slice(0, 60).join('');
  const name = `${day} ${profile} – ${cleanName(title)} (${short}).md`;
  const target = path.join(vault, 'Sessions', day.slice(0, 7), name);

  const existing = findNote(vault, short);
  let oldText = '';
  if (existing) {
    oldText = read(existing);
    if (existing !== target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(existing, target);
    }
  }
  const { summary, tail } = splitNote(oldText);

  const folder = shortPath(s.cwd ?? undefined);
  const header =
    '---\n' +
    'type: session\n' +
    `profile: ${quoted(profile)}\n` +
    `date: ${day}\n` +
    `started: "${day} ${timeOf(start)}"\n` +
    `updated: "${dayOf(end)} ${timeOf(end)}"\n` +
    `folder: ${quoted(folder)}\n` +
    `prompts: ${s.prompts.length}\n` +
    `session: ${sessionId}\n` +
    'tags: [session]\n' +
    '---\n' +
    `# ${title}\n\n` +
    `[[${profile} account]] · [[${day}]]${folder ? ` · \`${folder}\`` : ''}\n\n`;

  const lines = [
    AUTO_START,
    '## Activity',
    `_${timeOf(start)}–${timeOf(end)} · ${s.prompts.length} prompts · ${s.tools} tool calls · logged automatically_`,
    '',
    '### What was asked',
  ];
  for (const [ts, text] of s.prompts) lines.push(ts ? `- ${timeOf(new Date(ts))} ${text}` : `- ${text}`);
  if (s.files.size) {
    lines.push('', '### Files Claude wrote or edited');
    for (const [file, verb] of [...s.files].slice(0, 60)) lines.push(`- ${verb} \`${shortPath(file)}\``);
  }
  if (s.skills.size || s.apps.size) {
    lines.push('', '### Skills and apps used');
    if (s.skills.size) lines.push(`- Skills: ${[...s.skills].sort().join(', ')}`);
    if (s.apps.size) lines.push(`- Apps: ${[...s.apps].sort().join(', ')}`);
  }
  lines.push(AUTO_END);

  write(target, `${header}## Summary\n${summary}${lines.join('\n')}\n${tail ? `\n${tail}` : ''}`);
  updateDaily(vault, day);
  ensureProfileNote(vault, profile);
  updateHome(vault);
  return target;
}

export function frontmatter(text: string): Record<string, string> {
  const head = text.split('---')[1];
  if (head === undefined) return {};
  const values: Record<string, string> = {};
  for (const [, key, value] of head.matchAll(/^(\w+):(.*)$/gm))
    values[key] = value.trim().replace(/^"|"$/g, '');
  return values;
}

/** Replaces the file's auto block, or appends one; text outside the markers is kept. */
export function setAutoBlock(file: string, block: string, fallbackHeader = '') {
  let text = fs.existsSync(file) ? read(file) : fallbackHeader;
  if (text.includes(AUTO_START) && text.includes(AUTO_END)) {
    const [before, ...rest] = text.split(AUTO_START);
    text = before + block + rest.join(AUTO_START).split(AUTO_END).slice(1).join(AUTO_END);
  } else text = `${text.replace(/\n+$/, '')}\n\n${block}\n`;
  write(file, text);
}

export function updateDaily(vault: string, day: string) {
  const folder = path.join(vault, 'Sessions', day.slice(0, 7));
  const byProfile = new Map<string, [Record<string, string>, string][]>();
  for (const name of markdownIn(folder).filter((n) => n.startsWith(`${day} `))) {
    const fm = frontmatter(read(path.join(folder, name)));
    const profile = fm.profile ?? '?';
    if (!byProfile.has(profile)) byProfile.set(profile, []);
    byProfile.get(profile)!.push([fm, name.slice(0, -3)]);
  }
  const lines = [AUTO_START, '## Claude sessions'];
  for (const profile of [...byProfile.keys()].sort()) {
    lines.push(`### [[${profile} account]]`);
    const notes = byProfile
      .get(profile)!
      .sort((a, b) => (a[0].started ?? '').localeCompare(b[0].started ?? ''));
    for (const [fm, stem] of notes) {
      const label = stem.replace(/^\S+ .+? – (.*) \(\w+\)$/, '$1');
      lines.push(
        `- [[${stem}|${label}]] · ${(fm.started ?? '').slice(11)}–${(fm.updated ?? '').slice(11)} · ${fm.prompts ?? '?'} prompts`,
      );
    }
  }
  lines.push(AUTO_END);
  const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  setAutoBlock(
    path.join(vault, 'Daily', `${day}.md`),
    lines.join('\n'),
    `# ${day} · ${weekday}\n\n## Notes\n\n`,
  );
}

function ensureProfileNote(vault: string, profile: string) {
  const file = path.join(vault, 'Profiles', `${profile} account.md`);
  if (!fs.existsSync(file))
    write(
      file,
      `---\ntype: profile\n---\n# ${profile} account\n\nHatstand account. Every session in it links here, ` +
        'so they all show up under **Backlinks**.\n\n## Notes\n\n',
    );
}

/** {folder: [name, status][]} for the notes Claude keeps up to date. */
export function topicNotes(vault: string): [string, [string, string][]][] {
  return TOPIC_FOLDERS.map((folder) => [
    folder,
    markdownIn(path.join(vault, folder)).map((name): [string, string] => [
      name.slice(0, -3),
      frontmatter(read(path.join(vault, folder, name))).status ?? '',
    ]),
  ]);
}

export function updateHome(vault: string) {
  const lines = [AUTO_START, '## Index', '_Updated automatically from the topic folders._', ''];
  for (const [folder, items] of topicNotes(vault))
    if (items.length) {
      const links = items
        .map(([name, status]) => `[[${name}]]${status && status !== 'active' ? ` _(${status})_` : ''}`)
        .join(' · ');
      lines.push(`**${folder}:** ${links}`, '');
    }
  lines.push(AUTO_END);
  setAutoBlock(path.join(vault, 'Home.md'), lines.join('\n'), '# Second Brain\n');
}

/** What the SessionStart hook tells Claude: where the vault is and which topic notes exist. */
export function sessionContext(vault: string) {
  const listing =
    topicNotes(vault)
      .filter(([, items]) => items.length)
      .map(([folder, items]) => `- ${folder}: ${items.map(([name]) => name).join(', ')}`)
      .join('\n') || '- (none yet)';
  return (
    `Second brain vault: ${vault}. Topic notes that already exist:\n${listing}\n` +
    'When one of these comes up and something new happens (status, decision, deliverable, contact, ' +
    'lesson), update its note. When a new client, project, person or tool comes up, create its note ' +
    "from the vault's _templates/ folder. Full rules are in CLAUDE.md under 'Second brain'."
  ).slice(0, 6000);
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function transcripts(sessionId = '*'): string[] {
  const projects = path.join(configDir(), 'projects');
  let folders: string[] = [];
  try {
    folders = fs.readdirSync(projects);
  } catch {}
  const found: string[] = [];
  for (const folder of folders) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(projects, folder));
    } catch {}
    for (const name of names)
      if (name.endsWith('.jsonl') && (sessionId === '*' || name === `${sessionId}.jsonl`))
        found.push(path.join(projects, folder, name));
  }
  return found;
}
function transcriptFor(sessionId: string) {
  return transcripts(sessionId).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/**
 * Copies the vault into `dest` (a backup, e.g. inside an Obsidian folder): new and changed files only,
 * hidden files skipped, nothing in `dest` ever deleted. Returns how many files were copied.
 */
export function backupVault(vault: string, dest: string): number {
  let copied = 0;
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(vault, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.endsWith('-tmp') || entry.isSymbolicLink()) continue;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        const from = path.join(vault, child);
        const to = path.join(dest, child);
        const a = fs.statSync(from);
        const b = fs.statSync(to, { throwIfNoEntry: false });
        // Copied times can lose sub-millisecond precision, hence the 1 ms slack.
        if (b && b.size === a.size && b.mtimeMs + 1 >= a.mtimeMs) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        fs.utimesSync(to, a.atime, a.mtime);
        copied++;
      }
    }
  };
  walk('');
  return copied;
}

/** The capture command line: hook mode, `--context`, `--path` or `--backfill`. Never throws in hook mode. */
export function runCapture(args: string[], stdin: () => string, print: (text: string) => void) {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const vault = value('--vault');
  if (!vault) {
    print(
      'Usage: capture --vault <folder> [--profile <name>] [--backup <folder>] [--context | --path | --backfill]',
    );
    return;
  }
  // Cleaned once so file names and [[links]] agree.
  const options: BrainOptions = { vault, profile: cleanName(value('--profile') || 'Claude', 80) };
  if (args.includes('--context')) {
    try {
      updateHome(vault);
      print(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: sessionContext(vault) },
        }),
      );
    } catch {}
    return;
  }
  if (args.includes('--backfill')) {
    let done = 0;
    for (const t of transcripts()) if (sessionNote(options, path.basename(t, '.jsonl'), t)) done++;
    print(`${options.profile}: ${done} session notes`);
    return;
  }
  if (args.includes('--path')) {
    const id = process.env.CLAUDE_CODE_SESSION_ID ?? '';
    const t = id ? transcriptFor(id) : undefined;
    print((t && sessionNote(options, id, t)) || 'No note yet: this session has no logged prompts.');
    return;
  }
  try {
    const hook = JSON.parse(stdin());
    const t = hook?.transcript_path;
    if (typeof t === 'string' && fs.existsSync(t))
      sessionNote(
        options,
        typeof hook.session_id === 'string' ? hook.session_id : path.basename(t, '.jsonl'),
        t,
      );
    const backup = value('--backup');
    if (backup && path.isAbsolute(backup)) backupVault(vault, backup);
  } catch (error) {
    // A logging failure must never disturb the session.
    try {
      fs.mkdirSync(vault, { recursive: true });
      fs.appendFileSync(
        path.join(vault, '.capture-errors.log'),
        `${new Date().toISOString()} ${(error as Error)?.name}: ${(error as Error)?.message}\n`,
      );
    } catch {}
  }
}
