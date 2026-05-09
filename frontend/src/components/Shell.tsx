import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";

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
    <header className="border-b border-paper-300 bg-paper-50/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link to="/" className="font-serif text-2xl font-semibold tracking-tight text-ink-900">
          {t("app.name")}
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
            aria-label="Switch language"
          >
            {locale === "hu" ? "EN" : "HU"}
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
