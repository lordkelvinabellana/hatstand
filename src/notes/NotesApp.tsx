import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Files,
  Folder,
  FolderPlus,
  ExternalLink,
  Link2,
  Search,
  Sparkles,
  Waypoints,
  Wand2,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  buildGraph,
  filterGraph,
  GROUPS,
  type Group,
  localGraph,
  matchNodes,
  withInferred,
} from '../core/graph.ts';
import { parseInferred } from '../core/inferred.ts';
import { backlinks, buildIndex, createSearch, type NoteText, noteName, resolveLink } from '../core/links.ts';
import { editorExtensions, fromDisk, newState, reload } from './editor.ts';
import { GraphView, type Positions } from './GraphView.tsx';

interface NotesBridge {
  request(profile: string, action: string, payload?: unknown): Promise<unknown>;
  onChange(callback: () => void): () => void;
}
declare global {
  interface Window {
    notes: NotesBridge;
  }
}
/** The open vault's requests, all answered from `profile`'s vault by the main process. */
const forProfile = (profile: string) => ({
  request: (action: string, payload?: unknown) => window.notes.request(profile, action, payload),
  onChange: (callback: () => void) => window.notes.onChange(callback),
});
// shortcut: one notes view is mounted at a time (keyed by profile), so a module binding serves its children.
let api = forProfile('');
const mac = navigator.platform.toLowerCase().includes('mac');
const trashName = mac ? 'Trash' : 'Recycle Bin';

interface Doc {
  state: EditorState;
  /** The disk text the editor last loaded or saved. */
  base: string;
  dirty: boolean;
  /** Disk text that changed under unsaved edits. */
  conflict: string | null;
  timer?: ReturnType<typeof setTimeout>;
  saving?: Promise<void>;
}
interface Vault {
  folders: string[];
  notes: NoteText[];
  /** The deep-graph file Claude wrote (`.hatstand/inferred-links.json`), as text. */
  inferred?: string;
}
type Dialog =
  | { kind: 'note'; folder: string }
  | { kind: 'folder'; folder: string }
  | { kind: 'switch' }
  | null;
interface Menu {
  x: number;
  y: number;
  path: string;
  folder: boolean;
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Where a note made from a built-in template goes when no folder is picked. */
const templateFolders: Record<string, string> = {
  Client: 'Clients',
  Project: 'Projects',
  Person: 'People',
  Tool: 'Tools',
};
const cleanName = (name: string) => name.trim().replace(/\.md$/i, '');

export function NotesApp(props: { profile: string; theme: string }) {
  api = forProfile(props.profile);
  const theme = props.theme;
  const [info, setInfo] = useState<{ name: string; color: string } | null>(null);
  const [vault, setVault] = useState<Vault>({ folders: [], notes: [] });
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState<'files' | 'search' | 'ask'>('files');
  const [notice, setNotice] = useState('');
  const [showLinks, setShowLinks] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  // The graph is a tab of its own: `graphOpen` keeps the tab, `onGraph` shows it instead of the editor.
  const [graphOpen, setGraphOpen] = useState(false);
  const [onGraph, setOnGraph] = useState(false);
  const [hidden, setHidden] = useState<Set<Group>>(new Set());
  const [ghosts, setGhosts] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [graphQuery, setGraphQuery] = useState('');
  const [depth, setDepth] = useState(1);
  const [showAi, setShowAi] = useState(true);
  const globalPositions = useRef<Positions>(new Map());
  const localPositions = useRef<Positions>(new Map());
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const docs = useRef(new Map<string, Doc>());
  const viewRef = useRef<EditorView | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildIndex(vault.notes), [vault.notes]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const search = useMemo(() => (panel === 'search' ? createSearch(index) : null), [index, panel]);
  const inferred = useMemo(() => parseInferred(vault.inferred ?? '', index), [vault.inferred, index]);
  const graph = useMemo(
    () => (showAi ? withInferred(buildGraph(index), inferred) : buildGraph(index)),
    [index, inferred, showAi],
  );
  const shown = useMemo(
    () => filterGraph(graph, { hidden, ghosts, orphans }),
    [graph, hidden, ghosts, orphans],
  );
  const matches = useMemo(() => matchNodes(shown, graphQuery), [shown, graphQuery]);
  const local = useMemo(
    () =>
      active
        ? localGraph(filterGraph(graph, { hidden: new Set(), ghosts, orphans: true }), active, depth)
        : null,
    [graph, active, ghosts, depth],
  );

  const fail = useCallback((err: unknown) => setError((err as Error).message), []);
  const textOf = (path: string, doc: Doc) =>
    (path === activeRef.current && viewRef.current ? viewRef.current.state : doc.state).doc.toString();

  // ---- Saving ----
  // biome-ignore lint/correctness/useExhaustiveDependencies: textOf only reads refs.
  const save = useCallback(
    async (path: string): Promise<void> => {
      const doc = docs.current.get(path);
      if (!doc) return;
      clearTimeout(doc.timer);
      if (doc.saving) {
        await doc.saving;
        return save(path);
      }
      const text = textOf(path, doc);
      if (text === doc.base || doc.conflict !== null) {
        doc.dirty = text !== doc.base;
        return;
      }
      doc.saving = (async () => {
        try {
          const { conflict } = (await api.request('save', { path, text, base: doc.base })) as {
            conflict: string | null;
          };
          if (conflict !== null) doc.conflict = conflict;
          else doc.base = text;
          doc.dirty = textOf(path, doc) !== doc.base;
        } catch (err) {
          fail(err);
        } finally {
          doc.saving = undefined;
          bump();
        }
      })();
      await doc.saving;
    },
    [fail],
  );
  const saveAll = useCallback(() => Promise.all([...docs.current.keys()].map((p) => save(p))), [save]);

  // ---- Loading and live updates ----
  const replaceDoc = (path: string, doc: Doc, text: string) => {
    if (path === activeRef.current && viewRef.current) reload(viewRef.current, text);
    else
      doc.state = doc.state.update({
        changes: { from: 0, to: doc.state.doc.length, insert: text },
        annotations: fromDisk.of(true),
        filter: false,
      }).state;
    doc.base = text;
    doc.dirty = false;
    doc.conflict = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the helpers it calls only read refs and state setters.
  const load = useCallback(async () => {
    try {
      const next = (await api.request('load')) as Vault;
      setVault(next);
      const disk = new Map(next.notes.map((n) => [n.path, n.text]));
      const gone: string[] = [];
      for (const [path, doc] of docs.current) {
        if (doc.saving) continue;
        const text = disk.get(path);
        if (text === undefined) {
          if (!doc.dirty) gone.push(path);
          continue;
        }
        if (text === doc.base) continue;
        const mine = textOf(path, doc);
        if (!doc.dirty) replaceDoc(path, doc, text);
        else if (text === mine) {
          doc.base = text;
          doc.dirty = false;
        } else doc.conflict = text;
      }
      for (const path of gone) closeTab(path, false);
      bump();
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  // ---- Tabs ----
  const show = useCallback((path: string | null) => {
    const view = viewRef.current;
    const previous = activeRef.current;
    if (view && previous && docs.current.has(previous)) docs.current.get(previous)!.state = view.state;
    activeRef.current = path;
    setActive(path);
    setOnGraph(false);
    if (view && path) {
      view.setState(docs.current.get(path)!.state);
      view.focus();
    }
    if (path) {
      // Reveal the note in the tree.
      setOpen((current) => {
        const next = new Set(current);
        for (let p = parentOf(path); p; p = parentOf(p)) next.add(p);
        return next;
      });
      setFolder(parentOf(path));
    }
  }, []);
  const openNote = useCallback(
    async (path: string) => {
      try {
        if (!docs.current.has(path)) {
          const text = (await api.request('read', { path })) as string;
          docs.current.set(path, {
            state: newState(text, extensions.current!),
            base: text,
            dirty: false,
            conflict: null,
          });
          setTabs((t) => (t.includes(path) ? t : [...t, path]));
        }
        show(path);
      } catch (err) {
        fail(err);
      }
    },
    [show, fail],
  );
  function closeTab(path: string, flush = true) {
    const doc = docs.current.get(path);
    if (doc && flush && doc.dirty) void save(path);
    if (doc) clearTimeout(doc.timer);
    docs.current.delete(path);
    setTabs((t) => {
      const next = t.filter((p) => p !== path);
      if (activeRef.current === path) {
        const i = t.indexOf(path);
        activeRef.current = null;
        show(next[Math.min(i, next.length - 1)] ?? null);
      }
      return next;
    });
  }

  const openLink = useCallback(
    async (target: string) => {
      const found = resolveLink(indexRef.current, target);
      if (found) return openNote(found);
      try {
        // A link to a missing note creates it in the vault root (or the folder the link names).
        const created = (await api.request('create', { path: `${target}.md` })) as string;
        await load();
        await openNote(created);
      } catch (err) {
        fail(err);
      }
    },
    [openNote, load, fail],
  );

  // ---- Editor ----
  const extensions = useRef<ReturnType<typeof editorExtensions> | null>(null);
  if (!extensions.current)
    extensions.current = editorExtensions({
      index: () => indexRef.current,
      changed: (text) => {
        const path = activeRef.current;
        const doc = path && docs.current.get(path);
        if (!path || !doc) return;
        const dirty = text !== doc.base;
        if (dirty !== doc.dirty) {
          doc.dirty = dirty;
          bump();
        }
        clearTimeout(doc.timer);
        doc.timer = setTimeout(() => void save(path), 600);
      },
      openLink: (target) => void openLink(target),
      openUrl: (href) => {
        if (/^https?:\/\//i.test(href)) window.open(href);
      },
    });
  useEffect(() => {
    viewRef.current = new EditorView({ parent: host.current!, state: newState('', extensions.current!) });
    return () => viewRef.current?.destroy();
  }, []);

  useEffect(() => {
    void api
      .request('info')
      .then((value) => {
        const i = value as { name: string; color: string };
        setInfo(i);
      })
      .catch(fail);
    void load();
    return api.onChange(() => void load());
  }, [load, fail]);
  const flush = useRef<() => Promise<void>>(async () => {});
  flush.current = async () => {
    for (const [path, doc] of docs.current) if (doc.conflict !== null) await keepBoth(path);
    await saveAll();
  };
  // Leaving the page (another vault, another Hatstand page) saves what's pending.
  useEffect(() => () => void flush.current(), []);
  useEffect(() => {
    // Quitting Hatstand waits for pending saves; edits that conflict are kept as a copy.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const pending = [...docs.current.values()].some((d) => d.dirty || d.saving);
      if (!pending) return;
      event.preventDefault();
      event.returnValue = '';
      void (async () => {
        for (const [path, doc] of docs.current) if (doc.conflict !== null) await keepBoth(path);
        await saveAll();
        window.close();
      })();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        if (activeRef.current) void save(activeRef.current);
      } else if (k === 'o') {
        e.preventDefault();
        setDialog({ kind: 'switch' });
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault();
        setDialog({ kind: 'note', folder });
      } else if (k === 'g' && !e.shiftKey) {
        e.preventDefault();
        setGraphOpen(true);
        setOnGraph(true);
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        setPanel('search');
        setTimeout(() => searchInput.current?.focus());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [save, folder]);

  function openGraph() {
    setGraphOpen(true);
    setOnGraph(true);
  }
  const openFromGraph = (id: string, label: string) =>
    void (id.startsWith('ghost:') ? openLink(label) : openNote(id));

  // ---- Conflicts ----
  async function keepBoth(path: string) {
    const doc = docs.current.get(path);
    if (!doc || doc.conflict === null) return;
    const mine = textOf(path, doc);
    try {
      const copy = (await api.request('create', {
        path: path.replace(/\.md$/i, ' (my edits).md'),
        text: mine,
      })) as string;
      replaceDoc(path, doc, doc.conflict);
      await load();
      if (document.visibilityState === 'visible') await openNote(copy);
    } catch (err) {
      fail(err);
    }
  }
  function reloadTheirs(path: string) {
    const doc = docs.current.get(path);
    if (doc?.conflict != null) replaceDoc(path, doc, doc.conflict);
    bump();
  }
  async function keepMine(path: string) {
    const doc = docs.current.get(path);
    if (doc?.conflict == null) return;
    doc.base = doc.conflict;
    doc.conflict = null;
    await save(path);
  }

  // ---- File operations ----
  async function move(from: string, to: string) {
    if (from === to) return;
    try {
      for (const path of docs.current.keys())
        if (path === from || path.startsWith(`${from}/`)) await save(path);
      const done = await api.request('move', { from, to });
      if (done !== to) return;
      // Re-key open tabs under their new paths.
      const rename = (p: string) =>
        p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p;
      docs.current = new Map([...docs.current].map(([p, d]) => [rename(p), d]));
      setTabs((t) => t.map(rename));
      if (activeRef.current) {
        activeRef.current = rename(activeRef.current);
        setActive(activeRef.current);
      }
      await load();
    } catch (err) {
      fail(err);
    }
  }
  async function trash(path: string) {
    try {
      for (const p of docs.current.keys()) if (p === path || p.startsWith(`${path}/`)) await save(p);
      if (!(await api.request('trash', { path }))) return;
      for (const p of [...docs.current.keys()])
        if (p === path || p.startsWith(`${path}/`)) closeTab(p, false);
      await load();
    } catch (err) {
      fail(err);
    }
  }
  async function createNote(name: string, template: string, inFolder: string) {
    const title = cleanName(name);
    if (!title) return;
    try {
      let text = '';
      let target = inFolder;
      if (template) {
        text = ((await api.request('read', { path: `_templates/${template}.md` })) as string)
          .replaceAll('{{title}}', title)
          .replaceAll('{{date}}', today());
        if (!target) target = templateFolders[template] ?? '';
      }
      const created = (await api.request('create', { path: join(target, `${title}.md`), text })) as string;
      setDialog(null);
      await load();
      await openNote(created);
    } catch (err) {
      fail(err);
    }
  }
  async function createFolder(name: string, inFolder: string) {
    if (!name.trim()) return;
    try {
      const path = join(inFolder, name.trim());
      await api.request('createFolder', { path });
      setDialog(null);
      setOpen((o) => new Set(o).add(path).add(inFolder));
      await load();
    } catch (err) {
      fail(err);
    }
  }

  // ---- Rendering ----
  const templates = vault.notes
    .filter((n) => parentOf(n.path) === '_templates' && noteName(n.path) !== 'To-Do format')
    .map((n) => noteName(n.path));
  const activeDoc = active ? docs.current.get(active) : undefined;
  // Session notes written by the capture hook name the Claude Code session they log.
  const activeText = active ? (index.notes.get(active)?.text ?? '') : '';
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(activeText)?.[1] ?? '';
  const isSession = /^session:\s*[0-9a-f-]{36}\s*$/m.test(front);
  const claudeName = `${info?.name ?? 'this profile'}’s Claude`;
  async function openSession(path: string) {
    try {
      const result = await api.request('openSession', { path });
      setNotice(
        result === 'opened'
          ? ''
          : result === 'missing'
            ? `This session isn’t in ${claudeName} Desktop (it may have run in a terminal). Opened ${claudeName} instead.`
            : `Opened ${claudeName}. Find the session in its Code tab.`,
      );
    } catch (err) {
      fail(err);
    }
  }
  const links = active ? backlinks(index, active) : [];
  const suggested = active
    ? inferred
        .filter((l) => l.from === active || l.to === active)
        .map((l) => ({ ...l, other: l.from === active ? l.to : l.from }))
    : [];

  async function deepGraph() {
    try {
      const result = await api.request('deepGraph');
      setNotice(
        result === 'opened'
          ? `${claudeName} is building the deep graph in a new Code session. Its links show up here, in orange, when it’s done.`
          : `${claudeName} is opening. The deep-graph prompt is on your clipboard: paste it into a new Code session in this vault.`,
      );
    } catch (err) {
      fail(err);
    }
  }

  function tree(prefix: string, depth: number): React.ReactNode {
    const folders = vault.folders.filter((f) => parentOf(f) === prefix);
    const notes = vault.notes.filter((n) => parentOf(n.path) === prefix);
    const pad = { paddingLeft: 10 + depth * 14 };
    const drop = (target: string) => ({
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const from = e.dataTransfer.getData('text/x-note-path');
        const name = from.slice(from.lastIndexOf('/') + 1);
        if (from && target !== from && !target.startsWith(`${from}/`)) void move(from, join(target, name));
      },
    });
    const item = (path: string, isFolder: boolean) => ({
      draggable: renaming !== path,
      onDragStart: (e: React.DragEvent) => e.dataTransfer.setData('text/x-note-path', path),
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, path, folder: isFolder });
      },
    });
    const label = (path: string, text: string) =>
      renaming === path ? (
        <input
          className="n-rename"
          aria-label="New name"
          defaultValue={text}
          // biome-ignore lint/a11y/noAutofocus: renaming starts in the field, like Finder and Explorer.
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRenaming(null);
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={(e) => {
            setRenaming(null);
            const name = e.currentTarget.value.trim().replace(/\.md$/i, '');
            const isNote = path.endsWith('.md');
            if (name && name !== text) void move(path, join(parentOf(path), isNote ? `${name}.md` : name));
          }}
        />
      ) : (
        <span className="n-label">{text}</span>
      );
    return (
      <>
        {folders.map((f) => {
          const expanded = open.has(f);
          return (
            <div key={f} {...drop(f)}>
              <button
                type="button"
                className={`n-row${folder === f ? ' selected' : ''}`}
                style={pad}
                aria-expanded={expanded}
                onClick={() => {
                  setFolder(f);
                  setOpen((o) => {
                    const next = new Set(o);
                    if (expanded) next.delete(f);
                    else next.add(f);
                    return next;
                  });
                }}
                onDoubleClick={() => setRenaming(f)}
                {...item(f, true)}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} />
                {label(f, f.slice(f.lastIndexOf('/') + 1))}
              </button>
              {expanded && tree(f, depth + 1)}
            </div>
          );
        })}
        {notes.map((n) => (
          <button
            type="button"
            key={n.path}
            className={`n-row${active === n.path ? ' active' : ''}`}
            style={{ paddingLeft: 10 + depth * 14 + 18 }}
            onClick={() => void openNote(n.path)}
            onDoubleClick={() => setRenaming(n.path)}
            {...item(n.path, false)}
          >
            <FileText size={14} />
            {label(n.path, noteName(n.path))}
          </button>
        ))}
      </>
    );
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: closes the context menu, which Escape-free keyboard use never opens.
    <div className="n-app" onClick={() => setMenu(null)}>
      <aside className="n-side">
        <header className="n-brand">
          <span className={`n-dot ${info?.color ?? 'teal'}`} />
          <strong>{info?.name ?? 'Notes'}</strong>
        </header>
        <div className="n-tools" role="toolbar" aria-label="Notes">
          <button
            type="button"
            className={panel === 'files' ? 'on' : ''}
            onClick={() => setPanel('files')}
            title="Files"
            aria-label="Files"
          >
            <Files size={16} />
          </button>
          <button
            type="button"
            className={panel === 'search' ? 'on' : ''}
            onClick={() => {
              setPanel('search');
              setTimeout(() => searchInput.current?.focus());
            }}
            title={`Search (${mac ? '⇧⌘F' : 'Ctrl+Shift+F'})`}
            aria-label="Search"
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className={panel === 'ask' ? 'on' : ''}
            onClick={() => setPanel('ask')}
            title="Ask Claude about your notes"
            aria-label="Ask"
          >
            <Sparkles size={16} />
          </button>
          <button
            type="button"
            className={onGraph ? 'on' : ''}
            onClick={openGraph}
            title={`Graph (${mac ? '⌘G' : 'Ctrl+G'})`}
            aria-label="Graph"
          >
            <Waypoints size={16} />
          </button>
          <span className="n-spacer" />
          <button
            type="button"
            onClick={() => setDialog({ kind: 'note', folder })}
            title={`New note (${mac ? '⌘N' : 'Ctrl+N'})`}
            aria-label="New note"
          >
            <FilePlus size={16} />
          </button>
          <button
            type="button"
            onClick={() => setDialog({ kind: 'folder', folder })}
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlus size={16} />
          </button>
        </div>
        {panel === 'files' ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: clicking empty space picks the top folder; keyboard users pick folders by their rows.
          <nav
            className="n-tree"
            aria-label="Notes and folders"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const from = e.dataTransfer.getData('text/x-note-path');
              if (from.includes('/')) void move(from, from.slice(from.lastIndexOf('/') + 1));
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setFolder('');
            }}
          >
            {tree('', 0)}
          </nav>
        ) : panel === 'ask' ? (
          <AskPanel claudeName={claudeName} onError={fail} />
        ) : (
          <div className="n-search">
            <input
              ref={searchInput}
              type="search"
              aria-label="Search notes"
              placeholder="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul>
              {query.trim() &&
                search?.(query).map((hit) => (
                  <li key={hit.path}>
                    <button type="button" onClick={() => void openNote(hit.path)}>
                      <strong>{hit.title}</strong>
                      <span>{hit.snippet}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>

      <main className="n-main">
        <div className="n-tabs" role="tablist">
          {graphOpen && (
            <div className={`n-tab${onGraph ? ' active' : ''}`}>
              <button type="button" role="tab" aria-selected={onGraph} onClick={() => setOnGraph(true)}>
                <Waypoints size={13} /> Graph
              </button>
              <button
                type="button"
                className="n-close"
                aria-label="Close Graph"
                onClick={() => {
                  setGraphOpen(false);
                  setOnGraph(false);
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {tabs.map((path) => {
            const doc = docs.current.get(path);
            return (
              <div key={path} className={`n-tab${path === active && !onGraph ? ' active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={path === active && !onGraph}
                  title={path}
                  onClick={() => show(path)}
                  onAuxClick={(e) => e.button === 1 && closeTab(path)}
                >
                  {noteName(path)}
                  {doc?.dirty && <span className="n-unsaved" role="img" aria-label="Unsaved changes" />}
                </button>
                <button
                  type="button"
                  className="n-close"
                  aria-label={`Close ${noteName(path)}`}
                  onClick={() => closeTab(path)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <span className="n-spacer" />
          <button
            type="button"
            className={`n-links-toggle${showLinks ? ' on' : ''}`}
            onClick={() => setShowLinks((s) => !s)}
            title="Backlinks"
            aria-label="Backlinks"
            aria-pressed={showLinks}
          >
            <Link2 size={16} />
          </button>
        </div>
        {error && (
          <div className="banner error n-banner" role="alert">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {active && activeDoc?.conflict != null && (
          <div className="banner warning n-banner" role="alert">
            <span>This note changed on disk while you were editing it.</span>
            <button type="button" onClick={() => reloadTheirs(active)}>
              Reload theirs
            </button>
            <button type="button" onClick={() => void keepMine(active)}>
              Keep mine
            </button>
            <button type="button" onClick={() => void keepBoth(active)}>
              Keep both
            </button>
          </div>
        )}
        {notice && (
          <div className="banner n-banner" role="status">
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {active && !onGraph && isSession && (
          <div className="n-session">
            <span>Claude Code session</span>
            <button type="button" onClick={() => void openSession(active)}>
              <ExternalLink size={14} /> Open in {claudeName}
            </button>
          </div>
        )}
        <div className="n-body">
          <div className="n-editor" ref={host} hidden={!active || onGraph} />
          {onGraph && (
            <section className="n-graph" aria-label="Graph">
              <div className="n-graph-bar">
                <input
                  type="search"
                  aria-label="Highlight notes"
                  placeholder="Highlight notes"
                  value={graphQuery}
                  onChange={(e) => setGraphQuery(e.target.value)}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={hidden.has('Sessions') && hidden.has('Daily')}
                    onChange={(e) =>
                      setHidden((h) => {
                        const next = new Set(h);
                        for (const g of ['Sessions', 'Daily'] as const)
                          if (e.target.checked) next.add(g);
                          else next.delete(g);
                        return next;
                      })
                    }
                  />
                  Hide Sessions and Daily
                </label>
                <label>
                  <input type="checkbox" checked={!orphans} onChange={(e) => setOrphans(!e.target.checked)} />
                  Hide orphans
                </label>
                <label>
                  <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} />
                  Show missing notes
                </label>
                <label title="Connections Claude found that aren’t linked in your notes">
                  <input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} />
                  AI links{inferred.length ? ` (${inferred.length})` : ''}
                </label>
                <span className="n-spacer" />
                <span className="n-hint">
                  {shown.nodes.length} notes{matches ? `, ${matches.size} match` : ''}
                </span>
                <button
                  type="button"
                  className="secondary n-deep"
                  title="Ask this profile’s Claude to find connections your notes don’t link yet"
                  onClick={() => void deepGraph()}
                >
                  <Wand2 size={14} />
                  {inferred.length ? 'Refresh deep graph' : 'Deep graph'}
                </button>
              </div>
              <GraphView
                data={shown}
                theme={theme}
                active={active}
                highlight={matches}
                positions={globalPositions.current}
                label="Graph of the notes in this vault"
                onOpen={openFromGraph}
              />
              <fieldset className="n-legend" aria-label="Folders">
                {GROUPS.map((g) => (
                  <button
                    type="button"
                    key={g}
                    aria-pressed={!hidden.has(g)}
                    title={hidden.has(g) ? `Show ${g}` : `Hide ${g}`}
                    onClick={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(g)) next.delete(g);
                        else next.add(g);
                        return next;
                      })
                    }
                  >
                    <span className={`n-swatch g-${g.toLowerCase()}`} />
                    {g}
                    <span className="n-count">
                      {graph.nodes.filter((n) => n.group === g && !n.ghost).length}
                    </span>
                  </button>
                ))}
              </fieldset>
            </section>
          )}
          {!active && !onGraph && (
            <div className="n-empty">
              <p>{vault.notes.length ? 'Open a note from the list, or' : 'No notes yet.'}</p>
              <button type="button" className="primary" onClick={() => setDialog({ kind: 'note', folder })}>
                <FilePlus size={16} /> New note
              </button>
              <p className="n-hint">{mac ? '⌘O' : 'Ctrl+O'} to jump to a note</p>
            </div>
          )}
          {showLinks && active && !onGraph && (
            <aside className="n-backlinks" aria-label="Backlinks">
              <div className="n-local">
                <h2>Local graph</h2>
                <fieldset className="n-depth" aria-label="Depth">
                  {[1, 2].map((d) => (
                    <button type="button" key={d} aria-pressed={depth === d} onClick={() => setDepth(d)}>
                      {d}
                    </button>
                  ))}
                </fieldset>
              </div>
              {local && (
                <GraphView
                  compact
                  data={local}
                  theme={theme}
                  active={active}
                  highlight={null}
                  positions={localPositions.current}
                  label={`Notes linked with ${noteName(active)}`}
                  onOpen={openFromGraph}
                />
              )}
              {suggested.length > 0 && (
                <>
                  <h2>AI-suggested links</h2>
                  <ul className="n-suggested">
                    {suggested.map((l) => (
                      <li key={l.other}>
                        <button type="button" onClick={() => void openNote(l.other)}>
                          <strong>{noteName(l.other)}</strong>
                          {l.reason && <span>{l.reason}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h2>Backlinks</h2>
              {links.length ? (
                <ul>
                  {links.map((l) => (
                    <li key={l.path}>
                      <button type="button" onClick={() => void openNote(l.path)}>
                        <strong>{noteName(l.path)}</strong>
                        {l.lines.slice(0, 3).map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="n-hint">No notes link here yet.</p>
              )}
            </aside>
          )}
        </div>
      </main>

      {menu && (
        <div
          className="n-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          ref={(el) => {
            // Keep the menu inside the window, e.g. for a note near the bottom of the tree.
            if (!el) return;
            const r = el.getBoundingClientRect();
            el.style.left = `${Math.max(4, Math.min(menu.x, innerWidth - r.width - 4))}px`;
            el.style.top = `${Math.max(4, Math.min(menu.y, innerHeight - r.height - 4))}px`;
          }}
        >
          {menu.folder && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setDialog({ kind: 'note', folder: menu.path })}
              >
                New note here
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setDialog({ kind: 'folder', folder: menu.path })}
              >
                New folder here
              </button>
            </>
          )}
          <button type="button" role="menuitem" onClick={() => setRenaming(menu.path)}>
            Rename
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => void trash(menu.path)}>
            Move to {trashName}
          </button>
        </div>
      )}
      {dialog?.kind === 'note' && (
        <NewNoteDialog
          folder={dialog.folder}
          templates={templates}
          onCancel={() => setDialog(null)}
          onCreate={(name, template, inFolder) => void createNote(name, template, inFolder)}
        />
      )}
      {dialog?.kind === 'folder' && (
        <NameDialog
          title={dialog.folder ? `New folder in ${dialog.folder}` : 'New folder'}
          action="Create folder"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => void createFolder(name, dialog.folder)}
        />
      )}
      {dialog?.kind === 'switch' && (
        <Switcher
          index={index}
          onCancel={() => setDialog(null)}
          onPick={(path, name) => {
            setDialog(null);
            void (path ? openNote(path) : openLink(name));
          }}
        />
      )}
    </div>
  );
}

/** Sends a question to the profile's own Claude, as a new Code session in the vault with the recall tools. */
function AskPanel(props: { claudeName: string; onError(err: unknown): void }) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await api.request('ask', { question });
      setStatus(
        result === 'opened'
          ? `Asked in ${props.claudeName}: a new Code session in this vault, with your question filled in. Press Return there to send it.`
          : `Opened ${props.claudeName}. The question is on the clipboard: start a Code session in this vault and paste it.`,
      );
      setQuestion('');
    } catch (err) {
      props.onError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="n-ask"
      onSubmit={(e) => {
        e.preventDefault();
        void ask();
      }}
    >
      <label htmlFor="n-ask-question">Ask {props.claudeName} about your notes</label>
      <textarea
        id="n-ask-question"
        rows={5}
        placeholder="What did we decide about pricing for Northwind?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (mac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault();
            void ask();
          }
        }}
      />
      <button type="submit" className="primary" disabled={!question.trim() || busy}>
        <Sparkles size={15} /> Ask
      </button>
      <p className="n-hint">
        Opens in this profile’s own Claude, never another account. It searches and reads this vault and cites
        notes as [[links]].
      </p>
      {status && (
        <p className="n-ask-status" role="status">
          {status}
        </p>
      )}
    </form>
  );
}

function Modal({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  onCancel(): void;
}) {
  return (
    <div
      className="n-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <div className="n-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function NameDialog(props: {
  title: string;
  action: string;
  onCancel(): void;
  onSubmit(name: string): void;
}) {
  const [name, setName] = useState('');
  return (
    <Modal title={props.title} onCancel={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit(name);
        }}
      >
        {/* biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name. */}
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="n-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            {props.action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewNoteDialog(props: {
  folder: string;
  templates: string[];
  onCancel(): void;
  onCreate(name: string, template: string, folder: string): void;
}) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const where = props.folder || (template && templateFolders[template]) || '';
  return (
    <Modal title="New note" onCancel={props.onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onCreate(name, template, props.folder);
        }}
      >
        <label>
          Name
          {/* biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name. */}
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Template
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">Blank note</option>
            {props.templates.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <p className="n-hint">Saved in {where ? `${where}/` : 'the vault’s top folder'}</p>
        <div className="n-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!cleanName(name)}>
            Create note
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Jump to a note by name or alias; Enter on a new name creates it. */
function Switcher(props: {
  index: ReturnType<typeof buildIndex>;
  onCancel(): void;
  /** An existing note's path, or a new note's name. */
  onPick(path: string | null, name: string): void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const q = query.trim().toLowerCase();
  const items = [...props.index.notes.keys()]
    .flatMap((path) => [
      { label: noteName(path), path },
      ...(props.index.aliases.get(path) ?? []).map((alias) => ({ label: alias, path })),
    ])
    .filter((i) => i.label.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, 30);
  return (
    <Modal title="Open note" onCancel={props.onCancel}>
      <input
        aria-label="Note name"
        placeholder="Type a note name"
        value={query}
        // biome-ignore lint/a11y/noAutofocus: the switcher exists to type a name.
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0));
          else if (e.key === 'Enter') {
            const item = items[selected];
            if (item) props.onPick(item.path, item.label);
            else if (cleanName(query)) props.onPick(null, cleanName(query));
          } else return;
          e.preventDefault();
        }}
      />
      <ul className="n-switch">
        {items.map((item, i) => (
          <li key={`${item.path}:${item.label}`}>
            <button
              type="button"
              className={i === selected ? 'on' : ''}
              onClick={() => props.onPick(item.path, item.label)}
            >
              {item.label}
              <span>{item.path.replace(/\.md$/i, '')}</span>
            </button>
          </li>
        ))}
        {!items.length && cleanName(query) && <li className="n-hint">Enter creates “{cleanName(query)}”</li>}
      </ul>
    </Modal>
  );
}
