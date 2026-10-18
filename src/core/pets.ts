import { crc32, deflateSync } from 'node:zlib';
import { type Mood, type RGBA, speciesNames } from './sprites.ts';

export { drawPet, type Mood, speciesNames } from './sprites.ts';

/**
 * Menu-bar pets: one pixel pet per profile that shows what that account's Claude Code
 * sessions are doing. Claude Code hooks (pet-hook.sh) write one small JSON file per
 * session into `<profile>/pet/`; Hatstand reads them, draws the pet and plays a sound.
 */
export interface SessionState {
  state: 'working' | 'ask' | 'done';
  at: number;
  /** The session's Claude Code transcript (.jsonl), read for the hover panel. */
  transcript?: string;
  /** The desktop app's id for the session (local_…), used to open it. */
  host?: string;
}

const minute = 60_000;
// shortcut: a session that stops sending hook events (crash, force quit) is dropped after
// these ages; raise them if long tool-free thinking ever shows the pet idle too early.
const maxAge = { working: 20 * minute, ask: 12 * 60 * minute, done: 12 * 60 * minute };

export function petMood(running: boolean, sessions: SessionState[], now: number): Mood {
  const live = sessions.filter((s) => maxAge[s.state] && now - s.at < maxAge[s.state]);
  for (const state of ['ask', 'done', 'working'] as const)
    if (live.some((s) => s.state === state)) return state;
  return running ? 'idle' : 'sleep';
}

export function parseSession(text: string): SessionState | null {
  try {
    const value = JSON.parse(text);
    if (['working', 'ask', 'done'].includes(value?.state) && Number.isFinite(value?.at)) return value;
  } catch {}
  return null;
}

export interface PlanStep {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
export interface SessionSummary {
  title: string;
  prompt: string;
  cwd: string;
  model: string;
  plan: PlanStep[];
  /** Tokens in the latest request: the session's current context size. */
  context: number;
  output: number;
  /** The last turn ended on a question for you (the desktop app's wrap-up with an ask). */
  asking: boolean;
  /** Background commands and agents started but not yet reported finished. */
  background: number;
}

/** Reads what the hover panel shows out of a Claude Code transcript (.jsonl). */
export function summarizeTranscript(text: string): SessionSummary {
  const summary: SessionSummary = {
    title: '',
    prompt: '',
    cwd: '',
    model: '',
    plan: [],
    context: 0,
    output: 0,
    asking: false,
    background: 0,
  };
  const counted = new Set<string>();
  const running = new Set<string>();
  const finished = new Set<string>();
  for (const line of text.split('\n')) {
    // A background task ends with a <task-notification> naming its tool call and status.
    for (const match of line.matchAll(/<tool-use-id>([\w-]+)<\/tool-use-id>.*?<status>(\w+)<\/status>/g))
      if (match[2] !== 'running') finished.add(match[1]);
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.isSidechain) continue;
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string')
      summary.title = entry.customTitle;
    if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string')
      summary.prompt = entry.lastPrompt;
    for (const block of entry.type === 'user' && Array.isArray(entry.message?.content)
      ? entry.message.content
      : [])
      if (
        block?.type === 'tool_result' &&
        // Claude Code's own wording at the start of the result, so output that merely mentions it doesn't count.
        /^(Command running in background with ID:|Command did not complete within .*moved to the background \(ID:)/.test(
          typeof block.content === 'string' ? block.content : (block.content?.[0]?.text ?? ''),
        )
      )
        running.add(block.tool_use_id);
    if (
      entry.type === 'user' &&
      typeof entry.message?.content === 'string' &&
      !entry.message.content.startsWith('<')
    ) {
      summary.prompt = entry.message.content;
      summary.asking = false;
    }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const message = entry.message;
    if (typeof entry.cwd === 'string') summary.cwd = entry.cwd;
    if (typeof message.model === 'string') summary.model = message.model;
    const usage = message.usage;
    // One API response is split over several lines that repeat the same usage.
    if (usage && !counted.has(message.id)) {
      counted.add(message.id);
      summary.output += usage.output_tokens ?? 0;
      summary.context =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_use') continue;
      if (
        block.input?.run_in_background === true ||
        (block.name === 'Agent' && block.input?.run_in_background !== false)
      )
        running.add(block.id);
      if (typeof block.name === 'string' && block.name.endsWith('wrap_up'))
        summary.asking = !!block.input?.ask;
      if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos))
        summary.plan = steps(block.input.todos);
      if (typeof block.name === 'string' && block.name.endsWith('update_plan'))
        applyPlan(summary.plan, block.input, summary);
    }
  }
  summary.background = [...running].filter((id) => !finished.has(id)).length;
  return summary;
}
function steps(items: unknown[]): PlanStep[] {
  return items.map((item: any) => ({
    content: String(item?.content ?? ''),
    status: ['pending', 'in_progress', 'completed'].includes(item?.status) ? item.status : 'pending',
  }));
}
/** Replays the desktop app's task-list updates: a whole list, `advance`, or `done`/`start` by 1-based step. */
function applyPlan(plan: PlanStep[], input: any, summary: SessionSummary) {
  if (Array.isArray(input?.items)) {
    summary.plan = steps(input.items);
    return;
  }
  const at = (n: unknown) => (Number.isInteger(n) ? plan[(n as number) - 1] : undefined);
  if (input?.advance) {
    const current = plan.find((s) => s.status === 'in_progress');
    if (current) current.status = 'completed';
    const next = plan.find((s) => s.status === 'pending');
    if (next) next.status = 'in_progress';
  }
  for (const n of Array.isArray(input?.done) ? input.done : []) {
    const step = at(n);
    if (step) step.status = 'completed';
  }
  const start = at(input?.start);
  if (start) start.status = 'in_progress';
}

/** A finished turn only counts as done when its whole task list and its background tasks are finished. */
export function settledState(session: SessionState, summary?: SessionSummary): SessionState['state'] {
  if (session.state !== 'done' || !summary) return session.state;
  if (summary.background) return 'working';
  if (summary.asking) return 'ask';
  return summary.plan.some((step) => step.status !== 'completed') ? 'working' : 'done';
}

/** "claude-opus-5-5" → "Opus 5.5". */
export function modelName(id: string): string {
  const parts = id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-');
  const name = parts.filter((p) => !/^\d+$/.test(p)).map((p) => p[0].toUpperCase() + p.slice(1));
  return [...name, parts.filter((p) => /^\d+$/.test(p)).join('.')].filter(Boolean).join(' ');
}

/** Encodes an RGBA grid as a PNG, scaled up by `scale` with hard pixel edges. */
export function encodePng(grid: RGBA[][], scale: number): Buffer {
  const height = grid.length * scale;
  const width = grid[0].length * scale;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = grid[Math.floor(y / scale)];
    for (let x = 0; x < width; x++) raw.set(row[Math.floor(x / scale)], y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A short square-wave jingle as a 16-bit mono WAV. Each species sings in its own key,
 * so you can tell by ear which account wants you.
 */
export function petSound(kind: 'ask' | 'done', speciesIndex: number): Buffer {
  const rate = 22050;
  const transpose = [0, 3, 5, -2, 2, 7, -4, 4][speciesIndex % 8];
  // [semitones above A4, seconds]; null is a rest.
  const notes: [number | null, number][] =
    kind === 'ask'
      ? [
          [7, 0.07],
          [12, 0.11],
          [null, 0.08],
          [7, 0.07],
          [12, 0.14],
        ]
      : [
          [3, 0.06],
          [7, 0.06],
          [10, 0.06],
          [15, 0.2],
        ];
  const samples: number[] = [];
  for (const [note, seconds] of notes) {
    const count = Math.round(seconds * rate);
    const frequency = note === null ? 0 : 440 * 2 ** ((note + transpose) / 12);
    for (let i = 0; i < count; i++) {
      if (!frequency) {
        samples.push(0);
        continue;
      }
      const t = i / rate;
      const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 9);
      samples.push((t * frequency) % 1 < 0.5 ? envelope : -envelope);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries()) data.writeInt16LE(Math.round(s * 0.22 * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Records the session's state where Hatstand watches: `<profile>/pet/<session>.json`. */
export const hookScript = `#!/bin/sh
# Hatstand menu-bar pet hook (written by Hatstand). Usage: pet-hook.sh working|ask|done|end
[ -n "$CLAUDE_CONFIG_DIR" ] || exit 0
input=$(cat)
sid=$(printf '%s' "$input" | grep -o '"session_id" *: *"[^"]*"' | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
case "$sid" in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac
log=$(printf '%s' "$input" | grep -o '"transcript_path" *: *"[^"]*"' | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
host=$CLAUDE_CODE_HOST_SESSION_ID
case "$host" in local_*) case "$host" in *[!A-Za-z0-9_-]*) host= ;; esac ;; *) host= ;; esac
case "$log" in *\\\\*) log= ;; *.jsonl) ;; *) log= ;; esac
dir="$(dirname "$CLAUDE_CONFIG_DIR")/pet"
mkdir -p "$dir" || exit 0
if [ "$1" = end ]; then rm -f "$dir/$sid.json"; exit 0; fi
printf '{"state":"%s","at":%s000,"transcript":"%s","host":"%s"}\\n' "$1" "$(date +%s)" "$log" "$host" > "$dir/$sid.tmp" && mv -f "$dir/$sid.tmp" "$dir/$sid.json"
`;

/** Returns `settings` with the pet hooks added (replacing any earlier pet hooks), leaving other hooks alone. */
export function withPetHooks(settings: Record<string, unknown>, script: string): Record<string, unknown> {
  const run = (state: string) => ({
    type: 'command',
    command: `/bin/sh "${script}" ${state}`,
    timeout: 5,
    async: true,
  });
  const wanted: [string, string | undefined, string][] = [
    ['UserPromptSubmit', undefined, 'working'],
    ['PostToolUse', undefined, 'working'],
    ['PreToolUse', 'AskUserQuestion|ExitPlanMode', 'ask'],
    ['PermissionRequest', undefined, 'ask'],
    ['Notification', 'permission_prompt|elicitation_dialog', 'ask'],
    ['Stop', undefined, 'done'],
    ['SessionEnd', undefined, 'end'],
  ];
  const isPet = (group: unknown) =>
    JSON.stringify((group as { hooks?: unknown })?.hooks ?? '').includes('pet-hook.sh');
  const hooks: Record<string, unknown[]> = {};
  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  for (const [event, groups] of Object.entries(existing))
    hooks[event] = Array.isArray(groups) ? groups.filter((g) => !isPet(g)) : groups;
  for (const [event, matcher, state] of wanted) {
    hooks[event] ??= [];
    hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [run(state)] });
  }
  return { ...settings, hooks };
}
