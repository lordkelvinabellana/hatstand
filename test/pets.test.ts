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
  parseSession,
  petMood,
  petSound,
  withPetHooks,
} from '../src/core/pets.ts';

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

test('the hook script records and clears a session in the profile pet folder', async (t) => {
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
