// Entry point of dist/capture.cjs, run by Claude Code hooks as `ELECTRON_RUN_AS_NODE=1 <Hatstand> capture.cjs …`.
import * as fs from 'node:fs';
import { runCapture } from '../core/brain.ts';

runCapture(
  process.argv.slice(2),
  () => fs.readFileSync(0, 'utf8'),
  (text) => process.stdout.write(`${text}\n`),
);
