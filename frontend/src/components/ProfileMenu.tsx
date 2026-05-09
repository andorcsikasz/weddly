// Header dropdown for the signed-in user. Trigger is an initial-circle
// button; panel shows name, email, link to /app/profile, and Sign out.
// Closes on outside click, Escape, route change, or item selection.

import { LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

export function ProfileMenu() {
  const { user, logout } = useAuth();
  const { t } = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-close when navigating away.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!user) return null;

  const initials = getInitials(user.full_name, user.email);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("profile.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold uppercase text-paper-100 transition-colors hover:bg-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-64 origin-top-right rounded-2xl border border-paper-300 bg-white p-2 shadow-pop"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-900">
              {user.full_name || t("profile.no_name")}
            </p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-paper-200" />
          <Link
            to="/app/profile"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100"
          >
            <UserRound size={16} aria-hidden="true" />
            <span>{t("profile.menu_profile")}</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100"
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t("common.sign_out")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function getInitials(fullName: string, email: string): string {
  const source = fullName.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const single = parts[0] ?? "";
  return single.slice(0, 2).toUpperCase() || "?";
}
