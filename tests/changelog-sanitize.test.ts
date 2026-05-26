import { describe, it, expect } from 'vitest';
import { sanitizeChangelogHTML } from '../src/scripts/sanitize-html';

// OWASP XSS filter-evasion vectors (cheat-sheet top-10 + 3 obfuscations the
// CTO review flagged: protocol-relative, tab-split scheme, entity-encoded).
const XSS_VECTORS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)></svg>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<body onload=alert(1)>',
  '<input autofocus onfocus=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '"><script>alert(1)</script>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<math><mtext><a xlink:href="javascript:alert(1)">click</a></mtext></math>',
  '<a href="//evil.example">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href="javascript&colon;alert(1)">x</a>',
];

const FORBIDDEN = ['<script', 'onerror', 'onload', 'ontoggle', 'onfocus', 'javascript:', 'data:', '<iframe', '<svg'];

describe('sanitizeChangelogHTML — neutralizes XSS vectors', () => {
  for (const vector of XSS_VECTORS) {
    it(`strips: ${vector}`, () => {
      const out = sanitizeChangelogHTML(vector).toLowerCase();
      for (const bad of FORBIDDEN) {
        expect(out).not.toContain(bad);
      }
      // no surviving protocol-relative or javascript: href
      expect(out).not.toMatch(/href\s*=\s*["']?\s*\/\//);
      expect(out).not.toMatch(/href\s*=\s*["']?\s*java/);
    });
  }
});

describe('sanitizeChangelogHTML — preserves benign formatting', () => {
  it('keeps safe tags and https links', () => {
    const out = sanitizeChangelogHTML(
      '<p>Shipped <strong>X</strong> — see <a href="https://leaf.gundem.tech">docs</a></p>',
    );
    expect(out).toContain('<strong>');
    expect(out).toContain('<p>');
    expect(out).toContain('href="https://leaf.gundem.tech"');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeChangelogHTML('')).toBe('');
  });
});
