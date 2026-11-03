import { spawn as defaultSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function claudeArgs(opts: { prompt: string; resume: string }): string[] {
  return ['--resume', opts.resume, '-p', opts.prompt, '--output-format', 'json'];
}

export async function runClaude(
  opts: { prompt: string; resume: string; cwd: string; configDir: string; timeoutMs?: number },
  spawner: typeof defaultSpawn = defaultSpawn,
): Promise<{ text: string }> {
  const candidates = [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const executable = candidates
    .map((dir) => path.join(dir, 'claude'))
    .find((file) => {
      try {
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (!executable) throw new Error('No claude binary found.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawner(executable, claudeArgs(opts), {
        cwd: opts.cwd,
        env: { ...process.env, CLAUDE_CONFIG_DIR: opts.configDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-4096);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`claude exited (${code}): ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (typeof result?.result !== 'string') throw new Error('Invalid claude result.');
          if (result.is_error) throw new Error(result.result);
          resolve({ text: result.result });
        } catch (error) {
          reject(error);
        }
      });
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`claude timed out after ${opts.timeoutMs ?? 600_000}ms: ${stderr}`));
      }, opts.timeoutMs ?? 600_000);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
