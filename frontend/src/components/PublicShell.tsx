import { Menu, UserCheck, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { Wordmark } from "./Wordmark";

/** Track scroll direction so the public header can hide on scroll-down
 *  and reveal on scroll-up. Returns `true` while the header should be
 *  hidden. Stays visible whenever the page is near the top (< 80 px),
 *  so the user never lands on a blank chrome zone.
 *
 *  Honours `prefers-reduced-motion`: when the user has reduce-motion on,
 *  we never hide the header (no slide-in/out animation either). The
 *  matchMedia listener also keeps things correct if the OS preference
 *  flips while the page is open. */
function useHeaderHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let cleanupScroll: (() => void) | null = null;

    const attach = () => {
      if (reduce.matches) {
        // Reduced motion: scroll-hide is purely cosmetic, so opt out.
        setHidden(false);
        return;
      }
      lastY.current = window.scrollY;
      const onScroll = () => {
        const y = window.scrollY;
        const dy = y - lastY.current;
        if (y < 80) {
          setHidden(false);
        } else if (dy > 4) {
          // Scrolling down past the threshold — slide the header out.
          setHidden(true);
        } else if (dy < -4) {
          // Scrolling up — bring it back regardless of position.
          setHidden(false);
        }
        lastY.current = y;
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      cleanupScroll = () => window.removeEventListener("scroll", onScroll);
    };

    attach();

    const onPrefChange = () => {
      // Tear down whichever path we wired up, then re-attach against the
      // new preference state.
      cleanupScroll?.();
      cleanupScroll = null;
      setHidden(false);
      attach();
    };
    reduce.addEventListener("change", onPrefChange);

    return () => {
      cleanupScroll?.();
      reduce.removeEventListener("change", onPrefChange);
    };
  }, []);
  return hidden;
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const otherLocale = locale === "hu" ? "en" : "hu";
  const hidden = useHeaderHidden();

  return (
    <header
      data-scroll-hide="true"
      className={`sticky top-0 z-40 border-b border-paper-300 bg-paper-50/85 backdrop-blur transition-transform duration-200 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="shrink-0 text-ink-900 transition-colors hover:text-ink-700">
          {/* Header wordmark sits between Wordmark's md and lg presets:
              bigger than the body brand mark, but tracked tightly so the
              full WĒDDLY + audience cluster + right cluster fit at lg
              viewports. */}
          <Wordmark size="md" className="text-lg tracking-[0.32em] sm:text-xl" />
        </Link>

        {/* Audience entry points pulled left, immediately after the
            wordmark, as solid paper-toned chips. Vendor + Guest are
            the two non-couple paths — couples land via the right-side
            sign-up. */}
        <nav aria-label="Audience" className="ml-2 hidden items-center gap-2 md:flex">
          <Link
            to="/vendors"
            className="rounded-md border border-paper-300/70 bg-paper-100 px-3 py-1.5 text-sm text-ink-800 transition-colors hover:border-paper-400 hover:bg-paper-200"
          >
            {t("landing.nav_vendors")}
          </Link>
          <Link
            to="/rsvp"
            className="rounded-md border border-paper-300/70 bg-paper-100 px-3 py-1.5 text-sm text-ink-800 transition-colors hover:border-paper-400 hover:bg-paper-200"
          >
            {t("landing.footer_guests")}
          </Link>
        </nav>

        {/* Right cluster: every interactive item at text-sm so the
            wordmark logo is the only thing that visually leads. */}
        <div className="ml-auto flex items-center gap-3">
          <a
            href={`mailto:test.andorcsikasz@gmail.com?subject=${encodeURIComponent(t("landing.nav_feedback_subject"))}`}
            className="hidden text-sm text-ink-600 transition-colors hover:text-ink-900 lg:inline-flex"
          >
            {t("landing.nav_feedback")}
          </a>
          <Link
            to="/login"
            className="hidden text-sm text-ink-700 transition-colors hover:text-ink-900 sm:inline-flex"
          >
            {t("landing.cta_login")}
          </Link>
          <Link to="/signup" className="btn-primary px-3.5 py-1.5 text-sm">
            {t("landing.cta_signup")}
          </Link>
          <button
            type="button"
            onClick={() => setLocale(otherLocale)}
            className="hidden text-sm font-medium uppercase tracking-wider text-ink-500 transition-colors hover:text-ink-900 md:inline-flex"
            aria-label="Switch language"
          >
            {otherLocale}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-nav"
            aria-label={menuOpen ? t("public.menu_close") : t("public.menu_open")}
            className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-paper-100 hover:text-ink-900 md:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="public-mobile-nav"
          aria-label="Primary mobile"
          className="border-t border-paper-300 bg-paper-50 md:hidden"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-sm text-ink-700 sm:px-6">
            <Link
              to="/vendors"
              className="rounded-md px-2 py-2 transition-colors hover:bg-paper-100 hover:text-ink-900"
              onClick={() => setMenuOpen(false)}
            >
              {t("landing.nav_vendors")}
            </Link>
            <Link
              to="/rsvp"
              className="rounded-md px-2 py-2 transition-colors hover:bg-paper-100 hover:text-ink-900"
              onClick={() => setMenuOpen(false)}
            >
              {t("landing.footer_guests")}
            </Link>
            <Link
              to="/login"
              className="rounded-md px-2 py-2 transition-colors hover:bg-paper-100 hover:text-ink-900"
              onClick={() => setMenuOpen(false)}
            >
              {t("landing.cta_login")}
            </Link>
            <a
              href={`mailto:test.andorcsikasz@gmail.com?subject=${encodeURIComponent(t("landing.nav_feedback_subject"))}`}
              className="rounded-md px-2 py-2 transition-colors hover:bg-paper-100 hover:text-ink-900"
              onClick={() => setMenuOpen(false)}
            >
              {t("landing.nav_feedback")}
            </a>
            <button
              type="button"
              onClick={() => {
                setLocale(otherLocale);
                setMenuOpen(false);
              }}
              className="mt-1 flex items-center justify-between rounded-md px-2 py-2 text-left transition-colors hover:bg-paper-100 hover:text-ink-900"
            >
              <span>Language</span>
              <span className="text-xs font-medium uppercase tracking-wider text-ink-500">
                {locale} → {otherLocale}
              </span>
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}

function PublicFooter() {
  const { t } = useT();
  const askGuestCode = useGuestCodePrompt();
  return (
    <footer className="mt-24 border-t border-paper-300 bg-paper-100/60">
      {/* Band: guest CTA — italic serif label on the left, stationery-
          textured button on the right. Matches the hero's guest CTA so
          the two surfaces feel like one quiet invitation. */}
      <div className="border-b border-paper-300">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-6">
          <p className="font-serif text-lg italic text-ink-900 sm:text-xl">
            {t("landing.footer_band_text")}
          </p>
          <button
            type="button"
            className="stationery inline-flex items-center gap-2.5 rounded-lg border border-paper-400/80 px-5 py-2.5 text-sm font-medium text-ink-900 shadow-sm transition-all hover:border-ink-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500 focus-visible:ring-offset-2"
            onClick={() => {
              void askGuestCode();
            }}
          >
            <UserCheck size={15} aria-hidden />
            {t("landing.footer_band_cta")}
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <Wordmark size="md" className="text-ink-900" />
          <p className="mt-3 text-sm text-ink-600">{t("landing.footer_tagline")}</p>
        </div>
        <FooterColumn title={t("landing.footer_couples")}>
          <FooterLink to="/signup">{t("landing.footer_couples_signup")}</FooterLink>
          <FooterLink to="/login">{t("landing.footer_couples_signin")}</FooterLink>
          <FooterAnchor href="#phases">{t("landing.footer_couples_features")}</FooterAnchor>
        </FooterColumn>
        <FooterColumn title={t("landing.footer_vendors")}>
          <FooterLink to="/vendors">{t("landing.footer_vendors_waitlist")}</FooterLink>
          <FooterLink to="/about">{t("landing.footer_about_link")}</FooterLink>
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
          {/* The original "What is RSVP?" link pointed at the landing's
              #suppliers anchor, which 404'd visually on every public
              surface other than /. Send guests to the real check-in
              page instead — that's the destination they actually want. */}
          <FooterLink to="/rsvp">{t("landing.footer_guests_about")}</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-paper-300">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-ink-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            © {new Date().getFullYear()} {t("app.name")}
          </p>
          <div className="flex gap-5">
            <Link to="/terms" className="hover:text-ink-700">
              {t("landing.footer_legal_terms")}
            </Link>
            <Link to="/privacy" className="hover:text-ink-700">
              {t("landing.footer_legal_privacy")}
            </Link>
            <Link to="/about" className="hover:text-ink-700">
              {t("landing.footer_legal_about")}
            </Link>
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
