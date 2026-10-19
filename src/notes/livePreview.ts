import { syntaxTree } from '@codemirror/language';
import { EditorState, type Extension, RangeSetBuilder, type Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

/**
 * Obsidian-style live preview: markdown renders in place and its markup is hidden, except on the
 * lines the cursor is on, which show the raw text.
 */

export const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const AUTO = /<!-- auto:(?:start|end) -->/g;
const WIKILINK = /!?\[\[([^[\]\n]+?)\]\]/g;

class Bullet extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    span.textContent = '•';
    return span;
  }
}
class Checkbox extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly at: number,
  ) {
    super();
  }
  eq(other: Checkbox) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

const hide = Decoration.replace({});
const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string, attributes?: Record<string, string>) =>
  Decoration.mark({ class: cls, attributes });

/** Lines (by number) holding a cursor or selection: these show raw markdown. */
function activeLines(state: EditorState) {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
  const text = state.doc.toString();
  const front = FRONTMATTER.exec(text);
  const frontEnd = front ? front[0].length : 0;
  if (front)
    for (let n = 1; n <= state.doc.lineAt(Math.max(0, frontEnd - 1)).number; n++)
      decos.push(line('cm-frontmatter').range(state.doc.line(n).from));

  // Session notes: the block between the auto markers is rewritten by the capture hook.
  const markers = [...text.matchAll(AUTO)];
  for (let i = 0; i + 1 < markers.length; i += 2) {
    const first = state.doc.lineAt(markers[i].index).number;
    const last = state.doc.lineAt(markers[i + 1].index).number;
    for (let n = first; n <= last; n++)
      decos.push(
        line(n === first ? 'cm-auto cm-auto-first' : n === last ? 'cm-auto cm-auto-last' : 'cm-auto').range(
          state.doc.line(n).from,
        ),
      );
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.from < frontEnd) return;
        const name = node.name;
        const raw = isActive(node.from);
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          decos.push(line(`cm-h cm-h${heading[1]}`).range(state.doc.lineAt(node.from).from));
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            const after = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            if (!raw && state.doc.lineAt(node.from).text.startsWith('#'))
              decos.push(hide.range(node.from, after));
            else decos.push(mark('cm-md-mark').range(node.from, node.to));
            break;
          }
          case 'StrongEmphasis':
            decos.push(mark('cm-strong').range(node.from, node.to));
            break;
          case 'Emphasis':
            decos.push(mark('cm-em').range(node.from, node.to));
            break;
          case 'Strikethrough':
            decos.push(mark('cm-strike').range(node.from, node.to));
            break;
          case 'InlineCode':
            decos.push(mark('cm-inline-code').range(node.from, node.to));
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark':
          case 'CodeMark':
            if (node.node.parent?.name === 'FencedCode') break;
            decos.push((raw ? mark('cm-md-mark') : hide).range(node.from, node.to));
            break;
          case 'Link': {
            // `[[Note]]` also parses as a link inside brackets; wikilinks are handled below.
            if (
              state.doc.sliceString(node.from - 1, node.from) === '[' ||
              state.doc.sliceString(node.from, node.from + 2) === '[['
            )
              return false;
            const url = node.node.getChild('URL');
            const href = url ? state.doc.sliceString(url.from, url.to) : '';
            decos.push(mark('cm-md-link', { 'data-href': href }).range(node.from, node.to));
            if (!raw) {
              for (const part of node.node.getChildren('LinkMark')) {
                // Hide `](url)` as one piece; the opening `[` alone.
                if (state.doc.sliceString(part.from, part.to) === ']') {
                  decos.push(hide.range(part.from, node.to));
                  break;
                }
                decos.push(hide.range(part.from, part.to));
              }
            }
            return false;
          }
          case 'FencedCode':
            for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++)
              decos.push(line('cm-codeblock').range(state.doc.line(n).from));
            break;
          case 'CodeInfo':
            decos.push(mark('cm-md-mark').range(node.from, node.to));
            break;
          case 'Blockquote':
            for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++)
              decos.push(line('cm-quote').range(state.doc.line(n).from));
            break;
          case 'QuoteMark':
            decos.push((raw ? mark('cm-md-mark') : hide).range(node.from, node.to));
            break;
          case 'HorizontalRule':
            decos.push(line('cm-hr').range(state.doc.lineAt(node.from).from));
            if (!raw) decos.push(hide.range(node.from, node.to));
            break;
          case 'ListMark': {
            const task = node.node.nextSibling?.firstChild;
            const isTask = task?.name === 'TaskMarker';
            if (!raw && !isTask && /^[-*+]$/.test(state.doc.sliceString(node.from, node.to)))
              decos.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
            else decos.push(mark('cm-list-mark').range(node.from, node.to));
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            if (raw) decos.push(mark('cm-md-mark').range(node.from, node.to));
            else {
              // The list mark before the checkbox goes too, as in Obsidian.
              const lineStart = state.doc.lineAt(node.from);
              const listMark = /^(\s*)[-*+] /.exec(lineStart.text);
              const start = listMark ? lineStart.from + listMark[1].length : node.from;
              decos.push(
                Decoration.replace({ widget: new Checkbox(checked, node.from) }).range(start, node.to),
              );
            }
            if (checked) {
              const end = state.doc.lineAt(node.to).to;
              if (end > node.to + 1) decos.push(mark('cm-task-done').range(node.to + 1, end));
            }
            break;
          }
        }
      },
    });

    // Wikilinks are not markdown syntax, so they're found by pattern, line by line.
    for (let pos = from; pos <= to; ) {
      const l = state.doc.lineAt(pos);
      if (l.from >= frontEnd)
        for (const m of l.text.matchAll(WIKILINK)) {
          const start = l.from + m.index;
          const end = start + m[0].length;
          const inner = m[1];
          const pipe = inner.indexOf('|');
          const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).split('#')[0].trim();
          const linkMark = mark('cm-wikilink', { 'data-link': target });
          if (active.has(l.number)) decos.push(linkMark.range(start, end));
          else {
            const labelFrom =
              pipe >= 0 ? start + m[0].indexOf('[[') + 2 + pipe + 1 : start + m[0].indexOf('[[') + 2;
            const labelTo = end - 2;
            decos.push(hide.range(start, labelFrom));
            decos.push(linkMark.range(labelFrom, labelTo));
            decos.push(hide.range(labelTo, end));
          }
        }
      pos = l.to + 1;
    }
  }
  // Ranges must be added in order; line decorations sort before marks at the same position.
  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  let lastHidden = -1;
  for (const d of decos) {
    // Overlapping replacements (e.g. a hidden mark inside a hidden link) would throw; keep the first.
    const replacing = (d.value.spec as { widget?: unknown }).widget !== undefined || d.value === hide;
    if (replacing && d.from < lastHidden) continue;
    builder.add(d.from, d.to, d.value);
    if (replacing) lastHidden = d.to;
  }
  return builder.finish();
}

const preview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet)
        this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** The auto-block marker lines can't be edited by hand (reloads from disk pass `filter: false`). */
const protectMarkers = EditorState.changeFilter.of((tr) => {
  const text = tr.startState.doc.toString();
  for (const m of text.matchAll(AUTO))
    if (tr.changes.touchesRange(m.index + 1, m.index + m[0].length - 1)) return false;
  return true;
});

export function livePreview(openLink: (target: string) => void, openUrl: (href: string) => void): Extension {
  return [
    preview,
    protectMarkers,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const el = event.target as HTMLElement;
        const link = el.closest<HTMLElement>('[data-link], [data-href]');
        if (!link || event.button !== 0) return false;
        const pos = view.posAtDOM(link);
        // On the line being edited a plain click places the cursor; Cmd/Ctrl-click follows the link.
        const raw = activeLines(view.state).has(view.state.doc.lineAt(pos).number);
        if (raw && !(event.metaKey || event.ctrlKey)) return false;
        event.preventDefault();
        if (link.dataset.link !== undefined) openLink(link.dataset.link);
        else if (link.dataset.href) openUrl(link.dataset.href);
        return true;
      },
    }),
  ];
}
