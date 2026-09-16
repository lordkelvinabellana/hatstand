import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, X } from 'lucide-react';
import type { Color, ProfileInput } from '../../core/profiles.ts';
import { useApp } from '../api.ts';
import { ShortcutInput } from './ShortcutInput.tsx';

export const profileColors: Color[] = ['teal', 'amber', 'violet', 'blue', 'rose', 'slate'];
export const emptyProfile: Required<ProfileInput> = {
  name: '',
  accountLabel: '',
  color: 'teal',
  icon: 'C',
  hotkey: '',
  workFolder: '',
  openAtStartup: false,
};
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || 'C';
}

export function ProfileEditor(props: { editing: string; onClose(): void }) {
  const { data, pending, run, fire } = useApp();
  const existing = data.profiles.find((p) => p.id === props.editing);
  const [form, setForm] = useState<Required<ProfileInput>>(() =>
    existing
      ? {
          name: existing.name,
          accountLabel: existing.accountLabel,
          color: existing.color,
          icon: existing.icon,
          hotkey: existing.hotkey,
          workFolder: existing.workFolder,
          openAtStartup: existing.openAtStartup,
        }
      : { ...emptyProfile },
  );
  const [iconTouched, setIconTouched] = useState(!!existing);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const isNew = props.editing === 'new';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(
      isNew ? 'create' : 'edit',
      isNew ? form : { id: props.editing, input: form },
      isNew ? 'Profile created. Launch it to sign in.' : 'Profile saved.',
    )
      .then(props.onClose)
      .catch(() => {});
  }

  return (
    <aside className="editor">
      <div className="editor-heading">
        <h2>{isNew ? 'New client profile' : 'Profile details'}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close profile editor"
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className={`avatar editor-avatar ${form.color}`}>{form.icon}</div>
        <label>
          Client name
          <input
            ref={nameRef}
            required
            maxLength={80}
            value={form.name}
            placeholder="e.g. North Studio"
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                icon: iconTouched ? form.icon : initials(e.target.value),
              })
            }
          />
        </label>
        <label>
          Account label <span className="optional">optional</span>
          <input
            maxLength={160}
            value={form.accountLabel}
            placeholder="Work account or email"
            onChange={(e) => setForm({ ...form, accountLabel: e.target.value })}
          />
          <small>A label you enter, not a verified account identity.</small>
        </label>
        <label>
          Initials
          <input
            maxLength={3}
            value={form.icon}
            required
            onChange={(e) => {
              setIconTouched(true);
              setForm({ ...form, icon: e.target.value });
            }}
          />
        </label>
        <fieldset>
          <legend>Profile color</legend>
          <div className="color-options">
            {profileColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-swatch ${color} ${form.color === color ? 'chosen' : ''}`}
                aria-label={color}
                aria-pressed={form.color === color}
                onClick={() => setForm({ ...form, color })}
              >
                {form.color === color && <Check size={17} />}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field-group">
          <span className="field-label">
            Work folder <span className="optional">optional</span>
          </span>
          <div className="path-picker">
            <input aria-label="Work folder" readOnly placeholder="No folder" value={form.workFolder} />
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void run('pickWorkFolder')
                  .then((value) => {
                    if (typeof value === 'string') setForm((current) => ({ ...current, workFolder: value }));
                  })
                  .catch(() => {})
              }
            >
              Browse
            </button>
            {form.workFolder && (
              <button
                type="button"
                className="text-button"
                onClick={() => setForm({ ...form, workFolder: '' })}
              >
                Clear
              </button>
            )}
          </div>
          <small>A shortcut to the client’s files. It does not limit what Claude can access.</small>
        </div>
        <ShortcutInput
          id="profile-hotkey"
          label="Profile shortcut"
          value={form.hotkey}
          onChange={(hotkey) => setForm({ ...form, hotkey })}
          hint="Launches or focuses this client from any app. Backspace clears it."
          error={existing?.hotkeyError}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.openAtStartup}
            onChange={(e) => setForm({ ...form, openAtStartup: e.target.checked })}
          />
          <span>
            Open when Windows starts
            <small>
              {data.settings.startWithWindows
                ? 'Opens with Hatstand at sign-in.'
                : 'Also turn on Start with Windows in Settings.'}
            </small>
          </span>
        </label>
        <button className="primary full-width" disabled={!!pending} type="submit">
          {pending === 'create' || pending === 'edit' ? 'Saving…' : isNew ? 'Create profile' : 'Save changes'}
        </button>
      </form>
      {existing && (
        <details className="advanced">
          <summary>Local storage</summary>
          <p className="path-text">{existing.directory}</p>
          <button type="button" className="secondary" onClick={() => fire('openFolder', { id: existing.id })}>
            <FolderOpen size={15} />
            Open folder
          </button>
          <p>
            {existing.bound
              ? 'An existing folder attached to this profile. Hatstand never removes it.'
              : 'Contains this profile’s signed-in session. Keep it private.'}
          </p>
        </details>
      )}
    </aside>
  );
}
