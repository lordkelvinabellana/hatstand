import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import type { SessionView } from '../../shared.ts';
import type { Color } from '../../core/profiles.ts';
import { drawPet, type Mood, speciesNames } from '../../core/sprites.ts';
import { api, useApp } from '../api.ts';

const stateLabels: Record<SessionView['state'], string> = {
  working: 'Working…',
  ask: 'Needs your input',
  done: 'Done, output ready',
};

/** Every active profile's live sessions, refreshed every few seconds while the page is open. */
function useAllSessions(ids: string[]) {
  const [sessions, setSessions] = useState<Record<string, SessionView[]>>({});
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all(
        key
          .split(',')
          .filter(Boolean)
          .map((id) =>
            api
              .request('sessions', { id })
              .then((value) => [id, value as SessionView[]] as const)
              .catch(() => [id, [] as SessionView[]] as const),
          ),
      ).then((entries) => live && setSessions(Object.fromEntries(entries)));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key]);
  return sessions;
}

/** One pixel character, redrawn per animation frame as SVG. */
function PixelPet(props: { species: number; color: Color; mood: Mood; frame: number }) {
  const grid = drawPet(props.species, props.color, props.mood, props.frame);
  // One path per colour keeps the SVG small: 'M x y h1 v1 h-1 z' per pixel.
  const paths = new Map<string, string>();
  for (const [y, row] of grid.entries())
    for (const [x, [r, g, b, a]] of row.entries())
      if (a) paths.set(`rgb(${r} ${g} ${b})`, `${paths.get(`rgb(${r} ${g} ${b})`) ?? ''}M${x} ${y}h1v1h-1z`);
  return (
    <svg
      className={`office-pet ${props.mood}`}
      viewBox={`0 0 ${grid[0].length} ${grid.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {[...paths].map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}

/** The agent view: a room per profile with a character per live session, and what needs you on the right. */
export function OfficePage() {
  const { data, fire } = useApp();
  const profiles = data.profiles.filter((p) => !p.archived);
  const sessions = useAllSessions(profiles.map((p) => p.id));
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), 450);
    return () => clearInterval(timer);
  }, []);

  const rank = { ask: 0, done: 1, working: 2 };
  const inbox = profiles
    .flatMap((profile) => (sessions[profile.id] ?? []).map((session) => ({ profile, session })))
    .filter(({ session }) => session.state !== 'working')
    .sort((a, b) => rank[a.session.state] - rank[b.session.state] || b.session.at - a.session.at);

  return (
    <section className="office">
      <div className="office-rooms">
        {profiles.map((profile, index) => {
          const species = profile.pet ? speciesNames.indexOf(profile.pet) : index % speciesNames.length;
          const live = sessions[profile.id] ?? [];
          const running = profile.status === 'running' || profile.status === 'starting';
          return (
            <article key={profile.id} className={`office-room ${profile.color}`}>
              <header>
                <h2>{profile.name}</h2>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => fire('launch', { id: profile.id })}
                >
                  <Play size={14} />
                  {running ? 'Bring to front' : 'Launch'}
                </button>
              </header>
              <div className="office-floor">
                {live.length ? (
                  live.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className="office-desk"
                      title={s.summary?.title || 'Claude Code session'}
                      onClick={() => fire('openSession', { id: profile.id, session: s.host })}
                    >
                      <PixelPet species={species} color={profile.color} mood={s.state} frame={frame} />
                      <span>{s.summary?.title || 'Claude Code session'}</span>
                    </button>
                  ))
                ) : (
                  <div className="office-desk idle">
                    <PixelPet
                      species={species}
                      color={profile.color}
                      mood={running ? 'idle' : 'sleep'}
                      frame={frame}
                    />
                    <span>{running ? 'Idle' : 'Not running'}</span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <aside className="office-inbox" aria-label="Needs you">
        <h2>Needs you</h2>
        {inbox.length ? (
          <ul>
            {inbox.map(({ profile, session }) => (
              <li key={`${profile.id}/${session.id}`}>
                <button
                  type="button"
                  className="task"
                  onClick={() => fire('openSession', { id: profile.id, session: session.host })}
                >
                  <span className={`task-state ${session.state}`}>{stateLabels[session.state]}</span>
                  <strong>{session.summary?.title || 'Claude Code session'}</strong>
                  <small>{profile.name}</small>
                  {session.summary?.prompt && <span className="task-prompt">{session.summary.prompt}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="n-hint">Nothing waiting on you.</p>
        )}
      </aside>
    </section>
  );
}
