// Offline-tolerant RSVP submission queue. When the venue WiFi flakes mid-tap,
// we persist the would-be submission to localStorage and let the next "online"
// event (or the next successful submit) drain it.
//
// The backend POST /api/rsvp/checkin is idempotent on Idempotency-Key — same
// key + same (couple_slug, household_code) returns the cached 200 for 5 min.
// We stamp the key BEFORE the first attempt and reuse it for every retry, so
// at-least-once retries become at-most-once writes.

import type { CheckinSubmitBody, PublicCheckinView } from "@shared/types";
import { ApiError } from "./api";
import { rsvpApi } from "./endpoints";

const STORAGE_KEY = "weddly.rsvp.pending";

export interface PendingCheckin {
  /** UUID stamped on first attempt; reused for every retry. */
  idempotency_key: string;
  couple_slug: string;
  household_code: string;
  /** Local Date.now() at the moment we enqueued — used for newest-first display. */
  submitted_at: number;
  /** Exact payload we would have sent. */
  payload: CheckinSubmitBody;
}

/** Read the queue from localStorage. Returns `[]` on parse failure or missing storage. */
export function peekAll(): PendingCheckin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive — discard malformed entries instead of throwing.
    return parsed.filter(isValidPending);
  } catch {
    return [];
  }
}

function isValidPending(x: unknown): x is PendingCheckin {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.idempotency_key === "string" &&
    typeof r.couple_slug === "string" &&
    typeof r.household_code === "string" &&
    typeof r.submitted_at === "number" &&
    r.payload !== null &&
    typeof r.payload === "object"
  );
}

function writeAll(list: PendingCheckin[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded / blocked storage — fail soft. The submit toast already
    // claimed durability, but if we can't persist the next page-load loses it.
    // Better than throwing in the middle of a submit handler.
  }
}

/** Append a pending record. Returns the stored entry (with stamped key). */
export function enqueue(
  couple_slug: string,
  household_code: string,
  payload: CheckinSubmitBody,
  idempotency_key?: string,
): PendingCheckin {
  const entry: PendingCheckin = {
    idempotency_key: idempotency_key ?? makeKey(),
    couple_slug,
    household_code,
    submitted_at: Date.now(),
    payload,
  };
  const next = [...peekAll(), entry];
  writeAll(next);
  return entry;
}

/** Drop a single entry by idempotency key. No-op if not present. */
export function removeByKey(key: string): void {
  const cur = peekAll();
  const next = cur.filter((p) => p.idempotency_key !== key);
  if (next.length !== cur.length) writeAll(next);
}

export function makeKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for unusual embeds — not cryptographically strong, but unique
  // enough to dedupe with the 5-minute server-side cache.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface DrainResult {
  /** Entries that landed (200 or idempotent replay). */
  sent: number;
  /** Entries removed because the server said "no such household" (404). */
  dropped: number;
  /** Entries left behind for a future drain (still offline / 5xx). */
  remaining: number;
  /** Last server view returned during the drain, if any — caller may use it
   *  to refresh the on-screen household. */
  lastView: PublicCheckinView | null;
}

/** Attempt to push every pending record. Stops at the first transport-level
 *  failure so we don't burn through the queue while still offline. Records
 *  that the server rejected for content reasons (404, 400) are dropped from
 *  the queue and logged to the console — they'll never succeed. */
export async function drain(onProgress?: (r: DrainResult) => void): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, dropped: 0, remaining: 0, lastView: null };
  const queue = peekAll();
  if (queue.length === 0) return result;

  for (const entry of queue) {
    try {
      const r = await rsvpApi.checkin(entry.payload, { idempotencyKey: entry.idempotency_key });
      removeByKey(entry.idempotency_key);
      result.sent += 1;
      result.lastView = r.rsvp;
    } catch (err) {
      if (err instanceof ApiError) {
        // Transport-layer failures — give up for now, try again on next online.
        if (err.code === "network_error" || err.code === "timeout" || err.code === "aborted") {
          break;
        }
        // 5xx — server hiccup, retry next time.
        if (err.status >= 500) break;
        // 4xx (404, 400, 409, ...) — the request itself is broken. Drop the
        // entry; it would just re-fail forever otherwise.
        console.warn("[rsvp_offline] dropping unresolvable pending record", {
          code: err.code,
          status: err.status,
          key: entry.idempotency_key,
        });
        removeByKey(entry.idempotency_key);
        result.dropped += 1;
        continue;
      }
      // Unknown throw — bail and retry later.
      break;
    }
  }

  result.remaining = peekAll().length;
  if (onProgress) onProgress(result);
  return result;
}
