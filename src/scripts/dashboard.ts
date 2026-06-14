// /dashboard wiring — auth gate, populate user fields, sign out, delete account.
import { getSupabase } from './supabase-client';

const sb = getSupabase();

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function setField(field: string, value: string): void {
  const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (el) el.textContent = value;
}

// ─── Shared account state ──────────────────────────────────────────────
// Read AND mutated by both the init block below and the set-password
// handler further down (two separate IIFEs), so it lives at module scope.
let hasPwd = false;
let firstProvider = 'Email';
let oauthMethods: string[] = [];

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  gitlab: 'GitLab',
  email: 'Email',
};
function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? (p ? p[0].toUpperCase() + p.slice(1) : p);
}

// "Google (Google · GitHub · Password)" — first registration, then the
// current set of sign-in methods in parens. Password appended when known.
function renderProvider(): void {
  const methods = [...oauthMethods, ...(hasPwd ? ['Password'] : [])];
  setField('provider', methods.length ? `${firstProvider} (${methods.join(' · ')})` : firstProvider);
}

// Current device only (no history): "macOS · Chrome 142". Prefers the
// structured userAgentData (Chromium), falls back to parsing userAgent.
function describeDevice(): string {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> };
  }).userAgentData;

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

// Password control copy reflects whether a password actually exists.
function applyPasswordUi(): void {
  const spBlock = document.querySelector<HTMLElement>('[data-set-password]');
  if (!spBlock) return;
  spBlock.removeAttribute('hidden');
  const toggleBtn = document.getElementById('set-password-toggle');
  const intro = spBlock.querySelector<HTMLElement>('.set-password-head .muted');
  if (hasPwd) {
    if (toggleBtn) toggleBtn.textContent = 'Change password';
    if (intro) intro.textContent = 'Change your account password.';
  } else {
    if (toggleBtn) toggleBtn.textContent = 'Set a password';
    if (intro) intro.textContent =
      'Want to sign in with email + password too? Set a password for your account.';
  }
}

(async () => {
  const { data } = await sb.auth.getSession();
  const session = data?.session;
  if (!session) {
    window.location.href = '/signup';
    return;
  }
  const user = session.user;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = String(meta.full_name ?? meta.name ?? meta.user_name ?? '-');

  const provider = String(user.app_metadata?.provider ?? 'email');
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [provider];
  firstProvider = providerLabel(provider);
  oauthMethods = providers.filter((p) => p !== 'email').map(providerLabel);

  setField('name', fullName);
  setField('email', user.email ?? '-');
  setField('memberSince', user.created_at ? fmtDate(user.created_at) : '-');
  setField('device', describeDevice());

  const echo = document.querySelector<HTMLElement>('[data-user-email]');
  if (echo) echo.textContent = user.email ?? '-';

  // Whether a password is set isn't visible client-side for OAuth users
  // (Supabase stores the hash on auth.users without creating an email
  // identity), so ask the server. 'email' among providers already implies a
  // password. Treat RPC errors / missing function as "no password".
  hasPwd = providers.includes('email');
  if (!hasPwd) {
    try {
      const { data: hp } = await sb.rpc('has_password');
      hasPwd = hp === true;
    } catch { /* RPC absent or offline → assume no password */ }
  }

  renderProvider();
  applyPasswordUi();
})();

// ─── Set a password (OAuth users) ──────────────────────────────────────
// Lets Google/GitHub users add an email+password credential so they can
// also sign in with email. The control is hidden by default and revealed
// above once we know the provider is not "email".
(() => {
  const toggle = document.getElementById('set-password-toggle');
  const form = document.querySelector<HTMLFormElement>('[data-set-password-form]');
  const pwInput = document.querySelector<HTMLInputElement>('[data-sp-password]');
  const confirmInput = document.querySelector<HTMLInputElement>('[data-sp-confirm]');
  const reqList = document.querySelector<HTMLElement>('[data-sp-requirements]');
  const errEl = document.querySelector<HTMLElement>('[data-sp-error]');
  const okEl = document.querySelector<HTMLElement>('[data-sp-success]');
  if (!toggle || !form || !pwInput || !confirmInput || !reqList) return;

  const rules: Record<string, (v: string) => boolean> = {
    length: (v) => v.length >= 8,
    upper: (v) => /[A-Z]/.test(v),
    lower: (v) => /[a-z]/.test(v),
    number: (v) => /[0-9]/.test(v),
    symbol: (v) => /[^A-Za-z0-9]/.test(v),
  };
  const meetsAllRules = (v: string): boolean =>
    Object.values(rules).every((fn) => fn(v));

  const setSpError = (msg: string): void => {
    if (!errEl) return;
    if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
    errEl.hidden = false;
    errEl.textContent = msg;
  };
  const setSpSuccess = (msg: string): void => {
    if (!okEl) return;
    if (!msg) { okEl.hidden = true; okEl.textContent = ''; return; }
    okEl.hidden = false;
    okEl.textContent = msg;
  };

  const updateRequirements = (): void => {
    const v = pwInput.value;
    reqList.querySelectorAll<HTMLElement>('.requirement').forEach((row) => {
      const rule = rules[row.dataset.rule ?? ''];
      row.classList.toggle('met', !!rule && rule(v));
    });
  };
  pwInput.addEventListener('input', updateRequirements);
  updateRequirements();

  toggle.addEventListener('click', () => {
    const isHidden = form.hasAttribute('hidden');
    form.toggleAttribute('hidden', !isHidden);
    if (!isHidden) return; // was open → now closed, nothing else to do
    setSpError('');
    setSpSuccess('');
    pwInput.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setSpError('');
    setSpSuccess('');
    const password = pwInput.value;
    const confirm = confirmInput.value;
    if (!meetsAllRules(password)) {
      setSpError('Password must meet all requirements.');
      return;
    }
    if (password !== confirm) {
      setSpError('Passwords do not match.');
      return;
    }
    const { error } = await sb.auth.updateUser({ password });
    if (error) { setSpError(error.message); return; }
    form.reset();
    updateRequirements();
    // Message reflects the PRIOR state; then flip to "has password" and
    // re-render the methods line + control copy live (no reload).
    setSpSuccess(hasPwd
      ? 'Password changed.'
      : 'Password set — you can now sign in with email + password too.');
    hasPwd = true;
    renderProvider();
    applyPasswordUi();
  });
})();

// Sign out (button handler already wired inline in dashboard.astro,
// but listening here too ensures clean Supabase signOut even if inline JS misses).
document.getElementById('signout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await sb.auth.signOut();
  window.location.href = '/';
});

// Delete account — opens an in-page animated confirmation modal, then on
// confirm calls Supabase's RPC, signs out and redirects.
// Backed by an SQL function `delete_self_account()` defined server-side
// (security definer, idempotent). If the RPC is missing, surface the error
// inside the modal (no native dialogs).
(() => {
  const openBtn = document.getElementById('delete-btn');
  const overlay = document.querySelector<HTMLElement>('[data-delete-modal]');
  const dialog = document.querySelector<HTMLElement>('[data-delete-dialog]');
  const cancelBtn = document.getElementById('delete-cancel-btn');
  const confirmBtn = document.getElementById('delete-confirm-btn') as HTMLButtonElement | null;
  const errEl = document.querySelector<HTMLElement>('[data-delete-error]');
  if (!openBtn || !overlay || !dialog || !cancelBtn || !confirmBtn) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const setDeleteError = (msg: string): void => {
    if (!errEl) return;
    if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
    errEl.hidden = false;
    errEl.textContent = msg;
  };

  const openModal = (): void => {
    setDeleteError('');
    overlay.classList.remove('is-closing');
    overlay.hidden = false;
    confirmBtn.focus();
  };

  const closeModal = (): void => {
    if (prefersReducedMotion) {
      overlay.hidden = true;
      overlay.classList.remove('is-closing');
      openBtn.focus();
      return;
    }
    overlay.classList.add('is-closing');
    const onEnd = (ev: AnimationEvent): void => {
      if (ev.target !== overlay) return; // wait for the overlay's own fade-out
      overlay.hidden = true;
      overlay.classList.remove('is-closing');
      overlay.removeEventListener('animationend', onEnd);
      openBtn.focus();
    };
    overlay.addEventListener('animationend', onEnd);
  };

  openBtn.addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });

  // Backdrop click (outside the dialog) closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Escape closes while the modal is open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });

  confirmBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    setDeleteError('');
    confirmBtn.setAttribute('aria-disabled', 'true');
    const { error } = await sb.rpc('delete_self_account');
    if (error) {
      confirmBtn.removeAttribute('aria-disabled');
      setDeleteError(`Account deletion failed: ${error.message}`);
      return;
    }
    await sb.auth.signOut();
    window.location.href = '/';
  });
})();
