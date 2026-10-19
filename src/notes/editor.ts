import { autocompletion, type CompletionContext, closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { Annotation, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view';
import { noteName, type LinkIndex } from '../core/links.ts';
import { livePreview } from './livePreview.ts';

export interface EditorHooks {
  /** The current link index, for `[[` completion. */
  index(): LinkIndex;
  changed(text: string): void;
  openLink(target: string): void;
  openUrl(href: string): void;
}

/** `[[` completes note names and aliases; an alias inserts `Name|alias`. */
function wikilinkCompletion(hooks: EditorHooks) {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/\[\[[^[\]|#\n]*/);
    if (!match) return null;
    const index = hooks.index();
    const options = [];
    for (const path of index.notes.keys()) {
      const name = noteName(path);
      options.push({
        label: name,
        detail: path.includes('/') ? path.replace(/\/[^/]*$/, '') : '',
        apply: name,
      });
      for (const alias of index.aliases.get(path) ?? [])
        options.push({ label: alias, detail: `→ ${name}`, apply: `${name}|${alias}` });
    }
    return {
      from: match.from + 2,
      options: options.map((o) => ({
        ...o,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          // Close the link unless closeBrackets (or the user) already did.
          const closed = view.state.sliceDoc(to, to + 2) === ']]';
          const insert = closed ? o.apply : `${o.apply}]]`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length + (closed ? 2 : 0) },
          });
        },
      })),
      validFor: /^[^[\]|#\n]*$/,
    };
  };
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'var(--surface)', color: 'var(--ink)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65', padding: '28px 0 40vh' },
  '.cm-content': { maxWidth: '760px', margin: '0 auto', padding: '0 32px', caretColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft) !important',
  },
  '.cm-tooltip': { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent-soft)', color: 'var(--ink)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '8px' },
});

export function editorExtensions(hooks: EditorHooks): Extension {
  return [
    history(),
    drawSelection(),
    closeBrackets(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    autocompletion({ override: [wikilinkCompletion(hooks)], icons: false }),
    keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    placeholder('Start writing…'),
    livePreview(hooks.openLink, hooks.openUrl),
    theme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.every((t) => t.annotation(fromDisk)))
        hooks.changed(update.state.doc.toString());
    }),
  ];
}

/** Marks a reload from disk: not a user edit, so it isn't saved back, and the marker guard lets it through. */
export const fromDisk = Annotation.define<boolean>();

export const newState = (text: string, extensions: Extension) =>
  EditorState.create({ doc: text, extensions });

/** Replaces the document with the disk text, keeping the cursor where it can. */
export function reload(view: EditorView, text: string) {
  const head = Math.min(view.state.selection.main.head, text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: head },
    annotations: fromDisk.of(true),
    filter: false,
  });
}
