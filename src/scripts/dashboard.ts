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
  const fullName = String(meta.full_name ?? meta.name ?? meta.user_name ?? '—');
  const provider = String(user.app_metadata?.provider ?? 'email');

  setField('name', fullName);
  setField('email', user.email ?? '—');
  setField('provider', provider);
  setField('memberSince', user.created_at ? fmtDate(user.created_at) : '—');

  const echo = document.querySelector<HTMLElement>('[data-user-email]');
  if (echo) echo.textContent = user.email ?? '—';
})();

// Sign out (button handler already wired inline in dashboard.astro,
// but listening here too ensures clean Supabase signOut even if inline JS misses).
document.getElementById('signout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await sb.auth.signOut();
  window.location.href = '/';
});

// Delete account — calls Supabase's RPC, then signs out and redirects.
// Backed by an SQL function `delete_self_account()` defined server-side
// (security definer, idempotent). If the RPC is missing, surface the error.
document.getElementById('delete-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const ok = confirm(
    'Delete your account?\n\n' +
    'This removes team memberships and identity keys held on the relay.\n' +
    'Your local Mac data is not touched — wipe that from the macOS app\'s ' +
    'Settings → Danger zone.'
  );
  if (!ok) return;
  const { error } = await sb.rpc('delete_self_account');
  if (error) {
    alert(`Account deletion failed: ${error.message}`);
    return;
  }
  await sb.auth.signOut();
  window.location.href = '/';
});
