import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { codexArgs, parseCodexLine, runCodex } from '../src/core/codex-run.ts';

test('codexArgs builds fresh exec arguments', () => {
  assert.deepEqual(codexArgs({ prompt: '-hello', outFile: '/tmp/out' }), [
    'exec',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '--json',
    '-o',
    '/tmp/out',
    '--',
    '-hello',
  ]);
});
test('codexArgs keeps exec sandbox before resume and encodes MCP as TOML', () => {
  assert.deepEqual(
    codexArgs({
      prompt: 'hello',
      outFile: '/tmp/out',
      resume: 'session',
      mcp: { command: '/a b/node', args: ['a"b', 'c\\d'], env: { 'odd.key': 'a\nb' } },
    }),
    [
      'exec',
      '--skip-git-repo-check',
      '-s',
      'read-only',
      'resume',
      'session',
      '--json',
      '-o',
      '/tmp/out',
      '-c',
      'mcp_servers.hatstand={ command = "/a b/node", args = ["a\\"b", "c\\\\d"], env = { "odd.key" = "a\\nb" } }',
      '--',
      'hello',
    ],
  );
});
test('parseCodexLine selects only thread started events', () => {
  assert.deepEqual(parseCodexLine('{"type":"thread.started","thread_id":"abc"}'), { sessionId: 'abc' });
  for (const line of [
    'not JSON',
    '{"type":"turn.completed"}',
    'null',
    '{"type":"thread.started","thread_id":1}',
  ])
    assert.equal(parseCodexLine(line), undefined);
});

for (const code of [0, 1]) {
  test(`runCodex handles exit ${code} and removes output`, async (t) => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-codex-bin-'));
    const oldPath = process.env.PATH;
    t.after(async () => {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      await fs.rm(bin, { recursive: true, force: true });
    });
    await fs.writeFile(path.join(bin, 'codex'), '', { mode: 0o700 });
    process.env.PATH = bin;
    let output = '';
    const spawner = ((command: string, args: string[], options: { cwd: string }) => {
      assert.match(command, /[\\/]codex$/);
      assert.equal(options.cwd, os.homedir());
      output = args[args.indexOf('-o') + 1];
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true,
      });
      void fs.writeFile(output, 'answer').then(() => {
        child.stdout.end('{"type":"thread.started","thread_id":"abc"}\n');
        child.stderr.end('x'.repeat(5000) + 'failure tail');
        child.emit('close', code);
      });
      return child;
    }) as unknown as typeof spawn;
    if (code === 0)
      assert.deepEqual(await runCodex({ prompt: 'hello' }, spawner), { text: 'answer', sessionId: 'abc' });
    else
      await assert.rejects(
        runCodex({ prompt: 'hello' }, spawner),
        (error: Error) => error.message.endsWith('failure tail') && error.message.length < 4200,
      );
    await assert.rejects(fs.access(output), { code: 'ENOENT' });
  });
}

test('codexArgs approves the listed MCP tools up front', () => {
  const args = codexArgs({ prompt: 'p', outFile: 'o', mcp: { command: 'c', args: [], approve: ['a'] } });
  assert.match(args.join(' '), /tools = \{ "a" = \{ approval_mode = "approve" \} \}/);
});
