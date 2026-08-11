// Header dropdown for the signed-in user. Trigger is an initial-circle
// button; panel shows name, email, link to /app/profile, and Sign out.
// Closes on outside click, Escape, route change, or item selection.

import type { CouplePartnerView } from "@shared/types";
import {
  ArrowLeftRight,
  Check,
  Home,
  Languages,
  Layers,
  LogOut,
  MessageCircle,
  Moon,
  Share2,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isCurrentSessionDemo } from "../lib/demoSession";
import { coupleApi } from "../lib/endpoints";
import { LOCALE_NAMES, LOCALES, useT } from "../lib/i18n";

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
  theme,
  onToggleTheme,
}: {
  onOpenFeedback?: () => void;
  onOpenShare?: () => void;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
} = {}) {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Partner trickle — fetched once the user is signed in so the header can
  // show either the joined partner's monogram or the empty invitation slot.
  // `undefined` means the request has not completed (or could not be
  // refreshed); `null` is the server-confirmed "no partner and no pending
  // invite" state. Keeping those apart prevents the empty invite slot from
  // flashing for couples who already have a partner while the header loads.
  const [partner, setPartner] = useState<CouplePartnerView | null | undefined>(undefined);

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

  // Refresh the lightweight session-presence signal periodically. The backend
  // deliberately calls this "signed in", not "online": an unexpired session
  // is useful collaboration context without pretending to be heartbeat-level
  // realtime presence.
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPartner(undefined);
      return;
    }
    const refreshPartner = async () => {
      try {
        const res = await coupleApi.partner();
        if (!cancelled) setPartner(res.partner);
      } catch {
        // Preserve the last confirmed state. A temporary request failure must
        // not turn into a false "invite your partner" affordance.
      }
    };
    void refreshPartner();
    const interval = window.setInterval(refreshPartner, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user]);

  if (!user) return null;

  const inAdminView = location.pathname.startsWith("/app/admin");
  const initials = getInitials(user.full_name, user.email);
  // Only stack the partner monogram once they've actually joined — while
  // the partner is "invited" (no name, no account) showing a placeholder
  // would lie about presence.
  const showPartner =
    partner != null &&
    (partner.status === "joined" || partner.status === "active") &&
    !!partner.full_name;
  const showEmptyPartnerSlot = partner === null && !inAdminView && !isCurrentSessionDemo();
  const partnerInitials = showPartner
    ? getInitials(partner.full_name ?? "", partner.email ?? "")
    : "";

  return (
    <div ref={wrapRef} className="relative">
      <div className="inline-flex items-center">
        {showEmptyPartnerSlot && (
          <Link
            to="/app#invite-partner"
            aria-label={t("dashboard.invite_partner")}
            title={t("dashboard.invite_partner")}
            className="inline-flex h-10 w-10 shrink-0 rounded-full border-2 border-dashed border-ink-300 transition-colors hover:border-ink-500 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:border-umber-500 dark:hover:border-umber-300 dark:hover:bg-umber-800 dark:focus-visible:ring-paper-100"
          />
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("profile.menu_label")}
          onClick={() => setOpen((v) => !v)}
          className={`group inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full px-1 text-ink-700 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100 ${
            showEmptyPartnerSlot ? "ml-1" : ""
          }`}
        >
          <span className="flex items-center">
            {showPartner && (
              <span
                aria-hidden="true"
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-blush-700 text-xs font-semibold uppercase text-paper-100 ring-2 ring-paper-50 dark:bg-blush-500 dark:ring-umber-800"
                title={`${partner?.full_name ?? ""} · ${t(`profile.partner_status_${partner?.status ?? "joined"}`)}`}
              >
                {partnerInitials}
                <span
                  className={`absolute bottom-0 left-0 z-10 h-3 w-3 rounded-full border-2 border-paper-50 dark:border-umber-800 ${
                    partner?.status === "active" ? "bg-sage-500" : "bg-umber-400"
                  }`}
                />
              </span>
            )}
            <span
              title={`${user.full_name || user.email} · ${t("profile.partner_status_active")}`}
              className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-ink-800 text-xs font-semibold uppercase text-paper-100 transition-colors group-hover:bg-ink-900 dark:bg-umber-600 dark:text-paper-50 dark:group-hover:bg-umber-500 ${
                showPartner ? "-ml-3 ring-2 ring-paper-50 dark:ring-umber-800" : ""
              }`}
            >
              {initials}
              <span className="absolute bottom-0 right-0 z-10 h-3 w-3 rounded-full border-2 border-paper-50 bg-sage-500 dark:border-umber-800" />
            </span>
          </span>
          <ChevronDownIcon />
        </button>
      </div>

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
          {/* Mobile: list the languages so the user PICKS one, instead of the
              old blind cycle (which got confusing with a third language). */}
          <div className="sm:hidden">
            <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
              <Languages size={14} aria-hidden="true" />
              {t("nav.switch_language")}
            </p>
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                role="menuitemradio"
                aria-checked={l === locale}
                onClick={() => {
                  setOpen(false);
                  if (l !== locale) setLocale(l);
                }}
                className={`grid min-h-tap w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-paper-100 dark:hover:bg-umber-700 ${
                  l === locale
                    ? "font-semibold text-ink-900 dark:text-paper-50"
                    : "text-ink-700 dark:text-paper-100"
                }`}
              >
                <span className="min-w-0 pl-12">{LOCALE_NAMES[l]}</span>
                {l === locale && <Check size={15} aria-hidden="true" className="shrink-0" />}
              </button>
            ))}
          </div>
          {theme && onToggleTheme && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onToggleTheme();
              }}
              className="flex min-h-tap w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-paper-100 sm:hidden dark:text-paper-100 dark:hover:bg-umber-700"
            >
              {theme === "dark" ? (
                <Sun size={16} aria-hidden="true" />
              ) : (
                <Moon size={16} aria-hidden="true" />
              )}
              <span>{theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}</span>
            </button>
          )}
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
