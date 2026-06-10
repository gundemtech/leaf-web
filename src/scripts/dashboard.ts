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

  setField('name', fullName);
  setField('email', user.email ?? '-');
  setField('provider', provider);
  setField('memberSince', user.created_at ? fmtDate(user.created_at) : '-');

  const echo = document.querySelector<HTMLElement>('[data-user-email]');
  if (echo) echo.textContent = user.email ?? '-';

  // Reveal the password control for everyone: OAuth users SET a password (so
  // they can also sign in with email); email users CHANGE their password.
  const spBlock = document.querySelector<HTMLElement>('[data-set-password]');
  if (spBlock) {
    spBlock.removeAttribute('hidden');
    if (provider === 'email') {
      const toggleBtn = document.getElementById('set-password-toggle');
      if (toggleBtn) toggleBtn.textContent = 'Change password';
      const intro = spBlock.querySelector<HTMLElement>('.set-password-head .muted');
      if (intro) intro.textContent = 'Change your account password.';
    }
  }
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
    const prov = document.querySelector<HTMLElement>('[data-field="provider"]')?.textContent ?? 'email';
    setSpSuccess(prov === 'email'
      ? 'Password changed.'
      : 'Password set — you can now sign in with email + password too.');
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
