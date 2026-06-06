// Build-time single source of truth for the shipped Leaf version.
//
// Fetched from the live Sparkle appcast — the exact feed users download and
// auto-update from — once per `astro build` (and once per `astro dev` start).
// No hardcoded versions anywhere else on the site: import from this module.
//
// Fails the build loudly if the appcast is unreachable or unparseable:
// a failed deploy is better than silently shipping a stale version badge.

const APPCAST_URL = 'https://updates.gundem.tech/appcast.xml';

/** Compare "1.0.0-alpha.27"-style versions. Returns <0, 0, >0. */
function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitOnce(a, '-');
  const [coreB, preB] = splitOnce(b, '-');

  const segsA = coreA.split('.').map(Number);
  const segsB = coreB.split('.').map(Number);
  for (let i = 0; i < Math.max(segsA.length, segsB.length); i++) {
    const d = (segsA[i] ?? 0) - (segsB[i] ?? 0);
    if (d !== 0) return d;
  }

  // Same core: a release (no prerelease tag) outranks any prerelease.
  if (!preA && !preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;

  // Both prerelease: compare dot-segments, numerically where possible
  // ("alpha.9" < "alpha.27").
  const pA = preA.split('.');
  const pB = preB.split('.');
  for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
    const sA = pA[i];
    const sB = pB[i];
    if (sA === undefined) return -1;
    if (sB === undefined) return 1;
    const nA = Number(sA);
    const nB = Number(sB);
    const bothNumeric = !Number.isNaN(nA) && !Number.isNaN(nB);
    const d = bothNumeric ? nA - nB : sA.localeCompare(sB);
    if (d !== 0) return d;
  }
  return 0;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(APPCAST_URL);
  if (!res.ok) {
    throw new Error(`[version.ts] appcast fetch failed: ${res.status} ${APPCAST_URL}`);
  }
  const xml = await res.text();
  const versions = [...xml.matchAll(
    /<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/g,
  )].map((m) => m[1].trim());
  if (versions.length === 0) {
    throw new Error(`[version.ts] no <sparkle:shortVersionString> items in appcast — feed format changed?`);
  }
  versions.sort(compareVersions);
  return versions[versions.length - 1];
}

/** Latest shipped version, e.g. "1.0.0-alpha.27". */
export const LEAF_VERSION = await fetchLatestVersion();

/** Display form with the "v" prefix, e.g. "v1.0.0-alpha.27". */
export const LEAF_VERSION_TAG = `v${LEAF_VERSION}`;

/** Direct download URL of the shipped .dmg (versioned, matches release.sh layout). */
export const LEAF_DMG_URL = `https://updates.gundem.tech/releases/Leaf-${LEAF_VERSION}.dmg`;

/** SHA-256 checksum file published next to the .dmg. */
export const LEAF_DMG_SHA256_URL = `${LEAF_DMG_URL}.sha256`;
