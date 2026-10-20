import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const locks = new Map<string, Promise<unknown>>();

/**
 * Runs `task` with exclusive use of `file` within this process. Read-modify-write code (the pets' hooks, the
 * second brain's hooks, Remove Hatstand's changes) all edit a profile's Claude Code settings.json; without one
 * queue per file, one writer can overwrite the other's change.
 */
export function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(file);
  const run = (locks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

// Windows refuses a rename while another process (an antivirus scan, an indexer, Claude itself) briefly has the
// target open. Those clear within moments, so the rename is retried before giving up.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Replaces `file` with `text` via a uniquely named temporary file, so a reader never sees half a file. */
export async function writeFileAtomic(file: string, text: string, attempts = 8) {
  const temporary = `${file}.${randomUUID()}.hatstand-tmp`;
  try {
    await fs.writeFile(temporary, text);
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(temporary, file);
        return;
      } catch (error) {
        if (attempt >= attempts || !BUSY.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
