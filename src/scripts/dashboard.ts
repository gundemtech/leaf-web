// /dashboard wiring — auth gate, populate user fields, sign out, delete account.
import { getSupabase } from './supabase-client';
import { wireDeleteAccount } from './account-delete';

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
})();

// Sign out.
document.getElementById('signout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await sb.auth.signOut();
  window.location.href = '/';
});

// Delete account — gated behind a typed "DELETE" confirmation (see account-delete.ts).
// Backed by the server-side SQL function `delete_self_account()` (security definer,
// idempotent). The typed gate stops accidental deletion; see OT-SEC-7b for the XSS
// residual. If the RPC is missing/fails, surface the error without signing out.
const deleteInput = document.getElementById('delete-confirm-input') as HTMLInputElement | null;
const deleteButton = document.getElementById('delete-btn') as HTMLButtonElement | null;
if (deleteInput && deleteButton) {
  wireDeleteAccount({
    input: deleteInput,
    button: deleteButton,
    confirmFn: () =>
      confirm(
        'Delete your account?\n\n' +
          'This removes team memberships and identity keys held on the relay.\n' +
          'Your local Mac data is not touched — wipe that from the macOS app\'s ' +
          'Settings → Danger zone.',
      ),
    rpc: async () => {
      const { error } = await sb.rpc('delete_self_account');
      return { error: error ? { message: error.message } : null };
    },
    signOut: async () => {
      await sb.auth.signOut();
    },
    redirect: (url) => {
      window.location.href = url;
    },
    onError: (msg) => alert(`Account deletion failed: ${msg}`),
  });
}
