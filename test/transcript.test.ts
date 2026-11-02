import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastMessages } from '../src/core/transcript.ts';

test('lastMessages filters transcript entries, merges assistant text, and keeps the tail', () => {
  const user = (content: unknown) => ({ type: 'user', message: { content } });
  const assistant = (...texts: string[]) => ({
    type: 'assistant',
    message: { content: texts.map((text) => ({ type: 'text', text })) },
  });
  const transcript =
    [
      user('first'),
      assistant('one', 'two'),
      user('<tool-notification>'),
      user([{ type: 'tool_result' }]),
      { ...assistant('sidechain'), isSidechain: true },
      { type: 'assistant', message: { content: [{ type: 'tool_use' }] } },
      null,
      assistant('three'),
      user('x'.repeat(2100) + 'end'),
      assistant('a'.repeat(2100), 'tail'),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\nbroken';
  assert.deepEqual(
    lastMessages(transcript, 4),
    [
      { role: 'assistant', text: 'one\ntwo\nthree' },
      { role: 'user', text: 'x'.repeat(1997) + 'end' },
      { role: 'assistant', text: 'a'.repeat(1995) + '\ntail' },
    ].toSpliced(0, 0, { role: 'user', text: 'first' }),
  );
  assert.equal(lastMessages(transcript, 2).length, 2);
  assert.deepEqual(lastMessages(transcript, 0), []);
  assert.deepEqual(lastMessages('', 3), []);
});

test('brief keeps the end of the last assistant message, without markdown', async () => {
  const { brief } = await import('../src/core/transcript.ts');
  const text = brief([
    { role: 'user', text: 'go' },
    { role: 'assistant', text: 'I **fixed** the bug. See `a.ts`. Tests pass. Should I push it?' },
  ]);
  assert.equal(text, 'I fixed the bug. See a.ts. Tests pass. Should I push it?');
  assert.equal(brief([{ role: 'assistant', text: 'One. Two. Three.' }], 8), 'Three.');
});
