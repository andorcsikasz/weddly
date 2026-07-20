// Trigger bookkeeping for the one-time "share Weddly" popup: how many app
// sessions this account has had, and how many real planning edits it has made.
//
// Deliberately a LEAF module — no React, no imports. `api.ts` calls
// `noteMeaningfulAction()` from inside the fetch wrapper, so importing anything
// back would close a cycle. Everything here is localStorage/sessionStorage and
// fails soft: blocked storage means the popup simply never auto-fires, which is
// the right way to be wrong.
//
// The AUTHORITATIVE "already asked" latch is `users.share_prompt_seen_at` on the
// server (see routes/auth.ts). `seen` below is only the mirror that covers the
// window before /api/auth/me has hydrated, and the case where the write fails.

const KEY = "weddly.share.v1";
/** Per-tab marker so one browsing session counts as exactly one session, no
 *  matter how many times AppShell remounts across client-side navigation. */
const SESSION_MARK = "weddly.share.session_counted";

export interface ShareActivity {
  /** Account these counters belong to. A different id wipes them — a shared
   *  browser must not hand one user's progress to the next. */
  uid: number | null;
  /** Distinct app sessions, counted once per tab session. */
  sessions: number;
  /** Successful planning writes (see MEANINGFUL_PREFIXES). */
  actions: number;
  /** localStorage mirror of `users.share_prompt_seen_at != null`. */
  seen: boolean;
}

const EMPTY: ShareActivity = { uid: null, sessions: 0, actions: 0, seen: false };

/** Third session, per spec. */
export const SESSIONS_REQUIRED = 3;
/** Three meaningful planning actions, per spec. */
export const ACTIONS_REQUIRED = 3;
/** Floor that enforces "not immediately after registration". The action path
 *  alone would otherwise fire mid-onboarding, where a couple racks up three
 *  writes in their first two minutes — exactly the moment we were told not to
 *  ask. So the actions route needs a second session; the session route stands
 *  on its own. */
const MIN_SESSIONS_FOR_ACTION_PATH = 2;

/** Couple-workspace write surfaces that count as "planning". Mirrors
 *  `EDIT_PREFIXES` in backend/src/domain/billing.ts — kept as its own list
 *  because that one is server-only, and because this is a product heuristic
 *  ("did they actually plan something?") rather than a security boundary, so
 *  the two are allowed to drift. Onboarding, auth and billing writes are
 *  excluded on purpose: signing up is not a planning action. */
const MEANINGFUL_PREFIXES: readonly string[] = [
  "/api/budget",
  "/api/guests",
  "/api/guest-messages",
  "/api/households",
  "/api/seating",
  "/api/schedule",
  "/api/wishlist",
  "/api/received-gifts",
  "/api/planning",
  "/api/picks",
  "/api/saved-suppliers",
  "/api/couple-suppliers",
  "/api/couples/supplier-costs",
  "/api/accommodations",
  "/api/transfers",
  "/api/bookings",
  "/api/moodboard",
];

function read(): ShareActivity {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ShareActivity>;
    return {
      uid: typeof parsed.uid === "number" ? parsed.uid : null,
      sessions: typeof parsed.sessions === "number" ? parsed.sessions : 0,
      actions: typeof parsed.actions === "number" ? parsed.actions : 0,
      seen: parsed.seen === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(next: ShareActivity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode, hardened embeds) — the popup just never
    // auto-fires. The profile-menu entry still works, so the feature is
    // reachable either way.
  }
}

export function readShareActivity(): ShareActivity {
  return read();
}

/** Bind the counters to `userId`, resetting them if they belonged to someone
 *  else, and count this tab session exactly once. Call on app-shell mount. */
export function adoptShareUser(userId: number): ShareActivity {
  const current = read();
  const base: ShareActivity = current.uid === userId ? current : { ...EMPTY, uid: userId };

  let counted = true;
  try {
    counted = sessionStorage.getItem(SESSION_MARK) === "1";
    if (!counted) sessionStorage.setItem(SESSION_MARK, "1");
  } catch {
    // No sessionStorage — treat the session as already counted rather than
    // incrementing on every mount, which would fake a "3rd session" instantly.
  }

  const next: ShareActivity = counted ? base : { ...base, sessions: base.sessions + 1 };
  write(next);
  return next;
}

/** Called from `apiFetch` after a successful request. Only mutating calls to a
 *  planning surface move the counter; everything else returns without a write. */
export function noteMeaningfulAction(method: string, path: string): void {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return;
  // `path` may carry a query string; compare the pathname only.
  const pathname = path.split("?")[0] ?? path;
  const hit = MEANINGFUL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hit) return;

  const current = read();
  // Stop writing once we're past the bar — the counter has answered its only
  // question and there is no reason to touch storage on every subsequent edit.
  if (current.actions >= ACTIONS_REQUIRED) return;
  write({ ...current, actions: current.actions + 1 });
}

/** Mirror the server-side latch locally so a failed write still suppresses the
 *  popup on this device. */
export function markSharePromptSeenLocally(): void {
  write({ ...read(), seen: true });
}

/** Whether the automatic popup is owed. `seenOnServer` comes from
 *  `user.share_prompt_seen_at` and outranks everything — a prompt shown on
 *  another device must not fire again here. */
export function shouldAutoOpenShare(activity: ShareActivity, seenOnServer: boolean): boolean {
  if (seenOnServer || activity.seen) return false;
  if (activity.sessions >= SESSIONS_REQUIRED) return true;
  return activity.sessions >= MIN_SESSIONS_FOR_ACTION_PATH && activity.actions >= ACTIONS_REQUIRED;
}
