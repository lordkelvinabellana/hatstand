import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraph,
  combineVaults,
  filterGraph,
  groupOf,
  localGraph,
  matchNodes,
  ringPositions,
  splitVaultNode,
} from '../src/core/graph.ts';
import { buildIndex } from '../src/core/links.ts';

const vault = buildIndex([
  {
    path: 'Clients/Aether.md',
    text: '---\naliases: [Aether Labs]\n---\nWorks with [[Kam]] on [[Hatstand]].\n',
  },
  {
    path: 'People/Kam.md',
    text: 'Runs [[Aether Labs|the lab]], [[aether#Log]] again, and [[Kam]] itself.\n',
  },
  {
    path: 'Projects/Hatstand.md',
    text: 'client: "[[Aether]]"\nSee [[Missing note]] and [[missing NOTE]].\n',
  },
  { path: 'Sessions/2026-10-20 abc.md', text: 'Touched [[Hatstand]].\n' },
  { path: 'Daily/2026-10-20.md', text: '- [[2026-10-20 abc]]\n' },
  { path: 'Tools/Loner.md', text: 'Nothing links here.\n' },
  { path: 'To-Do.md', text: '- [ ] Call [[Kam]]\n' },
  { path: '_templates/Client.md', text: '# {{title}}\nOwner: [[Kam]] [[{{title}}]]\n' },
]);
const graph = buildGraph(vault);
const ids = (g: { nodes: { id: string }[] }) => g.nodes.map((n) => n.id).sort();
const node = (id: string) => graph.nodes.find((n) => n.id === id)!;
const none = { hidden: new Set<never>(), ghosts: true, orphans: true };

test('nodes are notes, grouped by top folder; templates are left out', () => {
  assert.deepEqual(ids(graph), [
    'Clients/Aether.md',
    'Daily/2026-10-20.md',
    'People/Kam.md',
    'Projects/Hatstand.md',
    'Sessions/2026-10-20 abc.md',
    'To-Do.md',
    'Tools/Loner.md',
    'ghost:missing note',
  ]);
  assert.equal(node('Clients/Aether.md').group, 'Clients');
  assert.equal(node('To-Do.md').group, 'Other');
  assert.equal(groupOf('Other/x.md'), 'Other');
  assert.equal(groupOf('Archive/x.md'), 'Other');
});

test('edges resolve names and aliases case-insensitively, deduped, no self-links', () => {
  const has = (a: string, b: string) =>
    graph.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  assert.ok(has('Clients/Aether.md', 'People/Kam.md'));
  assert.ok(has('Clients/Aether.md', 'Projects/Hatstand.md'));
  assert.ok(has('Daily/2026-10-20.md', 'Sessions/2026-10-20 abc.md'));
  assert.equal(new Set(graph.edges.map((e) => e.join('|'))).size, graph.edges.length);
  assert.ok(!graph.edges.some(([a, b]) => a === b));
  // Aether: Kam (both ways, one edge) and Hatstand (both ways, one edge).
  assert.equal(node('Clients/Aether.md').links, 2);
  assert.equal(node('People/Kam.md').links, 2);
  assert.equal(node('Tools/Loner.md').links, 0);
});

test('unresolved links become one ghost node per target', () => {
  const ghost = node('ghost:missing note');
  assert.equal(ghost.ghost, true);
  assert.equal(ghost.label, 'Missing note');
  assert.equal(ghost.links, 1);
});

test('filters: folders, ghosts, orphans', () => {
  const noGhosts = filterGraph(graph, { ...none, ghosts: false });
  assert.ok(!noGhosts.nodes.some((n) => n.ghost));
  assert.ok(!noGhosts.edges.flat().some((id) => id.startsWith('ghost:')));

  const quiet = filterGraph(graph, { ...none, hidden: new Set(['Sessions', 'Daily'] as const) });
  assert.ok(!quiet.nodes.some((n) => n.group === 'Sessions' || n.group === 'Daily'));
  assert.ok(!quiet.edges.flat().some((id) => id.startsWith('Sessions/') || id.startsWith('Daily/')));

  const linked = filterGraph(graph, { ...none, orphans: false });
  assert.ok(!linked.nodes.some((n) => n.id === 'Tools/Loner.md'));
  // A ghost loses its only link when ghosts are hidden, and orphans are judged after that.
  const both = filterGraph(graph, { hidden: new Set(['Projects'] as const), ghosts: true, orphans: false });
  assert.ok(!both.nodes.some((n) => n.ghost));
});

test('local graph keeps the note and its neighbours to the given depth', () => {
  assert.deepEqual(ids(localGraph(graph, 'People/Kam.md', 1)), [
    'Clients/Aether.md',
    'People/Kam.md',
    'To-Do.md',
  ]);
  assert.deepEqual(ids(localGraph(graph, 'People/Kam.md', 2)), [
    'Clients/Aether.md',
    'People/Kam.md',
    'Projects/Hatstand.md',
    'To-Do.md',
  ]);
  const local = localGraph(graph, 'People/Kam.md', 2);
  assert.ok(
    local.edges.every(([a, b]) => local.nodes.some((n) => n.id === a) && local.nodes.some((n) => n.id === b)),
  );
  assert.deepEqual(localGraph(graph, 'Nope.md', 2), { nodes: [], edges: [] });
});

test('search highlights matching names', () => {
  assert.equal(matchNodes(graph, '  '), null);
  assert.deepEqual([...matchNodes(graph, 'aeTH')!], ['Clients/Aether.md']);
  assert.deepEqual([...matchNodes(graph, '2026-10-20')!].sort(), [
    'Daily/2026-10-20.md',
    'Sessions/2026-10-20 abc.md',
  ]);
});

test('2,000 notes build quickly', () => {
  const notes = Array.from({ length: 2000 }, (_, i) => ({
    path: `${['Clients', 'Projects', 'People', 'Sessions'][i % 4]}/Note ${i}.md`,
    text: `[[Note ${(i * 7) % 2000}]] [[Note ${(i * 13) % 2000}]] [[Ghost ${i % 50}]]`,
  }));
  const start = performance.now();
  const big = buildGraph(buildIndex(notes));
  filterGraph(big, { hidden: new Set(['Sessions'] as const), ghosts: false, orphans: false });
  assert.equal(big.nodes.length, 2050);
  assert.ok(performance.now() - start < 1000);
});

test('all vaults: each vault hangs off its own hub and vaults never link to each other', () => {
  const other = buildGraph(buildIndex([{ path: 'People/Kam.md', text: 'Same name, other vault.\n' }]));
  const vaults = [
    { key: '/a', label: 'Personal', color: 'red', graph },
    { key: '/b', label: 'Stakra', color: 'blue', graph: other },
  ];
  const all = combineVaults(vaults);
  assert.equal(all.nodes.length, graph.nodes.length + other.nodes.length + 2);
  const hubs = all.nodes.filter((n) => n.hub);
  assert.deepEqual(
    hubs.map((n) => n.label),
    ['Personal', 'Stakra'],
  );
  assert.equal(all.nodes.find((n) => n.id === '/b\nPeople/Kam.md')?.color, 'blue');
  for (const [a, b] of all.edges) assert.equal(splitVaultNode(a).key, splitVaultNode(b).key);
  assert.deepEqual(splitVaultNode('/a\nPeople/Kam.md'), { key: '/a', path: 'People/Kam.md' });
  assert.deepEqual(splitVaultNode('/a\n'), { key: '/a', path: '' });
  const spots = ringPositions(vaults);
  assert.equal(spots.size, all.nodes.length);
  assert.notDeepEqual(spots.get('/a\n'), spots.get('/b\n'));
});
