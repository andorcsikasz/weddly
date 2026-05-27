import { Languages } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
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
  return (
    <header className="border-b border-paper-300 bg-paper-50/80 backdrop-blur dark:border-umber-700 dark:bg-umber-900/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          to="/"
          className="text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
        >
          <Wordmark size="md" />
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm inline-flex items-center gap-1.5"
            onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
            aria-label={t("nav.switch_language")}
          >
            <Languages size={16} aria-hidden="true" />
            <span className="hidden sm:inline">
              {locale === "hu" ? t("nav.switch_to_en") : t("nav.switch_to_hu")}
            </span>
          </button>
          {user ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => logout()}>
              {t("common.sign_out")}
            </button>
          ) : (
            <>
              <Link className="btn-ghost btn-sm" to="/login">
                {t("landing.cta_login")}
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
