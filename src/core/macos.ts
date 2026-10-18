import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { launchArguments, launchEnvironment, ownsProcess } from './launch.ts';
import type { ProcessObservation } from './launch.ts';
import type { Installation } from './platform.ts';

const execute = promisify(execFile);
export function bundleFromOverride(override: string): string {
  if (!path.posix.isAbsolute(override)) throw new Error('Choose the installed Claude.app bundle.');
  const suffix = '/Contents/MacOS/Claude';
  const bundle = override.endsWith(suffix) ? override.slice(0, -suffix.length) : override;
  if (!bundle.endsWith('.app')) throw new Error('Choose the installed Claude.app bundle.');
  return bundle;
}
async function inspectBundle(bundle: string): Promise<Installation> {
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const read = async (key: string) =>
    (
      await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { timeout: 5000 })
    ).stdout.trim();
  if (
    (await read('CFBundleIdentifier')) !== 'com.anthropic.claudefordesktop' ||
    (await read('CFBundleExecutable')) !== 'Claude'
  )
    throw new Error('Choose the official Claude Desktop app.');
  const executable = await fs.realpath(path.join(bundle, 'Contents', 'MacOS', 'Claude'));
  await fs.access(executable, fs.constants.X_OK);
  return { executable, version: await read('CFBundleShortVersionString'), kind: 'macOS' };
}
export async function detectInstallation(override = ''): Promise<Installation | null> {
  if (override) {
    try {
      return await inspectBundle(bundleFromOverride(override));
    } catch {
      throw new Error(
        'Claude.app was not found or is not a valid Claude Desktop installation. Choose it again in Settings.',
      );
    }
  }
  for (const bundle of ['/Applications/Claude.app', path.join(homedir(), 'Applications', 'Claude.app')]) {
    try {
      return await inspectBundle(bundle);
    } catch {}
  }
  const result = await execute(
    '/usr/bin/mdfind',
    ["kMDItemCFBundleIdentifier == 'com.anthropic.claudefordesktop'"],
    { timeout: 5000 },
  );
  for (const bundle of result.stdout.trim().split('\n').filter(Boolean)) {
    try {
      return await inspectBundle(bundle);
    } catch {}
  }
  return null;
}
function helperPath() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  // Packaged helper sits outside app.asar, where macOS can execute and sign it.
  return resources && !resources.endsWith('/Electron.app/Contents/Resources')
    ? path.join(resources, 'hatstand-macos')
    : path.resolve(
        typeof __dirname === 'string' ? __dirname : 'dist',
        '..',
        'resources',
        'bin',
        'hatstand-macos',
      );
}
async function helper(args: string[]) {
  try {
    return (await execute(helperPath(), args, { timeout: 10_000, maxBuffer: 4_000_000 })).stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(
      failure.stderr?.trim() || 'Could not inspect Claude processes. Rebuild or reinstall Hatstand.',
    );
  }
}
export async function listClaudeProcesses(): Promise<ProcessObservation[]> {
  return JSON.parse(await helper(['list'])) as ProcessObservation[];
}
export async function launchClaude(
  installation: Installation,
  desktop: string,
  code: string,
): Promise<number> {
  const running = (await listClaudeProcesses()).find((p) => ownsProcess(p, installation.executable, desktop));
  if (running) {
    await helper(['focus', String(running.pid), running.createdAt, installation.executable, desktop]);
    return running.pid;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(installation.executable, launchArguments(desktop), {
      cwd: path.dirname(installation.executable),
      env: launchEnvironment(process.env, desktop, code),
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid!);
    });
  });
}
/** Opens a Claude Code session in the profile's own running Claude. False when that Claude isn't running. */
export async function openClaudeSession(
  installation: Installation,
  desktop: string,
  session: string,
): Promise<boolean> {
  const running = (await listClaudeProcesses()).find((p) => ownsProcess(p, installation.executable, desktop));
  if (!running) return false;
  const url = `claude://code/continue?session=${encodeURIComponent(session)}`;
  await helper(['open-url', String(running.pid), running.createdAt, installation.executable, desktop, url]);
  return true;
}
export async function closeOwnedProcess(
  installation: Installation,
  desktop: string,
  expected: ProcessObservation,
  force: boolean,
): Promise<void> {
  if (!ownsProcess(expected, installation.executable, desktop))
    throw new Error('The process changed. Refresh and try again.');
  // The native helper rechecks PID, microsecond start time, executable and exact profile argument.
  await helper([
    force ? 'force-close' : 'close',
    String(expected.pid),
    expected.createdAt,
    installation.executable,
    desktop,
  ]);
}
