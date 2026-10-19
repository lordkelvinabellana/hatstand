import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askLink, askPrompt, findDesktopSession, sessionLink } from '../src/core/ask.ts';
import { handleRecall, RECALL_SERVER } from '../src/core/recall.ts';
import { recallEntry, withRecallServer } from '../src/core/vault.ts';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-recall-'));
async function vault() {
  const root = await temp();
  const write = async (rel: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await write(
    'Clients/Northwind.md',
    '---\naliases: [NW]\n---\n# Northwind\nPricing agreed at 40 per seat. Contact [[Ana]].\n',
  );
  await write('People/Ana.md', 'Works at [[Northwind]]. Likes [[Missing thing]].\n');
  await write('Projects/Site.md', 'For [[NW]].\n');
  await write('.obsidian/secret.md', 'hidden pricing\n');
  return root;
}
const call = async (folder: string, name: string, args: Record<string, unknown>) => {
  const answer = (await handleRecall(folder, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })) as { result: { content: { text: string }[]; isError?: boolean } };
  return answer.result;
};

test('recall server: initialize, list tools, notifications get no reply', async () => {
  const folder = await vault();
  const init = (await handleRecall(folder, {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  })) as { result: { protocolVersion: string; serverInfo: { name: string } } };
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.name, RECALL_SERVER);
  assert.equal(await handleRecall(folder, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = (await handleRecall(folder, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: { tools: { name: string }[] };
  };
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['search_notes', 'read_note', 'note_links'],
  );
  const unknown = (await handleRecall(folder, { jsonrpc: '2.0', id: 2, method: 'resources/list' })) as {
    error: { code: number };
  };
  assert.equal(unknown.error.code, -32601);
});

test('recall tools search, read by name or alias, and follow links; hidden folders stay hidden', async () => {
  const folder = await vault();
  const search = await call(folder, 'search_notes', { query: 'pricing' });
  assert.match(search.content[0].text, /\[\[Northwind\]\] \(Clients\/Northwind\.md\): .*40 per seat/);
  assert.doesNotMatch(search.content[0].text, /secret|hidden/);
  assert.match(
    (await call(folder, 'read_note', { note: 'nw' })).content[0].text,
    /^# Clients\/Northwind\.md/,
  );
  assert.match((await call(folder, 'read_note', { note: 'People/Ana' })).content[0].text, /Works at/);
  const links = (await call(folder, 'note_links', { note: 'Ana', depth: 2 })).content[0].text;
  assert.match(links, /Links to: \[\[Northwind\]\], Missing thing \(missing\)/);
  assert.match(links, /Linked from:\n- \[\[Northwind\]\]: .*Contact \[\[Ana\]\]/);
  assert.match(links, /Within 2 links: .*\[\[Site\]\]/);
  const missing = await call(folder, 'read_note', { note: '../../etc/passwd' });
  assert.equal(missing.isError, true);
  assert.equal((await call(folder, 'read_note', {})).isError, true);
  assert.equal((await call(folder, 'delete_note', { note: 'Ana' })).isError, true);
});

test('recall server speaks JSON-RPC over stdio', async () => {
  const folder = await vault();
  const child = spawn(process.execPath, ['src/brain/recall.ts', '--vault', folder]);
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\nnot json\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_note', arguments: { note: 'Ana' } } })}\n`,
  );
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
  const lines = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].result.tools.length, 3);
  assert.equal(lines[1].error.code, -32700);
  assert.match(lines[2].result.content[0].text, /Works at/);
});

test('links into Claude Desktop are validated and percent-encoded', () => {
  assert.equal(sessionLink('local_338c5e40-ec45'), 'claude://code/continue?session=local_338c5e40-ec45');
  assert.throws(() => sessionLink('local_x&evil=1'));
  assert.throws(() => sessionLink('338c5e40'));
  const link = askLink('What did we agree with Northwind & co?', '/Users/me/My Vault');
  // Exactly the shape the native helper accepts.
  assert.match(link, /^claude:\/\/code\/new\?q=[A-Za-z0-9%._~!*'()-]+&folder=[A-Za-z0-9%._~!*'()-]+$/);
  const url = new URL(link);
  assert.equal(url.searchParams.get('folder'), '/Users/me/My Vault');
  assert.match(
    url.searchParams.get('q')!,
    /^What did we agree with Northwind & co\?\n\nAnswer from my notes/,
  );
  assert.throws(() => askPrompt('   '), /Type a question/);
  assert.throws(() => askPrompt('x'.repeat(5000)), /under/);
});

test('finds the Desktop session for a Claude Code session, only in that profile’s data', async () => {
  const desktop = await temp();
  const folder = path.join(desktop, 'claude-code-sessions', 'a', 'b');
  await fs.mkdir(folder, { recursive: true });
  const cli = 'cfe779c8-051c-41b9-9f4f-4204303cb625';
  await fs.writeFile(path.join(folder, 'local_338c5e40.json'), JSON.stringify({ cliSessionId: cli }));
  await fs.writeFile(path.join(folder, 'local_other.json'), JSON.stringify({ cliSessionId: 'x', note: cli }));
  await fs.writeFile(path.join(folder, 'broken.json'), cli);
  assert.equal(await findDesktopSession(desktop, cli), 'local_338c5e40');
  assert.equal(await findDesktopSession(desktop, 'cfe779c8-0000-41b9-9f4f-4204303cb625'), null);
  assert.equal(await findDesktopSession(desktop, '../../x'), null);
  assert.equal(await findDesktopSession(await temp(), cli), null);
});

test('recall server entry is added to and removed from Claude configs, other servers kept', () => {
  const entry = recallEntry('/Apps/Hatstand', '/data/recall.cjs', '/notes');
  assert.deepEqual(entry.args, ['/data/recall.cjs', '--vault', '/notes']);
  assert.equal(entry.env.ELECTRON_RUN_AS_NODE, '1');
  const config = { numStartups: 3, mcpServers: { n8n: { command: 'x' } } };
  const on = withRecallServer(config, RECALL_SERVER, entry);
  assert.deepEqual(Object.keys(on.mcpServers as object), ['n8n', RECALL_SERVER]);
  assert.equal(on.numStartups, 3);
  assert.deepEqual(withRecallServer(on, RECALL_SERVER, null), config);
  const bare = { preferences: {} };
  assert.deepEqual(withRecallServer(withRecallServer(bare, RECALL_SERVER, entry), RECALL_SERVER, null), bare);
});
