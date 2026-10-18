import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  drawPet,
  encodePng,
  hookScript,
  modelName,
  parseSession,
  petMood,
  petSound,
  settledState,
  summarizeTranscript,
  withPetHooks,
} from '../src/core/pets.ts';
import { validateInput, validateState } from '../src/core/profiles.ts';

test('pet mood: asking beats done beats working, and stale sessions age out', () => {
  const now = 10 * 60 * 60_000;
  assert.equal(petMood(false, [], now), 'sleep');
  assert.equal(petMood(true, [], now), 'idle');
  assert.equal(
    petMood(
      true,
      [
        { state: 'working', at: now },
        { state: 'done', at: now },
      ],
      now,
    ),
    'done',
  );
  assert.equal(
    petMood(
      true,
      [
        { state: 'done', at: now },
        { state: 'ask', at: now - 1 },
      ],
      now,
    ),
    'ask',
  );
  assert.equal(petMood(true, [{ state: 'working', at: now - 21 * 60_000 }], now), 'idle');
  assert.equal(parseSession('{"state":"hacked","at":1}'), null);
  assert.equal(parseSession('not json'), null);
});

test('pet hooks are added once and leave other hooks alone', () => {
  const other = { hooks: [{ type: 'command', command: 'capture.py' }] };
  const once = withPetHooks({ model: 'x', hooks: { Stop: [other] } }, '/a b/pet-hook.sh');
  const twice = withPetHooks(once, '/a b/pet-hook.sh');
  assert.deepEqual(twice, once);
  const hooks = once.hooks as Record<string, unknown[]>;
  assert.equal(once.model, 'x');
  assert.deepEqual(hooks.Stop[0], other);
  assert.equal(hooks.Stop.length, 2);
  assert.match(JSON.stringify(hooks.PreToolUse), /AskUserQuestion/);
});

// Pets are macOS only; Windows has no /bin/sh to run the hook.
test('the hook script records and clears a session in the profile pet folder', {
  skip: process.platform === 'win32',
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-pet-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'pet-hook.sh');
  await fs.writeFile(script, hookScript);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(root, 'profile', 'code') };
  const run = (state: string, input: string) => execFileSync('/bin/sh', [script, state], { env, input });
  run('ask', '{"session_id": "abc-1", "cwd": "/x"}');
  const file = path.join(root, 'profile', 'pet', 'abc-1.json');
  assert.equal(parseSession(await fs.readFile(file, 'utf8'))?.state, 'ask');
  run('done', '{"session_id":"../evil"}');
  assert.deepEqual(await fs.readdir(path.join(root, 'profile', 'pet')), ['abc-1.json']);
  run('end', '{"session_id":"abc-1"}');
  assert.deepEqual(await fs.readdir(path.join(root, 'profile', 'pet')), []);
});

test('pets render as PNGs and sounds as WAVs', () => {
  const grid = drawPet(0, 'teal', 'ask', 0);
  assert.equal(grid.length, 16);
  assert.equal(grid[0].length, 26);
  assert.equal(drawPet(1, 'rose', 'idle', 0)[0].length, 16);
  assert.equal(encodePng(grid, 2).subarray(1, 4).toString(), 'PNG');
  assert.equal(petSound('done', 2).subarray(0, 4).toString(), 'RIFF');
});

test('transcript summary replays the task list and counts each response once', () => {
  const line = (value: unknown) => JSON.stringify(value);
  const plan = (input: unknown) => ({
    type: 'assistant',
    cwd: '/work/hatstand',
    message: {
      id: 'm1',
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 8,
        output_tokens: 50,
      },
      content: [{ type: 'tool_use', name: 'mcp__ccd_turn__update_plan', input }],
    },
  });
  const text = [
    line({ type: 'custom-title', customTitle: 'Pets' }),
    line({ type: 'user', message: { content: 'Add pets' } }),
    line(
      plan({
        items: [
          { content: 'A', status: 'in_progress' },
          { content: 'B', status: 'pending' },
          { content: 'C', status: 'pending' },
        ],
      }),
    ),
    line(plan({ advance: true })),
    'not json',
    line({ ...plan({ done: [3] }), isSidechain: true }),
  ].join('\n');
  const summary = summarizeTranscript(text);
  assert.equal(summary.title, 'Pets');
  assert.equal(summary.prompt, 'Add pets');
  assert.equal(summary.cwd, '/work/hatstand');
  assert.deepEqual(
    summary.plan.map((s) => s.status),
    ['completed', 'in_progress', 'pending'],
  );
  assert.equal(summary.output, 50);
  assert.equal(summary.context, 1010);
  assert.equal(modelName(summary.model), 'Opus 5.5');
  // Stopped with steps left: still working. Stopped on a question: needs you. All steps finished: done.
  const stopped = { state: 'done' as const, at: 1 };
  assert.equal(settledState(stopped, summary), 'working');
  assert.equal(settledState(stopped, { ...summary, asking: true }), 'ask');
  assert.equal(settledState(stopped, { ...summary, plan: [] }), 'done');
  assert.equal(settledState(stopped, { ...summary, plan: [], background: 1 }), 'working');
  const bash = line({
    type: 'assistant',
    message: {
      id: 'b',
      content: [
        { type: 'tool_use', id: 'toolu_bg', name: 'Bash', input: { command: 'x', run_in_background: true } },
      ],
    },
  });
  const notice = line({
    type: 'queue-operation',
    content: '<task-notification>\n<tool-use-id>toolu_bg</tool-use-id>\n<status>completed</status>',
  });
  assert.equal(summarizeTranscript([text, bash].join('\n')).background, 1);
  assert.equal(summarizeTranscript([text, bash, notice].join('\n')).background, 0);
  const wrapUp = (ask?: string) =>
    line({
      type: 'assistant',
      message: {
        id: 'w',
        content: [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: { recap: 'r', ask } }],
      },
    });
  assert.equal(summarizeTranscript([text, wrapUp('Commit?')].join('\n')).asking, true);
  assert.equal(
    summarizeTranscript(
      [text, wrapUp('Commit?'), line({ type: 'user', message: { content: 'yes' } })].join('\n'),
    ).asking,
    false,
  );
});

test('profiles get a pet: saved ones in order, unknown pets are rejected', () => {
  const base = { name: 'A', archived: false, createdAt: new Date(0).toISOString() };
  const state = validateState({
    schemaVersion: 2,
    profiles: [
      { ...base, id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      { ...base, id: '1f8fad5b-d9cb-469f-a165-70867728950e', pet: '' },
    ],
  });
  assert.deepEqual(
    state.profiles.map((p) => p.pet),
    ['cat', ''],
  );
  assert.throws(() => validateInput({ name: 'A', pet: 'dragon' }), /Invalid pet/);
});
