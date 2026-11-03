import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idleSessions } from '../src/core/idle.ts';

test('idleSessions selects idle non-working sessions unless this timestamp is vaulted', () => {
  const sessions = [
    { key: 'working', state: 'working' as const, at: 0 },
    { key: 'ask', state: 'ask' as const, at: 0 },
    { key: 'done', state: 'done' as const, at: 0 },
    { key: 'recent', state: 'done' as const, at: 1 },
    { key: 'vaulted', state: 'done' as const, at: 0 },
  ];
  assert.deepEqual(idleSessions(sessions, 3_600_000, { vaulted: 0, done: -1 }), ['ask', 'done']);
  assert.deepEqual(idleSessions(sessions, 10, {}, 9), ['ask', 'done', 'recent', 'vaulted']);
  assert.deepEqual(idleSessions([], 10, {}), []);
});
