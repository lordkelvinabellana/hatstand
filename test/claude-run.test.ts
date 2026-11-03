import assert from 'node:assert/strict';
import type { spawn, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { claudeArgs, runClaude } from '../src/core/claude-run.ts';

test('claudeArgs resumes in print mode with JSON output', () => {
  assert.deepEqual(claudeArgs({ prompt: 'hello', resume: 'session' }), [
    '--resume',
    'session',
    '-p',
    'hello',
    '--output-format',
    'json',
  ]);
});

for (const scenario of ['success', 'exit', 'is_error', 'invalid', 'error', 'timeout']) {
  test(`runClaude handles ${scenario} with an injected spawner`, async (t) => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-claude-bin-'));
    const oldPath = process.env.PATH;
    t.after(async () => {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      await fs.rm(bin, { recursive: true, force: true });
    });
    const executable = path.join(bin, 'claude');
    await fs.writeFile(executable, '', { mode: 0o700 });
    process.env.PATH = bin;
    let killed = false;
    const opts = { prompt: 'hello', resume: 'session', cwd: bin, configDir: '/profile/code' };
    const spawner = ((command: string, args: string[], options: SpawnOptions) => {
      assert.equal(command, executable);
      assert.deepEqual(args, claudeArgs(opts));
      assert.equal(options.cwd, bin);
      assert.deepEqual(options.env, { ...process.env, CLAUDE_CONFIG_DIR: opts.configDir });
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: (signal: string) => {
          assert.equal(signal, 'SIGKILL');
          killed = true;
          return true;
        },
      });
      queueMicrotask(() => {
        if (scenario === 'timeout') return;
        if (scenario === 'error') {
          child.emit('error', new Error('spawn failed'));
          return;
        }
        child.stdout.write(
          scenario === 'invalid'
            ? 'broken'
            : JSON.stringify({
                type: 'result',
                subtype: 'success',
                is_error: scenario === 'is_error',
                result: 'Done.',
              }),
        );
        child.stderr.write('x'.repeat(5000) + 'failure tail');
        child.emit('close', scenario === 'exit' ? 1 : 0);
      });
      return child;
    }) as unknown as typeof spawn;
    const result = runClaude({ ...opts, timeoutMs: 20 }, spawner);
    if (scenario === 'success') assert.deepEqual(await result, { text: 'Done.' });
    else if (scenario === 'exit')
      await assert.rejects(
        result,
        (error: Error) => error.message.endsWith('failure tail') && error.message.length < 4200,
      );
    else
      await assert.rejects(
        result,
        scenario === 'is_error'
          ? /Done\./
          : scenario === 'error'
            ? /spawn failed/
            : scenario === 'timeout'
              ? /timed out/
              : SyntaxError,
      );
    assert.equal(killed, scenario === 'timeout');
  });
}
