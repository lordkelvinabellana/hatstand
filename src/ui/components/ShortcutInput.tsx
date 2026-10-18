import type React from 'react';
import { formatShortcut, isMac } from '../api.ts';

const named: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
};
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return named[code] ?? null;
}

/** Records a key combination as an Electron accelerator. The main process validates it on save. */
export function ShortcutInput(props: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  hint?: string;
  error?: string;
}) {
  function record(event: React.KeyboardEvent<HTMLInputElement>) {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === 'Tab' && plain) return;
    event.preventDefault();
    event.stopPropagation();
    if (plain && !event.shiftKey && (event.key === 'Backspace' || event.key === 'Delete')) {
      props.onChange('');
      return;
    }
    if (plain && !event.shiftKey && event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    const key = keyName(event.code);
    if (!key) return; // A modifier on its own: wait for the rest of the combination.
    const modifiers = [
      event.metaKey && isMac && 'Command',
      event.ctrlKey && (isMac ? 'Control' : 'CommandOrControl'),
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && !isMac && 'Super',
    ].filter(Boolean);
    props.onChange([...modifiers, key].join('+'));
  }
  return (
    <div className="shortcut-field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="shortcut-input">
        <input
          id={props.id}
          readOnly
          value={props.value ? formatShortcut(props.value) : ''}
          placeholder="Click, then press keys"
          onKeyDown={record}
          aria-describedby={`${props.id}-hint`}
        />
        {props.value && (
          <button type="button" className="text-button" onClick={() => props.onChange('')}>
            Clear
          </button>
        )}
      </div>
      <small id={`${props.id}-hint`}>{props.hint ?? 'Backspace clears the shortcut.'}</small>
      {props.error && <p className="inline-error">{props.error}</p>}
    </div>
  );
}
