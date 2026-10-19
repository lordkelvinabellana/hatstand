import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Brain, Plus, Share2 } from 'lucide-react';
import type { Color } from '../../core/profiles.ts';
import {
  buildGraph,
  combineVaults,
  filterGraph,
  type Group,
  ringPositions,
  splitVaultNode,
} from '../../core/graph.ts';
import { buildIndex, type NoteText } from '../../core/links.ts';
import { GraphView, type Positions } from '../../notes/GraphView.tsx';
import { NotesApp } from '../../notes/NotesApp.tsx';
import type { ProfileView } from '../../shared.ts';
import { api, useApp } from '../api.ts';
import { PetAvatar } from './PetAvatar.tsx';
import { SetupVault, ShareVault, type VaultEntry, vaultEntries } from './VaultDialogs.tsx';

/** Graph colours per profile colour: readable on both themes. */
export const tints: Record<Color, string> = {
  teal: '#2f8f74',
  amber: '#c28a1e',
  violet: '#7c5cc4',
  blue: '#3b7dd8',
  rose: '#d0567a',
  slate: '#6b7785',
};
const quiet = new Set<Group>(['Sessions', 'Daily']);

/**
 * The Second brain page: every vault in one graph, each in its own circle, with a card per vault; or one
 * vault open in the notes view. Profiles without a vault get a setup card at the top, not at the bottom.
 */
export function VaultPage(props: { open: string | null }) {
  const { data, openVault, openProfile, theme } = useApp();
  const vaults = vaultEntries(data.profiles);
  const without = data.profiles.filter((p) => !p.archived && !p.brain.enabled && !p.brain.external);
  const [setup, setSetup] = useState<ProfileView | null>(null);
  const [share, setShare] = useState<VaultEntry | null>(null);
  const opened = props.open ? data.profiles.find((p) => p.id === props.open) : undefined;
  const current = opened ? vaults.find((v) => v.profiles.some((p) => p.id === opened.id)) : undefined;

  const dialogs = (
    <>
      {setup && <SetupVault profile={setup} onClose={() => setSetup(null)} />}
      {share && <ShareVault vault={share} onClose={() => setShare(null)} />}
    </>
  );

  if (current && opened)
    return (
      <div className="vault-open">
        <div className="vault-bar">
          <button type="button" className="text-button" onClick={() => openVault(null)}>
            <ArrowLeft size={15} />
            All vaults
          </button>
          <strong>{current.name}</strong>
          <span className="avatar-stack">
            {current.profiles.map((p) => (
              <button key={p.id} type="button" title={`${p.name}’s page`} onClick={() => openProfile(p.id)}>
                <PetAvatar pet={p.pet} color={p.color} icon={p.icon} />
              </button>
            ))}
          </span>
          <span className="n-spacer" />
          <button type="button" className="secondary" onClick={() => setShare(current)}>
            <Share2 size={15} />
            Share
          </button>
        </div>
        <div className="vault-notes">
          <NotesApp key={current.folder} profile={opened.id} theme={theme} />
        </div>
        {dialogs}
      </div>
    );

  return (
    <section className="vault-page">
      <div className="page-heading">
        <div>
          <h1>Second brain</h1>
          <p>
            Each profile’s Claude Code sessions keep notes in a vault: clients, projects, people, tools and a
            log of every session. Vaults stay separate unless you share one.
          </p>
        </div>
      </div>
      {opened && !current && !opened.brain.external && (
        <div className="banner warning">
          <span>{opened.name} has no second brain yet.</span>
          <button type="button" className="primary small" onClick={() => setSetup(opened)}>
            Set it up
          </button>
        </div>
      )}
      {without.length > 0 && (
        <div className="setup-strip">
          <Brain size={18} />
          <span>
            {without.length === 1 ? `${without[0].name} doesn’t` : `${without.length} profiles don’t`} keep
            notes yet.
          </span>
          {without.map((p) => (
            <button key={p.id} type="button" className="secondary" onClick={() => setSetup(p)}>
              <Plus size={14} />
              {p.name}
            </button>
          ))}
        </div>
      )}
      {vaults.length ? (
        <>
          <Overview vaults={vaults} />
          <div className="vault-cards">
            {vaults.map((v) => (
              <VaultCard key={v.folder} vault={v} onShare={() => setShare(v)} />
            ))}
          </div>
        </>
      ) : (
        <div className="empty">
          <h2>No vaults yet</h2>
          <p>Turn on a second brain for a profile above and its notes show up here.</p>
        </div>
      )}
      {dialogs}
    </section>
  );
}

interface LoadedVault {
  folder: string;
  name: string;
  color: Color;
  profiles: string[];
  notes: NoteText[];
}

/** Loads every vault's notes, again whenever a vault changes on disk. */
function useVaults(key: string) {
  const [loaded, setLoaded] = useState<LoadedVault[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` (the vault folders) is the trigger.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void api
        .request('vaults')
        .then((value) => live && setLoaded(value as LoadedVault[]))
        .catch(() => {});
    load();
    const stop = window.notes.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [key]);
  return loaded;
}

function Overview(props: { vaults: VaultEntry[] }) {
  const { theme, openVault } = useApp();
  const key = props.vaults.map((v) => v.folder).join('\n');
  const loaded = useVaults(key);
  const [sessions, setSessions] = useState(false);
  const graphs = useMemo(
    () =>
      loaded.map((v) => ({
        key: v.folder,
        label: v.name,
        color: tints[v.color] ?? tints.teal,
        graph: filterGraph(buildGraph(buildIndex(v.notes)), {
          hidden: sessions ? new Set<Group>() : quiet,
          ghosts: false,
          orphans: true,
        }),
      })),
    [loaded, sessions],
  );
  const data = useMemo(() => combineVaults(graphs), [graphs]);
  const positions = useRef<{ key: string; map: Positions }>({ key: '', map: new Map() });
  if (positions.current.key !== key && graphs.length) positions.current = { key, map: ringPositions(graphs) };

  return (
    <div className="vault-overview">
      <div className="vault-overview-bar">
        <span className="n-hint">Each circle is one vault. Click a note or a vault’s name to open it.</span>
        <label className="checkbox-row compact">
          <input type="checkbox" checked={sessions} onChange={(e) => setSessions(e.target.checked)} />
          <span>Show session logs</span>
        </label>
      </div>
      {loaded.length ? (
        <GraphView
          key={key}
          data={data}
          theme={theme}
          active={null}
          highlight={null}
          positions={positions.current.map}
          label="All vaults as one graph"
          onOpen={(id) => {
            const vault = loaded.find((v) => v.folder === splitVaultNode(id).key);
            if (vault) openVault(vault.profiles[0]);
          }}
        />
      ) : (
        <p className="n-graph-canvas n-graph-off">Loading notes…</p>
      )}
    </div>
  );
}

function VaultCard(props: { vault: VaultEntry; onShare(): void }) {
  const { openVault, openProfile, fire } = useApp();
  const { vault } = props;
  return (
    <article className="vault-card">
      <header>
        <span className="vault-swatch" style={{ background: tints[vault.profiles[0].color] }} />
        <strong>{vault.name}</strong>
        {vault.profiles.length > 1 && <span className="vault-tag">Shared</span>}
      </header>
      <div className="vault-people">
        {vault.profiles.map((p) => (
          <button key={p.id} type="button" className="vault-person" onClick={() => openProfile(p.id)}>
            <PetAvatar pet={p.pet} color={p.color} icon={p.icon} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <p className="path-text">{vault.folder}</p>
      <div className="button-row">
        <button type="button" className="primary small" onClick={() => openVault(vault.profiles[0].id)}>
          Open notes
        </button>
        <button type="button" className="secondary" onClick={props.onShare}>
          <Share2 size={14} />
          Share…
        </button>
        {vault.profiles.length > 1 &&
          vault.profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="text-button"
              onClick={() =>
                fire(
                  'leaveVault',
                  { id: p.id },
                  `${p.name} now keeps notes in its own vault again. Nothing was moved.`,
                )
              }
            >
              {p.name} leaves
            </button>
          ))}
      </div>
    </article>
  );
}
