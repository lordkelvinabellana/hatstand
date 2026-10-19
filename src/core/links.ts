import MiniSearch from 'minisearch';

/**
 * Wikilinks, aliases, backlinks and full-text search over one vault's notes. Pure: the notes window
 * builds this from the texts it loaded, and the tests run it in Node.
 */
export interface NoteText {
  /** Vault-relative, `/`-separated, ending in `.md`. */
  path: string;
  text: string;
}

export const noteName = (file: string) => file.replace(/^.*\//, '').replace(/\.md$/i, '');
const key = (value: string) => value.trim().toLowerCase();

const LINK = /\[\[([^[\]\n]+?)\]\]/g;
/** `[[Note#Heading|label]]` → `Note`. */
export const linkTarget = (inner: string) => inner.split('|')[0].split('#')[0].trim();

export function parseLinks(text: string): string[] {
  return [...text.matchAll(LINK)].map((m) => linkTarget(m[1])).filter(Boolean);
}

const unquote = (value: string) =>
  value
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();

/** Frontmatter `aliases:` (or `alias:`), inline `[a, b]`, a single value, or a `- item` list. */
export function parseAliases(text: string): string[] {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) return [];
  const lines = front[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^alias(es)?\s*:/i.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^alias(es)?\s*:/i, '').trim();
  let values: string[];
  if (inline.startsWith('[')) values = inline.replace(/^\[|\]$/g, '').split(',');
  else if (inline) values = [inline];
  else {
    values = [];
    for (const line of lines.slice(at + 1)) {
      const item = /^\s*-\s*(.*)$/.exec(line);
      if (!item) break;
      values.push(item[1]);
    }
  }
  return values.map(unquote).filter(Boolean);
}

export interface LinkIndex {
  notes: Map<string, NoteText>;
  /** Lower-cased name, alias or path without `.md` → note path. */
  names: Map<string, string>;
  aliases: Map<string, string[]>;
}

export function buildIndex(notes: NoteText[]): LinkIndex {
  const names = new Map<string, string>();
  const aliases = new Map<string, string[]>();
  // Shallower paths first, so a duplicate name resolves to the note nearest the root (as Obsidian does).
  const sorted = [...notes].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
  );
  for (const note of sorted) {
    names.set(key(note.path.replace(/\.md$/i, '')), note.path);
    if (!names.has(key(noteName(note.path)))) names.set(key(noteName(note.path)), note.path);
  }
  // Aliases never take a name a real note already has.
  for (const note of sorted) {
    const list = parseAliases(note.text);
    aliases.set(note.path, list);
    for (const alias of list) if (!names.has(key(alias))) names.set(key(alias), note.path);
  }
  return { notes: new Map(notes.map((n) => [n.path, n])), names, aliases };
}

export const resolveLink = (index: LinkIndex, target: string) => index.names.get(key(target));

/** Notes linking to `file`, with each line that links. */
export function backlinks(index: LinkIndex, file: string) {
  const result: { path: string; lines: string[] }[] = [];
  for (const note of index.notes.values()) {
    if (note.path === file) continue;
    const lines = note.text
      .split('\n')
      .filter((line) => parseLinks(line).some((t) => resolveLink(index, t) === file))
      .map((line) => line.trim());
    if (lines.length) result.push({ path: note.path, lines });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Rewrites `[[old]]`, `[[old|label]]` and `[[old#heading]]` to point at `next`. */
export function renameLinks(text: string, old: string, next: string) {
  return text.replace(LINK, (whole, inner: string) => {
    const target = linkTarget(inner);
    if (key(target) !== key(old)) return whole;
    return `[[${next}${inner.slice(inner.indexOf(target) + target.length)}]]`;
  });
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export function createSearch(index: LinkIndex) {
  const search = new MiniSearch<{ id: string; title: string; aliases: string; text: string }>({
    fields: ['title', 'aliases', 'text'],
    searchOptions: { boost: { title: 3, aliases: 2 }, prefix: true, fuzzy: 0.2 },
  });
  search.addAll(
    [...index.notes.values()].map((n) => ({
      id: n.path,
      title: noteName(n.path),
      aliases: (index.aliases.get(n.path) ?? []).join(' '),
      text: n.text,
    })),
  );
  return (query: string, limit = 50): SearchHit[] =>
    search
      .search(query)
      .slice(0, limit)
      .map((hit) => {
        const text = index.notes.get(hit.id)?.text ?? '';
        const words = hit.terms.map((t) => t.toLowerCase());
        const line =
          text.split('\n').find((l) => words.some((w) => l.toLowerCase().includes(w))) ?? text.slice(0, 120);
        return { path: hit.id, title: noteName(hit.id), snippet: line.trim().slice(0, 160) };
      });
}
