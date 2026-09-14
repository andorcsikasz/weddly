// Idle-based visibility for header icons that earn a couple's attention early
// but clutter the bar once they've been seen. The compass (feature tour) is
// the one consumer: unused for 15 days, it drops into the profile menu. A
// first impression gets a generous window; once it's already been demoted
// and someone reopens it from the profile menu, that's a weaker signal of
// habitual use, so the next grace period shrinks to 5 days.

import { useCallback, useState } from "react";

const LAST_USED_KEY = "weddly.compass_last_used_at";
const DEMOTED_ONCE_KEY = "weddly.compass_demoted_once";
const FIRST_GRACE_DAYS = 15;
const REGRACE_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function computeVisible(): boolean {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    // No record yet reads as "just used" — a couple who has never had the
    // chance to ignore the compass must not open the app to find it already
    // demoted.
    const lastUsed = raw ? Number(raw) : Date.now();
    if (!raw) localStorage.setItem(LAST_USED_KEY, String(lastUsed));
    const demotedOnce = localStorage.getItem(DEMOTED_ONCE_KEY) === "1";
    const graceDays = demotedOnce ? REGRACE_DAYS : FIRST_GRACE_DAYS;
    const idleDays = (Date.now() - lastUsed) / DAY_MS;
    const visible = idleDays < graceDays;
    if (!visible && !demotedOnce) localStorage.setItem(DEMOTED_ONCE_KEY, "1");
    return visible;
  } catch {
    // localStorage may be blocked — fail open so the tour stays reachable.
    return true;
  }
}

export function useCompassVisibility(): { visible: boolean; markUsed: () => void } {
  const [visible, setVisible] = useState(computeVisible);

  const markUsed = useCallback(() => {
    try {
      localStorage.setItem(LAST_USED_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setVisible(true);
  }, []);

  return { visible, markUsed };
}
