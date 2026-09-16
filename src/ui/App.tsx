import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  CircleHelp,
  Layers2,
  LayoutList,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react';
import type { Snapshot } from '../shared.ts';
import { api, AppContext } from './api.ts';
import type { AppContextValue, Page } from './api.ts';
import { CompatibilityPage } from './components/CompatibilityPage.tsx';
import { ProfilesPage } from './components/ProfilesPage.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { SetupPage } from './components/SetupPage.tsx';

const titles: Record<Page, string> = {
  profiles: 'Client profiles',
  archive: 'Archived',
  settings: 'Settings',
  about: 'Compatibility',
};

export function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>('profiles');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setData((await api.request('snapshot')) as Snapshot);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  const run = useCallback(
    async (action: string, payload?: unknown, message?: string) => {
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
        await refresh();
        throw err;
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );
  const fire = useCallback(
    (action: string, payload?: unknown, message?: string) => {
      void run(action, payload, message).catch(() => {});
    },
    [run],
  );
  const navigate = useCallback((next: Page) => {
    setPage(next);
    setEditing(null);
    setError('');
  }, []);

  useEffect(() => {
    void refresh();
    return api.onChange(() => void refresh());
  }, [refresh]);
  useEffect(() => {
    if (!data) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        data.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : data.settings.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data]);
  useEffect(() => {
    if (page === 'profiles' && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setEditing(null);
        if (searchRef.current) searchRef.current.focus();
        else focusSearch.current = true;
        setPage('profiles');
      }
      if (e.key === 'Escape') setEditing(null);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const context = useMemo<AppContextValue | null>(
    () => (data ? { data, pending, run, fire, navigate, refresh } : null),
    [data, pending, run, fire, navigate, refresh],
  );

  if (!data || !context)
    return (
      <main className="loading">
        <Layers2 size={36} />
        <h1>Opening ClientDeck</h1>
        <p>{error || 'Loading your client profiles…'}</p>
        {error && (
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        )}
      </main>
    );

  const banners = (
    <>
      {error && (
        <div role="alert" className="banner error">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="banner success">
          <Check size={16} />
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );

  if (!data.settings.setupComplete && data.profiles.length === 0)
    return (
      <AppContext.Provider value={context}>
        <div className="setup-shell">
          {banners}
          <SetupPage />
        </div>
      </AppContext.Provider>
    );

  const active = data.profiles.filter((p) => !p.archived);
  const navItem = (target: Page, icon: React.ReactNode, count?: number) => (
    <button
      type="button"
      aria-label={titles[target]}
      title={titles[target]}
      aria-current={page === target ? 'page' : undefined}
      className={`nav-item ${page === target ? 'active' : ''}`}
      onClick={() => navigate(target)}
    >
      {icon}
      <span>{titles[target]}</span>
      {count !== undefined && <span className="nav-count">{count}</span>}
    </button>
  );

  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <aside className="sidebar">
          <button
            type="button"
            className="brand"
            onClick={() => navigate('profiles')}
            aria-label="ClientDeck home"
          >
            <span className="brand-mark">
              <Layers2 size={23} />
            </span>
            <span>ClientDeck</span>
          </button>
          <nav className="nav-group" aria-label="Workspace">
            <p className="nav-caption">Workspace</p>
            {navItem('profiles', <LayoutList size={18} />, active.length)}
            {navItem('archive', <Archive size={18} />)}
          </nav>
          <div className="sidebar-bottom">
            {navItem('settings', <Settings2 size={18} />)}
            {navItem('about', <CircleHelp size={18} />)}
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
              Workspace <ChevronRight size={14} /> {titles[page]}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh Claude installation and status"
              disabled={!!pending}
              onClick={() => fire('refresh')}
            >
              <RefreshCw size={17} className={pending === 'refresh' ? 'spin' : ''} />
            </button>
          </header>
          <div className="page">
            {banners}
            {(page === 'profiles' || page === 'archive') && (
              <ProfilesPage
                key={page}
                ref={searchRef}
                archive={page === 'archive'}
                query={query}
                onQuery={setQuery}
                editing={editing}
                onEdit={setEditing}
              />
            )}
            {page === 'settings' && <SettingsPage />}
            {page === 'about' && <CompatibilityPage />}
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}
