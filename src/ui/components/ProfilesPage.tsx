import type React from 'react';
import { forwardRef, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  GripVertical,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { ProfileView } from '../../shared.ts';
import { formatShortcut, useApp } from '../api.ts';
import { moveByStep, moveToIndex } from '../order.ts';
import { HatMark } from './HatMark.tsx';
import { PetAvatar } from './PetAvatar.tsx';
import { ProfileEditor } from './ProfileEditor.tsx';

export const statusLabels: Record<ProfileView['status'], string> = {
  running: 'Running',
  starting: 'Opening…',
  closing: 'Closing…',
  error: 'Needs attention',
  unknown: 'Unknown',
  stopped: 'Ready to launch',
};

interface Props {
  archive: boolean;
  query: string;
  onQuery(value: string): void;
  editing: string | null;
  onEdit(id: string | null): void;
}

export const ProfilesPage = forwardRef<HTMLInputElement, Props>(function ProfilesPage(props, searchRef) {
  const { data, pending, fire, navigate, openProfile, openVault } = useApp();
  const [menu, setMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const query = props.query.toLowerCase();
  const group = data.profiles.filter((p) => p.archived === props.archive);
  const visible = group.filter((p) => `${p.name} ${p.accountLabel}`.toLowerCase().includes(query));
  const running = data.profiles.filter((p) => p.status === 'running').length;
  const selectedVisible = visible.filter((p) => selected.has(p.id) && !p.archived);
  const canDrag = !props.query && visible.length > 1;
  const startup = data.profiles.filter((p) => p.openAtStartup && !p.archived);

  useEffect(() => {
    if (menu)
      document.querySelector<HTMLButtonElement>(`#menu-${menu} [role="menuitem"]:not(:disabled)`)?.focus();
  }, [menu]);
  function closeMenu() {
    const trigger = menu && document.getElementById(`menu-trigger-${menu}`);
    setMenu(null);
    if (trigger) trigger.focus();
  }
  function menuKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') closeMenu();
    else return;
    if (event.key !== 'Tab') event.preventDefault();
    event.stopPropagation();
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function move(profile: ProfileView, delta: -1 | 1) {
    const ids = moveByStep(data.profiles, profile.id, delta);
    setMenu(null);
    if (ids) fire('reorder', { ids });
  }
  function drop(targetId: string) {
    if (!dragging || dragging === targetId) return;
    const index = group.findIndex((p) => p.id === targetId);
    fire('reorder', { ids: moveToIndex(data.profiles, dragging, index) });
  }
  function act(action: string, payload?: unknown, message?: string) {
    setMenu(null);
    fire(action, payload, message);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{props.archive ? 'Archived profiles' : 'Your clients, in place.'}</h1>
          <p>
            {props.archive
              ? 'Saved for later, with their local data preserved.'
              : 'Separate Claude accounts. One place to switch.'}
          </p>
        </div>
        {!props.archive && (
          <button type="button" className="primary" onClick={() => props.onEdit('new')}>
            <Plus size={17} />
            Add profile
          </button>
        )}
      </div>
      {!data.installation && (
        <div className="banner warning">
          <span>
            {data.installationError ||
              'Claude Desktop wasn’t found. Install it or choose its location in Settings.'}
          </span>
          <button type="button" onClick={() => navigate('settings')}>
            Open Settings <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {data.installation && !data.installationTested && !data.installationConfirmed && (
        <div className="banner warning">
          <span>
            {data.settings.confirmedVersions.length
              ? `Claude updated to ${data.installation.version} (profiles last worked on ${data.settings.confirmedVersions.at(-1)}). Check that each profile still opens in its own account, then mark it as working.`
              : `Claude ${data.installation.version} hasn’t been tested with Hatstand yet. If your profiles open and stay signed in, mark it as working and this won’t show again.`}
          </span>
          <button
            type="button"
            onClick={() =>
              fire(
                'confirmVersion',
                { works: true },
                `Marked Claude ${data.installation?.version} as working. You can undo this under Compatibility.`,
              )
            }
          >
            Works for me
          </button>
          <button type="button" onClick={() => navigate('about')}>
            Details <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {data.processError && <div className="banner warning">{data.processError}</div>}
      <div className="profile-workspace">
        <section className="profiles-panel" aria-label="Client profiles">
          <div className="list-toolbar">
            <label className="search">
              <Search size={17} />
              <input
                ref={searchRef}
                aria-label="Search profiles"
                placeholder="Find a client…"
                value={props.query}
                onChange={(e) => props.onQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && visible[0] && !visible[0].archived)
                    fire('launch', { id: visible[0].id });
                }}
              />
              <kbd>{data.platform === 'darwin' ? '⌘ K' : 'Ctrl K'}</kbd>
            </label>
            {selectedVisible.length > 0 ? (
              <span className="selection-actions">
                <button
                  type="button"
                  className="primary small"
                  disabled={!!pending || !data.installation}
                  onClick={() => {
                    fire('launchMany', { ids: selectedVisible.map((p) => p.id) });
                    setSelected(new Set());
                  }}
                >
                  <Play size={14} />
                  Open {selectedVisible.length} selected
                </button>
                <button type="button" className="text-button" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </span>
            ) : (
              <span className="toolbar-actions">
                {!props.archive && startup.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!pending || !data.installation}
                    title={startup.map((p) => p.name).join(', ')}
                    onClick={() => fire('launchMany', { ids: startup.map((p) => p.id) })}
                  >
                    Open startup group ({startup.length})
                  </button>
                )}
                {running > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!pending}
                    onClick={() => fire('closeAll')}
                  >
                    Close all
                  </button>
                )}
                <span className="running-count">{running} running</span>
              </span>
            )}
          </div>
          <div className="list-head">
            <span>Client</span>
            <span>Desktop</span>
            <span className="sr-only">Actions</span>
          </div>
          {visible.length === 0 ? (
            <div className="empty">
              <HatMark size={32} />
              <h2>
                {props.query
                  ? 'No matching profiles'
                  : props.archive
                    ? 'Nothing archived'
                    : 'Make room for your first client'}
              </h2>
              <p>
                {props.query
                  ? 'Try a client name or account label.'
                  : props.archive
                    ? 'Profiles you archive will appear here.'
                    : 'Create a profile, then sign in inside Claude Desktop.'}
              </p>
              {!props.archive && !props.query && (
                <button type="button" className="primary" onClick={() => props.onEdit('new')}>
                  <Plus size={16} />
                  Create a profile
                </button>
              )}
            </div>
          ) : (
            <div className="profile-list">
              {visible.map((profile) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users open the profile with its name button.
                <article
                  className={`profile-row ${props.editing === profile.id ? 'selected' : ''} ${dragging === profile.id ? 'dragging' : ''} ${dropTarget === profile.id && dragging !== profile.id ? 'drop-target' : ''}`}
                  key={profile.id}
                  // The whole row opens the profile; its own controls (select, drag, launch, menu) keep their jobs.
                  // Keyboard users have the name button, which does the same.
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest(
                        'button, input, a, label, [role="menu"], .drag-handle',
                      )
                    )
                      return;
                    openProfile(profile.id);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    setDropTarget(profile.id);
                  }}
                  onDragLeave={() => setDropTarget((current) => (current === profile.id ? null : current))}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(profile.id);
                    setDragging(null);
                    setDropTarget(null);
                  }}
                >
                  <div className="profile-cell">
                    {canDrag && (
                      <span
                        className="drag-handle"
                        draggable
                        title="Drag to reorder"
                        aria-hidden="true"
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', profile.id);
                          setDragging(profile.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                      >
                        <GripVertical size={15} />
                      </span>
                    )}
                    {!profile.archived && (
                      <input
                        type="checkbox"
                        className="row-select"
                        aria-label={`Select ${profile.name}`}
                        checked={selected.has(profile.id)}
                        onChange={() => toggle(profile.id)}
                      />
                    )}
                    <button
                      type="button"
                      className="profile-identity"
                      onClick={() => openProfile(profile.id)}
                    >
                      <PetAvatar pet={profile.pet} color={profile.color} icon={profile.icon} />
                      <span className="profile-name">
                        <strong>{profile.name}</strong>
                        <span>
                          {profile.accountLabel || 'Account label not set'}
                          {profile.hotkey && <kbd className="row-kbd">{formatShortcut(profile.hotkey)}</kbd>}
                        </span>
                        {profile.hotkeyError && <span className="row-warning">{profile.hotkeyError}</span>}
                      </span>
                    </button>
                  </div>
                  <span className={`profile-status ${profile.status}`} title={profile.message}>
                    <span className="status-dot" />
                    {statusLabels[profile.status]}
                  </span>
                  <div className="profile-actions">
                    {profile.archived ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => fire('archive', { id: profile.id, archived: false })}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={profile.status === 'running' ? 'focus-button' : 'launch-button'}
                        disabled={
                          !!pending ||
                          profile.status === 'starting' ||
                          profile.status === 'closing' ||
                          !data.installation
                        }
                        onClick={() => fire('launch', { id: profile.id })}
                      >
                        {profile.status === 'running' ? 'Focus' : 'Launch'}
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    <div className="menu-anchor">
                      <button
                        type="button"
                        className="icon-button"
                        id={`menu-trigger-${profile.id}`}
                        aria-label={`Actions for ${profile.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menu === profile.id}
                        onClick={() => setMenu(menu === profile.id ? null : profile.id)}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {menu === profile.id && (
                        <>
                          <button
                            type="button"
                            className="menu-backdrop"
                            aria-label="Close actions"
                            onClick={() => setMenu(null)}
                          />
                          <div
                            id={`menu-${profile.id}`}
                            className="actions-menu"
                            role="menu"
                            aria-label={`Actions for ${profile.name}`}
                            onKeyDown={menuKeys}
                          >
                            <button type="button" role="menuitem" onClick={() => props.onEdit(profile.id)}>
                              Edit profile
                            </button>
                            {!profile.brain.external && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setMenu(null);
                                  openVault(profile.id);
                                }}
                              >
                                Second brain
                              </button>
                            )}
                            {profile.workFolder && (
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => act('openWorkFolder', { id: profile.id })}
                              >
                                Open work folder
                              </button>
                            )}
                            {data.platform === 'win32' && (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!data.packaged}
                                title={data.packaged ? undefined : 'Available in the installed app'}
                                onClick={() =>
                                  act('shortcut', { id: profile.id }, 'Desktop shortcut created.')
                                }
                              >
                                Create desktop shortcut
                              </button>
                            )}
                            <button type="button" role="menuitem" onClick={() => move(profile, -1)}>
                              <ArrowUp size={14} />
                              Move up
                            </button>
                            <button type="button" role="menuitem" onClick={() => move(profile, 1)}>
                              <ArrowDown size={14} />
                              Move down
                            </button>
                            {profile.status === 'running' && (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => act('restart', { id: profile.id })}
                                >
                                  Restart Claude
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => act('close', { id: profile.id })}
                                >
                                  Close Claude
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => act('forceClose', { id: profile.id })}
                                >
                                  Force close…
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => act('archive', { id: profile.id, archived: !profile.archived })}
                            >
                              {profile.archived ? 'Restore profile' : 'Archive profile'}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="danger-text"
                              onClick={() => act('remove', { id: profile.id })}
                            >
                              Remove profile…
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="list-footer">
            <span>
              <ShieldCheck size={15} />
              Sign in happens in Claude.
            </span>
            <span>Hatstand never asks for your password.</span>
          </div>
        </section>
        {props.editing && (
          <ProfileEditor key={props.editing} editing={props.editing} onClose={() => props.onEdit(null)} />
        )}
      </div>
      <div className="bottom-note">
        <span>
          Using {data.installation ? `Claude ${data.installation.version}` : 'your installed Claude Desktop'}
        </span>
        <button type="button" onClick={() => navigate('about')}>
          Compatibility notes <ArrowUpRight size={14} />
        </button>
      </div>
    </>
  );
});
