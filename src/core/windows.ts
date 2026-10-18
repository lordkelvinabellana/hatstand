import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { launchArguments, launchEnvironment, ownsProcess } from './launch.ts';
import type { ProcessObservation } from './launch.ts';
const execute = promisify(execFile);
import type { Installation } from './platform.ts';
export type { Installation } from './platform.ts';
async function ps(script: string) {
  const result = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 },
  );
  return result.stdout.trim();
}

function versionParts(version: string) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
/** Picks the newest `app-<version>` folder, as used by Squirrel.Windows installs. */
export function newestSquirrelApp(entries: string[]): { folder: string; version: string } | null {
  const versions = entries
    .map((folder) => ({ folder, match: /^app-(\d+(?:\.\d+){1,3})$/.exec(folder) }))
    .filter((entry) => entry.match)
    .map((entry) => ({ folder: entry.folder, version: entry.match![1] }));
  versions.sort((a, b) => compareVersions(b.version, a.version));
  return versions[0] ?? null;
}
async function isFile(file: string) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
// Squirrel replaces `app-<version>` on every update, so a stored path would go stale.
// Resolve to the newest sibling that still contains Claude.exe.
async function squirrelInstallation(root: string, kind: Installation['kind']): Promise<Installation | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return null;
  }
  while (entries.length) {
    const newest = newestSquirrelApp(entries);
    if (!newest) return null;
    const executable = path.join(root, newest.folder, 'claude.exe');
    if (await isFile(executable)) return { executable, version: newest.version, kind };
    entries = entries.filter((entry) => entry !== newest.folder);
  }
  return null;
}

export async function detectInstallation(override = ''): Promise<Installation | null> {
  if (process.platform !== 'win32') return null;
  if (override) {
    if (!path.isAbsolute(override) || path.basename(override).toLowerCase() !== 'claude.exe')
      throw new Error('Choose the installed Claude.exe file.');
    const parent = path.dirname(override);
    if (/^app-\d/i.test(path.basename(parent))) {
      const resolved = await squirrelInstallation(path.dirname(parent), 'Manual');
      if (resolved) return resolved;
    }
    if (!(await isFile(override))) throw new Error('Claude.exe was not found. Choose it again in Settings.');
    return { executable: override, version: 'Unknown', kind: 'Manual' };
  }
  const output = await ps(
    "$p = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { @{executable=(Join-Path $p.InstallLocation 'app\\Claude.exe'); version=$p.Version.ToString(); kind='MSIX'} | ConvertTo-Json -Compress }",
  );
  if (output) {
    const found = JSON.parse(output) as Installation;
    await fs.access(found.executable);
    return found;
  }
  // Non-MSIX installer (not verified by the maintainers; see docs/COMPATIBILITY.md).
  const local = process.env.LOCALAPPDATA;
  return local ? squirrelInstallation(path.join(local, 'AnthropicClaude'), 'Squirrel') : null;
}
export async function listClaudeProcesses(): Promise<ProcessObservation[]> {
  if (process.platform !== 'win32') return [];
  const result = await ps(
    "@(Get-CimInstance Win32_Process -Filter \"Name='Claude.exe'\" | Where-Object { $_.CommandLine -like '*--user-data-dir=*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { @{pid=[int]$_.ProcessId; executable=$_.ExecutablePath; commandLine=$_.CommandLine; createdAt=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress",
  );
  if (!result) return [];
  const values = JSON.parse(result);
  return Array.isArray(values) ? values : [values];
}
export async function launchClaude(
  installation: Installation,
  desktop: string,
  code: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(installation.executable, launchArguments(desktop), {
      cwd: path.dirname(installation.executable),
      env: launchEnvironment(process.env, desktop, code),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid!);
    });
  });
}
export async function closeOwnedProcess(
  installation: Installation,
  desktop: string,
  expected: ProcessObservation,
  force: boolean,
): Promise<void> {
  const current = (await listClaudeProcesses()).find(
    (p) => p.pid === expected.pid && p.createdAt === expected.createdAt,
  );
  if (!current || !ownsProcess(current, installation.executable, desktop))
    throw new Error('The process changed. Refresh and try again.');
  // No image-name targeting. Non-forced taskkill requests a graceful close on Windows.
  await execute('taskkill.exe', ['/PID', String(current.pid), ...(force ? ['/T', '/F'] : [])], {
    windowsHide: true,
    timeout: 10_000,
  });
}
