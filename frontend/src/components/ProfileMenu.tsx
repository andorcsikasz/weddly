// Header dropdown for the signed-in user. Trigger is an initial-circle
// button; panel shows name, email, link to /app/profile, and Sign out.
// Closes on outside click, Escape, route change, or item selection.

import type { CouplePartnerView } from "@shared/types";
import {
  ArrowLeftRight,
  Home,
  Languages,
  Layers,
  LogOut,
  MessageCircle,
  Share2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { nextLocale, useT } from "../lib/i18n";

/** `onOpenFeedback` is supplied by AppShell. The feedback dialog's entry
 *  point lives here in the profile dropdown for every viewport (it used to
 *  be a header icon). Omit on screens that don't host a feedback dialog.
 *
 *  `onOpenShare` is the same arrangement for the share-Weddly prompt. It is
 *  passed only by the COUPLE shell: the share messages are written in a
 *  couple's voice ("we're planning our wedding with Weddly"), so putting the
 *  entry in the vendor or planner dropdown would hand those users a script
 *  that isn't theirs. Unlike the automatic popup, this entry has no limit —
 *  it opens the modal however many times it's clicked. */
export function ProfileMenu({
  onOpenFeedback,
  onOpenShare,
}: { onOpenFeedback?: () => void; onOpenShare?: () => void } = {}) {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Partner trickle — fetched once the user is signed in so the header
  // can stack a second monogram circle alongside the current user's once
  // the partner has actually joined the workspace. Stays null while the
  // partner is only "invited" (no name yet) or no partner exists.
  const [partner, setPartner] = useState<CouplePartnerView | null>(null);

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

  // Hydrate partner once per signed-in session. We don't need realtime
  // updates here — a refresh picks up "partner joined" when their session
  // actually goes live, and the absence of the second circle while invited
  // is itself a useful "they haven't accepted yet" signal.
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPartner(null);
      return;
    }
    (async () => {
      try {
        const res = await coupleApi.partner();
        if (!cancelled) setPartner(res.partner);
      } catch {
        if (!cancelled) setPartner(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const inAdminView = location.pathname.startsWith("/app/admin");
  const initials = getInitials(user.full_name, user.email);
  // Only stack the partner monogram once they've actually joined — while
  // the partner is "invited" (no name, no account) showing a placeholder
  // would lie about presence.
  const showPartner =
    partner !== null &&
    (partner.status === "joined" || partner.status === "active") &&
    !!partner.full_name;
  const partnerInitials = showPartner
    ? getInitials(partner.full_name ?? "", partner.email ?? "")
    : "";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("profile.menu_label")}
        onClick={() => setOpen((v) => !v)}
        className="group inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-1 text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
      >
        <span className="flex items-center">
          {showPartner && (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-blush-700 text-xs font-semibold uppercase text-paper-100 ring-2 ring-paper-50 dark:bg-blush-500 dark:ring-umber-800"
              title={partner?.full_name ?? ""}
            >
              {partnerInitials}
            </span>
          )}
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold uppercase text-paper-100 transition-colors group-hover:bg-ink-900 dark:bg-umber-600 dark:text-paper-50 dark:group-hover:bg-umber-500 ${
              showPartner ? "-ml-3 ring-2 ring-paper-50 dark:ring-umber-800" : ""
            }`}
          >
            {initials}
          </span>
        </span>
        <ChevronDownIcon />
      </button>

      {open && (
        <div
          role="menu"
          // Landing typeface (General Sans / font-grotesk) across the panel.
          // `[&_a]/[&_button]:lowercase` lowercases just the menu items (links +
          // buttons) for the soft, lowercase-start look — the name/email above
          // are <p> elements, so they keep their proper casing.
          className="absolute right-0 top-full z-30 mt-2 max-h-[calc(100vh-5rem)] w-64 max-w-[calc(100vw-1rem)] origin-top-right overflow-y-auto overscroll-contain rounded-2xl border border-paper-300 bg-white p-2 font-grotesk shadow-pop [&_a]:lowercase [&_button]:lowercase dark:border-umber-700 dark:bg-umber-800"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
              {user.full_name || t("profile.no_name")}
            </p>
            <p className="truncate text-xs text-ink-500 dark:text-umber-300">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          <Link
            to="/app/settings/account"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <UserRound size={16} aria-hidden="true" />
            <span>{t("profile.menu_profile")}</span>
          </Link>
          <Link
            to="/"
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <Home size={16} aria-hidden="true" />
            <span>{t("profile.menu_landing")}</span>
          </Link>
          <Link
            to={
              locale === "hu"
                ? "/eszkozok/100-kerdes-eskuvo-elott"
                : "/tools/100-questions-before-marriage"
            }
            role="menuitem"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <Layers size={16} aria-hidden="true" />
            <span>{t("profile.menu_couple_cards")}</span>
          </Link>
          {/* Divider: everything above is navigation, everything below is an
           *  action taken from here. */}
          {(onOpenShare || onOpenFeedback) && (
            <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
          )}
          {onOpenShare && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenShare();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
            >
              <Share2 size={16} aria-hidden="true" />
              <span>{t("share_weddly.menu_label")}</span>
            </button>
          )}
          {/* Feedback lives here in the dropdown for every viewport (it was
           *  moved out of the header icon row). The language toggle stays a
           *  mobile-only entry — tablet+ keeps the inline header icon, so it's
           *  `sm:hidden` here. */}
          {onOpenFeedback && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenFeedback();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span>{t("landing.nav_feedback")}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setLocale(nextLocale(locale));
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 sm:hidden dark:text-paper-100 dark:hover:bg-umber-700"
          >
            <span className="inline-flex items-center gap-2">
              <Languages size={16} aria-hidden="true" />
              <span>{t("nav.switch_language")}</span>
            </span>
            <span className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {locale} → {nextLocale(locale)}
            </span>
          </button>
          {user.is_admin && (
            <>
              <Link
                to={inAdminView ? "/app" : "/app/admin/suppliers"}
                role="menuitem"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-950 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-500/20"
              >
                {inAdminView ? (
                  <ArrowLeftRight size={16} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={16} aria-hidden="true" />
                )}
                <span>
                  {inAdminView ? t("admin.exit_admin_view") : t("admin.enter_admin_view")}
                </span>
              </Link>
              <div className="my-1 h-px bg-paper-200 dark:bg-umber-700" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
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
      className="text-ink-500 dark:text-umber-300"
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
