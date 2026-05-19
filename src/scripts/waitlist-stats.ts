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
const LEAVE_URL = '/api/waitlist/leave';
// Phase 1 tuning (2026-05-19): poll 3× more often. Worker now uses a 25s
// PRESENCE_WINDOW (was 90s), so a missed tick still keeps the row alive.
const POLL_MS = 10_000;
// Phase 3 idle gating: if no user input for this long, suspend heartbeat —
// the row decays out of the 25s window naturally so an open-but-untouched
// tab stops counting as "viewing".
const IDLE_THRESHOLD_MS = 120_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'wheel', 'touchstart', 'click', 'scroll'] as const;
// Phase 2 leader election: tabs of the same browser dedupe heartbeats via a
// BroadcastChannel. Lowest live tab-id wins.
const BC_CHANNEL_NAME = 'leaf-presence';
const TAB_ANNOUNCE_MS = 5_000;
const TAB_STALE_MS = 15_000;
const ANIM_MS = 1400;
const ANIM_DELAY_BASE_MS = 200;
const ANIM_DELAY_STEP_MS = 220;
const IO_THRESHOLD = 0.3;

interface Stats {
  total: number;
  this_week: number;
  viewing_now: number;
}

async function fetchStats(sendHeartbeat: boolean): Promise<Stats | null> {
  try {
    const requests: Promise<Response>[] = [];
    if (sendHeartbeat) {
      requests.push(fetch(HEARTBEAT_URL, { method: 'POST', credentials: 'same-origin' }));
    }
    requests.push(fetch(STATS_URL, { credentials: 'same-origin' }));
    const results = await Promise.all(requests);
    const statsRes = results[results.length - 1]!;
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

// ────────────────────────────────────────────────────────────────────────────
// Phase 2/3 helpers: activity tracking, leader election, leave beacon.
// ────────────────────────────────────────────────────────────────────────────

// Activity timestamp — bumped on user input. rAF-debounced so noisy events
// (mousemove every pixel) don't dominate the main thread.
let lastActivityAt = Date.now();
function installActivityListeners(): void {
  let pending = false;
  const bump = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      lastActivityAt = Date.now();
      pending = false;
    });
  };
  for (const ev of ACTIVITY_EVENTS) {
    document.addEventListener(ev, bump, { passive: true, capture: true });
  }
}
const isIdle = (): boolean => Date.now() - lastActivityAt > IDLE_THRESHOLD_MS;

// Per-tab id + peers map for leader election. Smallest live id is leader.
// Live = announced within TAB_STALE_MS. Pruned lazily on each isLeader() call.
const tabId = crypto.randomUUID();
const peers = new Map<string, number>();
peers.set(tabId, Date.now());
let bc: BroadcastChannel | null = null;

function isLeader(): boolean {
  const now = Date.now();
  for (const [id, ts] of peers) {
    if (now - ts > TAB_STALE_MS && id !== tabId) peers.delete(id);
  }
  peers.set(tabId, now);
  let leaderId = tabId;
  for (const id of peers.keys()) if (id < leaderId) leaderId = id;
  return leaderId === tabId;
}

function initBroadcastChannel(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try { bc = new BroadcastChannel(BC_CHANNEL_NAME); }
  catch { return; }
  bc.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type?: string; id?: string } | undefined;
    if (!msg || typeof msg.id !== 'string' || msg.id === tabId) return;
    if (msg.type === 'announce') peers.set(msg.id, Date.now());
    else if (msg.type === 'leave') peers.delete(msg.id);
  });
  const announce = () => bc?.postMessage({ type: 'announce', id: tabId });
  announce();
  setInterval(announce, TAB_ANNOUNCE_MS);
}

// pagehide is the modern, mobile-friendly equivalent of unload. sendBeacon is
// fire-and-forget — survives the navigation even if the document is gone.
function installLeaveBeacon(): void {
  window.addEventListener('pagehide', () => {
    bc?.postMessage({ type: 'leave', id: tabId });
    // Only the leader's row exists in D1 (peer tabs piggyback). Telling the
    // server to delete it is meaningful only from the leader.
    if (isLeader() && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(LEAVE_URL);
    }
  });
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

// Active count-up animations. Each animation closes over its own target value,
// so when fetch resolves *after* IO has fired (and IO triggered count-up using
// the inline fallbacks), the in-flight animations would otherwise keep
// over-writing the fresh textContent set by snap() — ending on the stale
// fallback in their final frame. snap() flips `cancelled` on every in-flight
// animation before writing the live numbers, so they bail out on next RAF.
type AbortFlag = { cancelled: boolean };
const liveAnimations = new Set<AbortFlag>();

function snap(root: HTMLElement, s: Stats) {
  for (const flag of liveAnimations) flag.cancelled = true;
  liveAnimations.clear();
  for (const [sel, key] of CELLS) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) el.textContent = String(s[key]);
  }
}

function animateCount(el: HTMLElement, target: number, durationMs: number, delayMs: number) {
  const flag: AbortFlag = { cancelled: false };
  liveAnimations.add(flag);
  const start = performance.now() + delayMs;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number) => {
    if (flag.cancelled) return;
    if (now < start) { requestAnimationFrame(step); return; }
    const t = Math.min(1, (now - start) / durationMs);
    el.textContent = String(Math.round(target * ease(t)));
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = String(target);
      liveAnimations.delete(flag);
    }
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

  // Phase 2/3: wire up activity tracking, leader election, leave beacon.
  // Done before first fetch so the first heartbeat (sent during initial paint
  // race) carries correct leader/idle semantics if announces arrived already.
  installActivityListeners();
  initBroadcastChannel();
  installLeaveBeacon();

  let liveStats: Stats | null = null;
  let firstPaintDone = false;

  const paintFirst = (s: Stats) => {
    if (firstPaintDone) return;
    firstPaintDone = true;
    applyVisibility(root, s);
    if (reduceMotion) snap(root, s);
    else countUp(root, s);
  };

  // First fetch always sends a heartbeat — at load there are no peers yet so
  // self is leader, and the user just opened the page so is by definition not
  // idle. This guarantees the visitor shows up in viewing_now immediately.
  const fetchPromise = fetchStats(true).then((s) => {
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
    // Heartbeat only if we're the elected leader for this browser AND the user
    // has interacted recently. Otherwise just refresh the displayed stats.
    const sendHeartbeat = isLeader() && !isIdle();
    const s = await fetchStats(sendHeartbeat);
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

  // Optimistic +1 when the waitlist form fires a successful signup. The
  // Worker also invalidates the /stats edge cache on the same request, so
  // the next polling tick reads the fresh total — these two together avoid
  // any visible dip back to the pre-signup value.
  document.addEventListener('leaf:waitlist-signup', () => {
    if (!liveStats) {
      // No fetch yet — synthesize from whatever is on screen so the bump
      // applies on top of fallback / mid-animation values.
      const readNum = (sel: string, dflt: number) => {
        const el = root.querySelector<HTMLElement>(sel);
        const n = parseInt(el?.textContent ?? '', 10);
        return Number.isFinite(n) ? n : dflt;
      };
      liveStats = {
        total:       readNum('[data-count-total]',
                       parseInt(root.querySelector<HTMLElement>('[data-count-total]')?.dataset.count ?? '0', 10) || 0),
        this_week:   readNum('[data-count-week]',
                       parseInt(root.querySelector<HTMLElement>('[data-count-week]')?.dataset.count ?? '0', 10) || 0),
        viewing_now: readNum('[data-count-viewing]', 1),
      };
    }
    liveStats.total += 1;
    liveStats.this_week += 1;
    applyVisibility(root, liveStats);
    snap(root, liveStats);  // also cancels any in-flight count-up animation
    firstPaintDone = true;  // we've now overridden whatever paint was pending
  });
}

initWaitlistStats();
