import type { CoupleActivityEntry } from "@shared/types";
import { createContext, type ReactNode, useEffect, useState } from "react";
import { coupleApi } from "../lib/endpoints";

export const CollaborationActivityContext = createContext<CoupleActivityEntry[]>([]);

/** App-shell-owned polling so data pages can share collaboration context
 * without each issuing another activity request. */
export function CollaborationActivityProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<CoupleActivityEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void coupleApi
        .activity()
        .then((r) => {
          if (!cancelled) setEntries(Array.isArray(r.entries) ? r.entries : []);
        })
        .catch(() => undefined);
    };
    refresh();
    const poll = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);
  return (
    <CollaborationActivityContext.Provider value={entries}>
      {children}
    </CollaborationActivityContext.Provider>
  );
}
