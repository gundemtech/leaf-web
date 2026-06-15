// /signup wiring — signin / create / verify OTP / forgot / reset password,
// OAuth Google + GitHub, plus resend cooldown.
// Panel switching is already wired live in signup.astro; this file adds
// the actual Supabase auth calls and post-submit redirects.
import { getSupabase } from './supabase-client';

// Cloudflare Turnstile global (loaded via challenges.cloudflare.com/turnstile/v0/api.js).
declare global {
  interface Window {
    turnstile?: {
      getResponse(widget?: string | HTMLElement): string | undefined;
      reset(widget?: string | HTMLElement): void;
      render(el: string | HTMLElement, opts: Record<string, unknown>): string;
    };
    // Analytics — defined by Analytics.astro; no-ops if analytics is disabled.
    leafTrack?: (event: string, props?: Record<string, unknown>) => void;
  }
}

const REDIRECT_AFTER_AUTH = '/dashboard';
const RESET_REDIRECT = `${window.location.origin}/signup?panel=reset`;

const sb = getSupabase();

// ─── Helpers ──────────────────────────────────────────────────────────
function setError(panel: string, msg: string): void {
  const el = document.querySelector<HTMLElement>(`[data-error="${panel}"]`);
  if (!el) return;
  el.classList.remove('is-success');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

// Positive notification (e.g. "reset link sent") — green, not error-red.
function setSuccess(panel: string, msg: string): void {
  const el = document.querySelector<HTMLElement>(`[data-error="${panel}"]`);
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.classList.add('is-success');
}

// Returns the Turnstile token for the widget inside the named panel, or ''.
function captchaTokenFor(panel: string): string {
  const widget = document.querySelector<HTMLElement>(
    `.auth-panel[data-panel="${panel}"] .cf-turnstile`,
  );
  if (!widget || !window.turnstile) return '';
  return window.turnstile.getResponse(widget) ?? '';
}

// Resets the Turnstile widget inside the named panel so a fresh token is
// required for the next attempt (tokens are single-use).
function resetCaptcha(panel: string): void {
  const widget = document.querySelector<HTMLElement>(
    `.auth-panel[data-panel="${panel}"] .cf-turnstile`,
  );
  if (widget && window.turnstile) window.turnstile.reset(widget);
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

function startResendCooldown(seconds = 60): void {
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

// Survives page reloads — iOS Safari routinely evicts the tab while the user
// is off reading the code in Mail; without this, Resend silently no-ops.
let lastVerifyEmail = sessionStorage.getItem('leaf-pending-verify-email') ?? '';

// ─── URL-driven initial panel (e.g. /signup?panel=reset from email link) ─
const urlPanel = new URLSearchParams(window.location.search).get('panel');

// ─── Already signed in? Send straight to /dashboard ────────────────────
// EXCEPT during password recovery (panel=reset): the reset link establishes a
// session, but the user must set a new password on the reset panel first — so
// don't bounce them to the dashboard.
if (urlPanel !== 'reset') {
  (async () => {
    try {
      const { data } = await sb.auth.getSession();
      if (data?.session) window.location.href = REDIRECT_AFTER_AUTH;
    } catch { /* anonymous */ }
  })();
}

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
  const captchaToken = captchaTokenFor('signin');
  if (!captchaToken) { setError('signin', 'Please complete the CAPTCHA.'); return; }
  const { error } = await sb.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  resetCaptcha('signin');
  if (error) { setError('signin', error.message); return; }
  window.leafTrack?.('signin_completed', { method: 'email' });
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
  const confirm = String(data.get('confirm') ?? '');
  const passwordMeetsRules =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!email || !passwordMeetsRules) {
    setError('create', 'Password must meet all requirements.');
    return;
  }
  if (password !== confirm) {
    setError('create', 'Passwords do not match.');
    return;
  }
  const captchaToken = captchaTokenFor('create');
  if (!captchaToken) { setError('create', 'Please complete the CAPTCHA.'); return; }
  const { data: signUpData, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, captchaToken },
  });
  resetCaptcha('create');
  if (error) { setError('create', error.message); return; }
  // With email confirmations on, signUp for an existing confirmed user returns an
  // obfuscated user with empty identities and sends no email — surface it instead
  // of advancing to a verify screen whose code will never arrive.
  if (signUpData.user && signUpData.user.identities?.length === 0) {
    setError('create', 'This email is already registered — sign in instead (you may have used Google or GitHub).');
    return;
  }
  window.leafTrack?.('signup_started', { method: 'email' });
  lastVerifyEmail = email;
  sessionStorage.setItem('leaf-pending-verify-email', email);
  const emailEcho = document.querySelector<HTMLElement>('.email-echo');
  if (emailEcho) emailEcho.textContent = email;
  showPanel('verify');
  startResendCooldown(60);
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
  sessionStorage.removeItem('leaf-pending-verify-email');
  window.leafTrack?.('signup_completed', { method: 'email' });
  window.location.href = REDIRECT_AFTER_AUTH;
});

// ─── Resend OTP ────────────────────────────────────────────────────────
const resendBtn = document.querySelector<HTMLButtonElement>('[data-action="resend"]');
resendBtn?.addEventListener('click', async () => {
  if (!lastVerifyEmail) { setError('verify', 'Session lost — go back and re-enter your email.'); return; }
  setError('verify', '');
  const { error } = await sb.auth.resend({ type: 'signup', email: lastVerifyEmail });
  if (error) { setError('verify', error.message); return; }
  setError('verify', 'New code sent — check your inbox.');
  startResendCooldown(60);
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
  setSuccess('forgot', 'Check your inbox — reset link sent.');
});

// ─── Reset password ────────────────────────────────────────────────────
const resetForm = document.querySelector<HTMLFormElement>('.auth-panel[data-panel="reset"]');
resetForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('reset', '');
  const data = new FormData(resetForm);
  const password = String(data.get('password') ?? '');
  const confirm = String(data.get('confirm') ?? '');
  const passwordMeetsRules =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
  if (!passwordMeetsRules) { setError('reset', 'Password must meet all requirements.'); return; }
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
    window.leafTrack?.('signup_started', { method: provider });
    setError('signin', '');
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${REDIRECT_AFTER_AUTH}`,
        // GUN-63 parity: always show the account chooser. The provider keeps a
        // live session in the browser and our sign-out only clears Leaf's local
        // session, so without this the chooser never reappears and the user
        // can't switch accounts. GoTrue forwards `prompt` to the provider; both
        // Google and GitHub (since 2024-06) honour `select_account`.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) setError('signin', error.message);
  });
});
