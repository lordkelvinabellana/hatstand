import { spawn as defaultSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

interface CodexOptions {
  prompt: string;
  outFile: string;
  mcp?: { command: string; args: string[]; env?: Record<string, string>; approve?: string[] };
  resume?: string;
}
// JSON string escaping is also valid TOML basic-string escaping.
const quote = (value: string) =>
  JSON.stringify(value).replace(/\\u([0-9a-f]{4})/g, (_, code: string) => `\\u${code.toUpperCase()}`);
export function codexArgs(opts: CodexOptions): string[] {
  // The sandbox flag belongs to exec, not its resume subcommand.
  const args = ['exec', '--skip-git-repo-check', '-s', 'read-only'];
  if (opts.resume) args.push('resume', opts.resume);
  args.push('--json', '-o', opts.outFile);
  if (opts.mcp) {
    const m = opts.mcp;
    const env = m.env
      ? `, env = { ${Object.entries(m.env)
          .map(([key, value]) => `${quote(key)} = ${quote(value)}`)
          .join(', ')} }`
      : '';
    // `codex exec` cannot ask, so tools it may call unattended are approved up front.
    const tools = m.approve?.length
      ? `, tools = { ${m.approve.map((name) => `${quote(name)} = { approval_mode = "approve" }`).join(', ')} }`
      : '';
    args.push(
      '-c',
      `mcp_servers.hatstand={ command = ${quote(m.command)}, args = [${m.args.map(quote).join(', ')}]${env}${tools} }`,
    );
  }
  return [...args, '--', opts.prompt];
}

export function parseCodexLine(line: string): { sessionId?: string } | undefined {
  try {
    const event = JSON.parse(line);
    if (event?.type === 'thread.started' && typeof event.thread_id === 'string')
      return { sessionId: event.thread_id };
  } catch {
    /* Ignore non-event output. */
  }
  return undefined;
}

export async function runCodex(
  opts: Omit<CodexOptions, 'outFile'> & { cwd?: string; timeoutMs?: number },
  spawner: typeof defaultSpawn = defaultSpawn,
): Promise<{ text: string; sessionId?: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-codex-'));
  const outFile = path.join(directory, 'last-message.txt');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const candidates = [
      ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
      path.join(os.homedir(), '.local/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
    const executable = candidates
      .map((dir) => path.join(dir, 'codex'))
      .find((file) => {
        try {
          accessSync(file, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    if (!executable) throw new Error('No codex binary found.');
    let sessionId = opts.resume;
    await new Promise<void>((resolve, reject) => {
      const child = spawner(executable, codexArgs({ ...opts, outFile }), {
        cwd: opts.cwd ?? os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      const lines = createInterface({ input: child.stdout! });
      lines.on('line', (line) => {
        sessionId = parseCodexLine(line)?.sessionId ?? sessionId;
      });
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-4096);
      });
      child.once('error', (error) => {
        lines.close();
        reject(error);
      });
      child.once('close', (code) => {
        lines.close();
        if (timer) clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`codex exited (${code}): ${stderr}`));
      });
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        lines.close();
        reject(new Error(`codex timed out after ${opts.timeoutMs ?? 300_000}ms: ${stderr}`));
      }, opts.timeoutMs ?? 300_000);
    });
    return { text: await fs.readFile(outFile, 'utf8'), sessionId };
  } finally {
    if (timer) clearTimeout(timer);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
