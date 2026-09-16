// Public project locations. Update these if the repository moves.
export const repository = 'lordkelvinabellana/hatstand';
export const repositoryUrl = `https://github.com/${repository}`;
export const releasesUrl = `${repositoryUrl}/releases`;
export const issuesUrl = `${repositoryUrl}/issues`;

export interface ReleaseInfo {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  notes: string;
}

function semver(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? '' };
}
/** True when `candidate` is a strictly newer semantic version than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = semver(candidate);
  const b = semver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  if (a.prerelease === b.prerelease) return false;
  if (!a.prerelease) return true; // 1.0.0 is newer than 1.0.0-beta
  if (!b.prerelease) return false;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true }) > 0;
}

/** Validates GitHub's `releases/latest` response. Links must stay on this repository's release pages. */
export function parseLatestRelease(data: unknown): ReleaseInfo {
  const release = data as Record<string, unknown> | null;
  if (
    !release ||
    typeof release.tag_name !== 'string' ||
    typeof release.html_url !== 'string' ||
    !release.html_url.startsWith(`${releasesUrl}/`) ||
    !semver(release.tag_name)
  )
    throw new Error('GitHub returned an unexpected release format.');
  return {
    version: release.tag_name.replace(/^v/, ''),
    name: typeof release.name === 'string' && release.name ? release.name.slice(0, 200) : release.tag_name,
    url: release.html_url,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
    notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '',
  };
}
