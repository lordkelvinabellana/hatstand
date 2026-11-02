import { ASK_LIMIT } from './ask.ts';

export const OPERATOR_SERVER = 'hatstand-operator';
export type OperatorBridge = (tool: string, args: Record<string, unknown>) => Promise<string>;
const VERSION = '2025-06-18';

const tools = [
  {
    name: 'list_profiles',
    description: 'Lists Hatstand profiles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sessions',
    description: 'Lists live Claude Code sessions in a profile.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string' } }, required: ['profile'] },
  },
  {
    name: 'start_session',
    description:
      "Opens a NEW Claude Code session inside that profile's own Claude app and never sends messages anywhere itself. The new session may act on the user's behalf, so prompts must state exactly what to do and say to ask the user before sending any message externally.",
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string' },
        prompt: { type: 'string', maxLength: ASK_LIMIT },
        folder: { type: 'string', maxLength: 1000, description: 'Optional absolute path.' },
      },
      required: ['profile', 'prompt'],
    },
  },
];

async function callTool(bridge: OperatorBridge, tool: string, args: Record<string, unknown>) {
  const text = (key: string) => {
    if (typeof args[key] !== 'string' || !(args[key] as string).trim())
      throw new Error(`“${key}” is required.`);
    return (args[key] as string).trim();
  };
  switch (tool) {
    case 'list_profiles':
      return bridge(tool, {});
    case 'list_sessions':
      return bridge(tool, { profile: text('profile') });
    case 'start_session': {
      const profile = text('profile');
      const prompt = text('prompt');
      if (prompt.length > ASK_LIMIT) throw new Error(`Keep the prompt under ${ASK_LIMIT} characters.`);
      const clean: Record<string, unknown> = { profile, prompt };
      if (args.folder !== undefined) {
        const folder = text('folder');
        if (!folder.startsWith('/') || folder.length > 1000)
          throw new Error('Folder must be an absolute path of at most 1000 characters.');
        clean.folder = folder;
      }
      return bridge(tool, clean);
    }
    default:
      throw new Error(`Unknown tool “${tool}”.`);
  }
}

type Message = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** Answers one JSON-RPC message; null for notifications, which get no reply. */
export async function handleOperator(bridge: OperatorBridge, message: Message): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: '2.0', id: message.id ?? null, result });
  if (message.id === undefined) return null;
  switch (message.method) {
    case 'initialize': {
      const asked = message.params?.protocolVersion;
      return reply({
        protocolVersion: typeof asked === 'string' ? asked : VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: OPERATOR_SERVER, version: '1.0.0' },
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools });
    case 'tools/call': {
      const params = message.params ?? {};
      try {
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const text = await callTool(bridge, String(params.name), args);
        return reply({ content: [{ type: 'text', text }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  }
}
