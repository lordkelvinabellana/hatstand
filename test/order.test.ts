import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveByStep, moveToIndex } from '../src/ui/order.ts';

const profiles = [
  { id: 'a', archived: false },
  { id: 'x', archived: true },
  { id: 'b', archived: false },
  { id: 'c', archived: false },
];

test('moving up skips over a hidden archived profile', () => {
  assert.deepEqual(moveByStep(profiles, 'b', -1), ['b', 'x', 'a', 'c']);
});

test('moving past the edge of the visible group does nothing', () => {
  assert.equal(moveByStep(profiles, 'a', -1), null);
  assert.equal(moveByStep(profiles, 'c', 1), null);
  assert.equal(moveByStep(profiles, 'x', 1), null);
});

test('dragging to a position keeps archived profiles in their slots and loses nothing', () => {
  const result = moveToIndex(profiles, 'c', 0);
  assert.deepEqual(result, ['c', 'x', 'a', 'b']);
  assert.deepEqual([...result].sort(), ['a', 'b', 'c', 'x']);
});
