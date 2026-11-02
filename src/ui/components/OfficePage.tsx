import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { SessionView } from '../../shared.ts';
import type { Color } from '../../core/profiles.ts';
import { drawPet, type Mood, speciesNames } from '../../core/sprites.ts';
import { api, useApp } from '../api.ts';
import { hasWebGL, OfficeWorld, type WorldZone } from './OfficeWorld.tsx';

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

/** Where a character stands: x in % of the room's width, y in px from its top (the label's bottom edge). */
interface Spot {
  key: string;
  x: number;
  y: number;
  mood: Mood;
  label: string;
  session?: SessionView;
}
const roomHeight = 208;
// shortcut: the desk row holds about eight desks at normal width; past that characters overlap, add a second row then.
const deskX = (index: number, desks: number) => 6 + ((index + 0.5) * 58) / desks;
const wander = [
  [34, 170],
  [52, 198],
  [68, 150],
  [22, 140],
];

/**
 * Working sessions sit at a desk, ones that need you wait at the door, finished ones rest on the couch,
 * and a profile with nothing running wanders (or sleeps on the couch when its Claude is closed).
 */
function layout(live: SessionView[], running: boolean, frame: number, seed: number) {
  const desks = Math.max(live.length, 3);
  if (!live.length) {
    const [x, y] = running ? wander[(Math.floor(frame / 11) + seed) % wander.length] : [12, 198];
    return { desks, spots: [{ key: 'idle', x, y, mood: running ? 'idle' : 'sleep', label: '' } as Spot] };
  }
  let asking = 0;
  let resting = 0;
  const spots = live.map((session, index): Spot => {
    const base = {
      key: session.id,
      mood: session.state,
      label: session.summary?.title || 'Claude Code session',
      session,
    };
    if (session.state === 'working') return { ...base, x: deskX(index, desks), y: 128 };
    if (session.state === 'ask') {
      const n = asking++;
      return { ...base, x: 84 - Math.floor(n / 2) * 10, y: 164 + (n % 2) * 16 };
    }
    return { ...base, x: 10 + resting++ * 9, y: 200 };
  });
  return { desks, spots };
}

/** The agent view: a pixel office with a room per profile, and what needs you on the right. */
export function OfficePage() {
  const { data, fire, theme } = useApp();
  const profiles = data.profiles.filter((p) => !p.archived);
  const sessions = useAllSessions(profiles.map((p) => p.id));
  const [frame, setFrame] = useState(0);
  // When each character last changed spots, so it shows its walking bob until it arrives.
  const moved = useRef(new Map<string, { at: string; since: number }>());
  // The flat fallback animates by redrawing; the 3D world runs its own loop.
  const world = useMemo(hasWebGL, []);
  useEffect(() => {
    if (world) return;
    const timer = setInterval(() => setFrame((n) => n + 1), 450);
    return () => clearInterval(timer);
  }, [world]);
  const zones = useMemo<WorldZone[]>(
    () =>
      data.profiles
        .filter((p) => !p.archived)
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          color: profile.color,
          running: profile.status === 'running' || profile.status === 'starting',
          sessions: sessions[profile.id] ?? [],
        })),
    [data.profiles, sessions],
  );

  const rank = { ask: 0, done: 1, working: 2 };
  const inbox = profiles
    .flatMap((profile) => (sessions[profile.id] ?? []).map((session) => ({ profile, session })))
    .filter(({ session }) => session.state !== 'working')
    .sort((a, b) => rank[a.session.state] - rank[b.session.state] || b.session.at - a.session.at);
  const now = Date.now();

  return (
    <section className={world ? 'office office-full' : 'office'}>
      {world ? (
        <OfficeWorld
          zones={zones}
          theme={theme}
          onOpen={(id, session) => fire('openSession', { id, session })}
          onLaunch={(id) => fire('launch', { id })}
        />
      ) : (
        <div className="office-rooms">
          {profiles.map((profile, index) => {
            const species = profile.pet ? speciesNames.indexOf(profile.pet) : index % speciesNames.length;
            const live = sessions[profile.id] ?? [];
            const running = profile.status === 'running' || profile.status === 'starting';
            const { desks, spots } = layout(live, running, frame, index);
            const knocking = live.some((s) => s.state === 'ask');
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
                <div className="office-scene" style={{ height: roomHeight }}>
                  <div className="office-wall" />
                  {[...Array(desks).keys()].map((i) => (
                    <div
                      key={i}
                      className={`office-deskpiece ${live[i]?.state === 'working' ? 'on' : ''}`}
                      style={{ left: `${deskX(i, desks) - 29 / desks - 1}%`, width: `${58 / desks - 2}%` }}
                    />
                  ))}
                  <div className={`office-door ${knocking ? 'knock' : ''}`} />
                  <div className="office-couch" />
                  <div className="office-plant" />
                  {spots.map((spot) => {
                    const at = `${spot.x},${spot.y}`;
                    const prev = moved.current.get(`${profile.id}/${spot.key}`);
                    if (prev?.at !== at) moved.current.set(`${profile.id}/${spot.key}`, { at, since: now });
                    const walking =
                      prev !== undefined && prev.at !== at ? true : now - (prev?.since ?? 0) < 1500;
                    const style = { left: `${spot.x}%`, top: spot.y, zIndex: Math.round(spot.y) };
                    const body = (
                      <>
                        <PixelPet
                          species={species}
                          color={profile.color}
                          mood={spot.mood}
                          frame={walking && spot.mood === 'idle' ? frame + 1 : frame}
                        />
                        {spot.label && <span className="office-label">{spot.label}</span>}
                      </>
                    );
                    return spot.session ? (
                      <button
                        type="button"
                        key={spot.key}
                        className={`office-agent ${walking ? 'walking' : ''}`}
                        style={style}
                        title={`${spot.label} · ${stateLabels[spot.session.state]}`}
                        onClick={() => fire('openSession', { id: profile.id, session: spot.session?.host })}
                      >
                        {body}
                      </button>
                    ) : (
                      <div
                        key={spot.key}
                        className={`office-agent idle ${walking ? 'walking' : ''}`}
                        style={style}
                        title={running ? 'Idle' : 'Not running'}
                      >
                        {body}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
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
