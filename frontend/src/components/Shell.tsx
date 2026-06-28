import { Languages, LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { Wordmark } from "./Wordmark";

export function Shell({ children, hideHeader }: { children: ReactNode; hideHeader?: boolean }) {
  return (
    <div className="min-h-full">
      {!hideHeader && <Header />}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}

function Header() {
  const { user, logout } = useAuth();
  const { locale, setLocale, t } = useT();
  const { pathname } = useLocation();
  const otherLocale = locale === "hu" ? "en" : "hu";
  return (
    <header className="border-b border-paper-300 bg-paper-50/80 backdrop-blur dark:border-umber-700 dark:bg-umber-900/80">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link
          to="/"
          className="shrink-0 text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
        >
          <Wordmark size="md" />
        </Link>

        {/* Vendors + planners get their own registration paths — couples land
            here via the right-side sign-up, but a vendor or planner who hits an
            auth page can branch off to the flow built for them. */}
        <nav
          aria-label={t("public.nav_audience_aria")}
          className="hidden items-center gap-4 font-grotesk sm:flex"
        >
          {[
            { to: "/vendors", label: t("landing.nav_vendors") },
            { to: "/planners", label: t("landing.nav_planners") },
          ].map(({ to, label }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={`text-sm transition-colors ${
                  active
                    ? "font-medium text-umber-900 dark:text-paper-50"
                    : "text-umber-700 hover:text-umber-900 dark:text-paper-200 dark:hover:text-paper-50"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            onClick={() => setLocale(otherLocale)}
            aria-label={t("nav.switch_language")}
            title={otherLocale.toUpperCase()}
          >
            <Languages size={18} aria-hidden="true" />
          </button>
          {user ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => logout()}>
              {t("common.sign_out")}
            </button>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                aria-label={t("landing.cta_login")}
                title={t("landing.cta_login")}
              >
                <LogIn size={18} aria-hidden="true" />
              </Link>
              <Link className="btn-primary btn-sm" to="/signup">
                {t("landing.cta_signup")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
