// Live counter for the WaitlistCTA strip.
//
// Each tick fires two requests against the leaf-contact Worker on the same
// origin: POST /api/waitlist/heartbeat (registers presence via cookie) and
// GET /api/waitlist/stats (edge-cached 30s, returns total / this_week /
// viewing_now). Visitor identity lives in the HttpOnly `leaf_vid` cookie
// set by the Worker on first heartbeat — never read from JS.
//
// First paint races IntersectionObserver vs. fetch:
//   • If fetch lands first → count-up animates straight to live numbers.
//   • If IO fires first    → count-up uses the inline data-count fallbacks.
//                            When fetch later resolves, numbers snap into place.
// Subsequent polling updates skip the count-up and just snap textContent.

const STATS_URL = '/api/waitlist/stats';
const HEARTBEAT_URL = '/api/waitlist/heartbeat';
const POLL_MS = 30_000;
const ANIM_MS = 1400;
const ANIM_DELAY_BASE_MS = 200;
const ANIM_DELAY_STEP_MS = 220;
const IO_THRESHOLD = 0.3;

interface Stats {
  total: number;
  this_week: number;
  viewing_now: number;
}

async function fetchStats(): Promise<Stats | null> {
  try {
    const [, statsRes] = await Promise.all([
      fetch(HEARTBEAT_URL, { method: 'POST', credentials: 'same-origin' }),
      fetch(STATS_URL, { credentials: 'same-origin' }),
    ]);
    if (!statsRes.ok) return null;
    const row = await statsRes.json() as Partial<Stats> | null;
    if (!row) return null;
    return {
      total:       Number(row.total ?? 0),
      this_week:   Number(row.this_week ?? 0),
      viewing_now: Math.max(1, Number(row.viewing_now ?? 1)),
    };
  } catch {
    return null;
  }
}

function applyVisibility(root: HTMLElement, s: Stats) {
  const weekWrap    = root.querySelector<HTMLElement>('[data-stat-week]');
  const viewingWrap = root.querySelector<HTMLElement>('[data-stat-viewing]');
  if (weekWrap)    weekWrap.hidden = s.this_week === 0;
  if (viewingWrap) viewingWrap.hidden = false;
}

const CELLS: Array<readonly [string, keyof Stats]> = [
  ['[data-count-total]',   'total'],
  ['[data-count-week]',    'this_week'],
  ['[data-count-viewing]', 'viewing_now'],
];

function snap(root: HTMLElement, s: Stats) {
  for (const [sel, key] of CELLS) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.textContent = String(s[key]);
  }
}

function animateCount(el: HTMLElement, target: number, durationMs: number, delayMs: number) {
  const start = performance.now() + delayMs;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    if (now < start) { requestAnimationFrame(step); return; }
    const t = Math.min(1, (now - start) / durationMs);
    el.textContent = String(Math.round(target * ease(t)));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(target);
  };
  requestAnimationFrame(step);
}

function countUp(root: HTMLElement, s: Stats) {
  CELLS.forEach(([sel, key], i) => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el || el.closest('[hidden]')) return;
    animateCount(el, s[key], ANIM_MS, ANIM_DELAY_BASE_MS + i * ANIM_DELAY_STEP_MS);
  });
}

function fallbackStats(root: HTMLElement): Stats {
  const read = (sel: string) =>
    parseInt(root.querySelector<HTMLElement>(sel)?.dataset.count ?? '0', 10);
  return {
    total:       read('[data-count-total]'),
    this_week:   read('[data-count-week]'),
    viewing_now: 1,
  };
}

export async function initWaitlistStats(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-stats]');
  if (!root) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let liveStats: Stats | null = null;
  let firstPaintDone = false;

  const paintFirst = (s: Stats) => {
    if (firstPaintDone) return;
    firstPaintDone = true;
    applyVisibility(root, s);
    if (reduceMotion) snap(root, s);
    else countUp(root, s);
  };

  const fetchPromise = fetchStats().then((s) => {
    if (!s) return;
    liveStats = s;
    if (!firstPaintDone) paintFirst(s);
    else { applyVisibility(root, s); snap(root, s); }
  });

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        io.unobserve(e.target);
        paintFirst(liveStats ?? fallbackStats(root));
      }
    }
  }, { threshold: IO_THRESHOLD });
  io.observe(root);

  await fetchPromise;

  let timer: number | undefined;
  const tick = async () => {
    const s = await fetchStats();
    if (!s) return;
    liveStats = s;
    if (firstPaintDone) { applyVisibility(root, s); snap(root, s); }
  };
  const start = () => {
    if (timer != null) return;
    timer = window.setInterval(tick, POLL_MS);
  };
  const stop = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = undefined;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });
  start();
}

initWaitlistStats();
