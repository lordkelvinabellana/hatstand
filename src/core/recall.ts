import { buildGraph, localGraph } from './graph.ts';
import {
  backlinks,
  buildIndex,
  createSearch,
  type LinkIndex,
  noteName,
  parseLinks,
  resolveLink,
} from './links.ts';
import { readAll } from './notes.ts';

/**
 * The `hatstand-notes` MCP server: read-only recall over one profile's vault, for that profile's Claude.
 * Speaks MCP's JSON-RPC over stdio (one message per line); `src/brain/recall.ts` is the process around it.
 */
export const RECALL_SERVER = 'hatstand-notes';
const VERSION = '2025-06-18';

const tools = [
  {
    name: 'search_notes',
    description:
      "Full-text search of the user's notes vault (names, aliases and text). Returns matching notes with a snippet.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Default 10, at most 50.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Reads a note by its name, an alias, or its path in the vault (e.g. "Clients/Aether").',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
  {
    name: 'note_links',
    description:
      'What a note is connected to: the notes it links to, the notes linking to it (with the linking line), and every note within `depth` links (1 or 2).',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' }, depth: { type: 'number', description: '1 (default) or 2.' } },
      required: ['note'],
    },
  },
];

const find = (index: LinkIndex, note: string) =>
  resolveLink(index, note.replace(/\.md$/i, '')) ??
  (() => {
    throw new Error(`No note called “${note}”. Try search_notes.`);
  })();
const name = (path: string) => noteName(path);

export async function callTool(vault: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const text = (key: string) => {
    if (typeof args[key] !== 'string' || !(args[key] as string).trim())
      throw new Error(`“${key}” is required.`);
    return (args[key] as string).trim();
  };
  const index = buildIndex(await readAll(vault));
  switch (tool) {
    case 'search_notes': {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
      const hits = createSearch(index)(text('query'), limit);
      return hits.length
        ? hits.map((h) => `- [[${h.title}]] (${h.path}): ${h.snippet}`).join('\n')
        : 'No notes match.';
    }
    case 'read_note': {
      const path = find(index, text('note'));
      return `# ${path}\n\n${index.notes.get(path)!.text}`;
    }
    case 'note_links': {
      const path = find(index, text('note'));
      const out = [
        ...new Set(
          parseLinks(index.notes.get(path)!.text).map((t) => resolveLink(index, t) ?? `${t} (missing)`),
        ),
      ];
      const back = backlinks(index, path);
      const depth = Number(args.depth) === 2 ? 2 : 1;
      const near = localGraph(buildGraph(index), path, depth).nodes.filter((n) => n.id !== path && !n.ghost);
      return [
        `# ${name(path)}`,
        '',
        `Links to: ${out.map((p) => (p.endsWith(' (missing)') ? p : `[[${name(p)}]]`)).join(', ') || 'nothing'}`,
        '',
        'Linked from:',
        ...(back.length
          ? back.map((b) => `- [[${name(b.path)}]]: ${b.lines.slice(0, 2).join(' / ')}`)
          : ['- nothing']),
        '',
        `Within ${depth} link${depth === 2 ? 's' : ''}: ${near.map((n) => `[[${n.label}]]`).join(', ') || 'nothing'}`,
      ].join('\n');
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
export async function handleRecall(vault: string, message: Message): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: '2.0', id: message.id ?? null, result });
  if (message.id === undefined) return null;
  switch (message.method) {
    case 'initialize': {
      const asked = message.params?.protocolVersion;
      return reply({
        protocolVersion: typeof asked === 'string' ? asked : VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: RECALL_SERVER, version: '1.0.0' },
        instructions:
          "Read-only access to this user's notes vault (their second brain). Search it before answering " +
          'questions about their clients, projects, people, tools or past sessions, and cite notes as [[Note name]].',
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
        const text = await callTool(vault, String(params.name), args);
        return reply({ content: [{ type: 'text', text }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: (error as Error).message }], isError: true });
      }
    }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  }
}
