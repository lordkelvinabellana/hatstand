import { useEffect, useState } from 'react';
import { ArrowLeft, Brain, FolderOpen, Pencil, Play, Share2 } from 'lucide-react';
import type { SessionView } from '../../shared.ts';
import { api, formatShortcut, useApp } from '../api.ts';
import { PetAvatar } from './PetAvatar.tsx';
import { statusLabels } from './ProfilesPage.tsx';
import { SetupVault, ShareVault, vaultEntries } from './VaultDialogs.tsx';

const stateLabels: Record<SessionView['state'], string> = {
  working: 'Working…',
  ask: 'Needs your input',
  done: 'Done, output ready',
};
const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Live sessions, refreshed every few seconds while the page is open. */
function useSessions(id: string) {
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void api
        .request('sessions', { id })
        .then((value) => live && setSessions(value as SessionView[]))
        .catch(() => live && setSessions([]));
    load();
    const timer = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);
  return sessions;
}

/** One profile: who it is, what its Claude is doing now, and its second brain. */
export function ProfilePage(props: { id: string }) {
  const { data, fire, navigate, openVault, edit } = useApp();
  const profile = data.profiles.find((p) => p.id === props.id);
  const sessions = useSessions(props.id);
  const [setup, setSetup] = useState(false);
  const [share, setShare] = useState(false);
  if (!profile)
    return (
      <div className="empty">
        <h2>Profile not found</h2>
        <button type="button" onClick={() => navigate('profiles')}>
          Back to profiles
        </button>
      </div>
    );
  const vault = vaultEntries(data.profiles).find((v) => v.profiles.some((p) => p.id === profile.id));
  const partners = data.profiles.filter((p) => profile.brain.sharedWith.includes(p.id));
  const running = profile.status === 'running' || profile.status === 'starting';

  return (
    <section className="profile-page">
      <button type="button" className="text-button back" onClick={() => navigate('profiles')}>
        <ArrowLeft size={15} />
        Profiles
      </button>
      <header className="profile-hero">
        <PetAvatar pet={profile.pet} color={profile.color} icon={profile.icon} className="hero-avatar" />
        <div>
          <h1>{profile.name}</h1>
          <p>{profile.accountLabel || 'Account label not set'}</p>
          <span className={`profile-status ${profile.status}`} title={profile.message}>
            <span className="status-dot" />
            {statusLabels[profile.status]}
          </span>
        </div>
        <span className="n-spacer" />
        <button type="button" className="secondary" onClick={() => edit(profile.id)}>
          <Pencil size={15} />
          Edit
        </button>
        <button type="button" className="primary" onClick={() => fire('launch', { id: profile.id })}>
          <Play size={15} />
          {running ? 'Bring to front' : 'Launch'}
        </button>
      </header>

      <div className="profile-grid">
        <div className="profile-panel tasks-panel">
          <h2>Running tasks</h2>
          {sessions === null ? (
            <p className="n-hint">Loading…</p>
          ) : sessions.length ? (
            <ul className="task-list">
              {sessions.map((s) => {
                const done = s.summary?.plan.filter((step) => step.status === 'completed').length ?? 0;
                const total = s.summary?.plan.length ?? 0;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="task"
                      onClick={() => fire('openSession', { id: profile.id, session: s.host })}
                    >
                      <span className={`task-state ${s.state}`}>{stateLabels[s.state]}</span>
                      <strong>{s.summary?.title || 'Claude Code session'}</strong>
                      {s.summary?.prompt && <span className="task-prompt">{s.summary.prompt}</span>}
                      {total > 0 && (
                        <span className="task-progress">
                          <span style={{ width: `${(done / total) * 100}%` }} />
                        </span>
                      )}
                      <small>
                        {[
                          total ? `${done}/${total} steps` : '',
                          s.summary?.background ? `${s.summary.background} in background` : '',
                          s.summary?.context ? `${tokens(s.summary.context)} context` : '',
                          s.summary?.model ?? '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="n-hint">
              {data.platform === 'darwin' && data.settings.pets
                ? 'Nothing running right now. Sessions show up here while Claude Code works.'
                : 'Running tasks come from the menu-bar pets. Turn them on in Settings to see them here.'}
            </p>
          )}
        </div>

        <div className="profile-panel">
          <h2>
            <Brain size={17} />
            Second brain
          </h2>
          {profile.brain.external ? (
            <p className="n-hint">
              This profile runs its own capture.py hooks, so Hatstand leaves its notes alone.
            </p>
          ) : profile.brain.enabled && vault ? (
            <>
              <p>
                Notes go to <strong>{vault.name}</strong>
                {partners.length ? `, shared with ${partners.map((p) => p.name).join(' and ')}` : ''}.
              </p>
              <p className="path-text">{profile.brain.folder}</p>
              <div className="button-row">
                <button type="button" className="primary small" onClick={() => openVault(profile.id)}>
                  Open notes
                </button>
                <button type="button" className="secondary" onClick={() => setShare(true)}>
                  <Share2 size={14} />
                  Share…
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => fire('openVault', { id: profile.id })}
                >
                  <FolderOpen size={14} />
                  Show folder
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Let this profile’s Claude Code sessions keep notes: clients, projects, people, tools and a
                session log.
              </p>
              <button type="button" className="primary small" onClick={() => setSetup(true)}>
                Set up second brain
              </button>
            </>
          )}
        </div>

        <div className="profile-panel">
          <h2>Details</h2>
          <dl className="detail-list">
            <dt>Shortcut</dt>
            <dd>{profile.hotkey ? <kbd>{formatShortcut(profile.hotkey)}</kbd> : 'None'}</dd>
            <dt>Work folder</dt>
            <dd>
              {profile.workFolder ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => fire('openWorkFolder', { id: profile.id })}
                >
                  {profile.workFolder}
                </button>
              ) : (
                'Not set'
              )}
            </dd>
            <dt>{data.platform === 'darwin' ? 'Open at login' : 'Open at startup'}</dt>
            <dd>{profile.openAtStartup ? 'Yes' : 'No'}</dd>
            <dt>Claude data</dt>
            <dd>
              <button
                type="button"
                className="text-button"
                onClick={() => fire('openFolder', { id: profile.id })}
              >
                {profile.directory}
              </button>
            </dd>
          </dl>
        </div>
      </div>
      {setup && <SetupVault profile={profile} onClose={() => setSetup(false)} />}
      {share && vault && <ShareVault vault={vault} onClose={() => setShare(false)} />}
    </section>
  );
}
