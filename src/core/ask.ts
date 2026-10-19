import * as fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Links that open things in a profile's own Claude Desktop. Hatstand delivers them to that profile's
 * process (never through the OS, which would pick whichever Claude account it likes).
 */
const DESKTOP_SESSION = /^local_[A-Za-z0-9-]{1,64}$/;
const CLI_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Claude Desktop truncates longer prompts; keep well under it. */
export const ASK_LIMIT = 4000;

export function sessionLink(desktopSession: string) {
  if (!DESKTOP_SESSION.test(desktopSession)) throw new Error('Invalid session.');
  return `claude://code/continue?session=${desktopSession}`;
}

/** The question as Claude gets it: answer from the vault, citing notes so the answer links back. */
export function askPrompt(question: string) {
  const q = question.trim();
  if (!q) throw new Error('Type a question first.');
  if (q.length > ASK_LIMIT) throw new Error(`Keep the question under ${ASK_LIMIT} characters.`);
  return `${q}\n\nAnswer from my notes in this folder: use the hatstand-notes tools if you have them, otherwise search and read the Markdown files here. Cite each note you use as [[Note name]].`;
}

/** A new Claude Code session in `folder` with the prompt filled in. Percent-encoded only, as the helper requires. */
export function askLink(question: string, folder: string) {
  return `claude://code/new?q=${encodeURIComponent(askPrompt(question))}&folder=${encodeURIComponent(folder)}`;
}

/**
 * Finds the Claude Desktop session (local_…) that ran a Claude Code session, in one profile's Desktop data.
 * Desktop keeps `claude-code-sessions/<…>/<…>/local_<id>.json` with the Code session's `cliSessionId`.
 */
export async function findDesktopSession(desktop: string, cliSession: string): Promise<string | null> {
  if (!CLI_SESSION.test(cliSession)) return null;
  const root = path.join(desktop, 'claude-code-sessions');
  const entries = await fs.readdir(root, { recursive: true }).catch(() => [] as string[]);
  for (const entry of entries) {
    const base = path.basename(entry, '.json');
    if (!entry.endsWith('.json') || !DESKTOP_SESSION.test(base)) continue;
    const text = await fs.readFile(path.join(root, entry), 'utf8').catch(() => '');
    // A cheap check first: these files can be large.
    if (!text.includes(cliSession)) continue;
    try {
      if (JSON.parse(text).cliSessionId === cliSession) return base;
    } catch {}
  }
  return null;
}
