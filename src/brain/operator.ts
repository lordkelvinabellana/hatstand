import { createInterface } from 'node:readline';
import { handleOperator } from '../core/operator.ts';
import { operatorCall } from '../core/operator-server.ts';

const at = process.argv.indexOf('--socket');
const socket = at >= 0 ? process.argv[at + 1] : undefined;
if (!socket) {
  process.stderr.write('Usage: operator --socket <path>\n');
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
    const answer = await handleOperator(
      (tool, args) => operatorCall(socket, tool, args),
      message as Parameters<typeof handleOperator>[1],
    );
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  }
})();
