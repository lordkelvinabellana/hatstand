// Validation for Electron accelerator strings used by global shortcuts.
// https://www.electronjs.org/docs/latest/api/accelerator

const modifierAliases: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
};
const namedKeys = [
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Plus',
  'PrintScreen',
];

function normalizeKey(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (/^num[0-9]$/i.test(key)) return `num${key.slice(3)}`;
  if (/^[`\-=[\];',./\\]$/.test(key)) return key;
  return namedKeys.find((name) => name.toLowerCase() === key.toLowerCase()) ?? null;
}

/** Returns a canonical accelerator, '' for none, or throws for unusable input. */
export function normalizeAccelerator(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Invalid shortcut.');
  const source = value.trim();
  if (!source) return '';
  // "Plus" is the documented spelling for the + key, so '+' is always a separator.
  const parts = source.split('+').map((part) => part.trim());
  const key = normalizeKey(parts.pop() ?? '');
  const modifiers = parts.map((part) => modifierAliases[part.toLowerCase()]);
  if (!key || modifiers.some((modifier) => !modifier) || new Set(modifiers).size !== modifiers.length) {
    throw new Error('That shortcut is not valid. Try something like Ctrl+Alt+1.');
  }
  // A global shortcut without Ctrl/Alt/Super would swallow ordinary typing everywhere.
  if (!modifiers.some((modifier) => modifier !== 'Shift') && !/^F\d+$/.test(key)) {
    throw new Error('Shortcuts need Ctrl, Alt, or the Windows key, so normal typing keeps working.');
  }
  return [...modifiers, key].join('+');
}

/** Case-insensitive identity, treating Ctrl and CommandOrControl as the same key on Windows. */
export function acceleratorKey(value: string): string {
  return value
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Control' : part).toLowerCase())
    .sort()
    .join('+');
}
