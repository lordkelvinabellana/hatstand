import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionView } from '../shared.ts';
import { notePath } from '../core/operator.ts';
import { callTool as readVault } from '../core/recall.ts';
import { newSessionLink } from '../core/ask.ts';
import { type OperatorActions, serveOperator } from '../core/operator-server.ts';
import type { Profile } from '../core/profiles.ts';
import { findProfileByArgument } from '../core/profiles.ts';

const labels: Record<SessionView['state'], string> = {
  working: 'working',
  ask: 'needs the user',
  done: 'done',
};

/** What the operator tools reach in Hatstand; main.ts supplies these. */
export interface OperatorHost {
  profiles(): Promise<Profile[]>;
  running(id: string): boolean;
  sessions(id: string): Promise<SessionView[]>;
  /** Delivers a claude:// link to the profile's own Claude, launching it first when needed. */
  open(id: string, url: string): Promise<boolean>;
  log(action: string, id: string): Promise<void>;
  /** The folder of a profile's vault. */
  vault(id: string): Promise<string>;
  /** Codex's own memory folder, kept apart from every client vault. */
  codexVault: string;
  /** Sends a reply into a live session of the profile and returns what it answered. */
  reply(id: string, session: string, text: string): Promise<string>;
}

/**
 * Serves the operator tools on a unix socket in Hatstand's data folder (owner-only), so an outside
 * agent can see profiles and sessions and start a new session. It can only reach what Hatstand's own
 * pets already read, and a started session runs inside the profile's own Claude.
 */
export function startOperator(socketPath: string, host: OperatorHost) {
  const find = async (name: string) =>
    findProfileByArgument(
      (await host.profiles()).filter((p) => !p.archived),
      name,
    );
  const actions: OperatorActions = {
    notes: async () => '',
    reply: async (name, session, text) => {
      const profile = await find(name);
      await host.log('operator-reply', profile.id).catch(() => {});
      return host.reply(profile.id, session, text);
    },
    async profiles() {
      const lines = (await host.profiles())
        .filter((p) => !p.archived)
        .map(
          (p) =>
            `- ${p.name} · ${host.running(p.id) ? 'running' : 'not running'}${p.workFolder ? ` · folder ${p.workFolder}` : ''}`,
        );
      return lines.join('\n') || 'No profiles.';
    },
    async sessions(name) {
      const profile = await find(name);
      const live = await host.sessions(profile.id);
      return live.length
        ? live
            .map((s) => {
              const plan = s.summary?.plan ?? [];
              const done = plan.filter((step) => step.status === 'completed').length;
              return `- ${s.summary?.title || 'Claude Code session'} · id ${s.id} · ${labels[s.state]}${plan.length ? ` · ${done}/${plan.length} steps` : ''}${s.summary?.prompt ? ` · last prompt: ${s.summary.prompt.slice(0, 160)}` : ''}`;
            })
            .join('\n')
        : `${profile.name} has no live sessions.`;
    },
    async start(name, prompt, folder) {
      const profile = await find(name);
      const where = path.resolve(folder || profile.workFolder || os.homedir());
      // A session can read and write wherever its folder allows, so it stays inside the user's home.
      if (where !== os.homedir() && !where.startsWith(os.homedir() + path.sep))
        throw new Error('The folder must be inside the home folder.');
      if (!(await fs.stat(where).catch(() => undefined))?.isDirectory())
        throw new Error(`No such folder: ${where}`);
      await host.log('operator-start', profile.id).catch(() => {});
      const opened = await host.open(profile.id, newSessionLink(prompt, where));
      return opened
        ? `Started a new session in ${profile.name}'s Claude (folder ${where}).`
        : `Launched ${profile.name}'s Claude, but the session may not have started; check its pet.`;
    },
  };
  actions.notes = async (tool, args) => {
    if (tool === 'save_note') {
      const file = notePath(host.codexVault, String(args.note));
      await fs.mkdir(host.codexVault, { recursive: true });
      await fs.writeFile(file, String(args.text), 'utf8');
      return `Saved “${args.note}” to your own memory.`;
    }
    const folder =
      String(args.profile).toLowerCase() === 'codex'
        ? host.codexVault
        : await host.vault((await find(String(args.profile))).id);
    if (!(await fs.stat(folder).catch(() => undefined))?.isDirectory()) return 'That vault has no notes yet.';
    return readVault(folder, tool, args);
  };
  return serveOperator(socketPath, actions);
}
