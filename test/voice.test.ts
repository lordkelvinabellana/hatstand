import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { findNode, speak } from '../src/core/voice.ts';

test('findNode searches PATH before extra directories and handles missing binaries', () => {
  assert.equal(
    findNode({ PATH: '/first:/second' }, ['/extra'], (file) =>
      ['/second/node', '/extra/node'].includes(file),
    ),
    '/second/node',
  );
  assert.equal(
    findNode({ PATH: '' }, [], () => false),
    undefined,
  );
});

function fakeSpawn(calls: { command: string; args: string[] }[], fail = false): typeof spawn {
  return ((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
    queueMicrotask(() => child.emit('close', fail && calls.length === 1 ? 1 : 0));
    return child;
  }) as unknown as typeof spawn;
}

test('speak passes model, output and capped text as arguments to plain Node', async () => {
  const calls: { command: string; args: string[] }[] = [];
  assert.equal(
    await speak('x'.repeat(601), '/tmp/voice.wav', fakeSpawn(calls), () => '/plain/node'),
    '/tmp/voice.wav',
  );
  assert.equal(calls[0].command, '/plain/node');
  assert.equal(calls[0].args[0], '-e');
  assert.match(calls[0].args[1], /new sherpa.OfflineTts/);
  assert.match(calls[0].args[2], /sherpa-onnx-node/);
  assert.match(calls[0].args[3], /voice-models\/kokoro-int8-en-v0_19$/);
  assert.deepEqual(calls[0].args.slice(4), ['/tmp/voice.wav', 'x'.repeat(600)]);
});

for (const missing of [true, false]) {
  test(`speak falls back to say on macOS (${missing ? 'missing Node' : 'child failure'})`, {
    skip: process.platform !== 'darwin',
  }, async () => {
    const calls: { command: string; args: string[] }[] = [];
    await speak('-hello', '/tmp/voice.wav', fakeSpawn(calls, !missing), () =>
      missing ? undefined : '/plain/node',
    );
    assert.deepEqual(calls.at(-1), {
      command: 'say',
      args: ['-o', '/tmp/voice.wav', '--data-format=LEI16@22050', '--', '-hello'],
    });
  });
}
