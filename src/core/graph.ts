import { type LinkIndex, noteName, parseLinks, resolveLink } from './links.ts';

/**
 * The vault as a graph: notes are nodes, [[wikilinks]] are edges. Built from step 3's link index, so it
 * resolves names and aliases exactly as the editor does. Pure: the graph view draws it, the tests run it in Node.
 */
export const GROUPS = ['Clients', 'Projects', 'People', 'Tools', 'Sessions', 'Daily', 'Other'] as const;
export type Group = (typeof GROUPS)[number];

export interface GraphNode {
  /** The note's vault path, or `ghost:<target>` for a link to a note that doesn't exist. */
  id: string;
  label: string;
  group: Group;
  /** Distinct notes this one links to or is linked from. */
  links: number;
  ghost: boolean;
}
export interface GraphData {
  nodes: GraphNode[];
  /** Undirected, one per linked pair. */
  edges: [string, string][];
}

export const groupOf = (path: string): Group => {
  const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  return (GROUPS as readonly string[]).includes(top) ? (top as Group) : 'Other';
};
// Templates are full of placeholder links; they'd tie every client to `{{title}}`.
const skip = (path: string) => path.startsWith('_templates/');

export function buildGraph(index: LinkIndex): GraphData {
  const nodes = new Map<string, GraphNode>();
  for (const path of index.notes.keys())
    if (!skip(path))
      nodes.set(path, { id: path, label: noteName(path), group: groupOf(path), links: 0, ghost: false });
  const edges = new Map<string, [string, string]>();
  for (const note of index.notes.values()) {
    if (skip(note.path)) continue;
    for (const target of parseLinks(note.text)) {
      let to = resolveLink(index, target);
      if (to && skip(to)) continue;
      if (!to) {
        to = `ghost:${target.toLowerCase()}`;
        if (!nodes.has(to)) nodes.set(to, { id: to, label: target, group: 'Other', links: 0, ghost: true });
      }
      if (to === note.path) continue;
      const pair: [string, string] = note.path < to ? [note.path, to] : [to, note.path];
      const key = pair.join('\n');
      if (edges.has(key)) continue;
      edges.set(key, pair);
      nodes.get(pair[0])!.links++;
      nodes.get(pair[1])!.links++;
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export interface GraphFilter {
  hidden: ReadonlySet<Group>;
  ghosts: boolean;
  orphans: boolean;
}

/** Drops hidden folders and (unless asked for) ghost links; orphans are judged on what is left. */
export function filterGraph(graph: GraphData, filter: GraphFilter): GraphData {
  const keep = new Set(
    graph.nodes.filter((n) => (n.ghost ? filter.ghosts : !filter.hidden.has(n.group))).map((n) => n.id),
  );
  const edges = graph.edges.filter(([a, b]) => keep.has(a) && keep.has(b));
  const linked = new Set(edges.flat());
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id) && (filter.orphans || linked.has(n.id))),
    edges,
  };
}

/** The note and everything within `depth` links of it. */
export function localGraph(graph: GraphData, center: string, depth: number): GraphData {
  const near = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = near.get(from);
    if (list) list.push(to);
    else near.set(from, [to]);
  };
  for (const [a, b] of graph.edges) {
    add(a, b);
    add(b, a);
  }
  if (!graph.nodes.some((n) => n.id === center)) return { nodes: [], edges: [] };
  const seen = new Set([center]);
  let ring = [center];
  for (let d = 0; d < depth; d++) {
    ring = ring.flatMap((id) => near.get(id) ?? []).filter((id) => !seen.has(id) && seen.add(id));
  }
  return {
    nodes: graph.nodes.filter((n) => seen.has(n.id)),
    edges: graph.edges.filter(([a, b]) => seen.has(a) && seen.has(b)),
  };
}

/** Node ids whose name contains the query (case-insensitive); null when there's no query. */
export function matchNodes(graph: GraphData, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return new Set(graph.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
}
