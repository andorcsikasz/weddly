import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";

/**
 * Wrapper for the public-facing surface (landing + vendors). Mirrors
 * the warm paper / ink / blush aesthetic used by the login page —
 * Cormorant serif headings, soft paper-300 borders, dark ink-800
 * primary CTAs.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex min-h-full flex-col bg-paper-50 text-ink-800">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-2"
      >
        {t("landing.skip_to_main")}
      </a>
      <PublicHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

function PublicHeader() {
  const { t, locale, setLocale } = useT();
  return (
    <header className="border-b border-paper-300 bg-paper-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link
          to="/"
          className="font-serif text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl"
        >
          {t("app.name")}
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-7 text-sm text-ink-700 md:flex"
        >
          <a href="#phases" className="hover:text-ink-900">
            {t("landing.nav_how")}
          </a>
          <a href="#suppliers" className="hover:text-ink-900">
            {t("landing.nav_suppliers")}
          </a>
          <Link
            to="/vendors"
            className="inline-flex items-center gap-1.5 rounded-full border border-blush-200 bg-blush-50 px-3 py-1.5 text-xs font-medium text-blush-700 hover:border-blush-400 hover:bg-blush-100"
          >
            {t("landing.vendor_pill")}
            <ArrowRight size={12} />
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
            aria-label="Switch language"
          >
            {locale === "hu" ? "EN" : "HU"}
          </button>
          <Link to="/login" className="btn-ghost btn-sm hidden sm:inline-flex">
            {t("landing.cta_login")}
          </Link>
          <Link to="/signup" className="btn-primary btn-sm">
            {t("landing.cta_signup")}
          </Link>
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  const { t } = useT();
  const askGuestCode = useGuestCodePrompt();
  return (
    <footer className="mt-24 border-t border-paper-300 bg-paper-100/60">
      {/* Band: guest CTA */}
      <div className="border-b border-paper-300">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 sm:flex-row sm:items-center sm:px-6">
          <p className="text-sm text-ink-700">
            <span className="font-medium text-ink-900">{t("landing.footer_band_text")}</span>
          </p>
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => {
              void askGuestCode();
            }}
          >
            {t("landing.footer_band_cta")}
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-serif text-xl font-semibold text-ink-900">{t("app.name")}</p>
          <p className="mt-2 text-sm text-ink-600">{t("landing.footer_tagline")}</p>
        </div>
        <FooterColumn title={t("landing.footer_couples")}>
          <FooterLink to="/signup">{t("landing.footer_couples_signup")}</FooterLink>
          <FooterLink to="/login">{t("landing.footer_couples_signin")}</FooterLink>
          <FooterAnchor href="#phases">{t("landing.footer_couples_features")}</FooterAnchor>
        </FooterColumn>
        <FooterColumn title={t("landing.footer_vendors")}>
          <FooterLink to="/vendors">{t("landing.footer_vendors_waitlist")}</FooterLink>
          <FooterLink to="/vendors">{t("landing.footer_vendors_about")}</FooterLink>
        </FooterColumn>
        <FooterColumn title={t("landing.footer_guests")}>
          <button
            type="button"
            className="text-left text-sm text-ink-700 hover:text-ink-900"
            onClick={() => {
              void askGuestCode();
            }}
          >
            {t("landing.footer_guests_enter")}
          </button>
          <FooterAnchor href="#suppliers">{t("landing.footer_guests_about")}</FooterAnchor>
        </FooterColumn>
      </div>

      <div className="border-t border-paper-300">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            © {new Date().getFullYear()} {t("app.name")}
          </p>
          <div className="flex gap-5">
            <a href="/terms" className="hover:text-ink-700">
              {t("landing.footer_legal_terms")}
            </a>
            <a href="/privacy" className="hover:text-ink-700">
              {t("landing.footer_legal_privacy")}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</p>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </div>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm text-ink-700 hover:text-ink-900">
      {children}
    </Link>
  );
}

function FooterAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-sm text-ink-700 hover:text-ink-900">
      {children}
    </a>
  );
}

/**
 * Sends the user to the airport-style /rsvp check-in page. Old invites that
 * shipped a `/rsvp/<6char>` URL still resolve via that route; this trigger
 * funnels everyone through the new flow.
 */
export function useGuestCodePrompt() {
  const navigate = useNavigate();
  return async () => {
    navigate("/rsvp");
  };
}
