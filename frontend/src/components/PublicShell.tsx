import {
  Check,
  ClipboardList,
  LayoutDashboard,
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
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { LOCALE_NAMES, LOCALES, useT } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";
import { FeedbackDialog } from "./FeedbackDialog";
import { LocaleSwitcher } from "./LocaleSwitcher";
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
function useHeaderState(): { hidden: boolean; atTop: boolean } {
  const [hidden, setHidden] = useState(false);
  // `atTop` drives the borderless look at the very top of the page; once the
  // user scrolls, a hairline border + soft shadow fade in (via CSS transition)
  // so the translucent header stays legible over scrolled content.
  const [atTop, setAtTop] = useState(true);
  const lastY = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let cleanupScroll: (() => void) | null = null;

    const attach = () => {
      const reduced = reduce.matches;
      lastY.current = window.scrollY;
      setAtTop(window.scrollY < 8);
      if (reduced) setHidden(false);
      const onScroll = () => {
        const y = window.scrollY;
        setAtTop(y < 8);
        if (!reduced) {
          // Reduced motion: keep the header pinned; only the at-top border
          // state tracks scroll. Otherwise hide on scroll-down, reveal up.
          const dy = y - lastY.current;
          if (y < 80) setHidden(false);
          else if (dy > 4) setHidden(true);
          else if (dy < -4) setHidden(false);
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
  return { hidden, atTop };
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
        className="sr-only rounded-md bg-umber-900 px-3 py-2 text-sm font-medium text-paper-100 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:outline-none focus:ring-2 focus:ring-umber-600 focus:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:focus:ring-umber-400"
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

function navLinkClass(active: boolean) {
  return `relative px-1 py-1.5 text-sm text-umber-900 transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out hover:text-umber-900 hover:after:w-[calc(100%-0.5rem)] focus-visible:after:w-[calc(100%-0.5rem)] dark:text-paper-100 dark:hover:text-paper-50 ${active ? "font-medium after:w-[calc(100%-0.5rem)]" : "after:w-0"}`;
}

function PublicHeader() {
  const { t, locale, setLocale } = useT();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackEmail, setFeedbackEmail] = useState<string | null>(null);
  const { hidden, atTop } = useHeaderState();
  const isAudiencePage = pathname === "/planners" || pathname === "/vendors";

  // Theme toggle shared with the app shells via `localStorage["weddly.theme"]`
  // (see lib/useTheme.ts). Public default is `light` (the warm paper marketing
  // aesthetic); the authenticated shells default to `dark`.
  const [theme, setTheme] = useTheme("light");

  function openFeedback() {
    setMenuOpen(false);
    setFeedbackOpen(true);
  }

  // Deep link from mail we send to people who are NOT signed in: `/?feedback=1`
  // opens the dialog on the public page. AppShell has the same hook on `/app`,
  // but that one is behind the login wall, and the one cohort we most need to
  // hear from is the couples who already left. `&e=` prefills the reply address
  // so an answer arrives attributed instead of anonymous; it is the recipient's
  // own address, echoed back to them. Both params are stripped afterwards so a
  // refresh or the back button doesn't re-open the modal.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("feedback") !== "1") return;
    const email = searchParams.get("e");
    if (email?.includes("@")) setFeedbackEmail(email);
    setFeedbackOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("feedback");
    next.delete("e");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <header
      data-scroll-hide="true"
      data-at-top={atTop ? "true" : undefined}
      className={`sticky top-0 z-40 border-b bg-paper-50/85 backdrop-blur transition-[transform,border-color,box-shadow] duration-200 dark:bg-umber-900/85 ${
        atTop
          ? "border-transparent"
          : "border-paper-300 shadow-[0_4px_16px_-8px_rgba(58,46,34,0.25)] dark:border-umber-700"
      } ${hidden ? "-translate-y-full" : "translate-y-0"}`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          to="/"
          className="-my-1 inline-flex min-h-tap shrink-0 items-center text-umber-900 transition-colors hover:text-umber-800 sm:my-0 sm:min-h-0 dark:text-paper-50 dark:hover:text-umber-300"
        >
          {/* Header wordmark sits between Wordmark's md and lg presets:
              bigger than the body brand mark, but tracked tightly so the
              full WĒDDLY + audience cluster + right cluster fit at lg
              viewports. */}
          <Wordmark
            size="md"
            className="text-lg tracking-[0.21em] sm:text-xl sm:tracking-[0.32em]"
          />
        </Link>

        {/* Audience entry points pulled left, immediately after the
            wordmark. Vendor + Guest are the two non-couple paths —
            couples land via the right-side sign-up. */}
        <nav
          aria-label={t("public.nav_audience_aria")}
          className="ml-2 hidden items-center gap-4 font-grotesk md:flex"
        >
          {[
            { to: "/vendors", label: t("landing.nav_vendors") },
            { to: "/planners", label: t("landing.nav_planners") },
            { to: "/rsvp", label: t("landing.footer_guests") },
          ].map(({ to, label }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                className={`relative px-1 py-1.5 text-sm transition-colors after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-px after:-translate-x-1/2 after:bg-current after:transition-[width] after:duration-300 after:ease-out focus-visible:after:w-[calc(100%-0.5rem)] dark:text-paper-100 dark:hover:text-paper-50 ${
                  active
                    ? "font-medium text-umber-900 after:w-[calc(100%-0.5rem)] dark:text-paper-50"
                    : "text-umber-900 after:w-0 hover:text-umber-900 hover:after:w-[calc(100%-0.5rem)]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster — left-to-right DOM order: feedback, locale,
            theme, login, signup. The action button anchors the right
            edge alone; login sits closest to it because "I already
            have an account" is the next-most-likely intent after the
            primary CTA. The hamburger trails on mobile only. */}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            data-nav-icon
            onClick={openFeedback}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 sm:inline-flex"
            aria-label={t("landing.nav_feedback")}
            title={t("landing.nav_feedback")}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </button>
          <LocaleSwitcher
            className="hidden md:block"
            dataNavIcon
            buttonClassName="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50"
          />
          <button
            type="button"
            data-nav-icon
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors sm:h-8 sm:w-8 ${
              theme === "dark"
                ? "bg-umber-800 text-paper-50 hover:bg-umber-700 dark:bg-umber-700 dark:text-paper-50 dark:hover:bg-umber-600"
                : "text-umber-800 hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            }`}
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
          {user ? (
            <Link
              to="/app"
              data-nav-icon
              className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 sm:inline-flex"
              aria-label={t("landing.cta_open_app")}
              title={t("landing.cta_open_app")}
            >
              <LayoutDashboard size={18} aria-hidden="true" />
            </Link>
          ) : (
            <Link
              to="/login"
              data-nav-icon
              className="hidden h-8 w-8 items-center justify-center rounded-md text-umber-800 transition-colors hover:bg-paper-100 hover:text-umber-900 dark:text-paper-200 dark:hover:bg-umber-800 dark:hover:text-paper-50 sm:inline-flex"
              aria-label={t("landing.cta_login")}
              title={t("landing.cta_login")}
            >
              <LogIn size={18} aria-hidden="true" />
            </Link>
          )}
          {user ? (
            <Link
              to="/app"
              className="btn-primary hidden shrink-0 whitespace-nowrap px-4 text-sm min-h-tap !py-2.5 sm:inline-flex sm:min-h-0 sm:!py-1.5"
            >
              {t("landing.cta_open_app")}
            </Link>
          ) : (
            !isAudiencePage && (
              <Link
                to="/signup"
                className="btn-primary hidden shrink-0 whitespace-nowrap px-4 text-sm min-h-tap !py-2.5 sm:inline-flex sm:min-h-0 sm:!py-1.5"
              >
                {t("landing.cta_signup")}
              </Link>
            )
          )}
          <button
            type="button"
            data-nav-icon
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
              to="/planners"
              className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
              onClick={() => setMenuOpen(false)}
            >
              <Store size={16} aria-hidden="true" className="text-umber-600 dark:text-umber-300" />
              <span>{t("landing.nav_planners")}</span>
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
            {user ? (
              <Link
                to="/app"
                className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                onClick={() => setMenuOpen(false)}
              >
                <LayoutDashboard
                  size={16}
                  aria-hidden="true"
                  className="text-umber-600 dark:text-umber-300"
                />
                <span>{t("landing.cta_open_app")}</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-3 rounded-md px-2 py-2.5 lowercase transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                onClick={() => setMenuOpen(false)}
              >
                <LogIn
                  size={16}
                  aria-hidden="true"
                  className="text-umber-600 dark:text-umber-300"
                />
                <span>{t("landing.cta_login")}</span>
              </Link>
            )}
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
            <div>
              <p className="flex items-center gap-3 px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-umber-600 dark:text-umber-300">
                <Languages size={16} aria-hidden="true" />
                {t("nav.switch_language")}
              </p>
              {LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-checked={l === locale}
                  onClick={() => {
                    if (l !== locale) setLocale(l);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-paper-100 hover:text-umber-900 dark:hover:bg-umber-800 dark:hover:text-paper-50 ${
                    l === locale ? "font-semibold text-umber-900 dark:text-paper-50" : ""
                  }`}
                >
                  <span>{LOCALE_NAMES[l]}</span>
                  {l === locale && <Check size={16} aria-hidden="true" className="shrink-0" />}
                </button>
              ))}
            </div>
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
                  <Sun
                    size={16}
                    aria-hidden="true"
                    className="text-umber-600 dark:text-umber-300"
                  />
                ) : (
                  <Moon
                    size={16}
                    aria-hidden="true"
                    className="text-umber-600 dark:text-umber-300"
                  />
                )}
                <span>{theme === "dark" ? t("nav.switch_to_light") : t("nav.switch_to_dark")}</span>
              </span>
            </button>
          </div>
        </nav>
      )}
      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        source="landing"
        initialEmail={feedbackEmail}
        preface={feedbackEmail ? t("landing.feedback_preface_invited") : undefined}
      />
    </header>
  );
}

function PublicFooter() {
  const { t, locale } = useT();
  const { pathname } = useLocation();
  const onVendorPage = pathname === "/vendors";
  const isAudiencePage = pathname === "/planners" || pathname === "/vendors";
  const askGuestCode = useGuestCodePrompt();
  const couplesCardsPath =
    locale === "hu" ? "/eszkozok/100-kerdes-eskuvo-elott" : "/tools/100-questions-before-marriage";
  return (
    // The footer is a black slab in BOTH themes — an intentional hard edge that
    // closes the cream page. The `dark` class on the element (Tailwind's
    // class strategy is descendant-based, so it styles the subtree, not itself)
    // flips every child's `dark:` variant on, which is why the links, borders,
    // social icons and the who-are-you band all read correctly on umber-950
    // without a single duplicated colour. One tone for the whole slab, band
    // included — the two-shade split read as a seam rather than a section.
    <footer
      className="dark mt-16 bg-umber-950 font-grotesk sm:mt-24"
      // The landing page's mobile sticky CTA stands down once the footer is on
      // screen: its backdrop is a cream scrim sized for the cream page, and
      // over this black slab it paints a smear instead of a separation. Inert
      // anywhere the bar does not exist, which is every other public page.
      data-sticky-cta-stop=""
    >
      {/* Band: who-are-you. Hidden on audience pages (/planners, /vendors)
       *  which already have their own escape-route sections immediately above
       *  the footer — showing it again here would be a duplicate. On the
       *  vendor page the "I'm a vendor" button loops to the same page, so
       *  we swap it for a couples CTA instead. */}
      {!isAudiencePage && (
        <div>
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-x-6 gap-y-3 px-4 py-5 sm:flex-row sm:flex-wrap sm:justify-center sm:px-6 sm:py-8">
            <span className="font-grotesk text-[0.7rem] font-medium uppercase tracking-[0.22em] text-umber-600 dark:text-umber-300">
              {t("landing.footer_band_prompt")}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to="/vendors" className={footerBandBtnClass}>
                <Store size={15} aria-hidden />
                {t("landing.footer_band_cta_vendor")}
              </Link>
              <Link to="/planners" className={footerBandBtnClass}>
                <ClipboardList size={15} aria-hidden />
                {t("landing.footer_band_cta_planner")}
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
      )}

      {/* Mobile = 2-col grid: brand+tagline span the top row, then Couples
       *  fills the left column while Vendors + Guests stack in the right
       *  column. Desktop (lg) expands to brand + 3 link columns — the
       *  right-column wrapper uses lg:contents so its two columns rejoin
       *  the grid as direct children. */}
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-4 px-4 py-5 sm:gap-8 sm:px-6 sm:py-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-12">
        <div className="col-span-2 lg:col-span-1">
          <Wordmark size="md" className="text-umber-900 dark:text-paper-50" />
          <p className="mt-1.5 max-w-xs text-sm leading-snug text-umber-700 sm:mt-3 sm:leading-relaxed dark:text-umber-200">
            {t("landing.footer_tagline")}
          </p>
          <div className="mt-3 flex items-center gap-2 sm:mt-4">
            <a
              href="https://www.tiktok.com/@tryweddly.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("landing.footer_social_tiktok")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-600 transition-colors hover:bg-paper-200 hover:text-umber-900 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.77a4.85 4.85 0 0 1-1.01-.08z" />
              </svg>
            </a>
            <a
              href="https://www.facebook.com/tryweddly"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("landing.footer_social_facebook")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-600 transition-colors hover:bg-paper-200 hover:text-umber-900 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/tryweddly"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("landing.footer_social_instagram")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-umber-600 transition-colors hover:bg-paper-200 hover:text-umber-900 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.72 3.72 0 0 1-1.38-.9 3.72 3.72 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
              </svg>
            </a>
          </div>
        </div>
        <FooterColumn title={t("landing.footer_couples")}>
          <FooterLink to="/signup">{t("landing.footer_couples_signup")}</FooterLink>
          <FooterLink to="/login">{t("landing.footer_couples_signin")}</FooterLink>
          <FooterAnchor href="/#phases">{t("landing.footer_couples_features")}</FooterAnchor>
          <FooterLink to="/blog">{t("blog.eyebrow")}</FooterLink>
          <FooterLink to={couplesCardsPath}>{t("landing.footer_couples_cards")}</FooterLink>
        </FooterColumn>
        {/* Mobile: Vendors + Guests stack in the right grid column (Guests
         *  directly under Vendors). `lg:contents` dissolves this wrapper on
         *  desktop so both columns become direct grid children again and the
         *  4-column brand+Couples+Vendors+Guests row is restored. */}
        <div className="flex flex-col gap-y-4 lg:contents">
          <FooterColumn title={t("landing.footer_vendors")}>
            <FooterLink to="/vendors">{t("landing.footer_vendors_waitlist")}</FooterLink>
          </FooterColumn>
          <FooterColumn title={t("landing.footer_planners")}>
            <FooterLink to="/planners">{t("landing.footer_planners_waitlist")}</FooterLink>
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
      </div>

      <div className="border-t border-paper-300 dark:border-umber-700">
        {/* Minimal single-line bar: copyright + every legal link flow in one
         *  flex-wrap row at all widths. On phones they wrap to as few lines
         *  as the labels allow (no rigid 2-col grid forcing a tall block);
         *  on tablet+ everything sits on one line, copyright pushed left. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-umber-700 sm:gap-x-5 sm:px-6 sm:py-4 dark:text-umber-300">
          <p className="sm:mr-auto">
            © {new Date().getFullYear()} {t("app.name")}
          </p>
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
      <div className="mt-2 flex flex-col items-start gap-1.5 sm:mt-3 sm:gap-2">{children}</div>
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
