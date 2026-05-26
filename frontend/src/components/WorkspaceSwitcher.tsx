// Header chip + dropdown listing every workspace the current user belongs
// to (Alpha / Bravo / Charlie). Rendered next to the wordmark in AppShell,
// only when signed in AND the user has at least one workspace. With a
// single workspace the chip collapses to a bare "+" affordance — the
// active name is already the page hero so repeating it is noise; only
// once Bravo exists does naming the active event start to earn its
// pixels.
//
// Switching = POST /api/users/me/active-couple → hard reload, since every
// page reads couple-scoped data on mount and stitching the in-memory
// state piecemeal across 27 callers of getCoupleForUser would be fragile.

import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type CoupleMembershipView, coupleApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";

export function WorkspaceSwitcher() {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [memberships, setMemberships] = useState<CoupleMembershipView[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // One-shot fetch on mount. We refresh after every Stripe-style event
  // that could change the workspace set (create / switch / leave) by
  // bumping a counter — but the dominant path is "open once per page
  // load", so a lazy fetch is fine.
  useEffect(() => {
    let cancelled = false;
    coupleApi.listMine().then(
      (r) => {
        if (cancelled) return;
        setMemberships(r.couples);
        setActiveId(r.current_couple_id);
      },
      () => {
        // Non-fatal — chip just stays unobtrusive ("workspace" with no
        // dropdown content) if the call fails.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click / Escape so the dropdown behaves like a menu.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (memberships.length === 0) return null;

  const active = memberships.find((m) => m.couple_id === activeId) ?? memberships[0];
  if (!active) return null;
  // Matches the server-side cap in handleCreateAdditionalCouple: once the
  // user has 3 live workspaces, the create entry point disappears here too
  // (the Profile panel does the same). A disabled link would read as
  // "broken"; better to remove the affordance until they free a slot.
  const atCap = memberships.filter((m) => m.status !== "deleting").length >= 3;

  // Single-workspace shortcut: skip the chip+dropdown entirely and render
  // a tiny "+" link straight to the profile's workspaces section. The
  // active name is redundant with the page hero ("Andor & Sári") that
  // already lives one row below, and the dropdown would be a one-item
  // menu with a footer link — pure friction.
  if (memberships.length === 1) {
    return (
      <Link
        to="/app/settings/workspace"
        aria-label={t("workspace.create_link")}
        title={t("workspace.create_link")}
        /* Hidden on phones — the single-workspace shortcut next to the
         *  wordmark is one icon too many on small viewports. The same
         *  destination is one tap away from the profile dropdown via
         *  Settings → Workspace, so this is decorative on mobile. */
        className="hidden h-7 w-7 items-center justify-center text-ink-700 transition-colors hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 sm:inline-flex dark:text-paper-200 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
      >
        <Plus size={14} aria-hidden="true" />
      </Link>
    );
  }

  async function pickWorkspace(id: number) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitchingId(id);
    try {
      await coupleApi.switchActive(id);
      // Hard reload so every couple-scoped page refetches from scratch.
      // window.location.reload() is the lowest-risk option — anything
      // softer (router refresh, context invalidation) leaves stale
      // localStorage caches in the budget + suppliers pages.
      window.location.assign("/app");
    } catch {
      setSwitchingId(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-sm text-ink-800 transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
        title={t("workspace.switcher_aria")}
      >
        <span className="max-w-[10rem] truncate font-medium">{active.display_name}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-paper-300 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {memberships.map((m) => {
              const isActive = m.couple_id === activeId;
              const isSwitching = switchingId === m.couple_id;
              return (
                <li key={m.couple_id}>
                  <button
                    type="button"
                    onClick={() => pickWorkspace(m.couple_id)}
                    disabled={switchingId !== null && !isSwitching}
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-paper-200/60 text-ink-900 dark:bg-umber-700 dark:text-paper-50"
                        : "text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700/60"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.display_name}</span>
                      {m.wedding_date ? (
                        <span className="block truncate text-xs text-ink-500 dark:text-umber-300">
                          {formatDate(m.wedding_date, locale)}
                        </span>
                      ) : null}
                    </span>
                    {isSwitching ? (
                      <span className="text-xs text-ink-500 dark:text-umber-300">
                        {t("common.loading")}
                      </span>
                    ) : isActive ? (
                      <span className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                        {t("workspace.active_marker")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {!atCap && (
            <div className="border-t border-paper-200 dark:border-umber-700">
              <Link
                to="/app/settings/workspace"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700/60"
              >
                <Plus size={14} aria-hidden="true" />
                <span>{t("workspace.create_link")}</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
