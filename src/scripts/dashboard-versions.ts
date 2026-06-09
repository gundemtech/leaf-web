// /dashboard — live version detail.
//
// Fetches the canonical release list from updates.gundem.tech at runtime and
// enriches the static (build-time) "Latest: vX" label with a versioned DMG link
// and a collapsible history of prior releases.
//
// SECURITY: every string from the fetched JSON (versions, dates, and the
// added/fixed/changed notes) is rendered as TEXT via `textContent` / DOM
// construction only — NEVER innerHTML. The dashboard is an authenticated page;
// untrusted feed content must never reach the HTML parser. (If HTML rendering
// were ever required, route it through src/scripts/sanitize-html.ts instead.)

const RELEASES_URL = 'https://updates.gundem.tech/releases.json';

type Release = {
  version: string;
  date: string;
  added?: string[];
  fixed?: string[];
  changed?: string[];
  dmgURL?: string;
  zipURL?: string;
  yanked?: boolean;
};

type ReleasesFile = {
  schemaVersion?: number;
  releases?: Release[];
};

function el(container: HTMLElement | null): HTMLElement | null {
  return container;
}

function setText(node: HTMLElement | null, text: string): void {
  if (node) node.textContent = text;
}

// Builds an <li> for one release using only textContent — no HTML injection.
function buildHistoryItem(rel: Release): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'version-history-item';

  const head = document.createElement('div');
  head.className = 'version-history-head';

  const ver = document.createElement('span');
  ver.className = 'ver mono';
  ver.textContent = `v${rel.version}`;
  head.appendChild(ver);

  if (typeof rel.date === 'string' && rel.date) {
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = rel.date;
    head.appendChild(date);
  }

  if (rel.yanked === true) {
    const yanked = document.createElement('span');
    yanked.className = 'yanked';
    yanked.textContent = 'yanked';
    head.appendChild(yanked);
  }

  li.appendChild(head);

  const notes: Array<[string, string[] | undefined]> = [
    ['Added', rel.added],
    ['Fixed', rel.fixed],
    ['Changed', rel.changed],
  ];
  const hasNotes = notes.some(([, arr]) => Array.isArray(arr) && arr.length > 0);
  if (hasNotes) {
    const ul = document.createElement('ul');
    ul.className = 'version-history-notes';
    for (const [kind, arr] of notes) {
      if (!Array.isArray(arr)) continue;
      for (const line of arr) {
        if (typeof line !== 'string' || !line) continue;
        const item = document.createElement('li');
        const kindSpan = document.createElement('span');
        kindSpan.className = 'kind';
        kindSpan.textContent = `${kind}: `;
        item.appendChild(kindSpan);
        // textContent — the note string is rendered verbatim, never parsed as HTML.
        item.appendChild(document.createTextNode(line));
        ul.appendChild(item);
      }
    }
    li.appendChild(ul);
  }

  return li;
}

(async () => {
  const live = el(document.querySelector<HTMLElement>('[data-version-live]'));
  const label = el(document.querySelector<HTMLElement>('[data-version-label]'));
  const dmgLink = document.querySelector<HTMLAnchorElement>('[data-version-dmg]');
  const dmgName = el(document.querySelector<HTMLElement>('[data-version-dmg-name]'));
  const summary = el(document.querySelector<HTMLElement>('[data-version-history-summary]'));
  const list = document.querySelector<HTMLOListElement>('[data-version-history-list]');

  // No-op (keep the static fallback) if the markup isn't present.
  if (!live || !list) return;

  let data: ReleasesFile;
  try {
    const res = await fetch(RELEASES_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as ReleasesFile;
  } catch {
    // Network/parse failure — leave the build-time static label as the fallback.
    return;
  }

  const releases = Array.isArray(data.releases) ? data.releases : [];
  if (releases.length === 0) return;

  const latest = releases[0];
  if (!latest || typeof latest.version !== 'string') return;

  // Enrich the static label with the live latest version.
  setText(label, `v${latest.version}`);

  // Versioned DMG link for the latest release (falls back to the permalink href).
  if (dmgLink && typeof latest.dmgURL === 'string' && latest.dmgURL) {
    dmgLink.href = latest.dmgURL;
  }
  setText(dmgName, `v${latest.version}`);

  // History = releases after the newest.
  const prior = releases.slice(1);
  if (prior.length > 0) {
    setText(summary, `Version history (${prior.length})`);
    const frag = document.createDocumentFragment();
    for (const rel of prior) {
      if (!rel || typeof rel.version !== 'string') continue;
      frag.appendChild(buildHistoryItem(rel));
    }
    list.appendChild(frag);
  } else {
    // Only one release — hide the empty history disclosure.
    const details = list.closest('details');
    if (details) details.hidden = true;
  }

  // Reveal the enriched block now that it's populated.
  live.hidden = false;
})();
