// Cross-tab/window sync. Couples plan together — when partner A edits a
// budget line in one tab, partner B's open seating tab next door should see
// the refresh on the next interaction without forcing a manual reload.
//
// Implementation: a single shared BroadcastChannel("weddly"). Publishers fire
// a typed message after every successful mutation; subscribers re-run their
// `refresh()` and pick up the latest server state. Falls back to a no-op
// when the runtime doesn't support BroadcastChannel (Safari < 15.4, RN
// webviews) so the rest of the app keeps working.

const CHANNEL_NAME = "weddly";

export type SyncTopic =
  | "budget:changed"
  | "seating:changed"
  | "guests:changed"
  | "picks:changed"
  | "planning_count:changed";

interface SyncMessage {
  topic: SyncTopic;
  /** Optional opaque payload — today nobody reads it, but we send a
   *  source-tab id so future code can ignore self-published events. */
  payload?: unknown;
  /** Unique id for this browser tab. Lets subscribers ignore their own
   *  publishes, so a refresh inside the publishing tab isn't double-fired. */
  source: string;
}

const SOURCE_ID = (() => {
  // crypto.randomUUID is widely available; the regex string is a perfectly
  // fine fallback for old WKWebView builds.
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
})();

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

/** Publish a topic to every other listener on the same origin. Safe to call
 *  even on platforms without BroadcastChannel — silently no-ops there. */
export function publish(topic: SyncTopic, payload?: unknown): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage({ topic, payload, source: SOURCE_ID } satisfies SyncMessage);
  } catch {
    // ignore — closed channel or unsupported payload shape.
  }
}

/** Subscribe to a single topic. Returns an unsubscribe function. Self-
 *  published messages (same tab) are ignored automatically. */
export function subscribe(topic: SyncTopic, cb: () => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent<SyncMessage>) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.topic !== topic) return;
    if (msg.source === SOURCE_ID) return;
    cb();
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
