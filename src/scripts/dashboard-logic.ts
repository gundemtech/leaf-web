// Pure, DOM-free helpers for /dashboard. Extracted so they can be unit-tested
// without a browser (see dashboard-logic.test.ts). dashboard.ts is the thin
// DOM + async orchestrator built on top of these.

export const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  gitlab: 'GitLab',
  email: 'Email',
};

export function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? (p ? p[0].toUpperCase() + p.slice(1) : p);
}

// "Google (Google · GitHub · Password)" — the first registration provider,
// then the current set of sign-in methods in parens (OAuth methods, plus
// Password when a password credential exists). Falls back to just the first
// provider when there are no extra methods to list.
export function buildProviderLine(opts: {
  provider: string;
  providers: string[];
  hasPassword: boolean;
}): string {
  const first = providerLabel(opts.provider);
  const oauthMethods = opts.providers.filter((p) => p !== 'email').map(providerLabel);
  const methods = [...oauthMethods, ...(opts.hasPassword ? ['Password'] : [])];
  return methods.length ? `${first} (${methods.join(' · ')})` : first;
}

export const PASSWORD_RULES: Record<string, (v: string) => boolean> = {
  length: (v) => v.length >= 8,
  upper: (v) => /[A-Z]/.test(v),
  lower: (v) => /[a-z]/.test(v),
  number: (v) => /[0-9]/.test(v),
  symbol: (v) => /[^A-Za-z0-9]/.test(v),
};

// Which rules a candidate password currently satisfies, keyed by rule name.
export function evaluateRules(v: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, fn] of Object.entries(PASSWORD_RULES)) out[name] = fn(v);
  return out;
}

export function meetsAllRules(v: string): boolean {
  return Object.values(PASSWORD_RULES).every((fn) => fn(v));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export interface UaData {
  platform?: string;
  brands?: Array<{ brand: string; version: string }>;
}

// "macOS · Chrome 142". Prefers the structured userAgentData (Chromium), falls
// back to parsing the userAgent string. Pure: the caller passes navigator's
// values in, so this is testable without a browser.
export function describeDevice(ua: string, uaData?: UaData): string {
  let os = '';
  let browser = '';

  if (uaData) {
    os = uaData.platform ?? '';
    const brand = (uaData.brands ?? []).find(
      (b) => !/Not.?A.?Brand/i.test(b.brand) && b.brand !== 'Chromium',
    );
    if (brand) browser = `${brand.brand.replace(/^Google /, '')} ${brand.version}`;
  }

  if (!os) {
    // iOS/Android first: their UAs also contain "Mac OS X"/"Linux".
    os = /(iPhone|iPad|iPod)/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? 'macOS'
      : /Windows/.test(ua) ? 'Windows'
      : /Linux/.test(ua) ? 'Linux'
      : '';
  }
  if (!browser) {
    let m: RegExpMatchArray | null;
    if ((m = ua.match(/Edg\/(\d+)/)))                     browser = `Edge ${m[1]}`;
    else if ((m = ua.match(/Firefox\/(\d+)/)))            browser = `Firefox ${m[1]}`;
    else if ((m = ua.match(/Chrome\/(\d+)/)))             browser = `Chrome ${m[1]}`;
    else if ((m = ua.match(/Version\/(\d+)[^ ]* Safari/))) browser = `Safari ${m[1]}`;
    else if (/Safari/.test(ua))                           browser = 'Safari';
  }

  return [os, browser].filter(Boolean).join(' · ') || 'Unknown device';
}
