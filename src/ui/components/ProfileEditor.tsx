import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, FolderOpen, X } from 'lucide-react';
import type { Color, ProfileInput } from '../../core/profiles.ts';
import { speciesNames } from '../../core/sprites.ts';
import { api, useApp } from '../api.ts';
import { PetAvatar } from './PetAvatar.tsx';
import { ShortcutInput } from './ShortcutInput.tsx';

export const profileColors: Color[] = ['teal', 'amber', 'violet', 'blue', 'rose', 'slate'];
export const emptyProfile: Required<ProfileInput> = {
  name: '',
  accountLabel: '',
  color: 'teal',
  icon: 'C',
  pet: 'cat',
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
          pet: existing.pet,
          hotkey: existing.hotkey,
          workFolder: existing.workFolder,
          openAtStartup: existing.openAtStartup,
        }
      : { ...emptyProfile, pet: speciesNames[data.profiles.length % speciesNames.length] },
  );
  const [iconTouched, setIconTouched] = useState(!!existing);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
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

  const title = isNew ? 'New client profile' : 'Profile details';
  return (
    // A native modal dialog: focus stays inside, Escape closes it, and the page behind is inert.
    <dialog
      ref={dialogRef}
      className="editor"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="editor-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close profile editor"
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="editor-body">
        <form id="profile-form" onSubmit={submit}>
          <PetAvatar pet={form.pet} color={form.color} icon={form.icon} className="editor-avatar" />
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
          <fieldset>
            <legend>Pet</legend>
            <div className="pet-options">
              {[...speciesNames, ''].map((pet) => (
                <button
                  key={pet || 'initials'}
                  type="button"
                  className={`pet-option ${form.pet === pet ? 'chosen' : ''}`}
                  aria-label={pet || 'Initials, no pet'}
                  aria-pressed={form.pet === pet}
                  title={pet || 'Initials'}
                  onClick={() => setForm({ ...form, pet })}
                >
                  <PetAvatar pet={pet} color={form.color} icon={form.icon} />
                </button>
              ))}
            </div>
            <small>
              {data.platform === 'darwin'
                ? 'Also lives in the menu bar and tells you when this account needs you.'
                : 'Shown as this profile’s picture.'}
            </small>
          </fieldset>
          {form.pet === '' && (
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
          )}
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
                      if (typeof value === 'string')
                        setForm((current) => ({ ...current, workFolder: value }));
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
              {data.platform === 'darwin' ? 'Open at login' : 'Open when Windows starts'}
              <small>
                {data.settings.startWithWindows
                  ? 'Opens with Hatstand at sign-in.'
                  : 'Also enable startup in Settings.'}
              </small>
            </span>
          </label>
        </form>
        {existing && (
          <details className="advanced" open={existing.brain.enabled}>
            <summary>Second brain</summary>
            {existing.brain.external ? (
              <p>
                This profile already runs its own capture.py hooks, so Hatstand leaves its notes setup alone.
              </p>
            ) : (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={existing.brain.enabled}
                    disabled={!!pending}
                    onChange={(e) =>
                      fire(
                        'brain',
                        { id: existing.id, enabled: e.target.checked },
                        e.target.checked
                          ? 'Second brain on. New Claude Code sessions write notes to this profile’s vault.'
                          : 'Second brain off. Your notes are kept.',
                      )
                    }
                  />
                  <span>
                    Keep notes from Claude Code sessions
                    <small>
                      Logs each session and asks Claude to keep client, project, people and tool notes. Only
                      this profile can see this vault.
                    </small>
                  </span>
                </label>
                <p className="path-text">{existing.brain.folder}</p>
                <div className="path-picker">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => fire('newVault', { id: existing.id })}
                  >
                    New vault…
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => fire('adoptVault', { id: existing.id })}
                  >
                    Use existing folder…
                  </button>
                  {existing.brain.vault && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        fire('resetVault', { id: existing.id }, 'Using the default vault folder.')
                      }
                    >
                      Use default
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => fire('openVault', { id: existing.id })}
                  >
                    <FolderOpen size={15} />
                    Open vault
                  </button>
                </div>
                <p>Switching folders never moves or deletes notes; you can copy them over.</p>
                {existing.brain.enabled && <Templates id={existing.id} folder={existing.brain.folder} />}
                <p>Turning it off removes the hooks and Claude instructions. Notes are never deleted.</p>
              </>
            )}
          </details>
        )}
        {existing && (
          <details className="advanced">
            <summary>Local storage</summary>
            <p className="path-text">{existing.directory}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => fire('openFolder', { id: existing.id })}
            >
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
      </div>
      <div className="editor-footer">
        <button type="button" className="secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button className="primary" form="profile-form" disabled={!!pending} type="submit">
          {pending === 'create' || pending === 'edit' ? 'Saving…' : isNew ? 'Create profile' : 'Save changes'}
        </button>
      </div>
    </dialog>
  );
}

/** Same names as TEMPLATE_NAMES in core/vault.ts (a Node module the UI can't import); main validates them. */
const templateNames = ['Client', 'Project', 'Person', 'Tool', 'To-Do format'];

/** Edits the vault's `_templates/` files; each can go back to Hatstand's default. */
function Templates(props: { id: string; folder: string }) {
  const { pending, run } = useApp();
  const [name, setName] = useState(templateNames[0]);
  const [saved, setSaved] = useState<{ text: string; edited: boolean } | null>(null);
  const [text, setText] = useState('');
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the vault moves or after a save or restore.
  useEffect(() => {
    let live = true;
    api
      .request('template', { id: props.id, name })
      .then((value) => {
        if (!live) return;
        const template = value as { text: string; edited: boolean };
        setSaved(template);
        setText(template.text);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [props.id, props.folder, name, version]);
  const reload = () => setVersion((v) => v + 1);

  return (
    <div className="template-editor">
      <label>
        Template {saved?.edited && <small>(edited)</small>}
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {templateNames.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <textarea
        aria-label={`${name} template`}
        value={text}
        spellCheck={false}
        disabled={!saved}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="path-picker">
        <button
          type="button"
          className="secondary"
          disabled={!!pending || !saved || text === saved.text}
          onClick={() =>
            run('saveTemplate', { id: props.id, name, text }, `${name} template saved.`)
              .then(reload)
              .catch(() => {})
          }
        >
          Save template
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!!pending || !saved?.edited}
          onClick={() =>
            run('resetTemplate', { id: props.id, name })
              .then(reload)
              .catch(() => {})
          }
        >
          Restore default
        </button>
      </div>
      <p>
        New notes start from these. <code>{'{{title}}'}</code> and <code>{'{{date}}'}</code> are filled in.
      </p>
    </div>
  );
}
