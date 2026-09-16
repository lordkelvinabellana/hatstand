import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  FolderOpen,
  Layers2,
  LayoutList,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type { Api, ProfileView, Snapshot } from '../shared.ts';
import type { Settings } from '../core/settings.ts';
import type { Color, ProfileInput } from '../core/profiles.ts';
import './style.css';
declare global {
  interface Window {
    clientdeck: Api;
  }
}
const api = window.clientdeck;
const colors: Color[] = ['teal', 'amber', 'violet', 'blue', 'rose', 'slate'];
const initial: ProfileInput = { name: '', accountLabel: '', color: 'teal', icon: 'C' };
function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<'profiles' | 'archive' | 'settings' | 'about'>('profiles');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileInput>({ ...initial });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ProfileInput[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<unknown>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  async function refresh() {
    try {
      setData((await api.request('snapshot')) as Snapshot);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    return api.onChange(() => {
      void refresh();
    });
  }, []);
  useEffect(() => {
    if (!data) return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        data.settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : data.settings.theme);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [data?.settings.theme]);
  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (page === 'profiles' && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        focusSearch.current = true;
        setEditing(null);
        setMenu(null);
        setPage('profiles');
        if (searchRef.current) {
          focusSearch.current = false;
          searchRef.current.focus();
        }
      }
      if (e.key === 'Escape') {
        setMenu(null);
        setEditing(null);
        setImportPreview(null);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  async function run(action: string, payload?: unknown, message?: string) {
    setPending(action);
    setError('');
    setNotice('');
    try {
      const result = await api.request(action, payload);
      if (message) setNotice(message);
      await refresh();
      return result;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setPending(null);
    }
  }
  function fire(action: string, payload?: unknown, message?: string) {
    void run(action, payload, message).catch(() => {});
    setMenu(null);
  }
  function edit(profile?: ProfileView) {
    setMenu(null);
    setEditing(profile?.id ?? 'new');
    setForm(
      profile
        ? { name: profile.name, accountLabel: profile.accountLabel, color: profile.color, icon: profile.icon }
        : { ...initial },
    );
  }
  function navigate(next: typeof page) {
    setPage(next);
    setEditing(null);
    setMenu(null);
    setError('');
    if (next === 'settings' && data) setSettings({ ...data.settings });
    if (next === 'about')
      void run('diagnostics')
        .then(setDiagnostics)
        .catch(() => {});
  }
  if (!data)
    return (
      <main className="loading">
        <Layers2 size={36} />
        <h1>Opening ClientDeck</h1>
        <p>{error || 'Loading your client profiles…'}</p>
        {error && <button onClick={() => void refresh()}>Try again</button>}
      </main>
    );
  const active = data.profiles.filter((p) => !p.archived);
  const visible = data.profiles.filter(
    (p) =>
      p.archived === (page === 'archive') &&
      `${p.name} ${p.accountLabel}`.toLowerCase().includes(query.toLowerCase()),
  );
  const running = data.profiles.filter((p) => p.status === 'running').length;
  function changeOrder(profile: ProfileView, delta: number) {
    const ids = data!.profiles.map((p) => p.id);
    const index = ids.indexOf(profile.id),
      next = index + delta;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    fire('reorder', { ids });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('profiles');
          }}
          aria-label="ClientDeck home"
        >
          <span className="brand-mark">
            <Layers2 size={23} />
          </span>
          <span>ClientDeck</span>
        </a>
        <div className="nav-group">
          <p className="nav-caption">Workspace</p>
          <button
            aria-label="Client profiles"
            title="Client profiles"
            className={`nav-item ${page === 'profiles' ? 'active' : ''}`}
            onClick={() => navigate('profiles')}
          >
            <LayoutList size={18} />
            <span>Client profiles</span>
            <span className="nav-count">{active.length}</span>
          </button>
          <button
            aria-label="Archived"
            title="Archived"
            className={`nav-item ${page === 'archive' ? 'active' : ''}`}
            onClick={() => navigate('archive')}
          >
            <Archive size={18} />
            <span>Archived</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            aria-label="Settings"
            title="Settings"
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button
            aria-label="Compatibility"
            title="Compatibility"
            className={`nav-item ${page === 'about' ? 'active' : ''}`}
            onClick={() => navigate('about')}
          >
            <CircleHelp size={18} />
            <span>Compatibility</span>
          </button>
          <div className="local-note">
            <span className="status-dot" />
            <span>Stored on this computer</span>
          </div>
          <span className="version">ClientDeck {data.version} · Preview</span>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} />{' '}
            {page === 'profiles'
              ? 'Client profiles'
              : page === 'archive'
                ? 'Archived'
                : page === 'settings'
                  ? 'Settings'
                  : 'Compatibility'}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh Claude installation and status"
            disabled={!!pending}
            onClick={() => fire('refresh')}
          >
            <RefreshCw size={17} className={pending === 'refresh' ? 'spin' : ''} />
          </button>
        </header>
        <div className="page">
          {error && (
            <div role="alert" className="banner error">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="banner success">
              <Check size={16} />
              <span>{notice}</span>
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {(page === 'profiles' || page === 'archive') && (
            <>
              <div className="page-heading">
                <div>
                  <h1>{page === 'profiles' ? 'Your clients, in place.' : 'Archived profiles'}</h1>
                  <p>
                    {page === 'profiles'
                      ? 'Separate Claude accounts. One place to switch.'
                      : 'Saved for later, with their local data preserved.'}
                  </p>
                </div>
                {page === 'profiles' && (
                  <button className="primary" onClick={() => edit()}>
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
                  <button onClick={() => navigate('settings')}>
                    Settings <ArrowUpRight size={15} />
                  </button>
                </div>
              )}
              {data.processError && <div className="banner warning">{data.processError}</div>}
              <div className={`profile-workspace ${editing ? 'with-editor' : ''}`}>
                <section className="profiles-panel" aria-label="Client profiles">
                  <div className="list-toolbar">
                    <label className="search">
                      <Search size={17} />
                      <input
                        ref={searchRef}
                        aria-label="Search profiles"
                        placeholder="Find a client…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && visible[0] && !visible[0].archived)
                            fire('launch', { id: visible[0].id });
                        }}
                      />
                      <kbd>Ctrl K</kbd>
                    </label>
                    <span className="running-count">{running} running</span>
                  </div>
                  <div className="list-head">
                    <span>Client</span>
                    <span>Desktop</span>
                    <span className="sr-only">Actions</span>
                  </div>
                  {visible.length === 0 ? (
                    <div className="empty">
                      <Layers2 size={32} />
                      <h2>
                        {query
                          ? 'No matching profiles'
                          : page === 'archive'
                            ? 'Nothing archived'
                            : 'Make room for your first client'}
                      </h2>
                      <p>
                        {query
                          ? 'Try a client name or account label.'
                          : page === 'archive'
                            ? 'Profiles you archive will appear here.'
                            : 'Create a profile, then sign in inside Claude Desktop.'}
                      </p>
                      {page === 'profiles' && !query && (
                        <button className="primary" onClick={() => edit()}>
                          <Plus size={16} />
                          Create a profile
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="profile-list">
                      {visible.map((profile) => (
                        <article
                          className={`profile-row ${editing === profile.id ? 'selected' : ''}`}
                          key={profile.id}
                        >
                          <button className="profile-identity" onClick={() => edit(profile)}>
                            <span className={`avatar ${profile.color}`}>{profile.icon}</span>
                            <span className="profile-name">
                              <strong>{profile.name}</strong>
                              <span>{profile.accountLabel || 'Account label not set'}</span>
                            </span>
                          </button>
                          <span className={`profile-status ${profile.status}`} title={profile.message}>
                            <span className="status-dot" />
                            {profile.status === 'running'
                              ? 'Running'
                              : profile.status === 'starting'
                                ? 'Opening…'
                                : profile.status === 'closing'
                                  ? 'Closing…'
                                  : profile.status === 'error'
                                    ? 'Needs attention'
                                    : profile.status === 'unknown'
                                      ? 'Unknown'
                                      : 'Ready to launch'}
                          </span>
                          <div className="profile-actions">
                            {profile.archived ? (
                              <button
                                className="secondary"
                                onClick={() => fire('archive', { id: profile.id, archived: false })}
                              >
                                Restore
                              </button>
                            ) : (
                              <button
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
                                className="icon-button"
                                aria-label={`Actions for ${profile.name}`}
                                aria-expanded={menu === profile.id}
                                onClick={() => setMenu(menu === profile.id ? null : profile.id)}
                              >
                                <MoreHorizontal size={18} />
                              </button>
                              {menu === profile.id && (
                                <>
                                  <button
                                    className="menu-backdrop"
                                    aria-label="Close actions"
                                    onClick={() => setMenu(null)}
                                  />
                                  <div
                                    className="actions-menu"
                                    role="group"
                                    aria-label={`Actions for ${profile.name}`}
                                  >
                                    <button onClick={() => edit(profile)}>Edit profile</button>
                                    <button
                                      onClick={() =>
                                        fire('shortcut', { id: profile.id }, 'Desktop shortcut created.')
                                      }
                                    >
                                      Create shortcut
                                    </button>
                                    <button onClick={() => changeOrder(profile, -1)}>
                                      <ArrowUp size={14} />
                                      Move up
                                    </button>
                                    <button onClick={() => changeOrder(profile, 1)}>
                                      <ArrowDown size={14} />
                                      Move down
                                    </button>
                                    {profile.status === 'running' && (
                                      <>
                                        <button onClick={() => fire('restart', { id: profile.id })}>
                                          Restart Claude
                                        </button>
                                        <button onClick={() => fire('close', { id: profile.id })}>
                                          Close Claude
                                        </button>
                                        <button onClick={() => fire('forceClose', { id: profile.id })}>
                                          Force close…
                                        </button>
                                      </>
                                    )}
                                    <button
                                      onClick={() =>
                                        fire('archive', { id: profile.id, archived: !profile.archived })
                                      }
                                    >
                                      {profile.archived ? 'Restore profile' : 'Archive profile'}
                                    </button>
                                    <button
                                      className="danger-text"
                                      onClick={() => fire('remove', { id: profile.id })}
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
                    <span>ClientDeck never asks for your password.</span>
                  </div>
                </section>
                {editing && (
                  <aside className="editor">
                    <div className="editor-heading">
                      <h2>{editing === 'new' ? 'New client profile' : 'Profile details'}</h2>
                      <button
                        className="icon-button"
                        aria-label="Close profile editor"
                        onClick={() => setEditing(null)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(
                          editing === 'new' ? 'create' : 'edit',
                          editing === 'new' ? form : { id: editing, input: form },
                          editing === 'new' ? 'Profile created. Launch it to sign in.' : 'Profile saved.',
                        )
                          .then(() => setEditing(null))
                          .catch(() => {});
                      }}
                    >
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
                              icon:
                                editing === 'new'
                                  ? e.target.value.trim().slice(0, 2).toUpperCase() || 'C'
                                  : form.icon,
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
                          onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        />
                      </label>
                      <fieldset>
                        <legend>Profile color</legend>
                        <div className="color-options">
                          {colors.map((color) => (
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
                      <button className="primary full-width" disabled={!!pending} type="submit">
                        {pending === 'create' || pending === 'edit'
                          ? 'Saving…'
                          : editing === 'new'
                            ? 'Create profile'
                            : 'Save changes'}
                      </button>
                    </form>
                    {editing !== 'new' && (
                      <details className="advanced">
                        <summary>Local storage</summary>
                        <p className="path-text">{data.profiles.find((p) => p.id === editing)?.directory}</p>
                        <button className="secondary" onClick={() => fire('openFolder', { id: editing })}>
                          <FolderOpen size={15} />
                          Open folder
                        </button>
                        <p>Contains this profile’s session data. Keep it private.</p>
                      </details>
                    )}
                  </aside>
                )}
              </div>
              <div className="bottom-note">
                <span>
                  Using{' '}
                  {data.installation
                    ? `Claude ${data.installation.version}`
                    : 'your installed Claude Desktop'}
                </span>
                <button onClick={() => navigate('about')}>
                  Compatibility notes <ArrowUpRight size={14} />
                </button>
              </div>
            </>
          )}
          {page === 'settings' && settings && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Make it your workspace.</h1>
                  <p>Small preferences for everyday switching.</p>
                </div>
              </div>
              <form
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  fire('settings', settings, 'Settings saved.');
                }}
              >
                <section className="setting-section">
                  <h2>Appearance</h2>
                  <div className="setting-row">
                    <div>
                      <label htmlFor="theme">Theme</label>
                      <p>Follow Windows or choose your own.</p>
                    </div>
                    <select
                      id="theme"
                      value={settings.theme}
                      onChange={(e) =>
                        setSettings({ ...settings, theme: e.target.value as Settings['theme'] })
                      }
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>
                </section>
                <section className="setting-section">
                  <h2>Daily workflow</h2>
                  <label className="setting-row">
                    <span>
                      Keep ClientDeck in the tray<small>Closing this window keeps switching available.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.minimizeToTray}
                      onChange={(e) => setSettings({ ...settings, minimizeToTray: e.target.checked })}
                    />
                  </label>
                  <label className="setting-row">
                    <span>
                      Start with Windows
                      <small>Opens the manager in the tray. Claude launches when you choose a client.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.startWithWindows}
                      onChange={(e) => setSettings({ ...settings, startWithWindows: e.target.checked })}
                    />
                  </label>
                  <label className="stacked-label">
                    Global shortcut
                    <input
                      value={settings.hotkey}
                      onChange={(e) => setSettings({ ...settings, hotkey: e.target.value })}
                    />
                    <small>Opens ClientDeck from another app. Leave blank to disable.</small>
                  </label>
                  {data.hotkeyError && <p className="inline-error">{data.hotkeyError}</p>}
                </section>
                <section className="setting-section">
                  <h2>Claude Desktop</h2>
                  <p>
                    {data.installation
                      ? `${data.installation.kind} installation · ${data.installation.version}`
                      : 'No installation detected'}
                  </p>
                  <div className="path-picker">
                    <input
                      aria-label="Claude executable override"
                      readOnly
                      placeholder="Automatically detect Claude"
                      value={settings.executable}
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void run('pickExecutable')
                          .then((value) => {
                            if (typeof value === 'string') setSettings({ ...settings, executable: value });
                          })
                          .catch(() => {})
                      }
                    >
                      Browse
                    </button>
                    {settings.executable && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSettings({ ...settings, executable: '' })}
                      >
                        Use automatic
                      </button>
                    )}
                  </div>
                  <button className="text-button" type="button" onClick={() => fire('downloadClaude')}>
                    Download Claude Desktop <ArrowUpRight size={14} />
                  </button>
                </section>
                <button className="primary" disabled={!!pending}>
                  Save preferences
                </button>
              </form>
              <section className="setting-section transfer">
                <h2>Move profile labels</h2>
                <p>
                  Export names, account labels, colors, and initials. Sign-ins and Claude session data stay on
                  this computer.
                </p>
                <div className="button-row">
                  <button className="secondary" onClick={() => fire('export')}>
                    <Download size={16} />
                    Export metadata
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void run('chooseImport')
                        .then((value) => setImportPreview(value as ProfileInput[] | null))
                        .catch(() => {})
                    }
                  >
                    <Upload size={16} />
                    Import metadata
                  </button>
                </div>
                {importPreview && (
                  <div className="import-preview">
                    <h3>Import {importPreview.length} profiles?</h3>
                    <p>These will be fresh profiles. You’ll sign into each inside Claude.</p>
                    <ul>
                      {importPreview.map((p, i) => (
                        <li key={i}>{p.name}</li>
                      ))}
                    </ul>
                    <div className="button-row">
                      <button
                        className="primary"
                        onClick={() =>
                          void run('confirmImport', null, 'Profiles imported.')
                            .then(() => setImportPreview(null))
                            .catch(() => {})
                        }
                      >
                        Create profiles
                      </button>
                      <button className="secondary" onClick={() => setImportPreview(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
          {page === 'about' && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Know what’s separate.</h1>
                  <p>Compatibility is measured, not assumed.</p>
                </div>
                <span className="preview-label">Preview build</span>
              </div>
              <section className="compatibility">
                <h2>Current verification</h2>
                <div className="check-row">
                  <span>Parallel Claude Desktop windows</span>
                  <span className="verified">Observed</span>
                </div>
                <div className="check-row">
                  <span>Two account sign-ins</span>
                  <span className="verified">User confirmed</span>
                </div>
                <div className="check-row">
                  <span>Cowork task execution and separation</span>
                  <span>Not yet verified</span>
                </div>
                <div className="check-row">
                  <span>Desktop Code task execution and separation</span>
                  <span>Not yet verified</span>
                </div>
                <div className="check-row">
                  <span>Persistence after a Windows reboot</span>
                  <span>Not yet verified</span>
                </div>
                <p>Initial checks used Claude MSIX 1.52386.6.0. Other versions may behave differently.</p>
              </section>
              <section className="setting-section">
                <h2>Separate sessions, shared computer</h2>
                <p>
                  Each profile has its own Desktop data location. Profiles still run as the same Windows user
                  and may access the same files, clipboard, and local services. This app does not create a
                  security sandbox.
                </p>
                <p>
                  ClientDeck is independent of Anthropic. You install and authenticate with the official
                  Claude Desktop app.
                </p>
              </section>
              <section className="setting-section">
                <h2>Diagnostic summary</h2>
                <p>
                  This summary contains versions and counts, without client names, emails, paths, or session
                  contents.
                </p>
                <pre className="diagnostics">
                  {diagnostics ? JSON.stringify(diagnostics, null, 2) : 'Loading summary…'}
                </pre>
                <button className="secondary" onClick={() => fire('exportDiagnostics')}>
                  <Download size={16} />
                  Save this summary
                </button>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
