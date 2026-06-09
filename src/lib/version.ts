// Build-time version source — the single source of truth for the version string
// shown across the site (hero strip, footer, dashboard, open-source page).
//
// Derived from the committed src/data/releases.json (a last-known snapshot of the
// app repo's Leaf/Resources/releases.json), so a standalone `pnpm build` is
// deterministic with no network access. The /dashboard page additionally fetches
// the LIVE list at runtime (see dashboard.astro) to enrich this static fallback.
//
// Fail-loud: if the data file is missing or has zero releases, the import below
// throws — and so the build fails — rather than silently shipping a blank/stale
// version. A release-time CI greps the built HTML for `latestVersion`.
import releasesData from '../data/releases.json';

export type Release = {
  version: string;
  date: string;
  added: string[];
  fixed: string[];
  changed: string[];
  dmgURL: string;
  zipURL: string;
  yanked?: boolean;
};

export type ReleasesFile = {
  schemaVersion: number;
  releases: Release[];
};

const data = releasesData as ReleasesFile;

if (!data || !Array.isArray(data.releases) || data.releases.length === 0) {
  throw new Error(
    'version.ts: src/data/releases.json is missing or has no releases — ' +
      'cannot derive the site version. Refresh it from the app repo.',
  );
}

/** Newest release (releases.json is newest-first). */
export const latestRelease: Release = data.releases[0];

/** Bare version string, e.g. "1.0.0-alpha.30". */
export const latestVersion: string = latestRelease.version;

/** Display version with leading "v", e.g. "v1.0.0-alpha.30". */
export const vLatest = `v${latestVersion}`;
