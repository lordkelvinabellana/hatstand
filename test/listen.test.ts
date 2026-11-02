import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWake, Segmenter } from '../src/core/listen.ts';

const rate = 16000;
const chunk = (level: number, ms = 100) =>
  Float32Array.from({ length: (rate * ms) / 1000 }, (_, i) => level * Math.sin(i / 5));

test('Segmenter returns a phrase once the speaker pauses, with silence ignored', () => {
  const s = new Segmenter();
  for (let i = 0; i < 20; i++) assert.equal(s.push(chunk(0.001), rate), undefined);
  for (let i = 0; i < 10; i++) assert.equal(s.push(chunk(0.2), rate), undefined);
  let phrase: Float32Array | undefined;
  for (let i = 0; i < 10 && !phrase; i++) phrase = s.push(chunk(0.001), rate);
  assert.ok(phrase && phrase.length >= rate); // at least the second of speech
});

test('Segmenter drops a short click', () => {
  const s = new Segmenter();
  s.push(chunk(0.2), rate);
  let phrase: Float32Array | undefined;
  for (let i = 0; i < 10; i++) phrase = s.push(chunk(0.001), rate) ?? phrase;
  assert.equal(phrase, undefined);
});

test('parseWake finds the wake word and the command after it', () => {
  assert.deepEqual(parseWake('Hey, Codex. What is running?'), { woke: true, command: 'What is running?' });
  assert.deepEqual(parseWake('codecs'), { woke: true, command: '' });
  assert.deepEqual(parseWake('Yo Codecs check Kam'), { woke: true, command: 'check Kam' });
  assert.equal(parseWake('the codex is broken').woke, false);
});
