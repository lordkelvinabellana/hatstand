import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { NotesPreview, ProfileView } from '../../shared.ts';
import { useApp } from '../api.ts';
import { PetAvatar } from './PetAvatar.tsx';

/** One vault as the Second brain page shows it: a folder and the profiles writing to it. */
export interface VaultEntry {
  folder: string;
  name: string;
  profiles: ProfileView[];
}

/** Groups profiles with their second brain on by vault folder; a shared vault appears once. */
export function vaultEntries(profiles: ProfileView[]): VaultEntry[] {
  const vaults = new Map<string, VaultEntry>();
  for (const p of profiles) {
    if (p.archived || !p.brain.enabled || p.brain.external) continue;
    const entry = vaults.get(p.brain.folder);
    if (entry) entry.profiles.push(p);
    else vaults.set(p.brain.folder, { folder: p.brain.folder, name: '', profiles: [p] });
  }
  for (const v of vaults.values()) v.name = v.profiles.map((p) => p.name).join(' + ');
  return [...vaults.values()];
}

function Modal(props: {
  title: string;
  onClose(): void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      className="editor vault-dialog"
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="editor-heading">
        <h2>{props.title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={props.onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="editor-body">{props.children}</div>
      <div className="editor-footer">{props.footer}</div>
    </dialog>
  );
}

/** Gives a profile a second brain: its own vault, a vault another profile shares, or an existing folder. */
export function SetupVault(props: { profile: ProfileView; onClose(): void }) {
  const { data, run } = useApp();
  const vaults = vaultEntries(data.profiles);
  const [choice, setChoice] = useState<string>('own');
  const [busy, setBusy] = useState(false);
  const { profile } = props;

  async function submit() {
    setBusy(true);
    try {
      if (choice === 'own')
        await run('brain', { id: profile.id, enabled: true }, `${profile.name} now keeps its own notes.`);
      else if (choice === 'folder') {
        await run('adoptVault', { id: profile.id });
        await run(
          'brain',
          { id: profile.id, enabled: true },
          `${profile.name} now keeps notes in that folder.`,
        );
      } else {
        const owner = vaults.find((v) => v.folder === choice)?.profiles[0];
        if (owner)
          await run(
            'shareVault',
            { id: owner.id, with: [profile.id] },
            `${profile.name} now shares that vault.`,
          );
      }
      props.onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Second brain for ${profile.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
            {choice === 'folder' ? 'Choose folder…' : 'Turn on'}
          </button>
        </>
      }
    >
      <p className="vault-lead">
        Claude Code sessions in this profile will log themselves and keep client, project, people and tool
        notes. This works in Claude’s Code tab only; regular chats aren’t captured.
      </p>
      <div className="choice-list" role="radiogroup" aria-label="Where notes go">
        <label className={`choice ${choice === 'own' ? 'chosen' : ''}`}>
          <input type="radio" name="vault" checked={choice === 'own'} onChange={() => setChoice('own')} />
          <span>
            <strong>Its own vault</strong>
            <small>Recommended. Only this profile sees these notes.</small>
          </span>
        </label>
        {vaults.map((v) => (
          <label key={v.folder} className={`choice ${choice === v.folder ? 'chosen' : ''}`}>
            <input
              type="radio"
              name="vault"
              checked={choice === v.folder}
              onChange={() => setChoice(v.folder)}
            />
            <span>
              <strong>Share {v.name}’s vault</strong>
              <small>For accounts that do the same work. Both profiles read and write the same notes.</small>
            </span>
            <span className="avatar-stack">
              {v.profiles.map((p) => (
                <PetAvatar key={p.id} pet={p.pet} color={p.color} icon={p.icon} />
              ))}
            </span>
          </label>
        ))}
        <label className={`choice ${choice === 'folder' ? 'chosen' : ''}`}>
          <input
            type="radio"
            name="vault"
            checked={choice === 'folder'}
            onChange={() => setChoice('folder')}
          />
          <span>
            <strong>An existing notes folder</strong>
            <small>For example an Obsidian vault. Hatstand only adds what’s missing.</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}

/** Lets other profiles write to a vault. Their own vaults are left as they are. */
export function ShareVault(props: { vault: VaultEntry; onClose(): void }) {
  const { data, run } = useApp();
  const inside = new Set(props.vault.profiles.map((p) => p.id));
  const others = data.profiles.filter((p) => !p.archived && !inside.has(p.id) && !p.brain.external);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await run(
        'shareVault',
        { id: props.vault.profiles[0].id, with: [...picked] },
        `Vault shared with ${others
          .filter((p) => picked.has(p.id))
          .map((p) => p.name)
          .join(' and ')}.`,
      );
      props.onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Share ${props.vault.name}’s vault`}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !picked.size}
            onClick={() => void submit()}
          >
            Share
          </button>
        </>
      }
    >
      <p className="vault-lead">
        The profiles you pick write their Claude Code notes here too, and see everything in it. Their own
        vaults stay where they are; you can copy their notes in.
      </p>
      {others.length ? (
        <div className="choice-list">
          {others.map((p) => (
            <label key={p.id} className={`choice ${picked.has(p.id) ? 'chosen' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={() => {
                  const next = new Set(picked);
                  if (!next.delete(p.id)) next.add(p.id);
                  setPicked(next);
                }}
              />
              <PetAvatar pet={p.pet} color={p.color} icon={p.icon} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.brain.enabled
                    ? `Leaves its own vault (${p.brain.sharedWith.length ? 'shared' : 'kept as is'})`
                    : 'No second brain yet'}
                </small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p>Every other profile already uses this vault.</p>
      )}
    </Modal>
  );
}

const actionText: Record<string, string> = {
  add: 'New',
  update: 'Updated',
  merge: 'Updated (section rebuilt from your sessions)',
  conflict: 'Changed on both: yours stays, theirs is saved next to it',
  keep: 'Yours is newer: kept',
  deleted: 'You deleted it: stays deleted',
};

/** Shows what importing a notes file would do, and writes it only when asked. Nothing is ever deleted. */
export function ImportNotes(props: { vault: VaultEntry; preview: NotesPreview; onClose(): void }) {
  const { run } = useApp();
  const { preview } = props;
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const counts = preview.counts;
  const changes = (counts.add ?? 0) + (counts.update ?? 0) + (counts.merge ?? 0) + (counts.conflict ?? 0);
  const summary = [
    [counts.add, 'new'],
    [(counts.update ?? 0) + (counts.merge ?? 0), 'updated'],
    [counts.conflict, 'changed on both'],
    [counts.same, 'already the same'],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`)
    .join(' · ');

  async function submit() {
    setBusy(true);
    try {
      await run(
        'applyNotesImport',
        { token: preview.token, anyway },
        'Notes imported. Nothing was deleted or overwritten.',
      );
      props.onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Import notes into ${props.vault.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !changes || (preview.differentVault && !anyway)}
            onClick={() => void submit()}
          >
            Import
          </button>
        </>
      }
    >
      <p className="vault-lead">
        From {preview.device}
        {preview.exportedAt && `, exported ${new Date(preview.exportedAt).toLocaleString()}`}.{' '}
        {summary || 'Nothing to import.'}
      </p>
      {preview.differentVault && (
        <label className="choice chosen">
          <input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
          <span>
            <strong>This file comes from a different vault.</strong>
            <small>Importing it mixes that vault’s notes into this one. Import anyway.</small>
          </span>
        </label>
      )}
      {preview.items.length > 0 && (
        <ul className="import-list">
          {preview.items.map((item) => (
            <li key={item.path}>
              <span className="path-text">{item.path}</span>
              <small>{actionText[item.action] ?? item.action}</small>
            </li>
          ))}
        </ul>
      )}
      {preview.rejected.length > 0 && (
        <>
          <p className="vault-lead">Skipped, not imported:</p>
          <ul className="import-list">
            {preview.rejected.map((item) => (
              <li key={item.path}>
                <span className="path-text">{item.path}</span>
                <small>{item.reason}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
