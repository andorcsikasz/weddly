// Header dropdown for the signed-in user. Trigger is an initial-circle
// button; panel shows name, email, link to /app/profile, and Sign out.
// Closes on outside click, Escape, route change, or item selection.

import { Inbox, LogOut, ShieldCheck, UserCog, UserRound } from "lucide-react";
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
  const firstName = (user.full_name || user.email).trim().split(/\s+/)[0] ?? "";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("profile.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-1 text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2"
      >
        {firstName && (
          <span className="hidden text-sm font-medium text-ink-800 lg:inline">{firstName}</span>
        )}
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold uppercase text-paper-100 transition-colors group-hover:bg-ink-900">
          {initials}
        </span>
        <ChevronDownIcon />
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
          {user.is_admin && (
            <>
              <div className="mx-3 mt-2 mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blush-700">
                <ShieldCheck size={11} aria-hidden="true" />
                {t("admin.nav_label")}
              </div>
              <Link
                to="/app/admin/suppliers"
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-blush-700 hover:bg-blush-50"
              >
                <ShieldCheck size={16} aria-hidden="true" />
                <span>{t("admin.nav_suppliers")}</span>
              </Link>
              <Link
                to="/app/admin/users"
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-blush-700 hover:bg-blush-50"
              >
                <UserCog size={16} aria-hidden="true" />
                <span>{t("admin.nav_users")}</span>
              </Link>
              <Link
                to="/app/admin/vendor-waitlist"
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-blush-700 hover:bg-blush-50"
              >
                <Inbox size={16} aria-hidden="true" />
                <span>{t("admin.nav_waitlist")}</span>
              </Link>
              <div className="my-1 h-px bg-paper-200" />
            </>
          )}
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

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-ink-500"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
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
