// Entry point of dist/recall.cjs, the `hatstand-notes` MCP server, run by Claude as
// `ELECTRON_RUN_AS_NODE=1 <Hatstand> recall.cjs --vault <folder>`.
import { createInterface } from 'node:readline';
import { handleRecall } from '../core/recall.ts';

const at = process.argv.indexOf('--vault');
const vault = at >= 0 ? process.argv[at + 1] : undefined;
if (!vault) {
  process.stderr.write('Usage: recall --vault <folder>\n');
  process.exit(2);
}
// The bundle is CommonJS, so no top-level await.
void (async () => {
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
      continue;
    }
    const answer = await handleRecall(vault, message as Parameters<typeof handleRecall>[1]);
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  }
})();
