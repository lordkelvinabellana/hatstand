import assert from 'node:assert/strict';
import test from 'node:test';
import { micInUse } from '../src/core/mic.ts';

test('micInUse answers with a boolean and never throws', async () => {
  assert.equal(typeof (await micInUse()), 'boolean');
});
