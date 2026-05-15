// /signup wiring — signin / create / verify OTP / forgot / reset password,
// OAuth Google + GitHub, plus resend cooldown.
// Panel switching is already wired live in signup.astro; this file adds
// the actual Supabase auth calls and post-submit redirects.
import { getSupabase } from './supabase-client';

const REDIRECT_AFTER_AUTH = '/dashboard';
const RESET_REDIRECT = `${window.location.origin}/signup?panel=reset`;

const sb = getSupabase();

// ─── Helpers ──────────────────────────────────────────────────────────
function setError(panel: string, msg: string): void {
  const el = document.querySelector<HTMLElement>(`[data-error="${panel}"]`);
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

function showPanel(name: string): void {
  document.querySelectorAll<HTMLElement>('.auth-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === name);
  });
  document.querySelectorAll<HTMLElement>('.auth-tab').forEach(t => {
    const isActive = t.dataset.panel === name;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', String(isActive));
  });
  document.querySelector<HTMLElement>('.auth-tabs')?.toggleAttribute('hidden', !['signin','create'].includes(name));
}

function startResendCooldown(seconds = 30): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-action="resend"]');
  const timer = document.querySelector<HTMLSpanElement>('[data-timer]');
  const arc = document.querySelector<SVGCircleElement>('.resend-arc');
  if (!btn || !timer || !arc) return;
  btn.disabled = true;
  const total = seconds;
  let left = seconds;
  const CIRC = 2 * Math.PI * 9;
  arc.style.strokeDashoffset = '0';
  timer.textContent = `${left}s`;
  const id = setInterval(() => {
    left -= 1;
    timer.textContent = `${Math.max(0, left)}s`;
    arc.style.strokeDashoffset = String(CIRC * (1 - left / total));
    if (left <= 0) {
      clearInterval(id);
      btn.disabled = false;
      timer.textContent = '';
      arc.style.strokeDashoffset = String(CIRC);
    }
  }, 1000);
}

let lastVerifyEmail = '';

// ─── Already signed in? Send straight to /dashboard ────────────────────
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session) window.location.href = REDIRECT_AFTER_AUTH;
  } catch { /* anonymous */ }
})();

// ─── URL-driven initial panel (e.g. /signup?panel=reset from email link) ─
const urlPanel = new URLSearchParams(window.location.search).get('panel');
if (urlPanel && ['signin','create','verify','forgot','reset'].includes(urlPanel)) {
  showPanel(urlPanel);
}

// ─── Sign in (email + password) ────────────────────────────────────────
const signinForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="signin"]');
signinForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('signin', '');
  const data = new FormData(signinForm);
  const email = String(data.get('email') ?? '').trim();
  const password = String(data.get('password') ?? '');
  if (!email || !password) { setError('signin', 'Email and password are required.'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { setError('signin', error.message); return; }
  window.location.href = REDIRECT_AFTER_AUTH;
});

// ─── Create account → email OTP ───────────────────────────────────────
const createForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="create"]');
createForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('create', '');
  const data = new FormData(createForm);
  const name = String(data.get('name') ?? '').trim();
  const email = String(data.get('email') ?? '').trim();
  const password = String(data.get('password') ?? '');
  if (!email || password.length < 8) {
    setError('create', 'Email and a password of 8+ chars are required.');
    return;
  }
  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });
  if (error) { setError('create', error.message); return; }
  lastVerifyEmail = email;
  const emailEcho = document.querySelector<HTMLElement>('.email-echo');
  if (emailEcho) emailEcho.textContent = email;
  showPanel('verify');
  startResendCooldown(30);
});

// ─── Verify OTP ────────────────────────────────────────────────────────
const verifyForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="verify"]');
verifyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('verify', '');
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('.otp-box'));
  const token = boxes.map(b => b.value).join('');
  if (token.length !== 6 || !/^\d{6}$/.test(token)) {
    setError('verify', 'Enter the 6-digit code.');
    return;
  }
  if (!lastVerifyEmail) { setError('verify', 'Session lost — go back and re-enter your email.'); return; }
  const { error } = await sb.auth.verifyOtp({ email: lastVerifyEmail, token, type: 'signup' });
  if (error) { setError('verify', error.message); return; }
  window.location.href = REDIRECT_AFTER_AUTH;
});

// ─── Resend OTP ────────────────────────────────────────────────────────
const resendBtn = document.querySelector<HTMLButtonElement>('[data-action="resend"]');
resendBtn?.addEventListener('click', async () => {
  if (!lastVerifyEmail) return;
  setError('verify', '');
  const { error } = await sb.auth.resend({ type: 'signup', email: lastVerifyEmail });
  if (error) { setError('verify', error.message); return; }
  startResendCooldown(30);
});

// ─── Forgot password ───────────────────────────────────────────────────
const forgotForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="forgot"]');
forgotForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('forgot', '');
  const data = new FormData(forgotForm);
  const email = String(data.get('email') ?? '').trim();
  if (!email) { setError('forgot', 'Email is required.'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT });
  if (error) { setError('forgot', error.message); return; }
  setError('forgot', 'Check your inbox — reset link sent.');
});

// ─── Reset password ────────────────────────────────────────────────────
const resetForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="reset"]');
resetForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('reset', '');
  const data = new FormData(resetForm);
  const password = String(data.get('password') ?? '');
  const confirm = String(data.get('confirm') ?? '');
  if (password.length < 8) { setError('reset', 'Password must be 8+ characters.'); return; }
  if (password !== confirm) { setError('reset', 'Passwords do not match.'); return; }
  const { error } = await sb.auth.updateUser({ password });
  if (error) { setError('reset', error.message); return; }
  window.location.href = REDIRECT_AFTER_AUTH;
});

// ─── OAuth (Google + GitHub) ───────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.oauth-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider as 'google' | 'github' | undefined;
    if (!provider) return;
    setError('signin', '');
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${REDIRECT_AFTER_AUTH}` },
    });
    if (error) setError('signin', error.message);
  });
});
