// "Still here" heartbeat feeding the admin's per-user total-active-time
// metric (AdminUserActivity.total_active_seconds / AdminCoupleView's
// workspace total). Fires only while the tab is the visible foreground
// tab — an abandoned open background tab must never keep racking up time,
// same rule working_presence follows on the backend (see
// routes/couples.ts's handleSetWorkingPresence comment). The server credits
// a fixed ACTIVITY_HEARTBEAT_INTERVAL_S per accepted call rather than
// trusting a client-reported duration, so a missed tick just under-counts —
// never over-counts — and failures are silently swallowed here.
import { ACTIVITY_HEARTBEAT_INTERVAL_S } from "@shared/activity";
import { useEffect } from "react";
import { activityApi } from "./endpoints";

export function useActivityHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      activityApi.heartbeat().catch(() => {
        /* best-effort — a dropped ping just under-counts this interval */
      });
    };
    // No immediate ping on mount: crediting a full interval the instant a
    // tab opens would over-count a visit shorter than the interval itself.
    const interval = setInterval(ping, ACTIVITY_HEARTBEAT_INTERVAL_S * 1000);
    return () => clearInterval(interval);
  }, [enabled]);
}
