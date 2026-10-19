import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, filterGraph, withInferred, withoutInferred } from '../src/core/graph.ts';
import { deepGraphLink, deepGraphPrompt, parseInferred } from '../src/core/inferred.ts';
import { buildIndex } from '../src/core/links.ts';
import { ASK_LIMIT } from '../src/core/ask.ts';

const index = buildIndex([
  { path: 'Clients/Aether.md', text: '---\naliases: [Aether Labs]\n---\nWorks with [[Kam]].\n' },
  { path: 'People/Kam.md', text: 'Runs ops.\n' },
  { path: 'Tools/n8n.md', text: 'Automation.\n' },
  { path: 'Projects/Scorecard.md', text: 'Weekly KPIs.\n' },
]);

test('inferred links: paths, names and aliases resolve; unknown, self and repeated pairs are dropped', () => {
  const file = JSON.stringify({
    generated: '2026-10-20',
    links: [
      { from: 'Projects/Scorecard.md', to: 'Tools/n8n.md', reason: 'Runs on n8n.', confidence: 0.9 },
      { from: 'Aether Labs', to: 'Scorecard', reason: 'Their scorecard.', confidence: 2 },
      { from: 'Tools/n8n.md', to: 'Projects/Scorecard.md', reason: 'Repeat, reversed.' },
      { from: 'Tools/n8n.md', to: 'Tools/n8n.md', reason: 'Self.' },
      { from: 'Nowhere', to: 'Tools/n8n.md', reason: 'Unknown note.' },
      { from: 'People/Kam.md', to: 'Tools/n8n.md', reason: 'x'.repeat(500) },
      'junk',
    ],
  });
  const links = parseInferred(file, index);
  assert.deepEqual(
    links.map((l) => [l.from, l.to, l.confidence]),
    [
      ['Projects/Scorecard.md', 'Tools/n8n.md', 0.9],
      ['Clients/Aether.md', 'Projects/Scorecard.md', 1],
      ['People/Kam.md', 'Tools/n8n.md', 0.5],
    ],
  );
  assert.equal(links[2].reason.length, 300);
  assert.deepEqual(parseInferred('not json', index), []);
  assert.deepEqual(parseInferred('{"links": 3}', index), []);
});

test('inferred links become their own kind of edge; hand-made links stay plain', () => {
  const graph = buildGraph(index);
  const links = [
    { from: 'Clients/Aether.md', to: 'People/Kam.md', reason: 'Already linked.' },
    { from: 'Projects/Scorecard.md', to: 'Tools/n8n.md', reason: 'Runs on n8n.' },
  ];
  const deep = withInferred(graph, links);
  assert.equal(deep.edges.length, graph.edges.length + 1);
  assert.deepEqual([...(deep.ai ?? [])], [['Projects/Scorecard.md\nTools/n8n.md', 'Runs on n8n.']]);
  // Filters keep the AI edges marked; turning them off drops only those.
  assert.equal(filterGraph(deep, { hidden: new Set(), ghosts: false, orphans: false }).ai?.size, 1);
  assert.deepEqual(withoutInferred(deep).edges, graph.edges);
});

test('the deep-graph prompt fits in a Claude Desktop link and names the file', () => {
  const prompt = deepGraphPrompt('2026-10-20');
  assert.ok(prompt.length < ASK_LIMIT);
  assert.match(prompt, /\.hatstand\/inferred-links\.json/);
  assert.match(deepGraphLink('/v', '2026-10-20'), /^claude:\/\/code\/new\?q=.+&folder=%2Fv$/);
});
