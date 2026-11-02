import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleOperator, OPERATOR_SERVER, type OperatorBridge } from '../src/core/operator.ts';
import { operatorCall, serveOperator } from '../src/core/operator-server.ts';

const call = async (bridge: OperatorBridge, name: string, args: Record<string, unknown>) => {
  const answer = (await handleOperator(bridge, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })) as { result: { content: { text: string }[]; isError?: boolean } };
  return answer.result;
};

test('operator server: initialize, list tools, ping and notifications', async () => {
  const bridge: OperatorBridge = async () => '';
  const init = (await handleOperator(bridge, {
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  })) as { result: { protocolVersion: string; serverInfo: { name: string } } };
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, OPERATOR_SERVER);
  assert.equal(await handleOperator(bridge, { method: 'notifications/initialized' }), null);
  assert.deepEqual(await handleOperator(bridge, { id: 2, method: 'ping' }), {
    jsonrpc: '2.0',
    id: 2,
    result: {},
  });
  const list = (await handleOperator(bridge, { id: 1, method: 'tools/list' })) as {
    result: { tools: { name: string }[] };
  };
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['list_profiles', 'list_sessions', 'start_session', 'search_notes', 'read_note', 'save_note'],
  );
  const unknown = (await handleOperator(bridge, { id: 2, method: 'resources/list' })) as {
    error: { code: number };
  };
  assert.equal(unknown.error.code, -32601);
});

test('operator tools validate and trim arguments before calling the bridge', async () => {
  const calls: unknown[] = [];
  const bridge: OperatorBridge = async (tool, args) => {
    calls.push([tool, args]);
    return 'done';
  };
  assert.equal(
    (await call(bridge, 'start_session', { profile: ' Work ', prompt: ' Do this ', folder: ' /work ' }))
      .content[0].text,
    'done',
  );
  await call(bridge, 'list_sessions', { profile: ' Work ' });
  await call(bridge, 'list_profiles', {});
  await call(bridge, 'start_session', { profile: 'Work', prompt: 'Do this' });
  assert.deepEqual(calls, [
    ['start_session', { profile: 'Work', prompt: 'Do this', folder: '/work' }],
    ['list_sessions', { profile: 'Work' }],
    ['list_profiles', {}],
    ['start_session', { profile: 'Work', prompt: 'Do this' }],
  ]);
  for (const [tool, args] of [
    ['list_sessions', {}],
    ['list_sessions', { profile: ' ' }],
    ['start_session', { profile: 'Work' }],
    ['start_session', { profile: '', prompt: 'x' }],
    ['start_session', { profile: 'Work', prompt: ' ' }],
    ['start_session', { profile: 'Work', prompt: 'x'.repeat(4001) }],
    ...['', 'relative', `/${'x'.repeat(1000)}`, 42].map((folder) => [
      'start_session',
      { profile: 'Work', prompt: 'x', folder },
    ]),
    ['unknown', {}],
  ] as [string, Record<string, unknown>][]) {
    assert.equal((await call(bridge, tool, args)).isError, true);
  }
  assert.equal(calls.length, 4);
  const failed = await call(
    async () => {
      throw new Error('Unavailable');
    },
    'list_profiles',
    {},
  );
  assert.equal(failed.isError, true);
  assert.equal(failed.content[0].text, 'Unavailable');
});

test('operator socket round trip and action errors', {
  skip: process.platform === 'win32' && 'Unix sockets only',
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-op-'));
  const socket = path.join(root, 'operator.sock');
  try {
    await fs.writeFile(socket, 'stale');
    const server = await serveOperator(socket, {
      notes: async () => '',
      profiles: async () => 'Work',
      sessions: async (profile) => `${profile}: live`,
      start: async (profile, prompt, folder) => `${profile}: ${prompt} in ${folder}`,
    });
    try {
      assert.equal((await fs.stat(socket)).mode & 0o777, 0o600);
      assert.equal(await operatorCall(socket, 'list_profiles', {}), 'Work');
      assert.equal(await operatorCall(socket, 'list_sessions', { profile: 'Work' }), 'Work: live');
      assert.equal(
        await operatorCall(socket, 'start_session', { profile: 'Work', prompt: 'Read', folder: '/work' }),
        'Work: Read in /work',
      );
      await assert.rejects(operatorCall(socket, 'unknown', {}), /Unknown tool/);
    } finally {
      await server.close();
    }
    const failing = await serveOperator(socket, {
      notes: async () => '',
      profiles: async () => {
        throw new Error('Action failed');
      },
      sessions: async () => '',
      start: async () => '',
    });
    try {
      await assert.rejects(operatorCall(socket, 'list_profiles', {}), { message: 'Action failed' });
    } finally {
      await failing.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("missing operator socket rejects with Hatstand isn't running", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-op-'));
  try {
    await assert.rejects(operatorCall(path.join(root, 'missing.sock'), 'list_profiles', {}), {
      message: "Hatstand isn't running.",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('notePath keeps Codex notes inside its vault folder', async () => {
  const { notePath } = await import('../src/core/operator.ts');
  assert.equal(notePath('/v', 'Handoff 1'), path.join('/v', 'Handoff 1.md'));
  assert.throws(() => notePath('/v', '../escape'));
  assert.throws(() => notePath('/v', '.hidden'));
});
