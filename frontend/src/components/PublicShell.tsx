import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { useEntryPrompt } from "./ui";

/**
 * Wrapper for the public-facing surface (landing + vendors). Renders the
 * Soft-Modern header on top, page content in the middle, public footer at
 * the bottom. Distinct from `Shell` (used by auth/legal pages) and
 * `AppShell` (used after login).
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-chalk-50 text-ink-900">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}

function PublicHeader() {
  const { t, locale, setLocale } = useT();
  return (
    <header className="border-b border-chalk-200 bg-chalk-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">
          {t("app.name")}
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-ink-700 md:flex">
          <a href="#phases" className="hover:text-ink-900">
            {t("landing.nav_how")}
          </a>
          <a href="#suppliers" className="hover:text-ink-900">
            {t("landing.nav_suppliers")}
          </a>
          <Link
            to="/vendors"
            className="inline-flex items-center gap-1.5 rounded-full border border-terracotta-300 bg-terracotta-50 px-3 py-1.5 text-xs font-medium text-terracotta-700 hover:border-terracotta-500 hover:bg-terracotta-100"
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
          <Link
            to="/signup"
            className="inline-flex items-center justify-center rounded-full bg-terracotta-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta-500 focus-visible:ring-offset-2"
          >
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
    <footer className="mt-24 border-t border-chalk-200 bg-chalk-100/60">
      {/* Band: guest CTA */}
      <div className="border-b border-chalk-200">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 sm:flex-row sm:items-center sm:px-6">
          <p className="text-sm text-ink-700">
            <span className="font-medium text-ink-900">{t("landing.footer_band_text")}</span>
          </p>
          <button
            type="button"
            className="btn-square btn-sm"
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
          <p className="font-display text-xl text-ink-900">{t("app.name")}</p>
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

      <div className="border-t border-chalk-200">
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
 * Asks for an invite code via the existing entry-dialog primitive and
 * navigates to the corresponding RSVP page. Exported so LandingPage and
 * the footer can share one trigger.
 */
export function useGuestCodePrompt() {
  const { t } = useT();
  const promptEntry = useEntryPrompt();
  const navigate = useNavigate();
  return async () => {
    const code = await promptEntry({
      title: t("landing.guest_sheet_title"),
      label: t("landing.guest_sheet_label"),
      placeholder: t("landing.guest_sheet_placeholder"),
      helperText: t("landing.guest_sheet_body"),
      confirmLabel: t("landing.guest_sheet_cta"),
      cancelLabel: t("landing.guest_sheet_cancel"),
      validate: (v) => (v.trim().length === 0 ? t("landing.guest_sheet_invalid") : null),
    });
    if (!code) return;
    navigate(`/rsvp/${encodeURIComponent(code.trim())}`);
  };
}
