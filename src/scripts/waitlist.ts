// Waitlist form handler — Turnstile gated, POSTs to the existing Cloudflare
// Worker /api/contact endpoint (unchanged by this redesign).

const CONTACT_ENDPOINT = '/api/contact';

declare global {
  interface Window {
    turnstile?: {
      getResponse(widget?: HTMLElement): string | undefined;
      reset(widget?: HTMLElement): void;
    };
  }
}

function setStatus(el: HTMLElement | null, msg: string, state: 'success' | 'error' | '') {
  if (!el) return;
  el.textContent = msg;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

export function initWaitlist(): void {
  const form = document.getElementById('waitlist-form') as HTMLFormElement | null;
  if (!form) return;

  const status = form.parentElement?.querySelector<HTMLElement>('[data-status]') ?? null;
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const turnstileEl = form.querySelector<HTMLElement>('.cf-turnstile');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);

    // Honeypot — bots usually fill every field.
    if ((data.get('hp') as string)?.length) return;

    const email = (data.get('email') as string)?.trim() ?? '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setStatus(status, 'Enter a valid email.', 'error');
      return;
    }

    const token = window.turnstile?.getResponse(turnstileEl ?? undefined) ?? '';
    if (!token) {
      setStatus(status, 'Please complete the captcha.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    setStatus(status, 'Sending…', '');

    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: token, source: 'waitlist' }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      setStatus(status, 'Thanks — we\'ll email you on release.', 'success');
      form.reset();
      window.turnstile?.reset(turnstileEl ?? undefined);
    } catch (err) {
      setStatus(status, 'Could not submit — try again in a moment.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

initWaitlist();
