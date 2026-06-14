// /dashboard wiring — auth gate, populate user fields, sign out, delete account.
// Pure helpers (provider line, password rules, device, date) live in
// ./dashboard-logic so they can be unit-tested without a browser.
import { getSupabase } from './supabase-client';
import {
  buildProviderLine,
  describeDevice,
  evaluateRules,
  fmtDate,
  meetsAllRules,
} from './dashboard-logic';

const sb = getSupabase();

// Tell the inline pre-hydration fallback (in dashboard.astro) to stand down:
// once the module is live it owns sign-out, so the inline handler must not also
// fire — otherwise a click triggers signOut() + redirect twice.
(window as Window & { __leafDashHydrated?: boolean }).__leafDashHydrated = true;

function setField(field: string, value: string): void {
  const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (el) el.textContent = value;
}

// ─── Shared account state ──────────────────────────────────────────────
// Read AND mutated by both the init block and the set-password handler (two
// separate IIFEs), so it lives at module scope.
let hasPwd = false;
let provider = 'email';
let providers: string[] = ['email'];

function renderProvider(): void {
  setField('provider', buildProviderLine({ provider, providers, hasPassword: hasPwd }));
}

// Password control copy reflects whether a password actually exists.
function applyPasswordUi(): void {
  const toggleBtn = document.getElementById('set-password-toggle');
  const intro = document.querySelector<HTMLElement>('.set-password-head .muted');
  if (hasPwd) {
    if (toggleBtn) toggleBtn.textContent = 'Change password';
    if (intro) intro.textContent = 'Change your account password.';
  } else {
    if (toggleBtn) toggleBtn.textContent = 'Set a password';
    if (intro) intro.textContent =
      'Want to sign in with email + password too? Set a password for your account.';
  }
}

// Swap the Account card out of its skeleton state in a single paint: hide the
// set-password skeleton, reveal the real head, drop the grid's loading flag.
function reveal(): void {
  document.querySelector('[data-sp-skeleton]')?.setAttribute('hidden', '');
  document.querySelector('[data-sp-head]')?.removeAttribute('hidden');
  document.querySelector('[data-dash]')?.removeAttribute('data-loading');
}

(async () => {
  try {
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session) {
      window.location.href = '/signup';
      return;
    }
    const user = session.user;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = String(meta.full_name ?? meta.name ?? meta.user_name ?? '-');

    provider = String(user.app_metadata?.provider ?? 'email');
    providers = (user.app_metadata?.providers as string[] | undefined) ?? [provider];

    // Whether a password is set isn't visible client-side for OAuth users
    // (Supabase stores the hash on auth.users without creating an email
    // identity), so ask the server. 'email' among providers already implies a
    // password. Treat RPC errors / missing function as "no password". We resolve
    // this BEFORE writing any field so the whole card renders in one paint
    // (provider line + set-password block included) — no staggered pop-in.
    hasPwd = providers.includes('email');
    if (!hasPwd) {
      try {
        const { data: hp } = await sb.rpc('has_password');
        hasPwd = hp === true;
      } catch { /* RPC absent or offline → assume no password */ }
    }

    // Single synchronous batch → one paint, everything appears together.
    const uaData = (navigator as Navigator & { userAgentData?: import('./dashboard-logic').UaData })
      .userAgentData;
    setField('name', fullName);
    setField('email', user.email ?? '-');
    setField('memberSince', user.created_at ? fmtDate(user.created_at) : '-');
    setField('device', describeDevice(navigator.userAgent, uaData));
    const echo = document.querySelector<HTMLElement>('[data-user-email]');
    if (echo) echo.textContent = user.email ?? '-';
    renderProvider();
    applyPasswordUi();
    reveal();
  } catch {
    // getSession threw (e.g. corrupt token) — treat as signed out rather than
    // leaving the page stuck on the skeleton forever.
    window.location.href = '/signup';
  }
})();

// ─── Set a password (OAuth users) ──────────────────────────────────────
// Lets Google/GitHub users add an email+password credential so they can also
// sign in with email. Copy + button label come from applyPasswordUi above.
(() => {
  const toggle = document.getElementById('set-password-toggle');
  const form = document.querySelector<HTMLFormElement>('[data-set-password-form]');
  const pwInput = document.querySelector<HTMLInputElement>('[data-sp-password]');
  const confirmInput = document.querySelector<HTMLInputElement>('[data-sp-confirm]');
  const reqList = document.querySelector<HTMLElement>('[data-sp-requirements]');
  const errEl = document.querySelector<HTMLElement>('[data-sp-error]');
  const okEl = document.querySelector<HTMLElement>('[data-sp-success]');
  if (!toggle || !form || !pwInput || !confirmInput || !reqList) return;
  toggle.setAttribute('aria-controls', 'set-password-form');
  toggle.setAttribute('aria-expanded', 'false');

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
    const met = evaluateRules(pwInput.value);
    reqList.querySelectorAll<HTMLElement>('.requirement').forEach((row) => {
      row.classList.toggle('met', !!met[row.dataset.rule ?? '']);
    });
  };
  pwInput.addEventListener('input', updateRequirements);
  updateRequirements();

  toggle.addEventListener('click', () => {
    const wasHidden = form.hasAttribute('hidden');
    form.toggleAttribute('hidden', !wasHidden);
    toggle.setAttribute('aria-expanded', String(wasHidden)); // open now iff it was hidden
    if (!wasHidden) return; // was open → now closed, nothing else to do
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

// Sign out — the module owns this (the inline handler in dashboard.astro stands
// down once __leafDashHydrated is set), so this fires exactly once.
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
  const confirmLabel = confirmBtn.textContent ?? 'Delete account';

  const setDeleteError = (msg: string): void => {
    if (!errEl) return;
    if (!msg) { errEl.hidden = true; errEl.textContent = ''; return; }
    errEl.hidden = false;
    errEl.textContent = msg;
  };

  const setBusy = (busy: boolean): void => {
    confirmBtn.disabled = busy;
    confirmBtn.toggleAttribute('aria-disabled', busy); // drives the dimmed .btn style
    confirmBtn.textContent = busy ? 'Deleting…' : confirmLabel;
  };

  // Keep Tab focus inside the dialog while it's open.
  const trapFocus = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
    )];
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const openModal = (): void => {
    setDeleteError('');
    setBusy(false);
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

  // Escape closes; Tab is trapped — both only while the modal is open.
  document.addEventListener('keydown', (e) => {
    if (overlay.hidden) return;
    if (e.key === 'Escape') closeModal();
    else trapFocus(e);
  });

  confirmBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (confirmBtn.disabled) return; // re-entrancy guard
    setDeleteError('');
    setBusy(true);
    const { error } = await sb.rpc('delete_self_account');
    if (error) {
      setBusy(false);
      setDeleteError(`Account deletion failed: ${error.message}`);
      return;
    }
    await sb.auth.signOut();
    window.location.href = '/';
  });
})();
