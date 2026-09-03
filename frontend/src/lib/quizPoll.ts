// Short-polling hook for the live quiz game — the codebase has no WebSocket
// infrastructure, so both the host console and a guest's own screen refresh
// state on an interval instead.
//
// EVERY tick fetches — a hidden tab slows to a much longer interval rather
// than stopping outright. A full stop sounds efficient but has one failure
// mode this feature cannot afford: it only resumes on a "visibilitychange"
// to "visible", and `document.visibilityState` reads "hidden" in more cases
// than an actually-backgrounded tab (a host's screen mirrored to a TV/
// projector through some capture setups, some PWA/kiosk-browser contexts,
// and — found the hard way, testing this feature — Chrome-extension-driven
// automation, where a tab can report "hidden" for its entire lifetime with
// no "visible" transition ever coming). A live-event feature that can go
// silently, permanently stuck on a false negative is worse than one that
// occasionally polls a backgrounded phone a little more than strictly
// necessary — hence "slower", never "off".
import { useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL_MS = 1400;
/** Floor for a hidden tab's polling interval — still fresh within a few
 *  seconds of switching back, nowhere near the foreground cadence. */
const HIDDEN_INTERVAL_MS = 10_000;

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useQuizPoll<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      try {
        const result = await fetchRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
      schedule();
    }

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(tick, isHidden() ? Math.max(intervalMs, HIDDEN_INTERVAL_MS) : intervalMs);
    }

    function onVisibilityChange() {
      if (!isHidden() && timer) {
        clearTimeout(timer);
        void tick();
      }
    }

    void tick();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // intervalMs is treated as fixed for the lifetime of one poller instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return { data, error };
}
