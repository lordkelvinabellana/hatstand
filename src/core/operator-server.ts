import * as fs from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';

export interface OperatorActions {
  profiles(): Promise<string>;
  sessions(profile: string): Promise<string>;
  start(profile: string, prompt: string, folder?: string): Promise<string>;
  /** search_notes, read_note and save_note: the vault tools. */
  notes(tool: string, args: Record<string, unknown>): Promise<string>;
  reply(profile: string, session: string, text: string): Promise<string>;
}

// shortcut: Unix sockets only; Windows is not a target for operator tools.
export async function serveOperator(
  socketPath: string,
  actions: OperatorActions,
): Promise<{ close(): Promise<void> }> {
  await fs.unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const server = createServer((socket) => {
    let pending = Buffer.alloc(0);
    let queue = Promise.resolve();
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.includes(10)) {
        const end = pending.indexOf(10);
        if (end > 64 * 1024) return void socket.destroy();
        const line = pending.subarray(0, end).toString('utf8');
        pending = pending.subarray(end + 1);
        let request: { tool: string; args: Record<string, unknown> };
        try {
          request = JSON.parse(line);
          if (
            !request ||
            typeof request.tool !== 'string' ||
            !request.args ||
            typeof request.args !== 'object' ||
            Array.isArray(request.args)
          )
            continue;
        } catch {
          continue;
        }
        queue = queue.then(async () => {
          let reply: object;
          try {
            let text: string;
            const args = request.args;
            switch (request.tool) {
              case 'list_profiles':
                text = await actions.profiles();
                break;
              case 'list_sessions':
                text = await actions.sessions(args.profile as string);
                break;
              case 'start_session':
                text = await actions.start(
                  args.profile as string,
                  args.prompt as string,
                  args.folder as string | undefined,
                );
                break;
              case 'reply_session':
                text = await actions.reply(
                  args.profile as string,
                  args.session as string,
                  args.text as string,
                );
                break;
              case 'search_notes':
              case 'read_note':
              case 'save_note':
                text = await actions.notes(request.tool, args);
                break;
              default:
                throw new Error(`Unknown tool “${request.tool}”.`);
            }
            reply = { ok: true, text };
          } catch (error) {
            reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
          if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`);
        });
      }
      if (pending.length > 64 * 1024) socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  try {
    await fs.chmod(socketPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function operatorCall(
  socketPath: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ tool, args })}\n`));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
            ? "Hatstand isn't running."
            : error.message,
        ),
      );
    });
    socket.on('data', (chunk) => {
      pending += chunk;
      const end = pending.indexOf('\n');
      if (end < 0) return;
      try {
        const reply = JSON.parse(pending.slice(0, end));
        if (reply.ok) resolve(reply.text);
        else reject(new Error(reply.error));
      } catch (error) {
        reject(error);
      }
      socket.destroy();
    });
    socket.on('close', () => reject(new Error('Operator connection closed.')));
  });
}
