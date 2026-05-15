// RSS 2.0 generator: fetches the canonical JSON feed at build time and
// re-emits as RSS 2.0 preserving the existing format from the legacy site.
// The JSON feed lives at the same origin and is updated by the
// Cloudflare Worker / Telegram approval flow (unchanged by this redesign).

import type { APIRoute } from 'astro';

type FeedEntry = {
  id?: string;
  url?: string;
  title: string;
  date_published: string;
  author?: { name?: string };
  tags?: string[];
  content_html?: string;
  content_text?: string;
};

const JSON_FEED_URL = 'https://leaf.gundem.tech/changelog/latest.json';
const SITE = 'https://leaf.gundem.tech';
const TITLE = 'Leaf: Changelog';
const DESCRIPTION = 'Releases, fixes, and shipped features for Leaf.';

function escapeXML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]!));
}
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export const GET: APIRoute = async () => {
  let items: FeedEntry[] = [];
  try {
    const res = await fetch(JSON_FEED_URL, { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      items = Array.isArray(json.items) ? json.items.slice(0, 50) : [];
    }
  } catch {
    // fall through with empty items
  }

  const xmlItems = items.map((e) => {
    const url = e.url ?? `${SITE}/changelog#${e.id ?? ''}`;
    const body = e.content_html ?? (e.content_text ?? '');
    return `    <item>
      <title>${escapeXML(e.title)}</title>
      <link>${escapeXML(url)}</link>
      <guid isPermaLink="false">${escapeXML(e.id ?? url)}</guid>
      <pubDate>${rfc822(e.date_published)}</pubDate>
      ${e.author?.name ? `<dc:creator>${escapeXML(e.author.name)}</dc:creator>` : ''}
      <description><![CDATA[${body}]]></description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXML(TITLE)}</title>
    <link>${SITE}/changelog</link>
    <atom:link href="${SITE}/changelog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXML(DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${xmlItems}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};
