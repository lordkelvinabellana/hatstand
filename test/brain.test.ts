import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AUTO_END, AUTO_START, promptText, runCapture, sessionNote } from '../src/core/brain.ts';
import {
  BLOCK_START,
  brainBlock,
  captureCommand,
  hasExternalCapture,
  seedVault,
  withBrainBlock,
  withBrainHooks,
} from '../src/core/vault.ts';
import { withPetHooks } from '../src/core/pets.ts';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-brain-'));
const line = (value: unknown) => JSON.stringify(value);
function transcript(prompts: string[]) {
  return [
    line({ type: 'custom-title', customTitle: 'Fix the invoice flow' }),
    ...prompts.map((text, i) =>
      line({
        type: 'user',
        origin: { kind: 'human' },
        cwd: '/work/acme',
        timestamp: `2026-10-19T1${i}:00:00Z`,
        message: { content: text },
      }),
    ),
    line({
      type: 'assistant',
      timestamp: '2026-10-19T12:00:00Z',
      message: {
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/work/acme/a.ts' } },
          { type: 'tool_use', name: 'Skill', input: { skill: 'pdf' } },
          { type: 'tool_use', name: 'mcp__slack__send', input: {} },
          { type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: {} },
        ],
      },
    }),
    line({ type: 'user', isSidechain: true, origin: { kind: 'human' }, message: { content: 'ignored' } }),
  ].join('\n');
}

test('prompts drop tool output and redact secrets, keys and emails', () => {
  const text = promptText(
    'deploy with sk-abcdefghijklmnop1234 and password: hunter2 for ana@example.com ' +
      'token AbCdEfGhIjKlMnOpQrSt12345 but keep 6f1c2d3e-aaaa-4bbb-8ccc-123456789abc and a-long-readable-slug-here' +
      '<system-reminder>secret context</system-reminder>',
  );
  assert.doesNotMatch(text, /sk-abc|hunter2|ana@|AbCdEf|secret context/);
  assert.match(text, /\[email\]/);
  assert.match(text, /6f1c2d3e-aaaa-4bbb-8ccc-123456789abc/);
  assert.match(text, /a-long-readable-slug-here/);
  assert.equal(promptText([{ type: 'text', text: 'x'.repeat(300) }]).length, 241);
});

test('a session note keeps the Summary and text after the auto block when refreshed', async () => {
  const vault = await temp();
  const log = path.join(vault, 'session.jsonl');
  await fs.writeFile(log, transcript(['First ask']));
  const options = { vault, profile: 'Acme' };
  const note = sessionNote(options, 'abcdef12-0000', log)!;
  assert.match(path.basename(note), /^2026-10-19 Acme – Fix the invoice flow \(abcdef12\)\.md$/);
  let text = await fs.readFile(note, 'utf8');
  assert.match(text, /wrote `\/work\/acme\/a.ts`/);
  assert.match(text, /- Skills: pdf/);
  assert.match(text, /- Apps: slack\n/);
  await fs.writeFile(
    note,
    text.replace(/## Summary\n[\s\S]*?(?=<!-- auto:start -->)/, '## Summary\n- Shipped it\n\n') +
      '\nMy own notes\n',
  );
  await fs.writeFile(log, transcript(['First ask', 'Second ask']));
  assert.equal(sessionNote(options, 'abcdef12-0000', log), note);
  text = await fs.readFile(note, 'utf8');
  assert.match(text, /## Summary\n- Shipped it\n\n<!-- auto:start -->/);
  assert.match(text, /Second ask/);
  assert.match(text, /My own notes\n$/);
  assert.equal(text.split(AUTO_START).length, 2);
  assert.equal(text.split(AUTO_END).length, 2);
  const daily = await fs.readFile(path.join(vault, 'Daily', '2026-10-19.md'), 'utf8');
  assert.match(
    daily,
    /### \[\[Acme account\]\]\n- \[\[2026-10-19 Acme – Fix the invoice flow \(abcdef12\)\|Fix the invoice flow\]\]/,
  );
  await fs.access(path.join(vault, 'Profiles', 'Acme account.md'));
  await fs.access(path.join(vault, 'Home.md'));
  assert.equal(sessionNote(options, 'empty', path.join(vault, 'Home.md')), null);
});

test('hook mode never throws and logs failures in the vault; --context lists topic notes', async () => {
  const vault = await temp();
  let printed = '';
  runCapture(
    ['--vault', vault],
    () => '{not json',
    (t) => (printed += t),
  );
  assert.equal(printed, '');
  assert.match(await fs.readFile(path.join(vault, '.capture-errors.log'), 'utf8'), /SyntaxError/);
  await fs.mkdir(path.join(vault, 'Clients'));
  await fs.writeFile(path.join(vault, 'Clients', 'Acme.md'), '---\nstatus: active\n---\n');
  runCapture(
    ['--vault', vault, '--context'],
    () => '',
    (t) => (printed = t),
  );
  const output = JSON.parse(printed).hookSpecificOutput;
  assert.equal(output.hookEventName, 'SessionStart');
  assert.match(output.additionalContext, /- Clients: Acme/);
});

test('the hook command runs through sh with awkward paths and names', {
  skip: process.platform === 'win32',
}, async () => {
  const vault = path.join(await temp(), "O'Brien vault");
  const log = path.join(vault, '..', 'log.jsonl');
  await fs.writeFile(log, transcript(['Hello']));
  const command = captureCommand(
    process.execPath,
    path.resolve('src/brain/capture.ts'),
    vault,
    "O'Brien & Co",
  );
  execFileSync('/bin/sh', ['-c', command], {
    input: line({ session_id: 'feedface-1', transcript_path: log }),
  });
  const [month] = await fs.readdir(path.join(vault, 'Sessions'));
  const [note] = await fs.readdir(path.join(vault, 'Sessions', month));
  assert.match(note, /O'Brien & Co – Fix the invoice flow \(feedface\)/);
});

test('capture hooks are added once, keep other hooks, and come out cleanly', () => {
  const pets = withPetHooks({ model: 'x' }, '/data/pet-hook.sh');
  const on = withBrainHooks(pets, "ELECTRON_RUN_AS_NODE=1 '/app' '/data/capture.cjs'");
  assert.deepEqual(withBrainHooks(on, "ELECTRON_RUN_AS_NODE=1 '/app' '/data/capture.cjs'"), on);
  const hooks = on.hooks as Record<string, { hooks: { command: string }[] }[]>;
  assert.equal(hooks.SessionStart.length, 1);
  assert.match(hooks.SessionStart[0].hooks[0].command, / --context$/);
  assert.equal(hooks.Stop.length, 2);
  assert.deepEqual(withBrainHooks(on, null), pets);
  assert.deepEqual(withBrainHooks({ model: 'x' }, null), { model: 'x' });
  assert.equal(hasExternalCapture(on), false);
  assert.equal(
    hasExternalCapture({
      hooks: { Stop: [{ hooks: [{ command: 'python3 ~/.claude/second-brain/capture.py' }] }] },
    }),
    true,
  );
});

test('the CLAUDE.md block is replaced in place and removed without touching other text', () => {
  const block = brainBlock('/v', 'cmd');
  const mine = '# My rules\n\nBe brief.\n';
  const on = withBrainBlock(mine, block);
  assert.equal(withBrainBlock(on, block), on);
  assert.equal(on.split(BLOCK_START).length, 2);
  assert.equal(withBrainBlock(withBrainBlock(on, brainBlock('/w', 'cmd')), block), on);
  assert.equal(withBrainBlock(on, null), mine);
  assert.equal(withBrainBlock(withBrainBlock('', block), null), '');
  assert.equal(withBrainBlock(mine, null), mine);
});

test('seeding a vault never overwrites existing files', async () => {
  const vault = await temp();
  await fs.writeFile(path.join(vault, 'To-Do.md'), 'mine');
  await seedVault(vault, '2026-10-19');
  await seedVault(vault, '2026-10-20');
  assert.equal(await fs.readFile(path.join(vault, 'To-Do.md'), 'utf8'), 'mine');
  assert.deepEqual((await fs.readdir(path.join(vault, '_templates'))).sort(), [
    'Client.md',
    'Person.md',
    'Project.md',
    'Tool.md',
  ]);
  for (const folder of ['Clients', 'Projects', 'People', 'Tools', 'Sessions', 'Daily'])
    await fs.access(path.join(vault, folder));
});
