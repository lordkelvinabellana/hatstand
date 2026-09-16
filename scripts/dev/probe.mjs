// Disposable compatibility experiment for maintainers: launches up to three fresh Claude
// profiles under .local/probe (ignored by Git). No account data is copied or inspected.
// Usage: node scripts/dev/probe.mjs launch [test-a|test-b|test-c] | status
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchEnvironment } from '../../src/core/launch.ts';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = path.join(project, '.local', 'probe');
fs.mkdirSync(root, { recursive: true });
function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}
const operation = process.argv[2] ?? 'status';
const installation = JSON.parse(
  powershell(
    'Get-AppxPackage -Name Claude | Select-Object Version,InstallLocation | ConvertTo-Json -Compress',
  ),
);
const exe = path.join(installation.InstallLocation, 'app', 'Claude.exe');
const labels = ['test-a', 'test-b', 'test-c'];
if (operation === 'launch') {
  const selected = process.argv[3] ? [process.argv[3]] : labels;
  for (const label of selected) {
    if (!labels.includes(label)) throw new Error('Unknown test profile');
    const dataDir = path.join(root, label, 'desktop');
    const codeDir = path.join(root, label, 'code');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(codeDir, { recursive: true });
    const child = spawn(exe, [`--user-data-dir=${dataDir}`], {
      env: launchEnvironment(process.env, dataDir, codeDir),
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => console.error(`${label}: ${err.message}`));
    child.unref();
    console.log(JSON.stringify({ label, pid: child.pid, version: installation.Version }));
  }
} else if (operation === 'status') {
  const processes = JSON.parse(
    powershell(
      "@(Get-CimInstance Win32_Process -Filter \"Name='Claude.exe'\" | Where-Object { $_.CommandLine -like '*clientdeck*probe*' } | ForEach-Object { $w = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [PSCustomObject]@{pid=$_.ProcessId; parent=$_.ParentProcessId; window=($w.MainWindowHandle -ne 0); profile=if($_.CommandLine -match 'test-([abc])'){ $Matches[0] }else{'unknown'}; main=($_.CommandLine -notmatch '--type=')} }) | ConvertTo-Json -Compress",
    ) || '[]',
  );
  const profiles = labels.map((label) => {
    const dir = path.join(root, label, 'desktop');
    return { label, entries: fs.existsSync(dir) ? fs.readdirSync(dir) : [] };
  });
  console.log(JSON.stringify({ version: installation.Version, processes, profiles }, null, 2));
} else throw new Error('Use launch [test-a|test-b|test-c] or status');
