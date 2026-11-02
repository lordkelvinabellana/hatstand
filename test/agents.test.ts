import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRows, agentWidth, drawAgent, lookFor } from '../src/core/agents.ts';

test('an agent keeps its look for a session and draws every mood at one size', () => {
  assert.deepEqual(lookFor('s1', '#2f8f74'), lookFor('s1', '#2f8f74'));
  assert.ok(
    new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => JSON.stringify(lookFor(id, '#2f8f74')))).size > 1,
  );
  for (let i = 0; i < 500; i++) {
    const any = lookFor(`session-${i}`, '#2f8f74');
    assert.ok(any.skin && any.hair && any.style, `look ${i} is complete`);
  }
  const look = lookFor('s1', '#2f8f74');
  const frames = (['idle', 'working', 'ask', 'done', 'sleep'] as const).map((mood) =>
    drawAgent(look, mood, 0, false),
  );
  for (const grid of frames) {
    assert.equal(grid.length, agentRows);
    assert.ok(grid.every((row) => row.length === agentWidth));
  }
  // The moods look different from one another, and walking moves the legs.
  assert.equal(new Set(frames.map((g) => JSON.stringify(g))).size, frames.length);
  assert.notDeepEqual(drawAgent(look, 'idle', 0, true), drawAgent(look, 'idle', 1, true));
});
