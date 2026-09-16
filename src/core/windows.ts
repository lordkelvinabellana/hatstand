import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { launchArguments, launchEnvironment, ownsProcess } from './launch.ts';
import type { ProcessObservation } from './launch.ts';
const execute = promisify(execFile);
export interface Installation {
  executable: string;
  version: string;
  kind: 'MSIX' | 'Manual';
}
export interface RunningProcess extends ProcessObservation {
  hasWindow: boolean;
}
async function ps(script: string) {
  const result = await execute(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 },
  );
  return result.stdout.trim();
}
export async function detectInstallation(override = ''): Promise<Installation | null> {
  if (process.platform !== 'win32') return null;
  if (override) {
    if (!path.isAbsolute(override) || path.basename(override).toLowerCase() !== 'claude.exe')
      throw new Error('Choose the installed Claude.exe file.');
    if (!(await fs.stat(override)).isFile()) throw new Error('Claude.exe was not found.');
    return { executable: override, version: 'Unverified', kind: 'Manual' };
  }
  const output = await ps(
    "$p = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1; if ($p) { @{executable=(Join-Path $p.InstallLocation 'app\\Claude.exe'); version=$p.Version.ToString(); kind='MSIX'} | ConvertTo-Json -Compress }",
  );
  if (!output) return null;
  const found = JSON.parse(output) as Installation;
  await fs.access(found.executable);
  return found;
}
export async function listClaudeProcesses(): Promise<RunningProcess[]> {
  if (process.platform !== 'win32') return [];
  const result = await ps(
    "@(Get-CimInstance Win32_Process -Filter \"Name='Claude.exe'\" | Where-Object { $_.CommandLine -like '*--user-data-dir=*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; @{pid=[int]$_.ProcessId; executable=$_.ExecutablePath; commandLine=$_.CommandLine; createdAt=$_.CreationDate.ToUniversalTime().ToString('o'); hasWindow=($p.MainWindowHandle -ne 0)} }) | ConvertTo-Json -Compress",
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
  expected: RunningProcess,
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
