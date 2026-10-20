import { type LinkIndex, resolveLink } from './links.ts';

/**
 * Deep graph: connections between notes that Claude found but nobody linked. The profile's own Claude
 * writes them to one file in the vault; Hatstand only reads it, keeps links between notes that exist,
 * and draws them apart from real [[wikilinks]]. Notes themselves are never changed.
 */
export const INFERRED_FILE = '.hatstand/inferred-links.json';
export const MAX_INFERRED = 300;

export interface InferredLink {
  from: string;
  to: string;
  reason: string;
  confidence: number;
}

/** Resolves a path or note name to a note's path, as wikilinks do; null when no such note. */
function noteOf(index: LinkIndex, value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return null;
  const v = value.trim().replace(/^\[\[|\]\]$/g, '');
  if (index.notes.has(v)) return v;
  if (index.notes.has(`${v}.md`)) return `${v}.md`;
  return resolveLink(index, v.replace(/^.*\//, '').replace(/\.md$/i, '')) ?? null;
}

/** The file Claude wrote, checked: unknown notes, self-links and repeats are dropped; text is capped. */
export function parseInferred(text: string, index: LinkIndex): InferredLink[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(value) ? value : (value as { links?: unknown })?.links;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: InferredLink[] = [];
  for (const item of list) {
    if (out.length >= MAX_INFERRED) break;
    if (!item || typeof item !== 'object') continue;
    const { from, to, reason, confidence } = item as Record<string, unknown>;
    const a = noteOf(index, from);
    const b = noteOf(index, to);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0.5;
    out.push({
      from: a,
      to: b,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '',
      confidence: Math.min(1, Math.max(0, c)),
    });
  }
  return out;
}

/** What the profile's Claude is asked to do. Kept under Claude Desktop's prompt limit. */
export function deepGraphPrompt(today: string) {
  return `Build a deep graph of this notes vault for Hatstand.

1. Read the notes in this folder (use the hatstand-notes tools if you have them, otherwise read the Markdown files). Focus on Clients, Projects, People and Tools; use Sessions and Daily only as evidence.
2. Find meaningful connections between notes that are NOT already linked with [[wikilinks]] in either direction: the same client or project under different names, a tool a project depends on, a person involved in a project, shared problems, decisions or lessons that apply elsewhere. Only connections you can justify from the text.
3. Write them to \`${INFERRED_FILE}\` in this folder (create the folder; replace the file) as JSON:
{"generated": "${today}", "links": [{"from": "Projects/Example.md", "to": "Tools/Example.md", "reason": "One short sentence why", "confidence": 0.8}]}
Use note paths relative to this folder. At most 150 links, strongest first.

Don't create, edit, rename or delete any notes. When done, tell me in two lines how many links you found and the three most surprising.`;
}

/** A new Claude Code session in the vault with the deep-graph prompt filled in. */
export function deepGraphLink(folder: string, today: string) {
  return `claude://code/new?q=${encodeURIComponent(deepGraphPrompt(today))}&folder=${encodeURIComponent(folder)}`;
}
