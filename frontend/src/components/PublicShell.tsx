import {
  Languages,
  LogIn,
  Menu,
  MessageSquare,
  Moon,
  Store,
  Sun,
  UserCheck,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useT } from "../lib/i18n";
import { FeedbackDialog } from "./FeedbackDialog";
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
 * Cormorant serif headings, soft paper-300 borders, dark umber-900
 * primary CTAs.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex min-h-full flex-col bg-paper-50 text-umber-900 dark:bg-umber-900 dark:text-paper-100">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-umber-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-umber-600 focus:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:focus:ring-blush-400"
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const otherLocale = locale === "hu" ? "en" : "hu";
  const hidden = useHeaderHidden();

  // Theme toggle shared with AppShell via `localStorage["weddly.theme"]`.
  // Public default is `light` (the warm paper marketing aesthetic); /app
  // defaults to `dark` when the user has never expressed a preference.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("weddly.theme") === "dark" ? "dark" : "light";
  });
  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try {
      window.localStorage.setItem("weddly.theme", theme);
    } catch {
      /* localStorage blocked — preference just won't persist */
    }
  }, [theme]);

  function openFeedback() {
    setMenuOpen(false);
    setFeedbackOpen(true);
  }

  return (
    <header
      data-scroll-hide="true"
      className={`sticky top-0 z-40 border-b border-paper-300 bg-paper-50/85 backdrop-blur transition-transform duration-200 dark:border-umber-700 dark:bg-umber-900/85 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          to="/"
          className="shrink-0 text-umber-900 transition-colors hover:text-umber-800 dark:text-paper-50 dark:hover:text-blush-300"
        >
          {/* Header wordmark sits between Wordmark's md and lg presets:
              bigger than the body brand mark, but tracked tightly so the
              full WĒDDLY + audience cluster + right cluster fit at lg
              viewports. */}
          <Wordmark size="md" className="text-lg tracking-[0.32em] sm:text-xl" />
        </Link>

        {/* Audience entry points pulled left, immediately after the
            wordmark. Vendor + Guest are the two non-couple paths —
            couples land via the right-side sign-up. */}
        <nav
          aria-label={t("public.nav_audience_aria")}
          className="ml-2 hidden items-center gap-4 font-grotesk md:flex"
        >
          <Link
            to="/vendors"
            className="relative px-1 py-1.5 text-sm text-umber-900 transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-0 after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out hover:text-umber-900 hover:after:w-[calc(100%-0.5rem)] focus-visible:after:w-[calc(100%-0.5rem)] dark:text-paper-100 dark:hover:text-paper-50"
          >
            {t("landing.nav_vendors")}
          </Link>
          <Link
            to="/rsvp"
            className="relative px-1 py-1.5 text-sm text-umber-900 transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-0 after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out hover:text-umber-900 hover:after:w-[calc(100%-0.5rem)] focus-visible:after:w-[calc(100%-0.5rem)] dark:text-paper-100 dark:hover:text-paper-50"
          >
            {t("landing.footer_guests")}
          </Link>
        </nav>

        {/* Right cluster — left-to-right DOM order: feedback, locale,
            theme, login, signup. The action button anchors the right
            edge alone; login sits closest to it because "I already
            have an account" is the next-most-likely intent after the
            primary CTA. The hamburger trails on mobile only. */}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={openFeedback}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 sm:inline-flex"
            aria-label={t("landing.nav_feedback")}
            title={t("landing.nav_feedback")}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setLocale(otherLocale)}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 md:inline-flex"
            aria-label={t("nav.switch_language")}
            title={otherLocale.toUpperCase()}
          >
            <Languages size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 sm:h-8 sm:w-8 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            aria-label={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}
          >
            {theme === "dark" ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
          </button>
          <Link
            to="/login"
            className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 sm:inline-flex"
            aria-label={t("landing.cta_login")}
            title={t("landing.cta_login")}
          >
            <LogIn size={18} aria-hidden="true" />
          </Link>
          {/* Header signup CTA hidden on phones: it competed with the
           *  hamburger for the right edge and pushed the wordmark closer
           *  to the moon toggle than to the brand origin. The mobile
           *  menu and the landing's own hero+sticky CTA carry signup
           *  intent below sm. Tablet+ still gets the inline button. */}
          <Link
            to="/signup"
            className="btn-primary hidden shrink-0 whitespace-nowrap px-4 text-sm min-h-tap !py-2.5 sm:inline-flex sm:min-h-0 sm:!py-1.5"
          >
            {t("landing.cta_signup")}
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-nav"
            aria-label={menuOpen ? t("public.menu_close") : t("public.menu_open")}
            className="-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 sm:h-8 sm:w-8 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 md:hidden"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="public-mobile-nav"
          aria-label={t("public.nav_mobile_aria")}
          className="border-t border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-900 md:hidden"
        >
          {/* Mobile menu rows: lucide glyph on the left, lowercase label on
           *  the right. `lowercase` is enforced via `normal-case` reset
           *  plus the literal `lowercase` utility so HU title-case labels
           *  read as a soft index (the user explicitly asked for "csupa
           *  kisbetű"). The hu locale's title-case "Bejelentkezés" /
           *  "Visszajelzés" lower-cases visually without a string rewrite,
           *  which keeps SEO + locale keys intact. */}
          <div className="mx-auto flex max-w-7xl flex-col gap-0.5 px-4 py-3 font-grotesk text-sm text-umber-800 sm:px-6 dark:text-paper-100">
            <Link
              to="/vendors"
              className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
              onClick={() => setMenuOpen(false)}
            >
              <Store size={16} aria-hidden="true" className="text-umber-600 dark:text-umber-300" />
              <span>{t("landing.nav_vendors")}</span>
            </Link>
            <Link
              to="/rsvp"
              className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
              onClick={() => setMenuOpen(false)}
            >
              <UserCheck
                size={16}
                aria-hidden="true"
                className="text-umber-600 dark:text-umber-300"
              />
              <span>{t("landing.footer_guests")}</span>
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
              onClick={() => setMenuOpen(false)}
            >
              <LogIn size={16} aria-hidden="true" className="text-umber-600 dark:text-umber-300" />
              <span>{t("landing.cta_login")}</span>
            </Link>
            <button
              type="button"
              onClick={openFeedback}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 text-left lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <MessageSquare
                size={16}
                aria-hidden="true"
                className="text-umber-600 dark:text-umber-300"
              />
              <span>{t("landing.nav_feedback")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLocale(otherLocale);
                setMenuOpen(false);
              }}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <span className="inline-flex items-center gap-3">
                <Languages
                  size={16}
                  aria-hidden="true"
                  className="text-umber-600 dark:text-umber-300"
                />
                <span>{t("nav.switch_language")}</span>
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-umber-700 dark:text-umber-300">
                {locale} → {otherLocale}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTheme(theme === "dark" ? "light" : "dark");
                setMenuOpen(false);
              }}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <span className="inline-flex items-center gap-3">
                {theme === "dark" ? (
                  <Sun size={16} aria-hidden="true" className="text-umber-600 dark:text-umber-300" />
                ) : (
                  <Moon size={16} aria-hidden="true" className="text-umber-600 dark:text-umber-300" />
                )}
                <span>{theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}</span>
              </span>
            </button>
          </div>
        </nav>
      )}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} source="landing" />
    </header>
  );
}

function PublicFooter() {
  const { t, locale } = useT();
  const askGuestCode = useGuestCodePrompt();
  const couplesCardsPath =
    locale === "hu" ? "/eszkozok/100-kerdes-eskuvo-elott" : "/tools/100-questions-before-marriage";
  return (
    <footer className="mt-16 border-t border-paper-300 bg-paper-100/60 font-grotesk sm:mt-24 dark:border-umber-700 dark:bg-umber-950/60">
      {/* Band: who-are-you. The specialty-coffee voice carried into the
       *  footer — a quiet grotesk prompt names the two non-couple audiences,
       *  each option a hairline cream pill that fills to espresso on hover
       *  (the single bright object inverts, candlelit). */}
      <div className="border-b border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-950">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-x-6 gap-y-4 px-4 py-7 sm:flex-row sm:flex-wrap sm:justify-center sm:px-6 sm:py-8">
          <span className="font-grotesk text-[0.7rem] font-medium uppercase tracking-[0.22em] text-umber-600 dark:text-umber-300">
            {t("landing.footer_band_prompt")}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/vendors" className={footerBandBtnClass}>
              <Store size={15} aria-hidden />
              {t("landing.footer_band_cta_vendor")}
            </Link>
            <button
              type="button"
              className={footerBandBtnClass}
              onClick={() => {
                void askGuestCode();
              }}
            >
              <UserCheck size={15} aria-hidden />
              {t("landing.footer_band_cta")}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile = 2-col grid: brand+tagline span the row at top, then the
       *  three link columns sit two-up below (Vendors + Guests share a
       *  row, Couples gets its own width). Tablet keeps the previous
       *  2-col grid; desktop expands to the brand+3-col layout. */}
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-12">
        <div className="col-span-2 lg:col-span-1">
          <Wordmark size="md" className="text-umber-900 dark:text-paper-50" />
          <p className="mt-2 max-w-xs text-sm leading-snug text-umber-700 sm:mt-3 sm:leading-relaxed dark:text-umber-200">
            {t("landing.footer_tagline")}
          </p>
        </div>
        <FooterColumn title={t("landing.footer_couples")}>
          <FooterLink to="/signup">{t("landing.footer_couples_signup")}</FooterLink>
          <FooterLink to="/login">{t("landing.footer_couples_signin")}</FooterLink>
          <FooterAnchor href="#phases">{t("landing.footer_couples_features")}</FooterAnchor>
          <FooterLink to="/blog">{t("blog.eyebrow")}</FooterLink>
          <FooterLink to={couplesCardsPath}>{t("landing.footer_couples_cards")}</FooterLink>
        </FooterColumn>
        <FooterColumn title={t("landing.footer_vendors")}>
          <FooterLink to="/vendors">{t("landing.footer_vendors_waitlist")}</FooterLink>
          <FooterLink to="/about">{t("landing.footer_about_link")}</FooterLink>
        </FooterColumn>
        <FooterColumn title={t("landing.footer_guests")}>
          <button
            type="button"
            className={`text-left ${footerLinkClass}`}
            onClick={() => {
              void askGuestCode();
            }}
          >
            {t("landing.footer_guests_enter")}
          </button>
          {/* The original "What is RSVP?" link pointed at the landing's
              #suppliers anchor, which 404'd visually on every public
              surface other than /. Send guests to the real check-in
              page instead, since that's the destination they actually want. */}
          <FooterLink to="/rsvp">{t("landing.footer_guests_about")}</FooterLink>
        </FooterColumn>
      </div>

      <div className="border-t border-paper-300 dark:border-umber-700">
        {/* Bottom row tightened: copyright sits left, legal links wrap into
         *  a tidy 2-col grid on mobile so the five labels can never trail
         *  into a ragged 3rd row. Tablet+ keeps them on a single line. */}
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-4 text-xs text-umber-700 sm:flex-row sm:items-center sm:px-6 sm:py-5 dark:text-umber-300">
          <p>
            © {new Date().getFullYear()} {t("app.name")}
          </p>
          <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-x-5 sm:gap-y-2">
            <Link to="/terms" className={legalLinkClass}>
              {t("landing.footer_legal_terms")}
            </Link>
            <Link to="/privacy" className={legalLinkClass}>
              {t("landing.footer_legal_privacy")}
            </Link>
            <Link to="/impresszum" className={legalLinkClass}>
              {t("landing.footer_legal_imprint")}
            </Link>
            <Link to="/terms/vendor-subscription" className={legalLinkClass}>
              {t("landing.footer_legal_subscription")}
            </Link>
            <Link to="/about" className={legalLinkClass}>
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
      <p className="text-xs font-semibold uppercase tracking-wider text-umber-700 dark:text-umber-300">
        {title}
      </p>
      <div className="mt-3 flex flex-col items-start gap-2">{children}</div>
    </div>
  );
}

/** Specialty-coffee audience pill for the footer band: a hairline cream
 *  capsule in the grotesk voice that fills to warm espresso on hover (cream
 *  text inverts), so the row reads as a calm "which are you?" menu rather
 *  than two flat outline buttons. */
const footerBandBtnClass =
  "inline-flex items-center gap-2 rounded-full border border-paper-400/70 bg-paper-50/60 px-4 py-2 font-grotesk text-sm font-medium tracking-tight text-umber-900 shadow-soft transition-colors duration-200 hover:border-umber-800 hover:bg-umber-900 hover:text-paper-50 dark:border-umber-700 dark:bg-umber-800/50 dark:text-paper-100 dark:hover:border-paper-200 dark:hover:bg-paper-50 dark:hover:text-umber-950";

/** Center-out underline on hover/focus. `inline-block` + `relative` so the
 *  ::after baseline anchors to the text width, not the parent flex column. */
const footerLinkClass =
  "relative inline-block text-sm text-umber-800 transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-0 after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out hover:text-umber-900 hover:after:w-full focus-visible:after:w-full dark:text-paper-100 dark:hover:text-paper-50";

const legalLinkClass =
  "relative inline-block transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-0 after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out hover:text-umber-800 hover:after:w-full focus-visible:after:w-full dark:hover:text-paper-100";

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={footerLinkClass}>
      {children}
    </Link>
  );
}

function FooterAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={footerLinkClass}>
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
