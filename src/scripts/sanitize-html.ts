// Shared HTML sanitizer for changelog entry bodies (`content_html`).
//
// Used in two places that both render untrusted feed HTML:
//   - the client `<script>` in src/pages/changelog/index.astro (innerHTML), and
//   - the build-time RSS generator in src/pages/changelog/feed.xml.ts.
//
// isomorphic-dompurify resolves to native DOMPurify in the browser (no jsdom in
// the client bundle) and to a jsdom-backed DOMPurify in Node (RSS build + tests).
//
// Policy: a tight allowlist for changelog formatting — links + basic block/inline
// tags only. No img/script/iframe/svg/object; only `href`/`title` attributes;
// only http(s)/mailto URL schemes (blocks javascript:, data:, protocol-relative).
import DOMPurify from 'isomorphic-dompurify';

export const CHANGELOG_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
    'code', 'pre', 'blockquote', 'h2', 'h3', 'h4', 'hr', 'span',
  ],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

export function sanitizeChangelogHTML(dirty: string): string {
  return DOMPurify.sanitize(dirty, CHANGELOG_SANITIZE_CONFIG) as string;
}
