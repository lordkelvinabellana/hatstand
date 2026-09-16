// Single source for compatibility claims shown in the app and diagnostics.
// Keep in sync with docs/COMPATIBILITY.md; record only observed evidence.

export const testedClaudeVersions = ['1.52386.6.0', '2.110.0.0'];

export type CheckResult = 'observed' | 'user-confirmed' | 'unverified';
export const compatibilityChecks: { key: string; label: string; result: CheckResult }[] = [
  { key: 'parallelLaunch', label: 'Parallel Claude Desktop windows', result: 'observed' },
  { key: 'twoAccountSignIn', label: 'Two account sign-ins', result: 'user-confirmed' },
  { key: 'reopenPersistence', label: 'Stays signed in after quit and reopen', result: 'observed' },
  { key: 'rebootPersistence', label: 'Stays signed in after a Windows reboot', result: 'unverified' },
  { key: 'logoutIsolation', label: 'Signing out affects only that profile', result: 'unverified' },
  { key: 'cowork', label: 'Cowork task execution and separation', result: 'unverified' },
  { key: 'desktopCode', label: 'Desktop Code task execution and separation', result: 'unverified' },
];

export function isTestedVersion(version: string | undefined) {
  return !!version && testedClaudeVersions.includes(version);
}
