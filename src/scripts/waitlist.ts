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

  // Scope to the whole section: [data-status] lives outside .waitlist-grid, so
  // form.parentElement would miss it (errors would silently never render).
  const section = form.closest<HTMLElement>('.waitlist');
  const status = section?.querySelector<HTMLElement>('[data-status]') ?? null;
  const successCard = section?.querySelector<HTMLElement>('[data-waitlist-success]') ?? null;
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
      // Swap the form for the success card (same style as the app's OAuth
      // browser success page). Clear the transient "Sending…" status so it
      // doesn't linger beneath the card. If the card is missing for any reason,
      // fall back to the inline success text.
      if (successCard) {
        setStatus(status, '', '');
        form.hidden = true;
        successCard.hidden = false;
        successCard.focus();
      } else {
        setStatus(status, 'Thanks — we\'ll email you on release.', 'success');
        form.reset();
        window.turnstile?.reset(turnstileEl ?? undefined);
      }
      // Tell the live-counter to bump total + this_week immediately — no need
      // to wait the next 30s polling tick. The Worker invalidates the /stats
      // edge cache on the same request, so polling won't visually revert.
      // (Analytics.astro listens for this to fire `waitlist_submitted`.)
      document.dispatchEvent(new CustomEvent('leaf:waitlist-signup'));
    } catch (err) {
      setStatus(status, 'Could not submit — try again in a moment.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

initWaitlist();
